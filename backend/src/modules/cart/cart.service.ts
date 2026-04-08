import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: productVariantId },
    });
    if (!variant || !variant.isActive) throw new NotFoundException('Variant not found');
    if (variant.stock < quantity) throw new BadRequestException('Insufficient stock');

    let cart = await this.findCart(userId, sessionId);
    if (!cart) {
      const newCart = await this.prisma.cart.create({
        data: { userId, sessionId },
        include: CART_INCLUDE,
      });
      cart = newCart;
    }

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_productVariantId: { cartId: cart.id, productVariantId } },
    });

    const newQty = (existing?.quantity ?? 0) + quantity;
    if (variant.stock < newQty) throw new BadRequestException('Insufficient stock');

    if (existing) {
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: newQty },
      });
    } else {
      await this.prisma.cartItem.create({
        data: { cartId: cart.id, productVariantId, quantity },
      });
    }

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

    const variant = await this.prisma.productVariant.findUnique({
      where: { id: productVariantId },
    });
    if (!variant) throw new NotFoundException('Variant not found');
    if (variant.stock < quantity) throw new BadRequestException('Insufficient stock');

    await this.prisma.cartItem.updateMany({
      where: { cartId: cart.id, productVariantId },
      data: { quantity },
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
    const guestCart = await this.prisma.cart.findFirst({
      where: { sessionId, userId: null },
      include: { items: true },
    });
    if (!guestCart || guestCart.items.length === 0) return;

    let userCart = await this.prisma.cart.findFirst({ where: { userId } });
    if (!userCart) {
      await this.prisma.cart.update({
        where: { id: guestCart.id },
        data: { userId, sessionId: null },
      });
      return;
    }

    for (const item of guestCart.items) {
      const existing = await this.prisma.cartItem.findUnique({
        where: {
          cartId_productVariantId: {
            cartId: userCart.id,
            productVariantId: item.productVariantId,
          },
        },
      });
      if (existing) {
        await this.prisma.cartItem.update({
          where: { id: existing.id },
          data: { quantity: existing.quantity + item.quantity },
        });
      } else {
        await this.prisma.cartItem.create({
          data: {
            cartId: userCart.id,
            productVariantId: item.productVariantId,
            quantity: item.quantity,
          },
        });
      }
    }

    await this.prisma.cart.delete({ where: { id: guestCart.id } });
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
