import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { EmailTokenType, Prisma, RefreshToken, User } from '@prisma/client';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { EmailQueueService } from '../email/email-queue.service';
import { RegisterDto } from './dto/register.dto';
import { parseDurationToSeconds } from '../../common/utils/duration.util';

const BCRYPT_ROUNDS = 12;

// A rotated token re-presented within this window is treated as a network drop
// rather than theft: the new cookie never reached the browser before the drop.
const REFRESH_GRACE_MS = 30_000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // TTL matches the access token lifetime so the entry self-expires when no old
  // tokens remain valid. Derived from JWT_ACCESS_EXPIRES_IN (rather than a literal)
  // so an operator bumping that env var can't silently shrink the revocation window
  // below the actual token lifetime.
  private readonly revokeBeforeTtlSecs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailQueueService,
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
  ) {
    this.revokeBeforeTtlSecs = parseDurationToSeconds(
      this.configService.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
    );
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM, { timeZone: 'Europe/Warsaw' })
  async purgeExpiredTokens(): Promise<void> {
    const acquired = await this.redis.set('cron:purge-tokens:lock', '1', 'EX', 82800, 'NX');
    if (!acquired) return;

    const now = new Date();
    const [refreshResult, resetResult, verificationResult] = await Promise.all([
      this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.emailVerificationToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    ]);
    this.logger.log(
      `Token purge complete — refresh: ${refreshResult.count}, passwordReset: ${resetResult.count}, emailVerification: ${verificationResult.count}`,
    );
  }

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    let user: User;
    try {
      user = await this.usersService.create({
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
      });
    } catch (err) {
      // Two requests can both pass the findByEmail check above before either
      // create() commits (double-submit, retried request). The DB-level
      // @unique on User.email is the real guard — map its violation to the
      // same 409 the pre-check above throws, instead of an unhandled 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Email already in use');
      }
      throw err;
    }

    // Fire-and-forget — don't block registration if email fails
    this.issueAndSendVerification(user).catch(() => {});

    return this.generateTokenPair(user);
  }

  async login(email: string, password: string) {
    const normalizedEmail = email.toLowerCase();
    const failKey = `auth:login-failures:${normalizedEmail}`;
    const lockKey = `auth:login-locked:${normalizedEmail}`;

    // IORedis queues calls indefinitely when maxRetriesPerRequest is null.
    // Any Redis outage would hang every login until the TimeoutInterceptor fires.
    // Wrap all Redis calls so the rate-limit is advisory: skip it on outage,
    // log to Sentry, and allow login to proceed — same pattern as JwtStrategy.
    try {
      if (await this.redis.exists(lockKey)) {
        throw new UnauthorizedException('Account temporarily locked — too many failed attempts');
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error('Redis unavailable in login() — skipping lockout check', (err as Error).message);
    }

    const user = await this.usersService.findByEmail(email);
    if (!user || !user.passwordHash) {
      try {
        const failures = await this.redis.incr(failKey);
        if (failures === 1) await this.redis.expire(failKey, 900);
        if (failures >= 10) await this.redis.setex(lockKey, 900, '1');
      } catch (err) {
        this.logger.error('Redis unavailable in login() — skipping failure tracking', (err as Error).message);
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      try {
        const failures = await this.redis.incr(failKey);
        if (failures === 1) await this.redis.expire(failKey, 900);
        if (failures >= 10) await this.redis.setex(lockKey, 900, '1');
      } catch (err) {
        this.logger.error('Redis unavailable in login() — skipping failure tracking', (err as Error).message);
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    try {
      await this.redis.del(failKey);
    } catch (err) {
      this.logger.error('Redis unavailable in login() — skipping failure counter reset', (err as Error).message);
    }
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
      // Block silent hijack: if the account was created with a password, require
      // the user to explicitly link Google from their account settings instead of
      // allowing any Google identity with the same email to take over the account.
      if (user.passwordHash && !user.googleId) {
        throw new ConflictException(
          'An account with this email already exists. Please log in with your password.',
        );
      }
      return this.usersService.update(user.id, {
        googleId: profile.googleId,
        isEmailVerified: true,
      });
    }

    try {
      return await this.usersService.create({
        email: profile.email,
        googleId: profile.googleId,
        firstName: profile.firstName,
        lastName: profile.lastName,
        isEmailVerified: true,
      });
    } catch (err) {
      // Two concurrent first-time Google callbacks for the same never-seen
      // email can both pass the findByGoogleId/findByEmail checks above
      // before either create() commits. The DB-level @unique on User.email/
      // User.googleId is the real guard — map its violation to a 409 instead
      // of an unhandled 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Email already in use');
      }
      throw err;
    }
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
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
    if (token) {
      await this.revokeAccessTokensForUser(token.userId);
    }
  }

  private async rotateToken(
    token: RefreshToken,
    family: string,
    user: User,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const rawNew = uuidv4();
    const newHash = createHash('sha256').update(rawNew).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      // Atomic guard: revokedAt: null in the WHERE clause ensures only the
      // first concurrent caller can rotate this exact token. Without it, two
      // requests racing on the same stale token (e.g. two browser tabs both
      // retrying after a dropped refresh within the grace window) could each
      // successfully rotate it, splitting the family into two divergent
      // child chains and silently defeating reuse detection.
      const result = await tx.refreshToken.updateMany({
        where: { id: token.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedBy: newHash },
      });
      if (result.count === 0) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      await tx.refreshToken.create({
        data: { tokenHash: newHash, userId: user.id, family, expiresAt },
      });
    });

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

  async requestEmailChange(userId: string, newEmail: string, currentPassword: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new BadRequestException('User not found');

    if (!user.passwordHash) throw new UnauthorizedException('Invalid credentials');
    const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!validPassword) throw new UnauthorizedException('Invalid credentials');

    const existing = await this.usersService.findByEmail(newEmail);
    if (existing && existing.id !== userId) {
      throw new ConflictException('Email already in use');
    }

    await this.prisma.emailVerificationToken.updateMany({
      where: { userId, usedAt: null },
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

    // Access tokens already in flight still carry the old email claim. Fence
    // them off now rather than waiting for verifyEmail() to confirm the
    // change, so stale-email artifacts (logging, Stripe, audit trail) stop
    // the moment a change is requested, not when it's confirmed.
    await this.revokeAccessTokensForUser(userId);
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

    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired verification link');
    }

    // Idempotent double-click: only for EMAIL_VERIFICATION tokens on an
    // already-verified account with no pending change. Must run AFTER the
    // usedAt/expiresAt guards so expired or stolen tokens cannot silently
    // bypass validation by exploiting this shortcut.
    if (
      stored.type === EmailTokenType.EMAIL_VERIFICATION &&
      stored.user.isEmailVerified &&
      !stored.user.pendingEmail
    ) {
      return;
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

      await this.prisma.$transaction(async (tx) => {
        // Atomic guard mirrors consumeMagicLink/rotateToken: usedAt: null in the
        // WHERE clause ensures a token already invalidated by a newer
        // requestEmailChange() call (e.g. the user requested a second email
        // change before clicking this link) cannot still promote its stale
        // pendingEmail captured above.
        const result = await tx.emailVerificationToken.updateMany({
          where: { id: stored.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (result.count === 0) {
          throw new BadRequestException('Invalid or expired verification link');
        }
        await tx.user.update({
          where: { id: stored.userId },
          data: { email: newEmail, pendingEmail: null, isEmailVerified: true },
        });
        // JWT encodes email — all devices must re-login after an email change
        await tx.refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      });
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
    const dedupeKey = `pwd-reset-sent:${email.toLowerCase()}`;
    if (await this.redis.exists(dedupeKey)) return;

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

    await this.redis.set(dedupeKey, '1', 'EX', 300);
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

    await this.revokeAccessTokensForUser(stored.userId);
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

    await this.revokeAccessTokensForUser(userId);
  }

  async requestMagicLink(email: string): Promise<void> {
    const dedupeKey = `magic-link-sent:${email.toLowerCase()}`;
    if (await this.redis.exists(dedupeKey)) return;

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

    await this.redis.set(dedupeKey, '1', 'EX', 300);
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
      // Atomic guard: only the first concurrent request wins; usedAt: null in
      // WHERE ensures a second request with the same token sees count=0 even if
      // both passed the outer check above before either transaction committed.
      const result = await tx.emailVerificationToken.updateMany({
        where: { id: stored.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (result.count === 0) {
        throw new BadRequestException('Invalid or expired magic link');
      }
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
    return this.jwtService.sign({ sub: user.id, email: user.email, role: user.role, jti: uuidv4() });
  }

  /**
   * Records a revocation fence for a user. Any access token with iat before
   * this fence is rejected by JwtStrategy. The key expires after one access
   * token lifetime so Redis doesn't accumulate stale entries.
   */
  async revokeAccessTokensForUser(userId: string): Promise<void> {
    await this.redis.set(
      `auth:revoke-before:${userId}`,
      Date.now().toString(),
      'EX',
      this.revokeBeforeTtlSecs,
    );
  }

  /**
   * Revokes a single access token by its jti. Use this for targeted device
   * logout (e.g., "log out this session only") without invalidating other
   * active sessions. ttlSecs should be set to the token's remaining validity
   * so the Redis key self-expires when the token would have expired anyway.
   */
  async revokeAccessTokenJti(jti: string, ttlSecs: number): Promise<void> {
    await this.redis.set(`auth:revoked-jti:${jti}`, '1', 'EX', ttlSecs);
  }
}
