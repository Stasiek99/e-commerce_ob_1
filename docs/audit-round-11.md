# E-Commerce Audit — Round 11
*Generated: 2026-06-15 — 5-agent stochastic consensus*
*Agents: Tax & Financial Integrity · Operational Resilience · API Attack Surface & Auth · Business Logic & Customer Experience · Data Integrity & GDPR/Polish Law*

> **Excludes** everything already in `audit-weak-points.md`, `audit-round-2.md` through `audit-round-10.md`, and `project-gaps-audit.md`.
> **Excludes** Phase 7 (pre-launch checklist) items in ROADMAP.md.

---
Done:

## 🔴 CRITICAL — `SELLER_NIP` boots with empty string — every invoice is legally void *(Tax agent)*

**File:** `backend/src/config.validation.ts:146`, `backend/src/modules/invoice/invoice.service.ts:319,435`

`requiredInProd(Joi.string(), '')` satisfies Joi's `.required()` check with the empty string `''` — it is not `undefined`, so it passes. The invoice renderer skips the NIP line silently:
```typescript
if (this.sellerNip) doc.text(`NIP: ${this.sellerNip}`); // '' is falsy — skipped
```

Per Art. 106e ust. 1 pkt 4 Ustawy o VAT the seller's NIP is a mandatory invoice element. Every invoice without it is legally void — the buyer cannot deduct input VAT and the merchant faces KAS penalties of up to 100% of the omitted tax per Art. 112b.

**Fix:**
```typescript
SELLER_NIP: requiredInProd(Joi.string().min(1).pattern(/^\d{10}$/), ''),
```
Add a startup assertion in `InvoiceService.onModuleInit` that throws if `sellerNip` is empty in production.

---

## 🔴 CRITICAL — Shipping rate fetched outside order transaction — customers silently over/under-charged *(Business Logic agent)*

**File:** `backend/src/modules/orders/orders.service.ts:213`

`ShippingRatesService.getRateForCarrier()` is called **before** `$transaction` opens. The shipping cost is snapshotted, then the transaction decrements stock and locks prices. If an admin updates a shipping rate between the two operations, the customer is charged the stale cached value. The Stripe Checkout Session is created with `order.shippingCostInCents` derived from this stale snapshot.

Redis cache TTL is 5 minutes; `invalidateCache()` only clears the key — another Railway pod serving the request may still hold the old value in its in-process Axios call. Rate increases silently overcharge customers; rate decreases mean the merchant under-collects.

**Fix:** Move `getRateForCarrier(dto.carrierCode)` inside the `$transaction` body after the stock decrement, so the shipping cost is atomically consistent with all other order data used to compute `txTotalInCents`.

---

## 🔴 CRITICAL — Redis hard-dependency in `login()` — any Redis outage causes total login lockout *(Ops agent)*

**File:** `backend/src/modules/auth/auth.service.ts:83–103`

`login()` calls `this.redis.exists(lockKey)` and `this.redis.incr(failKey)` with no `try/catch`. IORedis is configured with `maxRetriesPerRequest: null` — calls queue in an infinite offline queue. During any Redis outage (Railway sleep, restart, OOM eviction) all login attempts hang until the 8-second `TimeoutInterceptor` fires → every login returns 408.

Compare: `JwtStrategy.validate()` (line 82–88) correctly wraps Redis calls in try/catch and allows authenticated requests through. Login has no equivalent safety valve.

**Fix:** Wrap both Redis calls in `try/catch` inside `login()`. On error, skip the rate-limit check (log to Sentry) and allow login to proceed — mirroring the JWT-strategy pattern.

---

## 🔴 CRITICAL — Partial-refund discount proration uses stale `order.discountInCents` — compounds on second partial cancellation *(Tax agent)*

**File:** `backend/src/modules/orders/orders.service.ts:916–919`

```typescript
const discountFraction = order.discountInCents / order.itemsTotalInCents;
for (const item of resolvedItems) {
  item.priceInCents = Math.round(item.priceInCents * (1 - discountFraction));
}
```

`order.discountInCents` and `order.itemsTotalInCents` are never updated after a partial cancellation. On a second partial cancel of a `PARTIALLY_REFUNDED` order the same fraction is applied again — the already-discounted price is discounted a second time. The compound over-refund can push the total refunded above `payment.amountInCents`. `partialRefund()` in `payments.service.ts:1033` does **not** cap `refundAmountInCents` against `payment.amountInCents - payment.refundedAmountInCents`, so Stripe may accept both and the merchant pays out more than was captured.

**Fix:** Add a cap in `partialRefund()`: `Math.min(refundAmountInCents, payment.amountInCents - payment.refundedAmountInCents)`. Track per-item `alreadyCancelledDiscount` to avoid re-applying the fraction on subsequent partial cancels.

---

## 🔴 CRITICAL — Google OAuth silently takes over existing password-based accounts — no re-auth required *(API Auth agent)*

**File:** `backend/src/modules/auth/auth.service.ts:107`

When Google presents an email that already exists as a password-based account, `findOrCreateGoogleUser()` unconditionally links the Google identity and issues a full session:

```typescript
user = await this.usersService.findByEmail(profile.email);
if (user) {
  return this.usersService.update(user.id, {
    googleId: profile.googleId,
    isEmailVerified: true,
  });
}
```
No check for existing `googleId`, no password re-authentication, no opt-in confirmation. An attacker who creates a Google account with a victim's email (or gets access to any Google Workspace account with that email) gains full authenticated access to the victim's store account including their saved addresses, order history, and the ability to place orders on saved payment methods.

**Fix:** When linking a Google identity to an existing password account, either (a) require current-password proof before linking, or (b) send a verification email to the existing address and gate the link on that click. At minimum, throw `ConflictException` if the found user already has a `passwordHash` and no `googleId`.


## 🔴 CRITICAL — `logout()` does not revoke the current access token — 15-minute account takeover window *(API Auth agent)*

**File:** `backend/src/modules/auth/auth.service.ts:194`

`logout()` only sets `revokedAt` on the refresh token. It never calls `revokeAccessTokensForUser()` (which writes the Redis `auth:revoke-before:{userId}` fence) nor `revokeAccessTokenJti()`. Compare: `resetPassword()` and `changePassword()` both call `revokeAccessTokensForUser()` after invalidating refresh tokens.

After a user logs out, any access token already in an attacker's hands (stolen laptop, XSS leak, shared session) remains valid for up to 15 minutes. The user believes they are safe; the attacker can call any authenticated endpoint.

**Fix:** Call `revokeAccessTokensForUser(userId)` inside `logout()`. The refresh token row contains `userId` — one DB read before the revoke is sufficient, or pass `userId` as a second argument from the controller.

---

## 🟠 HIGH — `verifyEmail` idempotency shortcut fires before `usedAt`/`expiresAt` guards *(API Auth agent)*

**File:** `backend/src/modules/auth/auth.service.ts:303`

```typescript
// Fires FIRST — before expiry or usedAt check:
if (stored?.user?.isEmailVerified && !stored?.user?.pendingEmail) return;

// These guards never run for already-verified accounts:
if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
  throw new BadRequestException('Invalid or expired verification link');
}
```

A re-used, expired, or stolen verification token for an already-verified account bypasses the `BadRequestException` silently. An `EMAIL_CHANGE` token that set `pendingEmail` after initial verification was already completed can slip through. Also: the early return on a verified account leaks the existence of that verified account (timing/response enumeration).

**Fix:** Move the idempotency check to after both the `usedAt` and `expiresAt` validation. Validate that the token `type` is `EMAIL_VERIFICATION` before applying the early-return shortcut.

---

## 🟠 HIGH — `processInvoice` holds `SELECT FOR UPDATE` lock during Supabase upload — 30s pgBouncer exhaustion *(Ops agent)*

**File:** `backend/src/modules/invoice/invoice.service.ts:100–139`

`processInvoice` opens a Prisma interactive transaction with `timeout: 30_000`, acquires `SELECT ... FOR UPDATE` on the order row, then calls `this.storage.uploadInvoice(pdf, filename)` — an HTTP call to Supabase — **inside the transaction** (line 128). A slow upload (network blip, Supabase rate limit) holds a real Postgres connection for up to 30 seconds. With pgBouncer capped at 10 connections, three concurrent invoice generation stalls exhaust the pool entirely, queuing all other queries until `pool_timeout` (20s) fires.

This is not theoretical: `processInvoice` is called fire-and-forget from payment confirmation (`payments.service.ts:519`) and from the outbox processor (`outbox-processor.service.ts:91`), both of which can run concurrently under traffic.

**Fix:** Move `storage.uploadInvoice` outside the transaction. Obtain the sequence number inside a short transaction, generate + upload the PDF outside, then commit the order update in a second short transaction. Lock-hold time drops from seconds to microseconds.

---

## 🟠 HIGH — `markRefunded` in returns issues a full Stripe refund regardless of how many items were returned *(Business Logic agent)*

**File:** `backend/src/modules/returns/returns.service.ts:301`

`ReturnsService.markRefunded()` calls `this.payments.refundPayment(req.orderId, 'RETURN_APPROVAL')`. `refundPayment()` always refunds `payment.amountInCents` — the full captured amount. The `ReturnRequest.items` JSON blob (which specifies which items the customer returned) is never parsed and never passed into any payment amount calculation. Stock is fully restored for all items.

`partialRefund()` exists and is correctly wired to `cancelItemsByUser()` but `ReturnsService` never calls it. A customer returning 1 item out of 3 receives a full refund and has all stock restored.

**Fix:** Parse `req.items` in `markRefunded()`, compute the refund from `OrderItem.snapshotPrice × quantity`, call `paymentsService.partialRefund()` instead of `refundPayment()`.

---

## 🟠 HIGH — Corrective invoice has no idempotency guard — duplicate corrective invoices burn sequential numbers *(Tax agent)*

**File:** `backend/src/modules/invoice/invoice.service.ts:161–219`

The main invoice is protected by a `SELECT FOR UPDATE` idempotency check. `processCorrectiveInvoice` has no equivalent — it always calls `nextval`, generates a PDF, uploads to Supabase, and inserts a new `InvoiceCorrection` row. A BullMQ retry after a transient Supabase timeout produces:
1. A gap in the `FK/YYYY/NNNNNN` sequential series — a violation of Art. 106e ust. 1 pkt 2 Ustawy o VAT (sequential numbering, no gaps). A gap alone triggers automatic KAS audit.
2. A second `InvoiceCorrection` row for the same refund — the VAT ledger shows double the adjustment.

**Fix:** Add a composite unique index on `(orderId, correctedAmountInCents)` on `InvoiceCorrection`. Wrap `processCorrectiveInvoice` in a `SELECT FOR UPDATE` on the order row, checking for an existing correction row before allocating the sequence — same pattern as the main invoice.

---

## 🟠 HIGH — Guest checkout order-token TTL is 1 hour; P24/BLIK async payments can take 5 days *(Business Logic agent)*

**File:** `backend/src/modules/payments/payments.service.ts:167`

```typescript
await this.redis.set(`order-token:${order.id}`, guestToken, 'EX', 3600);
```

P24 (bank transfer) can take 1–2 business days per Stripe documentation. A guest customer who initiates P24 payment and returns 2 hours later via the URL in their confirmation email gets `401 Unauthorized` from `getPaymentStatusByToken`. They have no account, no way to check status, and the `trackByEmailAndNumber` endpoint only returns `{ status, trackingNumber }` — not payment status. The customer sees a locked-out payment page and has no visibility into whether their bank transfer was accepted.

**Fix:** Extend the Redis TTL to `7 * 24 * 3600` (7 days — the outer bound of P24 async settlement plus Stripe's retry window). Alternatively, implement a sliding-window TTL that refreshes on each `getPaymentStatusByToken` call.

---

## 🟠 HIGH — `ProductsModule` local `REDIS_CLIENT` provider permanently disconnects on first error *(Ops agent)*

**File:** `backend/src/modules/products/products.module.ts:14–27`

`ProductsModule` registers a local provider with the same `REDIS_CLIENT` token as the global client but with `retryStrategy: () => null` (permanent disconnect on first error). NestJS resolves the local provider first; `ProductsService` receives this fail-fast client. After any transient Redis error, the client **permanently** disconnects — all subsequent operations throw "Connection is closed" for the lifetime of the process, requiring a full container restart to recover. The stock SSE pub/sub subscriber is also a third separate connection outside DI, with no consistent error-handling policy.

**Fix:** Remove the local `REDIS_CLIENT` provider from `ProductsModule` and inject the global one. Register the SSE subscriber under a distinct token (e.g., `STOCK_SSE_REDIS_SUBSCRIBER`).

---

## 🟠 HIGH — `back_in_stock` email job not idempotent — BullMQ retry sends duplicate restock emails *(Ops agent)*

**File:** `backend/src/modules/email/email-queue.processor.ts:104–112`

The processor sends the email, then updates `wishlistItem.notifyOnRestock = false`. If the DB update fails and BullMQ retries, `notifyOnRestock` is still `true` and the email is sent again. `deriveJobId` in `email-queue.service.ts` does not generate a stable job ID for `back_in_stock` jobs (no `requestId` or `orderNumber` in the payload), so BullMQ has no deduplication key.

**Fix:** Read `notifyOnRestock` at the top of the processor before sending — skip if already `false`. Or update the flag to `false` *before* sending the email (if the update modified `count === 1`, send; otherwise skip). This is the correct at-least-once delivery pattern.

---

## 🟠 HIGH — NIP check-digit validation absent at order creation — B2B invoices silently void *(GDPR agent, Tax agent — 2/5 agents)*

**File:** `backend/src/modules/orders/dto/create-order.dto.ts:101–104`

`CreateOrderDto.nip` uses only `@Matches(/^\d{10}$/)` — no check-digit validation. The `NipChecksumConstraint` (`[6,5,7,2,3,4,5,6,7]` weight vector, `sum % 11 === digits[9]`) exists in `update-profile.dto.ts` and is never reused here. Any 10-digit string (e.g. `1234567890`) passes, gets snapshotted into `orders.snapshotNip`, and printed on the PDF invoice. A syntactically valid but algorithmically wrong NIP produces a legally defective VAT invoice under Art. 106e ust. 1 pkt 5 Ustawy o VAT — the buyer cannot deduct input VAT.

**Fix:** Import `NipChecksumConstraint` from `update-profile.dto.ts` and add `@Validate(NipChecksumConstraint)` to `CreateOrderDto.nip`.

---

## 🟠 HIGH — FREE_SHIPPING coupon proration treats shipping discount as item discount — incorrect partial refunds *(Tax agent)*

**File:** `backend/src/modules/orders/orders.service.ts:916–948`

When `FREE_SHIPPING` coupon is applied, `order.discountInCents = shippingCostInCents`. The partial-refund proration then computes `discountFraction = shippingCostInCents / itemsTotalInCents` and multiplies per-item prices by `(1 - discountFraction)`. This divides a **shipping** discount by an **items** total, producing an incorrect per-item reduction. The customer receives less than they paid for the item. The corrective invoice then reflects a smaller VAT adjustment than legally required under Art. 29a ust. 10 Ustawy o VAT.

**Fix:** Detect `FREE_SHIPPING` coupon type before proration (check `order.couponId → coupon.discountType`). Skip the item-price reduction for `FREE_SHIPPING` — the shipping refund is already encoded in `order.discountInCents` separately from the items total.

---

## 🟠 HIGH — `marketingConsentAt` never set when consent changes via `PATCH /users/me` *(GDPR agent)*

**File:** `backend/src/modules/users/users.service.ts:30–31`

`UsersService.update()` passes `UpdateProfileDto` directly to `prisma.user.update()`. When `marketingConsent: true` is submitted, the `User.marketingConsent` boolean is updated but `marketingConsentAt` is never set — it stays `NULL` indefinitely. `recordConsent()` (line 257–260) only handles analytics consent, not marketing consent set via profile update.

**GDPR:** Art. 7(1) requires the controller to demonstrate consent was given — the timestamp is the only proof. UODO enforcement (e.g. UZS-644-491/22) has treated missing consent timestamps as a breach of accountability. A NULL `marketingConsentAt` for a user with `marketingConsent = true` means consent cannot be demonstrated.

**Fix:** In `UsersService.update()`, when `marketingConsent` is in the update payload, also set `marketingConsentAt: new Date()` when `true`, or add a `marketingConsentRevokedAt` when `false`.

---

## 🟠 HIGH — `termsAcceptedAt` / `termsVersion` are optional at order creation — no proof of T&C acceptance *(GDPR agent)*

**File:** `backend/src/modules/orders/dto/create-order.dto.ts:91–99`

Both `termsVersion` and `termsAcceptedAt` are `@IsOptional()`. A direct API caller or a frontend bug can place a valid order with both fields absent, leaving `Order.termsVersion = NULL` and `Order.termsAcceptedAt = NULL`.

Under UŚUDE Art. 8 ust. 1 pkt 2, the service provider must make the regulations available before contract conclusion. Under UoK Art. 12 ust. 1 pkt 4, the consumer must receive information about the terms before being bound. An order row where both columns are NULL is indefensible in a UOKiK dispute or court proceeding.

**Fix:** Make both fields required (remove `@IsOptional()`). Validate that `termsVersion` matches the current published version and that `termsAcceptedAt` is within the last 10 minutes to prevent replay of stale consent timestamps.

---

## 🟠 HIGH — `SELLER_NIP` not checksum-validated — a mis-typed NIP produces void invoices silently *(Tax agent)*

**File:** `backend/src/config.validation.ts:146`

The buyer-side `UpdateProfileDto` correctly validates the NIP checksum. `SELLER_NIP` is only validated as `Joi.string()` — no pattern, no checksum. A mis-typed seller NIP (transposed digits) produces syntactically valid but legally wrong invoices. The error only surfaces when a business customer tries to deduct VAT and the VIES/KSeF lookup fails — at which point all invoices since the mis-type are defective.

**Fix:** Apply the same checksum validator used in `UpdateProfileDto`:
```typescript
SELLER_NIP: requiredInProd(
  Joi.string().min(1).pattern(/^\d{10}$/).custom(nipChecksumValidator),
  '',
),
```

---

## 🟡 MEDIUM — Order cancel token shares `JWT_ACCESS_SECRET` as its HMAC key *(API Auth agent)*

**File:** `backend/src/common/utils/order-token.util.ts:3`, `backend/src/modules/orders/orders.service.ts:440`

```typescript
const cancelToken = generateOrderToken(order.id, order.snapshotEmail, jwtSecret);
// Uses JWT_ACCESS_SECRET as the HMAC key for guest order cancel links
```

The HMAC output is embedded in plaintext cancel URLs in emails and Stripe redirect URLs. Consequences: (1) `JWT_ACCESS_SECRET` rotation silently breaks all outstanding cancel links. (2) If the secret leaks, both JWT forgery and unlimited guest-order cancellations are trivially possible from a single credential. The `guestToken` on the same flow correctly uses a dedicated 32-byte random token — this is the inconsistency.

**Fix:** Issue the cancel HMAC using a dedicated `ORDER_CANCEL_SECRET` env var (≥256 bits). Add it to `config.validation.ts` as `requiredInProd`.

---

## 🟡 MEDIUM — `emailBounced` suppression blocks transactional order emails — UoK Art. 21 gap *(Business Logic agent)*

**File:** `backend/src/modules/email/email-queue.service.ts:43–54`

When Resend fires a bounce webhook, `user.emailBounced = true` is set. `EmailQueueService.enqueue()` then suppresses **all emails to that address** indefinitely — including order confirmation, payment confirmation, shipping notification, and cancellation. A temporary hard bounce (full inbox, server restart) permanently silences transactional mail.

Under UoK Art. 21, the merchant must deliver order confirmation on a durable medium. If the bounce was temporary and the inbox is now healthy, the customer never receives their invoice, shipping notification, or cancellation. There is no admin UI to reset `emailBounced` and no automatic re-validation path.

**Fix:** Split suppression by email category. Transactional order emails must bypass the bounce suppression or route through a fallback (e.g., SMS). Add `emailBouncedReason` and a time-bounded auto-reset (e.g., clear after 30 days for transactional mail retry).

---

## 🟡 MEDIUM — Railway rolling deploy kills in-flight BullMQ jobs — `worker.close(true)` exceeds SIGKILL window *(Ops agent)*

**File:** `backend/src/modules/email/email-queue.processor.ts:46–48`

`onApplicationShutdown` calls `this.worker.close(true)` — `force: true` waits for all active jobs to finish before closing. Railway's SIGTERM→SIGKILL window is ~10 seconds. A `payment_confirmed_with_invoice` job mid-PDF-generation (5–10 seconds) exceeds the window and is force-killed, leaving the job in `stalled` state. BullMQ re-queues stalled jobs on next startup, sending the email again. The customer receives a duplicate order confirmation email.

**Fix:** Replace `worker.close(true)` with `worker.close(false)` — accept BullMQ's stalled-job recovery path and verify that `deriveJobId` stable-IDs all customer-facing email jobs for deduplication on restart.

---

## 🟡 MEDIUM — Dispute-lost flow skips stock restore when label URL exists — inventory permanently lost *(Business Logic agent)*

**File:** `backend/src/modules/payments/payments.service.ts:1269–1289`

`handleDisputeClosed` checks `payment.order.shipment?.labelUrl`. If a label URL exists, `goodsShipped = true` → stock is not restored. A label URL means a label was **generated**, not that the parcel was delivered. If the carrier lost the parcel and returns it to the merchant (common in international disputes), the inventory is never restored. The `OrderItem.cancelledQuantity` remains 0, making future reconciliation ambiguous.

**Fix:** The `labelUrl` heuristic is too coarse. Remove the auto-detect and restore stock on every dispute loss by default. Let admin manually adjust if goods are provably delivered (an active decision, not an assumed one).

---

## 🟡 MEDIUM — Back-in-stock notifications tied to `Product`, not `ProductVariant` — wrong variant notified *(Business Logic agent)*

**File:** `backend/src/modules/products/products.service.ts:589–603`

`WishlistItem` links to `productId`, not `productVariantId`. When the 50ml variant is restocked, all watchers of the **product** (including those who wanted the 100ml variant) receive a notification. Separately, the exclusion filter suppresses the notification if the user previously bought **any** variant of that product — a customer who bought the 100ml and now wants the 50ml gets silenced.

**Fix (schema):** Add optional `productVariantId` FK to `WishlistItem` for per-variant subscriptions. Until then, update the email copy to say "one of your watched items is back" rather than implying the specific variant is available.

---

## 🟡 MEDIUM — `pruneProcessedStripeEvents` lock TTL 23h causes 48h cleanup gap after Railway sleep *(Ops agent)*

**File:** `backend/src/modules/payments/payments.service.ts:909–921`

The midnight cron acquires a Redis lock with `EX 82800` (23 hours). If the Railway container is evicted during the cron and restarted at 00:30, the lock is still alive until 23:00 the next day. The next midnight cron finds the lock held → skips pruning → the lock expires → the following night's cron finally runs 48 hours after the original intent. `ProcessedStripeEvent` rows accumulate: BLIK/P24 payment failures can generate 10–20 Stripe retry events per order; at scale this table grows to millions of rows, degrading the idempotency `WHERE eventId = $1` lookup.

**Fix:** Reduce the lock TTL to `EX 82000` (leaving a 13-minute re-run window within the same calendar day), or use `cron-job.org` to keep the container awake through the midnight window.

---

## 🟡 MEDIUM — `email_logs` and `outbox_messages` accumulate PII indefinitely — no retention TTL *(GDPR agent)*

**Files:** `backend/prisma/schema.prisma`: models `EmailLog` (line 694), `OutboxMessage` (line 740)

`email_logs` stores `to` (email address), `subject`, and the full Resend webhook payload indefinitely. `outbox_messages` `PROCESSED` rows retain full `payload` JSON (containing `snapshotEmail`, `firstName`, order data) after processing — no cleanup. The orders cleanup service (5-year window) and cart cleanup service both exist, but neither touches these tables.

**GDPR:** Art. 5(1)(e) storage limitation. UODO enforcement since 2022 treats unbounded operational logs as a violation even when primary data has a defined window.

**Fix:** Add a weekly cron:
```typescript
prisma.outboxMessage.deleteMany({
  where: { status: 'PROCESSED', processedAt: { lt: subDays(new Date(), 90) } }
});
prisma.emailLog.deleteMany({
  where: { createdAt: { lt: subYears(new Date(), 1) } }
});
```
---

## 🟡 MEDIUM — EU Omnibus price history not populated via seed/bulk import — "lowest price in 30 days" shows promotional price *(GDPR agent)*

**File:** `backend/src/modules/products/products.service.ts:805–827`

`attachOmnibusData()` gates enrichment on `compareAtPriceInCents != null`. If a variant existed for months with no history rows (imported via seed, `prisma.productVariant.upsert()`, or direct migration), `lowestPrice30dInCents` falls back to `v.priceInCents` — the current promotional price — and displays that as the 30-day minimum. This is structurally misleading.

**Regulatory impact:** Dyrektywa Omnibus (2019/2161) Art. 6a transposed into Polish law (Dz.U. 2022 poz. 1169). UOKiK guidance requires the 30-day minimum to reflect the factual lowest price, not the promotional price masquerading as a baseline.

**Fix:** When `compareAtPriceInCents` is set on a variant for the first time (transition from `NULL`), require at least one `ProductVariantPriceHistory` row with `compareAtPriceInCents` dated ≥30 days ago to exist, or block the promotional price display until history is established.

---

## 🟡 MEDIUM — `ConsentLog.expiresAt` defined but no purge job — expired records accumulate indefinitely *(GDPR agent)*

**File:** `backend/prisma/migrations/20260615100000_consent_log_uuid_cookie/migration.sql`, `backend/src/modules/users/users.service.ts:264–270`

The migration correctly adds `expires_at` with a 5-year TTL on consent records. No cron or cleanup service ever deletes rows where `expires_at < NOW()`. The column is metadata-only — an intent without enforcement. Anonymous `ConsentLog` rows accumulate permanently, growing beyond their declared lifespan.

**GDPR:** Art. 5(1)(e): data must not be retained beyond the stated purpose. The `consentId` UUID is a pseudonymous first-party identifier; 5-year-old rows for devices that no longer exist serve no provability purpose once expired.

**Fix:** Extend `OrdersCleanupService` (or create a dedicated `ConsentCleanupService`) with:
```typescript
await this.prisma.consentLog.deleteMany({
  where: { expiresAt: { lt: new Date() } },
});
```
---

## 🟡 MEDIUM — `requestEmailChange` does not revoke the current access token — stale email claim persists *(API Auth agent)*

**File:** `backend/src/modules/auth/auth.service.ts:255`

When a user requests an email change, sessions are only revoked in `verifyEmail()` once the change is confirmed (line 330). During the pending window the access token encodes the old email. `JwtStrategy.validate()` checks only `user.id` — it never validates that the token's `email` claim matches the current DB email. Code paths that trust `payload.email` from the JWT (logging, Stripe email, audit trail) produce stale-email artifacts.

**Fix:** Call `revokeAccessTokensForUser(userId)` at the end of `requestEmailChange()` (not only in `verifyEmail()`). This mirrors the already-correct pattern in `resetPassword()` and `changePassword()`.

---

## 🟡 MEDIUM — Corrective invoice PDF missing per-rate VAT breakdown — Art. 106j ust. 2 violation *(Tax agent)*

**File:** `backend/src/modules/invoice/invoice.service.ts:333–372`

Art. 106j ust. 2 Ustawy o VAT requires the corrective invoice to contain the original taxable base per VAT rate, the corrected base per rate, and the net + VAT delta per rate. `renderCorrective` renders one gross correction amount with no VAT breakdown. For mixed-rate orders (e.g. 23% perfume + 5% item cancelled together), the corrective invoice is non-compliant and JPK_V7 will flag the mismatch.

**Fix:** Pass the cancelled item list (with `snapshotVatRate` per item) to `processCorrectiveInvoice`. Render one correction line per VAT rate group in `renderCorrective` showing: original net/VAT, corrected net/VAT, and the delta.

---

## 🟢 LOW — Concurrent 401 retry from two browser tabs can issue a third access token neither tab uses *(API Auth agent)*

**File:** `backend/src/modules/auth/auth.service.ts:142–147`

The 30-second grace window on `validateRefreshTokenByRaw()` allows a recently-rotated token to pass validation if `replacedBy` is set. If two tabs simultaneously receive 401 and both attempt refresh (racing past the Angular interceptor's serialization), both succeed in sequence — the second rotates the replacement token, generating a third token that neither tab stores. The user gets an unpredictable random logout on the next request.

**Fix:** Confirm the Angular `errorInterceptor` uses a `BehaviorSubject`/`ReplaySubject` to queue all concurrent 401s behind a single in-flight refresh. If two-tab scenarios are possible, add a `usedAt` flag to the grace-window path to prevent the replacement token from being rotated a second time within the grace period.

---
## Agent Agreement Summary

| Finding | Agents |
|---|---|
| NIP check-digit at order creation | Tax + GDPR (2/5) |
| All other findings | single-agent deep specialist territory |

*Note: Low cross-agent overlap is expected in Round 11 — each agent operates in fully distinct technical domains. Single-agent findings are still high-confidence within their domain.*

---

## Prioritized Fix Order

| # | Finding | Severity | Effort |
|---|---|---|---|
| 1 | Add `.min(1).pattern(/^\d{10}$/)` to `SELLER_NIP` in config.validation.ts; startup assertion | 🔴 CRITICAL | 30 min |
| 2 | Move `getRateForCarrier()` inside `$transaction` body in `orders.service.ts` | 🔴 CRITICAL | 1 hour |
| 3 | Wrap Redis calls in try/catch in `login()` — allow login on Redis outage | 🔴 CRITICAL | 30 min |
| 4 | Cap `partialRefund` at `amountInCents - refundedAmountInCents`; track per-item discount | 🔴 CRITICAL | 2 hours |
| 5 | Block Google OAuth linking to existing password accounts without re-auth | 🔴 CRITICAL | 2 hours |
| 6 | Call `revokeAccessTokensForUser()` in `logout()` | 🔴 CRITICAL | 30 min |
| 7 | Fix `verifyEmail` — move idempotency shortcut after `usedAt`/`expiresAt` guards | 🟠 HIGH | 1 hour |
| 8 | Move `storage.uploadInvoice` outside `processInvoice` transaction | 🟠 HIGH | 2 hours |
| 9 | Fix `markRefunded` — call `partialRefund()` with parsed return items, not full `refundPayment()` | 🟠 HIGH | 2 hours |
| 10 | Add idempotency guard to `processCorrectiveInvoice` (unique index + FOR UPDATE) | 🟠 HIGH | 2 hours |
| 11 | Extend guest order-token Redis TTL to 7 days | 🟠 HIGH | 15 min |
| 12 | Remove local `REDIS_CLIENT` from `ProductsModule`; use global client | 🟠 HIGH | 1 hour |
| 13 | Fix `back_in_stock` job — check `notifyOnRestock` before sending; update flag first | 🟠 HIGH | 1 hour |
| 14 | Add `@Validate(NipChecksumConstraint)` to `CreateOrderDto.nip` | 🟠 HIGH (2/5) | 30 min |
| 15 | Fix `FREE_SHIPPING` proration in `cancelItemsByUser` — skip item-price reduction | 🟠 HIGH | 1 hour |
| 16 | Set `marketingConsentAt` in `UsersService.update()` when `marketingConsent` changes | 🟠 HIGH | 30 min |
| 17 | Make `termsVersion` and `termsAcceptedAt` required in `CreateOrderDto` | 🟠 HIGH | 30 min |
| 18 | Add NIP checksum validator to `SELLER_NIP` env var in `config.validation.ts` | 🟠 HIGH | 1 hour |
| 19 | Add `ORDER_CANCEL_SECRET` env var; decouple cancel HMAC from `JWT_ACCESS_SECRET` | 🟡 MEDIUM | 1 hour |
| 20 | Split `emailBounced` suppression — allow transactional mail through; add auto-reset | 🟡 MEDIUM | 2 hours |
| 21 | Replace `worker.close(true)` with `worker.close(false)` in email processor | 🟡 MEDIUM | 15 min |
| 22 | Remove `labelUrl` heuristic from dispute-lost flow — always restore stock | 🟡 MEDIUM | 1 hour |
| 23 | Add optional `productVariantId` FK to `WishlistItem`; update restock query | 🟡 MEDIUM | 2 hours |
| 24 | Reduce `pruneProcessedStripeEvents` lock TTL to `EX 82000` | 🟡 MEDIUM | 15 min |
| 25 | Add `outbox_messages` (90 days) and `email_logs` (1 year) cleanup cron | 🟡 MEDIUM | 1 hour |
| 26 | Block `compareAtPriceInCents` set without ≥30 days of prior price history | 🟡 MEDIUM | 2 hours |
| 27 | Add `ConsentLog` expiry purge to `OrdersCleanupService` | 🟡 MEDIUM | 30 min |
| 28 | Call `revokeAccessTokensForUser()` in `requestEmailChange()` | 🟡 MEDIUM | 30 min |
| 29 | Add per-rate VAT breakdown to corrective invoice PDF | 🟡 MEDIUM | 3 hours |
| 30 | Verify Angular `errorInterceptor` serializes concurrent 401 retries correctly | 🟢 LOW | 1 hour |

---

## Legend

| Label | Meaning |
|---|---|
| 🔴 CRITICAL | Silent financial/legal destruction, complete feature outage, or auth bypass in production |
| 🟠 HIGH | Direct money loss, legal liability, broken customer flow, or serious data integrity gap |
| 🟡 MEDIUM | Compliance gap, operational blindspot, or UX failure at scale |
| 🟢 LOW | Hardening / edge-case defense |
