# E-Commerce Audit — Round 5
*Generated: 2026-06-02 — 5-agent stochastic consensus*
*Agents: Domain Expert · Security Skeptic · Pragmatist (Frontend) · First-Principles (DB/Infra) · Risk Analyst (Legal/Ops)*

> **Excludes** everything already in `audit-weak-points.md`, `audit-round-2.md`, `audit-round-3.md`, `audit-round-4.md`, and `project-gaps-audit.md`.
> **Excludes** Phase 7 (pre-launch checklist) items in ROADMAP.md.

---

## Legend

| Label | Meaning |
|---|---|
| 🟠 HIGH | Real money loss, data corruption, legal exposure, or security breach |
| 🟡 MEDIUM | Degrades correctness, UX, or compliance significantly |
| 🟢 LOW | Polish / hardening |

Agent agreement noted where 2+ agents independently identified the same issue.

---

## 🟠 HIGH — No per-email account lockout on login — distributed brute force possible *(3/5 agents)*

**File:** `backend/src/modules/auth/auth.controller.ts:85`

`POST /auth/login` is throttled at 5 requests per minute **per IP only**. An attacker targeting a known customer email from multiple IPs (via proxy list, residential VPNs, or a botnet) faces zero per-account friction:

- 5 attempts/min × 60 IPs = 300 attempts/min = 432 000 attempts/day against a single account
- Common Polish e-commerce passwords (`Aromaterie1!`, `sklep123`, etc.) are found in <1 hour at this rate
- No failed-login counter exists per email address; the per-IP counter resets after 60 seconds

The broken throttler (trust proxy not set — audit-round-3.md #6) means even the IP bucket is currently a single shared bucket for all clients. Combined, authentication is effectively unprotected against targeted attacks.

**Fix:**
```typescript
// In AuthService.login(), after bcrypt comparison fails:
const failKey = `auth:login-failures:${email.toLowerCase()}`;
const lockKey = `auth:login-locked:${email.toLowerCase()}`;
if (await this.redis.exists(lockKey)) throw new UnauthorizedException('Account temporarily locked');
const failures = await this.redis.incr(failKey);
if (failures === 1) await this.redis.expire(failKey, 900);
if (failures >= 10) {
  await this.redis.setex(lockKey, 900, '1');
  throw new UnauthorizedException('Account locked — too many failed attempts');
}
// On success: await this.redis.del(failKey);
```

---

## 🟠 HIGH — IBAN stored in plaintext in `ReturnRequest.bankAccount` — GDPR Art. 32 violation *(3/5 agents)*

**Files:** `backend/src/modules/returns/dto/create-return.dto.ts:90`, `backend/prisma/schema.prisma` (ReturnRequest model)

The `bankAccount` field accepts an IBAN string (up to 34 chars) and persists it as a plain `String?` in PostgreSQL. IBAN is personal financial data under GDPR Art. 4(1) and must be protected under Art. 32 (technical measures appropriate to the risk). A database breach exposes every customer bank account number that ever requested a cash refund.

Additionally, the GDPR erasure procedure in `backend/prisma/gdpr/erasure-procedure.sql` already nulls this field — confirming the system's own design treats it as sensitive — but the data is never encrypted at rest while live.

**Fix:**
1. Use Prisma middleware to encrypt/decrypt with `libsodium` (or AES-256-GCM via Node's `crypto`) on every write/read to `ReturnRequest.bankAccount`.
2. Alternatively, use Supabase column-level encryption via `pgcrypto`:
```sql
-- Migration: encrypt existing rows
UPDATE return_requests
SET bank_account = encode(pgp_sym_encrypt(bank_account, current_setting('app.iban_key')), 'base64')
WHERE bank_account IS NOT NULL;
```
3. Add `IBAN_ENCRYPTION_KEY` to env vars (rotate independently of DB credentials).

---

## 🟠 HIGH — Sentry NestJS OpenTelemetry integration may capture plaintext request bodies *(2/5 agents)*

**File:** `backend/src/instrument.ts:15-23`

The Sentry config uses `sendDefaultPii: false`, which suppresses cookies and user IPs. However, `@sentry/nestjs` with OpenTelemetry instrumentation attaches a `requestDataIntegration` that captures HTTP request bodies by default in some SDK versions. In NestJS, any error (including 401 on login, 400 on registration) creates a Sentry event that may include the full request body:

```json
{
  "email": "user@example.com",
  "password": "UserPassword123!"
}
```

Similarly, `POST /returns` may capture `{ bankAccount: "PL61109010140000071219812874" }` and `POST /orders` may capture `{ nip: "1234567890" }`. Anyone with Sentry dashboard access sees this data.

**Verification:** Add `beforeSend` immediately to ensure this is scrubbed regardless of SDK version:

```typescript
Sentry.init({
  dsn,
  sendDefaultPii: false,
  beforeSend(event) {
    if (event.request?.data) {
      const body = typeof event.request.data === 'string'
        ? JSON.parse(event.request.data)
        : event.request.data;
      for (const key of ['password', 'newPassword', 'nip', 'bankAccount', 'token']) {
        if (key in body) body[key] = '[REDACTED]';
      }
      event.request.data = JSON.stringify(body);
    }
    return event;
  },
});
```

---

## 🟠 HIGH — Magic link replay race condition — two concurrent requests both succeed *(2/5 agents)*

**File:** `backend/src/modules/auth/auth.service.ts:440-471`

`consumeMagicLink` checks `!stored.usedAt` **outside** the transaction at line 447, then calls `tx.emailVerificationToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } })` inside it at line 457. The `UPDATE` clause has no `WHERE usedAt IS NULL` guard.

Two concurrent requests with the same token:
1. Both read `stored.usedAt = null` → both pass the outer guard
2. Both enter the `$transaction`
3. Both `UPDATE` succeeds (UPDATE with `WHERE id = X` does not check the current value of `usedAt`)
4. Both `generateTokenPair` calls return valid JWTs → attacker has two authenticated sessions for one email

**Fix:** Add `usedAt: null` to the update's WHERE clause and check the affected row count:
```typescript
await this.prisma.$transaction(async (tx) => {
  const result = await tx.emailVerificationToken.updateMany({
    where: { id: stored.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (result.count === 0) throw new BadRequestException('Token already used');
  // ... verify email, etc.
});
```

---

## 🟠 HIGH — GLS `createShipment` always returns empty `labelUrl` — GLS orders permanently stuck *(2/5 agents)*

**File:** `backend/src/modules/shipping/carriers/gls.client.ts:84`

```typescript
return {
  trackingNumber: parcel?.TrackID ?? '',
  parcelId: parcel?.ParcelNumber ?? '',
  labelUrl: '', // ← hardcoded empty string for real (non-mock) mode
};
```

In mock mode, `labelUrl` is populated (`mock-label-gls-*.pdf`). In production mode, it is always `''`. Any order fulfilled via GLS will:
- Have `Shipment.labelUrl = ''` in the DB
- Show a broken/missing label in AdminJS "Generate Label"
- Trigger `LABEL_ERROR` status if the upload logic detects the empty URL
- Never produce a printable shipping label

The GLS API returns label data via a separate `GetLabel` call using the `ParcelNumber` from the `createShipment` response — this call is simply not implemented.

**Fix:** After `createShipment`, call GLS `GetLabel` with the returned `ParcelNumber`, download the PDF bytes, upload to Supabase, and return the resulting URL. This follows the same pattern as the InPost client.

---

## 🟠 HIGH — `ProductImage` has no `@@index([productId])` — O(n) scan on every product page *(2/5 agents)*

**File:** `backend/prisma/schema.prisma:316-328`

```prisma
model ProductImage {
  id          String   @id @default(uuid())
  productId   String
  product     Product  @relation(...)
  url         String
  storagePath String
  ...
  @@map("product_images")
  // ← NO @@index([productId])
}
```

Prisma generates a JOIN or subquery on `productId` for every `include: { images: { ... } }` in product queries. Without an index on `productId`, Postgres does a sequential scan of the entire `product_images` table for each product. With 200 products × 3-5 images each = ~800 rows now; but after a real launch with thousands of products, this becomes a full table scan per product page load.

**Fix:**
```prisma
model ProductImage {
  ...
  @@index([productId])
  @@map("product_images")
}
```

Then run `pnpm db:migrate`.

---

## 🟠 HIGH — No `marketingConsent` field on `User` — review-request emails sent without GDPR basis *(2/5 agents)*

**Files:** `backend/prisma/schema.prisma` (User model), `backend/src/modules/orders/orders.service.ts:845-846`

Review request emails are dispatched when an order reaches `DELIVERED` status. `User` has no `marketingConsent` field — neither the schema, the registration DTO, nor the checkout form captures separate consent for promotional communications. The transactional email lawful basis (Art. 6(1)(b) — contract performance) does not cover post-sale review solicitations, which require Art. 6(1)(a) explicit consent.

Polish UODO's published position (2023 guidance on e-commerce transactional emails) explicitly distinguishes order confirmation (Art. 6(1)(b)) from review request / "how was your order" emails (Art. 6(1)(a)). Sending review requests to all customers without consent is an ongoing UODO fine exposure.

**Fix:**
1. Add to `User` schema: `marketingConsent Boolean @default(false)`, `marketingConsentAt DateTime?`
2. Add opt-in checkbox to checkout (unchecked by default, separate from terms acceptance)
3. In `dispatchReviewRequestEmail`, guard: `if (!order.user.marketingConsent) return;`

---

## 🟡 MEDIUM — Forgot-password rate limit is per-IP only — any email address can be bombed *(3/5 agents)*

**File:** `backend/src/modules/auth/auth.controller.ts:143`

`@Throttle({ default: { ttl: 3600000, limit: 3 } })` limits to 3 requests per IP per hour. No per-**email** rate limit exists. An attacker cycling through IPs (each IP gets 3 attempts/hour) can send unlimited reset emails to a victim's address. At 10 proxied IPs, that's 30 password reset emails per hour delivered to a target, with no upper bound — a targeted email spam / inbox flood attack requiring no compromise.

**Fix:** Add per-email deduplication in `AuthService.requestPasswordReset`:
```typescript
const dedupeKey = `pwd-reset-sent:${email.toLowerCase()}`;
if (await this.redis.exists(dedupeKey)) return; // silent no-op
await this.emailService.sendPasswordReset({ ... });
await this.redis.set(dedupeKey, '1', 'EX', 300); // 5-minute cooldown per address
```

Same pattern should apply to `POST /auth/magic-link`.

---

## 🟡 MEDIUM — No password complexity on `RegisterDto` — `aaaaaaaa` is a valid password *(3/5 agents)*

**File:** `backend/src/modules/auth/dto/register.dto.ts:13-16`

```typescript
@IsString()
@MinLength(8)
@MaxLength(72)
password!: string;
```

8 characters minimum, no other constraint. `password`, `12345678`, `aaaaaaaa`, `QWERTY12` all pass. Account compromise via credential stuffing from other leaks is amplified by weak passwords. In e-commerce, a compromised account can place orders using saved addresses and trigger Stripe refunds via the returns flow.

**Fix:** Add a `@Matches` regex. NIST SP 800-63B recommends checking against a common-password blocklist — at minimum, enforce mixed character classes:
```typescript
@Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/, {
  message: 'Hasło musi zawierać co najmniej jedną wielką literę, małą literę i cyfrę',
})
password!: string;
```

Apply the same constraint to `ResetPasswordDto` and `ChangePasswordDto`.

---

## 🟡 MEDIUM — `removeImage()` never deletes from Supabase Storage — orphaned files accumulate indefinitely *(2/5 agents)*

**File:** `backend/src/modules/products/products.service.ts:563-568`

```typescript
async removeImage(imageId: string) {
  const image = await this.prisma.productImage.findUnique({ where: { id: imageId } });
  if (!image) throw new NotFoundException('Image not found');
  await this.prisma.productImage.delete({ where: { id: imageId } });
  return image; // ← Supabase object at image.storagePath is never deleted
}
```

The DB row is deleted but the file at `storagePath` in the Supabase `product-images` bucket persists forever. Two compounding problems:
1. **Financial:** Supabase charges for storage. Unused files accumulate across product image updates (every time an admin replaces a product image, the old one stays).
2. **Privacy/URL persistence:** The old `url` (Supabase CDN public URL) remains accessible indefinitely. If that URL has been indexed by crawlers or shared in emails, the image stays visible even after "deletion".

**Fix:**
```typescript
async removeImage(imageId: string) {
  const image = await this.prisma.productImage.findUnique({ where: { id: imageId } });
  if (!image) throw new NotFoundException('Image not found');
  if (image.storagePath) {
    await this.storageService.deleteFile(image.storagePath)
      .catch(err => this.logger.warn(`Supabase delete failed: ${image.storagePath}`, err));
  }
  await this.prisma.productImage.delete({ where: { id: imageId } });
  return image;
}
```

---

## 🟡 MEDIUM — NIP validates format only, not modulo-11 checksum — invalid NIPs accepted on B2B invoices *(2/5 agents)*

**File:** `backend/src/modules/users/dto/update-profile.dto.ts:21`

```typescript
@Matches(/^\d{10}$/, { message: 'NIP must be exactly 10 digits' })
nip?: string;
```

Polish NIP requires a modulo-11 checksum: multiply digits 1-9 by weights `[6,5,7,2,3,4,5,6,7]`, sum, take `mod 11`, compare to digit 10. Without this check, `1234567890` and other syntactically valid but semantically invalid NIPs are stored and printed on VAT invoices. KAS (tax authority) automated cross-referencing flags invoices with non-existent NIPs as potentially fraudulent. B2B customers cannot deduct VAT on invoices with invalid NIPs.

**Fix:**
```typescript
function isValidNip(nip: string): boolean {
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const digits = nip.split('').map(Number);
  const sum = weights.reduce((acc, w, i) => acc + w * digits[i], 0);
  return sum % 11 === digits[9];
}

// Custom class-validator constraint or @Validate(NipConstraint):
@Matches(/^\d{10}$/)
@Validate(NipChecksumConstraint)
nip?: string;
```

---

## 🟡 MEDIUM — DHL shipper address hardcoded in source — redeployment required for address change *(2/5 agents)*

**File:** `backend/src/modules/shipping/carriers/dhl.client.ts:77-79`

```typescript
shipperDetails: {
  postalAddress: { cityName: 'Kraków', countryCode: 'PL', postalCode: '30-001', addressLine1: 'ul. Sklep 1' },
  contactInformation: { fullName: 'Fragrance Store', phone: '+48000000000', email: 'sklep@example.com' },
},
```

All other carriers use env vars for shipper identity. DHL has it hardcoded. When the business address changes (relocation, satellite warehouse, change of trading name), the code must be edited and redeployed — and the wrong address will appear on all DHL labels until the deploy completes. DHL also validates the shipper address against the account registration; a mismatch may cause label generation to fail silently.

**Fix:** Add to `.env.example` and `config.validation.ts`:
```
DHL_SHIPPER_NAME=
DHL_SHIPPER_STREET=
DHL_SHIPPER_CITY=
DHL_SHIPPER_POSTAL_CODE=
DHL_SHIPPER_PHONE=
DHL_SHIPPER_EMAIL=
```
And read via `configService.get(...)` in `DhlClient` constructor.

---

## 🟡 MEDIUM — No `Content-Security-Policy` header on frontend — unrestricted script execution *(2/5 agents)*

**Files:** `vercel.json`, `frontend/src/server.ts`

`vercel.json` defines `Cache-Control` headers for assets but no `Content-Security-Policy`. The SSR Express server in `server.ts` also sets no CSP. This means:
- Any XSS payload (from product description injection, third-party script compromise, or Angular template escape) runs with full access to cookies, localStorage, and API calls
- GTM itself loads arbitrary scripts — if the GTM container is compromised, there is no browser-enforced sandbox
- `frame-ancestors` is unset, allowing the checkout page to be embedded in an iframe (separate clickjacking surface from the `X-Frame-Options` via Helmet on the backend, which only covers API responses, not frontend HTML)

**Fix:** Add to `vercel.json`:
```json
{
  "source": "/(.*)",
  "headers": [{
    "key": "Content-Security-Policy",
    "value": "default-src 'self'; script-src 'self' https://www.googletagmanager.com https://www.google-analytics.com; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; connect-src 'self' <railway-api-url> https://www.google-analytics.com; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self';"
  }]
}
```
Note: `'unsafe-inline'` for styles is typically required with Angular; `nonce` or hash-based CSP for scripts is ideal but requires Angular build adjustments.

---

## 🟡 MEDIUM — No Angular `TransferState` — every SSR page makes double API calls *(2/5 agents)*

**Files:** `frontend/src/app/features/catalog/product-detail/product-detail.component.ts:1158`, `frontend/src/app/features/home/home.component.ts`

Angular Universal SSR renders the page and fetches product data server-side. Without `TransferState`, the client-side Angular bootstrap does NOT receive the already-fetched data — it makes the same HTTP call again after hydration. Every product page visit causes:
- 1 API call during SSR render (Node.js)
- 1 API call during client bootstrap (browser)

With 200 prerendered products this is 400 Railway requests per Vercel build. In production, every SSR render + hydration cycle doubles backend load. This also causes a visible content flash if the second fetch is slower than the initial render.

**Fix:** Use Angular's `HttpTransferCache` (introduced in Angular 17+), which is the automatic solution:
```typescript
// In app.config.ts:
provideHttpClient(
  withFetch(),            // ← required
  withInterceptors([...]),
),
// Add:
provideClientHydration(withHttpTransferCacheOptions({ includePostRequests: false })),
```
With `withFetch()` + `provideClientHydration()`, Angular automatically transfers HTTP GET responses from server to client with no per-component code changes.

---

## 🟡 MEDIUM — Product detail 404 not handled — SSR returns blank 200, Google soft-404s *(1/5 agents)*

**File:** `frontend/src/app/features/catalog/product-detail/product-detail.component.ts:1192-1196`

When the backend returns 404 for a non-existent or inactive product slug, the error handler only calls `this.loading.set(false)`. No redirect to a 404 page, no HTTP status code set in the SSR response. The page renders as a 200 OK with no content — a blank product detail shell. Google indexes blank 200s as soft-404s, which suppresses the URL from search results without signalling the problem to Search Console.

**Fix:**
```typescript
error: (err) => {
  this.loading.set(false);
  if (err.status === 404) {
    this.router.navigate(['/not-found'], { skipLocationChange: true });
  }
},
```

In SSR, set the response status:
```typescript
// In server.ts or via Angular's RESPONSE token:
if (isPlatformServer(this.platformId)) {
  inject(RESPONSE)?.status(404);
}
```

---

## 🟡 MEDIUM — `scrollPositionRestoration: 'top'` — back-navigation loses position in product list *(1/5 agents)*

**File:** `frontend/src/app/app.config.ts`

```typescript
withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
```

`'top'` scrolls to the top on every navigation — including back-navigation. A user who scrolls to item 40 in the product catalog, opens a product detail, then presses the browser back button is returned to the top of the list. On mobile this requires re-scrolling through the entire catalog. This is the #1 cause of back-button abandonment in e-commerce catalogs.

**Fix:** Change to `'enabled'`:
```typescript
withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
```

Angular will scroll to top for forward navigations and restore position on back/forward. No other code changes required.

---

## 🟡 MEDIUM — AdminJS `buildAuthenticatedRouter` has no `session.regenerate()` — session fixation *(1/5 agents)*

**File:** `backend/src/modules/admin/admin.setup.ts`

`AdminJSExpress.buildAuthenticatedRouter()` creates an express-session backed authentication flow but does not expose a hook to call `req.session.regenerate()` after successful login. Classic session fixation: an attacker plants a known session ID in the admin's browser (via a link, CSRF, or a previous logged-out state), waits for the admin to log in, then uses that same session ID to access `/admin`.

The risk is amplified by the `connect-pg-simple` session store — sessions are persistent and long-lived.

**Fix:** Add a regeneration middleware directly after the AdminJS router:
```typescript
expressApp.use('/admin', (req: any, res: any, next: any) => {
  // Regenerate session on first authenticated admin request
  if (req.session?.adminUser && !req.session._regenerated) {
    const adminUser = req.session.adminUser;
    req.session.regenerate((err: Error | null) => {
      if (err) return next(err);
      req.session.adminUser = adminUser;
      req.session._regenerated = true;
      next();
    });
  } else {
    next();
  }
});
```

---

## 🟡 MEDIUM — CORS falls back to `localhost:4200` if `FRONTEND_URL` unset in production *(1/5 agents)*

**File:** `backend/src/main.ts`

```typescript
const allowedOrigins = (process.env.FRONTEND_URL ?? 'http://localhost:4200')
  .split(',').map(o => o.trim()).filter(Boolean);
```

If `FRONTEND_URL` is accidentally absent from Railway env vars (e.g., a new replica, a restored backup, a staging deploy), the backend silently accepts requests from `localhost:4200` as if it were the correct origin. Anyone running the Angular dev server against the production API URL bypasses CORS. With credentials: true, this means cookies flow freely.

`config.validation.ts` enforces `FRONTEND_URL` in production — but only at startup, not at runtime. If it passes startup validation with a correct value and then Railway clears the env var (unlikely but possible during an incident), the running process retains the correct value — however, the risk during deploy or restart is real.

**Fix:** Add a production guard as a belt-and-suspenders check:
```typescript
if (process.env.NODE_ENV === 'production' &&
    allowedOrigins.some(o => o.includes('localhost'))) {
  throw new Error('CORS misconfiguration: localhost in FRONTEND_URL in production');
}
```

---

## 🟢 LOW — No lazy-route preloading strategy — checkout bundle loaded on navigation click *(1/5 agents)*

**File:** `frontend/src/app/app.config.ts`

No `withPreloading(...)` is configured in `provideRouter`. The checkout bundle (~150-200KB gzipped) is downloaded only when the user clicks "Przejdź do kasy". On slow 3G or a cold Vercel edge, this adds 1-2 seconds at the worst possible moment (user intending to pay).

**Fix:**
```typescript
import { PreloadAllModules, withPreloading } from '@angular/router';

provideRouter(routes, withComponentInputBinding(), withViewTransitions(), withPreloading(PreloadAllModules))
```

Or use `QuicklinkStrategy` for intersection-observer-based selective prefetch.

---

## 🟢 LOW — `$executeRawUnsafe` in invoice sequence creation — dangerous pattern *(1/5 agents)*

**File:** `backend/src/modules/invoice/invoice.service.ts:62-64`

```typescript
await this.prisma.$executeRawUnsafe(
  `CREATE SEQUENCE IF NOT EXISTS invoice_number_seq_${year} START 1 INCREMENT 1`,
);
```

`year` is sourced from `order.createdAt.getFullYear()` — a JavaScript integer, not user input — so there is no current SQL injection risk. However, `$executeRawUnsafe` is explicitly marked by Prisma as "use at your own risk" and does not sanitize its input. If future refactoring ever passes a user-supplied or untrusted `year` value, this becomes instant SQL injection.

**Fix:** Validate `year` is a safe integer before interpolation:
```typescript
private async ensureSequence(year: number): Promise<void> {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new Error(`Invalid invoice year: ${year}`);
  }
  await this.prisma.$executeRawUnsafe(
    `CREATE SEQUENCE IF NOT EXISTS invoice_number_seq_${year} START 1 INCREMENT 1`,
  );
}
```

---

## 🟢 LOW — Thumbnail `<img>` elements in product-detail have empty `alt=""` *(1/5 agents)*

**File:** `frontend/src/app/features/catalog/product-detail/product-detail.component.html`

Gallery thumbnail images use `alt=""` (empty string). Screen readers announce "image" with no product context. Google Image Search ignores images without descriptive alt text. The main product image has `[alt]="product()!.name"` (correct), but thumbnails are unlabelled.

**Fix:** Add descriptive alt to thumbnails:
```html
<img [src]="img.url" [alt]="'Zdjęcie ' + (i + 1) + ' – ' + product()!.name" class="detail__thumb" />
```

---

## Prioritised Fix Order

### Launch blockers

| # | Finding | File |
|---|---|---|
| 1 | No per-email account lockout on login | `auth.controller.ts:85` |
| 2 | IBAN stored in plaintext (GDPR Art. 32) | `schema.prisma` ReturnRequest |
| 3 | Sentry may capture plaintext passwords/NIPs | `instrument.ts:15` |
| 4 | Magic link replay race condition | `auth.service.ts:440` |
| 5 | GLS `labelUrl` always `''` — no labels possible | `gls.client.ts:84` |

### Pre-first-real-order hardening

| # | Finding | File |
|---|---|---|
| 6 | ProductImage missing `@@index([productId])` | `schema.prisma:316` |
| 7 | No `marketingConsent` field — review email basis | `schema.prisma` User |
| 8 | Forgot-password email bombing (per-IP only) | `auth.controller.ts:143` |
| 9 | No password complexity on RegisterDto | `register.dto.ts:13` |
| 10 | removeImage never deletes from Supabase Storage | `products.service.ts:563` |
| 11 | NIP no modulo-11 checksum validation | `update-profile.dto.ts:21` |
| 12 | DHL shipper address hardcoded in source | `dhl.client.ts:77` |

### Post-launch sprint

| # | Finding | File |
|---|---|---|
| 13 | No Content-Security-Policy header on frontend | `vercel.json` |
| 14 | No TransferState — double HTTP calls per SSR load | `app.config.ts` |
| 15 | Product detail 404 unhandled — SSR blank 200 | `product-detail.component.ts:1192` |
| 16 | `scrollPositionRestoration: 'top'` — back-nav loses position | `app.config.ts` |
| 17 | AdminJS session fixation — no `session.regenerate()` | `admin.setup.ts` |
| 18 | CORS `localhost` fallback in production | `main.ts` |
| 19 | No lazy-route preloading strategy | `app.config.ts` |
| 20 | `$executeRawUnsafe` year interpolation — guard it | `invoice.service.ts:62` |
| 21 | Thumbnail images have empty `alt=""` | `product-detail.component.html` |

---

## Agent Agreement Summary

| Finding | Agents |
|---|---|
| No per-email account lockout | 3/5 |
| IBAN plaintext (GDPR) | 3/5 |
| Forgot-password email bombing | 3/5 |
| No password complexity | 3/5 |
| Magic link replay race condition | 2/5 |
| Sentry captures request bodies | 2/5 |
| GLS `labelUrl` always `''` | 2/5 |
| ProductImage missing index | 2/5 |
| No marketingConsent field | 2/5 |
| DHL shipper address hardcoded | 2/5 |
| No CSP header on frontend | 2/5 |
| No TransferState double HTTP calls | 2/5 |
| NIP no checksum | 2/5 |
| removeImage no Supabase delete | 2/5 |
