import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { PaymentsService } from '../payments/payments.service';
import { EmailService } from '../email/email.service';
import { CarrierCode, OrderStatus } from '@prisma/client';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
    private readonly paymentsService: PaymentsService,
    private readonly emailService: EmailService,
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
