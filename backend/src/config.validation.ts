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

  // ── InPost ShipX ──
  INPOST_MOCK_ENABLED: Joi.string().valid('true', 'false').default('false'),
  INPOST_ORGANIZATION_ID: Joi.string().default('mock-org-id'),
  INPOST_API_TOKEN: Joi.string().default('mock-api-token'),

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

  // ── Optional: DHL/GLS (not required for Phase 0) ──
  DHL_ACCOUNT_NUMBER: Joi.string().optional(),
  DHL_API_KEY: Joi.string().optional(),
  DHL_API_SECRET: Joi.string().optional(),
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

  // ── App ──
  PORT: Joi.number().default(3000),
  FRONTEND_URL: Joi.string().default('http://localhost:4200'),

  // ── Sentry (optional — SDK is a no-op when SENTRY_DSN is empty) ──
  SENTRY_DSN: Joi.string().uri().allow('').optional(),
  SENTRY_RELEASE: Joi.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: Joi.number().min(0).max(1).default(0.1),
  SENTRY_PROFILES_SAMPLE_RATE: Joi.number().min(0).max(1).default(0.1),

  // ── Admin ──
  // ADMIN_DEFAULT_PASSWORD must be a bcrypt hash (bcrypt.hash('yourpassword', 10)).
  ADMIN_DEFAULT_EMAIL: requiredInProd(Joi.string().email()),
  ADMIN_DEFAULT_PASSWORD: requiredInProd(Joi.string().min(10)),
  // Separate secret for signing the admin session cookie. Falls back to
  // ADMIN_DEFAULT_PASSWORD in dev, but should be set explicitly in prod.
  ADMIN_SESSION_SECRET: requiredInProd(Joi.string().min(16)),
  // Secret used by GET /health/debug-sentry to guard the intentional-error endpoint.
  DEBUG_SENTRY_SECRET: Joi.string().optional(),
}).options({ allowUnknown: true });
