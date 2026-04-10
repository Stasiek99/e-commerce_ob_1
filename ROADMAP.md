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
- [ ] Supabase — RLS on product-images bucket, verify connection limits
- [ ] Production env vars — Stripe live keys + webhook secret, Resend domain verification (SPF/DKIM)
- [ ] Database backups — Supabase Pro plan OR weekly `pg_dump` to S3/R2

### 1D. Smoke Testing (Days 6-7)

- [ ] 13-step checklist (see below) against deployed app
- [ ] P24 sandbox payment end-to-end with ngrok
- [ ] Verify Sentry captures errors
- [ ] Legal pages accessible, consent checkbox works
- [ ] Google Search Console: submit sitemap, check indexability

**Exit criteria:** App deployed · Product pages indexable · Sentry capturing · P24 sandbox checkout works · Legal pages live

---

## Phase 2 — OPERATIONAL (Admin + Profile + Addresses) — ~8 days

**Goal:** Admin can manage orders/products, users can edit profiles.

### 2A. AdminJS Panel (Days 1-5)

- [ ] Wire `AdminModule.createAdminAsync()` with PrismaService
- [ ] Register all models: Order (editable status), Product (image upload), User (read-only, hide passwordHash), Payment (read-only)
- [ ] Auth: `authenticate` with bcrypt against ADMIN_DEFAULT_EMAIL/PASSWORD
- [ ] Session store: express-session + connect-pg-simple
- [ ] Test: unauthenticated access rejected, admin can browse/edit orders

### 2B. Profile & Addresses (Days 6-8)

- [ ] Profile edit form (reactive form, toggle read/edit mode)
- [ ] Address book CRUD frontend (create, edit, delete, set default)
- [ ] Backend endpoints already exist; DTOs from Phase 0

**Exit criteria:** Admin can log in · View/edit orders · Manage products · Users can edit profile · Manage addresses

---

## Phase 3 — ROBUSTNESS (Payments + Shipping + Tests) — ~10 days

**Goal:** Payment edge cases handled, shipping labels work, test coverage meaningful.

### 3A. Payment Hardening (Days 1-3)

- [ ] Idempotency — check `payment.status === COMPLETED` before processing duplicate webhooks
- [ ] Reconciliation service — cron checking PENDING payments >30min against P24 API
- [ ] Transaction isolation — wrap "confirm payment → update order → send email" in single DB transaction
- [ ] Refund flow — P24 refund API call, stock restoration, order status → REFUNDED

### 3B. Shipping Completion (Days 4-6)

- [ ] InPost label — download PDF → upload to Supabase Storage → store public URL
- [ ] DHL — move shipper address to env vars (currently hardcoded Krakow)
- [ ] GLS — implement GetLabel endpoint
- [ ] AdminJS "Generate Label" action
- [ ] Carrier error handling — LABEL_ERROR status on API failure

### 3C. Test Coverage Expansion (Days 7-10)

- [ ] Unit tests: `AuthService`, `CartService.addItem`, `CartService.mergeGuestCart`
- [ ] Integration tests: full checkout flow (cart → order → payment → status update)
- [ ] Frontend: `errorInterceptor` test (401 → refresh → retry)
- [ ] Target: ≥70% branch coverage on auth/payments/orders/cart
- [ ] Add test gate to CI pipeline

**Exit criteria:** Webhooks idempotent · Payments reconciled · All carriers produce Supabase label URLs · Coverage ≥70%

---

## Phase 4 — POLISH (UX + Design + Communication) — ~8 days

**Goal:** Premium look-and-feel, invoice generation, Taiga UI integration.

### 4A. Design System + Taiga UI Components (Days 1-4)

- [ ] Product card as reusable component using Taiga UI (already started: Taiga UI installed, design tokens created)
- [ ] Refactor existing components to use design tokens + Taiga UI primitives
- [ ] Mobile responsive testing (320px → 1440px)
- [ ] Accessibility pass: focus indicators, ARIA labels, color contrast (WCAG AA)

### 4B. Invoice PDF (Days 5-6)

- [ ] Invoice PDF generator (pdfkit or puppeteer-based) — legally required for VAT (ustawa o VAT Art. 106b)
- [ ] Upload to Supabase Storage
- [ ] Admin: download invoice from order detail

### 4C. Email Improvements (Days 7-8)

- [ ] Invoice email template
- [ ] Retry mechanism (3 attempts, exponential backoff)
- [ ] Email delivery logging (Resend webhook)

**Exit criteria:** Taiga UI components live · Product cards reusable · Invoices generated · Emails retry on failure

---

## Phase 5 — SCALE PREP (Performance + Security Hardening) — ~5 days

**Goal:** App handles traffic spikes, security hardened, audit trail in place.

### 5A. Database & Performance (Days 1-2)

- [ ] OrderEvent audit trail — new Prisma model, log all status changes with actor + timestamp
- [ ] Connection pool tuning — `connection_limit` in DATABASE_URL
- [ ] Stale cart cleanup — cron to delete anonymous carts >30 days old
- [ ] Product listing pagination — cursor/offset on all list endpoints

### 5B. Security Hardening (Days 3-4)

- [ ] CORS whitelist — restrict to production frontend URL
- [ ] Session ID validation — server-generated UUIDs, reject invalid formats
- [ ] Payment endpoint ownership — verify user owns order in `GET /payments/:orderId/status`
- [ ] Google OAuth token — switch from URL query param to httpOnly cookie
- [ ] E2E security tests — Playwright: unauthenticated admin access, cross-user data access

### 5C. Observability (Day 5)

- [ ] Structured logging — Pino for JSON-formatted logs (Railway-friendly)
- [ ] Request tracing — correlation IDs across requests
- [ ] Supabase monitoring — connection count alerts, storage usage

**Exit criteria:** Audit trail active · CORS locked · Session IDs validated · Structured logs in production

---

## Phase 6 — GROWTH (Post-Launch Features) — ongoing

**Goal:** Revenue growth features. Prioritize based on customer feedback.

- [ ] Discount/coupon system (Coupon model, validation at checkout)
- [ ] Wishlist functionality
- [ ] Product reviews & ratings
- [ ] Return/withdrawal request flow (consumer-facing form)
- [ ] i18n/localization (if expanding beyond Poland)
- [ ] Full SSR (if prerendering proves insufficient)
- [ ] PWA (offline catalog, push notifications)
- [ ] DHL/GLS mock modes
- [ ] Advanced AdminJS views (order timeline, analytics dashboard)

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

**First real order possible:** End of Week 1 (after Phase 0)
**Full production launch:** End of Week 3 (after Phase 1)
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
| Full SSR | **REPLACED** | Prerendering sufficient for <500 pages. No Node server needed on Vercel. |
| 3 carriers at launch | **InPost only recommended** | ~70% of Polish deliveries. DHL/GLS launch in Phase 3. |

---

## 13-Step Smoke Test Checklist

1. Register new user → confirm in Prisma Studio
2. Logout + login → confirm refresh cookie in DevTools
3. Google OAuth flow → confirm `googleId` set in DB
4. Add 2 product variants to cart as guest → confirm persistence on reload
5. Login → confirm cart merge (guest items appear)
6. Full checkout: address → InPost + locker code → consent checkbox → summary → P24 redirect
7. Complete payment on P24 sandbox → confirm webhook received → DB: COMPLETED / PAID
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

**Created:** 2026-04-09
**Rebuilt from consensus analysis:** 2026-04-09
**Status:** Phase 0 — In Progress
