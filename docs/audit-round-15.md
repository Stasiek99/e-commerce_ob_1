# E-Commerce Audit — Round 15
*Generated: 2026-06-18 — 4-agent stochastic consensus*
*Agents: Domain Expert (Money & Checkout) · Skeptic (Money & Checkout, today's fix verification) · Domain Expert (Catalog & Engagement) · Risk Analyst/Systems Thinker (Catalog & Engagement, concurrency)*

> **Excludes** everything already in `docs/audit-exclusion-list.md` (~331 prior findings across rounds 1-14).
> **Excludes** settled tradeoffs in `docs/accepted-tradeoffs.md`.
> **Excludes** Phase 7 (pre-launch checklist) items in ROADMAP.md.
> **Scope:** Money & Checkout (payments, orders, cart, coupons, returns, invoice + checkout/cart frontend) and Catalog & Engagement (products, categories, reviews, wishlist, stock SSE/back-in-stock + catalog frontend) only. Auth, shipping/carriers, email/BullMQ infra, accessibility, SEO, generic security headers, and GDPR/legal were explicitly out of scope this round.

This round deliberately pointed one agent per domain at commit `f85974d` — round 14's fix commit, which landed *the same day* this round ran — on the theory (validated repeatedly in rounds 13-14) that freshly-changed code is exactly where sibling-call-site misses and "fixed leak A, opened leak B" regressions hide. That bet paid off again: **two independent agents (Domain Expert and Skeptic), working separately, converged on the same root mechanism** in Money & Checkout — today's new `cancel-lock` only protects one of six code paths that mutate the same refund/cancellation state — which is the strongest possible signal this is real, not a false positive. Catalog & Engagement's two agents found a regression introduced by today's own guest-wishlist fix (the revalidation logic that fixed staleness introduced a new overwrite race), plus two pre-existing gaps neither domain-expert nor skeptic pass had looked at before (admin stock-edit TOCTOU, and a second variant-edit endpoint that bypasses the stock-notification choke point entirely).

---

Done:
## 🔴 CRITICAL — Today's new `cancel-lock` only guards 1 of 6 code paths that mutate refund/cancellation state *(Domain Expert + Skeptic, independently converged)*

**Files:** `backend/src/modules/orders/orders.service.ts:763-844` (`cancelByUser`), `:846-903` (`cancelByToken`), `:1163-1174` (`rejectFraudReview`), `:1302-1410` (`bulkCancel`); `backend/src/modules/payments/payments.controller.ts:96-103` (admin `POST /payments/:orderId/refund`); `backend/src/modules/returns/returns.service.ts:276-403` (`markRefunded`)

Exclusion-list entry #64 records that `cancelItemsByUser`/`partialRefund` got a `cancel-lock:${orderId}` Redis `SET NX` lock today specifically to stop two concurrent cancellation requests from both reading stale `refundedAmountInCents`/`cancelledQuantity`, building an identical Stripe idempotency key, and then *each* still running its own DB transaction that double-increments stock and `cancelledQuantity` even though Stripe itself dedupes the actual refund call. That lock was added in exactly one place. Five other call sites reach the same unguarded `PaymentsService.refundPayment`/`partialRefund` methods — which have no internal locking of their own (no `SELECT ... FOR UPDATE`, and that primitive is a documented no-op under this stack's pgbouncer transaction-mode pooling anyway):

- `cancelByUser` — the customer-facing "cancel whole order" button (`POST /orders/:id/cancel`) — calls `refundPayment` directly, no lock.
- `cancelByToken` (guest cancel-link flow) — same unguarded `tx.productVariant.update({ stock: { increment } })` loop.
- `rejectFraudReview` (admin) — calls `refundPayment` directly, no lock.
- `bulkCancel` (admin) — calls `refundPayment` directly, no lock.
- `PaymentsController.refund` (admin `POST /payments/:orderId/refund`) — calls `refundPayment` directly, no lock.
- `ReturnsService.markRefunded` — calls `partialRefund` directly, no lock.

Concrete trigger: a customer clicks "cancel item A" via the (now-locked) `cancelItemsByUser` at the same moment an admin clicks "mark return refunded" for the same item via the (unlocked) `markRefunded`. Both read `payment.refundedAmountInCents = 0` before either commits, building the **identical** Stripe idempotency key — Stripe correctly dedupes the charge-side refund (money is safe) — but each caller's own `$transaction` still runs independently, both incrementing `cancelledQuantity` and restoring stock for the same physical units. Result: `cancelledQuantity` can exceed `item.quantity` (no DB CHECK constraint catches this per exclusion-list #127), `refundedAmountInCents` is double-counted (corrupting the `available = amountInCents - refundedAmountInCents` cap every subsequent partial refund relies on), phantom inventory becomes oversellable, and `allCancelled` can prematurely flip the order to fully `REFUNDED`. The commit's own intent ("mirrors the checkout-lock pattern in `createFromCart`") assumed refund/cancellation state has one mutation entry point the way checkout does — it has at least six.

**Fix:** Move lock acquisition into `PaymentsService.refundPayment`/`partialRefund` themselves (keyed on `orderId`), so every current and future caller is protected by construction instead of relying on each call site to remember it. This single change retroactively covers all five gaps above.

---

## 🟠 HIGH — `cancelByUser` is missing `DISPUTE_LOST_REVIEW` from its rejected-status checks — sibling inconsistency with the dispute-block fix that landed today *(Skeptic)*

**File:** `backend/src/modules/orders/orders.service.ts:763-798`

`cancelByUser` denylists `CANCELLED`/`REFUNDED` (:770), `SHIPPED`/`DELIVERED` (:774), `FRAUD_REVIEW` (:780), `PARTIALLY_REFUNDED` (:786), and `DISPUTE_HOLD` (:792), then falls through to `isRefund = [PAID, PROCESSING].includes(order.status)` (:798) and ultimately `refundPayment(orderId, 'CUSTOMER', reason)` (:829) for anything not explicitly blocked. `OrderStatus.DISPUTE_LOST_REVIEW` matches none of the denylisted values, so it falls through to the refund branch. Per `accepted-tradeoffs.md`'s "dispute-lost stock is never auto-restored" entry, a `lost` dispute is deliberately left in `DISPUTE_LOST_REVIEW` pending **explicit admin confirmation** before stock is restored — `refundPayment`'s only internal guard is `payment.status !== COMPLETED` (which a lost-dispute payment still satisfies, since the dispute branch only touches `Order.status`). A customer can therefore call `POST /orders/:id/cancel` on their own dispute-lost order and trigger a real Stripe refund attempt on funds Stripe already paid out via chargeback — directly bypassing the admin-confirmation gate the tradeoff relies on. `returns.service.ts`'s `markRefunded` got a `disputeBlockedStatuses` allowlist *today* that correctly includes `DISPUTE_LOST_REVIEW` (lines 362-372) — this is the identical bug class, missed in the sibling service.

**Fix:** Add `OrderStatus.DISPUTE_LOST_REVIEW` to `cancelByUser`'s (and `bulkCancel`'s `nonCancellableStatuses`, and `rejectFraudReview`'s, and the admin refund controller's) rejected-status checks.

---

## 🟠 HIGH — Today's guest-wishlist revalidation fix has two unsynchronized-overwrite races: login-during-revalidation and toggle-during-revalidation *(Domain Expert + Risk Analyst, independently converged)*

**File:** `frontend/src/app/core/services/wishlist.service.ts:29-41, 47-71, 118-145`

Today's fix made `revalidateGuestItems(stored)` re-fetch each guest wishlist item by slug to drop stale/deactivated entries (exclusion-list-bound finding from round 14). The completion callback does an unconditional `this._items.set(valid); this.saveToStorage();` with no check of whether anything changed underneath it while the `forkJoin` of N HTTP calls was in flight. Two independent races follow from the same root cause:

1. **Login race.** If the user logs in while guest revalidation is still in flight, the constructor's `effect()` re-fires for `isAuthenticated=true` and runs `syncFromBackend`, which merges/fetches the real backend wishlist, clears `localStorage`, and sets `_items()` to the authenticated set. If the slower guest-revalidation response resolves afterward, its callback overwrites `_items()` back to the stale pre-login guest set and re-writes `wishlist_v1` to `localStorage` — silently discarding the just-synced backend data until the next reload or auth-state change.
2. **Toggle race.** If the user clicks the wishlist heart (`toggle()`, called from `product-detail.component.ts:1503`) while guest revalidation is in flight, `toggle()` synchronously mutates and persists `_items` — but the revalidation's later completion overwrites `_items` with its own stale-snapshot-derived array (captured from the `items` parameter at call time), silently dropping the user's just-made toggle and re-persisting the stale state.

Both are reproducible by ordinary user action (logging in or clicking the heart icon within about a second of a guest page load) — no scripting required.

**Fix:** Guard the revalidation completion callback with an auth-state check before overwriting (skip if `auth.isAuthenticated()` flipped true mid-flight), and have it merge into the *current* `_items()` value at completion time rather than blindly replacing it — or track a "dirty since" / generation counter so a `toggle()` that happened after revalidation started always wins.

---

## 🟠 HIGH — Admin `updateVariantStock` is a TOCTOU race, not an atomic write *(Risk Analyst)*

**File:** `backend/src/modules/products/products.service.ts:571-594`

`updateVariantStock` reads `variant.stock` via `findUnique` (:572), computes `newStock` in application code from that snapshot (`dto.set` or `variant.stock + dto.adjustment`, :575-577), then performs an unconditional `prisma.productVariant.update({ data: { stock: newStock } })` (:581-584) — a plain overwrite, not an atomic `increment`/`decrement` or a `WHERE`-guarded `updateMany`. Two concurrent adjustment-mode calls (two admins correcting stock at once, or a bulk-import script racing a manual edit) both read the same pre-mutation stock, both compute `newStock` from that identical stale base, and the second `update()` silently clobbers the first with no conflict signal. This is exactly the TOCTOU class the codebase explicitly hardened against elsewhere — `orders.service.ts:281-284`'s own comment notes a separate `findUnique` + `update` would be this same race, which is why checkout stock decrements use a `WHERE stock >= quantity`-guarded `updateMany` instead. That pattern was never applied to this admin endpoint. It also means `notifyStockChange`'s reported `previousStock` (:586-592) can be stale if a concurrent mutation landed between the read and the write, misreporting a 0→positive or positive→0 transition to the back-in-stock notifier/SSE stream.

**Fix:** Use a single atomic statement for adjustment mode, e.g. `UPDATE product_variants SET stock = GREATEST(0, stock + $adjustment) WHERE id = $id RETURNING stock`, deriving `previousStock` from the returned row rather than a separate pre-read.

---

## 🟠 HIGH — `updateVariant` (general variant editor) can change stock without notifying the SSE stream or back-in-stock subscribers *(Risk Analyst)*

**File:** `backend/src/modules/products/products.service.ts:532-549`, `backend/src/modules/products/dto/product.dto.ts:345-348`

`UpdateVariantDto` (the DTO for the general `PATCH /products/:id/variants/:variantId` editor endpoint) includes an optional `stock?: number` field. `updateVariant()` passes `data` straight into `prisma.productVariant.update({ data })` and returns — there is no call to `notifyStockChange`/`notifyStockChangesByDelta` anywhere in this method, unlike the dedicated `updateVariantStock()` a few lines below it. The exclusion list records that *every* stock-mutation call site was centralized through one notification helper as a deliberate fix ("Real stock mutations... 11 call sites... fixed by centralizing the publish + notifier check into one helper called from every mutation site"). `updateVariant` is a 12th call site that mutates `stock` and was never wired in — an admin editing a variant's SKU and bumping its stock in the same request leaves wishlisted customers un-notified on restock and the storefront's live stock badge stale.

**Fix:** Either strip `stock` from `UpdateVariantDto` (force all stock edits through `updateVariantStock`), or have `updateVariant()` detect `data.stock !== undefined`, capture before/after, and call `notifyStockChange` the same way `updateVariantStock` does.

---

## 🟡 MEDIUM — Frontend full-cancel and partial-cancel buttons share no in-flight guard — the realistic trigger for the CRITICAL lock gap above *(Skeptic)*

**File:** `frontend/src/app/features/account/orders/order-detail.component.ts:155-198, 241-246`

The order-detail page renders a full-cancel zone (guarded only by its own `cancelling()` signal) and a partial-cancel zone (guarded only by its own `submittingPartial()` signal) simultaneously when both are eligible for the same order — with no shared in-flight flag between them. A user can click "cancel whole order," then before the response returns, open the partial-cancel panel and submit a partial cancellation for the same order — two genuinely concurrent requests hitting two different backend code paths, one of which is locked today and one of which isn't (see the CRITICAL finding above). This requires no scripting, just ordinary fast clicking between two adjacent UI sections.

**Fix:** Add one shared per-order in-flight signal that disables both the full-cancel and partial-cancel UI regions while either request is outstanding.

---

## 🟡 MEDIUM — Authenticated wishlist is missing Omnibus price-history, sale badge, catalog number, and gender data that the guest wishlist now has *(Domain Expert)*

**File:** `backend/src/modules/wishlist/wishlist.service.ts:8-39`, `backend/src/modules/products/products.service.ts:873-917` (`attachOmnibusData`), `frontend/src/app/shared/product-card/product-card.component.html:21-23, 39, 42-44, 51-58`

`WishlistService.getItems()` (the authenticated backend path) selects only `{ id, label, priceInCents, stock }` on variants, never includes `catalogNumber`/`gender` on the product projection, and never runs results through `attachOmnibusData()` — the helper every other product-listing path (`findAll`, `findBySlug`, `findRelated`) uses to populate `compareAtPriceInCents`/`lowestPrice30dInCents`. Today's guest-wishlist fix re-fetches each guest item via `GET /products/:slug` → `findBySlug()` → `attachOmnibusData()`, so a guest's wishlist cards now correctly show the sale badge and Omnibus disclosure for the same product an authenticated user's wishlist page never shows them for. This gap is pre-existing on the backend, but today's frontend-only fix converted a previously-symmetric omission (neither path enriched) into a visible authenticated-vs-guest inconsistency for identical data.

**Fix:** Have `WishlistService.getItems()` route its result through `attachOmnibusData()` (already exported in a reusable shape) and add `catalogNumber`/`gender` to its `select`, matching `findBySlug()`'s enrichment.

---

## 🟡 MEDIUM — SSE idle-reconnect signal crashes the frontend stream handler instead of triggering a reconnect *(Risk Analyst)*

**File:** `backend/src/modules/products/products.controller.ts:100-106`, `frontend/src/app/core/services/stock-stream.service.ts:15-33`, `frontend/src/app/features/catalog/product-detail/product-detail.component.ts:1304-1328`

After 5 minutes idle, the backend SSE handler sends `{ data: { reconnect: true } }` then calls `subscriber.complete()` — deliberately ending the response so the client reconnects. The frontend's `StockStreamService.connect()` has no special case for this payload: `source.onmessage` does `subscriber.next(JSON.parse(event.data) as StockUpdate[])` unconditionally, forwarding the plain `{ reconnect: true }` object as if it were an array. `product-detail.component.ts`'s `next` handler then calls `updates.find(...)` on it — `.find` doesn't exist on a plain object, throwing a `TypeError`. RxJS routes that synchronous throw to the subscription's `error` path, which sets `stockLive.set(false)` and closes the `EventSource` via the service's teardown. Nothing then opens a new `EventSource` — the code comment ("EventSource reconnects automatically per SSE spec") is true only for transient network-level drops on a still-alive `EventSource`, not for this deliberately-and-cleanly-closed case. Net effect: the live stock stream permanently dies after 5 minutes on any page left open that long, silently freezing every "live" stock badge with no recovery short of a manual reload.

**Fix:** Have the frontend check for the reconnect signal (e.g. `if (parsed && 'reconnect' in parsed)`) before treating the payload as `StockUpdate[]`, close the current `EventSource`, and re-invoke `connect()` to open a fresh one — rather than relying on browser-native retry that doesn't apply to this case.

---

## 🟢 LOW — `notifyStockChangesByDelta`'s aggregation correctness depends on an unenforced caller-array-order contract *(Domain Expert)*

**File:** `backend/src/modules/products/products.service.ts:624-654`

When multiple deltas for the same `variantId` appear in one batch, the aggregation does last-write-wins on `newStock` (`delta: (existing?.delta ?? 0) + delta, newStock`) — correct only if the array is in transaction-commit order, since `previousStock` is derived as `newStock - summedDelta`. Every current caller satisfies this by construction (sequential `for` loops that push into the array in the same order they call `tx.productVariant.update()`), and a schema-level `@@unique([cartId, productVariantId])` on `CartItem` means a single order can't even produce two `OrderItem`s for the same variant today — so there is no live bug. But nothing in the function's signature or body enforces the ordering assumption; a future caller built around `Promise.all` (parallel awaits) instead of a sequential loop would silently mis-derive `previousStock`, causing a missed or spurious back-in-stock email with no crash to surface it — exactly the failure class this round's fix was written to eliminate, reopened by construction the next time someone parallelizes a stock-restore loop for performance.

**Fix:** Not urgent given no current violation, but worth hardening defensively — e.g. have each caller pass its own pre-write stock alongside `newStock` so the function can assert `newStock - delta === previousEntryNewStock` and fail loudly instead of silently miscomputing.

---

## Notes — verified clean

**Money & Checkout** — both agents independently re-verified every fix `f85974d` claimed and found all of them complete and correct on their own terms (the gaps above are sibling-call-site misses, not flaws in the fixes themselves):
- Stripe `apiVersion` pin (`2026-05-27.dahlia`) — matches `accepted-tradeoffs.md` exactly, no second unpinned Stripe instance anywhere.
- Webhook route's `@SkipThrottle({ burst: true, sustained: true })` — correctly layered alongside its own `@Throttle({ default })`, backed by a real integration test that boots the actual guard stack.
- `POST /cart/items`'s restored `@Throttle({ default: { ttl: 60_000, limit: 20 } })` — correctly scoped to `addItem` only.
- `cancelItemsByUser`'s own lock lifecycle — `try/finally` releases on every exit path including thrown exceptions; atomic Lua compare-and-delete release token prevents cross-request lock theft after TTL expiry; no TOCTOU gap between lock acquisition and the order read (always read fresh, never cached pre-lock).
- `returns.service.ts`'s new `disputeBlockedStatuses` re-check inside `markRefunded` — complete and correctly placed immediately before `partialRefund` (the missing `DISPUTE_LOST_REVIEW` check is in the *sibling* `cancelByUser`, not here).
- `newStock` plumbing — every money-path call site (`createFromCart`, `cancelByUser`, `cancelByToken`, `retryPayment` rollback, `updateStatus`, `bulkCancel`, `refundPayment`, `partialRefund`, `handlePaymentFailure`, `sweepOrphanedPendingOrders`) reads `newStock` from its own transaction's write, never a post-commit re-read.
- Coupons and invoice modules — untouched by today's commit, nothing new found.

**Catalog & Engagement** — both agents independently confirmed:
- `CategoriesService.findAll()`'s unbounded-depth flat-query rewrite is complete, cycle-safe, and handles dangling `parentId` defensively; no third hardcoded-depth traversal site exists anywhere else in the codebase (cross-checked against the sibling recursive-CTE fix in `products.service.ts`'s `resolveCategorySlugs`).
- `notifyStockChangesByDelta`'s explicit-before/after fix reached every one of its ~11 callers across `orders.service.ts`/`payments.service.ts` — none reverted to a post-commit re-read (see the LOW finding above for the one remaining *unenforced*, not *violated*, contract risk).
- The guest-wishlist revalidation mechanism itself (re-fetch by slug, drop on 404, independent per-item failure handling, no-op when empty/SSR) is implemented correctly and unit-tested for all of those cases — the HIGH finding above is specifically about its interaction with concurrent auth-state changes and `toggle()`, not the revalidation logic in isolation.
- Review lifecycle (`resubmit()`'s helpful-count/vote reset, `markHelpful`'s guard/throttle/unique-constraint stack, review-`orderId` threading from product detail), back-in-stock targeting, search/sort tiebreakers, and category cycle-detection were all re-checked and match already-documented/excluded state — nothing new.

---

This round's findings, once resolved, should be folded into `docs/audit-exclusion-list.md` per its own maintenance instructions.
