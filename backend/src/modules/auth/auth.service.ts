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
import { EmailTokenType, RefreshToken, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { EmailQueueService } from '../email/email-queue.service';
import { RegisterDto } from './dto/register.dto';

const BCRYPT_ROUNDS = 12;

// A rotated token re-presented within this window is treated as a network drop
// rather than theft: the new cookie never reached the browser before the drop.
const REFRESH_GRACE_MS = 30_000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailQueueService,
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

    // Fire-and-forget — don't block registration if email fails
    this.issueAndSendVerification(user).catch(() => {});

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

    if (!stored || stored.expiresAt < new Date()) return null;

    if (stored.revokedAt) {
      // Allow recently-rotated tokens through so refresh() can do network-drop recovery.
      // Tokens revoked by logout/security events have replacedBy=null and are blocked here.
      const inGrace = Date.now() - stored.revokedAt.getTime() < REFRESH_GRACE_MS;
      if (!inGrace || !stored.replacedBy) return null;
    }

    return stored.user;
  }

  async refresh(userId: string, rawRefreshToken: string) {
    const tokenHash = createHash('sha256').update(rawRefreshToken).digest('hex');
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored || stored.userId !== userId || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      const inGrace = Date.now() - stored.revokedAt.getTime() < REFRESH_GRACE_MS;

      if (inGrace && stored.replacedBy) {
        // Likely network drop: the rotation succeeded server-side but the new
        // cookie never reached the browser. Try to rotate the replacement token.
        const replacement = await this.prisma.refreshToken.findUnique({
          where: { tokenHash: stored.replacedBy },
        });

        if (replacement && !replacement.revokedAt && replacement.expiresAt > new Date()) {
          return this.rotateToken(replacement, stored.family, stored.user);
        }
      }

      if (stored.replacedBy) {
        // Token was already rotated and is being reused outside the grace window
        // (or its replacement is also gone). This is a theft signal — invalidate
        // the entire session family to protect the legitimate user.
        await this.prisma.refreshToken.updateMany({
          where: { family: stored.family, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.rotateToken(stored, stored.family, stored.user);
  }

  async logout(rawRefreshToken: string) {
    const tokenHash = createHash('sha256').update(rawRefreshToken).digest('hex');
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
  }

  private async rotateToken(
    token: RefreshToken,
    family: string,
    user: User,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const rawNew = uuidv4();
    const newHash = createHash('sha256').update(rawNew).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: token.id },
        data: { revokedAt: new Date(), replacedBy: newHash },
      }),
      this.prisma.refreshToken.create({
        data: { tokenHash: newHash, userId: user.id, family, expiresAt },
      }),
    ]);

    const accessToken = this.signAccessToken(user);
    return { accessToken, refreshToken: rawNew };
  }

  private issueAndSendVerification = async (user: User): Promise<void> => {
    await this.prisma.emailVerificationToken.updateMany({
      where: { userId: user.id, type: EmailTokenType.EMAIL_VERIFICATION, usedAt: null },
      data: { usedAt: new Date() },
    });

    const rawToken = uuidv4();
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await this.prisma.emailVerificationToken.create({
      data: { tokenHash, userId: user.id, expiresAt },
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:4200');
    const verifyUrl = `${frontendUrl}/auth/verify-email?token=${rawToken}`;

    await this.emailService.sendEmailVerification({
      to: user.email,
      firstName: user.firstName ?? 'Kliencie',
      verifyUrl,
    });
  };

  async resendVerificationEmail(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user || user.isEmailVerified) return;
    await this.issueAndSendVerification(user);
  }

  async requestEmailChange(userId: string, newEmail: string): Promise<void> {
    const existing = await this.usersService.findByEmail(newEmail);
    if (existing && existing.id !== userId) {
      throw new ConflictException('Email already in use');
    }

    const user = await this.usersService.findById(userId);
    if (!user) throw new BadRequestException('User not found');

    await this.prisma.emailVerificationToken.updateMany({
      where: { userId, type: EmailTokenType.EMAIL_VERIFICATION, usedAt: null },
      data: { usedAt: new Date() },
    });

    await this.usersService.update(userId, { pendingEmail: newEmail });

    const rawToken = uuidv4();
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.prisma.emailVerificationToken.create({
      data: { tokenHash, userId, expiresAt },
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:4200');
    const verifyUrl = `${frontendUrl}/auth/verify-email?token=${rawToken}`;

    await this.emailService.sendEmailChangeVerification({
      to: newEmail,
      firstName: user.firstName ?? 'Kliencie',
      newEmail,
      verifyUrl,
    });
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const stored = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    // Reject magic link tokens used on the wrong endpoint
    if (stored?.type === EmailTokenType.MAGIC_LINK) {
      throw new BadRequestException('Invalid or expired verification link');
    }

    // Idempotent double-click for normal registration verification
    if (stored?.user?.isEmailVerified && !stored?.user?.pendingEmail) return;

    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired verification link');
    }

    if (stored.user.pendingEmail) {
      // Email-change flow: promote pendingEmail → email, revoke all sessions
      const newEmail = stored.user.pendingEmail;

      // Guard against race: another user may have claimed this email after the
      // request was issued.
      const taken = await this.prisma.user.findUnique({ where: { email: newEmail } });
      if (taken && taken.id !== stored.userId) {
        throw new ConflictException('The requested email address is no longer available');
      }

      await this.prisma.$transaction([
        this.prisma.emailVerificationToken.update({
          where: { id: stored.id },
          data: { usedAt: new Date() },
        }),
        this.prisma.user.update({
          where: { id: stored.userId },
          data: { email: newEmail, pendingEmail: null, isEmailVerified: true },
        }),
        // JWT encodes email — all devices must re-login after an email change
        this.prisma.refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);
    } else {
      await this.prisma.$transaction([
        this.prisma.emailVerificationToken.update({
          where: { id: stored.id },
          data: { usedAt: new Date() },
        }),
        this.prisma.user.update({
          where: { id: stored.userId },
          data: { isEmailVerified: true },
        }),
      ]);
    }
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    // Always resolve silently — never reveal whether an email is registered
    if (!user || !user.passwordHash) return;

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
      this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async requestMagicLink(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    // Always silent — prevents email enumeration
    if (!user) return;

    await this.prisma.emailVerificationToken.updateMany({
      where: { userId: user.id, type: EmailTokenType.MAGIC_LINK, usedAt: null },
      data: { usedAt: new Date() },
    });

    const rawToken = uuidv4();
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.prisma.emailVerificationToken.create({
      data: { tokenHash, userId: user.id, expiresAt, type: EmailTokenType.MAGIC_LINK },
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:4200');
    const magicUrl = `${frontendUrl}/auth/magic-login?token=${rawToken}`;

    await this.emailService.sendMagicLink({
      to: user.email,
      firstName: user.firstName ?? 'Kliencie',
      magicUrl,
    });
  }

  async consumeMagicLink(rawToken: string) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const stored = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !stored ||
      stored.type !== EmailTokenType.MAGIC_LINK ||
      stored.usedAt ||
      stored.expiresAt < new Date()
    ) {
      throw new BadRequestException('Invalid or expired magic link');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      });
      // Magic link click implicitly proves email ownership
      if (!stored.user.isEmailVerified) {
        await tx.user.update({
          where: { id: stored.userId },
          data: { isEmailVerified: true },
        });
      }
    });

    return this.generateTokenPair(stored.user);
  }

  async generateTokenPair(user: User) {
    const accessToken = this.signAccessToken(user);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const rawRefreshToken = uuidv4();
    const tokenHash = createHash('sha256').update(rawRefreshToken).digest('hex');
    const family = uuidv4(); // Each new login creates an isolated token family

    await this.prisma.refreshToken.create({
      data: { tokenHash, userId: user.id, expiresAt, family },
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  private signAccessToken(user: User): string {
    return this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });
  }
}
