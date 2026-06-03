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
});
