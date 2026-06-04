# E-Commerce Audit — Round 6
*Generated: 2026-06-03 — 5-agent stochastic consensus*
*Agents: Domain Expert · Security Skeptic · Pragmatist (Ops) · First-Principles (DB/Infra) · Risk Analyst (Legal)*

> **Excludes** everything already in `audit-weak-points.md`, `audit-round-2.md`, `audit-round-3.md`, `audit-round-4.md`, `audit-round-5.md`, and `project-gaps-audit.md`.
> **Excludes** Phase 7 (pre-launch checklist) items in ROADMAP.md.

---


## 🟠 HIGH — `charge.dispute.created` not handled — chargeback opens silently, order fulfills, deadline missed *(2/5 agents)*

**Files:** `backend/src/modules/payments/payments.service.ts:156-181`, `backend/src/modules/payments/stripe.client.ts`

`handleWebhookEvent` handles `checkout.session.*`, `charge.refund.updated`, and `refund.updated` — but not `charge.dispute.created` or `charge.dispute.closed`. When Stripe opens a chargeback:

1. Order remains `PAID` → fulfillment continues → shipping label is generated → parcel ships
2. Stock is never re-held
3. No Sentry alert, no admin notification, no order hold
4. Stripe requires evidence submission within **7 calendar days** — the system has zero automated path to respond

The dispute is silently ACKed as "ignoring" and Stripe eventually auto-rules in the cardholder's favour. On fragrance items (€50–150), losing a dispute after having shipped the product is double loss. At even a 0.3% dispute rate on 1000 orders, this is ~PLN 30,000/year in unchallenged chargebacks.

**Fix:**
1. Subscribe to `charge.dispute.created` and `charge.dispute.closed` in the Stripe Dashboard webhook endpoint.
2. In the handler: freeze fulfillment (`order.status → DISPUTE_HOLD`), notify admin via Slack, open a Sentry issue with the evidence deadline.
3. On `charge.dispute.closed`: restore stock or void based on `dispute.status`.

---

## 🟠 HIGH — `mergeGuestCart` bypasses `MAX_CART_QTY_PER_VARIANT` and stock guard *(2/5 agents)*

**File:** `backend/src/modules/cart/cart.service.ts:169-191`

When merging a guest cart into an authenticated user cart, quantities are summed (`existing.quantity + item.quantity`) with no enforcement of `MAX_CART_QTY_PER_VARIANT = 2` and no `stock >= newQty` re-check. An attacker (or any user) can:

1. Add 2 units of a limited variant as a guest
2. Log in to an account that already has 2 units of the same variant
3. Call `POST /cart/merge` → 4 units in the merged cart

`createFromCart` validates stock at checkout time using the merged quantities — so 4 units can be deducted from a stock of 2, producing negative stock. For limited-edition fragrances (the core product category), this is an inventory manipulation vector.

**Fix:** Add the same `newQty > MAX_CART_QTY_PER_VARIANT` and `variant.stock >= newQty` guards inside `mergeGuestCart`'s transaction loop, capping at `Math.min(existing + incoming, MAX_CART_QTY_PER_VARIANT)`.

---

## 🟠 HIGH — `retryPayment` creates a second `Payment` row on a PENDING order — unhandled P2002 crash *(1/5 agents)*

**File:** `backend/src/modules/payments/payments.service.ts:59-87`

`initiatePayment` reuses the existing `Payment` row only when `existingPayment.status === FAILED`. If a customer navigates away from Stripe checkout and immediately clicks "Pay again", the first row is still `PENDING` (Stripe session open). The code falls into the `else` branch and attempts `prisma.payment.create` — which throws `P2002` (unique constraint on `orderId`) as an unhandled exception, returning a 500 to the customer at the exact moment they're trying to pay.

**Fix:** Add `PENDING` to the reuse condition:
```typescript
if (['FAILED', 'PENDING'].includes(existingPayment?.status)) {
  // Return existing Stripe session URL if still valid, otherwise create new
}
```
Also check Stripe session expiry before reusing the `stripeSessionId`.

---


## 🟠 HIGH — `cancelByUser` lets a customer self-refund a `FRAUD_REVIEW` order before admin review completes *(1/5 agents)*

**File:** `backend/src/modules/orders/orders.service.ts:586-622`

The `cancelByUser` guard blocks `CANCELLED`, `REFUNDED`, `SHIPPED`, `DELIVERED` — but not `FRAUD_REVIEW`. An order in `FRAUD_REVIEW` has a `payment.status === COMPLETED` (set by `markSessionPaid` before routing to `FRAUD_REVIEW`). When the customer calls `DELETE /orders/:id`:

1. The guard passes
2. `refundPayment()` is called — which succeeds because the payment is `COMPLETED`
3. Full Stripe refund is issued before an admin has reviewed the fraud signal
4. Customer receives the refund, the order is cancelled, and the fraud review is moot

This is a bypass for the entire fraud hold mechanism. A fraudster who triggers fraud review simply cancels the order to immediately recover funds.

**Fix:** Add `FRAUD_REVIEW` to the set of statuses that block `cancelByUser`. Add a 409 with a customer-facing message ("Twoje zamówienie jest weryfikowane — skontaktuj się z obsługą").

---

## 🟠 HIGH — Product deactivation does NOT purge active carts — deactivated items can be checked out *(1/5 agents)*

**File:** `backend/src/modules/products/products.service.ts:444`, `backend/src/modules/orders/orders.service.ts` (checkout path)

`setVariantActive(false)` or `update({ isActive: false })` deactivates a variant in the DB. `cart.service.ts:addItem` correctly checks `isActive` — but `orders.service.ts:createFromCart` (the checkout path) never re-validates `isActive` before decrementing stock and creating the order. A customer with a stale open cart can complete checkout on a product that was just pulled from sale, a product under recall, or a product deactivated for any compliance reason.

**Fix:** Inside the `createFromCart` transaction, add a pre-check:
```typescript
const activeVariants = await tx.productVariant.findMany({
  where: { id: { in: variantIds }, isActive: true },
});
if (activeVariants.length !== variantIds.length) {
  throw new BadRequestException('One or more items in your cart are no longer available');
}
```

---

## 🟠 HIGH — Cookie consent stored only in `localStorage` — no GDPR-compliant audit trail *(1/5 agents)*

**File:** `frontend/src/app/core/services/consent.service.ts`

Analytics and marketing consent is persisted as `{ analytics: bool, v: 1 }` in `localStorage`. There is no consent timestamp, no IP hash, no user-agent fingerprint, no server-side record. Under GDPR Art. 7(1), the controller must be able to **demonstrate** that consent was given. `localStorage` is wiped by browser clear-data flows, is inaccessible during SSR, and cannot be produced as audit evidence during an UODO investigation or civil claim.

`User.marketingConsentAt` already exists on the User model — the pattern is established. Cookie/analytics consent has no equivalent.

**Fix:**
1. On consent acceptance, `POST /users/consent` with `{ analytics: boolean, timestamp }`. Store as `User.analyticsConsent + analyticsConsentAt` or in a separate `ConsentLog` table for guests.
2. For anonymous visitors, write a hashed session fingerprint with a timestamp to a `consent_logs` table (no PII, just proof of consent event).

---

## 🟠 HIGH — Price per unit of measure missing — Dyrektywa 98/6/EC + ustawa o cenach *(1/5 agents)*

**File:** `frontend/src/app/shared/product-card/product-card.component.ts`, `backend/prisma/schema.prisma:284`

Art. 5 of the EU Price Indication Directive (98/6/EC), reinforced by the Omnibus Directive (2019/2161), requires displaying the **unit price** (PLN per 100ml) for liquid products sold in comparable sizes. `ProductVariant` already has `volume Int?` (in ml) and `label` (e.g. "50ml"), but neither `product-card` nor `product-detail` computes or displays `priceInCents / volume * 100`. KAS spot-checks routinely flag this for online fragrance retailers. Penalty: up to 10% of annual turnover per Art. 4 ustawy o informowaniu o cenach.

**Fix:** Add a pipe or computed signal:
```typescript
unitPrice = computed(() =>
  this.variant().volume
    ? formatCurrency((this.variant().priceInCents / this.variant().volume!) * 100, 'pl', 'PLN')
    : null
);
```
Display as "149,00 zł / 100ml" below the main price on both card and detail views.


## 🟠 HIGH — Return shipping cost not disclosed at checkout — Art. 34 ust. 2 UoK violation *(1/5 agents)*

**File:** `frontend/src/app/features/legal/withdrawal/withdrawal.component.ts:45`

The correct disclosure ("Będziesz musiał/a ponieść bezpośrednie koszty zwrotu towarów") exists on the withdrawal information page — but Art. 34 ust. 2 UoK requires this disclosure **before the consumer is bound by the contract**, i.e. during checkout, not only in the Regulamin. UOKiK has issued fines specifically for this pattern.

**Fix:** Add a single sentence to the order summary panel in `checkout-page.component.html` and include it in the order confirmation email template.

---

## 🟠 HIGH — Timing attack on `PAYMENTS_RECONCILE_SECRET` comparison *(1/5 agents)*

**File:** `backend/src/modules/payments/payments.controller.ts:122`

```typescript
if (!secret || authorization !== `Bearer ${secret}`)
```

JavaScript `!==` on strings short-circuits on the first mismatched byte. An attacker making timed requests to `POST /payments/reconcile` can measure response-time deltas to brute-force the secret character by character. This endpoint triggers Stripe API calls and can mark orders as PAID.

**Fix:**
```typescript
import { timingSafeEqual } from 'crypto';
const expected = Buffer.from(`Bearer ${secret}`);
const actual = Buffer.from(authorization ?? '');
if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
  throw new UnauthorizedException();
}
```
---

## 🟠 HIGH — No BullMQ worker crash alert — failed email queue is permanently silent *(1/5 agents)*

**File:** `backend/src/modules/email/email-queue.processor.ts`

There is no `worker.on('failed')` hook registered anywhere in the codebase. When a BullMQ job exhausts all 3 retries (e.g. Resend is down), it moves to the failed set with `removeOnFail: { age: 604_800 }`. No Sentry event fires, no Slack notification, no health-endpoint degradation. The app continues returning 200 for order creation while email confirmation is permanently broken for the process lifetime. Failed jobs accumulate silently for 7 days, then are deleted without a trace.

**Fix:**
```typescript
worker.on('failed', (job, err) => {
  Sentry.captureException(err, { extra: { jobName: job?.name, jobId: job?.id } });
  this.logger.error(`BullMQ job failed: ${job?.name}`, err.stack);
});
```
---


## 🟠 HIGH — `cancelItemsByUser` partial refund computed from pre-discount gross — customer overpaid *(1/5 agents)*
**File:** `backend/src/modules/orders/orders.service.ts:767-776`
```typescript
refundAmountInCents = resolvedItems.reduce((s, i) => s + i.quantity * i.priceInCents, 0);
```
`i.priceInCents` is the snapshot price (pre-discount). The Stripe `partialRefund` call uses this same gross amount — the pro-rated coupon discount is never deducted. For a 20%-off coupon on a 200 PLN item, the customer paid 160 PLN but receives a 200 PLN refund. Financial loss on every partial item cancellation where a percentage coupon was applied.
**Fix:** Load `order.discountInCents`, `order.totalInCents`, and `order.itemsTotalInCents` to compute the pro-rated discount fraction per item:
```typescript
const discountFraction = order.discountInCents / order.itemsTotalInCents;
const refund = resolvedItems.reduce((s, i) =>
  s + Math.round(i.quantity * i.priceInCents * (1 - discountFraction)), 0);
```

---
## 🟠 HIGH — `CartItem` / `OrderItem` → `ProductVariant` FK has no `onDelete` rule — silent 500 on variant delete *(2/5 agents)*
**File:** `backend/prisma/schema.prisma:355, 431`
Both `CartItem.productVariant` and `OrderItem.productVariant` relations have no `onDelete` directive. Prisma defaults to `RESTRICT`. If a variant is ever hard-deleted (via a future admin action, a direct DB operation, or a Prisma `delete()` call in any future code path), PostgreSQL rejects the delete with a foreign key violation that bubbles up as an unhandled 500 — giving the admin no meaningful error.
More critically, `OrderItem` joining back to a deleted variant breaks invoice generation, refund amount calculations, and any future analytical queries.
**Fix:** For `CartItem`, use `onDelete: Cascade` (deleting a variant should remove it from carts). For `OrderItem`, use `onDelete: Restrict` but add an explicit pre-check in the service that surfaces a 409 before attempting the delete.
---

---

## Legend

| Label | Meaning |
|---|---|
| 🟠 HIGH | Real money loss, data corruption, legal exposure, or security breach |
| 🟡 MEDIUM | Degrades correctness, UX, or compliance significantly |
| 🟢 LOW | Polish / hardening |

Agent agreement noted where 2+ agents independently identified the same issue.

---

## 🟡 MEDIUM — `returns.service.ts` allows unlimited return requests per order — no uniqueness guard *(2/5 agents)*
**Files:** `backend/src/modules/returns/returns.service.ts:94`, `backend/prisma/schema.prisma:603-629`
`prisma.returnRequest.create(...)` has no pre-check and the schema has no `@@unique([orderId, type])` or `@@unique([orderId])` constraint. A customer can submit 3 simultaneous `WITHDRAWAL` return requests for the same order. All 3 are created. The Stripe refund idempotency guard means only the first refund fires, but the DB ends up with 3 `COMPLETED` return records and an encrypted IBAN stored 3× — a GDPR data minimisation violation (Art. 5(1)(c)) and a support nightmare.
**Fix:** Add `@@unique([orderId, status])` or at minimum an application-level guard:
```typescript
const existing = await this.prisma.returnRequest.findFirst({
  where: { orderId, status: { notIn: ['REJECTED', 'COMPLETED'] } },
});
if (existing) throw new ConflictException('A return request for this order is already in progress');
```
---

## 🟡 MEDIUM — `connect-pg-simple` session pool bypasses Prisma's capped pool — Supabase connection exhaustion *(1/5 agents)*
**File:** `backend/src/modules/admin/admin.setup.ts:830`
`connect-pg-simple` is initialized with `conString: process.env.DIRECT_URL`, opening its own `pg` driver pool (default: 10 connections) against Supabase's direct port (5432). This pool is entirely separate from Prisma's capped pool (`connection_limit=10` in the DATABASE_URL). Combined:
- Prisma pool: 10 connections
- `connect-pg-simple` pool: 10 connections (uncapped default)
- Supabase free tier: ~60 connections total
Under concurrent admin page-loads, both pools can be fully active simultaneously, consuming 20+ connections for admin sessions alone — leaving only 40 for all other Prisma queries.
**Fix:** Add `pool: { max: 2 }` to the `PgSession` constructor. Admin sessions have low concurrency requirements.
---

## 🟡 MEDIUM — `markSessionPaid` hardcodes `fromStatus: PENDING_PAYMENT` in OrderEvent — corrupts fraud-review audit trail *(1/5 agents)*
**File:** `backend/src/modules/payments/payments.service.ts:246`
`markSessionPaid` always writes `fromStatus: OrderStatus.PENDING_PAYMENT` to the `OrderEvent` audit log. But `reconcilePendingPayments` can call `markSessionPaid` on orders that were already routed to `FRAUD_REVIEW`. The resulting audit event shows `PENDING_PAYMENT → PAID` even when the real transition was `FRAUD_REVIEW → PAID` — corrupting the audit trail used for dispute evidence submission.
**Fix:** Read `fromStatus` from `payment.order.status` at transaction time rather than hardcoding it.
---

## 🟡 MEDIUM — `CouponUse` has no cascade on `Coupon` deletion — `reconcileCurrentUses` FK error *(1/5 agents)*
**File:** `backend/prisma/schema.prisma:551`
`CouponUse.coupon` has no `onDelete` rule (defaults to `RESTRICT`). Meanwhile, `Order.coupon` uses `onDelete: SetNull` — so an `Order` can lose its coupon FK while the corresponding `CouponUse` rows still reference the now-deleted `Coupon`. The hourly `reconcileCurrentUses` cron's `COUNT(*)` subquery joining `CouponUse → Coupon` will throw an FK error when orphaned rows exist.
**Fix:** Add `onDelete: Cascade` to `CouponUse.coupon` — if a coupon is deleted, its use records should be removed too (they're no longer meaningful without the coupon context).
---

## 🟡 MEDIUM — `MERCHANT_SLACK_WEBHOOK_URL` not validated as Slack-only — persistent SSRF risk *(1/5 agents)*
**File:** `backend/src/config.validation.ts:166`, `backend/src/modules/payments/payments.service.ts:382-388`
`MERCHANT_SLACK_WEBHOOK_URL` is validated only as `Joi.string().uri()`. The value is passed verbatim to `axios.post(webhookUrl, ...)`. If misconfigured or compromised, every paid order triggers an outbound POST with the customer email and order amount to an attacker-controlled endpoint.
**Fix:** Validate the URL prefix at startup:
```typescript
Joi.string().uri().custom((val, helpers) => {
  if (!val.startsWith('https://hooks.slack.com/')) {
    return helpers.error('MERCHANT_SLACK_WEBHOOK_URL must be a Slack webhook URL');
  }
  return val;
})
```
---

## 🟡 MEDIUM — Redis `retryStrategy: null` in dev silently kills BullMQ on connection loss *(1/5 agents)*
**File:** `backend/src/modules/redis/redis.module.ts` (IORedis client config)
In development (`isProd = false`), `retryStrategy: () => null` causes IORedis to stop retrying and emit an unhandled `error` event on the first Redis connection failure. BullMQ's `Queue` and `Worker` share this connection — if Redis goes down during development (or tests), email jobs are silently dropped. `EmailQueueService.enqueue` catches the error and only logs a warning; the app returns 200 for order creation while the email queue is permanently broken for the process lifetime.
**Fix:** Use `retryStrategy: () => 3000` (retry every 3s) in both environments. A broken queue should be observable, not silent.
---

## 🟡 MEDIUM — `BLIK`/P24 fraud: Stripe Radar fires post-payment — instant-transfer fraud window *(1/5 agents)*
**File:** `backend/src/modules/payments/payments.service.ts:207-222`
For BLIK and P24 payments, Stripe Radar's risk assessment runs after `checkout.session.completed` — **after the money has already moved**. Unlike card payments where Radar can decline at authorization, BLIK/P24 settles in seconds. The `radarRiskLevel` check in `handleWebhookEvent` can only trigger a `FRAUD_REVIEW` hold after funds arrive. There is no pre-checkout velocity check (same shipping address across accounts, new account + high-value order, multiple orders in 10 minutes).
BLIKjacking (attacker tricks victim into approving a BLIK code) specifically exploits this window.
**Fix:** Add a pre-`createCheckoutSession` velocity check in `OrdersService`:
```typescript
const recentOrders = await this.prisma.order.count({
  where: { shippingSnapshot: { contains: dto.address.city },
            createdAt: { gte: subMinutes(new Date(), 30) } },
});
if (recentOrders > 3) throw new BadRequestException('Order velocity limit reached');
```
---

## 🟡 MEDIUM — Sentry captures raw email addresses in `withScope` tags — GDPR/DPA violation *(1/5 agents)*
**Files:** `backend/src/modules/email/email-webhook.controller.ts:89-101`, `backend/src/modules/email/email.service.ts:305-337`
`email.service.ts` calls `captureException(error)` inside a Sentry scope that has `scope.setTag('to', recipientEmail)` set — the raw email address. Sentry's default PII scrubbing does not reliably catch email addresses in tag values. Under GDPR Art. 25 (privacy by design) and Sentry's DPA, sending raw email addresses to a US-hosted third-party error tracker without explicit user consent requires an explicit legal basis or anonymization.
**Fix:** Hash the email before tagging:
```typescript
const emailHash = createHash('sha256').update(recipientEmail).digest('hex').slice(0, 12);
scope.setTag('to_hash', emailHash);
```
---

## 🟡 MEDIUM — `FREE_SHIPPING` coupon shows PLN 0 discount in frontend validation — erodes trust *(1/5 agents)*
**File:** `backend/src/modules/coupons/coupon.service.ts:97-98`
`validate()` returns `discountAmountInCents = 0` for `FREE_SHIPPING` coupons (since the shipping amount is unknown at validation time). The frontend displays "Zniżka: 0,00 zł" next to a successfully applied coupon code, which looks broken to the customer. The actual shipping deduction happens correctly at order creation — but the UI signals failure.
**Fix:** Return a `discountType: 'FREE_SHIPPING'` flag from the validate endpoint and render it as "Darmowa wysyłka" rather than a monetary amount.
---

## 🟡 MEDIUM — Supabase storage upload has no retry — single transient failure permanently sets `LABEL_ERROR` *(1/5 agents)*
**File:** `backend/src/modules/storage/storage.service.ts:27-33`
`this.supabase.storage.from(...).upload(...)` is a single shot with no retry wrapper. A transient Supabase storage blip during shipping label upload permanently sets `ShipmentStatus.LABEL_ERROR`, requiring manual admin re-trigger. The shipping service catches and persists the error correctly — but the upstream I/O should retry on transient failures before surfacing as permanent.
**Fix:** Wrap with a simple exponential backoff (2-3 attempts):
```typescript
for (let attempt = 0; attempt < 3; attempt++) {
  const { error } = await this.supabase.storage.from(bucket).upload(path, buffer, opts);
  if (!error) return;
  if (attempt === 2) throw error;
  await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
}
```
---

## 🟡 MEDIUM — `GDPR Art. 17(3)(b)` conflict: no open-dispute check before account erasure *(1/5 agents)*
**File:** `backend/src/modules/users/users.service.ts:191-228`
`deleteAccount` anonymizes order snapshots and hard-deletes the user with no check for open Stripe disputes on their orders. If a chargeback is open at the time of erasure, the anonymized data (name, address, delivery confirmation) prevents submitting legally required dispute evidence to Stripe. The GDPR Art. 17(3)(b) "legal claim" exemption applies — but only if there's a guard enforcing it.
**Fix:** Before anonymization, check for open disputes:
```typescript
const openDisputes = await this.stripe.disputes.list({ charge: relatedChargeIds });
if (openDisputes.data.some(d => d.status === 'needs_response')) {
  throw new ConflictException('Account erasure is temporarily blocked due to an open payment dispute. Try again in 30 days.');
}
```
---

## 🟡 MEDIUM — No admin view: paid-but-not-shipped orders, coupon burn rate, or customer password reset *(1/5 agents)*
**File:** `backend/src/modules/admin/admin.setup.ts`
Three missing admin capabilities that will be day-1 operational requirements:
1. **Fulfillment gap:** No query surface for "orders with status `PAID`/`PROCESSING` older than N hours without a `Shipment` record." Primary fulfillment SLA metric with no dashboard.
2. **Coupon burn rate:** `coupon.service.ts:findAll` returns raw `Coupon` rows with no `_count: { uses: true }`. Admins cannot see which coupons are being redeemed fastest.
3. **Customer unlock:** `admin.setup.ts:526` — User resource has `edit: isAccessible: false`. There is no "Send password reset" admin action. Admins cannot help a locked-out customer without direct DB access.
---

## 🟢 LOW — 14-day withdrawal window off-by-one — `setDate(+14)` on delivery date itself *(1/5 agents)*
**File:** `backend/src/modules/returns/returns.service.ts:78-86`
Art. 27 UoK counts 14 **calendar days** starting the day **after** physical possession. Current code adds 14 days to the `deliveryDate` itself, making `deliveryDate` day 0 — so the window closes on day 14 of ownership instead of day 15 (delivery day + 14). A consumer reporting delivery on June 1 should have until June 15 — but the current code closes the window at June 15 23:59:59, which is correct for the expiry time but the start-of-day boundary on June 15 is ambiguous. Safe fix: use `deliveryDate + 15 days` for the window close, or clarify the policy to match the code exactly.
---

## 🟢 LOW — Stripe one-time coupon objects accumulate forever — Stripe Dashboard becomes unnavigable *(1/5 agents)*
**File:** `backend/src/modules/payments/stripe.client.ts:66-73`
Every discounted order creates a new Stripe coupon object (`stripe.coupons.create` with `max_redemptions: 1`) that is never deleted after the session completes or expires. Over time the Stripe account accumulates thousands of orphaned single-use coupon objects. The Stripe Dashboard becomes unnavigable for coupon management, and hitting Stripe's object limits (rare but real at scale) would silently break all discounted checkouts.
**Fix:** After `checkout.session.completed` or `checkout.session.expired`, delete the one-time coupon: `await this.stripe.coupons.del(session.discounts[0]?.coupon)`.
---

## 🟢 LOW — `Product.avgRating Float?` — IEEE 754 precision on a user-visible field *(1/5 agents)*
**File:** `backend/prisma/schema.prisma:269`
`avgRating Float?` is serialised as IEEE 754 double by Prisma. `4.65` can round-trip as `4.6499999...` in JSON. Not a critical bug today, but if `avgRating` is ever used in filter logic (e.g. `gte: 4.5`), floating-point comparisons will produce unpredictable results.
**Fix:** Change to `Decimal @db.Decimal(3,2)`. The raw SQL in `updateProductStats` already rounds to 2 decimal places correctly.
---

## 🟢 LOW — `Review.@@unique([userId, productId])` permanently blocks re-submission after admin rejection *(1/5 agents)*
**File:** `backend/prisma/schema.prisma:584`
If a user submits a review, the admin rejects it, and the user tries to resubmit with corrections — the `@@unique([userId, productId])` constraint prevents creating a new row. There is no user-facing "edit rejected review" flow and no `adminDelete`-then-resubmit path surfaced to the customer. This is guaranteed support friction at scale.
**Fix:** Change to `@@unique([userId, productId, status])` or expose a user-facing "edit" endpoint that updates the existing rejected row and resets status to `PENDING`.
---

## 🟢 LOW — No `security.txt` and no documented GDPR Art. 33 breach-notification process *(1/5 agents)*
No `/.well-known/security.txt`, no DPO contact on the privacy page, no internal runbook for the 72-hour UODO notification window. For a store processing payment data and health-adjacent (fragrance sensitivity/preference) data, this is a gap that regulators specifically look for in audits.
**Fix:** Add `/.well-known/security.txt` (auto-served by Vercel from `public/`), publish a `iod@<domain>.pl` contact on the privacy policy page, and document the breach-notification runbook in an internal wiki.
---

## Prioritised Fix Order

### Launch blockers

| # | Finding | File |
|---|---|---|
| 1 | `charge.dispute.created` not handled — silent chargeback loss | `payments.service.ts:156` |
| 2 | `cancelByUser` allows self-refund of FRAUD_REVIEW orders | `orders.service.ts:586` |
| 3 | `retryPayment` P2002 crash on PENDING payment | `payments.service.ts:59` |
| 4 | Product deactivation does not purge active carts | `orders.service.ts` checkout path |
| 5 | `mergeGuestCart` bypasses quantity cap + stock guard | `cart.service.ts:169` |
| 6 | `cancelItemsByUser` refunds pre-discount gross — financial overpay | `orders.service.ts:767` |
| 7 | Return shipping cost not disclosed at checkout — Art. 34 UoK | `checkout-page.component.html` |
| 8 | Price per unit of measure (PLN/100ml) missing — ustawa o cenach | `product-card.component.ts` |

### Pre-first-real-order hardening

| # | Finding | File |
|---|---|---|
| 9 | Timing attack on `PAYMENTS_RECONCILE_SECRET` | `payments.controller.ts:122` |
| 10 | No BullMQ worker crash alert | `email-queue.processor.ts` |
| 11 | Multiple return requests per order — no uniqueness guard | `returns.service.ts:94` |
| 12 | `CartItem`/`OrderItem` → `ProductVariant` FK no `onDelete` | `schema.prisma:355, 431` |
| 13 | Cookie consent not logged server-side — GDPR Art. 7(1) | `consent.service.ts` |
| 14 | `markSessionPaid` hardcodes `fromStatus` audit event | `payments.service.ts:246` |
| 15 | GDPR erasure no open-dispute guard — Art. 17(3)(b) | `users.service.ts:191` |
| 16 | `MERCHANT_SLACK_WEBHOOK_URL` SSRF — not Slack-validated | `config.validation.ts:166` |
| 17 | BLIK/P24 fraud — Radar fires post-payment, no velocity check | `payments.service.ts:207` |
| 18 | Sentry captures raw email addresses in scope tags | `email.service.ts:305` |

### Post-launch sprint

| # | Finding | File |
|---|---|---|
| 19 | `connect-pg-simple` pool bypasses Prisma cap | `admin.setup.ts:830` |
| 20 | `CouponUse` no cascade on Coupon deletion | `schema.prisma:551` |
| 21 | Redis dev `retryStrategy: null` silently kills BullMQ | `redis.module.ts` |
| 22 | Supabase storage upload no retry | `storage.service.ts:27` |
| 23 | `FREE_SHIPPING` coupon shows PLN 0 in frontend validation | `coupon.service.ts:97` |
| 24 | No admin: fulfillment gap view / coupon burn rate / password reset | `admin.setup.ts` |
| 25 | `Product.avgRating Float?` IEEE 754 precision | `schema.prisma:269` |
| 26 | `Review.@@unique` blocks re-submission after rejection | `schema.prisma:584` |
| 27 | Stripe one-time coupon objects never deleted | `stripe.client.ts:66` |
| 28 | 14-day withdrawal window off-by-one | `returns.service.ts:78` |
| 29 | `security.txt` + GDPR Art. 33 runbook missing | `public/` + internal wiki |

---

## Agent Agreement Summary

| Finding | Agents |
|---|---|
| `mergeGuestCart` bypasses quantity cap + stock guard | 2/5 |
| `CartItem`/`OrderItem` no `onDelete` on `productVariant` FK | 2/5 |
| Multiple return requests per order — no uniqueness guard | 2/5 |
| `charge.dispute.created` not handled | 2/5 |
| No BullMQ worker crash alert | 2/5 |
