import { ErrorHandler, Injectable } from '@angular/core';
import type { Router } from '@angular/router';
import { environment } from '../../environments/environment';

/**
 * Lazy Sentry wiring.
 *
 * `@sentry/angular` and its transitive `@sentry/browser` / `@sentry/core`
 * packages were statically imported by `main.ts` and `app.config.ts`, which put
 * roughly 120KB of minified JavaScript into the entry chunk — parsed and
 * evaluated on the critical path of every page load, for a library that only
 * does anything once something has already gone wrong.
 *
 * The SDK is now imported dynamically once the app has gone idle. Errors thrown
 * before it arrives are not dropped: they are buffered here (by the Angular
 * ErrorHandler below and by the window listeners `installEarlyErrorCapture()`
 * registers before bootstrap) and replayed into Sentry as soon as it loads.
 */

type SentryModule = typeof import('@sentry/angular');

const MAX_BUFFERED_ERRORS = 20;

let sentry: SentryModule | null = null;
let loading: Promise<SentryModule | null> | null = null;
const buffered: unknown[] = [];

function capture(error: unknown): void {
  if (sentry) {
    sentry.captureException(error);
    return;
  }
  // Bounded so a boot loop that throws on every frame can't grow without limit.
  if (buffered.length < MAX_BUFFERED_ERRORS) buffered.push(error);
}

/**
 * Registers global listeners before `bootstrapApplication` so failures during
 * bootstrap itself still reach Sentry once it loads. Safe to call more than
 * once — the listeners are idempotent in effect, and a no-op without a DSN.
 */
export function installEarlyErrorCapture(): void {
  if (typeof window === 'undefined' || !environment.sentryDsn) return;
  window.addEventListener('error', (event) => capture(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => capture(event.reason));
}

/**
 * Loads and initialises Sentry. Resolves to `null` when no DSN is configured
 * (local dev, preview deploys) — in that case the SDK is never fetched at all.
 */
export function loadSentry(router: Router): Promise<SentryModule | null> {
  if (loading) return loading;
  if (!environment.sentryDsn) return Promise.resolve(null);

  loading = import('@sentry/angular')
    .then((mod) => {
      mod.init({
        dsn: environment.sentryDsn,
        environment: environment.production ? 'production' : 'development',
        integrations: [mod.browserTracingIntegration()],
        tracesSampleRate: environment.sentryTracesSampleRate,
        tracePropagationTargets: environment.sentryTracePropagationTargets,
        sendDefaultPii: false,
      });
      // Router instrumentation: the Angular-specific navigation spans that
      // Sentry's TraceService would normally add via DI.
      new mod.TraceService(router);
      sentry = mod;
      buffered.splice(0).forEach((error) => mod.captureException(error));
      return mod;
    })
    .catch(() => {
      loading = null; // a failed chunk fetch shouldn't permanently disable reporting
      return null;
    });

  return loading;
}

/** Schedules `loadSentry` for the first idle moment after the app is running. */
export function scheduleSentryLoad(router: Router): void {
  if (typeof window === 'undefined' || !environment.sentryDsn) return;
  const start = () => void loadSentry(router);
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(start, { timeout: 5000 });
  } else {
    window.setTimeout(start, 2000); // Safari < 16.4
  }
}

/**
 * Forwards to Sentry when it is loaded and buffers otherwise, so an error that
 * happens during the gap is reported rather than lost.
 */
@Injectable()
export class LazySentryErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    console.error(error);
    capture(error);
  }
}
