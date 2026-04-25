import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { PaymentsService } from '../payments/payments.service';
import { EmailService } from '../email/email.service';
import { CarrierCode, OrderStatus } from '@prisma/client';

const LOW_STOCK_THRESHOLD = 2;

interface CartItem {
  productVariantId: string;
  quantity: number;
  productName: string;
  variantLabel: string;
  priceInCents: number;
  sku: string;
  stock: number;
  imageUrl?: string | null;
  slug: string;
}

const SHIPPING_RATES: Record<CarrierCode, number> = {
  [CarrierCode.INPOST]: 1499,  // 14,99 zł
  [CarrierCode.DHL]: 1999,     // 19,99 zł
  [CarrierCode.GLS]: 1799,     // 17,99 zł
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
    private readonly paymentsService: PaymentsService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

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
      notes?: string;
      termsVersion?: string;
      termsAcceptedAt?: string;
      nip?: string;
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

    const shippingCostInCents = SHIPPING_RATES[dto.carrierCode];
    const itemsTotalInCents = cart.totalInCents;
    const totalInCents = itemsTotalInCents + shippingCostInCents;

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

      // Validate and decrement stock
      for (const item of cart.items) {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.productVariantId },
        });
        if (!variant || variant.stock < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for: ${item.productName} ${item.variantLabel}`,
          );
        }
        await tx.productVariant.update({
          where: { id: item.productVariantId },
          data: { stock: { decrement: item.quantity } },
        });
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
          itemsTotalInCents,
          shippingCostInCents,
          totalInCents,
          notes: dto.notes,
          termsVersion: dto.termsVersion,
          termsAcceptedAt: dto.termsAcceptedAt ? new Date(dto.termsAcceptedAt) : undefined,
          items: {
            create: cart.items.map((item: CartItem) => ({
              productVariantId: item.productVariantId,
              snapshotName: `${item.productName} – ${item.variantLabel}`,
              snapshotSku: item.sku,
              snapshotPrice: item.priceInCents,
              quantity: item.quantity,
            })),
          },
        },
      });

      // Clear cart inside the transaction so it rolls back if payment init fails
      const cartRecord = await tx.cart.findFirst({
        where: userId ? { userId } : { sessionId },
      });
      if (cartRecord) {
        await tx.cartItem.deleteMany({ where: { cartId: cartRecord.id } });
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

    // Initiate payment (outside transaction — P24 API call)
    const { paymentUrl } = await this.paymentsService.initiatePayment(order.id);

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
      })
      // Fire-and-forget: EmailService.send already logs + reports to Sentry.
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

    const isRefund = order.status === OrderStatus.PAID || order.status === OrderStatus.PROCESSING;

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

  async updateStatus(id: string, status: OrderStatus, actor = 'ADMIN') {
    const current = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });
    return this.prisma.$transaction([
      this.prisma.order.update({ where: { id }, data: { status } }),
      this.prisma.orderEvent.create({
        data: { orderId: id, fromStatus: current.status, toStatus: status, actor },
      }),
    ]);
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
      .filter((v) => v.stock <= LOW_STOCK_THRESHOLD)
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

  /**
   * Generate a unique order number using a PostgreSQL sequence.
   * This is race-condition-safe — each call gets a unique incrementing value.
   */
  private async generateOrderNumber(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
  ): Promise<string> {
    const year = new Date().getFullYear();

    // Create sequence if it doesn't exist (idempotent)
    await tx.$executeRawUnsafe(
      `CREATE SEQUENCE IF NOT EXISTS order_number_seq_${year} START 1`,
    );

    const result: Array<{ nextval: bigint }> = await tx.$queryRawUnsafe(
      `SELECT nextval('order_number_seq_${year}')`,
    );

    const seq = Number(result[0].nextval);
    return `ORD-${year}-${String(seq).padStart(6, '0')}`;
  }
}
