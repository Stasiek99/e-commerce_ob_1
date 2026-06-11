import { envValidationSchema } from '../config.validation';

// Uses abortEarly: false so individual field errors surface even when other
// required fields are absent — we're testing each guard in isolation.
const validate = (input: Record<string, unknown>) =>
  envValidationSchema.validate(input, { abortEarly: false, allowUnknown: true });

// A structurally valid bcrypt hash (format: $2b$<cost>$<53-char salt+digest>).
// Not a real hash — generated for test fixture purposes only.
const VALID_BCRYPT_HASH = '$2b$12$LqvHW.I6oSyH3nNLb3MlUue9oQNfeFbOZ2OFI2TyHOh2GdBbfq3EC';

const hasSentryDsnError = (error: ReturnType<typeof validate>['error']): boolean =>
  error?.details.some(
    (d) => d.context?.key === 'SENTRY_DSN' || d.message.includes('SENTRY_DSN'),
  ) ?? false;

const hasInpostOrgError = (error: ReturnType<typeof validate>['error']): boolean =>
  error?.details.some(
    (d) => d.context?.key === 'INPOST_ORGANIZATION_ID' || d.message.includes('INPOST_ORGANIZATION_ID'),
  ) ?? false;

const hasInpostTokenError = (error: ReturnType<typeof validate>['error']): boolean =>
  error?.details.some(
    (d) => d.context?.key === 'INPOST_API_TOKEN' || d.message.includes('INPOST_API_TOKEN'),
  ) ?? false;

// ── ADMIN_DEFAULT_PASSWORD bcrypt format guard ────────────────────────────────
// FIX: config.validation.ts previously accepted any string ≥10 chars for
// ADMIN_DEFAULT_PASSWORD. A plaintext password is silently accepted at boot,
// then bcrypt.compare(plaintext, plaintext) returns false, locking every admin
// out of the panel. The pattern guard catches this at startup instead.

const hasAdminPasswordError = (error: ReturnType<typeof validate>['error']): boolean =>
  error?.details.some(
    (d) => d.context?.key === 'ADMIN_DEFAULT_PASSWORD' || d.message.includes('ADMIN_DEFAULT_PASSWORD'),
  ) ?? false;

describe('envValidationSchema — ADMIN_DEFAULT_PASSWORD bcrypt format guard', () => {
  describe('production environment', () => {
    it('rejects a plaintext password in production', () => {
      const { error } = validate({ NODE_ENV: 'production', ADMIN_DEFAULT_PASSWORD: 'MyP@ssword123' });
      expect(hasAdminPasswordError(error)).toBe(true);
    });

    it('rejects a password that starts with $2b$ but is too short', () => {
      const { error } = validate({ NODE_ENV: 'production', ADMIN_DEFAULT_PASSWORD: '$2b$12$tooshort' });
      expect(hasAdminPasswordError(error)).toBe(true);
    });

    it('rejects a password that uses an unsupported bcrypt prefix ($2y$)', () => {
      const { error } = validate({
        NODE_ENV: 'production',
        ADMIN_DEFAULT_PASSWORD: '$2y$12$LqvHW.I6oSyH3nNLb3MlUue9oQNfeFbOZ2OFI2TyHOh2GdBbfq3EC',
      });
      expect(hasAdminPasswordError(error)).toBe(true);
    });

    it('accepts a valid $2b$ bcrypt hash in production', () => {
      const { error } = validate({ NODE_ENV: 'production', ADMIN_DEFAULT_PASSWORD: VALID_BCRYPT_HASH });
      expect(hasAdminPasswordError(error)).toBe(false);
    });

    it('accepts a valid $2a$ bcrypt hash in production', () => {
      const { error } = validate({
        NODE_ENV: 'production',
        ADMIN_DEFAULT_PASSWORD: '$2a$12$LqvHW.I6oSyH3nNLb3MlUue9oQNfeFbOZ2OFI2TyHOh2GdBbfq3EC',
      });
      expect(hasAdminPasswordError(error)).toBe(false);
    });

    it('error message contains bcrypt generation guidance', () => {
      const { error } = validate({ NODE_ENV: 'production', ADMIN_DEFAULT_PASSWORD: 'plaintextpass' });
      const adminPwdError = error?.details.find(
        (d) => d.context?.key === 'ADMIN_DEFAULT_PASSWORD' || d.message.includes('ADMIN_DEFAULT_PASSWORD'),
      );
      expect(adminPwdError?.message).toContain('bcrypt');
    });
  });

  describe('development environment', () => {
    it('accepts a plaintext password in development (no bcrypt pattern check)', () => {
      const { error } = validate({ NODE_ENV: 'development', ADMIN_DEFAULT_PASSWORD: 'plaintextpass' });
      expect(hasAdminPasswordError(error)).toBe(false);
    });

    it('also accepts a valid bcrypt hash in development', () => {
      const { error } = validate({ NODE_ENV: 'development', ADMIN_DEFAULT_PASSWORD: VALID_BCRYPT_HASH });
      expect(hasAdminPasswordError(error)).toBe(false);
    });
  });
});

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

// ── InPost production credential guard ──────────────────────────────────────
// FIX: INPOST_ORGANIZATION_ID and INPOST_API_TOKEN must be required in production
// when INPOST_MOCK_ENABLED is not "true". The previous schema defaulted both to
// placeholder strings ('mock-org-id', 'mock-api-token'), allowing a production
// deploy with missing credentials that would silently write fake tracking URLs to
// the DB and send shipping emails with invalid tracking numbers.

describe('envValidationSchema — InPost production credential guard', () => {
  describe('development environment', () => {
    it('applies mock-org-id default when INPOST_ORGANIZATION_ID is absent in development', () => {
      const { value, error } = validate({ NODE_ENV: 'development' });
      expect(hasInpostOrgError(error)).toBe(false);
      expect(value.INPOST_ORGANIZATION_ID).toBe('mock-org-id');
    });

    it('applies mock-api-token default when INPOST_API_TOKEN is absent in development', () => {
      const { value, error } = validate({ NODE_ENV: 'development' });
      expect(hasInpostTokenError(error)).toBe(false);
      expect(value.INPOST_API_TOKEN).toBe('mock-api-token');
    });

    it('does not raise an error for missing org ID in development even when mock is disabled', () => {
      const { error } = validate({ NODE_ENV: 'development', INPOST_MOCK_ENABLED: 'false' });
      expect(hasInpostOrgError(error)).toBe(false);
    });
  });

  describe('production environment — mock disabled (INPOST_MOCK_ENABLED omitted or "false")', () => {
    it('raises an error when INPOST_ORGANIZATION_ID is absent and mock is disabled', () => {
      const { error } = validate({ NODE_ENV: 'production', INPOST_MOCK_ENABLED: 'false' });
      expect(hasInpostOrgError(error)).toBe(true);
    });

    it('raises an error when INPOST_API_TOKEN is absent and mock is disabled', () => {
      const { error } = validate({ NODE_ENV: 'production', INPOST_MOCK_ENABLED: 'false' });
      expect(hasInpostTokenError(error)).toBe(true);
    });

    it('raises an error when INPOST_ORGANIZATION_ID is absent (INPOST_MOCK_ENABLED not set)', () => {
      const { error } = validate({ NODE_ENV: 'production' });
      expect(hasInpostOrgError(error)).toBe(true);
    });

    it('does not raise an error when both credentials are provided and mock is disabled', () => {
      const { error } = validate({
        NODE_ENV: 'production',
        INPOST_MOCK_ENABLED: 'false',
        INPOST_ORGANIZATION_ID: 'real-org-id',
        INPOST_API_TOKEN: 'real-api-token',
      });
      expect(hasInpostOrgError(error)).toBe(false);
      expect(hasInpostTokenError(error)).toBe(false);
    });
  });

  describe('production environment — mock enabled (INPOST_MOCK_ENABLED="true")', () => {
    it('does not raise an error when INPOST_ORGANIZATION_ID is absent and mock is enabled', () => {
      const { error } = validate({ NODE_ENV: 'production', INPOST_MOCK_ENABLED: 'true' });
      expect(hasInpostOrgError(error)).toBe(false);
    });

    it('does not raise an error when INPOST_API_TOKEN is absent and mock is enabled', () => {
      const { error } = validate({ NODE_ENV: 'production', INPOST_MOCK_ENABLED: 'true' });
      expect(hasInpostTokenError(error)).toBe(false);
    });
  });
});
