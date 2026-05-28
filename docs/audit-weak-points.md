# E-Commerce Weak Point Audit
*Generated: 2026-05-28 — 5-agent stochastic consensus*

---
## Compliance & Legal (Polish market-specific)

### 13. VAT_RATE is a single hardcoded constant *(Domain Expert)*
Invoice engine uses `grossCents / 1.23` for every line item. If you ever stock 5% VAT goods or handle international shipping at 0% VAT, the invoice engine produces legally invalid invoices. Needs to be per-line-item before diversifying the catalog.

### 14. Seller NIP + address fields required for valid VAT invoice *(Pragmatist)*
`SELLER_NIP`, `SELLER_STREET`, `SELLER_CITY`, `SELLER_POSTAL_CODE` are required by Polish VAT law (art. 106e). Without them in production env vars, every generated PDF invoice is legally invalid.

### 15. Legal pages must have real content *(Pragmatist)*
`/privacy`, `/terms`, `/withdrawal` routes exist. Placeholder text is illegal in production under RODO/UoK. Non-negotiable before first real transaction.

---

## Operational & Reliability Gaps

### 16. No error monitoring *(3/5 agents)*
No Sentry DSN. Every 500, every failed webhook, every queue stall is invisible until a customer reports it. Mean time to detect a critical failure = days. 30 minutes to wire Sentry is the highest ROI action on this list.

### 17. JWT refresh token — no rotation on reuse, no network-drop recovery *(Skeptic + Risk Analyst)*
7-day httpOnly cookie with no rotation. A stolen cookie is valid for the full 7 days. If the network drops after the old token is revoked but before the new one reaches the client, the user is silently logged out mid-checkout — cart state diverges.

### 18. `order_number_seq_{year}` DDL inside a transaction *(Domain Expert)*
`CREATE SEQUENCE IF NOT EXISTS` inside a Prisma interactive transaction acquires a DDL lock. Under concurrent order creation, two transactions can deadlock on sequence creation. Move to a migration.

### 19. No merchant notification for new paid orders *(First-Principles)*
The admin alert email fires only if `ADMIN_ALERT_EMAIL` is configured and is fire-and-forget. No push notification, no dashboard badge for new orders. At any volume above a handful per day, orders will be missed and fulfillment SLAs broken.

### 20. Return-to-stock path inconsistent *(First-Principles)*
Stock restoration only happens via `paymentsService.refundPayment()` (Stripe refund path). Accepting a physical return and updating the order status in the admin panel does NOT restore stock. Inventory will silently drift with every manual return.

### 21. Shipping rates are hardcoded constants *(Domain Expert)*
`SHIPPING_RATES` in `orders.service.ts` are compile-time constants. Every carrier rate change, promotional free-shipping threshold, or weight-based surcharge requires a production code deploy.

### 22. SSR breaks the GDPR consent layer *(Domain Expert)*
`ConsentService` reads `localStorage` synchronously. On SSR (`isPlatformBrowser === false`), it returns null — every SSR-delivered page renders as "consent undecided," causing the cookie banner to flash for users who already consented and suppressing GA4 unnecessarily.

---

## Prioritized Fix Order (shortest path to safe first order)

| # | Action | Blocks |
|---|---|---|
| 1 | Provision Redis on Railway, set `REDIS_URL` | All transactional email |
| 2 | Set `SELLER_NIP` + address env vars | Legal VAT invoices |
| 3 | Verify Resend domain (SPF/DKIM/DMARC), set `EMAIL_FROM` | Email deliverability |
| 4 | Flip Stripe to live keys + register live webhook, get new `whsec_` | Taking real payments |
| 5 | Set `FRONTEND_URL`, `GOOGLE_CALLBACK_URL`, `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL` | CORS, OAuth, redirects |
| 6 | Wire Sentry DSN | Visibility into production failures |
| 7 | Enable daily `pg_dump` cron to R2/S3 | GDPR Art. 33, data integrity |
| 8 | Implement AdminJS minimum: order list, status update, refund button | Order fulfillment |
| 9 | Fix `updateItem` stock lock + cart-merge re-validation | Overselling |
| 10 | Add `processed_stripe_events` deduplication table | Duplicate webhook processing |
| 11 | Regenerate Prisma client — fix `(prisma as any).returnRequest` | Returns endpoint runtime crash |
| 12 | Move `order_number_seq` DDL creation to a migration | Deadlock under concurrent orders |
| 13 | Add GDPR Art. 20 data export endpoint + sealed/unsealed return field | Legal compliance |
| 23 | Configure database backups — Supabase Pro PITR or `pg_dump` cron to R2/S3 (tracked in Phase 7) | GDPR Art. 33, data integrity |

**Items 1–8 are launch blockers. Items 9–13 are pre-first-real-order hardening. Item 23 is deferred to Phase 7.**

---

## Agent Agreement Summary

| Finding | Agents |
|---|---|
| Redis/BullMQ hard dependency, no fallback | 5/5 |
| AdminJS absence = operational impossibility | 4/5 |
| No DB backups = GDPR/legal risk | 4/5 |
| Stock concurrency unsolved | 3/5 |
| Returns system non-functional | 2/5 (verified in code) |
