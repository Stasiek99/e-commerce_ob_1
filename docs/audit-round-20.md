# E-Commerce Audit — Round 20
*Generated: 2026-06-21 — 6-agent stochastic consensus*
*Agents: Domain Expert (Notifications & Background Jobs) · Skeptic (Notifications & Background Jobs, sibling-miss hunting) · Domain Expert (Frontend/SSR) · Skeptic (Contract Drift — backend response / shared-types / frontend shape verification) · Domain Expert (Infra, CI & Deploy) · Risk Analyst (Infra concurrency & failure modes)*

> **Excludes** everything already in `docs/audit-exclusion-list.md` (~397 prior findings across rounds 1-19) and settled tradeoffs in `docs/accepted-tradeoffs.md`.
> **Scope:** same three areas as round 17 — Notifications & Background Jobs (email/BullMQ/outbox/cron), Frontend/SSR & Contract Drift (Angular SSR mechanics plus backend-response ↔ shared-types ↔ frontend shape verification), and Infra/CI & Deploy (CI/CD pipeline, Railway/Vercel config, cron concurrency, graceful shutdown) — revisited after rounds 18-19 covered other domains, to catch regressions/drift and gaps the prior pass missed. Payments business logic, cart, coupons, returns, and catalog logic were out of scope except where a notification, contract-drift, or cron-concurrency angle touched them directly.
> **Verification note:** every finding below was independently re-checked against the current source after the agents reported (file:line spot-checks, not just trusting the agent transcripts).

The two Notifications agents — working independently from different lenses (Domain Expert sweeping the whole subsystem, Skeptic specifically hunting for templates the round-17 escaping sweep missed) — converged on the exact same two unescaped admin-facing email templates with no prompting toward it. The Skeptic went one level further and found that the regression test round 17 added specifically *to prevent a third sibling-miss* already has one: its hardcoded template list never grew to include either file. Separately, the Infra Risk Analyst's cron-concurrency sweep found a real, unfixed sibling of the already-resolved "double-restore stock on concurrent admin/cron calls" bug class, in a code path (`sweepOrphanedPendingOrders`) that sits right next to — but was never covered by — the lock that protects every other order-cancellation path.

---

## 🟠 HIGH — Two admin-facing email templates were never escaped, and the regression test added specifically to prevent this already misses both

**Classification:** Bug
**Files:** `backend/src/modules/email/templates/new-order-notification.template.ts:16,38` (`i.name`, `data.customerEmail`, no `escapeHtml` import anywhere in the file), `backend/src/modules/email/templates/low-stock-alert.template.ts:27-28` (`item.name`, `item.sku`, same gap) — contrast with every other file in the `templates/` directory, all of which import and call `escapeHtml`/`sanitizeUrl`; `backend/src/modules/email/templates/__tests__/xss-escaping.spec.ts` covers a hardcoded list of exactly 8 templates and was never extended to either file added since.

Round 17's sweep fixed escaping in 14 named templates plus 3 inline-HTML admin alerts in `email.service.ts` (`sendFraudReviewAlert`/`sendDisputeAlert`), and added `xss-escaping.spec.ts` explicitly "to prevent a third sibling-miss." `new-order-notification.template.ts` and `low-stock-alert.template.ts` were never in either sweep — confirmed by reading both files directly: neither imports `escapeHtml`, and both interpolate untrusted strings straight into the HTML body. `new-order-notification` is the higher-risk of the two: it renders `data.customerEmail` (sourced from `order.snapshotEmail` — `@IsEmail()`-validated guest/account email, the exact same residual RFC-5321 quoted-string caveat round 17 already accepted for the structurally identical `sendFraudReviewAlert`/`sendDisputeAlert` case) and every order item's `name` directly into the merchant's own admin inbox — precisely the cross-trust-boundary case (customer-controlled data rendered in staff's mail client) the original `return-admin-notification` fix was about. It is dispatched on **every paid order**, from both the fast path (`payments.service.ts` post-payment dispatch) and the outbox-recovery path (`outbox-processor.service.ts:101-113`). `low-stock-alert` carries lower-trust-boundary risk (`item.name`/`item.sku` are admin-entered product data, not customer input) but has the identical structural gap.

**Trigger:** Any paid order fires `new-order-notification` to the admin's inbox with `customerEmail`/item names rendered unescaped — reachable today via a guest checkout email local-part crafted to exploit a webmail/security-scanner HTML renderer, and unguarded against any future product-import path that lets `Product.name`/order data carry markup.

**Fix:** Add `import { escapeHtml } from './html-escape.util'` to both templates and wrap `data.customerEmail`, every `i.name`/`item.name`, and `item.sku` accordingly, matching every sibling template. Then add both templates to `xss-escaping.spec.ts`'s coverage list. Given this is the **second** time a "fixed, but missed N siblings" gap has been found in this exact file (round 17: 8 of 17 missed initially; round 20: 2 more found beyond that), it's worth converting the test from a manually-curated import list into one that iterates `fs.readdirSync('templates')` over every `*.template.ts` file and asserts each one escapes a payload — a hardcoded list will keep falling behind as templates are added.

---

## 🟠 HIGH — `CartService` never loads cart data during SSR, so `checkoutGuard` always sees an empty cart and silently serves `/cart`'s empty-state HTML at the `/checkout` URL

**Classification:** Bug
**Files:** `frontend/src/app/core/services/cart.service.ts:65-68` (`constructor() { if (!this.isBrowser) return; this.loadCart(); }` — cart fetch unconditionally skipped server-side), `frontend/src/app/core/guards/checkout.guard.ts:13-15` (`if (!cart.items().length) return router.createUrlTree(['/cart']);`), `frontend/src/app/app.routes.ts:50-52` (`checkout` route gated by `checkoutGuard`), `frontend/prerender-routes.txt` (confirms `/checkout` is not a static route — it's rendered dynamically by the Vercel SSR Lambda on every request)

`CartService`'s constructor only calls `loadCart()` when `isPlatformBrowser` is true — the `_items` signal stays `[]` for the entire server render, regardless of what the real cart (identified by the session cookie/header) actually contains. `checkoutGuard` reads `cart.items().length` synchronously during route activation and unconditionally redirects to `/cart` whenever it's empty — which, server-side, is always. Nothing bridges a guard-produced `UrlTree` redirect to an actual HTTP 3xx response (the only existing precedent, `RESPONSE`/`.status(404)` in `product-detail.component.ts`, is a one-off manual wire-up for a different code path) — so Angular's router silently resolves and renders `/cart`'s component tree instead, and `CommonEngine` ships that markup at HTTP 200 while the URL bar and any `<link rel="canonical">` still say `/checkout`. `/cart` itself has the same root cause one level up: `cart.items()` is `[]` there too, so what actually ships in the initial HTML is the *empty-cart* state, not the customer's real cart.

**Trigger:** Any authenticated customer with items in their cart navigates to `/checkout`. The first byte any non-JS client (search crawler, link-preview bot, a mobile session that hasn't finished hydrating yet) receives is the empty-cart `/cart` page's markup served under the `/checkout` URL. Real users see a flash/flicker once Angular hydrates and the guard re-evaluates against the now-populated client-side cart, which self-corrects — but the structural response is wrong regardless.

**Fix:** Either make `loadCart()` SSR-aware (fetch using the request's forwarded session cookie/header so `cart.items()` is populated before the guard runs, mirroring the explicit SSR-skip-but-acknowledged pattern already used for `auth.refresh()` in `app.config.ts`), or add a general guard-redirect → HTTP-3xx bridge via the existing `RESPONSE` token so a guard-driven mismatch produces a real redirect instead of silently rendering the wrong page at 200.

---

## 🟠 HIGH — `sweepOrphanedPendingOrders` has no lock or idempotency guard against concurrent execution — unlike every sibling stock-restore/cancellation path

**Classification:** Bug
**Files:** `backend/src/modules/payments/payments.service.ts:980-1032` (`reconcilePendingPayments` — `Redis.set(..., 'EX', 540, 'NX')`, 9-minute TTL on a 10-minute cron, never refreshed, guarding an unbounded loop of real Stripe API calls), `:1043-1116` (`sweepOrphanedPendingOrders`, called unconditionally at the end of every `reconcilePendingPayments` tick — its own `findMany` plus per-row `$transaction` restoring stock and decrementing `coupons.current_uses` has no claim-before-process step and no conditional `updateMany` keyed on expected prior status)

This is a real, unfixed sibling of the bug class already closed everywhere else: `cancelItemsByUser`, `partialRefund`, `cancelByUser`, `bulkCancel`, the admin refund endpoint, `ReturnsService.markRefunded`, `OrdersService.updateStatus`, and `approveFraudReview` were all wrapped in a `cancel-lock`/`refund-lock`/`status-lock` specifically to stop two concurrent calls from racing an unlocked read of stock/coupon state. `sweepOrphanedPendingOrders` does the identical read-then-restore-then-write (`tx.productVariant.update({ stock: { increment: activeQuantity } } })`, `tx.order.update({ status: CANCELLED })`, raw `current_uses = GREATEST(current_uses - 1, 0)`) but was never brought under any of those locks, and the cron-level Redis lock around it has its own gap: a 540s TTL on a cron declared to run every 10 minutes is sized to self-clear *before* the next tick under normal conditions, but the loop it guards makes one real outbound Stripe API call per stale `PENDING` payment with no cap and no per-iteration TTL refresh. If that loop (or a backlog accumulated during a Railway hobby-tier sleep window, a documented existing gap) pushes total runtime past 540s, the lock expires and a second tick's `findMany` — unfiltered by any claim from the first run — picks up the same orphaned orders the first run hasn't finished yet.

**Trigger:** A backlog of orphaned `PENDING_PAYMENT` orders builds up (post-sleep wake-up, or simply enough concurrent stale payments that Stripe round-trips push the loop past 9 minutes). Two overlapping `reconcilePendingPayments` ticks both reach `sweepOrphanedPendingOrders`'s `findMany` before either has finished processing the same rows: both transactions restore the full `activeQuantity` to stock (phantom inventory) and both decrement the same coupon's `current_uses` by 1 (under-counted usage, allowing the coupon to be used more times than its cap permits).

**Fix:** Claim each orphaned order via a conditional `updateMany` (`WHERE status = 'PENDING_PAYMENT'` → a transitional sentinel, or reuse the existing `status-lock:${id}` pattern from `OrdersService.updateStatus`) before processing it, so a second overlapping run's query naturally excludes in-flight rows — closing both the lock-expiry race and the missing-idempotency gap in one fix, the same way `OutboxProcessorService.recoverPendingMessages` was fixed in round 17.

---

## 🟠 HIGH — Corrective invoices are fully generated and stored after a partial cancellation, but the customer has no way to ever retrieve one

**Classification:** Bug (compliance/UX — a real legal document with no delivery path, not a crash)
**Files:** `backend/src/modules/orders/orders.controller.ts:77-81` (`GET /orders/:id/corrective-invoice`, fully implemented and working) → `OrdersService.getCorrectiveInvoiceForUser()`, fed by `InvoiceService.processCorrectiveInvoice()` fired from `cancelItemsByUser` — vs. a repo-wide grep across `frontend/src` for `correctiveInvoice`/`faktura kory*`/`korygując*`: **zero matches**. `order-detail.component.ts` renders exactly one invoice button, hard-wired to the *original* invoice endpoint, with no `PARTIALLY_REFUNDED`-conditional second button. Every email template and `email.service.ts` were also grepped for the same terms: no hits — the only email sent on a partial cancellation (`sendOrderCancellation`) carries no link or attachment to the corrective invoice either.

**Trigger:** A customer partially cancels a multi-item order on one that already has an original invoice. The backend silently generates a `faktura korygująca`, stores it in Supabase with a working signed URL behind a working endpoint — and nothing in the product (UI or email) ever tells the customer it exists or how to get it. For a Polish business this is a real document-delivery compliance gap (a corrective VAT invoice must reach the buyer), not just a missing convenience feature.

**Fix:** Add a "Pobierz korektę" button to `order-detail.component.ts`, conditioned on the order having any `cancelledQuantity > 0` items, wired to the existing endpoint; and/or link or attach the corrective invoice in the partial-cancellation confirmation email. Both are cheap since the backend plumbing already exists end-to-end — this is purely a missing frontend/email surface, mirroring the exact shape of round 19's magic-link and change-email/password findings.

---

## 🟡 MEDIUM — Resend webhook handler crashes on a bounce/complaint event with an empty or missing `to`, and Resend's retries can never set the suppression flag

**Classification:** Bug
**Files:** `backend/src/modules/email/email-webhook.controller.ts:76` (`const to = Array.isArray(data.to) ? data.to[0] : data.to;` — `undefined` whenever `data.to` is empty/absent), `:92` and `:114` (`createHash('sha256').update(to).digest('hex')` — no null guard)

The handler already anticipates a missing `to` everywhere else — `to: to ?? ''` when writing the `EmailLog` row (`:82`), and `if (to) { ... }` guarding the DB suppression update two lines below each hash call (`:99`, `:121`) — but the `createHash(...).update(to)` calls themselves have no equivalent guard. `crypto.Hash.update()` throws `TypeError [ERR_INVALID_ARG_TYPE]` on `undefined`, after the `EmailLog` row has already been created but before the suppression flag would have been set.

**Trigger:** Resend delivers an `email.bounced` or `email.complained` event where `data.to` is empty or absent (a malformed delivery, an upstream Resend edge case, or any signed-but-unusual payload). The handler 500s; Resend's retry policy redelivers the identical event repeatedly, 500ing every time, and the bounce/complaint suppression flag is never set because the crash happens before that code is reached.

**Fix:** Guard both hash computations the same way the two DB writes immediately below them already are: `const toHash = to ? createHash('sha256').update(to).digest('hex').slice(0, 12) : 'unknown';`.

---

## 🟡 MEDIUM — The wildcard `**` route's `NotFoundComponent` never sets an HTTP 404 status during SSR, unlike the one-off fix applied to product-detail

**Classification:** Bug
**Files:** `frontend/src/app/features/not-found/not-found.component.ts` (no `RESPONSE` token, no `isPlatformServer` check, no status call anywhere in the file) vs. `frontend/src/app/features/catalog/product-detail/product-detail.component.ts:1102,1295-1296` (`ssrResponse = inject(RESPONSE, { optional: true })`, `if (isPlatformServer(...)) { this.ssrResponse?.status(404); }`); `frontend/src/app/app.routes.ts:245-252` (`{ path: '**', loadComponent: () => ... NotFoundComponent }`)

The exclusion list's "Product detail 404 not handled" entry was closed with a manual, per-component fix specific to the API-driven product-lookup-fails path. Every *other* invalid URL on the site — typos, dead external links, any non-product route that doesn't exist — resolves through the wildcard route to `NotFoundComponent`, which has zero awareness of the `RESPONSE` token and never calls `.status(404)`. `CommonEngine.render()` defaults to 200 for anything that doesn't throw.

**Trigger:** Visit any nonexistent URL not specifically routed through product-detail's check (e.g. a typo'd path). The server responds 200 with 404-looking content — a soft-404, indexable by search engines and indistinguishable from a real page to any status-code-checking tool (uptime monitors, Search Console coverage reports).

**Fix:** Inject `RESPONSE` into `NotFoundComponent` and call `.status(404)` in `ngOnInit` when `isPlatformServer`, mirroring the proven product-detail pattern. Given this is now the second route needing this exact wiring, consider centralizing it once (e.g. in `app.component.ts`, keyed off the router resolving to the `**` path) so a third new route doesn't need the fix repeated again.

---

## 🟡 MEDIUM — `build-and-test`, the CI job gating every merge, has no timeout at any level — unlike its sibling `e2e` job

**Classification:** Bug
**Files:** `.github/workflows/ci.yml:10-89` (`build-and-test` — no `timeout-minutes` on the job or any of its 9 steps: `pnpm audit`, Prisma generate/diff, backend+frontend builds, Sentry sourcemap upload, `test:cov`, frontend tests) vs. `:198-200` (`e2e` job's Playwright step: `timeout-minutes: 10`)

Round 17 added exactly this hardening to the `e2e` job's Playwright step. It was never extended to `build-and-test` — confirmed by reading the full current file: `timeout-minutes` appears exactly once, on the `e2e` step. Since `e2e` declares `needs: build-and-test`, a hang anywhere in `build-and-test` (a frozen `pnpm audit` network call, a Jest test stuck on an unresolved promise, a frontend test wedged in fake-async) falls through to GitHub Actions' 360-minute default job cap instead of failing fast, and blocks `e2e` from ever starting for up to 6 hours on every push to `main`/`develop`/`feature/**`/`fix/**`.

**Fix:** Add `timeout-minutes: 20` (or similar) at the `build-and-test` job level, matching the hardening already applied to its sibling.

---

## 🟡 MEDIUM — `FAILED` outbox rows and exhausted `email-dlq` jobs are permanently excluded from the retention-purge cron

**Classification:** Bug
**Files:** `backend/src/modules/email/data-retention-cleanup.service.ts:26-28` (`outboxMessage.deleteMany({ where: { status: 'PROCESSED', processedAt: { lt: outboxCutoff } } })` — `FAILED` rows never match this filter), `backend/src/modules/payments/outbox-processor.service.ts:166` (sets `status: 'FAILED'` once `MAX_RETRIES` is exhausted), `backend/src/modules/email/email-queue.processor.ts:32` (`dlq.add(..., { removeOnComplete: false, removeOnFail: false })` — deliberately retained for human inspection, but nothing purges old entries)

The GDPR-motivated weekly purge cron (its own header comment cites Art. 5(1)(e) storage limitation) only ever deletes `outboxMessage` rows with `status: 'PROCESSED'`. A row that exhausts all 3 retries lands in `status: 'FAILED'` and is permanently excluded from the query's `where` clause — confirmed by reading the cron directly — so it's never purged by anything. These rows carry the same order/customer PII the cron exists to bound. Separately, `email-dlq` BullMQ jobs are kept indefinitely by design (so a human can inspect a permanently-failed send) but no cron or scheduled `queue.clean()` call exists anywhere in the codebase to bound that retention either.

**Trigger:** Any notification chain that fails 3 times in a row (a sustained Supabase outage during invoice upload, a malformed payload causing deterministic failure) leaves a `FAILED` outbox row and a DLQ entry indefinitely — both holding customer PII with no expiry.

**Fix:** Extend the retention query to `status: { in: ['PROCESSED', 'FAILED'] }` (the failure is already captured via Sentry per `outbox-processor.service.ts:151-158`, so purging the row doesn't lose the only record of the failure), and add a scheduled `queue.clean()` for `email-dlq` jobs older than N days, or at minimum alert when DLQ depth exceeds a threshold so it doesn't grow unbounded with no operator visibility.

---

## 🟢 LOW — Fire-and-forget notification dispatch failures in `orders.service.ts` aren't captured in Sentry, unlike the equivalent pattern in `payments.service.ts`

**Classification:** Bug (narrow)
**Files:** `backend/src/modules/orders/orders.service.ts` — ten fire-and-forget email dispatch sites (order-acknowledgement, cancellation, full/partial-cancel confirmation, corrective invoice, review-request, bulk-shipped/bulk-cancel notifications), all `.catch((err) => this.logger.warn(...))` with no `Sentry.captureException` — vs. the structurally identical pattern in `backend/src/modules/payments/payments.service.ts`, which does call `Sentry.captureException(err, { tags: ... })` in its catches.

**Mitigating factor (verified):** `email-queue.processor.ts`'s `worker.on('failed', ...)` already calls `Sentry.captureException` on every BullMQ attempt failure and `Sentry.captureMessage` on DLQ exhaustion, so a failure *after* `queue.add()` succeeds is still monitored regardless of which module enqueued it. The actual gap is narrower: only the rarer case where `EmailQueueService.enqueue()` itself throws before reaching `queue.add()` (e.g. its bounce-check Prisma lookup fails) is invisible to Sentry today for these ten call sites — visible only as a `logger.warn` line in Railway logs.

**Fix:** Add `Sentry.captureException(err)` alongside the existing `logger.warn` calls in `orders.service.ts`'s ten catch sites, for consistent on-call visibility regardless of which module's code path failed.

---

## 🟢 LOW — `outbox-recovery`'s lock-TTL refresh happens after each message completes, not before — the first message in a batch is unprotected if it alone is slow

**Classification:** Bug (narrow — already mitigated by the round-17 atomic claim)
**Files:** `backend/src/modules/payments/outbox-processor.service.ts:36` (initial TTL set to `LOCK_TTL_SECONDS = 25` on acquisition), `:68-73` (refresh via `redis.expire(...)` only runs *after* `processPostPaymentNotifications` returns)

If the very first message in a batch of up to 10 — which can include `invoiceService.processInvoice()`'s PDF render + Supabase upload — alone takes longer than 25 seconds (a Supabase cold start, a slow Postgres connection after a Railway sleep), the lock expires before the loop ever reaches its first refresh. A second replica's next `@Interval(30_000)` tick then re-acquires the lock and queries `PENDING` rows. The round-17 atomic per-row claim (`updateMany({ where: { status: 'PENDING' } })`) still prevents a duplicate send on any row the first run already claimed — so this doesn't reproduce the original duplicate-notification bug — but it does mean the first run's lock is silently invalid for the remainder of its own loop, and the second run wastes a full query-and-claim cycle racing rows the first run hasn't reached yet.

**Fix:** Refresh the lock TTL immediately before starting each message's work, not only after, or raise the TTL meaningfully above the realistic worst-case single-message duration (e.g. 60s) rather than tying it to the 30s `@Interval` period.

---

## 🟢 LOW — `GET /orders/:id/events` (order status-history timeline) has a complete backend implementation and zero frontend consumer

**Classification:** Dead contract surface (no security/data-integrity impact — flagged because it's the same "real shape, unverified by any actual usage" pattern as the corrective-invoice finding above, in the same module)
**Files:** `backend/src/modules/orders/orders.controller.ts:65-69` (`GET /orders/:id/events` → `findEventsForUser()`, returning a full `{id, fromStatus, toStatus, actor, createdAt}[]` audit trail) — a repo-wide grep for `/events` usage in `frontend/src/app` returns no matches in either `order-detail.component.ts` or `order-list.component.ts`.

**Fix:** Low priority — worth picking up together with the corrective-invoice finding if an order-timeline view is ever added to order-detail; not worth a dedicated fix on its own.

---

## Proposed tradeoffs for decision (not bugs — see `docs/accepted-tradeoffs.md` conventions)

- **`Vary: Cookie` on the public-catalog SSR cache fragments the CDN cache per logged-in visitor, silently defeating the `s-maxage=60` cold-start-absorption purpose its own comment describes for that segment.** `frontend/src/ssr-cache-headers.ts:14-22` applies `Vary: Cookie` unconditionally to `/products`/`/categories`, and any customer who has ever logged in carries a unique-per-account `refreshToken` cookie on every subsequent request — per Vercel's documented cache-key behavior, that partitions the edge cache to size 1 for that entire segment, so every page view for a returning, logged-in customer round-trips to the Lambda exactly as if `Cache-Control: no-store` were set. This is the prior round's privacy-driven `Vary: Cookie` fix behaving exactly as designed for safety — not a bug, and shouldn't be reverted — but the comment's stated benefit silently doesn't apply to logged-in traffic, generally an e-commerce site's more valuable, more frequent-visiting segment. Worth a deliberate decision (e.g. a more selective cache-key cookie, or accepting the gap and updating the comment) rather than leaving the mismatch between intent and effect undocumented.
- **`handlePaymentFailure`'s `SELECT ... FOR UPDATE` is a no-op under pgbouncer transaction-mode pooling, but the function is safe anyway because of an independent `ProcessedStripeEvent` unique-constraint guard.** `backend/src/modules/payments/payments.service.ts:1766-1768` — same already-excluded mechanism as other `FOR UPDATE`-under-pgbouncer findings, but the comment at `:1762-1765` claims the lock "serialises against a concurrent `markSessionPaid`," which isn't true through pgbouncer; the real protection is the `P2002` thrown by the unique-constraint insert two lines later, caught by the outer handler as "already processed." Not a live bug to fix under pressure — just a misleading comment that should be corrected so a future change to this function isn't reasoned about against a lock that doesn't actually serialize anything.
- **`docs/accepted-tradeoffs.md`'s Dependabot single-root-entry tradeoff doesn't mention the `e2e` workspace package.** `pnpm-workspace.yaml:1-5` lists `e2e` as a fourth workspace member (added since round 17, which only described the e2e suite as test files). Dependabot's existing root entry already covers it correctly — same reasoning as the documented tradeoff — this is purely a doc-completeness update so a future round doesn't wonder why a 4th workspace package has no dedicated entry.

## Stale exclusion-list entry to mark resolved

- **"`ReturnsService`/`ProductsService` bypass BullMQ retry queue (direct `EmailService` injection)"** (`docs/audit-exclusion-list.md`, Email/BullMQ section) is no longer accurate. Verified via import grep: `returns.service.ts`, `products.service.ts`, and `orders.service.ts` all inject `EmailQueueService`; the raw `EmailService` is now imported only inside the `email` module itself. Every dispatch path gets retry/backoff, a deterministic `jobId`, and bounce-suppression checking. This should be annotated resolved.

---

## Notes — verified clean

**Notifications & Background Jobs** — Outbox row-claiming via atomic `updateMany`, `dispatchPostPaymentNotifications`'s await-chaining before marking `PROCESSED`, `payout.failed`'s idempotency guard, all 8 round-17-escaped templates individually re-checked and still correct, bounce-suppression hard/soft split with 30-day auto-reset, `email.complained` → `suppressContact`, BullMQ job-type switch exhaustiveness + DLQ wiring, and `email_logs`/`consentLog` retention purge were all re-verified correct and not regressed.

**Frontend/SSR & Contract Drift** — `isPlatformBrowser`/`isPlatformServer` guards on `verify-email`/`checkout-success`, the CSP dual-header scoping fix, `TransferState`/`HttpTransferCache` (confirmed wired with a dedicated regression spec), the narrowed `TrackResult` shape, DPD/InPost widget listener cleanup, `ChunkLoadError`/`SwUpdate` handling, `STATUS_LABELS`/`canCancel`/`canPartialCancel`/`canDownloadInvoice` exhaustiveness against all 11 `OrderStatus` values, the live shipping-rate availability filter, wishlist `attachOmnibusData` enrichment, GA4 `purchase` value/variant-label fixes, and `ChangeEmailDto`/`ChangePasswordDto` frontend-backend payload alignment were all re-verified correct and not regressed.

**Infra, CI & Deploy** — Graceful shutdown ordering in `main.ts`, the outbox-processor claim-before-process fix, `SENTRY_RELEASE`'s `RAILWAY_GIT_COMMIT_SHA` fallback, all 11 cron/interval jobs' `SET NX` Redis lock coverage (10 confirmed sized correctly for their workload; `reconcilePendingPayments`/`sweepOrphanedPendingOrders` is the one exception, covered above), `.nvmrc`/`engines.node` sync, all 54 tracked Prisma migrations, `railway.json`/`vercel.json` build/start/healthcheck config, the `promote-main.yml` CI-gate logic, and `.github/dependabot.yml`'s root-entry configuration were all re-verified correct and not regressed.

---

This round's findings, once resolved, should be folded into `docs/audit-exclusion-list.md` per its own maintenance instructions.
