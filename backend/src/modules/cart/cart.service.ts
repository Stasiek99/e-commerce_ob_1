import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
                where: { isPrimary: true },
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
  constructor(private readonly prisma: PrismaService) {}

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
  }

  async updateItem(
    userId: string | undefined,
    sessionId: string | undefined,
    productVariantId: string,
    quantity: number,
  ) {
    const cart = await this.findCart(userId, sessionId);
    if (!cart) throw new NotFoundException('Cart not found');

    if (quantity <= 0) {
      return this.removeItem(userId, sessionId, productVariantId);
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
  }

  async removeItem(
    userId: string | undefined,
    sessionId: string | undefined,
    productVariantId: string,
  ) {
    const cart = await this.findCart(userId, sessionId);
    if (!cart) throw new NotFoundException('Cart not found');

    await this.prisma.cartItem.deleteMany({
      where: { cartId: cart.id, productVariantId },
    });

    return this.getOrCreate(userId, sessionId);
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
          where: { id: item.productVariantId },
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
