import { randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export function generateNonce(): string {
  return randomBytes(16).toString('base64');
}

// Angular's withEventReplay() emits two inline bootstrap scripts
// (#ng-event-dispatch-contract and a window.__jsaction_bootstrap(...) call) that it
// never attaches the CSP_NONCE token to, regardless of provider wiring — see
// https://github.com/angular/angular/issues/59886 and
// https://github.com/angular/angular/issues/66540. The nonce above covers every
// other Angular-injected inline element; these two fixed hash sources are the only
// way to unblock those specific scripts. Their content is framework-boilerplate
// (not per-request), so the hash is stable across deploys unless Angular's version
// or withEventReplay() config changes — re-derive via frontend/dist/frontend/browser/index.html
// if hydration breaks after an Angular upgrade.
const EVENT_REPLAY_SCRIPT_HASHES =
  "'sha256-VM2mZqyEQZoLzoTrp5EigFvzQ0+f1wSeBuoOn95WHCg=' 'sha256-sJtQRwXhGs3qiB9BaI1yomAMvp6wpH7vkm5wTnIjvWg='";

export function buildCsp(nonce: string): string {
  return (
    "default-src 'self'; " +
    `script-src 'self' 'nonce-${nonce}' ${EVENT_REPLAY_SCRIPT_HASHES} https://www.googletagmanager.com https://geowidget.easypack24.net https://challenges.cloudflare.com; ` +
    "img-src 'self' https: data:; " +
    "style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self' https://backend-production-c004.up.railway.app https://www.google-analytics.com https://analytics.google.com https://geowidget.easypack24.net https://challenges.cloudflare.com; " +
    "frame-src https://challenges.cloudflare.com https://www.googletagmanager.com https://api.dpd.cz; " +
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
