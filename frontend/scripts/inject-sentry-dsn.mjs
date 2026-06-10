#!/usr/bin/env node
/**
 * Injects SENTRY_DSN from the build environment into environment.prod.ts.
 *
 * Runs as part of the `prebuild` hook. When SENTRY_DSN is not set (local dev,
 * or Vercel preview without the secret) the script is a no-op — the compiled
 * app will have an empty DSN and Sentry will stay silent.
 *
 * Usage (set in Vercel → Environment Variables → Production):
 *   SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, '../src/environments/environment.prod.ts');

const dsn = process.env.SENTRY_DSN ?? '';

if (!dsn) {
  console.log('[inject-sentry-dsn] SENTRY_DSN not set — skipping.');
  process.exit(0);
}

const original = readFileSync(ENV_PATH, 'utf8');
const patched = original.replace(
  /sentryDsn:\s*'[^']*'/,
  `sentryDsn: '${dsn}'`,
);

if (patched === original) {
  console.warn('[inject-sentry-dsn] WARNING: sentryDsn pattern not found in environment.prod.ts — no substitution made.');
  process.exit(0);
}

writeFileSync(ENV_PATH, patched);
console.log('[inject-sentry-dsn] Injected SENTRY_DSN into environment.prod.ts.');
