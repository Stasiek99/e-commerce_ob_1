import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CarrierCode, DiscountType, OrderStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { OrdersService } from '../orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CartService } from '../../cart/cart.service';
import { PaymentsService } from '../../payments/payments.service';
import { EmailQueueService } from '../../email/email-queue.service';
import { CouponService } from '../../coupons/coupon.service';
import { InvoiceService } from '../../invoice/invoice.service';
import { ShippingRatesService } from '../../shipping/shipping-rates.service';

const MOCK_RATES: Record<CarrierCode, number> = {
  [CarrierCode.INPOST]:      1499,
  [CarrierCode.DHL]:         1999,
  [CarrierCode.GLS]:         1799,
  [CarrierCode.DPD]:         1599,
  [CarrierCode.DPD_COURIER]: 1699,
};

const mockShippingRatesService = {
  getRateForCarrier: jest.fn((code: CarrierCode) => Promise.resolve(MOCK_RATES[code] ?? 1999)),
  getRateMap: jest.fn(() => Promise.resolve(MOCK_RATES)),
};

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: any;
  let cartService: jest.Mocked<CartService>;
  let paymentsService: jest.Mocked<PaymentsService>;
  let invoiceService: jest.Mocked<InvoiceService>;

  const mockAddress = {
    firstName: 'Jan',
    lastName: 'Kowalski',
    street: 'ul. Marszałkowska 1',
    city: 'Warszawa',
    postalCode: '00-001',
    phone: '+48123456789',
  };

  const mockCartItems = [
    {
      productVariantId: 'pv-1',
      quantity: 2,
      productName: 'Dior Sauvage',
      variantLabel: '100ml',
      priceInCents: 34900,
      vatRate: 2300,
      sku: 'DS-100',
      stock: 10,
      imageUrl: null,
      slug: 'dior-sauvage',
    },
    {
      productVariantId: 'pv-2',
      quantity: 1,
      productName: 'Chanel No 5',
      variantLabel: '50ml',
      priceInCents: 44900,
      vatRate: 2300,
      sku: 'CN5-50',
      stock: 5,
      imageUrl: null,
      slug: 'chanel-no-5',
    },
  ];

  const mockCart = {
    id: 'cart-1',
    items: mockCartItems,
    totalInCents: 2 * 34900 + 44900, // 114700
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: PrismaService,
          useValue: {
            address: { findFirst: jest.fn() },
            user: { findUnique: jest.fn().mockResolvedValue(null) },
            order: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), count: jest.fn(), update: jest.fn() },
            orderEvent: { create: jest.fn(), findMany: jest.fn() },
            cart: { findFirst: jest.fn() },
            cartItem: { deleteMany: jest.fn() },
            productVariant: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
            $transaction: jest.fn(),
            $executeRawUnsafe: jest.fn(),
            $queryRawUnsafe: jest.fn(),
          },
        },
        {
          provide: CartService,
          useValue: {
            getOrCreate: jest.fn(),
          },
        },
        {
          provide: PaymentsService,
          useValue: {
            initiatePayment: jest.fn(),
            expirePendingCheckoutSession: jest.fn().mockResolvedValue(undefined),
            refundPayment: jest.fn().mockResolvedValue(undefined),
            partialRefund: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: EmailQueueService,
          useValue: {
            sendOrderConfirmation: jest.fn().mockResolvedValue(undefined),
            sendOrderCancellation: jest.fn().mockResolvedValue(undefined),
            sendShippingNotification: jest.fn().mockResolvedValue(undefined),
            sendLowStockAlert: jest.fn().mockResolvedValue(undefined),
            sendReviewRequest: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: CouponService,
          useValue: {
            validate: jest.fn().mockResolvedValue({ valid: false }),
            applyInsideTransaction: jest.fn().mockResolvedValue(undefined),
            calculateDiscount: jest.fn().mockImplementation((type: DiscountType, value: number, cartTotal: number) => {
              if (type === DiscountType.PERCENTAGE) return Math.round((cartTotal * value) / 100);
              if (type === DiscountType.FIXED_AMOUNT) return Math.min(value, cartTotal);
              return 0;
            }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(undefined),
            getOrThrow: jest.fn().mockReturnValue('https://example.com'),
          },
        },
        {
          provide: InvoiceService,
          useValue: {
            processInvoice: jest.fn(),
          },
        },
        {
          provide: ShippingRatesService,
          useValue: mockShippingRatesService,
        },
      ],
    }).compile();

    service = module.get(OrdersService);
    prisma = module.get(PrismaService);
    cartService = module.get(CartService);
    paymentsService = module.get(PaymentsService);
    invoiceService = module.get(InvoiceService);
  });

  // ─── onModuleInit — sequence pre-creation ────────────────────────────────────

  describe('onModuleInit', () => {
    it('creates sequences for the current and next year outside any transaction', async () => {
      prisma.$executeRawUnsafe.mockResolvedValue(undefined);

      await service.onModuleInit();

      const year = new Date().getFullYear();
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        `CREATE SEQUENCE IF NOT EXISTS order_number_seq_${year} START 1`,
      );
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        `CREATE SEQUENCE IF NOT EXISTS order_number_seq_${year + 1} START 1`,
      );
    });

    it('uses the top-level prisma client (not a transaction client) for sequence DDL', async () => {
      prisma.$executeRawUnsafe.mockResolvedValue(undefined);

      await service.onModuleInit();

      // prisma.$executeRawUnsafe is the service-level client; tx.$executeRawUnsafe
      // is the transaction-scoped client — DDL must never reach the latter
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    });
  });

  describe('createFromCart', () => {
    it('should throw if cart is empty', async () => {
      cartService.getOrCreate.mockResolvedValue({ id: 'cart-1', items: [], totalInCents: 0 } as any);

      await expect(
        service.createFromCart('user-1', undefined, 'test@example.com', {
          newAddress: mockAddress,
          carrierCode: CarrierCode.INPOST,
          inpostLockerCode: 'KRA001',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if InPost selected without locker code', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);

      await expect(
        service.createFromCart('user-1', undefined, 'test@example.com', {
          newAddress: mockAddress,
          carrierCode: CarrierCode.INPOST,
          // no inpostLockerCode
        }),
      ).rejects.toThrow('InPost locker code is required');
    });

    it('should throw if DPD Pickup selected without dpdPickupPointCode', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);

      await expect(
        service.createFromCart('user-1', undefined, 'test@example.com', {
          newAddress: mockAddress,
          carrierCode: CarrierCode.DPD,
          // no dpdPickupPointCode
        }),
      ).rejects.toThrow('DPD pickup point code is required');
    });

    it('should NOT throw if DPD_COURIER selected without dpdPickupPointCode (home delivery)', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);

      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          $executeRawUnsafe: jest.fn(),
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
          productVariant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([{ id: 'pv-1', priceInCents: 34900 }, { id: 'pv-2', priceInCents: 44900 }]) },
          order: { create: jest.fn().mockResolvedValue({ id: 'o-1', orderNumber: 'ORD-2026-000001' }) },
          cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
          cartItem: { deleteMany: jest.fn() },
          orderEvent: { create: jest.fn() },
        };
        return fn(tx);
      });
      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      await expect(
        service.createFromCart('user-1', undefined, 'test@example.com', {
          newAddress: mockAddress,
          carrierCode: CarrierCode.DPD_COURIER,
        }),
      ).resolves.toMatchObject({ orderId: 'o-1' });
    });

    it('should persist dpdPickupPointCode in order data when DPD Pickup is selected', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);

      let capturedOrderData: any;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          $executeRawUnsafe: jest.fn(),
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
          productVariant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([{ id: 'pv-1', priceInCents: 34900 }, { id: 'pv-2', priceInCents: 44900 }]) },
          order: {
            create: jest.fn().mockImplementation((args: any) => {
              capturedOrderData = args.data;
              return { id: 'o-1', orderNumber: 'ORD-2026-000001' };
            }),
          },
          cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
          cartItem: { deleteMany: jest.fn() },
          orderEvent: { create: jest.fn() },
        };
        return fn(tx);
      });
      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      await service.createFromCart('user-1', undefined, 'test@example.com', {
        newAddress: mockAddress,
        carrierCode: CarrierCode.DPD,
        dpdPickupPointCode: 'KRK12',
      });

      expect(capturedOrderData.dpdPickupPointCode).toBe('KRK12');
      expect(capturedOrderData.carrierCode).toBe(CarrierCode.DPD);
    });

    it('should use shipping rate 1599 for DPD Pickup', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);

      let capturedShipping: number | undefined;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          $executeRawUnsafe: jest.fn(),
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
          productVariant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([{ id: 'pv-1', priceInCents: 34900 }, { id: 'pv-2', priceInCents: 44900 }]) },
          order: {
            create: jest.fn().mockImplementation((args: any) => {
              capturedShipping = args.data.shippingCostInCents;
              return { id: 'o-1', orderNumber: 'ORD-2026-000001' };
            }),
          },
          cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
          cartItem: { deleteMany: jest.fn() },
          orderEvent: { create: jest.fn() },
        };
        return fn(tx);
      });
      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      await service.createFromCart('user-1', undefined, 'test@example.com', {
        newAddress: mockAddress,
        carrierCode: CarrierCode.DPD,
        dpdPickupPointCode: 'KRK12',
      });

      expect(capturedShipping).toBe(1599);
    });

    it('should use shipping rate 1699 for DPD_COURIER', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);

      let capturedShipping: number | undefined;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          $executeRawUnsafe: jest.fn(),
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
          productVariant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([{ id: 'pv-1', priceInCents: 34900 }, { id: 'pv-2', priceInCents: 44900 }]) },
          order: {
            create: jest.fn().mockImplementation((args: any) => {
              capturedShipping = args.data.shippingCostInCents;
              return { id: 'o-1', orderNumber: 'ORD-2026-000001' };
            }),
          },
          cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
          cartItem: { deleteMany: jest.fn() },
          orderEvent: { create: jest.fn() },
        };
        return fn(tx);
      });
      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      await service.createFromCart('user-1', undefined, 'test@example.com', {
        newAddress: mockAddress,
        carrierCode: CarrierCode.DPD_COURIER,
      });

      expect(capturedShipping).toBe(1699);
    });

    it('should throw if neither addressId nor newAddress is provided', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);

      await expect(
        service.createFromCart('user-1', undefined, 'test@example.com', {
          carrierCode: CarrierCode.DHL,
        }),
      ).rejects.toThrow('Address is required');
    });

    it('should calculate correct totals with shipping', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);

      const createdOrder = {
        id: 'order-1',
        orderNumber: 'ORD-2026-000001',
        totalInCents: mockCart.totalInCents + 1999, // DHL = 19.99
      };

      // Capture the order data passed to tx.order.create
      let capturedOrderData: any;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          $executeRawUnsafe: jest.fn(),
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
          productVariant: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findMany: jest.fn().mockResolvedValue([{ id: 'pv-1', priceInCents: 34900 }, { id: 'pv-2', priceInCents: 44900 }]),
          },
          order: {
            create: jest.fn().mockImplementation((args: any) => {
              capturedOrderData = args.data;
              return createdOrder;
            }),
          },
          cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
          cartItem: { deleteMany: jest.fn() },
          orderEvent: { create: jest.fn() },
        };
        return fn(tx);
      });

      paymentsService.initiatePayment.mockResolvedValue({
        paymentUrl: 'https://mock.p24/pay',
      });

      await service.createFromCart('user-1', undefined, 'test@example.com', {
        newAddress: mockAddress,
        carrierCode: CarrierCode.DHL,
      });

      // itemsTotalInCents = 114700 (2*34900 + 44900)
      expect(capturedOrderData.itemsTotalInCents).toBe(114700);
      // shippingCostInCents = 1999 (DHL)
      expect(capturedOrderData.shippingCostInCents).toBe(1999);
      // totalInCents = 114700 + 1999 = 116699
      expect(capturedOrderData.totalInCents).toBe(116699);
    });

    it('should snapshot snapshotVatRate from cart item vatRate into each order item', async () => {
      const cartWithCustomRate = {
        ...mockCart,
        items: [{ ...mockCartItems[0], vatRate: 500 }], // 5% VAT product
      };
      cartService.getOrCreate.mockResolvedValue(cartWithCustomRate as any);

      let capturedOrderData: any;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          $executeRawUnsafe: jest.fn(),
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
          productVariant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([{ id: 'pv-1', priceInCents: 34900 }, { id: 'pv-2', priceInCents: 44900 }]) },
          order: {
            create: jest.fn().mockImplementation((args: any) => {
              capturedOrderData = args.data;
              return { id: 'o-1', orderNumber: 'ORD-2026-000001' };
            }),
          },
          cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
          cartItem: { deleteMany: jest.fn() },
          orderEvent: { create: jest.fn() },
        };
        return fn(tx);
      });
      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      await service.createFromCart('user-1', undefined, 'test@example.com', {
        newAddress: mockAddress,
        carrierCode: CarrierCode.DHL,
      });

      expect(capturedOrderData.items.create[0]).toMatchObject({ snapshotVatRate: 500 });
    });

    it('should atomically decrement stock for each item during order creation', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);

      const stockUpdates: Array<{ id: string; decrement: number }> = [];
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          $executeRawUnsafe: jest.fn(),
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
          productVariant: {
            // updateMany with WHERE stock >= qty — returns count=1 on success
            updateMany: jest.fn().mockImplementation((args: any) => {
              stockUpdates.push({
                id: args.where.id,
                decrement: args.data.stock.decrement,
              });
              return { count: 1 };
            }),
            findMany: jest.fn().mockResolvedValue([{ id: 'pv-1', priceInCents: 34900 }, { id: 'pv-2', priceInCents: 44900 }]),
          },
          order: { create: jest.fn().mockResolvedValue({ id: 'o-1', orderNumber: 'ORD-2026-000001' }) },
          cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
          cartItem: { deleteMany: jest.fn() },
          orderEvent: { create: jest.fn() },
        };
        return fn(tx);
      });

      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      await service.createFromCart('user-1', undefined, 'test@example.com', {
        newAddress: mockAddress,
        carrierCode: CarrierCode.DHL,
      });

      expect(stockUpdates).toEqual([
        { id: 'pv-1', decrement: 2 },
        { id: 'pv-2', decrement: 1 },
      ]);
    });

    it('should throw if stock is insufficient (updateMany returns count=0)', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);

      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          $executeRawUnsafe: jest.fn(),
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
          productVariant: {
            // count=0 means the WHERE stock >= qty condition was not met
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          order: { create: jest.fn() },
          cart: { findFirst: jest.fn() },
          cartItem: { deleteMany: jest.fn() },
          orderEvent: { create: jest.fn() },
        };
        return fn(tx);
      });

      await expect(
        service.createFromCart('user-1', undefined, 'test@example.com', {
          newAddress: mockAddress,
          carrierCode: CarrierCode.DHL,
        }),
      ).rejects.toThrow('Insufficient stock');
    });

    it('should snapshot address fields and persist termsVersion', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);

      let capturedOrderData: any;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          $executeRawUnsafe: jest.fn(),
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
          productVariant: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findMany: jest.fn().mockResolvedValue([{ id: 'pv-1', priceInCents: 34900 }, { id: 'pv-2', priceInCents: 44900 }]),
          },
          order: {
            create: jest.fn().mockImplementation((args: any) => {
              capturedOrderData = args.data;
              return { id: 'o-1', orderNumber: 'ORD-2026-000001' };
            }),
          },
          cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
          cartItem: { deleteMany: jest.fn() },
          orderEvent: { create: jest.fn() },
        };
        return fn(tx);
      });

      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      await service.createFromCart('user-1', undefined, 'test@example.com', {
        newAddress: mockAddress,
        carrierCode: CarrierCode.DHL,
        termsVersion: '1.0',
        termsAcceptedAt: '2026-04-09T12:00:00.000Z',
      });

      expect(capturedOrderData.snapshotFirstName).toBe('Jan');
      expect(capturedOrderData.snapshotLastName).toBe('Kowalski');
      expect(capturedOrderData.snapshotCity).toBe('Warszawa');
      expect(capturedOrderData.snapshotCountry).toBe('PL');
      expect(capturedOrderData.termsVersion).toBe('1.0');
      expect(capturedOrderData.termsAcceptedAt).toEqual(new Date('2026-04-09T12:00:00.000Z'));
    });

    it('should clear cart after payment session is confirmed', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);
      prisma.cart.findFirst.mockResolvedValue({ id: 'cart-1' });

      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          $executeRawUnsafe: jest.fn(),
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
          productVariant: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findMany: jest.fn().mockResolvedValue([{ id: 'pv-1', priceInCents: 34900 }, { id: 'pv-2', priceInCents: 44900 }]),
          },
          order: { create: jest.fn().mockResolvedValue({ id: 'o-1', orderNumber: 'ORD-2026-000001' }) },
          cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
          cartItem: { deleteMany: jest.fn() },
          orderEvent: { create: jest.fn() },
        };
        return fn(tx);
      });

      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      await service.createFromCart('user-1', undefined, 'test@example.com', {
        newAddress: mockAddress,
        carrierCode: CarrierCode.DHL,
      });

      expect(prisma.cartItem.deleteMany).toHaveBeenCalled();
    });

    it('resolves address by saved addressId', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);
      prisma.address.findFirst.mockResolvedValue({
        firstName: 'Jan', lastName: 'K', street: 'ul. X 1',
        city: 'Kraków', postalCode: '30-001', country: 'PL', phone: '+48111111111',
      });

      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          $executeRawUnsafe: jest.fn(),
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
          productVariant: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findMany: jest.fn().mockResolvedValue([{ id: 'pv-1', priceInCents: 34900 }, { id: 'pv-2', priceInCents: 44900 }]),
          },
          order: { create: jest.fn().mockResolvedValue({ id: 'o-1', orderNumber: 'ORD-2026-000001' }) },
          cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
          cartItem: { deleteMany: jest.fn() },
          orderEvent: { create: jest.fn() },
        };
        return fn(tx);
      });

      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      await service.createFromCart('user-1', undefined, 'test@example.com', {
        addressId: 'addr-1',
        carrierCode: CarrierCode.DHL,
      });

      expect(prisma.address.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'addr-1' }) }),
      );
    });

    it('throws NotFoundException when addressId does not exist', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);
      prisma.address.findFirst.mockResolvedValue(null);

      await expect(
        service.createFromCart('user-1', undefined, 'test@example.com', {
          addressId: 'nonexistent-addr',
          carrierCode: CarrierCode.DHL,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    // ─── IDOR guard: guest + saved addressId ─────────────────────────────────

    it('throws BadRequestException when a guest supplies an addressId — IDOR guard', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);

      await expect(
        // userId = undefined → guest checkout
        service.createFromCart(undefined, 'session-abc', 'guest@example.com', {
          addressId: 'addr-belonging-to-registered-user',
          carrierCode: CarrierCode.DHL,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not query the address table when the IDOR guard fires', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);

      await expect(
        service.createFromCart(undefined, 'session-abc', 'guest@example.com', {
          addressId: 'addr-belonging-to-registered-user',
          carrierCode: CarrierCode.DHL,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.address.findFirst).not.toHaveBeenCalled();
    });

    it('allows an authenticated user to reference a saved addressId', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);
      prisma.address.findFirst.mockResolvedValue({
        firstName: 'Jan', lastName: 'K', street: 'ul. X 1',
        city: 'Kraków', postalCode: '30-001', country: 'PL', phone: '+48111111111',
      });
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          $executeRawUnsafe: jest.fn(),
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
          productVariant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([{ id: 'pv-1', priceInCents: 34900 }, { id: 'pv-2', priceInCents: 44900 }]) },
          order: { create: jest.fn().mockResolvedValue({ id: 'o-1', orderNumber: 'ORD-2026-000001' }) },
          cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
          cartItem: { deleteMany: jest.fn() },
          orderEvent: { create: jest.fn() },
        };
        return fn(tx);
      });
      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      await expect(
        service.createFromCart('user-1', undefined, 'user@example.com', {
          addressId: 'addr-1',
          carrierCode: CarrierCode.DHL,
        }),
      ).resolves.not.toThrow();

      expect(prisma.address.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'addr-1', userId: 'user-1' }) }),
      );
    });

    it('falls back to sessionId cart when userId cart is empty', async () => {
      const emptyCart = { id: 'cart-user', items: [], totalInCents: 0, itemCount: 0 };
      const sessionCart = mockCart;

      cartService.getOrCreate
        .mockResolvedValueOnce(emptyCart as any)    // userId cart — empty
        .mockResolvedValueOnce(sessionCart as any)  // sessionId cart — has items
        .mockResolvedValueOnce(sessionCart as any); // getOrCreate after add

      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          $executeRawUnsafe: jest.fn(),
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
          productVariant: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findMany: jest.fn().mockResolvedValue([{ id: 'pv-1', priceInCents: 34900 }, { id: 'pv-2', priceInCents: 44900 }]),
          },
          order: { create: jest.fn().mockResolvedValue({ id: 'o-1', orderNumber: 'ORD-2026-000001' }) },
          cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
          cartItem: { deleteMany: jest.fn() },
          orderEvent: { create: jest.fn() },
        };
        return fn(tx);
      });

      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      const result = await service.createFromCart(
        'user-1', 'sess-1', 'test@example.com',
        { newAddress: mockAddress, carrierCode: CarrierCode.DHL },
      );

      expect(result.orderId).toBe('o-1');
    });

    it('proceeds gracefully when no cartRecord found inside transaction', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);

      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          $executeRawUnsafe: jest.fn(),
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
          productVariant: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findMany: jest.fn().mockResolvedValue([{ id: 'pv-1', priceInCents: 34900 }, { id: 'pv-2', priceInCents: 44900 }]),
          },
          order: { create: jest.fn().mockResolvedValue({ id: 'o-1', orderNumber: 'ORD-2026-000001' }) },
          cart: { findFirst: jest.fn().mockResolvedValue(null) }, // no cart record
          cartItem: { deleteMany: jest.fn() },
          orderEvent: { create: jest.fn() },
        };
        return fn(tx);
      });

      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      const result = await service.createFromCart('user-1', undefined, 'test@example.com', {
        newAddress: mockAddress,
        carrierCode: CarrierCode.DHL,
      });

      expect(result.orderId).toBe('o-1');
    });
  });

  describe('findAllForUser', () => {
    it('returns all orders for a user', async () => {
      const orders = [
        { id: 'o-1', items: [], payment: null },
        { id: 'o-2', items: [], payment: null },
      ];
      prisma.order.findMany.mockResolvedValue(orders);
      prisma.order.count.mockResolvedValue(2);

      const result = await service.findAllForUser('user-1');

      expect(result.data).toMatchObject([{ id: 'o-1' }, { id: 'o-2' }]);
      expect(result.meta.total).toBe(2);
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
    });

    it('appends totalPrice = quantity * snapshotPrice to each item', async () => {
      prisma.order.findMany.mockResolvedValue([{
        id: 'o-1',
        items: [
          { id: 'oi-1', quantity: 2, snapshotPrice: 34900, snapshotName: 'Sauvage', snapshotSku: 'DS-1' },
          { id: 'oi-2', quantity: 1, snapshotPrice: 44900, snapshotName: 'No 5', snapshotSku: 'CN-1' },
        ],
        payment: null,
      }]);
      prisma.order.count.mockResolvedValue(1);

      const result = await service.findAllForUser('user-1');
      const items = result.data[0].items;

      expect(items[0].totalPrice).toBe(69800);
      expect(items[1].totalPrice).toBe(44900);
    });

    it('hoists refundedAmountInCents from the payment relation', async () => {
      prisma.order.findMany.mockResolvedValue([{
        id: 'o-1',
        items: [],
        payment: { refundedAmountInCents: 5000 },
      }]);
      prisma.order.count.mockResolvedValue(1);

      const result = await service.findAllForUser('user-1');

      expect(result.data[0].refundedAmountInCents).toBe(5000);
    });

    it('defaults refundedAmountInCents to 0 when payment is null', async () => {
      prisma.order.findMany.mockResolvedValue([{ id: 'o-1', items: [], payment: null }]);
      prisma.order.count.mockResolvedValue(1);

      const result = await service.findAllForUser('user-1');

      expect(result.data[0].refundedAmountInCents).toBe(0);
    });
  });

  describe('findOneForUser', () => {
    it('returns the order when found', async () => {
      const order = { id: 'o-1', userId: 'user-1', items: [], payment: null };
      prisma.order.findFirst.mockResolvedValue(order);

      const result = await service.findOneForUser('o-1', 'user-1');

      expect(result).toMatchObject({ id: 'o-1', userId: 'user-1' });
    });

    it('throws NotFoundException when order does not belong to user', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(service.findOneForUser('o-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('appends totalPrice = quantity * snapshotPrice to each item', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o-1',
        items: [{ id: 'oi-1', quantity: 3, snapshotPrice: 10000, snapshotName: 'X', snapshotSku: 'X-1' }],
        payment: null,
      });

      const result = await service.findOneForUser('o-1', 'user-1');

      expect(result.items[0].totalPrice).toBe(30000);
    });

    it('hoists refundedAmountInCents from the payment relation', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o-1',
        items: [],
        payment: { refundedAmountInCents: 12500 },
      });

      const result = await service.findOneForUser('o-1', 'user-1');

      expect(result.refundedAmountInCents).toBe(12500);
    });

    it('defaults refundedAmountInCents to 0 when payment is null', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'o-1', items: [], payment: null });

      const result = await service.findOneForUser('o-1', 'user-1');

      expect(result.refundedAmountInCents).toBe(0);
    });
  });

  describe('findEventsForUser', () => {
    const mockEvents = [
      {
        id: 'evt-1',
        fromStatus: null,
        toStatus: OrderStatus.PENDING_PAYMENT,
        actor: 'CUSTOMER',
        note: 'Order created from cart',
        createdAt: new Date('2026-05-01T10:00:00Z'),
      },
      {
        id: 'evt-2',
        fromStatus: OrderStatus.PENDING_PAYMENT,
        toStatus: OrderStatus.PAID,
        actor: 'SYSTEM',
        note: null,
        createdAt: new Date('2026-05-01T10:05:00Z'),
      },
    ];

    it('throws NotFoundException when order does not exist for this user', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(service.findEventsForUser('order-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('does not leak events from another user — findFirst returns null for wrong owner', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(service.findEventsForUser('order-1', 'other-user-id')).rejects.toThrow(
        NotFoundException,
      );

      expect(prisma.orderEvent.findMany).not.toHaveBeenCalled();
    });

    it('returns events sorted ascending by createdAt for the owning user', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
      prisma.orderEvent.findMany.mockResolvedValue(mockEvents);

      const result = await service.findEventsForUser('order-1', 'user-1');

      expect(result).toEqual(mockEvents);
      expect(prisma.orderEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orderId: 'order-1' },
          orderBy: { createdAt: 'asc' },
        }),
      );
    });

    it('queries ownership with both orderId and userId in the where clause', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
      prisma.orderEvent.findMany.mockResolvedValue([]);

      await service.findEventsForUser('order-1', 'user-1');

      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1', userId: 'user-1' },
        }),
      );
    });

    it('returns only the allowed fields via select', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
      prisma.orderEvent.findMany.mockResolvedValue(mockEvents);

      await service.findEventsForUser('order-1', 'user-1');

      expect(prisma.orderEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            actor: true,
            note: true,
            createdAt: true,
          },
        }),
      );
    });

    it('returns an empty array when the order has no events yet', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
      prisma.orderEvent.findMany.mockResolvedValue([]);

      const result = await service.findEventsForUser('order-1', 'user-1');

      expect(result).toEqual([]);
    });
  });

  describe('generateInvoice', () => {
    const mockOrderRow = {
      id: 'order-1',
      orderNumber: 'ORD-2026-000001',
      status: OrderStatus.PAID,
      snapshotFirstName: 'Jan',
      snapshotLastName: 'Kowalski',
      snapshotCompany: null,
      snapshotNip: null,
      snapshotStreet: 'ul. Marszałkowska 1',
      snapshotCity: 'Warszawa',
      snapshotPostalCode: '00-001',
      itemsTotalInCents: 34900,
      shippingCostInCents: 1999,
      totalInCents: 36899,
      createdAt: new Date('2026-05-01T10:00:00Z'),
      items: [{ snapshotName: 'Dior Sauvage 100ml', snapshotPrice: 34900, snapshotVatRate: 2300, quantity: 1 }],
    };

    it('throws NotFoundException when order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.generateInvoice('nonexistent-id')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when order status is PENDING_PAYMENT', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...mockOrderRow,
        status: OrderStatus.PENDING_PAYMENT,
      });

      await expect(service.generateInvoice('order-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when order status is CANCELLED', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...mockOrderRow,
        status: OrderStatus.CANCELLED,
      });

      await expect(service.generateInvoice('order-1')).rejects.toThrow(BadRequestException);
    });

    it('returns invoiceUrl for a PAID order', async () => {
      prisma.order.findUnique.mockResolvedValue(mockOrderRow);
      invoiceService.processInvoice.mockResolvedValue({
        url: 'https://cdn.example.com/FV-ORD-2026-000001.pdf',
        pdf: Buffer.from(''),
      });

      const result = await service.generateInvoice('order-1');

      expect(result).toEqual({ invoiceUrl: 'https://cdn.example.com/FV-ORD-2026-000001.pdf' });
    });

    it.each([
      OrderStatus.PROCESSING,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
      OrderStatus.PARTIALLY_REFUNDED,
      OrderStatus.REFUNDED,
    ])('allows invoice generation for status %s', async (status) => {
      prisma.order.findUnique.mockResolvedValue({ ...mockOrderRow, status });
      invoiceService.processInvoice.mockResolvedValue({
        url: 'https://cdn.example.com/invoice.pdf',
        pdf: Buffer.from(''),
      });

      await expect(service.generateInvoice('order-1')).resolves.toMatchObject({
        invoiceUrl: expect.any(String),
      });
    });

    it('delegates to InvoiceService with the full order payload', async () => {
      prisma.order.findUnique.mockResolvedValue(mockOrderRow);
      invoiceService.processInvoice.mockResolvedValue({
        url: 'https://cdn.example.com/FV-ORD-2026-000001.pdf',
        pdf: Buffer.from(''),
      });

      await service.generateInvoice('order-1');

      expect(invoiceService.processInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'order-1',
          orderNumber: 'ORD-2026-000001',
          totalInCents: 36899,
          items: [expect.objectContaining({ snapshotName: 'Dior Sauvage 100ml' })],
        }),
      );
    });

    it('includes snapshotVatRate in the items passed to InvoiceService', async () => {
      prisma.order.findUnique.mockResolvedValue(mockOrderRow);
      invoiceService.processInvoice.mockResolvedValue({
        url: 'https://cdn.example.com/invoice.pdf',
        pdf: Buffer.from(''),
      });

      await service.generateInvoice('order-1');

      expect(invoiceService.processInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [expect.objectContaining({ snapshotVatRate: 2300 })],
        }),
      );
    });

    it('propagates errors thrown by InvoiceService', async () => {
      prisma.order.findUnique.mockResolvedValue(mockOrderRow);
      invoiceService.processInvoice.mockRejectedValue(new Error('Supabase upload failed'));

      await expect(service.generateInvoice('order-1')).rejects.toThrow('Supabase upload failed');
    });
  });

  describe('generateInvoiceForUser', () => {
    const mockOrderRow = {
      id: 'order-1',
      orderNumber: 'ORD-2026-000001',
      status: OrderStatus.PAID,
      snapshotFirstName: 'Jan',
      snapshotLastName: 'Kowalski',
      snapshotCompany: null,
      snapshotNip: null,
      snapshotStreet: 'ul. Marszałkowska 1',
      snapshotCity: 'Warszawa',
      snapshotPostalCode: '00-001',
      itemsTotalInCents: 34900,
      shippingCostInCents: 1999,
      totalInCents: 36899,
      createdAt: new Date('2026-05-01T10:00:00Z'),
      items: [{ snapshotName: 'Dior Sauvage 100ml', snapshotPrice: 34900, snapshotVatRate: 2300, quantity: 1 }],
    };

    it('throws NotFoundException when order does not belong to the requesting user', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.generateInvoiceForUser('order-1', 'attacker-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when order does not exist', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.generateInvoiceForUser('nonexistent-id', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('delegates to generateInvoice and returns invoiceUrl when user owns the order', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
      prisma.order.findUnique.mockResolvedValue(mockOrderRow);
      invoiceService.processInvoice.mockResolvedValue({
        url: 'https://cdn.example.com/FV-ORD-2026-000001.pdf',
        pdf: Buffer.from(''),
      });

      const result = await service.generateInvoiceForUser('order-1', 'user-1');

      expect(result).toEqual({ invoiceUrl: 'https://cdn.example.com/FV-ORD-2026-000001.pdf' });
    });

    it('passes the correct WHERE clause — id AND userId — to findFirst', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.generateInvoiceForUser('order-abc', 'user-xyz'),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.order.findFirst).toHaveBeenCalledWith({
        where: { id: 'order-abc', userId: 'user-xyz' },
        select: { id: true },
      });
    });

    it('propagates BadRequestException from generateInvoice for non-invoiceable status', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' });
      prisma.order.findUnique.mockResolvedValue({
        ...mockOrderRow,
        status: OrderStatus.PENDING_PAYMENT,
      });

      await expect(
        service.generateInvoiceForUser('order-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateStatus', () => {
    const makeTx = (overrides: Partial<{ variantUpdate: jest.Mock; orderUpdate: jest.Mock }> = {}) => ({
      productVariant: { update: overrides.variantUpdate ?? jest.fn() },
      order: { update: overrides.orderUpdate ?? jest.fn() },
      orderEvent: { create: jest.fn() },
    });

    it('transitions non-terminal status without restoring stock', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: OrderStatus.PAID,
        items: [{ productVariantId: 'pv-1', quantity: 2, cancelledQuantity: 0 }],
      });
      const txVariantUpdate = jest.fn();
      const txOrderUpdate = jest.fn();
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn(makeTx({ variantUpdate: txVariantUpdate, orderUpdate: txOrderUpdate })),
      );

      await service.updateStatus('o-1', OrderStatus.PROCESSING);

      expect(txOrderUpdate).toHaveBeenCalledWith({ where: { id: 'o-1' }, data: { status: OrderStatus.PROCESSING } });
      expect(txVariantUpdate).not.toHaveBeenCalled();
    });

    it('restores active stock when transitioning to CANCELLED', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: OrderStatus.PAID,
        items: [
          { productVariantId: 'pv-1', quantity: 3, cancelledQuantity: 1 }, // activeQty = 2
          { productVariantId: 'pv-2', quantity: 2, cancelledQuantity: 0 }, // activeQty = 2
        ],
      });
      const increments: Array<{ id: string; amount: number }> = [];
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn(makeTx({
          variantUpdate: jest.fn().mockImplementation((args: any) => {
            increments.push({ id: args.where.id, amount: args.data.stock.increment });
          }),
        })),
      );

      await service.updateStatus('o-1', OrderStatus.CANCELLED);

      expect(increments).toEqual([
        { id: 'pv-1', amount: 2 },
        { id: 'pv-2', amount: 2 },
      ]);
    });

    it('restores active stock when transitioning to REFUNDED', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: OrderStatus.SHIPPED,
        items: [{ productVariantId: 'pv-1', quantity: 1, cancelledQuantity: 0 }],
      });
      const increments: Array<{ id: string; amount: number }> = [];
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn(makeTx({
          variantUpdate: jest.fn().mockImplementation((args: any) => {
            increments.push({ id: args.where.id, amount: args.data.stock.increment });
          }),
        })),
      );

      await service.updateStatus('o-1', OrderStatus.REFUNDED);

      expect(increments).toEqual([{ id: 'pv-1', amount: 1 }]);
    });

    it('throws BadRequestException when attempting to exit terminal state CANCELLED', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: OrderStatus.CANCELLED,
        items: [{ productVariantId: 'pv-1', quantity: 2, cancelledQuantity: 0 }],
      });

      await expect(
        service.updateStatus('o-1', OrderStatus.REFUNDED),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when attempting to exit terminal state REFUNDED', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: OrderStatus.REFUNDED,
        items: [{ productVariantId: 'pv-1', quantity: 2, cancelledQuantity: 0 }],
      });

      await expect(
        service.updateStatus('o-1', OrderStatus.CANCELLED),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('is a no-op (no DB calls) when status is already the target', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: OrderStatus.CANCELLED,
        items: [],
      });

      await service.updateStatus('o-1', OrderStatus.CANCELLED);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('skips fully-cancelled items (activeQty = 0) when restoring stock', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: OrderStatus.PARTIALLY_REFUNDED,
        items: [
          { productVariantId: 'pv-1', quantity: 2, cancelledQuantity: 2 }, // activeQty = 0 — skip
          { productVariantId: 'pv-2', quantity: 3, cancelledQuantity: 1 }, // activeQty = 2
        ],
      });
      const increments: Array<{ id: string; amount: number }> = [];
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn(makeTx({
          variantUpdate: jest.fn().mockImplementation((args: any) => {
            increments.push({ id: args.where.id, amount: args.data.stock.increment });
          }),
        })),
      );

      await service.updateStatus('o-1', OrderStatus.REFUNDED);

      expect(increments).toHaveLength(1);
      expect(increments[0]).toEqual({ id: 'pv-2', amount: 2 });
    });

    it('fires review-request email (fire-and-forget) when status becomes DELIVERED', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: OrderStatus.SHIPPED,
        items: [],
      });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(makeTx()));
      prisma.order.findUnique.mockResolvedValue(null); // dispatchReviewRequestEmail exits early

      await service.updateStatus('o-1', OrderStatus.DELIVERED);
      await Promise.resolve();

      expect(prisma.order.findUnique).toHaveBeenCalled();
    });
  });

  // ─── updateStatus — state machine transition guard ───────────────────────────

  describe('updateStatus — state machine transition guard', () => {
    const makeTx = () => ({
      productVariant: { update: jest.fn() },
      order: { update: jest.fn() },
      orderEvent: { create: jest.fn() },
    });

    it('throws BadRequestException for every impossible transition from a terminal state', async () => {
      const terminalToTarget: Array<[OrderStatus, OrderStatus]> = [
        [OrderStatus.CANCELLED, OrderStatus.PAID],
        [OrderStatus.CANCELLED, OrderStatus.PROCESSING],
        [OrderStatus.CANCELLED, OrderStatus.SHIPPED],
        [OrderStatus.CANCELLED, OrderStatus.DELIVERED],
        [OrderStatus.CANCELLED, OrderStatus.REFUNDED],
        [OrderStatus.CANCELLED, OrderStatus.PARTIALLY_REFUNDED],
        [OrderStatus.REFUNDED,  OrderStatus.PAID],
        [OrderStatus.REFUNDED,  OrderStatus.PROCESSING],
        [OrderStatus.REFUNDED,  OrderStatus.SHIPPED],
        [OrderStatus.REFUNDED,  OrderStatus.DELIVERED],
        [OrderStatus.REFUNDED,  OrderStatus.CANCELLED],
        [OrderStatus.REFUNDED,  OrderStatus.PARTIALLY_REFUNDED],
      ];

      for (const [current, target] of terminalToTarget) {
        prisma.order.findUniqueOrThrow.mockResolvedValue({ status: current, items: [] });

        await expect(service.updateStatus('o-1', target)).rejects.toThrow(BadRequestException);
      }
    });

    it('throws BadRequestException for illegal forward skips (e.g. PENDING_PAYMENT → DELIVERED)', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: OrderStatus.PENDING_PAYMENT,
        items: [],
      });

      await expect(
        service.updateStatus('o-1', OrderStatus.DELIVERED),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for illegal backwards transitions (e.g. SHIPPED → PROCESSING)', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: OrderStatus.SHIPPED,
        items: [],
      });

      await expect(
        service.updateStatus('o-1', OrderStatus.PROCESSING),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not enter the transaction when the guard fires', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: OrderStatus.REFUNDED,
        items: [],
      });

      await expect(
        service.updateStatus('o-1', OrderStatus.PROCESSING),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows every valid transition in the happy path', async () => {
      const validTransitions: Array<[OrderStatus, OrderStatus]> = [
        [OrderStatus.PENDING_PAYMENT,    OrderStatus.PAID],
        [OrderStatus.PENDING_PAYMENT,    OrderStatus.CANCELLED],
        [OrderStatus.PAID,               OrderStatus.PROCESSING],
        [OrderStatus.PAID,               OrderStatus.SHIPPED],
        [OrderStatus.PAID,               OrderStatus.CANCELLED],
        [OrderStatus.PAID,               OrderStatus.REFUNDED],
        [OrderStatus.PROCESSING,         OrderStatus.SHIPPED],
        [OrderStatus.PROCESSING,         OrderStatus.CANCELLED],
        [OrderStatus.PROCESSING,         OrderStatus.REFUNDED],
        [OrderStatus.SHIPPED,            OrderStatus.DELIVERED],
        [OrderStatus.SHIPPED,            OrderStatus.REFUNDED],
        [OrderStatus.DELIVERED,          OrderStatus.REFUNDED],
        [OrderStatus.PARTIALLY_REFUNDED, OrderStatus.REFUNDED],
      ];

      prisma.$transaction.mockImplementation(async (fn: any) => fn(makeTx()));
      prisma.order.findUnique.mockResolvedValue(null); // dispatchReviewRequestEmail early-exit

      for (const [current, target] of validTransitions) {
        prisma.order.findUniqueOrThrow.mockResolvedValue({ status: current, items: [] });

        await expect(service.updateStatus('o-1', target)).resolves.not.toThrow();
      }
    });
  });

  describe('createFromCart (coupon branches)', () => {
    const buildTx = (coupon: { id: string; discountType: DiscountType; value: number; minSpendInCents: number | null } | null = null) => ({
      $executeRawUnsafe: jest.fn(),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
      productVariant: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ id: 'pv-1', priceInCents: 34900 }, { id: 'pv-2', priceInCents: 44900 }]),
      },
      coupon: { findUnique: jest.fn().mockResolvedValue(coupon) },
      order: { create: jest.fn().mockResolvedValue({ id: 'o-1', orderNumber: 'ORD-2026-000001' }) },
      cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
      cartItem: { deleteMany: jest.fn() },
      orderEvent: { create: jest.fn() },
    });

    it('throws BadRequestException when coupon code is invalid', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);
      const couponService = (service as any).couponService;
      couponService.validate.mockResolvedValue({ valid: false, message: 'Kupon wygasł.' });

      await expect(
        service.createFromCart('user-1', undefined, 'test@example.com', {
          newAddress: mockAddress,
          carrierCode: CarrierCode.DHL,
          couponCode: 'INVALID10',
        }),
      ).rejects.toThrow('Kupon wygasł.');
    });

    it('applies a FIXED discount coupon and subtracts it from total', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);
      const couponService = (service as any).couponService;
      couponService.validate.mockResolvedValue({
        valid: true,
        couponId: 'coupon-1',
        discountType: DiscountType.FIXED_AMOUNT,
        discountAmountInCents: 1000,
      });

      let capturedTotal: number | undefined;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = buildTx({ id: 'coupon-1', discountType: DiscountType.FIXED_AMOUNT, value: 1000, minSpendInCents: null });
        tx.order.create = jest.fn().mockImplementation((args: any) => {
          capturedTotal = args.data.totalInCents;
          return { id: 'o-1', orderNumber: 'ORD-2026-000001' };
        });
        return fn(tx);
      });
      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      await service.createFromCart('user-1', undefined, 'test@example.com', {
        newAddress: mockAddress,
        carrierCode: CarrierCode.DHL,
        couponCode: 'SAVE10',
      });

      // itemsTotal=114700 (fresh prices unchanged), shipping=1999, discount=min(1000,114700)=1000 → total=115699
      expect(capturedTotal).toBe(114700 + 1999 - 1000);
    });

    it('applies a FREE_SHIPPING coupon and zeroes out shipping cost', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);
      const couponService = (service as any).couponService;
      couponService.validate.mockResolvedValue({
        valid: true,
        couponId: 'coupon-2',
        discountType: DiscountType.FREE_SHIPPING,
        discountAmountInCents: 0,
      });

      let capturedDiscount: number | undefined;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = buildTx({ id: 'coupon-2', discountType: DiscountType.FREE_SHIPPING, value: 0, minSpendInCents: null });
        tx.order.create = jest.fn().mockImplementation((args: any) => {
          capturedDiscount = args.data.discountInCents;
          return { id: 'o-1', orderNumber: 'ORD-2026-000001' };
        });
        return fn(tx);
      });
      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      await service.createFromCart('user-1', undefined, 'test@example.com', {
        newAddress: mockAddress,
        carrierCode: CarrierCode.DHL,
        couponCode: 'FREESHIP',
      });

      expect(capturedDiscount).toBe(1999); // DHL shipping cost fully discounted
    });
  });

  describe('trackByEmailAndNumber', () => {
    it('returns tracking info when order matches email and number', async () => {
      const order = {
        orderNumber: 'ORD-2026-000001',
        status: OrderStatus.PROCESSING,
        createdAt: new Date(),
        totalInCents: 10000,
        items: [{ snapshotName: 'Dior', quantity: 1, snapshotPrice: 10000 }],
        shipment: { trackingNumber: 'TRK123', carrierCode: CarrierCode.INPOST },
      };
      prisma.order.findFirst.mockResolvedValue(order);

      const result = await service.trackByEmailAndNumber('test@example.com', 'ORD-2026-000001');

      expect(result.orderNumber).toBe('ORD-2026-000001');
      expect(result.trackingNumber).toBe('TRK123');
      expect(result.carrier).toBe(CarrierCode.INPOST);
    });

    it('returns null tracking when no shipment exists yet', async () => {
      prisma.order.findFirst.mockResolvedValue({
        orderNumber: 'ORD-2026-000001',
        status: OrderStatus.PENDING_PAYMENT,
        createdAt: new Date(),
        totalInCents: 10000,
        items: [],
        shipment: null,
      });

      const result = await service.trackByEmailAndNumber('test@example.com', 'ORD-2026-000001');

      expect(result.trackingNumber).toBeNull();
      expect(result.carrier).toBeNull();
    });

    it('throws NotFoundException when no matching order exists', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.trackByEmailAndNumber('test@example.com', 'NONEXISTENT'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAllAdmin', () => {
    it('returns all orders without status filter', async () => {
      prisma.order.findMany.mockResolvedValue([{ id: 'o-1', items: [], payment: null }]);
      prisma.order.count.mockResolvedValue(1);

      const result = await service.findAllAdmin({});

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
      expect(result.meta.total).toBe(1);
    });

    it('filters orders by status when provided', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(0);

      await service.findAllAdmin({ status: OrderStatus.PAID });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: OrderStatus.PAID } }),
      );
    });

    it('appends totalPrice to each item in admin response', async () => {
      prisma.order.findMany.mockResolvedValue([{
        id: 'o-1',
        items: [{ id: 'oi-1', quantity: 1, snapshotPrice: 49900, snapshotName: 'Y', snapshotSku: 'Y-1' }],
        payment: { refundedAmountInCents: 0 },
      }]);
      prisma.order.count.mockResolvedValue(1);

      const result = await service.findAllAdmin({});

      expect(result.data[0].items[0].totalPrice).toBe(49900);
    });

    it('hoists refundedAmountInCents from payment in admin response', async () => {
      prisma.order.findMany.mockResolvedValue([{
        id: 'o-1',
        items: [],
        payment: { refundedAmountInCents: 9900 },
      }]);
      prisma.order.count.mockResolvedValue(1);

      const result = await service.findAllAdmin({});

      expect(result.data[0].refundedAmountInCents).toBe(9900);
    });
  });

  describe('cancelByUser', () => {
    const mockOrderWithItems = {
      id: 'order-1',
      orderNumber: 'ORD-2026-000001',
      status: OrderStatus.PENDING_PAYMENT,
      snapshotEmail: 'test@example.com',
      snapshotFirstName: 'Jan',
      totalInCents: 10000,
      items: [{ productVariantId: 'pv-1', quantity: 2 }],
    };

    it('throws NotFoundException when order does not belong to user', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(service.cancelByUser('order-1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when order is already CANCELLED', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...mockOrderWithItems,
        status: OrderStatus.CANCELLED,
      });

      await expect(service.cancelByUser('order-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when order is already SHIPPED', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...mockOrderWithItems,
        status: OrderStatus.SHIPPED,
      });

      await expect(service.cancelByUser('order-1', 'user-1')).rejects.toThrow(
        'already been shipped',
      );
    });

    it('cancels PENDING_PAYMENT order: expires session, restores stock, creates event', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrderWithItems);
      const stockRestored: string[] = [];
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          productVariant: {
            update: jest.fn().mockImplementation((args: any) => {
              stockRestored.push(args.where.id);
            }),
          },
          order: { update: jest.fn() },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.cancelByUser('order-1', 'user-1');

      expect(paymentsService.expirePendingCheckoutSession).toHaveBeenCalledWith('order-1');
      expect(stockRestored).toContain('pv-1');
      expect(paymentsService.refundPayment).not.toHaveBeenCalled();
    });

    it('cancels PENDING_PAYMENT order with reason logged in event note', async () => {
      prisma.order.findFirst.mockResolvedValue(mockOrderWithItems);
      let capturedNote: string | undefined;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          productVariant: { update: jest.fn() },
          order: { update: jest.fn() },
          orderEvent: {
            create: jest.fn().mockImplementation((args: any) => {
              capturedNote = args.data.note;
            }),
          },
        });
      });

      await service.cancelByUser('order-1', 'user-1', 'Changed my mind');

      expect(capturedNote).toContain('Changed my mind');
    });

    it('issues refund via PaymentsService when order is PAID', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...mockOrderWithItems,
        status: OrderStatus.PAID,
      });

      await service.cancelByUser('order-1', 'user-1');

      expect(paymentsService.refundPayment).toHaveBeenCalledWith('order-1', 'CUSTOMER');
      expect(paymentsService.expirePendingCheckoutSession).not.toHaveBeenCalled();
    });

    it('creates extra orderEvent when refunding a PAID order with a reason', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...mockOrderWithItems,
        status: OrderStatus.PAID,
      });

      await service.cancelByUser('order-1', 'user-1', 'Withdrawal reason');

      expect(prisma.orderEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ note: expect.stringContaining('Withdrawal reason') }),
        }),
      );
    });
  });

  describe('bulkMarkAsShipped', () => {
    const makeOrder = (id: string, orderNumber: string, status: OrderStatus, trackingNumber?: string) => ({
      id,
      orderNumber,
      status,
      snapshotEmail: `${id}@example.com`,
      snapshotFirstName: 'Jan',
      carrierCode: CarrierCode.DHL,
      shipment: trackingNumber ? { trackingNumber } : null,
    });

    it('marks PAID and PROCESSING orders as SHIPPED and returns correct counts', async () => {
      const orders = [
        makeOrder('o-1', 'ORD-001', OrderStatus.PAID, 'TRK001'),
        makeOrder('o-2', 'ORD-002', OrderStatus.PROCESSING, 'TRK002'),
      ];
      prisma.order.findMany.mockResolvedValue(orders);
      prisma.order.findUniqueOrThrow.mockResolvedValue({ status: OrderStatus.PAID, items: [] });
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({ productVariant: { update: jest.fn() }, order: { update: jest.fn() }, orderEvent: { create: jest.fn() } }),
      );

      const result = await service.bulkMarkAsShipped(['o-1', 'o-2']);

      expect(result.succeeded).toBe(2);
      expect(result.failed).toHaveLength(0);
    });

    it('puts non-shippable status orders in failed list', async () => {
      const orders = [
        makeOrder('o-1', 'ORD-001', OrderStatus.SHIPPED),
        makeOrder('o-2', 'ORD-002', OrderStatus.CANCELLED),
        makeOrder('o-3', 'ORD-003', OrderStatus.DELIVERED),
        makeOrder('o-4', 'ORD-004', OrderStatus.REFUNDED),
        makeOrder('o-5', 'ORD-005', OrderStatus.PENDING_PAYMENT),
      ];
      prisma.order.findMany.mockResolvedValue(orders);

      const result = await service.bulkMarkAsShipped(['o-1', 'o-2', 'o-3', 'o-4', 'o-5']);

      expect(result.succeeded).toBe(0);
      expect(result.failed).toHaveLength(5);
      expect(result.failed.map((f) => f.orderNumber)).toEqual(
        expect.arrayContaining(['ORD-001', 'ORD-002', 'ORD-003', 'ORD-004', 'ORD-005']),
      );
    });

    it('sends shipping notification when order has a tracking number', async () => {
      const emailService = (service as any).emailService;
      const orders = [makeOrder('o-1', 'ORD-001', OrderStatus.PAID, 'TRK001')];
      prisma.order.findMany.mockResolvedValue(orders);
      prisma.order.findUniqueOrThrow.mockResolvedValue({ status: OrderStatus.PAID, items: [] });
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({ productVariant: { update: jest.fn() }, order: { update: jest.fn() }, orderEvent: { create: jest.fn() } }),
      );

      await service.bulkMarkAsShipped(['o-1']);
      await Promise.resolve();

      expect(emailService.sendShippingNotification).toHaveBeenCalledWith(
        expect.objectContaining({ trackingNumber: 'TRK001' }),
      );
    });

    it('skips email when order has no tracking number', async () => {
      const emailService = (service as any).emailService;
      const orders = [makeOrder('o-1', 'ORD-001', OrderStatus.PAID)]; // no tracking
      prisma.order.findMany.mockResolvedValue(orders);
      prisma.order.findUniqueOrThrow.mockResolvedValue({ status: OrderStatus.PAID, items: [] });
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({ productVariant: { update: jest.fn() }, order: { update: jest.fn() }, orderEvent: { create: jest.fn() } }),
      );

      await service.bulkMarkAsShipped(['o-1']);
      await Promise.resolve();

      expect(emailService.sendShippingNotification).not.toHaveBeenCalled();
    });

    it('adds order to failed when updateStatus throws', async () => {
      const orders = [makeOrder('o-1', 'ORD-001', OrderStatus.PAID)];
      prisma.order.findMany.mockResolvedValue(orders);
      prisma.order.findUniqueOrThrow.mockRejectedValue(new Error('DB error'));

      const result = await service.bulkMarkAsShipped(['o-1']);

      expect(result.succeeded).toBe(0);
      expect(result.failed[0]).toEqual({ orderNumber: 'ORD-001', reason: 'DB error' });
    });

    it('returns empty result for empty input', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      const result = await service.bulkMarkAsShipped([]);

      expect(result.succeeded).toBe(0);
      expect(result.failed).toHaveLength(0);
    });
  });

  describe('bulkCancel', () => {
    const makeOrder = (
      id: string,
      orderNumber: string,
      status: OrderStatus,
      items = [{ productVariantId: 'pv-1', quantity: 2 }],
    ) => ({
      id,
      orderNumber,
      status,
      snapshotEmail: `${id}@example.com`,
      snapshotFirstName: 'Jan',
      totalInCents: 10000,
      items,
    });

    it('cancels PENDING_PAYMENT orders and restores stock inside transaction', async () => {
      const orders = [makeOrder('o-1', 'ORD-001', OrderStatus.PENDING_PAYMENT)];
      prisma.order.findMany.mockResolvedValue(orders);

      const stockRestored: string[] = [];
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          productVariant: {
            update: jest.fn().mockImplementation((args: any) => {
              stockRestored.push(args.where.id);
            }),
          },
          order: { update: jest.fn() },
          orderEvent: { create: jest.fn() },
        });
      });

      const result = await service.bulkCancel(['o-1']);

      expect(result.succeeded).toBe(1);
      expect(result.failed).toHaveLength(0);
      expect(stockRestored).toContain('pv-1');
    });

    it('calls refundPayment for PAID orders instead of the manual transaction', async () => {
      const orders = [makeOrder('o-1', 'ORD-001', OrderStatus.PAID)];
      prisma.order.findMany.mockResolvedValue(orders);

      const result = await service.bulkCancel(['o-1']);

      expect(result.succeeded).toBe(1);
      expect(paymentsService.refundPayment).toHaveBeenCalledWith('o-1', 'ADMIN');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('calls refundPayment for PROCESSING orders instead of the manual transaction', async () => {
      const orders = [makeOrder('o-1', 'ORD-001', OrderStatus.PROCESSING)];
      prisma.order.findMany.mockResolvedValue(orders);

      const result = await service.bulkCancel(['o-1']);

      expect(result.succeeded).toBe(1);
      expect(paymentsService.refundPayment).toHaveBeenCalledWith('o-1', 'ADMIN');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects non-cancellable statuses: CANCELLED, REFUNDED, SHIPPED, DELIVERED', async () => {
      const orders = [
        makeOrder('o-1', 'ORD-001', OrderStatus.CANCELLED),
        makeOrder('o-2', 'ORD-002', OrderStatus.REFUNDED),
        makeOrder('o-3', 'ORD-003', OrderStatus.SHIPPED),
        makeOrder('o-4', 'ORD-004', OrderStatus.DELIVERED),
      ];
      prisma.order.findMany.mockResolvedValue(orders);

      const result = await service.bulkCancel(['o-1', 'o-2', 'o-3', 'o-4']);

      expect(result.succeeded).toBe(0);
      expect(result.failed).toHaveLength(4);
    });

    it('sends cancellation email for each cancelled order', async () => {
      const emailService = (service as any).emailService;
      const orders = [makeOrder('o-1', 'ORD-001', OrderStatus.PENDING_PAYMENT)];
      prisma.order.findMany.mockResolvedValue(orders);
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          productVariant: { update: jest.fn() },
          order: { update: jest.fn() },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.bulkCancel(['o-1']);
      await Promise.resolve();

      expect(emailService.sendOrderCancellation).toHaveBeenCalledWith(
        expect.objectContaining({ orderNumber: 'ORD-001' }),
      );
    });

    it('records OrderEvent with actor="ADMIN" by default', async () => {
      const orders = [makeOrder('o-1', 'ORD-001', OrderStatus.PENDING_PAYMENT)];
      prisma.order.findMany.mockResolvedValue(orders);

      let capturedActor: string | undefined;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          productVariant: { update: jest.fn() },
          order: { update: jest.fn() },
          orderEvent: {
            create: jest.fn().mockImplementation((args: any) => {
              capturedActor = args.data.actor;
            }),
          },
        });
      });

      await service.bulkCancel(['o-1']);

      expect(capturedActor).toBe('ADMIN');
    });

    it('adds order to failed when transaction throws', async () => {
      const orders = [makeOrder('o-1', 'ORD-001', OrderStatus.PENDING_PAYMENT)];
      prisma.order.findMany.mockResolvedValue(orders);
      prisma.$transaction.mockRejectedValue(new Error('DB unavailable'));

      const result = await service.bulkCancel(['o-1']);

      expect(result.succeeded).toBe(0);
      expect(result.failed[0]).toEqual({ orderNumber: 'ORD-001', reason: 'DB unavailable' });
    });

    it('returns empty result for empty input', async () => {
      prisma.order.findMany.mockResolvedValue([]);

      const result = await service.bulkCancel([]);

      expect(result.succeeded).toBe(0);
      expect(result.failed).toHaveLength(0);
    });

    // ─── Issue #13 regression harness ────────────────────────────────────────

    it('blocks PARTIALLY_REFUNDED orders — adds to failed without entering the transaction', async () => {
      const orders = [makeOrder('o-1', 'ORD-001', OrderStatus.PARTIALLY_REFUNDED)];
      prisma.order.findMany.mockResolvedValue(orders);

      const result = await service.bulkCancel(['o-1']);

      expect(result.succeeded).toBe(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].orderNumber).toBe('ORD-001');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('restores only active quantity (quantity − cancelledQuantity) per item, not full quantity', async () => {
      const orders = [
        makeOrder('o-1', 'ORD-001', OrderStatus.PENDING_PAYMENT, [
          { productVariantId: 'pv-1', quantity: 5, cancelledQuantity: 2 }, // activeQty = 3
          { productVariantId: 'pv-2', quantity: 3, cancelledQuantity: 0 }, // activeQty = 3
        ] as any[]),
      ];
      prisma.order.findMany.mockResolvedValue(orders);

      const increments: Array<{ id: string; amount: number }> = [];
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          productVariant: {
            update: jest.fn().mockImplementation((args: any) => {
              increments.push({ id: args.where.id, amount: args.data.stock.increment });
            }),
          },
          order: { update: jest.fn() },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.bulkCancel(['o-1']);

      expect(increments).toEqual([
        { id: 'pv-1', amount: 3 },
        { id: 'pv-2', amount: 3 },
      ]);
    });

    it('skips stock restore for items where all units were already cancelled (activeQty = 0)', async () => {
      const orders = [
        makeOrder('o-1', 'ORD-001', OrderStatus.PENDING_PAYMENT, [
          { productVariantId: 'pv-1', quantity: 2, cancelledQuantity: 2 }, // activeQty = 0 — must be skipped
          { productVariantId: 'pv-2', quantity: 4, cancelledQuantity: 1 }, // activeQty = 3 — must be restored
        ] as any[]),
      ];
      prisma.order.findMany.mockResolvedValue(orders);

      const updatedVariants: string[] = [];
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          productVariant: {
            update: jest.fn().mockImplementation((args: any) => {
              updatedVariants.push(args.where.id);
            }),
          },
          order: { update: jest.fn() },
          orderEvent: { create: jest.fn() },
        });
      });

      await service.bulkCancel(['o-1']);

      expect(updatedVariants).toEqual(['pv-2']);
      expect(updatedVariants).not.toContain('pv-1');
    });
  });

  describe('cancelItemsByUser', () => {
    const mockOrderItems = [
      {
        id: 'item-1',
        productVariantId: 'pv-1',
        quantity: 3,
        cancelledQuantity: 0,
        snapshotName: 'Dior Sauvage 100ml',
        snapshotSku: 'DS-100',
        snapshotPrice: 34900,
      },
      {
        id: 'item-2',
        productVariantId: 'pv-2',
        quantity: 2,
        cancelledQuantity: 1,
        snapshotName: 'Chanel No 5 50ml',
        snapshotSku: 'CN5-50',
        snapshotPrice: 44900,
      },
    ];

    const mockPaidOrder = {
      id: 'order-1',
      orderNumber: 'ORD-2026-000001',
      status: OrderStatus.PAID,
      snapshotEmail: 'test@example.com',
      snapshotFirstName: 'Jan',
      totalInCents: 100000,
      items: mockOrderItems,
    };

    it('throws BadRequestException when dto.items is empty', async () => {
      await expect(
        service.cancelItemsByUser('order-1', 'user-1', { items: [] }),
      ).rejects.toThrow('No items provided for cancellation');
    });

    it('throws NotFoundException when order not found for user', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelItemsByUser('order-1', 'user-1', {
          items: [{ orderItemId: 'item-1', quantity: 1 }],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for PENDING_PAYMENT status', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...mockPaidOrder,
        status: OrderStatus.PENDING_PAYMENT,
      });

      await expect(
        service.cancelItemsByUser('order-1', 'user-1', {
          items: [{ orderItemId: 'item-1', quantity: 1 }],
        }),
      ).rejects.toThrow('Cannot partially cancel an order with status PENDING_PAYMENT');
    });

    it('throws BadRequestException for SHIPPED status', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...mockPaidOrder,
        status: OrderStatus.SHIPPED,
      });

      await expect(
        service.cancelItemsByUser('order-1', 'user-1', {
          items: [{ orderItemId: 'item-1', quantity: 1 }],
        }),
      ).rejects.toThrow('Cannot partially cancel an order with status SHIPPED');
    });

    it('throws BadRequestException for CANCELLED status', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...mockPaidOrder,
        status: OrderStatus.CANCELLED,
      });

      await expect(
        service.cancelItemsByUser('order-1', 'user-1', {
          items: [{ orderItemId: 'item-1', quantity: 1 }],
        }),
      ).rejects.toThrow('Cannot partially cancel an order with status CANCELLED');
    });

    it('throws BadRequestException when orderItemId not found in order', async () => {
      prisma.order.findFirst.mockResolvedValue(mockPaidOrder);

      await expect(
        service.cancelItemsByUser('order-1', 'user-1', {
          items: [{ orderItemId: 'nonexistent-item', quantity: 1 }],
        }),
      ).rejects.toThrow('Item nonexistent-item not found in this order');
    });

    it('throws BadRequestException when quantity exceeds remaining quantity', async () => {
      // item-2 has quantity=2, cancelledQuantity=1 → remaining=1
      prisma.order.findFirst.mockResolvedValue(mockPaidOrder);

      await expect(
        service.cancelItemsByUser('order-1', 'user-1', {
          items: [{ orderItemId: 'item-2', quantity: 2 }],
        }),
      ).rejects.toThrow('Invalid quantity 2');
    });

    it('throws BadRequestException when quantity is 0', async () => {
      prisma.order.findFirst.mockResolvedValue(mockPaidOrder);

      await expect(
        service.cancelItemsByUser('order-1', 'user-1', {
          items: [{ orderItemId: 'item-1', quantity: 0 }],
        }),
      ).rejects.toThrow('Invalid quantity 0');
    });

    it('delegates to paymentsService.partialRefund with resolved items and CUSTOMER actor', async () => {
      prisma.order.findFirst.mockResolvedValue(mockPaidOrder);

      await service.cancelItemsByUser('order-1', 'user-1', {
        items: [{ orderItemId: 'item-1', quantity: 2 }],
      });

      expect(paymentsService.partialRefund).toHaveBeenCalledWith(
        'order-1',
        [
          {
            orderItemId: 'item-1',
            productVariantId: 'pv-1',
            quantity: 2,
            priceInCents: 34900,
          },
        ],
        OrderStatus.PAID,
        'CUSTOMER',
      );
    });

    it('resolves remaining quantity correctly accounting for already-cancelled items', async () => {
      // item-2: quantity=2, cancelledQuantity=1 → remaining=1 → quantity=1 should succeed
      prisma.order.findFirst.mockResolvedValue(mockPaidOrder);

      await service.cancelItemsByUser('order-1', 'user-1', {
        items: [{ orderItemId: 'item-2', quantity: 1 }],
      });

      expect(paymentsService.partialRefund).toHaveBeenCalledWith(
        'order-1',
        [expect.objectContaining({ orderItemId: 'item-2', quantity: 1, priceInCents: 44900 })],
        OrderStatus.PAID,
        'CUSTOMER',
      );
    });

    it('sends cancellation email with correct refund amount (fire-and-forget)', async () => {
      prisma.order.findFirst.mockResolvedValue(mockPaidOrder);
      const emailService = (service as any).emailService;

      await service.cancelItemsByUser('order-1', 'user-1', {
        items: [{ orderItemId: 'item-1', quantity: 2 }],
      });
      await Promise.resolve();

      // 2 × 34900 = 69800
      expect(emailService.sendOrderCancellation).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          orderNumber: 'ORD-2026-000001',
          firstName: 'Jan',
          totalInCents: 69800,
          isRefund: true,
        }),
      );
    });

    it('accepts PROCESSING status as valid for partial cancellation', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...mockPaidOrder,
        status: OrderStatus.PROCESSING,
      });

      await expect(
        service.cancelItemsByUser('order-1', 'user-1', {
          items: [{ orderItemId: 'item-1', quantity: 1 }],
        }),
      ).resolves.toBeUndefined();

      expect(paymentsService.partialRefund).toHaveBeenCalled();
    });

    it('accepts PARTIALLY_REFUNDED status as valid for partial cancellation', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...mockPaidOrder,
        status: OrderStatus.PARTIALLY_REFUNDED,
      });

      await expect(
        service.cancelItemsByUser('order-1', 'user-1', {
          items: [{ orderItemId: 'item-1', quantity: 1 }],
        }),
      ).resolves.toBeUndefined();

      expect(paymentsService.partialRefund).toHaveBeenCalled();
    });

    it('handles multiple items in a single request', async () => {
      prisma.order.findFirst.mockResolvedValue(mockPaidOrder);

      await service.cancelItemsByUser('order-1', 'user-1', {
        items: [
          { orderItemId: 'item-1', quantity: 2 },
          { orderItemId: 'item-2', quantity: 1 },
        ],
      });

      expect(paymentsService.partialRefund).toHaveBeenCalledWith(
        'order-1',
        expect.arrayContaining([
          expect.objectContaining({ orderItemId: 'item-1', quantity: 2 }),
          expect.objectContaining({ orderItemId: 'item-2', quantity: 1 }),
        ]),
        OrderStatus.PAID,
        'CUSTOMER',
      );
    });
  });

  // Merchant notification was removed from createFromCart — it now fires only
  // on checkout.session.completed (confirmed payment). Tests in
  // payments.service.spec.ts cover the notification payload and channels.
  describe('createFromCart — no premature merchant notification', () => {
    let svc: OrdersService;
    let emailService: any;

    const buildTx = () => ({
      $executeRawUnsafe: jest.fn(),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
      productVariant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([{ id: 'pv-1', priceInCents: 34900 }, { id: 'pv-2', priceInCents: 44900 }]) },
      coupon: { findUnique: jest.fn().mockResolvedValue(null) },
      order: { create: jest.fn().mockResolvedValue({ id: 'o-1', orderNumber: 'ORD-2026-000001' }) },
      cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
      cartItem: { deleteMany: jest.fn() },
      orderEvent: { create: jest.fn() },
    });

    const DHL_DTO = { newAddress: mockAddress, carrierCode: CarrierCode.DHL };

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OrdersService,
          {
            provide: PrismaService,
            useValue: {
              address: { findFirst: jest.fn() },
              user: { findUnique: jest.fn().mockResolvedValue(null) },
              order: { create: jest.fn(), update: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), count: jest.fn() },
              orderEvent: { create: jest.fn() },
              cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
              cartItem: { deleteMany: jest.fn() },
              productVariant: { findMany: jest.fn().mockResolvedValue([]) },
              $transaction: jest.fn().mockImplementation(async (fn: any) => fn(buildTx())),
              $executeRawUnsafe: jest.fn(),
              $queryRawUnsafe: jest.fn(),
            },
          },
          { provide: CartService, useValue: { getOrCreate: jest.fn().mockResolvedValue(mockCart) } },
          {
            provide: PaymentsService,
            useValue: {
              initiatePayment: jest.fn().mockResolvedValue({ paymentUrl: 'https://stripe.mock/pay' }),
              expirePendingCheckoutSession: jest.fn().mockResolvedValue(undefined),
              refundPayment: jest.fn().mockResolvedValue(undefined),
              partialRefund: jest.fn().mockResolvedValue(undefined),
            },
          },
          {
            provide: EmailQueueService,
            useValue: {
              sendOrderConfirmation: jest.fn().mockResolvedValue(undefined),
              sendOrderCancellation: jest.fn().mockResolvedValue(undefined),
              sendNewOrderNotification: jest.fn().mockResolvedValue(undefined),
              sendLowStockAlert: jest.fn().mockResolvedValue(undefined),
              sendReviewRequest: jest.fn().mockResolvedValue(undefined),
              sendShippingNotification: jest.fn().mockResolvedValue(undefined),
            },
          },
          {
            provide: CouponService,
            useValue: {
              validate: jest.fn().mockResolvedValue({ valid: false }),
              applyInsideTransaction: jest.fn().mockResolvedValue(undefined),
              calculateDiscount: jest.fn().mockImplementation((type: DiscountType, value: number, cartTotal: number) => {
                if (type === DiscountType.PERCENTAGE) return Math.round((cartTotal * value) / 100);
                if (type === DiscountType.FIXED_AMOUNT) return Math.min(value, cartTotal);
                return 0;
              }),
            },
          },
          {
            provide: ConfigService,
            useValue: {
              // ADMIN_ALERT_EMAIL is set — notification must still NOT fire from createFromCart
              get: jest.fn().mockImplementation((key: string) => {
                if (key === 'ADMIN_ALERT_EMAIL') return 'admin@store.com';
                if (key === 'FRONTEND_URL') return 'https://mystore.pl';
                return undefined;
              }),
              getOrThrow: jest.fn().mockReturnValue('https://example.com'),
            },
          },
          { provide: InvoiceService, useValue: { processInvoice: jest.fn() } },
          { provide: ShippingRatesService, useValue: mockShippingRatesService },
        ],
      }).compile();

      svc = module.get(OrdersService);
      emailService = module.get(EmailQueueService);
    });

    it('never fires sendNewOrderNotification from createFromCart even when ADMIN_ALERT_EMAIL is configured', async () => {
      await svc.createFromCart('user-1', undefined, 'customer@example.com', DHL_DTO);
      await Promise.resolve();

      expect(emailService.sendNewOrderNotification).not.toHaveBeenCalled();
    });

    it('still sends order confirmation email to the customer from createFromCart', async () => {
      await svc.createFromCart('user-1', undefined, 'customer@example.com', DHL_DTO);
      await Promise.resolve();

      expect(emailService.sendOrderConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'customer@example.com' }),
      );
    });
  });

  describe('getUnreadCount', () => {
    it('returns count of orders with PAID status', async () => {
      prisma.order.count.mockResolvedValue(7);

      const result = await service.getUnreadCount();

      expect(result).toEqual({ count: 7 });
      expect(prisma.order.count).toHaveBeenCalledWith({
        where: { status: OrderStatus.PAID },
      });
    });

    it('returns { count: 0 } when no PAID orders exist', async () => {
      prisma.order.count.mockResolvedValue(0);

      const result = await service.getUnreadCount();

      expect(result).toEqual({ count: 0 });
    });
  });

  // ─── Fix #15 regression harness — price-change race condition ────────────────
  // Invariant: snapshotPrice, itemsTotalInCents, and discountInCents must all be
  // computed from the DB price at commit time, not from the stale cart read.

  describe('createFromCart — price-change race condition (fix #15 regression harness)', () => {
    const buildRaceTx = (
      freshPrices: Array<{ id: string; priceInCents: number }>,
      coupon: { id: string; discountType: DiscountType; value: number; minSpendInCents: number | null } | null = null,
    ) => ({
      $executeRawUnsafe: jest.fn(),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
      productVariant: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue(freshPrices),
      },
      coupon: { findUnique: jest.fn().mockResolvedValue(coupon) },
      order: { create: jest.fn().mockResolvedValue({ id: 'o-1', orderNumber: 'ORD-2026-000001' }) },
      cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
      cartItem: { deleteMany: jest.fn() },
      orderEvent: { create: jest.fn() },
    });

    it('uses the fresh DB price as snapshotPrice, not the stale cart price', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);
      // pv-1 price increased from 34900 (in cart) to 39900 (DB at commit time)
      const freshPrices = [{ id: 'pv-1', priceInCents: 39900 }, { id: 'pv-2', priceInCents: 44900 }];
      let capturedItems: any;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = buildRaceTx(freshPrices);
        tx.order.create = jest.fn().mockImplementation((args: any) => {
          capturedItems = args.data.items.create;
          return { id: 'o-1', orderNumber: 'ORD-2026-000001' };
        });
        return fn(tx);
      });
      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      await service.createFromCart('user-1', undefined, 'test@example.com', {
        newAddress: mockAddress,
        carrierCode: CarrierCode.DHL,
      });

      const item1 = capturedItems.find((i: any) => i.productVariantId === 'pv-1');
      expect(item1.snapshotPrice).toBe(39900);
      expect(item1.snapshotPrice).not.toBe(34900); // must not use the stale cart price
    });

    it('recomputes itemsTotalInCents and totalInCents from fresh variant prices, not stale cart total', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);
      // pv-1 price went from 34900 to 39900 → fresh total = 2*39900 + 44900 = 124700
      const freshPrices = [{ id: 'pv-1', priceInCents: 39900 }, { id: 'pv-2', priceInCents: 44900 }];
      let capturedOrderData: any;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = buildRaceTx(freshPrices);
        tx.order.create = jest.fn().mockImplementation((args: any) => {
          capturedOrderData = args.data;
          return { id: 'o-1', orderNumber: 'ORD-2026-000001' };
        });
        return fn(tx);
      });
      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      await service.createFromCart('user-1', undefined, 'test@example.com', {
        newAddress: mockAddress,
        carrierCode: CarrierCode.DHL,
      });

      const freshItemsTotal = 2 * 39900 + 44900; // 124700
      expect(capturedOrderData.itemsTotalInCents).toBe(freshItemsTotal);
      expect(capturedOrderData.totalInCents).toBe(freshItemsTotal + 1999); // + DHL
      expect(capturedOrderData.itemsTotalInCents).not.toBe(mockCart.totalInCents); // not stale
    });

    it('recomputes PERCENTAGE coupon discount against the fresh items total', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);
      const couponService = (service as any).couponService;
      couponService.validate.mockResolvedValue({
        valid: true,
        couponId: 'coupon-pct',
        discountType: DiscountType.PERCENTAGE,
        discountAmountInCents: Math.round(mockCart.totalInCents * 10 / 100), // stale outer amount
      });
      // pv-1 price increased → fresh total 124700 → 10% = 12470 (not 11470 from stale cart)
      const freshPrices = [{ id: 'pv-1', priceInCents: 39900 }, { id: 'pv-2', priceInCents: 44900 }];
      let capturedOrderData: any;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = buildRaceTx(freshPrices, { id: 'coupon-pct', discountType: DiscountType.PERCENTAGE, value: 10, minSpendInCents: null });
        tx.order.create = jest.fn().mockImplementation((args: any) => {
          capturedOrderData = args.data;
          return { id: 'o-1', orderNumber: 'ORD-2026-000001' };
        });
        return fn(tx);
      });
      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      await service.createFromCart('user-1', undefined, 'test@example.com', {
        newAddress: mockAddress,
        carrierCode: CarrierCode.DHL,
        couponCode: 'SAVE10PCT',
      });

      const freshItemsTotal = 2 * 39900 + 44900; // 124700
      expect(capturedOrderData.discountInCents).toBe(Math.round(freshItemsTotal * 10 / 100)); // 12470
      expect(capturedOrderData.discountInCents).not.toBe(Math.round(mockCart.totalInCents * 10 / 100)); // not 11470
    });

    it('throws BadRequestException inside the transaction when fresh prices drop below coupon minSpendInCents', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);
      const couponService = (service as any).couponService;
      // Outer validation passes — stale cart total (114700) is above the 50000 minimum
      couponService.validate.mockResolvedValue({
        valid: true,
        couponId: 'coupon-min',
        discountType: DiscountType.FIXED_AMOUNT,
        discountAmountInCents: 500,
      });
      // Fresh prices collapsed: total = 2*1000 + 1000 = 3000, below 50000 minimum
      const cheapPrices = [{ id: 'pv-1', priceInCents: 1000 }, { id: 'pv-2', priceInCents: 1000 }];
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn(buildRaceTx(cheapPrices, { id: 'coupon-min', discountType: DiscountType.FIXED_AMOUNT, value: 500, minSpendInCents: 50000 })),
      );

      await expect(
        service.createFromCart('user-1', undefined, 'test@example.com', {
          newAddress: mockAddress,
          carrierCode: CarrierCode.DHL,
          couponCode: 'MINSPEND',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('generateOrderNumber', () => {
    it('should produce format ORD-YYYY-NNNNNN using PostgreSQL sequence', async () => {
      // Access the private method via prototype
      const tx = {
        $executeRawUnsafe: jest.fn(),
        $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 42n }]),
      };

      // Use the service's private method through the transaction flow
      cartService.getOrCreate.mockResolvedValue(mockCart as any);

      let generatedOrderNumber: string | undefined;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const fullTx = {
          ...tx,
          productVariant: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findMany: jest.fn().mockResolvedValue([{ id: 'pv-1', priceInCents: 34900 }, { id: 'pv-2', priceInCents: 44900 }]),
          },
          order: {
            create: jest.fn().mockImplementation((args: any) => {
              generatedOrderNumber = args.data.orderNumber;
              return { id: 'o-1', orderNumber: args.data.orderNumber };
            }),
          },
          cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
          cartItem: { deleteMany: jest.fn() },
          orderEvent: { create: jest.fn() },
        };
        return fn(fullTx);
      });

      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      await service.createFromCart('user-1', undefined, 'test@example.com', {
        newAddress: mockAddress,
        carrierCode: CarrierCode.DHL,
      });

      const year = new Date().getFullYear();
      expect(generatedOrderNumber).toBe(`ORD-${year}-000042`);

      // DDL no longer runs inside the transaction (moved to onModuleInit)
      expect(tx.$executeRawUnsafe).not.toHaveBeenCalledWith(
        expect.stringContaining('CREATE SEQUENCE'),
      );

      // nextval is still called inside the transaction (pure DML — no lock risk)
      expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
        `SELECT nextval('order_number_seq_${year}')`,
      );
    });

    it('should pad order numbers to 6 digits', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);

      let generatedOrderNumber: string | undefined;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          $executeRawUnsafe: jest.fn(),
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
          productVariant: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findMany: jest.fn().mockResolvedValue([{ id: 'pv-1', priceInCents: 34900 }, { id: 'pv-2', priceInCents: 44900 }]),
          },
          order: {
            create: jest.fn().mockImplementation((args: any) => {
              generatedOrderNumber = args.data.orderNumber;
              return { id: 'o-1', orderNumber: args.data.orderNumber };
            }),
          },
          cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
          cartItem: { deleteMany: jest.fn() },
          orderEvent: { create: jest.fn() },
        };
        return fn(tx);
      });

      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      await service.createFromCart('user-1', undefined, 'test@example.com', {
        newAddress: mockAddress,
        carrierCode: CarrierCode.DHL,
      });

      const year = new Date().getFullYear();
      expect(generatedOrderNumber).toBe(`ORD-${year}-000001`);
    });
  });
});
