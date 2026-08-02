/**
 * Home-page section consistency check.
 *
 * Narrower than audit.mjs on purpose: it pins one property the generic
 * detectors cannot express — that stacked, every section on the home page
 * renders the same shape (product shot on top, copy centered underneath) and
 * every product shot occupies an identically sized box.
 *
 * That used to be false in four different ways: features and cards centered,
 * diffusers left-aligned, finder and gels right-aligned with the copy pulled
 * above the bottle, and the showcase bottles rendering about twice the height
 * of the feature ones because each block carried its own vh-based cap.
 *
 *   node visual/home-sections.mjs [label]     # from the e2e/ directory
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIEWPORTS } from './routes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.AUDIT_BASE_URL ?? 'http://localhost:4200';
const label = process.argv[2] ?? 'run';
const OUT = join(HERE, 'shots', `home-${label}`);
mkdirSync(OUT, { recursive: true });

const MEASURE = () => {
  const rows = [];
  const sel = '.feature__image, .showcase__image, .category-card__image';
  for (const img of document.querySelectorAll(sel)) {
    const section = img.closest('section, .category-card');
    const content = section?.querySelector(
      '.feature__content, .showcase__content, .category-card__content',
    );
    const media = img.parentElement;
    const r = img.getBoundingClientRect();
    const mr = media.getBoundingClientRect();
    const cr = content?.getBoundingClientRect();
    const cs = content ? getComputedStyle(content) : null;
    rows.push({
      section: section?.className ?? '?',
      imgW: Math.round(r.width),
      imgH: Math.round(r.height),
      mediaH: Math.round(mr.height),
      // negative => the shot sits ABOVE the copy, which is the target stacked
      mediaVsContent: cr ? Math.round(mr.top - cr.top) : null,
      textAlign: cs?.textAlign,
      alignItems: cs?.alignItems,
    });
  }
  // Hero framing: distance from the media box to its container on each side.
  // The old 95vw/85dvh pair left the top and bottom at zero on short
  // viewports, so the image butted against the header and the next section.
  const wrap = document.querySelector('.expand-wrap');
  const media = document.querySelector('.expand-media');
  let hero = null;
  if (wrap && media) {
    const w = wrap.getBoundingClientRect();
    const m = media.getBoundingClientRect();
    hero = {
      left: Math.round(m.left - w.left),
      right: Math.round(w.right - m.right),
      top: Math.round(m.top - w.top),
      bottom: Math.round(w.bottom - m.bottom),
    };
  }
  return { rows, hero };
};

const browser = await chromium.launch({ channel: 'chrome' });
const report = {};

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  // See visual/README.md: not 'networkidle' (open SSE stream never settles).
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('.category-card__image', { timeout: 30_000 });

  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  // Bounded: img.decode() on a stalled image never settles.
  await page
    .waitForFunction(() => [...document.images].every((i) => i.complete), null, {
      timeout: 15_000,
    })
    .catch(() => console.warn('  (some images never finished loading)'));
  await page.waitForTimeout(400);

  report[vp.name] = await page.evaluate(MEASURE);
  await page.screenshot({ path: join(OUT, `${vp.name}-full.png`), fullPage: true });
  await page.screenshot({ path: join(OUT, `${vp.name}-hero.png`) });
  await ctx.close();
}

await browser.close();
writeFileSync(join(OUT, 'measurements.json'), JSON.stringify(report, null, 2));

for (const [vp, data] of Object.entries(report)) {
  console.log(`\n=== ${vp} ===`);
  console.log('hero gaps:', JSON.stringify(data.hero));
  for (const r of data.rows) {
    const order = r.mediaVsContent === null ? '?' : r.mediaVsContent < 0 ? 'IMG-TOP' : 'TEXT-TOP';
    console.log(
      `  ${r.section.padEnd(34)} ${String(r.imgW).padStart(4)}x${String(r.imgH).padStart(4)}` +
        `  box=${String(r.mediaH).padStart(4)}  ${order.padEnd(8)} ${r.textAlign}/${r.alignItems}`,
    );
  }
}
console.log(`\nWritten: ${join(OUT, 'measurements.json')}`);
