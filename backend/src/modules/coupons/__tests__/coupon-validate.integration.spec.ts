import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { CouponController } from '../coupon.controller';
import { CouponService } from '../coupon.service';
import { CouponValidateThrottlerGuard } from '../guards/coupon-validate-throttler.guard';
import { OptionalJwtGuard } from '../../auth/guards/optional-jwt.guard';
import { THROTTLER_CONFIGS } from '../../../throttler.config';

// Unlike throttler-coupon-scope.spec.ts (proves the skipIf scoping against a FakeCouponController
// that only mirrors the route path) and coupon-validate-throttler.guard.spec.ts (calls
// guard.handleRequest() directly with a hand-built ExecutionContext), this boots the real
// CouponController with the real CouponValidateThrottlerGuard wired through its actual
// @UseGuards decorator, proving POST /coupons/validate is throttled end-to-end through
// production wiring rather than in isolation.
describe('CouponController — POST /coupons/validate integration (real guard stack)', () => {
  let app: INestApplication;
  let baseUrl: string;

  const mockCouponService = { validate: jest.fn() };
  const mockRedis = { incr: jest.fn(), expire: jest.fn(), del: jest.fn() };

  const postValidate = () =>
    fetch(`${baseUrl}/coupons/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'SAVE10', cartTotalInCents: 5000, variantIds: [] }),
    });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCouponService.validate.mockResolvedValue({
      valid: true,
      couponId: 'coupon-1',
      discountType: 'PERCENTAGE',
      discountAmountInCents: 500,
    });
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.del.mockResolvedValue(1);

    // Fresh module per test so the in-memory ThrottlerStorageService starts unhit —
    // otherwise hit counts would leak across tests sharing the same loopback IP.
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(THROTTLER_CONFIGS)],
      controllers: [CouponController],
      providers: [
        CouponValidateThrottlerGuard,
        { provide: CouponService, useValue: mockCouponService },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    })
      // OptionalJwtGuard delegates to the 'jwt' passport strategy, covered separately by
      // jwt.strategy.spec.ts — overriding it here keeps this spec focused on throttling.
      .overrideGuard(OptionalJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves the first 3 unauthenticated requests and throttles the 4th — coupon-anon (3/min) enforced through the real controller + guard wiring', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await postValidate()).status);
    }

    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(mockCouponService.validate).toHaveBeenCalledTimes(3);
  });

  it('returns the real CouponService result body on a successful request, proving the full handler ran (not just the guard)', async () => {
    const res = await postValidate();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      valid: true,
      couponId: 'coupon-1',
      discountType: 'PERCENTAGE',
      discountAmountInCents: 500,
    });
  });
});
