import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { PaymentsService } from '../payments/payments.service';
import { EmailQueueService } from '../email/email-queue.service';
import { CouponService } from '../coupons/coupon.service';
import { CarrierCode, DiscountType, OrderStatus, Prisma, ReturnStatus } from '@prisma/client';
import { InvoiceService } from '../invoice/invoice.service';
import { ShippingRatesService } from '../shipping/shipping-rates.service';
import { generateOrderToken, verifyOrderToken } from '../../common/utils/order-token.util';
import { getStripeMinimumChargeInCents } from '../payments/stripe-minimum-charge.util';
import type IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';


interface CartItem {
  productVariantId: string;
  quantity: number;
  productName: string;
  variantLabel: string;
  priceInCents: number;
  vatRate: number;
  sku: string;
  stock: number;
  imageUrl?: string | null;
  slug: string;
}

const CARRIER_DISPLAY_NAMES: Record<CarrierCode, string> = {
  [CarrierCode.INPOST]:      'InPost',
  [CarrierCode.DHL]:         'DHL Express',
  [CarrierCode.GLS]:         'GLS',
  [CarrierCode.DPD]:         'DPD Pickup',
  [CarrierCode.DPD_COURIER]: 'DPD Kurier',
};

// Explicit state-machine allowlist. Any transition not listed here is invalid.
// Terminal states (CANCELLED, REFUNDED) have empty arrays — no exit.
const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING_PAYMENT]:    [OrderStatus.PAID, OrderStatus.CANCELLED, OrderStatus.FRAUD_REVIEW],
  [OrderStatus.FRAUD_REVIEW]:       [OrderStatus.PAID, OrderStatus.REFUNDED, OrderStatus.CANCELLED],
  [OrderStatus.PAID]:               [OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.CANCELLED, OrderStatus.REFUNDED, OrderStatus.PARTIALLY_REFUNDED],
  [OrderStatus.PROCESSING]:         [OrderStatus.SHIPPED, OrderStatus.CANCELLED, OrderStatus.REFUNDED, OrderStatus.PARTIALLY_REFUNDED],
  [OrderStatus.SHIPPED]:            [OrderStatus.DELIVERED, OrderStatus.REFUNDED, OrderStatus.PARTIALLY_REFUNDED],
  [OrderStatus.DELIVERED]:          [OrderStatus.REFUNDED, OrderStatus.PARTIALLY_REFUNDED],
  [OrderStatus.PARTIALLY_REFUNDED]: [OrderStatus.REFUNDED],
  [OrderStatus.CANCELLED]:          [],
  [OrderStatus.REFUNDED]:           [],
  [OrderStatus.DISPUTE_HOLD]:       [OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED],
  // Admin must explicitly confirm the goods were never delivered (→ CANCELLED, restores
  // stock) or that the chargeback stands with goods kept by the customer (→ REFUNDED).
  [OrderStatus.DISPUTE_LOST_REVIEW]: [OrderStatus.CANCELLED, OrderStatus.REFUNDED],
};

@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
    private readonly paymentsService: PaymentsService,
    private readonly emailService: EmailQueueService,
    private readonly couponService: CouponService,
    private readonly configService: ConfigService,
    private readonly invoiceService: InvoiceService,
    private readonly shippingRatesService: ShippingRatesService,
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
  ) {}

  // year is server-derived (Date.now()), never attacker input — this guards
  // against a future change threading a stored/client-influenced date into
  // this DDL/raw-SQL path, mirroring InvoiceService.ensureSequence.
  private assertValidOrderSequenceYear(year: number): void {
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      throw new Error(`Invalid order sequence year: ${year}`);
    }
  }

  async onModuleInit(): Promise<void> {
    const maxAttempts = 6;
    const baseDelayMs = 3_000;
    const year = new Date().getFullYear();
    this.assertValidOrderSequenceYear(year);
    this.assertValidOrderSequenceYear(year + 1);
    // CREATE SEQUENCE IF NOT EXISTS is idempotent — concurrent pod startups
    // are safe without an advisory lock. pg_advisory_xact_lock is ineffective
    // here because DATABASE_URL goes through pgbouncer in transaction mode,
    // which may route statements within the same $transaction to different
    // physical connections, defeating the lock entirely.
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.prisma.$executeRawUnsafe(
          `CREATE SEQUENCE IF NOT EXISTS order_number_seq_${year} START 1`,
        );
        await this.prisma.$executeRawUnsafe(
          `CREATE SEQUENCE IF NOT EXISTS order_number_seq_${year + 1} START 1`,
        );
        this.logger.log('Order number sequences ensured');
        return;
      } catch (err) {
        if (attempt === maxAttempts) {
          this.logger.error('Failed to create order number sequences after all retries — giving up');
          throw err;
        }
        const delay = baseDelayMs * 2 ** (attempt - 1); // 3s, 6s, 12s, 24s, 48s
        this.logger.warn(
          `Sequence DDL failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms…`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async createFromCart(
    userId: string | undefined,
    sessionId: string | undefined,
    userEmail: string,
    dto: {
      addressId?: string;
      newAddress?: {
        firstName: string;
        lastName: string;
        company?: string;
        street: string;
        city: string;
        postalCode: string;
        country?: string;
        phone: string;
      };
      carrierCode: CarrierCode;
      inpostLockerCode?: string;
      dpdPickupPointCode?: string;
      notes?: string;
      termsVersion?: string;
      termsAcceptedAt?: string;
      nip?: string;
      couponCode?: string;
      idempotencyKey?: string;
    },
  ) {
    // Idempotency guard: if the same checkout request already created an order,
    // return the existing result instead of creating a duplicate.
    if (dto.idempotencyKey) {
      const existing = await this.prisma.order.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existing) {
        if (existing.status === OrderStatus.PENDING_PAYMENT) {
          const { paymentUrl } = await this.paymentsService.initiatePayment(existing.id);
          return { orderId: existing.id, orderNumber: existing.orderNumber, paymentUrl };
        }
        throw new ConflictException('Order already placed for this checkout session');
      }
    }

    // Distributed lock: prevents two concurrent requests (double-click, two tabs, network retry)
    // from both reading the same cart and creating duplicate orders / double-charges.
    // Key is per-user (authenticated) or per-session (guest). TTL 30 s covers the full
    // checkout flow including the Stripe API call; lock is released early in the finally block.
    const lockKey = `checkout-lock:${userId ?? sessionId}`;
    const lockToken = randomUUID();
    const acquired = await this.redis.set(lockKey, lockToken, 'EX', 30, 'NX');
    if (!acquired) {
      throw new HttpException('Checkout already in progress — please wait a moment before trying again', HttpStatus.TOO_MANY_REQUESTS);
    }

    try {

    let cart = await this.cartService.getOrCreate(userId, sessionId);
    // Fallback: if userId cart is empty, check sessionId cart (items added before merge)
    if (!cart.items.length && userId && sessionId) {
      const sessionCart = await this.cartService.getOrCreate(undefined, sessionId);
      if (sessionCart.items.length) cart = sessionCart;
    }
    if (!cart.items.length) throw new BadRequestException('Cart is empty');

    if (dto.carrierCode === CarrierCode.INPOST && !dto.inpostLockerCode) {
      throw new BadRequestException('InPost locker code is required');
    }
    if (dto.carrierCode === CarrierCode.DPD && !dto.dpdPickupPointCode) {
      throw new BadRequestException('DPD pickup point code is required');
    }

    let address: {
      firstName: string;
      lastName: string;
      company?: string | null;
      street: string;
      city: string;
      postalCode: string;
      country: string;
      phone: string;
    } | null = null;

    if (dto.addressId && !userId) {
      throw new BadRequestException('Guests must supply a new address');
    }

    if (dto.addressId) {
      address = await this.prisma.address.findFirst({
        where: { id: dto.addressId, userId },
      });
      if (!address) throw new NotFoundException('Address not found');
      if (address.country !== 'PL') {
        throw new BadRequestException(
          'Shipping is only available to Poland (PL) — UN 1266 dangerous goods restriction.',
        );
      }
    } else if (dto.newAddress) {
      address = { country: 'PL', ...dto.newAddress };
    } else {
      throw new BadRequestException('Address is required');
    }

    const itemsTotalInCents = cart.totalInCents;

    // Validate coupon before the transaction so the user gets an early error.
    // The actual discount amount is recomputed inside the transaction against
    // fresh prices to prevent race conditions.
    let resolvedCouponId: string | null = null;
    const resolvedCouponCode = dto.couponCode ? dto.couponCode.trim().toUpperCase() : null;

    if (resolvedCouponCode) {
      const variantIds = cart.items.map((i: CartItem) => i.productVariantId);
      const couponResult = await this.couponService.validate(
        resolvedCouponCode,
        itemsTotalInCents,
        userId,
        variantIds,
      );
      if (!couponResult.valid) {
        throw new BadRequestException(couponResult.message ?? 'Nieprawidłowy kod rabatowy.');
      }
      resolvedCouponId = couponResult.couponId!;
    }

    // Resolve NIP: DTO value takes priority, else fall back to user's stored NIP
    let snapshotNip: string | null = dto.nip ?? null;
    if (!snapshotNip && userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { nip: true } });
      snapshotNip = user?.nip ?? null;
    }

    // Use the transaction for everything: stock decrement, order creation, cart clearing
    const order = await this.prisma.$transaction(async (tx) => {
      // Generate order number using raw SQL to avoid race conditions
      const orderNumber = await this.generateOrderNumber(tx);

      // Reject checkout if any variant or its parent product was deactivated
      // after the cart was populated. product.isActive catches compliance-driven
      // removals (e.g. CPNP pull) that don't individually deactivate every variant.
      const variantIds = cart.items.map((i: CartItem) => i.productVariantId);
      const activeVariants = await tx.productVariant.findMany({
        where: { id: { in: variantIds }, isActive: true, product: { isActive: true } },
        select: { id: true },
      });
      if (activeVariants.length !== variantIds.length) {
        throw new BadRequestException('One or more items in your cart are no longer available');
      }

      // Atomically check and decrement stock in a single UPDATE statement.
      // A separate findUnique + update would be a TOCTOU race: two concurrent
      // transactions can both read stock=1, both pass the check, both decrement
      // → stock goes to -1. updateMany with WHERE stock >= quantity closes that gap.
      for (const item of cart.items) {
        const result = await tx.productVariant.updateMany({
          where: { id: item.productVariantId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (result.count === 0) {
          throw new BadRequestException(
            `Insufficient stock for: ${item.productName} ${item.variantLabel}`,
          );
        }
      }

      // Re-fetch prices from the rows we just locked so snapshotPrice and all totals
      // reflect the price that was authoritative at commit time, not the stale cart read.
      const freshVariants = await tx.productVariant.findMany({
        where: { id: { in: cart.items.map((i: CartItem) => i.productVariantId) } },
        select: { id: true, priceInCents: true },
      });
      const freshPriceMap = new Map(freshVariants.map((v) => [v.id, v.priceInCents]));

      const txItemsTotalInCents = cart.items.reduce((sum: number, item: CartItem) => {
        return sum + (freshPriceMap.get(item.productVariantId) ?? item.priceInCents) * item.quantity;
      }, 0);

      // Fetch shipping rate inside the transaction so it is consistent with the
      // price snapshot and stock decrement committed in the same atomic unit.
      // Outside the transaction a Redis cache update between the fetch and the
      // DB write could produce a stale rate in the Stripe session total.
      const shippingCostInCents = await this.shippingRatesService.getRateForCarrier(dto.carrierCode);

      // Recompute coupon discount against the fresh items total
      let txDiscountInCents = 0;
      if (resolvedCouponId) {
        const coupon = await tx.coupon.findUnique({ where: { id: resolvedCouponId } });
        if (coupon) {
          if (coupon.minSpendInCents !== null && txItemsTotalInCents < coupon.minSpendInCents) {
            throw new BadRequestException(
              'Cena produktów zmieniła się — kod rabatowy nie jest już ważny dla tej wartości koszyka.',
            );
          }
          txDiscountInCents =
            coupon.discountType === DiscountType.FREE_SHIPPING
              ? shippingCostInCents
              : this.couponService.calculateDiscount(coupon.discountType, coupon.value, txItemsTotalInCents);
        }
      }

      const txTotalInCents = Math.max(0, txItemsTotalInCents + shippingCostInCents - txDiscountInCents);

      const stripeCurrency = this.configService.get<string>('STRIPE_CURRENCY', 'pln');
      const minimumChargeInCents = getStripeMinimumChargeInCents(stripeCurrency);
      if (txTotalInCents > 0 && txTotalInCents < minimumChargeInCents) {
        const minimumLabel = stripeCurrency.toLowerCase() === 'pln'
          ? `${(minimumChargeInCents / 100).toFixed(2).replace('.', ',')} zł`
          : `${(minimumChargeInCents / 100).toFixed(2)} ${stripeCurrency.toUpperCase()}`;
        throw new BadRequestException(
          `Kwota zamówienia jest zbyt niska (minimum ${minimumLabel} po rabacie).`,
        );
      }

      // Create order with address snapshot
      const newOrder = await tx.order.create({
        data: {
          orderNumber,
          ...(dto.idempotencyKey && { idempotencyKey: dto.idempotencyKey }),
          ...(userId && { userId }),
          status: OrderStatus.PENDING_PAYMENT,
          ...(dto.addressId && { addressId: dto.addressId }),
          snapshotFirstName: address!.firstName,
          snapshotLastName: address!.lastName,
          snapshotCompany: address!.company,
          snapshotStreet: address!.street,
          snapshotCity: address!.city,
          snapshotPostalCode: address!.postalCode,
          snapshotCountry: address!.country,
          snapshotPhone: address!.phone,
          snapshotEmail: userEmail,
          snapshotNip,
          carrierCode: dto.carrierCode,
          inpostLockerCode: dto.inpostLockerCode,
          dpdPickupPointCode: dto.dpdPickupPointCode,
          itemsTotalInCents: txItemsTotalInCents,
          shippingCostInCents,
          discountInCents: txDiscountInCents,
          totalInCents: txTotalInCents,
          ...(resolvedCouponId && { couponId: resolvedCouponId }),
          ...(resolvedCouponCode && { couponCode: resolvedCouponCode }),
          notes: dto.notes,
          termsVersion: dto.termsVersion,
          termsAcceptedAt: dto.termsAcceptedAt ? new Date(dto.termsAcceptedAt) : undefined,
          retentionExpiresAt: (() => {
            // Ustawa o rachunkowości Art. 74: retain financial records for 5 years
            // from year-end after the fiscal year closes. Order created in year Y
            // must be kept until Dec 31 of year Y+5.
            const y = new Date().getFullYear();
            return new Date(Date.UTC(y + 5, 11, 31, 23, 59, 59, 999));
          })(),
          items: {
            create: cart.items.map((item: CartItem) => ({
              productVariantId: item.productVariantId,
              snapshotName: `${item.productName} – ${item.variantLabel}`,
              snapshotSku: item.sku,
              snapshotPrice: freshPriceMap.get(item.productVariantId) ?? item.priceInCents,
              snapshotVatRate: item.vatRate,
              quantity: item.quantity,
            })),
          },
        },
      });

      // Record coupon usage inside the transaction (TOCTOU-safe)
      if (resolvedCouponId) {
        await this.couponService.applyInsideTransaction(
          tx,
          resolvedCouponId,
          newOrder.id,
          userId,
          txDiscountInCents,
        );
      }

      await tx.orderEvent.create({
        data: {
          orderId: newOrder.id,
          fromStatus: null,
          toStatus: OrderStatus.PENDING_PAYMENT,
          actor: userId ?? 'CUSTOMER',
          note: 'Order created from cart',
        },
      });

      return newOrder;
    });

    // Initiate Stripe Checkout Session outside the transaction (external API call).
    // If Stripe throws, the committed order is cancelled and stock + coupon are restored
    // atomically so the customer's cart remains intact and they can retry immediately.
    let paymentUrl: string;
    try {
      ({ paymentUrl } = await this.paymentsService.initiatePayment(order.id));
    } catch (stripeErr) {
      this.logger.error(
        `Payment initiation failed for order ${order.orderNumber}: ${(stripeErr as Error).message} — rolling back`,
      );
      await this.prisma.$transaction(async (tx) => {
        for (const item of cart.items) {
          await tx.productVariant.update({
            where: { id: item.productVariantId },
            data: { stock: { increment: item.quantity } },
          });
        }
        await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.CANCELLED } });
        if (resolvedCouponId) {
          await tx.$executeRaw`
            UPDATE coupons SET current_uses = GREATEST(current_uses - 1, 0)
            WHERE id = ${resolvedCouponId}::uuid
          `;
          await tx.couponUse.deleteMany({ where: { orderId: order.id } });
        }
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            fromStatus: OrderStatus.PENDING_PAYMENT,
            toStatus: OrderStatus.CANCELLED,
            actor: 'SYSTEM',
            note: `Payment initiation failed: ${(stripeErr as Error).message}`,
          },
        });
      });
      throw stripeErr;
    }

    // Clear cart only after the Stripe session is confirmed — if Stripe had thrown above,
    // the cart is still intact and the customer can retry.
    const cartRecord = await this.prisma.cart.findFirst({
      where: userId ? { userId } : { sessionId },
    });
    if (cartRecord) {
      await this.prisma.cartItem.deleteMany({ where: { cartId: cartRecord.id } });
    }

    // UoK Art. 21: contract formation occurs at order creation, not at payment capture.
    // Send the order-acknowledged email immediately so the customer always has a
    // durable confirmation on a durable medium, even if they close the browser before paying.
    // The payment-confirmed + invoice email is still sent from markSessionPaid() as the second email.
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', '');
    const cancelSecret = this.configService.get<string>('ORDER_CANCEL_SECRET', '');
    const cancelToken = generateOrderToken(order.id, order.snapshotEmail, cancelSecret);
    const cancelUrl = `${frontendUrl}/orders/${order.id}/cancel?token=${cancelToken}`;
    this.emailService
      .sendOrderAcknowledgement({
        to: order.snapshotEmail,
        orderNumber: order.orderNumber,
        firstName: order.snapshotFirstName,
        items: cart.items.map((i: CartItem) => ({
          name: `${i.productName} – ${i.variantLabel}`,
          quantity: i.quantity,
          price: i.priceInCents,
        })),
        totalInCents: order.totalInCents,
        paymentUrl,
        cancelUrl,
      })
      .catch((err) => this.logger.warn('Order acknowledged email failed', err));

    // Stock alert (fire-and-forget): check post-decrement levels for all ordered variants
    this.sendStockAlertIfNeeded(
      order.orderNumber,
      cart.items.map((i: CartItem) => i.productVariantId),
    ).catch((err) => this.logger.warn('sendStockAlertIfNeeded failed', err));

    return { orderId: order.id, orderNumber: order.orderNumber, paymentUrl };

    } finally {
      // Release the lock only if we still own it (Lua script is atomic).
      await this.redis.eval(
        `if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end`,
        1,
        lockKey,
        lockToken,
      );
    }
  }

  async findAllForUser(userId: string, query: { page?: number; limit?: number } = {}) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 50);
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId },
        include: { items: true, payment: true, shipment: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.order.count({ where: { userId } }),
    ]);

    return {
      data: orders.map((o) => this.mapOrder(o)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOneForUser(id: string, userId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, userId },
      include: { items: true, payment: true, shipment: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return this.mapOrder(order);
  }

  async findEventsForUser(orderId: string, userId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const events = await this.prisma.orderEvent.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        actor: true,
        createdAt: true,
      },
    });

    return events.map((e) => ({
      id: e.id,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actor: this.mapActorForCustomer(e.actor),
      createdAt: e.createdAt,
    }));
  }

  async findEventsAdmin(orderId: string) {
    return this.prisma.orderEvent.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        actor: true,
        note: true,
        createdAt: true,
      },
    });
  }

  private mapActorForCustomer(actor: string): string {
    if (actor === 'ADMIN') return 'Obsługa sklepu';
    if (actor.startsWith('SYSTEM')) return 'System';
    return 'Klient';
  }

  async generateInvoiceForUser(orderId: string, userId: string): Promise<{ invoiceUrl: string }> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return this.generateInvoice(orderId);
  }

  async generateInvoice(orderId: string): Promise<{ invoiceUrl: string }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        invoiceStoragePath: true,
        snapshotFirstName: true,
        snapshotLastName: true,
        snapshotCompany: true,
        snapshotNip: true,
        snapshotStreet: true,
        snapshotCity: true,
        snapshotPostalCode: true,
        itemsTotalInCents: true,
        shippingCostInCents: true,
        discountInCents: true,
        couponCode: true,
        totalInCents: true,
        createdAt: true,
        items: {
          select: { snapshotName: true, snapshotPrice: true, snapshotVatRate: true, quantity: true },
        },
      },
    });

    if (!order) throw new NotFoundException('Order not found');

    const nonInvoiceable: OrderStatus[] = [
      OrderStatus.PENDING_PAYMENT,
      OrderStatus.CANCELLED,
      OrderStatus.FRAUD_REVIEW,
      OrderStatus.DISPUTE_HOLD,
    ];
    if (nonInvoiceable.includes(order.status)) {
      throw new BadRequestException(
        `Cannot generate invoice for an order with status ${order.status}`,
      );
    }

    // Re-sign with 1h TTL on every request — path is stable across key rotations
    if (order.invoiceStoragePath) {
      const invoiceUrl = await this.invoiceService.getSignedUrl(order.invoiceStoragePath);
      return { invoiceUrl };
    }

    const { storagePath } = await this.invoiceService.processInvoice(order);
    const invoiceUrl = await this.invoiceService.getSignedUrl(storagePath);
    return { invoiceUrl };
  }

  async trackByEmailAndNumber(email: string, orderNumber: string) {
    const normalizedEmail = email.trim().toLowerCase();

    // Per-email lockout: block enumeration after 5 missed attempts (GDPR Art. 5(1)(f)).
    // Lockout key lives for 1h; checked before the DB query to prevent any enumeration.
    const lockoutKey = `track:lockout:${normalizedEmail}`;
    if (await this.redis.get(lockoutKey)) {
      throw new HttpException(
        'Too many failed attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const order = await this.prisma.order.findFirst({
      where: {
        orderNumber: orderNumber.trim().toUpperCase(),
        snapshotEmail: { equals: normalizedEmail, mode: 'insensitive' },
      },
      select: {
        status: true,
        shipment: { select: { trackingNumber: true, carrierCode: true } },
      },
    });

    if (!order) {
      const failKey = `track:fail:${normalizedEmail}`;
      const fails = await this.redis.incr(failKey);
      if (fails === 1) await this.redis.expire(failKey, 3600);
      if (fails >= 5) {
        await this.redis.set(lockoutKey, '1', 'EX', 3600);
        await this.redis.del(failKey);
      }
      throw new NotFoundException('Order not found');
    }

    // Reset failure counter on a successful lookup
    await this.redis.del(`track:fail:${normalizedEmail}`);

    // Unauthenticated endpoint — return status and tracking only.
    // Omitting items/prices/dates prevents enumeration of purchase history
    // via sequential order numbers (GDPR Art. 5(1)(f)).
    return {
      status: order.status,
      trackingNumber: order.shipment?.trackingNumber ?? null,
      carrier: order.shipment?.carrierCode ?? null,
    };
  }

  async getUnreadCount(): Promise<{ count: number }> {
    const count = await this.prisma.order.count({
      where: { status: OrderStatus.PAID, isRead: false },
    });
    return { count };
  }

  async findOneAdmin(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true, payment: true, shipment: true, user: { select: { email: true } } },
    });

    if (!order) throw new NotFoundException('Order not found');

    if (!order.isRead) {
      await this.prisma.order.update({ where: { id }, data: { isRead: true } });
    }

    return order;
  }

  async findAllAdmin(filter: { status?: OrderStatus; page?: number; limit?: number }) {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where = filter.status ? { status: filter.status } : {};

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: { items: true, payment: true, shipment: true, user: { select: { email: true } } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders.map((o) => this.mapOrder(o)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async cancelByUser(orderId: string, userId: string, reason?: string): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REFUNDED) {
      throw new BadRequestException('This order has already been cancelled or refunded.');
    }

    if (order.status === OrderStatus.SHIPPED || order.status === OrderStatus.DELIVERED) {
      throw new BadRequestException(
        'Your order has already been shipped. Please contact us to arrange a return.',
      );
    }

    if (order.status === OrderStatus.FRAUD_REVIEW) {
      throw new ConflictException(
        'Twoje zamówienie jest weryfikowane — skontaktuj się z obsługą.',
      );
    }

    if (order.status === OrderStatus.PARTIALLY_REFUNDED) {
      throw new ConflictException(
        'This order has already been partially refunded. Use the returns flow for remaining items.',
      );
    }

    if (order.status === OrderStatus.DISPUTE_HOLD) {
      throw new ConflictException(
        'Twoje zamówienie jest aktualnie w trakcie sporu płatniczego — skontaktuj się z obsługą.',
      );
    }

    const isRefund = ([OrderStatus.PAID, OrderStatus.PROCESSING] as OrderStatus[]).includes(order.status);

    if (order.status === OrderStatus.PENDING_PAYMENT) {
      // No payment made — expire the Stripe session (best-effort) and cancel
      await this.paymentsService.expirePendingCheckoutSession(orderId);

      await this.prisma.$transaction(async (tx) => {
        for (const item of order.items) {
          await tx.productVariant.update({
            where: { id: item.productVariantId },
            data: { stock: { increment: item.quantity } },
          });
        }
        await tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.CANCELLED } });
        await tx.orderEvent.create({
          data: {
            orderId,
            fromStatus: OrderStatus.PENDING_PAYMENT,
            toStatus: OrderStatus.CANCELLED,
            actor: 'CUSTOMER',
            note: reason
              ? `Cancelled by customer before payment. Reason: ${reason}`
              : 'Cancelled by customer before payment',
          },
        });
      });
    } else {
      // PAID or PROCESSING — issue a full Stripe refund (handles stock + event)
      await this.paymentsService.refundPayment(orderId, 'CUSTOMER');
      if (reason) {
        await this.prisma.orderEvent.create({
          data: {
            orderId,
            fromStatus: OrderStatus.REFUNDED,
            toStatus: OrderStatus.REFUNDED,
            actor: 'CUSTOMER',
            note: `Withdrawal reason: ${reason}`,
          },
        });
      }
    }

    // Cancellation / withdrawal confirmation email (fire-and-forget)
    this.emailService
      .sendOrderCancellation({
        to: order.snapshotEmail,
        orderNumber: order.orderNumber,
        firstName: order.snapshotFirstName,
        totalInCents: order.totalInCents,
        isRefund,
      })
      .catch((err) => this.logger.warn('Order cancellation email failed', err));
  }

  async cancelByToken(orderId: string, token: string, reason?: string): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const secret = this.configService.get<string>('ORDER_CANCEL_SECRET', '');
    if (!verifyOrderToken(token, orderId, order.snapshotEmail, secret)) {
      throw new UnauthorizedException('Invalid cancel token');
    }

    // Only allow cancelling PENDING_PAYMENT orders via token — paid orders require
    // proper authentication since a refund triggers financial side-effects.
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException(
        'Token-based cancellation is only available for orders awaiting payment.',
      );
    }

    await this.paymentsService.expirePendingCheckoutSession(orderId);

    await this.prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        await tx.productVariant.update({
          where: { id: item.productVariantId },
          data: { stock: { increment: item.quantity } },
        });
      }
      await tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.CANCELLED } });
      await tx.orderEvent.create({
        data: {
          orderId,
          fromStatus: OrderStatus.PENDING_PAYMENT,
          toStatus: OrderStatus.CANCELLED,
          actor: 'CUSTOMER',
          note: reason
            ? `Cancelled by guest before payment. Reason: ${reason}`
            : 'Cancelled by guest before payment',
        },
      });
    });

    this.emailService
      .sendOrderCancellation({
        to: order.snapshotEmail,
        orderNumber: order.orderNumber,
        firstName: order.snapshotFirstName,
        totalInCents: order.totalInCents,
        isRefund: false,
      })
      .catch((err) => this.logger.warn('Order cancellation email failed', err));
  }

  async retryPayment(orderId: string, userId: string): Promise<{ paymentUrl: string }> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException(
        `Cannot retry payment for an order in status ${order.status}`,
      );
    }

    // Mirrors the rollback in createFromCart: if Stripe rejects the session
    // (e.g. a pre-fix order below the minimum chargeable amount), the order
    // must not stay PENDING_PAYMENT with stock decremented and no way out.
    try {
      return await this.paymentsService.initiatePayment(orderId);
    } catch (stripeErr) {
      this.logger.error(
        `Payment retry failed for order ${order.orderNumber}: ${(stripeErr as Error).message} — rolling back`,
      );
      await this.prisma.$transaction(async (tx) => {
        for (const item of order.items) {
          await tx.productVariant.update({
            where: { id: item.productVariantId },
            data: { stock: { increment: item.quantity } },
          });
        }
        await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.CANCELLED } });
        if (order.couponId) {
          await tx.$executeRaw`
            UPDATE coupons SET current_uses = GREATEST(current_uses - 1, 0)
            WHERE id = ${order.couponId}::uuid
          `;
          await tx.couponUse.deleteMany({ where: { orderId: order.id } });
        }
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            fromStatus: OrderStatus.PENDING_PAYMENT,
            toStatus: OrderStatus.CANCELLED,
            actor: 'SYSTEM',
            note: `Payment retry failed: ${(stripeErr as Error).message}`,
          },
        });
      });
      throw stripeErr;
    }
  }

  async cancelItemsByUser(
    orderId: string,
    userId: string,
    dto: { items: Array<{ orderItemId: string; quantity: number }> },
  ): Promise<void> {
    if (!dto.items.length) throw new BadRequestException('No items provided for cancellation');

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const cancellableStatuses: OrderStatus[] = [
      OrderStatus.PAID,
      OrderStatus.PROCESSING,
      OrderStatus.PARTIALLY_REFUNDED,
    ];
    if (!cancellableStatuses.includes(order.status)) {
      throw new BadRequestException(
        `Cannot partially cancel an order with status ${order.status}`,
      );
    }

    const resolvedItems: Array<{
      orderItemId: string;
      productVariantId: string;
      quantity: number;
      priceInCents: number;
      vatRate: number;
    }> = [];

    for (const line of dto.items) {
      const item = order.items.find(i => i.id === line.orderItemId);
      if (!item) throw new BadRequestException(`Item ${line.orderItemId} not found in this order`);

      const remaining = item.quantity - item.cancelledQuantity;
      if (line.quantity < 1 || line.quantity > remaining) {
        throw new BadRequestException(
          `Invalid quantity ${line.quantity} for "${item.snapshotName}" — remaining: ${remaining}`,
        );
      }

      resolvedItems.push({
        orderItemId: item.id,
        productVariantId: item.productVariantId,
        quantity: line.quantity,
        priceInCents: item.snapshotPrice,
        vatRate: item.snapshotVatRate,
      });
    }

    let isFreeShippingCoupon = false;
    if (order.couponId) {
      const coupon = await this.prisma.coupon.findUnique({
        where: { id: order.couponId },
        select: { discountType: true },
      });
      isFreeShippingCoupon = coupon?.discountType === DiscountType.FREE_SHIPPING;
    }

    // FREE_SHIPPING coupons store the shipping refund in discountInCents, not an
    // items-total discount — prorating it across item prices here would refund
    // less than the customer paid for the items themselves.
    if (!isFreeShippingCoupon && order.discountInCents > 0 && order.itemsTotalInCents > 0) {
      const discountFraction = order.discountInCents / order.itemsTotalInCents;
      for (const item of resolvedItems) {
        const orderItem = order.items.find(i => i.id === item.orderItemId)!;
        // Max discount this item can ever yield (based on all units)
        const maxItemDiscount = Math.round(orderItem.snapshotPrice * discountFraction * orderItem.quantity);
        // Discount already consumed by prior partial cancels, derived from cancelledQuantity
        // so we don't re-apply the fraction on subsequent partial cancels of the same item.
        const alreadyCancelledDiscount = Math.round(orderItem.snapshotPrice * discountFraction * orderItem.cancelledQuantity);
        const remainingItemDiscount = Math.max(0, maxItemDiscount - alreadyCancelledDiscount);
        // Proportional discount we'd ideally apply to the qty being cancelled now
        const wantedDiscount = Math.round(orderItem.snapshotPrice * discountFraction * item.quantity);
        const appliedDiscount = Math.min(wantedDiscount, remainingItemDiscount);
        // Floor to per-unit (sub-cent remainder is absorbed by the cap in partialRefund)
        item.priceInCents = item.priceInCents - Math.floor(appliedDiscount / item.quantity);
      }
    }

    const allCancelled = order.items.every((item) => {
      const remaining = item.quantity - item.cancelledQuantity;
      if (remaining === 0) return true;
      const cancelling = resolvedItems.find((r) => r.orderItemId === item.id);
      return cancelling ? cancelling.quantity >= remaining : false;
    });

    if (allCancelled) {
      // Full withdrawal — use refundPayment so the shipping cost is included
      // (partialRefund only sums item prices and misses shippingCostInCents)
      await this.paymentsService.refundPayment(orderId, 'CUSTOMER');
      this.emailService
        .sendOrderCancellation({
          to: order.snapshotEmail,
          orderNumber: order.orderNumber,
          firstName: order.snapshotFirstName,
          totalInCents: order.totalInCents,
          isRefund: true,
        })
        .catch((err) => this.logger.warn('Full-cancellation email failed', err));
      return;
    }

    await this.paymentsService.partialRefund(orderId, resolvedItems, order.status, 'CUSTOMER');

    const refundAmountInCents = resolvedItems.reduce((s, i) => s + i.quantity * i.priceInCents, 0);

    if (order.invoiceNumber) {
      this.invoiceService
        .processCorrectiveInvoice(
          orderId,
          order.invoiceNumber,
          refundAmountInCents,
          'PARTIAL_CANCELLATION',
          resolvedItems.map((i) => ({
            orderItemId: i.orderItemId,
            quantity: i.quantity,
            priceInCents: i.priceInCents,
            vatRate: i.vatRate,
          })),
        )
        .catch((err) => this.logger.warn('Corrective invoice generation failed', (err as Error).message));
    }

    this.emailService
      .sendOrderCancellation({
        to: order.snapshotEmail,
        orderNumber: order.orderNumber,
        firstName: order.snapshotFirstName,
        totalInCents: refundAmountInCents,
        isRefund: true,
      })
      .catch((err) => this.logger.warn('Partial refund cancellation email failed', err));
  }

  async getCorrectiveInvoiceForUser(orderId: string, userId: string): Promise<{ correctiveInvoiceUrl: string; correctiveInvoiceNumber: string }> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    const result = await this.invoiceService.getCorrectiveInvoiceUrl(orderId);
    if (!result) throw new NotFoundException('No corrective invoice found for this order');
    return result;
  }

  async getCorrectiveInvoiceAdmin(orderId: string): Promise<{ correctiveInvoiceUrl: string; correctiveInvoiceNumber: string }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    const result = await this.invoiceService.getCorrectiveInvoiceUrl(orderId);
    if (!result) throw new NotFoundException('No corrective invoice found for this order');
    return result;
  }

  async approveFraudReview(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    });
    if (order.status !== OrderStatus.FRAUD_REVIEW) {
      throw new BadRequestException(
        `Order is not in FRAUD_REVIEW status (current: ${order.status})`,
      );
    }
    await this.paymentsService.approveFraudReview(orderId, 'ADMIN');
  }

  async rejectFraudReview(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    });
    if (order.status !== OrderStatus.FRAUD_REVIEW) {
      throw new BadRequestException(
        `Order is not in FRAUD_REVIEW status (current: ${order.status})`,
      );
    }
    await this.paymentsService.refundPayment(orderId, 'ADMIN:fraud-reject');
  }

  async updateStatus(id: string, status: OrderStatus, actor = 'ADMIN') {
    const current = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      select: {
        status: true,
        items: { select: { productVariantId: true, quantity: true, cancelledQuantity: true } },
      },
    });

    if (current.status === status) return;

    if (current.status === OrderStatus.DISPUTE_HOLD && status === OrderStatus.CANCELLED) {
      throw new ConflictException(
        'Cannot manually cancel an order under dispute. Wait for the Stripe charge.dispute.closed webhook to resolve the dispute before taking action.',
      );
    }

    if (!ORDER_STATUS_TRANSITIONS[current.status].includes(status)) {
      throw new BadRequestException(
        `Invalid order status transition: ${current.status} → ${status}`,
      );
    }

    const stockRestoringStatuses: OrderStatus[] = [OrderStatus.CANCELLED, OrderStatus.REFUNDED];
    const stockAlreadyRestored: OrderStatus[] = [OrderStatus.CANCELLED, OrderStatus.REFUNDED];

    // From DISPUTE_LOST_REVIEW, REFUNDED means the admin confirmed the chargeback
    // stands (goods were delivered, not coming back) — restoring stock there would
    // recreate the exact oversell risk this review gate exists to prevent. Only
    // CANCELLED (admin confirms goods were never delivered/were returned) restores it.
    const isUnverifiedDisputeLossPayout =
      current.status === OrderStatus.DISPUTE_LOST_REVIEW && status === OrderStatus.REFUNDED;

    const shouldRestoreStock =
      stockRestoringStatuses.includes(status) &&
      !stockAlreadyRestored.includes(current.status) &&
      !isUnverifiedDisputeLossPayout;

    await this.prisma.$transaction(async (tx) => {
      if (shouldRestoreStock) {
        for (const item of current.items) {
          const activeQty = item.quantity - (item.cancelledQuantity ?? 0);
          if (activeQty > 0) {
            await tx.productVariant.update({
              where: { id: item.productVariantId },
              data: { stock: { increment: activeQty } },
            });
          }
        }
      }

      await tx.order.update({ where: { id }, data: { status } });
      await tx.orderEvent.create({
        data: { orderId: id, fromStatus: current.status, toStatus: status, actor },
      });

      if (status === OrderStatus.SHIPPED) {
        await tx.shipment.updateMany({
          where: { orderId: id, shippedAt: null },
          data: { shippedAt: new Date() },
        });
      }
    });

    if (status === OrderStatus.DELIVERED) {
      this.dispatchReviewRequestEmail(id).catch((err) => this.logger.warn('Review request email failed', err));
    }
  }

  async bulkMarkAsShipped(orderIds: string[]): Promise<{
    succeeded: number;
    failed: Array<{ orderNumber: string; reason: string }>;
  }> {
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds } },
      include: { shipment: true },
    });

    const succeeded: string[] = [];
    const failed: Array<{ orderNumber: string; reason: string }> = [];

    const nonShippableStatuses: OrderStatus[] = [
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
      OrderStatus.CANCELLED,
      OrderStatus.REFUNDED,
      OrderStatus.PENDING_PAYMENT,
    ];

    await Promise.all(
      orders.map(async (order) => {
        if (nonShippableStatuses.includes(order.status)) {
          failed.push({ orderNumber: order.orderNumber, reason: `Status ${order.status} nie pozwala na wysyłkę` });
          return;
        }

        try {
          await this.updateStatus(order.id, OrderStatus.SHIPPED, 'ADMIN');

          if (order.shipment?.trackingNumber) {
            this.emailService
              .sendShippingNotification({
                to: order.snapshotEmail,
                orderNumber: order.orderNumber,
                firstName: order.snapshotFirstName,
                carrier: CARRIER_DISPLAY_NAMES[order.carrierCode] ?? order.carrierCode,
                trackingNumber: order.shipment.trackingNumber,
              })
              .catch((err) => this.logger.warn('Bulk shipped shipping notification email failed', err));
          }

          succeeded.push(order.orderNumber);
        } catch (err) {
          failed.push({ orderNumber: order.orderNumber, reason: (err as Error).message });
        }
      }),
    );

    return { succeeded: succeeded.length, failed };
  }

  async bulkCancel(
    orderIds: string[],
    actor = 'ADMIN',
  ): Promise<{
    succeeded: number;
    failed: Array<{ orderNumber: string; reason: string }>;
  }> {
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds } },
      include: { items: true },
    });

    const succeeded: string[] = [];
    const failed: Array<{ orderNumber: string; reason: string }> = [];

    const nonCancellableStatuses: OrderStatus[] = [
      OrderStatus.CANCELLED,
      OrderStatus.REFUNDED,
      OrderStatus.PARTIALLY_REFUNDED,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
    ];

    await Promise.all(
      orders.map(async (order) => {
        if (nonCancellableStatuses.includes(order.status)) {
          failed.push({ orderNumber: order.orderNumber, reason: `Status ${order.status} nie pozwala na anulowanie` });
          return;
        }

        const isRefund = order.status === OrderStatus.PAID || order.status === OrderStatus.PROCESSING;

        try {
          if (isRefund) {
            // Payment already captured — issue a full Stripe refund.
            // refundPayment handles stock restore, order status → REFUNDED, and event atomically.
            await this.paymentsService.refundPayment(order.id, actor);
          } else {
            // PENDING_PAYMENT: no payment taken, cancel in-place.
            await this.prisma.$transaction(async (tx) => {
              for (const item of order.items) {
                const activeQty = item.quantity - (item.cancelledQuantity ?? 0);
                if (activeQty > 0) {
                  await tx.productVariant.update({
                    where: { id: item.productVariantId },
                    data: { stock: { increment: activeQty } },
                  });
                }
              }
              await tx.order.update({
                where: { id: order.id },
                data: { status: OrderStatus.CANCELLED },
              });
              await tx.orderEvent.create({
                data: {
                  orderId: order.id,
                  fromStatus: order.status,
                  toStatus: OrderStatus.CANCELLED,
                  actor,
                  note: 'Bulk cancelled by admin',
                },
              });
            });
          }

          this.emailService
            .sendOrderCancellation({
              to: order.snapshotEmail,
              orderNumber: order.orderNumber,
              firstName: order.snapshotFirstName,
              totalInCents: order.totalInCents,
              isRefund,
            })
            .catch((err) => this.logger.warn('Bulk cancel order cancellation email failed', err));

          succeeded.push(order.orderNumber);
        } catch (err) {
          failed.push({ orderNumber: order.orderNumber, reason: (err as Error).message });
        }
      }),
    );

    return { succeeded: succeeded.length, failed };
  }

  private async dispatchReviewRequestEmail(orderId: string): Promise<void> {
    // Skip if the customer has an active return/withdrawal on this order.
    // Only REJECTED returns are excluded — pending, approved, and completed
    // returns all indicate the customer is in a return flow.
    const returnCount = await this.prisma.returnRequest.count({
      where: { orderId, status: { not: ReturnStatus.REJECTED } },
    });
    if (returnCount > 0) return;

    // Atomic idempotency guard: compare-and-set reviewRequestSentAt.
    // Only the first caller wins; replayed DELIVERED webhooks are silently skipped.
    const stamped = await this.prisma.order.updateMany({
      where: { id: orderId, reviewRequestSentAt: null },
      data: { reviewRequestSentAt: new Date() },
    });
    if (stamped.count === 0) return;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true,
        snapshotEmail: true,
        snapshotFirstName: true,
        items: {
          include: {
            productVariant: {
              include: {
                product: {
                  select: {
                    name: true,
                    slug: true,
                    images: { where: { isPrimary: true }, take: 1 },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!order) return;

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', '');

    // Deduplicate products (one variant per unique product)
    const seen = new Set<string>();
    const products = order.items
      .filter((item) => {
        const slug = item.productVariant.product.slug;
        if (seen.has(slug)) return false;
        seen.add(slug);
        return true;
      })
      .map((item) => ({
        name: item.productVariant.product.name,
        imageUrl: item.productVariant.product.images[0]?.url,
        reviewUrl: `${frontendUrl}/products/${item.productVariant.product.slug}?review=1&orderId=${orderId}`,
      }));

    await this.emailService.sendReviewRequest({
      to: order.snapshotEmail,
      firstName: order.snapshotFirstName,
      orderNumber: order.orderNumber,
      products,
    });
  }

  private async sendStockAlertIfNeeded(
    orderNumber: string,
    variantIds: string[],
  ): Promise<void> {
    const adminEmail =
      this.configService.get<string>('ADMIN_ALERT_EMAIL') ||
      this.configService.get<string>('EMAIL_FROM');

    if (!adminEmail) return;

    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: { product: { select: { name: true } } },
    });

    const alertItems = variants
      .filter((v) => v.stock <= v.reorderThreshold)
      .map((v) => ({
        sku: v.sku,
        name: `${v.product.name} – ${v.label}`,
        stock: v.stock,
        isOutOfStock: v.stock === 0,
      }));

    if (alertItems.length === 0) return;

    this.logger.warn(
      `Stock alert for order #${orderNumber}: ${alertItems.map((i) => `${i.sku}=${i.stock}`).join(', ')}`,
    );

    await this.emailService.sendLowStockAlert({ to: adminEmail, orderNumber, items: alertItems });
  }

  private mapOrder<
    T extends {
      items: Array<{ quantity: number; snapshotPrice: number }>;
      payment: { refundedAmountInCents: number } | null;
    },
  >(order: T) {
    return {
      ...order,
      items: order.items.map((item) => ({
        ...item,
        totalPrice: item.quantity * item.snapshotPrice,
      })),
      refundedAmountInCents: order.payment?.refundedAmountInCents ?? 0,
    };
  }

  // Sequences are guaranteed to exist by onModuleInit (startup) and the
  // pre_create_order_number_sequences migration — no DDL inside this
  // transaction to avoid AccessExclusive catalog-lock deadlocks.
  private async generateOrderNumber(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const year = new Date().getFullYear();
    this.assertValidOrderSequenceYear(year);

    const result: Array<{ nextval: bigint }> = await tx.$queryRawUnsafe(
      `SELECT nextval('order_number_seq_${year}')`,
    );

    const seq = Number(result[0].nextval);
    return `ORD-${year}-${String(seq).padStart(6, '0')}`;
  }
}
