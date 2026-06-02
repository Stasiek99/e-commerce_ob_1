# E-Commerce Audit — Round 4
*Generated: 2026-06-02 — 7-agent stochastic consensus*
*Agents: Domain Expert · Security Skeptic · Risk Analyst · Frontend Expert · DB/Data Expert · Infrastructure Expert · Contrarian Innovator*

> **Excludes** everything already in `audit-weak-points.md`, `audit-round-2.md`, `audit-round-3.md`, and `project-gaps-audit.md`.
> **Excludes** Phase 7 (pre-launch checklist) items in ROADMAP.md.

---
Done:

## 🟠 HIGH — Vercel SSR missing `Vary: Cookie` — authenticated user response cached for all visitors *(3/7 agents)*
**File:** `api/ssr.mjs`
The Angular SSR Serverless Function returns HTML without a `Vary: Cookie` header. Vercel's CDN caches responses keyed on the URL path alone. If an authenticated user visits `/products`, the SSR response (which may include their name in the navigation header, cart count, or personalized state) is cached at Vercel edge and served to every subsequent anonymous visitor hitting the same URL — leaking account data to strangers. The inverse is also true: an anonymous (empty-cart) response is cached and returned to a logged-in user, hiding their cart state.
Additionally, authenticated account-level routes (`/account/*`) should never be cached at all — no `Cache-Control: no-store` or `private` directive is currently set for these paths.
**Fix:** In `api/ssr.mjs` (or in Angular's `server.ts` Express middleware), set `res.setHeader('Vary', 'Cookie')` globally. Add `Cache-Control: no-store` for routes starting with `/account`, `/checkout`, `/cart`.
---

## 🟠 HIGH — Pino logger does not redact request body — plaintext passwords in Railway logs *(2/7 agents)*
**File:** `backend/src/app.module.ts:45-46`
The `nestjs-pino` configuration redacts `req.headers.authorization` and `req.headers.cookie`, but does NOT redact the request body. Every `POST /auth/login`, `POST /auth/register`, and `POST /auth/reset-password` request logs the raw body including `{ email, password }` and `{ newPassword }` in plaintext to Railway's log aggregator.
Railway logs are stored and searchable. Anyone with Railway dashboard access (or a Railway log export) sees every user's plaintext password. This is a GDPR Art. 32 (security of processing) violation and a PCI-DSS concern.
**Fix:** Extend the redact array:
```ts
redact: [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.newPassword',
  'req.body.confirmPassword',
  'req.body.nip',         // B2B tax ID
  'req.body.bankAccount', // IBAN on return requests
]
```

## 🟠 HIGH — Open redirect via unvalidated `returnTo` query parameter — post-login phishing *(2/7 agents)*
**File:** `frontend/src/app/features/auth/google-callback/google-callback.component.ts:22`, `frontend/src/app/features/auth/login/login.component.ts`
After OAuth callback and after email/password login, the app reads `returnTo` from `sessionStorage` (set from the query param) and calls `this.router.navigateByUrl(returnTo)` without validating whether the URL is relative. An attacker crafts:
```
https://store.pl/auth/login?returnTo=https://attacker.com/steal-session
```
After a successful login, the user is silently redirected to `attacker.com`, which displays a fake "confirm your session" form and steals their credentials or OAuth token. This bypasses Angular's same-origin routing because `navigateByUrl` with an absolute URL triggers a full browser navigation.
**Fix:**
```ts
const raw = sessionStorage.getItem('auth_return_to') ?? '/';
const safe = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
this.router.navigateByUrl(safe);
```

## 🟠 HIGH — Invoice Supabase storage bucket has no RLS policy — any user can access another user's invoice PDF *(2/7 agents)*
**File:** `backend/src/modules/storage/storage.service.ts:65-75`, `backend/prisma/supabase/product-images-rls.sql`
The `product-images` bucket has an explicit RLS policy file (`product-images-rls.sql`) enforcing public SELECT but write-only for service role. No equivalent `invoices-rls.sql` exists for the invoices bucket. Invoice PDFs contain the customer's full name, street address, NIP (tax ID), all order items, and price paid.
If the invoices bucket defaults to `public = true` (Supabase's legacy default for buckets created without explicit RLS), the path is:
```
https://<project>.supabase.co/storage/v1/object/public/invoices/order-<orderId>-<timestamp>.pdf
```
Order UUIDs are not secret — they appear in the URL when the customer views their order. Any user can construct a valid invoice URL for another user by substituting a known/guessed `orderId`.
**Fix:** Create `backend/prisma/supabase/invoices-rls.sql` and apply it manually:
```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', false)
ON CONFLICT (id) DO UPDATE SET public = false;
-- Only service role can read/write (signed URLs issued by backend bypass RLS)
CREATE POLICY "no public reads" ON storage.objects
  FOR SELECT USING (bucket_id = 'invoices' AND false);
```
All invoice access should go through `GET /orders/:id/invoice` which re-signs a short-lived (1h) URL after validating `order.userId === requestingUserId`.
---

## 🟠 HIGH — BullMQ email jobs have no `jobId` — reconciliation cron + webhook fire duplicate emails *(2/7 agents)*
**File:** `backend/src/modules/email/email-queue.service.ts:21-28`
All email jobs are enqueued with auto-generated UUIDs (no explicit `jobId`):
```ts
await this.queue.add(name, data, JOB_OPTIONS);  // no jobId
```
When `checkout.session.completed` fires, the webhook handler enqueues `payment_confirmed_with_invoice`. Ten minutes later, the reconciliation cron (`reconcilePendingPayments`) also detects the payment and enqueues a second `payment_confirmed_with_invoice` for the same order. Both are distinct BullMQ jobs with different IDs — both execute, both send. Customer receives two order-confirmation emails with two invoice PDFs attached. The double send also creates a second Supabase invoice upload, consuming storage.
**Fix:** Set a deterministic `jobId` per order per event type:
```ts
await this.queue.add(name, data, {
  ...JOB_OPTIONS,
  jobId: `${name}-${orderId}`,  // idempotent key
});
```
BullMQ will reject the second `add` with the same `jobId` if the first is still active/completed.
---

## 🟠 HIGH — Refund issued before confirming physical return receipt — financial fraud exposure *(1/7 agents)*
**File:** `backend/src/modules/returns/returns.service.ts`
The `markRefunded()` method calls `paymentsService.refundPayment()` when an admin clicks "Approve" on a WITHDRAWAL return. There is no mechanism to confirm the customer actually shipped the item back. Polish consumer law (Art. 32 UoK) allows the merchant to withhold refund until the returned item is received **or** the customer provides proof of shipment.
At current price points (€50–150 per fragrance bottle), a fraud ring can:
1. Order 10–20 bottles using different accounts
2. File WITHDRAWAL returns immediately
3. Receive Stripe refunds upon admin approval
4. Never ship anything back
With a busy admin clicking through a returns queue, this is a PLN 5,000–20,000+ one-time fraud exposure per campaign.
**Fix:** Add `returnTrackingNumber` to the `ReturnRequest` model. Split the approval flow: "Received item" status triggers `markRefunded()` rather than a single "Approve" action. Until a tracking number proving return shipment exists on the record, block the refund button in AdminJS.
---

## 🟠 HIGH — AdminJS admin credentials not rotatable without redeployment + no admin action audit trail *(1/7 agents)*
**File:** `backend/src/modules/admin/admin.setup.ts`
Two compounding issues:
1. **Credential rotation requires a Railway env var change + full redeployment** (~5–10 minutes). If `ADMIN_DEFAULT_PASSWORD` is compromised (e.g., leaked via a git commit or Railway log grep), the attacker has up to ~10 minutes of unobstructed admin access to approve fake refunds, export customer data, or modify product prices before the credential can be rotated.
2. **The `adminPassword ?? 'dev-admin-secret'` fallback** means if `ADMIN_DEFAULT_PASSWORD` is absent from the Railway env, the panel is accessible with the hardcoded string `dev-admin-secret`. The existing audit flags the panel as unprotected when env vars are absent (from `project-gaps-audit.md`), but the specific fallback string is a concrete attack vector.
3. **No audit trail**: AdminJS actions (approve return, cancel order, generate label, update price) are not logged anywhere. After a credential compromise, you cannot determine what the attacker did.
   **Fix:** (a) Throw at startup if `ADMIN_DEFAULT_PASSWORD` is missing (no fallback). (b) Add an `AdminLog` Prisma model with `action`, `entityType`, `entityId`, `actor`, `timestamp`, `before`, `after` and write to it on every AdminJS `after` hook. (c) Long-term: store admin credentials in DB with bcrypt so they can be rotated in-app without redeployment.
---

## 🟠 HIGH — Angular SSR hydration mismatch in `formatDate()` — destroys Core Web Vitals *(2/7 agents)*
**File:** `frontend/src/app/features/catalog/product-detail/product-detail.component.ts:1314`
```ts
formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat('pl-PL', { ... }).format(new Date(value));
}
```
This method is called in the review card template (`{{ formatDate(review.createdAt) }}`). `new Date(isoString)` parsing is timezone-sensitive: the same ISO timestamp parses to different local dates on the Node.js server (UTC) vs. a user's browser in Warsaw (UTC+1/+2). For reviews submitted near midnight, the server renders "1 sty" while the browser renders "2 sty" — a hydration mismatch. Angular 18 destroys the entire hydration and re-renders the component tree from scratch, causing a Cumulative Layout Shift and defeating the SSR performance benefit.
**Fix:** Append `Z` to force UTC interpretation before parsing:
```ts
const date = typeof value === 'string' ? new Date(value + 'Z') : value;
```
Or use Angular's `DatePipe` with explicit UTC locale (`date | date:'d MMM yyyy':'UTC':'pl-PL'`).
---

## 🟡 MEDIUM — Coupon expiry comparison is timezone-naive — coupons expire 1-2h early in summer *(2/7 agents)*
**File:** `backend/src/modules/coupons/coupon.service.ts`
```ts
const now = new Date();  // always UTC
if (coupon.expiresAt && coupon.expiresAt < now) { ... }
```
When admins enter an expiry date in the AdminJS panel without explicit timezone context (e.g., "Black Friday ends at midnight"), the value may be stored as `2024-11-29T23:00:00.000Z` (midnight Warsaw CET = 23:00 UTC) or as `2024-11-29T00:00:00.000Z` depending on how the admin's browser locale interacts with AdminJS's date picker. In summer (CEST, UTC+2), a "midnight" coupon stored without conversion expires at 22:00 UTC — two hours early, during peak shopping hours.
**Fix:** Store all `expiresAt`/`startsAt` as UTC explicitly. Add a timezone field to the `Coupon` model defaulting to `'Europe/Warsaw'`. Validate the admin input with explicit UTC conversion before persisting. Display the stored UTC time as Warsaw time in AdminJS using the `timeZone` option.
---

## 🟡 MEDIUM — All `@Cron` decorators run in UTC, not Warsaw time — cron schedules are off by 1-2h *(1/7 agents)*
**Files:** `backend/src/modules/payments/payments.service.ts`, `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/cart/cart-cleanup.service.ts`
`@Cron(CronExpression.EVERY_DAY_AT_4AM)` runs at 04:00 UTC. In summer (CEST), that is 06:00 Warsaw time. Token cleanup, stale cart deletion, and coupon reconciliation all fire at unexpected local times for an operator monitoring the system from Warsaw. More critically, if future crons are added for business reports or low-stock alerts, stakeholders will receive them at odd hours.
**Fix:** Pass `{ timeZone: 'Europe/Warsaw' }` to all `@Cron` decorators:
```ts
@Cron('0 4 * * *', { timeZone: 'Europe/Warsaw' })
```

## 🟡 MEDIUM — `@Cron` decorators fire on every Railway replica independently — duplicate reconciliation/cleanup runs *(2/7 agents)*
**Files:** `backend/src/modules/payments/payments.service.ts`, `backend/src/modules/auth/auth.service.ts`, `backend/src/modules/cart/cart-cleanup.service.ts`, `backend/src/modules/coupons/coupon.service.ts`
NestJS `@Cron` uses `node-cron`, which does not distribute across replicas. If Railway scales to 2 replicas (possible under traffic spikes even on hobby tier), every cron fires twice:
- `reconcilePendingPayments` at `EVERY_10_MINUTES` — two replicas race the same stale payments; the second hits the `processedStripeEvent` guard and logs a noisy warning.
- `purgeExpiredTokens` at `EVERY_DAY_AT_4AM` — harmless double delete, but Sentry noise.
- `reconcileCurrentUses` at `EVERY_HOUR` — double reconciliation of denormalized coupon counter.
  **Fix:** Use a Redis-backed distributed lock before each cron body (e.g., `SET cron:reconcile:lock NX EX 600`). If the lock cannot be acquired, skip silently. Alternatively, externalize all crons to a dedicated Railway Cron Job service (already documented in CLAUDE.md for payments — apply the same pattern to all crons).
---

## 🟡 MEDIUM — Deactivated products remain accessible via direct slug URL *(1/7 agents)*
**File:** `backend/src/modules/products/products.service.ts`
`findBySlug()` does:
```ts
const product = await this.prisma.product.findUnique({ where: { slug } });
if (!product || !product.isActive) throw new NotFoundException();
```
The `isActive` filter is applied at the application layer after the DB read. This means:
1. Deactivated products are visible to search engines that cached the URL (returning a 200 → then 404 is a soft-404 SEO signal)
2. If the `NOT_FOUND` check ever has a bug or is bypassed, the product data is returned
3. The Prisma query wastes a round-trip fetching data for a product that will be rejected
   **Fix:** Add `isActive: true` to the WHERE clause:
```ts
const product = await this.prisma.product.findUnique({
  where: { slug, isActive: true },
  select: PRODUCT_SELECT,
});
if (!product) throw new NotFoundException('Produkt nie istnieje');
```
Also apply to `findAll()` to ensure catalog queries never return inactive products regardless of filtering.
---

## 🟡 MEDIUM — Authenticated carts never expire — stock hoarding attack possible *(1/7 agents)*
**File:** `backend/src/modules/cart/cart-cleanup.service.ts`
The stale cart cleanup cron only deletes **anonymous** carts older than 30 days. Authenticated user carts never expire. A coordinated attack (or a single automated script) can:
1. Create 50 accounts (no email verification required to register)
2. Add 1 unit of a limited-stock fragrance (e.g., stock=5) to each cart
3. Never check out — holding all stock indefinitely
   The legitimate buyer attempting to add the same item sees "Brak w magazynie" and leaves. The attacker's carts are never cleaned up. This is especially damaging for limited-edition launches announced on social media.
   **Fix:** Add a cart item expiry TTL (2-4 hours for stock reservation). When a cart item expires, restore the reserved stock. Alternatively, do not reserve stock at cart-add time — only decrement during `createFromCart()` — and show a "this item may sell out" warning instead of blocking non-cart users. Also enforce a max-quantity cap per variant per user in the cart (e.g., 2 units).
---

## 🟡 MEDIUM — Coupon validate endpoint rate limit allows full brute-force enumeration in <2 hours *(1/7 agents)*
**File:** `backend/src/modules/coupons/coupon.controller.ts`
The `POST /coupons/validate` endpoint is rate-limited to 10 requests per 60 seconds per IP. With common Polish e-commerce coupon patterns (`WELCOME10`, `LATO20`, `CZARNYPIATOK15`, `VIP30`, `URODZINY`…), an attacker cycling through ~1,200 guesses per 2 hours (10/min × 120 min) with a single IP, or faster with multiple proxied IPs, can discover valid active codes before they're publicly released.
Once discovered, the attacker (or a competitor) can:
- Use the coupon ahead of the intended audience
- Share the code publicly, exhausting campaign budget
- Apply the coupon to bulk orders before the campaign starts
  **Fix:** Reduce rate limit to 3 per 60s for unauthenticated, 10 per 60s for authenticated. Add Sentry alerting on 5+ consecutive 400s from the same IP on this endpoint. Use non-guessable coupon codes (UUID-based, e.g., `7F3K-9M2P`) rather than human-readable strings. Tie all campaign codes to specific user segments (email-matched, one-time-use) rather than public codes.
---

## 🟡 MEDIUM — Review bombing enabled by lack of email verification gate *(1/7 agents)*
**File:** `backend/src/modules/reviews/reviews.service.ts`
Reviews require an `orderId` from a completed order — but there is no requirement for `isEmailVerified = true` before a user can register, place a test order, and submit a review. A competitor can:
1. Create 500 accounts with disposable email addresses
2. Place 500 cheap orders (even using test cards in production by accident)
3. Submit 500 one-star reviews for a specific product
4. Drive the average rating from 4.8 → 1.2 in hours
   The `@@unique([userId, productId])` constraint prevents one user submitting multiple reviews for the same product, but does not prevent 500 unique users from each submitting one review.
   **Fix:** Gate review submission on `user.isEmailVerified = true`. Add suspicious-activity detection: flag accounts that register + order + review within 24 hours of each other for manual review. Consider requiring a minimum of 3 days between registration and first review, matching the pattern of organic behavior.
---

## 🟡 MEDIUM — No `ChunkLoadError` recovery handler — app silently breaks after new deploy for users with open tabs *(1/7 agents)*
**File:** `frontend/src/main.ts`, `frontend/src/app/app.component.ts`
When a new deploy happens and Angular chunk filenames change (content hashing), users with old tabs open trigger a `ChunkLoadError` when clicking any lazy-loaded route. The error propagates uncaught — Angular's default error handler logs to the console but does not reload the page. Users see a blank component or frozen navigation with no explanation.
**Fix:** In `main.ts`:
```ts
bootstrapApplication(AppComponent, appConfig).catch((err) => {
  if (err?.name === 'ChunkLoadError' || err?.message?.includes('chunk')) {
    window.location.reload();
  }
  console.error(err);
});
```
Also add a global `ErrorHandler` that catches chunk errors during lazy route loading.
---

## 🟡 MEDIUM — PWA service worker serves stale JS bundle after deploy — no `SwUpdate` reload prompt *(1/7 agents)*
**File:** `frontend/ngsw-config.json`, `frontend/src/app/app.config.ts`
The `ngsw-config.json` uses `navigationRequestStrategy: "freshness"` for HTML but the default cache-first strategy for JS/CSS chunks. After a new Vercel deploy, a returning user's service worker serves the old JS bundle while the new backend API returns responses with changed shapes or new required fields. This causes silent runtime errors (undefined properties, missing enum values from `shared-types`) with no user-visible error message.
There is no subscription to `SwUpdate.versionUpdates` to prompt users to reload when a new version is detected.
**Fix:** In `app.component.ts`:
```ts
inject(SwUpdate).versionUpdates
  .pipe(filter(e => e.type === 'VERSION_READY'))
  .subscribe(() => document.location.reload());
```
Or show a toast ("New version available — click to reload") for less disruptive UX.
---


## 🟡 MEDIUM — `Prisma.P2024` pool timeout on Railway cold-start returns unhandled 500 *(2/7 agents)*
**File:** `backend/src/modules/prisma/prisma.service.ts`
After Railway wakes from sleep, Prisma attempts to establish connections to Supabase pgbouncer. If the pool cannot acquire a slot within `pool_timeout` seconds (20s in the configured `DATABASE_URL`), Prisma throws `PrismaClientInitializationError: "pool timeout after 20 seconds"`. This error is not caught by NestJS's default exception filter and propagates as an unhandled 500.
**Impact:** The first 1-3 requests after a cold start may crash. If those requests are Stripe webhook deliveries (Stripe retries on 500), the order stays `PENDING_PAYMENT` until the next retry cycle.
**Fix:** Add a global exception filter for Prisma initialization errors:
```ts
@Catch(PrismaClientInitializationError)
export class PrismaPoolExceptionFilter implements ExceptionFilter {
  catch(exception: PrismaClientInitializationError, host: ArgumentsHost) {
    if (exception.message.includes('pool timeout')) {
      host.switchToHttp().getResponse().status(503).json({ error: 'Service temporarily unavailable' });
    }
  }
}
```
Also add a `onModuleInit()` warmup in `PrismaService`:
```ts
async onModuleInit() {
  await this.$queryRaw`SELECT 1`; // pre-warms connection pool
}
```

## 🟡 MEDIUM — 14-day withdrawal window closes at exact timestamp, not end-of-calendar-day *(1/7 agents)*
**File:** `backend/src/modules/returns/returns.service.ts`
The withdrawal window is calculated as:
```ts
const windowEnd = new Date(dto.deliveryDate).getTime() + 14 * 24 * 60 * 60 * 1000;
if (Date.now() > windowEnd) throw new BadRequestException(...);
```
Polish consumer law (Art. 27 UoK) grants consumers 14 **calendar days**. A customer whose package arrived at 14:32:05 on January 1st has until "the end of day" on January 15th (23:59:59), not until 14:32:05 on January 15th. If they submit a return at 15:00 on January 15th, the current code rejects them — a wrongful denial of a statutory right.
**Fix:** Normalize to end-of-day in Warsaw timezone:
```ts
const windowEnd = new Date(dto.deliveryDate);
windowEnd.setDate(windowEnd.getDate() + 14);
windowEnd.setHours(23, 59, 59, 999);
// Also apply Europe/Warsaw offset if needed
if (Date.now() > windowEnd.getTime()) throw new BadRequestException(...);
```

## 🟡 MEDIUM — Product list pagination missing stable tiebreaker — items duplicated or skipped on concurrent inserts *(2/7 agents)*
**File:** `backend/src/modules/products/products.service.ts`
The `orderBy` clause uses `[{ sortOrder: 'asc' }, { createdAt: 'desc' }]`. Two products with identical `sortOrder` and `createdAt` (common after bulk seeding) have an undefined order. When a new product is inserted between page 1 and page 2 requests, offset-based pagination shifts all subsequent records — the last item of page 1 reappears as the first item of page 2.
**Fix:** Add `{ id: 'asc' }` as the final tiebreaker (UUIDs are monotonically comparable via `gen_random_uuid()` insertion order on Postgres):
```ts
orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }]
```
Long-term: migrate to cursor-based pagination using `createdAt` + `id` composite cursor.
---

## 🟡 MEDIUM — Reviews fire HTTP requests during SSR prerender — unnecessary server-side API calls inflating backend load *(1/7 agents)*
**File:** `frontend/src/app/features/catalog/product-detail/product-detail.component.ts`
`loadReviews()` is called from `ngOnInit()` without an `isPlatformBrowser()` guard. During Vercel's build-time prerendering of product pages (or SSR on-demand), the server-side Angular Universal makes a live HTTP call to `GET /products/{id}/reviews` for every product page rendered. With 200+ products prerendered, this is 200+ extra backend requests during every Vercel deploy — inflating Railway request counts, increasing cold-start frequency, and adding 200–500ms to each SSR render.
**Fix:**
```ts
ngOnInit() {
  if (isPlatformBrowser(this.platformId)) {
    this.loadReviews(this.product.id);
  }
}
```
Reviews are not critical for SEO (Google doesn't require them in the initial HTML) and load fast client-side.
---

## 🟡 MEDIUM — SSR function returns no `Cache-Control` headers for product pages — every page load hits the Lambda *(1/7 agents)*
**File:** `api/ssr.mjs`, `frontend/src/server.ts`
SSR product and category pages (`/products`, `/products/:slug`, `/categories/:slug`) are rendered fresh on every request with no `Cache-Control` header. Vercel defaults to `s-maxage=0` for function responses. These pages rarely change between deploys — product prices and stock are dynamic but the HTML structure is stable.
Each request hits the Vercel Lambda (cold-start risk), then calls the Railway backend (second cold-start risk), resulting in 5-10s TTFB for the first request of the day.
**Fix:** In Angular's Express server, set short-lived CDN cache for public catalog routes:
```ts
res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
```
Exclude `/account`, `/cart`, `/checkout` routes which must be uncached. This keeps product pages warm on Vercel edge while still reflecting price changes within 60s.
---

## 🟢 LOW — Multi-tab logout: Tab B remains authenticated for up to 15 minutes after Tab A logs out *(1/7 agents)*
**File:** `frontend/src/app/core/services/auth.service.ts`
When a user logs out in Tab A, `clearSession()` clears the in-memory `_accessToken` signal in that tab's `AuthService` instance. Tab B has its own `AuthService` instance still holding the valid 15-minute access token. Tab B can continue making authenticated API calls (view orders, edit profile, place orders) for up to 15 minutes without realizing it has been logged out from another tab.
**Fix:** Add a `BroadcastChannel` listener:
```ts
// In AuthService constructor:
if (isPlatformBrowser(this.platformId)) {
  const ch = new BroadcastChannel('fragrance-auth');
  ch.onmessage = (e) => { if (e.data === 'logout') this.clearSession(); };
  // In logout():
  ch.postMessage('logout');
}
```
`BroadcastChannel` is supported in all modern browsers (including Safari 15.4+).
---


## 🟢 LOW — Coupon percentage discount uses `Math.round()` — rounds in customer's favor *(1/7 agents)*
**File:** `backend/src/modules/coupons/coupon.service.ts`
```ts
case DiscountType.PERCENTAGE:
  return Math.round((cartTotalInCents * value) / 100);
```
`Math.round()` rounds 0.5 upward, giving customers a slightly larger discount than mathematically exact. For example, a 19% coupon on 10,001 cents: `Math.round(10001 * 19 / 100) = 1901` vs. mathematically exact `1900.19`. Over time with many transactions, this consistently rounds in the customer's favor.
This is not a bug — rounding toward the customer is the industry-standard behavior and legally defensible. However, the inconsistency should be documented so future changes to coupon math don't accidentally reverse the direction.
**Fix:** Add a comment documenting the intentional choice:
```ts
// Math.round: rounds in customer's favor (standard retail practice)
return Math.round((cartTotalInCents * value) / 100);
```
---

## 🟢 LOW — No admin stock-change audit log — stock overwrites cannot be investigated *(1/7 agents)*
**File:** `backend/src/modules/products/products.service.ts` (`updateVariantStock`)
The admin stock update endpoint (`PATCH /products/admin/variants/:variantId/stock`) accepts `{ set: number }` for absolute overwrites. If an admin accidentally sets stock to 0 (or a malicious actor with admin access sets all stock to 0), there is no audit trail recording the before/after value, who made the change, or when. The `OrderEvent` pattern exists for orders — the same pattern should apply to stock changes.
**Fix:** Log stock changes to a new `StockEvent` Prisma model or extend `OrderEvent` to cover product events:
```ts
this.logger.log({ variantId, before: variant.stock, after: newStock, actor: adminId }, 'stock_update');
```
At minimum, add structured Pino logging before the update so Railway logs capture the change.
---
## Legend

| Label | Meaning |
|---|---|
| 🔴 BLOCKER | Must fix before any real customer |
| 🟠 HIGH | Real money loss, data corruption, legal exposure, or security breach |
| 🟡 MEDIUM | Degrades correctness, UX, or compliance significantly |
| 🟢 LOW | Polish / hardening |

Agent agreement is noted where 2+ agents independently identified the same issue.

---
## Prioritised Fix Order

### Launch blockers

| # | Finding | File |
|---|---|---|
| 1 | Vercel SSR missing `Vary: Cookie` — auth response cached for anonymous users | `api/ssr.mjs` |
| 2 | Pino logs plaintext passwords in request body | `app.module.ts:45` |
| 3 | Open redirect via unvalidated `returnTo` | `google-callback.component.ts:22` |
| 4 | Invoice Supabase bucket has no RLS — cross-user PDF access | `storage.service.ts:65` |
| 5 | BullMQ no `jobId` — duplicate emails from webhook + reconciliation cron | `email-queue.service.ts:21` |

### Pre-first-real-order hardening

| # | Finding | File |
|---|---|---|
| 6 | Refund issued without return shipment verification — fraud exposure | `returns.service.ts` |
| 7 | Admin credentials no rotation path + no audit trail | `admin.setup.ts` |
| 8 | Review bombing — no email verification gate | `reviews.service.ts` |
| 9 | P2024 Prisma pool timeout on cold-start returns unhandled 500 | `prisma.service.ts` |
| 10 | Cart hoarding — authenticated carts never expire, stock indefinitely reserved | `cart-cleanup.service.ts` |
| 11 | Coupon validate only 10/min — brute-forceable in 2 hours | `coupon.controller.ts` |
| 12 | SSR hydration mismatch in `formatDate()` — destroys Core Web Vitals | `product-detail.component.ts:1314` |
| 13 | Deactivated products accessible via direct slug URL | `products.service.ts` |

### Post-launch sprint

| # | Finding | File |
|---|---|---|
| 14 | Coupon expiry timezone-naive — 1-2h early in summer | `coupon.service.ts` |
| 15 | All `@Cron` decorators in UTC not Warsaw time | Multiple files |
| 16 | `@Cron` fires on all Railway replicas — duplicate cron runs | Multiple files |
| 17 | 14-day withdrawal window not normalized to end-of-calendar-day | `returns.service.ts` |
| 18 | `ChunkLoadError` not handled — silent app breakage after deploy | `main.ts` |
| 19 | PWA service worker stale bundles — no `SwUpdate` reload prompt | `app.config.ts` |
| 20 | SSR product pages have no `Cache-Control` — every load hits Lambda | `server.ts` |
| 21 | Reviews fire HTTP requests during SSR prerender | `product-detail.component.ts` |
| 22 | Product pagination missing tiebreaker `id` — items skip/duplicate | `products.service.ts` |
| 23 | Multi-tab logout — Tab B authenticated for 15m after Tab A logout | `auth.service.ts` |

---

## Agent Agreement Summary

| Finding | Agents |
|---|---|
| Vercel SSR missing `Vary: Cookie` | 3/7 |
| BullMQ job deduplication missing | 2/7 |
| Open redirect in `returnTo` | 2/7 |
| Invoice bucket no RLS | 2/7 |
| Pino logs plaintext passwords | 2/7 |
| Angular SSR hydration mismatch `formatDate` | 2/7 |
| P2024 crash on cold-start | 2/7 |
| `@Cron` multi-replica collision | 2/7 |
| Coupon timezone-naive | 2/7 |
| Pagination missing tiebreaker | 2/7 |
