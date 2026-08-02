# Responsive UI audit — baseline

Mechanical sweep of every public route at five viewports, run with
[`e2e/visual`](../e2e/visual/README.md):

```bash
cd e2e && node visual/audit.mjs baseline
```

20 routes x 5 viewports (360 / 390 / 430 / 768 / 1440). Screenshots and the raw
`findings.json` are gitignored — regenerate them rather than reading a stale
copy. This file is the committed baseline: re-run the audit after a UI change
and the distinct-offender table below should shrink, never grow.

Captured 2026-08-02, against the dev servers on :4200 / :3000.

## Headline result

**No horizontal overflow anywhere.** The most common small-screen defect — one
wide child making the whole document pan sideways — does not occur on any route
at any width. That is the good news, and it is worth keeping: the detector will
catch a regression the day someone adds a fixed-width table or an unwrapped
flex row.

Everything else reduces to four problem classes. Raw counts (4287 findings)
are misleading because the same element repeats across 20 routes and 5
viewports; deduplicated, there are **59 distinct offenders**.

| Class | Distinct | Worst instance |
|---|---|---|
| `small-tap-target` | 25 | header icon links at **20x20** |
| `tiny-text` | 12 | `.footer__seller-title` at **10px** |
| `axe:color-contrast` | 1 rule, 746 nodes | `.feature__eyebrow` gold on cream |
| `clipped-text` | 6 | cookie `.btn-accept`, 166px of content in a 158px box |

## Prioritised findings

### 1. Header icon links are 20x20 (all 20 routes, all viewports)

`a.header__action-link` — wishlist, cart, account. At 20x20 CSS px these are
less than half the 44x44 that Apple HIG and Material both call for, and under
even the WCAG 2.5.8 floor of 24x24. The hamburger is 30x30 and the header's
search and finder buttons are 32px tall.

This is the single highest-impact item: it is on every page, it affects the
primary navigation, and it is a pure padding change — the icons themselves can
stay their current size.

### 2. Product-card wishlist button, 32x32 (4 catalog routes)

`button.product-card__wishlist`. Same class of problem, and it sits on top of a
card that is itself a link, so a miss does not do nothing — it navigates.

### 3. Text under 12px in the product card and footer

- `.product-card__subtitle` — 11.52px
- `.product-card__unit-price` — 11.2px
- `.footer__seller-title` — 10px
- a generic `span` at 11px, present on all 20 routes

The unit price and the seller block are exactly the content a shopper needs to
read carefully. 10px is below what any mobile guideline endorses.

### 4. Colour contrast — one rule, 746 nodes, 9 routes

Every violation axe reports is `color-contrast`; no missing labels, no ARIA
errors, no heading-order problems. The sample it points at is
`.feature__eyebrow`, the gold `#c9a96e` on the cream `#f9f5f0` section
background — roughly 2.2:1 against a 4.5:1 requirement. The same gold is used
for every eyebrow label across the home page sections, which is where the node
count comes from.

Worth fixing as one token change rather than 746 individual ones.

### 5. Cookie banner button clips its own label

`button.btn-accept` — 166px of text in a 158px box, at 360px only. Small, but
it is the first interactive element a new visitor sees.

### 6. Hero headline overflows on narrow screens

`.expand-wrap` reports 886px of content in a 360px box. The headline
`.expand-title__word` is `white-space: nowrap` at `clamp(42px, 7vw, 100px)`, so
"który mówi wszystko." cannot fit at 360px and is clipped by the wrap's
`overflow-x: hidden`. The clipping is invisible rather than broken-looking, but
the sentence is the page's first message and part of it is unreadable.

## Judgement calls, not detector output

The screenshots surface things no rule can express:

- **Catalog at 360px is 11577px tall** — one product per row. Mobile
  e-commerce convention is a two-column grid at this width; the current layout
  makes the shopper scroll through roughly 30 screens of catalog.
- Section rhythm on the home page is now consistent (fixed earlier in this
  branch, pinned by `visual/home-sections.mjs`).

## Coverage gaps

Not audited, because they need a session and a seeded cart:
`/checkout`, `/account`, `/account/orders`, `/account/orders/:id`,
`/account/profile`, `/account/addresses`, `/wishlist`, `/returns`.

Also uncovered: cart-with-items, and any state reached only by interaction
(open menus, dialogs, form validation errors).

Not yet implemented from the audit plan: real-device conditions — `dvh` with a
retracting address bar, `safe-area-inset` on notched devices, landscape
orientation, and CPU/network throttling.

## Known rig flake

Four screenshot writes failed with `ENOENT` at 768px (login, register,
forgot-password, magic-link) on the baseline run. The findings for those
route/viewport pairs were collected before the failure, but the summary script
skips entries carrying an `error`, so they are missing from the totals above.
Re-running usually succeeds; if it persists, it is a Windows file-handle issue,
not a page defect.
