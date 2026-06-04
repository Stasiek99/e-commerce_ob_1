import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PaymentsController } from '../payments.controller';
import { PaymentsService } from '../payments.service';
import { StripeClient } from '../stripe.client';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';

const RECONCILE_SECRET = 'test-reconcile-secret-abc123';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let service: jest.Mocked<PaymentsService>;
  let stripeClient: jest.Mocked<StripeClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        {
          provide: PaymentsService,
          useValue: {
            refundPayment: jest.fn(),
            getPaymentStatus: jest.fn(),
            handleWebhookEvent: jest.fn(),
          },
        },
        {
          provide: StripeClient,
          useValue: {
            constructWebhookEvent: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(RECONCILE_SECRET),
          },
        },
      ],
    }).compile();

    controller = module.get(PaymentsController);
    service = module.get(PaymentsService) as jest.Mocked<PaymentsService>;
    stripeClient = module.get(StripeClient) as jest.Mocked<StripeClient>;
  });

  afterEach(() => jest.clearAllMocks());

  // ─── Guard metadata: POST /payments/:orderId/refund ──────────────────────
  //
  // These tests verify that the decorator metadata is correctly wired at the
  // handler level — they don't exercise HTTP transport, but they catch the
  // original bug (missing @Roles / RolesGuard) at the source.

  describe('refund endpoint — guard metadata', () => {
    it('has @Roles(Role.ADMIN) set on the refund handler', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, PaymentsController.prototype.refund);

      expect(roles).toBeDefined();
      expect(roles).toContain(Role.ADMIN);
    });

    it('has RolesGuard in the guards metadata for the refund handler', () => {
      const guards: unknown[] =
        Reflect.getMetadata('__guards__', PaymentsController.prototype.refund) ?? [];

      expect(guards).toContain(RolesGuard);
    });

    it('does NOT apply RolesGuard to the getStatus handler', () => {
      const guards: unknown[] =
        Reflect.getMetadata('__guards__', PaymentsController.prototype.getStatus) ?? [];

      expect(guards ?? []).not.toContain(RolesGuard);
    });

    it('does NOT attach @Roles metadata to the getStatus handler', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, PaymentsController.prototype.getStatus);

      expect(roles).toBeUndefined();
    });
  });

  // ─── RolesGuard unit — admin access control ──────────────────────────────

  describe('RolesGuard', () => {
    let guard: RolesGuard;
    let reflector: Reflector;

    const buildContext = (userRole: Role | undefined): ExecutionContext =>
      ({
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({
            user: userRole !== undefined ? { role: userRole } : undefined,
          }),
        }),
      }) as unknown as ExecutionContext;

    beforeEach(async () => {
      const guardModule = await Test.createTestingModule({
        providers: [RolesGuard, Reflector],
      }).compile();

      guard = guardModule.get(RolesGuard);
      reflector = guardModule.get(Reflector);
    });

    it('allows any request when no roles are required on the handler', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      expect(guard.canActivate(buildContext(Role.CUSTOMER))).toBe(true);
    });

    it('allows an admin user when @Roles(ADMIN) is required', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

      expect(guard.canActivate(buildContext(Role.ADMIN))).toBe(true);
    });

    it('blocks a customer user when @Roles(ADMIN) is required', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

      expect(guard.canActivate(buildContext(Role.CUSTOMER))).toBe(false);
    });

    it('blocks a request with no user object when @Roles(ADMIN) is required', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

      expect(guard.canActivate(buildContext(undefined))).toBe(false);
    });
  });

  // ─── POST /payments/:orderId/refund ──────────────────────────────────────

  describe('refund', () => {
    it('delegates to PaymentsService.refundPayment with the orderId', async () => {
      service.refundPayment.mockResolvedValue(undefined);

      const result = await controller.refund('order-uuid-1');

      expect(service.refundPayment).toHaveBeenCalledWith('order-uuid-1');
      expect(result).toEqual({ refunded: true });
    });

    it('propagates NotFoundException when order does not exist', async () => {
      service.refundPayment.mockRejectedValue(new NotFoundException('Order not found'));

      await expect(controller.refund('nonexistent-uuid')).rejects.toThrow(NotFoundException);
    });

    it('propagates BadRequestException when order is not in a refundable state', async () => {
      service.refundPayment.mockRejectedValue(
        new BadRequestException('Order is not paid'),
      );

      await expect(controller.refund('order-uuid-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── GET /payments/:orderId/status ───────────────────────────────────────

  describe('getStatus', () => {
    it('delegates to PaymentsService.getPaymentStatus with orderId and userId when user is authenticated', async () => {
      const user = { id: 'user-1' } as any;
      const statusResult = { status: 'PAID', paidAt: new Date() } as any;
      service.getPaymentStatus.mockResolvedValue(statusResult);

      const result = await controller.getStatus('order-uuid-1', user, undefined);

      expect(service.getPaymentStatus).toHaveBeenCalledWith('order-uuid-1', 'user-1');
      expect(result).toBe(statusResult);
    });

    it('passes the userId from the JWT user object, not a hardcoded value', async () => {
      const user = { id: 'user-99' } as any;
      service.getPaymentStatus.mockResolvedValue({ status: 'PENDING' } as any);

      await controller.getStatus('order-uuid-2', user, undefined);

      expect(service.getPaymentStatus).toHaveBeenCalledWith('order-uuid-2', 'user-99');
    });

    it('propagates NotFoundException when order is not found or does not belong to user', async () => {
      const user = { id: 'user-1' } as any;
      service.getPaymentStatus.mockRejectedValue(new NotFoundException());

      await expect(controller.getStatus('stranger-order', user, undefined)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('delegates to getPaymentStatusByToken when no user but token is present', async () => {
      const statusResult = { status: 'PENDING', paidAt: null } as any;
      service.getPaymentStatusByToken = jest.fn().mockResolvedValue(statusResult);

      const result = await controller.getStatus('order-uuid-3', undefined, 'abc123token');

      expect(service.getPaymentStatusByToken).toHaveBeenCalledWith('order-uuid-3', 'abc123token');
      expect(result).toBe(statusResult);
    });

    it('throws UnauthorizedException when neither user nor token is present', async () => {
      let error: unknown;
      try {
        await controller.getStatus('order-uuid-4', undefined, undefined);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(UnauthorizedException);
    });
  });

  // ─── POST /payments/webhook ───────────────────────────────────────────────

  describe('webhook', () => {
    it('throws BadRequestException when stripe-signature header is missing', async () => {
      const req = { rawBody: Buffer.from('{}') } as any;

      await expect(controller.webhook(req, '')).rejects.toThrow(BadRequestException);
      await expect(controller.webhook(req, '')).rejects.toThrow(
        'Missing stripe-signature header',
      );
    });

    it('throws BadRequestException when raw body is not available', async () => {
      const req = { rawBody: undefined } as any;

      await expect(controller.webhook(req, 'sig_test')).rejects.toThrow(BadRequestException);
      await expect(controller.webhook(req, 'sig_test')).rejects.toThrow(
        'Raw body not available',
      );
    });

    it('throws BadRequestException when Stripe signature verification fails', async () => {
      const req = { rawBody: Buffer.from('{}') } as any;
      stripeClient.constructWebhookEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature for payload');
      });

      await expect(controller.webhook(req, 'bad_sig')).rejects.toThrow(BadRequestException);
      await expect(controller.webhook(req, 'bad_sig')).rejects.toThrow(
        'Invalid Stripe webhook signature',
      );
    });

    it('calls handleWebhookEvent and returns { received: true } on valid request', async () => {
      const fakeEvent = { id: 'evt_1', type: 'checkout.session.completed' } as any;
      const req = { rawBody: Buffer.from('{}') } as any;
      stripeClient.constructWebhookEvent.mockReturnValue(fakeEvent);
      service.handleWebhookEvent.mockResolvedValue(undefined);

      const result = await controller.webhook(req, 'valid_sig');

      expect(stripeClient.constructWebhookEvent).toHaveBeenCalledWith(req.rawBody, 'valid_sig');
      expect(service.handleWebhookEvent).toHaveBeenCalledWith(fakeEvent);
      expect(result).toEqual({ received: true });
    });
  });

  // ─── POST /payments/reconcile ─────────────────────────────────────────────

  describe('triggerReconciliation', () => {
    it('returns { triggered: true } and fires reconciliation with a valid secret', async () => {
      service.reconcilePendingPayments = jest.fn().mockResolvedValue(undefined);

      const result = await controller.triggerReconciliation(
        `Bearer ${RECONCILE_SECRET}`,
      );

      expect(result).toEqual({ triggered: true });
      // Give the fire-and-forget micro-task a tick to start
      await Promise.resolve();
      expect(service.reconcilePendingPayments).toHaveBeenCalledTimes(1);
    });

    it('throws UnauthorizedException when the authorization header is wrong', async () => {
      await expect(
        controller.triggerReconciliation('Bearer wrong-secret'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when the authorization header is missing', async () => {
      await expect(
        controller.triggerReconciliation(''),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when PAYMENTS_RECONCILE_SECRET is not configured', async () => {
      // Re-create controller with an empty secret
      const module = await Test.createTestingModule({
        controllers: [PaymentsController],
        providers: [
          { provide: PaymentsService, useValue: { reconcilePendingPayments: jest.fn() } },
          { provide: StripeClient, useValue: { constructWebhookEvent: jest.fn() } },
          { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
        ],
      }).compile();
      const ctrl = module.get(PaymentsController);

      await expect(
        ctrl.triggerReconciliation(`Bearer ${RECONCILE_SECRET}`),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for a same-length wrong secret (timing-safe guard)', async () => {
      // A secret with identical length to RECONCILE_SECRET but different content.
      // Naive string !== short-circuits early on the first mismatched byte, but
      // timingSafeEqual always runs the full comparison — both should reject.
      const sameLength = 'X'.repeat(RECONCILE_SECRET.length);
      await expect(
        controller.triggerReconciliation(`Bearer ${sameLength}`),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for a prefix of the correct secret', async () => {
      await expect(
        controller.triggerReconciliation(`Bearer ${RECONCILE_SECRET.slice(0, -1)}`),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for the correct secret with extra trailing character', async () => {
      await expect(
        controller.triggerReconciliation(`Bearer ${RECONCILE_SECRET}x`),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
