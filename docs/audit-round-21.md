# E-Commerce Audit — Round 21
*Generated: 2026-06-23 — 4-agent stochastic consensus*
*Agents: Domain Expert (Backend Module-to-Module Seams) · Skeptic (Backend↔Frontend Contract Drift) · Risk Analyst (External-Service Integration Boundaries — Stripe/Supabase/Resend/Carriers) · Systems Thinker (DB/Infra/Cross-Replica/Deploy Seams)*

> **Excludes** everything already in `docs/audit-exclusion-list.md` (~408 prior findings across rounds 1-20) and settled tradeoffs in `docs/accepted-tradeoffs.md`.
> **Scope:** integration seams between subsystems specifically — not single-module bugs. Each agent was scoped to a distinct seam category: (1) backend module-to-module data handoffs and transaction boundaries, (2) backend response shape ↔ `shared-types` ↔ frontend consumption contract drift, (3) the boundary between our system and Stripe/Supabase/Resend/carriers (partial-failure and retry-interaction bugs), (4) cross-replica/cross-process state and CI/CD↔Railway↔Vercel deploy-topology seams.
> **Verification note:** the highest-severity findings below (AdminJS Order edit bypass, the dead `Shipment.deliveredAt` writer, the missing corrective-invoice call in `markRefunded`, the cron-vs-webhook coupon-cleanup split, the cart/checkout lock gap, the SSE per-replica cap, and the reset-password validator gap) were independently re-checked against the current source by reading the actual files and line ranges cited — not just trusting agent transcripts.

Three of the four agents converged on the same underlying pattern from different angles: **a fix lands on one path through a piece of state, but a sibling path that reaches the identical end state never gets it.** The reconciliation cron and the webhook handler both fail a Stripe session, but only one cleans up the Stripe coupon object. Self-service partial cancellation and admin-approved returns both issue a partial refund through the identical `partialRefund()` call, but only one generates the legally-required corrective invoice. The order-detail and order-list pages both got round 17's status-label fix, but the guest order-tracking page — a third, independent copy of the same map — never did. This "sibling miss" shape, first named in round 20's email-template finding, turns out to be the dominant bug class at integration seams generally, not just in the notifications subsystem.

Separately, the Systems Thinker agent found a structural regression: a prior fix for an SSE crash-lockout bug correctly removed a stale Redis counter, but in doing so silently turned a documented *global* 500-connection cap into a *per-replica* cap with no other change to the surrounding comments or constant name — the cap now scales with replica count instead of bounding it.

---

## 🟠 HIGH — AdminJS's `Order` resource has no edit restriction at all — the plain Edit form bypasses every status-transition guard, lock, refund, and stock-restore rule in `OrdersService`

**Classification:** Bug
**Files:** `backend/src/modules/admin/admin.setup.ts:459-467` (Order resource — `properties` only restricts `invoiceUrl`'s visibility; `actions` only disables `new`/`delete` and adds custom record actions `downloadInvoice`/`generateLabel`/`bulkMarkAsShipped`/`bulkCancel`/`refundFull` — no `edit` entry anywhere in the resource) — contrast with `User` (`:737`, `edit: { isAccessible: false }`) and other resources in the same file that lock down `edit` (`:326`, `:1000`) or whitelist `editProperties` (`ReturnRequest`, `Review`, per the exclusion list).

Every status-machine-backed resource in this file is either edit-disabled or `editProperties`-whitelisted — except `Order`, the single highest-stakes resource in the entire admin panel. AdminJS's default Edit form therefore exposes every column, including `status`, `totalInCents`, `discountInCents`, and the nested `items[].cancelledQuantity`, as directly PATCH-able through AdminJS's generic Prisma `update()` internals. None of `OrdersService.updateStatus()`'s machinery runs: no `status-lock:${id}` Redis lock, no `ORDER_STATUS_TRANSITIONS` allowlist (which exists specifically to make `CANCELLED`/`REFUNDED` terminal and to gate `DISPUTE_LOST_REVIEW → CANCELLED` behind explicit confirmation), no stock-restore, no Stripe refund call, no `OrderEvent` audit row.

**Trigger:** An admin (or anyone with admin-panel access, including a compromised admin session) opens any order's plain Edit screen and changes `status` directly — e.g. `CANCELLED → PAID` (a transition the allowlist forbids since `CANCELLED` is terminal), or `PAID → REFUNDED` with no Stripe refund ever issued, or `DISPUTE_LOST_REVIEW → REFUNDED` bypassing the explicit manual-confirmation gate that exists precisely to stop a refund from going out against a payment already lost to chargeback. Every one of these silently desyncs inventory, the Stripe ledger, and the order timeline, with zero trace in `OrderEvent`.

**Fix:** Add `editProperties` (restricted to genuinely safe fields, or none) or `actions: { edit: { isAccessible: false } }` to the `Order` resource, matching `User`/`ReturnRequest`/`Review`, and route every legitimate status change through the existing dedicated actions (`refundFull`, `bulkCancel`, `bulkMarkAsShipped`) that already call into `OrdersService`/`PaymentsService` correctly.

---

## 🟠 HIGH — `Shipment.deliveredAt` has no writer anywhere in the codebase, so the "authoritative withdrawal-clock timestamp" fix from a prior round never actually engages

**Classification:** Bug
**Files:** `backend/src/modules/returns/returns.service.ts:102` (`order.shipment?.deliveredAt ?? null` — the supposedly authoritative source for the Art. 27 UoK 14-day withdrawal deadline), `:428-441` (`setReplacementDeliveredAt` — the *only* writer of any "delivered" timestamp in the codebase, and it writes to a different column, `ReturnRequest.replacementDeliveredAt`, for *replacement* deliveries only) — confirmed via a full-codebase search for `deliveredAt:` assignments: `backend/src/modules/shipping/shipping.service.ts` never sets `Shipment.status = 'DELIVERED'` or `Shipment.deliveredAt` anywhere (it only writes `LABEL_PENDING`/`LABEL_GENERATED`/`LABEL_ERROR`), `OrdersService.updateStatus`'s `DELIVERED` transition (`orders.service.ts`) only stamps `OrderEvent` and fires the review-request email — it never touches the `Shipment` row — and `shipping.controller.ts` has no inbound carrier webhook endpoints and no cron polls carrier tracking APIs.

This closes the loop on an already-cataloged finding ("Withdrawal 14-day deadline trusted from client `deliveryDate`, not authoritative `shipment.deliveredAt`") whose fix was a *consumer*-side trust decision in `returns.service.ts` — but the *producer* side of that same seam (shipping/orders → the `Shipment` row) was never built. The fallback (`?? null` → falls through to trusting `dto.deliveryDate`) is therefore not a rare edge case; it is the only path that has ever executed in production, since `order.shipment?.deliveredAt` is always `null`.

**Trigger:** Any customer requesting a WITHDRAWAL return. The backend has no real delivery timestamp to check the claim against, so it accepts whatever `dto.deliveryDate` the client supplies with no independent bound — letting a customer claim a delivery date that extends the legal 14-day window arbitrarily past the real delivery date, which is exactly the abuse vector the original fix was written to close.

**Fix:** Either add a carrier webhook/polling mechanism that sets `Shipment.status = DELIVERED` + `Shipment.deliveredAt` on real delivery confirmation, or at minimum expose an admin action (mirroring `setReplacementDeliveredAt`) to record the original delivery date manually so the existing trust logic in `returns.service.ts` has real data to ever actually use.

---

## 🟠 HIGH — Refunds issued through the return/complaint flow (`ReturnsService.markRefunded`) never generate the legally required corrective invoice — only the self-service partial-cancellation flow does

**Classification:** Bug
**Files:** `backend/src/modules/returns/returns.service.ts` (no import of `InvoiceService`, no call to `processCorrectiveInvoice` anywhere in the file — confirmed by grep) — contrast `backend/src/modules/orders/orders.service.ts:1080-1102` (`cancelItemsByUser`, which calls the identical `paymentsService.partialRefund(...)` and then immediately fires `this.invoiceService.processCorrectiveInvoice(...)`).

A repo-wide search for `processCorrectiveInvoice` finds exactly one production call site: `OrdersService.cancelItemsByUser`. `ReturnsService.markRefunded` mutates `OrderItem.cancelledQuantity` and issues a Stripe partial refund through the exact same `PaymentsService.partialRefund` call, transitioning the order to `PARTIALLY_REFUNDED`/`REFUNDED` — but no corrective invoice (`faktura korygująca`) is ever created for this path. Per Art. 106j of the Polish VAT act, any price reduction legally requires one, regardless of which internal flow triggered it.

**Trigger:** A customer files a return/complaint via `POST /returns` and an admin approves it via `markRefunded` — likely the single most common refund path for post-delivery issues, more common than self-service cancellation. Stripe correctly refunds the customer, but no corrective invoice is ever produced, leaving both the customer and the merchant's VAT records permanently missing a legally required document. Downstream, round 20's "Pobierz korektę" button on `order-detail.component.ts` (gated only on `cancelledQuantity > 0`, with no awareness of which flow produced that count) renders and 404s on click for every order refunded this way, since no `InvoiceCorrection` row was ever created.

**Fix:** In `ReturnsService.markRefunded`, after `partialRefund` succeeds, mirror `cancelItemsByUser`: fire-and-forget `invoiceService.processCorrectiveInvoice(...)` gated on `order.invoiceNumber` being set, with the same `.catch(logger.warn + Sentry.captureException)` pattern used elsewhere in the module.

---

## 🟠 HIGH — Register and reset-password forms accept passwords the backend will reject, and reset-password's generic error handler then falsely tells the user their (still-valid, untouched) token expired

**Classification:** Bug
**Files:** Backend: `backend/src/modules/auth/dto/register.dto.ts:14-20` and `backend/src/modules/auth/dto/reset-password.dto.ts:7-12` (both `@Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/)`). Frontend (broken): `frontend/src/app/features/auth/register/register.component.ts:89` (`Validators.required, Validators.minLength(8)` — no pattern, confirmed by direct read) and `frontend/src/app/features/auth/reset-password/reset-password.component.ts:84` (same gap, confirmed — no `Validators.pattern` anywhere in the file) plus `:102-106` (generic error handler). Frontend (correct sibling, proving the rule was deliberately mirrored once and never propagated further): `frontend/src/app/features/account/profile/profile.component.ts:29,376` (`PASSWORD_RE` + `Validators.pattern(PASSWORD_RE)`), matching `backend/src/modules/users/dto/change-password.dto.ts`.

A password like `"passwordpass"` (12 chars, all lowercase, no digit) passes both broken frontend forms' `minLength(8)` check and gets a 400 from the backend. On **register**, the user at least sees a generic toast with the backend's Polish message, but the field itself shows no inline error. On **reset-password**, the consequence is worse: the same generic catch sets `this.token = ''` on *any* error response — including this 400 — which flips the template to the "link jest nieprawidłowy lub wygasł" (link invalid/expired) branch. The single-use reset token was never touched server-side (DTO validation runs before token consumption), so the actual problem was password complexity, not the token — yet the user is told to request an entirely new reset email.

**Trigger:** A user resetting a forgotten password picks an all-lowercase or no-digit password ≥8 characters — a very common real-world password shape. The reset form vanishes entirely and the user must restart the whole forgot-password flow (request a new email, wait, click again) over a problem a client-side regex would have caught instantly.

**Fix:** Add `Validators.pattern(PASSWORD_RE)` (hoist the regex already defined in `profile.component.ts` to a shared validator) to both `register.component.ts`'s and `reset-password.component.ts`'s password controls, with an inline error message. Separately, scope `reset-password.component.ts`'s error handler to only clear `token`/show the expired-link branch for actual token errors (check the error message for a token-specific signal), not for every error including password-validation 400s.

---

## 🟡 MEDIUM — The reconciliation cron fails a stale Stripe session through a different code path than the webhook does, and only the webhook path cleans up the Stripe coupon object

**Classification:** Bug
**Files:** `backend/src/modules/payments/payments.service.ts:1007-1016` (cron path: `session.status === 'expired'` → calls `handlePaymentFailure()` directly), `:646-686` (webhook path: `markSessionFailed()` → `handlePaymentFailure()` **then** `extractSessionCouponId(session)` + `stripeClient.deleteCoupon()` at `:684-685`) — confirmed by direct read: the cron's `handlePaymentFailure` call at line 1010 has no surrounding call to `extractSessionCouponId`/`deleteCoupon` anywhere nearby, unlike the webhook path.

Our system creates a one-time, `max_redemptions: 1` Stripe coupon object for every discounted Checkout Session. Two independent paths can fail a stale session to the identical terminal DB state (`Payment.FAILED`, `Order.CANCELLED`) — the webhook (`checkout.session.expired`/`async_payment_failed`) and the reconciliation cron (the documented backstop for exactly the case where the webhook never arrives) — but only the webhook path's `markSessionFailed()` wrapper performs the Stripe-side coupon cleanup. The cron calls `handlePaymentFailure()` directly, bypassing it entirely.

**Trigger:** A customer abandons a discounted Checkout Session and the `checkout.session.expired` webhook delivery fails or is delayed past the reconciliation window (a Railway cold start, a transient network partition — precisely the scenario the cron exists to backstop). The cron reconciles the order correctly but leaks the Stripe coupon object indefinitely — a narrower regression of the already-fixed "orphaned Stripe coupon" finding, reachable only via the cron path specifically.

**Fix:** Route the cron's `session.status === 'expired'` branch through `markSessionFailed()` instead of calling `handlePaymentFailure()` directly, mirroring how `markSessionPaid()` is already shared between the webhook and the cron's `payment_status === 'paid'` branch immediately above it.

---

## 🟡 MEDIUM — The corrective invoice and refund-confirmation email show a refund amount that can exceed what Stripe actually refunded, because the cap applied inside `partialRefund` is never returned to its caller

**Classification:** Bug
**Files:** `backend/src/modules/orders/orders.service.ts:1080-1110` (`cancelItemsByUser` — calls `partialRefund` at `:1080`, then independently recomputes its own uncapped `refundAmountInCents` at `:1082` and feeds it to both `processCorrectiveInvoice` (`:1084-1101`) and `sendOrderCancellation` (`:1104-1110`)), `backend/src/modules/payments/payments.service.ts:1393-1400` (`partialRefund` computes `rawRefundAmountInCents`, then caps it: `Math.min(rawRefundAmountInCents, available)` — this capped figure is what's actually sent to Stripe and persisted to `payment.refundedAmountInCents`, but `partialRefund` returns `Promise<void>` and never surfaces it), `:1252` (the function's own comment acknowledging "sub-cent remainder is absorbed by the cap").

The cap exists specifically to prevent over-refund from rounding accumulation across multiple sequential partial cancellations. But `cancelItemsByUser` never receives the capped value back — it recomputes an independent, uncapped sum from the same input items and uses that for both the legally-mandated corrective invoice and the customer-facing "kwota X zostanie zwrócona" email.

**Trigger:** A coupon-discounted order undergoes 3+ sequential partial cancellations (the same drift-accumulation scenario already fixed once for the proration math itself). On a call where `available` is smaller than the raw item-sum, Stripe refunds the capped (smaller) amount, but the email and the corrective invoice both show the larger, uncapped figure — telling the customer, and recording on a legal document, a refund amount that was never actually sent to their card.

**Fix:** Change `PaymentsService.partialRefund()` to return the actual `refundAmountInCents` it sent to Stripe, and have `cancelItemsByUser` use that returned value — instead of recomputing its own — for both the invoice and the email.

---

## 🟡 MEDIUM — Cart mutation has no lock against a concurrently in-flight checkout, so `createFromCart` can charge/decrement stock against a snapshot the customer has already changed

**Classification:** Bug
**Files:** `backend/src/modules/orders/orders.service.ts:176-191` (the `checkout-lock` is acquired, then `cart` is read once via `cartService.getOrCreate()` *before* the lock-protected transaction begins, with real I/O — coupon validation, NIP lookup — in between) through every downstream use of that same `cart.items` array (lines 240, 273, 286-318, 393-403) ↔ `backend/src/modules/cart/cart.service.ts` (`updateItem`/`removeItem`/`addItem` — confirmed via grep: none acquire or check `checkout-lock` or any cart-scoped lock).

The `checkout-lock` Redis key only guards two concurrent `createFromCart` calls against each other; it has no effect on `CartService`'s own mutation methods, and the cart is read once outside the transaction the lock protects.

**Trigger:** A customer has the cart open in two tabs. Tab A starts checkout (reads cart: item X qty 2). Before Tab A's transaction commits, Tab B edits the cart (reduces item X to qty 1). Tab A's transaction still decrements stock by 2 and charges for 2, silently ignoring the customer's own concurrent edit — and the post-payment cart cleanup then deletes whatever Tab B left, masking the discrepancy instead of reconciling it.

**Fix:** Either have `CartService.updateItem`/`removeItem`/`addItem` acquire the same per-user/session lock before mutating, or re-read the cart from inside the transaction (after the lock is held) instead of relying on the pre-lock snapshot taken at the top of `createFromCart`.

---

## 🟡 MEDIUM — `SSE_MAX_CONNS_GLOBAL` is per-replica in-memory state, not actually global — the real fleet-wide ceiling silently scales with replica count

**Classification:** Bug
**Files:** `backend/src/modules/products/products.controller.ts:39` (`const SSE_MAX_CONNS_GLOBAL = 500;`), `:47` (`private sseConnCount = 0;` — a plain class field, i.e. per-process state), `:86-95` (enforcement and increment) — confirmed by direct read.

This counter was previously Redis-backed (`sse:global:count`), making the 500 cap a true cross-replica ceiling. A later fix replaced it with a server-local counter specifically to stop a stale Redis key from permanently locking out connections after an ungraceful crash — but in doing so reverted the cap to per-process scope, while leaving the constant's name and the surrounding comments still describing a global guarantee that no longer holds.

**Trigger:** Railway scales the backend to, say, 3 replicas under normal traffic. A spike of ~1,400 concurrent SSE stock-stream viewers (a flash sale, or a scraper hitting every PDP) load-balances roughly evenly — each replica sees ~470 connections, under its own local 500 cap, so none of them 429. The fleet now holds ~1,400 long-lived SSE connections plus their underlying Postgres-polling/Redis-subscriber overhead, defeating the original intent of the cap (preventing per-connection polling from saturating the DB pool) at exactly the multi-replica scale Railway exists to provide.

**Fix:** Either re-introduce a Redis-backed global counter using a crash-safe pattern (short-TTL per-connection keys refreshed by the existing idle-reset heartbeat, counted via `SCAN` rather than a single `INCR`/`DECR` accumulator that can drift after an ungraceful kill), or divide the cap by the expected replica count and rename the constant to `SSE_MAX_CONNS_PER_REPLICA` so it no longer claims a guarantee it doesn't provide.

---

## 🟡 MEDIUM — Guest order-tracking page shows raw English enum strings for 3 order statuses that round 17's status-label fix never reached, because it's a third, independent copy of the same map

**Classification:** Bug
**Files:** `backend/src/modules/orders/orders.service.ts:677-723` (`trackByEmailAndNumber` — deliberately returns the order's real, unfiltered `status`, any of the 11 `OrderStatus` values), `frontend/src/app/features/orders/track-order/track-order.component.ts:15-24` (`STATUS_LABELS`) and `:120-126` (`.status--*` classes), `:152-154` (`statusLabel()` fallback `?? status`) — confirmed: this file's `STATUS_LABELS` map and its independent CSS badge-color rules were never touched by round 17's fix to the structurally identical maps in `order-detail.component.ts`/`order-list.component.ts`.

`track-order.component.ts` maintains its own copy of the Polish status-label map and badge-color CSS, separate from the two files round 17 fixed to add `DISPUTE_HOLD`/`DISPUTE_LOST_REVIEW`/`FRAUD_REVIEW`. This third copy still has only 8 of 11 entries.

**Trigger:** A guest customer whose order is `PARTIALLY_REFUNDED`, `DISPUTE_HOLD`, or `DISPUTE_LOST_REVIEW` visits `/orders/track` and sees the literal raw enum string rendered in an unstyled gray pill — on a storefront with no other English text anywhere in the customer-facing flow.

**Fix:** Add the same entries to `track-order.component.ts`'s `STATUS_LABELS`/CSS that round 17 already added elsewhere — ideally extract the map into one shared constant so a future status addition only needs to land once instead of three times.

---

## Stale exclusion-list framing to correct (not new bugs — just count/description drift)

- **Cron distributed-lock coverage:** round 20's notes describe "all 11 cron/interval jobs"; re-counting from current source finds exactly **10** `@Cron`/`@Interval` jobs total, all 10 with `SET NX` Redis locks (the 11th apparently no longer exists or was consolidated). Coverage is genuinely complete; the "11" figure in round 20's verified-clean notes should be corrected to 10 so a future round doesn't go looking for an 11th job that isn't there.
- **Order-number/invoice-number sequence DDL:** the exclusion list's "non-idempotent/no retry under concurrent boot" framing (line 109, 135) is stale — current `OrdersService.onModuleInit`/`InvoiceService.ensureSequence` both use `CREATE SEQUENCE IF NOT EXISTS` plus exponential-backoff retry, correctly handling concurrent multi-replica cold starts. Worth annotating resolved.
- **Supabase upload retry:** the exclusion list's "`uploadWithRetry` exists only for `uploadShippingLabel`, not `uploadProductImage`/`uploadInvoice`" (Shipping/Carriers section) is stale — all three call sites now share the same retry-with-backoff helper. Worth annotating resolved.

---

## Notes — verified clean

**Backend module seams** — `ProductsService.notifyStockChange`/`notifyStockChangesByDelta` remains the sole stock-mutation choke point across orders/payments/products (returns has zero direct stock writes, delegating entirely to `partialRefund`); shipping-cost snapshot consistency (`order.shippingCostInCents` captured once, never re-derived); pre-transaction coupon eligibility correctly re-verified inside the transaction with fresh prices; invoice generation/correction locking and VAT-breakdown math unchanged and correct.

**Contract drift** — Cart, order detail/list, payment-status, shipping-rate, coupon-validate, and review response shapes were each traced end-to-end (backend → shared-types → frontend) and match exactly, including round 18/19's proration-formula and live-rate fixes. `CarrierCode`'s 5 values are handled consistently everywhere they're branched on. Address `country` omission from the frontend form is safe (DB default + backend re-validation). `estimatedRestockDate` reaching the frontend's model but never rendering is a missing-feature gap, not a contract bug — flagged for visibility only, not included above.

**External-service boundaries** — Stripe coupon string-vs-expanded-object handling is correct everywhere coupons are read back from a session; the invoice signed-URL used by the BullMQ post-payment job is generated fresh on every processing attempt (not captured stale at enqueue time); `handleRefundUpdate`'s recovery branch correctly uses Stripe's own authoritative `refund.amount` rather than a locally recomputed figure (the pattern the refund-amount-mismatch finding above should converge toward); carrier client timeout/retry math is internally consistent with the `generateLabel` lock TTL.

**Infra/cross-replica** — `OutboxProcessorService`'s claim-before-work plus the just-shipped lock-refresh-before-each-message fix correctly close the cross-replica double-processing race; `reconcilePendingPayments`'s diagnostic `lastReconcileAt` write doesn't factor into the `/health` readiness boolean, so cron staleness can't affect Railway's traffic routing; `ShippingRatesService`'s Redis-backed rate cache avoids the previously-fixed DEL-then-stale-SET race; recent Prisma migrations are all additive/nullable-or-defaulted with no rolling-deploy ordering risk; no other module-level mutable singleton state found outside the SSE counter above.

---

This round's findings, once resolved, should be folded into `docs/audit-exclusion-list.md` per its own maintenance instructions.
