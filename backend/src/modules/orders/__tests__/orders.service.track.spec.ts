import { Test } from '@nestjs/testing';
import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { OrdersService } from '../orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CartService } from '../../cart/cart.service';
import { PaymentsService } from '../../payments/payments.service';
import { EmailQueueService } from '../../email/email-queue.service';
import { CouponService } from '../../coupons/coupon.service';
import { ConfigService } from '@nestjs/config';
import { InvoiceService } from '../../invoice/invoice.service';
import { ShippingRatesService } from '../../shipping/shipping-rates.service';
import { ProductsService } from '../../products/products.service';

const mockPrisma = {
  $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
  order: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  del: jest.fn(),
};

describe('OrdersService.trackByEmailAndNumber', () => {
  let service: OrdersService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService,         useValue: mockPrisma },
        { provide: CartService,           useValue: {} },
        { provide: PaymentsService,       useValue: {} },
        { provide: EmailQueueService,     useValue: {} },
        { provide: CouponService,         useValue: {} },
        { provide: ConfigService,         useValue: { get: jest.fn() } },
        { provide: InvoiceService,        useValue: {} },
        { provide: ShippingRatesService,  useValue: {} },
        { provide: ProductsService,       useValue: { notifyStockChangesByDelta: jest.fn() } },
        { provide: 'REDIS_CLIENT',        useValue: mockRedis },
      ],
    }).compile();

    service = module.get(OrdersService);

    jest.clearAllMocks();

    // Safe defaults: not locked out, first miss, all writes succeed
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.del.mockResolvedValue(1);
  });

  // ── Core behaviour ────────────────────────────────────────────────────────

  it('throws NotFoundException when no order matches email + orderNumber', async () => {
    mockPrisma.order.findFirst.mockResolvedValue(null);

    await expect(
      service.trackByEmailAndNumber('buyer@example.com', 'ORD-2026-000001'),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns only status, trackingNumber, carrier — omits items, prices, dates', async () => {
    mockPrisma.order.findFirst.mockResolvedValue({
      status: 'SHIPPED',
      shipment: { trackingNumber: 'TRK123', carrierCode: 'INPOST' },
    });

    const result = await service.trackByEmailAndNumber('buyer@example.com', 'ORD-2026-000001');

    expect(result).toEqual({
      status: 'SHIPPED',
      trackingNumber: 'TRK123',
      carrier: 'INPOST',
    });
    // Sensitive fields must be absent — verifies the GDPR Art. 5(1)(f) trim
    expect(result).not.toHaveProperty('items');
    expect(result).not.toHaveProperty('totalInCents');
    expect(result).not.toHaveProperty('createdAt');
    expect(result).not.toHaveProperty('orderNumber');
  });

  it('returns null trackingNumber and carrier when order has no shipment yet', async () => {
    mockPrisma.order.findFirst.mockResolvedValue({
      status: 'PAID',
      shipment: null,
    });

    const result = await service.trackByEmailAndNumber('buyer@example.com', 'ORD-2026-000042');

    expect(result).toEqual({
      status: 'PAID',
      trackingNumber: null,
      carrier: null,
    });
  });

  it('normalises orderNumber to uppercase and trims whitespace before querying', async () => {
    mockPrisma.order.findFirst.mockResolvedValue({
      status: 'PROCESSING',
      shipment: null,
    });

    await service.trackByEmailAndNumber(' buyer@example.com ', '  ord-2026-000001  ');

    expect(mockPrisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orderNumber: 'ORD-2026-000001',
        }),
      }),
    );
  });

  // ── Per-email lockout ─────────────────────────────────────────────────────

  it('throws 429 when the email is locked out and skips the DB query', async () => {
    mockRedis.get.mockResolvedValue('1'); // locked

    await expect(
      service.trackByEmailAndNumber('attacker@example.com', 'ORD-2026-000001'),
    ).rejects.toThrow(HttpException);

    await expect(
      service.trackByEmailAndNumber('attacker@example.com', 'ORD-2026-000001'),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });

    // DB must never be touched when locked
    expect(mockPrisma.order.findFirst).not.toHaveBeenCalled();
  });

  it('increments fail counter on each miss and does not lock before 5 misses', async () => {
    mockPrisma.order.findFirst.mockResolvedValue(null);
    mockRedis.incr.mockResolvedValue(3); // 3rd miss — not yet at threshold

    await expect(
      service.trackByEmailAndNumber('buyer@example.com', 'ORD-2026-WRONG'),
    ).rejects.toThrow(NotFoundException);

    expect(mockRedis.incr).toHaveBeenCalledWith(
      expect.stringContaining('track:fail:'),
    );
    // No lockout key set below threshold
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('sets 1h TTL on the fail key on the very first miss', async () => {
    mockPrisma.order.findFirst.mockResolvedValue(null);
    mockRedis.incr.mockResolvedValue(1); // first miss

    await expect(
      service.trackByEmailAndNumber('buyer@example.com', 'ORD-2026-WRONG'),
    ).rejects.toThrow(NotFoundException);

    expect(mockRedis.expire).toHaveBeenCalledWith(
      expect.stringContaining('track:fail:'),
      3600,
    );
  });

  it('does not set TTL again on the second miss', async () => {
    mockPrisma.order.findFirst.mockResolvedValue(null);
    mockRedis.incr.mockResolvedValue(2); // second miss

    await expect(
      service.trackByEmailAndNumber('buyer@example.com', 'ORD-2026-WRONG'),
    ).rejects.toThrow(NotFoundException);

    expect(mockRedis.expire).not.toHaveBeenCalled();
  });

  it('sets lockout key with 1h TTL after the 5th consecutive miss', async () => {
    mockPrisma.order.findFirst.mockResolvedValue(null);
    mockRedis.incr.mockResolvedValue(5); // 5th miss — triggers lockout

    await expect(
      service.trackByEmailAndNumber('buyer@example.com', 'ORD-2026-WRONG'),
    ).rejects.toThrow(NotFoundException);

    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining('track:lockout:buyer@example.com'),
      '1',
      'EX',
      3600,
    );
    expect(mockRedis.del).toHaveBeenCalledWith(
      expect.stringContaining('track:fail:'),
    );
  });

  it('resets the fail counter on a successful lookup', async () => {
    mockPrisma.order.findFirst.mockResolvedValue({
      status: 'PAID',
      shipment: null,
    });

    await service.trackByEmailAndNumber('buyer@example.com', 'ORD-2026-000042');

    expect(mockRedis.del).toHaveBeenCalledWith(
      expect.stringContaining('track:fail:buyer@example.com'),
    );
  });

  it('uses the lowercased email in lockout and fail key names for case-insensitive consistency', async () => {
    mockPrisma.order.findFirst.mockResolvedValue(null);

    await expect(
      service.trackByEmailAndNumber('BUYER@EXAMPLE.COM', 'ORD-2026-WRONG'),
    ).rejects.toThrow(NotFoundException);

    expect(mockRedis.get).toHaveBeenCalledWith(
      expect.stringContaining('buyer@example.com'),
    );
    expect(mockRedis.incr).toHaveBeenCalledWith(
      expect.stringContaining('buyer@example.com'),
    );
  });
});
