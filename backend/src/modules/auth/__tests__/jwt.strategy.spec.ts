import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { UsersService } from '../../users/users.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  role: Role.CUSTOMER,
  firstName: 'Jan',
  lastName: 'Kowalski',
  passwordHash: null,
  phone: null,
  googleId: null,
  pendingEmail: null,
  isEmailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// A payload issued at Unix second 1_700_000_000 (arbitrary fixed point in time)
const ISSUED_AT = 1_700_000_000;
const validPayload = { sub: 'user-1', email: 'test@example.com', role: 'CUSTOMER', iat: ISSUED_AT };
const payloadWithJti = { ...validPayload, jti: 'jti-abc123' };

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let usersService: { findById: jest.Mock };
  let redis: { get: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockImplementation((key: string) => {
              if (key === 'JWT_ACCESS_SECRET') return 'test-secret';
              throw new Error(`Missing env var: ${key}`);
            }),
            get: jest.fn().mockReturnValue(undefined), // JWT_ACCESS_SECRET_PREV absent by default
          },
        },
        {
          provide: JwtService,
          useValue: { verify: jest.fn().mockReturnValue({}) },
        },
        {
          provide: UsersService,
          useValue: { findById: jest.fn() },
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    strategy = module.get(JwtStrategy);
    usersService = module.get(UsersService) as any;
    redis = module.get('REDIS_CLIENT');
    jest.clearAllMocks();
  });

  // ─── Access token revocation fence ───────────────────────────────────────────

  describe('validate — revocation fence', () => {
    it('throws UnauthorizedException when token iat is before the fence timestamp', async () => {
      // Fence written 5 seconds after this token was issued
      redis.get.mockResolvedValue(String((ISSUED_AT + 5) * 1000));

      await expect(strategy.validate(validPayload)).rejects.toThrow(UnauthorizedException);
    });

    it('throws with "Token has been revoked" message when the fence blocks the token', async () => {
      redis.get.mockResolvedValue(String((ISSUED_AT + 1) * 1000));

      await expect(strategy.validate(validPayload)).rejects.toThrow('Token has been revoked');
    });

    it('short-circuits before the DB lookup when the fence blocks the token', async () => {
      redis.get.mockResolvedValue(String((ISSUED_AT + 5) * 1000));

      await expect(strategy.validate(validPayload)).rejects.toThrow(UnauthorizedException);

      expect(usersService.findById).not.toHaveBeenCalled();
    });

    it('allows token through and returns user when iat is after the fence', async () => {
      // Fence is 10 seconds in the past relative to token issue time
      redis.get.mockResolvedValue(String((ISSUED_AT - 10) * 1000));
      usersService.findById.mockResolvedValue(mockUser);

      const result = await strategy.validate(validPayload);

      expect(result).toEqual(mockUser);
    });

    it('allows token through when no revocation fence exists in Redis (null)', async () => {
      redis.get.mockResolvedValue(null);
      usersService.findById.mockResolvedValue(mockUser);

      const result = await strategy.validate(validPayload);

      expect(result).toEqual(mockUser);
    });

    it('does NOT block a token issued at exactly the fence boundary (fence is strict less-than)', async () => {
      // iat * 1000 === revokeBeforeMs → should pass through
      redis.get.mockResolvedValue(String(ISSUED_AT * 1000));
      usersService.findById.mockResolvedValue(mockUser);

      const result = await strategy.validate(validPayload);

      expect(result).toEqual(mockUser);
    });

    it('looks up Redis using a key scoped to the token subject (userId)', async () => {
      redis.get.mockResolvedValue(null);
      usersService.findById.mockResolvedValue(mockUser);

      await strategy.validate(validPayload);

      expect(redis.get).toHaveBeenCalledWith('auth:revoke-before:user-1');
    });

    it('uses a different key per user so one revocation does not affect another user', async () => {
      const otherPayload = { ...validPayload, sub: 'user-99' };
      // user-99 has no fence
      redis.get.mockResolvedValue(null);
      usersService.findById.mockResolvedValue({ ...mockUser, id: 'user-99' });

      await strategy.validate(otherPayload);

      expect(redis.get).toHaveBeenCalledWith('auth:revoke-before:user-99');
      expect(redis.get).not.toHaveBeenCalledWith('auth:revoke-before:user-1');
    });
  });

  // ─── Redis circuit-breaker ────────────────────────────────────────────────────

  describe('validate — Redis circuit-breaker', () => {
    it('allows request through and returns user when Redis throws a connection error', async () => {
      redis.get.mockRejectedValue(new Error('ECONNREFUSED'));
      usersService.findById.mockResolvedValue(mockUser);

      const result = await strategy.validate(validPayload);

      expect(result).toEqual(mockUser);
    });

    it('reports to Sentry with auth.redis tag when Redis throws a connection error', async () => {
      const redisError = new Error('ECONNREFUSED');
      redis.get.mockRejectedValue(redisError);
      usersService.findById.mockResolvedValue(mockUser);

      await strategy.validate(validPayload);

      expect(Sentry.captureException).toHaveBeenCalledWith(
        redisError,
        expect.objectContaining({ tags: { 'auth.redis': 'unavailable' } }),
      );
    });

    it('re-throws UnauthorizedException from the revocation check and does not swallow it', async () => {
      redis.get.mockResolvedValue(String((ISSUED_AT + 5) * 1000));

      await expect(strategy.validate(validPayload)).rejects.toThrow(UnauthorizedException);
    });

    it('does not call Sentry when revocation check throws UnauthorizedException', async () => {
      redis.get.mockResolvedValue(String((ISSUED_AT + 5) * 1000));

      await expect(strategy.validate(validPayload)).rejects.toThrow(UnauthorizedException);

      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('proceeds to DB lookup after swallowing a Redis connection error', async () => {
      redis.get.mockRejectedValue(new Error('Redis timeout'));
      usersService.findById.mockResolvedValue(mockUser);

      await strategy.validate(validPayload);

      expect(usersService.findById).toHaveBeenCalledWith('user-1');
    });
  });

  // ─── User existence check ─────────────────────────────────────────────────────

  describe('validate — user existence', () => {
    it('throws UnauthorizedException when user no longer exists in DB', async () => {
      redis.get.mockResolvedValue(null);
      usersService.findById.mockResolvedValue(null);

      await expect(strategy.validate(validPayload)).rejects.toThrow(UnauthorizedException);
    });

    it('returns the user record when both the fence check and DB lookup pass', async () => {
      redis.get.mockResolvedValue(null);
      usersService.findById.mockResolvedValue(mockUser);

      const result = await strategy.validate(validPayload);

      expect(result).toEqual(mockUser);
      expect(usersService.findById).toHaveBeenCalledWith('user-1');
    });
  });

  // ─── Per-token jti blocklist ──────────────────────────────────────────────────

  describe('validate — jti blocklist', () => {
    it('throws UnauthorizedException when the jti appears in the Redis blocklist', async () => {
      redis.get.mockImplementation((key: string) =>
        Promise.resolve(key === `auth:revoked-jti:${payloadWithJti.jti}` ? '1' : null),
      );

      await expect(strategy.validate(payloadWithJti)).rejects.toThrow(UnauthorizedException);
    });

    it('throws "Token has been revoked" when the jti is blocklisted', async () => {
      redis.get.mockImplementation((key: string) =>
        Promise.resolve(key === `auth:revoked-jti:${payloadWithJti.jti}` ? '1' : null),
      );

      await expect(strategy.validate(payloadWithJti)).rejects.toThrow('Token has been revoked');
    });

    it('does not reach the DB lookup when the jti is blocklisted', async () => {
      redis.get.mockImplementation((key: string) =>
        Promise.resolve(key === `auth:revoked-jti:${payloadWithJti.jti}` ? '1' : null),
      );

      await expect(strategy.validate(payloadWithJti)).rejects.toThrow(UnauthorizedException);

      expect(usersService.findById).not.toHaveBeenCalled();
    });

    it('allows token through when the jti is not in the blocklist (null)', async () => {
      redis.get.mockResolvedValue(null);
      usersService.findById.mockResolvedValue(mockUser);

      const result = await strategy.validate(payloadWithJti);

      expect(result).toEqual(mockUser);
    });

    it('checks the jti-scoped key in Redis when jti is present in payload', async () => {
      redis.get.mockResolvedValue(null);
      usersService.findById.mockResolvedValue(mockUser);

      await strategy.validate(payloadWithJti);

      expect(redis.get).toHaveBeenCalledWith(`auth:revoked-jti:${payloadWithJti.jti}`);
    });

    it('does not check any jti key when the payload has no jti field', async () => {
      redis.get.mockResolvedValue(null);
      usersService.findById.mockResolvedValue(mockUser);

      await strategy.validate(validPayload);

      const jtiCallArgs = redis.get.mock.calls.map((c) => c[0] as string);
      expect(jtiCallArgs.every((k) => !k.startsWith('auth:revoked-jti:'))).toBe(true);
    });

    it('blocklists a specific token without affecting another token for the same user', async () => {
      const otherJtiPayload = { ...validPayload, jti: 'other-jti-xyz' };

      redis.get.mockImplementation((key: string) =>
        // Only 'jti-abc123' is blocklisted; 'other-jti-xyz' is clean
        Promise.resolve(key === `auth:revoked-jti:${payloadWithJti.jti}` ? '1' : null),
      );
      usersService.findById.mockResolvedValue(mockUser);

      // Blocklisted token must fail
      await expect(strategy.validate(payloadWithJti)).rejects.toThrow(UnauthorizedException);

      // Clean token must succeed
      const result = await strategy.validate(otherJtiPayload);
      expect(result).toEqual(mockUser);
    });
  });
});
