/**
 * Uploads Angular production source maps to Sentry after `ng build`.
 *
 * Requires env vars at build time (set in Vercel → Settings → Environment Variables):
 *   SENTRY_AUTH_TOKEN  — from Sentry Dashboard → Settings → Auth Tokens (scope: project:releases)
 *   SENTRY_ORG         — your Sentry org slug
 *   SENTRY_PROJECT     — your Sentry project slug
 *
 * Skips silently when SENTRY_AUTH_TOKEN is not set so local dev builds are unaffected.
 */
import { execSync } from 'child_process';

const token = process.env.SENTRY_AUTH_TOKEN;

if (!token) {
  console.log('Sentry source map upload skipped — SENTRY_AUTH_TOKEN not set.');
  process.exit(0);
}

const dir = 'dist/frontend/browser';

try {
  execSync(`sentry-cli sourcemaps inject ${dir}`, { stdio: 'inherit' });
  execSync(`sentry-cli sourcemaps upload --dist=${process.env.npm_package_version ?? '0'} ${dir}`, { stdio: 'inherit' });
  console.log('Sentry source maps uploaded successfully.');
} catch (err) {
  // Non-fatal — a failed upload should not block the deployment.
  console.error('Sentry source map upload failed (non-fatal):', err.message);
  process.exit(0);
}
