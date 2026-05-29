import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type IORedis from 'ioredis';
import { UsersService } from '../../users/users.service';

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  iat: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
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
    const revokeBeforeRaw = await this.redis.get(`auth:revoke-before:${payload.sub}`);
    if (revokeBeforeRaw) {
      const revokeBeforeMs = parseInt(revokeBeforeRaw, 10);
      if (payload.iat * 1000 < revokeBeforeMs) {
        throw new UnauthorizedException('Token has been revoked');
      }
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
