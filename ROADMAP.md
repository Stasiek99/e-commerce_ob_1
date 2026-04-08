# E-Commerce Perfume Shop — Production Roadmap

Living reference document. Each phase is a focused work session. Follow in order — phases are dependency-ordered.

**Current state:** Backend ~95% built · Frontend ~90% built · DB migrated · 0 tests · AdminJS stub

---

## Phase 0 — Credential Setup *(S — blocks everything)*

Configure all 6 external services before any integration testing.

| Service | Env vars | Where to get them |
|---|---|---|
| Resend | `RESEND_API_KEY`, `EMAIL_FROM` | resend.com → API Keys |
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | console.cloud.google.com → OAuth 2.0 clients |
| Przelewy24 | `P24_MERCHANT_ID`, `P24_POS_ID`, `P24_CRC`, `P24_API_KEY`, `P24_SANDBOX=true`, `P24_NOTIFY_URL`, `P24_RETURN_URL` | sandbox.przelewy24.pl |
| InPost ShipX | `INPOST_API_TOKEN`, `INPOST_ORGANIZATION_ID`, `INPOST_SANDBOX=true` | panel.inpost.pl |
| DHL Express | `DHL_API_KEY`, `DHL_API_SECRET`, `DHL_ACCOUNT_NUMBER`, `DHL_SANDBOX=true` | developer.dhl.com |
| GLS | `GLS_USERNAME`, `GLS_PASSWORD`, `GLS_SENDER_ID`, `GLS_SANDBOX=true` | contact GLS Poland partner support |

> **Agent:** Use `research` agent per service — e.g. *"InPost ShipX sandbox registration steps and where to find INPOST_API_TOKEN"*

**Done when:** Backend starts without env exceptions · Resend test email arrives · P24 `/transactions` returns 200

---

## Phase 1 — Profile Edit Form *(S)*

**File:** `frontend/src/app/features/account/profile/profile.component.ts`

Profile is currently read-only. Backend endpoint `PATCH /users/me` already exists.

- Reactive form: `firstName`, `lastName`, `phone`
- Pre-populate from `auth.currentUser()` signal on init
- On success: call `auth.loadCurrentUser()` + `toast.success()`
- Toggle UX: read view by default → "Edit" button reveals the form

No new services or routes needed.

**Done when:** Logged-in user can edit and save profile; values update in the header without page reload.

---

## Phase 2 — AdminJS Panel *(L)*

**File:** `backend/src/modules/admin/admin.module.ts` (currently empty skeleton)

Packages already installed: `adminjs`, `@adminjs/nestjs`, `@adminjs/prisma`.

1. Wire `AdminModule.createAdminAsync()` with `PrismaService` — register all 13 models
2. Per-resource display:
   - `Order` — editable status, custom **"Generate Label"** action → `ShippingService.generateLabel()`
   - `Product` — list + edit with image upload via `StorageService`
   - `User` — read-only, whitelist safe fields (never expose `passwordHash`)
   - `Payment` — read-only (audit trail)
3. Auth: `authenticate` option checking `ADMIN_DEFAULT_EMAIL`/`ADMIN_DEFAULT_PASSWORD` env vars (bcrypt)
4. Session store: `express-session` + `connect-pg-simple` backed by Supabase

> **Note:** AdminJS must remain the **last import in AppModule** (comment already in code)

> **Agent:** Use `research` agent — *"@adminjs/nestjs v7 + @adminjs/prisma v5 createAdminAsync wiring example with PrismaClient"*

**Done when:** `/admin` loads · Admin can log in · Orders browsable/editable · Unauthenticated access rejected

---

## Phase 3 — Testing *(M)*

Zero test files exist. Use **`qa` agent**, one service per call (keeps context focused).

Priority order — highest risk first:

| # | Service | Scenarios to cover |
|---|---|---|
| 1 | `AuthService` | Duplicate email throws, wrong password throws, revoked refresh token throws, hash stored not raw token |
| 2 | `PaymentsService.handleWebhook` | Unknown session logged+returns, valid webhook updates DB in transaction, email failure doesn't throw |
| 3 | `OrdersService.createFromCart` | Empty cart throws, INPOST without locker throws, insufficient stock throws, happy path decrements stock |
| 4 | `CartService.addItem` | Variant not found, insufficient stock, adding existing item merges quantity |
| 5 | `errorInterceptor` (frontend) | 401 triggers refresh + request retry, refresh failure triggers logout |

Run with: `pnpm --filter backend test` · `ng test`

**Done when:** All unit tests pass · Auth/payments/orders/cart branch coverage ≥70%

---

## Phase 4 — Security Code Review *(M)*

Two focused passes with **`code-reviewer` agent**.

**Pass A — Auth**
Files: `auth.service.ts`, `auth.controller.ts`, `jwt.strategy.ts`, `jwt-refresh.strategy.ts`, `google.strategy.ts`, `error.interceptor.ts`
Check: cookie flags (`httpOnly`, `Secure`, `SameSite`), refresh token stored as SHA-256 hash not raw, `@Public()` misuse, CORS scope.

**Pass B — Payments**
Files: `payments.controller.ts`, `payments.service.ts`, `przelewy24.client.ts`
Known gap: the incoming P24 webhook `sign` field is **not verified before DB access** — a forged body could trigger `verifyTransaction`. SHA-384 check must run first (before session lookup).

**Done when:** No HIGH/CRITICAL findings unresolved · P24 webhook signature gap fixed

---

## Phase 5 — Implementation Gaps *(M)*

Finish placeholder code before smoke testing.

| Gap | File | Fix |
|---|---|---|
| InPost label URL is a fake `label://${id}` | `shipping/carriers/inpost.client.ts` | Download PDF buffer → upload to Supabase Storage → return public URL |
| GLS label retrieval is empty | `shipping/carriers/gls.client.ts` | Call GLS `GetLabel` endpoint, store URL |
| DHL shipper address hardcoded to Kraków placeholder | `shipping/carriers/dhl.client.ts` | Move to env vars `DHL_SHIPPER_*`, read via `ConfigService` |
| `PATCH /users/me` accepts `body: any` | `users.controller.ts` | Add `UpdateProfileDto` with class-validator decorators |
| P24 webhook `sign` not verified (from Phase 4) | `payments.service.ts` | SHA-384 check before any DB access |

> **Agent:** Use `research` agent for GLS: *"GLS ADE API v2 GetLabel endpoint request format"*

**Done when:** All three carriers return real Supabase Storage URLs · Webhook signature verified · DTO rejects invalid input with 400

---

## Phase 6 — Integration Smoke Testing *(M — manual)*

Run local dev with real sandbox credentials. Use **ngrok** for P24 webhooks.
Open Prisma Studio alongside: `pnpm --filter backend prisma:studio`

**13-step checklist:**

1. Register new user → confirm in Prisma Studio
2. Logout + login → confirm refresh cookie in DevTools (Application → Cookies)
3. Google OAuth flow → confirm `googleId` set in DB
4. Add 2 product variants to cart as guest → confirm persistence on page reload
5. Login → confirm cart merge (guest items appear)
6. Full checkout: address → InPost + locker code → summary → P24 sandbox redirect
7. Complete payment on P24 sandbox → confirm webhook received → DB: `COMPLETED` / `PAID`
8. Confirm order confirmation + payment emails in Resend dashboard
9. AdminJS: change order to `PROCESSING` → confirm updated at `/account/orders`
10. AdminJS: Generate Label → confirm real Supabase URL + shipping notification email
11. Second test order via Google OAuth user
12. Force token expiry (`JWT_ACCESS_EXPIRES_IN=15s`) → confirm `errorInterceptor` retries automatically
13. Edit profile → confirm header reflects new name without reload

**Done when:** All 13 pass · No unhandled errors in NestJS console

---

## Phase 7 — Deployment *(M)*

### Railway (backend)

- Service root dir: `backend/`
- Build command: `npm run build`
- Start command: `prisma migrate deploy && node dist/main.js`
- Set all env vars from `backend/.env`
- Production overrides:
  - `NODE_ENV=production`
  - `FRONTEND_URL=https://your-app.vercel.app`
  - `P24_NOTIFY_URL=https://your-app.railway.app/payments/webhook`
  - `P24_RETURN_URL=https://your-app.vercel.app/checkout/success`
  - `GOOGLE_CALLBACK_URL=https://your-app.railway.app/auth/google/callback`
  - Keep `P24_SANDBOX=true` and all `*_SANDBOX=true` until first real order tested

### Vercel (frontend)

- Root dir: `frontend/`
- Build command: `ng build --configuration production`
- Output dir: `dist/frontend/browser`
- Before deploying: update `frontend/src/environments/environment.prod.ts` → `apiUrl: 'https://your-backend.railway.app'`
- Add Vercel URL to Railway's `FRONTEND_URL` and to Google OAuth redirect URIs

### Supabase

- Enable RLS on `product-images` bucket: public read, service-role write only
- Confirm free tier limits (500MB DB, 1GB bandwidth) or upgrade

**Done when:** Production URL loads home · Login works · P24 sandbox checkout completes end-to-end

---

## Phase 8 — Post-Launch *(S setup + ongoing)*

- **Error tracking:** Add `@sentry/nestjs` + `@sentry/angular`. Target the fire-and-forget email calls that currently `.catch(() => {})` — wire these to Sentry.
  > **Agent:** *"@sentry/nestjs v8 NestJS module setup and exception filter"*
- **Email deliverability:** Verify sending domain in Resend (SPF/DKIM/DMARC). Until domain is verified, `onboarding@resend.dev` only delivers to the account owner's inbox.
- **DB pool:** If Railway free tier hits `max_client_conn`, add `connection_limit=1` to `DATABASE_URL` query string.
- **Weekly checks:** Supabase (storage/connections) · Railway (CPU/RAM/latency) · Resend (bounce rate) · P24 (transaction success rate)

**Done when:** First real production order flows end-to-end · All emails delivered · Sentry shows no unresolved HIGH issues in 24h

---

## Agent Quick Reference

| Situation | Agent | Example prompt |
|---|---|---|
| API docs, sandbox registration | `research` | *"InPost ShipX sandbox — how to get INPOST_API_TOKEN"* |
| AdminJS version-specific wiring | `research` | *"@adminjs/nestjs v7 + @adminjs/prisma v5 createAdminAsync with PrismaClient"* |
| Writing unit tests | `qa` | *"Generate Jest tests for AuthService: duplicate email throws ConflictException, wrong password throws UnauthorizedException, refresh with revoked token throws"* |
| Security audit | `code-reviewer` | *"Review auth.service.ts and auth.controller.ts for cookie security, token hashing, and @Public misuse"* |
| Post-launch tooling | `research` | *"@sentry/nestjs v8 setup in NestJS module"* |

---

## Critical Files

| File | Phase | Purpose |
|---|---|---|
| `backend/src/modules/admin/admin.module.ts` | 2 | AdminJS full build-out |
| `backend/src/modules/payments/payments.service.ts` | 4+5 | P24 webhook signature verification |
| `backend/src/modules/shipping/carriers/inpost.client.ts` | 5 | Label URL → Supabase Storage |
| `backend/src/modules/shipping/carriers/gls.client.ts` | 5 | GLS GetLabel wiring |
| `backend/src/modules/shipping/carriers/dhl.client.ts` | 5 | Shipper env vars |
| `backend/src/modules/users/users.controller.ts` | 5 | UpdateProfileDto |
| `frontend/src/app/features/account/profile/profile.component.ts` | 1 | Profile edit form |
| `frontend/src/environments/environment.prod.ts` | 7 | Production API URL |
| `backend/.env` | — | All credentials — never commit |
