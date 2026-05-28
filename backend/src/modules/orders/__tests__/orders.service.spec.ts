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
          productVariant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
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
          productVariant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
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
          productVariant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
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
          productVariant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
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
          productVariant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
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
      const orders = [{ id: 'o-1' }, { id: 'o-2' }];
      prisma.order.findMany.mockResolvedValue(orders);
      prisma.order.count.mockResolvedValue(2);

      const result = await service.findAllForUser('user-1');

      expect(result.data).toEqual(orders);
      expect(result.meta.total).toBe(2);
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
    });
  });

  describe('findOneForUser', () => {
    it('returns the order when found', async () => {
      const order = { id: 'o-1', userId: 'user-1' };
      prisma.order.findFirst.mockResolvedValue(order);

      const result = await service.findOneForUser('o-1', 'user-1');

      expect(result).toEqual(order);
    });

    it('throws NotFoundException when order does not belong to user', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(service.findOneForUser('o-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
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
    it('updates the order status', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({ status: OrderStatus.PENDING_PAYMENT });
      prisma.$transaction.mockResolvedValue([{ id: 'o-1', status: OrderStatus.PROCESSING }, {}]);

      await service.updateStatus('o-1', OrderStatus.PROCESSING);

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'o-1' },
        data: { status: OrderStatus.PROCESSING },
      });
    });

    it('fires review-request email (fire-and-forget) when status becomes DELIVERED', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({ status: OrderStatus.PROCESSING });
      prisma.$transaction.mockResolvedValue([{}, {}]);
      // dispatchReviewRequestEmail calls order.findUnique — return null to exit early
      prisma.order.findUnique.mockResolvedValue(null);

      await service.updateStatus('o-1', OrderStatus.DELIVERED);
      await Promise.resolve(); // flush microtasks

      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: OrderStatus.DELIVERED } }),
      );
    });
  });

  describe('createFromCart (coupon branches)', () => {
    const buildTx = (_overrides: { couponApply?: jest.Mock } = {}) => ({
      $executeRawUnsafe: jest.fn(),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
      productVariant: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
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
        const tx = buildTx();
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

      // itemsTotal=114700, shipping=1999, discount=1000 → total=115699
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
        const tx = buildTx();
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
      prisma.order.findMany.mockResolvedValue([{ id: 'o-1' }]);
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
      prisma.order.findUniqueOrThrow.mockResolvedValue({ status: OrderStatus.PAID });
      prisma.$transaction.mockResolvedValue([{}, {}]);

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
      prisma.order.findUniqueOrThrow.mockResolvedValue({ status: OrderStatus.PAID });
      prisma.$transaction.mockResolvedValue([{}, {}]);

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
      prisma.order.findUniqueOrThrow.mockResolvedValue({ status: OrderStatus.PAID });
      prisma.$transaction.mockResolvedValue([{}, {}]);

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

    it('adds PAID orders to needsRefund list', async () => {
      const orders = [makeOrder('o-1', 'ORD-001', OrderStatus.PAID)];
      prisma.order.findMany.mockResolvedValue(orders);
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          productVariant: { update: jest.fn() },
          order: { update: jest.fn() },
          orderEvent: { create: jest.fn() },
        });
      });

      const result = await service.bulkCancel(['o-1']);

      expect(result.succeeded).toBe(1);
      expect(result.needsRefund).toContain('ORD-001');
    });

    it('adds PROCESSING orders to needsRefund list', async () => {
      const orders = [makeOrder('o-1', 'ORD-001', OrderStatus.PROCESSING)];
      prisma.order.findMany.mockResolvedValue(orders);
      prisma.$transaction.mockImplementation(async (fn: any) => {
        await fn({
          productVariant: { update: jest.fn() },
          order: { update: jest.fn() },
          orderEvent: { create: jest.fn() },
        });
      });

      const result = await service.bulkCancel(['o-1']);

      expect(result.needsRefund).toContain('ORD-001');
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
      expect(result.needsRefund).toHaveLength(0);
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
      expect(result.needsRefund).toHaveLength(0);
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

  describe('new_order_notification', () => {
    let svc: OrdersService;
    let emailService: any;
    let configGetMock: jest.Mock;

    const buildTx = () => ({
      $executeRawUnsafe: jest.fn(),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
      productVariant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      order: { create: jest.fn().mockResolvedValue({ id: 'o-1', orderNumber: 'ORD-2026-000001' }) },
      cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
      cartItem: { deleteMany: jest.fn() },
      orderEvent: { create: jest.fn() },
    });

    const DHL_DTO = { newAddress: mockAddress, carrierCode: CarrierCode.DHL };

    beforeEach(async () => {
      configGetMock = jest.fn().mockReturnValue(undefined);

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
            },
          },
          { provide: ConfigService, useValue: { get: configGetMock, getOrThrow: jest.fn() } },
          { provide: InvoiceService, useValue: { processInvoice: jest.fn() } },
        ],
      }).compile();

      svc = module.get(OrdersService);
      emailService = module.get(EmailQueueService);
    });

    it('sends notification to ADMIN_ALERT_EMAIL when configured', async () => {
      configGetMock.mockImplementation((key: string) => {
        if (key === 'ADMIN_ALERT_EMAIL') return 'admin@store.com';
        return undefined;
      });

      await svc.createFromCart('user-1', undefined, 'customer@example.com', DHL_DTO);
      await Promise.resolve();

      expect(emailService.sendNewOrderNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'admin@store.com',
          customerEmail: 'customer@example.com',
          orderNumber: 'ORD-2026-000001',
          carrierCode: CarrierCode.DHL,
        }),
      );
    });

    it('falls back to EMAIL_FROM when ADMIN_ALERT_EMAIL is absent', async () => {
      configGetMock.mockImplementation((key: string) => {
        if (key === 'EMAIL_FROM') return 'noreply@store.com';
        return undefined;
      });

      await svc.createFromCart('user-1', undefined, 'customer@example.com', DHL_DTO);
      await Promise.resolve();

      expect(emailService.sendNewOrderNotification).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'noreply@store.com' }),
      );
    });

    it('skips notification when neither ADMIN_ALERT_EMAIL nor EMAIL_FROM is configured', async () => {
      // configGetMock already returns undefined for all keys
      await svc.createFromCart('user-1', undefined, 'customer@example.com', DHL_DTO);
      await Promise.resolve();

      expect(emailService.sendNewOrderNotification).not.toHaveBeenCalled();
    });

    it('does not propagate notification queue failure to the caller', async () => {
      configGetMock.mockImplementation((key: string) => {
        if (key === 'ADMIN_ALERT_EMAIL') return 'admin@store.com';
        return undefined;
      });
      emailService.sendNewOrderNotification.mockRejectedValue(new Error('Redis down'));

      await expect(
        svc.createFromCart('user-1', undefined, 'customer@example.com', DHL_DTO),
      ).resolves.toMatchObject({ orderId: 'o-1', orderNumber: 'ORD-2026-000001' });
    });

    it('includes correct items and total in the notification payload', async () => {
      configGetMock.mockImplementation((key: string) => {
        if (key === 'ADMIN_ALERT_EMAIL') return 'admin@store.com';
        return undefined;
      });

      await svc.createFromCart('user-1', undefined, 'customer@example.com', DHL_DTO);
      await Promise.resolve();

      // itemsTotal=114700 + DHL shipping=1999 = 116699
      expect(emailService.sendNewOrderNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          totalInCents: 116699,
          items: [
            { name: 'Dior Sauvage – 100ml', quantity: 2, price: 34900 },
            { name: 'Chanel No 5 – 50ml', quantity: 1, price: 44900 },
          ],
        }),
      );
    });

    it('includes adminUrl when FRONTEND_URL is set', async () => {
      configGetMock.mockImplementation((key: string, defaultVal?: string) => {
        if (key === 'ADMIN_ALERT_EMAIL') return 'admin@store.com';
        if (key === 'FRONTEND_URL') return 'https://store.example.com';
        return defaultVal;
      });

      await svc.createFromCart('user-1', undefined, 'customer@example.com', DHL_DTO);
      await Promise.resolve();

      expect(emailService.sendNewOrderNotification).toHaveBeenCalledWith(
        expect.objectContaining({ adminUrl: 'https://store.example.com/admin/orders/o-1' }),
      );
    });

    it('omits adminUrl when FRONTEND_URL is not set', async () => {
      configGetMock.mockImplementation((key: string, defaultVal?: string) => {
        if (key === 'ADMIN_ALERT_EMAIL') return 'admin@store.com';
        return defaultVal; // 'FRONTEND_URL' gets its '' default, which is falsy
      });

      await svc.createFromCart('user-1', undefined, 'customer@example.com', DHL_DTO);
      await Promise.resolve();

      expect(emailService.sendNewOrderNotification).toHaveBeenCalledWith(
        expect.objectContaining({ adminUrl: undefined }),
      );
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
