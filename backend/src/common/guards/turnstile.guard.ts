import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class TurnstileGuard implements CanActivate {
  private readonly secretKey = process.env['CLOUDFLARE_TURNSTILE_SECRET_KEY'];

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.secretKey) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = req.headers['cf-turnstile-response'] as string | undefined;
    if (!token) throw new ForbiddenException('Bot protection challenge required');

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: this.secretKey, response: token }).toString(),
    });
    const data = (await res.json()) as { success: boolean };
    if (!data.success) throw new ForbiddenException('Bot protection check failed');
    return true;
  }
}
