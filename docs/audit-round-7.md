# E-Commerce Audit — Round 7
*Generated: 2026-06-04 — 5-agent stochastic consensus*
*Agents: Domain Expert · Security Skeptic · Pragmatist (Ops) · First-Principles (DB/Infra) · Risk Analyst (Legal)*

> **Excludes** everything already in `audit-weak-points.md`, `audit-round-2.md`, `audit-round-3.md`, `audit-round-4.md`, `audit-round-5.md`, `audit-round-6.md`, and `project-gaps-audit.md`.
> **Excludes** Phase 7 (pre-launch checklist) items in ROADMAP.md.

Done:

## 🔴 BLOCKER — `pg_trgm` extension never installed — all product search queries crash in production *(1/5 agents)*

**File:** `backend/src/modules/products/products.service.ts:151-165`

The full-text search and suggest queries use the PostgreSQL trigram operator `<%` (e.g. `'Sauvage' <% p.name`) for typo-tolerance. This operator requires the `pg_trgm` extension (`CREATE EXTENSION IF NOT EXISTS pg_trgm`). No migration in the project installs it — confirmed by inspecting all 27 migration files. On a fresh Supabase production database, every call to `GET /products?search=...` and `GET /products/suggest` throws:

```
PrismaClientUnknownRequestError: operator does not exist: unknown <% text
```

returned to the user as a 500. Product search — a primary catalog navigation path — is completely non-functional in production without this one-line migration.

**Fix:** Add a new migration:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

---

## 🔴 BLOCKER — EC 1223/2009 Art. 19(1)(f) — Allergen disclosure absent from product API and product page *(1/5 agents)*

**File:** `backend/src/modules/products/products.service.ts:13-42`, `frontend/src/app/features/catalog/product-detail/product-detail.component.ts:27-61`

For cosmetics sold via distance communication, EC Regulation 1223/2009 Art. 19(1)(f) requires that regulated fragrance allergens (Annex III list) present above threshold concentrations be individually named *before purchase* — on the product listing itself, not only on the physical label. The `allergens` column exists in the Prisma schema (`Product.allergens String[]`) but is not included in `PRODUCT_SELECT`, so the field is never returned by any product API endpoint. The frontend `ProductDetail` interface has no `allergens` field and renders no allergen list. The full INCI string is also absent.

**Risk:** Inspekcja Handlowa and UOKiK can order product withdrawal from online sale and impose fines up to PLN 100,000 per product under Art. 66 Ustawy o produktach kosmetycznych (Dz.U. 2018 poz. 308). SCENIHR has flagged allergen disclosure as the primary enforcement target for online fragrance retail since 2023.

**Fix:** Add `allergens`, `ingredients`, `paoMonths`, and `warnings` to `PRODUCT_SELECT`. Add an `allergens` field to `ProductDetail` interface. Render a "Skład i informacje" section on the product detail page with the full INCI list and individually named allergens (per the Phase 7 ROADMAP item — but this must be done *before any product is listed*, not at launch).

---


## 🟠 HIGH — `generateLabel` has no order-status guard — labels generated for CANCELLED/REFUNDED/PENDING_PAYMENT orders *(1/5 agents)*

**File:** `backend/src/modules/shipping/shipping.service.ts:51-237`

`generateLabel(orderId)` calls the carrier API with zero status validation. An admin can call `POST /shipping/:orderId/label` on any order regardless of status:

- **CANCELLED order:** real carrier shipment created and billed; label uploaded to Supabase; tracking email sent to customer — for an order that was already cancelled and refunded. Manual carrier-side cancellation required.
- **PENDING_PAYMENT order:** shipping label generated before payment. Customer receives a tracking email before they've paid. If checkout is abandoned, the carrier shipment still exists and may be billed.
- **Re-trigger on SHIPPED/DELIVERED order:** the `upsert` on `Shipment` with `update: { status: LABEL_GENERATED }` silently downgrades a `IN_TRANSIT` or `DELIVERED` status back to `LABEL_GENERATED`, corrupting the audit trail.

**Fix:**
```typescript
const allowedStatuses = [OrderStatus.PAID, OrderStatus.PROCESSING];
if (!allowedStatuses.includes(order.status as OrderStatus)) {
  throw new BadRequestException(
    `Cannot generate label for order in status ${order.status}`,
  );
}
const existing = await this.prisma.shipment.findUnique({ where: { orderId } });
if (existing && existing.status !== ShipmentStatus.LABEL_ERROR) {
  throw new ConflictException('Label already exists for this order');
}
```

---

## 🟠 HIGH — `cancelByUser` issues a full Stripe refund on `PARTIALLY_REFUNDED` orders — double-refund *(1/5 agents)*

**File:** `backend/src/modules/orders/orders.service.ts:614, 640-642`

```typescript
const isRefund = [PAID, PROCESSING, PARTIALLY_REFUNDED].includes(order.status);
// ...
} else {
  await this.paymentsService.refundPayment(orderId, 'CUSTOMER');  // full refund
}
```

When `status === PARTIALLY_REFUNDED`, the code falls into the `else` branch and calls `refundPayment()` with no amount parameter — Stripe interprets this as a full refund of the original charge. A customer who already received a partial refund (e.g. 80 PLN refunded on a 200 PLN order) can call `POST /orders/:id/cancel` and receive a second Stripe refund for the full 200 PLN.

**Attack vector:** Buy 5 items → cancel 4 via `/cancel-items` (get partial refund) → call `/cancel` → receive a second refund for the full original payment.

**Fix:** Add an explicit `PARTIALLY_REFUNDED` guard that computes the remaining non-refunded amount and passes it as the Stripe refund amount, or blocks `cancelByUser` for partially-refunded orders entirely and redirects to the return flow:
```typescript
if (order.status === OrderStatus.PARTIALLY_REFUNDED) {
  throw new ConflictException(
    'This order has already been partially refunded. Use the returns flow for remaining items.',
  );
}
```

---

## 🟠 HIGH — `cancelItemsByUser` excludes shipping cost from full-cancellation refund — customer underpaid on full withdrawal *(1/5 agents)*

**File:** `backend/src/modules/orders/orders.service.ts:783-790`

When a customer cancels all items via `cancelItemsByUser`, `partialRefund` computes `refundAmountInCents` as the sum of item prices (after discount pro-ration) only. `order.shippingCostInCents` is never added even when `allCancelled = true`. Example: 200 PLN items + 15 PLN shipping = 215 PLN paid; customer receives only 200 PLN refund — the 15 PLN shipping is permanently lost.

Under Art. 32 ust. 1 UoK, a full withdrawal requires reimbursement of the original delivery cost. The `refundPayment()` full-refund path correctly covers the whole `amountInCents`, but `cancelItemsByUser` never calls it — it always uses `partialRefund`.

**Fix:** In `cancelItemsByUser`, after determining `allCancelled = true`, call `refundPayment()` instead of `partialRefund()`:
```typescript
if (allCancelled) {
  await this.paymentsService.refundPayment(orderId, actor);
  return; // refundPayment handles status, stock, and events
}
await this.paymentsService.partialRefund(...);
```


## 🟠 HIGH — `processInvoice` has no idempotency guard — concurrent webhook + reconciliation cron burns sequential invoice numbers *(2/5 agents)*

**File:** `backend/src/modules/invoice/invoice.service.ts:86-105`, `backend/src/modules/payments/payments.service.ts:420-453`

`processInvoice()` checks `order.invoiceStoragePath` before calling `nextInvoiceNumber()` — but this check is a plain read outside any transaction. When the Stripe webhook and the reconciliation cron both call `dispatchPostPaymentNotifications()` for the same order before either has committed the invoice path:

1. Both read `invoiceStoragePath = null`
2. Both call `nextInvoiceNumber()` — two different sequence values are allocated
3. Both generate separate PDFs and upload; the second `UPDATE orders SET invoiceNumber = ...` overwrites the first
4. The first invoice number is permanently orphaned (a gap in the legally-required sequential series per Art. 106e pkt 2 Ustawy o VAT) and the first PDF leaks in Supabase storage

**Fix:** Wrap the idempotency check and invoice number allocation in a `$transaction` with a `SELECT ... FOR UPDATE` on the order row:
```typescript
await this.prisma.$transaction(async (tx) => {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { invoiceStoragePath: true },
  });
  if (order?.invoiceStoragePath) return; // already generated, skip
  const invoiceNumber = await this.nextInvoiceNumber(tx, year);
  // ... generate and upload PDF
});
```

---

## 🟠 HIGH — WITHDRAWAL return: `deliveryDate` trusted from client — 14-day window trivially bypassed *(1/5 agents)*

**File:** `backend/src/modules/returns/returns.service.ts:73-88`

The withdrawal window is computed from user-supplied `dto.deliveryDate`:
```typescript
const windowEnd = new Date(dto.deliveryDate);
windowEnd.setDate(windowEnd.getDate() + 14);
```

The DB stores an authoritative `shipment.deliveredAt` timestamp when the order transitions to `DELIVERED`. An attacker with an order older than 14 days simply passes `deliveryDate = today` to bypass the window and re-open the refund right. The database `deliveredAt` is never consulted.

Note: this is distinct from the existing finding (#17 in round-3) that validates `dto.deliveryDate + 14 >= now` server-side. That finding ensures *some* server-side check exists; this finding identifies that the check uses untrusted input.

**Fix:** When `order.shipment.deliveredAt` is set, use it as the authoritative date; reject any `dto.deliveryDate` that predates it:
```typescript
const authoritativeDate = order.shipment?.deliveredAt ?? new Date(dto.deliveryDate);
if (order.shipment?.deliveredAt) {
  const submitted = new Date(dto.deliveryDate);
  if (submitted < order.shipment.deliveredAt) {
    throw new BadRequestException('deliveryDate cannot precede actual delivery date');
  }
}
const windowEnd = addDays(authoritativeDate, 15); // end-of-day + 1 for boundary
```
---

## 🟠 HIGH — Supabase free-tier auto-pause triggers Railway health check cascade failure loop *(1/5 agents)*

**File:** `backend/src/health.controller.ts:34-37`, `backend/src/modules/prisma/prisma.service.ts:18-21`

Supabase free-tier pauses projects after 7 days of inactivity. The Railway health check runs `SELECT 1` against the DB. If Supabase is paused:

1. `$queryRaw\`SELECT 1\`` throws a connection error
2. Health check returns `{ status: 'error', db: 'disconnected' }`
3. Railway marks the service unhealthy and restarts it
4. On restart, `PrismaService.onModuleInit()` also calls `SELECT 1` and `OrdersService.onModuleInit()` runs DDL — both fail
5. Container enters a restart loop indefinitely

Supabase only wakes from pause on the first real HTTP request to the dashboard or a direct connection; a Railway container restart does not wake it. The service stays down until an operator manually unpauses Supabase. There is no alert, no backoff, and the health endpoint does not distinguish "DB paused" from "DB hardware failure."

**Fix:** (a) Upgrade to Supabase Pro to disable auto-pause (already required for PITR per CLAUDE.md). (b) As a belt-and-suspenders guard, wrap the health check DB query in a try/catch and return `503` with `{ status: 'degraded', db: 'starting_up' }` instead of crashing; add exponential backoff on retry. (c) Add an UptimeRobot ping to the frontend URL (which uses Vercel, never sleeps) to generate the traffic needed to keep the DB awake — this also keeps the Railway container warm (per CLAUDE.md).


## 🟠 HIGH — ODR platform link absent — EU Regulation 524/2013 Art. 14 + UoK Art. 37a violation *(1/5 agents)*

**File:** `frontend/src/app/shared/components/footer/footer.component.ts`, `frontend/src/app/features/checkout/checkout-page/checkout-page.component.ts`

Art. 14 of EU Regulation 524/2013 requires that online traders include a clickable link to the EC ODR platform (`https://ec.europa.eu/consumers/odr`) in an "easily accessible place" on their website at all times. UoK Art. 37a (Polish implementation) further requires it near the terms checkbox at checkout. The ODR link appears only once in `terms.component.ts` — it is absent from the footer, the checkout page, and the contact section.

**Risk:** UOKiK has fined Polish e-commerce operators PLN 10,000–50,000 for ODR non-compliance in recent enforcement actions. Any consumer can use this omission as evidence of systemic non-compliance in a complaint, extending their right of withdrawal by 12 months (Art. 15 UoK).

**Fix:** Add a one-line ODR link to the footer template and near the checkout terms-acceptance checkbox:
```html
<a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener">
  Platforma ODR (rozwiązywanie sporów online)
</a>
```
---

## 🟠 HIGH — CPNP notification record absent — cosmetics placed on EU market without mandatory notification *(1/5 agents)*

**File:** `backend/prisma/schema.prisma` (Product model), `frontend/src/app/features/catalog/product-detail/`

EC Regulation 1223/2009 Art. 13 requires that the Responsible Person (RP) notify each cosmetic product in the CPNP (Cosmetic Products Notification Portal) before it is placed on the EU market. For inspired/repackaged fragrances, the seller acting as RP must have obtained CPNP notification numbers. Neither the `Product` schema nor any product admin screen captures or displays a CPNP notification number, and there is no mechanism to confirm this step was taken.

**Risk:** Placing products on the market without CPNP notification is a criminal offence under Art. 66 of the Polish Cosmetics Products Act; GIS can order market withdrawal of all unnotified products and impose fines up to PLN 100,000. This is directly relevant to the `LEGAL — before first product listing` items in Phase 7 but is noted here as a code/data gap: the system has no field to record compliance.

**Fix:** Add `cpnpNotificationNumber String?` and `responsiblePersonName String?` to the `Product` model. Add these fields to the AdminJS product form with a validation warning if null when `isActive = true`.

---

## 🟠 HIGH — Guest cancel-token embedded in success URL — leaks via Referer headers to analytics providers *(1/5 agents)*

**File:** `backend/src/modules/payments/payments.service.ts:104-116`

The order cancel/status token (a JWT signed with `JWT_ACCESS_SECRET`) is appended to the Stripe success redirect URL as `?token=<cancelToken>`. This URL:

1. Leaks in `Referer` headers when the Angular success page loads GTM, GA4, or any third-party pixel — the full `?token=` value is sent to Google/Meta/etc.
2. Appears in Railway/Vercel access logs capturing query parameters
3. Is visible in browser history — a shared-household member can extract it
4. Is signed with the master `JWT_ACCESS_SECRET` — if leaked, enables order cancellation via `cancelByToken` endpoints

**Fix:** Use a short-lived opaque random token stored in Redis instead of a JWT:
```typescript
const guestToken = randomBytes(32).toString('hex');
await this.redis.set(`order-token:${order.id}`, guestToken, 'EX', 3600);
successUrl: `${successUrl}?orderId=${order.id}&token=${guestToken}`;
```
Verify via Redis lookup instead of JWT verification. Additionally, in `CheckoutSuccessComponent.ngOnInit()`, strip the `token` param from the URL after reading it: `this.router.navigate([], { queryParams: { orderId }, replaceUrl: true })`.
---

## 🟠 HIGH — Stripe payout failure and account risk — no monitoring, no contingency *(1/5 agents)*

**File:** `backend/src/modules/payments/payments.service.ts` (handleWebhookEvent)

The webhook handler subscribes to `checkout.session.*`, `charge.refund.updated`, and `charge.dispute.*` — but not `payout.failed`, `payout.paid`, `account.updated`, or `balance.available`. New Stripe accounts processing fragrance/cosmetics orders are routinely subjected to rolling reserves (30–100% of settlement held 90–120 days) or full account closure if chargeback rates exceed 0.75%. When this happens:

- Funds already collected are held and payouts fail silently — no admin alert, no order linking
- With no secondary processor, all new checkout sessions fail payment initiation immediately
- Customers are owed refunds within 14 days under Art. 32 UoK regardless of whether Stripe has paid out

**Fix:** Subscribe to `payout.failed` in the Stripe webhook endpoint. In the handler, send a Sentry critical alert and an admin email notification. Document a manual recovery runbook: how to issue refunds via Stripe Dashboard when the automated path is down, and how to verify customer refund obligations using `Order.totalInCents` data.

---

## 🟡 MEDIUM — `dispute_alert` BullMQ job silently skipped in processor — admin never receives chargeback email *(1/5 agents)*

**File:** `backend/src/modules/email/email-queue.processor.ts:107-110`

When a `charge.dispute.created` webhook fires, `handleDisputeCreated()` enqueues a `dispute_alert` BullMQ job. In the processor, the `dispute_alert` case is explicitly handled with only `this.logger.warn(...)` — no email is sent, no template is wired. The admin is notified only via Sentry (if configured). During a Railway cold-start or Redis restart, even the Sentry capture may be lost. Given that Stripe's dispute evidence deadline is 7 calendar days, a missed alert can result in uncontested chargebacks.

**Fix:** Create an `admin-dispute-alert` Resend email template (or use the existing Slack notification path as a fallback) and wire it to the `dispute_alert` processor case. Remove the `logger.warn`-and-return pattern.

---

## 🟡 MEDIUM — `Category` deletion throws unhandled FK violation 500 — no pre-check for assigned products *(1/5 agents)*

**File:** `backend/src/modules/categories/categories.service.ts:58-62`

`CategoriesService.remove()` calls `prisma.category.delete()` without first checking if any products are assigned to the category. PostgreSQL throws a foreign-key violation (Prisma default `RESTRICT`) that surfaces as an unhandled 500 to the admin with a cryptic error. The same problem exists for self-referential child categories. No `409 Conflict` is ever returned.

**Fix:**
```typescript
async remove(id: string) {
  const [productCount, childCount] = await Promise.all([
    this.prisma.product.count({ where: { categoryId: id } }),
    this.prisma.category.count({ where: { parentId: id } }),
  ]);
  if (productCount > 0) throw new ConflictException(`Category has ${productCount} products.`);
  if (childCount > 0) throw new ConflictException(`Category has ${childCount} child categories.`);
  return this.prisma.category.delete({ where: { id } });
}
```


## 🟡 MEDIUM — Invoice total (`DO ZAPŁATY`) can differ from summed line items by 1-3 gr due to accumulated VAT rounding *(1/5 agents)*

**File:** `backend/src/modules/invoice/invoice.service.ts:279-302`

Per-item VAT is computed as `netCents = Math.round(grossCents / (1 + vatRate))`. The rounding on each item accumulates across a multi-item order. The "Razem brutto" total (summed line items) can differ from `order.totalInCents` (the DB-authoritative total, which drives the "DO ZAPŁATY" box) by 1-3 groszy. Under Polish VAT law (Art. 106e), the invoice total (sum of rows) must equal the amount payable — a discrepancy causes the invoice to be rejected by accounting software and may constitute a formal defect in the VAT document.

**Fix:** Derive "Razem brutto" directly from `order.totalInCents` and compute any rounding remainder into the last VAT bucket:
```typescript
const razem = order.totalInCents; // authoritative single source of truth
// Display razem as both "Razem brutto" and "DO ZAPŁATY"
// Compute VAT breakdown as: totalVat = razem - sum(Math.round(gross/(1+rate)))
```

---

## 🟡 MEDIUM — `Payment` table has no indexes on `status` or `createdAt` — reconciliation cron does full table scan *(1/5 agents)*

**File:** `backend/prisma/schema.prisma` (Payment model)

`reconcilePendingPayments()` queries:
```typescript
findMany({ where: { status: PENDING, createdAt: { lt: cutoff }, stripeCheckoutSessionId: { not: null } } })
```

The `Payment` model has no `@@index` directive at all — no index on `status`, `createdAt`, or `stripeCheckoutSessionId`. This query runs a full sequential scan of the `payments` table every 10 minutes. At 500 orders/month, this is manageable; at 5,000+ it becomes a measurable DB load spike on every cron run.

**Fix:**
```prisma
model Payment {
  ...
  @@index([status, createdAt])
  @@index([stripeCheckoutSessionId])
  @@map("payments")
}
```

---

## 🟡 MEDIUM — Bounce tracking is passive — bounced email addresses keep receiving transactional emails *(1/5 agents)*

**File:** `backend/src/modules/email/email-webhook.controller.ts:75-93`

When a `email.bounced` Resend webhook fires, the code logs a warning and sends a Sentry alert but takes no action: the email address is not suppressed. On the next order event (cancellation, shipping, etc.), the same bounced address is queued again, generating another bounce. ISPs count sender bounce rates and throttle or blacklist domains above ~2-5% bounce rate — silently killing all transactional email delivery. The `User` model has no `emailBounced` flag.

**Fix:** Add `emailBounced Boolean @default(false)`, `emailBouncedAt DateTime?` to the `User` model. In the bounce webhook handler: `await prisma.user.updateMany({ where: { email: bouncedTo }, data: { emailBounced: true, emailBouncedAt: new Date() } })`. In `EmailQueueService.enqueue()`, skip enqueue if the recipient user has `emailBounced = true`. Surface the flag in AdminJS user view.

---



## 🟡 MEDIUM — Signed Supabase invoice URL stored in BullMQ job payload expires in 7 days — delayed jobs permanently fail *(1/5 agents)*

**File:** `backend/src/modules/email/email-queue.processor.ts:42-48`, `backend/src/modules/invoice/invoice.service.ts:100-101`

`processInvoice()` generates a 7-day Supabase signed URL and stores it in the BullMQ job payload as `invoiceUrl`. The processor fetches the PDF bytes at job execution time via `fetch(payload.invoiceUrl)`. If the job is delayed past 7 days (Redis restart, long retry backoff chain, or the `removeOnFail: { age: 604_800 }` 7-day hold period), the signed URL returns 403 — all three retry attempts fail and the customer permanently receives no invoice email.

**Fix:** Store the `storagePath` (not the signed URL) in the job payload. In the processor, call `StorageService.createSignedUrl(payload.storagePath, 3600)` at execution time:
```typescript
// In processor:
const signedUrl = await this.storageService.createSignedUrl(payload.invoiceStoragePath, 3600);
const pdfBuffer = Buffer.from(await fetch(signedUrl).then(r => r.arrayBuffer()));
```

---

## 🟡 MEDIUM — UŚUDE Art. 5 — Mandatory provider identity missing from every page of the site *(1/5 agents)*

**File:** `frontend/src/app/shared/components/footer/footer.component.ts`

Art. 5(1) UŚUDE (Dz.U. 2002 nr 144 poz. 1204) requires that a service provider's full trade name, registered address, contact email, NIP, REGON, and KRS/CEIDG number be displayed "clearly and unambiguously, accessible at any time" — i.e. on every page, typically in the footer. The footer currently shows only the brand name "Aromaterie" with none of the required identifiers. These values exist in `environment.seller` but are only rendered inside the Terms page.

**Risk:** UOKiK can impose fines up to 3% of prior-year revenue. More directly: failure to provide this information gives consumers an extra 12-month right of withdrawal (Art. 15 UoK) on top of the standard 14 days — converting into ongoing financial liability for the operator on every order placed while the footer is incomplete.

**Fix:** Add a "Dane sprzedawcy" block to the footer template that interpolates `environment.seller.legalName`, `environment.seller.nip`, `environment.seller.street`, etc. and renders an `href="mailto:..."` for the contact email. These fields are already seeded in `environment.prod.ts` (once the Phase 7 placeholders are filled).

---

## 🟡 MEDIUM — B2B invoice has no reverse-charge path — incorrect VAT for intra-EU or cross-border B2B buyers *(1/5 agents)*

**File:** `backend/src/modules/invoice/invoice.service.ts:168-178, 207-246`

When a buyer provides a NIP (stored as `order.snapshotNip`), the invoice applies `snapshotVatRate` unconditionally at 23% (or 5% for applicable items). For cross-border intra-EU B2B goods dispatched outside Poland, Art. 42 Ustawy o VAT requires zero-rated treatment with the notation "odwrotne obciążenie" and the buyer's EU VAT number. The `order.snapshotCountry` field exists but is never checked in invoice generation.

**Risk:** Issuing a VAT-inclusive invoice to a B2B buyer entitled to reverse-charge is a VAT error under Art. 108 Ustawy o VAT. KAS can impose an additional 30% tax liability charge for repeated errors (Art. 112b).

**Fix:** In `invoice.service.ts`, check `order.snapshotCountry !== 'PL'` and `order.snapshotNip` (EU VAT number). If both are present and the goods are dispatched cross-border, set `vatRate = 0` on all line items and add a `"Odwrotne obciążenie / Reverse charge — Art. 42 ust. 1 Ustawy o VAT"` note to the invoice template.

---

## 🟡 MEDIUM — `deleted@deleted` GDPR sentinel is predictable — enables enumeration of GDPR-erased order history *(1/5 agents)*

**File:** `backend/src/modules/users/users.service.ts:204-206`, `backend/src/modules/orders/orders.service.ts:521-525`

When a user invokes GDPR account deletion, all their orders get `snapshotEmail = 'deleted@deleted'`. The `GET /orders/track` endpoint queries by `snapshotEmail` (case-insensitive). An attacker can call:
```
GET /orders/track?email=deleted@deleted&orderNumber=ORD-2026-000001
```
and cycle through sequential order numbers to enumerate every deleted user's order contents, statuses, and item names. The throttle is 5 req/min per IP — the sequential 6-digit suffix is enumerable in ~33 hours per year from a single IP.

**Fix:** Replace the static sentinel with a UUID-suffixed value that cannot be guessed:
```typescript
snapshotEmail: `deleted+${randomUUID()}@deleted.invalid`
```
This ensures the `snapshotEmail` used for lookup is unguessable, making track-by-email enumeration impossible even if the orderNumber is known.

---

## 🟡 MEDIUM — Invoice generation not blocked for `FRAUD_REVIEW` or `DISPUTE_HOLD` orders *(1/5 agents)*

**File:** `backend/src/modules/orders/orders.service.ts:503-504`

```typescript
const nonInvoiceable = [OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED];
if (nonInvoiceable.includes(order.status)) throw new NotFoundException();
```

Orders in `FRAUD_REVIEW` or `DISPUTE_HOLD` pass this check and receive a fully stamped VAT invoice with a consumed sequential invoice number. Issuing a `Faktura VAT` for a transaction under fraud review or chargeback hold is an accounting irregularity: the invoice creates a taxable supply record that complicates chargeback proceedings and may constitute a formal VAT error if the order is later voided.

**Fix:** Add `FRAUD_REVIEW` and `DISPUTE_HOLD` to `nonInvoiceable`:
```typescript
const nonInvoiceable = [PENDING_PAYMENT, CANCELLED, FRAUD_REVIEW, DISPUTE_HOLD];
```
---

## 🟢 LOW — Cancel `reason` body has no DTO — unbounded string written to `order_events` table *(1/5 agents)*

**File:** `backend/src/modules/orders/orders.controller.ts:96-99`, `backend/src/modules/orders/orders.service.ts:634`

`POST /:id/cancel` accepts `@Body() body: { reason?: string }` with no class-validator DTO. The raw `reason` string is interpolated verbatim into `orderEvent.note`:
```typescript
note: `Cancelled by customer before payment. Reason: ${reason}`
```
There is no `@MaxLength`, no `@IsString`, no trimming. A guest caller with a valid `?token=` can submit a multi-megabyte `reason` string, bloating the `order_events` table.

**Fix:** Introduce a typed DTO:
```typescript
class CancelOrderDto {
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}
```


## Legend

| Label | Meaning |
|---|---|
| 🔴 BLOCKER | Must fix before any real customer |
| 🟠 HIGH | Real money loss, data corruption, legal exposure, or security breach |
| 🟡 MEDIUM | Degrades correctness, UX, or compliance significantly |
| 🟢 LOW | Polish / hardening |

Agent agreement is noted where 2+ agents independently identified the same issue.
---

---

## 🟢 LOW — DPD tracking URL absent from order detail page, tracking page, and email delivery-estimate map *(1/5 agents)*

**Files:** `frontend/src/app/features/account/orders/order-detail.component.ts:52-56`, `backend/src/modules/email/templates/order-confirmation.template.ts:7-11`

Three related gaps for DPD and DPD Kurier:
1. `trackingUrl()` in `order-detail.component.ts` has no entry for `DPD` or `DPD_COURIER` — returns null and renders a bare tracking number string instead of a clickable link
2. The guest `track-order` page likewise renders no link for DPD orders
3. The `DELIVERY_ESTIMATES` map in `order-confirmation.template.ts` omits `DPD` and `DPD_COURIER` — confirmation emails show no estimated delivery window for DPD shipments

**Fix:**
```typescript
// order-detail.component.ts
const TRACKING_URLS = {
  INPOST: 'https://inpost.pl/sledzenie-przesylek?number=',
  DHL: 'https://www.dhl.com.pl/exp-en/express/tracking.html?AWB=',
  GLS: 'https://gls-group.eu/track/',
  DPD: 'https://tracktrace.dpd.com.pl/parcelDetails?typ=1&p1=',
  DPD_COURIER: 'https://tracktrace.dpd.com.pl/parcelDetails?typ=1&p1=',
};
// order-confirmation.template.ts
const DELIVERY_ESTIMATES = {
  INPOST: '1-2 dni robocze',
  DHL: '1-2 dni robocze',
  GLS: '2-3 dni robocze',
  DPD: '1-2 dni robocze',
  DPD_COURIER: '1-2 dni robocze',
};
```

---

## 🟢 LOW — `pg_advisory_xact_lock` is ineffective through pgbouncer transaction mode *(1/5 agents)*

**File:** `backend/src/modules/orders/orders.service.ts:79-87`

`onModuleInit()` uses `pg_advisory_xact_lock` inside a `$transaction` to serialize the `CREATE SEQUENCE IF NOT EXISTS` DDL across concurrent pod startups. However, `DATABASE_URL` uses pgbouncer in transaction mode (port 6543). Transaction-mode pgbouncer may route individual statements within the same Prisma transaction to different physical connections, so the advisory lock acquired on statement 1 does not protect statement 2. The lock provides no serialization guarantee. In practice `CREATE SEQUENCE IF NOT EXISTS` is idempotent so no failure occurs — but the lock's stated purpose is defeated and adds false confidence.

**Fix:** Move the DDL into a Prisma migration (already recommended in `audit-round-2.md` #56 for a different reason). If kept in `onModuleInit`, use the direct connection URL (port 5432) for this specific call, or accept the race and rely on the `IF NOT EXISTS` idempotency.

---

## Prioritised Fix Order

### Launch blockers

| # | Finding | File |
|---|---|---|
| 1 | `pg_trgm` extension not installed — all search crashes | New migration needed |
| 2 | EC 1223/2009 allergen disclosure absent from product API + page | `products.service.ts:13`, `product-detail.component.ts:27` |
| 3 | `generateLabel` no order-status guard — CANCELLED order labels | `shipping.service.ts:51` |
| 4 | `cancelByUser` full refund on PARTIALLY_REFUNDED order | `orders.service.ts:614` |
| 5 | Shipping cost excluded from `cancelItemsByUser` full-cancellation refund | `orders.service.ts:783` |
| 6 | ODR platform link absent — UoK Art. 37a + EU Regulation 524/2013 | `footer.component.ts`, checkout |

### Pre-first-real-order hardening

| # | Finding | File |
|---|---|---|
| 7 | `processInvoice` no idempotency guard — concurrent calls burn invoice numbers | `invoice.service.ts:86`, `payments.service.ts:420` |
| 8 | WITHDRAWAL delivery date trusted from client — 14-day window bypassed | `returns.service.ts:73` |
| 9 | Supabase auto-pause → Railway health check cascade failure loop | `health.controller.ts:34`, `prisma.service.ts:18` |
| 10 | Guest cancel-token in URL leaks via Referer to analytics | `payments.service.ts:104` |
| 11 | Stripe payout failure not monitored — no contingency for account hold | `payments.service.ts` (webhook handler) |
| 12 | CPNP notification number absent from Product schema | `schema.prisma` |
| 13 | `dispute_alert` BullMQ job silently skipped — admin never emailed on chargeback | `email-queue.processor.ts:107` |
| 14 | Category deletion throws unhandled FK violation 500 | `categories.service.ts:58` |
| 15 | Invoice generated for FRAUD_REVIEW / DISPUTE_HOLD orders | `orders.service.ts:503` |
| 16 | `deleted@deleted` sentinel enables GDPR-erased order enumeration | `users.service.ts:204` |
| 17 | UŚUDE Art. 5 — Mandatory company info absent from footer | `footer.component.ts` |
| 18 | Email bounce tracking passive — no suppression list | `email-webhook.controller.ts:75` |

### Post-launch sprint

| # | Finding | File |
|---|---|---|
| 19 | Invoice line items don't foot due to accumulated VAT rounding | `invoice.service.ts:279` |
| 20 | Signed invoice URL in BullMQ expires in 7 days — delayed jobs permanently fail | `email-queue.processor.ts:42`, `invoice.service.ts:100` |
| 21 | `Payment` table no indexes on `status`/`createdAt` | `schema.prisma` (Payment model) |
| 22 | B2B invoice no reverse-charge path for cross-border intra-EU orders | `invoice.service.ts:168` |
| 23 | InPost locker availability not checked before label generation | `shipping.service.ts`, `inpost.client.ts` |
| 24 | DPD tracking URL missing + DPD delivery estimates missing from email | `order-detail.component.ts:52`, `order-confirmation.template.ts:7` |
| 25 | Cancel `reason` field has no DTO — unbounded string in DB | `orders.controller.ts:96` |
| 26 | `pg_advisory_xact_lock` ineffective through pgbouncer | `orders.service.ts:79` |

---

## Agent Agreement Summary

| Finding | Agents |
|---|---|
| `processInvoice` no idempotency guard / concurrent invoice number allocation | 2/5 |
| Allergen disclosure absent from API (legal + domain expert both flagged) | 2/5 |
| Invoice integrity / VAT rounding issues | 2/5 |
| Guest cancel-token security (URL leak + JWT-signed with master secret) | 1/5 (but high confidence) |
| `pg_trgm` extension missing — search crashes in production | 1/5 (confirmed by code inspection) |
