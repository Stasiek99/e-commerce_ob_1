/**
 * Pino redact paths applied to every HTTP request log.
 * Exported so the test suite can assert that sensitive fields
 * are present without importing the full AppModule.
 */
export const PINO_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.newPassword',
  'req.body.confirmPassword',
  'req.body.nip',
  'req.body.bankAccount',
] as const;
