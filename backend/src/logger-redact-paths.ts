/**
 * Pino redact paths applied to every HTTP request log.
 * Exported so the test suite can assert that sensitive fields
 * are present without importing the full AppModule.
 */

// Strips query parameters from the logged URL so values like
// ?email=... never appear in Railway request logs (GDPR Art. 5(1)(f)).
export const PINO_SERIALIZERS = {
  req(req: { method: string; url: string; id?: string }) {
    return { method: req.method, url: req.url.split('?')[0], id: req.id };
  },
};

export const PINO_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.newPassword',
  'req.body.confirmPassword',
  'req.body.nip',
  'req.body.bankAccount',
] as const;
