import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  async getItems(userId: string) {
    const items = await this.prisma.wishlistItem.findMany({
      where: { userId, product: { isActive: true } },
      take: 200,
      include: {
        product: {
          include: {
            images: {
              where: { isPrimary: true },
              take: 1,
            },
            variants: {
              where: { isActive: true },
              select: { id: true, label: true, priceInCents: true, stock: true },
              orderBy: { priceInCents: 'asc' },
            },
          },
        },
      },
      orderBy: { addedAt: 'desc' },
    });

    return items.map(({ product, notifyOnRestock }) => ({
      id: product.id,
      name: product.name,
      slug: product.slug,
      brand: product.brand,
      images: product.images.map((img) => ({ url: img.url })),
      variants: product.variants,
      notifyOnRestock,
    }));
  }

  async addItem(userId: string, productId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, isActive: true } });
    if (!product) throw new NotFoundException('Product not found');

    await this.prisma.wishlistItem.upsert({
      where: { userId_productId: { userId, productId } },
      create: { userId, productId },
      update: {},
    });
  }

  async removeItem(userId: string, productId: string) {
    await this.prisma.wishlistItem.deleteMany({ where: { userId, productId } });
  }

  async setNotify(userId: string, productId: string, notify: boolean) {
    await this.prisma.wishlistItem.updateMany({
      where: { userId, productId },
      data: { notifyOnRestock: notify },
    });
  }

  async mergeGuestItems(userId: string, productIds: string[]) {
    if (!productIds.length) return;

    const existingProducts = await this.prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      select: { id: true },
    });

    if (!existingProducts.length) return;

    await this.prisma.wishlistItem.createMany({
      data: existingProducts.map(({ id }) => ({ userId, productId: id })),
      skipDuplicates: true,
    });
  }
}
