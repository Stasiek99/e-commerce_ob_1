/**
 * Sentry instrumentation — MUST be imported as the very first line of main.ts,
 * before any other module. Sentry's NestJS integration relies on OpenTelemetry
 * patching, which requires hooks to be installed before anything else loads.
 *
 * Skips initialization when SENTRY_DSN is empty so local dev and Phase 0
 * environments don't need a real project — the SDK becomes a no-op.
 */
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const dsn = process.env.SENTRY_DSN;

const SENSITIVE_KEYS = ['password', 'newPassword', 'nip', 'bankAccount', 'token'];

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? '0.1'),
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers) {
        delete (event.request.headers as Record<string, unknown>)['authorization'];
        delete (event.request.headers as Record<string, unknown>)['cookie'];
      }
      if (event.request?.data) {
        try {
          const body =
            typeof event.request.data === 'string'
              ? (JSON.parse(event.request.data) as Record<string, unknown>)
              : (event.request.data as Record<string, unknown>);
          for (const key of SENSITIVE_KEYS) {
            if (key in body) body[key] = '[REDACTED]';
          }
          event.request.data = JSON.stringify(body);
        } catch {
          // Non-JSON body — drop it entirely to avoid leaking raw form data
          event.request.data = '[REDACTED]';
        }
      }
      return event;
    },
  });
}
