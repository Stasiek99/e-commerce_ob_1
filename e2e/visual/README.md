# Responsive UI audit rig

Screenshots every public route at every viewport and runs mechanical defect
detectors over the rendered DOM. The point is regression pressure: findings are
written to JSON so a UI change either clears entries or adds them, instead of
relying on someone remembering what a page looked like last month.

## Running

Both dev servers must be up (`pnpm dev:frontend`, `pnpm dev:backend`):

```bash
cd e2e
node visual/audit.mjs baseline     # writes visual/shots/baseline/
node visual/audit.mjs after-fix    # ... and compare the two findings.json
```

Override targets with `AUDIT_BASE_URL` / `AUDIT_API_URL` to point at a deployed
environment instead of localhost.

## What it checks

| Detector | Rule |
|---|---|
| `horizontal-overflow` | any visible element extending past the viewport's right edge — the usual cause of a page that pans sideways on a phone |
| `small-tap-target` | interactive element under 44x44 CSS px |
| `tiny-text` | rendered font-size under 12px |
| `clipped-text` | content wider than its own `overflow: hidden` box |
| `axe:*` | axe-core violations, `wcag2a` + `wcag2aa` + `wcag21aa` |

None of these require judgement. Visual review — spacing rhythm, hierarchy,
whether a layout simply looks wrong — is a separate pass over the screenshots.

## Coverage gaps

Routes behind `authGuard` / `checkoutGuard` are **not** audited: `/checkout`,
`/account/*`, `/wishlist`, `/returns`. They need a logged-in session and a
seeded cart. They are listed in `routes.mjs` as `GUARDED` and echoed into
`findings.json` so the hole stays visible rather than being mistaken for a
clean result.

Cart-with-items, and any other state reached only by interaction, is likewise
uncovered so far.

## Gotchas baked into the rig

Two mistakes cost an hour each when this was first written, so they are guarded
in code and repeated here:

- **Never `waitUntil: 'networkidle'`.** The app holds an open SSE stock stream.
  The network never falls quiet, so the wait always burns its full timeout.
- **Never `await img.decode()` without a bound.** An image that 404s leaves the
  promise pending forever and the whole run hangs with no output written. The
  rig polls `img.complete` under a timeout instead.

The rig launches the system Chrome (`channel: 'chrome'`) rather than
Playwright's pinned build, which is not downloaded in this workspace. Run
`pnpm --filter e2e install:browsers` if you would rather pin it.
