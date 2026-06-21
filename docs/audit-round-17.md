# E-Commerce Audit — Round 17
*Generated: 2026-06-20 — 6-agent stochastic consensus*
*Agents: Domain Expert (Notifications & Background Jobs) · Skeptic (Notifications & Background Jobs, sibling-miss hunting) · Domain Expert (Frontend/SSR) · Skeptic (Contract Drift — backend response / shared-types / frontend shape verification) · Domain Expert (Infra, CI & Deploy) · Risk Analyst (Infra concurrency & failure modes)*

> **Excludes** everything already in `docs/audit-exclusion-list.md` (~360 prior findings across rounds 1-16).
> **Excludes** settled tradeoffs in `docs/accepted-tradeoffs.md`.
> **Scope:** Notifications & Background Jobs (email/BullMQ/outbox/cron), Frontend/SSR & Contract Drift (Angular SSR mechanics plus backend-response ↔ shared-types ↔ frontend shape verification), and Infra/CI & Deploy (CI/CD pipeline, Railway/Vercel config, cron concurrency, graceful shutdown). Payments business logic, cart, coupons, returns, and catalog logic were out of scope except where a contract-drift or notification angle touched them directly.

Two independent agents converged on the same outbox-processor subsystem from opposite failure directions without prompting toward it: the Notifications Domain Expert found that `markSessionPaid`'s fast path marks an outbox row `PROCESSED` *before* the work it guards has even completed — a **lost-notification** bug — while the Infra Risk Analyst, auditing cron/lock concurrency from a completely different angle, found that the *recovery* poller's lock TTL doesn't cover a slow batch's full duration — a **duplicated-notification** bug in the same file. Both are real, distinct mechanisms. Separately, the Notifications Domain Expert and Skeptic both flagged the email-template HTML-escaping gap; the Skeptic's broader sweep found it spans 8 templates, not the smaller set the Domain Expert first identified — folded into one finding below. The Contract Drift Skeptic's highest-severity finding (guest order-tracking page) is a clean case of a privacy fix in one file (round-15-era) silently breaking its own frontend consumer, which nothing has caught since because the only existing test never renders the template with real data.

---

## 🔴 CRITICAL — Guest order-tracking page throws on every successful lookup — the frontend still renders fields the backend deliberately stopped sending

**Classification:** Bug
**Files:** `backend/src/modules/orders/orders.service.ts:707-714` (`trackByEmailAndNumber`), `frontend/src/app/features/orders/track-order/track-order.component.ts:28-36` (`TrackResult` interface), `:70-95` (template), `:206-218` (`track()`) *(Contract Drift Skeptic)*

A prior round's fix for the documented GDPR/enumeration-leak finding ("`GET /orders/track` ... leak full order contents to anyone with email+orderNumber") deliberately shrank `trackByEmailAndNumber`'s return value to exactly `{ status, trackingNumber, carrier }` — the code comment explicitly states "Omitting items/prices/dates prevents enumeration of purchase history." That fix touched only the backend service and its spec; it never touched `track-order.component.ts`. The frontend still types the response as the old, richer shape (`orderNumber`, `createdAt`, `totalInCents`, `items: Array<{snapshotName, quantity, snapshotPrice}>`) and the template unconditionally renders `result()!.orderNumber`, `{{ result()!.createdAt | date:'dd.MM.yyyy' }}`, and `@for (item of result()!.items; ...)` — none of which exist in the real response anymore.

**Trigger:** A guest enters a valid email + order number on `/orders/track`. The backend returns 200 with `{status, trackingNumber, carrier}`. `DatePipe` throws `InvalidPipeArgument` on the `undefined` `createdAt`, and/or Angular's `@for` throws `NG0900` iterating `undefined` `items` — the results panel never renders; a *successful, valid* lookup shows a broken page. The only existing test exercises just the pure `trackingUrl()` helper and never renders the template with a populated `result()`, so this regression has zero coverage and has been silently broken in production since the privacy fix shipped.

**Fix:** Narrow `TrackResult` to `{ status: string; trackingNumber: string | null; carrier: string | null }` and rewrite the results template to show only status + tracking link, matching what the backend actually (and intentionally) sends. Add a render-level spec asserting the component doesn't throw against the real minimal response shape.

---

## 🔴 CRITICAL — Email-verification (and email-change) links break for every normal user, not just behind a security scanner — SSR consumes the single-use token, then hydration immediately re-fires and overwrites success with an error

**Classification:** Bug
**Files:** `frontend/src/app/features/auth/verify-email/verify-email.component.ts:54-66`, `backend/src/modules/auth/auth.service.ts:377-407` (`verifyEmail` — single-use, guarded by `usedAt`/`expiresAt`), `frontend/src/app/app.config.ts` (`provideClientHydration(withHttpTransferCacheOptions({ includePostRequests: false }))`) *(Frontend/SSR Domain Expert)*

`VerifyEmailComponent.ngOnInit()` reads `token` from the query string and unconditionally calls `this.auth.verifyEmail(token).subscribe(...)` with no `isPlatformBrowser` guard anywhere in the file. `/auth/verify-email` is not in `prerender-routes.txt`, so it is rendered on-demand by the Vercel SSR Lambda for every request — meaning the **server-side render itself** sends the token-consuming `POST /auth/verify-email` from the Node SSR process before the user's browser executes a single line of client JS. Because `includePostRequests: false` excludes POST from Angular's transfer cache, hydration re-runs `ngOnInit()` client-side and fires the **identical POST a second time** — now against an already-used token, hitting the backend's `usedAt` guard and producing an error response that overwrites whatever the SSR pass rendered.

For a completely normal user clicking the link directly, with no security scanner involved: SSR renders and the token is consumed successfully → hydration fires again moments later → the backend correctly rejects the now-used token → the component's error handler sets `state = 'error'`, displaying "Link jest nieprawidłowy lub wygasł" even though verification genuinely succeeded a moment earlier. This is not an edge case requiring a corporate email-link prefetcher (Microsoft Defender Safe Links, Proofpoint, Mimecast — which would make it worse, burning the token before the user even clicks) — it is the deterministic outcome of every single normal click on every non-prerendered SSR route running this pattern. The same URL pattern (`/auth/verify-email?token=`) backs both the registration-verification and email-change-confirmation flows.

**Trigger:** Click any `/auth/verify-email?token=...` link normally in a browser. SSR consumes the token and would show success; hydration's repeat POST a moment later overwrites the page with the failure state.

**Fix:** Guard `ngOnInit()`'s body with `isPlatformBrowser` so the token is only ever consumed once by the real browser, not by the discarded SSR render. Independently, this component needs hydration-safe handling — the SSR-rendered state needs to either be the source of truth (via `TransferState`, since POST isn't covered by `HttpTransferCache`) or `ngOnInit()` needs a one-shot guard so the client doesn't immediately repeat a request the server already made.

---

## 🔴 CRITICAL — Graceful shutdown is not actually graceful: Prisma disconnects before the HTTP server drains in-flight requests, despite `main.ts`'s own comments claiming otherwise

**Classification:** Bug
**Files:** `backend/src/main.ts:100-114` (shutdown hook registration + comments claiming in-flight requests "finish normally"), `backend/src/modules/prisma/prisma.service.ts:42-44` (`onModuleDestroy` → `$disconnect()`); confirmed against `@nestjs/core`'s actual shutdown sequence (`nest-application-context.js`'s `cleanup()`: `callDestroyHook()` → `callBeforeShutdownHook()` → `dispose()` → `callShutdownHook()`; `nest-application.js`'s `dispose()` is what calls `httpAdapter.close()`) *(Infra Risk Analyst)*

`main.ts` calls `app.enableShutdownHooks()`, registering Nest's own `SIGTERM` listener, then separately registers a second `process.once('SIGTERM', ...)` handler afterward. On `SIGTERM`, Nest's `cleanup()` runs **`callDestroyHook()` first** — invoking every provider's `onModuleDestroy()`, including `PrismaService`'s, which disconnects the Prisma engine **process-wide**. Only *after* that fully completes does Nest reach `dispose()` → `httpAdapter.close()` → the step that actually stops accepting new connections and waits for in-flight requests to finish. This is the opposite order from what graceful shutdown requires: by the time the HTTP server begins draining, Prisma has already been torn down for every still-in-flight request. The `main.ts` comment claiming in-flight requests "finish normally (bounded by the 8s TimeoutInterceptor)" describes behavior that does not occur for any in-flight handler that needs a Prisma call after `callDestroyHook()` resolves.

**Trigger:** Any request mid-handler (e.g. `OrdersService.createFromCart`, about to call `tx.order.create(...)`) when Railway sends `SIGTERM` for a routine rolling deploy. Nest's hardcoded hook ordering guarantees Prisma disconnects before the HTTP server even starts draining — this isn't a narrow timing race, it's a structural ordering bug that fires on every deploy that lands during live traffic (the normal case, not the exception). The in-flight request's next Prisma call throws `PrismaClientInitializationError` instead of completing or being cleanly cut by the timeout interceptor — a checkout/payment transaction can 500 mid-write during routine deploys.

**Fix:** Decouple HTTP-drain from provider teardown. Replace `app.enableShutdownHooks()` + the separate `SIGTERM` listener with a single custom handler that calls `await server.close()` (resolving once in-flight connections finish, or racing against the existing timeout budget) **before** triggering `app.close()` — so Prisma/BullMQ teardown only happens once the HTTP server has actually finished draining.

---

## 🟠 HIGH — Outbox rows are marked `PROCESSED` before the notification work they guard has even completed, defeating the crash-recovery purpose of the outbox pattern

**Classification:** Bug
**Files:** `backend/src/modules/payments/payments.service.ts:462-471` (`markSessionPaid` fast path), `:522-529` (`approveFraudReview`, identical pattern), `:532-615` (`dispatchPostPaymentNotifications`), `backend/src/modules/payments/outbox-processor.service.ts:30-63` (the poller this defeats), `backend/src/modules/invoice/invoice.service.ts:117-186` (`processInvoice` — the slow, failure-prone async work running *after* the row is already marked done) *(Notifications Domain Expert)*

`dispatchPostPaymentNotifications` is synchronous and returns immediately without awaiting its internal promise chains (merchant notification, optional Slack webhook, and critically `invoiceService.processInvoice(order).then(...).catch(...)`) — each only has a `.catch()` attached. Both call sites invoke it without `await`, then immediately mark the outbox row `PROCESSED`:

```ts
this.dispatchPostPaymentNotifications(payment.order, paymentIntentId);   // fire-and-forget
if (outboxId) {
  this.prisma.outboxMessage.update({ where: { id: outboxId }, data: { status: 'PROCESSED', ... } }).catch(...);  // fires immediately after
}
```

The code's own comment ("If the process crashes here before the outbox can be marked PROCESSED, OutboxProcessorService will recover...") describes a crash window that doesn't actually exist as implemented — the `PROCESSED` write happens in essentially the same tick as kicking off dispatch, not after invoice PDF generation + Supabase upload + BullMQ enqueue actually complete. Once `PROCESSED`, `OutboxProcessorService.recoverPendingMessages()` (which only scans `status: 'PENDING'`) will never revisit the row. `outboxId` is populated for the common case (non-fraud-review paid orders), so this is the primary path, not an edge case. Both entry points into `markSessionPaid` (the Stripe webhook and the 10-minute reconciliation cron) hit it identically; `approveFraudReview` has the same pattern independently. The existing regression test only awaits a single microtask tick before asserting the update fired, so it validates the buggy ordering as correct.

**Trigger:** Customer pays via Stripe → `dispatchPostPaymentNotifications` kicks off invoice generation → outbox row marked `PROCESSED` in the same tick → process crashes (Railway OOM, deploy restart) before the Supabase upload or BullMQ enqueue completes. The customer never receives a payment confirmation or invoice email, and the outbox poller has no way to know — the row already says done.

**Fix:** Make `dispatchPostPaymentNotifications` return the combined promise of the invoice+customer-email chain (the side-channel merchant/Slack notifications can stay fire-and-forget), and only mark the outbox row `PROCESSED` after that promise settles successfully — on failure, leave it `PENDING` so the poller's recovery window has accurate state to act on.

---

## 🟠 HIGH — `withEventReplay()`'s pre-hydration click buffering is silently disabled on every prerendered page because two independent CSP headers are sent and intersect

**Classification:** Bug
**Files:** `vercel.json:21-46` (static, no-nonce `Content-Security-Policy` matched against `source: "/(.*)"`), `frontend/src/ssr-security-headers.ts:8-23` (`buildCsp`, separate per-request nonce-based CSP set via `res.setHeader` inside the SSR Lambda), `frontend/dist/frontend/browser/index.html` (build artifact — confirmed two inline `<script>` tags from Angular's `withEventReplay()`, neither carrying a `nonce`) *(Frontend/SSR Domain Expert)*

`vercel.json`'s CSP header rule applies to "static files, Vercel functions, and a wildcard that matches all routes" per Vercel's own documented behavior — it is not scoped away from the SSR Lambda. Its `script-src` has no `'unsafe-inline'` and no nonce (it's a static string baked at deploy time, before any per-request nonce can exist). `ssr-security-headers.ts` was added later, independently, building a second nonce-based CSP for the SSR Lambda's own responses. Neither file excludes the other from firing on the same response, and per the CSP spec, when a response carries multiple `Content-Security-Policy` headers, browsers enforce the **intersection** — a script must satisfy every listed policy, not just one. The actual prerendered build output for `/`, `/legal/terms`, `/legal/privacy`, `/legal/withdrawal` contains two inline `<script>` tags (`ng-event-dispatch-contract`, `__jsaction_bootstrap`) emitted by Angular's `withEventReplay()` hydration feature — these can't carry a nonce because they're baked in at build time, and the only CSP these CDN-served pages get (`vercel.json`'s) has neither a nonce nor `'unsafe-inline'` fallback. The browser blocks both inline scripts on every load of the homepage and all three legal pages, silently disabling pre-hydration click/input replay on exactly the highest-traffic route in the app. The same dual-header risk applies to every dynamically-SSR-rendered route, where the Lambda's nonce'd header does not supersede or merge with `vercel.json`'s separate policy — both are sent, and the stricter (no-nonce) combination governs.

**Trigger:** Open DevTools Console on the production homepage — expect a CSP violation for the two inline hydration-bootstrap scripts, and observe that clicks/keystrokes occurring before Angular's bundles finish parsing are never replayed once hydration completes, despite `withEventReplay()` being configured to guarantee exactly that.

**Fix:** Pick one CSP source of truth. Either remove the `Content-Security-Policy` entry from `vercel.json`'s `headers` array and rely solely on the SSR Lambda's nonce'd policy (confirming the 4 static prerendered routes are actually served through a path that runs the Express middleware — if not, bake a fixed `'sha256-...'` hash-source CSP for the two known inline scripts instead of a nonce), or scope `vercel.json`'s CSP away from SSR-rendered paths entirely so the Lambda's per-request header is the only CSP for non-static routes.

---

## 🟠 HIGH — `/checkout/success` runs an unguarded payment-status poll, cart clear, and GA4 purchase fire during SSR — on the one route every successful payment hits

**Classification:** Bug
**Files:** `frontend/src/app/features/checkout/checkout-success/checkout-success.component.ts:243-288` (`ngOnInit`), contrast with `product-detail.component.ts` and `checkout-page.component.ts`, both of which guard comparable work with `isPlatformBrowser` *(Frontend/SSR Domain Expert)*

`CheckoutSuccessComponent.ngOnInit()` has no `isPlatformBrowser`/`isPlatformServer` check anywhere in the file. It unconditionally strips `session_id` via `router.navigate()`, then starts a `timer(0, 3000)`-driven poll of `GET /payments/:id/status` (up to 10 times), and on `COMPLETED` calls `cart.clear()` and fires a GA4 purchase event. `/checkout/success` is not in `prerender-routes.txt`, so every hit is server-rendered fresh by the Vercel Lambda (confirmed `Cache-Control: no-store` for the `/checkout` prefix) — and this is exactly the page Stripe redirects to after every successful payment, so this SSR execution path fires on every real purchase. The SSR render's poll results are discarded on hydration (Angular re-runs the lifecycle hook client-side with no state transfer for this data), so at minimum every page load wastes up to 10 backend round-trips run server-side for no benefit; at worst, if the poll happens to observe `COMPLETED` within the SSR render window, the GA4 purchase event fires from the discarded SSR process and then potentially again on hydration.

**Trigger:** Any successful Stripe redirect to `/checkout/success?orderId=X` runs this entire sequence server-side before the browser receives any bytes.

**Fix:** Guard the polling/navigate/clear block with `isPlatformBrowser(this.platformId)` at the top of `ngOnInit()`, mirroring the pattern already used elsewhere in the app for comparable browser-only work.

---

## 🟠 HIGH — HTML-escaping fix from prior rounds covers only 6 of 17 email templates — 8 templates, including password-reset and magic-link, still interpolate raw `firstName` into HTML emails

**Classification:** Bug
**Files:** `password-reset.template.ts:15`, `magic-link.template.ts:15`, `email-verification.template.ts:15`, `email-change.template.ts:16-17` (`firstName` *and* `newEmail`), `payment-confirmed.template.ts:20`, `invoice.template.ts:67` (`firstName`) and `:24` (item names), `review-request.template.ts:61` (`firstName`), `:24/18-19/25` (product name/image/review URL), `back-in-stock.template.ts:22,33,35,38` (`firstName`/`productName`/`variantLabel`/`productUrl`) — versus the 6 templates already correctly calling `escapeHtml()`: `order-confirmation.template.ts`, `order-cancellation.template.ts`, `order-acknowledged.template.ts`, `shipping-notification.template.ts`, `return-confirmation.template.ts`, `return-status-update.template.ts`, `return-admin-notification.template.ts` *(Notifications Domain Expert + Skeptic, independently converged, Skeptic's sweep found the full 8-template extent)*

`RegisterDto.firstName`/`UpdateProfileDto.firstName` are `@IsString() @MaxLength(50)` with no character allowlist — a user can set `firstName` to an `<img onerror=...>` payload and trigger any of the 8 affected templates. The exclusion list documents the original fix as covering 3 named templates; in reality 6 were fixed and 8 were missed, including the two highest-trust transactional emails (password-reset, magic-link).

**Important exploitability caveat, verified by re-tracing the recipient of each template:** unlike the original fix's flagship case (`return-admin-notification`, which is genuinely cross-user — a customer's poisoned data rendered in the *admin's* inbox), all 8 templates here are sent to the data owner's **own** email address (password-reset/magic-link/email-verification/payment-confirmed/back-in-stock/review-request all interpolate the recipient's own `firstName`). This is closer to self-XSS than a direct cross-user attack vector — the realistic risk is a corporate mail gateway or webmail HTML renderer executing the payload in a context other than the account owner's own trusted client (security-scanner link/content previews, a support agent viewing a forwarded `.eml`), rather than an attacker compromising a different user's session directly. The consistency violation and defense-in-depth gap are real regardless; the severity is lower than a directly cross-user-exploitable stored XSS would be.

**Trigger:** Set `firstName` to a markup/event-handler payload via `PATCH /users/me`, then trigger `POST /auth/forgot-password` or any flow hitting the other 7 templates — the payload renders unescaped in the resulting email.

**Fix:** Apply `escapeHtml()` to every interpolated string field across all 8 templates, and `sanitizeUrl()` to `productUrl`/`p.imageUrl`/`p.reviewUrl`. Given this has now been missed twice across two rounds, consider a unit test (mirroring `html-escape.util.spec.ts`) asserting every `*.template.ts` file's `Data` interface fields are routed through `escapeHtml`, to prevent a third sibling-miss.

---

## 🟡 MEDIUM — `OutboxProcessorService.recoverPendingMessages`'s lock doesn't cover the full duration of a slow batch — re-opens the "two processors touch the same row" race the round-16 fix closed, just through TTL expiry instead of concurrent entry

**Classification:** Bug
**Files:** `backend/src/modules/payments/outbox-processor.service.ts:14-16` (25s lock TTL), `:30-63` (`recoverPendingMessages`), `:65-156` (`processPostPaymentNotifications`, the per-row work) *(Infra Risk Analyst)*

The Redis `SET NX` lock (TTL 25s) is acquired once at function entry, then up to 10 `PENDING` rows are processed **sequentially**, each involving a DB read, an admin-notification email enqueue, `invoiceService.processInvoice` (explicitly slow by design — PDF render + Supabase upload, outside any transaction), and a second email enqueue — only then is the row marked `PROCESSED`. There is no intermediate "claimed"/`PROCESSING` state; a row stays visibly `PENDING` for the entire time it's being worked. 10 messages with realistic per-message latency can plausibly exceed the 25-second lock TTL.

**Trigger:** Replica A's run starts at t=0, lock expires at t=25s, but the batch is still mid-loop (e.g. stuck on message #6 of 10 due to a Supabase latency blip). At t=30s the next `@Interval` tick (Replica A or B) re-acquires the now-expired lock and re-queries `status: 'PENDING'` — messages #6-10, not yet reached by the first run, are returned and processed **a second time concurrently with the still-running first loop**. Result: the admin and customer each receive duplicate notification emails for the same order. (`processInvoice`'s own row-level lock prevents the invoice PDF/number itself from duplicating — but the email dispatch around it has no equivalent guard.) This is a new angle on the exact mechanism the exclusion list already fixed once — that fix closed the race on concurrent *entry*; this reopens the same outcome through TTL expiry mid-batch.

**Fix:** Claim each row individually before processing (`UPDATE outbox_messages SET status='PROCESSING' WHERE id=$1 AND status='PENDING'`, checking the affected-row count) so a second runner's `PENDING`-filtered query naturally excludes in-flight rows; as defense-in-depth, also refresh/extend the Redis lock's TTL after each message in the loop.

---

## 🟡 MEDIUM — Admin-facing fraud/dispute/payout alert emails also interpolate user-influenced fields without escaping

**Classification:** Bug
**Files:** `backend/src/modules/email/email.service.ts:159-172` (`sendFraudReviewAlert`, `data.customerEmail` raw), `:273-293` (`sendDisputeAlert`, `data.customerEmail` raw, `data.reason` raw — Stripe-defined enum, low risk) *(Notifications Skeptic)*

These three alert emails build HTML inline in `EmailService` rather than via the `templates/` files, and none import `html-escape.util.ts`. `customerEmail` traces to `order.snapshotEmail` — either the registered `User.email` or `CreateOrderDto.guestEmail`, both `@IsEmail()`-validated, which provides some baked-in protection against raw `<`/`>` in the common case but isn't a strict guarantee across all class-validator configurations (quoted-string local parts can legally contain otherwise-restricted characters per RFC 5321). The recipient is internal staff only, so blast radius is the merchant's own inbox — same risk class as the already-fixed `return-admin-notification` case, just with a narrower, email-constrained input field.

**Fix:** Route `customerEmail` (and `reason`, for completeness) through `escapeHtml()` in all three alert builders, consistent with every other field crossing a trust boundary elsewhere in this module.

---

## 🟡 MEDIUM — `payout.failed` is the only Stripe webhook handler with no `ProcessedStripeEvent` idempotency guard, and its alert job has no deterministic `jobId`

**Classification:** Bug
**Files:** `backend/src/modules/payments/payments.service.ts:235-278` (`handleWebhookEvent` dispatch table), `:269-270` (`payout.failed` case — calls `handlePayoutFailed` with no `event.id`), `:1564-1611` (`handlePayoutFailed` — no `processedStripeEvent.create` anywhere), `backend/src/modules/email/email-queue.service.ts:42-56` (`deriveJobId` — doesn't recognize the `payoutId` payload key) *(Notifications Skeptic)*

Every other webhook case passes `event.id` to its handler, which atomically inserts a `processedStripeEvent` row inside the same transaction as the state change (`markSessionPaid`, `markSessionFailed`, `handleRefundUpdate`, `handleDisputeCreated`, `handleDisputeClosed` all do this). `handlePayoutFailed` alone has neither the parameter nor the guard. Its downstream BullMQ job (`payout_failed_alert`) also has no dedup key since `deriveJobId` doesn't recognize `payoutId`, unlike its structural sibling `dispute_alert` (keyed on `orderNumber`, which `deriveJobId` does recognize). Stripe's documented retry policy redelivers on any non-2xx/timeout.

**Trigger:** A `payout.failed` webhook delivery times out (DB pool saturation, mid-deploy) → Stripe redelivers the identical event → no record it was already processed → `handlePayoutFailed` runs twice → two separate Sentry alerts and two un-deduplicated BullMQ jobs → on-call gets paged twice for one payout failure.

**Fix:** Thread `event.id` into `handlePayoutFailed` and add the same `processedStripeEvent.create`/`P2002`-catch guard the other 5 handlers use. Separately, extend `deriveJobId` to recognize `payoutId`.

---

## 🟡 MEDIUM — GA4 `purchase` event reports the SKU code as `item_variant` instead of the human variant label every other GA4 event uses for the same line item

**Classification:** Bug
**Files:** `backend/src/modules/payments/payments.service.ts:893-916` (`formatStatusResponse`, line 911: `variantLabel: i.snapshotSku`), `frontend/src/app/features/checkout/checkout-success/checkout-success.component.ts:13-19, :304`, `frontend/src/app/core/services/analytics.service.ts:119-138` (`trackPurchase`, `item_variant: i.variantLabel`) *(Contract Drift Skeptic)*

`OrderItem` only snapshots `snapshotName`/`snapshotSku` — there's no stored variant-label snapshot. `formatStatusResponse` (backing the endpoint the success page polls to fire GA4's `purchase` event) maps `snapshotSku` into a field literally named `variantLabel`. Every other GA4 event in the codebase (`trackViewItem`, `trackAddToCart`) correctly sources `item_variant` from the real `ProductVariant.label` (e.g. "50ml"). Only the commercially most important event — the purchase conversion — gets a SKU string instead.

**Trigger:** Complete a checkout; the `purchase` event's `item_variant` shows e.g. `PERF-CHL-50` while the `add_to_cart`/`view_item` events for the identical line item show `50ml`. Any GA4 report segmenting revenue by variant/size shows inconsistent dimension values between funnel stages, breaking variant-level revenue attribution.

**Fix:** Store a `snapshotVariantLabel` on `OrderItem` at order-creation time (consistent with the other snapshot fields, preserving historical accuracy even if the variant's label later changes), or join `productVariant.label` into `formatStatusResponse`'s select.

---

## 🟡 MEDIUM — `SENTRY_RELEASE` is never set on Railway, so CI's SHA-tagged sourcemap upload never matches any production error — stack traces stay permanently minified

**Classification:** Bug
**Files:** `.github/workflows/ci.yml:66-80` (`SENTRY_RELEASE: ${{ github.sha }}` at upload time), `backend/src/instrument.ts:36` (`release: process.env.SENTRY_RELEASE`), `backend/src/config.validation.ts:245` (`Joi.string().optional()`, no default), `CLAUDE.md:160` (Railway env var checklist — doesn't mention it) *(Infra/CI Domain Expert)*

CI uploads sourcemaps tagged with the commit SHA as the release. At runtime, `Sentry.init({ release: process.env.SENTRY_RELEASE })` reads from the process environment — `SENTRY_RELEASE` is optional with no default and isn't in Railway's documented required-vars checklist, and no code reads Railway's auto-injected `RAILWAY_GIT_COMMIT_SHA` as a fallback (confirmed via grep — zero matches). Unless someone has manually set it in Railway's dashboard (undocumented), every production error carries `release: undefined`, which can never match a SHA-tagged sourcemap upload — defeating the entire purpose of the CI step.

**Trigger:** Deploy without manually setting `SENTRY_RELEASE`; trigger any unhandled exception in production; the Sentry UI shows a minified stack trace with no source mapping.

**Fix:** Set `SENTRY_RELEASE=${RAILWAY_GIT_COMMIT_SHA}` in Railway's service variables (auto-populated by Railway, no extra wiring needed), or fall back to it directly in `instrument.ts`: `release: process.env.SENTRY_RELEASE ?? process.env.RAILWAY_GIT_COMMIT_SHA`. Add it to the `CLAUDE.md` Railway checklist either way.

---

## 🟢 LOW — InPost locker-picker `MutationObserver` has no component-destroy cleanup — the sibling DPD modal got this fix in round 16, this one didn't

**Classification:** Bug
**Files:** `frontend/src/app/features/checkout/checkout-page/checkout-page.component.ts:1016-1047` (`openLockerPicker`), contrast with the same file's `_dpdModalCleanup = this.destroyRef.onDestroy(...)` (line 674) *(Frontend/SSR Domain Expert)*

`openLockerPicker()` creates a `MutationObserver` watching `document.body` for the InPost widget's backdrop, stored only in a local `const` — never registered with `destroyRef`. It disconnects itself only on finding the backdrop or on point-selection; there's no destruction path. Navigating away between observer start and the widget actually injecting its backdrop leaves it running indefinitely against a torn-down component tree.

**Fix:** Store the observer on `this` and disconnect it via `destroyRef.onDestroy`, mirroring the existing DPD cleanup pattern.

---

## 🟢 LOW — `FRAUD_REVIEW` order status has the correct Polish label but no badge color, falling back to generic gray indistinguishable from an unstyled fallback

**Classification:** Bug
**Files:** `backend/prisma/schema.prisma:18-30` (`OrderStatus`), `frontend/src/styles.scss:49-58` (`.status--*` rules — 10 of 11 statuses covered), `order-detail.component.ts:94`, `order-list.component.ts` *(Contract Drift Skeptic)*

10 of 11 `OrderStatus` values have a distinct `.status--*` color rule, including the round-16-added `dispute_hold`/`dispute_lost_review`. `fraud_review` has no rule, silently falling back to the base `.status` class's generic gray — visually identical to what a completely unrecognized status string would render as. The Polish label itself (`'Weryfikacja'`) is correctly present in both components; this is purely a missing-color gap.

**Fix:** Add a `.status--fraud_review` rule with a warning tone, matching the other "needs attention" statuses.

---

## 🟢 LOW — Admin single-order endpoint (`findOneAdmin`) is the only order-detail read path that bypasses `mapOrder()`, omitting `totalPrice`/`refundedAmountInCents`

**Classification:** Bug
**Files:** `backend/src/modules/orders/orders.service.ts:724-737` (`findOneAdmin`) vs. `:528-548, :550-557, :739-761` (the other three, all call `mapOrder`) *(Contract Drift Skeptic)*

`mapOrder()` is the single function computing `item.totalPrice` and lifting `refundedAmountInCents` onto the order — exactly the two fields a prior round flagged as never populated. That's fixed for three of four order-read paths; `findOneAdmin` (`GET /orders/admin/:id`) still returns the bare Prisma object. Currently has no Angular frontend consumer (AdminJS uses its own resource views), so this is a landmine for any future admin UI built directly against this REST endpoint rather than a live bug today.

**Fix:** Change `findOneAdmin` to `return this.mapOrder(order)`, matching `findAllAdmin`.

---

## 🟢 LOW — `CLAUDE.md`'s Railway checklist calls Sentry DSN "(optional)" while `config.validation.ts` makes it required and boot-fatal in production

**Classification:** Bug (documentation vs. enforcement mismatch — the inverse of the usual direction)
**Files:** `CLAUDE.md:160`, `backend/src/config.validation.ts:240-244` (`Joi.when('NODE_ENV', { is: 'production', then: Joi.string().uri().required(), ... })`) *(Infra/CI Domain Expert)*

The Joi schema requires a non-empty `SENTRY_DSN` in production and crashes the boot if missing, but the human-readable checklist explicitly labels it optional — someone provisioning a fresh environment from the docs would reasonably skip it, then hit an opaque boot crash with no explanation in the docs for why.

**Fix:** Drop "(optional)" from `CLAUDE.md:160`, or move `SENTRY_DSN` into the structured production env var checklist table alongside the other hard-gated vars.

---




## Proposed tradeoffs (for decision, not defects)

**`prisma migrate diff --exit-code`'s CI gate is structurally blind to hand-written raw-SQL migrations (CHECK constraints, partial/conditional unique indexes) — by design, not by gap.** *(Infra/CI Domain Expert)* Traced: the gate diffs Prisma's internal schema *model*, and constructs like `CREATE UNIQUE INDEX ... WHERE "isDefault" = true` have no representation in Prisma's DSL on either side of the comparison — there's nothing for the gate to diff. Verified the gate still does exactly what it was added for (catching locally-generated migrations that were never `git add`ed); it was never capable of validating hand-written SQL logic, and can't be made to without a different tool. Worth recording explicitly in `docs/accepted-tradeoffs.md` so a future engineer doesn't over-trust "we have a migrate-diff gate" to mean all migration drift is caught — hand-written SQL migrations still need manual PR review.

**`packages/shared-types`'s `CartDto`/`CouponValidationResultDto`/`ProductDto`/`ProductListItemDto`/`OrderDto` are effectively dead code — the frontend declares its own local interfaces everywhere and never imports them.** *(Contract Drift Skeptic)* Confirmed via grep across `frontend/src` — these specific DTOs have zero import sites. The frontend's local interfaces currently do match real backend output (no traced incorrect-data symptom today), so this isn't a live bug, but it means the shared-types package isn't actually functioning as the single source of truth its name implies for these shapes — drift between the backend and a local frontend interface would currently go uncaught by the type system, since there's no shared type forcing a compile error on either side. Worth a decision: invest in wiring the frontend to actually import and use these DTOs (catching drift at compile time going forward), or accept this as the status quo and stop treating these specific DTOs as meaningful — leaving them as-is invites the next engineer to assume a guarantee that isn't there.

---

## Documentation correction (not a finding — exclusion list updated)

The Notifications Skeptic verified that two payments-domain items in `docs/audit-exclusion-list.md` (lines 66-67, no explicit "fixed" annotation per that document's own convention) are **already resolved in code**, ahead of this round: `approveFraudReview` now creates and atomically marks its own `OutboxMessage` row within the same transaction as the `PAID` transition (`payments.service.ts:503-518`), and `sweepOrphanedPendingOrders` (run at the end of every `reconcilePendingPayments` cron tick) now explicitly handles orders with a null `stripeCheckoutSessionId`, auto-cancelling after a 2-hour grace period and restoring stock/coupon capacity (`payments.service.ts:974, 986-1059`). The exclusion list has been updated to reflect this so future rounds don't re-verify it.

---

## Notes — verified clean

**Notifications & Background Jobs** — all 11 cron/interval jobs (`reconcileCurrentUses`, `purgeStaleOperationalLogs`, Supabase monitoring, `deleteStaleAnonymousCarts`, `expireAuthenticatedCartItems`, `reconcilePendingPayments`, `pruneProcessedStripeEvents`, `purgeExpiredOrderRetention`, `purgeExpiredTokens`, `cleanupStaleShippingLabels`, `recoverPendingMessages`) correctly acquire a Redis `SET NX` distributed lock before running — no new unguarded job found. Bounce hard/soft suppression split, `email.complained` flagging, `dispute_alert` end-to-end wiring, `back_in_stock` idempotency, the `ReturnsService`/`ProductsService` outbox-bypass fix, and BullMQ job-type exhaustiveness all re-verified correct and not regressed.

**Frontend/SSR** — the round-16 fixes (live `GET /shipping/rates` fetch replacing the hardcoded `CARRIERS` array, DPD modal listener cleanup, `register.component.ts`'s open-redirect guard, `checkout-failure.component.ts`'s relative API paths + threaded guest token, `placeOrder()`'s `addressId` linkage, GA4 purchase value sourced from the backend response rather than `sessionStorage`, SSE idle-reconnect handling) were all independently re-confirmed present and correct.

**Infra/CI** — Node engine pin consistency, the deploy-rollback runbook's completeness, the e2e CI job's service containers/health checks/`needs` gating/`timeout-minutes`, `tsconfig.build.json`'s `rootDir` guard (confirmed not reintroduced by newer stray root-level `.ts` files), `pnpm.overrides`/lockfile consistency, and `promote-main.yml`'s handling of an in-progress or missing CI run (both correctly resolve to "skip promotion," not a silent bad fast-forward) were all re-verified correct.

---

This round's findings, once resolved, should be folded into `docs/audit-exclusion-list.md` per its own maintenance instructions.
