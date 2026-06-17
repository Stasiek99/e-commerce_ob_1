# E-Commerce Audit — Round 12
*Generated: 2026-06-16 — 5-agent stochastic consensus*
*Agents: Domain Expert (payments/architecture) · Skeptic (fix-verification) · Pragmatist (ops/deploy) · First-Principles (invariant tracing) · Risk Analyst (security/IDOR/injection)*

> **Excludes** everything already in `audit-weak-points.md`, `audit-round-2.md` through `audit-round-11.md`, and `project-gaps-audit.md` — condensed into `docs/audit-round-12-exclusion-list.md` (~280 prior findings).
> **Excludes** Phase 7 (pre-launch checklist) items in ROADMAP.md.

A theme of this round, distinct from rounds 1-11: several findings here are **fixes from round 11 itself that re-introduce or relocate the bug they were meant to close** (corrective-invoice idempotency, dispute-lost stock restore, bounce suppression). The codebase has converged enough on auth/IDOR/injection basics that the Risk Analyst pass came back mostly clean — the remaining risk surface is now concentrated in **state-machine edge cases and the gap between independently-correct pieces of code composed in new contexts**, not missing guards.

---

## 🔴 CRITICAL — Five new Prisma migrations are untracked in git on this exact branch — next deploy silently skips them *(Pragmatist)*

**Files:** `backend/prisma/migrations/20260614195315_cart_item_variant_restrict/`, `20260614210000_order_review_request_sent_at/`, `20260615100000_consent_log_uuid_cookie/`, `20260615110000_invoice_correction_idempotency/`, `20260616120000_add_email_bounced_reason/`

All five show as `??` (untracked) in `git status` on `fix/fixes_round_11`. If this branch is merged/pushed as-is, Railway's `pnpm --filter backend exec prisma migrate deploy` pre-deploy step never sees these files — the remote checkout doesn't have them. The build succeeds, but the DB schema silently diverges from `schema.prisma`. Concretely: `invoice_correction_idempotency` adds a UNIQUE constraint that commit `3878f6d`'s service code already depends on, and `add_email_bounced_reason` adds a column commit `27fbd86` reads/writes. Missing column/constraint on first production request → unhandled Prisma error.

This is exactly the failure mode the now-fixed `.gitignore` issue was supposed to close — the gitignore rule is fixed, but nothing enforces these files actually get `git add`ed before merge.

**Fix:** `git add backend/prisma/migrations/` and commit before merging. Add a CI check that fails if `prisma migrate diff` shows pending migrations not present in the checked-out tree (`prisma migrate status` against a throwaway DB as a pre-merge gate).

---


## 🔴 CRITICAL — Corrective-invoice idempotency key collides on refund amount, not correction identity — silently swallows distinct partial cancellations *(Skeptic)*

**Files:** `backend/src/modules/invoice/invoice.service.ts:202-253`, unique constraint in `backend/prisma/migrations/20260615110000_invoice_correction_idempotency/migration.sql`

Round 11's fix added a unique constraint and idempotency check on `(orderId, correctedAmountInCents)` to stop BullMQ retries from duplicating a corrective invoice. But `correctedAmountInCents` is derived fresh per-call from only the items cancelled in that specific call — not from any correction sequence number or request ID. Two **separate, unrelated** partial cancellations on the same order that happen to total the same refund amount (common in a fragrance catalog with shared price points like 99 PLN / 149 PLN) hit the existing row, see `correctiveStoragePath` already set, and the code returns the **first** correction's URL/number as if it were the second's (lines 217-228). The second correction is never generated — the customer is refunded via Stripe but never receives a corrective invoice for it, and the VAT ledger permanently understates the correction. The accompanying test suite (`invoice.service.spec.ts:1174+`) only exercises true-retry-of-same-correction, never two distinct same-amount corrections.

This is exactly the kind of bug a JPK_V7 cross-check (declared refund total vs. corrective invoices issued) would catch.

**Fix:** Key idempotency on a per-correction sequence/request id (e.g. a `correctionSequence` int per order, or hash of the specific `orderItemId`s being cancelled in this call), not on the resulting amount.

---

## 🔴 CRITICAL — "Always restore stock on lost dispute" fix creates phantom inventory for the majority of real chargebacks *(Skeptic)*

**File:** `backend/src/modules/payments/payments.service.ts:1284-1315` (commit `9cc62f0`)

Round 11 removed the `shipment.labelUrl` heuristic and now restores stock unconditionally on every lost dispute. But most real-world chargebacks ("item not as described," "didn't recognize charge," friendly fraud) involve goods that were **genuinely delivered** and aren't coming back. Unconditionally incrementing `productVariant.stock` on every lost dispute creates phantom sellable inventory — the platform will oversell that SKU to a second paying customer who will never receive it, because the bottle is sitting in the first customer's home. The commit message rationalizes this as "let an admin manually adjust if goods are provably delivered," but there is no admin UI for that adjustment, no flag set on the order to prompt review, and the Sentry alert tag (`dispute_lost`) doesn't mention stock was auto-restored or needs verification.

The fix swapped one wrong default (never restore) for the opposite wrong default (always restore) without adding the verification step its own commit message says is needed — directly enabling the "double loss" (chargeback + oversold replacement) it claims to prevent.

**Fix:** Set order to a `DISPUTE_LOST_REVIEW` flag/status instead of auto-restoring stock; require explicit admin confirmation that goods were never delivered before incrementing stock.

---

## 🟠 HIGH — Stripe minimum-charge floor hardcoded to 50gr but Stripe's actual PLN minimum is 200gr *(Domain Expert)*

**File:** `backend/src/modules/orders/orders.service.ts:312`

```ts
if (txTotalInCents > 0 && txTotalInCents < 50) {
  throw new BadRequestException('Kwota zamówienia jest zbyt niska (minimum 0,50 zł po rabacie).');
}
```

Stripe's documented minimum charge for PLN is 2.00 PLN, not 0.50 PLN. Any order landing between 51gr and 199gr (a cheap sample item after a coupon, or with `FREE_SHIPPING` zeroing delivery) passes this guard, then fails at `stripe.checkout.sessions.create`. For `createFromCart` the existing rollback catches this. But `retryPayment` calls `initiatePayment` directly with **no try/catch and no rollback path at all** — the Stripe error surfaces as a raw 500 with stock still decremented and the order stuck in `PENDING_PAYMENT` forever.

**Fix:** Change the threshold to 200 (and make it currency-aware via a lookup table if `STRIPE_CURRENCY` is ever not PLN).

---

## 🟠 HIGH — `markSessionPaid` never validates Stripe's captured amount against the order's stored total *(Domain Expert)*

**File:** `backend/src/modules/payments/payments.service.ts:276-427`

The webhook handler trusts `payment.amountInCents`/`order.totalInCents` blindly — it never reads `session.amount_total` and compares it to what the DB expected to collect. There is no defense-in-depth check at settlement time: a bug elsewhere that builds a Checkout Session with the wrong line items (admin price edit, concurrent shipping-rate change) would silently mark an order PAID for the wrong amount with no alarm. Every other safeguard in this module assumes `order.totalInCents` is ground truth at webhook time; nothing actually confirms that's what Stripe collected.

**Fix:** In `markSessionPaid`, assert `session.amount_total === payment.amountInCents` (or order total) and raise a Sentry alert + hold the order for review on mismatch instead of marking PAID.

---

## 🟠 HIGH — `approveFraudReview` has no outbox/recovery safety net — a crash after commit permanently loses the invoice + confirmation email *(Domain Expert)*

**File:** `backend/src/modules/payments/payments.service.ts:433-469`

When an order is first flagged `FRAUD_REVIEW` in `markSessionPaid`, `payment.status` is already set to `COMPLETED` unconditionally and the outbox insert is skipped (`if (!isFraudFlagged)`). When an admin later calls `approveFraudReview`, it commits the `PAID` transition, then dispatches notifications purely in-process with no `OutboxMessage` row. If the process crashes/restarts between commit and notification (plausible on Railway hobby tier), the order is permanently PAID but the customer never gets an invoice or confirmation email — and nothing can recover it: the outbox poller has no row, and `reconcilePendingPayments` only scans `payment.status === PENDING`, which this payment already isn't.

**Fix:** Wire `approveFraudReview`'s notification dispatch through the same `OutboxMessage` pattern used by the main webhook path.

---

## 🟠 HIGH — Per-rate VAT breakdown on corrective invoices uses pristine original-order totals, not the post-prior-correction base *(Skeptic)*

**File:** `backend/src/modules/invoice/invoice.service.ts:280, 325-364`

`buildCorrectiveVatBreakdown` fetches `order.items` fresh (full `snapshotPrice * quantity`, ignoring `cancelledQuantity`) every time `processCorrectiveInvoice` runs, using that as `originalGross` for each VAT-rate bucket. On a **second** partial cancellation touching a VAT rate already partially corrected once, the "original" column on the new corrective invoice shows the order's pristine pre-any-correction total, not the actual taxable base immediately prior to this correction — which Art. 106j ust. 2 requires. The delta itself is computed correctly, but `corrected_invoice_2.original ≠ corrected_invoice_1.corrected`, an internal inconsistency between sequential corrective invoices for the same order. This is the same "stale base on repeated partial cancellation" bug class the team already fixed once for discount proration (round 11), reintroduced in the brand-new VAT-breakdown code added in the same commit.

**Fix:** Compute `originalGross` per rate as `pristine total − sum(all prior corrections for that rate)`, not the pristine total directly.

---

## 🟠 HIGH — Bounce-suppression bypass for transactional emails fires for permanent (hard) bounces too, not just transient ones *(Skeptic)*

**Files:** `backend/src/modules/email/email-queue.service.ts:56-85`, `backend/src/modules/email/email-webhook.controller.ts:90-105`

Round 11's fix lets `TRANSACTIONAL_ORDER_EMAIL_TYPES` bypass bounce suppression whenever `emailBounced=true` and the bounce isn't yet 30 days stale. But `emailBounced` is set identically for `bounce.type === 'Permanent'` (mailbox doesn't exist) and `'Transient'` (mailbox full) — nothing in `enqueue()` branches on `emailBouncedReason`'s subtype. For a hard bounce, the address is confirmed dead, yet the code keeps re-sending order/payment/shipping/cancellation emails to it for up to 30 days, once per order event. Sustained hard-bounce sends are exactly what gets a Resend/SES sending identity rate-limited or suspended — taking down transactional email for **every** customer, not just the one with the dead address.

**Fix:** Branch on bounce subtype — bypass suppression only for `Transient`/soft bounces; never bypass for `Permanent`/hard bounces (fall back to the order's other contact method or just accept non-delivery there).

---

## 🟠 HIGH — `retryPayment` has no rollback when coupon re-validation throws — permanently strands stock and a coupon redemption *(First-Principles)*

**Files:** `backend/src/modules/coupons/coupon.service.ts:65,76`, `backend/src/modules/orders/orders.service.ts:368-377,860-869`, `backend/src/modules/payments/payments.service.ts:41-52`

`initiatePayment` re-validates the coupon on every call, including retries — intentional, to catch a coupon that became invalid *after* order creation. `createFromCart`'s `catch` block correctly rolls back stock/coupon-use if this throws on the first call. But `retryPayment` (`orders.controller.ts:92-93`) calls `initiatePayment` directly with **no try/catch, no rollback at all**. If a customer's *own order creation* consumed the coupon's last `maxUsesTotal`/`maxUsesPerUser` slot, then any transient retry (declined card, closed browser) re-runs the same validation, which still reads the cap as exceeded — now self-inflicted and unrecoverable. The order is stuck `PENDING_PAYMENT` forever, stock stays decremented, and the coupon slot is burned for a sale that can never close. Nothing in `OrdersCleanupService` reclaims stranded `PENDING_PAYMENT` orders.

This is an emergent bug from two independently-correct pieces of code (validate-on-every-call, rollback-on-create-failure) composed in a context — `retryPayment` — that neither was written assuming.

**Fix:** Wrap `retryPayment`'s call to `initiatePayment` in the same rollback logic as `createFromCart`, or exempt the *creating* order's own coupon use from the re-validation cap check on retry.

---

## 🟡 MEDIUM — `OutboxProcessorService.recoverPendingMessages` has no distributed lock — every Railway replica races the same rows *(Domain Expert)*

**File:** `backend/src/modules/payments/outbox-processor.service.ts:25-48`

Unlike the sibling `@Cron` jobs (`reconcilePendingPayments`, `pruneProcessedStripeEvents`), which both acquire a Redis `SET ... NX` lock first, this `@Interval(30_000)` poller has no lock and no atomic row-claiming (`SELECT ... FOR UPDATE SKIP LOCKED`). With more than one backend replica, every instance independently queries the same `PENDING` rows every 30s and races `processInvoice` + email dispatch concurrently for the same order. Email duplication happens to be mitigated by `EmailQueueService.deriveJobId`, but the concurrent `processInvoice` calls and wasted work are not — multiplying any existing `processInvoice` atomicity gap by replica count.

**Fix:** Add the same Redis lock pattern used by the other cron jobs, or claim rows via an atomic `UPDATE ... WHERE status='PENDING' RETURNING`.

---

## 🟡 MEDIUM — `email_logs` 1-year deletion destroys the only audit trail proving bounce-suppression decisions were correct *(Skeptic)*

**File:** `backend/src/modules/email/data-retention-cleanup.service.ts:33-39`

`EmailLog` rows (Resend webhook payload, bounce subtype/reason) are deleted after 365 days regardless of whether the associated `User.emailBounced` flag is still active. If a customer disputes "I never got a legally-required order confirmation" and the merchant's defense is "it was suppressed due to a bounce," the evidence proving why is gone after a year while the suppression flag itself can persist far longer. Not a GDPR violation (the opposite), but it undermines the merchant's own UoK Art. 21 defense — the side effect of two round-11 fixes (bounce-bypass + log retention) interacting in a way neither commit considered together.

**Fix:** Either extend `EmailLog` retention for rows tied to a still-active `emailBounced=true` user, or snapshot the bounce reason onto the `User` record itself before the log row is purged.

---

## 🟡 MEDIUM — `pnpm audit` in CI is `continue-on-error: true` — a HIGH/CRITICAL CVE never blocks merge *(Pragmatist)*

**File:** `.github/workflows/ci.yml:28-30`

The audit step exists, so it superficially looks like the "no CVE scanning" gap from prior rounds is closed — but `continue-on-error: true` makes it advisory-only; nothing fails the build. Combined with Dependabot restricted to patch/minor only (major versions explicitly ignored in `.github/dependabot.yml`), a critical vulnerability in a major-pinned dependency (`stripe`, `@prisma/client`, `bullmq`, all on `^` major-floor ranges) can sit unflagged indefinitely. This is a false sense of security: "we have a CVE gate" when there isn't one.

**Fix:** Remove `continue-on-error` for `high`/`critical` findings, or at minimum pipe the audit output to a required status check separate from the main test job.

---

## 🟡 MEDIUM — Coverage gate is bypassable via `--passWithNoTests` on exactly the four money-path files it's meant to protect *(Pragmatist)*

**Files:** `backend/package.json:17`, `frontend/package.json:13`, `backend/jest.config.ts:13-19`

`test:cov` runs with `--passWithNoTests`, and the 70%-branch-coverage threshold is enforced only on `auth.service.ts`, `cart.service.ts`, `orders.service.ts`, `payments.service.ts`. If any of those `.spec.ts` files is renamed, accidentally excluded by a future `testPathIgnorePatterns` change, or deleted in a refactor, Jest finds 0 matching tests for that threshold and — because of `--passWithNoTests` — exits 0 (green) instead of failing. The test gate silently becomes a no-op exactly where it matters most.

**Fix:** Drop `--passWithNoTests` from `test:cov` (keep it only for unrelated lint-adjacent test runs if needed), or add an explicit count-of-test-files assertion.

---

## 🟡 MEDIUM — No documented rollback runbook for "migration applied cleanly, new app code is broken" *(Pragmatist)*

**File:** `railway.json:17-19` (pre-deploy gate)

Railway's `preDeployCommand` blocks traffic shift only if the migration itself fails — there's no equivalent gate or written procedure for "migration succeeded, but the new code has a bug." Prisma migrations are forward-only; a Railway "redeploy previous version" click can make things worse if a migration in between added a `NOT NULL` column the prior code can't tolerate, or vice versa. This is distinct from the already-flagged backup/PITR gap — it's specifically about deploy-time rollback procedure, not data-loss recovery.

**Fix:** Write a short runbook: when to roll back app code only vs. when a migration makes rollback unsafe, and how to verify compatibility before clicking "redeploy previous version."

---

## 🟡 MEDIUM — Node engine range is unbounded (`>=20`) with no `.nvmrc` or pinned Railway runtime *(Pragmatist)*

**File:** `package.json:17`

Railway's Railpack builder resolves "Node 20 or later" at build time with no lockfile-equivalent pin, while CI hardcodes `node-version: 20` in `actions/setup-node` — the two can silently drift. A future Railway base-image bump to Node 22/24 changes the runtime under the app with zero corresponding commit or CI signal (V8 flag changes, ICU differences, deprecated API removal).

**Fix:** Add a `.nvmrc` pinning an exact Node version and reference it both in CI's `setup-node` and (if supported) Railway's build config.

---


Not yet:










## 🟡 MEDIUM — `reconcilePendingPayments` cannot recover orders whose `initiatePayment` failed before any Stripe session existed *(First-Principles)*

**File:** `backend/src/modules/payments/payments.service.ts:866-873`

`reconcilePendingPayments()` only selects `Payment` rows where `stripeCheckoutSessionId: { not: null }`. An order whose retry attempt threw before reaching the Stripe call (e.g., the coupon-revalidation finding above) never gets a session ID recorded for that attempt, so the cron has nothing to reconcile against — these orders are a slow, invisible leak of stock and coupon capacity with no monitoring signal and no automatic terminal state.

**Fix:** Add a secondary sweep for orders in `PENDING_PAYMENT` older than N hours with **no** associated Payment row bearing a session ID, and surface them for manual review or auto-cancel.

---

## 🟡 MEDIUM — Order-number sequence DDL interpolates the year via `$executeRawUnsafe`/`$queryRawUnsafe`, mirroring the already-flagged invoice pattern in a second, independent location *(Risk Analyst)*

**File:** `backend/src/modules/orders/orders.service.ts:90-95` (`onModuleInit`), `:1373-1375` (`generateOrderNumber`)

`year` is `new Date().getFullYear()` — server-derived, not attacker input, so this is not directly exploitable today. But it's a second, independent occurrence of the exact gap the exclusion list calls out only for `invoice.service.ts` ("needs bounds-check, also missing in `processCorrectiveInvoice`"). If any future change threads a stored/client-influenced date into this path, it becomes SQL injection into a DDL statement.

**Fix:** Apply the same integer-bounds-check fix planned for `invoice.service.ts` here too, for consistency and to close the pattern everywhere at once rather than file-by-file.

---

## 🟢 LOW-MEDIUM — Coverage report committed to git despite being gitignored, with machine-specific absolute paths *(Pragmatist)*

**Files:** `backend/coverage/` (101 tracked files), `backend/coverage/coverage-summary.json`

`backend/coverage/` is listed in `.gitignore` but 101 files were tracked before the rule existed and never removed from the index. The currently-modified `coverage-summary.json` contains hardcoded paths like `E:\\repos\\e-commerce_ob_1\\...` — a different drive letter than this machine. Every `pnpm --filter backend test:cov` run, including CI, regenerates this file with the current machine's absolute paths, producing a 100%-changed diff unrelated to actual code on every PR and guaranteeing merge conflicts whenever two branches both run tests.

**Fix:** `git rm -r --cached backend/coverage` once; the `.gitignore` rule will keep it out going forward.

---

## 🟢 LOW-MEDIUM — Admin session-fixation regeneration guard doesn't cover two custom Express routes registered before it *(Risk Analyst)*

**File:** `backend/src/modules/admin/admin.setup.ts:1090-1116` (routes) vs `:1134-1146` (guard middleware)

`/admin/picklist` and `/admin/fulfillment-gap` are registered and terminate the request (`res.send`) before the regenerate-on-login guard middleware, mounted later, ever runs for those paths — Express dispatches in registration order. The guard reliably fires only for requests that fall through to the AdminJS router. Narrow exploit story (requires an attacker-planted session cookie plus the admin's first post-login navigation landing on one of these two specific bookmarked URLs rather than the dashboard), but it is a genuine gap in coverage of the round-11 session-fixation fix.

**Fix:** Register the regenerate-guard middleware before the two custom routes, or call the regeneration explicitly inside each handler.

---

## 🟢 LOW — `handlePaymentFailure` stock-restore ignores `cancelledQuantity` — currently dead code, but a landmine for the next state-machine change *(First-Principles)*

**File:** `backend/src/modules/payments/payments.service.ts:1452-1457`

Restores `item.quantity` (full original) unconditionally, unlike the four other stock-restore sites in the same module which all compute `item.quantity - (item.cancelledQuantity ?? 0)`. Currently unreachable — `handlePaymentFailure` only runs against `Payment.status === PENDING`, and the order state machine never transitions back to `PENDING_PAYMENT` from a state where `cancelledQuantity > 0` could exist. But the other four call sites were clearly written defensively against exactly this bug; this one was missed, and it will silently double-credit stock the moment any future feature (payment retry after partial dispute resolution, admin manual reset) reintroduces a path into this function with partially-cancelled items.

**Fix:** One-line change to match the other four sites: `item.quantity - (item.cancelledQuantity ?? 0)`.

---

## 🟢 LOW — Redundant self-loop `OrderEvent` (`REFUNDED → REFUNDED`) bypasses the state-machine guard and corrupts the audit trail *(Domain Expert)*

**File:** `backend/src/modules/orders/orders.service.ts:781-791`

After `refundPayment` already writes the correct `PAID → REFUNDED` transition event, a second write inserts a `REFUNDED → REFUNDED` self-transition directly via Prisma (bypassing `ORDER_STATUS_TRANSITIONS`, which defines `REFUNDED` as terminal with no legal exits) solely to attach the customer's withdrawal `reason` text. Any future order-timeline UI consuming `findEventsForUser`/`findEventsAdmin` would render a confusing duplicate "Refunded" entry.

**Fix:** Attach `reason` to the original transition event instead of inserting a second nonsensical one — pass `reason` through to `refundPayment`'s own event-creation call.

---

## Notes — verified clean, not findings

The Risk Analyst pass specifically targeted IDOR, injection, SSRF, hardcoded secrets, and coupon/cart fraud vectors not already in the exclusion list, and came back largely clean: all 15 controllers correctly scope "me"/"mine" endpoints off `@CurrentUser()`; no unparameterized SQL outside the two year-interpolation sites above; no new SSRF surface (all outbound calls hit hardcoded carrier/Stripe/Resend/Cloudflare/location-API domains); no hardcoded secrets beyond what prior rounds found; coupon discount is always recomputed server-side against fresh prices inside the order transaction, never trusted from a client preview call. This convergence is itself a useful signal — 11 rounds in, the auth/ownership/injection layer has largely stabilized, and remaining risk is concentrated in state-machine edge cases and the interaction between independently-shipped fixes (see the Skeptic and First-Principles findings above).
