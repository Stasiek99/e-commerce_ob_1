import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine } from '@angular/ssr/node';
import express from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import bootstrap from './main.server';
import { LOCAL_STORAGE } from './app/core/tokens/storage.tokens';
import { RESPONSE } from './app/core/tokens/ssr.tokens';
import { ssrCacheHeaders } from './ssr-cache-headers';
import { ssrSecurityHeaders } from './ssr-security-headers';

export interface AppOptions {
  browserDistFolder?: string;
  serverDistFolder?: string;
}

function createRequestStorageMock(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
}

export function app(opts: AppOptions = {}): express.Express {
  const server = express();
  const defaultServerDist = dirname(fileURLToPath(import.meta.url));

  const serverDistFolder = opts.serverDistFolder ?? defaultServerDist;
  const browserDistFolder = opts.browserDistFolder ?? resolve(serverDistFolder, '../browser');
  const indexHtml = join(serverDistFolder, 'index.server.html');

  const commonEngine = new CommonEngine();

  server.set('view engine', 'html');
  server.set('views', browserDistFolder);

  server.use(ssrCacheHeaders);
  server.use(ssrSecurityHeaders);

  // Serve static files (local dev and Railway; Vercel CDN handles this in production)
  server.get(
    '**',
    express.static(browserDistFolder, {
      maxAge: '1y',
      index: 'index.html',
      redirect: false,
    }),
  );

  // All HTML routes: server-side render via Angular CommonEngine
  server.get('**', (req, res, next) => {
    const { protocol, originalUrl, headers } = req;
    commonEngine
      .render({
        bootstrap,
        documentFilePath: indexHtml,
        url: `${protocol}://${headers.host}${originalUrl}`,
        publicPath: browserDistFolder,
        providers: [
          { provide: APP_BASE_HREF, useValue: req.baseUrl },
          { provide: LOCAL_STORAGE, useValue: createRequestStorageMock() },
          { provide: RESPONSE, useValue: res },
        ],
      })
      .then(html => res.send(html))
      .catch(err => next(err));
  });

  // SSR error handler — logs and falls back to a bare 500 rather than hanging
  server.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[SSR render error]', err);
    res.status(500).send('Internal Server Error');
  });

  return server;
}

// Start HTTP listener only when run directly (local dev / Railway).
// When imported by api/ssr.mjs on Vercel, this guard prevents a stray listener.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const port = process.env['PORT'] || 4000;
  app().listen(port, () => {
    console.log(`Angular SSR server listening on http://localhost:${port}`);
  });
}

// Re-export pathToFileURL so api/ssr.mjs can do safe dynamic imports
export { pathToFileURL };
