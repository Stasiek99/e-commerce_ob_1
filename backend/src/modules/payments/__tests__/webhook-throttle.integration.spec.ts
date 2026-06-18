import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { json } from 'express';
import { PaymentsController } from '../payments.controller';
import { PaymentsService } from '../payments.service';
import { StripeClient } from '../stripe.client';
import { ConfigService } from '@nestjs/config';
import { THROTTLER_CONFIGS } from '../../../throttler.config';

// Invariant: POST /payments/webhook's @Throttle({ default: {...} }) override only
// replaces the 'default' throttler bucket — the global 'burst' (5 req/s/IP) and
// 'sustained' (60 req/min/IP) throttlers from THROTTLER_CONFIGS still apply to any
// route that doesn't explicitly skip them. Stripe sends webhooks from a small,
// rotating IP pool and retries failed deliveries with backoff for up to 3 days, so
// without @SkipThrottle({ burst: true, sustained: true }) a burst of retries could
// be 429'd indistinguishably from abuse. This boots the real PaymentsController
// with the real ThrottlerGuard (as APP_GUARD) to prove the exemption end-to-end.
describe('PaymentsController — POST /payments/webhook burst throttle exemption', () => {
  let app: INestApplication;
  let baseUrl: string;

  const mockPaymentsService = { handleWebhookEvent: jest.fn() };
  const mockStripeClient = { constructWebhookEvent: jest.fn() };

  const postWebhook = () =>
    fetch(`${baseUrl}/payments/webhook`, {
      method: 'POST',
      headers: { 'stripe-signature': 'sig_test', 'Content-Type': 'application/json' },
      body: '{}',
    });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockStripeClient.constructWebhookEvent.mockReturnValue({
      id: 'evt_1',
      type: 'checkout.session.completed',
    });
    mockPaymentsService.handleWebhookEvent.mockResolvedValue(undefined);

    // Fresh module per test so the in-memory ThrottlerStorageService starts unhit —
    // otherwise hit counts would leak across tests sharing the same loopback IP.
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(THROTTLER_CONFIGS)],
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: StripeClient, useValue: mockStripeClient },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    app.use(json({ verify: (req: any, _res: any, buf: Buffer) => { req.rawBody = buf; } }));
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves 6 rapid requests without a 429 — exempt from the 5 req/s burst limit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await postWebhook()).status);
    }

    expect(statuses).not.toContain(429);
    expect(mockPaymentsService.handleWebhookEvent).toHaveBeenCalledTimes(6);
  });
});
