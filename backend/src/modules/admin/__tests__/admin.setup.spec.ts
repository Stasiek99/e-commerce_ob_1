import { setupAdmin } from '../admin.setup';

// Minimal stubs — only used if execution passes the credential guard.
// The three "missing creds" cases throw before any of these are touched.
const mockHttpAdapter = { getInstance: jest.fn().mockReturnValue({ get: jest.fn() }) };
const mockApp = { getHttpAdapter: jest.fn().mockReturnValue(mockHttpAdapter) } as any;
const mockPrisma = {} as any;
const mockInvoice = {} as any;
const mockShipping = {} as any;
const mockOrders = {} as any;
const mockPayments = {} as any;

const callSetupAdmin = () =>
  setupAdmin(mockApp, mockPrisma, mockInvoice, mockShipping, mockOrders, mockPayments);

const GUARD_ERROR =
  'ADMIN_DEFAULT_EMAIL and ADMIN_DEFAULT_PASSWORD must be set — refusing to boot with an unprotected admin panel';

describe('setupAdmin credential guard', () => {
  let savedEmail: string | undefined;
  let savedPassword: string | undefined;

  beforeEach(() => {
    savedEmail = process.env.ADMIN_DEFAULT_EMAIL;
    savedPassword = process.env.ADMIN_DEFAULT_PASSWORD;
  });

  afterEach(() => {
    if (savedEmail !== undefined) process.env.ADMIN_DEFAULT_EMAIL = savedEmail;
    else delete process.env.ADMIN_DEFAULT_EMAIL;

    if (savedPassword !== undefined) process.env.ADMIN_DEFAULT_PASSWORD = savedPassword;
    else delete process.env.ADMIN_DEFAULT_PASSWORD;
  });

  it('throws when ADMIN_DEFAULT_EMAIL is missing', async () => {
    delete process.env.ADMIN_DEFAULT_EMAIL;
    process.env.ADMIN_DEFAULT_PASSWORD = 'super-secret';

    await expect(callSetupAdmin()).rejects.toThrow(GUARD_ERROR);
  });

  it('throws when ADMIN_DEFAULT_PASSWORD is missing', async () => {
    process.env.ADMIN_DEFAULT_EMAIL = 'admin@example.com';
    delete process.env.ADMIN_DEFAULT_PASSWORD;

    await expect(callSetupAdmin()).rejects.toThrow(GUARD_ERROR);
  });

  it('throws when both credentials are missing', async () => {
    delete process.env.ADMIN_DEFAULT_EMAIL;
    delete process.env.ADMIN_DEFAULT_PASSWORD;

    await expect(callSetupAdmin()).rejects.toThrow(GUARD_ERROR);
  });

  it('does not throw the credential guard error when both credentials are set', async () => {
    process.env.ADMIN_DEFAULT_EMAIL = 'admin@example.com';
    process.env.ADMIN_DEFAULT_PASSWORD = 'super-secret';

    let thrownError: unknown;
    try {
      await callSetupAdmin();
    } catch (err) {
      thrownError = err;
    }

    // Setup may still fail (e.g. no DB, ESM loading in Jest), but it must NOT be
    // the credential guard that kills it.
    if (thrownError instanceof Error) {
      expect(thrownError.message).not.toContain(
        'ADMIN_DEFAULT_EMAIL and ADMIN_DEFAULT_PASSWORD must be set',
      );
    }
  });
});
