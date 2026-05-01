import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { ReviewsService } from '../reviews.service';
import { PrismaService } from '../../prisma/prisma.service';

const makeReview = (overrides: Partial<Record<string, any>> = {}) => ({
  id: 'review-1',
  productId: 'product-1',
  userId: 'user-1',
  orderId: null,
  rating: 5,
  title: 'Great scent',
  body: 'Loved every drop',
  status: 'APPROVED',
  adminReply: null,
  helpfulCount: 0,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  ...overrides,
});

describe('ReviewsService', () => {
  let service: ReviewsService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewsService,
        {
          provide: PrismaService,
          useValue: {
            order: { findFirst: jest.fn() },
            product: { findUnique: jest.fn() },
            review: {
              create: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            $executeRaw: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ReviewsService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto = { productId: 'product-1', rating: 5 };

    it('creates review with PENDING status when no orderId provided', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'product-1', isActive: true });
      prisma.review.create.mockResolvedValue(makeReview({ status: 'PENDING' }));

      await service.create('user-1', dto);

      expect(prisma.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productId: 'product-1',
            userId: 'user-1',
            orderId: null,
            status: 'PENDING',
          }),
        }),
      );
    });

    it('throws NotFoundException when orderId provided but order not found', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        service.create('user-1', { ...dto, orderId: 'order-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when order status is not DELIVERED', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.PAID,
        items: [{ productVariant: { productId: 'product-1' } }],
      });

      await expect(
        service.create('user-1', { ...dto, orderId: 'order-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when reviewed product is not in the given order', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.DELIVERED,
        items: [{ productVariant: { productId: 'other-product' } }],
      });

      await expect(
        service.create('user-1', { ...dto, orderId: 'order-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when product does not exist', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.create('user-1', dto)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when product is inactive', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'product-1', isActive: false });

      await expect(service.create('user-1', dto)).rejects.toThrow(NotFoundException);
    });

    it('trims whitespace from title and body', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'product-1', isActive: true });
      prisma.review.create.mockResolvedValue(makeReview());

      await service.create('user-1', { ...dto, title: '  Great  ', body: '  Love it  ' });

      expect(prisma.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: 'Great', body: 'Love it' }),
        }),
      );
    });

    it('stores null for title and body when not provided', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'product-1', isActive: true });
      prisma.review.create.mockResolvedValue(makeReview({ title: null, body: null }));

      await service.create('user-1', dto);

      expect(prisma.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: null, body: null }),
        }),
      );
    });

    it('stores orderId when order is DELIVERED and contains the product', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.DELIVERED,
        items: [{ productVariant: { productId: 'product-1' } }],
      });
      prisma.product.findUnique.mockResolvedValue({ id: 'product-1', isActive: true });
      prisma.review.create.mockResolvedValue(makeReview({ orderId: 'order-1' }));

      await service.create('user-1', { ...dto, orderId: 'order-1' });

      expect(prisma.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderId: 'order-1' }),
        }),
      );
    });

    it('skips order lookup entirely when no orderId provided', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'product-1', isActive: true });
      prisma.review.create.mockResolvedValue(makeReview());

      await service.create('user-1', dto);

      expect(prisma.order.findFirst).not.toHaveBeenCalled();
    });
  });

  // ─── getByProduct ─────────────────────────────────────────────────────────

  describe('getByProduct', () => {
    const makeDbReview = (overrides: any = {}) => ({
      id: 'review-1',
      rating: 4,
      title: 'Nice scent',
      body: 'Good quality',
      adminReply: null,
      helpfulCount: 3,
      createdAt: new Date('2025-01-01'),
      orderId: 'order-1',
      user: { firstName: 'Jan', lastName: 'Kowalski' },
      ...overrides,
    });

    beforeEach(() => {
      prisma.review.findMany.mockResolvedValue([makeDbReview()]);
      prisma.review.count.mockResolvedValue(1);
    });

    it('only returns APPROVED reviews', async () => {
      await service.getByProduct('product-1');

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { productId: 'product-1', status: 'APPROVED' },
        }),
      );
    });

    it('returns pagination meta', async () => {
      prisma.review.count.mockResolvedValue(25);

      const result = await service.getByProduct('product-1', 2, 10);

      expect(result.meta).toMatchObject({
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
      });
    });

    it('calculates correct skip offset for page 3 with limit 10', async () => {
      await service.getByProduct('product-1', 3, 10);

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20 }),
      );
    });

    it('caps limit at 50 even when a larger value is requested', async () => {
      await service.getByProduct('product-1', 1, 999);

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('orders by helpfulCount desc when sort=helpful', async () => {
      await service.getByProduct('product-1', 1, 10, 'helpful');

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { helpfulCount: 'desc' } }),
      );
    });

    it('orders by createdAt desc when sort=recent (default)', async () => {
      await service.getByProduct('product-1');

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });

    it('sets verifiedPurchase=true when orderId is not null', async () => {
      const result = await service.getByProduct('product-1');

      expect(result.data[0].verifiedPurchase).toBe(true);
    });

    it('sets verifiedPurchase=false when orderId is null', async () => {
      prisma.review.findMany.mockResolvedValue([makeDbReview({ orderId: null })]);

      const result = await service.getByProduct('product-1');

      expect(result.data[0].verifiedPurchase).toBe(false);
    });

    it('formats authorName as "FirstName L."', async () => {
      const result = await service.getByProduct('product-1');

      expect(result.data[0].authorName).toBe('Jan K.');
    });

    it('falls back to "Klient" when user has no firstName and no lastName', async () => {
      prisma.review.findMany.mockResolvedValue([
        makeDbReview({ user: { firstName: null, lastName: null } }),
      ]);

      const result = await service.getByProduct('product-1');

      expect(result.data[0].authorName).toBe('Klient');
    });

    it('uses firstName only when lastName is null', async () => {
      prisma.review.findMany.mockResolvedValue([
        makeDbReview({ user: { firstName: 'Anna', lastName: null } }),
      ]);

      const result = await service.getByProduct('product-1');

      expect(result.data[0].authorName).toBe('Anna');
    });
  });

  // ─── getMine ─────────────────────────────────────────────────────────────

  describe('getMine', () => {
    it('returns all reviews for the user with product info', async () => {
      prisma.review.findMany.mockResolvedValue([
        {
          id: 'r-1',
          rating: 5,
          title: 'Excellent',
          body: 'Love it',
          status: 'APPROVED',
          createdAt: new Date('2025-01-01'),
          product: {
            id: 'p-1',
            name: 'Sauvage',
            slug: 'sauvage',
            images: [{ url: 'https://cdn.example.com/img.jpg' }],
          },
        },
      ]);

      const result = await service.getMine('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].product.imageUrl).toBe('https://cdn.example.com/img.jpg');
      expect(result[0].product.slug).toBe('sauvage');
    });

    it('returns null imageUrl when product has no primary image', async () => {
      prisma.review.findMany.mockResolvedValue([
        {
          id: 'r-1',
          rating: 3,
          title: null,
          body: null,
          status: 'PENDING',
          createdAt: new Date(),
          product: { id: 'p-1', name: 'Test', slug: 'test', images: [] },
        },
      ]);

      const result = await service.getMine('user-1');

      expect(result[0].product.imageUrl).toBeNull();
    });

    it('queries by userId', async () => {
      prisma.review.findMany.mockResolvedValue([]);

      await service.getMine('user-42');

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-42' } }),
      );
    });
  });

  // ─── markHelpful ─────────────────────────────────────────────────────────

  describe('markHelpful', () => {
    it('throws NotFoundException when review does not exist', async () => {
      prisma.review.findUnique.mockResolvedValue(null);

      await expect(service.markHelpful('review-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when review is not APPROVED', async () => {
      prisma.review.findUnique.mockResolvedValue(makeReview({ status: 'PENDING' }));

      await expect(service.markHelpful('review-1')).rejects.toThrow(NotFoundException);
    });

    it('also throws NotFoundException for REJECTED reviews', async () => {
      prisma.review.findUnique.mockResolvedValue(makeReview({ status: 'REJECTED' }));

      await expect(service.markHelpful('review-1')).rejects.toThrow(NotFoundException);
    });

    it('increments helpfulCount on an APPROVED review', async () => {
      prisma.review.findUnique.mockResolvedValue(makeReview({ status: 'APPROVED' }));
      prisma.review.update.mockResolvedValue({ id: 'review-1', helpfulCount: 1 });

      await service.markHelpful('review-1');

      expect(prisma.review.update).toHaveBeenCalledWith({
        where: { id: 'review-1' },
        data: { helpfulCount: { increment: 1 } },
        select: { id: true, helpfulCount: true },
      });
    });
  });

  // ─── adminUpdateStatus ───────────────────────────────────────────────────

  describe('adminUpdateStatus', () => {
    it('throws NotFoundException when review does not exist', async () => {
      prisma.review.findUnique.mockResolvedValue(null);

      await expect(
        service.adminUpdateStatus('review-1', { action: 'approve' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('sets status to APPROVED on approve action', async () => {
      prisma.review.findUnique.mockResolvedValue(makeReview({ productId: 'product-1' }));
      prisma.review.update.mockResolvedValue(makeReview({ status: 'APPROVED' }));
      prisma.$executeRaw.mockResolvedValue(1);

      await service.adminUpdateStatus('review-1', { action: 'approve' });

      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APPROVED' }),
        }),
      );
    });

    it('sets status to REJECTED on reject action', async () => {
      prisma.review.findUnique.mockResolvedValue(makeReview({ productId: 'product-1' }));
      prisma.review.update.mockResolvedValue(makeReview({ status: 'REJECTED' }));
      prisma.$executeRaw.mockResolvedValue(1);

      await service.adminUpdateStatus('review-1', { action: 'reject' });

      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REJECTED' }),
        }),
      );
    });

    it('trims adminReply and converts blank string to null', async () => {
      prisma.review.findUnique.mockResolvedValue(makeReview());
      prisma.review.update.mockResolvedValue(makeReview());
      prisma.$executeRaw.mockResolvedValue(1);

      await service.adminUpdateStatus('review-1', { action: 'approve', adminReply: '   ' });

      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ adminReply: null }),
        }),
      );
    });

    it('preserves non-empty adminReply text', async () => {
      prisma.review.findUnique.mockResolvedValue(makeReview());
      prisma.review.update.mockResolvedValue(makeReview());
      prisma.$executeRaw.mockResolvedValue(1);

      await service.adminUpdateStatus('review-1', {
        action: 'approve',
        adminReply: '  Thank you!  ',
      });

      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ adminReply: 'Thank you!' }),
        }),
      );
    });

    it('does not include adminReply in update when not provided', async () => {
      prisma.review.findUnique.mockResolvedValue(makeReview());
      prisma.review.update.mockResolvedValue(makeReview());
      prisma.$executeRaw.mockResolvedValue(1);

      await service.adminUpdateStatus('review-1', { action: 'approve' });

      const updateArgs = prisma.review.update.mock.calls[0][0];
      expect(updateArgs.data).not.toHaveProperty('adminReply');
    });

    it('calls updateProductStats after status change', async () => {
      prisma.review.findUnique.mockResolvedValue(makeReview({ productId: 'product-1' }));
      prisma.review.update.mockResolvedValue(makeReview());
      prisma.$executeRaw.mockResolvedValue(1);

      await service.adminUpdateStatus('review-1', { action: 'approve' });

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });

  // ─── adminDelete ─────────────────────────────────────────────────────────

  describe('adminDelete', () => {
    it('throws NotFoundException when review does not exist', async () => {
      prisma.review.findUnique.mockResolvedValue(null);

      await expect(service.adminDelete('review-1')).rejects.toThrow(NotFoundException);
    });

    it('deletes the review', async () => {
      prisma.review.findUnique.mockResolvedValue(makeReview({ productId: 'product-1' }));
      prisma.review.delete.mockResolvedValue(undefined);
      prisma.$executeRaw.mockResolvedValue(1);

      await service.adminDelete('review-1');

      expect(prisma.review.delete).toHaveBeenCalledWith({ where: { id: 'review-1' } });
    });

    it('calls updateProductStats after deletion', async () => {
      prisma.review.findUnique.mockResolvedValue(makeReview({ productId: 'product-1' }));
      prisma.review.delete.mockResolvedValue(undefined);
      prisma.$executeRaw.mockResolvedValue(1);

      await service.adminDelete('review-1');

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });

  // ─── updateProductStats ──────────────────────────────────────────────────

  describe('updateProductStats', () => {
    it('executes a single raw SQL statement', async () => {
      prisma.$executeRaw.mockResolvedValue(1);

      await service.updateProductStats('product-1');

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });
});
