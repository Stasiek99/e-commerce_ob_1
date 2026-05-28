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
          },
        },
        {
          provide: AuthService,
          useValue: {
            requestEmailChange: jest.fn(),
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

    it('delegates to UsersService.deleteAccount with the authenticated user id', async () => {
      usersService.deleteAccount.mockResolvedValue(undefined);

      await controller.deleteMe(mockUser as any, makeMockResponse());

      expect(usersService.deleteAccount).toHaveBeenCalledTimes(1);
      expect(usersService.deleteAccount).toHaveBeenCalledWith('user-1');
    });

    it('clears the refresh-token cookie after deletion', async () => {
      usersService.deleteAccount.mockResolvedValue(undefined);
      const res = makeMockResponse();

      await controller.deleteMe(mockUser as any, res);

      expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE, { path: '/' });
    });

    it('clears cookie even when order anonymisation produced zero updates', async () => {
      usersService.deleteAccount.mockResolvedValue(undefined);
      const res = makeMockResponse();

      await controller.deleteMe(mockUser as any, res);

      expect(res.clearCookie).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from UsersService without touching the cookie', async () => {
      usersService.deleteAccount.mockRejectedValue(new Error('DB failure'));
      const res = makeMockResponse();

      await expect(controller.deleteMe(mockUser as any, res)).rejects.toThrow('DB failure');
      expect(res.clearCookie).not.toHaveBeenCalled();
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
