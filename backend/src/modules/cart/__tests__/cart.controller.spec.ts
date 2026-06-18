// Guards against the throttler leak fix: POST /cart/items must carry its own explicit
// rate limit. Before this fix, the route had no @Throttle decorator at all and fell back
// to the generic floors (burst 5 req/s) once the accidental coupon-throttler global leak
// was scoped away — a real jump from an accidental ~3/min cap to ~300/min on a
// TurnstileGuard-protected, bot-sensitive endpoint.

import { INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CartController } from '../cart.controller';
import { CartService } from '../cart.service';
import { THROTTLER_CONFIGS } from '../../../throttler.config';

describe('CartController — POST /cart/items rate limiting', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(THROTTLER_CONFIGS)],
      controllers: [CartController],
      providers: [
        Reflector,
        {
          provide: CartService,
          useValue: { addItem: jest.fn().mockResolvedValue({ id: 'cart-1', items: [] }) },
        },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
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

  it('is actually enforced — the 21st request within the window is rejected with 429', async () => {
    // Paced below the global 'burst' (5 req/s) and 'sustained' (60/min) throttlers —
    // which still apply on top of this route's 'default' override — so only the
    // 20/min 'default' cap added by this fix can possibly trip the 21st request.
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await fetch(`${baseUrl}/cart/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productVariantId: 'pv-1', quantity: 1 }),
      });
      statuses.push(res.status);
      await new Promise((resolve) => setTimeout(resolve, 210));
    }

    expect(statuses.slice(0, 20).every((s) => s !== 429)).toBe(true);
    expect(statuses[20]).toBe(429);
  }, 15000);
});
