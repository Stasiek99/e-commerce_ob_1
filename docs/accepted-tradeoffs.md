# Accepted Tradeoffs

**See also:** [`business-process-model.md`](./business-process-model.md),
[`coupon-lifecycle-model.md`](./coupon-lifecycle-model.md),
[`auth-session-lifecycle-model.md`](./auth-session-lifecycle-model.md), and
[`gdpr-export-erasure-model.md`](./gdpr-export-erasure-model.md), which cite
several of the entries below inline against the specific state-machine transition they
justify (e.g. the DISPUTE_LOST_REVIEW no-auto-restore entry, the coupon `Math.round`
entry, the JWT-Redis-outage fail-open entry).

Companion to `audit-exclusion-list.md`. That file records resolved *bugs* — things that were wrong and got fixed. This file records *judgment calls*: places where the code deliberately picked one defensible option over another, where reasonable engineers could disagree, and where a future audit round should not re-flag the choice itself as a defect.

The distinction matters because several real findings across this audit series turned out to be the same tradeoff being re-litigated from a different angle each time (e.g. round 13 fixed a coupon-throttler leak; round 14 then flagged that the fix removed `cart/items`'s only incidental rate limit — both findings were real, but the underlying question "how strict should `cart/items` be?" is a tradeoff, not a bug, and deserves one explicit answer instead of N rounds of drive-by opinions).

**Rule for future audit rounds:** if you're about to flag something, check here first. If the mechanism matches an entry below, it's out of scope — the choice was made deliberately, for the stated reason. If you believe the reasoning is now wrong (new information, changed scale, changed risk tolerance), say so explicitly as a *proposal to revisit a tradeoff*, not as a freshly-discovered defect — and cite which entry you're proposing to overturn.

**Rule for whoever resolves a future finding:** if the "fix" is really a choice between two valid designs, don't just ship one — add an entry here explaining why, so the next round doesn't reopen it from the other side.

---

## Auth / Sessions

- **JWT validation fails open on Redis outage.** `backend/src/modules/auth/strategies/jwt.strategy.ts:81-89` — if the revocation-fence Redis lookup (`auth:revoke-before:*`, `auth:revoked-jti:*`) throws, the catch block lets the request through rather than rejecting it, logging an error and capturing it in Sentry instead.
  **Why:** the alternative — fail closed — means a Redis outage locks out every authenticated user simultaneously, including the admin trying to diagnose the outage. The accepted exposure is narrow and time-boxed: a revoked token can keep working for up to `JWT_ACCESS_EXPIRES_IN` (15 min default) during an outage, which is the same window a legitimately-non-revoked token would have anyway.
  **Don't flag:** "JWT validation doesn't fail closed on Redis errors." Do flag: any *new* code path that relies on the revocation fence being authoritative (it isn't, by design, during an outage) — e.g. anything assuming a revoked token can never reach a handler.

## Payments / Stripe

- **Stripe API version is pinned explicitly, bumped only in a dedicated commit.** `backend/src/modules/payments/stripe.client.ts` — `new StripeSDK(apiKey, { apiVersion: '2026-05-27.dahlia' })`.
  **Why:** the previous approach omitted `apiVersion` on the theory that this "tracks the Stripe account's Dashboard default." Reading `stripe-node`'s own source (`stripe.core.js`: `version: props.apiVersion || DEFAULT_API_VERSION`) shows that's not what happens — the SDK always sends a `Stripe-Version` header, defaulting to whatever version is bundled with the installed `stripe` npm package. Since Dependabot's `root-minor`/`root-patch` groups can bump `stripe` without anyone specifically reviewing a webhook/session payload shape change, the *implicit* pin was silently riding on routine dependency bumps. An explicit pin makes version bumps a deliberate, reviewable decision instead of a side effect.
  **Don't flag:** "apiVersion is hardcoded and will eventually be outdated." That's the point — bump it on purpose, in its own commit, when you've actually checked the changelog between versions; don't auto-float it.

- **`STRIPE_CURRENCY`'s zero-decimal-currency check runs once at boot, not per call site.** `backend/src/config.validation.ts` (boot-time `isZeroDecimalCurrency` rejection) — no runtime guard exists in `payments.service.ts`, `stripe.client.ts`, or `invoice.service.ts` money-math call sites.
  **Why:** `STRIPE_CURRENCY` is read from an immutable env var at `ConfigModule.forRoot()`; it cannot change without a process restart, which re-triggers the boot validation. A per-call-site runtime check would be pure redundancy with no scenario where boot validation passes but a later call sees a different currency.
  **Don't flag:** "money math doesn't validate currency format per call." Do flag: any new money-computation path that reads currency from somewhere *other than* the validated config (e.g. a value sourced from request input or a third-party response) — that would bypass the boot guard for real.

- **Coupon `PERCENTAGE` discount rounds in the customer's favor.** `backend/src/modules/coupons/coupon.service.ts:165-166` — `Math.round((cartTotalInCents * value) / 100)`, standard "round half up," explicitly commented as deliberate.
  **Why:** standard retail practice — when a discount calculation lands on a half-grosz boundary, rounding toward the customer (vs. the merchant) avoids the appearance of shortchanging them and is immaterial at this scale (the order-level cap in `partialRefund` already prevents this from compounding into anything beyond a few grosz, per round 13's separate discount-proration finding).
  **Don't flag:** "discount rounding could be `Math.floor`'d to favor the merchant." This is intentional. Do flag: if rounding direction becomes *inconsistent* across discount types (it should always round customer-favorable, not merchant-favorable in one place and customer-favorable in another).

- **Dispute-lost stock is never auto-restored — it requires explicit admin confirmation.** `backend/src/modules/payments/payments.service.ts:1462-1468` — a `lost` dispute moves the order to `DISPUTE_LOST_REVIEW` and stops there; stock is only incremented if an admin manually transitions the order onward (e.g. to `CANCELLED`) after confirming the goods genuinely weren't delivered.
  **Why:** this replaced an earlier "always restore stock on lost dispute" behavior that overcorrected — the majority of real-world chargebacks involve goods that *were* genuinely delivered, so blind auto-restore created phantom inventory (oversold SKUs) far more often than it correctly recovered stock from fraud. Trading restock latency for inventory accuracy was the deliberate call.
  **Don't flag:** "stock isn't restored automatically when a dispute is lost" or "this adds manual latency to restocking." Do flag: if `DISPUTE_LOST_REVIEW` orders can silently sit forever with no admin alert/queue surfacing them (an operational gap, not the tradeoff itself).

## Infra / CI

- **Dependabot uses one root-level npm entry for the whole pnpm workspace, not one entry per package.** `.github/dependabot.yml:1-12`.
  **Why:** pnpm workspaces can only be updated from the workspace root — pointing Dependabot's `directory` at `/backend`, `/frontend`, or `/packages/shared-types` individually throws `misconfigured_tooling`, since `pnpm-lock.yaml` and `pnpm-workspace.yaml` only exist at the root. A single root entry with `versioning-strategy: lockfile-only` is the only configuration that actually works for a pnpm monorepo, and it does cover every workspace package's dependencies.
  **Don't flag:** "Dependabot doesn't have separate entries for backend/frontend/shared-types" — that configuration is invalid for this package manager, not a coverage gap. Do flag: if a *new* workspace package is added at the root level under a different lockfile (it isn't currently, and shouldn't be).

---

*When you settle a currently-open tradeoff (e.g. the `cart/items` throttle strictness flagged in round 14), add it here and remove it from the "open questions" list in the relevant audit round doc.*
