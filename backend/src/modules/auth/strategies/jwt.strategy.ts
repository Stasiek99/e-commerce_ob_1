import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      ignoreExpiration: false,
    });
  }

  async validate(payload: JwtPayload) {
    try {
      const revokeBeforeRaw = await this.redis.get(`auth:revoke-before:${payload.sub}`);
      if (revokeBeforeRaw) {
        const revokeBeforeMs = parseInt(revokeBeforeRaw, 10);
        if (payload.iat * 1000 < revokeBeforeMs) {
          throw new UnauthorizedException('Token has been revoked');
        }
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      // Redis unavailable — allow through rather than locking out all users.
      // Revocation window of max 15 min is accepted as the trade-off.
      this.logger.error(`Redis unavailable during JWT validation: ${(err as Error).message}`);
      Sentry.captureException(err, { tags: { 'auth.redis': 'unavailable' } });
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
