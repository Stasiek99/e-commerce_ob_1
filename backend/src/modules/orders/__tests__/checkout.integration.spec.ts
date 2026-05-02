/**
 * Integration tests for the full checkout flow.
 * All three real services (CartService, OrdersService, PaymentsService) are
 * wired together. Only the external boundaries are mocked:
 *   - PrismaService  (database)
 *   - StripeClient   (Stripe API)
 *   - EmailService   (Resend)
 *   - InvoiceService (PDF generation + Supabase upload)
 *   - CouponService  (discount validation)
 *   - ConfigService  (env vars)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CarrierCode, OrderStatus, PaymentStatus } from '@prisma/client';
import type Stripe from 'stripe';
import { CartService } from '../../cart/cart.service';
import { OrdersService } from '../orders.service';
import { PaymentsService } from '../../payments/payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeClient } from '../../payments/stripe.client';
import { EmailService } from '../../email/email.service';
import { InvoiceService } from '../../invoice/invoice.service';
import { CouponService } from '../../coupons/coupon.service';
import { ConfigService } from '@nestjs/config';

// Fixed IDs shared across the test scenarios
const IDS = {
  orderId: 'order-integration-1',
  orderNumber: 'ORD-2026-000001',
  sessionId: 'cs_test_integration',
  paymentIntentId: 'pi_test_integration',
  cartId: 'cart-integration-1',
  variantId: 'pv-integration-1',
};

const mockCartItems = [
  {
    productVariantId: IDS.variantId,
    quantity: 2,
    productName: 'Dior Sauvage',
    variantLabel: '100ml',
    priceInCents: 34900,
    sku: 'DS-100',
    stock: 10,
    imageUrl: null,
    slug: 'dior-sauvage',
  },
];

const mockCart = {
  id: IDS.cartId,
  items: mockCartItems,
  totalInCents: 69800,
  itemCount: 2,
};

const mockOrder = {
  id: IDS.orderId,
  orderNumber: IDS.orderNumber,
  status: OrderStatus.PENDING_PAYMENT,
  snapshotEmail: 'test@example.com',
  snapshotFirstName: 'Jan',
  snapshotLastName: 'Kowalski',
  totalInCents: 71299,
  shippingCostInCents: 1499,
  carrierCode: CarrierCode.INPOST,
  items: [
    {
      snapshotName: 'Dior Sauvage – 100ml',
      snapshotSku: 'DS-100',
      snapshotPrice: 34900,
      quantity: 2,
    },
  ],
};

const mockStripeSession: Partial<Stripe.Checkout.Session> = {
  id: IDS.sessionId,
  payment_intent: IDS.paymentIntentId,
  url: 'https://checkout.stripe.com/pay/cs_test_integration',
};

const mockPayment = {
  id: 'payment-integration-1',
  orderId: IDS.orderId,
  status: PaymentStatus.PENDING,
  stripeCheckoutSessionId: IDS.sessionId,
  stripePaymentIntentId: IDS.paymentIntentId,
  amountInCents: 71299,
  currency: 'PLN',
  paidAt: null,
  failureReason: null,
  rawWebhookPayload: null,
  provider: 'stripe',
  createdAt: new Date(),
  updatedAt: new Date(),
  order: {
    ...mockOrder,
    items: [{ productVariantId: IDS.variantId, quantity: 2 }],
  },
};

const buildStripeEvent = (
  type: Stripe.Event.Type,
  object: unknown,
): Stripe.Event =>
  ({ id: `evt_${type}`, type, data: { object } }) as unknown as Stripe.Event;

describe('Checkout Integration Flow', () => {
  let cartService: CartService;
  let ordersService: OrdersService;
  let paymentsService: PaymentsService;
  let prisma: any;
  let stripeClient: jest.Mocked<StripeClient>;
  let emailService: jest.Mocked<EmailService>;

  const buildTransactionMock = (overrides: {
    stock?: number;
    orderResult?: any;
  } = {}) =>
    jest.fn().mockImplementation(async (fn: any) => {
      const tx = {
        $executeRawUnsafe: jest.fn(),
        $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
        productVariant: {
          findUnique: jest.fn().mockResolvedValue({
            id: IDS.variantId,
            stock: overrides.stock ?? 10,
          }),
          update: jest.fn(),
        },
        order: {
          create: jest.fn().mockResolvedValue(
            overrides.orderResult ?? mockOrder,
          ),
        },
        cart: {
          findFirst: jest.fn().mockResolvedValue({ id: IDS.cartId }),
        },
        cartItem: { deleteMany: jest.fn() },
        orderEvent: { create: jest.fn() },
      };
      return fn(tx);
    });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        OrdersService,
        PaymentsService,
        {
          provide: PrismaService,
          useValue: {
            cart: { findFirst: jest.fn() },
            cartItem: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
            user: { findUnique: jest.fn().mockResolvedValue(null) },
            productVariant: { findUnique: jest.fn() },
            order: { findUniqueOrThrow: jest.fn(), update: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
            orderEvent: { create: jest.fn() },
            payment: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
            $transaction: jest.fn(),
          },
        },
        {
          provide: StripeClient,
          useValue: {
            createCheckoutSession: jest.fn().mockResolvedValue(mockStripeSession),
            constructWebhookEvent: jest.fn(),
            retrieveCheckoutSession: jest.fn(),
          },
        },
        {
          provide: EmailService,
          useValue: {
            sendOrderConfirmation: jest.fn().mockResolvedValue(undefined),
            sendPaymentConfirmed: jest.fn().mockResolvedValue(undefined),
            sendPaymentConfirmedWithInvoice: jest.fn().mockResolvedValue(undefined),
            sendNewOrderNotification: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: InvoiceService,
          useValue: {
            processInvoice: jest.fn().mockResolvedValue({ url: 'https://mock-invoice.pdf', pdf: Buffer.from('') }),
          },
        },
        {
          provide: CouponService,
          useValue: {
            validate: jest.fn().mockResolvedValue({ valid: false }),
            applyInsideTransaction: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('pln'),
            getOrThrow: jest.fn().mockReturnValue('https://store.example.com/checkout/success'),
          },
        },
      ],
    }).compile();

    cartService = module.get(CartService);
    ordersService = module.get(OrdersService);
    paymentsService = module.get(PaymentsService);
    prisma = module.get(PrismaService);
    stripeClient = module.get(StripeClient);
    emailService = module.get(EmailService);
  });

  describe('happy path: cart → order → payment initiated', () => {
    beforeEach(() => {
      // CartService.getOrCreate
      prisma.cart.findFirst.mockResolvedValue({
        id: IDS.cartId,
        items: [
          {
            id: 'ci-1',
            productVariantId: IDS.variantId,
            quantity: 2,
            productVariant: {
              priceInCents: 34900,
              label: '100ml',
              sku: 'DS-100',
              stock: 10,
              product: { name: 'Dior Sauvage', slug: 'dior-sauvage', images: [] },
            },
          },
        ],
      });
      prisma.$transaction.mockImplementation(buildTransactionMock());
      // PaymentsService.initiatePayment → needs to load the order
      prisma.order.findUniqueOrThrow.mockResolvedValue(mockOrder);
      prisma.payment.create.mockResolvedValue(mockPayment);
    });

    it('returns orderId, orderNumber, and a Stripe paymentUrl', async () => {
      const result = await ordersService.createFromCart(
        'user-1',
        undefined,
        'test@example.com',
        {
          newAddress: {
            firstName: 'Jan',
            lastName: 'Kowalski',
            street: 'ul. Kwiatowa 1',
            city: 'Kraków',
            postalCode: '30-001',
            phone: '+48123456789',
          },
          carrierCode: CarrierCode.INPOST,
          inpostLockerCode: 'KRA001',
        },
      );

      expect(result.orderId).toBe(IDS.orderId);
      expect(result.orderNumber).toBe(IDS.orderNumber);
      expect(result.paymentUrl).toBe(mockStripeSession.url);
    });

    it('creates a Stripe Checkout Session with correct line items', async () => {
      await ordersService.createFromCart(
        'user-1',
        undefined,
        'test@example.com',
        {
          newAddress: {
            firstName: 'Jan',
            lastName: 'Kowalski',
            street: 'ul. Kwiatowa 1',
            city: 'Kraków',
            postalCode: '30-001',
            phone: '+48123456789',
          },
          carrierCode: CarrierCode.INPOST,
          inpostLockerCode: 'KRA001',
        },
      );

      expect(stripeClient.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: IDS.orderId,
          orderNumber: IDS.orderNumber,
          customerEmail: 'test@example.com',
        }),
      );
    });

    it('persists a Payment record linked to the order', async () => {
      await ordersService.createFromCart(
        'user-1',
        undefined,
        'test@example.com',
        {
          newAddress: {
            firstName: 'Jan',
            lastName: 'Kowalski',
            street: 'ul. Kwiatowa 1',
            city: 'Kraków',
            postalCode: '30-001',
            phone: '+48123456789',
          },
          carrierCode: CarrierCode.INPOST,
          inpostLockerCode: 'KRA001',
        },
      );

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: IDS.orderId,
            stripeCheckoutSessionId: IDS.sessionId,
            provider: 'stripe',
          }),
        }),
      );
    });

    it('sends order confirmation email as fire-and-forget', async () => {
      await ordersService.createFromCart(
        'user-1',
        undefined,
        'test@example.com',
        {
          newAddress: {
            firstName: 'Jan',
            lastName: 'Kowalski',
            street: 'ul. Kwiatowa 1',
            city: 'Kraków',
            postalCode: '30-001',
            phone: '+48123456789',
          },
          carrierCode: CarrierCode.INPOST,
          inpostLockerCode: 'KRA001',
        },
      );

      // Allow the fire-and-forget promise to settle
      await Promise.resolve();
      expect(emailService.sendOrderConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          orderNumber: IDS.orderNumber,
        }),
      );
    });
  });

  describe('webhook: checkout.session.completed → order marked PAID', () => {
    it('updates payment to COMPLETED and order to PAID atomically', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPayment);
      prisma.$transaction.mockResolvedValue([{}, {}]);

      await paymentsService.handleWebhookEvent(
        buildStripeEvent('checkout.session.completed', mockStripeSession),
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const txArgs = prisma.$transaction.mock.calls[0][0];
      expect(Array.isArray(txArgs)).toBe(true);
      // Invoice + email chain is fire-and-forget; flush microtasks before asserting
      await Promise.resolve();
      expect(emailService.sendPaymentConfirmedWithInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ orderNumber: IDS.orderNumber }),
      );
    });

    it('is idempotent — second webhook for same session is a no-op', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.COMPLETED,
      });

      await paymentsService.handleWebhookEvent(
        buildStripeEvent('checkout.session.completed', mockStripeSession),
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(emailService.sendPaymentConfirmed).not.toHaveBeenCalled();
    });
  });

  describe('webhook: checkout.session.expired → stock restored, order CANCELLED', () => {
    it('cancels order and restores stock when session expires', async () => {
      prisma.payment.findUnique.mockResolvedValue(mockPayment);

      const stockRestored: string[] = [];
      prisma.$transaction.mockImplementation(async (fn: any) => {
        if (typeof fn === 'function') {
          await fn({
            payment: { update: jest.fn() },
            order: { update: jest.fn() },
            orderEvent: { create: jest.fn() },
            productVariant: {
              update: jest.fn().mockImplementation((args: any) => {
                stockRestored.push(args.where.id);
              }),
            },
          });
        }
      });

      await paymentsService.handleWebhookEvent(
        buildStripeEvent('checkout.session.expired', mockStripeSession),
      );

      expect(stockRestored).toContain(IDS.variantId);
      expect(emailService.sendPaymentConfirmed).not.toHaveBeenCalled();
    });

    it('does not cancel an already-COMPLETED order on stray expired event', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        status: PaymentStatus.COMPLETED,
      });

      await paymentsService.handleWebhookEvent(
        buildStripeEvent('checkout.session.expired', mockStripeSession),
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('checkout guard rails', () => {
    it('throws BadRequestException when cart is empty', async () => {
      prisma.cart.findFirst.mockResolvedValue({
        id: IDS.cartId,
        items: [],
      });

      await expect(
        ordersService.createFromCart(
          'user-1',
          undefined,
          'test@example.com',
          {
            newAddress: {
              firstName: 'Jan',
              lastName: 'K',
              street: 'ul. Kwiatowa 1',
              city: 'Kraków',
              postalCode: '30-001',
              phone: '+48123456789',
            },
            carrierCode: CarrierCode.DHL,
          },
        ),
      ).rejects.toThrow(BadRequestException);

      expect(stripeClient.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('throws if stock is exhausted between cart fill and order creation', async () => {
      prisma.cart.findFirst.mockResolvedValue({
        id: IDS.cartId,
        items: [
          {
            id: 'ci-1',
            productVariantId: IDS.variantId,
            quantity: 5,
            productVariant: {
              priceInCents: 34900,
              label: '100ml',
              sku: 'DS-100',
              stock: 5,
              product: { name: 'Dior Sauvage', slug: 'dior-sauvage', images: [] },
            },
          },
        ],
      });

      prisma.$transaction.mockImplementation(
        buildTransactionMock({ stock: 2 }), // only 2 in stock, but 5 requested
      );

      await expect(
        ordersService.createFromCart(
          'user-1',
          undefined,
          'test@example.com',
          {
            newAddress: {
              firstName: 'Jan',
              lastName: 'K',
              street: 'ul. Kwiatowa 1',
              city: 'Kraków',
              postalCode: '30-001',
              phone: '+48123456789',
            },
            carrierCode: CarrierCode.DHL,
          },
        ),
      ).rejects.toThrow('Insufficient stock');

      expect(stripeClient.createCheckoutSession).not.toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });
  });
});
