import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtRefreshGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const rawToken = req.cookies?.['refresh_token'];

    if (!rawToken) throw new UnauthorizedException();

    const user = await this.authService.validateRefreshTokenByRaw(rawToken);
    if (!user) throw new UnauthorizedException();

    (req as Request & { user: unknown }).user = user;
    return true;
  }
}
