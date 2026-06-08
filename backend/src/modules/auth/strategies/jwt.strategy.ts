import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type IORedis from 'ioredis';
import * as Sentry from '@sentry/nestjs';
import { UsersService } from '../../users/users.service';

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  iat: number;
  jti?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    configService: ConfigService,
    jwtService: JwtService,
    private readonly usersService: UsersService,
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Dual-key provider: validates against JWT_ACCESS_SECRET, then falls back to
      // JWT_ACCESS_SECRET_PREV during a rotation window so active sessions survive
      // a secret rotation without force-logging out every user.
      secretOrKeyProvider: (
        _req: unknown,
        rawToken: string,
        done: (err: Error | null, secret: string) => void,
      ) => {
        const current = configService.getOrThrow<string>('JWT_ACCESS_SECRET');
        const prev = configService.get<string>('JWT_ACCESS_SECRET_PREV');
        try {
          jwtService.verify(rawToken, { secret: current });
          return done(null, current);
        } catch {
          // current key failed — check previous key during rotation window
        }
        if (prev) {
          try {
            jwtService.verify(rawToken, { secret: prev });
            return done(null, prev);
          } catch {
            // prev key also failed — let passport-jwt reject with the current key
          }
        }
        done(null, current);
      },
    });
  }

  async validate(payload: JwtPayload) {
    try {
      const redisChecks: Promise<string | null>[] = [
        this.redis.get(`auth:revoke-before:${payload.sub}`),
      ];
      if (payload.jti) {
        redisChecks.push(this.redis.get(`auth:revoked-jti:${payload.jti}`));
      }

      const [revokeBeforeRaw, revokedJti] = await Promise.all(redisChecks);

      if (revokeBeforeRaw) {
        const revokeBeforeMs = parseInt(revokeBeforeRaw, 10);
        if (payload.iat * 1000 < revokeBeforeMs) {
          throw new UnauthorizedException('Token has been revoked');
        }
      }

      if (revokedJti) {
        throw new UnauthorizedException('Token has been revoked');
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      // Redis unavailable — allow through to avoid locking out all users during an outage.
      // Security trade-off (accepted): revocation fences (revoke-before + per-jti blocklist)
      // won't hold for up to JWT_ACCESS_EXPIRES_IN (default 15 min) while Redis is down.
      // For JWT_SECRET rotation, use JWT_ACCESS_SECRET_PREV (above) — tokens signed with
      // the old key remain valid through the dual-key window, so no forced re-login occurs.
      this.logger.error(`Redis unavailable during JWT validation: ${(err as Error).message}`);
      Sentry.captureException(err, { tags: { 'auth.redis': 'unavailable' } });
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
