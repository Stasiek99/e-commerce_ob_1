import type { Event } from '@sentry/nestjs';

const mockInit = jest.fn();

jest.mock('@sentry/nestjs', () => ({ init: mockInit }));
jest.mock('@sentry/profiling-node', () => ({
  nodeProfilingIntegration: jest.fn().mockReturnValue({ name: 'MockProfiling' }),
}));

type BeforeSend = (event: Event) => Event | null;

function loadInstrument(): BeforeSend | undefined {
  require('../instrument');
  const config = mockInit.mock.calls[0]?.[0] as { beforeSend: BeforeSend } | undefined;
  return config?.beforeSend;
}

describe('instrument.ts', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('@sentry/nestjs', () => ({ init: mockInit }));
    jest.mock('@sentry/profiling-node', () => ({
      nodeProfilingIntegration: jest.fn().mockReturnValue({ name: 'MockProfiling' }),
    }));
    mockInit.mockClear();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('Sentry.init gating', () => {
    it('calls Sentry.init when SENTRY_DSN is set', () => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/1';
      loadInstrument();
      expect(mockInit).toHaveBeenCalledTimes(1);
    });

    it('does not call Sentry.init when SENTRY_DSN is absent', () => {
      delete process.env.SENTRY_DSN;
      loadInstrument();
      expect(mockInit).not.toHaveBeenCalled();
    });

    it('initialises with sendDefaultPii: false', () => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/1';
      loadInstrument();
      expect(mockInit.mock.calls[0][0]).toMatchObject({ sendDefaultPii: false });
    });
  });

  describe('release configuration', () => {
    beforeEach(() => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/1';
    });

    it('uses SENTRY_RELEASE when set', () => {
      process.env.SENTRY_RELEASE = 'manual-release-123';
      delete process.env.RAILWAY_GIT_COMMIT_SHA;

      loadInstrument();

      expect(mockInit.mock.calls[0][0]).toMatchObject({ release: 'manual-release-123' });
    });

    it('falls back to RAILWAY_GIT_COMMIT_SHA when SENTRY_RELEASE is unset', () => {
      delete process.env.SENTRY_RELEASE;
      process.env.RAILWAY_GIT_COMMIT_SHA = 'abc123commitsha';

      loadInstrument();

      expect(mockInit.mock.calls[0][0]).toMatchObject({ release: 'abc123commitsha' });
    });

    it('prefers SENTRY_RELEASE over RAILWAY_GIT_COMMIT_SHA when both are set', () => {
      process.env.SENTRY_RELEASE = 'manual-release-123';
      process.env.RAILWAY_GIT_COMMIT_SHA = 'abc123commitsha';

      loadInstrument();

      expect(mockInit.mock.calls[0][0]).toMatchObject({ release: 'manual-release-123' });
    });

    it('leaves release undefined when neither SENTRY_RELEASE nor RAILWAY_GIT_COMMIT_SHA is set', () => {
      delete process.env.SENTRY_RELEASE;
      delete process.env.RAILWAY_GIT_COMMIT_SHA;

      loadInstrument();

      expect(mockInit.mock.calls[0][0]).toMatchObject({ release: undefined });
    });
  });

  describe('beforeSend — sensitive field scrubbing', () => {
    let beforeSend: BeforeSend;

    beforeEach(() => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/1';
      beforeSend = loadInstrument()!;
    });

    it('redacts password from object body', () => {
      const event: Event = { request: { data: { password: 'S3cr3t!' } } };
      const result = beforeSend(event);
      expect((result!.request!.data as string)).toContain('"password":"[REDACTED]"');
    });

    it('redacts newPassword from object body', () => {
      const event: Event = { request: { data: { newPassword: 'NewS3cr3t!' } } };
      const result = beforeSend(event);
      expect((result!.request!.data as string)).toContain('"newPassword":"[REDACTED]"');
    });

    it('redacts nip from object body', () => {
      const event: Event = { request: { data: { nip: '1234567890' } } };
      const result = beforeSend(event);
      expect((result!.request!.data as string)).toContain('"nip":"[REDACTED]"');
    });

    it('redacts bankAccount from object body', () => {
      const event: Event = { request: { data: { bankAccount: 'PL61109010140000071219812874' } } };
      const result = beforeSend(event);
      expect((result!.request!.data as string)).toContain('"bankAccount":"[REDACTED]"');
    });

    it('redacts token from object body', () => {
      const event: Event = { request: { data: { token: 'abc-def-ghi' } } };
      const result = beforeSend(event);
      expect((result!.request!.data as string)).toContain('"token":"[REDACTED]"');
    });

    it('redacts all sensitive keys simultaneously', () => {
      const event: Event = {
        request: {
          data: {
            email: 'user@example.com',
            password: 'pw',
            nip: '123',
            bankAccount: 'PL00',
            token: 'tok',
          },
        },
      };
      const result = beforeSend(event);
      const parsed = JSON.parse(result!.request!.data as string);
      expect(parsed.password).toBe('[REDACTED]');
      expect(parsed.nip).toBe('[REDACTED]');
      expect(parsed.bankAccount).toBe('[REDACTED]');
      expect(parsed.token).toBe('[REDACTED]');
    });

    it('preserves non-sensitive fields untouched', () => {
      const event: Event = {
        request: { data: { email: 'user@example.com', firstName: 'Jan' } },
      };
      const result = beforeSend(event);
      const parsed = JSON.parse(result!.request!.data as string);
      expect(parsed.email).toBe('user@example.com');
      expect(parsed.firstName).toBe('Jan');
    });

    it('redacts sensitive keys from a JSON-string body', () => {
      const event: Event = {
        request: { data: JSON.stringify({ email: 'x@y.com', password: 'hunter2' }) },
      };
      const result = beforeSend(event);
      const parsed = JSON.parse(result!.request!.data as string);
      expect(parsed.password).toBe('[REDACTED]');
      expect(parsed.email).toBe('x@y.com');
    });

    it('replaces non-JSON string body with [REDACTED]', () => {
      const event: Event = { request: { data: 'not-valid-json' } };
      const result = beforeSend(event);
      expect(result!.request!.data).toBe('[REDACTED]');
    });

    it('redacts sensitive keys nested inside an address object', () => {
      const event: Event = {
        request: {
          data: {
            firstName: 'Jan',
            address: { street: 'ul. Główna 1', nip: '9876543210', phone: '+48123456789' },
          },
        },
      };
      const result = beforeSend(event);
      const parsed = JSON.parse(result!.request!.data as string);
      expect(parsed.address.nip).toBe('[REDACTED]');
      expect(parsed.address.street).toBe('ul. Główna 1');
      expect(parsed.firstName).toBe('Jan');
    });

    it('redacts password two levels deep inside a nested object', () => {
      const event: Event = {
        request: {
          data: { user: { profile: { password: 'deep-secret', email: 'x@y.com' } } },
        },
      };
      const result = beforeSend(event);
      const parsed = JSON.parse(result!.request!.data as string);
      expect(parsed.user.profile.password).toBe('[REDACTED]');
      expect(parsed.user.profile.email).toBe('x@y.com');
    });

    it('redacts sensitive keys inside array elements', () => {
      const event: Event = {
        request: {
          data: {
            items: [
              { quantity: 1, token: 'tkn-a' },
              { quantity: 2, token: 'tkn-b' },
            ],
          },
        },
      };
      const result = beforeSend(event);
      const parsed = JSON.parse(result!.request!.data as string);
      expect(parsed.items[0].token).toBe('[REDACTED]');
      expect(parsed.items[0].quantity).toBe(1);
      expect(parsed.items[1].token).toBe('[REDACTED]');
    });

    it('redacts both top-level and nested sensitive keys in one pass', () => {
      const event: Event = {
        request: {
          data: {
            nip: 'top-nip',
            address: { bankAccount: 'nested-bank', city: 'Warsaw' },
          },
        },
      };
      const result = beforeSend(event);
      const parsed = JSON.parse(result!.request!.data as string);
      expect(parsed.nip).toBe('[REDACTED]');
      expect(parsed.address.bankAccount).toBe('[REDACTED]');
      expect(parsed.address.city).toBe('Warsaw');
    });

    it('returns event unchanged when request.data is absent', () => {
      const event: Event = { request: { url: 'https://example.com' } };
      const result = beforeSend(event);
      expect(result).toBe(event);
    });

    it('returns event unchanged when request is absent', () => {
      const event: Event = { level: 'error' };
      const result = beforeSend(event);
      expect(result).toBe(event);
    });
  });

  describe('beforeSend — header redaction', () => {
    let beforeSend: BeforeSend;

    beforeEach(() => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/1';
      beforeSend = loadInstrument()!;
    });

    it('removes the authorization header from the event', () => {
      const event: Event = {
        request: { headers: { authorization: 'Bearer eyJliveToken', 'content-type': 'application/json' } },
      };

      const result = beforeSend(event);

      expect(result!.request!.headers).not.toHaveProperty('authorization');
    });

    it('preserves non-sensitive headers when removing authorization', () => {
      const event: Event = {
        request: { headers: { authorization: 'Bearer eyJliveToken', 'content-type': 'application/json' } },
      };

      const result = beforeSend(event);

      expect(result!.request!.headers!['content-type']).toBe('application/json');
    });

    it('removes the cookie header from the event', () => {
      const event: Event = {
        request: { headers: { cookie: 'refreshToken=secret; session=abc', 'x-request-id': 'req-1' } },
      };

      const result = beforeSend(event);

      expect(result!.request!.headers).not.toHaveProperty('cookie');
    });

    it('preserves non-sensitive headers when removing cookie', () => {
      const event: Event = {
        request: { headers: { cookie: 'refreshToken=secret', 'x-request-id': 'req-1' } },
      };

      const result = beforeSend(event);

      expect(result!.request!.headers!['x-request-id']).toBe('req-1');
    });

    it('removes both authorization and cookie when both are present', () => {
      const event: Event = {
        request: {
          headers: {
            authorization: 'Bearer token',
            cookie: 'refreshToken=r',
            accept: 'application/json',
          },
        },
      };

      const result = beforeSend(event);

      expect(result!.request!.headers).not.toHaveProperty('authorization');
      expect(result!.request!.headers).not.toHaveProperty('cookie');
      expect(result!.request!.headers!['accept']).toBe('application/json');
    });

    it('returns event unchanged when request has no headers', () => {
      const event: Event = { request: { url: 'https://example.com' } };
      const result = beforeSend(event);
      expect(result).toBe(event);
    });

    it('strips authorization header AND redacts sensitive body in the same call', () => {
      const event: Event = {
        request: {
          headers: { authorization: 'Bearer live-token', 'content-type': 'application/json' },
          data: JSON.stringify({ token: 'refresh-jwt', amount: 99 }),
        },
      };

      const result = beforeSend(event);
      const body = JSON.parse(result!.request!.data as string);

      expect(result!.request!.headers).not.toHaveProperty('authorization');
      expect(body.token).toBe('[REDACTED]');
      expect(body.amount).toBe(99);
    });
  });
});
