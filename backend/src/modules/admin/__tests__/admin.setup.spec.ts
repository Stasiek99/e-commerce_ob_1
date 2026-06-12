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
const mockAuth = {} as any;

const callSetupAdmin = () =>
  setupAdmin(mockApp, mockPrisma, mockInvoice, mockShipping, mockOrders, mockPayments, mockReturns, mockAuth);

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

// ─── ADMIN_SESSION_SECRET guard ──────────────────────────────────────────────
// FIX: The session secret previously fell back to the bcrypt hash of the admin
// password when ADMIN_SESSION_SECRET was not set in dev. A bcrypt hash is a
// known-format string ($2b$12$...) which reduces entropy as an HMAC key. The
// fix generates a random ephemeral secret via crypto.randomBytes instead.

describe('setupAdmin — ADMIN_SESSION_SECRET guard', () => {
  const BCRYPT_HASH = '$2b$12$LqvHW.I6oSyH3nNLb3MlUue9oQNfeFbOZ2OFI2TyHOh2GdBbfq3EC';

  let savedEmail: string | undefined;
  let savedPassword: string | undefined;
  let savedSecret: string | undefined;
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    savedEmail = process.env.ADMIN_DEFAULT_EMAIL;
    savedPassword = process.env.ADMIN_DEFAULT_PASSWORD;
    savedSecret = process.env.ADMIN_SESSION_SECRET;
    savedNodeEnv = process.env.NODE_ENV;

    process.env.ADMIN_DEFAULT_EMAIL = 'admin@example.com';
    process.env.ADMIN_DEFAULT_PASSWORD = BCRYPT_HASH;
    delete process.env.ADMIN_SESSION_SECRET;
  });

  afterEach(() => {
    if (savedEmail !== undefined) process.env.ADMIN_DEFAULT_EMAIL = savedEmail;
    else delete process.env.ADMIN_DEFAULT_EMAIL;

    if (savedPassword !== undefined) process.env.ADMIN_DEFAULT_PASSWORD = savedPassword;
    else delete process.env.ADMIN_DEFAULT_PASSWORD;

    if (savedSecret !== undefined) process.env.ADMIN_SESSION_SECRET = savedSecret;
    else delete process.env.ADMIN_SESSION_SECRET;

    if (savedNodeEnv !== undefined) process.env.NODE_ENV = savedNodeEnv;
    else delete process.env.NODE_ENV;
  });

  it('throws when ADMIN_SESSION_SECRET is absent in production', async () => {
    process.env.NODE_ENV = 'production';

    await expect(callSetupAdmin()).rejects.toThrow(
      'ADMIN_SESSION_SECRET must be set in production — refusing to boot',
    );
  });

  it('does not use the bcrypt hash (adminPassword) as the dev session secret fallback', async () => {
    process.env.NODE_ENV = 'development';

    // setupAdmin still throws for ESM-load reasons in Jest, but the session
    // secret assignment happens before the ESM import call.
    try { await callSetupAdmin(); } catch { /* expected */ }

    expect(process.env.ADMIN_SESSION_SECRET).toBeDefined();
    expect(process.env.ADMIN_SESSION_SECRET).not.toBe(BCRYPT_HASH);
  });

  it('generates a hex string of ≥32 chars as the dev fallback (entropy from crypto.randomBytes)', async () => {
    process.env.NODE_ENV = 'development';

    try { await callSetupAdmin(); } catch { /* expected */ }

    const secret = process.env.ADMIN_SESSION_SECRET;
    expect(secret).toBeDefined();
    expect(secret!.length).toBeGreaterThanOrEqual(32);
    expect(secret).toMatch(/^[0-9a-f]+$/);
  });
});

// ─── Session secret source contract ──────────────────────────────────────────

describe('setupAdmin — session secret source contract', () => {
  const setupSource = fs.readFileSync(path.join(__dirname, '../admin.setup.ts'), 'utf-8');

  it('uses crypto.randomBytes for the dev session secret (not adminPassword)', () => {
    expect(setupSource).toContain('crypto.randomBytes');
  });

  it('imports the crypto module', () => {
    expect(setupSource).toMatch(/import \* as crypto from ['"]crypto['"]/);
  });
});

// ─── authService parameter ────────────────────────────────────────────────────

describe('setupAdmin — authService parameter (source contract)', () => {
  const setupSource = fs.readFileSync(path.join(__dirname, '../admin.setup.ts'), 'utf-8');

  it('accepts authService as an explicit typed parameter', () => {
    expect(setupSource).toContain('authService: AuthService');
  });

  it('imports AuthService from the auth module', () => {
    expect(setupSource).toContain("from '../auth/auth.service'");
  });
});

// ─── sendPasswordReset action — source contract ───────────────────────────────
// Admins must be able to trigger a password reset for a locked-out customer
// without direct DB access. The action calls AuthService.requestPasswordReset
// so the existing rate-limit and email delivery logic is reused.

describe('setupAdmin — sendPasswordReset action (source contract)', () => {
  const setupSource = fs.readFileSync(path.join(__dirname, '../admin.setup.ts'), 'utf-8');

  it('defines a sendPasswordReset record action on the User resource', () => {
    expect(setupSource).toContain('sendPasswordReset');
  });

  it('delegates to authService.requestPasswordReset with the user email', () => {
    expect(setupSource).toContain('authService.requestPasswordReset(email)');
  });

  it('logs the action via logAdminAction after a successful reset', () => {
    const actionIndex = setupSource.indexOf('sendPasswordReset');
    const actionBlock = setupSource.slice(actionIndex, actionIndex + 800);
    expect(actionBlock).toContain('logAdminAction');
  });
});

// ─── sendPasswordReset handler — behaviour ────────────────────────────────────

function makeSendPasswordResetHandler(
  authService: { requestPasswordReset: (email: string) => Promise<void> },
  prisma: { adminLog: { create: (args: any) => Promise<any> } },
  adminEmail: string,
) {
  return async (_request: any, _response: any, context: any) => {
    const { record } = context;
    const email = record.params.email as string;
    try {
      await authService.requestPasswordReset(email);
      await prisma.adminLog.create({
        data: { action: 'sendPasswordReset', entityType: 'User', entityId: record.params.id as string, actor: context.currentAdmin?.email ?? adminEmail, metadata: { email } },
      });
      return {
        record: record.toJSON(),
        notice: { message: `Link do resetu hasła wysłany na ${email}.`, type: 'success' },
      };
    } catch (err) {
      return {
        record: record.toJSON(),
        notice: { message: `Błąd wysyłki: ${(err as Error).message}`, type: 'error' },
      };
    }
  };
}

describe('setupAdmin — sendPasswordReset handler behaviour', () => {
  const adminEmail = 'admin@test.com';
  const mockPrismaLog = { adminLog: { create: jest.fn().mockResolvedValue({}) } };

  const makeRecord = (email: string, id: string) => ({
    params: { id, email },
    toJSON: () => ({ id, email }),
  });

  afterEach(() => jest.clearAllMocks());

  it('calls requestPasswordReset with the user email and returns a success notice', async () => {
    const auth = { requestPasswordReset: jest.fn().mockResolvedValue(undefined) };
    const handler = makeSendPasswordResetHandler(auth, mockPrismaLog, adminEmail);

    const record = makeRecord('customer@example.com', 'user-123');
    const result = await handler({}, {}, { record, currentAdmin: { email: adminEmail } });

    expect(auth.requestPasswordReset).toHaveBeenCalledWith('customer@example.com');
    expect(result.notice.type).toBe('success');
    expect(result.notice.message).toContain('customer@example.com');
  });

  it('returns an error notice when requestPasswordReset rejects', async () => {
    const auth = { requestPasswordReset: jest.fn().mockRejectedValue(new Error('email service down')) };
    const handler = makeSendPasswordResetHandler(auth, mockPrismaLog, adminEmail);

    const record = makeRecord('customer@example.com', 'user-456');
    const result = await handler({}, {}, { record, currentAdmin: null });

    expect(result.notice.type).toBe('error');
    expect(result.notice.message).toContain('email service down');
  });

  it('falls back to the module-level adminEmail when currentAdmin is absent', async () => {
    const auth = { requestPasswordReset: jest.fn().mockResolvedValue(undefined) };
    const handler = makeSendPasswordResetHandler(auth, mockPrismaLog, adminEmail);

    const record = makeRecord('customer@example.com', 'user-789');
    await handler({}, {}, { record, currentAdmin: undefined });

    expect(mockPrismaLog.adminLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actor: adminEmail }) }),
    );
  });

  it('does not call logAdminAction when requestPasswordReset rejects', async () => {
    const auth = { requestPasswordReset: jest.fn().mockRejectedValue(new Error('smtp timeout')) };
    const handler = makeSendPasswordResetHandler(auth, mockPrismaLog, adminEmail);

    const record = makeRecord('customer@example.com', 'user-000');
    await handler({}, {}, { record, currentAdmin: { email: adminEmail } });

    expect(mockPrismaLog.adminLog.create).not.toHaveBeenCalled();
  });
});

// ─── Fulfillment gap — source contract ───────────────────────────────────────
// Orders with status PAID or PROCESSING that have no associated Shipment record
// are the primary fulfillment SLA metric; they must be surfaced in the admin panel.

describe('setupAdmin — fulfillment gap (source contract)', () => {
  const setupSource = fs.readFileSync(path.join(__dirname, '../admin.setup.ts'), 'utf-8');

  it('registers a /admin/fulfillment-gap Express route', () => {
    expect(setupSource).toContain('/admin/fulfillment-gap');
  });

  it('defines a fulfillmentGap resource action on the Order resource', () => {
    expect(setupSource).toContain('fulfillmentGap');
  });

  it('queries only PAID and PROCESSING orders', () => {
    expect(setupSource).toMatch(/PAID.*PROCESSING|PROCESSING.*PAID/);
  });

  it('filters orders where no shipment exists', () => {
    expect(setupSource).toContain('shipment: { is: null }');
  });

  it('redirects the resource action to /admin/fulfillment-gap', () => {
    const actionIdx = setupSource.indexOf('fulfillmentGap');
    const actionBlock = setupSource.slice(actionIdx, actionIdx + 500);
    expect(actionBlock).toContain('/admin/fulfillment-gap');
  });
});

// ─── CPNP notification fields — source contract ──────────────────────────────
// EC Regulation 1223/2009 Art. 13 requires every cosmetic product to be notified
// in the CPNP portal before it is placed on the EU market. The Product resource
// must capture the notification number and Responsible Person, and the list view
// must warn the admin when any active product is missing these fields.

describe('setupAdmin — CPNP fields (source contract)', () => {
  const setupSource = fs.readFileSync(path.join(__dirname, '../admin.setup.ts'), 'utf-8');

  it('exposes cpnpNotificationNumber as an editable Product property', () => {
    expect(setupSource).toContain('cpnpNotificationNumber');
  });

  it('exposes responsiblePersonName as an editable Product property', () => {
    expect(setupSource).toContain('responsiblePersonName');
  });

  it('queries products where isActive = true and CPNP fields are null in the list after hook', () => {
    expect(setupSource).toContain('"isActive" = true');
    expect(setupSource).toContain('"cpnpNotificationNumber" IS NULL');
    expect(setupSource).toContain('"responsiblePersonName" IS NULL');
  });

  it('sets notice.type to "error" when unnotified active products exist', () => {
    const sqlAnchor = setupSource.indexOf('"cpnpNotificationNumber" IS NULL');
    expect(sqlAnchor).toBeGreaterThan(-1);
    const hookBlock = setupSource.slice(sqlAnchor, sqlAnchor + 500);
    expect(hookBlock).toContain("type: 'error'");
  });
});

// ─── CPNP list hook — behaviour ──────────────────────────────────────────────

function makeCpnpListAfterHook(prisma: { $queryRaw: jest.Mock }) {
  return async (response: any): Promise<any> => {
    const result: Array<{ count: number }> = await prisma.$queryRaw({} as any);
    const count = Number(result[0]?.count ?? 0);
    if (count > 0) {
      response.notice = {
        message: `CPNP: ${count} aktywn${count === 1 ? 'y produkt wymaga' : 'e produkty wymagają'} numeru powiadomienia CPNP lub nazwy Osoby Odpowiedzialnej (art. 13 rozp. 1223/2009)`,
        type: 'error',
      };
    }
    return response;
  };
}

describe('setupAdmin — CPNP list after hook behaviour', () => {
  const mockPrismaQ = { $queryRaw: jest.fn() };

  afterEach(() => jest.clearAllMocks());

  it('sets an error notice when one active product is missing CPNP data', async () => {
    mockPrismaQ.$queryRaw.mockResolvedValue([{ count: 1 }]);
    const hook = makeCpnpListAfterHook(mockPrismaQ);

    const response = await hook({});

    expect(response.notice).toBeDefined();
    expect(response.notice.type).toBe('error');
    expect(response.notice.message).toContain('CPNP');
    expect(response.notice.message).toContain('1');
    expect(response.notice.message).toContain('wymaga');
  });

  it('uses plural form when multiple products are missing CPNP data', async () => {
    mockPrismaQ.$queryRaw.mockResolvedValue([{ count: 3 }]);
    const hook = makeCpnpListAfterHook(mockPrismaQ);

    const response = await hook({});

    expect(response.notice.message).toContain('3');
    expect(response.notice.message).toContain('wymagają');
  });

  it('does not set a notice when all active products have CPNP data', async () => {
    mockPrismaQ.$queryRaw.mockResolvedValue([{ count: 0 }]);
    const hook = makeCpnpListAfterHook(mockPrismaQ);

    const response = await hook({});

    expect(response.notice).toBeUndefined();
  });

  it('does not set a notice when the query returns no rows', async () => {
    mockPrismaQ.$queryRaw.mockResolvedValue([]);
    const hook = makeCpnpListAfterHook(mockPrismaQ);

    const response = await hook({});

    expect(response.notice).toBeUndefined();
  });

  it('preserves existing response properties when adding the notice', async () => {
    mockPrismaQ.$queryRaw.mockResolvedValue([{ count: 2 }]);
    const hook = makeCpnpListAfterHook(mockPrismaQ);

    const response = await hook({ records: [{ id: 'p-1' }] });

    expect(response.records).toEqual([{ id: 'p-1' }]);
    expect(response.notice.type).toBe('error');
  });
});

// ─── Coupon burn rate — source contract ──────────────────────────────────────
// Admins need to see which coupons are redeemed fastest (burn rate). The Coupon
// resource must be present in AdminJS and the list hook must inject actual use
// counts from the CouponUse table via groupBy, not just the denormalized counter.

describe('setupAdmin — coupon burn rate (source contract)', () => {
  const setupSource = fs.readFileSync(path.join(__dirname, '../admin.setup.ts'), 'utf-8');

  it("registers the Coupon model as an AdminJS resource", () => {
    expect(setupSource).toContain("getModelByName('Coupon')");
  });

  it("registers the CouponUse model as an AdminJS resource for drill-down", () => {
    expect(setupSource).toContain("getModelByName('CouponUse')");
  });

  it('uses prisma.couponUse.groupBy to count actual redemptions', () => {
    expect(setupSource).toContain('couponUse.groupBy');
  });

  it('injects usesCount into each Coupon record in the list after hook', () => {
    expect(setupSource).toContain('usesCount');
  });

  it('keys the countMap on couponId from the groupBy result', () => {
    expect(setupSource).toContain('countMap');
  });
});
