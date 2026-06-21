# E-Commerce Audit — Round 19
*Generated: 2026-06-21 — 6-agent stochastic consensus*
*Agents: Domain Expert (Identity & Admin) · Risk Analyst (Identity & Admin) · Skeptic (Identity & Admin) · Domain Expert (Shipping & Storage) · Risk Analyst (Shipping & Storage) · Skeptic (Shipping & Storage)*

> **Excludes** everything already in `docs/audit-exclusion-list.md` (~389 prior findings across rounds 1-18) and settled tradeoffs in `docs/accepted-tradeoffs.md`.
> **Scope:** Identity & Admin (auth, users, admin/AdminJS modules, plus the corresponding frontend auth/account components and guards/interceptors) and Shipping & Storage (shipping, storage modules, carrier clients, plus the corresponding frontend checkout-carrier UI and AdminJS shipping routes). Cart/orders/payments/coupons/invoices/products/catalog were out of scope — rounds 16-18 cover those.
> **Verification note:** every finding below was independently re-checked against the current source after the agents reported (file:line spot-checks, not just trusting the agent's transcript). One agent-reported finding — a claimed unused `GLS_SANDBOX` env var in `gls.client.ts`/`.env.example` — was checked and found to be **fabricated** (no such variable exists in `.env.example`; only `GLS_MOCK_ENABLED`/`GLS_USERNAME`/`GLS_PASSWORD`/`GLS_SENDER_ID` are defined). It is excluded from this report.

The two Shipping & Storage agents working independently from different lenses (Risk Analyst on partial-failure/ordering, Skeptic on sibling-divergence) converged on the same target function — `cleanupStaleShippingLabels()` — but found two genuinely different bugs in it, both confirmed against the current code. They're written up together below since a fix for one without the other still leaves the cron broken.

---

## 🟠 HIGH — AdminJS `ReturnRequest.reject()` is missing the `APPROVED` guard its sibling `approve()` has — an admin can reject an already-approved, refund-promised return

**Classification:** Bug
**Files:** `backend/src/modules/returns/returns.service.ts:193-201` (`approve()`, blocks `APPROVED`/`COMPLETED`/`REJECTED`) vs. `:225-233` (`reject()`, blocks only `REJECTED`/`COMPLETED`); `backend/src/modules/admin/admin.setup.ts:875-876` (`approve.isVisible` excludes `APPROVED, COMPLETED, REJECTED`) vs. `:899-900` (`reject.isVisible` excludes only `REJECTED, COMPLETED` — `APPROVED` is absent from both the button-visibility predicate and the service-level status guard)

`approve()` correctly refuses to run against an already-`APPROVED` request. `reject()` has no equivalent check — `req.status === 'APPROVED'` is never tested, in either the AdminJS `isVisible` predicate (so the "Odrzuć" button stays clickable after approval) or the service method itself (so the handler runs unobstructed if clicked). The bug is duplicated identically at both layers, which is why it survived: neither layer would have caught the other's gap.

**Trigger:** Admin approves a return (customer receives a "zatwierdzony" email, the request becomes reachable from `markRefunded`, which requires `status === 'APPROVED'`). The same record is then rejected — by mistake, by a second admin working the queue, or via a stale second tab still showing the "Odrzuć" button. `reject()` runs, flips `status` to `REJECTED`, and sends a contradictory "odrzucony" email to the same customer. The request is now stuck in a state `markRefunded` will never process (it requires `APPROVED`), and the only recovery is a second manual admin intervention that has no obvious trigger in the AdminJS UI (no "re-approve from rejected" path either, by design — `approve()` correctly blocks `REJECTED`).

**Fix:** Add `'APPROVED'` to `reject`'s `isVisible` exclusion list (matching `approve`'s pattern) and add `if (req.status === 'APPROVED') throw new BadRequestException('Cannot reject an already-approved return request')` to `ReturnsService.reject()`, mirroring the symmetry `approve()` already has.

---

## 🟠 HIGH — Magic-link login is fully implemented end-to-end on the backend but has zero frontend entry point

**Classification:** Bug
**Files:** `backend/src/modules/auth/auth.controller.ts:159-178` (`POST /auth/magic-link`, `POST /auth/magic-link/verify`), `backend/src/modules/auth/auth.service.ts:540-610` (`requestMagicLink`/`consumeMagicLink`) — contrast with `frontend/src/app/app.routes.ts` (only `auth/login`, `auth/register`, `auth/callback`, `auth/verify-email`, `auth/forgot-password`, `auth/reset-password` are registered) and a repo-wide frontend grep for `magic-link`/`MagicLink`/`magic-login`, which returns zero matches

The backend exposes complete, working, rate-limited magic-link request/verify endpoints with a full service implementation. No Angular route, component, or `AuthService` method references it anywhere — `login.component.ts` links to `/auth/forgot-password` but has no passwordless-login option. This is dead product surface that is simultaneously **live attack surface**: the endpoints are fully reachable via direct HTTP request (curl/Postman) by anyone, independent of whether any UI links to them, so they still need to carry their own security properties (rate limiting, replay protection) for no current product benefit.

**Trigger:** No customer can discover or use magic-link login through the storefront — the feature delivers zero UX value while still being live, reachable, unauthenticated-callable backend surface.

**Fix:** Either ship the frontend (a `/auth/magic-login` route + request/verify components mirroring `reset-password`), or remove the backend endpoints, DTOs, and service methods if the feature was abandoned. Shipping backend-only is the worst of both options — all of the risk, none of the benefit.

---

## 🟠 HIGH — Authenticated users have no way to change their email or password from the product — the working backend endpoints are unreachable

**Classification:** Bug
**Files:** `backend/src/modules/users/users.controller.ts:68-80` (`PATCH /users/me/email` → `requestEmailChange`, `PATCH /users/me/password` → `changePassword`, both already correctly hardened per the exclusion list) vs. `frontend/src/app/features/account/profile/profile.component.ts:60-87` (email rendered as a permanently muted, non-editable span — `info-value--muted`, no input — even in edit mode; the edit form has only `firstName`/`lastName`/`phone`/`nip` controls) — confirmed via a repo-wide frontend grep for `changeEmail`/`changePassword`/`users/me/email`/`users/me/password`, all returning zero matches

The only credential-recovery path exposed to the user is `forgot-password`, which assumes the user is logged out. A logged-in user who wants to rotate a password (e.g. after a breach notice) or correct a typo'd registration email has no in-product path to do either — both backend endpoints exist, are already correctly hardened (password-confirmation required, token revocation wired), and are simply never called by anything in the Angular app.

**Trigger:** Any authenticated customer attempting to change their email or password from their account page finds no control to do so anywhere in the UI.

**Fix:** Add change-email and change-password forms to `ProfileComponent` (or a dedicated account-security section), wired to the existing backend endpoints — no backend work required, this is purely a missing frontend surface.

---

## 🟠 HIGH — Deactivating a shipping carrier doesn't remove it from the checkout UI — it stays selectable at a stale price until order submission fails

**Classification:** Bug
**Files:** `frontend/src/app/features/checkout/checkout-page/checkout-page.component.ts:747-764` (`ngOnInit`'s live-rate fetch), contrast with `backend/src/modules/shipping/shipping.service.ts` (`GET /shipping/rates` correctly filters to only carriers with an active `ShippingRate` row) and `backend/src/modules/shipping/shipping-rates.service.ts` (`getRateForCarrier` → `NotFoundException` for a deactivated carrier)

`carriers` is seeded from the static fallback `CARRIERS` array (all 5 carrier codes). The live-rate fetch does `this.carriers().map((c) => ({ ...c, price: priceByCode.get(c.code) ?? c.price }))` — a `.map()`, which updates the price for any carrier found in the live response but never removes a carrier that's *missing* from it. The carrier radio-button template iterates `carriers()` directly with no active/availability filter. A carrier an admin deactivated via `PATCH /shipping/admin/rates/:carrier` therefore stays fully visible and clickable at its hardcoded fallback price. This is a distinct mechanism from the already-fixed "hardcoded prices diverge from the DB" bug (round 16) — that fix solved stale *price*, but never addressed stale *availability*, which survived the very code path that fixed the price problem.

**Trigger:** Admin deactivates a carrier. A customer reaches checkout, selects that carrier (still shown, still priced), fills in the entire address form, and only discovers the problem when `POST /orders` 404s server-side via `getRateForCarrier` — at the worst possible point in the funnel.

**Fix:** Filter `updated` to only carriers present in `priceByCode` (falling back to the full static list only when the live fetch fails entirely, matching the existing "offline last-resort" comment's intent), and clear `selectedCarrier` if it's no longer in the filtered list.

---

## 🟠 HIGH — `cleanupStaleShippingLabels()` has two independent bugs: it silently destroys carrier-hosted label references without deleting anything, and risks orphaning Supabase-stored ones on a crash

**Classification:** Bug
**Files:** `backend/src/modules/shipping/shipping.service.ts:354-393` (`cleanupStaleShippingLabels`), contrast with `:18-20` (`isCarrierHostedUrl`, exported specifically for this distinction) and `:339-346` (`getLabel()`, which correctly uses it); `backend/src/modules/storage/storage.service.ts:90-95` (`deleteShippingLabel`)

**Bug A — wrong heuristic, deterministic data loss for DHL/DPD.** The cron's skip condition is `if (!shipment.labelUrl || shipment.labelUrl.startsWith('mock-label-')) continue;` — it never calls `isCarrierHostedUrl()`, the exact helper `getLabel()` (a few lines above in the same file) uses to tell a Supabase storage path apart from a carrier's own hosted URL. For DHL/DPD, `labelUrl` is always a `https://...` URL set directly from the carrier's `createShipment()` response — never a Supabase path. The cron passes this full URL into `storage.deleteShippingLabel()`, which calls Supabase's `.remove([fullUrl])`. Supabase's remove API does not error on a non-matching key, so the `try` block's `catch` is never triggered: `deleted++` increments and `shipment.labelUrl` is unconditionally set to `null` in the DB — even though nothing was actually deleted from storage, because the "path" passed in was never a real object key. The only durable record of that order's DHL/DPD label/tracking URL is destroyed with zero actual cleanup achieved, and the cron's own stated goal (purging PII from Supabase) silently fails to do anything for every DHL/DPD shipment it processes.

**Bug B — non-transactional ordering risk for InPost/GLS.** For the carriers where `labelUrl` genuinely is a Supabase path, the delete-then-null sequence (`:380-384`) is two independent, unguarded calls, not one transaction. A process kill between them (Railway redeploy, OOM, the 8s graceful-shutdown budget expiring mid-loop over what can be hundreds of stale rows) leaves the Supabase object gone but `Shipment.labelUrl` still pointing at it. The next `getLabel()` call for that order calls `getShippingLabelSignedUrl()` on a path that 404s in Supabase, which throws a bare, uncaught `Error` (`storage.service.ts:86`) — surfacing as a raw 500 instead of a clean "no label" response.

**Trigger:** Bug A fires deterministically for any cancelled/refunded DHL or DPD order whose label is 30+ days old — the very next Monday 03:00 run. Bug B requires a crash in a narrow window during the cron's loop, affecting only InPost/GLS rows in that batch.

**Fix:** Add the same `isCarrierHostedUrl()` check the cron's sibling `getLabel()` already uses — `if (!shipment.labelUrl || shipment.labelUrl.startsWith('mock-label-') || isCarrierHostedUrl(shipment.labelUrl)) continue;` (carrier-hosted PII retention is the carrier's own policy, not this cron's concern). For the remaining Supabase-path case, null the DB column only after confirming the Supabase delete succeeded, and treat a subsequent 404 on signed-URL generation as equivalent to "already deleted" rather than throwing.

---

## 🟡 MEDIUM — `deleteAddress` re-promotes a new default address with an unguarded, non-transactional read-then-write — unlike its already-fixed siblings `createAddress`/`updateAddress`

**Classification:** Bug
**Files:** `backend/src/modules/users/users.service.ts:91-111` (`deleteAddress`), contrast with the same file's `createAddress`/`updateAddress` (now using a single atomic raw-SQL `UPDATE ... SET "isDefault" = ("id" = $1)` inside a transaction, backed by the partial unique index `addresses_one_default_per_user`)

`createAddress`/`updateAddress` were fixed (per the exclusion list) to flip the default flag atomically. `deleteAddress` was never brought in line: it runs `findFirst` → `delete` → `findFirst` → `update` as four sequential, unguarded statements with no transaction. The partial unique index backstops only "two rows can't both be `true` simultaneously" — it does nothing to stop the *wrong* row from winning a race between `deleteAddress`'s re-promotion and a concurrent `updateAddress` call explicitly setting a different address as default.

**Trigger:** User has addresses A (default) and B. One tab calls `PATCH /addresses/B {isDefault:true}` while another concurrently calls `DELETE /addresses/A`. Depending on commit order, `deleteAddress`'s `findFirst({ orderBy: { createdAt: 'desc' } })`-then-`update` can silently overwrite the user's just-made explicit choice with whichever row it independently picked, with no error surfaced to either request.

**Fix:** Wrap `deleteAddress`'s delete + re-promotion in a transaction, and replace the separate `findFirst`/`update` pair with the same atomic single-statement pattern `createAddress`/`updateAddress` already use, so concurrent default-touching mutations for the same user serialize through Postgres row locking instead of racing on uncoordinated reads.

---

## 🟡 MEDIUM — AdminJS `Review`'s plain Edit action has no field whitelist, unlike its siblings `ReturnRequest`/`CustomerNote` — `status`/`rating`/`productId` are directly editable and bypass `updateReviewStats()`

**Classification:** Bug
**Files:** `backend/src/modules/admin/admin.setup.ts:867` (`ReturnRequest`: `editProperties: ['adminNote']`), `:952` (`CustomerNote`: `editProperties: ['userId', 'body', 'adminEmail']`) — both whitelist editable fields at the resource level — vs. `:967-994` (`Review`'s `options` block has **no `editProperties` key at all**; only per-field `isVisible.edit: false` overrides exist for `body`, `userId`, `orderId`, `helpfulCount`)

AdminJS's default behavior makes every model field editable unless explicitly restricted. Because `Review` has no `editProperties` whitelist, and `status`/`rating`/`productId` have no `isVisible: { edit: false }` override either, all three remain directly editable through the plain "Edit" form — none of which route through `updateReviewStats(prisma, review.productId)`, which only the dedicated `approve`/`reject`/`bulkApprove` actions call. The inline comment at `:992` ("Limit editable fields to adminReply only") states the intent, but the action's `after` hook (`:993`) is a no-op pass-through (`async (response) => response`) — it documents the intent without enforcing it.

**Trigger:** Admin opens a review's plain Edit form (not the dedicated Approve/Reject action) and changes `rating` from 2★ to 5★, or reassigns `productId`. `Product.avgRating`/`reviewCount` for the affected product(s) silently desync from the actual approved-review aggregate until some unrelated action happens to recompute it.

**Fix:** Add `editProperties: ['adminReply']` to the `Review` resource options, matching the pattern `ReturnRequest`/`CustomerNote` already use.

---

## 🟢 LOW — AdminJS "Generuj etykietę" button is visible (and clickable, but always fails) on `SHIPPED` orders

**Classification:** Bug
**Files:** `backend/src/modules/admin/admin.setup.ts:521-524` (`generateLabel.isVisible` excludes `PENDING_PAYMENT`, `CANCELLED`, `REFUNDED`, `DELIVERED` — `SHIPPED` is absent) vs. `backend/src/modules/shipping/shipping.service.ts:88-91` (`generateLabel()`'s actual guard only allows `OrderStatus.PAID`/`PROCESSING`)

By the time an order reaches `SHIPPED`, its `Shipment.status` has already progressed past `LABEL_GENERATED` (to `IN_TRANSIT` or later), so the handler's "already generated, redirect to existing label" early-return doesn't apply — the button instead calls `shippingService.generateLabel()`, which throws `BadRequestException` for any status outside `[PAID, PROCESSING]`. The action is caught and surfaced as an AdminJS error notice, so there's no data corruption — just a confusing dead button on every shipped order.

**Trigger:** Admin viewing a `SHIPPED` order's detail page clicks "Generuj etykietę" out of habit or confusion — it always errors.

**Fix:** Add `'SHIPPED'` to the `isVisible` exclusion list, matching the actual allowed-status guard.

---

## Notes — verified clean

**Identity & Admin** — JWT dual-key rotation (`JWT_ACCESS_SECRET_PREV`), `requestEmailChange`/`changePassword`/`resetPassword`'s consistent token-revocation calls, `register()`/`findOrCreateGoogleUser()`'s now-uniform P2002→409 handling, `createAddress`/`updateAddress`'s atomic default-flip, frontend multi-tab logout via `BroadcastChannel`, `refresh$`'s `shareReplay({refCount:false})` fix, AdminJS's session-fixation guard and the `/admin/picklist`/`/admin/fulfillment-gap` routes' session-key fix, `ChangeEmailDto` now requiring `currentPassword`, OAuth `state`/nonce handling, and `authGuard`/`guestGuard` were all re-verified correct and not regressed. JWT's intentional Redis-outage fail-open behavior was confirmed as the documented tradeoff, not re-flagged.

**Shipping & Storage** — `generateLabel()`'s distributed lock and LABEL_ERROR resume-by-`shipmentId` logic, `StorageService.uploadWithRetry()` now shared uniformly across product images/labels/invoices, `ShippingRatesService`'s cache CAS fix and in-transaction rate lookup, all four carrier clients' 15s HTTP timeouts and `assertTrackingNumber` guard, GLS's `parcelId`→`shipmentId` persistence fix, AdminJS's `/admin/picklist`/`/admin/fulfillment-gap` session guard, and the DPD/InPost frontend widget listener cleanups were all re-verified correct and not regressed. The originally-reported `GLS_SANDBOX`-unused-env-var claim was checked and found to be inaccurate (no such variable exists in `.env.example`) and is excluded from this report.

---

This round's findings, once resolved, should be folded into `docs/audit-exclusion-list.md` per its own maintenance instructions.
