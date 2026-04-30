/**
 * Vercel serverless function entry point for Angular SSR.
 *
 * Vercel serves static files from `outputDirectory` (dist/frontend/browser)
 * directly via its CDN. Only paths that don't match a static file reach this
 * function, so prerendered routes (/, /products, /cart, /legal/*) are served
 * from the CDN edge without touching Node at all.
 *
 * Dynamic routes (/products/:slug, /category/:slug, /account/*, etc.) land
 * here and are rendered on-demand by Angular's CommonEngine.
 *
 * `includeFiles` in vercel.json bundles the full server + browser dist so
 * paths are available at runtime relative to this file's directory.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// api/ is one level below the repo root
const repoRoot = resolve(__dirname, '..');

let expressApp;

export default async function handler(req, res) {
  if (!expressApp) {
    const serverDist = resolve(repoRoot, 'frontend/dist/frontend/server');
    const browserDist = resolve(repoRoot, 'frontend/dist/frontend/browser');

    // Use pathToFileURL for reliable ESM dynamic import of absolute paths
    const serverMjsUrl = pathToFileURL(resolve(serverDist, 'server.mjs')).href;
    const { app } = await import(serverMjsUrl);

    expressApp = app({ serverDistFolder: serverDist, browserDistFolder: browserDist });
  }

  expressApp(req, res);
}
