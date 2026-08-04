import type { Request, Response, NextFunction } from "express";

const PRIVATE_SSR_PREFIXES = ["/account", "/checkout", "/cart"];
const PUBLIC_CATALOG_PREFIXES = ["/products", "/categories"];

/**
 * Sets Vary: Cookie on every SSR response so Vercel's CDN keys cached HTML on
 * the cookie presence, preventing authenticated responses from being served to
 * anonymous visitors. Adds Cache-Control: no-store for routes that always carry
 * user-specific state and must never be edge-cached. Public catalog routes get
 * a short CDN TTL (60s) with stale-while-revalidate to absorb cold-start spikes
 * while still reflecting price/stock changes within a minute.
 */
export function ssrCacheHeaders(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("Vary", "Cookie");
  if (PRIVATE_SSR_PREFIXES.some((p) => req.path.startsWith(p))) {
    res.setHeader("Cache-Control", "no-store");
  } else if (PUBLIC_CATALOG_PREFIXES.some((p) => req.path.startsWith(p))) {
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300",
    );
  }
  next();
}
