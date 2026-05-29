import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { PaymentsService } from '../payments/payments.service';
import { EmailQueueService } from '../email/email-queue.service';
import { CouponService } from '../coupons/coupon.service';
import { CarrierCode, DiscountType, OrderStatus, Prisma } from '@prisma/client';
import { InvoiceService } from '../invoice/invoice.service';
import { ShippingRatesService } from '../shipping/shipping-rates.service';


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
  ) {}

  async onModuleInit(): Promise<void> {
    const year = new Date().getFullYear();
    // Ensure sequences exist for the current and next calendar year.
    // Runs once at startup, outside any transaction, so the brief DDL lock
    // never interferes with concurrent order-creation transactions.
    await this.prisma.$executeRawUnsafe(
      `CREATE SEQUENCE IF NOT EXISTS order_number_seq_${year} START 1`,
    );
    await this.prisma.$executeRawUnsafe(
      `CREATE SEQUENCE IF NOT EXISTS order_number_seq_${year + 1} START 1`,
    );
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
    },
  ) {
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

    if (dto.addressId) {
      address = await this.prisma.address.findFirst({
        where: { id: dto.addressId, ...(userId ? { userId } : {}) },
      });
      if (!address) throw new NotFoundException('Address not found');
    } else if (dto.newAddress) {
      address = { country: 'PL', ...dto.newAddress };
    } else {
      throw new BadRequestException('Address is required');
    }

    const shippingCostInCents = await this.shippingRatesService.getRateForCarrier(dto.carrierCode);
    const itemsTotalInCents = cart.totalInCents;

    // Resolve coupon discount before entering the transaction
    let discountInCents = 0;
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
      if (couponResult.discountType === DiscountType.FREE_SHIPPING) {
        discountInCents = shippingCostInCents;
      } else {
        discountInCents = couponResult.discountAmountInCents ?? 0;
      }
      resolvedCouponId = couponResult.couponId!;
    }

    const totalInCents = Math.max(0, itemsTotalInCents + shippingCostInCents - discountInCents);

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

      // Create order with address snapshot
      const newOrder = await tx.order.create({
        data: {
          orderNumber,
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
          itemsTotalInCents,
          shippingCostInCents,
          discountInCents,
          totalInCents,
          ...(resolvedCouponId && { couponId: resolvedCouponId }),
          ...(resolvedCouponCode && { couponCode: resolvedCouponCode }),
          notes: dto.notes,
          termsVersion: dto.termsVersion,
          termsAcceptedAt: dto.termsAcceptedAt ? new Date(dto.termsAcceptedAt) : undefined,
          items: {
            create: cart.items.map((item: CartItem) => ({
              productVariantId: item.productVariantId,
              snapshotName: `${item.productName} – ${item.variantLabel}`,
              snapshotSku: item.sku,
              snapshotPrice: item.priceInCents,
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
          discountInCents,
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

    // Send confirmation email (fire-and-forget)
    this.emailService
      .sendOrderConfirmation({
        to: userEmail,
        orderNumber: order.orderNumber,
        firstName: address.firstName,
        items: cart.items.map((i: CartItem) => ({
          name: `${i.productName} – ${i.variantLabel}`,
          quantity: i.quantity,
          price: i.priceInCents,
        })),
        totalInCents,
        carrierCode: dto.carrierCode,
      })
      .catch(() => undefined);

    // Stock alert (fire-and-forget): check post-decrement levels for all ordered variants
    this.sendStockAlertIfNeeded(
      order.orderNumber,
      cart.items.map((i: CartItem) => i.productVariantId),
    ).catch(() => undefined);

    return { orderId: order.id, orderNumber: order.orderNumber, paymentUrl };
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

    return { data: orders, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOneForUser(id: string, userId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, userId },
      include: { items: true, payment: true, shipment: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async findEventsForUser(orderId: string, userId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found');

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
        snapshotFirstName: true,
        snapshotLastName: true,
        snapshotCompany: true,
        snapshotNip: true,
        snapshotStreet: true,
        snapshotCity: true,
        snapshotPostalCode: true,
        itemsTotalInCents: true,
        shippingCostInCents: true,
        totalInCents: true,
        createdAt: true,
        items: {
          select: { snapshotName: true, snapshotPrice: true, snapshotVatRate: true, quantity: true },
        },
      },
    });

    if (!order) throw new NotFoundException('Order not found');

    const nonInvoiceable: OrderStatus[] = [OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED];
    if (nonInvoiceable.includes(order.status)) {
      throw new BadRequestException(
        `Cannot generate invoice for an order with status ${order.status}`,
      );
    }

    const { url } = await this.invoiceService.processInvoice(order);
    return { invoiceUrl: url };
  }

  async trackByEmailAndNumber(email: string, orderNumber: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        orderNumber: orderNumber.trim().toUpperCase(),
        snapshotEmail: { equals: email.trim(), mode: 'insensitive' },
      },
      include: {
        items: { select: { snapshotName: true, quantity: true, snapshotPrice: true } },
        shipment: { select: { trackingNumber: true, carrierCode: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    return {
      orderNumber: order.orderNumber,
      status: order.status,
      createdAt: order.createdAt,
      totalInCents: order.totalInCents,
      items: order.items,
      trackingNumber: order.shipment?.trackingNumber ?? null,
      carrier: order.shipment?.carrierCode ?? null,
    };
  }

  async getUnreadCount(): Promise<{ count: number }> {
    const count = await this.prisma.order.count({
      where: { status: OrderStatus.PAID },
    });
    return { count };
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

    return { data: orders, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
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

    const isRefund = ([OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.PARTIALLY_REFUNDED] as OrderStatus[]).includes(order.status);

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
      .catch(() => undefined);
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
      });
    }

    await this.paymentsService.partialRefund(orderId, resolvedItems, order.status, 'CUSTOMER');

    const refundAmountInCents = resolvedItems.reduce((s, i) => s + i.quantity * i.priceInCents, 0);
    this.emailService
      .sendOrderCancellation({
        to: order.snapshotEmail,
        orderNumber: order.orderNumber,
        firstName: order.snapshotFirstName,
        totalInCents: refundAmountInCents,
        isRefund: true,
      })
      .catch(() => undefined);
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

    const stockRestoringStatuses: OrderStatus[] = [OrderStatus.CANCELLED, OrderStatus.REFUNDED];
    const stockAlreadyRestored: OrderStatus[] = [OrderStatus.CANCELLED, OrderStatus.REFUNDED];

    const shouldRestoreStock =
      stockRestoringStatuses.includes(status) && !stockAlreadyRestored.includes(current.status);

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
    });

    if (status === OrderStatus.DELIVERED) {
      this.dispatchReviewRequestEmail(id).catch(() => undefined);
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
              .catch(() => undefined);
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
    needsRefund: string[];
  }> {
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds } },
      include: { items: true },
    });

    const succeeded: string[] = [];
    const failed: Array<{ orderNumber: string; reason: string }> = [];
    const needsRefund: string[] = [];

    const nonCancellableStatuses: OrderStatus[] = [
      OrderStatus.CANCELLED,
      OrderStatus.REFUNDED,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
    ];

    await Promise.all(
      orders.map(async (order) => {
        if (nonCancellableStatuses.includes(order.status)) {
          failed.push({ orderNumber: order.orderNumber, reason: `Status ${order.status} nie pozwala na anulowanie` });
          return;
        }

        try {
          await this.prisma.$transaction(async (tx) => {
            for (const item of order.items) {
              await tx.productVariant.update({
                where: { id: item.productVariantId },
                data: { stock: { increment: item.quantity } },
              });
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

          const isRefund = order.status === OrderStatus.PAID || order.status === OrderStatus.PROCESSING;

          this.emailService
            .sendOrderCancellation({
              to: order.snapshotEmail,
              orderNumber: order.orderNumber,
              firstName: order.snapshotFirstName,
              totalInCents: order.totalInCents,
              isRefund,
            })
            .catch(() => undefined);

          if (isRefund) needsRefund.push(order.orderNumber);
          succeeded.push(order.orderNumber);
        } catch (err) {
          failed.push({ orderNumber: order.orderNumber, reason: (err as Error).message });
        }
      }),
    );

    return { succeeded: succeeded.length, failed, needsRefund };
  }

  private async dispatchReviewRequestEmail(orderId: string): Promise<void> {
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
        reviewUrl: `${frontendUrl}/products/${item.productVariant.product.slug}?review=1`,
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

  // Sequences are guaranteed to exist by onModuleInit (startup) and the
  // pre_create_order_number_sequences migration — no DDL inside this
  // transaction to avoid AccessExclusive catalog-lock deadlocks.
  private async generateOrderNumber(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const year = new Date().getFullYear();

    const result: Array<{ nextval: bigint }> = await tx.$queryRawUnsafe(
      `SELECT nextval('order_number_seq_${year}')`,
    );

    const seq = Number(result[0].nextval);
    return `ORD-${year}-${String(seq).padStart(6, '0')}`;
  }
}
