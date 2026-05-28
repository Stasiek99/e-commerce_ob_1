import { envValidationSchema } from '../config.validation';

// Uses abortEarly: false so SENTRY_DSN errors surface even when other
// required fields are absent — we're testing the SENTRY_DSN guard in isolation.
const validate = (input: Record<string, unknown>) =>
  envValidationSchema.validate(input, { abortEarly: false, allowUnknown: true });

const hasSentryDsnError = (error: ReturnType<typeof validate>['error']): boolean =>
  error?.details.some(
    (d) => d.context?.key === 'SENTRY_DSN' || d.message.includes('SENTRY_DSN'),
  ) ?? false;

describe('envValidationSchema — SENTRY_DSN production guard', () => {
  describe('development environment', () => {
    it('does not raise a SENTRY_DSN error when DSN is absent in development', () => {
      const { error } = validate({ NODE_ENV: 'development' });
      expect(hasSentryDsnError(error)).toBe(false);
    });

    it('does not raise a SENTRY_DSN error when DSN is an empty string in development', () => {
      const { error } = validate({ NODE_ENV: 'development', SENTRY_DSN: '' });
      expect(hasSentryDsnError(error)).toBe(false);
    });

    it('does not raise a SENTRY_DSN error when a valid URI is provided in development', () => {
      const { error } = validate({
        NODE_ENV: 'development',
        SENTRY_DSN: 'https://abc123@o123.ingest.sentry.io/456',
      });
      expect(hasSentryDsnError(error)).toBe(false);
    });
  });

  describe('production environment', () => {
    it('raises a SENTRY_DSN validation error when DSN is absent in production', () => {
      const { error } = validate({ NODE_ENV: 'production' });
      expect(hasSentryDsnError(error)).toBe(true);
    });

    it('raises a SENTRY_DSN validation error when DSN is an empty string in production', () => {
      const { error } = validate({ NODE_ENV: 'production', SENTRY_DSN: '' });
      expect(hasSentryDsnError(error)).toBe(true);
    });

    it('raises a SENTRY_DSN validation error when DSN is a non-URI string in production', () => {
      const { error } = validate({ NODE_ENV: 'production', SENTRY_DSN: 'not-a-url' });
      expect(hasSentryDsnError(error)).toBe(true);
    });

    it('does not raise a SENTRY_DSN error when a valid URI is provided in production', () => {
      const { error } = validate({
        NODE_ENV: 'production',
        SENTRY_DSN: 'https://abc123@o123.ingest.sentry.io/456',
      });
      expect(hasSentryDsnError(error)).toBe(false);
    });
  });
});
