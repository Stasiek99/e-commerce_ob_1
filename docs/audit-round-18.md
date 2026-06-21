# E-Commerce Audit — Round 18
*Generated: 2026-06-20 — 4-agent stochastic consensus*
*Agents: Domain Expert (Money & Checkout) · Risk Analyst (Money & Checkout, concurrency/failure-mode focus) · Domain Expert (Catalog & Engagement) · Skeptic (Catalog & Engagement, sibling-miss hunting)*

> **Excludes** everything already in `docs/audit-exclusion-list.md` (~360 prior findings across rounds 1-16) and `docs/audit-round-17.md` (pending, not yet folded in).
> **Excludes** settled tradeoffs in `docs/accepted-tradeoffs.md`.
> **Scope:** Money & Checkout (cart, orders, payments, coupons, invoices, returns, money-relevant shipping, plus the corresponding frontend cart/checkout/returns components) and Catalog & Engagement (products, categories, reviews, wishlist, plus the corresponding frontend catalog/wishlist/home components). Notifications/SSR/infra mechanics, carrier-client plumbing, and accessibility/SEO were out of scope — round 17 and earlier rounds already cover those.

Both Catalog & Engagement agents — working independently, from opposite entry points (one tracing `ProductsService.removeImage()` outward to its consumers, the other tracing four separate "get product thumbnail" call sites backward to their shared root cause) — converged on the same bug: deleting a product's primary image never re-promotes a replacement, silently emptying the `images` array on every read path that filters `isPrimary: true` instead of using the catalog's own safe fallback ordering. That convergence is folded into one finding below. Separately, the Money & Checkout pair split cleanly along their assigned lenses: the Domain Expert found a real money-math gap (coupon discount never prorated into return refunds) that the Risk Analyst's concurrency-only lens wasn't looking for, while the Risk Analyst found two unlocked admin state-transition races that the Domain Expert's steady-state-logic lens passed over.

---

## 🟠 HIGH — `ReturnsService.markRefunded()` refunds the full undiscounted price on coupon-discounted orders, overpaying the customer

**Classification:** Bug
**Files:** `backend/src/modules/returns/returns.service.ts:323-350` (`markRefunded`), contrast with `backend/src/modules/orders/orders.service.ts:1032-1067` (`cancelItemsByUser`'s discount-proration block), `backend/src/modules/payments/payments.service.ts:1221-1268,1282` (`partialRefund`'s use of `discountAppliedInCents`)

`OrdersService.cancelItemsByUser` (the customer self-service "cancel some items" flow) explicitly prorates each cancelled item's refund price by the order's coupon-discount fraction before calling `PaymentsService.partialRefund` — it computes `discountFraction = order.discountInCents / order.itemsTotalInCents`, derives a capped per-unit discount, and passes the reduced price through as `discountAppliedInCents`.

`ReturnsService.markRefunded()` (the admin-approved physical-return refund flow) calls the same `partialRefund`, but builds its `refundItems` directly from `orderItem.snapshotPrice` — the full, undiscounted per-unit price — with no reference to `order.discountInCents` or `itemsTotalInCents` anywhere in the method. `discountAppliedInCents` is never set, so `cancelledDiscountInCents` increments by 0. `partialRefund`'s only safety net is a cap against the order's *total remaining balance*, not the *correct proportional amount for the returned items* — so any return that doesn't exhaust the whole order's remaining balance sails through with room to spare, refunding the customer more than they paid for those units.

**Trigger:** Customer places a multi-item order using a coupon (discount > 0). They submit a return for one item; admin approves via `markRefunded`. The Stripe refund issued is `quantity × snapshotPrice` — the pre-discount price — instead of the discount-prorated amount `cancelItemsByUser` would produce for the identical item/quantity. Real money lost on every coupon-discounted partial return processed through this path.

**Fix:** Factor `cancelItemsByUser`'s discount-proration block into a shared helper and call it from `markRefunded` too, so `discountAppliedInCents` (and therefore `cancelledDiscountInCents`) stays consistent regardless of which flow issues the refund.

---

## 🟠 HIGH — Admin order-status transition (`updateStatus`) has no lock and no conditional write — two concurrent calls on the same order double-restore stock

**Classification:** Bug
**Files:** `backend/src/modules/orders/orders.service.ts:1182-1249` (`updateStatus`)

`updateStatus` reads `current.status` via a plain `findUniqueOrThrow` outside any lock, computes `shouldRestoreStock` from that stale read, then runs an **unconditional** `tx.order.update({ where: { id }, data: { status } })` inside its transaction — not a guarded `updateMany({ where: { id, status: current.status } })` with a row-count check. This is the exact mechanism the exclusion list documents as fixed for `cancelItemsByUser`/`refundPayment`/`partialRefund` ("the `cancel-lock` ... fixed by moving the lock into `PaymentsService.refundPayment`/`partialRefund` themselves, covering every caller by construction") — but `updateStatus` runs its own direct stock-restore transaction and never calls either of those, so it sits entirely outside that fix's coverage.

This is the admin endpoint used for exactly the flow `docs/accepted-tradeoffs.md` describes as deliberately requiring "explicit admin confirmation" — moving a `DISPUTE_LOST_REVIEW` order to `CANCELLED` after confirming non-delivery — as well as every other general-purpose admin status transition.

**Trigger:** Two admins (or one admin double-clicking, or a stale tab retry) call `PATCH /orders/admin/:id/status` with the same target status on the same `DISPUTE_LOST_REVIEW` order within milliseconds of each other. Both read the same prior status, both compute `shouldRestoreStock = true`, both increment `productVariant.stock` for every item — phantom inventory, the exact oversell risk the dispute-lost manual-confirmation gate exists to prevent, reintroduced via a race instead of a logic bug.

**Fix:** Wrap `updateStatus` in a per-order Redis lock (mirroring `cancel-lock:`/`refund-lock:`), and/or change the status write to a conditional `updateMany` keyed on the expected prior status, aborting the stock restore if the affected-row count is 0.

---

## 🟠 HIGH — Deleting a product's primary image leaves cart, wishlist, order-history, review-history, and review-request emails permanently imageless for that product

**Classification:** Bug
**Files:** `backend/src/modules/products/products.service.ts:760-783` (`addImage`/`removeImage` — no re-promotion logic on delete), contrast with `:43,822` (`PRODUCT_SELECT`/`suggest`'s safe `orderBy: [{isPrimary:'desc'},{sortOrder:'asc'}]`, which degrades gracefully); brittle filtered consumers: `backend/src/modules/reviews/reviews.service.ts:179,196` (`getMine`), `backend/src/modules/wishlist/wishlist.service.ts:19-22` (`getItems`, filtered *before* `attachOmnibusData` enrichment), `backend/src/modules/cart/cart.service.ts:17-21` (`CART_INCLUDE`), `backend/src/modules/orders/orders.service.ts:1430` (`dispatchReviewRequestEmail`)

`addImage()` only ever sets `isPrimary: true` for the very first image uploaded (`isPrimary: count === 0`) — there is no endpoint to re-designate a different image as primary later. `removeImage()` deletes whichever image ID is passed unconditionally, with no check for whether it was the primary image and no promotion of a replacement. If an admin deletes the current primary image (the plausible real workflow — swapping in a better hero shot), the product ends up with zero `isPrimary: true` rows while other images still exist.

The product detail page is unaffected, because `PRODUCT_SELECT`'s `images` projection has no `isPrimary` filter — it returns all images ordered by `isPrimary desc, sortOrder asc`, so the PDP gracefully falls back to the next image. But four other read paths across three modules each hard-filter `where: { isPrimary: true }, take: 1` with no fallback: cart-page line items (`CART_INCLUDE`, the highest-traffic of the four), wishlist cards, "My Reviews" thumbnails, and the review-request email's product image. Each silently returns an empty `images` array once the primary is gone — the product looks broken specifically in commerce-critical, conversion-adjacent UI while displaying fine everywhere else, making the root cause non-obvious.

**Trigger:** Admin uploads image A (auto-flagged primary) then image B for a product. Admin later deletes image A via `DELETE /products/:id/images/:imageId`. From that point on: cart line items, wishlist cards, order-history/review thumbnails, and review-request emails for that product all render with no image, while the PDP and category/search listings (on the unfiltered `PRODUCT_SELECT`) still show image B correctly.

**Fix:** In `removeImage()`, after deleting, check if the deleted row was `isPrimary: true`; if so, promote the next image by `sortOrder` to `isPrimary: true` in the same transaction (guards against a race with a concurrent `addImage`). As defense-in-depth, change the four filtered consumers to the same safe `orderBy`-based pattern `PRODUCT_SELECT` already uses, so a future all-non-primary product doesn't lose its thumbnail everywhere at once.

---

## 🟠 HIGH — `ProductCardComponent` always adds the cheapest variant to cart, but only disables the button when *every* variant is out of stock — multi-variant products with a sold-out cheapest size show a clickable "Add to cart" that always fails

**Classification:** Bug
**Files:** `frontend/src/app/shared/product-card/product-card.component.ts:59-67,76-103` (`firstVariant`, `outOfStock`, `onAddToCart`), `frontend/src/app/shared/product-card/product-card.component.html:71-82` (disabled binding), contrast with `frontend/src/app/features/wishlist/wishlist.component.ts:142-147` (`addAllToCart`, correctly does `variants.find(v => v.stock > 0)`) and `product-detail.component.ts` (gates on the specific `selectedVariant()`'s stock), `backend/src/modules/products/products.service.ts:42` (`PRODUCT_SELECT.variants` always `orderBy: { priceInCents: 'asc' }`, so `variants[0]` is deterministically the cheapest, not necessarily in-stock)

`ProductCardComponent` is the single shared rendering surface for the catalog grid, related-products rail, and wishlist grid. Its `outOfStock` getter is `variants.every(v => v.stock === 0)` — true only when **all** variants are sold out — and the disabled binding uses exactly that aggregate. But `onAddToCart()` always operates on `firstVariant = variants?.[0]`, with zero stock check of its own. Since the backend always orders variants cheapest-first, `variants[0]` is the cheapest variant, not necessarily the in-stock one.

A product with a sold-out cheap variant and an in-stock pricier variant renders `outOfStock = false` (button enabled, reads "Do koszyka"), but clicking it always targets the sold-out cheap variant, which the backend correctly rejects with `BadRequestException('Insufficient stock')` — a generic failure toast for a product that visibly has stock, with no path to buy the in-stock variant from the card. This is a clean sibling-miss: `wishlist.component.ts`'s own `addAllToCart()`, one file over and calling the same `CartService`, already gets this right.

**Trigger:** View `/products`, any `/category/:slug` listing, a PDP's related-products rail, or the wishlist grid for a product with 2+ variants where the cheapest has `stock: 0` and a pricier one has `stock > 0`. The card shows an enabled, normal-looking button; clicking it always fails.

**Fix:** Change variant selection to the first variant with `stock > 0`, falling back to `variants[0]` only for price-display purposes when none have stock — mirroring `wishlist.component.ts`'s existing pattern.

---

## 🟡 MEDIUM — Order-detail's partial-cancel refund preview shows the undiscounted amount, overstating what the backend will actually refund

**Classification:** Bug
**Files:** `frontend/src/app/features/account/orders/order-detail.component.ts:451-471` (`startPartialCancel`/`refundPreview`), contrast with `backend/src/modules/orders/orders.service.ts:1032-1067` (the server-side proration applied to the same request)

`startPartialCancel()` populates `partialLines` with the raw `snapshotPrice`, and `refundPreview()` sums `quantity × priceInCents` with no discount awareness — there's no client-side replication of the coupon-proration math `cancelItemsByUser` actually applies server-side. For any coupon-discounted order, the customer commits to a cancellation based on a "Do zwrotu" figure the backend was never going to honor; the actual refund (and post-reload `refundedAmountInCents`) comes back lower.

**Trigger:** Authenticated customer with a coupon-discounted order opens order detail, selects an item to cancel — the preview shows full price × quantity; the actual refund issued is prorated lower.

**Fix:** Expose the order's `discountInCents`/`itemsTotalInCents` (already in the order-detail response) and replicate the same proration formula client-side, or add a lightweight non-committing preview endpoint that runs the real math.

---

## 🟡 MEDIUM — GA4 `purchase` event value omits the coupon discount, overstating reported revenue on every discounted order

**Classification:** Bug
**Files:** `frontend/src/app/features/checkout/checkout-success/checkout-success.component.ts:301-308` (`firePurchaseEvent`), `backend/src/modules/payments/payments.service.ts:893-916` (`formatStatusResponse` — never selects/returns `discountInCents`/`couponCode`)

`firePurchaseEvent` computes `value` as `itemsGross + shipping` — structurally incapable of reflecting a discount, since `GET /payments/:id/status` never queries or returns `order.discountInCents`/`couponCode`. Every order placed with an active coupon reports a GA4 purchase value equal to the pre-discount gross, not what the customer actually paid, silently inflating reported revenue/ROAS for every discounted order in a way invisible from the dashboard alone (the number just looks plausible, systematically too high on coupon orders specifically).

**Trigger:** Complete checkout with any `discountInCents > 0` coupon. The fired `value` equals `itemsGross + shipping`, not the order's actual `totalInCents`.

**Fix:** Add `discountInCents` to `formatStatusResponse`'s selected fields and subtract it in `firePurchaseEvent`, or better, return and use the order's authoritative `totalInCents` directly instead of recomputing it from parts.

---

## 🟡 MEDIUM — `approveFraudReview` has the same unlocked read-then-write pattern as `updateStatus` — two concurrent approvals double-fire payment-confirmation emails and create two outbox rows for one order

**Classification:** Bug
**Files:** `backend/src/modules/payments/payments.service.ts:478-530` (`approveFraudReview`)

Same mechanism as the `updateStatus` finding above, on the `FRAUD_REVIEW → PAID` admin-approval path: the status check reads from an unguarded `findUniqueOrThrow`, then the transaction writes `status: PAID` unconditionally with no row-count check. `processInvoice`'s own lock correctly prevents a duplicate invoice number/PDF, but nothing stops two separate `outboxMessage` rows or two separate `dispatchPostPaymentNotifications` calls (admin notification, payment-confirmed email) for the same order.

**Trigger:** Two concurrent calls to the fraud-review approval endpoint for the same order (double-click, or two admins approving from the queue simultaneously) — customer and admin each get duplicated emails.

**Fix:** Same remedy as `updateStatus` — guard with a per-order lock (the existing `refund-lock:${orderId}` key would work, since this and `refundPayment`/`partialRefund` never legitimately run concurrently for the same order) or a conditional `updateMany`.

---

## 🟡 MEDIUM — Corrective-invoice VAT-breakdown computation runs its cross-correction read outside the order's cancel-lock, reopening the exact "stale prior-correction base" bug the exclusion list already fixed once

**Classification:** Bug
**Files:** `backend/src/modules/invoice/invoice.service.ts:208-310` (`processCorrectiveInvoice`, the unlocked `priorDeltaGrossByRate` read at lines 296-299), `backend/src/modules/orders/orders.service.ts:1096-1111` (`cancelItemsByUser`'s fire-and-forget call), `:1123-1131` (`cancel-lock` released in `finally` before the invoice call settles)

`processCorrectiveInvoice` correctly holds `SELECT...FOR UPDATE` only for the idempotency/sequence-number reservation, deliberately not for the slow PDF-generation/Supabase-upload I/O that follows — that part is intentional. The problem is `cancelItemsByUser`, the only caller, invokes it fire-and-forget (`.catch()`, never awaited) and releases `cancel-lock:${orderId}` in its `finally` block *before* that promise settles. A second, fully sequential partial-cancellation on the same order can acquire a fresh lock and kick off its own `processCorrectiveInvoice` call while the first call's cross-correction read/write is still in flight. If correction B's "sum all prior corrections" read executes before correction A's write commits, B computes its taxable base from an incomplete prior-corrections set — reintroducing, via a timing window instead of the original recompute logic, the same internal-inconsistency-between-sequential-invoices failure mode the exclusion list documents as already fixed once.

**Trigger:** Two partial-cancellation requests on the same order close enough together that the second's invoice-service call starts before the first's PDF generation + Supabase upload finishes committing. Two corrective invoices are generated whose declared "before"/"after" taxable bases don't chain correctly — a discoverable accounting inconsistency under a KAS audit.

**Fix:** Either await `processCorrectiveInvoice` inside `cancelItemsByUser` before releasing `cancel-lock`, or have `processCorrectiveInvoice` acquire its own short-lived per-order lock spanning the prior-corrections read through the final write.

---

## 🟡 MEDIUM — No validation that `compareAtPriceInCents` exceeds `priceInCents` — a misconfigured "sale" can advertise a discount that isn't one

**Classification:** Bug
**Files:** `backend/src/modules/products/dto/product.dto.ts:292-300,340-348` (`CreateVariantDto`/`UpdateVariantDto`, only `@IsInt() @Min(0)`), `backend/src/modules/products/products.service.ts:930-974` (`attachOmnibusData`, only checks `!= null`), `frontend/src/app/shared/product-card/product-card.component.html:21-23,51-58`, `frontend/src/app/features/catalog/product-detail/product-detail.component.ts:196-199,225-229`

Neither DTO nor `attachOmnibusData()` cross-checks that `compareAtPriceInCents` is actually greater than `priceInCents`. AdminJS exposes `ProductVariant` as a raw, unguarded resource, so a data-entry mistake (swapped values, or a stale `compareAtPriceInCents` left after a later price increase) reaches the database unresisted. Both the product card and PDP render the "PROMOCJA" badge plus a struck-through "was" price purely off `compareAtPriceInCents` being truthy — if it's ≤ the current price, the storefront advertises a discount that doesn't exist (or a price increase dressed as a sale), which is also a live Omnibus-directive/UOKiK compliance risk, not just cosmetic.

**Trigger:** Set a variant's `priceInCents` to 15000 and `compareAtPriceInCents` to 12000 via AdminJS. The storefront immediately shows "PROMOCJA" with a "was 120 zł" strikethrough next to the actual 150 zł price.

**Fix:** Add a cross-field validator on both DTOs rejecting `compareAtPriceInCents <= priceInCents`, or have `attachOmnibusData()` null out `compareAtPriceInCents`/`lowestPrice30dInCents` whenever the invariant doesn't hold, mirroring its existing "suppress until verified" pattern.

---

## 🟡 MEDIUM — Guest wishlists over 100 items are silently and completely discarded on login, not just truncated

**Classification:** Bug
**Files:** `frontend/src/app/core/services/wishlist.service.ts:88-113` (`syncFromBackend`), `backend/src/modules/wishlist/dto/merge-wishlist.dto.ts:1-8` (`@ArrayMaxSize(100)`), `backend/src/modules/wishlist/wishlist.controller.ts:30-34` (`mergeGuest`)

`MergeWishlistDto.productIds` is capped at 100; exceeding it makes `POST /wishlist/merge` 400 wholesale, with no server-side batching. The guest-side `toggle()` has no client-side cap of its own, so a long-lived session can exceed 100 items. `syncFromBackend()` routes any merge failure (including this 400) through the same `catchError` as success, and unconditionally clears `localStorage` afterward regardless of whether the merge actually succeeded — the comment even calls this deliberate ("prevents infinite re-merge"). Net effect: a guest with >100 wishlisted items loses the *entire* wishlist on login, not just the items past #100, with no error shown.

**Trigger:** As a guest, wishlist more than 100 distinct products, then log in or register. The merge 400s, the catch falls back to fetching the (empty, for a new account) authenticated wishlist, and localStorage is cleared.

**Fix:** Raise the cap to match a realistic UI limit (enforced client-side too with a visible "wishlist full" state), or chunk the guest IDs into ≤100-item batches and merge sequentially — and don't clear localStorage in the `catchError` branch when the merge call itself is what failed.

---

## 🟡 MEDIUM — `suggest()`'s autocomplete cache has no version key, so admin product edits never invalidate it — stale results for up to 10 minutes, including deleted/deactivated products

**Classification:** Bug
**Files:** `backend/src/modules/products/products.service.ts:785-845` (`suggest`), contrast with `:847-853,378-410,891-919` (`searchCacheKey`/`getFacets`/`findRelated`, all embed `v${version}`), `:976-989` (`invalidateProductCaches`/`getCacheVersion`)

`invalidateProductCaches()`'s own comment states the invariant: "all cache keys embed the current version, so a stale version means a guaranteed cache miss." `suggest()` is the one cached read path that doesn't follow it — its key is the bare `suggest:${term.toLowerCase()}` with a fixed 600s TTL and no reference to `product_cache_v`. Renaming, repricing, deactivating, or deleting a product correctly busts `findAll`/`getFacets` on the next request, but the autocomplete dropdown keeps serving the pre-edit cached result — including a now-inactive or deleted product, which 404s on click — for whatever remains of the TTL.

**Trigger:** Trigger a suggest query, then immediately rename or delete that product via the admin panel. Re-run the same suggest query within 10 minutes — the dropdown still shows the stale/removed entry.

**Fix:** Embed `product_cache_v` in the suggest key (`` `suggest:v${version}:${term}` ``) using the existing `getCacheVersion()` helper, matching every sibling cached read.

---

## 🟡 MEDIUM — Curated Millesime/Luxury interleaving for the "perfume" category is permanently dead code due to a singular/plural slug mismatch

**Classification:** Bug
**Files:** `backend/src/modules/products/products.service.ts:269-313`

The curated-interleaving block (alternating 5 Millesime / 5 Luxury results) is gated on `query.category === 'perfumes'` (plural). Every real category slug is singular — the seed data creates `slug: 'perfume'`, the sibling curated block for the all-products view checks `'perfume-luxury'` (also singular), and the frontend's category maps are all keyed on `'perfume'`. No code path anywhere produces the plural form. A repo-wide grep shows the only other place the string `'perfumes'` exists is two test fixtures, which use it as a slug convenience — accidentally matching the typo and masking it from ever failing a test; no test exercises the interleaving logic itself.

**Trigger:** `GET /products?category=perfume` (the only real route) — the condition is always false, execution falls through to plain `sortOrder` ordering, and the merchandising intent (preventing one product line from dominating the first several pages) never applies to the one category it was built for.

**Fix:** Change the literal to `'perfume'`. Add a regression test using the real slug that asserts the interleaved chunk pattern, so a fixture typo can't mask this again.

---

## 🟢 LOW — `CategoriesService.findBySlug()` still hardcodes one level of `children` — the exact bug class `findAll()` was already fixed for, in the same file

**Classification:** Bug
**Files:** `backend/src/modules/categories/categories.service.ts:36-43` (`findBySlug` — `include: { children: true, parent: true }`, one level only) vs. `:13-34` (`findAll`, already fixed per the exclusion list to a flat query + unbounded-depth tree build)

The category tree supports arbitrary depth — that's why `findAll()` was rewritten away from a nested `include`. `findBySlug()`, backing the public `GET /categories/:slug` endpoint, was never touched by that fix and still silently drops grandchildren for any category nested 2+ levels deep. No current Angular consumer calls this endpoint directly (`/category/:slug` resolves through `GET /products?category=slug`, not through this method), so it's a landmine rather than a live-traffic bug today — the same character as round 17's `findOneAdmin`-bypasses-`mapOrder()` finding.

**Trigger:** Call `GET /categories/:slug` directly for a category with grandchildren — `children` stops at depth 1.

**Fix:** Reuse `findAll()`'s flat-query-plus-tree-build helper scoped to the requested subtree, or recurse until no children remain. Low priority unless a frontend feature starts consuming `children` from this endpoint directly.

---

## Notes — verified clean

**Money & Checkout** — cart's best-effort stock guard, `CouponService`'s atomic `applyInsideTransaction`, frontend idempotency-key/double-submit patterns, `markSessionPaid`'s amount-mismatch defense-in-depth, `partialRefund`'s idempotency-key disambiguation, and the `cancel-lock`/`refund-lock` coverage of `partialRefund`/`refundPayment` themselves (confirmed `markRefunded`'s *caller path* into those two functions is correctly locked — only `markRefunded`'s own discount math, audited above, is wrong) were all re-verified correct. Stripe Checkout Session discount-vs-line-items consistency, `ShippingRatesService`'s cache/CAS handling, and the FREE_SHIPPING/FIXED_AMOUNT coupon UI disclosures were also confirmed already fixed per the exclusion list, not regressed.

**Catalog & Engagement** — `ReviewsService` (verification gate, resubmit, helpful-vote transaction, suspicious-activity detection), `CategoriesService.create/update/remove` (symmetric DTOs, cycle detection correctly scoped to `update`), the SSE stock-stream's product-detail consumer (correctly syncs both `product.variants` and `selectedVariant` on live updates), and `packages/shared-types`'s product DTOs (known-unused per round 17, not re-flagged) were all re-verified correct. `findBySlug`'s status-filter difference from `findAll`/`findRelated` initially looked like a sibling-miss but is confirmed intentional — the frontend has dedicated UI for rendering `DISCONTINUED` products with a banner, so that endpoint deliberately omits the status filter the others apply.

---

This round's findings, once resolved, should be folded into `docs/audit-exclusion-list.md` per its own maintenance instructions.
