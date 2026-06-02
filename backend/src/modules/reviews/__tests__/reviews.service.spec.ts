import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { OrderStatus, Prisma } from '@prisma/client';
import { ReviewsService } from '../reviews.service';
import { PrismaService } from '../../prisma/prisma.service';

const VERIFIED_USER = { isEmailVerified: true, createdAt: new Date('2020-01-01') };
const UNVERIFIED_USER = { isEmailVerified: false, createdAt: new Date('2020-01-01') };

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
            user: { findUnique: jest.fn() },
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
            reviewHelpfulVote: {
              create: jest.fn(),
            },
            $transaction: jest.fn().mockResolvedValue([{}, {}]),
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
    const dto = { productId: 'product-1', orderId: 'order-1', rating: 5 };
    const validOrder = {
      id: 'order-1',
      status: OrderStatus.DELIVERED,
      createdAt: new Date('2020-01-01'),
      items: [{ productVariant: { productId: 'product-1' } }],
    };

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(VERIFIED_USER);
    });

    it('creates review with PENDING status when order is DELIVERED', async () => {
      prisma.order.findFirst.mockResolvedValue(validOrder);
      prisma.product.findUnique.mockResolvedValue({ id: 'product-1', isActive: true });
      prisma.review.create.mockResolvedValue(makeReview({ status: 'PENDING', orderId: 'order-1' }));

      await service.create('user-1', dto);

      expect(prisma.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productId: 'product-1',
            userId: 'user-1',
            orderId: 'order-1',
            status: 'PENDING',
          }),
        }),
      );
    });

    it('throws NotFoundException when order not found', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(service.create('user-1', dto)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when order status is not DELIVERED', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.PAID,
        items: [{ productVariant: { productId: 'product-1' } }],
      });

      await expect(service.create('user-1', dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when reviewed product is not in the given order', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.DELIVERED,
        items: [{ productVariant: { productId: 'other-product' } }],
      });

      await expect(service.create('user-1', dto)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when product does not exist', async () => {
      prisma.order.findFirst.mockResolvedValue(validOrder);
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.create('user-1', dto)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when product is inactive', async () => {
      prisma.order.findFirst.mockResolvedValue(validOrder);
      prisma.product.findUnique.mockResolvedValue({ id: 'product-1', isActive: false });

      await expect(service.create('user-1', dto)).rejects.toThrow(NotFoundException);
    });

    it('trims whitespace from title and body', async () => {
      prisma.order.findFirst.mockResolvedValue(validOrder);
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
      prisma.order.findFirst.mockResolvedValue(validOrder);
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
      prisma.order.findFirst.mockResolvedValue(validOrder);
      prisma.product.findUnique.mockResolvedValue({ id: 'product-1', isActive: true });
      prisma.review.create.mockResolvedValue(makeReview({ orderId: 'order-1' }));

      await service.create('user-1', dto);

      expect(prisma.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderId: 'order-1' }),
        }),
      );
    });

    it('always performs order lookup before creating a review', async () => {
      prisma.order.findFirst.mockResolvedValue(validOrder);
      prisma.product.findUnique.mockResolvedValue({ id: 'product-1', isActive: true });
      prisma.review.create.mockResolvedValue(makeReview());

      await service.create('user-1', dto);

      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'order-1', userId: 'user-1' } }),
      );
    });

    // ── duplicate review guard (fix #41) ──────────────────────────────────────
    // Invariant: Prisma P2002 (@@unique[userId, productId] violation) must map
    // to a 409 ConflictException rather than propagating as an unhandled 500.

    it('throws ConflictException when user has already reviewed this product', async () => {
      prisma.order.findFirst.mockResolvedValue(validOrder);
      prisma.product.findUnique.mockResolvedValue({ id: 'product-1', isActive: true });

      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`userId`,`productId`)',
        { code: 'P2002', clientVersion: '5.0.0', meta: { target: ['userId', 'productId'] } },
      );
      prisma.review.create.mockRejectedValue(p2002);

      await expect(service.create('user-1', dto)).rejects.toThrow(ConflictException);
    });

    it('includes a descriptive message in the ConflictException', async () => {
      prisma.order.findFirst.mockResolvedValue(validOrder);
      prisma.product.findUnique.mockResolvedValue({ id: 'product-1', isActive: true });

      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0.0', meta: { target: ['userId', 'productId'] } },
      );
      prisma.review.create.mockRejectedValue(p2002);

      await expect(service.create('user-1', dto)).rejects.toThrow(
        'You have already reviewed this product',
      );
    });

    it('re-throws non-P2002 Prisma errors unchanged', async () => {
      prisma.order.findFirst.mockResolvedValue(validOrder);
      prisma.product.findUnique.mockResolvedValue({ id: 'product-1', isActive: true });

      const p2003 = new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint failed',
        { code: 'P2003', clientVersion: '5.0.0', meta: {} },
      );
      prisma.review.create.mockRejectedValue(p2003);

      await expect(service.create('user-1', dto)).rejects.toThrow(p2003);
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

      await expect(service.markHelpful('review-1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when review is not APPROVED', async () => {
      prisma.review.findUnique.mockResolvedValue(makeReview({ status: 'PENDING' }));

      await expect(service.markHelpful('review-1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('also throws NotFoundException for REJECTED reviews', async () => {
      prisma.review.findUnique.mockResolvedValue(makeReview({ status: 'REJECTED' }));

      await expect(service.markHelpful('review-1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('executes vote creation and helpfulCount increment atomically via $transaction', async () => {
      prisma.review.findUnique
        .mockResolvedValueOnce(makeReview({ status: 'APPROVED' })) // guard lookup
        .mockResolvedValueOnce({ id: 'review-1', helpfulCount: 1 }); // return value lookup
      prisma.$transaction.mockResolvedValue([{}, {}]);

      await service.markHelpful('review-1', 'user-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    // Fix #29 — duplicate vote guard (one vote per user per review)
    it('throws ConflictException when the user has already voted (P2002 unique constraint)', async () => {
      prisma.review.findUnique.mockResolvedValue(makeReview({ status: 'APPROVED' }));
      const dupError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`review_id`,`user_id`)',
        { code: 'P2002', clientVersion: '6.0.0' },
      );
      prisma.$transaction.mockRejectedValue(dupError);

      await expect(service.markHelpful('review-1', 'user-1')).rejects.toThrow(ConflictException);
    });

    it('re-throws non-unique-constraint errors from $transaction unchanged', async () => {
      prisma.review.findUnique.mockResolvedValue(makeReview({ status: 'APPROVED' }));
      prisma.$transaction.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.markHelpful('review-1', 'user-1')).rejects.toThrow('DB connection lost');
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

    it('interpolates the productId into the SQL query', async () => {
      prisma.$executeRaw.mockResolvedValue(1);

      await service.updateProductStats('product-xyz');

      // Tagged template literals are called as (templateStrings, ...values).
      // productId appears 3 times in the SQL template — first interpolated arg is productId.
      const rawCallArgs: unknown[] = prisma.$executeRaw.mock.calls[0];
      const interpolatedValues = rawCallArgs.slice(1);
      expect(interpolatedValues).toContain('product-xyz');
    });
  });

  // ─── create (additional edge cases) ──────────────────────────────────────

  describe('create — additional edge cases', () => {
    const dto = { productId: 'product-1', orderId: 'order-1', rating: 4 };
    const validOrder = {
      id: 'order-1',
      status: OrderStatus.DELIVERED,
      createdAt: new Date('2020-01-01'),
      items: [{ productVariant: { productId: 'product-1' } }],
    };

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(VERIFIED_USER);
    });

    it('stores empty string title as-is (not coerced to null)', async () => {
      prisma.order.findFirst.mockResolvedValue(validOrder);
      prisma.product.findUnique.mockResolvedValue({ id: 'product-1', isActive: true });
      prisma.review.create.mockResolvedValue(makeReview({ title: '' }));

      await service.create('user-1', { ...dto, title: '' });

      // `''.trim() ?? null` returns '' because '' is not null/undefined.
      // This test documents current behavior; a stricter impl would use `|| null`.
      expect(prisma.review.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: '' }),
        }),
      );
    });

    it('propagates Prisma unique-constraint error for duplicate (userId, productId) review', async () => {
      const uniqueError = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      });
      prisma.order.findFirst.mockResolvedValue(validOrder);
      prisma.product.findUnique.mockResolvedValue({ id: 'product-1', isActive: true });
      prisma.review.create.mockRejectedValue(uniqueError);

      await expect(service.create('user-1', dto)).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  // ─── getByProduct (additional edge cases) ────────────────────────────────

  describe('getByProduct — additional edge cases', () => {
    it('uses skip=0 for first page', async () => {
      prisma.review.findMany.mockResolvedValue([]);
      prisma.review.count.mockResolvedValue(0);

      await service.getByProduct('product-1', 1, 10);

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
    });

    it('returns empty data and totalPages=0 when product has no approved reviews', async () => {
      prisma.review.findMany.mockResolvedValue([]);
      prisma.review.count.mockResolvedValue(0);

      const result = await service.getByProduct('product-1');

      expect(result.data).toHaveLength(0);
      expect(result.meta.totalPages).toBe(0);
      expect(result.meta.total).toBe(0);
    });

    it('formats authorName as "L." when firstName is null but lastName exists', async () => {
      prisma.review.findMany.mockResolvedValue([
        {
          id: 'r-1',
          rating: 3,
          title: null,
          body: null,
          adminReply: null,
          helpfulCount: 0,
          createdAt: new Date(),
          orderId: null,
          user: { firstName: null, lastName: 'Smith' },
        },
      ]);
      prisma.review.count.mockResolvedValue(1);

      const result = await service.getByProduct('product-1');

      // Only last-name initial with no first name — documents actual behavior.
      expect(result.data[0].authorName).toBe('S.');
    });
  });

  // ─── getMine (additional edge cases) ─────────────────────────────────────

  describe('getMine — additional edge cases', () => {
    it('returns empty array when user has no reviews', async () => {
      prisma.review.findMany.mockResolvedValue([]);

      const result = await service.getMine('user-1');

      expect(result).toEqual([]);
    });

    it('orders by createdAt descending', async () => {
      prisma.review.findMany.mockResolvedValue([]);

      await service.getMine('user-1');

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });
  });

  // ─── markHelpful (additional edge cases) ─────────────────────────────────

  describe('markHelpful — additional edge cases', () => {
    it('returns the updated helpfulCount from a post-transaction findUnique', async () => {
      prisma.review.findUnique
        .mockResolvedValueOnce(makeReview({ status: 'APPROVED' })) // guard lookup
        .mockResolvedValueOnce({ id: 'review-1', helpfulCount: 7 }); // return value
      prisma.$transaction.mockResolvedValue([{}, {}]);

      const result = await service.markHelpful('review-1', 'user-1');

      expect(result).toEqual({ id: 'review-1', helpfulCount: 7 });
    });
  });

  // ─── adminUpdateStatus (additional edge cases) ────────────────────────────

  describe('adminUpdateStatus — additional edge cases', () => {
    it("passes the review's own productId to updateProductStats", async () => {
      const targetProductId = 'product-specific-42';
      prisma.review.findUnique.mockResolvedValue(makeReview({ productId: targetProductId }));
      prisma.review.update.mockResolvedValue(makeReview());
      prisma.$executeRaw.mockResolvedValue(1);

      await service.adminUpdateStatus('review-1', { action: 'approve' });

      const interpolatedValues: unknown[] = prisma.$executeRaw.mock.calls[0].slice(1);
      expect(interpolatedValues).toContain(targetProductId);
    });
  });

  // ─── adminDelete (additional edge cases) ─────────────────────────────────

  describe('adminDelete — additional edge cases', () => {
    it("passes the review's own productId to updateProductStats after deletion", async () => {
      const targetProductId = 'product-specific-99';
      prisma.review.findUnique.mockResolvedValue(makeReview({ productId: targetProductId }));
      prisma.review.delete.mockResolvedValue(undefined);
      prisma.$executeRaw.mockResolvedValue(1);

      await service.adminDelete('review-1');

      const interpolatedValues: unknown[] = prisma.$executeRaw.mock.calls[0].slice(1);
      expect(interpolatedValues).toContain(targetProductId);
    });
  });

  // ─── create — email verification gate ────────────────────────────────────────

  describe('create — email verification gate', () => {
    const dto = { productId: 'product-1', orderId: 'order-1', rating: 5 };

    it('throws NotFoundException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.create('ghost-user', dto)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when user email is not verified', async () => {
      prisma.user.findUnique.mockResolvedValue(UNVERIFIED_USER);

      await expect(service.create('user-1', dto)).rejects.toThrow(ForbiddenException);
    });

    it('does not proceed to order lookup when email is not verified', async () => {
      prisma.user.findUnique.mockResolvedValue(UNVERIFIED_USER);

      await service.create('user-1', dto).catch(() => {});

      expect(prisma.order.findFirst).not.toHaveBeenCalled();
    });

    it('allows review creation when user email is verified', async () => {
      prisma.user.findUnique.mockResolvedValue(VERIFIED_USER);
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.DELIVERED,
        createdAt: new Date('2020-01-01'),
        items: [{ productVariant: { productId: 'product-1' } }],
      });
      prisma.product.findUnique.mockResolvedValue({ id: 'product-1', isActive: true });
      prisma.review.create.mockResolvedValue({ id: 'review-1', status: 'PENDING' });

      await expect(service.create('user-1', dto)).resolves.toMatchObject({ status: 'PENDING' });
    });
  });

  // ─── create — suspicious activity detection ───────────────────────────────────

  describe('create — suspicious activity detection', () => {
    const dto = { productId: 'product-1', orderId: 'order-1', rating: 5 };
    let sentrySpy: jest.SpyInstance;

    beforeEach(() => {
      sentrySpy = jest.spyOn(Sentry, 'captureMessage').mockReturnValue(undefined as any);

      prisma.product.findUnique.mockResolvedValue({ id: 'product-1', isActive: true });
      prisma.review.create.mockResolvedValue({ id: 'review-1', status: 'PENDING' });
    });

    const recentOrder = {
      id: 'order-1',
      status: OrderStatus.DELIVERED,
      createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
      items: [{ productVariant: { productId: 'product-1' } }],
    };

    const oldOrder = {
      id: 'order-1',
      status: OrderStatus.DELIVERED,
      createdAt: new Date('2020-01-01'),
      items: [{ productVariant: { productId: 'product-1' } }],
    };

    const newUser = { isEmailVerified: true, createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) };
    const oldUser = VERIFIED_USER;

    it('fires a Sentry warning when account and order are both created within 24h', async () => {
      prisma.user.findUnique.mockResolvedValue(newUser);
      prisma.order.findFirst.mockResolvedValue(recentOrder);

      await service.create('user-1', dto);

      expect(sentrySpy).toHaveBeenCalledWith(
        expect.stringContaining('Suspicious review activity'),
        'warning',
      );
    });

    it('includes the userId in the Sentry message', async () => {
      prisma.user.findUnique.mockResolvedValue(newUser);
      prisma.order.findFirst.mockResolvedValue(recentOrder);

      await service.create('user-1', dto);

      expect(sentrySpy).toHaveBeenCalledWith(
        expect.stringContaining('user-1'),
        'warning',
      );
    });

    it('does not alert Sentry when account is old even if order is recent', async () => {
      prisma.user.findUnique.mockResolvedValue(oldUser);
      prisma.order.findFirst.mockResolvedValue(recentOrder);

      await service.create('user-1', dto);

      expect(sentrySpy).not.toHaveBeenCalled();
    });

    it('does not alert Sentry when order is old even if account is new', async () => {
      prisma.user.findUnique.mockResolvedValue(newUser);
      prisma.order.findFirst.mockResolvedValue(oldOrder);

      await service.create('user-1', dto);

      expect(sentrySpy).not.toHaveBeenCalled();
    });

    it('does not alert Sentry for a normal verified user with an old order', async () => {
      prisma.user.findUnique.mockResolvedValue(oldUser);
      prisma.order.findFirst.mockResolvedValue(oldOrder);

      await service.create('user-1', dto);

      expect(sentrySpy).not.toHaveBeenCalled();
    });
  });
});
