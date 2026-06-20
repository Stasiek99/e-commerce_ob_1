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

// ── DHL/GLS/DPD production credential guard ───────────────────────────────────
// FIX: DhlClient/GlsClient/DpdClient call configService.getOrThrow() for these
// credentials whenever their own mock flag is not 'true', and all three are
// eager providers in ShippingModule — a missing credential previously passed
// Joi validation cleanly (unconditionally .optional(), and DPD had no schema
// entries at all) only to crash the whole process moments later inside the
// carrier client's constructor. Mirrors the INPOST_ORGANIZATION_ID/
// INPOST_API_TOKEN gate above for all three remaining carriers.

const hasFieldError = (error: ReturnType<typeof validate>['error'], field: string): boolean =>
  error?.details.some((d) => d.context?.key === field || d.message.includes(field)) ?? false;

describe.each([
  { carrier: 'DHL', mockFlag: 'DHL_MOCK_ENABLED', fields: ['DHL_ACCOUNT_NUMBER', 'DHL_API_KEY', 'DHL_API_SECRET'] },
  { carrier: 'GLS', mockFlag: 'GLS_MOCK_ENABLED', fields: ['GLS_SENDER_ID', 'GLS_USERNAME', 'GLS_PASSWORD'] },
  { carrier: 'DPD', mockFlag: 'DPD_MOCK_ENABLED', fields: ['DPD_SENDER_ID', 'DPD_API_KEY'] },
])('envValidationSchema — $carrier production credential guard', ({ mockFlag, fields }) => {
  describe('development environment', () => {
    it.each(fields)('does not raise an error for missing %s in development, mock disabled', (field) => {
      const { error } = validate({ NODE_ENV: 'development', [mockFlag]: 'false' });
      expect(hasFieldError(error, field)).toBe(false);
    });
  });

  describe('production environment — mock disabled (flag omitted or "false")', () => {
    it.each(fields)('raises an error when %s is absent and mock is disabled', (field) => {
      const { error } = validate({ NODE_ENV: 'production', [mockFlag]: 'false' });
      expect(hasFieldError(error, field)).toBe(true);
    });

    it.each(fields)('raises an error when %s is absent (mock flag not set at all)', (field) => {
      const { error } = validate({ NODE_ENV: 'production' });
      expect(hasFieldError(error, field)).toBe(true);
    });

    it('does not raise an error when all credentials are provided and mock is disabled', () => {
      const creds = Object.fromEntries(fields.map((f) => [f, 'real-value']));
      const { error } = validate({ NODE_ENV: 'production', [mockFlag]: 'false', ...creds });
      for (const field of fields) {
        expect(hasFieldError(error, field)).toBe(false);
      }
    });
  });

  describe('production environment — mock enabled (flag "true")', () => {
    it.each(fields)('does not raise an error when %s is absent and mock is enabled', (field) => {
      const { error } = validate({ NODE_ENV: 'production', [mockFlag]: 'true' });
      expect(hasFieldError(error, field)).toBe(false);
    });
  });
});

// ── SELLER_NIP production validation guard ───────────────────────────────────
// FIX: SELLER_NIP previously used requiredInProd(Joi.string(), '') which let
// '' pass .required() in production. An empty NIP silently omits the seller
// tax ID from every invoice, voiding them per Art. 106e ust. 1 pkt 4 Ustawy
// o VAT. The fix inlines a full Joi.when() with .min(1).pattern(/^\d{10}$/)
// in the production branch and .allow('').optional().default('') in dev,
// allowing dev to boot without a NIP while blocking production deployments.

const hasSellerNipError = (error: ReturnType<typeof validate>['error']): boolean =>
  error?.details.some(
    (d) => d.context?.key === 'SELLER_NIP' || d.message.includes('SELLER_NIP'),
  ) ?? false;

describe('envValidationSchema — SELLER_NIP production guard', () => {
  describe('production environment', () => {
    it('rejects an empty string SELLER_NIP in production', () => {
      const { error } = validate({ NODE_ENV: 'production', SELLER_NIP: '' });
      expect(hasSellerNipError(error)).toBe(true);
    });

    it('rejects a missing SELLER_NIP in production', () => {
      const { error } = validate({ NODE_ENV: 'production' });
      expect(hasSellerNipError(error)).toBe(true);
    });

    it('rejects a 9-digit NIP (too short) in production', () => {
      const { error } = validate({ NODE_ENV: 'production', SELLER_NIP: '123456789' });
      expect(hasSellerNipError(error)).toBe(true);
    });

    it('rejects an 11-digit NIP (too long) in production', () => {
      const { error } = validate({ NODE_ENV: 'production', SELLER_NIP: '12345678901' });
      expect(hasSellerNipError(error)).toBe(true);
    });

    it('rejects a NIP containing non-digit characters in production', () => {
      const { error } = validate({ NODE_ENV: 'production', SELLER_NIP: '123-456-789' });
      expect(hasSellerNipError(error)).toBe(true);
    });

    it('accepts a valid 10-digit NIP with a correct checksum in production', () => {
      const { error } = validate({ NODE_ENV: 'production', SELLER_NIP: '5250007738' });
      expect(hasSellerNipError(error)).toBe(false);
    });

    it('rejects a 10-digit NIP with an incorrect checksum in production', () => {
      const { error } = validate({ NODE_ENV: 'production', SELLER_NIP: '1234567890' });
      expect(hasSellerNipError(error)).toBe(true);
    });
  });

  describe('development environment', () => {
    it('accepts an empty string SELLER_NIP in development', () => {
      const { error } = validate({ NODE_ENV: 'development', SELLER_NIP: '' });
      expect(hasSellerNipError(error)).toBe(false);
    });

    it('accepts a missing SELLER_NIP in development (dev default applies)', () => {
      const { error } = validate({ NODE_ENV: 'development' });
      expect(hasSellerNipError(error)).toBe(false);
    });

    it('applies empty string as default when SELLER_NIP is absent in development', () => {
      const { value } = validate({ NODE_ENV: 'development' });
      expect(value.SELLER_NIP).toBe('');
    });
  });
});

// ── STRIPE_CURRENCY zero-decimal guard ────────────────────────────────────────
// FIX: every money computation in payments/invoice (snapshotPrice, unitAmount,
// amount_off, totalInCents, invoice VAT math) assumes a 2-decimal minor unit
// (gr/100 = zł) and passes those integers straight to Stripe's unit_amount/
// amount_off/amount fields. Stripe's zero-decimal currencies (JPY, KRW, VND,
// etc.) treat that integer as a whole unit instead, which would silently
// overcharge customers 100x. STRIPE_CURRENCY now rejects zero-decimal
// currencies at boot in both environments — this guard applies regardless of
// NODE_ENV since the bug is in money math, not a prod-only credential.

const hasStripeCurrencyError = (error: ReturnType<typeof validate>['error']): boolean =>
  error?.details.some(
    (d) => d.context?.key === 'STRIPE_CURRENCY' || d.message.includes('STRIPE_CURRENCY'),
  ) ?? false;

describe('envValidationSchema — STRIPE_CURRENCY zero-decimal guard', () => {
  it('rejects JPY (zero-decimal currency)', () => {
    const { error } = validate({ NODE_ENV: 'production', STRIPE_CURRENCY: 'jpy' });
    expect(hasStripeCurrencyError(error)).toBe(true);
  });

  it('rejects KRW regardless of casing', () => {
    const { error } = validate({ NODE_ENV: 'production', STRIPE_CURRENCY: 'KRW' });
    expect(hasStripeCurrencyError(error)).toBe(true);
  });

  it('rejects VND in development too — the bug is in money math, not a prod-only guard', () => {
    const { error } = validate({ NODE_ENV: 'development', STRIPE_CURRENCY: 'vnd' });
    expect(hasStripeCurrencyError(error)).toBe(true);
  });

  it('accepts PLN (the default 2-decimal currency)', () => {
    const { error } = validate({ NODE_ENV: 'production', STRIPE_CURRENCY: 'pln' });
    expect(hasStripeCurrencyError(error)).toBe(false);
  });

  it('accepts USD (a supported 2-decimal currency)', () => {
    const { error } = validate({ NODE_ENV: 'production', STRIPE_CURRENCY: 'usd' });
    expect(hasStripeCurrencyError(error)).toBe(false);
  });

  it('defaults to pln when STRIPE_CURRENCY is absent', () => {
    const { value, error } = validate({ NODE_ENV: 'development' });
    expect(hasStripeCurrencyError(error)).toBe(false);
    expect(value.STRIPE_CURRENCY).toBe('pln');
  });

  it('error message explains the zero-decimal mismatch', () => {
    const { error } = validate({ NODE_ENV: 'production', STRIPE_CURRENCY: 'jpy' });
    const currencyError = error?.details.find((d) => d.context?.key === 'STRIPE_CURRENCY');
    expect(currencyError?.message).toContain('zero-decimal');
  });
});

// ── ORDER_CANCEL_SECRET production guard ──────────────────────────────────────
// FIX: guest order cancel tokens previously reused JWT_ACCESS_SECRET as their
// HMAC key, coupling cancel-link validity to JWT secret rotation and letting a
// leaked cancel token double as a JWT-forgery key. ORDER_CANCEL_SECRET is now
// a dedicated, required-in-prod secret (>=32 chars).

const hasOrderCancelSecretError = (error: ReturnType<typeof validate>['error']): boolean =>
  error?.details.some(
    (d) => d.context?.key === 'ORDER_CANCEL_SECRET' || d.message.includes('ORDER_CANCEL_SECRET'),
  ) ?? false;

describe('envValidationSchema — ORDER_CANCEL_SECRET production guard', () => {
  describe('production environment', () => {
    it('rejects a missing ORDER_CANCEL_SECRET in production', () => {
      const { error } = validate({ NODE_ENV: 'production' });
      expect(hasOrderCancelSecretError(error)).toBe(true);
    });

    it('rejects an ORDER_CANCEL_SECRET shorter than 32 characters in production', () => {
      const { error } = validate({ NODE_ENV: 'production', ORDER_CANCEL_SECRET: 'short-secret' });
      expect(hasOrderCancelSecretError(error)).toBe(true);
    });

    it('accepts a 32+ character ORDER_CANCEL_SECRET in production', () => {
      const { error } = validate({
        NODE_ENV: 'production',
        ORDER_CANCEL_SECRET: 'a'.repeat(32),
      });
      expect(hasOrderCancelSecretError(error)).toBe(false);
    });
  });

  describe('development environment', () => {
    it('applies a dev default when ORDER_CANCEL_SECRET is absent in development', () => {
      const { error, value } = validate({ NODE_ENV: 'development' });
      expect(hasOrderCancelSecretError(error)).toBe(false);
      expect(value.ORDER_CANCEL_SECRET).toBe('dev-order-cancel-secret');
    });
  });
});
