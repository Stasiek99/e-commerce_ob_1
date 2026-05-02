import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../../users/users.service';
import { EmailService } from '../../email/email.service';

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
          },
        },
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            findByGoogleId: jest.fn(),
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
          provide: EmailService,
          useValue: {
            sendEmailVerification: jest.fn().mockResolvedValue(undefined),
            sendPasswordReset: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
    prisma = module.get(PrismaService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
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

      const result = await service.findOrCreateGoogleUser({
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
});
