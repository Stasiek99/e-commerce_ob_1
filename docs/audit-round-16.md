# E-Commerce Audit — Round 16
*Generated: 2026-06-19 — 6-agent stochastic consensus*
*Agents: Domain Expert (Identity & Admin) · Skeptic (Identity & Admin, fix-completeness verification) · Risk Analyst (Identity & Admin, concurrency) · Domain Expert (Shipping & Storage) · Skeptic (Shipping & Storage, cross-carrier symmetry) · Risk Analyst (Shipping & Storage, concurrency/failure modes)*

> **Excludes** everything already in `docs/audit-exclusion-list.md` (~340 prior findings across rounds 1-15).
> **Excludes** settled tradeoffs in `docs/accepted-tradeoffs.md`.
> **Scope:** Identity & Admin (auth, users, admin/AdminJS + auth/account frontend) and Shipping & Storage (shipping, carriers, storage + checkout's carrier-selection/DPD-picker UI) only. Payments, orders, cart, coupons, returns, invoices, products/catalog were explicitly out of scope this round — these two domains hadn't had dedicated audit attention since round 13 (shipping) and earlier (auth/admin), making them the highest-yield targets.

All three findings claiming a fix was "complete" got independently re-verified by a second agent reading the same code from a different angle — and twice that re-verification surfaced a real gap the first pass missed: the Shipping Domain Expert and Skeptic, working separately, both traced the same `getLabel()`/AdminJS label-URL mismatch from opposite directions (one found DHL/DPD breaks `getLabel()`, the other found the *inverse* — InPost/GLS breaks AdminJS's own "already generated" branch) and converged on one root cause. The Identity Skeptic went a level deeper than "is this fixed" and actually read AdminJS's own session-handling source in `node_modules` to confirm the already-known wrong-session-key bug now also breaks the round-15 fix that was supposed to extend it — a distinct, previously-undocumented consequence. Three agents, working independently across the same checkout file, all converged on the same hardcoded shipping-price bug with no prompting toward it.

---
Done:

## 🔴 CRITICAL — `PATCH /users/me/email` requires no password or re-authentication — a stolen access token is a permanent account-takeover primitive
**Classification:** Bug
**Files:** `backend/src/modules/auth/auth.service.ts:300-339` (`requestEmailChange`), `backend/src/modules/users/users.controller.ts:68-73` (`changeEmail`), `backend/src/modules/users/dto/change-email.dto.ts`

`ChangeEmailDto` validates only `{ email }` (`@IsEmail`, `@IsNotEmpty`) — no `currentPassword` field exists. `UsersController.changeEmail()` passes nothing else through. Contrast with the sibling endpoint one line below it: `changePassword(user.id, dto.currentPassword, dto.newPassword)` (`users.controller.ts:78-79`) requires `currentPassword` and `auth.service.ts:477` verifies it with `bcrypt.compare` before proceeding. `requestEmailChange` has no equivalent check — any request carrying a valid access token can redirect the account's email to an attacker-controlled address. Worse, `requestEmailChange` itself revokes the user's other tokens at the end (line ~330s), so the legitimate owner is locked out at the exact moment the attacker gains control of `pendingEmail`. Once the attacker clicks the verification link sent to their own inbox, `verifyEmail()` promotes `pendingEmail → email`, and the account is now permanently keyed to an address the real owner doesn't control — blocking even password-reset recovery.

**Trigger:** Attacker obtains a live access token (XSS, shared/public device, leaked token — any 15-minute window) → `PATCH /users/me/email { "email": "attacker@evil.com" }` → verification link lands in attacker's inbox → attacker clicks it → account email permanently changed, real owner's other sessions already revoked.

Note: there is currently no frontend UI calling either `/users/me/email` or `/users/me/password` (both are reachable only by direct API call) — this reduces accidental exposure but does not change that the endpoint is live, documented, throttled, and trivially reachable with any HTTP client.

**Fix:** Add `currentPassword` to `ChangeEmailDto`, verify via `bcrypt.compare` against `user.passwordHash` inside `requestEmailChange` before issuing the pending-email token — mirroring `changePassword` exactly. For Google-only accounts with no `passwordHash`, require a fresh re-auth signal instead (e.g. reject if the access token's `iat` exceeds a short re-auth window, or require re-running the Google OAuth flow).

---

## 🔴 CRITICAL — DHL/GLS/DPD credentials are unconditionally optional in boot validation, but their client constructors `getOrThrow` them — a production deploy without these vars crashes the entire backend, not just shipping
**Classification:** Bug
**Files:** `backend/src/config.validation.ts:154-165` (DHL/GLS entries; DPD has **no** entries at all), `backend/src/modules/shipping/carriers/dhl.client.ts:39-53`, `gls.client.ts:32-42`, `dpd.client.ts:31-41`, `backend/src/modules/shipping/shipping.module.ts:13` *(Domain Expert)*

`DhlClient`/`GlsClient`/`DpdClient` constructors call `configService.getOrThrow(...)` for their account/sender/API credentials whenever `mockEnabled` is false (`this.mockEnabled = configService.get('X_MOCK_ENABLED') === 'true'`). All four carrier clients are registered as eager providers in `ShippingModule` (confirmed: `providers: [..., InpostClient, DhlClient, GlsClient, DpdClient]`), so Nest's DI instantiates every one of them at bootstrap — there is no lazy-loading. `config.validation.ts` declares `DHL_ACCOUNT_NUMBER`/`DHL_API_KEY`/`DHL_API_SECRET` and `GLS_SENDER_ID`/`GLS_USERNAME`/`GLS_PASSWORD` as unconditional `Joi.string().optional()`, with **no** `Joi.when('NODE_ENV', ...)` gate — unlike `INPOST_ORGANIZATION_ID`/`INPOST_API_TOKEN`, which correctly require a value in production unless `INPOST_MOCK_ENABLED === 'true'` (lines 105-124). `DPD_SENDER_ID`/`DPD_API_KEY`/`DPD_MOCK_ENABLED` have **zero** entries in the validation schema — not even as optional. None of `DHL_MOCK_ENABLED`/`GLS_MOCK_ENABLED`/`DPD_MOCK_ENABLED` are declared either. `.env.example` doesn't define any of these mock flags at all (it uses an unrelated, unread `*_SANDBOX` naming convention instead), and CLAUDE.md's own Railway env var checklist and Phase 0 status explicitly describe DHL/GLS as "optional for Phase 0" — meaning a real deployment can easily exist today where these vars are simply never set in Railway. Joi boot validation passes cleanly in that state; the carrier constructor then throws moments later in the same bootstrap sequence, crashing the whole process — auth, checkout, payments, everything.

**Trigger:** Deploy to Railway with `DHL_MOCK_ENABLED`/`GLS_MOCK_ENABLED`/`DPD_MOCK_ENABLED` unset and the corresponding credential vars not yet provisioned — exactly the state CLAUDE.md describes as acceptable for the current phase. The backend never starts.

**Fix:** Mirror InPost's pattern for all three carriers: add `Joi.when('NODE_ENV', { is: 'production', then: Joi.when('<CARRIER>_MOCK_ENABLED', { is: 'true', then: optional, otherwise: required }) })` to `config.validation.ts`, and add the missing DPD entries entirely, so a missing credential fails loudly and specifically at boot instead of crashing via an unrelated `getOrThrow` stack trace deep in a carrier client.

---

## 🔴 CRITICAL — `getLabel()` and AdminJS's "label already exists" branch use opposite, mutually-incompatible heuristics for telling a Supabase-stored label apart from a carrier-hosted one — each breaks for the carriers the other doesn't handle
**Classification:** Bug
**Files:** `backend/src/modules/shipping/shipping.service.ts:254-266` (`getLabel`), `backend/src/modules/admin/admin.setup.ts:505-515` (AdminJS `generateLabel` "already exists" branch) *(Domain Expert + Skeptic, independently converged from opposite directions)*

For InPost/GLS, `generateLabel()` uploads the fetched PDF to Supabase and stores a bare **storage path** (e.g. `labels/inpost-XXX.pdf`) in `Shipment.labelUrl`. For DHL/DPD, neither client ever calls `uploadShippingLabel` — `labelUrl` is the carrier's own **external hosted URL**, taken straight from its API response. Two different consumers each assume only one shape:
- `getLabel()` checks `!labelUrl.startsWith('mock-label-')` and, if true, unconditionally calls `storage.getShippingLabelSignedUrl(labelUrl)` — i.e. assumes every non-mock value is a Supabase path. For DHL/DPD, this passes a full external `https://...` URL as a Supabase storage path; Supabase returns "object not found," and `getLabel()` throws — `GET /shipping/:orderId/label` 500s for **every** DHL/DPD order.
- AdminJS's "already generated" branch checks the opposite: `existing.labelUrl.startsWith('http')` — correct for DHL/DPD, but wrong for InPost/GLS, whose value (`labels/inpost-XXX.pdf`) doesn't start with `http` even though it's a real, successfully-generated private-bucket label. It falls into the `else` branch and tells the admin "Etykieta już wygenerowana (**tryb mock**)" — a genuinely real label permanently mislabeled as mock-only, with the admin never shown a working signed link to it again from this action.

**Trigger:** (a) Generate a real DHL/DPD label, then call `GET /shipping/:orderId/label` — 500s. (b) Generate a real InPost/GLS label, click "Generuj etykietę" again in AdminJS — reports "tryb mock" for a real label and never surfaces a working link.

**Fix:** Introduce one shared `isCarrierHostedUrl(labelUrl)` helper (`startsWith('http')`, checked before the `mock-label-` check) and use it consistently in both places — `getLabel()` should return an external URL as-is instead of trying to sign it; AdminJS's branch should call `shippingService.getLabel(orderId)` for a bare path instead of assuming mock mode.

---

## 🟠 HIGH — `/admin/picklist` and `/admin/fulfillment-gap` are permanently inaccessible to every legitimate admin — their own primary auth check uses a session key AdminJS never sets
**Classification:** Bug
**Files:** `backend/src/modules/admin/admin.setup.ts:38-50, 1110-1144` *(Skeptic — verified directly against `@adminjs/express`'s source)*

This codebase's AdminJS setup uses the plain `authenticate` callback (no `provider`), so `@adminjs/express`'s own `login.handler.js` sets `req.session.adminUser = adminUser` on successful login (confirmed directly in `node_modules/@adminjs+express@6.1.1/.../login.handler.js:96`, and its sibling `protected-routes.handler.js:4` checks the same key). The exclusion list already documents that `regenerateSessionOnLogin` checks the wrong key (`req.session?.passport?.user`, which nothing in this app ever sets — there's no Passport strategy registered for the admin panel) and is therefore inert as a session-fixation guard; that part is known and out of scope here. What's new: the two custom routes' **own primary authentication gate** — not just the regen-guard wrapping them — uses the identical wrong key:

```
expressApp.get('/admin/picklist', sessionMw, regenerateSessionOnLogin, async (req, res) => {
  if (!req.session?.passport?.user) return res.redirect('/admin/login');   // line 1115
  ...
```

Since `req.session.passport` is never populated by this app's actual login flow, this condition is **always true** — every request to `/admin/picklist` and `/admin/fulfillment-gap` redirects to `/admin/login`, including from a fully, correctly authenticated admin who just logged in seconds earlier. This is the opposite failure mode from the exclusion list's previously-documented dispatch-order bypass (too permissive); this is a total, permanent feature outage (too restrictive) introduced by the same wrong-key root cause being copied into new code. The existing unit test (`admin.setup.spec.ts`) can't catch this because it mocks the session as `{ passport: { user: ... } }`, matching the bug instead of AdminJS's real `{ adminUser: ... }` shape.

**Trigger:** Any admin, correctly logged in, navigates to `/admin/picklist` or `/admin/fulfillment-gap` — always redirected to login, with no way to ever reach either page short of a code fix.

**Fix:** Change all three occurrences of `req.session?.passport?.user` (lines 39, 1115, 1133) and the reassignment at line 43 to `req.session?.adminUser` / `req.session.adminUser = adminUser`, and update the test mocks to use the real `{ adminUser }` shape so it can no longer pass against the wrong key.

---

## 🟠 HIGH — Concurrent address default-flag writes are not atomic — two (or zero) addresses can end up `isDefault: true` *(Domain Expert + Risk Analyst, independently converged)*
**Classification:** Bug
**Files:** `backend/src/modules/users/users.service.ts:46-71` (`createAddress`, `updateAddress`)

Both methods implement "only one default address" as two separate, non-transactional Prisma calls: `updateMany({ userId, ... }, { isDefault: false })` to demote everyone else, then a second `create()`/`update()` to promote the target. Neither is wrapped in `prisma.$transaction`, and there is no DB-level partial-unique index (`Address` has no `@@unique` involving `isDefault`) to catch the result as a fallback. Two concurrent requests promoting *different* addresses can interleave so each one's "demote everyone else" step commits after the other's "promote me" step already did, leaving both targets `isDefault: true` simultaneously (or, with a different interleaving / a request erroring between steps, zero rows `true`).

**Trigger:** User has addresses A(default), B, C. Two tabs fire near-simultaneously: `PATCH /addresses/B {isDefault:true}` and `PATCH /addresses/C {isDefault:true}`. Interleaving: Req1 demotes A,C→false; Req2 demotes A,B→false; Req2 sets C→true; Req1 sets B→true. Final state: B **and** C both `true`. Checkout/order logic and the addresses page's "domyślny" badge become nondeterministic about which one is actually default.

**Fix:** Add a Postgres partial unique index — `CREATE UNIQUE INDEX addresses_one_default_per_user ON addresses (user_id) WHERE is_default = true` — and replace the demote-then-promote pair with a single atomic statement, e.g. `UPDATE addresses SET is_default = (id = $addressId) WHERE user_id = $userId` via `$executeRaw`, which is atomic as one statement and unaffected by this stack's pgbouncer transaction-mode limitations on `FOR UPDATE`/advisory locks.

---

## 🟠 HIGH — No lock on `generateLabel()` lets two concurrent requests for the same order both create a real shipment with the carrier — one becomes permanently untracked
**Classification:** Bug
**Files:** `backend/src/modules/shipping/shipping.service.ts:54-71` *(Risk Analyst)*

`generateLabel()` reads the existing `Shipment` row with no row lock, no transaction, and no Redis lock keyed on `orderId` (the only lock in this file guards an unrelated weekly cleanup cron). The duplicate-guard explicitly allows a retry past a `LABEL_ERROR` row. Two concurrent calls for the same order with no shipment (or a `LABEL_ERROR` one) both pass the guard and both call the carrier's real, billable `createShipment()`. The final `prisma.shipment.upsert` (keyed on `Shipment.orderId @unique`) only protects the **local row** — the second upsert silently overwrites the first's `shipmentId`/`trackingNumber`, leaving one of the two real carrier-side shipments with no local DB record at all, while still being dispatched and billed.

**Trigger:** Two admins (or one admin retrying a slow request they assume hung — carrier latency near the 15s axios timeout is a realistic trigger) call `POST /shipping/:orderId/label` for the same order within the race window.

**Fix:** Acquire a Redis `SET NX` lock keyed `label-gen-lock:${orderId}` (mirroring this codebase's existing `checkout-lock`/`cancel-lock` pattern) at the top of `generateLabel`, released in a `finally`, before the existing-shipment check runs.

---

## 🟠 HIGH — Retrying after `LABEL_ERROR` (whether via an explicit retry or a lost-but-processed carrier response) re-issues `createShipment()` with no idempotency key or check against an already-recorded `shipmentId`
**Classification:** Bug
**Files:** `backend/src/modules/shipping/shipping.service.ts:54-71, 90-185`; `carriers/inpost.client.ts:91-102`, `dhl.client.ts:116-124`, `gls.client.ts:75-83`, `dpd.client.ts:76-84` *(Domain Expert + Risk Analyst, independently converged on the same root mechanism from two different triggers)*

`generateLabel()`'s only guard against re-running is `existing.status !== LABEL_ERROR` — once in that state (e.g. the carrier call succeeded and a real `shipmentId`/`trackingNumber` was issued, but the subsequent Supabase upload failed after all retries), the function is fully re-entrant: it unconditionally calls `createShipment()` again, never checking whether `existing.shipmentId` is already populated. None of the four carrier clients attach any idempotency/request key to their payload either, so the same failure mode is reachable without an explicit retry at all: a network timeout where the carrier actually received and processed the request, but the HTTP response was lost, leaves the local row in `LABEL_ERROR` with no `shipmentId` recorded — the next `generateLabel()` call (manual retry) resubmits an identical payload the carrier has no way to recognize as a duplicate. Either path creates a second real, billable, dispatchable shipment with the carrier; the DB upsert silently overwrites the first reference, orphaning it.

**Trigger:** Admin generates an InPost label; the carrier call succeeds (real tracking number, locker reservation made) but a transient Supabase outage fails the upload after all retries, leaving `LABEL_ERROR` with `shipmentId` preserved. Admin retries once Supabase recovers — `generateLabel()` calls `createShipment()` again, creating a second InPost shipment/reservation under the same order.

**Fix:** On a `LABEL_ERROR` retry, check `existing.shipmentId` first; if populated, skip `createShipment()` entirely and resume from the label-fetch/upload step using the preserved identifier. Only call `createShipment()` again if no `shipmentId` was ever recorded. Where the carrier API supports it, also attach a stable per-order idempotency key to the creation payload itself.

---

## 🟠 HIGH — Deactivating a shipping rate has no effect on whether the carrier can still be selected and charged
**Classification:** Bug
**Files:** `backend/src/modules/shipping/shipping-rates.service.ts:11-61` *(Domain Expert)*

`getRateMap()` seeds its return value from `FALLBACK_RATES`, which always defines a price for all 5 `CarrierCode` values, then overwrites entries only for rows where `isActive: true`. Setting a carrier's `isActive` to `false` simply excludes its row from the active set — its key in the returned map is **never deleted**, so it silently keeps (or falls back to) the previous/fallback price. `getRateForCarrier()` — called authoritatively by order creation to price and validate the order server-side — exhibits the identical behavior: it still returns a valid price for a carrier the admin explicitly disabled.

**Trigger:** Admin disables DHL (e.g. credentials revoked, carrier suspended) via `isActive: false`. `GET /shipping/rates` still lists DHL with its last price; a customer selects and pays for DHL shipping; the order is created successfully. The only failure surfaces later at label generation, by which point payment has already been captured.

**Fix:** After building the map from active rows, explicitly delete/omit keys for any carrier absent from the active set, so a deactivated carrier disappears from `/shipping/rates` and `getRateForCarrier()` throws instead of silently substituting a stale price.

---

## 🟠 HIGH — Checkout's displayed shipping price is a hardcoded frontend constant that never reflects an admin's live rate changes *(Risk Analyst + Domain Expert + Skeptic — three independent agents converged on the same file)*
**Classification:** Bug
**Files:** `frontend/src/app/features/checkout/checkout-page/checkout-page.component.ts:42-48` (`CARRIERS`), `:689` (`effectiveTotal`), `:425` (rendered total)

`CARRIERS` is a module-level array with hardcoded `price` fields (1499/1599/1699/1999/1799) duplicating `ShippingRatesService.FALLBACK_RATES`. The component never calls `GET /shipping/rates` — the endpoint already exists, is `@Public()`, and already returns the live, admin-editable DB price — confirmed by three independent full-file searches finding zero reference to it anywhere in the component. `effectiveTotal()` (the pre-payment total shown throughout checkout, explicitly commented elsewhere in the file as serving Art. 8 UoUP pre-contractual price disclosure) is computed purely from this hardcoded array. The actual order/payment total remains correctly authoritative server-side (`orders.service.ts` reads the live rate inside its transaction), so this isn't an overcharge/undercharge risk — but the price the customer is *shown* throughout carrier selection and the order summary can silently diverge from what they're actually charged the instant an admin edits a rate, with no mechanism to ever reconcile the two short of a frontend redeploy.

**Trigger:** Admin raises DHL's price via `PATCH /shipping/admin/rates/DHL`. Every customer's checkout continues showing the old price through carrier selection and the summary; the Stripe Checkout Session is then built server-side with the new, different price — a "shown one price, charged another" complaint, and the kind of price-transparency inconsistency the file's own UoK-citing comment elsewhere was written to avoid.

**Fix:** Fetch `GET /shipping/rates` on checkout-step entry and populate `CARRIERS`' `price` field from the response, keeping the hardcoded array only as an offline last-resort fallback — mirroring the backend's own static-metadata-vs-DB-price separation.

---

## 🟡 MEDIUM — `verifyEmail`'s email-change branch lacks the atomic `usedAt: null` guard its sibling token-consumption flows already use, allowing a stale `pendingEmail` to be silently confirmed
**Classification:** Bug
**Files:** `backend/src/modules/auth/auth.service.ts:341-407` (`verifyEmail`), contrast with `:545-563` (`consumeMagicLink`), `:247-264` (`rotateToken`) *(Risk Analyst)*

`consumeMagicLink`/`rotateToken` were hardened to use `tx.X.updateMany({ where: { id, usedAt/revokedAt: null }, ... })` specifically so a second concurrent caller sees `count === 0` and is rejected. `verifyEmail`'s email-change transaction instead does a plain `update({ where: { id: stored.id } })` with no re-check that `usedAt` is still `null` at write time, and `stored.user.pendingEmail` is captured well before the transaction commits.

**Trigger:** User requests an email change to `a@new.com`, then immediately requests a second change to `b@new.com` before clicking the first link. If the first link is clicked while `requestEmailChange`'s own invalidating `updateMany` is still in flight, `verifyEmail`'s earlier `findUnique` read can win the race and confirm the superseded `a@new.com` — the very value the user tried to overwrite — with no conflict surfaced.

**Fix:** Mirror `consumeMagicLink`'s pattern: replace the plain `update` with `tx.emailVerificationToken.updateMany({ where: { id: stored.id, usedAt: null }, data: { usedAt: new Date() } })` inside an interactive transaction, checking `result.count === 0` and throwing before proceeding.

---

## 🟡 MEDIUM — Concurrent registration / first-time Google sign-in race to an unhandled `P2002`, surfacing as a raw 500 instead of a clean 409
**Classification:** Bug
**Files:** `backend/src/modules/auth/auth.service.ts:60-76` (`register`), `:128-160` (`findOrCreateGoogleUser`) *(Risk Analyst)*

Both functions do a TOCTOU check-then-create (`findByEmail`/`findByGoogleId` → throw if found, else `create()`). `User.email`/`User.googleId` both carry DB-level `@unique`, but neither call path catches `PrismaClientKnownRequestError` code `P2002` — the registered exception filter only catches connection-pool errors. Other modules (products, payments, reviews, coupons) already catch `P2002` explicitly at their own call sites; auth never adopted the pattern.

**Trigger:** Double-submit of the registration form from a second tab, a retried request on a flaky connection, or a script hitting the API directly with the same email — both requests pass the existence check before either `create()` commits; the loser's unhandled `P2002` becomes a generic 500. Same mechanism for two concurrent first-time Google OAuth callbacks for a never-seen email.

**Fix:** Wrap both `create()` calls in a try/catch that maps `P2002` to `ConflictException`, matching the existing pattern in `products.service.ts`/`payments.service.ts`/`reviews.service.ts`/`coupon.service.ts`.

---

## 🟡 MEDIUM — Access-token revocation fence TTL is a hardcoded literal, silently drifts from the configurable `JWT_ACCESS_EXPIRES_IN`
**Classification:** Bug
**Files:** `backend/src/modules/auth/auth.service.ts:33` (`REVOKE_BEFORE_TTL_SECS = 900`), `:592-599` (`revokeAccessTokensForUser`), `backend/src/config.validation.ts:37` *(Domain Expert)*

`revokeAccessTokensForUser` — called by `logout`/`changePassword`/`resetPassword`/`requestEmailChange` to fence off all previously-issued access tokens — writes its Redis key with a hardcoded 900-second TTL, commented as "matches the access token lifetime so the entry self-expires." The actual lifetime is `JWT_ACCESS_EXPIRES_IN` (default `15m`, operator-configurable to any value, validated only as `Joi.string()` with no upper bound and no cross-check against this constant). The sibling function `revokeAccessTokenJti(jti, ttlSecs)` already takes TTL as an explicit parameter, showing the correct pattern exists right next to the broken one.

**Trigger:** Operator bumps `JWT_ACCESS_EXPIRES_IN` to `1h` in Railway for UX reasons, no code change. From then on, any revocation fence set by `logout`/`changePassword`/`resetPassword`/`requestEmailChange` expires after 15 minutes even though tokens it was meant to block remain valid for up to an hour — a window where a token that should be revoked (e.g. after a password reset following compromise) is honored again.

**Fix:** Derive `REVOKE_BEFORE_TTL_SECS` from the same config the JWT module reads, or add a boot-time assertion that fails fast if `JWT_ACCESS_EXPIRES_IN` would ever exceed the hardcoded fence TTL.

---

## 🟡 MEDIUM — Shipping-rate cache read-repopulate path can race an admin's invalidate-on-write, serving a stale price for up to 5 minutes even on a single replica
**Classification:** Bug
**Files:** `backend/src/modules/shipping/shipping-rates.service.ts:28-61, 74-108` *(Risk Analyst)*

`getRateMap()` on a cache miss reads Postgres then writes the result back to Redis with a 5-minute TTL, with no version check or compare-and-set guard. `updateRate()` writes the new price, then issues a plain `DEL`. If a `getRateMap()` read executes concurrently with an admin's update + invalidate, the read path's *subsequent* `SET` can land after the admin's `DEL`, repopulating the cache with the stale pre-update price — serving it for up to the full TTL. This is distinct from the already-excluded cross-replica cache-sharing gap: it reproduces on a single replica with one Redis instance.

**Trigger:** Admin updates a rate at the same moment the cache happens to expire and a concurrent customer request triggers repopulation — realistic during business hours when rate edits and live traffic overlap.

**Fix:** Have `updateRate()` directly `SET` the freshly computed map into Redis as part of the same call instead of `DEL`-ing it, making the admin's write the sole source of truth for that key until natural expiry — eliminating the read-repopulate race entirely.

---

## 🟡 MEDIUM — GLS's carrier-side parcel identifier is never persisted to `Shipment.shipmentId`, unlike InPost's structurally identical field
**Classification:** Bug
**Files:** `backend/src/modules/shipping/shipping.service.ts:92-116` (InPost branch) vs. `:136-164` (GLS branch) *(Skeptic)*

InPost's branch assigns `shipmentId = result.id` into the shared variable both the success and `LABEL_ERROR` upserts persist to the dedicated `Shipment.shipmentId` column — added specifically (per its own commit message) so a support engineer can locate the shipment on the carrier's dashboard without parsing JSON. GLS's branch uses `result.parcelId` only transiently inline (required by `fetchLabelPdf`) but never assigns it to `shipmentId`. The value survives inside `rawCarrierResponse` JSON, but is unavailable to any query/admin view filtering on the dedicated column — the exact gap InPost's fix was written to close, left open for GLS.

**Fix:** Add `shipmentId = result.parcelId;` immediately after `createShipment()` resolves in the GLS branch, mirroring InPost.

---

## 🟡 MEDIUM — `StorageService`'s upload retry-with-backoff exists only for shipping labels, not product images or invoices
**Classification:** Bug
**Files:** `backend/src/modules/storage/storage.service.ts:20-47, 52-65, 83-93, 104-107` *(Domain Expert)*

`uploadShippingLabel` retries up to 3 times with exponential backoff on a transient Supabase failure. `uploadProductImage` and `uploadInvoice` each make a single unretried call and throw immediately — the same class of transient failure self-heals for labels but fails permanently on the first attempt for images/invoices, an inconsistent reliability posture for mechanically the same Supabase `.upload()` call within one service.

**Fix:** Extract the retry-with-backoff loop into a shared private helper and use it for all upload call sites in this file, not just `uploadShippingLabel`.

---

## 🟢 LOW — Frontend Google OAuth "state" CSRF token is generated and stored but never transmitted to or validated by the backend — a non-functional, purely cosmetic check *(Domain Expert + Skeptic, independently converged)*
**Classification:** Bug
**Files:** `frontend/src/app/core/services/auth.service.ts:79-85`, `frontend/src/app/features/auth/google-callback/google-callback.component.ts:16-25`

`loginWithGoogle()` generates a random `state`, stores it in `sessionStorage`, but never appends it to the redirect URL or sends it to the backend in any form. The backend's real CSRF protection is Passport's own independent `state: true` on `GoogleStrategy`, validated entirely server-side with no relationship to the frontend value. `google-callback.component.ts` only checks the stored value for *truthiness*, never compares it against anything echoed back — because nothing is ever echoed back. Not independently exploitable today (the backend's real protection is sound and unrelated), but the code reads as a security control that isn't one, risking a future refactor that mistakenly relies on it and removes the backend's actual `state: true`.

**Fix:** Either remove the dead frontend mechanism entirely, or wire it correctly — append it as a query param Google round-trips, have the backend echo it back, and have the callback component compare by equality rather than presence.

---

## 🟢 LOW — Google OAuth account-hijack rejection surfaces as a bare, unstyled 401 instead of a frontend-redirected error
**Classification:** Bug
**Files:** `backend/src/modules/auth/strategies/google.strategy.ts:22-42`, `auth.controller.ts:186-208` *(Domain Expert)*

When `findOrCreateGoogleUser` correctly throws `ConflictException` for an email that already has a password account, the rejection happens inside Passport's strategy callback, which the default `AuthGuard` surfaces as a bare JSON 401 directly from `/auth/google/callback` — a route whose only other code path is `res.redirect()` to the frontend. The user's browser, mid-redirect-chain, lands on raw JSON instead of being bounced back into the app with a readable message.

**Fix:** Override `handleRequest` in `GoogleAuthGuard` (or catch at the controller level) to redirect to a frontend error route instead of letting the default 401 render.

---

## 🟢 LOW — Google OAuth account-hijack rejection surfaces as a bare, unstyled 401 instead of a frontend-redirected error
**Classification:** Bug
**Files:** `backend/src/modules/auth/strategies/google.strategy.ts:22-42`, `auth.controller.ts:186-208` *(Domain Expert)*

When `findOrCreateGoogleUser` correctly throws `ConflictException` for an email that already has a password account, the rejection happens inside Passport's strategy callback, which the default `AuthGuard` surfaces as a bare JSON 401 directly from `/auth/google/callback` — a route whose only other code path is `res.redirect()` to the frontend. The user's browser, mid-redirect-chain, lands on raw JSON instead of being bounced back into the app with a readable message.

**Fix:** Override `handleRequest` in `GoogleAuthGuard` (or catch at the controller level) to redirect to a frontend error route instead of letting the default 401 render.

---

## 🟢 LOW — `register.component.ts`'s `returnTo` skips the open-redirect guard its sibling auth components both apply
**Classification:** Bug
**Files:** `frontend/src/app/features/auth/register/register.component.ts:79, 106` *(Skeptic)*

`login.component.ts` and `google-callback.component.ts` both validate `returnTo` with `startsWith('/') && !startsWith('//')` before navigating. `register.component.ts` reads the identical query param with no validation and passes it straight to `router.navigateByUrl()`. Real-world impact is limited since Angular's `navigateByUrl` resolves through its own internal route tree rather than an actual cross-origin redirect, but it's a genuine, evidence-based inconsistency against the pattern its siblings establish.

**Fix:** Apply the same guard used in `login.component.ts`/`google-callback.component.ts`.

---

## 🟢 LOW — DPD pickup-point modal's `window` message listener is never cleaned up if the component is destroyed while the modal is open *(Risk Analyst + Domain Expert, independently converged)*
**Classification:** Bug
**Files:** `frontend/src/app/features/checkout/checkout-page/checkout-page.component.ts:959-983`

`openDpdPicker()` registers a `window`-level `message` listener, removed only by `closeDpdModal()`. The component has no `ngOnDestroy`, so navigating away (back button, header link, an auth-guard redirect) while the modal is open leaves the listener permanently attached, accumulating one stale listener per abandoned session for the remainder of the SPA's lifetime.

**Fix:** Wire cleanup via `this.destroyRef.onDestroy(() => this.closeDpdModal())`, or replace manual `addEventListener`/`removeEventListener` with a `fromEvent(window, 'message')` subscription managed by `takeUntilDestroyed`.

---

## 🟢 LOW — Carrier `trackingNumber` parsing has no validation across all four clients — a malformed upstream response ships a dead tracking link instead of failing loudly
**Classification:** Bug
**Files:** `dhl.client.ts:131`, `dpd.client.ts:90`, `gls.client.ts:89`, `inpost.client.ts:109` *(Skeptic)*

None of the four clients validate that the carrier actually returned a usable tracking number; GLS/DPD fall back to `''`, DHL/InPost have no fallback (`undefined`). A malformed/changed carrier response shape silently produces `LABEL_GENERATED` with a broken tracking link emailed to the customer rather than a loud failure. Symmetric across all four carriers (no sibling-miss), and requires a genuinely malformed upstream response to trigger — noted for completeness rather than as a strong finding.

**Fix:** Add a shared guard in `shipping.service.ts` that throws if `trackingNumber` is falsy immediately after each `createShipment()` call, before persisting `LABEL_GENERATED`.

---

## Notes — verified clean

**Identity & Admin** — all three agents independently re-verified prior rounds' fixes:
- Refresh-token rotation/reuse-detection (`rotateToken`, `refresh()`) — atomic `updateMany({ revokedAt: null })` guard correctly prevents the previously-fixed two-tabs-splits-the-family bug; reuse-outside-grace-window correctly triggers family-wide revocation.
- `consumeMagicLink` — atomic `updateMany({ usedAt: null })` guard correctly prevents replay.
- `logout`/`changePassword`/`resetPassword`/`requestEmailChange` all correctly call `revokeAccessTokensForUser`, closing the previously-listed "access token survives logout" gap for all four call sites (the email-change endpoint's *missing password check*, above, is a different, new defect in the same function).
- Multi-tab logout via `BroadcastChannel` — confirmed working, previously-listed gap closed.
- `findOrCreateGoogleUser`'s account-hijack guard — correctly blocks a Google identity from silently taking over a password account.
- AdminJS: `User`/`Address` resources have no admin-side mutation surface at all (`new`/`edit`/`delete` disabled or read-only) — no identity-mutation race possible via the panel; `buildAdminAuthenticator`'s constant-time dummy-hash comparison correctly prevents email-enumeration timing attacks.
- `deleteAccount`'s GDPR scrub — `snapshotStreet`/`City`/`PostalCode` confirmed nulled alongside name/email/phone/nip; previously-listed gap closed.
- `authGuard`/`guestGuard`/`errorInterceptor` — `returnTo` preserved and validated, guest guard applied to login/register, 429 handling with localized toast — all consistent with already-fixed exclusion-list items.
- JWT dual-key rotation and per-jti blocklist — implemented correctly; Redis-outage fail-open behavior matches the documented accepted tradeoff exactly, no new code path assumes the revocation fence is authoritative.

**Shipping & Storage** — all three agents independently re-verified prior rounds' fixes:
- Mock-mode flag detection is symmetric and correct (strict `=== 'true'`, no OR-fallback) across all four carriers — the previously-listed "InPost fixed, DHL/GLS/DPD never patched" gap is fully closed (note: this doesn't extend to the boot-validation gap above, a different mechanism).
- HTTP timeouts (15s, mapped to `ServiceUnavailableException`) present and symmetric across all four carrier clients.
- GLS real-mode label fetch, DHL shipper-address config-driven sourcing, `generateLabel`'s order-status guard, the cross-replica Redis-backed rate cache, DPD's `postMessage` origin check, and the stale-label-cleanup cron's distributed lock were all independently re-traced and confirmed complete and not regressed.
- Partial-failure carrier-identifier preservation (InPost/GLS keep `shipmentId`/`trackingNumber` when the *upload* step fails) and the Supabase upload retry-with-backoff for labels specifically — both confirmed correct via source and existing regression tests.
- Image-file-filter magic-byte validation — confirmed no TOCTOU gap (same in-memory buffer used for validation and upload, no trust placed in client-supplied filename/MIME).
- Product-images bucket RLS — confirmed correctly public-read/service-role-write by design, not a defect (this bucket is meant to be public, unlike the labels/invoices buckets).

---

This round's findings, once resolved, should be folded into `docs/audit-exclusion-list.md` per its own maintenance instructions.
