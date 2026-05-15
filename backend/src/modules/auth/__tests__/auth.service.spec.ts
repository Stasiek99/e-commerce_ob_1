import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { EmailTokenType, Role } from '@prisma/client';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../../users/users.service';
import { EmailQueueService } from '../../email/email-queue.service';

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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            refreshToken: {
              create: jest.fn().mockResolvedValue({}),
              findUnique: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
            },
            emailVerificationToken: {
              updateMany: jest.fn().mockResolvedValue({}),
              create: jest.fn().mockResolvedValue({}),
              findUnique: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
            },
            passwordResetToken: {
              updateMany: jest.fn().mockResolvedValue({}),
              create: jest.fn().mockResolvedValue({}),
              findUnique: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
            },
            user: {
              update: jest.fn().mockResolvedValue({}),
            },
            $transaction: jest.fn().mockResolvedValue([{}, {}]),
          },
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
            get: jest.fn().mockReturnValue('7d'),
          },
        },
        {
          provide: EmailQueueService,
          useValue: {
            sendEmailVerification: jest.fn().mockResolvedValue(undefined),
            sendPasswordReset: jest.fn().mockResolvedValue(undefined),
            sendMagicLink: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
    prisma = module.get(PrismaService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
    emailService = module.get(EmailQueueService);
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
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60),
        user: mockUser,
      });
      prisma.refreshToken.update.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.refresh('user-1', 'valid-raw-token');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rt-1' }, data: { revokedAt: expect.any(Date) } }),
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
  });

  describe('logout', () => {
    it('revokes the refresh token by hash', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.logout('some-raw-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { revokedAt: expect.any(Date) } }),
      );
    });
  });

  describe('refresh (additional branch coverage)', () => {
    it('throws UnauthorizedException when token is revoked', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
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
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        user: mockUser,
      });

      await expect(service.refresh('user-1', 'expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
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
        user: { ...mockUser, isEmailVerified: true },
      });

      await service.verifyEmail('already-verified-token');

      expect(prisma.$transaction).not.toHaveBeenCalled();
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
          emailVerificationToken: { update: jest.fn().mockResolvedValue({}) },
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
          emailVerificationToken: { update: jest.fn().mockResolvedValue({}) },
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
          emailVerificationToken: { update: jest.fn().mockResolvedValue({}) },
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
          emailVerificationToken: { update: jest.fn().mockResolvedValue({}) },
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
          emailVerificationToken: { update: jest.fn().mockResolvedValue({}) },
          user: { update: jest.fn().mockResolvedValue({}) },
        }),
      );

      await service.consumeMagicLink('valid-token');

      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });
  });
});
