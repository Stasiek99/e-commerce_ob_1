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

**Search:** Both `GET /products?search=` and the autocomplete `GET /products/suggest` run through one matcher, `ProductsService.rankedSearchIds()`. It queries a single denormalized column, `products."searchText"`, holding the normalized concatenation of name + catalogNumber + inspiredBy + brand + shortDescription + notes + scentFamily + line + category name + the joined `LuxuryReference` (brand, name, aliases). The column is written **only** by the `products_search_text_sync` DB trigger — never from application code, because AdminJS writes to the table directly. Sibling triggers re-sync it when a `luxury_references` row or a category name changes.

Two normalizers must stay identical: `normalize_search_text()` in Postgres (writes the haystack) and `normalizeSearchText()` in `backend/src/modules/products/search/search-query.util.ts` (normalizes the query). Both lowercase, fold diacritics to ASCII (`Lancôme` → `lancome`), drop `&.,'` *without* inserting a space so `D&G` collapses to the single token `dg`, and reduce everything else to spaces. Changing one without the other silently breaks matching — the util file carries the full contract in its header comment, and `search-query.util.spec.ts` pins the query half.

Query flow: normalize → expand brand abbreviations token-by-token (`dg` → `dolce gabbana`, `ysl` → `yves saint laurent`) → AND one predicate per token, each `LIKE '%token%' OR token <% "searchText"`. The `<%` trigram branch is applied only to tokens of ≥4 characters (`FUZZY_MIN_TOKEN_LENGTH`) — word similarity on a 2–3 character token matches most of the catalog. If the AND pass returns nothing, a relaxed OR pass runs with a coverage floor of ⌈tokens/2⌉ matched tokens. Ranking is a weighted sum: catalog-number hit > exact alias > reference brand > reference name > inspiredBy > product name, plus token coverage and a `word_similarity` tie-break.

Brand abbreviations live in one place, `backend/src/modules/products/search/brand-aliases.ts`, imported by both `prisma/seed.ts` (which writes them into `luxury_references.aliases`) and the query expander. Adding a brand means editing that file only.

Indexing: `products_search_text_trgm_idx` is a GIN `gin_trgm_ops` index serving both the `LIKE '%…%'` and `<%` predicates. **Any migration that bulk-rewrites `products` must end with `ANALYZE "products";`** — without fresh statistics the planner ignores the trigram index and falls back to a Seq Scan.

**Fragrance finder** (`/dobierz-zapach`): a picker for shoppers who cannot name what they want — the store's product names are invented, so "Aqua Soul" tells a first-time visitor nothing. Two backend routes:

- `GET /products/finder/notes` — note vocabulary, derived from the catalog (not hardcoded) so it cannot drift from what is purchasable. Returns `{ key, label, count }`: `key` is normalized, `label` is the most common raw spelling ("Jaśmin"). Capped at `FINDER_NOTE_VOCABULARY_SIZE` (24) — the catalog has ~255 distinct notes with a long tail.
- `GET /products/finder/match?notes=…&gender=…&category=…&exclude=…` — ranks by `recall * 100 + precision * 20` (ported from the reference project's `matchByNotes`). Recall dominates so a product covering both picked notes beats one covering only the first; precision is the tie-break that stops a 20-note pyramid winning on surface area alone. Accepts either normalized keys or raw display strings — both go through `normalizeSearchText`, so the product page can pass its own `notes` verbatim.

Matching runs against `products."notesNormalized"`, a deduplicated normalized copy of `notes` maintained by the same trigger as `searchText` and GIN-indexed for the `&&` overlap prefilter. **Gender/category/exclude filters must stay inside the ranked SQL, never applied to its LIMITed output** — filtering afterwards made `wanilia + dyfuzory` return zero results, because top-scoring perfumes consumed the entire limit first. `products.service.finder.spec.ts` pins this.

**Data gap:** the 12 products in "Dyfuzory i odświeżacze" have empty `notes[]`, so they cannot participate in note matching at all. Perfumes, luxury perfumes and gels are fully covered. Populating diffuser notes is a seed/admin data task, not a code change.

Frontend: one reusable `FragranceFinderComponent` (`shared/components/fragrance-finder/`) rendered inline on `/dobierz-zapach`, in the catalog's empty search state, and lazily inside a Taiga dialog from the header button. The home page links to the route rather than embedding the widget — `/` is prerendered and must stay light. Its `name` mode calls `GET /products?search=` (not `/products/suggest`) because the result cards need variant `id`/`stock` for add-to-cart, which the trimmed suggest payload omits.

**Search-as-you-type plumbing is shared, endpoints are not.** Every search surface (header autocomplete, both finder modes) runs on `createSearchStream` / `createTextSearchStream` in [`core/utils/search-stream.ts`](frontend/src/app/core/utils/search-stream.ts): `debounce → normalize → distinctUntilChanged → switchMap`, with `SEARCH_DEBOUNCE_MS` / `SEARCH_MIN_LENGTH` from `core/constants/search.constants.ts`. Do not hand-roll this again — when it existed as two copies each grew its own defect: the finder subscribed per keystroke with no `switchMap` (a slow early response could overwrite a newer one), and the header ran `distinctUntilChanged` on the untrimmed value (so `"dg"` → `"dg "` fired a duplicate query). Ordering is load-bearing: normalizing *before* the distinct check is what makes a trailing space a repeat rather than a new search. Use `search()` for typed input (debounced, de-duplicated) and `refresh()` when a filter changes but the term does not — `refresh` deliberately bypasses `distinctUntilChanged`, which would otherwise swallow it.

The header also mirrors `?q=` back into the search box (`route.queryParamMap` → `setValue(..., { emitEvent: false })`). Without it, arriving at the catalog by shared link, reload, or browser-back showed "Wyniki dla: dg" above an empty search bar. The `emitEvent: false` is what prevents a feedback loop with the search-as-you-type pipeline that navigates on input.

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

### Branch model

`develop` is the real integration branch — all PRs land there and CI (`.github/workflows/ci.yml`) gates merges into it. `main` is a **deploy-only mirror of develop**: Railway and Vercel are configured to track `main`, but no work happens directly on it.

Keeping `main` in sync is automated by [`.github/workflows/promote-main.yml`](.github/workflows/promote-main.yml): a weekly scheduled job (Mondays 06:00 UTC) plus a manual `workflow_dispatch` trigger. It only fast-forwards `main` to `develop`'s tip if the latest CI run for `develop`'s current commit concluded `success`; otherwise it's a silent no-op (logged as a `::notice::`, not a failure). This exists because `main` was previously promoted manually and drifted ~2 months stale (rounds 10-13 hardening sat unmerged into prod) — see `docs/audit-round-14.md`.

If you need to deploy sooner than the weekly schedule, trigger the workflow manually from the Actions tab instead of merging directly into `main`.

**Known gap — no branch protection on `main` or `develop`:** this repo is private on GitHub's Free plan, which 403s both the classic branch-protection API and the newer rulesets API ("Upgrade to GitHub Pro or make this repository public to enable this feature"). Practically, nothing currently stops a force-push, direct push, or branch deletion on `main`/`develop` outside of this documented process. Closing this gap requires either upgrading to GitHub Pro/Team or making the repo public — a cost/visibility tradeoff for the repo owner to decide, not something to silently work around. Once available, `main` should require the `build-and-test` and `e2e` status checks, disallow force-pushes, and disallow deletion.

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

**Node version pin:** the root `.nvmrc` and the root `package.json` `engines.node` must always be set to the same exact version. CI's `actions/setup-node` reads `.nvmrc` via `node-version-file`. Railway's Railpack builder reads `engines.node` first (higher priority than `.nvmrc` — see [railpack.com/languages/node](https://railpack.com/languages/node/)), so `.nvmrc` alone would not pin the Railway runtime. Bumping the Node version means editing both files together, never just one.

**Required Railway env vars** (set in the service's Variables tab — `backend/.env` is not used in production): all variables from `.env.example` — database URLs, JWT secrets, Google OAuth (with the Railway callback URL), Stripe keys + webhook secret, Resend API key, Supabase keys, Sentry DSN (see production checklist below — required, not optional), admin credentials, and `FRONTEND_URL` pointing at the deployed Vercel frontend.

#### Production env var checklist

`config.validation.ts` enforces the rules below when `NODE_ENV=production`. The app fails fast at boot on any violation — don't try to paper over a failure by loosening the schema.

| Variable | Production requirement | How to obtain |
|---|---|---|
| `NODE_ENV` | `production` | Railway auto-sets, but verify |
| `STRIPE_SECRET_KEY` | must start with `sk_live_` | Stripe Dashboard → Developers → API keys, **flip the "Test mode" toggle off first** |
| `STRIPE_PUBLISHABLE_KEY` | must start with `pk_live_` | same page as above |
| `STRIPE_WEBHOOK_SECRET` | required (non-empty) | Stripe Dashboard → Developers → Webhooks → Add endpoint → URL `https://<railway>/payments/webhook`, events `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_failed`, `charge.refund.updated`, `charge.dispute.created`, `charge.dispute.closed`, `payout.failed` → copy "Signing secret" (`whsec_…`). **All 7 events must be selected** — `handleWebhookEvent` (`payments.service.ts:241-277`) has working, tested handlers for the dispute/payout events, but Stripe only delivers event types explicitly subscribed on the endpoint; omitting them silently disables the entire `DISPUTE_HOLD` state machine and payout-failure alerting (`docs/business-process-model.md` finding A6). **Each webhook endpoint has its own secret — test-mode and live-mode secrets are different, don't mix them up.** |
| `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` | must point at the Vercel frontend, not localhost | e.g. `https://<vercel>/checkout/success` |
| `RESEND_API_KEY` | required (no `re_mock` fallback) | Resend Dashboard → API Keys |
| `EMAIL_FROM` | must be an address on a **verified** domain | see Resend domain verification below |
| `REDIS_URL` | required — **hard gate**: BullMQ email queue (order confirmation, invoice, payment failure, shipping notification) silently never processes without a real Redis instance; `redis://localhost:6379` is the dev default but does not exist on Railway | Railway Dashboard → New Service → Redis → copy the connection URL |
| `PAYMENTS_RECONCILE_SECRET` | required (≥16 chars) — without it `POST /payments/reconcile` always returns 401 and the external-cron reconciliation path is silently broken | generate with `openssl rand -hex 32` |
| `ORDER_CANCEL_SECRET` | required (≥32 chars) — dedicated HMAC key for guest order cancel-link tokens, kept separate from `JWT_ACCESS_SECRET` so JWT rotation doesn't invalidate outstanding cancel links | generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `FRONTEND_URL` | Vercel production URL | used for CORS + OAuth redirects |
| `GOOGLE_CALLBACK_URL` | Railway production URL + `/auth/google/callback` | also whitelist it in Google Cloud Console → Credentials → Authorized redirect URIs |
| `SENTRY_DSN` | required (non-empty URI) — boot-fatal if missing; `config.validation.ts` only allows blank/absent outside production | Sentry Dashboard → Project Settings → Client Keys (DSN) |
| `SENTRY_RELEASE` | not required — `instrument.ts` falls back to Railway's auto-injected `RAILWAY_GIT_COMMIT_SHA` when unset, which already matches the SHA CI tags its sourcemap upload with | no action needed; only set manually if you want to override the release name for a specific deploy |

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
- `SITEMAP_BACKEND_URL=https://backend-production-c004.up.railway.app` — the `prebuild` sitemap generator hits this at build time to pull product/category slugs. **No `/api` suffix** — the backend has no global route prefix (see `main.ts`, `railway.json`'s `healthcheckPath: /health`, and `environment.prod.ts`'s `apiUrl`, none of which use `/api`). When this var is set, the build now **hard-fails** if the resolved route count never rises above the static-only baseline (retries 3x with backoff first) — it no longer silently degrades, so a wrong URL here breaks the build loudly instead of shipping a near-empty sitemap.
- `SITEMAP_SITE_URL=https://<your-vercel-domain>` — the canonical URL written into `sitemap.xml`.

**Post-deploy backend sync:** after the first Vercel deploy, copy the production URL and set it as `FRONTEND_URL` in Railway's backend env vars (needed for CORS and the OAuth redirect whitelist). Also update `GOOGLE_CALLBACK_URL` in Google Cloud Console if you want OAuth to work from the Vercel origin.

## Development Roadmap State

- **Phase 1 (backend core):** ~95% complete
- **Phase 2 (AdminJS panel):** Stub only — `AdminModule` needs implementation
- **Phase 3 (tests):** Not started — priority targets: `AuthService`, `PaymentsService.handleWebhookEvent`, `OrdersService.createFromCart`, `CartService.addItem`, frontend `errorInterceptor`
- **Phase 4 (security/hardening):** Stripe webhook signature verification is wired (`StripeClient.constructWebhookEvent`), provided `STRIPE_WEBHOOK_SECRET` is configured in each environment.
