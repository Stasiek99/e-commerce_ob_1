// Invariant: 'coupon-anon' and 'coupon-auth' are throttler names registered globally
// (THROTTLER_CONFIGS, consumed by the APP_GUARD ThrottlerGuard that runs on every route),
// but they are only meant to gate POST /coupons/validate (enforced there by the dedicated
// CouponValidateThrottlerGuard). Without skipIf scoping them to that route, the global guard
// silently throttles every other route in the app — including public storefront routes like
// GET /products — to 3-10 req/min per route.

import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { THROTTLER_CONFIGS } from '../throttler.config';

@Controller('other')
class UnrelatedController {
  @Get('ping')
  ping() {
    return { ok: true };
  }
}

// Mirrors CouponController's POST /coupons/validate path exactly — the only route the
// coupon-anon/coupon-auth throttlers should ever apply to.
@Controller('coupons')
class FakeCouponController {
  @Post('validate')
  validate() {
    return { ok: true };
  }
}

describe('THROTTLER_CONFIGS — coupon throttler scoping', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(THROTTLER_CONFIGS)],
      controllers: [UnrelatedController, FakeCouponController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not throttle an unrelated route via coupon-anon — more than 3 requests in the window all succeed', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${baseUrl}/other/ping`);
      statuses.push(res.status);
    }

    expect(statuses).toEqual([200, 200, 200, 200]);
  });

  it('still enforces coupon-anon on POST /coupons/validate — the 4th request in the window is rejected', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${baseUrl}/coupons/validate`, { method: 'POST' });
      statuses.push(res.status);
    }

    expect(statuses).toContain(429);
  });
});
