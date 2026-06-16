# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fragrance e-commerce store targeting the Polish market. Uses a **pnpm monorepo** with three packages:
- `backend/` — NestJS 10 REST API (port 3000)
- `frontend/` — Angular 18 SPA (port 4200)
- `packages/shared-types/` — Shared TypeScript enums, DTOs, and types (`@fragrance-store/shared-types`)

## Common Commands

```bash
# Development
pnpm dev:backend        # NestJS with hot reload
pnpm dev:frontend       # Angular dev server

# Build
pnpm build:backend
pnpm build:frontend

# Database (Prisma)
pnpm db:migrate         # prisma migrate dev (dev only)
pnpm db:studio          # Open Prisma Studio
pnpm db:generate        # Regenerate Prisma client after schema change

# Backend only (run from backend/)
pnpm prisma:migrate:prod   # prisma migrate deploy (production)
pnpm prisma:seed           # Seed database via ts-node
pnpm lint                  # ESLint with autofix
```

Angular has no custom test or lint scripts configured yet. Backend has no test scripts — Jest setup is planned for Phase 3.

## Architecture

### Backend (`backend/src/modules/`)

Each module is self-contained with controller, service, and module file:

| Module | Responsibility |
|---|---|
| `auth` | JWT (15m access / 7d refresh) + Google OAuth, bcrypt password hashing |
| `users` | Profiles, addresses with default flag |
| `products` | Catalog with variants, images, categories |
| `categories` | Hierarchical (self-referential) category tree |
| `cart` | Session-based + authenticated cart, stock validation |
| `orders` | Cart → Order conversion with price snapshots |
| `payments` | Stripe Checkout Session creation + signed webhook handler |
| `shipping` | InPost / DHL / GLS carrier clients, label generation |
| `email` | Resend transactional emails with templates |
| `storage` | Supabase image upload/delete |
| `admin` | AdminJS panel (stub — scheduled for Phase 2) |
| `prisma` | Global `PrismaService` injected everywhere |

### Frontend (`frontend/src/app/`)

Standalone Angular 18 components, fully lazy-loaded:
- `core/` — `AuthService`, `CartService`, `ToastService`, `authGuard`, `authInterceptor`, `errorInterceptor`
- `features/` — `auth`, `catalog`, `cart`, `checkout`, `account` (protected), `home`
- `shared/` — Reusable UI components and pipes

API calls proxy `/api/*` → `http://localhost:3000` (configured in `proxy.conf.json`).

### Shared Types (`packages/shared-types/`)

Source of truth for enums (`Role`, `OrderStatus`, `PaymentStatus`, `ShipmentStatus`, `CarrierCode`) and request/response DTOs. Imported by both backend and frontend via `workspace:*`.

## Key Patterns

**Auth flow:** Access token (Bearer, 15m) injected by `authInterceptor`. Refresh token stored as httpOnly cookie (never exposed to JS). Token stored in DB as SHA-256 hash. On 401, `errorInterceptor` calls `/auth/refresh` and retries the original request.

**Payments:** Order created with `PENDING_PAYMENT` → backend creates a Stripe Checkout Session (cards + BLIK + P24 via Stripe) → frontend redirects to `session.url` → Stripe sends a signed webhook to `POST /payments/webhook` → controller verifies HMAC against `STRIPE_WEBHOOK_SECRET` using the raw body, then dispatches `checkout.session.completed` → PAID (and `expired`/`async_payment_failed` → CANCELLED with stock restored). Webhook endpoint needs `req.rawBody`, enabled via `NestFactory.create({ rawBody: true })`.

**Cart:** Items linked to `ProductVariant` (not `Product`). Both `sessionId` and `userId` can exist on a cart (anonymous → authenticated merge).

**Order items:** Store price/name/SKU snapshots at purchase time to preserve historical accuracy.

**Images:** Stored in Supabase (`storagePath` + `url` in `ProductImage`). Managed via `StorageModule`.

**Admin panel:** AdminJS + `@adminjs/prisma`. Uses express-session backed by PostgreSQL (`connect-pg-simple`). Auth via `ADMIN_DEFAULT_EMAIL` / `ADMIN_DEFAULT_PASSWORD` env vars.

## Database

Prisma schema at `backend/prisma/schema.prisma`. Uses two connection strings:
- `DATABASE_URL` — pooled (pgbouncer, port 6543, for runtime). Must include `?pgbouncer=true&connection_limit=10&pool_timeout=20` — caps Prisma's per-instance pool so multiple Railway replicas don't exhaust Supabase's shared transaction pool (~200 conns on Pro tier, ~60 on free).
- `DIRECT_URL` — direct (port 5432, for Prisma migrations only)

**Supabase Storage RLS:** policies for the `product-images` bucket live in [`backend/prisma/supabase/product-images-rls.sql`](backend/prisma/supabase/product-images-rls.sql) — Prisma can't manage the `storage` schema, so apply this manually via Supabase Dashboard → SQL Editor whenever the bucket is reprovisioned. Model: public SELECT (CDN reads), writes locked to service role (backend uses `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS).

Key model relationships: `User → Address[]`, `User → Order[]`, `Order → OrderItem[]`, `Order → Payment (1:1)`, `Order → Shipment (1:1)`, `Product → ProductVariant[]`, `Cart → CartItem[]`.

## Phase 0 Credential Status

**✅ Verified & Working:**
- Supabase: Connected, database initialized
- Resend: Email service tested, sending to `onboarding@resend.dev`
- Google OAuth: Credentials loaded, redirecting correctly to Google login
- **Stripe: TEST MODE** — using `sk_test_` / `pk_test_` keys. Real test charges via Stripe Dashboard → Developers, card `4242 4242 4242 4242` any future expiry, any CVC.
- **InPost ShipX: MOCK MODE ENABLED** for testing shipment creation without NIP/sandbox account

**⏳ Optional (Not needed for Phase 0):**
- DHL/GLS: Optional for Phase 0, needed only for shipment creation in Phase 1+
- `STRIPE_WEBHOOK_SECRET`: Required to verify webhook signatures. For local dev, install the Stripe CLI and run `stripe listen --forward-to localhost:3000/payments/webhook` — it prints a `whsec_` to paste into `backend/.env`. Without it, the webhook endpoint returns 400 on every request.

### Stripe (Development Testing)

- Test keys live in `backend/.env` (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`).
- Checkout Session enables `card`, `blik`, and `p24` payment methods — set in `stripe.client.ts`.
- Raw body is required for webhook signature verification — enabled in `main.ts` via `NestFactory.create({ rawBody: true })`.
- `STRIPE_CURRENCY` defaults to `pln`. `STRIPE_SUCCESS_URL` and `STRIPE_CANCEL_URL` are the redirect targets after Stripe-hosted checkout completes.
- **Test cards:** `4242 4242 4242 4242` (success), `4000 0000 0000 9995` (insufficient funds), `4000 0025 0000 3155` (3D Secure required). See https://stripe.com/docs/testing.

### InPost ShipX Mock Mode (Development Testing)

When `INPOST_MOCK_ENABLED=true` in `.env`:
- No real InPost API calls (uses placeholder credentials safely)
- Generates mock shipment IDs prefixed with `MOCK_INPOST_`
- Creates realistic mock tracking numbers
- Returns mock label URLs (format: `mock-label-{id}.pdf`)
- Safe for testing full shipment creation flow without sandbox account

InPost ShipX sandbox requires filling in company/invoice data including NIP in `sandbox-manager.paczkomaty.pl`, even for testing. Mock mode bypasses this blocker for Phase 0.

**Switch to real InPost:** Set `INPOST_MOCK_ENABLED=false` + register sandbox account at `sandbox-manager.paczkomaty.pl`, fill in company data, generate Organization ID and Bearer token from API tab

## Environment

Copy `.env.example` to `backend/.env`. Required external services: PostgreSQL/Supabase, Google OAuth, Stripe, InPost/DHL/GLS, Resend.

## Deployment

### Backend — Railway

Config lives in [`railway.json`](railway.json) at the repo root. Railway auto-detects the pnpm monorepo, runs `pnpm install` from the root (so `packages/shared-types` resolves via workspace), then:

- **Build:** `pnpm --filter backend exec prisma generate && pnpm --filter backend build`
- **Start:** `node backend/dist/main`
- **Pre-deploy:** `pnpm --filter backend exec prisma migrate deploy` — runs after build, before traffic is shifted. Blocks the deploy if migrations fail, which is what we want (no half-migrated prod).
- **Healthcheck:** `GET /health` (wired to `HealthController`, runs `SELECT 1` against Postgres + `PING` against Redis in parallel; returns `{ status, db, redis, timestamp }`). Timeout 300s.
- **Database backups (HARD GATE — required before Stripe live mode):** Supabase free tier has no PITR. Options: (a) upgrade to Supabase Pro (automatic PITR + daily snapshots), or (b) weekly `pg_dump` to S3/R2 via a Railway cron job. A missing backup before the first real customer order is a potential GDPR Art. 33 breach on data loss.
- **Restart policy:** `ON_FAILURE`.
- **Watch patterns:** limit rebuilds to `backend/**`, `packages/shared-types/**`, `pnpm-lock.yaml`, `package.json`, `railway.json` — frontend changes don't redeploy the backend.

**Build-layout gotcha:** `backend/tsconfig.build.json` must include `"include": ["src/**/*"]`. Without it, any stray `.ts` file at `backend/` root (e.g. old smoke-test scripts) shifts TypeScript's computed rootDir up one level and the compiled entrypoint ends up at `dist/src/main.js` instead of `dist/main.js` — breaking the Railway start command.

**Required Railway env vars** (set in the service's Variables tab — `backend/.env` is not used in production): all variables from `.env.example` — database URLs, JWT secrets, Google OAuth (with the Railway callback URL), Stripe keys + webhook secret, Resend API key, Supabase keys, Sentry DSN (optional), admin credentials, and `FRONTEND_URL` pointing at the deployed Vercel frontend.

#### Production env var checklist

`config.validation.ts` enforces the rules below when `NODE_ENV=production`. The app fails fast at boot on any violation — don't try to paper over a failure by loosening the schema.

| Variable | Production requirement | How to obtain |
|---|---|---|
| `NODE_ENV` | `production` | Railway auto-sets, but verify |
| `STRIPE_SECRET_KEY` | must start with `sk_live_` | Stripe Dashboard → Developers → API keys, **flip the "Test mode" toggle off first** |
| `STRIPE_PUBLISHABLE_KEY` | must start with `pk_live_` | same page as above |
| `STRIPE_WEBHOOK_SECRET` | required (non-empty) | Stripe Dashboard → Developers → Webhooks → Add endpoint → URL `https://<railway>/payments/webhook`, events `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_failed`, `charge.refund.updated` → copy "Signing secret" (`whsec_…`). **Each webhook endpoint has its own secret — test-mode and live-mode secrets are different, don't mix them up.** |
| `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` | must point at the Vercel frontend, not localhost | e.g. `https://<vercel>/checkout/success` |
| `RESEND_API_KEY` | required (no `re_mock` fallback) | Resend Dashboard → API Keys |
| `EMAIL_FROM` | must be an address on a **verified** domain | see Resend domain verification below |
| `REDIS_URL` | required — **hard gate**: BullMQ email queue (order confirmation, invoice, payment failure, shipping notification) silently never processes without a real Redis instance; `redis://localhost:6379` is the dev default but does not exist on Railway | Railway Dashboard → New Service → Redis → copy the connection URL |
| `PAYMENTS_RECONCILE_SECRET` | required (≥16 chars) — without it `POST /payments/reconcile` always returns 401 and the external-cron reconciliation path is silently broken | generate with `openssl rand -hex 32` |
| `ORDER_CANCEL_SECRET` | required (≥32 chars) — dedicated HMAC key for guest order cancel-link tokens, kept separate from `JWT_ACCESS_SECRET` so JWT rotation doesn't invalidate outstanding cancel links | generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `FRONTEND_URL` | Vercel production URL | used for CORS + OAuth redirects |
| `GOOGLE_CALLBACK_URL` | Railway production URL + `/auth/google/callback` | also whitelist it in Google Cloud Console → Credentials → Authorized redirect URIs |

#### Reconciliation cron (Railway hobby tier — required)

Railway's hobby tier containers sleep on inactivity. The in-process `@Cron` decorator does not fire while the container is sleeping, so `reconcilePendingPayments()` won't run overnight when no traffic arrives — leaving stuck `PENDING_PAYMENT` orders unresolved.

**Fix:** add a Railway Cron Job service (separate service, never sleeps) that pings the backend every 10 minutes:

```
# Railway Cron Job service — command field:
curl -s -o /dev/null -w "%{http_code}" \
  -X POST https://<your-backend-url>/payments/reconcile \
  -H "Authorization: Bearer $PAYMENTS_RECONCILE_SECRET"
```

Set `PAYMENTS_RECONCILE_SECRET` to the same value in both the backend service and the cron job service environment variables.

**Alternative (simpler, free):** configure [cron-job.org](https://cron-job.org) or UptimeRobot to `GET https://<backend>/health` every 5 minutes. This keeps the container awake so the built-in `@Cron` fires normally — no secret required, no Railway cron service needed. Sufficient for most hobby-tier deployments.

#### Resend domain verification (SPF + DKIM)

Until the sender domain is verified, `EMAIL_FROM` can only use Resend's shared sandbox address (`onboarding@resend.dev`), and those emails are rate-limited and can only be sent to the account owner — useless for real customers. Full flow:

1. Resend Dashboard → Domains → Add Domain → enter the apex domain (e.g. `fragrancestore.pl`, not a subdomain).
2. Resend shows DNS records to add. There are three:
   - **MX** record on `send.<domain>` pointing to `feedback-smtp.<region>.amazonses.com` — required for Resend to receive bounce/complaint reports (SPF alignment).
   - **TXT** SPF record on `send.<domain>`: `v=spf1 include:amazonses.com ~all`.
   - **TXT** DKIM record on `resend._domainkey.<domain>` (long base64 value — copy the entire string including the `p=` portion).
3. Add the records in your DNS provider (Cloudflare, OVH, etc.). Set **TTL to "Auto"** or the lowest allowed value; propagation is usually under 30 minutes but Resend will re-check every few hours if it's slow.
4. Resend Dashboard → Domains → click the domain → "Verify DNS Records". Wait for all three rows to show green.
5. Optional but recommended: add a DMARC record on `_dmarc.<domain>`: `v=DMARC1; p=none; rua=mailto:postmaster@<domain>`. Starts in monitor-only mode — once you see reports coming in cleanly, tighten to `p=quarantine` then `p=reject`.
6. Only after the domain is marked **Verified** in Resend, set `EMAIL_FROM=sklep@<domain>` in Railway and redeploy. Sending from an unverified domain throws at the API level.

Verification gotcha: if you're using Cloudflare, DNS records default to "Proxied" (orange cloud). **Switch MX and TXT records to DNS-only (grey cloud)** — Cloudflare's proxy strips the records otherwise and Resend's check fails with no useful error.

### Frontend — Vercel (SSR + hybrid prerender)

Config lives in [`vercel.json`](vercel.json) at the repo root. The project is deployed in **hybrid mode**: known static routes are prerendered at build time and served from Vercel's CDN edge; all other routes are server-side rendered on-demand by a Vercel Serverless Function.

- **Install:** `pnpm install --frozen-lockfile` (from repo root, so the `@fragrance-store/shared-types` workspace package resolves)
- **Build:** `pnpm --filter frontend build` — runs the `prebuild` sitemap generator then `ng build --configuration production`, which:
  - Prerenders the 6 static routes from [`frontend/prerender-routes.txt`](frontend/prerender-routes.txt) into `dist/frontend/browser/`
  - Emits the SSR server bundle to `dist/frontend/server/server.mjs`
- **Output directory:** `frontend/dist/frontend/browser` — static assets, hashed JS/CSS, prerendered HTML, `sitemap.xml`.
- **SSR function:** `api/ssr.mjs` (repo root) — Vercel Serverless Function; imports the Angular `CommonEngine` from `dist/frontend/server/server.mjs`; `includeFiles` in `vercel.json` bundles the full server+browser dist into the Lambda.
- **Routing:** Vercel checks static files first. Prerendered routes (e.g. `/`, `/products`) are served from the CDN without touching Node. Unmatched paths (e.g. `/products/:slug`, `/account/*`) hit the SSR function.
- **Cache headers:** `/assets/*` and hashed JS/CSS/fonts get `max-age=31536000, immutable`.
- **SSR entry files:** `frontend/src/server.ts` (Express server, exports `app(opts?)`), `frontend/src/main.server.ts` (Angular bootstrap + polyfills for localStorage/rAF).
- **Local SSR server:** `pnpm --filter frontend serve:ssr:frontend` → `node dist/frontend/server/server.mjs` (listens on port 4000).

**Vercel project settings** (set in the dashboard — do NOT override any of these or they clobber `vercel.json`):
- **Root Directory:** leave unset (= repo root). The monorepo build needs access to `pnpm-workspace.yaml` at the root.
- **Framework Preset:** Other (the `vercel.json` forces `framework: null` — Vercel's Angular preset tries to run `ng build` from the root, which fails in a monorepo).
- **Install / Build / Output Directory:** leave blank — `vercel.json` owns them.

**Required Vercel env vars** (Settings → Environment Variables, Production scope):
- `SITEMAP_BACKEND_URL=https://backend-production-c004.up.railway.app/api` — the `prebuild` sitemap generator hits this at build time to pull product/category slugs. Falls back to static routes only if unreachable, so the build never hard-fails.
- `SITEMAP_SITE_URL=https://<your-vercel-domain>` — the canonical URL written into `sitemap.xml`.

**Post-deploy backend sync:** after the first Vercel deploy, copy the production URL and set it as `FRONTEND_URL` in Railway's backend env vars (needed for CORS and the OAuth redirect whitelist). Also update `GOOGLE_CALLBACK_URL` in Google Cloud Console if you want OAuth to work from the Vercel origin.

## Development Roadmap State

- **Phase 1 (backend core):** ~95% complete
- **Phase 2 (AdminJS panel):** Stub only — `AdminModule` needs implementation
- **Phase 3 (tests):** Not started — priority targets: `AuthService`, `PaymentsService.handleWebhookEvent`, `OrdersService.createFromCart`, `CartService.addItem`, frontend `errorInterceptor`
- **Phase 4 (security/hardening):** Stripe webhook signature verification is wired (`StripeClient.constructWebhookEvent`), provided `STRIPE_WEBHOOK_SECRET` is configured in each environment.
