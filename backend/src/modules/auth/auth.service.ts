import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { RegisterDto } from './dto/register.dto';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.usersService.create({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });

    return this.generateTokenPair(user);
  }

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.generateTokenPair(user);
  }

  async findOrCreateGoogleUser(profile: {
    googleId: string;
    email: string;
    firstName?: string;
    lastName?: string;
  }): Promise<User> {
    let user = await this.usersService.findByGoogleId(profile.googleId);
    if (user) return user;

    user = await this.usersService.findByEmail(profile.email);
    if (user) {
      return this.usersService.update(user.id, {
        googleId: profile.googleId,
        isEmailVerified: true,
      });
    }

    return this.usersService.create({
      email: profile.email,
      googleId: profile.googleId,
      firstName: profile.firstName,
      lastName: profile.lastName,
      isEmailVerified: true,
    });
  }

  async validateRefreshTokenByRaw(rawToken: string): Promise<User | null> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      return null;
    }

    return stored.user;
  }

  async refresh(userId: string, rawRefreshToken: string) {
    const tokenHash = createHash('sha256').update(rawRefreshToken).digest('hex');
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored || stored.userId !== userId || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Rotate — revoke old token
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.generateTokenPair(stored.user);
  }

  async logout(rawRefreshToken: string) {
    const tokenHash = createHash('sha256').update(rawRefreshToken).digest('hex');
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    // Always resolve silently — never reveal whether an email is registered
    if (!user || !user.passwordHash) return;

    // Invalidate any existing unused tokens for this user
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const rawToken = uuidv4();
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.passwordResetToken.create({
      data: { tokenHash, userId: user.id, expiresAt },
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:4200');
    const resetUrl = `${frontendUrl}/auth/reset-password?token=${rawToken}`;

    await this.emailService.sendPasswordReset({
      to: user.email,
      firstName: user.firstName ?? 'Kliencie',
      resetUrl,
    });
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: stored.userId },
        data: { passwordHash },
      }),
      // Revoke all active refresh tokens — forces re-login on all devices
      this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async generateTokenPair(user: User) {
    const jti = uuidv4();
    const payload = { sub: user.id, email: user.email, role: user.role };

    const accessToken = this.jwtService.sign(payload);

    const refreshExpiresIn = this.configService.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
      '7d',
    );
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const rawRefreshToken = uuidv4();
    const tokenHash = createHash('sha256').update(rawRefreshToken).digest('hex');

    await this.prisma.refreshToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt,
      },
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }
}
