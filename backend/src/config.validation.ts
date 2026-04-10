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

  // ── Przelewy24 ──
  P24_MOCK_ENABLED: Joi.string().valid('true', 'false').default('false'),
  P24_SANDBOX: Joi.string().valid('true', 'false').default('true'),
  P24_MERCHANT_ID: Joi.string().required(),
  P24_POS_ID: Joi.string().required(),
  P24_CRC: Joi.string().required(),
  P24_API_KEY: Joi.string().required(),
  P24_RETURN_URL: Joi.string().required(),
  P24_NOTIFY_URL: Joi.string().required(),

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

  // ── Admin ──
  ADMIN_DEFAULT_EMAIL: Joi.string().email().optional(),
  ADMIN_DEFAULT_PASSWORD: Joi.string().optional(),
}).options({ allowUnknown: true });
