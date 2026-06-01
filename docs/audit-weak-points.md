# E-Commerce Weak Point Audit
*Generated: 2026-05-28 — 5-agent stochastic consensus*

Done:
Legal / Compliance
- EU Omnibus Directive — when displaying a promotional price, you must show the lowest price from the preceding 30 days. Your discount logic needs to store price history, not just the current price.

Financial / Tax
- Chargeback ratio — Stripe will flag and eventually close accounts above ~1% dispute rate. You need a fraud review step before fulfillment, not just after disputes arrive.

Technical
- Bot protection on checkout — scalpers and stockout bots hit fragrance stores heavily (limited editions). Consider Cloudflare Turnstile or similar on cart add and checkout start, not just login.
- Crawl budget and faceted navigation — if you add filters (size, brand, concentration), each combination generates a URL. Without noindex or canonical tagging on filter pages, Google wastes crawl budget and you get duplicate
  content penalties.
- Structured data (Schema.org Product) — price, availability, aggregateRating, and breadcrumb markup directly affects Google Shopping and rich results CTR. Worth doing before launch, not after.

---
Not yet:

Legal / Compliance
- Regulamin (terms of service) — Polish consumer law has specific mandatory clauses (UOKiK checklist) that differ from generic EU T&Cs. A lawyer review is cheaper than a UOKiK fine.

Financial / Tax
- EU VAT OSS — if you sell to consumers in other EU countries above the €10k threshold, you register once in Poland and file a quarterly OSS return instead of 27 separate VAT registrations. Plan your checkout to capture
  customer country accurately.
- 
Analytics / Measurement
- GA4 e-commerce events — view_item, add_to_cart, begin_checkout, purchase — need to be wired before launch or you have no funnel data from day one.

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
| No DB backups = GDPR/legal risk | 4/5 |
| Stock concurrency unsolved | 3/5 |
