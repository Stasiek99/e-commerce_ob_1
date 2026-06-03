import type { Request, Response, NextFunction } from 'express';

const CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://geowidget.easypack24.net https://challenges.cloudflare.com; " +
  "img-src 'self' https: data:; " +
  "style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self' https://backend-production-c004.up.railway.app https://www.google-analytics.com https://analytics.google.com https://geowidget.easypack24.net https://challenges.cloudflare.com; " +
  "frame-src https://challenges.cloudflare.com https://www.googletagmanager.com; " +
  "frame-ancestors 'none'; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "worker-src 'self' https://challenges.cloudflare.com;";

export function ssrSecurityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}
