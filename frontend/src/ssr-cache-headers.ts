import type { Request, Response, NextFunction } from 'express';

const PRIVATE_SSR_PREFIXES = ['/account', '/checkout', '/cart'];

/**
 * Sets Vary: Cookie on every SSR response so Vercel's CDN keys cached HTML on
 * the cookie presence, preventing authenticated responses from being served to
 * anonymous visitors. Adds Cache-Control: no-store for routes that always carry
 * user-specific state and must never be edge-cached.
 */
export function ssrCacheHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Vary', 'Cookie');
  if (PRIVATE_SSR_PREFIXES.some(p => req.path.startsWith(p))) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}
