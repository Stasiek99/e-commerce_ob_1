import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { Prisma } from '@prisma/client';

const PRODUCT_INCLUDE = {
  variants: { where: { isActive: true }, orderBy: { priceInCents: 'asc' as const } },
  images: { orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }] },
  category: { select: { id: true, name: true, slug: true } },
};

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  async findAll(query: {
    page?: number;
    limit?: number;
    category?: string;
    brand?: string;
    gender?: string[];
    scentFamily?: string[];
    line?: string[];
    volumes?: string[];
    inStock?: boolean;
    sortBy?: 'relevance' | 'price_asc' | 'price_desc';
    minPrice?: number;
    maxPrice?: number;
    search?: string;
    featured?: boolean;
  }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const variantWhere: Prisma.ProductVariantWhereInput = { isActive: true };
    if (query.volumes?.length) {
      variantWhere.volume = { in: query.volumes.map((v) => parseInt(v, 10)).filter(Number.isFinite) };
    }
    if (query.inStock) {
      variantWhere.stock = { gt: 0 };
    }
    if (query.minPrice !== undefined) {
      variantWhere.priceInCents = { ...variantWhere.priceInCents as object, gte: query.minPrice };
    }
    if (query.maxPrice !== undefined) {
      variantWhere.priceInCents = { ...variantWhere.priceInCents as object, lte: query.maxPrice };
    }
    const hasVariantFilter =
      query.volumes?.length || query.inStock || query.minPrice !== undefined || query.maxPrice !== undefined;

    let categorySlugs: string[] | undefined;
    if (query.category) {
      const cat = await this.prisma.category.findUnique({
        where: { slug: query.category },
        include: { children: { select: { slug: true } } },
      });
      if (cat) {
        categorySlugs = [cat.slug, ...cat.children.map((c) => c.slug)];
      }
    }

    const where: Prisma.ProductWhereInput = {
      isActive: true,
      ...(categorySlugs && { category: { slug: { in: categorySlugs } } }),
      ...(query.brand && { brand: { equals: query.brand, mode: 'insensitive' } }),
      ...(query.gender?.length && { gender: { in: query.gender } }),
      ...(query.scentFamily?.length && { scentFamily: { in: query.scentFamily } }),
      ...(query.line?.length && { line: { in: query.line } }),
      ...(query.featured !== undefined && { isFeatured: query.featured }),
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { brand: { contains: query.search, mode: 'insensitive' } },
          { shortDescription: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
      ...(hasVariantFilter ? { variants: { some: variantWhere } } : {}),
    };

    if (query.sortBy === 'price_asc' || query.sortBy === 'price_desc') {
      const all = await this.prisma.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      });

      const minPrice = (p: (typeof all)[0]) =>
        p.variants.length ? Math.min(...p.variants.map((v) => v.priceInCents)) : Infinity;

      all.sort((a, b) =>
        query.sortBy === 'price_asc' ? minPrice(a) - minPrice(b) : minPrice(b) - minPrice(a),
      );

      return {
        data: all.slice(skip, skip + limit),
        meta: { total: all.length, page, limit, totalPages: Math.ceil(all.length / limit) },
      };
    }

    // Curated interleaving for the perfumes parent category:
    // 5 Millesime → 5 Luxury per round. Skipped when any filter is active — narrowed results
    // are already specific enough that round-robin adds no value.
    if (
      query.category === 'perfumes' &&
      !query.featured &&
      (!query.sortBy || query.sortBy === 'relevance') &&
      !query.brand && !query.gender?.length && !query.scentFamily?.length &&
      !query.line?.length && !hasVariantFilter && !query.search
    ) {
      const all = await this.prisma.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      });

      type P = (typeof all)[0];
      const millesime: P[] = [], luxury: P[] = [], other: P[] = [];

      for (const p of all) {
        if (p.line === 'Millesime')                            millesime.push(p);
        else if (p.line === 'Luxury' || p.category?.slug === 'perfume-luxury') luxury.push(p);
        else                                                   other.push(p);
      }

      const CHUNK = 5;
      const groups = [millesime, luxury];
      const rounds = Math.max(...groups.map(g => Math.ceil(g.length / CHUNK)), 0);
      const interleaved: P[] = [];

      for (let r = 0; r < rounds; r++) {
        for (const g of groups) interleaved.push(...g.slice(r * CHUNK, (r + 1) * CHUNK));
      }
      interleaved.push(...other);

      return {
        data: interleaved.slice(skip, skip + limit),
        meta: { total: interleaved.length, page, limit, totalPages: Math.ceil(interleaved.length / limit) },
      };
    }

    // Curated interleaving for the default all-products view:
    // 5 Millesime → 5 Luxury → 5 Gels → 5 Diffusers per page, repeating across pages.
    if (!query.category && !query.featured && (!query.sortBy || query.sortBy === 'relevance')) {
      const all = await this.prisma.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      });

      type P = (typeof all)[0];
      const millesime: P[] = [], luxury: P[] = [], gels: P[] = [], diffusers: P[] = [], other: P[] = [];

      for (const p of all) {
        const slug = p.category?.slug;
        if (slug === 'diffusers')                              diffusers.push(p);
        else if (slug === 'gels')                              gels.push(p);
        else if (p.line === 'Millesime')                       millesime.push(p);
        else if (p.line === 'Luxury' || slug === 'perfume-luxury') luxury.push(p);
        else                                                   other.push(p);
      }

      const CHUNK = 5;
      const groups = [millesime, luxury, gels, diffusers];
      const rounds = Math.max(...groups.map(g => Math.ceil(g.length / CHUNK)), 0);
      const interleaved: P[] = [];

      for (let r = 0; r < rounds; r++) {
        for (const g of groups) interleaved.push(...g.slice(r * CHUNK, (r + 1) * CHUNK));
      }
      interleaved.push(...other);

      return {
        data: interleaved.slice(skip, skip + limit),
        meta: { total: interleaved.length, page, limit, totalPages: Math.ceil(interleaved.length / limit) },
      };
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        skip,
        take: limit,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: products,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getFacets(query: { category?: string }) {
    let categorySlugs: string[] | undefined;
    if (query.category) {
      const cat = await this.prisma.category.findUnique({
        where: { slug: query.category },
        include: { children: { select: { slug: true } } },
      });
      if (cat) {
        categorySlugs = [cat.slug, ...cat.children.map((c) => c.slug)];
      }
    }

    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
        ...(categorySlugs && { category: { slug: { in: categorySlugs } } }),
      },
      select: { scentFamily: true, gender: true },
    });

    const scentFamilies = [...new Set(
      products.map((p) => p.scentFamily).filter((s): s is string => s != null),
    )].sort();

    const genders = [...new Set(
      products.map((p) => p.gender).filter((g): g is string => g != null),
    )];

    return { scentFamilies, genders };
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
    sortOrder?: number;
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
    sortOrder?: number;
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

    const wasOutOfStock = variant.stock === 0;
    const newStock = dto.set !== undefined
      ? dto.set
      : Math.max(0, variant.stock + (dto.adjustment ?? 0));

    const updated = await this.prisma.productVariant.update({
      where: { id: variantId },
      data: { stock: newStock },
    });

    if (wasOutOfStock && newStock > 0) {
      this.dispatchBackInStockNotifications(variant.productId, variant.label).catch(() => undefined);
    }

    return updated;
  }

  private async dispatchBackInStockNotifications(productId: string, variantLabel: string): Promise<void> {
    const wishlistItems = await this.prisma.wishlistItem.findMany({
      where: { productId, notifyOnRestock: true },
      include: {
        user: { select: { email: true, firstName: true } },
        product: { select: { name: true, slug: true } },
      },
    });

    if (!wishlistItems.length) return;

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', '');

    // Reset flags BEFORE sending — prevents duplicate notifications if process
    // crashes mid-loop; users who miss an email can re-enable the flag manually.
    await this.prisma.wishlistItem.updateMany({
      where: { productId, notifyOnRestock: true },
      data: { notifyOnRestock: false },
    });

    // Fire all emails concurrently — sequential await would block the event loop
    // for hundreds of ms × N users (e.g. 500 users × 300ms = 150 s blocked).
    await Promise.allSettled(
      wishlistItems.map((item) =>
        this.emailService
          .sendBackInStock({
            to: item.user.email,
            firstName: item.user.firstName ?? '',
            productName: item.product.name,
            variantLabel,
            productUrl: `${frontendUrl}/products/${item.product.slug}`,
          })
          .catch((err) => this.logger.error(`Back-in-stock email failed for ${item.user.email}: ${err.message}`)),
      ),
    );

    this.logger.log(`Back-in-stock: notified ${wishlistItems.length} user(s) for product ${productId}`);
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
