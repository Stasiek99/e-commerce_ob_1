# E-Commerce Audit — Round 3
*Generated: 2026-05-30 — 7-agent stochastic consensus*
*Agents: Domain Expert · Security Skeptic · Pragmatist · First-Principles (DB) · Risk Analyst · End-User Advocate · Contrarian Innovator*

> **Excludes** everything already in `audit-weak-points.md`, `audit-round-2.md`, and `project-gaps-audit.md`.
> **Excludes** Phase 7 (pre-launch checklist) items.

---

## Legend

| Label | Meaning |
|---|---|
| 🔴 BLOCKER | Must fix before any real customer |
| 🟠 HIGH | Real money loss, data corruption, legal exposure, or security breach |
| 🟡 MEDIUM | Degrades correctness, UX, or compliance significantly |
| 🟢 LOW | Polish / hardening |

Agent agreement noted where 3+ agents independently identified the same issue.

---

## 🔴 BLOCKER — BLIK and P24 are advertised but never enabled in Stripe Checkout *(5/7 agents)*

**File:** `backend/src/modules/payments/stripe.client.ts:79`

```ts
// Polish market: cards + BLIK + P24 + Apple/Google Pay (last two auto via 'card')
payment_method_types: ['card'],
```

The comment is factually wrong. Passing only `['card']` to Stripe does **not** automatically include BLIK or Przelewy24 — these require explicit entries. BLIK is the dominant Polish payment method (~60% of e-commerce transactions per NBP/PayU data). A Polish-language fragrance store that silently presents a card-only checkout will lose the majority of mobile-first buyers with zero error logged anywhere.

Additionally, `checkout.session.async_payment_failed` is already wired in the webhook handler for BLIK's async confirmation model — meaning the backend is ready but the payment methods are simply never offered.

**Fix:** Change to `payment_method_types: ['card', 'blik', 'p24']` or remove the array entirely and use `automatic_payment_methods: { enabled: true }` with methods configured in the Stripe Dashboard.

---

## 🔴 BLOCKER — Invoice sequence DDL race on concurrent boot + `nextval` consumed before upload *(4/7 agents)*

**Files:**
- `backend/src/modules/invoice/invoice.service.ts:56–85`

Two distinct sub-bugs compound each other:

**Bug A — DDL race on cold-start:** `ensureSequence()` issues `CREATE SEQUENCE IF NOT EXISTS invoice_number_seq_YYYY` as a bare `$executeRawUnsafe` with no advisory lock. `OrdersService.onModuleInit()` wraps its equivalent DDL in `pg_advisory_xact_lock` — `InvoiceService` does not. Two Railway replicas booting simultaneously race to create the sequence, with one potentially failing `onModuleInit` and entering Railway's restart loop.

**Bug B — Sequence consumed before upload commits:** `nextInvoiceNumber()` calls `nextval(...)` at line 69 before `generatePdf()` and `uploadInvoice()`. PostgreSQL sequences are intentionally non-transactional — `nextval` always advances even if the caller throws or the process is SIGKILL'd mid-PDF. Any failure after `nextval` produces a permanent gap in the `FV/YYYY/NNNNNN` series. Polish VAT law (Art. 106e pkt 2 Ustawy o VAT) requires sequential invoice numbering without gaps; missing numbers are treated by KAS (tax authority) as evidence of suppressed invoices.

Furthermore, if two concurrent calls reach `processInvoice` simultaneously (e.g. `markSessionPaid` webhook + admin's "Download Invoice" click within the same second), both call `nextval` independently, each gets a unique sequence number, both attempt `order.update({ invoiceNumber })`, and the second throws P2002 (`@unique` on `invoiceNumber`). The first invoice is saved; the second order fails silently (fire-and-forget in `markSessionPaid`), so the customer's PAID order never gets an invoice with no alert beyond Sentry.

**Fix A:** Wrap `ensureSequence` in `$transaction` with `pg_advisory_xact_lock(stable_int)` using `DIRECT_URL`.
**Fix B:** Use a `invoice_counter` table with `SELECT ... FOR UPDATE` inside the same `$transaction` as `order.update(invoiceNumber)` — a DB table counter is transactional, a PostgreSQL sequence is not. Check `order.invoiceNumber IS NOT NULL` before allocating to prevent concurrent double-allocation.

---

## 🟠 HIGH — `processedStripeEvent` table grows forever — eventual checkout blockage *(3/7 agents)*

**Files:** `backend/prisma/schema.prisma:620–626`, `backend/src/modules/payments/payments.service.ts:129`

The `ProcessedStripeEvent` table is a pure append-only deduplication log with no cleanup. A modest store doing 50 orders/day × 4 webhook events each accumulates ~73 000 rows/year. Supabase free-tier storage at ~500 MB exhausts in under a year. When Postgres runs out of disk, `processedStripeEvent.create` starts throwing; because the insert happens **before** any payment processing, every subsequent webhook returns 500. Stripe begins exponential backoff. New payments stop being confirmed. Orders stay `PENDING_PAYMENT` until the reconciliation cron cancels them 30+ minutes later — after the customer has already been charged.

The `@@index([createdAt])` on the model suggests cleanup was planned but was never implemented; there is no `@Cron` in the codebase that prunes this table.

**Fix:** Add a nightly `@Cron` that deletes rows older than 7 days (safe margin above Stripe's 72-hour retry window).

---

## 🟠 HIGH — `processedStripeEvent` insert not atomic with the payment handler — crash creates permanently skipped events *(2/7 agents)*

**File:** `backend/src/modules/payments/payments.service.ts:128–210`

The idempotency guard inserts into `ProcessedStripeEvent` (line 128) then calls `markSessionPaid()` as a separate operation. If the process crashes, times out, or the Supabase connection pool exhausts **between** the successful insert and the start of `markSessionPaid`, the event is permanently recorded as processed. Every subsequent Stripe webhook retry hits the `P2002` guard and returns early. The order stays `PENDING_PAYMENT` forever. The reconciliation cron will eventually cancel it — but if the Stripe session's 30-minute TTL has already passed, the customer paid and gets nothing.

**Fix:** Move the `processedStripeEvent` upsert inside the same `$transaction` as the `payment.update + order.update` in `markSessionPaid()`. A single atomic commit means either both succeed or both roll back, allowing the next Stripe retry to succeed.

---

## 🟠 HIGH — Invoice PDF stored as base64 in Redis BullMQ job payload — evictable under memory pressure *(3/7 agents)*

**File:** `backend/src/modules/email/email-queue.service.ts:59–63`

```ts
invoicePdfBase64: invoicePdf.toString('base64')
```

A typical invoice PDF is 80–200 KB; base64 adds ~33% → 110–270 KB per job stored in Redis. With `removeOnComplete: { age: 86400 }` (24 hours of completed job retention), a busy day's orders can accumulate tens of MB in Redis purely in job payloads. On Railway's smallest Redis tier (256 MB), this becomes a risk during flash sales or promotions.

When Redis hits its `maxmemory` limit with `allkeys-lru` policy (Railway's default): BullMQ job payloads are eligible for eviction. An evicted `payment_confirmed_with_invoice` job is dequeued, the processor finds it missing, and the customer never receives their invoice email — no exception raised, no Sentry event.

The fix also applies to the `invoiceUrl` already being generated and passed alongside the base64 blob — it is redundant to store both.

**Fix:** Store only `invoiceUrl` in the job payload. The processor downloads the PDF bytes from the Supabase URL at processing time (idempotent, no size in Redis).

---

## 🟠 HIGH — Throttler `getTracker` broken: Express `trust proxy` never configured, all clients share one token bucket *(2/7 agents)*

**Files:** `backend/src/app.module.ts:74–78`, `backend/src/main.ts`

```ts
getTracker: (req) => req['ips']?.[0] ?? req.ip
```

This reads `req.ips[0]`, which Express populates from `X-Forwarded-For` only when `app.set('trust proxy', ...)` is explicitly configured. `NestExpressApplication` does not call this automatically. Without it, `req.ips` is always `[]`, so `req['ips']?.[0]` is `undefined` and the fallback `req.ip` resolves to the **Railway load-balancer's IP** — the same for every client.

Every customer, every bot, and every attacker share a single rate-limit bucket. The 5 req/s burst is exhausted by normal organic traffic, returning 429 to legitimate users. The per-endpoint limits on login and register are similarly broken. A bot trivially exhausts the shared bucket to DoS checkout for everyone.

Additionally, `ThrottlerStorageRedisService` (line 71) creates a **second** independent IORedis connection with no `retryStrategy` and no error handler. If this connection silently fails, throttling degrades to per-replica in-memory storage — with 2 Railway replicas the effective burst limit doubles for an attacker using multiple IPs.

**Fix:** Add `app.set('trust proxy', 1)` in `main.ts` before the Throttler middleware. Wire the `ThrottlerStorageRedisService` connection to the same `REDIS_CLIENT` provider from `RedisModule` to avoid the second disconnected pool.

---

## 🟠 HIGH — AdminJS full Helmet bypass enables clickjacking against admin sessions *(3/7 agents)*

**File:** `backend/src/main.ts:40–44`

```ts
app.use((req, res, next) => {
  if (req.path.startsWith('/admin')) return next();
  helmet()(req, res, next);
});
```

The blanket skip removes **all** Helmet headers from every admin response — including `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy`. The absence of `X-Frame-Options` means the AdminJS panel can be embedded in a third-party `<iframe>`, enabling clickjacking: an attacker frames the admin panel over decoy buttons and tricks a logged-in admin into clicking "Approve Return" or "Generate Label" unknowingly.

The justification for the bypass (AdminJS inline scripts) only requires relaxing `content-security-policy` — all other Helmet headers are safe to keep.

**Fix:** Replace the blanket bypass with a targeted Helmet config: apply all headers but override `contentSecurityPolicy: false` (or a permissive CSP) for the `/admin` scope. Keep `X-Frame-Options`, `X-Content-Type-Options`, `hsts`, and `Referrer-Policy` active.

---

## 🟠 HIGH — `CouponUse @@unique([couponId, userId])` contradicts `maxUsesPerUser > 1` — **prior audit fix introduces this bug** *(2/7 agents)*

**File:** `backend/prisma/schema.prisma` — `CouponUse` model

> ⚠️ This directly contradicts `audit-round-2.md` finding #30, which recommended adding `@@unique([couponId, userId])` as a fix. That fix is correct for preventing the race, but introduces a new bug for multi-use coupons.

If `@@unique([couponId, userId])` is added, a user can never redeem the same coupon twice — even when `Coupon.maxUsesPerUser = 3`. The second attempt throws P2002 inside `applyInsideTransaction`, which is caught as a generic `BadRequestException('Kod rabatowy jest nieważny')` — indistinguishable from an expired coupon. Any loyalty coupon with `maxUsesPerUser > 1` silently behaves as single-use.

Additionally, for coupons with `maxUsesPerUser = 1` used by a guest (`userId = null`): the unique constraint treats all null userIds as a single identity. The first guest to redeem exhausts the per-user slot for all future guests, making welcome-code promotions globally single-use rather than per-person.

**Correct fix:** Remove `@@unique([couponId, userId])`. Use `SELECT ... FOR UPDATE` on the `Coupon` row inside `applyInsideTransaction` to serialize concurrent redemption checks — the existing `count(CouponUse)` check plus a row lock is the correct pattern. Add `@@unique([couponId, orderId])` to prevent double-use per order (the actual uniqueness requirement).

---

## 🟠 HIGH — Guest customers cannot cancel PENDING_PAYMENT orders and cannot poll payment status *(2/7 agents)*

**Files:**
- `backend/src/modules/orders/orders.controller.ts` — `@UseGuards(JwtAuthGuard)` on `POST /orders/:id/cancel`
- `backend/src/modules/payments/payments.controller.ts` — `@UseGuards(JwtAuthGuard)` on `GET /payments/:orderId/status`

Guests can place orders (`OptionalJwtGuard`) and pay via Stripe. Two gaps:

1. **Cancellation:** `POST /orders/:id/cancel` requires a JWT. A guest cannot cancel a `PENDING_PAYMENT` order before the 30-minute Stripe session expires. Under Art. 12 UoK, the merchant must provide a pre-shipment management path. The guest must wait 30+ minutes for auto-cancellation.

2. **Success page poll:** `GET /payments/:orderId/status` also requires a JWT and checks `order.userId === requestingUserId`. A guest landing on `/checkout/success?orderId=...` immediately gets 401, the poll fails, and the page shows "Płatność w toku" permanently even after successful payment — unless the webhook fires before the first poll.

**Fix:** Implement token-based cancellation: send a signed `cancelToken` in the order confirmation email URL. Add a `GET /payments/:orderId/status?token=` path that validates the token against `order.snapshotEmail` + HMAC without requiring JWT.

---

## 🟠 HIGH — DPD pickup-point widget `postMessage` handler accepts any origin *(1/7 agents)*

**File:** `frontend/src/app/features/checkout/checkout-page/checkout-page.component.ts:904–910`

```ts
this.dpdMessageListener = (e: MessageEvent) => {
  if (!e.data?.dpdWidget) return;  // no e.origin check
  this.dpdPickupPointCode.set(e.data.dpdWidget.id);
```

The handler checks only `e.data?.dpdWidget` but never validates `e.origin`. Any page that can reference the checkout window can send a crafted `postMessage({ dpdWidget: { id: 'FAKE_POINT' } })` to inject an arbitrary DPD pickup-point code into the order — rerouting the parcel to a location the attacker controls.

Additionally, the widget is loaded from `https://api.dpd.cz` (Czech domain), which is not the official Polish DPD geowidget endpoint (`geowidget.dpd.com.pl`). This URL could change or become unavailable without notice.

**Fix:** Add `if (e.origin !== 'https://api.dpd.cz') return;` before processing the event data. Evaluate migrating to the official Polish DPD widget.

---

## 🟠 HIGH — File upload accepts any MIME type — stored XSS via Supabase CDN *(1/7 agents)*

**File:** `backend/src/modules/products/products.controller.ts:128`, `backend/src/modules/storage/storage.service.ts:27–33`

`FileInterceptor` only limits file size (10 MB). No `fileFilter` callback validates the actual content type. `StorageService.uploadProductImage` passes `file.mimetype` directly to Supabase as `contentType` — but Multer's `mimetype` is taken from the request `Content-Type` header, **never verified against actual file bytes**.

An authenticated admin (or a compromised admin session) can upload an SVG containing embedded JavaScript by sending `Content-Type: image/jpeg`. Supabase stores it and serves it from its public CDN. Any user loading the "image" URL receives attacker-controlled content. Browsers execute inline scripts in SVGs served as `image/svg+xml` (and sometimes even `image/jpeg` under MIME-sniff). This is a stored XSS vector on the product catalog served to all visitors.

**Fix:** Add `fileFilter` using the `file-type` npm package to verify magic bytes match an allowlist (`image/jpeg`, `image/png`, `image/webp`). Reject mismatches before the file reaches Supabase.

---

## 🟠 HIGH — Return notification email uses caller-supplied `dto.email`, not the authenticated user's email *(1/7 agents)*

**File:** `backend/src/modules/returns/returns.service.ts:49–62`, `backend/src/modules/returns/dto/create-return.dto.ts`

`ReturnsService.create()` correctly verifies ownership (`order.userId !== userId`), but then uses `dto.email` — not the authenticated user's account email — as the notification destination for both the customer confirmation and the admin notification:

```ts
await this.email.sendReturnConfirmation({ to: request.email, ... });
await this.email.sendReturnAdminNotification({ email: request.email, ... });
```

An authenticated user can submit a return for their own order but put an arbitrary third-party address in `dto.email`. The return details (order number, item list, return ID) are delivered to the victim address from the store's verified sending domain — a spam and phishing vector. The legitimate customer never receives their own confirmation.

**Fix:** Derive the notification address from `user.email` (from the authenticated session), ignoring `dto.email` entirely for notification routing.

---

## 🟠 HIGH — `ReturnsService` and `ProductsService` inject `EmailService` directly, bypassing BullMQ retry queue *(2/7 agents)*

**Files:** `backend/src/modules/returns/returns.service.ts:10`, `backend/src/modules/products/products.service.ts`

All payment, auth, shipping, and order services correctly use `EmailQueueService` (BullMQ with 3-attempt exponential backoff). `ReturnsService` and `ProductsService` inject `EmailService` directly — calling Resend synchronously with no retry. A transient Resend outage during a return submission silently drops the customer confirmation and admin notification with no retry, no queue, and no Sentry event. `EmailModule` already exports both services; no module change is needed.

**Fix:** Replace `EmailService` injection in both services with `EmailQueueService`.

---

## 🟠 HIGH — `AuthService.refresh$` uses `shareReplay({ refCount: true })` — mid-flight cancel logs out the user *(1/7 agents)*

**File:** `frontend/src/app/core/services/auth.service.ts:84–102`

```ts
shareReplay({ bufferSize: 1, refCount: true })
```

`refCount: true` tears down the underlying observable when the last subscriber unsubscribes. If subscriber A triggers a refresh and subscriber B (e.g. a component destroyed during navigation) unsubscribes before the response arrives, `refCount` drops to zero, the HTTP request is cancelled, and `finalize(() => { this._refresh$ = null })` runs. Subscriber A's `catchError` sees a cancelled request, interprets it as a refresh failure, and navigates to `/auth/login` — logging the user out despite the fact that the refresh would have succeeded.

**Fix:** Change to `shareReplay({ bufferSize: 1, refCount: false })`.

---

## 🟠 HIGH — `placeOrder()` always sends `newAddress`, never `addressId` — saved addresses never linked to orders *(1/7 agents)*

**File:** `frontend/src/app/features/checkout/checkout-page/checkout-page.component.ts:971–1026`

`placeOrder()` always builds and sends `newAddress: addrPayload` from the form values regardless of whether `selectedSavedId()` is set. It never sends `addressId`. The backend `createFromCart` DTO supports both paths: when `addressId` is provided it links `order.addressId` to the existing `Address` row; when only `newAddress` is provided it creates a new inline record without the FK.

Consequence: every order placed by a returning customer with saved addresses creates a duplicate address record and the order is never linked to their saved `Address` row — breaking any future dashboard code that joins `Order → Address` and defeating the purpose of address management.

**Fix:** In `placeOrder()`, if `selectedSavedId()` is non-null send `{ addressId: selectedSavedId() }` instead of `newAddress`.

---

## 🟠 HIGH — JWT `validate()` has no circuit-breaker for Redis outage — total auth outage when Redis goes down *(1/7 agents)*

**File:** `backend/src/modules/auth/strategies/jwt.strategy.ts:30`

The token revocation check calls `this.redis.get(...)` with no try/catch. IORedis in production has `retryStrategy: (times) => Math.min(times * 500, 5_000)` — it retries indefinitely before throwing. During a Redis outage, every JWT validation blocks for seconds before IORedis gives up and throws. The thrown error propagates through `JwtStrategy.validate()`, Passport treats it as auth failure, and returns 401.

Result: **every authenticated user is locked out** for the duration of the Redis outage. Checkout, orders, account — all return 401. There is no graceful degradation.

The `auth:revoke-before` keys TTL matches the access token lifetime (15 min), so a Redis outage of >15 min means any revocation window has already elapsed safely when Redis recovers.

**Fix:** Wrap the Redis call in try/catch; on a connection error, allow the request through (accept the brief revocation window) and log to Sentry. This trades a security edge-case for availability.

---

## 🟠 HIGH — Withdrawal 14-day deadline enforced only on the frontend; backend accepts any `deliveryDate` *(1/7 agents)*

**Files:** `frontend/.../return-request.component.ts`, `backend/src/modules/returns/returns.service.ts:28–66`

The frontend correctly computes `deliveryDate + 14 days` per Art. 27 UoK and disables submission after the window. The backend `ReturnsService.create()` does zero server-side validation of `deliveryDate`. A direct API call with `deliveryDate` set to yesterday (regardless of actual delivery) will create a WITHDRAWAL return request, triggering the admin refund flow. This is a financial exposure for every order ever placed.

**Fix:** In `ReturnsService.create()`, for `type === 'WITHDRAWAL'`, assert `dto.deliveryDate + 14 days >= new Date()` and throw `BadRequestException` otherwise.

---

## 🟠 HIGH — Discount VAT rate hardcoded at 23% on invoice — incorrect VAT split for mixed-rate baskets *(1/7 agents)*

**File:** `backend/src/modules/invoice/invoice.service.ts:207–213`

```ts
{ name: 'Rabat: ...', vatRate: 0.23 }
```

When a discount line item is added for a coupon, it applies `23%` VAT unconditionally. If the order contains items at multiple VAT rates (e.g. 5% for hygiene gels, 23% for cosmetics), the discount must be prorated across each rate per Art. 106e pkt 7 (cross-referenced with Art. 29a ust. 10). A flat 23% discount line produces an incorrect VAT split — both over-reporting and under-reporting liability depending on basket composition. This is a KAS audit finding.

**Fix:** Weight the discount amount across each unique VAT rate proportionally to items at that rate.

---

## 🟡 MEDIUM — Supabase signed invoice URLs break on key rotation — 5-year access obligation *(1/7 agents)*

**File:** `backend/src/modules/storage/storage.service.ts:69–73`

`uploadInvoice` generates a 10-year signed URL and persists it as `order.invoiceUrl`. Signed URLs are tied to the service-role key at signing time. If the Supabase project is deleted, migrated to a new project, or the service-role key is rotated, every stored URL returns 403. There is no re-signing cron or fallback.

Under Art. 106b of Polish VAT law, sellers must make VAT invoices available to buyers on demand for 5 years. A single key rotation silently breaks all historical invoice access across thousands of orders simultaneously — a compliance breach with no automated recovery.

**Fix:** Store the raw storage path (`storagePath`) rather than the signed URL. Re-sign on demand in `GET /orders/:id/invoice` using a short-lived signed URL (1 hour TTL). This makes re-signing trivially automatic on every request.

---

## 🟡 MEDIUM — `shared-types` dist is committed to git; Vercel uses stale snapshot instead of rebuilding *(1/7 agents)*

**File:** `vercel.json` `buildCommand`, `packages/shared-types/dist/` (committed)

Railway's build chain explicitly runs `pnpm --filter @fragrance-store/shared-types build` before the backend build. Vercel's `buildCommand` runs only `pnpm --filter frontend build` with no prior `shared-types` build step. Because `packages/shared-types/dist/` is committed to git, Vercel uses whatever snapshot was last committed — not what the source code reflects at deploy time.

Divergence scenario: a developer adds `OrderStatus.ON_HOLD` to the shared enums, commits, and deploys. Railway rebuilds shared-types → backend gets the new value. Vercel uses the stale committed dist → frontend's runtime imports receive the old enum (even though TypeScript paths in `tsconfig.json` point to `src/*`, the `exports` field in `package.json` resolves to `dist/*` at runtime). Order status display breaks in production in a way that CI never catches.

**Fix:** Either prepend `pnpm --filter @fragrance-store/shared-types build &&` to `vercel.json`'s `buildCommand`, or add `packages/shared-types/dist/` to `.gitignore` to force both platforms to always build from source.

---

## 🟡 MEDIUM — BullMQ workers have no graceful drain on Railway rolling restart *(1/7 agents)*

**File:** `backend/src/main.ts`, `backend/src/modules/email/email-queue.processor.ts`

`main.ts` does not call `app.enableShutdownHooks()`, and no `onApplicationShutdown` lifecycle hook closes the BullMQ `Worker` before process exit. When Railway sends SIGTERM (deploy or restart-on-failure), Node.js exits during the grace window. Any `payment_confirmed_with_invoice` job mid-flight is interrupted.

BullMQ retains the job as "active" until `lockDuration` (~30s) expires. If the new container starts before that window, the job is re-queued and the customer receives **two** invoice emails. If the new container starts after the lock expires with no remaining attempts, the job enters failed state — the customer receives nothing.

The combination `SSR → Stripe payment → BullMQ` makes this acute: a payment confirmed just as a deploy starts produces a customer who paid but got no confirmation.

**Fix:** Add `app.enableShutdownHooks()` in `main.ts`. Implement `onApplicationShutdown` in `EmailModule` calling `worker.close(true)` (drain before exit).

---

## 🟡 MEDIUM — `reconcilePendingPayments` cron bypasses `processedStripeEvent` idempotency guard *(1/7 agents)*

**File:** `backend/src/modules/payments/payments.service.ts:536–539`

`handleWebhookEvent` inserts into `ProcessedStripeEvent` before calling `markSessionPaid` (correct, idempotent). But `reconcilePendingPayments` calls `markSessionPaid` directly without going through `handleWebhookEvent`. If a webhook fires and the cron runs simultaneously (Stripe session just flipped to `paid`), both paths call `markSessionPaid` concurrently. The status-equals-COMPLETED guard inside `markSessionPaid` is a non-transactional read — two concurrent calls can both read `PENDING`, both pass the guard, and both commit. Result: duplicate `OrderEvent` rows and potentially two concurrent `processInvoice` calls → duplicate invoice numbers (see BLOCKER above).

**Fix:** Move the `processedStripeEvent` upsert inside `markSessionPaid`, or wrap the reconciliation path with a synthetic idempotency key like `reconcile-${payment.id}`.

---

## 🟡 MEDIUM — `CartService.updateQueue` uses `switchMap` — concurrent updates to different items silently drop one *(1/7 agents)*

**File:** `frontend/src/app/core/services/cart.service.ts:65–76`

`updateQueue` is a single shared `Subject` piped through `switchMap`. `switchMap` cancels the in-flight PATCH when a new emission arrives. If a user increments item A then item B within the debounce window, the B emission cancels A's in-flight request — A's quantity is never updated server-side, but the optimistic local signal shows the new value. On page reload, the cart reverts to item A's pre-change quantity with no error shown.

The `updateQueue` also has **no `catchError` handler**. When the server returns 400 (e.g. "Insufficient stock"), the observable errors and the subscription terminates permanently. All subsequent `updateQueue.next()` calls are no-ops until the page is reloaded — the user can keep clicking the stepper with no effect, then reach checkout and be rejected again.

**Fix:** Replace `switchMap` with `groupBy(e => e.variantId).pipe(mergeMap(group => group.pipe(debounceTime(400), switchMap(update => patchRequest(update)))))` to debounce per-item independently. Add `catchError((err) => { toast.error(...); return EMPTY; })` inside the `switchMap` to keep the stream alive.

---

## 🟡 MEDIUM — Prerendered `/products` page embeds stale catalog data baked at build time *(1/7 agents)*

**File:** `frontend/prerender-routes.txt`, `vercel.json`

`/products` is prerendered at build time and served from Vercel's CDN edge with `Cache-Control: immutable`. The baked HTML contains the product list as it existed at the moment of `ng build`. Price changes, stock-outs, or deactivated products between deploys produce a stale CDN snapshot shown to first-load users and crawlers.

For SEO: Googlebot may index build-time prices embedded in the SSR output. If a promotion ends between deploys, the CDN-cached page shows the promotional price, creating an EU Omnibus-adjacent situation where the indexed "current" price does not match the live price — also a consumer-law risk under Art. 8 UoK (misleading commercial practice).

**Fix:** Remove `/products` from `prerender-routes.txt` and let it hit the SSR function on-demand, or set a short `s-maxage=60` CDN TTL to prevent stale indexing.

---

## 🟡 MEDIUM — Guest success page displays UUID (`orderId`), not `orderNumber` — track-order lookup always fails *(1/7 agents)*

**File:** `frontend/src/app/features/checkout/checkout-success/checkout-success.component.ts:33–43`

The success page displays `orderId` (a UUID like `3f7a8b2c-...`) as "Numer zamówienia". The `/orders/track` form asks for the human-readable `orderNumber` (format `ORD-2026-000042`). A guest who just paid types their UUID into the track form → the backend receives it as `orderNumber` → returns 404. The customer cannot self-serve track their own order without checking their confirmation email.

The `PaymentStatusResponse` DTO returned by `GET /payments/:orderId/status` does not include `orderNumber` — the field is never fetched or displayed.

**Fix:** Add `orderNumber` to `PaymentStatusResponse` and display it on the success page. The order is already loaded in the success component — `orderNumber` just needs to be included in the backend response.

---

## 🟡 MEDIUM — `compareAtPriceInCents` modelled in the DTO but never rendered — sale prices invisible *(1/7 agents)*

**Files:** `frontend/src/app/features/catalog/product-detail/product-detail.component.ts:29`, `frontend/src/app/shared/product-card/product-card.component.html`

The `ProductVariantDetail` interface declares `compareAtPriceInCents?: number | null`, indicating the data model supports promotional strikethrough pricing. The product detail template renders only `selectedVariant()!.priceInCents | price` with no comparison price, no "PROMOCJA" badge, and no crossed-out original price. `ProductCardData` on the card component also omits `compareAtPriceInCents`.

If an admin sets a promotional price in the backend, customers see nothing visual — losing one of the highest-converting elements for Polish impulse buyers.

**Fix:** Add `@if (selectedVariant()?.compareAtPriceInCents)` block in the detail template and product card template with a strikethrough style on `compareAtPriceInCents`.

---

## 🟡 MEDIUM — Checkout failure page retry calls `/api/...` hardcoded path — breaks in production (Vercel) *(1/7 agents)*

**File:** `frontend/src/app/features/checkout/checkout-failure/checkout-failure.component.ts:100, 110`

```ts
this.http.post(`/api/orders/${id}/retry-payment`, {})
this.http.post(`/api/orders/${id}/cancel`, {})
```

These use absolute `/api/...` paths rather than `environment.apiUrl`. In development, the Angular proxy rewrites `/api/*` → `localhost:3000`. On Vercel, there is no equivalent rewrite rule in `vercel.json` for this path — Vercel would serve a 404 from the CDN. The retry and cancel buttons silently fail.

**Fix:** Prefix with `this.env.apiUrl + '/orders/...'` matching the pattern used everywhere else in the codebase.

---

## 🟡 MEDIUM — `inspiredBy` trademark exposed via search scoring — IP/trademark litigation vector *(2/7 agents)*

**Files:** `backend/src/modules/products/products.service.ts:10–37` (PRODUCT_SELECT exclusion), lines `135–162` (search SQL)

`PRODUCT_SELECT` explicitly excludes `inspiredBy` with a comment about not leaking the inspiration mapping. However the search ranking SQL uses `p."inspiredBy" ILIKE '%Sauvage%'` in the `WHERE` clause. A customer searching "Sauvage" receives the inspired products ranked to the top — revealing the mapping through search result ordering even without the field in the response body.

Polish courts (and EU Trademark Regulation 2017/1001) consider using a trademark in trade for commercial advantage actionable even when the field is not displayed, if the search algorithm is optimized on the brand name. Luxury houses (Dior, Chanel) actively monitor the Polish clone/inspiration market.

**Fix:** This is primarily a legal strategy decision. At minimum: require legal review before launching `inspiredBy`-driven search ranking. As a technical hedge, store the `luxuryReferenceId` only, not the brand name string, and filter search on an allowlist of approved inspiration categories rather than brand names.

---

## 🟡 MEDIUM — `retryPayment` always tries to create a new `Payment` row — hits `@unique orderId` constraint *(1/7 agents)*

**File:** `backend/src/modules/payments/payments.service.ts:25–75`, `backend/src/modules/orders/orders.service.ts`

`retryPayment` calls `initiatePayment(orderId)`. `initiatePayment` unconditionally calls `prisma.payment.create(...)`. `Payment.orderId` has `@unique`. For any order where a first payment attempt was made and failed/expired (status `FAILED`), a second `create` call throws P2002. The retry button always returns 500 for orders with an existing (failed) Payment row.

**Fix:** In `initiatePayment`, check for an existing `FAILED` payment row and `upsert` (update session fields) instead of creating a new row. Expire the old Stripe session before creating a new one.

---

## 🟡 MEDIUM — Return requests creatable on `CANCELLED` or `PENDING_PAYMENT` orders *(2/7 agents)*

**File:** `backend/src/modules/returns/returns.service.ts:28–65`

`create()` only validates ownership — not order status. A customer can file a `COMPLAINT` on a `CANCELLED` order (stock already restored) or a `PENDING_PAYMENT` order (not yet paid). The return request is created and emails fire, generating unnecessary admin work and eventually a manually rejected complaint with a confused customer.

**Fix:** Add a status allowlist guard: `const allowed = [SHIPPED, DELIVERED, PAID, PROCESSING]; if (!allowed.includes(order.status)) throw new BadRequestException(...)`.

---

## 🟡 MEDIUM — Free-shipping coupon displayed total goes stale when carrier is changed after coupon is applied *(1/7 agents)*

**File:** `frontend/src/app/features/checkout/checkout-page/checkout-page.component.ts:756–760`

When a `FREE_SHIPPING` coupon is validated, `appliedCoupon.discountAmountInCents` is set to the currently selected carrier's price. If the customer returns to step 1 and switches carriers, `appliedCoupon` is not recomputed. The displayed subtotal shows the wrong discount amount (old carrier price). The backend will compute correctly from the new carrier — so Stripe charges the correct amount but the pre-payment summary shown to the customer is wrong, violating the price information duty under Art. 8 Ustawa o usługach płatniczych.

**Fix:** Add an `effect(() => { if (this.appliedCoupon()?.isFreeShipping) this.recomputeFreeShippingDiscount(); })` that watches `selectedCarrier()`.

---

## 🟡 MEDIUM — Order event log exposes internal actor strings and admin notes to authenticated customers *(1/7 agents)*

**File:** `backend/src/modules/orders/orders.service.ts:295–303`, `backend/src/modules/orders/orders.controller.ts:63–66`

`GET /orders/:id/events` is accessible to the order owner. The `actor` column contains literal strings like `'SYSTEM:stripe-webhook'`, `'ADMIN'`, and for admin-triggered events the `note` field contains free-form admin text (e.g. `'Bulk cancelled by admin — reason: suspected fraud'`). These internal strings are returned to the customer without filtering.

**Fix:** Create a customer-facing projection of `OrderEvent` that maps `actor` to human-readable labels (e.g. `'ADMIN'` → `'Obsługa sklepu'`) and omits the `note` field entirely from the customer-facing response. Expose full details only to admin endpoints.

---

## 🟡 MEDIUM — SSE stock stream endpoint has no per-IP connection cap — persistent connection exhaustion *(1/7 agents)*

**File:** `backend/src/modules/products/products.controller.ts:64–72`

`GET /products/variants/stock-stream` (`@Public()`) opens a persistent server-sent events connection per client. The global throttler counts only the initial handshake request, not the connection lifetime. An attacker can open 60 persistent SSE connections per minute per IP within the rate-limit budget, each holding a Redis subscriber and a Node.js socket. There is no idle timeout and no per-IP connection count limit.

**Fix:** Add a maximum concurrent SSE connections guard per IP (tracked in Redis). Close idle connections after 5 minutes with a reconnect hint to the client.

---

## 🟢 LOW — Stripe Checkout `session_id` lingers in browser URL — referrer PII leakage *(1/7 agents)*

**File:** `backend/src/modules/payments/stripe.client.ts:104`, `frontend/.../checkout-success.component.ts`

```ts
success_url: `${input.successUrl}?orderId=${input.orderId}&session_id={CHECKOUT_SESSION_ID}`
```

After redirect, the customer's browser URL contains `session_id=cs_live_xxx`. This appears in Vercel access logs (full URL captured), browser history, and referrer headers on outbound clicks. A Stripe Checkout Session ID exposes `customer_email`, `amount_total`, and line items to anyone who retrieves it. In Vercel's access log → log aggregator pipeline this is inadvertent PII logging.

**Fix:** In `CheckoutSuccessComponent.ngOnInit()`, after reading `orderId`, call `this.router.navigate([], { queryParams: { orderId }, replaceUrl: true })` to strip `session_id` from history before starting the status poll.

---

## 🟢 LOW — `price_desc` sort returns products with no active variants at the top with a blank price *(1/7 agents)*

**File:** `backend/src/modules/products/products.service.ts:198`

```ts
const minPrice = (p) => p.variants[0]?.priceInCents ?? Infinity
```

For `price_desc`, a product with no active variants (all `isActive: false`) has `minPrice = Infinity` — largest value, sorts to position 1. The product card renders a blank price field. Google indexes a product page with no price in structured data — a soft-404 signal.

**Fix:** Add `where: { variants: { some: { isActive: true } } }` to the default `findAll` query, or replace `Infinity` with `-Infinity` in the `price_desc` comparator.

---

## 🟢 LOW — Tracking number shown as plain text — no carrier deep-link *(1/7 agents)*

**File:** `frontend/src/app/features/account/orders/order-detail.component.ts:131–135`

`order.shipment.trackingNumber` is rendered in a `<strong>` tag with no link. For InPost: `https://inpost.pl/sledzenie-przesylek?number=<trackingNumber>`. For DHL PL: the DHL tracking URL. Polish customers expect a tap-to-track link in their order detail. The `carrierCode` is not included in the `OrderDetail` response interface, so building the URL client-side would require a backend change.

**Fix:** Add `carrierCode` to the order detail response. Build the tracking URL from a carrier→URL map in the component.

---

## 🟢 LOW — Redis `invalidateProductCaches` opens multiple concurrent scanStreams with no backpressure *(1/7 agents)*

**File:** `backend/src/modules/products/products.service.ts:721–728`

`invalidateProductCaches()` is `void` — it returns before the stream finishes. Under concurrent stock adjustments or product updates, multiple `scanStream` instances run in parallel. A lagging stream from a previous request can DEL a freshly written cache key from the current request immediately after it is set. The product list cache is effectively invalidated twice, and the fresh DB result is evicted before it can be served.

**Fix:** Use a monotonically incrementing `product_cache_version` counter in Redis. Embed the version in all cache keys. Invalidation means incrementing the version counter (O(1)) rather than scanning all keys.

---

## Prioritised Fix Order

### Launch blockers

| # | Finding | File |
|---|---|---|
| 1 | BLIK/P24 never offered in Stripe Checkout | `stripe.client.ts:79` |
| 2 | Invoice DDL race on boot + nextval consumed before upload | `invoice.service.ts:56–85` |
| 3 | `processedStripeEvent` no purge — eventual checkout blockage | `schema.prisma:620`, `payments.service.ts:129` |
| 4 | `processedStripeEvent` insert not atomic with handler | `payments.service.ts:128–210` |
| 5 | Invoice PDF base64 in Redis — evictable under memory pressure | `email-queue.service.ts:59` |

### Pre-first-real-order hardening

| # | Finding | File |
|---|---|---|
| 6 | Throttler `getTracker` broken — trust proxy missing | `app.module.ts:74`, `main.ts` |
| 7 | AdminJS full Helmet bypass — clickjacking surface | `main.ts:40–44` |
| 8 | `CouponUse @@unique` contradicts `maxUsesPerUser > 1` | `schema.prisma:CouponUse` |
| 9 | Guest cannot cancel or poll payment status | `orders.controller.ts`, `payments.controller.ts` |
| 10 | DPD postMessage no origin check — parcel reroute attack | `checkout-page.component.ts:904` |
| 11 | File upload accepts any MIME — stored XSS via CDN | `products.controller.ts:128` |
| 12 | Return notification uses caller-supplied email | `returns.service.ts:49` |
| 13 | `ReturnsService`/`ProductsService` bypass email retry queue | `returns.service.ts:10` |
| 14 | `shareReplay({ refCount: true })` on refresh — spurious logout | `auth.service.ts:84` |
| 15 | `placeOrder()` never sends `addressId` — saved addresses unlinked | `checkout-page.component.ts:971` |
| 16 | JWT validate Redis failure = total auth outage | `jwt.strategy.ts:30` |
| 17 | Withdrawal deadline not validated server-side | `returns.service.ts:28` |
| 18 | Discount VAT rate hardcoded 23% on invoice | `invoice.service.ts:207` |

### Post-launch sprint

| # | Finding | File |
|---|---|---|
| 19 | Supabase signed invoice URLs broken by key rotation | `storage.service.ts:69` |
| 20 | `shared-types` dist committed — Vercel uses stale snapshot | `vercel.json`, `packages/shared-types/dist/` |
| 21 | BullMQ no graceful drain on Railway SIGTERM | `main.ts`, `email-queue.processor.ts` |
| 22 | Cron bypasses `processedStripeEvent` — duplicate invoice numbers | `payments.service.ts:536` |
| 23 | `CartService.updateQueue` switchMap drops concurrent item updates | `cart.service.ts:65` |
| 24 | Prerendered `/products` embeds stale catalog data | `prerender-routes.txt` |
| 25 | Guest success page shows UUID not orderNumber | `checkout-success.component.ts:33` |
| 26 | `compareAtPriceInCents` modelled but never rendered | `product-detail.component.ts:29` |
| 27 | Checkout failure retry uses hardcoded `/api/...` path | `checkout-failure.component.ts:100` |
| 28 | `inspiredBy` trademark exposed via search scoring | `products.service.ts:135` |
| 29 | `retryPayment` always creates new Payment row — always 500 | `payments.service.ts:25` |
| 30 | Return complaints on wrong-status orders | `returns.service.ts:28` |
| 31 | Free-shipping coupon total stale after carrier change | `checkout-page.component.ts:756` |
| 32 | Order events expose internal actor strings to customers | `orders.service.ts:295` |
| 33 | SSE stock stream — no connection cap | `products.controller.ts:64` |

---

## Agent Agreement Summary

| Finding | Agents |
|---|---|
| BLIK/P24 never enabled in Stripe | 5/7 |
| Invoice sequence DDL race + nextval gap | 4/7 |
| `processedStripeEvent` table grows unbounded | 3/7 |
| Invoice PDF base64 in Redis | 3/7 |
| AdminJS full Helmet bypass | 3/7 |
| Throttler broken (trust proxy + second Redis conn) | 2/7 |
| `CouponUse @@unique` vs `maxUsesPerUser > 1` | 2/7 |
| Guest cancellation/payment-status locked out | 2/7 |
| Return complaints on wrong-status orders | 2/7 |
| `inspiredBy` trademark via search scoring | 2/7 |
| `ReturnsService` bypasses email retry queue | 2/7 |
