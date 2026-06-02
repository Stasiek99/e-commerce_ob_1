import { ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';
import { CouponValidateThrottlerGuard } from '../coupon-validate-throttler.guard';

function makeContext(authHeader?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authHeader ? { authorization: authHeader } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

function makeRequestProps(
  throttlerName: string,
  context: ExecutionContext,
): ThrottlerRequest {
  return {
    context,
    limit: 10,
    ttl: 60_000,
    throttler: { name: throttlerName, limit: 10, ttl: 60_000 },
    blockDuration: 0,
    getTracker: jest.fn(),
    generateKey: jest.fn(),
  } as unknown as ThrottlerRequest;
}

describe('CouponValidateThrottlerGuard', () => {
  let guard: CouponValidateThrottlerGuard;
  let superHandleSpy: jest.SpyInstance;

  beforeEach(() => {
    guard = new CouponValidateThrottlerGuard(
      { throttlers: [] } as any,
      {} as any,
      {} as any,
    );

    superHandleSpy = jest
      .spyOn(ThrottlerGuard.prototype as any, 'handleRequest')
      .mockResolvedValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── global throttlers are always skipped ────────────────────────────────────

  describe('global throttler bypass', () => {
    it('skips the burst throttler without calling super.handleRequest', async () => {
      const props = makeRequestProps('burst', makeContext());

      const result = await guard['handleRequest'](props);

      expect(result).toBe(true);
      expect(superHandleSpy).not.toHaveBeenCalled();
    });

    it('skips the sustained throttler without calling super.handleRequest', async () => {
      const props = makeRequestProps('sustained', makeContext());

      const result = await guard['handleRequest'](props);

      expect(result).toBe(true);
      expect(superHandleSpy).not.toHaveBeenCalled();
    });
  });

  // ─── unauthenticated requests use coupon-anon throttler ──────────────────────

  describe('anonymous request (no Bearer token)', () => {
    it('delegates coupon-anon to super.handleRequest for requests without Authorization header', async () => {
      const props = makeRequestProps('coupon-anon', makeContext());

      const result = await guard['handleRequest'](props);

      expect(superHandleSpy).toHaveBeenCalledWith(props);
      expect(result).toBe(true);
    });

    it('skips coupon-auth throttler for requests without Authorization header', async () => {
      const props = makeRequestProps('coupon-auth', makeContext());

      const result = await guard['handleRequest'](props);

      expect(result).toBe(true);
      expect(superHandleSpy).not.toHaveBeenCalled();
    });
  });

  // ─── authenticated requests use coupon-auth throttler ────────────────────────

  describe('authenticated request (Bearer token present)', () => {
    it('delegates coupon-auth to super.handleRequest for requests with a Bearer token', async () => {
      const props = makeRequestProps('coupon-auth', makeContext('Bearer some-jwt-token'));

      const result = await guard['handleRequest'](props);

      expect(superHandleSpy).toHaveBeenCalledWith(props);
      expect(result).toBe(true);
    });

    it('skips coupon-anon throttler for requests with a Bearer token', async () => {
      const props = makeRequestProps('coupon-anon', makeContext('Bearer some-jwt-token'));

      const result = await guard['handleRequest'](props);

      expect(result).toBe(true);
      expect(superHandleSpy).not.toHaveBeenCalled();
    });
  });

  // ─── authorization header edge cases ─────────────────────────────────────────

  describe('authorization header edge cases', () => {
    it('treats a non-Bearer scheme as unauthenticated (uses coupon-anon)', async () => {
      const props = makeRequestProps('coupon-anon', makeContext('Basic dXNlcjpwYXNz'));

      await guard['handleRequest'](props);

      expect(superHandleSpy).toHaveBeenCalled();
    });

    it('treats an empty authorization header as unauthenticated (uses coupon-anon)', async () => {
      const props = makeRequestProps('coupon-anon', makeContext(''));

      await guard['handleRequest'](props);

      expect(superHandleSpy).toHaveBeenCalled();
    });
  });
});
