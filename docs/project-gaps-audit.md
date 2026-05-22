# Project Gaps Audit — Fragrance E-Commerce (Aromaterie)

> Generated via 5-agent stochastic consensus — 2026-05-22
> Agents: Domain Expert · Security Skeptic · UX Pragmatist · Infrastructure First-Principles · Risk Analyst

---

## Legend

| Label | Meaning |
|---|---|
| 🔴 BLOCKER | Must fix before any real customers |
| 🟠 HIGH | Causes real loss / legal exposure if ignored |
| 🟡 MEDIUM | Degrades UX or maintainability significantly |
| 🟢 LOW | Nice-to-have polish |

Agent agreement is noted where 2+ agents independently identified the same issue.

---

## 1. SEO & Indexability

### 🔴 BLOCKER — Static sitemap excludes all product pages
- `frontend/prerender-routes.txt` contains only 6 static routes; no product slugs
- `sitemap.xml` (if pre-generated) mirrors the same list
- **Effect:** Googlebot sees blank JS shells for every product page — zero organic traffic from Google Shopping or branded searches
- **Fix:** Use `SITEMAP_BACKEND_URL` (already wired in Vercel env) to pull all product/category slugs at build time and emit them into `sitemap.xml`; expand `prerender-routes.txt` to include at least `/products/:slug` for each product

### 🟠 HIGH — SSR configured but product pages not prerendered
- Angular SSR `server.ts` exists and the Common Engine is wired
- Only the 6 routes in `prerender-routes.txt` benefit from SSR prerendering at build time; all others fall back to client-side rendering
- **Effect:** Product detail pages (the pages Google needs to rank) render as blank `<app-root>` to crawlers
- **Fix:** Either expand the prerender list or verify that the Vercel SSR function (`api/ssr.mjs`) is correctly handling product URLs server-side on every request (not just prerender time)

---

## 2. Analytics & Conversion Tracking

### 🔴 BLOCKER — No analytics or conversion tracking anywhere
- No `gtag`, GTM script, `GoogleAnalyticsService`, or any analytics hook found across frontend
- `checkout-success.component.ts` fires no purchase event on Stripe success
- **Effect:** No funnel visibility, no attribution, no way to measure CAC, ROAS, or conversion rate
- **Fix:** Add GTM container to `index.html`; fire `purchase` event with `transaction_id`, `value`, `currency` on checkout success; fire `add_to_cart` / `begin_checkout` events in cart and checkout flow

---

## 3. Legal & Compliance (RODO / EU Consumer Law)

### 🔴 BLOCKER — Cookie consent non-compliant
- `cookie-consent.component` exists and has `role="dialog"` / `aria-live` — good structure
- But: only "essential cookies" offered with no opt-in/opt-out for analytics or marketing categories
- **Effect:** RODO (Polish GDPR implementation) requires explicit opt-in consent before any non-essential cookies are set. If GTM / GA is added (as it must be — see above), this becomes an active violation from day one
- **Fix:** Add a preference centre with at minimum two switches: Essential (locked) and Analytics (opt-in). Persist consent in localStorage. Block GA/GTM until consent granted

### 🟠 HIGH — GDPR data deletion: documented but unimplemented
- Privacy policy (confirmed present at `/legal/privacy`) states data is deleted on request
- No `DELETE /users/:id` endpoint with ownership verification found in backend
- No frontend button to trigger account deletion from `/account/profile`
- **Fix:** Add `UsersService.deleteAccount()` → hard-delete user row, anonymise order history (GDPR Art. 17 + 20); expose as `DELETE /users/me`; add button in account settings

### 🟡 MEDIUM — Right-of-withdrawal form is static (print/email only)
- `/legal/withdrawal` shows a template customers must print or email manually
- No in-app submission flow
- **Fix:** Wire the existing `/returns` frontend flow to also cover Art. 27 withdrawal cases; or at minimum add a mailto link that pre-fills the withdrawal template

---

## 4. Security

### 🔴 BLOCKER (dev/staging) — Admin panel unprotected when env vars absent
- `admin.setup.ts` logs a warning but still boots `AdminJSExpress.buildRouter(admin)` without auth if `ADMIN_DEFAULT_EMAIL` / `ADMIN_DEFAULT_PASSWORD` are missing
- **Effect:** Any network-reachable staging/preview deployment exposes full order management, refunds, and user data with no login
- **Fix:** Throw at startup (not just warn) if admin credentials are not set; or return HTTP 503 on all `/admin/*` routes

### 🟠 HIGH — Stock oversell race condition
- `cart.service.ts → addItem()` performs two separate queries (stock lookup, then write) with no database transaction
- **Effect:** Under concurrent load, two users can both pass the stock check for the last item and both succeed — inventory goes negative
- **Fix:** Wrap the check-and-decrement in a Prisma `$transaction` with a `SELECT ... FOR UPDATE` equivalent (`prisma.$transaction` + optimistic concurrency or `updateMany` with `where: { stock: { gte: quantity } }` returning the row count to detect contention)

### 🟠 HIGH — Returns endpoint has no auth guard
- `returns.controller.ts` accepts return requests without JWT validation
- No check that the `orderNumber` in the payload belongs to the submitting user
- **Effect:** Anyone can spam fake return requests; real order IDs can be guessed/enumerated
- **Fix:** Add `@UseGuards(JwtAuthGuard)` to the returns controller; validate `order.userId === req.user.id`

### 🟠 HIGH — Refresh tokens not invalidated on password change/reset
- `resetPassword()` flow does not revoke all active refresh tokens for the user
- **Effect:** An attacker who obtained a refresh token before the victim's password reset retains access until the 7-day token TTL expires
- **Fix:** On password change/reset, call `UsersService.invalidateAllRefreshTokens(userId)` (delete all `RefreshToken` rows for that user)

### 🟡 MEDIUM — Cart merge race condition on login
- `mergeGuestCart()` is not wrapped in a transaction; items added to the guest cart between the lookup and deletion get orphaned
- **Fix:** Wrap the entire merge operation in `prisma.$transaction`

### 🟡 MEDIUM — No body size limit or request timeout configured
- `main.ts` uses default body limit (~100 KB) and no request timeout
- Invoice PDF payloads and large cart updates can exceed this; Stripe calls can hang indefinitely
- **Fix:** Set `bodyLimit: '10mb'` for file upload routes; add `app.use(timeout('30s'))` or NestJS `TimeoutInterceptor`

### 🟢 LOW — CSRF not implemented
- Low risk for a pure SPA (no cookie-based auth for API calls), but the AdminJS panel uses express-session cookies
- **Fix if AdminJS is ever exposed on a separate subdomain:** Add `csurf` or `nestjs-csrf` for the `/admin` session cookie path

---

## 5. Backend — Missing / Incomplete Implementations

### 🟠 HIGH — `new_order_notification` email never triggered
- Job type is defined in `email-queue.types.ts` and the processor switch exists, but the job is never enqueued in `OrdersService.createFromCart()`
- **Effect:** Admin receives no alert when an order is placed — you will miss orders until you manually check AdminJS
- **Fix:** Add `this.emailQueue.add('new_order_notification', { orderId, ... })` at the end of `createFromCart()`

### 🟠 HIGH — Redis not in health check
- `GET /health` checks Postgres but not Redis
- **Effect:** A dead Redis connection (which silently kills all email jobs and rate limiting) appears healthy to Railway's healthcheck — no automatic restart triggered
- **Fix:** Add `redis.ping()` + BullMQ queue depth check to `HealthController`

### 🟡 MEDIUM — Missing database indexes on hot query paths
The Prisma schema has `@unique` constraints but no explicit `@@index` directives on:
- `User.email` — every auth login is a full table scan
- `Product.slug` — every product detail page load
- `Order.userId` — every order history page load
- `Category.slug` — category navigation queries

**Fix:** Add to `schema.prisma`:
```prisma
@@index([email])         // User
@@index([slug])          // Product
@@index([userId])        // Order
@@index([slug])          // Category
```
Then run `pnpm db:migrate`.

### 🟡 MEDIUM — No `GET /orders/:id/events` endpoint
- `OrderEvent` table exists in Prisma schema (audit trail)
- No API endpoint exposes it; frontend order detail cannot show status history
- **Fix:** Add `OrdersController` route that returns events for an order owned by the authenticated user

### 🟡 MEDIUM — Manual invoice generation has no admin endpoint
- `InvoiceService.processInvoice()` exists but is only callable through AdminJS action handlers
- No `POST /orders/:id/invoice` endpoint for programmatic admin tooling or edge cases
- Low urgency if AdminJS is the primary admin surface

---

## 6. Frontend — Missing User-Facing Features

### 🟠 HIGH — InPost paczkomat picker incomplete
- Checkout Step 2 has a text input for the locker code with a comment "full map coming soon"
- **Effect:** Customers cannot browse paczkomat locations; conversion drop for InPost (the most popular delivery method in Poland)
- **Fix:** Integrate [InPost Leaflet Map Widget](https://dokumentacja-api.inpost.pl/docs/shipx/) or use the InPost Geowidget iframe

### 🟡 MEDIUM — No related/recommended products
- Product detail page has gallery, reviews, stock badge, olfactory pyramid — but nothing below reviews
- **Effect:** Zero cross-sell; high exit rate after viewing a single product
- **Fix:** Add a "You may also like" section (4-6 products from same category or adjacent price range) using the existing `ProductsService.findAll()` with category filter

### 🟡 MEDIUM — No custom 404 page
- `app.routes.ts` wildcard route (`**`) redirects to home (`''`) instead of a 404 component
- **Effect:** Broken links / mistyped URLs silently redirect to home — confusing UX, also hurts SEO (Google interprets soft-404s)
- **Fix:** Create a `NotFoundComponent`; replace the wildcard redirect with `{ path: '**', component: NotFoundComponent }`

### 🟡 MEDIUM — No newsletter signup
- No newsletter form in footer, homepage hero, or post-purchase flow
- **Effect:** No email list building; lost re-engagement channel
- **Fix:** Minimal: one-field email form in footer → `POST /newsletter/subscribe` → queued welcome email

### 🟡 MEDIUM — No invoice download in order detail
- Admin can generate invoices via AdminJS; customer cannot download their own invoice from `/account/orders/:id`
- **Effect:** Polish law requires providing VAT invoice to any customer who requests one
- **Fix:** Add "Download invoice" button in order detail that hits `GET /orders/:id/invoice` (PDF stream or signed Supabase URL)

### 🟢 LOW — No skeleton loading screens
- Product list, product detail, checkout, and order history use text "Loading..." states instead of skeleton placeholders
- **Fix:** Use TuiSkeleton (Taiga UI has one) or build simple CSS skeleton components

### 🟢 LOW — No estimated delivery dates
- Checkout summary and order confirmation show no estimated delivery window
- **Fix:** Display carrier-specific estimates (InPost: next-day, DHL/GLS: 1–3 days) in checkout summary and order confirmation email

---

## 7. Infrastructure & Observability

### 🔴 BLOCKER — Redis not provisioned on Railway (hard gate)
- CLAUDE.md explicitly calls this out: BullMQ silently drops all email jobs if `REDIS_URL` is not set to a real instance
- **Effect:** Order confirmations, payment receipts, invoices, shipping notifications — all silently disappear
- **Fix:** Railway Dashboard → New Service → Redis → copy URL → set `REDIS_URL` env var → redeploy

> Note: Sentry is correctly implemented on both backend (`@sentry/nestjs`, `instrument.ts`) and frontend (`@sentry/angular`, `main.ts`). Structured logging via `nestjs-pino` is also solid. These are not gaps.

---

## 8. Positive Findings (Not Gaps)

These were listed as concerns in CLAUDE.md or assumed incomplete — all are actually done:

| Area | Status |
|---|---|
| AdminJS panel | Fully implemented (730+ lines): catalog CRUD, order management, invoice download, label generation, bulk ship/cancel, picklist HTML, customer stats, review moderation |
| Sentry backend | `instrument.ts` + OpenTelemetry wired, profiling enabled |
| Sentry frontend | `@sentry/angular` initialized in `main.ts` + `main.server.ts` |
| BullMQ processors | 14/14 job types mapped; retry logic, exponential backoff, auto-cleanup |
| Rate limiting | `ThrottlerModule` Redis-backed, 5 req/s burst / 60 req/min sustained |
| Input validation | Global `ValidationPipe` with whitelist + forbidNonWhitelisted + transform |
| Helmet | Enabled globally; CSP bypassed only for `/admin` (required by AdminJS inline scripts) |
| Refund flow | Full + partial refund, stock restoration, Stripe reconciliation cron |
| Legal pages | `/legal/terms`, `/legal/privacy`, `/legal/withdrawal` all present |
| Wishlist | `/wishlist` route with "notify when back in stock" feature |
| Returns flow | `/returns` route, form captures withdrawal + complaint types |
| Order tracking | `/orders/track` for guest lookup |
| Config validation | Joi schema enforces all critical vars in production; app fails fast on missing secrets |

---

## Prioritised Fix List

### Must fix before launch (blockers)

1. Provision Redis on Railway → set `REDIS_URL`
2. Generate dynamic sitemap with product slugs
3. Add Google Analytics / GTM + purchase event on checkout success
4. Make cookie consent RODO-compliant (opt-in for analytics)
5. Throw startup error when admin credentials are absent (not just log)

### Should fix before first real customer

6. Add `new_order_notification` enqueue in `createFromCart()`
7. Add Redis ping to `/health` endpoint
8. Fix stock oversell race condition (transaction on add-to-cart)
9. Add auth guard + ownership check to returns controller
10. Invalidate refresh tokens on password reset
11. Add 4 missing Prisma indexes (`User.email`, `Product.slug`, `Order.userId`, `Category.slug`)
12. Implement InPost Geowidget in checkout Step 2
13. Add GDPR account deletion endpoint + frontend button

### High-value improvements (post-launch sprint)

14. Expand SSR prerender routes to cover all product slugs
15. Add related products section on product detail
16. Create custom 404 page
17. Add newsletter signup form in footer
18. Add invoice download button in `/account/orders/:id`
19. Add `GET /orders/:id/events` endpoint for order audit trail
