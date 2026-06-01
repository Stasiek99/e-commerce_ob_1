import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { ExchangeTokenDto } from '../dto/exchange-token.dto';

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

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { generateTokenPair: jest.Mock };
  let redis: { set: jest.Mock; getdel: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            register: jest.fn(),
            login: jest.fn(),
            refresh: jest.fn(),
            logout: jest.fn(),
            verifyEmail: jest.fn(),
            resendVerificationEmail: jest.fn(),
            requestPasswordReset: jest.fn(),
            resetPassword: jest.fn(),
            requestMagicLink: jest.fn(),
            consumeMagicLink: jest.fn(),
            generateTokenPair: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('http://localhost:4200'),
          },
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: {
            set: jest.fn().mockResolvedValue('OK'),
            getdel: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(AuthController);
    authService = module.get(AuthService) as any;
    redis = module.get('REDIS_CLIENT') as any;
  });

  afterEach(() => jest.clearAllMocks());

  // ─── exchangeOAuthToken — CSRF nonce guard ────────────────────────────────────

  describe('exchangeOAuthToken — CSRF nonce guard', () => {
    const validDto: ExchangeTokenDto = { nonce: 'valid-nonce-abc' };

    it('throws UnauthorizedException when nonce is absent from Redis (never issued or expired)', async () => {
      redis.getdel.mockResolvedValue(null);
      const req = { cookies: { oauth_access_token: 'at-1' } };
      const res = { clearCookie: jest.fn() };

      await expect(
        controller.exchangeOAuthToken(validDto, req as any, res as any),
      ).rejects.toThrow(UnauthorizedException);

      expect(res.clearCookie).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException on replay — second call with same nonce returns null from getdel', async () => {
      redis.getdel
        .mockResolvedValueOnce('1')   // first call: nonce consumed
        .mockResolvedValueOnce(null); // second call: already gone
      const makeReq = () => ({ cookies: { oauth_access_token: 'at-1' } });
      const makeRes = () => ({ clearCookie: jest.fn() });

      await controller.exchangeOAuthToken(validDto, makeReq() as any, makeRes() as any);

      await expect(
        controller.exchangeOAuthToken(validDto, makeReq() as any, makeRes() as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when nonce is valid but oauth cookie is absent', async () => {
      redis.getdel.mockResolvedValue('1');
      const req = { cookies: {} };
      const res = { clearCookie: jest.fn() };

      await expect(
        controller.exchangeOAuthToken(validDto, req as any, res as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns accessToken and clears exchange cookie when nonce and cookie are both valid', async () => {
      redis.getdel.mockResolvedValue('1');
      const req = { cookies: { oauth_access_token: 'my-jwt' } };
      const res = { clearCookie: jest.fn() };

      const result = await controller.exchangeOAuthToken(validDto, req as any, res as any);

      expect(result).toEqual({ accessToken: 'my-jwt' });
      expect(res.clearCookie).toHaveBeenCalledWith('oauth_access_token', { path: '/' });
    });

    it('calls getdel with the oauth_nonce:<nonce> key — verifying the Redis key format', async () => {
      redis.getdel.mockResolvedValue(null);
      const req = { cookies: {} };
      const res = { clearCookie: jest.fn() };

      await expect(
        controller.exchangeOAuthToken({ nonce: 'abc123' }, req as any, res as any),
      ).rejects.toThrow(UnauthorizedException);

      expect(redis.getdel).toHaveBeenCalledWith('oauth_nonce:abc123');
    });
  });

  // ─── logout — cookie cleanup ──────────────────────────────────────────────────

  describe('logout — cookie cleanup', () => {
    it('clears both refresh_token and oauth_access_token cookies', async () => {
      (authService as any).logout = jest.fn().mockResolvedValue(undefined);
      const req = { cookies: { refresh_token: 'rt-val' } };
      const res = { clearCookie: jest.fn() };

      await controller.logout(req as any, res as any);

      const clearedNames = (res.clearCookie as jest.Mock).mock.calls.map(
        (args: unknown[]) => args[0] as string,
      );
      expect(clearedNames).toContain('refresh_token');
      expect(clearedNames).toContain('oauth_access_token');
    });

    it('clears oauth_access_token even when no refresh token cookie is present', async () => {
      const req = { cookies: {} };
      const res = { clearCookie: jest.fn() };

      await controller.logout(req as any, res as any);

      const clearedNames = (res.clearCookie as jest.Mock).mock.calls.map(
        (args: unknown[]) => args[0] as string,
      );
      expect(clearedNames).toContain('oauth_access_token');
    });

    it('clears both cookies with path / so they are matched by the browser', async () => {
      (authService as any).logout = jest.fn().mockResolvedValue(undefined);
      const req = { cookies: { refresh_token: 'rt-val' } };
      const res = { clearCookie: jest.fn() };

      await controller.logout(req as any, res as any);

      const calls = (res.clearCookie as jest.Mock).mock.calls as [string, { path: string }][];
      for (const [, options] of calls) {
        expect(options).toMatchObject({ path: '/' });
      }
    });

    it('does not call authService.logout when no refresh token cookie is present', async () => {
      const req = { cookies: {} };
      const res = { clearCookie: jest.fn() };

      await controller.logout(req as any, res as any);

      expect((authService as any).logout).not.toHaveBeenCalled();
    });
  });

  // ─── googleCallback — nonce issuance ─────────────────────────────────────────

  describe('googleCallback — nonce issuance', () => {
    beforeEach(() => {
      authService.generateTokenPair.mockResolvedValue({
        accessToken: 'at-val',
        refreshToken: 'rt-val',
      });
    });

    it('stores a 64-char hex nonce in Redis with a 60-second TTL', async () => {
      const res = { cookie: jest.fn(), redirect: jest.fn() };

      await controller.googleCallback(mockUser as any, res as any);

      expect(redis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^oauth_nonce:[a-f0-9]{64}$/),
        '1',
        'EX',
        60,
      );
    });

    it('appends #state=<nonce> fragment to the redirect URL', async () => {
      const res = { cookie: jest.fn(), redirect: jest.fn() };

      await controller.googleCallback(mockUser as any, res as any);

      const redirectUrl: string = (res.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectUrl).toMatch(/\/auth\/callback#state=[a-f0-9]{64}$/);
    });

    it('sets both the refresh cookie and the short-lived oauth_access_token cookie', async () => {
      const res = { cookie: jest.fn(), redirect: jest.fn() };

      await controller.googleCallback(mockUser as any, res as any);

      const setCookieNames = (res.cookie as jest.Mock).mock.calls.map(
        (args: unknown[]) => args[0] as string,
      );
      expect(setCookieNames).toContain('refresh_token');
      expect(setCookieNames).toContain('oauth_access_token');
    });

    it('nonce in the redirect URL matches the Redis key written (end-to-end consistency)', async () => {
      const res = { cookie: jest.fn(), redirect: jest.fn() };

      await controller.googleCallback(mockUser as any, res as any);

      const redisKey: string = (redis.set as jest.Mock).mock.calls[0][0];
      const nonce = redisKey.replace('oauth_nonce:', '');
      const redirectUrl: string = (res.redirect as jest.Mock).mock.calls[0][0];

      expect(redirectUrl).toContain(`#state=${nonce}`);
    });

    it('generates a unique nonce for each callback invocation', async () => {
      const res1 = { cookie: jest.fn(), redirect: jest.fn() };
      const res2 = { cookie: jest.fn(), redirect: jest.fn() };

      await controller.googleCallback(mockUser as any, res1 as any);
      await controller.googleCallback(mockUser as any, res2 as any);

      const url1: string = (res1.redirect as jest.Mock).mock.calls[0][0];
      const url2: string = (res2.redirect as jest.Mock).mock.calls[0][0];

      expect(url1).not.toBe(url2);
    });
  });

  // ─── cookie SameSite/Secure derived from ConfigService ──────────────────────
  // Invariant: CROSS_SITE must be evaluated at controller construction time via
  // ConfigService, NOT at module-import time via process.env. The stale constant
  // locked cookies to Secure=false/SameSite=Lax before ConfigModule finished loading.

  describe('refresh-token cookie attributes — ConfigService-derived CROSS_SITE', () => {
    async function buildControllerWithFrontendUrl(frontendUrl: string) {
      const mockAuthSvc = {
        register: jest.fn().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
        login: jest.fn(),
        refresh: jest.fn(),
        logout: jest.fn(),
        verifyEmail: jest.fn(),
        resendVerificationEmail: jest.fn(),
        requestPasswordReset: jest.fn(),
        resetPassword: jest.fn(),
        requestMagicLink: jest.fn(),
        consumeMagicLink: jest.fn(),
        generateTokenPair: jest.fn(),
      };
      const module = await Test.createTestingModule({
        controllers: [AuthController],
        providers: [
          { provide: AuthService, useValue: mockAuthSvc },
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue(frontendUrl) },
          },
          {
            provide: 'REDIS_CLIENT',
            useValue: { set: jest.fn().mockResolvedValue('OK'), getdel: jest.fn() },
          },
        ],
      }).compile();
      return { ctrl: module.get(AuthController), authSvc: mockAuthSvc };
    }

    it('sets Secure=true and SameSite=none when FRONTEND_URL starts with https://', async () => {
      const { ctrl } = await buildControllerWithFrontendUrl('https://shop.example.com');
      const res = { cookie: jest.fn() };
      const dto = { email: 'a@b.com', password: 'pass' };
      (ctrl as any).authService.login.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' });

      await ctrl.login(dto as any, res as any);

      const cookieCall = (res.cookie as jest.Mock).mock.calls[0];
      expect(cookieCall[2]).toMatchObject({ secure: true, sameSite: 'none' });
    });

    it('sets Secure=false and SameSite=lax when FRONTEND_URL starts with http://', async () => {
      const { ctrl } = await buildControllerWithFrontendUrl('http://localhost:4200');
      const res = { cookie: jest.fn() };
      const dto = { email: 'a@b.com', password: 'pass' };
      (ctrl as any).authService.login.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' });

      await ctrl.login(dto as any, res as any);

      const cookieCall = (res.cookie as jest.Mock).mock.calls[0];
      expect(cookieCall[2]).toMatchObject({ secure: false, sameSite: 'lax' });
    });

    it('sets Secure=false and SameSite=lax when FRONTEND_URL is empty', async () => {
      const { ctrl } = await buildControllerWithFrontendUrl('');
      const res = { cookie: jest.fn() };
      const dto = { email: 'a@b.com', password: 'pass' };
      (ctrl as any).authService.login.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' });

      await ctrl.login(dto as any, res as any);

      const cookieCall = (res.cookie as jest.Mock).mock.calls[0];
      expect(cookieCall[2]).toMatchObject({ secure: false, sameSite: 'lax' });
    });

    it('register also uses ConfigService-derived secure attributes', async () => {
      const { ctrl } = await buildControllerWithFrontendUrl('https://prod.example.com');
      const res = { cookie: jest.fn() };
      (ctrl as any).authService.register.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' });

      await ctrl.register({} as any, res as any);

      const cookieCall = (res.cookie as jest.Mock).mock.calls[0];
      expect(cookieCall[2]).toMatchObject({ secure: true, sameSite: 'none' });
    });
  });
});
