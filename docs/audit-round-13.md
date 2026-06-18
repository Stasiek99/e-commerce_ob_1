# E-Commerce Audit — Round 13
*Generated: 2026-06-17 — 7-agent stochastic consensus*
*Agents: Domain Expert (payments/finance depth) · Skeptic (fix-verification) · Pragmatist (ops/infra/deploy) · First-Principles (cross-subsystem invariants) · Risk Analyst (admin security depth) · Systems Thinker (concurrency/replica races) · End-User Advocate (frontend/backend contract drift)*

> **Excludes** everything already in `docs/audit-exclusion-list.md` (~300 prior findings across rounds 1-12).
> **Excludes** Phase 7 (pre-launch checklist) items in ROADMAP.md.

This round's theme: the auth/IDOR/injection/admin-security layer is confirmed stable again (Risk Analyst's dedicated admin-security pass came back fully clean — picklist/fulfillment-gap routes correctly carry their own auth check, independent of the session-fixation guard fixed in `c8d02ad`). New findings instead cluster at **integration seams between independently-correct subsystems**: a live-stock SSE stream and back-in-stock notifier that nothing outside one admin endpoint actually feeds; a frontend that hardcodes its own copies of status-gating arrays that silently desync every time the backend's `OrderStatus` enum grows; a Stripe idempotency key that was designed for the 1st/2nd cancellation case and collides on the 3rd; and a cron job that's the lone outlier missing the distributed-lock pattern every one of its 9 siblings uses. One finding (the first below) is not hypothetical — it's a live, reproduced break sitting in the working tree right now.

---
## 🔴 CRITICAL — Uncommitted `pnpm.overrides` edit is inert and will hard-fail every frozen-lockfile install *(Pragmatist)*

**File:** `package.json:24-84` (working tree, uncommitted) vs `pnpm-lock.yaml` (unchanged)

`package.json` currently has ~30 new `pnpm.overrides` entries (tar, hono, vite, esbuild, ws, qs, etc.) added to remediate the CVEs in the untracked `audit-prod.txt`/`audit-full.json` dumps sitting in the repo root — but `pnpm-lock.yaml` was never regenerated to match. **Confirmed by reproduction:** `pnpm install --frozen-lockfile` fails immediately with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` ("the current overrides configuration doesn't match the value found in the lockfile"). Railway's `installCommand`, Vercel's build, and CI's install step all use `--frozen-lockfile` — the moment this `package.json` is committed and pushed as-is, all three pipelines break at the first step. `pnpm audit` also confirms the overrides currently do nothing yet anyway (still reports the same vulnerability count, including a `hono` CORS-credentials CVE), since they were never applied to the lockfile.

**Fix:** run `pnpm install --no-frozen-lockfile` to regenerate `pnpm-lock.yaml` against the new overrides, re-run `pnpm audit --audit-level=high` to confirm it drops to zero high/critical, then commit `package.json` + `pnpm-lock.yaml` together in the same commit.

---

## 🟠 HIGH — Partial-refund idempotency key collides across unrelated cancellation calls on a 3rd/4th sequential cancellation *(Domain Expert)*

**File:** `backend/src/modules/payments/payments.service.ts:1192-1194` (called from `backend/src/modules/orders/orders.service.ts:1024`)

`partialRefund`'s Stripe idempotency key is built only from the current call's `orderItemId:quantity` pairs, with no sequence number or running-total baked in. A customer who cancels 1 unit of item A, then 2 units of item B, then 1 *more* unit of item A (a normal three-call sequence if remaining stock supports it) produces an identical key for calls 1 and 3. Stripe caches idempotency keys for 24h, so call 3's `refunds.create` silently returns the **cached result of call 1** — no new Stripe refund is issued — while the DB transaction still increments `cancelledQuantity`, restores stock, and increments `payment.refundedAmountInCents` as if a real second refund happened. The order shows the item cancelled and "refunded," but Stripe never actually returned that money: a silent, permanent revenue-side discrepancy only a manual Dashboard reconciliation would catch.

**Fix:** Bake a monotonic per-order correction sequence (or the order's current `refundedAmountInCents`) into the idempotency key so repeated identical item/quantity combinations across different calls never collide.

---

## 🟠 HIGH — No guard against zero-decimal currencies if `STRIPE_CURRENCY` is ever changed *(Domain Expert)*

**File:** `backend/src/modules/payments/stripe.client.ts:90-91`, `backend/src/modules/payments/payments.service.ts:71-89`, `backend/src/modules/invoice/invoice.service.ts` (no currency handling at all)

Every money computation (`snapshotPrice`, `unitAmount`, `amount_off`, `totalInCents`, invoice VAT math) assumes the configured `STRIPE_CURRENCY` always uses a 2-decimal minor unit (gr/100 = zł) and passes those integers straight to Stripe's `unit_amount`/`amount_off`/`amount` fields. Stripe defines a list of zero-decimal currencies (JPY, KRW, VND, CLP, etc.) where the integer passed to the API is the *whole* unit, not 1/100th of it. If `STRIPE_CURRENCY` is ever changed to one of these (e.g. market expansion), every Checkout line item, coupon, and refund amount would be silently interpreted as 100x the intended value, with zero validation anywhere in the path.

**Fix:** Add a zero-decimal-currency lookup (mirroring the existing `STRIPE_MINIMUM_CHARGE_IN_CENTS` table pattern) and reject non-2-decimal currencies at boot via `config.validation.ts`, or convert amounts accordingly.

---

## 🟠 HIGH — Real stock mutations from sales/cancellations never reach the live-stock SSE stream or the back-in-stock notifier *(First-Principles)*

**File:** `backend/src/modules/products/products.service.ts:578` (the only publish site) vs. eleven mutation sites across `backend/src/modules/orders/orders.service.ts` (lines 281, 426, 782, 841, 894, 1149, 1270) and `backend/src/modules/payments/payments.service.ts` (lines 737, 1001, 1123, 1209, 1592)

Both the SSE stock-stream and the back-in-stock notifier assume every write to `ProductVariant.stock` is observable through the `stock:updates` Redis channel / triggers `dispatchBackInStockNotifications`. In reality, only the admin manual stock-edit endpoint (`ProductsService.updateVariantStock`) publishes to Redis or fires the notifier. Every real checkout decrement, cancellation restore, payment-failure restore, and dispute restore writes `stock` directly via Prisma inside a transaction and never touches either mechanism. A customer watching the live-stock badge during checkout never sees stock actually drop when someone else buys the last unit, and a customer who opted into "notify me when back in stock" never gets an email when stock is restored by a cancellation or refund — only by a manual admin edit.

**Fix:** Centralize the `stock:updates` publish + back-in-stock check into one helper called from every site that mutates `ProductVariant.stock` (or a Prisma middleware hook), so no call site can bypass it.

---

## 🟠 HIGH — Playwright e2e suite exists and is fully wired, but CI never runs it *(Pragmatist)*

**File:** `.github/workflows/ci.yml:1-87`, `e2e/playwright.config.ts`, `package.json:13-14`

The root `package.json` defines `test:e2e` → `pnpm --filter e2e test`, and `e2e` is a real workspace package with a working Playwright config (used manually via the `run-e2e-smoke` skill). `ci.yml` only runs backend/frontend unit-level Jest — nothing boots the app and runs `test:e2e` against it. A regression that breaks the actual checkout flow end-to-end (cart → Stripe redirect → webhook → success page) can merge to `main` and deploy with a fully green CI run.

**Fix:** Add a CI job that boots backend+frontend against the CI Postgres/Redis services and runs `pnpm test:e2e`, at minimum on PRs into `main`.

---

## 🟡 MEDIUM — `sweepOrphanedPendingOrders` stock-restore still uses raw `quantity`, the exact bug shape `782e711` just fixed four lines away *(Skeptic)*

**File:** `backend/src/modules/payments/payments.service.ts:998-1002`

Commit `782e711` fixed `handlePaymentFailure` to restore `item.quantity - item.cancelledQuantity` instead of raw `item.quantity`, explicitly because it was "unlike the other three stock-restore sites." `sweepOrphanedPendingOrders` (the 2-hour PENDING_PAYMENT reconciliation sweep, same file) still increments stock by raw `item.quantity` with no subtraction. Currently unreachable — `ORDER_STATUS_TRANSITIONS` forbids any path back to `PENDING_PAYMENT` from a state where `cancelledQuantity > 0` could exist — but it's the identical "currently dead, future landmine" shape the prior fix was justified on, missed in the same file ~250 lines away.

**Fix:** Apply `item.quantity - (item.cancelledQuantity ?? 0)` at this site too, for consistency and defense-in-depth.

---

## 🟡 MEDIUM — `cleanupStaleShippingLabels` is the only cron job (of 10) with no distributed lock *(Systems Thinker)*

**File:** `backend/src/modules/shipping/shipping.service.ts:269-305`

Full inventory taken: 10 `@Cron` jobs + 1 `@Interval` + 1 BullMQ worker exist in the backend. Nine of the ten `@Cron` jobs take the standard `redis.set('cron:<name>:lock', '1', 'EX', <ttl>, 'NX')` guard before mutating rows. `cleanupStaleShippingLabels` is the sole outlier with no lock at all. On any multi-replica deploy, every replica independently queries the same stale `Shipment` rows every Monday at 03:00 and races duplicate Supabase deletes + Prisma updates on the same rows. The Supabase delete is idempotent so this doesn't crash, but it's wasted, duplicated work scaling with replica count — exactly the bug class every sibling cron was already hardened against.

**Fix:** Add the same `SET NX` Redis lock guard used by the other 9 crons before the `findMany`.

---

## 🟡 MEDIUM — Order status badge falls back to the raw enum string for `DISPUTE_HOLD`/`DISPUTE_LOST_REVIEW` *(End-User Advocate)*

**File:** `frontend/src/app/features/account/orders/order-list.component.ts:20-30`, `order-detail.component.ts:60-70`, `frontend/src/styles.scss:49-56`

The `STATUS_LABELS` map covers 9 of 11 `OrderStatus` values but omits `DISPUTE_HOLD` and `DISPUTE_LOST_REVIEW` (both reachable per `ORDER_STATUS_TRANSITIONS`). `statusLabel()` falls back to `?? status`, so a customer in either state sees the literal string "DISPUTE_HOLD" as their order status, with no matching badge color in `styles.scss` either — an alarming raw technical string on a customer-facing page about a payment dispute.

**Fix:** Add Polish labels and badge colors for both states in `order-list`/`order-detail` and `styles.scss`.

---

## 🟡 MEDIUM — "Cancel order" button shown on `PARTIALLY_REFUNDED` orders, but the backend always rejects it *(End-User Advocate)*

**File:** `frontend/src/app/features/account/orders/order-detail.component.ts:417`, `backend/src/modules/orders/orders.service.ts:760-764`

`canCancel()` includes `PARTIALLY_REFUNDED` in its allowed list, showing an active "Anuluj zamówienie" button with a confirmation dialog promising a refund. `cancelByUser()` explicitly throws a `ConflictException` for that exact status ("use the returns flow for remaining items"). The customer fills in a reason, confirms, and gets an opaque 409 error instead — a guaranteed dead end for any order that's had even one partial cancellation or return processed.

**Fix:** Remove `'PARTIALLY_REFUNDED'` from `canCancel()`'s allowed list (it's already correctly present in the separate `canPartialCancel()`), or route it to a "use returns" message instead.

---

## 🟡 MEDIUM — Invoice-download button offered for `FRAUD_REVIEW`/`DISPUTE_HOLD`/`DISPUTE_LOST_REVIEW` orders the backend refuses to invoice *(End-User Advocate)*

**File:** `frontend/src/app/features/account/orders/order-detail.component.ts:424-426`, `backend/src/modules/orders/orders.service.ts:620-630`

`canDownloadInvoice()` only excludes `PENDING_PAYMENT` and `CANCELLED`, so the "Pobierz fakturę" button renders for `FRAUD_REVIEW` and `DISPUTE_HOLD` too. The backend's `generateInvoice()` maintains its own `nonInvoiceable` list containing exactly those statuses. A customer whose order is mid fraud-review or dispute clicks the visible button and gets an unexplained error toast — right when they're already anxious about the flag on their order.

**Fix:** Mirror the backend's `nonInvoiceable` array exactly in `canDownloadInvoice()`.

---
## 🟡 MEDIUM — Dependabot has no `github-actions` ecosystem entry and skips the root workspace + `shared-types` *(Pragmatist)*

**File:** `.github/dependabot.yml:1-45`

Only `/backend` and `/frontend` npm ecosystems are declared. There's no entry for `/` (root `package.json` — exactly where the CVE-remediation `pnpm.overrides` block above lives, and must now be hand-maintained forever) or `/packages/shared-types`, and no `github-actions` ecosystem entry to bump pinned Action versions (`actions/checkout@v4`, etc.) as new majors ship.

**Fix:** Add `directory: /` and `directory: /packages/shared-types` npm entries, plus a `package-ecosystem: github-actions, directory: /` entry.

---

## 🟡 MEDIUM — Review helpful-votes/count not reset across a reject → resubmit → re-approve cycle *(First-Principles)*

**File:** `backend/src/modules/reviews/reviews.service.ts:201-226` (`markHelpful`), `:228-245` (`resubmit`), `:247-264` (`adminUpdateStatus`)

`adminUpdateStatus` has no transition guard, so an approved review (already carrying accumulated `ReviewHelpfulVote` rows and a nonzero `helpfulCount`) can be moved to `REJECTED` at any time. `resubmit()` resets `status` to `PENDING` and overwrites the review body/rating, but never clears `helpfulCount` or deletes the stale vote rows. If re-approved, the resubmitted review reappears with a helpful-count inherited from entirely different content — and a user who voted on the old content can never vote again on the new content (the `@@id([reviewId, userId])` row already exists).

**Fix:** In `resubmit()`, reset `helpfulCount` to 0 and delete the review's `ReviewHelpfulVote` rows in the same transaction.

---

## 🟡 MEDIUM — Wishlist `addItem` skips the `isActive` check that `mergeGuestItems` enforces *(First-Principles)*

**File:** `backend/src/modules/wishlist/wishlist.service.ts:41-50` vs `:63-77`

`mergeGuestItems` filters `where: { id: { in: productIds }, isActive: true }` before inserting — "product must be active" is the implicit invariant for wishlist-eligibility. The single-product `addItem` path only checks product existence, no `isActive` check. A direct API call or stale client-side id can wishlist a deactivated product, which then sits permanently in `getItems()` (which also doesn't filter on `product.isActive`) showing an empty variants array forever.

**Fix:** Add `isActive: true` to the `addItem` product lookup, or to `getItems`'s product include, so all paths agree on wishlist-eligibility.

---

## 🟢 LOW — Discount-proration `floor` rounding drifts the refund a few grosz from true entitlement across 3+ sequential partial cancellations *(Domain Expert)*

**File:** `backend/src/modules/orders/orders.service.ts:984-997`

`alreadyCancelledDiscount` recomputes the *ideal* (`Math.round`) discount for previously-cancelled units, but the discount actually applied in each prior call used `Math.floor`, which is generally smaller. Verified by simulation (100gr price, 1/3 discount, qty 9, cancelled across 4 calls): the items-portion refund comes out a few grosz higher than entitled, purely from per-call floor rounding compounding. The order-level cap in `partialRefund` prevents this from ever exceeding the order total, so it's a small merchant-margin leak, not a customer-facing overcharge.

**Fix:** Track `alreadyCancelledDiscount` from the actual floor-applied amount of each prior call rather than recomputing the ideal value fresh each time.

---

## 🟢 LOW — `generate-sitemap.mjs` silently degrades to 4 static routes if the backend is slow/down during a Vercel build *(Pragmatist)*

**File:** `frontend/scripts/generate-sitemap.mjs:44-56, 174-181`

`fetchJson` catches any fetch error/timeout/non-2xx and returns `null` with only a `console.warn`. The script always exits 0 and writes `prerender-routes.txt` with just the 4 static routes whenever Railway is cold-starting or blipping at the exact moment Vercel's `prebuild` hook runs — silently shipping a build that prerenders almost nothing, with no build failure and no alert.

**Fix:** Add 1-2 retries with backoff in `fetchJson`, and fail the build if the prerendered route count drops below a sane minimum.

---

## 🟢 LOW — Category product filter only descends one level, silently dropping grandchild-category products *(First-Principles)*

**File:** `backend/src/modules/products/products.service.ts:130-139` vs `backend/src/modules/categories/categories.service.ts:9-15`

`CategoriesService.findAll()` renders a 3-level tree and the schema's self-referential `parentId` supports arbitrary depth. But the product category filter only builds `[cat.slug, ...cat.children.map(c => c.slug)]` — one level of children, never grandchildren. Browsing a top-level category silently excludes all products assigned to a grandchild category, with no error.

**Fix:** Recursively collect all descendant slugs instead of one level of `children`.

---

## Misc note

`audit-prod.txt` / `audit-full.json` (untracked, repo root) contain only public `pnpm audit` CVE data — no secrets or internal paths — so there's no exposure risk, just clutter with no `.gitignore` rule. Worth a `.gitignore` entry (`audit-*.txt`, `audit-*.json`) given the project already had one stray-tooling-output incident (`backend/coverage/`, see exclusion list).

---

## Notes — verified clean, not findings

The **Risk Analyst** pass specifically targeted admin module security beyond the already-excluded session-fixation findings and came back clean: `/admin/picklist` and `/admin/fulfillment-gap` both carry their own explicit `req.session?.passport?.user` check independent of the session-regeneration guard (confirmed `regenerateSessionOnLogin` itself doesn't reject unauthenticated sessions — the inline checks are load-bearing and present); neither route leaks PII beyond what a fulfillment picker needs; all AdminJS custom resource actions run under the single shared admin session guard with no missing-ownership gap; no CSV/export endpoints exist; Supabase storage key construction never incorporates user-controlled path segments.

The **Skeptic** pass confirmed all 4 recent fix commits (`65446d8`, `782e711`, `c8d02ad`, `c4979e8`) are complete, correctly scoped, and have no sibling call sites the developer missed (apart from the one `sweepOrphanedPendingOrders` finding above).

The **Systems Thinker** pass built an exhaustive inventory of all recurring backend work (10 `@Cron` + 1 `@Interval` + 1 BullMQ worker) — 9 of 10 crons are correctly lock-guarded, the BullMQ email worker has implicit concurrency 1 (no parallel-job race), and no dynamically-registered jobs exist outside this inventory.

The **First-Principles** pass also checked the partnership feature (clean — static marketing page, correct `takeUntilDestroyed` usage) and the wishlist optimistic-update/logout-race pattern (clean — consistent fallback behavior, not a bug).

The **End-User Advocate** pass also checked guest order-tracking and the guest-cancel-by-token flow — both correctly scoped server-side with no frontend over/under-restriction, and `ShipmentStatus`/`PaymentStatus` have no dedicated frontend switch (so no drift surface exists for them).

The **Domain Expert** pass confirmed `markSessionPaid`'s amount-mismatch check and the Stripe minimum-charge table (both round-12 fixes) are correctly implemented, and that every Stripe call site carries an idempotency key except the one collision found above.
