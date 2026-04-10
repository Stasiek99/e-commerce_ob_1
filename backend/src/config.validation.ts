import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
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
  STRIPE_SECRET_KEY: Joi.string().required(),
  STRIPE_PUBLISHABLE_KEY: Joi.string().required(),
  STRIPE_WEBHOOK_SECRET: Joi.string().allow('').default(''),
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
  RESEND_API_KEY: Joi.string().default('re_mock'),

  // ── Optional: DHL/GLS (not required for Phase 0) ──
  DHL_ACCOUNT_NUMBER: Joi.string().optional(),
  DHL_API_KEY: Joi.string().optional(),
  DHL_API_SECRET: Joi.string().optional(),
  GLS_SENDER_ID: Joi.string().optional(),
  GLS_USERNAME: Joi.string().optional(),
  GLS_PASSWORD: Joi.string().optional(),

  // ── App ──
  PORT: Joi.number().default(3000),
  FRONTEND_URL: Joi.string().default('http://localhost:4200'),

  // ── Sentry (optional — SDK is a no-op when SENTRY_DSN is empty) ──
  SENTRY_DSN: Joi.string().uri().allow('').optional(),
  SENTRY_RELEASE: Joi.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: Joi.number().min(0).max(1).default(0.1),
  SENTRY_PROFILES_SAMPLE_RATE: Joi.number().min(0).max(1).default(0.1),

  // ── Admin ──
  ADMIN_DEFAULT_EMAIL: Joi.string().email().optional(),
  ADMIN_DEFAULT_PASSWORD: Joi.string().optional(),
}).options({ allowUnknown: true });
