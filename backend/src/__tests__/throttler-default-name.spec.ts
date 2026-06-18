// Invariant: every @Throttle({ default: { ttl, limit } }) decorator in the app
// (auth, orders, payments, returns, reviews, users) overrides a throttler named
// 'default'. ThrottlerGuard only resolves route-level overrides for names present
// in the throttlers array passed to ThrottlerModule — without an entry literally
// named 'default', those overrides are silently never read and only burst/sustained
// apply anywhere. See app.module.ts THROTTLER_CONFIGS.

import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { THROTTLER_CONFIGS } from '../app.module';

@Controller('probe')
class ThrottleProbeController {
  // Tightened well below the 'sustained' (60/min) and 'burst' (5/s) global
  // floors, so only a working 'default' override can possibly trip it.
  @Throttle({ default: { ttl: 60_000, limit: 2 } })
  @Get('ping')
  ping() {
    return { ok: true };
  }
}

describe('THROTTLER_CONFIGS', () => {
  it('registers a throttler literally named "default"', () => {
    expect(THROTTLER_CONFIGS.some((t) => t.name === 'default')).toBe(true);
  });

  describe('route-level @Throttle({ default: {...} }) override', () => {
    let app: INestApplication;
    let baseUrl: string;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [ThrottlerModule.forRoot(THROTTLER_CONFIGS)],
        controllers: [ThrottleProbeController],
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

    it('is actually enforced — the 3rd request within the window is rejected with 429', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await fetch(`${baseUrl}/probe/ping`);
        statuses.push(res.status);
      }

      expect(statuses).toEqual([200, 200, 429]);
    });
  });
});
