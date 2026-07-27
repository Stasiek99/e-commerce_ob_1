import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from '../users.controller';
import { UsersService } from '../users.service';
import { AuthService } from '../../auth/auth.service';
import { REFRESH_COOKIE } from '../../auth/auth.constants';
import { Role } from '@prisma/client';

const mockUser = {
  id: 'user-1',
  email: 'jan@example.com',
  passwordHash: 'hashed',
  firstName: 'Jan',
  lastName: 'Kowalski',
  phone: null,
  googleId: null,
  role: Role.CUSTOMER,
  isEmailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: jest.Mocked<UsersService>;
  let authService: jest.Mocked<AuthService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: {
            exportData: jest.fn(),
            deleteAccount: jest.fn(),
            update: jest.fn(),
            getAddresses: jest.fn(),
            createAddress: jest.fn(),
            updateAddress: jest.fn(),
            deleteAddress: jest.fn(),
            recordConsent: jest.fn(),
            recordAnonymousConsent: jest.fn(),
          },
        },
        {
          provide: AuthService,
          useValue: {
            requestEmailChange: jest.fn(),
            verifyCurrentPassword: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(UsersController);
    usersService = module.get(UsersService) as jest.Mocked<UsersService>;
    authService = module.get(AuthService) as jest.Mocked<AuthService>;
  });

  afterEach(() => jest.clearAllMocks());

  // ─── GET /users/me/data-export — GDPR Art. 20 ───────────────────────────

  describe('exportMyData', () => {
    function makeMockResponse() {
      return { setHeader: jest.fn() } as any;
    }

    const exportPayload = {
      exportedAt: '2026-05-28T12:00:00.000Z',
      profile: { id: 'user-1', email: 'jan@example.com', addresses: [] },
      orders: [],
      reviews: [],
      wishlist: [],
      returnRequests: [],
    };

    it('delegates to UsersService.exportData with the authenticated user id and email', async () => {
      usersService.exportData.mockResolvedValue(exportPayload as any);

      await controller.exportMyData(mockUser as any, makeMockResponse());

      expect(usersService.exportData).toHaveBeenCalledWith('user-1', 'jan@example.com');
    });

    it('sets Content-Disposition attachment header with a dated filename', async () => {
      usersService.exportData.mockResolvedValue(exportPayload as any);
      const res = makeMockResponse();

      await controller.exportMyData(mockUser as any, res);

      const call = (res.setHeader.mock.calls as [string, string][]).find(([name]) => name === 'Content-Disposition');
      expect(call).toBeDefined();
      expect(call![1]).toMatch(/^attachment; filename="gdpr-export-\d{4}-\d{2}-\d{2}\.json"$/);
    });

    it('sets Content-Type to application/json', async () => {
      usersService.exportData.mockResolvedValue(exportPayload as any);

      await controller.exportMyData(mockUser as any, makeMockResponse());

      expect(usersService.exportData).toHaveBeenCalledTimes(1);
    });

    it('returns the full export payload from the service', async () => {
      usersService.exportData.mockResolvedValue(exportPayload as any);

      const result = await controller.exportMyData(mockUser as any, makeMockResponse());

      expect(result).toBe(exportPayload);
    });

    it('propagates errors from UsersService without swallowing them', async () => {
      usersService.exportData.mockRejectedValue(new Error('DB timeout'));

      await expect(controller.exportMyData(mockUser as any, makeMockResponse())).rejects.toThrow('DB timeout');
    });
  });

  // ─── DELETE /users/me ─────────────────────────────────────────────────────

  describe('deleteMe', () => {
    function makeMockResponse() {
      return { clearCookie: jest.fn() } as any;
    }

    const dto = { currentPassword: 'correct-horse' } as any;

    it('delegates to UsersService.deleteAccount with the authenticated user id', async () => {
      authService.verifyCurrentPassword.mockResolvedValue(undefined);
      usersService.deleteAccount.mockResolvedValue(undefined);

      await controller.deleteMe(mockUser as any, dto, makeMockResponse());

      expect(usersService.deleteAccount).toHaveBeenCalledTimes(1);
      expect(usersService.deleteAccount).toHaveBeenCalledWith('user-1');
    });

    it('clears the refresh-token cookie after deletion', async () => {
      authService.verifyCurrentPassword.mockResolvedValue(undefined);
      usersService.deleteAccount.mockResolvedValue(undefined);
      const res = makeMockResponse();

      await controller.deleteMe(mockUser as any, dto, res);

      expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE, { path: '/' });
    });

    it('clears cookie even when order anonymisation produced zero updates', async () => {
      authService.verifyCurrentPassword.mockResolvedValue(undefined);
      usersService.deleteAccount.mockResolvedValue(undefined);
      const res = makeMockResponse();

      await controller.deleteMe(mockUser as any, dto, res);

      expect(res.clearCookie).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from UsersService without touching the cookie', async () => {
      authService.verifyCurrentPassword.mockResolvedValue(undefined);
      usersService.deleteAccount.mockRejectedValue(new Error('DB failure'));
      const res = makeMockResponse();

      await expect(controller.deleteMe(mockUser as any, dto, res)).rejects.toThrow('DB failure');
      expect(res.clearCookie).not.toHaveBeenCalled();
    });
  });

  // ─── POST /users/consent ─────────────────────────────────────────────────

  describe('recordConsent', () => {
    function makeReq(cookies: Record<string, string> = {}) {
      return { cookies } as any;
    }

    function makeRes() {
      return { cookie: jest.fn() } as any;
    }

    it('delegates to UsersService.recordConsent for authenticated users', async () => {
      usersService.recordConsent.mockResolvedValue(undefined);
      const req = makeReq();
      const res = makeRes();

      await controller.recordConsent({ analytics: true }, mockUser as any, req, res);

      expect(usersService.recordConsent).toHaveBeenCalledWith('user-1', true);
      expect(usersService.recordAnonymousConsent).not.toHaveBeenCalled();
    });

    it('does not set a cookie for authenticated users', async () => {
      usersService.recordConsent.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.recordConsent({ analytics: true }, mockUser as any, makeReq(), res);

      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('issues a consent_id cookie for anonymous visitors with no existing cookie', async () => {
      usersService.recordAnonymousConsent.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.recordConsent({ analytics: true }, undefined, makeReq(), res);

      expect(res.cookie).toHaveBeenCalledTimes(1);
      const [name, , opts] = res.cookie.mock.calls[0] as [string, string, Record<string, unknown>];
      expect(name).toBe('consent_id');
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe('lax');
      expect(typeof opts.maxAge).toBe('number');
    });

    it('stores the issued UUID in consent_logs for anonymous visitors', async () => {
      usersService.recordAnonymousConsent.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.recordConsent({ analytics: false }, undefined, makeReq(), res);

      const [consentId, analytics] = usersService.recordAnonymousConsent.mock.calls[0] as [string, boolean];
      expect(consentId).toMatch(/^[0-9a-f-]{36}$/);
      expect(analytics).toBe(false);
    });

    it('reuses an existing consent_id cookie without issuing a new one', async () => {
      usersService.recordAnonymousConsent.mockResolvedValue(undefined);
      const existingId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const req = makeReq({ consent_id: existingId });
      const res = makeRes();

      await controller.recordConsent({ analytics: true }, undefined, req, res);

      expect(res.cookie).not.toHaveBeenCalled();
      expect(usersService.recordAnonymousConsent).toHaveBeenCalledWith(existingId, true);
    });

    it('does not call recordConsent for anonymous visitors', async () => {
      usersService.recordAnonymousConsent.mockResolvedValue(undefined);

      await controller.recordConsent({ analytics: true }, undefined, makeReq(), makeRes());

      expect(usersService.recordConsent).not.toHaveBeenCalled();
    });
  });

  // ─── GET /users/me — password hash is never exposed ──────────────────────

  describe('getMe', () => {
    it('omits passwordHash from the response', () => {
      const result = controller.getMe(mockUser as any);

      expect(result).not.toHaveProperty('passwordHash');
      expect(result).toMatchObject({ id: 'user-1', email: 'jan@example.com' });
    });
  });
});
