#!/usr/bin/env node
/**
 * Injects TURNSTILE_SITE_KEY from the build environment into environment.prod.ts.
 *
 * Runs as part of the `prebuild` hook. When TURNSTILE_SITE_KEY is not set
 * (local dev, or CI without the secret) the script is a no-op — the compiled
 * app will have an empty site key and Turnstile challenges are skipped client-side.
 *
 * Usage (set in Vercel → Environment Variables → Production):
 *   TURNSTILE_SITE_KEY=0x4AAAAAAA...   (from Cloudflare Dashboard → Turnstile)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, '../src/environments/environment.prod.ts');

const siteKey = process.env.TURNSTILE_SITE_KEY ?? '';

if (!siteKey) {
  console.log('[inject-turnstile] TURNSTILE_SITE_KEY not set — skipping.');
  process.exit(0);
}

const original = readFileSync(ENV_PATH, 'utf8');
const patched = original.replace(
  /turnstileSiteKey:\s*'[^']*'/,
  `turnstileSiteKey: '${siteKey}'`,
);

if (patched === original) {
  console.warn('[inject-turnstile] WARNING: turnstileSiteKey pattern not found in environment.prod.ts — no substitution made.');
  process.exit(0);
}

writeFileSync(ENV_PATH, patched);
console.log('[inject-turnstile] Injected TURNSTILE_SITE_KEY into environment.prod.ts.');
