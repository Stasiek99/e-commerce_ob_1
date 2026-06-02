import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';

// Global burst/sustained throttlers apply site-wide; the validate endpoint
// uses its own named throttlers (coupon-anon / coupon-auth) instead.
const GLOBAL_THROTTLERS = new Set(['burst', 'sustained']);

@Injectable()
export class CouponValidateThrottlerGuard extends ThrottlerGuard {
  protected async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const name = requestProps.throttler.name ?? '';

    if (GLOBAL_THROTTLERS.has(name)) {
      // Global throttlers are skipped via @SkipThrottle on the route; returning
      // true here keeps canActivate looping without blocking.
      return true;
    }

    const req = requestProps.context.switchToHttp().getRequest<Record<string, unknown>>();
    const hasBearer = typeof req['headers'] === 'object' &&
      String((req['headers'] as Record<string, unknown>)['authorization'] ?? '').startsWith('Bearer ');

    const targetThrottler = hasBearer ? 'coupon-auth' : 'coupon-anon';
    if (name !== targetThrottler) {
      return true;
    }

    return super.handleRequest(requestProps);
  }

  // Skips the shouldSkip() check that honours @SkipThrottle on this guard's
  // own execution so the per-throttler filtering above always runs.
  async canActivate(context: ExecutionContext): Promise<boolean> {
    return super.canActivate(context);
  }
}
