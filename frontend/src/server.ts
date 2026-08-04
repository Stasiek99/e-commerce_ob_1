import { APP_BASE_HREF } from "@angular/common";
import { CSP_NONCE } from "@angular/core";
import { CommonEngine } from "@angular/ssr/node";
import compression from "compression";
import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import bootstrap from "./main.server";
import { LOCAL_STORAGE } from "./app/core/tokens/storage.tokens";
import { RESPONSE } from "./app/core/tokens/ssr.tokens";
import { ssrCacheHeaders } from "./ssr-cache-headers";
import { ssrSecurityHeaders } from "./ssr-security-headers";

const SSR_RENDER_TIMEOUT_MS = 10_000;

export interface AppOptions {
  browserDistFolder?: string;
  serverDistFolder?: string;
}

function createRequestStorageMock(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      Object.keys(store).forEach((k) => delete store[k]);
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
}

export function app(opts: AppOptions = {}): express.Express {
  const server = express();
  const defaultServerDist = dirname(fileURLToPath(import.meta.url));

  const serverDistFolder = opts.serverDistFolder ?? defaultServerDist;
  const browserDistFolder =
    opts.browserDistFolder ?? resolve(serverDistFolder, "../browser");
  const indexHtml = join(serverDistFolder, "index.server.html");

  const commonEngine = new CommonEngine();

  // Pre-read the CSR shell once at startup so it's available instantly for
  // timeout fallbacks without a synchronous fs call per request.
  const csrShell = readFileSync(join(browserDistFolder, "index.html"), "utf-8");

  server.set("view engine", "html");
  server.set("views", browserDistFolder);

  // gzip every text response — SSR HTML, JS bundles, CSS. Vercel's edge does
  // this for us in production, but the Express server is what runs locally,
  // in `serve:ssr:frontend`, and on any non-Vercel host; without it the same
  // build ships ~1.1MB of uncompressed text instead of ~250KB.
  server.use(compression());

  server.use(ssrCacheHeaders);
  server.use(ssrSecurityHeaders);

  // Serve static files (local dev and Railway; Vercel CDN handles this in production)
  server.get(
    "*splat",
    express.static(browserDistFolder, {
      maxAge: "1y",
      index: "index.html",
      redirect: false,
    }),
  );

  // All HTML routes: server-side render via Angular CommonEngine.
  // A 10s Promise.race guards against Railway cold-start cascades: if the
  // backend is slow to respond during SSR ngOnInit calls, we fall back to the
  // CSR shell so the Lambda doesn't reach Vercel's 30s hard cut and return 504.
  server.get("*splat", (req, res, next) => {
    const { protocol, originalUrl, headers } = req;

    let timeoutHandle: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        const err = new Error("SSR render timed out") as Error & {
          name: string;
        };
        err.name = "SSRTimeoutError";
        reject(err);
      }, SSR_RENDER_TIMEOUT_MS);
    });

    const renderPromise = commonEngine.render({
      bootstrap,
      documentFilePath: indexHtml,
      url: `${protocol}://${headers.host}${originalUrl}`,
      publicPath: browserDistFolder,
      providers: [
        { provide: APP_BASE_HREF, useValue: req.baseUrl },
        { provide: LOCAL_STORAGE, useValue: createRequestStorageMock() },
        { provide: RESPONSE, useValue: res },
        { provide: CSP_NONCE, useValue: res.locals["cspNonce"] as string },
      ],
    });

    Promise.race([renderPromise, timeoutPromise])
      .then((html) => {
        clearTimeout(timeoutHandle);
        // A route guard may have already issued a real HTTP redirect via the
        // RESPONSE token (see bridgeGuardRedirectsToHttp in app.config.ts) — the
        // rendered html for whatever route Angular settled on is then stale.
        if (res.headersSent) return;
        res.send(html);
      })
      .catch((err) => {
        clearTimeout(timeoutHandle);
        if (res.headersSent) return;
        if ((err as Error & { name?: string }).name === "SSRTimeoutError") {
          console.error(
            `[SSR timeout] ${SSR_RENDER_TIMEOUT_MS}ms exceeded for ${req.url} — serving CSR shell`,
          );
          res.set("X-SSR-Fallback", "timeout");
          res.set("Cache-Control", "no-store");
          res.send(csrShell);
          return;
        }
        next(err);
      });
  });

  // SSR error handler — logs and falls back to a bare 500 rather than hanging
  server.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error("[SSR render error]", err);
      res.status(500).send("Internal Server Error");
    },
  );

  return server;
}

// Start HTTP listener only when run directly (local dev / Railway).
// When imported by api/ssr.mjs on Vercel, this guard prevents a stray listener.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const port = process.env["PORT"] || 4000;
  app().listen(port, () => {
    console.log(`Angular SSR server listening on http://localhost:${port}`);
  });
}

// Re-export pathToFileURL so api/ssr.mjs can do safe dynamic imports
export { pathToFileURL };
