import * as Joi from 'joi';

// Joi helper: field is required in production, optional (or has a dev default)
// otherwise. Keeps dev/test ergonomic without letting prod boot in an unsafe
// state.
const requiredInProd = <T extends Joi.AnySchema>(schema: T, devDefault?: unknown) =>
  schema.when('NODE_ENV', {
    is: 'production',
    then: (schema as Joi.AnySchema).required(),
    otherwise:
      devDefault === undefined
        ? (schema as Joi.AnySchema).optional()
        : (schema as Joi.AnySchema).default(devDefault),
  });

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  // ── Database (always required) ──
  DATABASE_URL: Joi.string().uri().required(),
  DIRECT_URL: Joi.string().uri().required(),
  // Prisma connections per instance. Formula: instances × limit ≤ pgbouncer max_client_conn.
  // Supabase free: ~60 total. Supabase Pro: ~200 total. Default 10 → safe up to 6/20 replicas.
  DATABASE_CONNECTION_LIMIT: Joi.number().integer().min(1).max(100).default(10),

  // ── JWT (always required) ──
  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // ── Google OAuth (always required) ──
  GOOGLE_CLIENT_ID: Joi.string().required(),
  GOOGLE_CLIENT_SECRET: Joi.string().required(),
  GOOGLE_CALLBACK_URL: Joi.string().uri().required(),

  // ── Stripe ──
  // In production, keys must be live-mode. Test keys (`sk_test_`, `pk_test_`)
  // are rejected at boot so we never accidentally deploy with them.
  STRIPE_SECRET_KEY: Joi.string()
    .required()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().pattern(/^sk_live_/).required().messages({
        'string.pattern.base':
          'STRIPE_SECRET_KEY must be a live-mode key (sk_live_…) in production',
      }),
    }),
  STRIPE_PUBLISHABLE_KEY: Joi.string()
    .required()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().pattern(/^pk_live_/).required().messages({
        'string.pattern.base':
          'STRIPE_PUBLISHABLE_KEY must be a live-mode key (pk_live_…) in production',
      }),
    }),
  // Webhook secret: required in prod (no signature verification means no
  // webhook trust), optional in dev where Stripe CLI prints a `whsec_` on demand.
  STRIPE_WEBHOOK_SECRET: requiredInProd(Joi.string(), ''),
  STRIPE_CURRENCY: Joi.string().lowercase().default('pln'),
  STRIPE_SUCCESS_URL: Joi.string().uri().required(),
  STRIPE_CANCEL_URL: Joi.string().uri().required(),
  // Secret for POST /payments/reconcile. Required in production — without it,
  // the reconciliation endpoint is permanently locked (returns 401 for every call),
  // meaning the fallback cron path is silently broken.
  PAYMENTS_RECONCILE_SECRET: requiredInProd(Joi.string().min(16), ''),

  // ── InPost ShipX ──
  INPOST_MOCK_ENABLED: Joi.string().valid('true', 'false').default('false'),
  // In production with mock disabled, both credentials are required — without them
  // the client falls back to the 'mock-org-id' default and writes fake tracking URLs
  // to the DB, triggering the customer cascade: 404 → support → refund → chargeback.
  INPOST_ORGANIZATION_ID: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.when('INPOST_MOCK_ENABLED', {
      is: 'true',
      then: Joi.string().optional().allow(''),
      otherwise: Joi.string().required().messages({
        'any.required':
          'INPOST_ORGANIZATION_ID is required in production when INPOST_MOCK_ENABLED is not "true"',
      }),
    }),
    otherwise: Joi.string().default('mock-org-id'),
  }),
  INPOST_API_TOKEN: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.when('INPOST_MOCK_ENABLED', {
      is: 'true',
      then: Joi.string().optional().allow(''),
      otherwise: Joi.string().required().messages({
        'any.required':
          'INPOST_API_TOKEN is required in production when INPOST_MOCK_ENABLED is not "true"',
      }),
    }),
    otherwise: Joi.string().default('mock-api-token'),
  }),

  // ── Supabase ──
  SUPABASE_URL: Joi.string().uri().required(),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().required(),

  // ── Resend (email) ──
  // Required in prod (transactional emails are legally load-bearing — order
  // confirmation, invoice delivery). Defaults to a mock key in dev so the
  // service starts without a real key.
  RESEND_API_KEY: requiredInProd(Joi.string(), 're_mock'),
  // EMAIL_FROM must use a domain verified in Resend (SPF + DKIM). In dev we
  // fall back to Resend's shared sandbox sender.
  EMAIL_FROM: requiredInProd(Joi.string().email(), 'onboarding@resend.dev'),
  // Signing secret for Resend webhook events (svix `whsec_…`).
  // Required in prod — without it, any caller can spoof delivery events.
  // In dev, the controller logs a warning and skips verification.
  RESEND_WEBHOOK_SECRET: requiredInProd(Joi.string(), ''),

  // ── Optional: DHL/GLS (not required for Phase 0) ──
  DHL_ACCOUNT_NUMBER: Joi.string().optional(),
  DHL_API_KEY: Joi.string().optional(),
  DHL_API_SECRET: Joi.string().optional(),
  DHL_SHIPPER_NAME: Joi.string().optional(),
  DHL_SHIPPER_STREET: Joi.string().optional(),
  DHL_SHIPPER_CITY: Joi.string().optional(),
  DHL_SHIPPER_POSTAL_CODE: Joi.string().optional(),
  DHL_SHIPPER_PHONE: Joi.string().optional(),
  DHL_SHIPPER_EMAIL: Joi.string().email().optional(),
  GLS_SENDER_ID: Joi.string().optional(),
  GLS_USERNAME: Joi.string().optional(),
  GLS_PASSWORD: Joi.string().optional(),

  // ── Invoice / Seller info ──
  // Required in production to generate legally-compliant Polish VAT invoices.
  // SELLER_NIP is the seller's Polish tax ID (10 digits, no spaces).
  SELLER_NAME: requiredInProd(Joi.string(), 'Aromaterie'),
  SELLER_NIP: requiredInProd(Joi.string(), ''),
  SELLER_STREET: requiredInProd(Joi.string(), ''),
  SELLER_CITY: requiredInProd(Joi.string(), ''),
  SELLER_POSTAL_CODE: requiredInProd(Joi.string(), ''),
  INVOICE_FONT_PATH: Joi.string().optional(),

  // ── Redis / BullMQ ──
  REDIS_URL: requiredInProd(Joi.string().uri(), 'redis://localhost:6379'),

  // ── App ──
  PORT: Joi.number().default(3000),
  // Comma-separated list of allowed CORS origins. Required in production so
  // the app never boots with the localhost fallback against a live database.
  FRONTEND_URL: requiredInProd(Joi.string().uri(), 'http://localhost:4200'),

  // ── Sentry ──
  // Required (non-empty URI) in production so errors are never silently invisible.
  // Dev/test can omit or leave blank — the SDK becomes a no-op when DSN is absent.
  // Uses an explicit when() rather than requiredInProd() so that .allow('') only
  // applies to the otherwise branch; production rejects empty strings.
  SENTRY_DSN: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().uri().required(),
    otherwise: Joi.string().uri().allow('').optional(),
  }),
  SENTRY_RELEASE: Joi.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: Joi.number().min(0).max(1).default(0.1),
  SENTRY_PROFILES_SAMPLE_RATE: Joi.number().min(0).max(1).default(0.1),

  // ── GDPR / Encryption ──
  // AES-256-GCM key for IBAN at-rest encryption (ReturnRequest.bankAccount).
  // Must be a 64-character lowercase hex string (32 bytes). Generate with:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  // Rotate independently of DB credentials. Never reuse across environments.
  IBAN_ENCRYPTION_KEY: requiredInProd(
    Joi.string()
      .length(64)
      .pattern(/^[0-9a-f]+$/)
      .messages({
        'string.length': 'IBAN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)',
        'string.pattern.base': 'IBAN_ENCRYPTION_KEY must be lowercase hex only',
      }),
  ),

  // ── Admin ──
  // ADMIN_DEFAULT_PASSWORD must be a bcrypt hash (bcrypt.hash('yourpassword', 10)).
  ADMIN_DEFAULT_EMAIL: requiredInProd(Joi.string().email()),
  ADMIN_DEFAULT_PASSWORD: requiredInProd(Joi.string().min(10)),
  // Separate secret for signing the admin session cookie. Falls back to
  // ADMIN_DEFAULT_PASSWORD in dev, but should be set explicitly in prod.
  ADMIN_SESSION_SECRET: requiredInProd(Joi.string().min(16)),
  // Optional: recipient override for merchant order alert emails (defaults to EMAIL_FROM).
  ADMIN_ALERT_EMAIL: Joi.string().email().optional(),
  // Optional: Slack incoming webhook URL for instant new-order push notifications.
  // When set, a message is POSTed immediately after checkout.session.completed.
  MERCHANT_SLACK_WEBHOOK_URL: Joi.string().uri().optional(),
  // Secret used by GET /health/debug-sentry to guard the intentional-error endpoint.
  DEBUG_SENTRY_SECRET: Joi.string().optional(),
}).options({ allowUnknown: true });
