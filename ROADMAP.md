# E-Commerce Fragrance Store — Production Roadmap

Living reference document. Each phase is a focused work session. Follow in order — phases are dependency-ordered.

**Current state:** Backend ~95% built · Frontend ~90% built · DB migrated · 0 tests · AdminJS stub · Taiga UI installed (not yet used in components)

**Origin:** Rebuilt from stochastic consensus analysis (5 independent agents, 25 flaws identified). Corrects critical ordering mistakes in the original plan — security/legal fixes moved to Phase 0, redundant work cut, MVP checkpoint defined.

---

## Phase 0 — SHIP BLOCKERS (Critical Security + Legal) — ~5 days

**Goal:** Make the app safe to accept real money.

Everything in this phase MUST be done before the first real order.

### 0A. Payment Security (Day 1)

| Task | File(s) | Status |
|------|---------|--------|
| P24 webhook SHA-384 signature verification — verify `sign` BEFORE any DB access | `payments.service.ts:65-99`, `przelewy24.client.ts` | ⏳ |
| Webhook DTO — `WebhookPayloadDto` with class-validator | `payments/dto/webhook-payload.dto.ts` (new) | ⏳ |
| Fix order number race condition — replace `count + 1` with PostgreSQL sequence | `orders.service.ts:218-224` | ⏳ |
| Fix cart clearing — move inside Prisma transaction or after payment URL confirmed | `orders.service.ts:150-153` | ⏳ |
| Stock restoration on payment failure — restore stock when payment fails/expires | `payments.service.ts`, `orders.service.ts` | ⏳ |

### 0B. Input Validation — All DTOs (Day 2)

| Task | Status |
|------|--------|
| `CreateOrderDto` — orders controller | ⏳ |
| `UpdateOrderStatusDto` — orders admin endpoint | ⏳ |
| `AddToCartDto`, `UpdateCartItemDto` — cart controller | ⏳ |
| `UpdateProfileDto` — users controller | ⏳ |
| `CreateAddressDto`, `UpdateAddressDto` — users/addresses | ⏳ |
| `CreateProductDto`, `UpdateProductDto` — products controller | ⏳ |
| `CreateCategoryDto`, `UpdateCategoryDto` — categories controller | ⏳ |
| Add `@nestjs/throttler` — rate limit login (5/min), register (3/min), webhook (30/min) | ⏳ |
| Add `helmet` middleware in `main.ts` | ⏳ |

### 0C. Polish Legal Compliance (Days 3-4)

| Task | File(s) | Status |
|------|---------|--------|
| Regulamin sklepu (Terms of Service) — static page + acceptance checkbox at checkout | `frontend/src/app/features/legal/` (new) | ✅ |
| Polityka prywatnosci (Privacy Policy / RODO) — static page | `frontend/src/app/features/legal/` (new) | ✅ |
| Prawo odstapienia (14-day withdrawal rights) — informational page | `frontend/src/app/features/legal/` (new) | ✅ |
| Checkout consent checkbox — "Akceptuje regulamin i polityke prywatnosci" | `checkout-page.component.ts` | ✅ |
| Cookie consent banner (basic — localStorage flag) | `frontend/src/app/shared/` (new) | ✅ |
| Store accepted terms version + timestamp on Order model | Prisma migration | ✅ |

### 0D. Minimal Safety Net (Day 5)

| Task | Status |
|------|--------|
| Unit tests for money paths: `handleWebhook`, `createFromCart`, `generateOrderNumber` | ✅ |
| Health check endpoint — `GET /api/health` checking DB connection | ✅ |
| ConfigModule Zod/Joi validation — fail-fast on missing critical env vars | ✅ |
| Basic CI — GitHub Actions: install → build → test | ✅ |

**Exit criteria:** P24 webhook verified · All DTOs validated · Legal pages live · Consent checkbox works · Critical tests pass · CI green

---

## Phase 1 — LAUNCH READY (SEO + Monitoring + Deploy) — ~7 days

**Goal:** Product pages indexable by Google, errors visible, app deployed.

### 1A. SEO & Prerendering (Days 1-2)

- [ ] Angular prerendering (NOT full SSR) — `ng build --prerender` for product/category routes
- [ ] Meta tag service — dynamic `<title>`, `og:title`, `og:description`, `og:image` for product pages
- [ ] JSON-LD structured data for products (Product schema)
- [ ] Canonical URLs on all pages
- [ ] sitemap.xml generation (static at build time from product slugs)

### 1B. Error Monitoring (Day 3)

- [ ] Sentry — `@sentry/nestjs` backend + `@sentry/angular` frontend
- [ ] Replace `.catch(() => {})` email calls with `.catch(e => Sentry.captureException(e))`
- [ ] Email failure alerting — log + Sentry capture on Resend failures

### 1C. Deployment (Days 4-5)

- [x] Railway backend — build command, start command, env vars, `prisma migrate deploy`
- [x] Vercel frontend — prerendered build, `environment.prod.ts` API URL updated
- [x] Supabase — RLS on product-images bucket, verify connection limits
- [x] Production env vars — Stripe live keys + webhook secret, Resend domain verification (SPF/DKIM)
- [ ] Database backups — Supabase Pro plan OR weekly `pg_dump` to S3/R2

### 1D. Smoke Testing (Days 6-7)

- [ ] 13-step checklist (see below) against deployed app
- [ ] Stripe test-mode payment end-to-end
- [ ] Verify Sentry captures errors
- [ ] Legal pages accessible, consent checkbox works
- [ ] Google Search Console: submit sitemap, check indexability

**Exit criteria:** App deployed · Product pages indexable · Sentry capturing · Stripe test checkout works · Legal pages live

---

## Phase 2 — OPERATIONAL (Admin + Profile + Addresses) — ~8 days

**Goal:** Admin can manage orders/products, users can edit profiles.

### 2A. AdminJS Panel (Days 1-5)

- [x] Wire AdminJS with PrismaService (via bootstrap `setupAdmin()` — bypasses ESM-only `@adminjs/nestjs`)
- [x] Register all models: Order (editable status), Product (image upload), User (read-only, hide passwordHash), Payment (read-only), OrderItem, ProductVariant, Shipment
- [x] Auth: `authenticate` with bcrypt against ADMIN_DEFAULT_EMAIL/PASSWORD
- [x] Session store: express-session + connect-pg-simple
- [x] Test: unauthenticated access rejected (302 → login), admin panel available at /admin

### 2B. Profile & Addresses (Days 6-8)

- [x] Profile edit form (reactive form, toggle read/edit mode)
- [x] Address book CRUD frontend (create, edit, delete, set default)
- [x] Backend endpoints already exist; DTOs from Phase 0

**Exit criteria:** Admin can log in · View/edit orders · Manage products · Users can edit profile · Manage addresses

---

## Phase 3 — ROBUSTNESS (Payments + Shipping + Tests) — ~10 days

**Goal:** Payment edge cases handled, shipping labels work, test coverage meaningful.

### 3A. Payment Hardening (Days 1-3)

- [x] Idempotency — check `payment.status === COMPLETED` before processing duplicate webhooks
- [x] Reconciliation service — cron checking PENDING payments >30min against Stripe API
- [x] Transaction isolation — wrap "confirm payment → update order → send email" in single DB transaction
- [x] Refund flow — Stripe refund API call, stock restoration, order status → REFUNDED

### 3B. Shipping Completion (Days 4-6)

- [x] InPost label — download PDF → upload to Supabase Storage → store public URL
- [ ] DHL — move shipper address to env vars (currently hardcoded Krakow)
- [ ] GLS — implement GetLabel endpoint
- [ ] AdminJS "Generate Label" action
- [x] Carrier error handling — LABEL_ERROR status on API failure

### 3C. Test Coverage Expansion (Days 7-10)

- [x] Unit tests: `AuthService`, `CartService.addItem`, `CartService.mergeGuestCart`
- [x] Integration tests: full checkout flow (cart → order → payment → status update)
- [x] Frontend: `errorInterceptor` test (401 → refresh → retry)
- [x] Target: ≥70% branch coverage on auth/payments/orders/cart
- [x] Add test gate to CI pipeline

**Exit criteria:** Webhooks idempotent · Payments reconciled · All carriers produce Supabase label URLs · Coverage ≥70%

---

## Phase 4 — POLISH (UX + Design + Communication) — ~8 days

**Goal:** Premium look-and-feel, invoice generation, Taiga UI integration.

### 4A. Design System + Taiga UI Components (Days 1-4)

- [x] Product card as reusable component using Taiga UI (already started: Taiga UI installed, design tokens created)
- [x] Refactor existing components to use design tokens + Taiga UI primitives
- [x] Mobile responsive testing (320px → 1440px)
- [x] Accessibility pass: focus indicators, ARIA labels, color contrast (WCAG AA)

### 4B. Invoice PDF (Days 5-6)

- [x] Invoice PDF generator (pdfkit or puppeteer-based) — legally required for VAT (ustawa o VAT Art. 106b)
- [x] Upload to Supabase Storage
- [x] Admin: download invoice from order detail

### 4C. Email Improvements (Days 7-8)

- [x] Invoice email template
- [x] Retry mechanism (3 attempts, exponential backoff)
- [x] Email delivery logging (Resend webhook)

**Exit criteria:** Taiga UI components live · Product cards reusable · Invoices generated · Emails retry on failure

---

## Phase 5 — SCALE PREP (Performance + Security Hardening) — ~5 days

**Goal:** App handles traffic spikes, security hardened, audit trail in place.

### 5A. Database & Performance (Days 1-2)

- [x] OrderEvent audit trail — new Prisma model, log all status changes with actor + timestamp
- [x] Connection pool tuning — `connection_limit` in DATABASE_URL
- [x] Stale cart cleanup — cron to delete anonymous carts >30 days old
- [x] Product listing pagination — cursor/offset on all list endpoints

### 5B. Security Hardening (Days 3-4)

- [x] CORS whitelist — restrict to production frontend URL
- [x] Session ID validation — server-generated UUIDs, reject invalid formats
- [x] Payment endpoint ownership — verify user owns order in `GET /payments/:orderId/status`
- [x] Google OAuth token — switch from URL query param to httpOnly cookie
- [x] E2E security tests — Playwright: unauthenticated admin access, cross-user data access

### 5C. Observability (Day 5)

- [x] Structured logging — Pino for JSON-formatted logs (Railway-friendly)
- [x] Request tracing — correlation IDs across requests
- [x] Supabase monitoring — connection count alerts, storage usage

**Exit criteria:** Audit trail active · CORS locked · Session IDs validated · Structured logs in production

---

## Phase 5D — CORE LOGIC GAPS (Missing Auth Flows) — ~1 day

**Goal:** Close auth features that existed as stubs or dead code in the codebase.

| Task | Status |
|------|--------|
| Password reset flow — `PasswordResetToken` model, `POST /auth/forgot-password`, `POST /auth/reset-password`, Resend email, frontend forms (`/auth/forgot-password`, `/auth/reset-password`), "Nie pamiętasz hasła?" link on login | ✅ |
| Email verification — `EmailVerificationToken` model, verification email on register (fire-and-forget), `POST /auth/verify-email`, `POST /auth/resend-verification`, `VerifyEmailComponent` (`/auth/verify-email`), unverified-email banner with resend button in account dashboard | ✅ |
| Race condition fix — `verifyEmail()` checks `isEmailVerified` before validating token, so a double-click returns 204 instead of 400 | ✅ |
| Expired token cleanup cron — daily job deletes `email_verification_tokens` and `password_reset_tokens` rows where `expiresAt < now()` to prevent table bloat | ⏳ |
| Low-stock / out-of-stock alert — after each order's stock decrements, query post-decrement levels; email `ADMIN_ALERT_EMAIL` listing any SKU at 0 (out-of-stock) or ≤ 2 (low-stock threshold); one fire-and-forget email per order, no schema change | ✅ |
| New order notification — on `checkout.session.completed`, fire-and-forget email to `ADMIN_ALERT_EMAIL` with order number, customer email, items table, total, carrier, and admin panel link | ✅ |
| Guest order tracking — `GET /orders/track?email=&orderNumber=` (public, case-insensitive match); returns status, items, tracking number; `/orders/track` frontend page with form + result card; link added to checkout success page | ✅ |
| GDPR Art. 17 erasure procedure — `backend/prisma/gdpr/erasure-procedure.sql` (anonymises user + order snapshots, deletes tokens/addresses, preserves order rows for 5-year tax retention); privacy policy updated with Art. 17 section, contact address, and legal retention explanation | ✅ |
| B2B invoice NIP — `nip` field on `User`, `snapshotNip` on `Order`; NIP snapshoted from DTO or user profile at order creation; printed in NABYWCA section of PDF invoice; NIP field in profile view/edit with 10-digit validation; `PATCH /users/me` accepts `nip`; Prisma migration `20260425020000` | ✅ |
| Inventory replenishment — `PATCH /products/admin/variants/:variantId/stock` (admin-only); accepts `{ set: number }` for absolute value or `{ adjustment: number }` for relative delta (floored at 0); no direct DB access required | ✅ |
| Consumer-facing order cancel/withdraw — `POST /orders/:id/cancel` (PENDING_PAYMENT → expire Stripe session + restore stock + CANCELLED; PAID/PROCESSING → full Stripe refund + REFUNDED), inline confirm UI in order detail with legal note, cancellation/refund email via Resend, Polish status labels on list + detail | ✅ |

**Exit criteria:** Users can recover forgotten passwords via email · New email/password registrations receive a verification email · `isEmailVerified` field is set correctly and reflected in the UI · Expired tokens are purged daily · Buyers can self-serve cancel unpaid orders and withdraw from paid orders before shipment

---

## Phase 6 — GROWTH (Post-Launch Features) — ongoing

**Goal:** Revenue growth features. Prioritize based on customer feedback.

- [x] Discount/coupon system (Coupon model, validation at checkout) 
- [x] Wishlist functionality
- [x] Product reviews & ratings
- [ ] Return/withdrawal request flow (consumer-facing form)
- [ ] i18n/localization (if expanding beyond Poland)
- [x] Full SSR (if prerendering proves insufficient)
- [ ] PWA (offline catalog, push notifications)
- [ ] DHL/GLS mock modes
- [ ] Advanced AdminJS views (order timeline, analytics dashboard)
- [x] Consumer-facing order cancel/withdraw — `POST /orders/:id/cancel`, inline confirm UI in order detail, Polish status labels on list + detail, cancellation email (see Phase 5B)
- [ ] Email address change flow — `PATCH /users/me/email` with re-verification (must invalidate old `EmailVerificationToken` rows and set `isEmailVerified = false` on change)
- [ ] Outbox pattern for transactional emails — replace fire-and-forget with a BullMQ queue (Redis) so verification/reset emails survive server restarts between DB write and send
- [ ] Magic Link login — passwordless flow reusing the `EmailVerificationToken` infrastructure; issue a short-lived token, exchange for a session on click
- [ ] Partial order cancellation — cancel individual line items rather than the whole order; requires item-selection UI, partial Stripe refund amount calculation, and per-item stock restoration
- [ ] `refund.succeeded` webhook — currently refunds are confirmed synchronously via Stripe API response (sufficient for cards/BLIK/P24); add webhook handler for async payment methods where refund confirmation may be delayed

---

## Timeline Summary

| Phase | Focus | Duration | Cumulative |
|-------|-------|----------|------------|
| 0 | Ship Blockers (security + legal + tests) | 5 days | Week 1 |
| 1 | Launch Ready (SEO + monitoring + deploy) | 7 days | Week 2-3 |
| 2 | Operational (AdminJS + profile/addresses) | 8 days | Week 4-5 |
| 3 | Robustness (payments + shipping + tests) | 10 days | Week 6-7 |
| 4 | Polish (UX/design + invoices + emails) | 8 days | Week 8-9 |
| 5 | Scale Prep (performance + security hardening) | 5 days | Week 10 |
| 6 | Growth (post-launch features) | ongoing | Week 11+ |
| 7 | Pre-Launch Polish (domain, emails, real data) | 2 days | Before go-live |

**First real order possible:** End of Week 1 (after Phase 0)
**Full production launch:** After Phase 7 (all placeholders replaced with real values)
**Feature-complete:** End of Week 10 (after Phase 5)

---

## What Was Cut From Original Plan (and why)

| Original Item | Decision | Rationale |
|---------------|----------|-----------|
| Stock reservation cron (15-20 min timer) | **CUT** | <100 orders/day; atomic decrement sufficient. Stock restore on payment failure solves the real problem. |
| Product slug generation | **CUT** | Already exists (`slug @unique` on Product and Category) |
| Cart merging logic | **CUT** | Already implemented in `cart.service.ts:126-168` |
| Atomic stock updates | **CUT** | Already implemented in `orders.service.ts:95-109` |
| Soft deletes (deletedAt) | **DEFERRED** | <500 products don't need soft deletes. `isActive` flag suffices. |
| Winston/Pino at Phase 0 | **MOVED to Phase 5** | NestJS logger + Railway stdout sufficient for launch |
| Full SSR | **IMPLEMENTED** | Phase 6 — `server.ts` Express entry, `api/ssr.mjs` Vercel Function. Prerendered routes still served from CDN; dynamic routes SSR'd on-demand. |
| 3 carriers at launch | **InPost only recommended** | ~70% of Polish deliveries. DHL/GLS launch in Phase 3. |

---

## 13-Step Smoke Test Checklist

1. Register new user → confirm in Prisma Studio
2. Logout + login → confirm refresh cookie in DevTools
3. Google OAuth flow → confirm `googleId` set in DB
4. Add 2 product variants to cart as guest → confirm persistence on reload
5. Login → confirm cart merge (guest items appear)
6. Full checkout: address → InPost + locker code → consent checkbox → summary → Stripe redirect
7. Complete payment on Stripe test mode → confirm webhook received → DB: COMPLETED / PAID
8. Confirm order confirmation + payment emails in Resend dashboard
9. AdminJS: change order to PROCESSING → confirm updated at `/account/orders`
10. AdminJS: Generate Label → confirm Supabase URL + shipping notification email
11. Second test order via Google OAuth user
12. Force token expiry (`JWT_ACCESS_EXPIRES_IN=15s`) → confirm `errorInterceptor` retries
13. Edit profile → confirm header reflects new name without reload

---

## Critical Files Reference

| File | Phase | Purpose |
|------|-------|---------|
| `backend/src/modules/payments/payments.service.ts` | 0, 3 | Webhook verification, failure handling, idempotency |
| `backend/src/modules/payments/payments.controller.ts` | 0 | Webhook DTO |
| `backend/src/modules/orders/orders.service.ts` | 0 | Order number fix, cart clearing, stock restore |
| `backend/src/main.ts` | 0 | Helmet, throttler |
| `backend/src/modules/admin/admin.module.ts` | 2 | AdminJS build-out |
| `backend/src/modules/shipping/carriers/*.client.ts` | 3 | Label URL → Supabase |
| `frontend/src/app/features/checkout/` | 0 | Consent checkbox |
| `frontend/src/app/features/legal/` | 0 | Legal pages (new) |
| `frontend/src/app/features/account/profile/` | 2 | Profile edit form |
| `frontend/angular.json` | 1 | Prerender config |
| `frontend/src/environments/environment.prod.ts` | 1 | Production API URL |
| `.github/workflows/ci.yml` | 0 | CI pipeline (new) |

---

## Phase 7 — PRE-LAUNCH POLISH (Final Go-Live Checklist) — ~2 days

**Goal:** Everything that's been deferred with placeholders gets its real value before the first real customer.

- [ ] Register business domain + point DNS
- [ ] Resend domain verification (SPF + DKIM + DMARC) → set `EMAIL_FROM` in Railway
- [ ] Resend Dashboard → Webhooks → Add endpoint: URL `https://<railway>/email/webhook`, events `email.sent`, `email.delivered`, `email.bounced`, `email.complained` → copy Signing Secret → set `RESEND_WEBHOOK_SECRET` in Railway
- [ ] Stripe: update statement descriptor to real business name
- [ ] Seed real product catalog (products, variants, images, categories) — see field guide below
- [ ] Upload product images to Supabase `product-images` bucket
- [ ] Database backups — Supabase Pro plan OR weekly `pg_dump` to S3/R2
- [ ] Switch Stripe to live mode in Railway (`sk_live_` / `pk_live_`) — verify checkout end-to-end with a real card (refund immediately)
- [ ] Google Search Console: submit sitemap, verify indexability
- [ ] Final CORS check — `FRONTEND_URL` matches production domain
- [ ] Google OAuth: update Authorized redirect URIs to production domain
- [ ] Rotate any credentials exposed during development (DB password, JWT secrets)
- [ ] One full end-to-end order: register → cart → checkout → Stripe → confirmation email → verify in DB

**Exit criteria:** Real domain live · Emails sending from verified domain · Real products visible · Stripe live checkout works · Backups configured

---

## Product Catalog Field Guide (for seeding real data)

Reference for how filter values map to Prisma fields. The frontend filter UI reads these exact strings — casing matters.

### `Product` model fields

| Filter UI label | Prisma field | Accepted values |
|---|---|---|
| Płeć | `gender` | `"Kobieta"`, `"Mężczyzna"`, `"Unisex"` |
| Grupa olfaktoryczna | `scentFamily` | e.g. `"Drzewne"`, `"Kwiatowe"`, `"Cytrusowe"`, `"Orientalne"` — decide final list before seeding |
| Linia | *(field TBD — needs schema migration)* | `"Millesime"`, `"Luxury"` |

### `ProductVariant` model fields

| Filter UI label | Prisma field | Values by category |
|---|---|---|
| Pojemność | `volume` (integer, ml) | Perfumy: `30`, `50`, `70` · Dyfuzory: `100`, `200`, `500` · Żele: `250` |

`volume` is stored as an integer (ml). The filter UI displays it as "30ml", "50ml" etc. — the backend converts on query.

### Volume options per category (for dynamic filter UI)

When a category is selected in the frontend, the "Pojemność" accordion shows only that category's sizes. When "Wszystkie produkty" is shown, all sizes are merged.

| Category slug | Volume options |
|---|---|
| `perfume` | 30ml, 50ml, 70ml |
| `diffusers` | 100ml, 200ml, 500ml |
| `gels` | 250ml |
| *(all products)* | 30ml, 50ml, 70ml, 100ml, 200ml, 250ml, 500ml |

### `inStock` filter

Maps to `variants: { some: { stock: { gt: 0 }, isActive: true } }` in Prisma. No schema change needed — uses the existing `stock` field on `ProductVariant`.

---

**Created:** 2026-04-09
**Rebuilt from consensus analysis:** 2026-04-09
**Status:** Phase 0 — In Progress
