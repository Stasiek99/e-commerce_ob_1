import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

const MAX_CART_QTY_PER_VARIANT = 2;

const CART_INCLUDE = {
  items: {
    include: {
      productVariant: {
        include: {
          product: {
            include: {
              images: {
                orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }],
                take: 1,
              },
            },
          },
        },
      },
    },
  },
};

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
  ) {}

  async getOrCreate(userId?: string, sessionId?: string) {
    let cart = await this.findCart(userId, sessionId);
    if (!cart) {
      cart = await this.prisma.cart.create({
        data: { userId, sessionId },
        include: CART_INCLUDE,
      });
    }
    return this.formatCart(cart);
  }

  async addItem(
    userId: string | undefined,
    sessionId: string | undefined,
    productVariantId: string,
    quantity: number,
  ) {
    return this.withCheckoutLock(userId, sessionId, async () => {
      await this.prisma.$transaction(async (tx) => {
        // Best-effort stock guard: FOR UPDATE is a no-op on pgbouncer transaction mode,
        // so we read without a lock. The authoritative atomic check-and-decrement
        // happens in createFromCart via updateMany WHERE stock >= quantity.
        const variant = await tx.productVariant.findUnique({
          where: { id: productVariantId },
          select: { id: true, isActive: true, stock: true },
        });
        if (!variant || !variant.isActive) throw new NotFoundException('Variant not found');

        const cart =
          (userId
            ? await tx.cart.findFirst({ where: { userId } })
            : await tx.cart.findFirst({ where: { sessionId, userId: null } })) ??
          (await tx.cart.create({ data: { userId, sessionId } }));

        const existing = await tx.cartItem.findUnique({
          where: { cartId_productVariantId: { cartId: cart.id, productVariantId } },
        });

        const newQty = (existing?.quantity ?? 0) + quantity;
        if (newQty > MAX_CART_QTY_PER_VARIANT)
          throw new BadRequestException(`Maximum ${MAX_CART_QTY_PER_VARIANT} units per product variant allowed`);
        if (variant.stock < newQty) throw new BadRequestException('Insufficient stock');

        if (existing) {
          await tx.cartItem.update({
            where: { id: existing.id },
            data: { quantity: newQty },
          });
        } else {
          await tx.cartItem.create({
            data: { cartId: cart.id, productVariantId, quantity },
          });
        }
      });

      return this.getOrCreate(userId, sessionId);
    });
  }

  async updateItem(
    userId: string | undefined,
    sessionId: string | undefined,
    productVariantId: string,
    quantity: number,
  ) {
    return this.withCheckoutLock(userId, sessionId, async () => {
      const cart = await this.findCart(userId, sessionId);
      if (!cart) throw new NotFoundException('Cart not found');

      if (quantity <= 0) {
        return this.removeItemFromCart(cart.id, productVariantId, userId, sessionId);
      }

      await this.prisma.$transaction(async (tx) => {
        const variant = await tx.productVariant.findUnique({
          where: { id: productVariantId },
          select: { isActive: true, stock: true },
        });
        if (!variant || !variant.isActive) throw new NotFoundException('Variant not found');
        if (quantity > MAX_CART_QTY_PER_VARIANT)
          throw new BadRequestException(`Maximum ${MAX_CART_QTY_PER_VARIANT} units per product variant allowed`);
        if (variant.stock < quantity) throw new BadRequestException('Insufficient stock');

        await tx.cartItem.updateMany({
          where: { cartId: cart.id, productVariantId },
          data: { quantity },
        });
      });

      return this.getOrCreate(userId, sessionId);
    });
  }

  async removeItem(
    userId: string | undefined,
    sessionId: string | undefined,
    productVariantId: string,
  ) {
    return this.withCheckoutLock(userId, sessionId, async () => {
      const cart = await this.findCart(userId, sessionId);
      if (!cart) throw new NotFoundException('Cart not found');

      return this.removeItemFromCart(cart.id, productVariantId, userId, sessionId);
    });
  }

  private async removeItemFromCart(
    cartId: string,
    productVariantId: string,
    userId: string | undefined,
    sessionId: string | undefined,
  ) {
    await this.prisma.cartItem.deleteMany({
      where: { cartId, productVariantId },
    });

    return this.getOrCreate(userId, sessionId);
  }

  // Same key OrdersService.createFromCart holds for its full read-cart → charge →
  // decrement-stock span. Acquiring it here means a cart edit racing an in-flight
  // checkout in another tab gets rejected (429) instead of silently mutating rows
  // out from under a checkout transaction that already snapshotted the old cart.
  private async withCheckoutLock<T>(
    userId: string | undefined,
    sessionId: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    const lockKey = `checkout-lock:${userId ?? sessionId}`;
    const lockToken = randomUUID();
    const acquired = await this.redis.set(lockKey, lockToken, 'EX', 30, 'NX');
    if (!acquired) {
      throw new HttpException(
        'Checkout already in progress — please wait a moment before trying again',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    try {
      return await fn();
    } finally {
      await this.redis.eval(
        `if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end`,
        1,
        lockKey,
        lockToken,
      );
    }
  }

  async mergeGuestCart(userId: string, sessionId: string) {
    await this.prisma.$transaction(async (tx) => {
      const guestCart = await tx.cart.findFirst({
        where: { sessionId, userId: null },
        select: { id: true },
      });
      if (!guestCart) return;

      const guestCartId = guestCart.id;
      const guestItems = await tx.cartItem.findMany({ where: { cartId: guestCartId } });
      if (guestItems.length === 0) return;

      const userCart = await tx.cart.findFirst({ where: { userId } });
      if (!userCart) {
        // Fast path: claim the guest cart directly — no item copying needed
        await tx.cart.update({
          where: { id: guestCartId },
          data: { userId, sessionId: null },
        });
        return;
      }

      for (const item of guestItems) {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.productVariantId, isActive: true },
          select: { stock: true },
        });
        const availableStock = variant?.stock ?? 0;

        const existing = await tx.cartItem.findUnique({
          where: {
            cartId_productVariantId: {
              cartId: userCart.id,
              productVariantId: item.productVariantId,
            },
          },
        });

        const newQty = Math.min(
          (existing?.quantity ?? 0) + item.quantity,
          MAX_CART_QTY_PER_VARIANT,
          availableStock,
        );

        if (newQty <= 0) continue;

        if (existing) {
          if (newQty !== existing.quantity) {
            await tx.cartItem.update({
              where: { id: existing.id },
              data: { quantity: newQty },
            });
          }
        } else {
          await tx.cartItem.create({
            data: {
              cartId: userCart.id,
              productVariantId: item.productVariantId,
              quantity: newQty,
            },
          });
        }
      }

      await tx.cart.delete({ where: { id: guestCartId } });
    });
  }

  async clearCart(cartId: string) {
    await this.prisma.cartItem.deleteMany({ where: { cartId } });
  }

  private async findCart(userId?: string, sessionId?: string) {
    if (userId) {
      return this.prisma.cart.findFirst({
        where: { userId },
        include: CART_INCLUDE,
      });
    }
    if (sessionId) {
      return this.prisma.cart.findFirst({
        where: { sessionId, userId: null },
        include: CART_INCLUDE,
      });
    }
    return null;
  }

  private formatCart(cart: any) {
    const items = cart.items.map((item: any) => ({
      id: item.id,
      productVariantId: item.productVariantId,
      quantity: item.quantity,
      productName: item.productVariant.product.name,
      variantLabel: item.productVariant.label,
      priceInCents: item.productVariant.priceInCents,
      vatRate: item.productVariant.vatRate,
      imageUrl: item.productVariant.product.images[0]?.url ?? null,
      slug: item.productVariant.product.slug,
      sku: item.productVariant.sku,
      stock: item.productVariant.stock,
    }));

    const totalInCents = items.reduce(
      (sum: number, i: any) => sum + i.priceInCents * i.quantity,
      0,
    );

    return {
      id: cart.id,
      items,
      itemCount: items.reduce((sum: number, i: any) => sum + i.quantity, 0),
      totalInCents,
    };
  }
}
