import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto, UpdateReviewStatusDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateReviewDto) {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, userId },
      include: {
        items: { include: { productVariant: { select: { productId: true } } } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException(
        'Możesz ocenić produkt tylko po jego dostarczeniu.',
      );
    }
    const hasProduct = order.items.some(
      (i) => i.productVariant.productId === dto.productId,
    );
    if (!hasProduct) {
      throw new BadRequestException(
        'Ten produkt nie znajduje się w wybranym zamówieniu.',
      );
    }

    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });
    if (!product || !product.isActive) throw new NotFoundException('Product not found');

    return this.prisma.review.create({
      data: {
        productId: dto.productId,
        userId,
        orderId: dto.orderId,
        rating: dto.rating,
        title: dto.title?.trim() ?? null,
        body: dto.body?.trim() ?? null,
        status: 'PENDING',
      },
    });
  }

  async getByProduct(
    productId: string,
    page = 1,
    limit = 10,
    sort: 'recent' | 'helpful' = 'recent',
  ) {
    const safeLimit = Math.min(limit, 50);
    const skip = (page - 1) * safeLimit;
    const orderBy: Prisma.ReviewOrderByWithRelationInput =
      sort === 'helpful' ? { helpfulCount: 'desc' } : { createdAt: 'desc' };

    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where: { productId, status: 'APPROVED' },
        orderBy,
        skip,
        take: safeLimit,
        select: {
          id: true,
          rating: true,
          title: true,
          body: true,
          adminReply: true,
          helpfulCount: true,
          createdAt: true,
          orderId: true,
          user: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.review.count({ where: { productId, status: 'APPROVED' } }),
    ]);

    return {
      data: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        body: r.body,
        adminReply: r.adminReply,
        helpfulCount: r.helpfulCount,
        createdAt: r.createdAt,
        verifiedPurchase: r.orderId !== null,
        authorName:
          [r.user.firstName, r.user.lastName?.charAt(0).concat('.')]
            .filter(Boolean)
            .join(' ')
            .trim() || 'Klient',
      })),
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async getMine(userId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            images: { where: { isPrimary: true }, take: 1 },
          },
        },
      },
    });

    return reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      status: r.status,
      createdAt: r.createdAt,
      product: {
        id: r.product.id,
        name: r.product.name,
        slug: r.product.slug,
        imageUrl: r.product.images[0]?.url ?? null,
      },
    }));
  }

  async markHelpful(reviewId: string, userId: string) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review || review.status !== 'APPROVED') {
      throw new NotFoundException('Review not found');
    }

    try {
      await this.prisma.$transaction([
        this.prisma.reviewHelpfulVote.create({ data: { reviewId, userId } }),
        this.prisma.review.update({
          where: { id: reviewId },
          data: { helpfulCount: { increment: 1 } },
        }),
      ]);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('You have already marked this review as helpful');
      }
      throw err;
    }

    return this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, helpfulCount: true },
    });
  }

  async adminUpdateStatus(id: string, dto: UpdateReviewStatusDto) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Review not found');

    const status = dto.action === 'approve' ? ('APPROVED' as const) : ('REJECTED' as const);
    const updated = await this.prisma.review.update({
      where: { id },
      data: {
        status,
        ...(dto.adminReply !== undefined && {
          adminReply: dto.adminReply.trim() || null,
        }),
      },
    });

    await this.updateProductStats(review.productId);
    return updated;
  }

  async adminDelete(id: string): Promise<void> {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Review not found');
    await this.prisma.review.delete({ where: { id } });
    await this.updateProductStats(review.productId);
  }

  async updateProductStats(productId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE products SET
        review_count = (
          SELECT COUNT(*) FROM reviews
          WHERE product_id = ${productId}::uuid AND status = 'APPROVED'
        ),
        avg_rating = (
          SELECT ROUND(AVG(rating)::numeric, 2)
          FROM reviews
          WHERE product_id = ${productId}::uuid AND status = 'APPROVED'
        )
      WHERE id = ${productId}::uuid
    `;
  }
}
