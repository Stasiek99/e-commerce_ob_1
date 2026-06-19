# Audit Exclusion List

Condensed digest of every distinct finding already raised across `audit-weak-points.md`, `audit-round-2.md` through `audit-round-12.md`, `project-gaps-audit.md`, and ROADMAP.md's Phase 7 pre-launch checklist. Used to keep each new stochastic-consensus audit round focused on genuinely new gaps instead of re-discovering known ones.

After each round wraps up, fold its resolved findings into the relevant category below (condensed to one line, in the same terse style) before starting the next round. This file has no round number in its name on purpose — it is cumulative and never gets rewritten from scratch.

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
- Admin: AdminJS no `session.regenerate()` (session fixation) — and the regen-guard fix itself checks wrong session key (`adminUser` vs `passport.user`), making it inert; password not validated as bcrypt hash format; session secret falls back to admin password hash; session cookie missing `secure`/`sameSite`; admin email enumerable via bcrypt timing; admin credentials not rotatable without redeploy + no audit trail; `deleteVariant()` guard bypassed by AdminJS default delete; `User.show` access not logged — later: the regen-guard fix itself didn't cover `/admin/picklist`/`/admin/fulfillment-gap`, two custom routes registered (and `res.send`-terminated) before the guard middleware in Express dispatch order

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
- "Always restore stock on lost dispute" fix overcorrected — unconditional restore creates phantom inventory for the majority of real chargebacks where goods were genuinely delivered; fixed to require explicit admin confirmation via a `DISPUTE_LOST_REVIEW` status instead of auto-restoring
- Stripe PLN minimum-charge floor hardcoded to 50gr instead of Stripe's actual 200gr minimum; `retryPayment` called `initiatePayment` with no try/catch/rollback at all, unlike `createFromCart`
- `markSessionPaid` never cross-checks Stripe's captured `session.amount_total` against the order's stored total — no defense-in-depth against a Checkout Session built with the wrong amount
- `approveFraudReview` dispatched invoice/confirmation notifications purely in-process with no `OutboxMessage` row — a crash between commit and send permanently lost them, with no recovery path
- `reconcilePendingPayments` only selects payments with a non-null `stripeCheckoutSessionId` — orders whose `initiatePayment` failed before any session was created are invisible to reconciliation, a slow invisible leak of stock/coupon capacity
- `handlePaymentFailure` stock-restore credited the full original `quantity` instead of `quantity - cancelledQuantity`, unlike the other three restore sites in the module (dead code at the time, but a landmine for the next state-machine change)
- `sweepOrphanedPendingOrders` stock-restore had the same raw-`quantity` bug as `handlePaymentFailure`, missed in the same file ~250 lines away — fixed to subtract `cancelledQuantity` too
- Partial-refund Stripe idempotency key built only from the current call's `orderItemId:quantity` pairs, no sequence/running-total — collided across the 1st and 3rd cancellation call in a 3+-call sequence, returning Stripe's cached 1st-call result while the DB recorded a second real refund — fixed by disambiguating the key across sequential cancellations
- No zero-decimal-currency guard — every money computation assumed `STRIPE_CURRENCY` is always a 2-decimal minor unit; fixed to reject non-2-decimal currencies (JPY, KRW, VND, CLP, etc.) at boot via `config.validation.ts`
- `alreadyCancelledDiscount` recomputed the *ideal* `Math.round` discount for previously-cancelled units instead of the actual `Math.floor`-applied amount, drifting the refund a few grosz across 3+ sequential partial cancellations — fixed to persist and reuse the actual discount applied per cancelled unit
- `cancelItemsByUser`/`partialRefund` had no per-order lock — two concurrent cancellation requests on the same order (double-click, two tabs) raced past the unlocked `refundedAmountInCents` read and built the identical idempotency key; Stripe deduped the refund itself, but the second request still ran its own DB transaction, double-incrementing `cancelledQuantity` and stock — fixed with a `cancel-lock:${orderId}` Redis lock mirroring `createFromCart`'s `checkout-lock`
- Stripe SDK `apiVersion` left intentionally unset on the theory it tracked the Dashboard's account-default — `stripe-node` always sends its own bundled default instead, so the integration silently rode whatever version shipped with the installed package on any routine Dependabot bump — fixed by pinning explicitly to `2026-05-27.dahlia`, recorded in `docs/accepted-tradeoffs.md`
- Webhook route's `@Throttle({ default })` override didn't exempt it from the global `burst`/`sustained` per-IP limits, risking 429s on legitimate Stripe retry bursts from its shared IP pool — fixed with `@SkipThrottle({ burst: true, sustained: true })`
- The `cancel-lock:${orderId}` lock (entry above) only wrapped `cancelItemsByUser`/`partialRefund`, leaving `cancelByUser`, `cancelByToken`, `rejectFraudReview`, `bulkCancel`, the admin refund endpoint, and `ReturnsService.markRefunded` free to race the same `refundedAmountInCents`/`cancelledQuantity` read and double-restore stock — fixed by moving the lock into `PaymentsService.refundPayment`/`partialRefund` themselves, covering every caller by construction; also closed `cancelByUser`/`bulkCancel`/the admin refund endpoint never blocking `DISPUTE_LOST_REVIEW` the way `markRefunded` already did, letting a refund fire on funds already taken via chargeback

## Cart
- Stock oversell race (`addItem` no transaction) — original finding, later found to be structurally broken under pgbouncer (see above)
- `mergeGuestCart` bypasses `MAX_CART_QTY_PER_VARIANT` and stock guard; cart merge race not transactional
- Cart never cleared after order placement (ghost badge)
- `CartService.updateQueue` switchMap drops concurrent per-item updates, no `catchError`
- Authenticated carts never expire (stock hoarding attack)
- 4-hour cart cleanup TTL deletes items during active 24h Stripe session window
- `CartItem→ProductVariant` FK `onDelete: Cascade` (asymmetric vs `OrderItem: Restrict`) — hard variant delete silently destroys carts
- Product deactivation doesn't purge carts / doesn't cascade to variants — deactivated/soft-deleted items remain checkout-eligible
- Wishlist `addItem` skipped the `isActive` product check that `mergeGuestItems` already enforced, letting a deactivated product get wishlisted and sit there permanently — fixed to check `isActive` on both `addItem` and `getItems`
- Round 13's coupon-throttler scoping fix incidentally removed the only rate limit `POST /cart/items` had ever had (it had previously been caught by accident by an unscoped global `coupon-anon`/`coupon-auth` throttler) — fixed with an explicit `@Throttle({ default: { ttl: 60_000, limit: 20 } })` on `addItem`
- Authenticated `WishlistService.getItems()` selected only `id`/`label`/`priceInCents`/`stock` and never ran results through `attachOmnibusData()`, unlike `findAll`/`findBySlug`/`findRelated` — meaning guest wishlists (after the slug-revalidation fix above) showed the sale badge/30-day-low disclosure that authenticated wishlists never did for the same product — fixed by routing `getItems()` through the same enrichment plus surfacing `gender`/`catalogNumber`

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
- Order-number sequence DDL (`onModuleInit`, `generateOrderNumber`) interpolated the year via `$executeRawUnsafe`/`$queryRawUnsafe` with no bounds-check — same gap independently present in a second location besides `invoice.service.ts`
- `cancelByUser` inserted a redundant `REFUNDED → REFUNDED` self-loop `OrderEvent` directly via Prisma (bypassing the `ORDER_STATUS_TRANSITIONS` guard, which defines `REFUNDED` as terminal) solely to attach the withdrawal reason — duplicated the order-timeline entry; fixed by folding the reason into `refundPayment`'s own transition event

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
- `ReturnsService.approve()`/`markRefunded()` only validated `order.status` at request creation, not again before the refund actually fires days later — a Stripe dispute opened in the interim (`handleDisputeCreated` bypasses the transition guard to set `DISPUTE_HOLD`/`FRAUD_REVIEW`) let a real refund go out against a payment_intent under active chargeback — fixed by re-checking status against a `disputeBlockedStatuses` allowlist immediately before `partialRefund`

## Invoices / Tax / VAT
- Invoice totals diverge from line items (missing discount line); VAT rate hardcoded 23% on discount line for mixed-rate baskets; rounding causes 1-3gr discrepancy vs `order.totalInCents`
- Invoice number not crash-safe sequential (derived from orderNumber) — later moved to dedicated Postgres sequence, but `processInvoice` idempotency/atomicity gap (concurrent webhook+cron burns numbers); `$executeRawUnsafe` year interpolation needs bounds-check (also missing in `processCorrectiveInvoice`)
- B2B reverse-charge path missing for cross-border intra-EU
- Invoice generated for FRAUD_REVIEW/DISPUTE_HOLD orders
- Supabase signed invoice URL fixed-TTL issues (10yr signed URL breaks on key rotation; 7-day signed URL stored in BullMQ payload expires before delayed job runs)
- `SELLER_NIP` boots with empty string passing Joi `.required()`; not checksum-validated
- `processInvoice` holds `SELECT FOR UPDATE` during Supabase upload — connection pool exhaustion risk
- Invoice bucket has no RLS (cross-user PDF access) — later fixed to signed URLs; shipping-label bucket has same public-URL PII exposure issue, separately
- Corrective-invoice idempotency keyed on `correctedAmountInCents` (the refund amount) rather than correction identity — two unrelated partial cancellations totaling the same refund (common with shared price points like 99/149 PLN) collided on the unique constraint and the second correction was silently never generated; fixed to key on a `correctionRequestKey` derived from the specific items/quantities being cancelled
- Per-rate VAT breakdown on corrective invoices recomputed `originalGross` from the pristine original-order total on every call instead of the post-prior-correction base, producing an internal inconsistency between sequential corrective invoices for the same order (same "stale base on repeated partial cancellation" bug class as the discount-proration fix, reintroduced in new VAT-breakdown code)

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
- `retryPayment` re-validates the coupon on every call with no rollback — if the order's own creation consumed the coupon's last `maxUsesTotal`/`maxUsesPerUser` slot, a transient retry sees the cap as already (self-)exceeded and permanently strands stock + the coupon slot
- `coupon-validate` throttler test only exercised a synthetic test controller in isolation, not the real `CouponController`/`CouponValidateThrottlerGuard` wiring, so it couldn't prove the real route was throttled end-to-end — fixed with an integration test that boots the real controller and asserts 429s through the actual guard stack

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
- Bounce-suppression bypass for transactional emails fired identically for permanent (hard) and transient (soft) bounces — sustained hard-bounce sends risk the sending identity getting rate-limited/suspended for every customer, not just the one with the dead address; fixed to bypass only for transient bounces
- `OutboxProcessorService.recoverPendingMessages` had no distributed lock or atomic row-claiming (`SELECT ... FOR UPDATE SKIP LOCKED`), unlike the sibling `@Cron` jobs that take a Redis `SET NX` lock first — every Railway replica raced the same `PENDING` rows
- `email_logs` 365-day blanket deletion could destroy the audit trail proving a bounce-suppression decision was correct while the `User.emailBounced` flag itself persists far longer — undermines the merchant's own defense if a customer disputes non-delivery

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
- `resubmit()` reset review `status`/body/rating but never cleared `helpfulCount` or deleted stale `ReviewHelpfulVote` rows — a re-approved review kept a helpful-count inherited from different content, and prior voters could never vote again — fixed to reset both in the same transaction
- Real stock mutations (checkout decrements, cancellation/payment-failure/dispute restores — 11 call sites across orders/payments) never published to the `stock:updates` Redis channel or fired the back-in-stock notifier, only the admin manual stock-edit endpoint did — fixed by centralizing the publish + notifier check into one helper called from every mutation site
- Category product filter only descended one level of `children`, silently dropping products assigned to grandchild categories despite the schema/tree supporting arbitrary depth — fixed to recursively collect all descendant slugs
- `CategoriesService.findAll()` hardcoded a manually-nested 3-level-deep Prisma `include`, silently dropping any 4th-level-or-deeper category from `GET /categories` despite the self-referential `parentId` relation supporting arbitrary depth (producer-side instance of the same bug class as the category-filter fix above) — fixed by replacing it with a flat query + in-memory tree build of unbounded depth; `generate-sitemap.mjs`'s stale "(up to 3 levels)" comment updated to match
- `notifyStockChangesByDelta` re-derived `previousStock` via a post-commit re-read minus the known delta — two concurrent delta batches for the same variant (e.g. a partial-cancel restore racing a fresh checkout decrement) could each read the other's already-committed effect, misreporting back-in-stock transitions — fixed by having every caller pass its own transaction's `newStock` through explicitly instead of re-deriving it
- Admin `updateVariantStock()` read stock via `findUnique` then wrote the computed value via a separate `update()` — two concurrent adjustments (two admins, or a bulk import racing a manual edit) could both read the same stale stock and the second write would silently clobber the first, also risking a stale `previousStock` reported to the back-in-stock notifier — fixed by moving the read inside the transaction with `SELECT ... FOR UPDATE`
- The general variant editor (`PATCH /products/:id/variants/:variantId`, `updateVariant()`) could change `stock` via `UpdateVariantDto` without ever calling `notifyStockChange` — a 12th un-wired stock-mutation site beside the 11 already centralized (entry above) — fixed by locking the row, capturing before/after, and publishing through the same choke point
- `notifyStockChangesByDelta`'s same-variant aggregation derived `previousStock` as `newStock - summedDelta`, correct only if entries for one variant arrive in transaction-commit order — true for every current caller but unenforced by the function itself — fixed to validate each entry's implied previous stock (`newStock - delta`) against the prior entry's `newStock` and throw instead of silently miscomputing if a future caller (e.g. one built on `Promise.all`) violates the order

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
- `STATUS_LABELS` map omitted `DISPUTE_HOLD`/`DISPUTE_LOST_REVIEW`, falling back to the raw enum string with no badge color — fixed by adding Polish labels and badge colors for both
- `canCancel()` included `PARTIALLY_REFUNDED` in its allowed list, showing an active cancel button the backend always rejected with a 409 — fixed by removing it (already correctly handled by the separate `canPartialCancel()`)
- `canDownloadInvoice()` only excluded `PENDING_PAYMENT`/`CANCELLED`, so the invoice button rendered for `FRAUD_REVIEW`/`DISPUTE_HOLD` orders the backend's `nonInvoiceable` list refuses to invoice — fixed to mirror the backend list exactly
- 429 responses fell through the error interceptor's catch-all with no UI signal, surfacing NestJS's raw English `ThrottlerException` string on a Polish storefront — fixed with a dedicated 429 branch that reads `Retry-After` and shows a localized toast via `ToastService`
- Guest wishlist (localStorage-only) never revalidated its frozen product-card snapshot against the backend's `isActive`/price/stock state, unlike the authenticated path's backend-filtered `getItems()` — a deactivated, re-priced, or restocked product stayed stale indefinitely until a login-triggered merge — fixed by re-fetching each guest item by slug on load and dropping any that 404
- `AuthService.isAdmin` compared against the hardcoded string literal `'ADMIN'` instead of importing `Role` from `@fragrance-store/shared-types` (duplicate-instead-of-import pattern) — fixed to use the shared enum
- Round 14's guest-wishlist slug-revalidation fix (entry above) introduced two new races: logging in while revalidation was in flight let the slower guest response overwrite the just-synced authenticated wishlist, and toggling the heart mid-revalidation got silently discarded by the later completion callback — fixed by skipping the overwrite once authenticated and merging into current items instead of replacing them
- Order-detail page's full-cancel and partial-cancel zones tracked separate in-flight signals, letting a user fire both for the same order before either resolved — the realistic trigger for the cancel-lock-coverage gap in Payments/Stripe above — fixed with one shared `actionInFlight()` signal disabling both zones while either request is outstanding
- Backend SSE idle-timeout signal (`{reconnect:true}` + `subscriber.complete()`) had no matching frontend handling — `StockStreamService` forwarded the plain object as a `StockUpdate[]`, the product-detail page's `.find()` call threw, RxJS routed it to `error`, and nothing reopened a new `EventSource` — silently freezing every live stock badge after 5 minutes idle with no recovery short of a reload — fixed by detecting the reconnect signal and reopening the connection internally

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
- `generate-sitemap.mjs`'s `fetchJson` caught any fetch error/timeout and silently returned `null`, shipping a near-empty 4-static-route sitemap with no build failure if Railway was cold-starting during the Vercel build — fixed with retry+backoff and a hard build failure if the route count never rises above the static-only baseline
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
- Prisma migrations directory gitignored (no-op `migrate deploy` on fresh Railway) — later: gitignore rule fixed, but five new migrations still showed as untracked (`??`) on a feature branch with nothing enforcing they get `git add`ed before merge; fixed by committing them and adding a CI `prisma migrate diff --exit-code` gate
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
- `pnpm audit` step in CI was `continue-on-error: true` — a HIGH/CRITICAL CVE never actually blocked merge despite the audit step existing; fixed to fail the build on high/critical findings
- Coverage gate (`test:cov`) ran with `--passWithNoTests` while the 70%-branch threshold is scoped only to `auth`/`cart`/`orders`/`payments` `.service.ts` — a deleted/renamed/excluded spec for exactly those four money-path files would silently pass instead of failing; fixed by dropping the flag
- No documented rollback runbook for "migration applied cleanly, new app code is broken" — Prisma migrations are forward-only and a naive "redeploy previous version" click can be unsafe; fixed with `deploy-rollback-runbook.md`
- Node engine range was unbounded (`>=20`) with no `.nvmrc`/pinned Railway runtime — Railway (Railpack, reads `engines.node`) and CI (`actions/setup-node`, reads `.nvmrc`) could silently drift to different Node versions; fixed by pinning both to the same exact version
- `backend/coverage/` had 101 files tracked in git despite being gitignored, with machine-specific absolute paths causing a 100%-changed diff and guaranteed merge conflicts on every test run; fixed via `git rm -r --cached`
- Playwright e2e suite (`pnpm test:e2e`) existed and was fully wired but CI never ran it — a regression breaking checkout end-to-end could merge with a fully green run; fixed by adding a CI `e2e` job that boots Postgres+Redis+backend with mocked carrier/Stripe/Supabase credentials and runs the suite against it
- `cleanupStaleShippingLabels` was the only cron job (of 10) with no distributed lock — every replica raced duplicate deletes/updates on the same stale rows every Monday 03:00; fixed by adding the same `SET NX` Redis lock guard the other 9 crons use
- Dependabot had no `github-actions` ecosystem entry and skipped the root workspace + `packages/shared-types` — fixed by adding both npm directories plus a `github-actions, directory: /` entry — later (`2f26114`) the `packages/shared-types` npm entry was re-collapsed back into the single root `directory: /` entry; not a regression — pnpm workspace deps hoist to the root `pnpm-lock.yaml`, so one root entry still covers update-detection for every package, the `github-actions` entry is untouched, exclude
- `package.json`'s ~30-entry `pnpm.overrides` CVE-remediation block (tar, hono, vite, esbuild, ws, qs, multer, etc.) was added without regenerating `pnpm-lock.yaml` to match, so `pnpm install --frozen-lockfile` (used by Railway/Vercel/CI) failed immediately on `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` — fixed by pairing each override addition with a lockfile regeneration going forward; the untracked `audit-prod.txt`/`audit-full.json` CVE dumps that motivated the overrides are public data with no exposure risk but still have **no `.gitignore` entry** — open
- `main` (Railway/Vercel's actual deploy branch) had silently drifted ~2 months behind `develop`, leaving rounds 10-13's entire hardening backlog unmerged into prod with no mechanism to ever re-sync them — fixed by adding `.github/workflows/promote-main.yml`, a weekly (+ manual `workflow_dispatch`) job that fast-forwards `main` to `develop`'s tip only when `develop`'s latest CI run for that commit concluded `success`
- Whether `main` enforces the same required status checks/no-force-push/no-deletion as `develop` is unverified — GitHub branch protection lives in repo settings, invisible to a filesystem audit, and this repo's private-on-Free-plan status already 403s both the classic and ruleset branch-protection APIs (documented as a known gap in CLAUDE.md's deployment section) — open, blocked on a GitHub plan upgrade or making the repo public
- New e2e CI job's Playwright step had no `timeout-minutes`, relying on GitHub Actions' 6-hour job default to eventually catch a hung test (e.g. waiting on a webhook a mocked Stripe never fires) — fixed with `timeout-minutes: 10` on the step plus an 8-minute `globalTimeout` in `playwright.config.ts`

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

This list spans ~340 distinct findings (9 folded in from round 15). Each new audit round should avoid restating any of the above and focus on genuinely new angles.
