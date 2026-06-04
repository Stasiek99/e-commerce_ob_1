import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { EmailWebhookController } from '../email-webhook.controller';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('svix', () => ({ Webhook: jest.fn() }));
jest.mock('@sentry/nestjs', () => ({
  withScope: jest.fn((fn: (scope: unknown) => void) =>
    fn({ setTag: jest.fn(), setContext: jest.fn() }),
  ),
  captureMessage: jest.fn(),
}));

import { Webhook } from 'svix';

const MockedWebhook = Webhook as jest.MockedClass<typeof Webhook>;

// ─── fixtures ────────────────────────────────────────────────────────────────

const VALID_SECRET = 'whsec_test_secret_32bytes_padding_x';

const SVIX_HEADERS = {
  id: 'msg_123',
  timestamp: '1700000000',
  signature: 'v1,valid-sig',
};

function makeEvent(type: string, emailId = 'em-1', to: string[] = ['user@example.com']) {
  return {
    type,
    created_at: '2024-01-01T00:00:00Z',
    data: {
      email_id: emailId,
      from: 'shop@example.com',
      to,
      subject: 'Test subject',
      ...(type === 'email.bounced' && {
        bounce: { message: 'User unknown', subType: 'General', type: 'Permanent' },
      }),
    },
  };
}

function makeReq(body: object) {
  return { body, rawBody: Buffer.from(JSON.stringify(body)) };
}

async function buildController(secret: string) {
  const prisma = {
    emailLog: { create: jest.fn().mockResolvedValue({}) },
    user: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const config = {
    get: jest.fn((key: string, def = '') => (key === 'RESEND_WEBHOOK_SECRET' ? secret : def)),
  };

  const module: TestingModule = await Test.createTestingModule({
    controllers: [EmailWebhookController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: ConfigService, useValue: config },
    ],
  }).compile();

  return { controller: module.get(EmailWebhookController), prisma };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('EmailWebhookController', () => {
  let controller: EmailWebhookController;
  let prisma: { emailLog: { create: jest.Mock }; user: { updateMany: jest.Mock } };
  let mockVerify: jest.Mock;

  afterEach(() => jest.clearAllMocks());

  // ─── missing secret → 503 ────────────────────────────────────────────────────

  describe('when RESEND_WEBHOOK_SECRET is not configured', () => {
    beforeEach(async () => {
      mockVerify = jest.fn();
      MockedWebhook.mockImplementation(() => ({ verify: mockVerify }) as any);
      ({ controller, prisma } = await buildController(''));
    });

    it('throws ServiceUnavailableException — 503 not a silent pass-through', async () => {
      const req = makeReq(makeEvent('email.delivered'));

      await expect(
        controller.handle(req as any, SVIX_HEADERS.id, SVIX_HEADERS.timestamp, SVIX_HEADERS.signature),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('does not write any emailLog row when the secret is absent', async () => {
      const req = makeReq(makeEvent('email.delivered'));

      await expect(
        controller.handle(req as any, SVIX_HEADERS.id, SVIX_HEADERS.timestamp, SVIX_HEADERS.signature),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(prisma.emailLog.create).not.toHaveBeenCalled();
    });

    it('does not invoke Svix signature verification when the secret is absent', async () => {
      const req = makeReq(makeEvent('email.delivered'));

      await expect(
        controller.handle(req as any, SVIX_HEADERS.id, SVIX_HEADERS.timestamp, SVIX_HEADERS.signature),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(mockVerify).not.toHaveBeenCalled();
    });

    it('does not trigger any Sentry alert when the secret is absent', async () => {
      const req = makeReq(makeEvent('email.bounced'));

      await expect(
        controller.handle(req as any, SVIX_HEADERS.id, SVIX_HEADERS.timestamp, SVIX_HEADERS.signature),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(Sentry.withScope).not.toHaveBeenCalled();
    });
  });

  // ─── signature verification ───────────────────────────────────────────────────

  describe('when RESEND_WEBHOOK_SECRET is configured', () => {
    beforeEach(async () => {
      mockVerify = jest.fn();
      MockedWebhook.mockImplementation(() => ({ verify: mockVerify }) as any);
      ({ controller, prisma } = await buildController(VALID_SECRET));
    });

    describe('signature verification', () => {
      it('throws BadRequestException when svix.verify rejects the signature', async () => {
        mockVerify.mockImplementation(() => { throw new Error('bad sig'); });
        const req = makeReq(makeEvent('email.delivered'));

        await expect(
          controller.handle(req as any, SVIX_HEADERS.id, SVIX_HEADERS.timestamp, SVIX_HEADERS.signature),
        ).rejects.toThrow(BadRequestException);
      });

      it('does not write an emailLog row when the signature is invalid', async () => {
        mockVerify.mockImplementation(() => { throw new Error('bad sig'); });
        const req = makeReq(makeEvent('email.delivered'));

        await expect(
          controller.handle(req as any, SVIX_HEADERS.id, SVIX_HEADERS.timestamp, SVIX_HEADERS.signature),
        ).rejects.toThrow(BadRequestException);

        expect(prisma.emailLog.create).not.toHaveBeenCalled();
      });

      it('constructs Webhook with the configured secret', async () => {
        mockVerify.mockReturnValue(undefined);
        const req = makeReq(makeEvent('email.delivered'));

        await controller.handle(req as any, SVIX_HEADERS.id, SVIX_HEADERS.timestamp, SVIX_HEADERS.signature);

        expect(MockedWebhook).toHaveBeenCalledWith(VALID_SECRET);
      });

      it('passes the raw body and all three svix header values to verify()', async () => {
        mockVerify.mockReturnValue(undefined);
        const body = makeEvent('email.delivered');
        const rawBody = Buffer.from(JSON.stringify(body));
        const req = { body, rawBody };

        await controller.handle(req as any, SVIX_HEADERS.id, SVIX_HEADERS.timestamp, SVIX_HEADERS.signature);

        expect(mockVerify).toHaveBeenCalledWith(rawBody.toString('utf8'), {
          'svix-id': SVIX_HEADERS.id,
          'svix-timestamp': SVIX_HEADERS.timestamp,
          'svix-signature': SVIX_HEADERS.signature,
        });
      });
    });

    // ─── event processing ─────────────────────────────────────────────────────

    describe('event processing (valid signature)', () => {
      beforeEach(() => {
        mockVerify.mockReturnValue(undefined);
      });

      it('creates an emailLog row with the correct resendEmailId, event type, and recipient', async () => {
        const req = makeReq(makeEvent('email.delivered', 'em-99', ['buyer@store.pl']));

        await controller.handle(req as any, SVIX_HEADERS.id, SVIX_HEADERS.timestamp, SVIX_HEADERS.signature);

        expect(prisma.emailLog.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            resendEmailId: 'em-99',
            event: 'email.delivered',
            to: 'buyer@store.pl',
          }),
        });
      });

      it('uses the first element of the `to` array as the recipient', async () => {
        const req = makeReq(makeEvent('email.delivered', 'em-1', ['first@x.com', 'second@x.com']));

        await controller.handle(req as any, SVIX_HEADERS.id, SVIX_HEADERS.timestamp, SVIX_HEADERS.signature);

        expect(prisma.emailLog.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ to: 'first@x.com' }) }),
        );
      });

      it('triggers a Sentry warning on email.bounced', async () => {
        const req = makeReq(makeEvent('email.bounced'));

        await controller.handle(req as any, SVIX_HEADERS.id, SVIX_HEADERS.timestamp, SVIX_HEADERS.signature);

        expect(Sentry.withScope).toHaveBeenCalled();
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
          expect.stringContaining('bounced'),
          'warning',
        );
      });

      it('triggers a Sentry warning on email.complained', async () => {
        const req = makeReq(makeEvent('email.complained'));

        await controller.handle(req as any, SVIX_HEADERS.id, SVIX_HEADERS.timestamp, SVIX_HEADERS.signature);

        expect(Sentry.withScope).toHaveBeenCalled();
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
          expect.stringContaining('complaint'),
          'warning',
        );
      });

      it('does not call Sentry for non-alert event types such as email.delivered', async () => {
        const req = makeReq(makeEvent('email.delivered'));

        await controller.handle(req as any, SVIX_HEADERS.id, SVIX_HEADERS.timestamp, SVIX_HEADERS.signature);

        expect(Sentry.withScope).not.toHaveBeenCalled();
      });

      // ── bounce suppression flag (DB update) ───────────────────────────────────
      // Invariant: a verified email.bounced event must set emailBounced=true on
      // the matching user row. Without this, EmailQueueService cannot suppress
      // future sends to the same address — the domain bounce rate will keep
      // rising until ISPs throttle or blacklist the sender domain.

      describe('email.bounced — user emailBounced flag update', () => {
        it('calls user.updateMany with emailBounced=true for the bounced address', async () => {
          const req = makeReq(makeEvent('email.bounced', 'em-bounce-1', ['bounced@customer.com']));

          await controller.handle(req as any, SVIX_HEADERS.id, SVIX_HEADERS.timestamp, SVIX_HEADERS.signature);

          expect(prisma.user.updateMany).toHaveBeenCalledWith({
            where: { email: 'bounced@customer.com' },
            data: expect.objectContaining({ emailBounced: true }),
          });
        });

        it('sets emailBouncedAt to a Date on the user record', async () => {
          const req = makeReq(makeEvent('email.bounced', 'em-bounce-2', ['bounced@customer.com']));

          await controller.handle(req as any, SVIX_HEADERS.id, SVIX_HEADERS.timestamp, SVIX_HEADERS.signature);

          const [callArg] = prisma.user.updateMany.mock.calls[0];
          expect(callArg.data.emailBouncedAt).toBeInstanceOf(Date);
        });

        it('does not call user.updateMany for email.delivered events', async () => {
          const req = makeReq(makeEvent('email.delivered'));

          await controller.handle(req as any, SVIX_HEADERS.id, SVIX_HEADERS.timestamp, SVIX_HEADERS.signature);

          expect(prisma.user.updateMany).not.toHaveBeenCalled();
        });

        it('does not call user.updateMany for email.complained events', async () => {
          const req = makeReq(makeEvent('email.complained'));

          await controller.handle(req as any, SVIX_HEADERS.id, SVIX_HEADERS.timestamp, SVIX_HEADERS.signature);

          expect(prisma.user.updateMany).not.toHaveBeenCalled();
        });

        it('still calls user.updateMany even when the bounced address has no user row (updateMany is safe for 0 matches)', async () => {
          prisma.user.updateMany.mockResolvedValue({ count: 0 });
          const req = makeReq(makeEvent('email.bounced', 'em-guest', ['guest@nonexistent.com']));

          await expect(
            controller.handle(req as any, SVIX_HEADERS.id, SVIX_HEADERS.timestamp, SVIX_HEADERS.signature),
          ).resolves.not.toThrow();

          expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
        });
      });
    });
  });
});
