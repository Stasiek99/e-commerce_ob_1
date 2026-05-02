import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine } from '@angular/ssr/node';
import express from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import bootstrap from './main.server';

export interface AppOptions {
  browserDistFolder?: string;
  serverDistFolder?: string;
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
    const { protocol, originalUrl, baseUrl, headers } = req;
    commonEngine
      .render({
        bootstrap,
        documentFilePath: indexHtml,
        url: `${protocol}://${headers.host}${originalUrl}`,
        publicPath: browserDistFolder,
        providers: [{ provide: APP_BASE_HREF, useValue: req.baseUrl }],
      })
      .then(html => res.send(html))
      .catch(err => next(err));
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
