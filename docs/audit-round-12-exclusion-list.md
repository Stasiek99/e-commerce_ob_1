# Audit Round 12 — Exclusion List

Condensed digest of every distinct finding already raised across `audit-weak-points.md`, `audit-round-2.md` through `audit-round-11.md`, `project-gaps-audit.md`, and ROADMAP.md's Phase 7 pre-launch checklist. Used to keep the round-12 stochastic-consensus audit focused on genuinely new gaps instead of re-discovering known ones.

## Auth / Sessions / OAuth
- Login throttle per-IP only, no per-email lockout; `trust proxy` never set so all clients share one bucket (`auth.controller.ts`, `app.module.ts`, `main.ts`)
- No password complexity rules on `RegisterDto` (`register.dto.ts`)
- Forgot-password / magic-link bombing (per-IP only, no per-email dedupe)
- Magic link replay race (`consumeMagicLink` no `usedAt` WHERE guard)
- Google OAuth: no `state` CSRF param on strategy; frontend never validates `?state=` either; OAuth silently takes over existing password accounts with no re-auth (`google.strategy.ts`, `google-callback.component.ts`, `auth.service.ts findOrCreateGoogleUser`)
- OAuth token exchange 60s CSRF window via `oauth_access_token` cookie
- `changePassword`/`resetPassword` don't revoke current access token (jti blocklist missing) — `logout()` also never revokes access tokens (15-min takeover window)
- `requestEmailChange` doesn't revoke access tokens or all token types (MAGIC_LINK survives)
- `verifyEmail` idempotency shortcut bypasses `usedAt`/`expiresAt` guards
- JWT `validate()` Redis outage handling: JWT strategy fails open (documented tradeoff) but `login()` Redis calls have no try/catch → total lockout on Redis outage
- Dual-key JWT rotation strategy missing
- Cookie `SameSite`/`Secure` computed from stale module-load constant
- Open redirect via unvalidated `returnTo` param
- Multi-tab logout (Tab B stays authed up to 15 min) — no `BroadcastChannel`
- Concurrent 401 refresh races across tabs can orphan a token
- Guest/auth guard gaps: `authGuard` drops `returnUrl`; no `guestGuard` on login/register; `/wishlist`,`/returns` missing `canActivate`
- Admin: AdminJS no `session.regenerate()` (session fixation) — and the regen-guard fix itself checks wrong session key (`adminUser` vs `passport.user`), making it inert; password not validated as bcrypt hash format; session secret falls back to admin password hash; session cookie missing `secure`/`sameSite`; admin email enumerable via bcrypt timing; admin credentials not rotatable without redeploy + no audit trail; `deleteVariant()` guard bypassed by AdminJS default delete; `User.show` access not logged

## Payments / Stripe
- BLIK/P24 advertised but not in `payment_method_types` (fixed in code per ROADMAP but needs Stripe Dashboard activation — still a Phase 7 item)
- Coupon discount not subtracted in Stripe line items (overcharge)
- `ProcessedStripeEvent` table unbounded growth / no purge cron (ROADMAP Phase 7 item explicitly)
- `processedStripeEvent` insert not atomic with `markSessionPaid` (ROADMAP Phase 7 item explicitly)
- Reconciliation cron bypasses idempotency guard vs webhook race
- Stripe webhook out-of-order (`expired` before `completed`) flips paid order to cancelled
- No idempotency key on `sessions.create` / `coupons.create` — duplicate sessions/coupons on LB retry
- Orphaned Stripe coupon objects never deleted (on retry, on expiry)
- `retryPayment` P2002 crash creating second Payment row (PENDING and FAILED cases)
- Sub-50gr order total bypasses Stripe minimum, can orphan order on rollback failure
- Payment record created after Stripe API call (ordering risk)
- Invoice PDF base64 stored in BullMQ/Redis payload (evictable) — fixed pattern should use storagePath
- `charge.dispute.created`/`closed` not handled (initially) — later: `DISPUTE_HOLD→CANCELLED` admin transition bypasses webhook; `cancelByUser`/`cancelByUser` allow refund on `FRAUD_REVIEW`, `DISPUTE_HOLD`, `PARTIALLY_REFUNDED` orders (multiple distinct double-refund paths across rounds 6,7,9)
- `cancelItemsByUser` refunds pre-discount gross; excludes shipping on full cancellation; FREE_SHIPPING coupon proration math wrong; discount fraction recomputation compounds on second partial cancel (no cap vs `amountInCents - refundedAmountInCents`)
- Timing attack on `PAYMENTS_RECONCILE_SECRET` comparison
- `pg_advisory_xact_lock` ineffective through pgbouncer transaction-mode (sequence DDL)
- `FOR UPDATE` inside interactive transactions is a no-op under pgbouncer transaction mode — oversell protection broken (cart/order/payment stock checks)
- No HTTP timeout on Stripe-adjacent / carrier axios clients generally (see Shipping)
- Stripe payout failure / account risk not monitored (`payout.failed` not subscribed)
- Guest cancel-token embedded in success URL leaks via Referer; later fixed to Redis opaque token but TTL too short for P24/BLIK (1h vs multi-day settlement)
- Shipping rate fetched **outside** order transaction → stale price charged
- City-level velocity guard ineffective/blocks legit Warsaw customers
- BLIK/P24 fraud: Radar fires post-payment, no pre-checkout velocity check (later partially addressed, still noted as weak)
- Duplicate order creation: no idempotency/lock on `createFromCart` (double-click/double-tab double-charge)
- `markRefunded` (returns) issues full refund regardless of partial return items — doesn't call `partialRefund`
- `ProductsModule` local `REDIS_CLIENT` provider with `retryStrategy: null` permanently disconnects, shadows global client
- `pruneProcessedStripeEvents` lock TTL causes 48h cleanup gap after Railway sleep

## Cart
- Stock oversell race (`addItem` no transaction) — original finding, later found to be structurally broken under pgbouncer (see above)
- `mergeGuestCart` bypasses `MAX_CART_QTY_PER_VARIANT` and stock guard; cart merge race not transactional
- Cart never cleared after order placement (ghost badge)
- `CartService.updateQueue` switchMap drops concurrent per-item updates, no `catchError`
- Authenticated carts never expire (stock hoarding attack)
- 4-hour cart cleanup TTL deletes items during active 24h Stripe session window
- `CartItem→ProductVariant` FK `onDelete: Cascade` (asymmetric vs `OrderItem: Restrict`) — hard variant delete silently destroys carts
- Product deactivation doesn't purge carts / doesn't cascade to variants — deactivated/soft-deleted items remain checkout-eligible

## Orders
- Guest `guestEmail` not validated (`@IsEmail` missing)
- `GET /orders/track` unauthenticated/enumerable; later found to leak full order contents to anyone with email+orderNumber; `deleted@deleted` GDPR sentinel enumerable; email logged in plaintext in Railway logs via query string
- Guest `addressId` IDOR (no ownership filter when `userId` absent)
- No `OrderStatus` transition guard/allowlist
- `bulkCancel` stock inflation (ignores `cancelledQuantity`) + skips Stripe refund
- Coupon discount computed outside transaction on stale cart total
- Order confirmation email sent while still PENDING_PAYMENT (timing) — later: missing **order-creation acknowledgement** email distinct from payment-confirmed email (UoK Art. 21)
- `OrderItemDto.totalPrice` / `refundedAmountInCents` DTO gaps never populated by backend
- `getUnreadCount` monotonic forever-growing badge
- `onModuleInit` sequence DDL non-idempotent/no retry under concurrent boot or DB unavailability
- Cancel `reason` body has no DTO/length cap
- Review-request email not suppressed for returned orders; no `reviewRequestSentAt` guard (dedupe)
- NIP check-digit (modulo-11) validation missing on `CreateOrderDto.nip` (separate from profile-update NIP which does validate)
- `termsVersion`/`termsAcceptedAt` optional at order creation — no proof of T&C acceptance
- Order cancel token (HMAC) shares `JWT_ACCESS_SECRET` instead of dedicated secret (later ROADMAP added `ORDER_CANCEL_SECRET` — confirm still consistent)
- Dispute-lost flow stock-restore heuristic keyed on `labelUrl` presence is wrong signal

## Returns / Withdrawal
- `ReturnRequest` no FK to Order (fixed) — returns no-op refund/stock-restore (fixed)
- Withdrawal 14-day deadline trusted from client `deliveryDate`, not authoritative `shipment.deliveredAt`; off-by-one / not normalized to end-of-calendar-day; replacement delivery doesn't reset withdrawal clock
- IBAN stored in plaintext (`ReturnRequest.bankAccount`) — GDPR; later found still placed unencrypted into BullMQ/Redis job payload (Round 5 DB fix negated in transit) plus customer phone also leaked into Redis payload
- Return notification email uses caller-supplied `dto.email` not authenticated user's email
- `ReturnsService`/`ProductsService` bypass BullMQ retry queue (direct `EmailService` injection)
- Refund issued before confirming physical return receipt (fraud exposure)
- Unlimited return requests per order — no uniqueness guard
- Return complaints allowed on wrong-status orders (CANCELLED/PENDING_PAYMENT)
- Invoice not corrected after partial refund (no corrective invoice / faktura korygująca) — later: corrective invoice itself has no idempotency guard, no per-rate VAT breakdown

## Invoices / Tax / VAT
- Invoice totals diverge from line items (missing discount line); VAT rate hardcoded 23% on discount line for mixed-rate baskets; rounding causes 1-3gr discrepancy vs `order.totalInCents`
- Invoice number not crash-safe sequential (derived from orderNumber) — later moved to dedicated Postgres sequence, but `processInvoice` idempotency/atomicity gap (concurrent webhook+cron burns numbers); `$executeRawUnsafe` year interpolation needs bounds-check (also missing in `processCorrectiveInvoice`)
- B2B reverse-charge path missing for cross-border intra-EU
- Invoice generated for FRAUD_REVIEW/DISPUTE_HOLD orders
- Supabase signed invoice URL fixed-TTL issues (10yr signed URL breaks on key rotation; 7-day signed URL stored in BullMQ payload expires before delayed job runs)
- `SELLER_NIP` boots with empty string passing Joi `.required()`; not checksum-validated
- `processInvoice` holds `SELECT FOR UPDATE` during Supabase upload — connection pool exhaustion risk
- Invoice bucket has no RLS (cross-user PDF access) — later fixed to signed URLs; shipping-label bucket has same public-URL PII exposure issue, separately

## Coupons
- `CouponUse @@unique([couponId,userId])` race fix vs `maxUsesPerUser>1` contradiction; correct fix is row lock + `@@unique([couponId,orderId])`
- `Coupon.currentUses` drift from actual count on crash
- No DB CHECK constraints (stock≥0, rating 1-5, cancelledQuantity bounds, coupon value≤100 for percentage)
- Coupon validate brute-forceable (rate limit too generous); validate endpoint leaks discount value (oracle for enumeration)
- Coupon expiry timezone-naive (UTC vs Europe/Warsaw)
- FIXED_AMOUNT coupon excludes shipping with no UI disclosure
- FREE_SHIPPING coupon shows PLN 0 discount in UI (looks broken)
- Free-shipping coupon total stale after carrier change post-validation
- Coupon not re-validated on `retryPayment` (deactivated/expired coupon still honored)
- `CouponUse` no cascade on Coupon deletion (FK error in reconciliation cron)
- Coupon percentage `Math.round` rounds in customer's favor (documented as acceptable, not a bug)

## Shipping / Carriers
- GLS `labelUrl` always empty string in real mode
- DHL shipper address hardcoded (not env-driven)
- InPost mock mode silently activates when `INPOST_ORGANIZATION_ID` missing (fixed) — later found DHL/GLS/DPD have the *same* OR-fallback bug, never patched
- `generateLabel` no order-status guard (labels for CANCELLED/PENDING_PAYMENT; re-trigger downgrades SHIPPED/DELIVERED)
- No HTTP timeout on any carrier Axios client (event loop starvation)
- Shipping label Supabase URL permanent public unauthenticated (PII exposure)
- `shippedAt` set at label-generation not actual dispatch
- InPost shipment ID/tracking lost in error catch on Supabase upload failure
- Supabase storage upload no retry (single transient failure = permanent LABEL_ERROR)
- DPD `postMessage` handler no origin check (pickup point injection); DPD iframe blocked by CSP `frame-src` (missing DPD domain); DPD tracking URL/delivery estimate missing from UI/email
- Cross-border dangerous-goods (UN 1266 flammable) shipping restriction gate missing
- ShippingRatesService in-process cache not shared across replicas (Redis pub/sub invalidation needed)

## Email / BullMQ / Notifications
- Resend webhook signature verification silently skipped when secret unset
- BullMQ jobs have no deterministic `jobId` → duplicate emails (webhook + reconciliation cron both fire)
- No BullMQ worker crash/failed alert; no Dead Letter Queue; failed jobs deleted after 7 days silently
- Email confirmation lost when crash occurs between transaction commit and BullMQ enqueue (needs transactional outbox — later implemented as `OutboxMessage`/outbox-processor, but `outbox_messages`/`email_logs` have no retention TTL/purge cron)
- `.catch(() => undefined)` silent failure pattern on several email dispatch sites
- Unknown BullMQ job type silently marked completed instead of failing
- Email bounce handling passive (no suppression on resend) — fixed with `emailBounced` flag, but suppression then found to block ALL transactional mail indefinitely including for temporary bounces (no category split, no auto-reset)
- `email.complained` webhook doesn't set any flag / no suppression list entry
- Stored XSS in HTML email templates via unescaped interpolation (`return-admin-notification`, `shipping-notification`, `order-confirmation` templates)
- `dispute_alert` BullMQ job silently logged/skipped, no actual email sent
- Redis `retryStrategy: null` in dev kills BullMQ silently on disconnect
- `back_in_stock` job not idempotent (retry sends duplicate restock emails); flag reset happens before email send confirmed (data-loss order) — two distinct bugs across rounds
- Back-in-stock notifications tied to Product not Variant (wrong-variant notify) + excludes users who bought a different variant
- Railway rolling deploy: `worker.close(true)` exceeds SIGKILL window → duplicate emails on restart
- Sentry captures plaintext passwords/PII in request body (top-level only, recursive scrub still missing for nested address fields); captures raw email address in tags; captures `Authorization` header/live JWT; Sentry source maps never uploaded to CI

## Products / Catalog / Search
- `pg_trgm` extension never installed — search crashes
- Deactivated products accessible via direct slug URL (filter applied app-layer not query-layer)
- `ProductImage` missing `@@index([productId])`
- `removeImage()` never deletes from Supabase Storage (orphaned files)
- `inspiredBy` trademark exposed via search ranking (legal/IP risk)
- `price_desc` sort bug (products w/ no active variants sort first with Infinity)
- Pagination missing stable `id` tiebreaker
- Category circular reference / no cycle detection on `parentId`
- Category deletion unhandled FK violation (no pre-check for products/children)
- Allergen/INCI/PAO/warnings disclosure absent from API + page (EC 1223/2009) — this is explicitly a ROADMAP Phase 7 item already, exclude
- CPNP notification number field absent from Product schema
- Missing `DISCONTINUED`/`OUT_OF_STOCK` product status distinction
- Price-per-unit-of-measure (PLN/100ml) missing — ustawa o cenach
- EU Omnibus 30-day price history: gating logic exists but not populated via seed/bulk import (falls back to current price as "lowest")
- Product slug P2002 unhandled 500
- Review form never passes `orderId` (review submission always 404s) — separately, `markHelpful` unauthenticated/gameable; review bombing no email-verification gate; `Review.@@unique` blocks resubmission after rejection; `verifiedPurchase` nullified silently on order hard-delete; review author last-name initial exposed publicly

## Frontend / Angular / SSR
- SSR `localStorage` singleton cross-request leakage (fixed) — WishlistService SSR hydration mismatch (separate, still flagged)
- Multiple unguarded `document`/`sessionStorage`/`window` access points in checkout/product-detail/guards (SSR crash risk) — broad pattern, many call sites across rounds
- Vercel SSR missing `Vary: Cookie` (cache poisoning across users)
- No `TransferState`/`HttpTransferCache` — double API calls per SSR load
- Hydration mismatch in `formatDate()` (timezone-naive Date parsing)
- Reviews fire HTTP requests during SSR prerender unnecessarily
- SSR product pages have no `Cache-Control` (every load hits Lambda); no SSR render timeout (Vercel 504 cascade)
- ChunkLoadError not handled after deploy; PWA service worker stale bundle, no `SwUpdate` reload prompt
- `shared-types` dist committed to git, Vercel build skips rebuilding it (drift vs Railway)
- `scrollPositionRestoration: 'top'` breaks back-nav UX
- No lazy-route preloading strategy / later: `PreloadAllModules` over-preloads auth/account for anonymous users
- Angular subscription leaks (`PartnershipComponent`, `ProductDetailComponent` SSE/related-products, `CartService` update queues never completed)
- `effect()` writes to signal without `allowSignalWrites: true` (checkout free-shipping sync)
- `@HostListener('document:keydown')` missing SSR platform guard
- `loadFacets` subscription missing `takeUntilDestroyed`
- Checkout stepper bypasses carrier validation when navigating tabs
- `placeOrder()` always sends `newAddress`, never `addressId` (saved addresses never linked)
- Checkout failure page hardcoded `/api/...` paths (breaks on Vercel); retry flow guest-cancel always fails silently (no guest token threaded)
- Duplicate PENDING_PAYMENT orders created on checkout retry from failure page
- Success page no auto-poll on webhook race
- Guest success page displays UUID not human orderNumber
- `compareAtPriceInCents` modeled but never rendered (no strikethrough/sale badge)
- `AuthService.refresh$` `shareReplay({refCount:true})` — mid-flight cancel causes spurious logout
- Error interceptor double-logout race
- Register/login forms: no inline validation error display; no guest guard
- Product card "Add to Cart" silent failure (no toast)
- `window.confirm()` used for address delete (breaks in WebView/PWA)
- `logout` doesn't clear `oauth_access_token` cookie
- Address deletion has no auto-promotion of new default
- Wishlist auto-redirect away from its own empty state
- GA4 purchase value computed from mutable `sessionStorage`

## Accessibility (EAA/WCAG) — Round 9, large cluster, all excluded
- No skip-navigation link; no per-route `<title>`/TitleStrategy; DPD modal & lightbox no focus trap/`aria-modal`/focus restore; form errors not `role="alert"`; hero scroll-jacking inaccessible to keyboard + no `prefers-reduced-motion`; low-contrast text (cookie consent button, footer, street-hint warning); cart/wishlist badge no accessible name; lightbox `tabindex` present but never focused; in-stock filter checkbox no label association; `<a role="button">` without `href` not focusable; mobile nav no focus trap; `<time>` missing `datetime`; Taiga UI label association unverified

## SEO
- GTM placeholder fires real requests in prod (later fixed); GTM container ID still a Phase 7 TODO
- `/category/:slug` canonical points to non-existent `/products/:slug`; BreadcrumbList JSON-LD same wrong-URL bug
- No `Organization`/`WebSite` JSON-LD despite seller data existing
- Sorted product URLs (`?sort=`) indexable as separate pages
- Checkout success/failure pages not `noindex`
- No `robots.txt`; `/cart` prerendered and indexable
- `sitemap.xml` committed to git as stale artifact
- Prerendered `/products` embeds stale build-time catalog data
- Product detail 404 not handled — SSR returns blank 200 (soft-404)
- No `preconnect` hints for InPost/Turnstile/GTM origins
- Thumbnail images empty `alt=""`

## Security headers / CSP / Infra hardening
- No CSP header at all (fixed) → later: CSP `'unsafe-inline'` neutralizes XSS protection (needs nonce); missing `form-action`, `X-Frame-Options`, HSTS; DPD domain missing from `frame-src`
- AdminJS full Helmet bypass (clickjacking) — fixed to targeted bypass
- CORS falls back to `localhost:4200` if `FRONTEND_URL` unset in prod
- File upload accepts any MIME type (no magic-byte check) — stored XSS via CDN
- Sentry frontend DSN hardcoded in committed source
- No `pnpm audit`/Dependabot in CI; CI doesn't trigger on `fix/**` branches
- Prisma migrations directory gitignored (no-op `migrate deploy` on fresh Railway)
- Source maps shipped in production backend container
- `connect-pg-simple` session pool bypasses Prisma's capped pool (connection exhaustion)
- `MERCHANT_SLACK_WEBHOOK_URL` not validated as Slack-only (SSRF)
- `/location/postal-code`,`/location/street-check` unthrottled / no length cap / no cache / no timeout (Nominatim/zippopotam abuse + ban risk)
- SSE stock stream: no per-IP cap (bypassable via shared NAT IP), Prisma poll saturates pool at scale, Redis counter not reset after crash (lockout)
- HTTP graceful shutdown gap — in-flight requests cut by SIGKILL; BullMQ worker drain timing issues (`close(true)` vs SIGKILL window)
- `Payment` table missing indexes on `status`/`createdAt`
- `pnpm audit`/CVE scanning absent
- Cloudflare Turnstile disabled in production (empty site key) — this is **explicitly a ROADMAP Phase 7 hard-gate item**, exclude
- `Prisma.P2024` pool-timeout cold start returns unhandled 500; Supabase auto-pause → Railway health-check restart loop
- `@Cron` decorators run in UTC not Warsaw time; fire on every replica independently (no distributed lock)
- `railway.json` missing explicit `installCommand --frozen-lockfile`

## GDPR / Privacy / Data Retention
- `deleteAccount` doesn't scrub `ReturnRequest` PII; `snapshotStreet`/`City`/`PostalCode` never nulled in erasure (only name/email/phone/company/nip)
- GDPR erasure no open-dispute check (Art. 17(3)(b) conflict)
- Cookie/analytics consent stored only in localStorage, no server-side audit trail — later implemented as `ConsentLog` keyed on IP+UA hash (not a stable/valid identifier; itself personal data) → further fixed to UUID cookie, but **no purge job for `expiresAt`**
- `marketingConsent` field missing entirely (added) → later `marketingConsentAt` never set when changed via `PATCH /users/me`
- No data retention schedule / `retentionExpiresAt` for orders past 5-year accounting window
- `email_logs`/`outbox_messages` accumulate PII indefinitely, no TTL cron
- No `security.txt`, no documented Art. 33 breach-notification runbook

## Legal / Compliance (Polish/EU) — non-Phase-7 items only
- ODR platform link absent from footer/checkout (separate from terms-only placement)
- UŚUDE Art. 5 mandatory seller identity missing from footer (separate from Phase 7's "fill in real company data" placeholder item)
- Marketing/review consent bundled with order T&C checkbox (not separated)
- Omnibus ranking-algorithm disclosure missing ("Polecane" sort)
- Return shipping cost not disclosed at checkout (Art. 34 ust.2 UoK) — separate from withdrawal-page disclosure
- Note: allergen/CPNP/Turnstile/seller-NIP-env/seller-phone/fiscal-receipt/JPK_V7/domain-DNS/Resend-verification/Stripe-live-mode items are ROADMAP Phase 7 checklist items — excluded per instruction

## Misc DB/Schema
- `Payment`/`Shipment` missing `onDelete: Cascade`
- `CartItem`/`OrderItem`→`ProductVariant` FK missing `onDelete` rule (later found asymmetric: Cascade vs Restrict)
- `Product.avgRating Float?` IEEE754 precision risk
- Missing indexes flagged early (`User.email`, `Product.slug`, `Order.userId`, `Category.slug`) — fixed per project-gaps-audit

---

This list spans ~280 distinct findings. The round-12 audit actively avoids restating any of the above and focuses on genuinely new angles.
