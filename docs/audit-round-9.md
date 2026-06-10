# E-Commerce Audit — Round 9
*Generated: 2026-06-08 — 5-agent stochastic consensus*
*Agents: EAA/Accessibility Expert · Payment Logic Devil's Advocate · Angular Reactivity Analyst · Supply-Chain/Build Inspector · Polish Law First-Principles Analyst*

> **Excludes** everything already in `audit-weak-points.md`, `audit-round-2.md`, `audit-round-3.md`, `audit-round-4.md`, `audit-round-5.md`, `audit-round-6.md`, `audit-round-7.md`, `audit-round-8.md`, and `project-gaps-audit.md`.
> **Excludes** Phase 7 (pre-launch checklist) items in ROADMAP.md.

Done:

## 🔴 CRITICAL — All 37 Prisma migration files are gitignored — `prisma migrate deploy` is a no-op on Railway *(Supply-Chain agent)*

**File:** `.gitignore:38`

```
backend/prisma/migrations/
```

The `.gitignore` blanket-ignores the entire migrations directory. Every migration file (including `migration_lock.toml`) exists only on the developer's local machine and is never committed to git.

**Cascade on Railway:** `railway.json` runs `prisma migrate deploy` as the `preDeployCommand`. On any fresh Railway deployment (new service, environment reset, team handoff), `migrate deploy` finds zero migration files and exits successfully — Prisma treats "no migrations to run" as success, not as an error. The deployed database schema then diverges silently from the Prisma client: `FRAUD_REVIEW`, `DISPUTE_HOLD`, the `outbox_messages` table, custom indexes, sequences, FK constraints, and every other post-baseline change is absent from the DB while the compiled NestJS binary expects them. First request that touches any of those constructs throws a `PrismaClientUnknownRequestError`.

Prisma's own docs explicitly state: *"You should commit your migration files to source control."* The `migration_lock.toml` comment reads the same instruction.

**Fix:** Remove `backend/prisma/migrations/` from `.gitignore` and commit all existing migration files. The line `backend/prisma/migrations/` must be deleted entirely from `.gitignore`.

---

## 🔴 CRITICAL — No idempotency key on `stripe.checkout.sessions.create` — LB retry creates two sessions per order *(Payment Logic agent · confirmed)*

**File:** `backend/src/modules/payments/stripe.client.ts:76`

`this.stripe.checkout.sessions.create({...})` has no `idempotencyKey` option. Railway's load balancer retries POST requests on 502/503/timeout. On any network-level retry, Stripe receives two `sessions.create` calls and creates two distinct Checkout Sessions for the same order.

**Cascade:**
- Both sessions carry `metadata.orderId`. The second response overwrites `payment.stripeCheckoutSessionId`. The first session URL was never shown to the customer; it expires silently in 30 minutes.
- If the order had a discount, `coupons.create` (line 66, also missing an idempotency key) runs twice — two Stripe coupon objects are created. The orphaned coupon's `deleteCoupon` path is never triggered because no payment row references its ID.
- Orphaned coupon objects accumulate indefinitely in the Stripe account.

**Fix:** Thread a stable `paymentId` through `CreateCheckoutSessionInput` and pass:
```typescript
{ idempotencyKey: `checkout-${paymentId}` }
```
as the second argument to `sessions.create`. Pass `{ idempotencyKey: `coupon-${paymentId}` }` to `coupons.create`.

## 🔴 CRITICAL — EU Accessibility Act 2025 (EAA) — No skip-navigation link — WCAG 2.4.1 failure *(EAA agent)*

**File:** `frontend/src/app/app.component.ts:20–27`

The EU Accessibility Act (Directive 2019/882) has applied to e-commerce since **June 28, 2025**. Polish transposition: ustawa o dostępności cyfrowej. Non-compliance is subject to UDT fines up to PLN 100,000 plus civil claims. **This store launched after the EAA effective date.**

There is no skip-navigation link. Keyboard-only users must Tab through the entire announcement banner + header (8+ focusable elements: logo, "Produkty" dropdown, search form, autocomplete, 3 action icons, hamburger) on every single page before reaching any content. This is a hard WCAG 2.4.1 (Bypass Blocks) failure — Annex I, Section I of the EAA.

**Fix:** Add as the first child of the app shell:
```html
<a href="#main-content" class="skip-link">Przejdź do treści</a>
```
Add `id="main-content"` to `<main>`. Style `.skip-link` to be visually hidden until focused (absolute, top: -100%, shown on `:focus`).

---

## 🔴 CRITICAL — EAA/WCAG 2.4.2 — No unique `<title>` per route; `TitleStrategy` absent *(EAA agent)*

**Files:** `frontend/src/app/app.routes.ts` (all routes), `frontend/src/app/app.config.ts`, `frontend/src/index.html:6`

Not a single route has a `title:` property. No `TitleStrategy` is registered in `app.config.ts`. `index.html` has a static `<title>Aromaterie</title>`. Every route — login, cart, checkout, account, product detail, legal pages — announces the same title to screen readers on navigation.

`SeoService.updatePageMeta()` sets `document.title` imperatively in a few components (catalog, product detail), but the home, cart, checkout, auth, account, and legal routes never call it. SSR-rendered HTML for all those routes has the static title.

WCAG 2.4.2 (Page Titled) is a Level A criterion — mandatory under EAA.

**Fix:** Either add `title:` to every route and provide `withRouterConfig({ titleStrategy: ... })`, or ensure every routed component calls `SeoService.updatePageMeta()` on init.

---


## 🔴 CRITICAL — EAA/WCAG 2.1.2 — DPD pickup modal has no focus trap, no `aria-modal`, no focus restoration *(EAA agent)*

**File:** `frontend/src/app/features/checkout/checkout-page/checkout-page.component.ts:453–465`

```html
@if (dpdModalOpen()) {
  <div class="dpd-modal-backdrop" (click)="closeDpdModal()">
    <div class="dpd-modal-content" (click)="$event.stopPropagation()">
      <button type="button" class="dpd-modal-close" (click)="closeDpdModal()">✕</button>
      <iframe class="dpd-modal-iframe" [src]="dpdWidgetUrl" ...></iframe>
    </div>
  </div>
}
```

- No focus trap — Tab exits the modal into the page behind it.
- No focus restoration — closing the modal leaves focus at an unrelated position.
- No `role="dialog"` or `aria-modal="true"` — screen readers read through the entire background page.
- No `aria-label` on the dialog container.

The product image lightbox (lines 562–603) has `role="dialog"` and `aria-modal="true"` but also lacks a focus trap and focus restoration.

**Fix:** Add `role="dialog"`, `aria-modal="true"`, `aria-label="Wybierz punkt odbioru DPD"` to `.dpd-modal-content`. Use Angular CDK `CdkTrapFocus` directive for the focus trap. Store the triggering element ref and call `.focus()` on `closeDpdModal()`.

---

## 🟠 HIGH — Orphaned Stripe coupon on every retry of a discounted order *(Payment Logic agent)*

**Files:** `backend/src/modules/payments/payments.service.ts:91–106`, `stripe.client.ts:66`

When `initiatePayment` resets a PENDING order (customer abandoned and returned), it calls `expireCheckoutSession` at line 94, then nulls `stripeCheckoutSessionId` at line 103, then calls `createCheckoutSession` which creates a **new Stripe coupon** (new `coupon.id`).

The `checkout.session.expired` webhook for the old session tries to find the payment row by `stripeCheckoutSessionId` — but the row was already updated to `null`. Lookup returns nothing. **The old coupon is never deleted.**

This runs on every "customer abandons checkout and retries" flow — the most common non-linear checkout path. A discount campaign with 100 daily retries accumulates 100 orphaned Stripe coupon objects per day permanently.

**Fix:** Before resetting the payment row (line 98), retrieve the old session (already retrieved at line 80 during the PENDING check) and call `deleteCoupon` on its `discounts[0].coupon.id` before nulling `stripeCheckoutSessionId`.

---

## 🟠 HIGH — `cancelByUser` allows customer to trigger full Stripe refund on `DISPUTE_HOLD` orders *(Payment Logic agent)*

**File:** `backend/src/modules/orders/orders.service.ts:596–665`

`cancelByUser` blocks: `CANCELLED`, `REFUNDED`, `SHIPPED`, `DELIVERED`, `FRAUD_REVIEW`, `PARTIALLY_REFUNDED`. It does **not** block `DISPUTE_HOLD`.

A `DISPUTE_HOLD` order has `payment.status === COMPLETED` (Stripe captured the charge; the dispute was opened later). When the customer calls `POST /orders/:id/cancel` on a `DISPUTE_HOLD` order, `cancelByUser` falls through all guards and calls `refundPayment(orderId, 'CUSTOMER')`. `refundPayment` confirms `payment.status === COMPLETED` and issues a full Stripe refund.

When Stripe receives a refund on a disputed charge, the dispute is automatically closed in the customer's favour — the merchant has already returned funds and cannot contest. The merchant loses both the goods and the money. This defeats the entire `DISPUTE_HOLD` state, which was specifically designed to prevent premature refunds pending dispute investigation (audit round 6, the admin path via `updateStatus` was partially fixed, but the customer-accessible path was missed).

**Fix:**
```typescript
if (order.status === OrderStatus.DISPUTE_HOLD) {
  throw new ConflictException(
    'Twoje zamówienie jest aktualnie w trakcie sporu płatniczego — skontaktuj się z obsługą.',
  );
}
```
Add this check before line 625 in `cancelByUser`.

---

## 🟠 HIGH — EAA/WCAG 3.3.1 — Form validation errors not announced to screen readers *(EAA agent)*

**Files:**
- `frontend/src/app/features/checkout/checkout-page/checkout-page.component.ts:148–149, 166–167, 185, 200, 227, 233`
- `frontend/src/app/features/auth/login/login.component.ts:32, 38`
- `frontend/src/app/features/auth/register/register.component.ts:42, 48`
- `frontend/src/app/features/catalog/product-detail/product-detail.component.ts:425`

All form validation errors are rendered as bare `<p class="field-error">` elements with no `role="alert"` or `aria-live`. When Angular reactively inserts an error paragraph, screen readers receive no notification — users must tab back to discover the error. WCAG 3.3.1 (Error Identification, Level A) and 3.3.3 (Error Suggestion, Level AA) require errors to be identified and announced.

**Fix:**
```html
@if (errorMsg('firstName'); as msg) {
  <p class="field-error" role="alert">{{ msg }}</p>
}
```
Apply to all error paragraphs across checkout, auth forms, and reviews.

---


## 🟠 HIGH — EAA/WCAG 2.1.1 — Hero scroll-jacking completely inaccessible to keyboard users *(EAA agent)*

**File:** `frontend/src/app/features/home/home.component.ts:521–533, 541–547, 248`

```typescript
private wheelHandler = (e: WheelEvent) => {
  if (!this.mediaFullyExpanded) e.preventDefault(); // intercepts ALL scroll
};
private touchMoveHandler = (e: TouchEvent) => {
  e.preventDefault(); // intercepts ALL touch scroll
};
```

The hero intercepts `wheel` and `touchmove` until `scrollProgress >= 1`. There is no keyboard handler. The below-fold content has `pointer-events: none; opacity: 0` until `showContent = true`. A keyboard user pressing Tab reaches the first CTA link inside `.expand-content` while it is visually invisible with `pointer-events: none` — the link is inert.

Additionally there is no `prefers-reduced-motion` check anywhere in the component (Finding 12 from EAA agent — combined here for severity). Users with vestibular disorders who have set `prefers-reduced-motion: reduce` in their OS still receive the full scroll-driven animation.

**Fix:**
```typescript
ngOnInit() {
  if (!this.isBrowser) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    this.scrollProgress = 1;
    this.showContent = true;
    this.mediaFullyExpanded = true;
    return;
  }
  // ... existing animation setup
}
```
Also add a keyboard-accessible trigger (Space/Enter on hero or a visible "Odkryj kolekcję" button) that sets `scrollProgress = 1`.

---

## 🟠 HIGH — Missing order-creation confirmation email — Polish UoK Art. 21 violation *(Polish Law agent)*

**File:** `backend/src/modules/orders/orders.service.ts:372–374`

```typescript
// Order confirmation email is sent in markSessionPaid() after the Stripe
// webhook confirms payment — not here, to avoid emailing customers who
// abandon the Stripe checkout before paying.
```

Polish Ustawa o prawach konsumenta Art. 21 ust. 1 requires the seller to confirm the contract "niezwłocznie" (without undue delay) on a durable medium. **Contract formation occurs at order creation** (`createFromCart`), not at payment capture. These are two distinct legal acts.

Consequences:
- A customer completing BLIK payment (async, 30–120s) receives zero email during the pending window. If they close the browser after authorising on their phone, they receive nothing until the webhook fires — which may be minutes later or never (outbox delivery failure).
- P24 bank-transfer similarly has async confirmation.
- Under UoK, "order placed, awaiting payment" confirmation is legally distinct from "payment confirmed + invoice" and both are required.

**Fix:** Create an `ORDER_ACKNOWLEDGED` email job type. In `createFromCart`, after line 382, enqueue it containing: order number, items summary, total, payment link, and cancel link. Label it "Potwierdzenie zamówienia — oczekujemy na płatność" (not "potwierdzenie płatności"). The existing payment-confirmed email with invoice remains as the second email.

---


## 🟠 HIGH — Sub-50gr order total bypasses pre-flight — Stripe throws, rollback can fail, leaving orphaned order and locked stock *(Payment Logic agent)*

**Files:** `backend/src/modules/orders/orders.service.ts:250`, `payments.service.ts:122–147`

`txTotalInCents = Math.max(0, itemsTotal + shipping - discount)` can produce any value between 0 and 49. Stripe rejects PLN amounts below 50 gr with `amount_too_small`.

Normal path: Stripe throws → `payments.service.ts` catch marks Payment FAILED → rollback transaction restores stock and coupon. Safe.

**Failure path:** if the rollback DB transaction itself fails (DB connection drop immediately after Stripe threw), the system is left with:
- An `Order` in `PENDING_PAYMENT` with `totalInCents < 50`
- A `Payment` in `FAILED` with `stripeCheckoutSessionId = null`
- Decremented stock that was never restored
- A coupon use that was never rolled back

The reconciliation cron explicitly filters `stripeCheckoutSessionId: { not: null }` — this payment is permanently invisible to reconciliation. The order sits in `PENDING_PAYMENT` forever.

**Fix:** Add before the transaction commits the order (line ~251):
```typescript
if (txTotalInCents > 0 && txTotalInCents < 50) {
  throw new BadRequestException(
    'Kwota zamówienia jest zbyt niska (minimum 0,50 zł po rabacie).',
  );
}
```

---

## 🟠 HIGH — Angular: `PartnershipComponent`, `ProductDetailComponent`, `CartService` subscription leaks *(Angular agent · 4/5 HIGH)*

**Files:**
- `frontend/src/app/features/partnership/partnership.component.ts:24` — `BreakpointObserver.observe()` subscription in constructor, never unsubscribed. Every `/partnership` visit adds a new listener to `MediaQueryList`.
- `frontend/src/app/features/catalog/product-detail/product-detail.component.ts:1253, 1278` — `subscribeStockStream()` overwrites `this.stockSub` without first unsubscribing. On rapid `/products/a → /products/b` navigation (same component reused), old SSE connection leaks. Also `loadRelatedProducts` at line 1304 subscribes without `takeUntilDestroyed` — fires on destroyed component after navigation.
- `frontend/src/app/core/services/cart.service.ts:138, 158` — Per-variant `Subject` subscriptions created in `getOrCreateUpdateQueue()`, stored in a `Map`, never completed. `clear()` (called on logout and order completion) resets `_items` and `_cartId` but never calls `subject.complete()` or clears the `updateQueues` Map.

**Fix (summary):**
```typescript
// partnership.component.ts
private readonly destroyRef = inject(DestroyRef);
constructor() {
  this.bp.observe('(max-width: 1000px)')
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe(...);
}

// product-detail: subscribeStockStream — add before reassign
this.stockSub?.unsubscribe();
// loadRelatedProducts — add pipe
.pipe(takeUntilDestroyed(this.destroyRef))

// cart.service.ts — in clear()
this.updateQueues.forEach(subject => subject.complete());
this.updateQueues.clear();
```

---


## 🟠 HIGH — WishlistService: `_items` signal initialized from `localStorage` — SSR hydration mismatch *(Angular agent)*

**File:** `frontend/src/app/core/services/wishlist.service.ts:23`

```typescript
private readonly _items = signal<WishlistItemData[]>(this.loadFromStorage());
```

`loadFromStorage()` returns `[]` on SSR (correct). The SSR Lambda renders the header with cart badge = 0. The browser hydrates, reads `localStorage`, and finds N items — the wishlist count badge instantly jumps from 0 to N. Angular 18's hydration reconciliation sees a mismatch between server HTML (0) and client signal (N), triggering a hydration warning and a visible flash.

**Fix:** Use Angular `TransferState` to persist the guest wishlist item count from SSR to browser hydration, or render the wishlist badge as `@defer` (browser-only) so the server never commits the 0-count to the serialized DOM.

---

## 🟠 HIGH — Prisma `$executeRawUnsafe` in `processCorrectiveInvoice` interpolates `year` without bounds validation *(Supply-Chain agent)*

**File:** `backend/src/modules/invoice/invoice.service.ts:177–181`

```typescript
const seqName = `corrective_invoice_number_seq_${year}`;
await this.prisma.$executeRawUnsafe(
  `CREATE SEQUENCE IF NOT EXISTS ${seqName} START 1 INCREMENT 1`,
);
const seqRows = await this.prisma.$queryRawUnsafe<Array<{ nextval: bigint }>>(
  `SELECT nextval('${seqName}')`,
);
```

`year` is `new Date().getFullYear()` today, but `ensureSequence()` at line 63–68 validates `year` against `< 2020 || > 2100` before interpolation. `processCorrectiveInvoice` performs no such validation and deviates from the pattern established explicitly to guard this operation. If a call site is ever refactored to accept a `year` parameter (e.g., for backdating corrective invoices to the original order year), there is no guard. The inconsistency is a future SQL injection risk.

**Fix:** Extract a `ensureCorrectiveSequence(year: number)` that mirrors the integer + range check in `ensureSequence`.

---


## 🟠 HIGH — No `robots.txt` — `/cart` prerendered and indexable; sensitive routes unprotected *(Supply-Chain agent)*

**File:** `frontend/src/app/angular.json:30–45`, `frontend/prerender-routes.txt:2`

No `robots.txt` exists anywhere in the project. `prerender-routes.txt` lists `/cart` as a prerendered route, producing a static HTML artifact at that URL. `/checkout/*`, `/account/*`, `/auth/callback` are wide open to search engine crawlers with no crawl-budget instruction.

`/cart` has no SEO value and produces an empty-cart page at a URL that should not be indexed. Googlebot will waste crawl budget on it, and any cart-abandonment personalisation embedded during SSR would be cached publicly.

**Fix:** Create `frontend/src/robots.txt`:
```
User-agent: *
Disallow: /checkout/
Disallow: /account/
Disallow: /auth/
Disallow: /cart
Allow: /

Sitemap: https://<your-domain>/sitemap.xml
```
Add to `angular.json` assets. Remove `/cart` from `prerender-routes.txt`.

---

## 🟠 HIGH — Sentry production DSN hardcoded in committed source file *(Supply-Chain agent)*

**File:** `frontend/src/environments/environment.prod.ts:6`

```typescript
sentryDsn: 'https://e859ba7aa95521faa94e9b42ade0c8ea@o4511250966839296.ingest.de.sentry.io/...',
```

A real production Sentry DSN is committed to the repository. While DSNs are intentionally public in browser bundles, committing it to source means:
1. Anyone who forks/clones the repo can spam the Sentry project with fake events, filling the monthly quota.
2. The production Sentry project ID is permanently exposed in git history even if later removed.

`backend/src/instrument.ts` correctly reads `process.env.SENTRY_DSN`. The frontend diverges from this pattern.

**Fix:** Use Angular's environment file replacement mechanism to inject the DSN from a Vercel env var at build time (via `@angular/build`'s `define` replacements or `fileReplacements`). Rotate the exposed DSN in the Sentry Dashboard.

---


## 🟠 HIGH — EAA/WCAG 1.4.3 — Multiple low-contrast text failures *(EAA agent)*

**Files:**
- `frontend/src/app/shared/components/cookie-consent/cookie-consent.component.ts:93–100` — `.btn-minimal { color: rgba(255,255,255,0.42) }` on `#1a1a1a` ≈ 3.9:1 (fails 4.5:1 for normal text). This is the "Tylko niezbędne" button — the GDPR opt-out option.
- `frontend/src/app/shared/components/footer/footer.component.ts:64–67` — `.footer__seller { color: rgba(255,255,255,0.55) }` ≈ 4.2:1 at 11px (fails). `.footer__seller-title { color: rgba(255,255,255,0.4) }` ≈ 3.0:1 at 10px (fails).
- `frontend/src/app/features/checkout/checkout-page/checkout-page.component.ts:527` — `.street-hint--warning { color: #c47a00 }` on white ≈ 2.87:1 (fails 4.5:1 for 12px text).

**Fix:** Increase contrast: `.btn-minimal` → `rgba(255,255,255,0.70)` (≈6.6:1). `.footer__seller` → `rgba(255,255,255,0.65)`. `.street-hint--warning` → `#9a5e00` or darker.

---

## 🟠 HIGH — EAA/WCAG 4.1.3 — Cart and wishlist badge count has no accessible name *(EAA agent)*

**File:** `frontend/src/app/shared/components/header/header.component.ts:136–147`

The numeric badge is visually overlaid on the icon and read by screen readers as a raw number concatenated with the link text: "3 Koszyk" with no context about what "3" means.

**Fix:**
```html
<a routerLink="/cart"
   [attr.aria-label]="cartService.itemCount() > 0
     ? 'Koszyk (' + cartService.itemCount() + ' produktów)'
     : 'Koszyk'">
  <tui-icon icon="@tui.shopping-cart" aria-hidden="true" />
  @if (cartService.itemCount() > 0) {
    <span class="header__cart-badge" aria-hidden="true">{{ cartService.itemCount() }}</span>
  }
  <span aria-hidden="true">Koszyk</span>
</a>
```
Apply same pattern to wishlist badge.

---

## 🟡 MEDIUM — Angular: `CheckoutPageComponent` `effect()` writes to signal without `allowSignalWrites: true` — throws in dev mode *(Angular agent)*

**File:** `frontend/src/app/features/checkout/checkout-page/checkout-page.component.ts:664`

```typescript
private readonly _freeShippingCarrierSync = effect(() => {
  const carrier = this.selectedCarrier();
  const coupon = untracked(() => this.appliedCoupon());
  if (coupon?.isFreeShipping) {
    this.appliedCoupon.set({ ...coupon, discountAmountInCents: carrier?.price ?? 0 });
  }
});
```

Angular 18 throws `"Writing to signals is not allowed in a computed or an effect by default"` in dev mode when `set()` is called inside `effect()` without `{ allowSignalWrites: true }`. The `untracked` wrapper silences the tracking side but not the write-guard. This throws a runtime error in dev mode; in production builds the check may be stripped, silently leaving the reactive model in a broken state.

**Fix:** Add `{ allowSignalWrites: true }` as second argument to `effect()`.

---

## 🟡 MEDIUM — Angular: `ProductDetailComponent` `@HostListener('document:keydown')` missing SSR platform guard *(Angular agent)*

**File:** `frontend/src/app/features/catalog/product-detail/product-detail.component.ts:1201`

```typescript
@HostListener('document:keydown', ['$event'])
onKeyDown(e: KeyboardEvent): void {
  if (!this.lightboxOpen()) return;
  // calls closeLightbox() which does document.body.style.overflow = ''
}
```

The listener is established during SSR rendering. `closeLightbox()` sets `document.body.style.overflow` — guarded by `isPlatformBrowser` in the method — but the listener fires during SSR hydration window, creating a double-listener state. The `lightboxOpen.set(false)` inside `closeLightbox()` runs server-side.

**Fix:**
```typescript
@HostListener('document:keydown', ['$event'])
onKeyDown(e: KeyboardEvent): void {
  if (!isPlatformBrowser(this.platformId) || !this.lightboxOpen()) return;
  ...
}
```


## 🟡 MEDIUM — Angular: `ProductListComponent.loadFacets` subscription has no `takeUntilDestroyed` *(Angular agent)*

**File:** `frontend/src/app/features/catalog/product-list/product-list.component.ts:776`

`loadFacets()` creates a bare `.subscribe()` without `takeUntilDestroyed`. If the user navigates away before the facets response arrives, `this.facets.set(res)` executes on a destroyed component. The main route-change pipeline uses `takeUntilDestroyed(this.destroyRef)` — `loadFacets` is a callsite gap.

**Fix:** Add `.pipe(takeUntilDestroyed(this.destroyRef))` before `.subscribe()`.

---

## 🟡 MEDIUM — `verifiedPurchase` flag nullified silently on order deletion — EU Omnibus Art. 3a gap *(Polish Law agent)*

**File:** `backend/prisma/schema.prisma:598–599`

`Review.orderId String?` with `onDelete: SetNull`. If an admin hard-deletes an order, all linked reviews silently flip to `orderId = null` → `verifiedPurchase: false`. Affected reviews were legitimately purchased but are now labelled unverified with no audit trail.

Separately: EU Omnibus Art. 3a requires disclosure of whether and how consumer reviews are verified. The API emits `verifiedPurchase: boolean`. If the frontend displays `false` as simply "no badge" (silent omission), that is non-compliant — the regulation requires proactive disclosure of the verification mechanism, or explicit labelling of unverified reviews.

**Fix:** Change the `Review.order` relation from `onDelete: SetNull` to `onDelete: Restrict` in the schema. Admin order deletion should soft-delete or warn about linked verified reviews. On the frontend, display "Niezweryfikowany zakup" explicitly on reviews where `verifiedPurchase: false` (or exclude them from the public listing).

---


## 🟡 MEDIUM — FIXED_AMOUNT coupon excludes shipping with no UI disclosure — UoK Art. 13 violation *(Polish Law agent)*

**Files:** `backend/src/modules/coupons/coupon.service.ts:150`, `frontend/src/app/features/checkout/checkout-page/checkout-page.component.ts:786`

`calculateDiscount(FIXED_AMOUNT)` caps at `Math.min(value, cartTotalInCents)` where `cartTotalInCents` is items total only (no shipping). A 100 PLN coupon on a 50 PLN item + 15 PLN shipping discounts only 50 PLN — the customer still pays 15 PLN shipping, even though the coupon value would theoretically cover the entire total.

Polish UoK Art. 13 (pre-contract information obligations) requires clear disclosure of the total price including all costs. If a coupon is marketed as "100 PLN off your order" but silently excludes shipping costs, this is a misleading omission.

**Fix:** Add `appliesToItemsOnly: boolean` to the coupon validation response for `FIXED_AMOUNT` types where `value >= itemsTotal`. In the checkout UI display: *"Rabat nie obejmuje kosztu dostawy"* when this flag is true.

---

## 🟡 MEDIUM — EAA/WCAG 2.4.3 — Lightbox `tabindex="-1"` present but `.focus()` never called on open *(EAA agent)*

**File:** `frontend/src/app/features/catalog/product-detail/product-detail.component.ts:562–564, 1168–1172`

The lightbox has `tabindex="-1"` making it programmatically focusable, but `openLightbox()` never calls `.focus()`. When the lightbox opens, focus stays on the thumbnail button — behind the modal. The close button is unreachable by keyboard without tabbing through the entire obscured page.

**Fix:**
```typescript
openLightbox(index: number): void {
  this.lightboxIndex.set(index);
  this.lightboxOpen.set(true);
  if (isPlatformBrowser(this.platformId)) {
    document.body.style.overflow = 'hidden';
    setTimeout(() => (document.querySelector('.lightbox') as HTMLElement)?.focus(), 0);
  }
}
```
Also add `CdkTrapFocus` and restore focus to the triggering element on close.

---


## 🟡 MEDIUM — EAA/WCAG 2.4.6 — In-stock filter toggle has no programmatic label association *(EAA agent)*

**File:** `frontend/src/app/features/catalog/product-list/product-list.component.ts:291–300`

```html
<div class="filter-instock">
  <span>Pokaż tylko dostępne</span>
  <input type="checkbox" tuiSwitch [ngModel]="stagedInStock()" .../>
</div>
```

The `<span>` and `<input>` are siblings, not associated via `<label for>` or `aria-labelledby`. Screen readers announce the checkbox with no label context.

**Fix:** Wrap in `<label>` or add `id`/`for` linkage:
```html
<label class="filter-instock">
  <span>Pokaż tylko dostępne</span>
  <input type="checkbox" tuiSwitch [ngModel]="stagedInStock()" .../>
</label>
```

---

## 🟡 MEDIUM — EAA/WCAG 4.1.2 — `<a>` without `href` uses `role="button"` but is not keyboard-focusable *(EAA agent)*

**File:** `frontend/src/app/features/catalog/product-detail/product-detail.component.ts:175`

```html
<a class="detail__rating-summary" role="button" style="cursor:pointer"
   aria-label="Przejdź do opinii" (click)="scrollToReviews()">
```

An `<a>` without `href` is not keyboard-focusable by default. `role="button"` overrides its semantic role but Tab cannot reach it. Screen readers may announce it inconsistently.

**Fix:** Replace with a `<button type="button">` element.

---


## 🟡 MEDIUM — No `pnpm audit` or Dependabot in CI — dependency CVEs go undetected *(Supply-Chain agent)*

**File:** `.github/workflows/ci.yml` (no audit step)

CI has no `pnpm audit`, no Snyk, no Trivy, and no `.github/dependabot.yml`. Notable packages with CVE histories in the project: `express@^4.22.1` (header injection history), `axios@^1.15.0` (SSRF/ReDoS), `multer@^2.1.1` (DoS), `adminjs@^7.8.17` (XSS history — panel is at `/admin`).

**Fix:**
```yaml
# in ci.yml, after pnpm install
- name: Security audit
  run: pnpm audit --audit-level=high
  continue-on-error: true
```
Add `.github/dependabot.yml` with `package-ecosystem: npm` for both `backend/` and `frontend/`, weekly schedule.

---

## 🟡 MEDIUM — `vercel.json` CSP missing `form-action`; no `X-Frame-Options` or `HSTS` *(Supply-Chain agent)*

**File:** `vercel.json:27`

- `form-action` is absent — an injected `<form action="https://attacker.com">` can exfiltrate form data cross-origin. `form-action` is not inherited from `default-src`; it must be set explicitly.
- `X-Frame-Options: DENY` absent (the CSP `frame-ancestors 'none'` covers modern browsers but not IE11/older Safari).
- `Strict-Transport-Security` absent — no local HSTS pin in the browser.

**Fix:**
```json
{ "key": "form-action", "value": "'self'" },
{ "key": "X-Frame-Options", "value": "DENY" },
{ "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" }
```
Add `form-action 'self'; manifest-src 'self';` to the existing CSP string.

---


## 🟡 MEDIUM — Replacement delivery does not reset the 14-day withdrawal clock *(Polish Law agent)*

**File:** `backend/src/modules/returns/returns.service.ts`

Polish UoK Art. 27 (implementing Directive 2011/83/EU Art. 14 ust. 1): the withdrawal window runs from the moment the consumer takes physical possession of the goods. For a replacement unit, the clock restarts from receipt of the replacement — not the original delivery.

The system has no `replacementDeliveredAt` field on `ReturnRequest`. When a customer receives a replacement and submits a second return request referencing the original order, the withdrawal check uses `order.shipment.deliveredAt` (original delivery) — which may be >14 days ago, causing a wrongful rejection.

**Fix:** Add `replacementDeliveredAt DateTime?` to `ReturnRequest`. Admin sets it when confirming replacement dispatch. Modify the withdrawal clock check to prefer `replacementDeliveredAt` when present on a prior COMPLETED return for the same order.

---

## 🟡 MEDIUM — `sitemap.xml` committed to git — stale artifact, catalog exposure *(Supply-Chain agent)*

**File:** `frontend/src/sitemap.xml` (tracked in git per `git status`)

`sitemap.xml` is regenerated at every Vercel build by `scripts/generate-sitemap.mjs`. Committing it:
1. Creates permanent git history snapshots of the product catalog (all slugs, URLs).
2. If the Vercel build fetches live product slugs from the backend and the backend is unreachable, the graceful fallback is to static routes — but the committed stale file would be packaged instead, shipping incorrect/missing product URLs.
3. Creates confusing `git diff` noise (visible in current `git status`: `M frontend/src/sitemap.xml`).

**Fix:** Add `frontend/src/sitemap.xml` and `frontend/prerender-routes.txt` to `.gitignore`. Both are generated artifacts.

---


## 🟡 MEDIUM — Guest order self-cancel from failure page always fails silently *(Payment Logic agent)*

**File:** `frontend/src/app/features/checkout/checkout-failure/checkout-failure.component.ts:107–114`

`cancelOrder()` calls `POST /orders/:id/cancel` with no guest token. For guest checkouts, `authInterceptor` sends no `Bearer` token. The backend returns `UnauthorizedException`. The catch at line 113 resets only the loading state — no error message is shown. The "Anuluj zamówienie" button is permanently broken for guest users on the failure page.

**Fix:** Thread `guestToken` into the cancel URL (alongside `orderId` and `session_id`) and have the failure component append it as a query param to the cancel request.

---

## 🟢 LOW — EAA/WCAG 3.3.2 — Taiga UI `tui-textfield` inputs may lack programmatic label association *(EAA agent)*

**File:** `frontend/src/app/features/checkout/checkout-page/checkout-page.component.ts:138–200`

Taiga UI's `tuiLabel` + bare `<input tuiTextfield>` pattern may not inject `id`/`for` pairs or `aria-labelledby` depending on the Taiga UI version. Verify in DevTools accessibility tree: if the rendered `<input>` has no `id` and the `<label>` has no `for`, screen readers cannot associate them.

**Fix:** Add explicit `id`/`for` pairs to all form fields, or verify Taiga UI v4 correctly injects `aria-labelledby`.

---


## 🟢 LOW — EAA/WCAG — Mobile nav panel has no focus trap *(EAA agent)*

**File:** `frontend/src/app/shared/components/header/header.component.ts:170–186`

The mobile menu opens without moving focus into it, has no `role="dialog"` or `aria-modal`, and Tab exits into the obscured page. Lower severity because mobile-viewport users are predominantly touch-based, but keyboard-attached tablets are common.

**Fix:** Add `role="dialog"`, `aria-modal="true"`, `aria-label="Menu nawigacyjne"`. Use `CdkTrapFocus`. Restore focus to hamburger on close.

---

## 🟢 LOW — EAA/WCAG 3.1.2 — `<time>` elements missing `datetime` attribute *(EAA agent)*

**File:** `frontend/src/app/features/catalog/product-detail/product-detail.component.ts:480–482`

```html
<time class="review-card__date">{{ formatDate(review.createdAt) }}</time>
```

`<time>` without `datetime` is meaningless to assistive technology. Fix: `[attr.datetime]="review.createdAt"`.

## 🟢 LOW — CI does not trigger on `fix/**` branches *(Supply-Chain agent)*

**File:** `.github/workflows/ci.yml:5–6`

The current branch `fix/fixes_round_8` bypasses CI entirely. Security fixes pushed to `fix/**` branches are not built or tested before merging.

**Fix:** Add `'fix/**'` to the push branch filter in `ci.yml`.

---

## Legend

| Label | Meaning |
|---|---|
| 🔴 CRITICAL | Silent infrastructure failure, broken in production right now |
| 🟠 HIGH | Direct money loss, legal exposure, serious EAA/WCAG failure |
| 🟡 MEDIUM | Material correctness, UX, or compliance gap |
| 🟢 LOW | Hardening / polish |

---

## Agent Agreement Summary

| Finding | Agents |
|---|---|
| Prisma migrations gitignored | Supply-Chain (1/5) |
| Stripe sessions.create missing idempotency key | Payment Logic (1/5) |
| cancelByUser DISPUTE_HOLD gap | Payment Logic (1/5) |
| EAA/accessibility (all 16 findings) | EAA (1/5) |
| Order-creation confirmation email missing (UoK Art. 21) | Polish Law (1/5) |
| Angular subscription leaks (4 findings) | Angular (1/5) |
| WishlistService SSR hydration mismatch | Angular (1/5) |
| Sub-50gr order total leaves orphan | Payment Logic (1/5) |
| No robots.txt / cart prerendered | Supply-Chain (1/5) |
| Sentry DSN hardcoded in frontend | Supply-Chain (1/5) |

*Note: Low agent-agreement is expected in Round 9 — the easy multi-agent overlaps were found in rounds 1–8. Fresh territory means each agent finds distinct issues in their domain.*

---

## Prioritized Fix Order

| # | Finding | Severity | Effort |
|---|---|---|---|
| 1 | Add `backend/prisma/migrations/` to git (remove from `.gitignore`) | 🔴 CRITICAL | 5 min |
| 2 | Idempotency key on `sessions.create` + `coupons.create` | 🔴 CRITICAL | 1 hour |
| 3 | Skip-navigation link in app shell | 🔴 CRITICAL | 30 min |
| 4 | Add `title:` to all routes or TitleStrategy | 🔴 CRITICAL | 2 hours |
| 5 | DPD modal: add `role="dialog"`, `aria-modal`, focus trap, focus restore | 🔴 CRITICAL | 2 hours |
| 6 | Add `cancelByUser` DISPUTE_HOLD guard | 🟠 HIGH | 30 min |
| 7 | Orphaned Stripe coupon on retry — delete before resetting payment row | 🟠 HIGH | 2 hours |
| 8 | Add `ORDER_ACKNOWLEDGED` email on order creation (UoK Art. 21) | 🟠 HIGH | 3 hours |
| 9 | Sub-50gr total pre-flight guard before order transaction commits | 🟠 HIGH | 1 hour |
| 10 | Fix form validation error `role="alert"` across all forms | 🟠 HIGH | 2 hours |
| 11 | Hero: `prefers-reduced-motion` + keyboard accessibility trigger | 🟠 HIGH | 3 hours |
| 12 | Fix Angular subscription leaks (partnership, product-detail, cart.service) | 🟠 HIGH | 2 hours |
| 13 | WishlistService: SSR hydration mismatch (`TransferState` or `@defer`) | 🟠 HIGH | 2 hours |
| 14 | `$executeRawUnsafe` in `processCorrectiveInvoice` — add year bounds check | 🟠 HIGH | 1 hour |
| 15 | Create `frontend/src/robots.txt`, remove `/cart` from prerender | 🟠 HIGH | 30 min |
| 16 | Rotate and externalize Sentry frontend DSN | 🟠 HIGH | 30 min |
| 17 | Cart/wishlist badge `aria-label` with item count | 🟠 HIGH | 30 min |
| 18 | Lightbox: `.focus()` on open + focus trap | 🟡 MEDIUM | 1 hour |
| 19 | `effect()` in checkout: add `allowSignalWrites: true` | 🟡 MEDIUM | 5 min |
| 20 | `@HostListener` in product-detail: add `isPlatformBrowser` guard | 🟡 MEDIUM | 15 min |
| 21 | `loadFacets` subscription: add `takeUntilDestroyed` | 🟡 MEDIUM | 15 min |
| 22 | `verifiedPurchase` — change `Review.order` to `onDelete: Restrict` | 🟡 MEDIUM | 1 hour |
| 23 | FIXED_AMOUNT coupon: add `appliesToItemsOnly` disclosure in UI | 🟡 MEDIUM | 1 hour |
| 24 | Add `pnpm audit` step and Dependabot to CI | 🟡 MEDIUM | 1 hour |
| 25 | CSP: add `form-action 'self'`; add `X-Frame-Options` and `HSTS` to `vercel.json` | 🟡 MEDIUM | 30 min |
| 26 | Replacement delivery: `replacementDeliveredAt` field + withdrawal clock fix | 🟡 MEDIUM | 2 hours |
| 27 | Gitignore `sitemap.xml` and `prerender-routes.txt` | 🟡 MEDIUM | 5 min |
| 28 | Guest cancel from failure page: thread `guestToken` into cancel URL | 🟡 MEDIUM | 1 hour |
| 29 | Taiga UI label association: verify aria tree or add explicit `id`/`for` | 🟢 LOW | 2 hours |
| 30 | Mobile nav: `role="dialog"`, focus trap | 🟢 LOW | 1 hour |
| 31 | `<time datetime>` on review cards | 🟢 LOW | 15 min |
| 32 | CI: add `fix/**` to push branch trigger | 🟢 LOW | 5 min |
| 33 | In-stock filter toggle: wrap in `<label>` | 🟢 LOW | 15 min |
| 34 | Rating anchor `<a>` → `<button>` | 🟢 LOW | 10 min |
