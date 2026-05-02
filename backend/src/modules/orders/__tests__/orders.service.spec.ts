import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CarrierCode, DiscountType, OrderStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { OrdersService } from '../orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CartService } from '../../cart/cart.service';
import { PaymentsService } from '../../payments/payments.service';
import { EmailService } from '../../email/email.service';
import { CouponService } from '../../coupons/coupon.service';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: any;
  let cartService: jest.Mocked<CartService>;
  let paymentsService: jest.Mocked<PaymentsService>;

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
            orderEvent: { create: jest.fn() },
            cart: { findFirst: jest.fn() },
            cartItem: { deleteMany: jest.fn() },
            productVariant: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
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
          },
        },
        {
          provide: EmailService,
          useValue: {
            sendOrderConfirmation: jest.fn().mockResolvedValue(undefined),
            sendOrderCancellation: jest.fn().mockResolvedValue(undefined),
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
      ],
    }).compile();

    service = module.get(OrdersService);
    prisma = module.get(PrismaService);
    cartService = module.get(CartService);
    paymentsService = module.get(PaymentsService);
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
            findUnique: jest.fn().mockResolvedValue({ stock: 100 }),
            update: jest.fn(),
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

    it('should decrement stock for each item during order creation', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);

      const stockUpdates: Array<{ id: string; decrement: number }> = [];
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          $executeRawUnsafe: jest.fn(),
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
          productVariant: {
            findUnique: jest.fn().mockResolvedValue({ stock: 100 }),
            update: jest.fn().mockImplementation((args: any) => {
              stockUpdates.push({
                id: args.where.id,
                decrement: args.data.stock.decrement,
              });
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

    it('should throw if stock is insufficient', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);

      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          $executeRawUnsafe: jest.fn(),
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
          productVariant: {
            findUnique: jest.fn().mockResolvedValue({ stock: 1 }), // only 1 in stock but need 2
            update: jest.fn(),
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
            findUnique: jest.fn().mockResolvedValue({ stock: 100 }),
            update: jest.fn(),
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

    it('should clear cart within the same transaction', async () => {
      cartService.getOrCreate.mockResolvedValue(mockCart as any);

      let cartCleared = false;
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          $executeRawUnsafe: jest.fn(),
          $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
          productVariant: {
            findUnique: jest.fn().mockResolvedValue({ stock: 100 }),
            update: jest.fn(),
          },
          order: { create: jest.fn().mockResolvedValue({ id: 'o-1', orderNumber: 'ORD-2026-000001' }) },
          cart: { findFirst: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
          cartItem: {
            deleteMany: jest.fn().mockImplementation(() => {
              cartCleared = true;
            }),
          },
          orderEvent: { create: jest.fn() },
        };
        return fn(tx);
      });

      paymentsService.initiatePayment.mockResolvedValue({ paymentUrl: 'https://mock/pay' });

      await service.createFromCart('user-1', undefined, 'test@example.com', {
        newAddress: mockAddress,
        carrierCode: CarrierCode.DHL,
      });

      expect(cartCleared).toBe(true);
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
            findUnique: jest.fn().mockResolvedValue({ stock: 100 }),
            update: jest.fn(),
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
            findUnique: jest.fn().mockResolvedValue({ stock: 100 }),
            update: jest.fn(),
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
            findUnique: jest.fn().mockResolvedValue({ stock: 100 }),
            update: jest.fn(),
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
    const buildTx = (overrides: { couponApply?: jest.Mock } = {}) => ({
      $executeRawUnsafe: jest.fn(),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
      productVariant: {
        findUnique: jest.fn().mockResolvedValue({ stock: 100 }),
        update: jest.fn(),
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
            findUnique: jest.fn().mockResolvedValue({ stock: 100 }),
            update: jest.fn(),
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

      // Verify it creates sequence if not exists
      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        `CREATE SEQUENCE IF NOT EXISTS order_number_seq_${year} START 1`,
      );

      // Verify it uses nextval from the sequence
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
            findUnique: jest.fn().mockResolvedValue({ stock: 100 }),
            update: jest.fn(),
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
