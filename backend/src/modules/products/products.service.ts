import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

const PRODUCT_INCLUDE = {
  variants: { where: { isActive: true }, orderBy: { priceInCents: 'asc' as const } },
  images: { orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }] },
  category: { select: { id: true, name: true, slug: true } },
};

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: {
    page?: number;
    limit?: number;
    category?: string;
    brand?: string;
    gender?: string;
    scentFamily?: string;
    minPrice?: number;
    maxPrice?: number;
    search?: string;
    featured?: boolean;
  }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      isActive: true,
      ...(query.category && { category: { slug: query.category } }),
      ...(query.brand && { brand: { equals: query.brand, mode: 'insensitive' } }),
      ...(query.gender && { gender: query.gender }),
      ...(query.scentFamily && { scentFamily: query.scentFamily }),
      ...(query.featured !== undefined && { isFeatured: query.featured }),
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { brand: { contains: query.search, mode: 'insensitive' } },
          { shortDescription: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
      ...(query.minPrice !== undefined || query.maxPrice !== undefined
        ? {
            variants: {
              some: {
                isActive: true,
                priceInCents: {
                  ...(query.minPrice !== undefined && { gte: query.minPrice }),
                  ...(query.maxPrice !== undefined && { lte: query.maxPrice }),
                },
              },
            },
          }
        : {}),
    };

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: products,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findBySlug(slug: string) {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      include: PRODUCT_INCLUDE,
    });
    if (!product || !product.isActive) throw new NotFoundException('Product not found');
    return product;
  }

  create(data: {
    name: string;
    slug: string;
    categoryId: string;
    description?: string;
    shortDescription?: string;
    brand?: string;
    isActive?: boolean;
    isFeatured?: boolean;
    scentFamily?: string;
    notes?: string[];
    gender?: string;
  }) {
    const { categoryId, ...rest } = data;
    return this.prisma.product.create({
      data: { ...rest, category: { connect: { id: categoryId } } },
      include: PRODUCT_INCLUDE,
    });
  }

  async update(id: string, data: {
    name?: string;
    slug?: string;
    categoryId?: string;
    description?: string;
    shortDescription?: string;
    brand?: string;
    isActive?: boolean;
    isFeatured?: boolean;
    scentFamily?: string;
    notes?: string[];
    gender?: string;
  }) {
    await this.ensureExists(id);
    const { categoryId, ...rest } = data;
    const prismaData: Prisma.ProductUpdateInput = { ...rest };
    if (categoryId) {
      prismaData.category = { connect: { id: categoryId } };
    }
    return this.prisma.product.update({ where: { id }, data: prismaData, include: PRODUCT_INCLUDE });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    return this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
  }

  createVariant(productId: string, data: {
    sku: string;
    label: string;
    priceInCents: number;
    volume?: number;
    weight?: number;
    compareAtPriceInCents?: number;
    stock?: number;
    isActive?: boolean;
  }) {
    return this.prisma.productVariant.create({
      data: { ...data, product: { connect: { id: productId } } },
    });
  }

  updateVariant(variantId: string, data: {
    sku?: string;
    label?: string;
    priceInCents?: number;
    volume?: number;
    weight?: number;
    compareAtPriceInCents?: number;
    stock?: number;
    isActive?: boolean;
  }) {
    return this.prisma.productVariant.update({ where: { id: variantId }, data });
  }

  async updateVariantStock(variantId: string, dto: { set?: number; adjustment?: number }) {
    const variant = await this.prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!variant) throw new NotFoundException('Variant not found');

    if (dto.set !== undefined) {
      return this.prisma.productVariant.update({
        where: { id: variantId },
        data: { stock: dto.set },
      });
    }

    const newStock = Math.max(0, variant.stock + (dto.adjustment ?? 0));
    return this.prisma.productVariant.update({
      where: { id: variantId },
      data: { stock: newStock },
    });
  }

  async addImage(productId: string, url: string, storagePath: string, altText?: string) {
    const count = await this.prisma.productImage.count({ where: { productId } });
    return this.prisma.productImage.create({
      data: {
        productId,
        url,
        storagePath,
        altText,
        isPrimary: count === 0,
        sortOrder: count,
      },
    });
  }

  async removeImage(imageId: string) {
    const image = await this.prisma.productImage.findUnique({ where: { id: imageId } });
    if (!image) throw new NotFoundException('Image not found');
    await this.prisma.productImage.delete({ where: { id: imageId } });
    return image;
  }

  private async ensureExists(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }
}
