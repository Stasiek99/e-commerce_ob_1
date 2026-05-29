# E-Commerce Audit — Round 2
*Generated: 2026-05-29 — 7-agent stochastic consensus*
*Agents: Domain Expert · Security Skeptic · Pragmatist (Angular) · First-Principles (DB) · Risk Analyst · End-User Advocate · Contrarian (SSR/Integration)*

> **Excludes** everything already in `audit-weak-points.md` and `project-gaps-audit.md`.
> **Excludes** Phase 7 (pre-launch checklist) items.

---

## Legend

| Label | Meaning |
|---|---|
| 🔴 BLOCKER | Must fix before any real customer |
| 🟠 HIGH | Causes real money loss, data corruption, or security breach |
| 🟡 MEDIUM | Degrades correctness or UX significantly |
| 🟢 LOW | Polish / hardening |

Agent agreement is noted where 3+ agents independently identified the same issue.

---
Done:

### 1 — Stripe checkout session ignores coupon discount — customers are overcharged
- **File:** `backend/src/modules/payments/payments.service.ts:35-49`
- **Issue:** `initiatePayment()` builds Stripe `lineItems` from individual product prices plus shipping but never subtracts `order.discountInCents`. Stripe collects `itemsTotal + shipping` while `order.totalInCents` already has the coupon deducted. A customer with a 20% coupon pays the full price.
- **Impact:** Money loss for customers → chargebacks → Stripe account risk.
- **Fix:** Push a negative line item before `createCheckoutSession`: `{ name: 'Rabat', unit_amount: -order.discountInCents, quantity: 1 }`. Also sets `payment.amountInCents` correctly (currently it records the discounted amount but Stripe charges the undiscounted one).

### 2 — Guest `guestEmail` has no `@IsEmail()` — order confirmation silently lost
- **File:** `backend/src/modules/orders/dto/create-order.dto.ts` + `orders.controller.ts:38-39`
- **Issue:** `guestEmail` is `@IsOptional() @IsString()` with no `@IsEmail()` and no `@IsNotEmpty()`. When both `user.email` and `dto.guestEmail` are falsy the non-null assertion `!` on `userEmail` suppresses TypeScript but not runtime — `snapshotEmail` is stored as `undefined`. No confirmation, no shipping notification, no order tracking via `/orders/track`.
- **Fix:** Add `@IsEmail()` and `@IsNotEmpty()` to the DTO. Guard in the service: `if (!userEmail) throw new BadRequestException('Guest email is required')`.

### 3 — `GET /orders/track` is fully unauthenticated and rate-limitless — order enumeration
- **File:** `backend/src/modules/orders/orders.controller.ts`
- **Fix applied:** Added `@Throttle({ default: { ttl: 60_000, limit: 5 } })` — 5 lookups per minute per IP. Note: `orderNumber` remains sequential; the two-factor check (email + orderNumber) provides meaningful protection but replacing it with a non-guessable UUID would fully eliminate the enumeration surface.

### 5 — `ReturnRequest` has no FK to `Order` — structurally impossible to trigger a refund
- **File:** `backend/prisma/schema.prisma` — `ReturnRequest` model
- **Fix applied:** Added `orderId String?` + `order Order? @relation(...)` to `ReturnRequest`. Migration `20260529100000_add_return_request_order_fk` adds the column, FK constraint, and index. Also fixed pre-existing drift: `shipping_rates.carrier_code` was TEXT; cast to `"CarrierCode"` enum in the same migration. `returns.service.ts create()` now sets `orderId` at request creation time.

### 4 — Return approval never triggers Stripe refund or stock restore — returns are a UI façade
- **File:** `backend/src/modules/returns/returns.service.ts`
- **Fix applied:** `markRefunded()` now calls `paymentsService.refundPayment(req.orderId, 'RETURN_APPROVAL')` before flipping status to COMPLETED. `refundPayment` handles Stripe refund issuance, stock restore, and `order.status → REFUNDED` atomically. If Stripe fails, the return stays APPROVED (retryable). Guard added for `orderId: null` (legacy rows). `PaymentsModule` added to `ReturnsModule` imports.

### 6 — SSR `localStorage` mock is a process-level singleton — cross-request state leakage
- **Fix applied:**
  - `main.server.ts`: replaced shared-store singleton with a stateless no-op (returns null/empty; never retains data between requests)
  - `frontend/src/app/core/tokens/storage.tokens.ts` (new): `LOCAL_STORAGE` injection token
  - `app.config.ts`: provides `window.localStorage` for browser; SSR overrides this per-request
  - `server.ts`: `createRequestStorageMock()` creates a fresh isolated store per request, passed via `CommonEngine.render()` providers
  - `WishlistService`: injects `LOCAL_STORAGE` token instead of using the global; adds `isPlatformBrowser()` guard on every access — returns `[]` and skips writes during SSR

### 7 — No expired `RefreshToken` cleanup — table grows unbounded
- **File:** `backend/src/modules/auth/auth.service.ts` (no `@Cron` for purge)
- **Issue:** Every login/register/OAuth creates a new `RefreshToken` row. Rows are soft-deleted (`revokedAt`) but never hard-deleted. No cron exists to purge `expiresAt < NOW()` rows. Same issue for `PasswordResetToken` and `EmailVerificationToken` (the Phase 5D cleanup cron is listed as ⏳).
- **Impact:** Table bloat → query latency regression; Supabase free-tier storage cap risk.
- **Fix:** Add a nightly `@Cron(CronExpression.EVERY_DAY_AT_4AM)` that `deleteMany({ where: { expiresAt: { lt: new Date() } } })` on all three token tables.

### 8 — Google OAuth has no `state` parameter — CSRF on the callback
- **File:** `backend/src/modules/auth/strategies/google.strategy.ts`
- **Issue:** `passport-google-oauth20` does not receive `state: true` in the strategy constructor. The callback URL (`GET /auth/google/callback`) accepts any redirect from Google with no nonce verification. An attacker can craft a Google auth URL pointing at this callback to trigger a CSRF login that links the victim's session to the attacker's Google account.
- **Fix:** Add `state: true` to the `super({...})` call. Passport will generate and verify a random nonce automatically.

### 9 — OAuth token exchange has no CSRF protection — 60-second window for token theft
- **File:** `backend/src/modules/auth/auth.controller.ts:192-203`
- **Issue:** After Google OAuth, a full access token is stored in the `oauth_access_token` httpOnly cookie and the frontend calls `GET /auth/token/exchange` to consume it. This endpoint has no CSRF protection. Any same-origin JS (including any XSS payload) can call it within 60 seconds and receive the JWT in the response body.
- **Fix:** Issue a server-side one-time nonce in the OAuth callback redirect URL fragment (`#state=nonce`). The exchange endpoint requires the nonce as a POST body param and verifies it against a Redis key before returning the token.

### 10 — `POST /email/webhook` signature verification silently skipped when `RESEND_WEBHOOK_SECRET` is unset
- **File:** `backend/src/modules/email/email-webhook.controller.ts:53-66`
- **Issue:** When the env var is empty (the default in `.env.example`), the controller logs a warning and processes the unauthenticated POST. Any actor can write arbitrary rows to `emailLog` and trigger spam-complaint Sentry alerts for real customers. No throttle.
- **Fix:** Return `503 Service Unavailable` when the secret is missing instead of processing. Add `@Throttle()`.

### 11 — Guest order `addressId` IDOR — any guest can ship to any registered user's saved address
- **File:** `backend/src/modules/orders/orders.service.ts:120-124`
- **Issue:** `where: { id: dto.addressId, ...(userId ? { userId } : {}) }` — when `userId` is absent (guest checkout), the ownership filter is omitted. A guest supplying another user's address UUID ships an order to that user's full name, street, and phone number.
- **Fix:** When `userId` is absent, disallow `addressId` entirely: `if (dto.addressId && !userId) throw new BadRequestException('Guests must supply a new address')`.

### 12 — `OrderStatus` state machine has no transition guard in `updateStatus()`
- **File:** `backend/src/modules/orders/orders.service.ts:608-647`
- **Issue:** Any `OrderStatus` target is accepted without validating the current → target transition. An admin can move `REFUNDED → PROCESSING` or `CANCELLED → PAID`. The stock restore guard (`!stockAlreadyRestored.includes(current.status)`) prevents double-restore, but the status flip itself is unrestricted, leaving order + payment records in an incoherent state.
- **Fix:** Define an explicit allowlist (`PENDING_PAYMENT → [PAID, CANCELLED]`, etc.) and throw `BadRequestException` for invalid transitions.

### 13 — `bulkCancel` restores full `item.quantity` stock, ignoring `cancelledQuantity` *(3 agents)*
- **File:** `backend/src/modules/orders/orders.service.ts:733-742`
- **Fix applied:** Stock increment now uses `activeQty = item.quantity - (item.cancelledQuantity ?? 0)` (matching `updateStatus()`). Skip update when `activeQty <= 0`. Added `PARTIALLY_REFUNDED` to `nonCancellableStatuses` — these orders are blocked from bulk-cancel and must go through the individual refund flow.

### 14 — `bulkCancel` doesn't call `refundPayment()` for PAID/PROCESSING orders
- **File:** `backend/src/modules/orders/orders.service.ts:755-767`
- **Fix applied:** `PAID`/`PROCESSING` orders now call `paymentsService.refundPayment(order.id, actor)` which handles Stripe refund, stock restore, status→`REFUNDED`, and event atomically. The manual `$transaction` block is only used for `PENDING_PAYMENT` orders (no payment to refund). `needsRefund` field removed from return type; `admin.setup.ts` updated accordingly.

### 15 — Coupon discount computed outside the DB transaction on a potentially stale cart total
- **File:** `backend/src/modules/orders/orders.service.ts:131-156`
- **Issue:** `itemsTotalInCents` is read from `cart.totalInCents` before the `$transaction` starts. If a product price changes between the cart read and the transaction commit, the `snapshotPrice` in `OrderItem` diverges from `order.totalInCents`, and the Stripe amount diverges too.
- **Fix:** Re-fetch `priceInCents` from `ProductVariant` inside the transaction and recompute `itemsTotalInCents` atomically.

### 16 — `initiatePayment` creates the `Payment` DB record after the Stripe API call — money-loss scenario
- **File:** `backend/src/modules/payments/payments.service.ts:51-73`
- **Issue:** Stripe session is created at line 51; `Payment` row inserted at line 61. If the DB insert fails (transient error), the Stripe session exists but has no `Payment` row. `markSessionPaid` (webhook) and `reconcilePendingPayments` (cron) both look up by `stripeCheckoutSessionId` in the `payments` table — they find nothing. Customer pays Stripe; order stays `PENDING_PAYMENT` forever.
- **Fix:** Create the `Payment` row *before* calling `createCheckoutSession`. If DB fails, no Stripe session is created. If Stripe fails after the DB row exists, the reconciliation cron handles it.

Not yet:
## 🔴 BLOCKER

### 17 — `changePassword` doesn't invalidate active access tokens — 15-minute continued access after compromise
- **File:** `backend/src/modules/auth/auth.service.ts:361-380`
- **Issue:** Refresh tokens are correctly revoked, but the current access token (15-min JWT) is not. An attacker with a stolen access token continues making authenticated API calls for up to 15 minutes after the victim resets their password.
- **Fix:** Implement a Redis blocklist keyed on JWT `jti`. On `changePassword`, insert all active access token JTIs. The JWT strategy checks the blocklist before accepting tokens.

### 18 — `requestEmailChange` leaves `MAGIC_LINK` tokens alive — session bypass during email change
- **File:** `backend/src/modules/auth/auth.service.ts:219-224`
- **Issue:** The `updateMany` filters on `type: EMAIL_VERIFICATION` only. Active `MAGIC_LINK` tokens survive. A magic link issued before the email-change request was made can still be consumed to authenticate as the user.
- **Fix:** Remove the `type` filter (or add a second `updateMany` for `MAGIC_LINK`) to revoke all token types.

### 19 — Reviews creatable without a purchase — `orderId` is optional, no enforcement
- **File:** `backend/src/modules/reviews/reviews.service.ts:14-53`
- **Issue:** `orderId` in `CreateReviewDto` is `@IsOptional()`. If omitted, the purchase-verification block is skipped entirely. Any authenticated user can review any product they've never bought. `verifiedPurchase` is a label, not a gate.
- **Fix:** Either require `orderId` for all reviews (`@IsUUID()` without `@IsOptional()`), or make unverified and verified reviews a deliberate policy choice — currently neither is enforced.

### 20 — `OrderItemDto.totalPrice` is in shared-types but never emitted by the backend
- **File:** `packages/shared-types/src/dto/order.dto.ts:44` vs `backend/src/modules/orders/orders.service.ts:326-352`
- **Issue:** The backend returns raw Prisma `OrderItem` objects. Prisma has no `totalPrice` column. Frontend reads `order.items[n].totalPrice` → `undefined`. Silently renders NaN in order history totals.
- **Fix:** Add a response mapper that appends `totalPrice: item.quantity * item.snapshotPrice`, or remove `totalPrice` from the DTO and compute it client-side.

### 21 — `OrderDto.refundedAmountInCents` is in shared-types but the orders query never selects it
- **File:** `packages/shared-types/src/dto/order.dto.ts:71` vs `backend/src/modules/orders/orders.service.ts:332-351`
- **Issue:** `findAllForUser` and `findOneForUser` only select `payment.status` and `payment.paidAt`. `refundedAmountInCents` lives on the `Payment` model and is never forwarded. Frontend reads it as `undefined`, showing "Refunded: 0.00 PLN" for partial refunds.
- **Fix:** Extend the payment `include` to also select `refundedAmountInCents`, or add it to the orders response mapper.

### 22 — Invoice totals diverge from line items — coupon discount missing on PDF
- **File:** `backend/src/modules/invoice/invoice.service.ts:206-229`
- **Issue:** "Razem brutto" sums per-item grosses (undiscounted). "DO ZAPŁATY" renders `order.totalInCents` (discounted). No discount line item bridges the gap. Polish VAT law (Art. 106e pkt 7) requires the discount amount and basis on the invoice.
- **Fix:** When `order.discountInCents > 0`, push a negative line item (`Rabat: [couponCode]`) so the sum of line items equals `order.totalInCents`.

### 23 — SSR crashes: unguarded `document`/`sessionStorage` access in checkout and product detail *(3 agents)*
- **Files:**
  - `frontend/src/app/core/guards/checkout.guard.ts:18` — `sessionStorage.getItem()`
  - `frontend/src/app/features/checkout/checkout-page/checkout-page.component.ts:936-949` — `document.body` in `openLockerPicker`
  - `frontend/src/app/features/catalog/product-detail/product-detail.component.ts:956,961,1031,1140` — `document.body.style.overflow`, `document.getElementById`
  - `frontend/src/app/features/checkout/checkout-auth-choice/checkout-auth-choice.component.ts:152` — `sessionStorage`
  - `frontend/src/app/features/auth/google-callback/google-callback.component.ts:14-26` — `exchangeOAuthToken()` in `ngOnInit`
- **Issue:** Angular Universal executes route guards and `ngOnInit` on the server. All of these call browser-only APIs without `isPlatformBrowser()` guards, throwing `ReferenceError` in Node and returning 500 for SSR-rendered routes.
- **Fix:** Wrap every `document`/`sessionStorage`/`window` access with `if (isPlatformBrowser(this.platformId))`. For the callback component, guard the entire `ngOnInit` body.

### 24 — Checkout failure creates duplicate `PENDING_PAYMENT` orders on retry
- **File:** `frontend/src/app/features/checkout/checkout-failure/checkout-failure.component.ts`
- **Issue:** When Stripe redirects to `/checkout/failure`, an `Order` in `PENDING_PAYMENT` already exists in the DB. Clicking "Wróć do koszyka" and re-submitting checkout creates a second order. The first stays as dangling `PENDING_PAYMENT` until the reconciliation cron expires it. No UI shows the existing order or offers "retry payment."
- **Fix:** Pass `?orderId={ORDER_ID}` in `STRIPE_CANCEL_URL` (inject at session-creation time). The failure page reads `orderId`, links to the order, and offers "Retry Payment" (POST to re-initiate Stripe session for the existing order) and "Cancel Order."

### 25 — `deleteAccount` leaves `ReturnRequest` PII unscrubbred — GDPR Art. 17 violation
- **File:** `backend/src/modules/users/users.service.ts:177-196`
- **Issue:** `deleteAccount()` anonymises `snapshotEmail`/`snapshotFirstName`/`snapshotLastName` on orders but never touches `ReturnRequest`, which has its own `email`, `firstName`, `lastName`, `phone`, and `bankAccount` (IBAN) fields — with no FK to `User` and no cascade.
- **Fix:** Add inside the deletion transaction: `prisma.returnRequest.updateMany({ where: { email: user.email }, data: { firstName: '[usunięto]', lastName: '[usunięto]', email: 'deleted@deleted', phone: null, bankAccount: null } })`.

### 26 — Cookie `SameSite`/`Secure` attributes computed from a stale module-load constant
- **File:** `backend/src/modules/auth/auth.controller.ts:33-48`
- **Issue:** `const CROSS_SITE = process.env.FRONTEND_URL?.startsWith('https://')` is evaluated at module import time — before NestJS `ConfigModule` has loaded. During Railway's `prisma migrate deploy` pre-deploy step (which imports the app module tree), `FRONTEND_URL` may not yet be in `process.env`, locking `CROSS_SITE = false` for the life of the process. All refresh-token cookies are then issued as `SameSite=Lax; Secure=false` in production.
- **Fix:** Derive the flag in the constructor via `ConfigService.get('FRONTEND_URL')` and store it as an instance property.

### 27 — Order confirmation email sent while order is still `PENDING_PAYMENT` — customer confusion
- **File:** `backend/src/modules/orders/orders.service.ts:301-316`
- **Issue:** The confirmation email fires after cart-clear but before Stripe payment. If the customer abandons Stripe, the order is cancelled but they've already received an "order confirmed" email.
- **Fix:** Move the "order confirmed" email to `markSessionPaid()` in the webhook handler. At order creation, send a "payment pending" email (or nothing) instead.

### 28 — InPost shipment label upload failure loses the carrier `shipmentId` in the error catch
- **File:** `backend/src/modules/shipping/shipping.service.ts:88-98, 198-217`
- **Issue:** When `uploadShippingLabel` (Supabase) fails after the InPost API has already committed the shipment, the catch block upserts `LABEL_ERROR` but does not store `shipmentId` or `trackingNumber`. These exist only in memory and are permanently lost. Recovery requires searching InPost's dashboard manually.
- **Fix:** In the error catch upsert, always include `shipmentId`, `trackingNumber`, and the raw carrier response, even when the Supabase upload failed.

### 29 — `markHelpful` on reviews is fully unauthenticated — trivially gameable *(2 agents)*
- **File:** `backend/src/modules/reviews/reviews.controller.ts:44-49`
- **Issue:** No `@UseGuards`, no per-user deduplication. A bot can inflate any review's `helpfulCount` without limit, poisoning the "sort by helpful" order.
- **Fix:** Require `JwtAuthGuard`. Add a `ReviewHelpfulVote` join table with `@@unique([reviewId, userId])` to enforce one vote per user.

---

## 🟡 MEDIUM

### 30 — No `@@unique([couponId, userId])` on `CouponUse` — per-user coupon limit bypassable under concurrency
- **File:** `backend/prisma/schema.prisma` — `CouponUse` model
- **Issue:** Two simultaneous orders with the same `maxUsesPerUser: 1` coupon can both pass the subquery check (both see count=0) before either commits, resulting in two `CouponUse` rows for the same `(couponId, userId)`.
- **Fix:** Add `@@unique([couponId, userId])` to `CouponUse`. This is the only race-proof solution.

### 31 — Missing DB-level constraints on critical numeric fields
- **Files:** `backend/prisma/schema.prisma`
- **Issues (add via migrations):**
  - `ProductVariant.stock`: no `CHECK (stock >= 0)` — refund bugs can go negative
  - `Review.rating`: no `CHECK (rating BETWEEN 1 AND 5)` — any integer accepted, corrupts `avgRating`
  - `OrderItem.cancelledQuantity`: no `CHECK (0 <= cancelled_quantity <= quantity)` — admin can restore 999 units on a quantity-1 item
  - `Coupon.value`: no `CHECK` for `PERCENTAGE` type `value <= 100` — 200% discount possible via direct DB edit
  - `Cart`: no `CHECK (user_id IS NOT NULL OR session_id IS NOT NULL)` — orphaned carts possible
- **Fix:** Add each constraint in a dedicated migration using `ALTER TABLE ... ADD CONSTRAINT ...`.

### 32 — `authGuard` drops the `returnUrl` — deep links silently redirect to `/`
- **File:** `frontend/src/app/core/guards/auth.guard.ts:11`
- **Issue:** `router.createUrlTree(['/auth/login'])` passes no `returnTo`. An unauthenticated user deep-linking to `/account/orders/123`, who then logs in, lands on `/` instead of their order.
- **Fix:** `return router.createUrlTree(['/auth/login'], { queryParams: { returnTo: state.url } })`.

### 33 — Cart never cleared after order placement — ghost cart badge after every purchase *(2 agents)*
- **File:** `frontend/src/app/features/checkout/checkout-page/checkout-page.component.ts:993-1005` and `checkout-success/checkout-success.component.ts`
- **Issue:** `placeOrder()` calls `window.location.href = res.paymentUrl` without clearing `_items`. After Stripe redirect and return, the header cart badge still shows the pre-order count. Same issue in the success component — `CartService` is never injected or cleared.
- **Fix:** Add `CartService.clear()` method that resets `_items` and `_cartId`. Call it in `placeOrder()` before the redirect and in `CheckoutSuccessComponent` when `paid()` becomes true.

### 34 — Error interceptor double-logout race on refresh failure
- **File:** `frontend/src/app/core/interceptors/error.interceptor.ts:29-31`
- **Issue:** On refresh failure, `clearSession()` is called then `logout().subscribe()` — which calls `clearSession()` again and navigates twice. The fire-and-forget `subscribe()` swallows errors and leaves observable chains uncleaned.
- **Fix:** `catchError` should only call `clearSession()` and `router.navigate(['/auth/login'])`, not call `logout()`.

### 35 — Success page has no polling on webhook race — user must manually refresh
- **File:** `frontend/src/app/features/checkout/checkout-success/checkout-success.component.ts:166-187`
- **Issue:** The success page makes a single `GET /payments/{id}/status`. If the webhook hasn't fired yet, "Płatność w toku" is shown with a "refresh manually" message. No auto-retry.
- **Fix:** Replace the single HTTP call with `interval(3000).pipe(switchMap(...), takeWhile(s => s.status !== 'COMPLETED', true), take(10))`. Fall back to the manual-refresh message only after 30 seconds.

### 36 — Checkout stepper header allows skipping carrier selection validation
- **File:** `frontend/src/app/features/checkout/checkout-page/checkout-page.component.ts:788-792`
- **Issue:** Clicking a stepper pill tab from Step 2 back to Step 0, then clicking Step 2 again, bypasses the `onNext()` carrier validation. A user can reach "Place Order" without selecting a carrier.
- **Fix:** Disable forward-navigation tabs, or call `onNext()` inside `onStep()` when `newIndex > this.index`.

### 37 — `ShippingRatesService` in-process cache not shared across Railway replicas
- **File:** `backend/src/modules/shipping/shipping-rates.service.ts:22-24`
- **Issue:** `private cache` and `private cacheExpiresAt` are instance variables. When admin calls `updateRate()`, only the replica that handled that request invalidates its cache. Other replicas serve stale prices for up to 5 minutes — customers see different shipping prices concurrently.
- **Fix:** Publish a Redis pub/sub invalidation event on `updateRate()` and subscribe on startup. Or skip in-process cache and use Redis with a TTL.

### 38 — `dispatchReviewRequestEmail` and other async calls use `.catch(() => undefined)` — silent failures
- **File:** `backend/src/modules/orders/orders.service.ts:644-646` (and multiple similar sites)
- **Issue:** `.catch(() => undefined)` swallows errors with zero logging. When Redis is down, queued emails are lost with no Sentry event, no log entry, no retry.
- **Fix:** Replace with `.catch((err) => this.logger.warn('Review request email failed', err))` at minimum. Establish a codebase rule: never `.catch(() => undefined)` on email operations.

### 39 — GTM placeholder `GTM-XXXXXXX` fires real Google CDN requests in production
- **File:** `frontend/src/environments/environment.prod.ts:4`
- **Issue:** `'GTM-XXXXXXX'` is truthy so the `AnalyticsService.init()` guard passes. Every production page load fires a failing request to `googletagmanager.com/gtm.js?id=GTM-XXXXXXX`.
- **Fix:** Add `if (!gtmId || gtmId.startsWith('GTM-XXX')) return;` to `AnalyticsService.init()`, or replace with the real container ID.

### 40 — Unknown BullMQ job type silently marks job as completed instead of failing it
- **File:** `backend/src/modules/email/email-queue.processor.ts:90-93`
- **Issue:** The `default` branch logs a warning and returns `undefined`. BullMQ treats a resolved promise as success. An unrecognised job type is dequeued, the email never sends, and no retry occurs. The TypeScript `never` check only catches this at compile time.
- **Fix:** Change the `default` branch to `throw new Error(\`Unknown job type: \${(data as any).type}\`)`. BullMQ will move it to failed state and apply the retry policy.

### 41 — `Review` `@@unique([userId, productId])` throws an unhandled 500 on duplicate submit
- **File:** `backend/src/modules/reviews/reviews.service.ts:43-53`
- **Issue:** Prisma throws `P2002` when a user submits a second review for the same product. This propagates as an unhandled 500 instead of a friendly 409.
- **Fix:** Catch `PrismaClientKnownRequestError` with code `P2002` and throw `ConflictException('You have already reviewed this product')`.

### 42 — Login/register routes have no guest guard — authenticated users can re-register
- **File:** `frontend/src/app/app.routes.ts:69-78`
- **Issue:** An authenticated user navigating to `/auth/register` sees the form. They can create a duplicate account. Authenticated users navigating to `/auth/login` get a confusing UX.
- **Fix:** Add a `guestGuard` that redirects to `/account` if `auth.isAuthenticated()`, and apply to both routes.

### 43 — Address deletion has no auto-promotion of a new default
- **File:** `backend/src/modules/users/users.service.ts:63-69`
- **Issue:** If the deleted address was `isDefault: true`, no other address is promoted. The user has no default address for their next checkout. `Order.addressId` also becomes `NULL` via `onDelete: SetNull`, breaking any dashboard code that joins `Order → Address`.
- **Fix:** After deletion, if `isDefault` was true, run `updateMany` to set `isDefault: true` on the most recently created remaining address (if any).

### 44 — `Payment` and `Shipment` missing `onDelete: Cascade` — hard-delete paths fail
- **File:** `backend/prisma/schema.prisma` — `Payment` and `Shipment` models
- **Issue:** Both default to `Restrict`. Any code path that hard-deletes an `Order` (e.g., future GDPR erasure) will hit a FK violation. `OrderItem` and `OrderEvent` already use `Cascade`.
- **Fix:** Add `onDelete: Cascade` to the `order` relation on both models.

### 45 — Wishlist auto-redirects away from its own empty state
- **File:** `frontend/src/app/features/wishlist/wishlist.component.ts:132-138`
- **Issue:** The `effect()` in the constructor redirects to `/products` whenever `items().length === 0` and `loading()` is false. The well-designed empty-state template is never seen. The effect also fires on page load before items finish hydrating from `localStorage`.
- **Fix:** Remove the `effect()` redirect entirely. The template's empty-state UI (`"Przeglądaj produkty"` link) is sufficient.

### 46 — Register/login forms show no inline validation errors — submit button silently stays disabled
- **File:** `frontend/src/app/features/auth/register/register.component.ts`
- **Issue:** `form.invalid` disables the submit button but there are zero `@if (field.errors)` blocks in the template. Users have no idea why the button is disabled.
- **Fix:** Add error-display blocks under each field matching the pattern already used in `checkout-page`.

### 47 — Product card "Add to Cart" fails silently on error
- **File:** `frontend/src/app/shared/product-card/product-card.component.ts:69-84`
- **Issue:** The `error` handler only calls `this.adding.set(false)`. No toast or feedback is shown.
- **Fix:** Inject `ToastService` and call `toast.error('Nie udało się dodać do koszyka.')` in the error handler.

### 48 — `window.confirm()` for address delete breaks in WebView/PWA environments
- **File:** `frontend/src/app/features/account/addresses/addresses.component.ts:612`
- **Issue:** `window.confirm()` always returns `false` in PWA WebViews and cross-origin iframes, silently blocking the delete.
- **Fix:** Use `TuiDialogService.open()` confirmation, matching the pattern in `order-detail.component.ts`.

---

## 🟢 LOW

### 49 — `logout` doesn't clear the `oauth_access_token` cookie
- **File:** `backend/src/modules/auth/auth.controller.ts:104-110`
- **Issue:** Only `REFRESH_COOKIE` is cleared. If a user calls `/auth/token/exchange` then immediately `/auth/logout` within 60 seconds, the `oauth_access_token` cookie lingers. Minimal risk but unnecessary artifact.
- **Fix:** Add `res.clearCookie('oauth_access_token', { path: '/' })`.

### 50 — `Coupon.currentUses` can drift from `COUNT(CouponUse)` on crash
- **File:** `backend/prisma/schema.prisma` — `Coupon.currentUses`
- **Issue:** `currentUses` is a denormalized counter. If the Stripe error rollback path (which decrements it) crashes before committing, `currentUses` is permanently inflated.
- **Fix:** Add a periodic reconciliation: `UPDATE coupons SET current_uses = (SELECT COUNT(*) FROM coupon_uses WHERE coupon_id = coupons.id)`.

### 51 — Invoice number is not a crash-safe sequential series
- **File:** `backend/src/modules/invoice/invoice.service.ts:93`
- **Issue:** Invoice number is derived from `orderNumber` (`FV-ORD-2026-000001`). If invoice PDF generation fails mid-upload, the next order's invoice has a gap in the sequence — illegal under Art. 106e pkt 2 Ustawy o VAT.
- **Fix:** Create a separate `invoice_number_seq_{year}` PostgreSQL sequence. Only assign the number when the PDF is successfully uploaded and the URL is saved.

### 52 — `shippedAt` set at label generation, not actual dispatch
- **File:** `backend/src/modules/shipping/shipping.service.ts:178`
- **Issue:** `shippedAt = new Date()` fires when the InPost label is generated, which can be days before the parcel is dropped off.
- **Fix:** Rename to `labelGeneratedAt`. Set `shippedAt` when the order status transitions to `SHIPPED` in `updateStatus()`.

### 53 — `getUnreadCount` is a monotonic all-time PAID count — badge is useless after first few orders
- **File:** `backend/src/modules/orders/orders.service.ts:445-450`
- **Issue:** Counts all `status = PAID` orders regardless of whether admin has viewed them. Grows forever.
- **Fix:** Add `isRead Boolean @default(false)` to `Order`. Set it when admin opens the order detail. Filter `count({ where: { status: PAID, isRead: false } })`.

### 54 — TypeScript version drift: frontend `~5.9.x` vs backend `^5.6.x`
- **File:** `frontend/package.json:58` vs `backend/package.json:91`
- **Issue:** After a `pnpm update`, decorator metadata emitted by TS 5.9 may differ from 5.6, causing subtle NestJS DI failures at runtime with no compile-time error.
- **Fix:** Pin both to `~5.9.3` and add it to the workspace root `package.json`.

### 55 — Location endpoints (`/location/postal-code`, `/location/street-check`) unthrottled
- **File:** `backend/src/modules/location/location.controller.ts`
- **Issue:** Unmetered proxies to Nominatim (1 req/s ToU) and Zippopotam. A single client can generate thousands of requests, getting the backend IP banned by Nominatim.
- **Fix:** `@Throttle({ default: { ttl: 1_000, limit: 1 } })` on `checkStreet`, `@Throttle({ default: { ttl: 60_000, limit: 20 } })` on `getCitiesByPostalCode`.

### 56 — `onModuleInit` sequence DDL is non-idempotent under concurrent pod startup
- **File:** `backend/src/modules/orders/orders.service.ts:55-66`
- **Issue:** `CREATE SEQUENCE IF NOT EXISTS` runs on every boot. Two Railway replicas starting simultaneously hold competing AccessExclusive locks — can add latency to cold-start under load.
- **Fix:** Wrap in `pg_advisory_xact_lock` or move DDL to a Prisma migration.

### 57 — Order list `loading = signal(false)` causes "Brak zamówień" flash before skeleton
- **File:** `frontend/src/app/features/account/orders/order-list.component.ts:120`
- **Issue:** `loading` initialised to `false` → the empty-state renders for one frame before `ngOnInit` sets it to `true`.
- **Fix:** `readonly loading = signal(true)`.

---

## Prioritised Fix Order

### Launch blockers (fix before first real customer)

| # | Finding |
|---|---|
| 1 | Stripe session ignores coupon discount — customer overcharge |
| 2 | Guest `guestEmail` not validated — lost order confirmations |
| 3 | `GET /orders/track` unauthenticated — PII enumeration |
| 4+5 | Return approval no-ops (no refund, no FK) |
| 6 | SSR `localStorage` singleton — cross-user state leak |
| 7 | Refresh token table grows forever — no cleanup cron |
| 8 | Google OAuth no `state` param — CSRF |
| 23 | SSR crashes in checkout/product-detail/callback |
| 24 | Checkout failure creates duplicate PENDING_PAYMENT orders |

### Pre-first-real-order hardening

| # | Finding |
|---|---|
| 9 | OAuth token exchange CSRF window |
| 10 | Resend webhook silently accepts unauthenticated POST |
| 11 | Guest addressId IDOR |
| 12 | No OrderStatus transition guard |
| 13+14 | `bulkCancel` stock inflation + no Stripe refund |
| 16 | Payment record created after Stripe call |
| 17 | changePassword doesn't invalidate access tokens |
| 25 | deleteAccount leaves ReturnRequest PII |
| 26 | Cookie SameSite from stale module-load env |
| 28 | InPost shipmentId lost in upload failure |
| 31 | Missing DB CHECK constraints (stock, rating, cancelledQuantity, coupon.value) |
| 33 | Cart never cleared after purchase |
| 34 | Error interceptor double-logout race |

### Post-launch sprint (high-value, low-blast-radius)

| # | Finding |
|---|---|
| 15+18 | Coupon discount stale; email change leaves magic links |
| 19 | Reviews without purchase |
| 20+21 | OrderItem totalPrice / refundedAmountInCents DTO gaps |
| 22 | Invoice missing discount line |
| 27 | Order confirmation email in PENDING_PAYMENT state |
| 30 | CouponUse unique constraint |
| 35 | Success page auto-poll on webhook race |
| 36 | Stepper bypasses carrier validation |
| 37 | Shipping rates cache per-replica |
| 38 | Silent `.catch(() => undefined)` on email calls |
| 40 | BullMQ unknown job type silently succeeds |
| 45 | Wishlist auto-redirect |

---

## Agent Agreement Summary

| Finding | Agents |
|---|---|
| SSR localStorage singleton / WishlistService guard | 4/7 |
| `bulkCancel` double stock restore | 3/7 |
| SSR crashes (document/sessionStorage without isPlatformBrowser) | 3/7 |
| `markHelpful` unauthenticated | 2/7 |
| Cart not cleared after purchase | 2/7 |
| Cart merge ignores stock cap | 2/7 |
| `GET /orders/track` unauthenticated enumeration | 2/7 |
