# E-Commerce Audit — Round 10
*Generated: 2026-06-10 — 5-agent stochastic consensus*
*Agents: Frontend Security/SEO · API Attack Surface · Business Logic Fault Finder · Infrastructure Resilience · Data Privacy/GDPR Forensics*

> **Excludes** everything already in `audit-weak-points.md`, `audit-round-2.md` through `audit-round-9.md`, and `project-gaps-audit.md`.
> **Excludes** Phase 7 (pre-launch checklist) items in ROADMAP.md.

---

## 🔴 CRITICAL — Cloudflare Turnstile disabled in production — no bot protection on cart/checkout *(Frontend agent)*

**File:** `frontend/src/environments/environment.prod.ts:5`

```typescript
turnstileSiteKey: '',
```

**File:** `frontend/src/app/core/services/turnstile.service.ts:33–34`

```typescript
if (!isPlatformBrowser(this.platformId) || !this.siteKey) {
  return Promise.resolve('');  // empty string = challenge bypassed
}
```

`TurnstileService.getToken()` resolves immediately with `''` when the site key is blank. The dev environment uses the always-pass test key `1x00000000000000000000AA` instead of a real key — confirming no production key was ever registered. If the backend Turnstile middleware treats an empty/missing token as pass-through (standard default), any bot can hammer `POST /cart/items` or `POST /orders` with zero challenge overhead.

**Business impact:** Scalpers can drain limited-edition fragrance stock in seconds. With `MAX_CART_QTY_PER_VARIANT = 2`, a botnet hits 50 SKUs in parallel and empties the store before any human sees the page.

**Fix:** Register a real Turnstile site key at dash.cloudflare.com for your production domain. Set it in `environment.prod.ts`. Verify the backend middleware rejects empty or invalid token responses.

---

## 🔴 CRITICAL — Duplicate order creation: no idempotency guard on `createFromCart` *(Business Logic agent)*

**File:** `backend/src/modules/orders/orders.service.ts:114–409`

Two concurrent HTTP calls to `POST /orders` (double-click, network retry, two tabs) both:
1. Read the same non-empty cart (cart is cleared only after Stripe session creation)
2. Both pass the variant `isActive` check and the `updateMany WHERE stock >= qty`
3. Both create independent order rows with independent `Payment` rows
4. Both increment `coupon.currentUses`

Result: customer is charged twice. Two Stripe Checkout Sessions for two different orders. Two `CouponUse` rows. Two stock decrements. The `@@unique([couponId, orderId])` constraint on `CouponUse` only prevents the *same orderId* from reusing a coupon — it does not prevent two different orderIds from the same cart from each incrementing use count.

**Fix:** Before the transaction, acquire a Redis `SET NX EX 30` lock on `checkout-lock:{userId ?? sessionId}`. Release after cart is cleared. A concurrent second request gets 429. Alternatively, add a DB partial unique index: `UNIQUE (userId) WHERE status = 'PENDING_PAYMENT'`.

---

## 🔴 CRITICAL — No HTTP timeout on any carrier Axios client — event loop starvation *(Infrastructure agent)*

**Files:**
- `backend/src/modules/shipping/carriers/inpost.client.ts:45` — `axios.create({...})` has no `timeout`
- `backend/src/modules/shipping/carriers/dhl.client.ts:50` — same
- `backend/src/modules/shipping/carriers/gls.client.ts:39` — same
- `backend/src/modules/shipping/carriers/dpd.client.ts:38` — same

Axios default is no timeout — a hanging TCP connection waits indefinitely. The `TimeoutInterceptor` sends a 408 to the client after 8 seconds but does **not** abort the underlying Axios request. The `createShipment()` call continues executing in the background. At InPost sandbox speeds (30+ second stalls are common), a burst of 20 label-generation requests creates 20 dangling connections holding the Node.js event loop. Railway hobby = single core — each dangling async operation starves all other requests.

**Fix:** Add `timeout: 15_000` to every `axios.create()` call in all four carrier clients. Add `try/catch` for `ECONNABORTED`/`ETIMEDOUT` → `ServiceUnavailableException`.

---

## 🔴 CRITICAL — No Dead Letter Queue — emails permanently lost after 3 retries *(Infrastructure agent)*

**File:** `backend/src/modules/email/email-queue.service.ts:7–11`

`attempts: 3` with 5s/10s/20s backoff means all three attempts exhaust in ~35 seconds. After the third failure, BullMQ moves the job to `failed`. `removeOnFail: { age: 604_800 }` silently deletes it after 7 days. There is no DLQ and no alerting pipeline beyond a single Sentry capture (which may itself fail if Sentry is misconfigured).

A customer who placed an order during a 36-second Resend outage **permanently never receives their invoice, order confirmation, or cancellation email**. The `/health` endpoint surfaces `queue.failed` count, but no automated alert is wired to it.

**Fix:** Increase `attempts` to 10+ with a max delay cap of 1 hour to ride out multi-hour outages. Add a `worker.on('failed', ...)` handler that re-enqueues to a `email-dlq` queue after exhaustion. Add a monitoring rule: alert when `queue.failed > 0`.

---

## 🔴 CRITICAL — AdminJS: password not validated as bcrypt hash — authentication bypass on plaintext password *(API Attack Surface agent)*

**File:** `backend/src/modules/admin/admin.setup.ts:1077`

`config.validation.ts` schema enforces only `min(10)` on `ADMIN_DEFAULT_PASSWORD`. It does NOT pattern-match `^\$2[ab]\$`. In `admin.setup.ts`, `bcrypt.compare(password, adminPassword)` is called where `adminPassword` is the raw env value. If an operator stores a plaintext password (the `.env.example` comment says `"must be a bcrypt hash"` but no tooling enforces it), `bcrypt.compare('Mypass', 'Mypass')` returns `false` — the admin panel becomes completely unloginnable. Operators may then disable auth entirely as a workaround.

Additionally, line 237 falls back the session secret to `adminPassword`:
```typescript
const sessionSecret = process.env.ADMIN_SESSION_SECRET ?? adminPassword;
```
If the bcrypt hash is used as the session signing secret, it is a known-format string (`$2b$12$...`) reducing entropy as an HMAC key.

**Fix:** Add Joi pattern validation: `Joi.string().pattern(/^\$2[ab]\$\d{2}\$.{53}$/)`. Make `ADMIN_SESSION_SECRET` unconditionally required in production. Remove the `adminPassword` fallback.

---

## 🔴 CRITICAL — Session fixation guard is a no-op — checks `adminUser` instead of `passport.user` *(API Attack Surface agent)*

**File:** `backend/src/modules/admin/admin.setup.ts:1092–1104`

```typescript
if (req.session?.adminUser && !req.session._regenerated) {
```

AdminJS + Passport stores the authenticated principal in `req.session.passport.user`, **not** `req.session.adminUser`. This property is never set. The regeneration block never executes. The guard is completely inert.

**Attack:** Attacker captures a pre-login session ID → injects it into the admin's browser → admin logs in → Passport populates `req.session.passport.user` but the session ID is not rotated → attacker uses the known pre-auth session ID as a fully authenticated admin session.

**Fix:** Change check to `req.session?.passport?.user && !req.session._regenerated`. Better: hook `req.session.regenerate()` directly into Passport's `serializeUser` callback.

---

## 🔴 CRITICAL — `/category/:slug` emits canonical to non-existent `/products/:slug` route *(Frontend agent)*

**File:** `frontend/src/app/features/catalog/product-list/product-list.component.ts:763`

Both `/products` and `/category/:slug` load `ProductListComponent`. Inside, `updateSeo()` always sets canonical to `/products/${slug}` regardless of which route matched. The page at `https://aromaterie.pl/category/perfume` emits `<link rel="canonical" href="https://aromaterie.pl/products/perfume">` — a URL that does not exist (there is no `/products/:slug` route; categories live at `/category/:slug`). Google sees two URLs both claiming the other as canonical, cannot resolve the conflict, and may decline to index either.

**Business impact:** Category pages are the highest-value SEO entry points for e-commerce. Broken canonicals = Google ignores them.

**Fix:** Use the actual Angular Router URL or the matched route in `updateSeo()`. Alternatively, unify all category traffic on `/category/:slug` and emit canonical pointing to that real URL.

---

## 🟠 HIGH — DHL, GLS, DPD silently enter mock mode when env var is missing (InPost fix not propagated) *(Infrastructure agent · 2/5 agents)*

**Files:**
- `backend/src/modules/shipping/carriers/dhl.client.ts:40–41`
- `backend/src/modules/shipping/carriers/gls.client.ts:34–35`
- `backend/src/modules/shipping/carriers/dpd.client.ts:33–34`

```typescript
this.mockEnabled = configService.get('DHL_MOCK_ENABLED') === 'true'
  || !configService.get('DHL_ACCOUNT_NUMBER');  // ← silent fallback
```

Round 8 patched InPost's identical OR-fallback. DHL, GLS, and DPD were not updated. If `DHL_ACCOUNT_NUMBER`, `GLS_SENDER_ID`, or `DPD_SENDER_ID` is absent from Railway's env vars in production, the carrier enters mock mode silently. Real customers receive `MOCK_DHL_*` tracking numbers. The same customer-complaint → support-ticket → chargeback cascade documented in round 8 applies to all three carriers.

**Fix:** Remove the `|| !configService.get(...)` OR-fallback from all three clients, exactly as done for InPost. Require explicit `DHL_MOCK_ENABLED=true` and `getOrThrow` credentials otherwise.

---

## 🟠 HIGH — Admin session cookie missing `secure: true` and `sameSite: 'strict'` *(API agent + Privacy agent — 2/5 agents)*

**File:** `backend/src/modules/admin/admin.setup.ts:1034–1040`

```typescript
const sessionOpts = {
  store, resave: false, saveUninitialized: false,
  secret: sessionSecret, name: 'adminjs',
  // no `cookie` key
};
```

`express-session` defaults: `cookie.secure = false`, `cookie.sameSite = undefined` (browser Lax, not server-enforced). In production:
- No `secure: true` → cookie sent over HTTP during the redirect from Railway's edge (briefly unencrypted)
- No `sameSite: 'strict'` → admin panel exposed to CSRF via top-level cross-origin navigations. AdminJS has no CSRF tokens.

**Fix:**
```typescript
cookie: {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 8 * 60 * 60 * 1000,
},
```

---

## 🟠 HIGH — Stripe webhook out-of-order: `expired` before `completed` → paid order cancelled *(Infrastructure agent)*

**File:** `backend/src/modules/payments/payments.service.ts:535–573`

Stripe does not guarantee delivery order. For BLIK/P24 async payment methods, `checkout.session.expired` can arrive before `checkout.session.completed`. When `expired` arrives first: `markSessionFailed()` checks `payment.status === COMPLETED` (false → PENDING) and proceeds to `handlePaymentFailure()` — cancels the order, restores stock. When `completed` arrives next: the idempotency keys use different event IDs, no P2002 collision fires, and `markSessionPaid()` marks the payment COMPLETED on top of the now-CANCELLED order. Final state: order=CANCELLED, payment=COMPLETED. Customer's money is taken, order is gone.

**Fix:** In `markSessionFailed()`, wrap the status check and the order-cancel in a P2002-protected idempotency insert (as `markSessionPaid` does), so only one handler wins the race. Alternatively, add `SELECT FOR UPDATE` on the payment row to serialize the two concurrent webhook processors.

---

## 🟠 HIGH — `CartItem → ProductVariant` is `onDelete: Cascade` — cart silently destroyed on variant delete *(Business Logic + API agents — 2/5 agents)*

**File:** `backend/prisma/schema.prisma:375`

```prisma
productVariant ProductVariant @relation(..., onDelete: Cascade)
```

`OrderItem` correctly uses `onDelete: Restrict` (schema line 454). The asymmetry is an oversight. When an admin hard-deletes a `ProductVariant` row (not soft-deactivates), all `CartItem` rows referencing it are silently deleted at the DB level. The user's cart shrinks with no notification, no error. Neither `products.service.ts → deleteVariant()` nor `admin.setup.ts` AdminJS delete action checks for live cart items before deletion — the AdminJS delete bypasses `deleteVariant()`'s `OrderItem` guard entirely.

**Fix:** Change `CartItem → ProductVariant` to `onDelete: Restrict`. Add a pre-delete check in `deleteVariant()` for live CartItems; throw 409 if any exist. Also add `delete: { isAccessible: false }` or a guard override in the AdminJS `ProductVariant` resource.

---

## 🟠 HIGH — Product soft-delete doesn't cascade to variants — removed products remain checkout-eligible *(Business Logic agent)*

**File:** `backend/src/modules/products/products.service.ts:450–458`

`products.service.ts → remove()` sets only `product.isActive = false`. It does NOT set `variant.isActive = false`. The checkout guard in `orders.service.ts:196–203` checks `variant.isActive = true` but never checks `product.isActive`. A customer who has a variant in their cart before the product was soft-deleted can still complete checkout for a removed product. If the product was removed due to a CPNP/compliance issue, this creates liability.

**Fix:** In `products.service.ts → remove()`, also set all variants `isActive = false` in the same transaction. Also add `AND productVariant.product.isActive = true` to the checkout guard.

---

## 🟠 HIGH — Coupon not re-validated on `retryPayment` — deactivated/expired coupons honoured indefinitely *(Business Logic agent)*

**File:** `backend/src/modules/orders/orders.service.ts:765–773`

`retryPayment` calls `initiatePayment(orderId)` which creates a new Stripe Checkout Session using the snapshotted `order.discountInCents` and `order.couponCode` from the original order — without re-validating the coupon. After an admin deactivates a coupon (flash sale ended, fraud detected), every existing `PENDING_PAYMENT` order with that coupon continues to honour it on every retry, indefinitely.

**Fix:** At the top of `initiatePayment` when `order.couponId` is set, re-run `couponService.validate`. If the coupon is now invalid, throw `BadRequestException` and inform the customer.

---

## 🟠 HIGH — 4-hour cart cleanup TTL deletes items during active 24-hour Stripe sessions *(Business Logic agent)*

**File:** `backend/src/modules/cart/cart-cleanup.service.ts:51–81`

`expireAuthenticatedCartItems` runs hourly and deletes `CartItem` rows where `updatedAt < now - 4h`. Stripe Checkout Sessions are valid for 24 hours. A user who adds items, initiates checkout, then returns 5+ hours later to pay will find their cart empty (the `retryPayment` path still works, but the visual cart is destroyed). Worse: if the user's session is expired, the "Anuluj i wróć" flow creates a confusing state where stock is held but cart is empty.

**Fix:** Skip deletion for cart items belonging to users with a `PENDING_PAYMENT` order created within the past 24 hours:
```sql
AND NOT EXISTS (
  SELECT 1 FROM orders o
  WHERE o.user_id = c.user_id
    AND o.status = 'PENDING_PAYMENT'
    AND o.created_at > NOW() - INTERVAL '24 hours'
)
```

---

## 🟠 HIGH — Review form silently fails — `orderId` never passed to backend *(Frontend agent)*

**File:** `frontend/src/app/features/catalog/product-detail/product-detail.component.ts:1363–1368`

The review submission does not pass `orderId`:
```typescript
this.reviewsService.submit({
  productId, rating: this.reviewRating, title: ..., body: ...,
  // orderId is never set
});
```
The backend `ReviewsService.create()` throws `NotFoundException('Order not found')` when `orderId` is undefined. Every review submission via the product page returns a 404. No verified-purchase reviews can ever be submitted through the current UI. `aggregateRating` in JSON-LD stays at zero permanently, killing Google product review rich snippets.

**Fix:** Pre-load the user's orders for this product and populate `orderId` automatically in the submit call. Or change the backend to accept reviews without `orderId` as unverified.

---

## 🟠 HIGH — Review request email not suppressed for returned orders *(Business Logic agent)*

**File:** `backend/src/modules/orders/orders.service.ts:980–981`

`dispatchReviewRequestEmail` fires immediately on transition to `DELIVERED` with no check for existing return requests. Customers who receive a replacement or file a withdrawal receive "Tell us what you think!" for an item they returned. Additionally, there is no `reviewRequestSentAt` guard on `Order` — a re-sync from a carrier webhook that replays the `DELIVERED` transition sends duplicate review request emails.

**Fix:** Add `reviewRequestSentAt DateTime?` to `Order`. Set it atomically when dispatching; skip if already set. Check for non-REJECTED `ReturnRequest` on this order before dispatching.

---

## 🟠 HIGH — Sentry captures `Authorization` header (live JWT) in error events *(Privacy agent)*

**File:** `backend/src/instrument.ts:25–40`

`beforeSend` only redacts `event.request.data` (body). It does not touch `event.request.headers`. When Sentry captures an exception from a guarded route, `Authorization: Bearer <access_token>` is included in the event payload. `sendDefaultPii: false` does not suppress headers — Sentry documents this explicitly. An access token in Sentry is a live credential for 15 minutes. If a Sentry project is shared across the team, any member can impersonate any user.

**GDPR:** Art. 32 — security of processing.

**Fix:**
```typescript
beforeSend(event) {
  if (event.request?.headers) {
    delete (event.request.headers as Record<string, unknown>)['authorization'];
    delete (event.request.headers as Record<string, unknown>)['cookie'];
  }
  // ... existing body redaction
}
```

---

## 🟠 HIGH — `snapshotStreet` never nulled in GDPR erasure — address survives deletion request *(Privacy agent)*

**File:** `backend/prisma/gdpr/erasure-procedure.sql:33–41`

The SQL procedure blanks `snapshotFirstName`, `snapshotLastName`, `snapshotEmail`, `snapshotPhone`, `snapshotCompany`, `snapshotNip` — but `snapshotStreet`, `snapshotCity`, and `snapshotPostalCode` are never touched. After erasure, the order row still contains the customer's full street address. Combined with `snapshotPostalCode` and `snapshotCity`, the address uniquely identifies a natural person. The ORM path in `users.service.ts:224–233` shares the same gap.

**GDPR:** Art. 17 — right to erasure; Art. 5(1)(e) — storage limitation.

**Fix:** Add to the erasure SQL UPDATE and the ORM block:
```sql
"snapshotStreet"      = NULL,
"snapshotCity"        = NULL,
"snapshotPostalCode"  = NULL,
```

---

## 🟠 HIGH — Customer IBAN placed unencrypted in BullMQ/Redis job payload *(Privacy agent)*

**File:** `backend/src/modules/email/email-queue.types.ts:120–134`

The `return_admin_notification` job payload type includes `bankAccount?: string` (the customer's IBAN). PostgreSQL stores it encrypted (Round 5 fix). But when queued into BullMQ, the value is serialised as **plaintext JSON** in the Redis list. Railway's Redis has no encryption at rest. The Round 5 fix is negated in transit.

**GDPR:** Art. 32 — security of processing.

**Fix:** Remove `bankAccount` from the job payload entirely. The admin can retrieve the IBAN from the `ReturnRequest` record in the AdminJS panel. There is no operational need to include it in an email notification.

---

## 🟠 HIGH — OAuth callback never validates `?state=` CSRF parameter *(Frontend agent)*

**File:** `frontend/src/app/features/auth/google-callback/google-callback.component.ts:16–29`

`exchangeOAuthToken()` reads the `#state` fragment and posts it to the backend as a nonce. The `?state=` query parameter that Google echoes back (the standard OAuth CSRF token) is never read or verified by the frontend. No CSRF `state` value is generated before redirect, stored in sessionStorage, and compared on return. A cross-origin attacker who can inject a crafted `?code=` into the callback URL can trigger account linking without user initiation.

**Fix:** Before `auth.loginWithGoogle()`, generate a random `state`, store it in `sessionStorage('oauth_state')`. In the callback, read `queryParamMap.get('state')`, compare with stored value, reject on mismatch.

---

## 🟠 HIGH — SSE stock stream: O(n) polling saturates Prisma pool under 1,000 connections *(Infrastructure agent)*

**File:** `backend/src/modules/products/products.controller.ts:43–134`

The SSE handler polls Prisma every 5 seconds per connection. 1,000 concurrent connections = 200 Prisma queries/second through a pool of 10 connections. This saturates the pool and causes cascading timeouts for all other modules. The per-IP connection limit (`SSE_MAX_CONNS_PER_IP = 5`) is keyed on `X-Forwarded-For` — bypassed by corporate NAT (all users share one IP → effectively one global slot). If Vercel SSR prefetches SSE, all requests arrive with Vercel's single egress IP, capping SSE globally.

**Fix:** Replace the Prisma poll loop with Postgres `LISTEN`/`NOTIFY` so the DB pushes on stock change instead of being polled. Replace the per-IP limit with a global connection cap (e.g., `sse:global:count`) stored in Redis.

---

## 🟠 HIGH — `/location/street-check` has no input length cap; enables Nominatim rate-limit abuse *(API agent)*

**File:** `backend/src/modules/location/location.controller.ts:34–57`

`street` and `city` query parameters have no `@MaxLength` validation. A 10,000-character string is forwarded to Nominatim. Beyond that: Nominatim forbids bulk requests per ToS — continued abuse from the `fragrancestore.pl` User-Agent triggers a permanent ban, breaking address validation for all users. The rate limit is `1 req/sec per IP` but the `trust proxy` setting (broken per Round 3) means this may be a single global bucket.

**Fix:** Add `@MaxLength(100)` on both params via a DTO. Add an `AbortController` with 3s timeout on the fetch. Cache successful responses in Redis by `postal+street` hash.

---

## 🟠 HIGH — `'unsafe-inline'` in CSP neutralises XSS protection for access tokens *(Frontend agent)*

**File:** `vercel.json:27`

`script-src 'self' 'unsafe-inline' ...` — `'unsafe-inline'` means any injected inline `<script>` tag runs immediately. The access token is in an Angular signal that is readable via `ng.getComponent()` or `window.dataLayer`. A single stored XSS (e.g., in a product description field) becomes a complete auth token exfiltration attack.

**Fix:** Replace `'unsafe-inline'` with a per-request nonce generated in `server.ts`. Switch GTM loading to `<script src="...">` to remove the inline injection that necessitates `'unsafe-inline'`.

---

## 🟠 HIGH — No `Organization`/`WebSite` JSON-LD — blocks Google Shopping and Knowledge Panel *(Frontend agent)*

**File:** `frontend/src/app/core/services/seo.service.ts` (absence)

`environment.prod.ts` has a complete `seller` object with name, NIP, REGON, address — but it is never serialised into a `schema.org/Organization` node on any page. There is also no `schema.org/WebSite` with `SearchAction`. Without `Organization` structured data:
- Google Shopping may reject the merchant for insufficient identity signals
- No Knowledge Panel is buildable for Aromaterie
- Polish price-comparison sites that cross-reference NIP in structured data cannot verify the seller

**Fix:** In `AppComponent` constructor, call a new `seo.setOrganizationJsonLd()` method once, populated from `environment.seller`. Add a `WebSite` node with a `SearchAction` pointing to `/products?q={search_term_string}`.

---

## 🟡 MEDIUM — Admin `adminPassword` bcrypt hash used as session secret fallback *(API agent)*

**File:** `backend/src/modules/admin/admin.setup.ts:237`

```typescript
const sessionSecret = process.env.ADMIN_SESSION_SECRET ?? adminPassword;
```

The bcrypt hash (a known-format 60-char string starting with `$2b$`) is used as the HMAC signing key for admin session cookies when `ADMIN_SESSION_SECRET` is unset. If `ADMIN_DEFAULT_PASSWORD` is ever leaked (git history, Railway variable dump), an attacker can forge admin session tokens.

**Fix:** Make `ADMIN_SESSION_SECRET` unconditionally required in production. Remove the fallback entirely.

---

## 🟡 MEDIUM — `deleteVariant()` guard bypassed via AdminJS default delete action *(API agent)*

**File:** `backend/src/modules/admin/admin.setup.ts:~307`

`deleteVariant()` in `products.service.ts` guards against deleting variants that have `OrderItem` references. The AdminJS `ProductVariant` resource does NOT override the `delete` action to call `productsService.deleteVariant()` — it calls `prisma.productVariant.delete()` directly, bypassing the guard. An AdminJS admin can hard-delete a variant with order items, triggering a `Restrict` FK violation which surfaces as an unhandled 500 in the panel.

**Fix:** Override the AdminJS `ProductVariant` delete action to call `productsService.deleteVariant()`, or set `delete: { isAccessible: false }` on that resource.

---

## 🟡 MEDIUM — Guest order tracking endpoint exposes full purchase history via sequential order numbers *(Business Logic + Privacy agents — 2/5 agents)*

**File:** `backend/src/modules/orders/orders.controller.ts:50–57`

`GET /orders/track?email=X&orderNumber=Y` returns full order contents (item names, quantities, prices, tracking number) to anyone with the correct email + order number. Order numbers are sequential (`ORD-2026-000001`). Rate limit: 5 req/60s per IP — sufficient to enumerate all orders for a known email at 300/hour. With proxies the rate limit is irrelevant.

**GDPR:** Art. 5(1)(f) — integrity and confidentiality.

**Fix:** Immediately: trim the unauthenticated response to status + trackingNumber + carrier only. Remove `items`, `totalInCents`, `createdAt`. Medium-term: add per-email lockout after 5 misses. Long-term: use the existing `guestToken` mechanism for tracking too.

---

## 🟡 MEDIUM — SSR Lambda has no application-level render timeout — Vercel 504 cascade risk *(Infrastructure agent)*

**File:** `frontend/src/server.ts:56–72`

`vercel.json` sets `maxDuration: 30s`. `CommonEngine.render()` fires `ngOnInit` HTTP calls against Railway. If Railway is cold-starting (5–15s on hobby tier), the SSR Lambda blocks. No `Promise.race` timeout wraps `commonEngine.render()`. If the backend call takes >25s, the Lambda hits Vercel's 30s hard cut and returns 504. Vercel CDN may briefly cache the 504, cascading failures for subsequent requests to the same URL.

**Fix:** Wrap `commonEngine.render()` in a `Promise.race` with a 10s timeout that falls back to a minimal client-rendered HTML shell. Set `AbortController` with 8s timeout on Angular's `HttpClient` in the SSR context.

---

## 🟡 MEDIUM — Sentry body scrubber is shallow — nested address PII not redacted *(Privacy agent)*

**File:** `backend/src/instrument.ts:32–34`

```typescript
for (const key of SENSITIVE_KEYS) {
  if (key in body) body[key] = '[REDACTED]';
}
```

This is a top-level-only check. For checkout bodies like `{ address: { street: "...", phone: "..." }, nip: "..." }`, `nip` at top level is scrubbed but `address.phone` and `address.firstName` are not. Nested personal data reaches Sentry.

**Fix:** Replace with a recursive scrubber that walks nested objects.

---

## 🟡 MEDIUM — Anonymous cookie consent keyed on IP+UA hash — not a stable or valid consent identifier *(Privacy agent)*

**File:** `backend/src/modules/users/users.controller.ts:103–106`

```typescript
const raw = `${req.ip}|${req.headers['user-agent'] ?? ''}`;
const sessionHash = createHash('sha256').update(raw).digest('hex');
```

A mobile user on 4G changes IP every few minutes; their consent record is immediately orphaned. More critically: a hash of an IP address is personal data under GDPR Recital 26 if re-identification is reasonably possible. The hash is stored in `consent_logs` without a retention policy or erasure path.

**GDPR:** Art. 7(1) — demonstrability of consent; Art. 4(1) — definition of personal data.

**Fix:** Issue a first-party UUID cookie (`consent_id`) at consent time. Store the UUID (not a hash of PII) in `consent_logs`. Add 5-year expiry to `consent_logs` rows.

---

## 🟡 MEDIUM — Admin `User.show` access not logged — accountability gap *(Privacy agent)*

**File:** `backend/src/modules/admin/admin.setup.ts:669–688`

Sensitive admin actions (refund, status change, label generation) call `logAdminAction`. But the `show.after` hook for the `User` resource — which displays email, firstName, lastName, phone, NIP, emailBounced — never calls `logAdminAction`. A UODO audit can ask "who viewed this customer's data and when?" — currently unanswerable.

**GDPR:** Art. 5(2) — accountability; Art. 25 — data protection by design.

**Fix:** Add `logAdminAction(prisma, 'viewProfile', 'User', userId, adminEmail)` inside the `show.after` hook.

---

## 🟡 MEDIUM — SSE Redis counter not reset after container crash — 12-minute reconnect lockout *(Infrastructure agent)*

**File:** `backend/src/modules/products/products.controller.ts:95–133`

The SSE connection counter uses `redis.incr(connKey)` on connect and `redis.decr(connKey)` on disconnect. If the container crashes (Railway SIGKILL, OOM), the teardown handlers never run — the Redis counter stays inflated. Users attempting to reconnect after the restart immediately hit the `SSE_MAX_CONNS_PER_IP = 5` cap. The TTL is 700 seconds (~12 minutes) — lockout lasts 12 minutes after every crash.

**Fix:** On `onApplicationShutdown`, flush all tracked connection keys. Or use a server-local `Map<ip, count>` instead of Redis (SSE connections are per-instance anyway).

---

## 🟡 MEDIUM — DPD pickup widget iframe blocked by CSP — `frame-src` missing DPD domain *(Infrastructure agent)*

**File:** `vercel.json:27` and `frontend/src/ssr-security-headers.ts:8`

CSP `frame-src` includes Cloudflare Turnstile and GTM only:
```
frame-src https://challenges.cloudflare.com https://www.googletagmanager.com;
```

The DPD pickup point widget loads from a DPD-owned domain (e.g. `cig.dpd.com.pl`). The iframe is blocked by the browser's CSP right now. Users selecting DPD pickup see a blank dialog and cannot proceed.

**Fix:** Confirm the exact DPD widget origin from `checkout-page.component.ts → dpdWidgetUrl`. Add it to `frame-src` in both `vercel.json` and `ssr-security-headers.ts`.

---

## 🟡 MEDIUM — `GET /orders/track?email=...` logs customer email in Railway request logs *(Privacy agent)*

**File:** `backend/src/logger-redact-paths.ts`

`nestjs-pino` logs the full `req.url` including query parameters. Pino's `redact` paths cover `req.body.*` and `req.headers.*` but not the URL string itself. `GET /orders/track?email=jan.kowalski@gmail.com&orderNumber=ORD-2026-000001` dumps the customer's email into Railway logs (retained 7 days, readable by all project members).

**GDPR:** Art. 5(1)(f).

**Fix:** Add a Pino `serializers.req` override:
```typescript
serializers: {
  req(req) {
    return { method: req.method, url: req.url.split('?')[0], id: req.id };
  }
}
```
Or switch the endpoint to POST with email in the body (body redaction already covers it).

---

## 🟡 MEDIUM — `onModuleInit` sequence DDL has no timeout/retry — crash-loops on DB unavailability *(Infrastructure agent)*

**File:** `backend/src/modules/orders/orders.service.ts:73–86`

`onModuleInit()` issues `CREATE SEQUENCE IF NOT EXISTS` via `$executeRawUnsafe` without a retry or timeout guard. If Supabase is momentarily unavailable during Railway startup, these calls hang, NestJS bootstrap fails, and the container crash-loops. Railway's `ON_FAILURE` restart policy respawns every ~3 seconds. Extended Supabase degradation causes repeated crash-loops that may trigger Railway's circuit breaker.

**Fix:** Wrap both DDL calls in the same retry loop pattern used by `PrismaService.onModuleInit()`. Or better: move sequence creation to a Prisma migration where it belongs.

---

## 🟡 MEDIUM — Checkout success/failure pages not `noindex` — order IDs indexable by Googlebot *(Frontend agent)*

**File:** `frontend/src/app/features/checkout/checkout-success/checkout-success.component.ts`
**File:** `frontend/src/app/features/checkout/checkout-failure/checkout-failure.component.ts`

Neither component calls `seo.setRobotsTag('noindex,nofollow')`. `AppComponent` sets `robots: index,follow` as default on every `NavigationStart`. A URL like `https://aromaterie.pl/checkout/success?orderId=abc123` can be indexed by Googlebot if shared, showing customers a "Thank you" page in search results.

**Fix:** Call `this.seo.setRobotsTag('noindex,nofollow')` in `ngOnInit` of both components.

---

## 🟡 MEDIUM — BreadcrumbList JSON-LD points to wrong category URL *(Frontend agent)*

**File:** `frontend/src/app/core/services/seo.service.ts:163–165`

```typescript
item: `${SITE_URL}/products/${product.category.slug}`,
```

The actual route for a category is `/category/:slug`, not `/products/:slug`. Every product page emits a BreadcrumbList pointing to a 404 URL for the category level. Google crawls the URL, finds no content, and the BreadcrumbList is broken.

**Fix:** Change to `item: \`${SITE_URL}/category/${product.category.slug}\``.

---

## 🟡 MEDIUM — Sorted product pages (`?sort=price_asc`) are indexable as separate URLs *(Frontend agent)*

**File:** `frontend/src/app/features/catalog/product-list/product-list.component.ts:627–631`

The `hasFilters` check does not include `sort`. `/products?sort=price_asc` and `/products?sort=price_desc` are indexed by search engines as separate pages — both with the same canonical pointing to `/products`, but different content ordering. Google sees canonical mismatch and wastes crawl budget.

**Fix:** Add `sort !== 'relevance'` (or your default sort value) to the `hasFilters` expression.

---

## 🟡 MEDIUM — `return_admin_notification` job includes customer phone in Redis *(Privacy agent)*

**File:** `backend/src/modules/email/email-queue.types.ts:126`

The `phone?: string` field in `return_admin_notification` payload serialises the customer's phone number to Redis (unencrypted). Railway Redis has no encryption at rest. Phone numbers are personal data under GDPR.

**Fix:** Remove `phone` from the job payload. Link admin to the AdminJS ReturnRequest panel view instead.

---

## 🟡 MEDIUM — Review author last initial exposed publicly *(API agent)*

**File:** `backend/src/modules/reviews/reviews.service.ts:136`

```typescript
authorName: [r.user.firstName, r.user.lastName?.charAt(0).concat('.')]
  .filter(Boolean).join(' ').trim() || 'Klient',
```

Last initials on a public, unauthenticated, un-rate-limited endpoint. Combined with public product reviews for niche fragrances, this partial name can be used to narrow down individuals.

**Fix:** Return first name only (`r.user.firstName`) or anonymise to "Verified buyer". Add `@Throttle({ ttl: 60_000, limit: 30 })` to the `getByProduct` endpoint.

---

## 🟡 MEDIUM — No `preconnect` hints for critical third-party origins *(Frontend agent)*

**File:** `frontend/src/index.html` (absence)

No `<link rel="preconnect">` for:
- `https://geowidget.easypack24.net` — InPost CSS in `<link>` is render-blocking; cold DNS = 100–400ms to LCP
- `https://challenges.cloudflare.com` — Turnstile
- `https://www.googletagmanager.com` — GTM (fires immediately for returning visitors)

**Business impact:** Google uses LCP as a Core Web Vitals ranking factor.

**Fix:** Add preconnect hints to `index.html` for all three origins.

---

## 🟡 MEDIUM — Source maps shipped in production container — bloat and disclosure risk *(Infrastructure agent)*

**File:** `backend/tsconfig.json:10` (`"sourceMap": true`)

`tsconfig.build.json` does not override this. Production build emits `*.js.map` files alongside every `*.js` in `backend/dist/`. Source maps add 20–40MB to the Railway image and expose full TypeScript source if static file serving is ever accidentally enabled.

**Fix:** Add `"sourceMap": false` to `tsconfig.build.json`. Upload maps to Sentry in CI (`sentry-cli sourcemaps upload`) and delete them from `dist/` as a post-build step.

---

## 🟢 LOW — Product slug P2002 unique constraint violation surfaces as 500 *(API agent)*

**File:** `backend/src/modules/products/products.service.ts:411–416`

`create()` and `update()` do not catch `PrismaClientKnownRequestError P2002` on the `slug` unique index. Concurrent admin creates with the same slug surface an unhandled 500 leaking internal Prisma error details.

**Fix:** Catch P2002 → `ConflictException('Slug already in use')`.

---

## 🟢 LOW — Postal code lookup calls `zippopotam.us` without cache or timeout *(API agent)*

**File:** `backend/src/modules/location/location.controller.ts:21–29`

No TTL cache, no `AbortController` timeout. zippopotam.us is a free community service with no SLA. An outage blocks checkout address validation for all users. Every keypress fires a backend→external call.

**Fix:** Cache in Redis with 24h TTL (`postal:${code}`). `AbortController` with 3s timeout. Fallback to empty array on failure (don't throw).

---

## 🟢 LOW — GA4 purchase value computed from mutable `sessionStorage` *(Frontend agent)*

**File:** `frontend/src/app/features/checkout/checkout-success/checkout-success.component.ts:288–302`

`total` reported to GA4 is computed client-side from `sessionStorage._pending_purchase`. An XSS that writes to sessionStorage before the success page loads can inflate reported revenue. Not a money issue, but corrupts business analytics.

**Fix:** Fetch order details from the backend instead (`GET /payments/:id/status` or `/orders/:id/receipt`). Delete `_pending_purchase` writes entirely.

---

## 🟢 LOW — `PreloadAllModules` preloads auth/account routes for anonymous users *(Frontend agent)*

**File:** `frontend/src/app/app.config.ts:62`

`PreloadAllModules` preloads all lazy chunks post-bootstrap, including `account`, `returns`, `wishlist`, `auth` — which anonymous visitors will never use. On 3G/4G, this competes with product image loading.

**Fix:** Replace with a custom allowlist strategy that preloads only `products` and `cart`. Consider `ngx-quicklink` for viewport-based preloading.

---

## 🟢 LOW — Admin email enumerable via bcrypt timing side-channel *(API agent)*

**File:** `backend/src/modules/admin/admin.setup.ts:1075–1078`

Wrong-email path returns immediately (~0ms); correct-email + wrong-password path runs `bcrypt.compare` (~100ms). Response timing confirms whether the guessed admin email is correct.

**Fix:** Always run `bcrypt.compare()` against a static dummy hash on email mismatch to normalise response time.

---

## 🟢 LOW — `postSlackOrderAlert` uses bare `axios.post` with no timeout — graceful shutdown stall *(Infrastructure agent)*

**File:** `backend/src/modules/payments/payments.service.ts:1380–1388`

A hanging Slack API response during a Railway rolling deploy holds the `onApplicationShutdown` drain beyond Railway's SIGKILL window, causing a forceful process kill rather than graceful drain.

**Fix:** Add `{ timeout: 3_000 }` to the `axios.post` call.

---

## Legend

| Label | Meaning |
|---|---|
| 🔴 CRITICAL | Silent infrastructure failure, auth bypass, or broken production flow right now |
| 🟠 HIGH | Direct money loss, legal exposure, security breach, or SEO-killing defect |
| 🟡 MEDIUM | Material correctness, privacy, UX, or compliance gap |
| 🟢 LOW | Hardening / polish |

---

## Agent Agreement Summary

| Finding | Agents |
|---|---|
| CartItem onDelete: Cascade (silent cart destruction) | Business Logic + API (2/5) |
| Admin session cookie missing secure/sameSite | API + Privacy (2/5) |
| DHL/GLS/DPD silent mock fallback | Infrastructure + API (2/5) |
| Guest track endpoint order history enumeration | Business Logic + Privacy (2/5) |

*Note: Many findings are single-agent because Round 10 is deep specialist territory — easy cross-agent overlaps were found in rounds 1–9.*

---

## Prioritized Fix Order

| # | Finding | Severity | Effort |
|---|---|---|---|
| 1 | Register real Turnstile site key in `environment.prod.ts` | 🔴 CRITICAL | 30 min |
| 2 | Add Redis lock to `createFromCart` — prevent duplicate orders | 🔴 CRITICAL | 2 hours |
| 3 | Add `timeout: 15_000` to all 4 carrier Axios clients | 🔴 CRITICAL | 1 hour |
| 4 | Add DLQ + increase BullMQ attempts to 10 with 1h max delay | 🔴 CRITICAL | 2 hours |
| 5 | AdminJS: validate `ADMIN_DEFAULT_PASSWORD` as bcrypt hash; require `ADMIN_SESSION_SECRET` | 🔴 CRITICAL | 1 hour |
| 6 | Fix session fixation guard: check `passport.user` not `adminUser` | 🔴 CRITICAL | 30 min |
| 7 | Fix `/category/:slug` canonical — point to actual route URL | 🔴 CRITICAL | 1 hour |
| 8 | Remove OR-fallback from DHL, GLS, DPD mock-mode detection | 🟠 HIGH | 1 hour |
| 9 | Add `secure/sameSite/httpOnly` to AdminJS session cookie | 🟠 HIGH | 30 min |
| 10 | Fix Stripe webhook out-of-order race (add idempotency in `markSessionFailed`) | 🟠 HIGH | 2 hours |
| 11 | Change `CartItem→ProductVariant` to `onDelete: Restrict`; check CartItems before variant delete | 🟠 HIGH | 2 hours |
| 12 | Cascade `isActive=false` to variants in `products.service.ts → remove()` | 🟠 HIGH | 1 hour |
| 13 | Re-validate coupon in `retryPayment` path | 🟠 HIGH | 1 hour |
| 14 | Fix cart-cleanup 4h TTL — skip users with PENDING_PAYMENT orders | 🟠 HIGH | 1 hour |
| 15 | Fix review form — pass `orderId` on submission | 🟠 HIGH | 1 hour |
| 16 | Add `reviewRequestSentAt` guard; skip review email for returned orders | 🟠 HIGH | 2 hours |
| 17 | Strip `Authorization` header in Sentry `beforeSend` | 🟠 HIGH | 30 min |
| 18 | Null `snapshotStreet`/`snapshotCity`/`snapshotPostalCode` in erasure SQL + ORM | 🟠 HIGH | 1 hour |
| 19 | Remove `bankAccount` from BullMQ job payload | 🟠 HIGH | 30 min |
| 20 | Validate `?state=` parameter in OAuth callback | 🟠 HIGH | 1 hour |
| 21 | Replace SSE Prisma polling with Postgres LISTEN/NOTIFY | 🟠 HIGH | 1 day |
| 22 | Add `@MaxLength(100)` + `AbortController` + Redis cache to street-check and postal endpoints | 🟠 HIGH | 1 hour |
| 23 | Remove `'unsafe-inline'` from CSP — switch to nonce | 🟠 HIGH | 3 hours |
| 24 | Add `Organization`/`WebSite` JSON-LD to app shell | 🟠 HIGH | 2 hours |
| 25 | Remove `adminPassword` session-secret fallback | 🟡 MEDIUM | 15 min |
| 26 | Override AdminJS `ProductVariant` delete to use `deleteVariant()` guard | 🟡 MEDIUM | 1 hour |
| 27 | Trim guest track response to status+tracking only; add per-email lockout | 🟡 MEDIUM | 1 hour |
| 28 | Wrap `commonEngine.render()` in SSR timeout/fallback | 🟡 MEDIUM | 2 hours |
| 29 | Recursive Sentry body scrubber | 🟡 MEDIUM | 1 hour |
| 30 | Replace IP+UA consent hash with first-party UUID cookie | 🟡 MEDIUM | 2 hours |
| 31 | Log `User.show` access in AdminLog | 🟡 MEDIUM | 30 min |
| 32 | Flush SSE Redis counters in `onApplicationShutdown` | 🟡 MEDIUM | 1 hour |
| 33 | Add DPD widget origin to `frame-src` in CSP | 🟡 MEDIUM | 30 min |
| 34 | Log redaction for `req.url` query params (email in track endpoint) | 🟡 MEDIUM | 1 hour |
| 35 | Wrap `onModuleInit` DDL in retry loop or migrate to Prisma migration | 🟡 MEDIUM | 1 hour |
| 36 | Add `noindex` to checkout-success and checkout-failure components | 🟡 MEDIUM | 15 min |
| 37 | Fix BreadcrumbList category URL in `seo.service.ts` | 🟡 MEDIUM | 15 min |
| 38 | Add `sort` to `hasFilters` noindex check in product list | 🟡 MEDIUM | 15 min |
| 39 | Remove `phone` from `return_admin_notification` job payload | 🟡 MEDIUM | 30 min |
| 40 | Mask review author to first name only; throttle reviews endpoint | 🟡 MEDIUM | 30 min |
| 41 | Add `preconnect` hints for InPost, Turnstile, GTM in `index.html` | 🟡 MEDIUM | 30 min |
| 42 | Disable source maps in production build; upload to Sentry in CI | 🟡 MEDIUM | 1 hour |
| 43 | Product slug P2002 → ConflictException | 🟢 LOW | 30 min |
| 44 | Cache + timeout zippopotam.us calls | 🟢 LOW | 1 hour |
| 45 | GA4: fetch order data from backend, drop sessionStorage fallback | 🟢 LOW | 1 hour |
| 46 | Replace `PreloadAllModules` with selective preload strategy | 🟢 LOW | 1 hour |
| 47 | Admin email timing side-channel — constant-time compare on wrong email | 🟢 LOW | 30 min |
| 48 | Add `{ timeout: 3_000 }` to `postSlackOrderAlert` axios call | 🟢 LOW | 15 min |
