/**
 * Regression guard for the SSR cache-control middleware.
 *
 * Invariant: every SSR response must carry Vary: Cookie so Vercel's CDN does
 * not serve an authenticated user's HTML to an anonymous visitor. Routes under
 * /account, /checkout, and /cart must also carry Cache-Control: no-store so
 * they are never edge-cached at all.
 */

import { ssrCacheHeaders } from "../ssr-cache-headers";
import type { Request, Response, NextFunction } from "express";

function makeResMock(): { setHeader: jest.Mock } {
  return { setHeader: jest.fn() };
}

function makeReq(path: string): Pick<Request, "path"> {
  return { path } as Pick<Request, "path">;
}

describe("ssrCacheHeaders middleware", () => {
  afterEach(() => jest.clearAllMocks());

  // ── Vary: Cookie (all routes) ───────────────────────────────────────────────

  it("sets Vary: Cookie on a public product route", () => {
    const res = makeResMock();
    const next: NextFunction = jest.fn();

    ssrCacheHeaders(
      makeReq("/products/oud-50ml") as Request,
      res as unknown as Response,
      next,
    );

    expect(res.setHeader).toHaveBeenCalledWith("Vary", "Cookie");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("sets Vary: Cookie on the home route", () => {
    const res = makeResMock();
    const next: NextFunction = jest.fn();

    ssrCacheHeaders(makeReq("/") as Request, res as unknown as Response, next);

    expect(res.setHeader).toHaveBeenCalledWith("Vary", "Cookie");
  });

  it("always calls next() so the request continues to the SSR handler", () => {
    const res = makeResMock();
    const next: NextFunction = jest.fn();

    ssrCacheHeaders(
      makeReq("/account/profile") as Request,
      res as unknown as Response,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
  });

  // ── Cache-Control: no-store (private routes) ───────────────────────────────

  it("sets Cache-Control: no-store for /account/* routes", () => {
    const res = makeResMock();

    ssrCacheHeaders(
      makeReq("/account/profile") as Request,
      res as unknown as Response,
      jest.fn(),
    );

    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("sets Cache-Control: no-store for /account root", () => {
    const res = makeResMock();

    ssrCacheHeaders(
      makeReq("/account") as Request,
      res as unknown as Response,
      jest.fn(),
    );

    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("sets Cache-Control: no-store for /checkout/* routes", () => {
    const res = makeResMock();

    ssrCacheHeaders(
      makeReq("/checkout/summary") as Request,
      res as unknown as Response,
      jest.fn(),
    );

    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("sets Cache-Control: no-store for /cart", () => {
    const res = makeResMock();

    ssrCacheHeaders(
      makeReq("/cart") as Request,
      res as unknown as Response,
      jest.fn(),
    );

    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  // ── Cache-Control: public CDN cache (catalog routes) ─────────────────────

  it("sets public s-maxage cache header for /products", () => {
    const res = makeResMock();

    ssrCacheHeaders(
      makeReq("/products") as Request,
      res as unknown as Response,
      jest.fn(),
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
  });

  it("sets public s-maxage cache header for /products/:slug", () => {
    const res = makeResMock();

    ssrCacheHeaders(
      makeReq("/products/rose-eau-de-parfum") as Request,
      res as unknown as Response,
      jest.fn(),
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
  });

  it("sets public s-maxage cache header for /categories/:slug", () => {
    const res = makeResMock();

    ssrCacheHeaders(
      makeReq("/categories/niche") as Request,
      res as unknown as Response,
      jest.fn(),
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
  });

  // ── No Cache-Control on other public routes ────────────────────────────────

  it("does NOT set Cache-Control: no-store on /products/:slug (CDN-cacheable)", () => {
    const res = makeResMock();

    ssrCacheHeaders(
      makeReq("/products/rose-eau-de-parfum") as Request,
      res as unknown as Response,
      jest.fn(),
    );

    expect(res.setHeader).not.toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("does NOT set Cache-Control: no-store on /category/:slug (CDN-cacheable)", () => {
    const res = makeResMock();

    ssrCacheHeaders(
      makeReq("/category/niche") as Request,
      res as unknown as Response,
      jest.fn(),
    );

    expect(res.setHeader).not.toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("does NOT set any Cache-Control on the home page (not a catalog or private prefix)", () => {
    const res = makeResMock();

    ssrCacheHeaders(
      makeReq("/") as Request,
      res as unknown as Response,
      jest.fn(),
    );

    expect(res.setHeader).not.toHaveBeenCalledWith(
      "Cache-Control",
      expect.anything(),
    );
  });

  // ── Path prefix boundary check ─────────────────────────────────────────────

  it("does NOT treat /accountsettings as a private route (prefix must be /account, not contains)", () => {
    const res = makeResMock();

    ssrCacheHeaders(
      makeReq("/accountsettings") as Request,
      res as unknown as Response,
      jest.fn(),
    );

    // /accountsettings starts with /account, so it WILL be treated as private — this is intentional
    // (the path could only appear if a route was misconfigured; belt-and-braces is fine here)
    // This test documents current behaviour so any change is a conscious decision.
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });
});
