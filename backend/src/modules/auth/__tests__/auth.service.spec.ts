import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { EmailTokenType, Prisma, Role } from '@prisma/client';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../../users/users.service';
import { EmailQueueService } from '../../email/email-queue.service';

const makeP2002 = (target: string) =>
  new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on the fields: (\`${target}\`)`, {
    code: 'P2002',
    clientVersion: '6.0.0',
    meta: { target: [target] },
  });

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  passwordHash: null as string | null,
  role: Role.CUSTOMER,
  firstName: 'Jan',
  lastName: 'Kowalski',
  phone: null,
  googleId: null,
  isEmailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let prisma: any;
  let jwtService: jest.Mocked<JwtService>;
  let emailService: any;
  let redis: {
    set: jest.Mock;
    get: jest.Mock;
    exists: jest.Mock;
    incr: jest.Mock;
    expire: jest.Mock;
    setex: jest.Mock;
    del: jest.Mock;
  };

  beforeEach(async () => {
    // $transaction supports both call styles used in auth.service.ts: array-style
    // (resetPassword, changePassword, verifyEmail's plain-verification branch)
    // eagerly evaluates its queries when the array literal is constructed, so the
    // literal [{}, {}] resolution is enough for those callers. Callback-style
    // (rotateToken, consumeMagicLink, verifyEmail's email-change branch) must
    // actually invoke the callback — routed to this same prismaMock so existing
    // assertions on e.g. prisma.refreshToken.create continue to work unchanged.
    const prismaMock: any = {
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      emailVerificationToken: {
        updateMany: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      passwordResetToken: {
        updateMany: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    prismaMock.$transaction = jest.fn().mockImplementation((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(prismaMock)
        : Promise.resolve([{}, {}]),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            findByGoogleId: jest.fn(),
            findById: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock-access-token'),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            // JWT_ACCESS_EXPIRES_IN drives revokeBeforeTtlSecs (15m → 900s, matching
            // the literal the rest of this suite asserts on). Other keys (e.g.
            // FRONTEND_URL) fall through to whatever default the call site passes.
            get: jest.fn((key: string, defaultValue?: unknown) =>
              key === 'JWT_ACCESS_EXPIRES_IN' ? '15m' : defaultValue,
            ),
          },
        },
        {
          provide: EmailQueueService,
          useValue: {
            sendEmailVerification: jest.fn().mockResolvedValue(undefined),
            sendEmailChangeVerification: jest.fn().mockResolvedValue(undefined),
            sendPasswordReset: jest.fn().mockResolvedValue(undefined),
            sendMagicLink: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: {
            set: jest.fn().mockResolvedValue('OK'),
            get: jest.fn(),
            exists: jest.fn().mockResolvedValue(0),
            incr: jest.fn().mockResolvedValue(1),
            expire: jest.fn().mockResolvedValue(1),
            setex: jest.fn().mockResolvedValue('OK'),
            del: jest.fn().mockResolvedValue(1),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
    prisma = module.get(PrismaService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
    emailService = module.get(EmailQueueService);
    redis = module.get('REDIS_CLIENT');
  });

  describe('register', () => {
    it('throws ConflictException when email is already in use', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as any);

      await expect(
        service.register({ email: 'test@example.com', password: 'pass', firstName: 'Jan', lastName: 'K' }),
      ).rejects.toThrow(ConflictException);

      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('creates user with hashed password and returns token pair', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue(mockUser as any);

      const result = await service.register({
        email: 'new@example.com',
        password: 'plaintext',
        firstName: 'Jan',
        lastName: 'K',
      });

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@example.com' }),
      );
      const createdWithHash = usersService.create.mock.calls[0][0];
      expect(await bcrypt.compare('plaintext', createdWithHash.passwordHash as string)).toBe(true);
      expect(result).toHaveProperty('accessToken', 'mock-access-token');
      expect(result).toHaveProperty('refreshToken');
    });

    // ─── concurrent registration race (fix: unhandled P2002 → raw 500) ────────
    // Invariant: a second concurrent request can pass the findByEmail
    // pre-check before either create() commits. The DB-level @unique on
    // User.email is the real guard — its P2002 must map to the same 409
    // the pre-check throws, not an unhandled 500.

    it('throws ConflictException when create() races to a P2002 on email', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockRejectedValue(makeP2002('email'));

      await expect(
        service.register({ email: 'race@example.com', password: 'pass', firstName: 'Jan', lastName: 'K' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException with message "Email already in use" on P2002 race', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockRejectedValue(makeP2002('email'));

      await expect(
        service.register({ email: 'race@example.com', password: 'pass', firstName: 'Jan', lastName: 'K' }),
      ).rejects.toThrow('Email already in use');
    });

    it('re-throws non-P2002 errors from create() without wrapping', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      const dbError = new Error('Database connection lost');
      usersService.create.mockRejectedValue(dbError);

      await expect(
        service.register({ email: 'new@example.com', password: 'pass', firstName: 'Jan', lastName: 'K' }),
      ).rejects.toThrow(dbError);
    });
  });

  describe('login', () => {
    it('throws UnauthorizedException when user is not found', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(service.login('missing@example.com', 'pass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when user has no password (OAuth-only account)', async () => {
      usersService.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: null } as any);

      await expect(service.login('test@example.com', 'pass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when password is wrong', async () => {
      const hash = await bcrypt.hash('correctpass', 10);
      usersService.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);

      await expect(service.login('test@example.com', 'wrongpass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns token pair on correct credentials', async () => {
      const hash = await bcrypt.hash('correctpass', 10);
      usersService.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);

      const result = await service.login('test@example.com', 'correctpass');

      expect(result).toHaveProperty('accessToken', 'mock-access-token');
      expect(result).toHaveProperty('refreshToken');
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });

    describe('per-email lockout', () => {
      it('throws UnauthorizedException with lockout message when account is locked', async () => {
        redis.exists.mockResolvedValue(1);

        await expect(service.login('victim@example.com', 'anypass')).rejects.toThrow(
          'Account temporarily locked',
        );

        expect(usersService.findByEmail).not.toHaveBeenCalled();
      });

      it('normalizes email to lowercase before checking the lock key', async () => {
        redis.exists.mockResolvedValue(1);

        await expect(service.login('VICTIM@Example.COM', 'anypass')).rejects.toThrow(
          UnauthorizedException,
        );

        expect(redis.exists).toHaveBeenCalledWith('auth:login-locked:victim@example.com');
      });

      it('increments failure counter and sets expire on first failed attempt (user not found)', async () => {
        usersService.findByEmail.mockResolvedValue(null);
        redis.incr.mockResolvedValue(1);

        await expect(service.login('missing@example.com', 'anypass')).rejects.toThrow(
          UnauthorizedException,
        );

        expect(redis.incr).toHaveBeenCalledWith('auth:login-failures:missing@example.com');
        expect(redis.expire).toHaveBeenCalledWith('auth:login-failures:missing@example.com', 900);
      });

      it('increments failure counter but skips expire on subsequent failures', async () => {
        usersService.findByEmail.mockResolvedValue(null);
        redis.incr.mockResolvedValue(5);

        await expect(service.login('missing@example.com', 'anypass')).rejects.toThrow(
          UnauthorizedException,
        );

        expect(redis.incr).toHaveBeenCalledTimes(1);
        expect(redis.expire).not.toHaveBeenCalled();
      });

      it('sets lock key with 900-second TTL after the 10th failure on wrong password', async () => {
        const hash = await bcrypt.hash('correctpass', 10);
        usersService.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);
        redis.incr.mockResolvedValue(10);

        await expect(service.login('test@example.com', 'wrongpass')).rejects.toThrow(
          UnauthorizedException,
        );

        expect(redis.setex).toHaveBeenCalledWith('auth:login-locked:test@example.com', 900, '1');
      });

      it('does not set lock key before the 10th failure', async () => {
        const hash = await bcrypt.hash('correctpass', 10);
        usersService.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);
        redis.incr.mockResolvedValue(9);

        await expect(service.login('test@example.com', 'wrongpass')).rejects.toThrow(
          UnauthorizedException,
        );

        expect(redis.setex).not.toHaveBeenCalled();
      });

      it('deletes failure counter on successful login', async () => {
        const hash = await bcrypt.hash('correctpass', 10);
        usersService.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);

        await service.login('test@example.com', 'correctpass');

        expect(redis.del).toHaveBeenCalledWith('auth:login-failures:test@example.com');
      });

      it('does not delete failure counter when login fails', async () => {
        usersService.findByEmail.mockResolvedValue(null);

        await expect(service.login('test@example.com', 'wrongpass')).rejects.toThrow(
          UnauthorizedException,
        );

        expect(redis.del).not.toHaveBeenCalled();
      });
    });

    // ─── Redis outage safety valve ────────────────────────────────────────────
    // IORedis with maxRetriesPerRequest: null queues calls forever on outage,
    // hanging every login until TimeoutInterceptor fires. The fix wraps every
    // Redis call in try/catch: on error, skip the rate-limit and allow login
    // to proceed (fail-open). UnauthorizedException from valid lockouts or bad
    // credentials must still propagate — Redis errors must not suppress them.

    describe('Redis outage safety valve', () => {
      const redisError = new Error('Redis connection refused');

      it('allows login to succeed when redis.exists() throws during lockout check', async () => {
        redis.exists.mockRejectedValue(redisError);

        const hash = await bcrypt.hash('correctpass', 10);
        usersService.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);
        redis.del.mockResolvedValue(1);

        const result = await service.login('test@example.com', 'correctpass');

        expect(result).toHaveProperty('accessToken', 'mock-access-token');
      });

      it('still throws UnauthorizedException for bad password when redis.exists() throws', async () => {
        redis.exists.mockRejectedValue(redisError);

        const hash = await bcrypt.hash('correctpass', 10);
        usersService.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);

        await expect(service.login('test@example.com', 'wrongpass')).rejects.toThrow(
          UnauthorizedException,
        );
      });

      it('still throws UnauthorizedException for missing user when redis.incr() throws', async () => {
        redis.exists.mockResolvedValue(0);
        redis.incr.mockRejectedValue(redisError);
        usersService.findByEmail.mockResolvedValue(null);

        await expect(service.login('missing@example.com', 'anypass')).rejects.toThrow(
          UnauthorizedException,
        );
      });

      it('still throws UnauthorizedException for wrong password when redis.incr() throws', async () => {
        redis.exists.mockResolvedValue(0);
        redis.incr.mockRejectedValue(redisError);

        const hash = await bcrypt.hash('correctpass', 10);
        usersService.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);

        await expect(service.login('test@example.com', 'wrongpass')).rejects.toThrow(
          UnauthorizedException,
        );
      });

      it('returns token pair when redis.del() throws on successful login', async () => {
        redis.exists.mockResolvedValue(0);
        redis.del.mockRejectedValue(redisError);

        const hash = await bcrypt.hash('correctpass', 10);
        usersService.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);

        const result = await service.login('test@example.com', 'correctpass');

        expect(result).toHaveProperty('accessToken', 'mock-access-token');
      });

      it('re-throws the UnauthorizedException from an active lockout even inside the try/catch', async () => {
        redis.exists.mockResolvedValue(1); // account is locked

        await expect(service.login('victim@example.com', 'anypass')).rejects.toThrow(
          'Account temporarily locked',
        );
      });

      it('does not call usersService.findByEmail when the lockout check is skipped on Redis error', async () => {
        redis.exists.mockRejectedValue(redisError);

        const hash = await bcrypt.hash('correctpass', 10);
        usersService.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);
        redis.del.mockResolvedValue(1);

        await service.login('test@example.com', 'correctpass');

        // findByEmail is called once for credential resolution, not blocked by Redis error
        expect(usersService.findByEmail).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('validateRefreshTokenByRaw', () => {
    it('returns null when token does not exist in DB', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      const result = await service.validateRefreshTokenByRaw('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null when token is revoked', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        tokenHash: 'hash',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        user: mockUser,
      });

      const result = await service.validateRefreshTokenByRaw('revoked-token');
      expect(result).toBeNull();
    });

    it('returns null when token is expired', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        tokenHash: 'hash',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        user: mockUser,
      });

      const result = await service.validateRefreshTokenByRaw('expired-token');
      expect(result).toBeNull();
    });

    it('returns user when token is valid', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        tokenHash: 'hash',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        user: mockUser,
      });

      const result = await service.validateRefreshTokenByRaw('valid-raw-token');
      expect(result).toEqual(mockUser);
    });
  });

  describe('refresh', () => {
    it('throws UnauthorizedException when token does not exist', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh('user-1', 'bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when token belongs to a different user', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-99',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60),
        user: { ...mockUser, id: 'user-99' },
      });

      await expect(service.refresh('user-1', 'some-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rotates token: revokes old one and returns new pair', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        family: 'family-1',
        replacedBy: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60),
        user: mockUser,
      });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.refresh('user-1', 'valid-raw-token');

      // Atomic guard: revokedAt: null in the WHERE clause — see rotateToken fix.
      // data now includes replacedBy in addition to revokedAt — use objectContaining
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rt-1', revokedAt: null },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
      expect(result).toHaveProperty('accessToken', 'mock-access-token');
      expect(result).toHaveProperty('refreshToken');
    });
  });

  describe('findOrCreateGoogleUser', () => {
    it('returns existing user when found by googleId', async () => {
      usersService.findByGoogleId.mockResolvedValue(mockUser as any);

      const result = await service.findOrCreateGoogleUser({
        googleId: 'gid-1',
        email: 'test@example.com',
      });

      expect(result).toEqual(mockUser);
      expect(usersService.findByEmail).not.toHaveBeenCalled();
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('links googleId to an existing email account', async () => {
      usersService.findByGoogleId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(mockUser as any);
      usersService.update.mockResolvedValue({ ...mockUser, googleId: 'gid-1' } as any);

      await service.findOrCreateGoogleUser({
        googleId: 'gid-1',
        email: 'test@example.com',
      });

      expect(usersService.update).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ googleId: 'gid-1', isEmailVerified: true }),
      );
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('creates a new user when no matching account exists', async () => {
      usersService.findByGoogleId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue({ ...mockUser, googleId: 'gid-new' } as any);

      await service.findOrCreateGoogleUser({
        googleId: 'gid-new',
        email: 'new@example.com',
        firstName: 'New',
        lastName: 'User',
      });

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          googleId: 'gid-new',
          email: 'new@example.com',
          isEmailVerified: true,
        }),
      );
    });

    // ─── account-hijack guard (fix: block silent OAuth takeover of password accounts) ─

    it('throws ConflictException when Google email matches a password-protected account without a linked googleId', async () => {
      // An attacker controls a Google account sharing the victim's email.
      // Before the fix, findOrCreateGoogleUser() would silently link and issue a session.
      const passwordAccount = { ...mockUser, passwordHash: '$2b$10$hashedpassword', googleId: null };
      usersService.findByGoogleId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(passwordAccount as any);

      await expect(
        service.findOrCreateGoogleUser({ googleId: 'gid-attacker', email: 'test@example.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('does not link googleId or issue a session when the hijack guard fires', async () => {
      const passwordAccount = { ...mockUser, passwordHash: '$2b$10$hashedpassword', googleId: null };
      usersService.findByGoogleId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(passwordAccount as any);

      await expect(
        service.findOrCreateGoogleUser({ googleId: 'gid-attacker', email: 'test@example.com' }),
      ).rejects.toThrow(ConflictException);

      expect(usersService.update).not.toHaveBeenCalled();
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('links googleId when the existing email account has no password set (passwordless or invite account)', async () => {
      // passwordHash=null means the account was created without a password
      // (e.g., invited or via another OAuth provider). Linking is safe.
      const passwordlessAccount = { ...mockUser, passwordHash: null, googleId: null };
      usersService.findByGoogleId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(passwordlessAccount as any);
      usersService.update.mockResolvedValue({ ...passwordlessAccount, googleId: 'gid-safe' } as any);

      await service.findOrCreateGoogleUser({ googleId: 'gid-safe', email: 'test@example.com' });

      expect(usersService.update).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ googleId: 'gid-safe', isEmailVerified: true }),
      );
    });

    // ─── concurrent first-time Google sign-in race (fix: unhandled P2002 → raw 500) ─
    // Invariant: two concurrent callbacks for the same never-seen email can both
    // pass the findByGoogleId/findByEmail checks above before either create()
    // commits. The DB-level @unique on User.email/User.googleId is the real
    // guard — its P2002 must map to a 409, not an unhandled 500.

    it('throws ConflictException when create() races to a P2002 for a never-seen email', async () => {
      usersService.findByGoogleId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockRejectedValue(makeP2002('email'));

      await expect(
        service.findOrCreateGoogleUser({ googleId: 'gid-race', email: 'race@example.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('re-throws non-P2002 errors from create() without wrapping', async () => {
      usersService.findByGoogleId.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);
      const dbError = new Error('Database connection lost');
      usersService.create.mockRejectedValue(dbError);

      await expect(
        service.findOrCreateGoogleUser({ googleId: 'gid-new', email: 'new@example.com' }),
      ).rejects.toThrow(dbError);
    });
  });

  describe('logout', () => {
    it('revokes the refresh token by hash', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({ userId: 'user-1' });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.logout('some-raw-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { revokedAt: expect.any(Date) } }),
      );
    });

    it('writes the access-token revocation fence to Redis when the refresh token exists in the database', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({ userId: 'user-1' });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.logout('some-raw-token');

      expect(redis.set).toHaveBeenCalledWith(
        'auth:revoke-before:user-1',
        expect.any(String),
        'EX',
        900,
      );
    });

    it('does not write the revocation fence when the refresh token is not found in the database', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await service.logout('unknown-raw-token');

      expect(redis.set).not.toHaveBeenCalled();
    });

    it('still resolves when Redis is unavailable while writing the revocation fence (DB-side revocation already committed)', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({ userId: 'user-1' });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      redis.set.mockRejectedValueOnce(new Error('Redis unavailable'));

      await expect(service.logout('some-raw-token')).resolves.toBeUndefined();
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { revokedAt: expect.any(Date) } }),
      );
    });

    it('looks up the refresh token by its SHA-256 hash to obtain the userId before revoking', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({ userId: 'user-1' });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.logout('some-raw-token');

      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
        select: { userId: true },
      });
    });

    it('resolves without throwing when called with an unrecognised token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.logout('totally-unknown-token')).resolves.toBeUndefined();
    });
  });

  describe('refresh (additional branch coverage)', () => {
    it('throws UnauthorizedException when token is revoked with no replacedBy (e.g. logout)', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        family: 'family-1',
        replacedBy: null,
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        user: mockUser,
      });

      await expect(service.refresh('user-1', 'revoked-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when token is expired', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        family: 'family-1',
        replacedBy: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        user: mockUser,
      });

      await expect(service.refresh('user-1', 'expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── Token Family & Reuse Detection ──────────────────────────────────────────

  describe('refresh — token family and reuse detection', () => {
    const validToken = {
      id: 'rt-1',
      userId: 'user-1',
      family: 'family-abc',
      replacedBy: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      user: mockUser,
    };

    it('propagates the same family to the newly issued rotation token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({ ...validToken });

      await service.refresh('user-1', 'valid-raw-token');

      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ family: 'family-abc' }),
        }),
      );
    });

    it('stamps replacedBy on the consumed token with the new token hash', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({ ...validToken });

      await service.refresh('user-1', 'valid-raw-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rt-1', revokedAt: null },
          data: expect.objectContaining({
            revokedAt: expect.any(Date),
            replacedBy: expect.stringMatching(/^[a-f0-9]{64}$/), // SHA-256 hex
          }),
        }),
      );
    });

    it('revokes the entire family when a rotated token is replayed outside the 30-second grace window', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...validToken,
        revokedAt: new Date(Date.now() - 60_000), // 60 seconds ago — outside grace
        replacedBy: 'some-replacement-hash',
      });

      await expect(service.refresh('user-1', 'stale-rotated-token')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ family: 'family-abc', revokedAt: null }),
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });

    it('does not revoke family when token was explicitly revoked with no replacedBy (logout path)', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...validToken,
        revokedAt: new Date(Date.now() - 60_000),
        replacedBy: null, // logout — no rotation happened
      });

      await expect(service.refresh('user-1', 'logged-out-token')).rejects.toThrow(
        UnauthorizedException,
      );

      // Family must NOT be touched — this is not a theft signal
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ family: 'family-abc' }),
        }),
      );
    });

    it('performs network-drop recovery: rotates the replacement when called within 30-second grace window', async () => {
      const replacementToken = {
        id: 'rt-replacement',
        userId: 'user-1',
        family: 'family-abc',
        replacedBy: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      // First call: the original (now-revoked) token with revokedAt 5s ago
      prisma.refreshToken.findUnique
        .mockResolvedValueOnce({
          ...validToken,
          revokedAt: new Date(Date.now() - 5_000),
          replacedBy: 'replacement-hash-abc',
        })
        // Second call: the replacement token (still valid)
        .mockResolvedValueOnce(replacementToken);

      const result = await service.refresh('user-1', 'network-drop-raw-token');

      // The replacement token should now be revoked (atomic guard) and a fresh one issued
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rt-replacement', revokedAt: null } }),
      );
      expect(result).toHaveProperty('accessToken', 'mock-access-token');
      expect(result).toHaveProperty('refreshToken');
      expect(typeof result.refreshToken).toBe('string');
    });

    // ─── multi-tab race, end-to-end (regression — auth-session-lifecycle-model.md §5) ──
    // Two tabs share one cookie jar. TabA refreshes first and rotates the only
    // live token. TabB still holds the now-stale cookie and refreshes moments
    // later, inside REFRESH_GRACE_MS. Unlike the synthetic-state tests above,
    // this drives two real sequential service.refresh() calls from the same
    // starting token to prove the documented claim end-to-end: both tabs end
    // up authenticated, neither gets logged out nor triggers theft detection.
    it('keeps both tabs authenticated when TabB redeems the same stale cookie inside the grace window', async () => {
      // TabA: refreshes first with the only live token in the family.
      prisma.refreshToken.findUnique.mockResolvedValueOnce({ ...validToken });

      const resultA = await service.refresh('user-1', 'shared-raw-token');
      expect(resultA).toHaveProperty('accessToken');
      expect(resultA).toHaveProperty('refreshToken');

      // TabB: same raw token, now stale — TabA already rotated it. Within the
      // grace window, refresh() recovers by looking up the replacement TabA's
      // rotation created.
      prisma.refreshToken.findUnique
        .mockResolvedValueOnce({
          ...validToken,
          revokedAt: new Date(), // just rotated by TabA
          replacedBy: 'tabA-replacement-hash',
        })
        .mockResolvedValueOnce({
          id: 'rt-tabA-replacement',
          userId: 'user-1',
          family: 'family-abc',
          replacedBy: null,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

      const resultB = await service.refresh('user-1', 'shared-raw-token');

      // TabB must recover into a fresh session — not get logged out, and not
      // trigger the family-wide theft revocation.
      expect(resultB).toHaveProperty('accessToken');
      expect(resultB).toHaveProperty('refreshToken');
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ family: 'family-abc', revokedAt: null }),
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });

    // ─── concurrent-tab double-rotation guard (fix) ──────────────────────────
    // Two browser tabs can both receive a 401 and both retry refresh() with the
    // same stale raw token within the grace window. Before the fix, rotateToken()
    // used a plain `update` with no WHERE guard, so both concurrent calls could
    // each successfully rotate the same "replacement" token — splitting the
    // family into two divergent child chains and defeating reuse detection.
    // The atomic `updateMany({ where: { id, revokedAt: null } })` guard ensures
    // only the first racer wins; the second must see a clean rejection.

    it('throws UnauthorizedException when a concurrent request already rotated the replacement token (lost the race)', async () => {
      const replacementToken = {
        id: 'rt-replacement',
        userId: 'user-1',
        family: 'family-abc',
        replacedBy: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      prisma.refreshToken.findUnique
        .mockResolvedValueOnce({
          ...validToken,
          revokedAt: new Date(Date.now() - 5_000),
          replacedBy: 'replacement-hash-abc',
        })
        .mockResolvedValueOnce(replacementToken);
      // Simulates the second concurrent tab losing the atomic race: the first
      // request already flipped revokedAt, so this updateMany matches 0 rows.
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.refresh('user-1', 'network-drop-raw-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('does not create a new token when the atomic rotation guard loses the race', async () => {
      const replacementToken = {
        id: 'rt-replacement',
        userId: 'user-1',
        family: 'family-abc',
        replacedBy: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      prisma.refreshToken.findUnique
        .mockResolvedValueOnce({
          ...validToken,
          revokedAt: new Date(Date.now() - 5_000),
          replacedBy: 'replacement-hash-abc',
        })
        .mockResolvedValueOnce(replacementToken);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.refresh('user-1', 'network-drop-raw-token')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('falls back to theft detection when the replacement is already revoked during the grace window', async () => {
      // First call: revoked within grace window, has replacedBy
      prisma.refreshToken.findUnique
        .mockResolvedValueOnce({
          ...validToken,
          revokedAt: new Date(Date.now() - 5_000),
          replacedBy: 'already-compromised-hash',
        })
        // Second call: replacement is also revoked — attacker used it already
        .mockResolvedValueOnce({
          id: 'rt-replacement',
          userId: 'user-1',
          family: 'family-abc',
          replacedBy: null,
          revokedAt: new Date(), // already revoked
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

      await expect(service.refresh('user-1', 'compromised-token')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ family: 'family-abc', revokedAt: null }),
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });
  });

  // ─── validateRefreshTokenByRaw — grace-window behavior ───────────────────────

  describe('validateRefreshTokenByRaw — grace window', () => {
    it('returns user for a recently-rotated token within the 30-second grace window', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        tokenHash: 'hash',
        family: 'family-1',
        replacedBy: 'some-replacement-hash',
        revokedAt: new Date(Date.now() - 5_000), // 5 seconds ago
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        user: mockUser,
      });

      const result = await service.validateRefreshTokenByRaw('recent-rotation-token');
      expect(result).toEqual(mockUser);
    });

    it('returns null when token was revoked by logout (replacedBy is null — not a rotation)', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        tokenHash: 'hash',
        family: 'family-1',
        replacedBy: null,
        revokedAt: new Date(Date.now() - 5_000), // recent but from logout
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        user: mockUser,
      });

      const result = await service.validateRefreshTokenByRaw('logged-out-token');
      expect(result).toBeNull();
    });

    it('returns null when the rotation happened more than 30 seconds ago', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        tokenHash: 'hash',
        family: 'family-1',
        replacedBy: 'some-replacement-hash',
        revokedAt: new Date(Date.now() - 60_000), // 60 seconds ago — outside grace
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        user: mockUser,
      });

      const result = await service.validateRefreshTokenByRaw('old-rotated-token');
      expect(result).toBeNull();
    });
  });

  // ─── generateTokenPair — family initialization ────────────────────────────────

  describe('generateTokenPair', () => {
    it('creates the refresh token with a non-empty family field', async () => {
      await service.generateTokenPair(mockUser as any);

      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ family: expect.stringMatching(/^[0-9a-f-]{36}$/i) }),
        }),
      );
    });

    it('assigns a unique family UUID to each new token pair (different sessions)', async () => {
      await service.generateTokenPair(mockUser as any);
      await service.generateTokenPair(mockUser as any);

      const firstFamily = (prisma.refreshToken.create.mock.calls[0][0] as any).data.family;
      const secondFamily = (prisma.refreshToken.create.mock.calls[1][0] as any).data.family;

      expect(typeof firstFamily).toBe('string');
      expect(firstFamily).not.toBe(secondFamily);
    });
  });

  describe('resendVerificationEmail', () => {
    it('returns early when user is not found', async () => {
      usersService.findById.mockResolvedValue(null);

      await service.resendVerificationEmail('user-1');

      expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
    });

    it('returns early when user is already verified', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, isEmailVerified: true } as any);

      await service.resendVerificationEmail('user-1');

      expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
    });

    it('issues a new token and sends email when user is unverified', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, isEmailVerified: false } as any);

      await service.resendVerificationEmail('user-1');

      expect(prisma.emailVerificationToken.create).toHaveBeenCalled();
      expect(emailService.sendEmailVerification).toHaveBeenCalledWith(
        expect.objectContaining({ to: mockUser.email }),
      );
    });
  });

  describe('verifyEmail', () => {
    it('returns early without DB write when user is already verified (idempotent)', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'vt-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        type: EmailTokenType.EMAIL_VERIFICATION,
        user: { ...mockUser, isEmailVerified: true },
      });

      await service.verifyEmail('already-verified-token');

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for an expired EMAIL_VERIFICATION token even when the account is already verified', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'vt-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        type: EmailTokenType.EMAIL_VERIFICATION,
        user: { ...mockUser, isEmailVerified: true },
      });

      await expect(service.verifyEmail('expired-already-verified-token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for a used EMAIL_VERIFICATION token even when the account is already verified', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'vt-1',
        userId: 'user-1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        type: EmailTokenType.EMAIL_VERIFICATION,
        user: { ...mockUser, isEmailVerified: true },
      });

      await expect(service.verifyEmail('used-already-verified-token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when token does not exist', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(null);

      await expect(service.verifyEmail('nonexistent-token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when token has already been used', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'vt-1',
        userId: 'user-1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        user: { ...mockUser, isEmailVerified: false },
      });

      await expect(service.verifyEmail('used-token')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when token is expired', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'vt-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        user: { ...mockUser, isEmailVerified: false },
      });

      await expect(service.verifyEmail('expired-token')).rejects.toThrow(BadRequestException);
    });

    it('marks token as used and sets user verified on valid token', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'vt-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: { ...mockUser, isEmailVerified: false },
      });

      await service.verifyEmail('valid-token');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException when a MAGIC_LINK token is used on this endpoint', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'vt-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        type: EmailTokenType.MAGIC_LINK,
        user: { ...mockUser, isEmailVerified: false },
      });

      await expect(service.verifyEmail('magic-link-token')).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    describe('email-change flow (pendingEmail)', () => {
      const storedToken = {
        id: 'vt-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        type: EmailTokenType.EMAIL_VERIFICATION,
        user: { ...mockUser, isEmailVerified: false, pendingEmail: 'new@example.com' },
      };

      it('promotes pendingEmail to email and revokes all refresh tokens on a valid token', async () => {
        prisma.emailVerificationToken.findUnique.mockResolvedValue(storedToken);
        prisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 });

        await service.verifyEmail('valid-change-token');

        expect(prisma.user.update).toHaveBeenCalledWith({
          where: { id: 'user-1' },
          data: { email: 'new@example.com', pendingEmail: null, isEmailVerified: true },
        });
        expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
          where: { userId: 'user-1', revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        });
      });

      it('throws ConflictException when the pending email was claimed by another user', async () => {
        prisma.emailVerificationToken.findUnique.mockResolvedValue(storedToken);
        prisma.user.findUnique.mockResolvedValue({ id: 'other-user', email: 'new@example.com' });

        await expect(service.verifyEmail('valid-change-token')).rejects.toThrow(ConflictException);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('does not throw the conflict when the pending email is already owned by the same user', async () => {
        prisma.emailVerificationToken.findUnique.mockResolvedValue(storedToken);
        prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'new@example.com' });
        prisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 });

        await expect(service.verifyEmail('valid-change-token')).resolves.toEqual({ type: 'email_change' });
      });

      // ── race condition: a newer requestEmailChange() invalidated this token ──

      it('throws BadRequestException and does not promote the stale pendingEmail when the token was invalidated mid-flight', async () => {
        prisma.emailVerificationToken.findUnique.mockResolvedValue(storedToken);
        // Simulates a concurrent requestEmailChange() committing its invalidating
        // updateMany (usedAt: null guard) between this verifyEmail's initial read
        // and its own transaction — the atomic guard must see count: 0 and reject
        // instead of confirming the captured (now superseded) pendingEmail.
        prisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 0 });

        await expect(service.verifyEmail('raced-change-token')).rejects.toThrow(
          BadRequestException,
        );
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      });

      it('guards the email-change promotion with usedAt: null in the same updateMany call that marks it used', async () => {
        prisma.emailVerificationToken.findUnique.mockResolvedValue(storedToken);
        prisma.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 });

        await service.verifyEmail('valid-change-token');

        expect(prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({
          where: { id: 'vt-1', usedAt: null },
          data: { usedAt: expect.any(Date) },
        });
      });
    });
  });

  // ─── Request Email Change ─────────────────────────────────────────────────────

  describe('requestEmailChange', () => {
    it('throws BadRequestException when the requesting user does not exist', async () => {
      usersService.findById.mockResolvedValue(null);

      await expect(
        service.requestEmailChange('ghost-user', 'new@example.com', 'whatever'),
      ).rejects.toThrow(BadRequestException);

      expect(usersService.findByEmail).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the account is OAuth-only (no passwordHash)', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, passwordHash: null } as any);

      await expect(
        service.requestEmailChange('user-1', 'new@example.com', 'whatever'),
      ).rejects.toThrow(UnauthorizedException);

      expect(usersService.findByEmail).not.toHaveBeenCalled();
      expect(prisma.emailVerificationToken.updateMany).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when currentPassword is wrong', async () => {
      const hash = await bcrypt.hash('correctpass', 10);
      usersService.findById.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);

      await expect(
        service.requestEmailChange('user-1', 'new@example.com', 'wrongpass'),
      ).rejects.toThrow(UnauthorizedException);

      expect(usersService.findByEmail).not.toHaveBeenCalled();
      expect(prisma.emailVerificationToken.updateMany).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the new email is already taken by another account', async () => {
      const hash = await bcrypt.hash('correctpass', 10);
      usersService.findById.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);
      usersService.findByEmail.mockResolvedValue({ ...mockUser, id: 'other-user' } as any);

      await expect(
        service.requestEmailChange('user-1', 'taken@example.com', 'correctpass'),
      ).rejects.toThrow(ConflictException);

      expect(prisma.emailVerificationToken.updateMany).not.toHaveBeenCalled();
    });

    it('revokes ALL existing email verification tokens — including MAGIC_LINK — before issuing the change token', async () => {
      const hash = await bcrypt.hash('correctpass', 10);
      usersService.findById.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);
      usersService.findByEmail.mockResolvedValue(null);

      await service.requestEmailChange('user-1', 'new@example.com', 'correctpass');

      // Must NOT include a type filter — both EMAIL_VERIFICATION and MAGIC_LINK must be revoked
      expect(prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ type: expect.anything() }),
          data: { usedAt: expect.any(Date) },
        }),
      );
    });

    it('scopes the revocation to the requesting user only', async () => {
      const hash = await bcrypt.hash('correctpass', 10);
      usersService.findById.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);
      usersService.findByEmail.mockResolvedValue(null);

      await service.requestEmailChange('user-1', 'new@example.com', 'correctpass');

      expect(prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-1', usedAt: null }),
        }),
      );
    });

    it('stores the new email as pendingEmail on the user record', async () => {
      const hash = await bcrypt.hash('correctpass', 10);
      usersService.findById.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);
      usersService.findByEmail.mockResolvedValue(null);

      await service.requestEmailChange('user-1', 'new@example.com', 'correctpass');

      expect(usersService.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ pendingEmail: 'new@example.com' }),
      );
    });

    it('creates a new email verification token and sends the change-confirmation email', async () => {
      const hash = await bcrypt.hash('correctpass', 10);
      usersService.findById.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);
      usersService.findByEmail.mockResolvedValue(null);

      await service.requestEmailChange('user-1', 'new@example.com', 'correctpass');

      expect(prisma.emailVerificationToken.create).toHaveBeenCalledTimes(1);
      expect(emailService.sendEmailChangeVerification).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'new@example.com', newEmail: 'new@example.com' }),
      );
    });

    it('allows the change when the new email matches the requesting user own current email (no-op conflict check)', async () => {
      const hash = await bcrypt.hash('correctpass', 10);
      usersService.findById.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);
      // findByEmail returns the same user → should not throw ConflictException
      usersService.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);

      await expect(
        service.requestEmailChange('user-1', 'test@example.com', 'correctpass'),
      ).resolves.toBeUndefined();
    });

    it('writes the access-token revocation fence to Redis so already-issued tokens stop carrying the old email claim', async () => {
      const hash = await bcrypt.hash('correctpass', 10);
      usersService.findById.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);
      usersService.findByEmail.mockResolvedValue(null);

      await service.requestEmailChange('user-1', 'new@example.com', 'correctpass');

      expect(redis.set).toHaveBeenCalledWith(
        'auth:revoke-before:user-1',
        expect.stringMatching(/^\d+$/),
        'EX',
        900,
      );
    });

    it('does not write the revocation fence when the new email is already taken (request rejected before any side effects)', async () => {
      const hash = await bcrypt.hash('correctpass', 10);
      usersService.findById.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);
      usersService.findByEmail.mockResolvedValue({ ...mockUser, id: 'other-user' } as any);

      await expect(
        service.requestEmailChange('user-1', 'taken@example.com', 'correctpass'),
      ).rejects.toThrow(ConflictException);

      expect(redis.set).not.toHaveBeenCalledWith(
        'auth:revoke-before:user-1',
        expect.any(String),
        'EX',
        900,
      );
    });

    it('does not write the revocation fence when currentPassword is wrong', async () => {
      const hash = await bcrypt.hash('correctpass', 10);
      usersService.findById.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);

      await expect(
        service.requestEmailChange('user-1', 'new@example.com', 'wrongpass'),
      ).rejects.toThrow(UnauthorizedException);

      expect(redis.set).not.toHaveBeenCalledWith(
        'auth:revoke-before:user-1',
        expect.any(String),
        'EX',
        900,
      );
    });
  });

  describe('requestPasswordReset', () => {
    it('returns silently when user is not found (never reveal registration status)', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await service.requestPasswordReset('nobody@example.com');

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('returns silently when user is OAuth-only (no password)', async () => {
      usersService.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: null } as any);

      await service.requestPasswordReset('test@example.com');

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('creates a reset token and sends email for a password-enabled account', async () => {
      usersService.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: 'hashed' } as any);

      await service.requestPasswordReset('test@example.com');

      expect(prisma.passwordResetToken.create).toHaveBeenCalled();
      expect(emailService.sendPasswordReset).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'test@example.com' }),
      );
    });

    it('returns silently without sending email when per-email dedupe key exists in Redis', async () => {
      redis.exists.mockResolvedValue(1); // key present → cooldown active

      await service.requestPasswordReset('test@example.com');

      expect(usersService.findByEmail).not.toHaveBeenCalled();
      expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('sets per-email dedupe key with 300s TTL after sending the reset email', async () => {
      redis.exists.mockResolvedValue(0);
      usersService.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: 'hashed' } as any);

      await service.requestPasswordReset('test@example.com');

      expect(redis.set).toHaveBeenCalledWith(
        `pwd-reset-sent:test@example.com`,
        '1',
        'EX',
        300,
      );
    });

    it('does not set dedupe key when user has no password (email never sent)', async () => {
      redis.exists.mockResolvedValue(0);
      usersService.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: null } as any);

      await service.requestPasswordReset('test@example.com');

      expect(redis.set).not.toHaveBeenCalledWith(
        expect.stringContaining('pwd-reset-sent'),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('normalises email to lowercase before checking the dedupe key', async () => {
      redis.exists.mockResolvedValue(0);
      usersService.findByEmail.mockResolvedValue({ ...mockUser, passwordHash: 'hashed' } as any);

      await service.requestPasswordReset('Test@Example.COM');

      expect(redis.exists).toHaveBeenCalledWith('pwd-reset-sent:test@example.com');
    });
  });

  describe('resetPassword', () => {
    it('throws BadRequestException when token does not exist', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(service.resetPassword('bad-token', 'newpass')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when token is already used', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        userId: 'user-1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        user: mockUser,
      });

      await expect(service.resetPassword('used-token', 'newpass')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when token is expired', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        user: mockUser,
      });

      await expect(service.resetPassword('expired-token', 'newpass')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('resets password and revokes all refresh tokens in a single transaction', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: mockUser,
      });

      await service.resetPassword('valid-token', 'newStrongPassword123');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('writes the access token revocation fence to Redis after a successful password reset', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: mockUser,
      });

      await service.resetPassword('valid-token', 'newStrongPassword123');

      expect(redis.set).toHaveBeenCalledWith(
        'auth:revoke-before:user-1',
        expect.stringMatching(/^\d+$/),
        'EX',
        900,
      );
    });

    it('does not write revocation fence when reset token is invalid', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(service.resetPassword('bad-token', 'newpass')).rejects.toThrow(
        BadRequestException,
      );

      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  // ─── Change Password ──────────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('throws UnauthorizedException when user is not found', async () => {
      usersService.findById.mockResolvedValue(null);

      await expect(service.changePassword('user-1', 'currentPass', 'newPass')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when user is OAuth-only (no passwordHash)', async () => {
      usersService.findById.mockResolvedValue({ ...mockUser, passwordHash: null } as any);

      await expect(service.changePassword('user-1', 'currentPass', 'newPass')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when current password is wrong', async () => {
      const hash = await bcrypt.hash('correctpass', 10);
      usersService.findById.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);

      await expect(service.changePassword('user-1', 'wrongpass', 'newpass12345')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('updates passwordHash with a valid bcrypt hash of newPassword', async () => {
      const hash = await bcrypt.hash('currentpass', 10);
      usersService.findById.mockResolvedValue({ ...mockUser, id: 'user-1', passwordHash: hash } as any);

      await service.changePassword('user-1', 'currentpass', 'brandnewpass');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' } }),
      );
      const newHash = prisma.user.update.mock.calls[0][0].data.passwordHash as string;
      expect(await bcrypt.compare('brandnewpass', newHash)).toBe(true);
      expect(await bcrypt.compare('currentpass', newHash)).toBe(false);
    });

    it('revokes all active refresh tokens for the user in the same transaction', async () => {
      const hash = await bcrypt.hash('currentpass', 10);
      usersService.findById.mockResolvedValue({ ...mockUser, id: 'user-1', passwordHash: hash } as any);

      await service.changePassword('user-1', 'currentpass', 'brandnewpass');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-1', revokedAt: null }),
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });

    it('performs the password update and token revocation atomically (single $transaction call)', async () => {
      const hash = await bcrypt.hash('currentpass', 10);
      usersService.findById.mockResolvedValue({ ...mockUser, id: 'user-1', passwordHash: hash } as any);

      await service.changePassword('user-1', 'currentpass', 'brandnewpass');

      // Both operations must be batched — the mock captures the array passed to $transaction
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    });

    // ─── Access token revocation fence ─────────────────────────────────────────

    it('writes the access token revocation fence to Redis after a successful password change', async () => {
      const hash = await bcrypt.hash('currentpass', 10);
      usersService.findById.mockResolvedValue({ ...mockUser, id: 'user-1', passwordHash: hash } as any);

      await service.changePassword('user-1', 'currentpass', 'brandnewpass');

      expect(redis.set).toHaveBeenCalledWith(
        'auth:revoke-before:user-1',
        expect.stringMatching(/^\d+$/),
        'EX',
        900,
      );
    });

    it('sets the revocation fence TTL to 900 seconds (one access token lifetime)', async () => {
      const hash = await bcrypt.hash('currentpass', 10);
      usersService.findById.mockResolvedValue({ ...mockUser, id: 'user-1', passwordHash: hash } as any);

      await service.changePassword('user-1', 'currentpass', 'brandnewpass');

      const [, , , ttl] = redis.set.mock.calls[0];
      expect(ttl).toBe(900);
    });

    it('stores the current time as the fence value so older tokens are identified by iat', async () => {
      const hash = await bcrypt.hash('currentpass', 10);
      usersService.findById.mockResolvedValue({ ...mockUser, id: 'user-1', passwordHash: hash } as any);
      const before = Date.now();

      await service.changePassword('user-1', 'currentpass', 'brandnewpass');

      const after = Date.now();
      const fenceMs = parseInt(redis.set.mock.calls[0][1], 10);
      expect(fenceMs).toBeGreaterThanOrEqual(before);
      expect(fenceMs).toBeLessThanOrEqual(after);
    });

    it('does not write revocation fence when current password is wrong', async () => {
      const hash = await bcrypt.hash('correctpass', 10);
      usersService.findById.mockResolvedValue({ ...mockUser, passwordHash: hash } as any);

      await expect(service.changePassword('user-1', 'wrongpass', 'newpass')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(redis.set).not.toHaveBeenCalled();
    });

    it('does not write revocation fence when user is not found', async () => {
      usersService.findById.mockResolvedValue(null);

      await expect(service.changePassword('user-1', 'pass', 'newpass')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  // ─── Revocation fence TTL derivation (fix: literal drifted from JWT_ACCESS_EXPIRES_IN) ─
  // Invariant: the fence TTL must track whatever JWT_ACCESS_EXPIRES_IN actually is,
  // not a hardcoded 900. Before the fix, bumping the env var to e.g. "1h" left the
  // fence still expiring after 900s while tokens stayed valid for an hour.

  describe('revocation fence TTL — derived from JWT_ACCESS_EXPIRES_IN', () => {
    async function buildServiceWithExpiry(expiresIn: string) {
      const prismaMock: any = {
        refreshToken: {
          findUnique: jest.fn().mockResolvedValue({ userId: 'user-1' }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const redisMock = { set: jest.fn().mockResolvedValue('OK') };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: PrismaService, useValue: prismaMock },
          { provide: UsersService, useValue: {} },
          { provide: JwtService, useValue: { sign: jest.fn() } },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => (key === 'JWT_ACCESS_EXPIRES_IN' ? expiresIn : undefined)),
            },
          },
          { provide: EmailQueueService, useValue: {} },
          { provide: 'REDIS_CLIENT', useValue: redisMock },
        ],
      }).compile();

      return { service: module.get(AuthService), redisMock };
    }

    it('writes a 3600s fence TTL when JWT_ACCESS_EXPIRES_IN is "1h"', async () => {
      const { service: svc, redisMock } = await buildServiceWithExpiry('1h');

      await svc.logout('some-raw-token');

      expect(redisMock.set).toHaveBeenCalledWith(
        'auth:revoke-before:user-1',
        expect.any(String),
        'EX',
        3600,
      );
    });

    it('writes a 900s fence TTL when JWT_ACCESS_EXPIRES_IN is "15m"', async () => {
      const { service: svc, redisMock } = await buildServiceWithExpiry('15m');

      await svc.logout('some-raw-token');

      expect(redisMock.set).toHaveBeenCalledWith(
        'auth:revoke-before:user-1',
        expect.any(String),
        'EX',
        900,
      );
    });

    it('writes a 30s fence TTL when JWT_ACCESS_EXPIRES_IN is "30s"', async () => {
      const { service: svc, redisMock } = await buildServiceWithExpiry('30s');

      await svc.logout('some-raw-token');

      expect(redisMock.set).toHaveBeenCalledWith(
        'auth:revoke-before:user-1',
        expect.any(String),
        'EX',
        30,
      );
    });
  });

  // ─── Magic Link ───────────────────────────────────────────────────────────────

  describe('requestMagicLink', () => {
    it('returns silently when user is not found (prevents email enumeration)', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await service.requestMagicLink('nobody@example.com');

      expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
      expect(emailService.sendMagicLink).not.toHaveBeenCalled();
    });

    it('invalidates existing MAGIC_LINK tokens before issuing a new one', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as any);

      await service.requestMagicLink('test@example.com');

      expect(prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: mockUser.id,
            type: EmailTokenType.MAGIC_LINK,
            usedAt: null,
          }),
          data: { usedAt: expect.any(Date) },
        }),
      );
    });

    it('creates a MAGIC_LINK token expiring in ~15 minutes (not 24 h)', async () => {
      const before = Date.now();
      usersService.findByEmail.mockResolvedValue(mockUser as any);

      await service.requestMagicLink('test@example.com');

      const createCall = prisma.emailVerificationToken.create.mock.calls[0][0];
      expect(createCall.data.type).toBe(EmailTokenType.MAGIC_LINK);
      const expiry = createCall.data.expiresAt as Date;
      expect(expiry.getTime()).toBeGreaterThan(before + 14 * 60 * 1000);
      expect(expiry.getTime()).toBeLessThan(before + 16 * 60 * 1000);
    });

    it('sends magic link email with /auth/magic-login?token= URL', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as any);

      await service.requestMagicLink('test@example.com');

      expect(emailService.sendMagicLink).toHaveBeenCalledWith(
        expect.objectContaining({
          to: mockUser.email,
          firstName: mockUser.firstName,
          magicUrl: expect.stringContaining('/auth/magic-login?token='),
        }),
      );
    });

    it('does not invalidate EMAIL_VERIFICATION tokens (type isolation)', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as any);

      await service.requestMagicLink('test@example.com');

      for (const [args] of prisma.emailVerificationToken.updateMany.mock.calls) {
        if (args.where?.userId === mockUser.id) {
          expect(args.where.type).toBe(EmailTokenType.MAGIC_LINK);
          expect(args.where.type).not.toBe(EmailTokenType.EMAIL_VERIFICATION);
        }
      }
    });

    it('uses the firstName fallback when user has no firstName', async () => {
      usersService.findByEmail.mockResolvedValue({ ...mockUser, firstName: null } as any);

      await service.requestMagicLink('test@example.com');

      expect(emailService.sendMagicLink).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'Kliencie' }),
      );
    });

    it('returns silently without sending magic link when per-email dedupe key exists in Redis', async () => {
      redis.exists.mockResolvedValue(1); // cooldown active

      await service.requestMagicLink('test@example.com');

      expect(usersService.findByEmail).not.toHaveBeenCalled();
      expect(emailService.sendMagicLink).not.toHaveBeenCalled();
      expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
    });

    it('sets per-email dedupe key with 300s TTL after sending the magic link', async () => {
      redis.exists.mockResolvedValue(0);
      usersService.findByEmail.mockResolvedValue(mockUser as any);

      await service.requestMagicLink('test@example.com');

      expect(redis.set).toHaveBeenCalledWith(
        'magic-link-sent:test@example.com',
        '1',
        'EX',
        300,
      );
    });

    it('normalises email to lowercase before checking the dedupe key', async () => {
      redis.exists.mockResolvedValue(0);
      usersService.findByEmail.mockResolvedValue(mockUser as any);

      await service.requestMagicLink('Test@Example.COM');

      expect(redis.exists).toHaveBeenCalledWith('magic-link-sent:test@example.com');
    });
  });

  describe('consumeMagicLink', () => {
    const validStoredToken = {
      id: 'vt-magic-1',
      userId: 'user-1',
      usedAt: null,
      type: EmailTokenType.MAGIC_LINK,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      user: { ...mockUser, isEmailVerified: false },
    };

    it('throws BadRequestException when token does not exist', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(null);

      await expect(service.consumeMagicLink('nonexistent-token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when token type is EMAIL_VERIFICATION (wrong endpoint)', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        ...validStoredToken,
        type: EmailTokenType.EMAIL_VERIFICATION,
      });

      await expect(service.consumeMagicLink('email-verify-token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when token has already been used', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        ...validStoredToken,
        usedAt: new Date(),
      });

      await expect(service.consumeMagicLink('used-token')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when token is expired', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        ...validStoredToken,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.consumeMagicLink('expired-token')).rejects.toThrow(BadRequestException);
    });

    it('executes a transaction to mark the token as used on success', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(validStoredToken);
      prisma.$transaction.mockImplementation((cb: (tx: any) => Promise<any>) =>
        cb({
          emailVerificationToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          user: { update: jest.fn().mockResolvedValue({}) },
        }),
      );

      await service.consumeMagicLink('valid-token');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('returns an accessToken + refreshToken pair on successful consumption', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(validStoredToken);
      prisma.$transaction.mockImplementation((cb: (tx: any) => Promise<any>) =>
        cb({
          emailVerificationToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          user: { update: jest.fn().mockResolvedValue({}) },
        }),
      );

      const result = await service.consumeMagicLink('valid-token');

      expect(result).toHaveProperty('accessToken', 'mock-access-token');
      expect(result).toHaveProperty('refreshToken');
      expect(typeof result.refreshToken).toBe('string');
    });

    it('marks an unverified user as email-verified inside the transaction', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        ...validStoredToken,
        user: { ...mockUser, isEmailVerified: false },
      });
      const txUserUpdate = jest.fn().mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: (tx: any) => Promise<any>) =>
        cb({
          emailVerificationToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          user: { update: txUserUpdate },
        }),
      );

      await service.consumeMagicLink('valid-token');

      expect(txUserUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isEmailVerified: true } }),
      );
    });

    it('skips the email verification update when user is already verified', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        ...validStoredToken,
        user: { ...mockUser, isEmailVerified: true },
      });
      const txUserUpdate = jest.fn().mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb: (tx: any) => Promise<any>) =>
        cb({
          emailVerificationToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          user: { update: txUserUpdate },
        }),
      );

      await service.consumeMagicLink('valid-token');

      expect(txUserUpdate).not.toHaveBeenCalled();
    });

    it('stores a new refresh token in DB as part of session creation', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(validStoredToken);
      prisma.$transaction.mockImplementation((cb: (tx: any) => Promise<any>) =>
        cb({
          emailVerificationToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          user: { update: jest.fn().mockResolvedValue({}) },
        }),
      );

      await service.consumeMagicLink('valid-token');

      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException when concurrent request already consumed the token (count=0)', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(validStoredToken);
      prisma.$transaction.mockImplementation((cb: (tx: any) => Promise<any>) =>
        cb({
          emailVerificationToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
          user: { update: jest.fn().mockResolvedValue({}) },
        }),
      );

      await expect(service.consumeMagicLink('raced-token')).rejects.toThrow(BadRequestException);

      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('passes usedAt: null in the updateMany WHERE clause to prevent double-consumption', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue(validStoredToken);
      const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.$transaction.mockImplementation((cb: (tx: any) => Promise<any>) =>
        cb({
          emailVerificationToken: { updateMany: txUpdateMany },
          user: { update: jest.fn().mockResolvedValue({}) },
        }),
      );

      await service.consumeMagicLink('valid-token');

      expect(txUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: validStoredToken.id, usedAt: null }),
          data: { usedAt: expect.any(Date) },
        }),
      );
    });
  });

  // ─── purgeExpiredTokens ───────────────────────────────────────────────────────

  describe('purgeExpiredTokens', () => {
    it('calls deleteMany on all three token tables in parallel', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 5 });
      prisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 2 });
      prisma.emailVerificationToken.deleteMany.mockResolvedValue({ count: 8 });

      await service.purgeExpiredTokens();

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledTimes(1);
    });

    it('passes expiresAt: { lt: <current date> } as the where clause to each table', async () => {
      const before = Date.now();

      await service.purgeExpiredTokens();

      const after = Date.now();

      for (const mock of [
        prisma.refreshToken.deleteMany,
        prisma.passwordResetToken.deleteMany,
        prisma.emailVerificationToken.deleteMany,
      ]) {
        const where = (mock as jest.Mock).mock.calls[0][0].where;
        expect(where).toHaveProperty('expiresAt');
        const cutoff: Date = where.expiresAt.lt;
        expect(cutoff).toBeInstanceOf(Date);
        expect(cutoff.getTime()).toBeGreaterThanOrEqual(before);
        expect(cutoff.getTime()).toBeLessThanOrEqual(after);
      }
    });

    it('resolves without throwing when all tables return count 0 (nothing to purge)', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.emailVerificationToken.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.purgeExpiredTokens()).resolves.toBeUndefined();
    });

    it('propagates a Prisma rejection so the scheduler surfaces the failure', async () => {
      prisma.refreshToken.deleteMany.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.purgeExpiredTokens()).rejects.toThrow('DB connection lost');
    });
  });

  // ─── @Cron timezone configuration ────────────────────────────────────────────

  describe('@Cron timezone configuration', () => {
    it('purgeExpiredTokens is configured to fire in Europe/Warsaw timezone', () => {
      const meta = Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        AuthService.prototype['purgeExpiredTokens'],
      );
      expect(meta?.timeZone).toBe('Europe/Warsaw');
    });
  });

  // ─── Distributed lock guard ───────────────────────────────────────────────────

  describe('distributed lock guard', () => {
    describe('purgeExpiredTokens', () => {
      it('skips token deletion when another replica already holds the lock', async () => {
        redis.set.mockResolvedValue(null);

        await service.purgeExpiredTokens();

        expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
        expect(prisma.passwordResetToken.deleteMany).not.toHaveBeenCalled();
        expect(prisma.emailVerificationToken.deleteMany).not.toHaveBeenCalled();
      });

      it('runs the token purge when the lock is acquired', async () => {
        redis.set.mockResolvedValue('OK');

        await service.purgeExpiredTokens();

        expect(prisma.refreshToken.deleteMany).toHaveBeenCalledTimes(1);
      });

      it('acquires the lock with NX and an 82800-second TTL', async () => {
        redis.set.mockResolvedValue('OK');

        await service.purgeExpiredTokens();

        expect(redis.set).toHaveBeenCalledWith(
          'cron:purge-tokens:lock',
          '1',
          'EX',
          82800,
          'NX',
        );
      });
    });
  });
});
