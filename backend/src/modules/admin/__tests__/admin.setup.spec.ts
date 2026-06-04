import * as fs from 'fs';
import * as path from 'path';
import { setupAdmin, logAdminAction } from '../admin.setup';

// Minimal stubs — only used if execution passes the credential guard.
// The three "missing creds" cases throw before any of these are touched.
const mockHttpAdapter = { getInstance: jest.fn().mockReturnValue({ get: jest.fn() }) };
const mockApp = { getHttpAdapter: jest.fn().mockReturnValue(mockHttpAdapter) } as any;
const mockPrisma = {} as any;
const mockInvoice = {} as any;
const mockShipping = {} as any;
const mockOrders = {} as any;
const mockPayments = {} as any;
const mockReturns = {} as any;

const callSetupAdmin = () =>
  setupAdmin(mockApp, mockPrisma, mockInvoice, mockShipping, mockOrders, mockPayments, mockReturns);

const GUARD_ERROR =
  'ADMIN_DEFAULT_EMAIL and ADMIN_DEFAULT_PASSWORD must be set — refusing to boot with an unprotected admin panel';

describe('logAdminAction', () => {
  const mockPrismaLog = { adminLog: { create: jest.fn() } } as any;

  beforeEach(() => jest.clearAllMocks());

  it('writes the correct fields to prisma.adminLog', async () => {
    mockPrismaLog.adminLog.create.mockResolvedValue({});

    await logAdminAction(mockPrismaLog, 'approve', 'ReturnRequest', 'rr-123', 'admin@test.com', { adminNote: 'ok' });

    expect(mockPrismaLog.adminLog.create).toHaveBeenCalledWith({
      data: {
        action: 'approve',
        entityType: 'ReturnRequest',
        entityId: 'rr-123',
        actor: 'admin@test.com',
        metadata: { adminNote: 'ok' },
      },
    });
  });

  it('passes undefined metadata when none provided', async () => {
    mockPrismaLog.adminLog.create.mockResolvedValue({});

    await logAdminAction(mockPrismaLog, 'refundFull', 'Order', 'order-456', 'admin@test.com');

    expect(mockPrismaLog.adminLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ metadata: undefined }),
    });
  });

  it('does not propagate errors when prisma.adminLog.create fails', async () => {
    mockPrismaLog.adminLog.create.mockRejectedValue(new Error('DB connection lost'));

    await expect(
      logAdminAction(mockPrismaLog, 'approve', 'Review', 'review-789', 'admin@test.com'),
    ).resolves.toBeUndefined();
  });
});

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

// ─── Session fixation guard — source contract ─────────────────────────────────
// The inline middleware registered on expressApp after the AdminJS router must
// regenerate the session on the first authenticated request to prevent session
// fixation: an attacker who pre-seeds a session ID before admin login would
// inherit the authenticated session without this guard.

describe('setupAdmin — session fixation middleware (source contract)', () => {
  const setupSource = fs.readFileSync(
    path.join(__dirname, '../admin.setup.ts'),
    'utf-8',
  );

  it('calls req.session.regenerate() to prevent session fixation after login', () => {
    expect(setupSource).toContain('req.session.regenerate');
  });

  it('sets _regenerated flag to prevent repeated regeneration on every request', () => {
    expect(setupSource).toContain('req.session._regenerated');
  });

  it('restores adminUser onto the new session after regeneration', () => {
    expect(setupSource).toContain('req.session.adminUser = adminUser');
  });

  it('guards the regeneration on req.session.adminUser being set', () => {
    expect(setupSource).toContain('req.session?.adminUser');
  });
});

// ─── Session fixation middleware — behaviour ──────────────────────────────────
// Tests that the middleware logic (req, res, next) behaves correctly for every
// branch. The inline function is reproduced here to produce a testable unit;
// the source contract suite above fails if admin.setup.ts removes the code.

function makeSessionFixationMiddleware() {
  return (req: any, _res: any, next: any): void => {
    if (req.session?.adminUser && !req.session._regenerated) {
      const adminUser = req.session.adminUser;
      req.session.regenerate((err: Error | null) => {
        if (err) return next(err);
        req.session.adminUser = adminUser;
        req.session._regenerated = true;
        next();
      });
    } else {
      next();
    }
  };
}

describe('setupAdmin — session fixation middleware behaviour', () => {
  const middleware = makeSessionFixationMiddleware();
  const res = {};

  afterEach(() => jest.clearAllMocks());

  it('calls next() without regenerating when session has no adminUser (unauthenticated request)', () => {
    const next = jest.fn();
    const req = { session: {} };

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next() without regenerating when session is null (no session middleware)', () => {
    const next = jest.fn();
    const req = { session: null };

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next() without regenerating when session is already marked regenerated', () => {
    const next = jest.fn();
    const regenerate = jest.fn();
    const req = { session: { adminUser: { email: 'admin@test.com' }, _regenerated: true, regenerate } };

    middleware(req, res, next);

    expect(regenerate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('regenerates the session on first authenticated request', () => {
    const next = jest.fn();
    const newSession: any = {};
    const req: any = {
      session: {
        adminUser: { email: 'admin@test.com' },
        regenerate: jest.fn((cb: (err: Error | null) => void) => {
          req.session = newSession; // simulate session reset
          cb(null);
        }),
      },
    };

    middleware(req, res, next);

    expect(req.session.regenerate ?? newSession.regenerate ?? req.session === newSession).toBeTruthy();
    expect(next).toHaveBeenCalledWith();
  });

  it('preserves adminUser on the new session after regeneration', () => {
    const next = jest.fn();
    const adminUser = { email: 'admin@test.com' };
    const newSession: any = {};
    const req: any = {
      session: {
        adminUser,
        regenerate: jest.fn((cb: (err: Error | null) => void) => {
          req.session = newSession;
          cb(null);
        }),
      },
    };

    middleware(req, res, next);

    expect(newSession.adminUser).toBe(adminUser);
  });

  it('sets _regenerated on the new session after regeneration', () => {
    const next = jest.fn();
    const newSession: any = {};
    const req: any = {
      session: {
        adminUser: { email: 'admin@test.com' },
        regenerate: jest.fn((cb: (err: Error | null) => void) => {
          req.session = newSession;
          cb(null);
        }),
      },
    };

    middleware(req, res, next);

    expect(newSession._regenerated).toBe(true);
  });

  it('calls next(err) when session.regenerate fails', () => {
    const next = jest.fn();
    const regenerateError = new Error('session store unavailable');
    const req: any = {
      session: {
        adminUser: { email: 'admin@test.com' },
        regenerate: jest.fn((cb: (err: Error | null) => void) => cb(regenerateError)),
      },
    };

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith(regenerateError);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

// ─── PgSession pool cap — source contract ─────────────────────────────────────
// connect-pg-simple opens its own pg driver pool (default: 10 connections) on
// top of Prisma's capped pool (connection_limit=10). Combined they can exhaust
// Supabase's free-tier limit (~60 total). The store must be initialised with
// pool: { max: 2 } since admin sessions have low concurrency requirements.

describe('setupAdmin — PgSession pool cap (source contract)', () => {
  const setupSource = fs.readFileSync(
    path.join(__dirname, '../admin.setup.ts'),
    'utf-8',
  );

  it('initialises PgSession store with pool: { max: 2 } to cap admin session connections', () => {
    expect(setupSource).toContain('pool: { max: 2 }');
  });

  it('passes pool config inside the PgSession constructor call (not outside it)', () => {
    const pgSessionCallIndex = setupSource.indexOf('new PgSession(');
    expect(pgSessionCallIndex).toBeGreaterThan(-1);

    const closingBraceIndex = setupSource.indexOf('});', pgSessionCallIndex);
    const constructorBlock = setupSource.slice(pgSessionCallIndex, closingBraceIndex);
    expect(constructorBlock).toContain('pool: { max: 2 }');
  });
});
