# E-Commerce Audit — Round 14
*Generated: 2026-06-18 — 7-agent stochastic consensus*
*Agents: Skeptic (round-13 fix verification) · Domain Expert (payments/finance depth) · Pragmatist (dependency bumps & CI) · Risk Analyst (security beyond admin) · Systems Thinker (concurrency in new fixes) · First-Principles (shallow-traversal pattern hunt) · End-User Advocate (frontend/backend contract drift)*

> **Excludes** everything already in `docs/audit-exclusion-list.md` (~317 prior findings across rounds 1-13).
> **Excludes** Phase 7 (pre-launch checklist) items in ROADMAP.md.

This round deliberately pointed every agent at round 13's own fixes (commit `40f5272` + four follow-up commits), on the theory that freshly-changed code is where sibling-call-site misses and "fixed leak A, opened leak B" regressions hide. That bet paid off: **the coupon-throttler fix and the partial-refund idempotency fix each introduced a new problem of their own**, and the Pragmatist's branch audit surfaced something none of the prior 13 rounds checked — the actual production deploy branch (`main`) is two months behind the branch (`develop`) all this hardening has been landing on. The Skeptic's dedicated re-verification pass, by contrast, came back fully clean: all 7 of round 13's claimed fixes are genuinely complete with no missed sibling sites.

---

Done:

## 🔴 CRITICAL — `main`, the actual Railway/Vercel deploy branch, is two months behind `develop` — none of rounds 10-13's hardening has shipped *(Pragmatist)*

**Evidence:** `git log main -1` → last commit dated 2026-04-15. `develop` (and every `fix/*` branch built on it, including this one) is at 2026-06-18. `git log main..develop --oneline` shows the entire round 10-13 backlog — Stripe idempotency fixes, stock-restore bugs, throttler fixes, the new CI e2e job, GDPR/security hardening — sitting unmerged. `git log develop..main` is empty: nothing has gone the other direction either.

CLAUDE.md documents Railway (backend) and Vercel (frontend) as deploying from `main`. If those services are connected and auto-deploying as configured, the **live site is running pre-round-10 code** — none of the payment-idempotency, stock-restoration, or security fixes from the last two months of audit work are protecting real traffic. Commit `2f26114`'s message ("validate PRs into develop, since that's the actual integration branch") correctly identifies `develop` as where work lands, but no mechanism was ever added to promote `develop` into `main` on any cadence.

**Fix:** Open and merge a `develop → main` PR now. Add either a scheduled or manually-triggered promotion workflow so this gap can't silently re-grow — `main` and `develop` should never be allowed to diverge by more than one release cycle. Confirm in Railway/Vercel dashboards which branch each service is actually tracking today.

### Related — CI gate asymmetry on the (apparently never-exercised) promotion path *(Pragmatist)*

`.github/workflows/ci.yml:6-7` triggers `pull_request` on both `main` and `develop`, which looks symmetric — but given the finding above, the `develop → main` path has never actually been exercised, so whether GitHub branch protection requires the `build-and-test`/`e2e` checks on `main` is unverified (branch protection lives in GitHub settings, not in the repo). An ungated fast-forward or admin-merge into `main` would ship straight to prod with zero CI signal.

**Fix:** Confirm in GitHub Settings → Branches that `main` requires the same status checks as `develop`, no force-push, no admin bypass — and document that requirement in CLAUDE.md's deployment section, since it's currently invisible to anyone auditing only the filesystem.

---

## 🔴 CRITICAL — `partialRefund` has no per-order lock — concurrent double-submit re-collides the idempotency key and double-restores stock *(Systems Thinker)*

**File:** `backend/src/modules/payments/payments.service.ts:1189-1221`, called from `orders.service.ts:1065` (`cancelItemsByUser` — no lock guard anywhere in this path, contrast with `createFromCart`'s `checkout-lock:${userId}` at `orders.service.ts:175-180`)

Round 13 fixed the partial-refund idempotency key to bake in `payment.refundedAmountInCents` so sequential calls don't collide (exclusion list #61). But that value is read via a plain unlocked `findUnique`, and pgbouncer transaction-mode makes `FOR UPDATE` a no-op anyway. Two browser tabs double-submitting "cancel item X, qty 1" on the same order race like this: both read `refundedAmountInCents = 0` before either commits, so both build the **identical** idempotency key. Stripe processes the first `refunds.create` for real; the second returns Stripe's **cached result of the first call** (no second charge-side effect — money is safe), but the second request's code doesn't know it got a replay, and proceeds to run its own DB transaction anyway: `cancelledQuantity` and stock both get incremented a **second** time for the same physical units. Net effect: phantom inventory (oversellable stock) and a `cancelledQuantity` that can exceed `item.quantity`, corrupting the basis for any subsequent cancellation on that order.

**Fix:** Take a Redis `SET NX` per-order lock (mirroring the existing `checkout-lock:${userId}` pattern, e.g. `cancel-lock:${orderId}`) around the read-decide-write span in `cancelItemsByUser`/`partialRefund`, held until the DB transaction commits.

---

## 🟠 HIGH — Round-13's coupon-throttler fix silently removed the only rate limit `POST /cart/items` ever had *(Risk Analyst)*

**File:** `backend/src/throttler.config.ts:25-26` vs `backend/src/modules/cart/cart.controller.ts:36-37`

Before `40f5272`, the `coupon-anon`/`coupon-auth` throttlers (3/min, 10/min) had no `skipIf`, so they applied globally to every route — including `POST /cart/items`, which has never carried its own `@Throttle` decorator in any commit. That accidental global leak was, in practice, the *only* meaningful rate limit `cart/items` ever had. Now that the leak is correctly scoped to `POST /coupons/validate` only, `cart/items` falls back to the generic floors (`burst` 5 req/s, `sustained` 60/min, `default` 100/min) — a jump from an accidental ~3/min cap to a real ~300/min ceiling, on an endpoint that sits behind `TurnstileGuard` specifically because it's bot-sensitive. Turnstile tokens aren't single-use server-side here, so a scripted client with one valid token can now hammer `addItem` at up to 5 req/s — materially increasing the achievable rate for the cart-based stock-hoarding/oversell race that's already a known structural issue.

**Fix:** Add an explicit, intentionally-scoped `@Throttle({ default: { ttl: 60_000, limit: N } })` on `CartController.addItem` rather than relying on incidental global leakage from an unrelated throttler.

---

## 🟠 HIGH — Returns-refund flow can issue a Stripe refund on an order currently under active dispute *(Domain Expert)*

**File:** `backend/src/modules/returns/returns.service.ts:190-279` (`approve`, `recordReturnTracking`, `markRefunded`)

`ReturnsService.create()` validates `order.status` once, at request creation. A return request can then sit for days awaiting the customer's physical return shipment before an admin calls `approve()` → `recordReturnTracking()` → `markRefunded()` — none of which re-check `order.status`. If Stripe opens a dispute in the interim, `handleDisputeCreated` flips the order to `DISPUTE_HOLD` via a raw update that bypasses the transition guard. `markRefunded` then calls `partialRefund()`, which validates only `payment.status === COMPLETED` — never order status. Result: a real Stripe refund fires against a `payment_intent` simultaneously the subject of an open chargeback, undermining the evidence needed to contest it and risking a double-debit (refund + lost dispute) against the merchant. This is mechanism-distinct from the exclusion list's `cancelByUser` dispute cluster — a different service with its own independent, stale time-of-check guard.

**Fix:** Re-fetch and validate `order.status` against an allowlist (excluding `DISPUTE_HOLD`/`FRAUD_REVIEW`/`DISPUTE_LOST_REVIEW`) inside `markRefunded`, immediately before calling `partialRefund`.

---

## 🟠 HIGH — `CategoriesService.findAll()` hardcodes a 3-level-deep tree, silently dropping any 4th-level category from every consumer *(First-Principles)*

**File:** `backend/src/modules/categories/categories.service.ts:9-15`

```ts
findAll() {
  return this.prisma.category.findMany({
    where: { parentId: null },
    include: { children: { include: { children: true } } },
    orderBy: { name: 'asc' },
  });
}
```

A manually nested Prisma `include`, capped at exactly 3 levels. The schema's `parentId` self-relation supports arbitrary depth — the same fact that motivated round 13's fix to `products.service.ts`. This is the *producer*-side instance of the identical bug class round 13 fixed on the *consumer* side: a 5th-level-or-deeper category simply never appears in the tree at all, not even as an empty placeholder. `GET /categories` is the sole data source for category navigation.

**Fix:** Replace the nested `include` with the same recursive-CTE pattern `resolveCategorySlugs()` already established in `products.service.ts:121-134`, or recurse with repeated `findMany` grouped by `parentId` until no rows return.

### Related — `generate-sitemap.mjs` is itself unbounded but inherits the truncated data *(First-Principles)*

`frontend/scripts/generate-sitemap.mjs:92-100`'s `flattenCategories()` recursion has no depth cap of its own — the "(up to 3 levels)" comment documents the upstream API's limitation, not anything this function does. The sitemap silently omits any 4th-level-or-deeper category page with zero error signal (the build's route-count gate only catches a *count collapse*, not partial truncation). Resolves automatically once the `findAll()` fix above ships — just update the stale comment.

---

## 🟠 HIGH — 429 responses are completely unhandled by the frontend, and round 13's throttler fix means real users will now hit them *(End-User Advocate)*

**File:** `frontend/src/app/core/interceptors/error.interceptor.ts:11-39`

The interceptor only special-cases `err.status === 401`. Everything else — including 429 — falls through to `throwError(() => err)`, leaving individual components to build their own toast from `err.error?.message`. Before round 13, only the blanket `burst`/`sustained` throttlers fired, so 429s were rare. Round 13 registered the missing `default` throttler, which the commit's own description says activates 13 previously-inert `@Throttle({ default: {...} })` overrides across auth, orders, payments, returns, reviews, and users controllers. Ordinary users doing ordinary things (rapid login retries, repeated status checks, review resubmits) will now hit real limits, and NestJS's default `ThrottlerException` body (`{"message":"ThrottlerException: Too Many Requests"}`) will surface as a literal **English** string on a Polish-language storefront, with no `Retry-After` read and no retry guidance.

**Fix:** Add a 429 branch in `error.interceptor.ts` that reads the `Retry-After` header and emits a localized toast ("Za dużo żądań, spróbuj ponownie za Xs") via `ToastService`, instead of leaving it to component-specific fallback strings.

---

## 🟠 HIGH — Guest wishlist (localStorage) is never revalidated against the backend's `isActive` filter; it caches a permanently stale snapshot *(End-User Advocate)*

**File:** `frontend/src/app/core/services/wishlist.service.ts:45-69, 113-121`

For an unauthenticated user, `toggle()` pushes the product-card snapshot straight into `_items`/localStorage with no backend round-trip, and `loadFromStorage()` replays that frozen snapshot on every later visit with no re-fetch. The snapshot type has no `isActive` field at all. This contrasts with the authenticated path, which now correctly calls the backend's `getItems()` — filtered to `isActive: true` on both product and variant per round 13's `b1cca0a` fix. A guest who wishlists a product that's later deactivated, re-priced, or restocked sees indefinitely stale data until login triggers the merge; clicking "add to cart" on a stale entry sends a possibly-dead `variant.id`, relying entirely on the cart endpoint to fail gracefully.

**Fix:** On `loadFromStorage()` (or wishlist-page mount), batch-revalidate guest item IDs against the products endpoint before rendering — don't trust the localStorage snapshot as ground truth for purchasability.

---

## 🟡 MEDIUM — Stripe SDK API version intentionally left unpinned *(Domain Expert)* — ✅ RESOLVED same day

**File:** `backend/src/modules/payments/stripe.client.ts:44-46`

The code deliberately omitted `apiVersion` ("avoids hardcoding a version string that rots"), but this inverted the actual risk: reading `stripe-node`'s own source confirmed the SDK always sends a `Stripe-Version` header (`version: props.apiVersion || DEFAULT_API_VERSION`) — it was never actually tracking the Stripe Dashboard's account-default version, only whatever version happened to be bundled with the installed `stripe` package, which Dependabot's grouped minor/patch bumps can change without anyone reviewing a payload-shape implication.

**Fix applied:** Pinned explicitly to `'2026-05-27.dahlia'` (matching the installed SDK's bundled default at time of pinning), with the rationale recorded in `docs/accepted-tradeoffs.md` so future bumps are a deliberate, reviewed decision rather than a side effect of a routine dependency update.

---

## 🟡 MEDIUM — `notifyStockChangesByDelta`'s re-derived `previousStock` can misreport back-in-stock transitions under concurrent deltas *(Systems Thinker)*

**File:** `backend/src/modules/products/products.service.ts` (`notifyStockChangesByDelta`)

It does one post-commit `findMany` for current stock, then computes `previousStock = variant.stock - delta` per variant. If two delta batches for the same variant are in flight concurrently (e.g. a partial-cancel restore racing a fresh checkout decrement), each batch's read already reflects the other side's committed effect, so the derived "before" value doesn't represent this batch's own before-state — silently skipping or double-firing a back-in-stock notification depending on interleaving. The underlying `stock` column itself stays correct (Prisma's `increment` is atomic) — this is a notification-accuracy gap, not a money/stock-correctness bug.

**Fix:** Pass explicit before/after values through from the transaction instead of re-deriving via post-commit re-read + subtraction, mirroring how the non-delta `notifyStockChange` already does it correctly.

---

## 🟡 MEDIUM — Frontend hardcodes the `'ADMIN'` string literal instead of importing `Role` from shared-types *(End-User Advocate)*

**File:** `frontend/src/app/core/services/auth.service.ts:52`

```ts
readonly isAdmin = computed(() => this._user()?.role === 'ADMIN');
```

`Role` is defined in `packages/shared-types/src/enums.ts` and already used by the backend, but never imported here. Low severity today (binary ADMIN/CUSTOMER can't silently desync the way a list can), but it's the exact duplicate-instead-of-import pattern this audit series keeps finding elsewhere, and any future role addition (e.g. `STAFF`) reintroduces real risk.

**Fix:** `import { Role } from '@fragrance-store/shared-types'` and compare to `Role.ADMIN`.

---

## 🟡 MEDIUM — New e2e CI job's Playwright step has no timeout *(Pragmatist)*

**File:** `.github/workflows/ci.yml:198-199`, `e2e/playwright.config.ts`

The health-wait loop correctly fails fast (30×2s, then `exit 1`), but the `Run Playwright e2e suite` step itself has no `timeout-minutes`, and `playwright.config.ts` sets no `globalTimeout` either. A hung test (e.g. waiting on a webhook that never fires against mocked Stripe) relies entirely on GitHub Actions' 6-hour job default before failing, burning CI minutes silently instead of failing fast.

**Fix:** Add `timeout-minutes: 10` to the Playwright step and/or set `globalTimeout` in the Playwright config.

---









Not yet:






## 🟡 MEDIUM — Dependabot's "consolidation" comment overclaims coverage vs. a prior fix it silently reverted *(Pragmatist)*

**File:** `.github/dependabot.yml:1-9` (from `2f26114`)

The comment claims a single root entry "covers every package in the monorepo," which is true for update-detection purposes, but the exclusion list (line 268) previously recorded a fix that added root, `shared-types`, and `github-actions` as three separate directory entries. `2f26114` re-collapsed `shared-types` back into the root entry without acknowledging the prior commit. Functionally likely fine (workspace deps hoist to the root lockfile), but worth a one-line note in the exclusion list so round 15 doesn't flag it as a fresh regression.

**Fix:** No functional change needed — add a clarifying note to the exclusion list's Dependabot entry.

---

## 🟡 MEDIUM — `coupon-validate` throttler test only exercises a synthetic controller, not the real route wiring *(Risk Analyst)*

**File:** `backend/src/__tests__/throttler-coupon-scope.spec.ts`

The test proves the `skipIf` predicate works correctly in isolation against a minimal test controller, but never exercises the real `CouponController`/`CouponValidateThrottlerGuard` pairing — so it can't actually prove `POST /coupons/validate` is throttled correctly end-to-end in production wiring, despite the commit message implying stronger coverage.

**Fix:** Add an integration-level test that boots the real `CouponController` and asserts the 429 behavior through the actual guard stack.

---

## 🟢 LOW — Webhook route's `default` throttle override doesn't exempt it from the global `burst`/`sustained` limits *(Domain Expert)*

**File:** `backend/src/modules/payments/payments.controller.ts:53-54`, `backend/src/throttler.config.ts:21-27`

`@Throttle({ default: {...} })` on the webhook route only overrides the `default` entry — `burst` (5 req/s/IP) and `sustained` (60/min/IP) still apply, keyed per-IP. Stripe sends webhooks from a small, rotating IP pool and retries failed deliveries with backoff for up to 3 days. Current limits are unlikely to be hit under normal load, but if Stripe ever bursts replays (e.g. catching up after an extended outage), the shared-IP `sustained` bucket could 429 legitimate webhook deliveries indistinguishably from abuse.

**Fix:** Either add `@SkipThrottle({ burst: true, sustained: true })` on the webhook route, or document that 60/min is intentionally chosen with margin above Stripe's retry cadence.

---

## Notes — verified clean, not findings

The **Skeptic** pass re-verified all 7 of round 13's claimed fixes by reading diffs and executing the new tests live (not just reading them): the throttler fix correctly registers a `default` throttler and scopes `coupon-anon`/`coupon-auth` to `/coupons/validate` only; the zero-decimal-currency util's boot-only scope is correct by design (env var is immutable without a restart); the partial-refund idempotency key genuinely disambiguates sequential calls (though see the new concurrency finding above — sequential correctness and concurrent-safety are different properties); SSE/back-in-stock publishing is fully wired at all 12 mutation sites, not partial; `cleanupStaleShippingLabels`'s lock matches the sibling cron pattern exactly; the e2e CI job genuinely boots Postgres+Redis+backend and runs the real Playwright suite (API-level only, honestly disclosed as a scope limit in its own comment); `sweepOrphanedPendingOrders` is fixed identically to `handlePaymentFailure`. No gaps in any of the 7 areas.

The **Systems Thinker** pass confirmed the centralized stock-publish helper is called post-commit (never inside the transaction) at every one of the 12 mutation sites, and found no new reliance on pgbouncer-incompatible row locking in the 59 new `orders.service.ts` lines.

The **Risk Analyst** pass confirmed Turnstile-vs-throttler guard ordering is pre-existing NestJS framework behavior, unchanged by round 13 (not a regression); confirmed the recent dependency/CI-version bumps resolve only from the standard npm registry with no new postinstall scripts or suspicious transitive packages; confirmed the two new throttler spec files genuinely assert 429-on-Nth-request, not just happy-path.

The **Domain Expert** pass found no remaining money-math call site that bypasses the new zero-decimal-currency util — it's enforced once at boot, with no per-call-site bypass surface left to audit.

The **First-Principles** pass confirmed `Category` is the only self-referential model in the entire schema (no comment threads, bundle products, or nested discounts with the same risk), and that no other call site walks `.children`/`parentId` with a hardcoded depth — the cycle-detection walk in `categories.service.ts` is a correctly-bounded ancestor traversal, not the same bug class.

The **End-User Advocate** pass re-verified `canCancel`/`canPartialCancel`/`canDownloadInvoice` against their backend guards line-by-line and confirmed round 13's fixes held with no new drift.

The **Pragmatist** pass confirmed the recent dependency bumps (`ioredis`, `axios`, `bullmq`, `helmet`, `stripe`, `@nestjs/*`) introduce no breaking-change landmines — a transient `ioredis` dual-copy issue from `bullmq`'s nested resolution was already caught and pinned via `pnpm.overrides` within the same PR — and `pnpm install --frozen-lockfile` / `pnpm audit --audit-level=high` both come back clean (4 pre-documented ignored CVEs, 0 new unaccounted high/critical).

---

This round's findings, once resolved, should be folded into `docs/audit-exclusion-list.md` per its own maintenance instructions.
