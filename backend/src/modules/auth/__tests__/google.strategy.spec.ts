import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { GoogleStrategy } from '../strategies/google.strategy';
import { AuthService } from '../auth.service';

const MOCK_CONFIG: Record<string, string> = {
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:3000/auth/google/callback',
};

const mockUser = {
  id: 'user-1',
  email: 'jan@example.com',
  role: Role.CUSTOMER,
  firstName: 'Jan',
  lastName: 'Kowalski',
  googleId: 'google-id-1',
  isEmailVerified: true,
  passwordHash: null,
  phone: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('GoogleStrategy', () => {
  let strategy: GoogleStrategy;
  let authService: { findOrCreateGoogleUser: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleStrategy,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockImplementation((key: string) => {
              const value = MOCK_CONFIG[key];
              if (!value) throw new Error(`Missing env var: ${key}`);
              return value;
            }),
          },
        },
        {
          provide: AuthService,
          useValue: {
            findOrCreateGoogleUser: jest.fn(),
          },
        },
      ],
    }).compile();

    strategy = module.get(GoogleStrategy);
    authService = module.get(AuthService) as any;
    jest.clearAllMocks();
  });

  // ─── CSRF state protection ────────────────────────────────────────────────────

  describe('CSRF state protection', () => {
    it('uses SessionStore (state: true) to prevent CSRF login-linkage attacks', () => {
      const stateStore = (strategy as any)._stateStore;

      expect(stateStore).toBeDefined();
      expect(stateStore.constructor.name).toBe('SessionStore');
    });

    it('does NOT use NullStore which would allow stateless (unverified) callbacks', () => {
      const stateStore = (strategy as any)._stateStore;

      expect(stateStore.constructor.name).not.toBe('NullStore');
    });
  });

  // ─── validate ─────────────────────────────────────────────────────────────────

  describe('validate', () => {
    it('invokes findOrCreateGoogleUser with profile data and calls done(null, user) on success', async () => {
      authService.findOrCreateGoogleUser.mockResolvedValue(mockUser);
      const done = jest.fn();

      await strategy.validate(
        'access-token',
        'refresh-token',
        {
          id: 'google-id-1',
          emails: [{ value: 'jan@example.com' }],
          name: { givenName: 'Jan', familyName: 'Kowalski' },
        } as any,
        done,
      );

      expect(authService.findOrCreateGoogleUser).toHaveBeenCalledWith({
        googleId: 'google-id-1',
        email: 'jan@example.com',
        firstName: 'Jan',
        lastName: 'Kowalski',
      });
      expect(done).toHaveBeenCalledWith(null, mockUser);
    });

    it('calls done with an Error and never calls the service when profile has no emails field', async () => {
      const done = jest.fn();

      await strategy.validate(
        'access-token',
        'refresh-token',
        { id: 'google-id-2', emails: undefined, name: {} } as any,
        done,
      );

      expect(authService.findOrCreateGoogleUser).not.toHaveBeenCalled();
      expect(done).toHaveBeenCalledWith(expect.any(Error), undefined);
    });

    it('calls done with an Error when emails array is present but empty', async () => {
      const done = jest.fn();

      await strategy.validate(
        'access-token',
        'refresh-token',
        { id: 'google-id-3', emails: [], name: {} } as any,
        done,
      );

      expect(authService.findOrCreateGoogleUser).not.toHaveBeenCalled();
      expect(done).toHaveBeenCalledWith(expect.any(Error), undefined);
    });

    it('passes undefined firstName and lastName when profile name is absent', async () => {
      authService.findOrCreateGoogleUser.mockResolvedValue(mockUser);
      const done = jest.fn();

      await strategy.validate(
        'access-token',
        'refresh-token',
        {
          id: 'google-id-4',
          emails: [{ value: 'noname@example.com' }],
          name: undefined,
        } as any,
        done,
      );

      expect(authService.findOrCreateGoogleUser).toHaveBeenCalledWith({
        googleId: 'google-id-4',
        email: 'noname@example.com',
        firstName: undefined,
        lastName: undefined,
      });
    });

    it('propagates a service rejection so the caller observes the failure', async () => {
      authService.findOrCreateGoogleUser.mockRejectedValue(new Error('DB unavailable'));
      const done = jest.fn();

      await expect(
        strategy.validate(
          'access-token',
          'refresh-token',
          {
            id: 'google-id-5',
            emails: [{ value: 'jan@example.com' }],
            name: { givenName: 'Jan', familyName: 'K' },
          } as any,
          done,
        ),
      ).rejects.toThrow('DB unavailable');
    });
  });
});
