import { randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export function generateNonce(): string {
  return randomBytes(16).toString('base64');
}

export function buildCsp(nonce: string): string {
  return (
    "default-src 'self'; " +
    `script-src 'self' 'nonce-${nonce}' https://www.googletagmanager.com https://geowidget.easypack24.net https://challenges.cloudflare.com; ` +
    "img-src 'self' https: data:; " +
    "style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self' https://backend-production-c004.up.railway.app https://www.google-analytics.com https://analytics.google.com https://geowidget.easypack24.net https://challenges.cloudflare.com; " +
    "frame-src https://challenges.cloudflare.com https://www.googletagmanager.com; " +
    "frame-ancestors 'none'; " +
    "object-src 'none'; " +
    "base-uri 'self'; " +
    "worker-src 'self' https://challenges.cloudflare.com; " +
    "form-action 'self'; " +
    "manifest-src 'self';"
  );
}

export function ssrSecurityHeaders(_req: Request, res: Response, next: NextFunction): void {
  const nonce = generateNonce();
  res.locals['cspNonce'] = nonce;
  res.setHeader('Content-Security-Policy', buildCsp(nonce));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}
