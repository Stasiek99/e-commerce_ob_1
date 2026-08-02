/**
 * Responsive UI audit rig.
 *
 * Walks every public route at every viewport, screenshots it, and runs a set of
 * yes/no defect detectors plus axe-core. Output is a findings JSON that can be
 * diffed between runs, so a UI change either clears findings or adds them.
 *
 *   node visual/audit.mjs [label]      # from the e2e/ directory
 *
 * Requires the frontend dev server on :4200 and the backend on :3000.
 *
 * Two traps worth knowing, both already handled below:
 *  - Never wait for 'networkidle'. The app holds an open SSE stock stream, so
 *    the network never falls quiet and the wait burns its full timeout.
 *  - Never await img.decode() unguarded. A bottle that 404s leaves that promise
 *    pending forever and hangs the entire run with no output.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTES, GUARDED, VIEWPORTS } from './routes.mjs';
import { collectFindings } from './detectors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.AUDIT_BASE_URL ?? 'http://localhost:4200';
const API = process.env.AUDIT_API_URL ?? 'http://localhost:3000';
const AXE = join(HERE, '..', 'node_modules', 'axe-core', 'axe.min.js');

// WCAG 2.5.8 puts the minimum target at 24x24; Apple HIG and Material both say
// 44. We report against 44 and treat 24-43 as the softer band in the summary.
const MIN_TAP_TARGET = 44;
const MIN_FONT_SIZE = 12;

const label = process.argv[2] ?? 'run';
const OUT = join(HERE, 'shots', label);
mkdirSync(OUT, { recursive: true });

/** Pull a real product slug so /products/:slug is audited against live data. */
async function resolveSlug() {
  try {
    const res = await fetch(`${API}/products?limit=1`);
    const body = await res.json();
    const slug = (body.data ?? body.items ?? body)?.[0]?.slug;
    if (slug) return slug;
  } catch {
    /* fall through */
  }
  console.warn('! could not resolve a product slug from the API — skipping product-detail');
  return null;
}

const slug = await resolveSlug();
const routes = ROUTES.flatMap((r) => {
  if (!r.slug) return [r];
  return slug ? [{ ...r, path: r.path.replace(':slug', slug) }] : [];
});

const browser = await chromium.launch({ channel: 'chrome' });
const report = { label, base: BASE, generatedAt: new Date().toISOString(), viewports: {} };

for (const vp of VIEWPORTS) {
  // reducedMotion skips the home page's scroll-expand gate, which otherwise
  // hides every content section behind a wheel interaction.
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  report.viewports[vp.name] = {};

  for (const route of routes) {
    const url = `${BASE}${route.path}`;
    const entry = { path: route.path, findings: [], axe: [] };
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(700);

      // Trigger lazy images by walking the page, then return to the top.
      await page.evaluate(async () => {
        const step = window.innerHeight;
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 100));
        }
        window.scrollTo(0, 0);
      });
      await page
        .waitForFunction(() => [...document.images].every((i) => i.complete), null, {
          timeout: 10_000,
        })
        .catch(() => {});

      entry.findings = await page.evaluate(collectFindings, {
        minTapTarget: MIN_TAP_TARGET,
        minFontSize: MIN_FONT_SIZE,
      });

      if (existsSync(AXE)) {
        await page.addScriptTag({ path: AXE });
        const axeRes = await page.evaluate(async () => {
          const r = await window.axe.run(document, {
            resultTypes: ['violations'],
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
          });
          return r.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            nodes: v.nodes.length,
            sample: v.nodes[0]?.target?.join(' ') ?? '',
          }));
        });
        entry.axe = axeRes;
      }

      await page.screenshot({
        path: join(OUT, `${vp.name}--${route.name}.png`),
        fullPage: true,
      });
    } catch (err) {
      entry.error = String(err).split('\n')[0].slice(0, 200);
    }
    report.viewports[vp.name][route.name] = entry;
    process.stdout.write('.');
  }
  await ctx.close();
}

await browser.close();
report.guardedNotCovered = GUARDED;
writeFileSync(join(OUT, 'findings.json'), JSON.stringify(report, null, 2));

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n\nAudit "${label}" — ${routes.length} routes x ${VIEWPORTS.length} viewports\n`);

const byType = {};
const byRoute = {};
for (const [vpName, vpRoutes] of Object.entries(report.viewports)) {
  for (const [routeName, entry] of Object.entries(vpRoutes)) {
    if (entry.error) {
      console.log(`  ERROR ${vpName}/${routeName}: ${entry.error}`);
      continue;
    }
    for (const f of entry.findings) {
      byType[f.type] = (byType[f.type] ?? 0) + 1;
      const key = `${routeName} @ ${vpName}`;
      (byRoute[key] ??= []).push(f);
    }
    for (const v of entry.axe) {
      byType[`axe:${v.id}`] = (byType[`axe:${v.id}`] ?? 0) + v.nodes;
    }
  }
}

console.log('Findings by type:');
for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(5)}  ${type}`);
}

console.log('\nWorst routes:');
const worst = Object.entries(byRoute)
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 12);
for (const [key, list] of worst) {
  const types = [...new Set(list.map((f) => f.type))].join(', ');
  console.log(`  ${String(list.length).padStart(4)}  ${key.padEnd(34)} ${types}`);
}

console.log(`\nWritten: ${join(OUT, 'findings.json')}`);
