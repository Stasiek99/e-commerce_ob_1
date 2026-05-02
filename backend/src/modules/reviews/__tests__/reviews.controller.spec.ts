import { Test, TestingModule } from '@nestjs/testing';
import { ReviewsController } from '../reviews.controller';
import { ReviewsService } from '../reviews.service';

const mockPage = {
  data: [],
  meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
};

describe('ReviewsController', () => {
  let controller: ReviewsController;
  let service: jest.Mocked<ReviewsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReviewsController],
      providers: [
        {
          provide: ReviewsService,
          useValue: {
            getByProduct: jest.fn(),
            create: jest.fn(),
            markHelpful: jest.fn(),
            getMine: jest.fn(),
            adminUpdateStatus: jest.fn(),
            adminDelete: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(ReviewsController);
    service = module.get(ReviewsService) as jest.Mocked<ReviewsService>;
  });

  afterEach(() => jest.clearAllMocks());

  // ─── GET /reviews/product/:productId ─────────────────────────────────────

  describe('getByProduct', () => {
    it('delegates to ReviewsService.getByProduct with numeric page and limit', async () => {
      service.getByProduct.mockResolvedValue(mockPage);

      const result = await controller.getByProduct('product-1', '2', '20', 'helpful');

      expect(service.getByProduct).toHaveBeenCalledWith('product-1', 2, 20, 'helpful');
      expect(result).toBe(mockPage);
    });

    it('passes default values (page=1, limit=10, sort=recent) when omitted', async () => {
      service.getByProduct.mockResolvedValue(mockPage);

      await controller.getByProduct('product-1');

      expect(service.getByProduct).toHaveBeenCalledWith('product-1', 1, 10, 'recent');
    });

    it('converts page and limit strings to numbers', async () => {
      service.getByProduct.mockResolvedValue(mockPage);

      await controller.getByProduct('product-1', '3', '5', 'recent');

      const [, page, limit] = service.getByProduct.mock.calls[0];
      expect(typeof page).toBe('number');
      expect(typeof limit).toBe('number');
      expect(page).toBe(3);
      expect(limit).toBe(5);
    });
  });

  // ─── POST /reviews ────────────────────────────────────────────────────────

  describe('create', () => {
    it('delegates to ReviewsService.create using current user id', async () => {
      const user = { id: 'user-1' } as any;
      const dto = { productId: 'product-1', rating: 5 };
      service.create.mockResolvedValue({ id: 'review-new' } as any);

      await controller.create(user, dto);

      expect(service.create).toHaveBeenCalledWith('user-1', dto);
    });
  });

  // ─── POST /reviews/:id/helpful ────────────────────────────────────────────

  describe('markHelpful', () => {
    it('delegates to ReviewsService.markHelpful with the review id', async () => {
      service.markHelpful.mockResolvedValue({ id: 'review-1', helpfulCount: 5 });

      const result = await controller.markHelpful('review-1');

      expect(service.markHelpful).toHaveBeenCalledWith('review-1');
      expect(result).toEqual({ id: 'review-1', helpfulCount: 5 });
    });
  });

  // ─── GET /reviews/mine ────────────────────────────────────────────────────

  describe('getMine', () => {
    it('delegates to ReviewsService.getMine using current user id', async () => {
      const user = { id: 'user-1' } as any;
      service.getMine.mockResolvedValue([]);

      await controller.getMine(user);

      expect(service.getMine).toHaveBeenCalledWith('user-1');
    });
  });

  // ─── PATCH /reviews/admin/:id/status ─────────────────────────────────────

  describe('updateStatus', () => {
    it('delegates to ReviewsService.adminUpdateStatus', async () => {
      const dto = { action: 'approve' as const };
      service.adminUpdateStatus.mockResolvedValue({ id: 'review-1' } as any);

      await controller.updateStatus('review-1', dto);

      expect(service.adminUpdateStatus).toHaveBeenCalledWith('review-1', dto);
    });

    it('propagates reject action', async () => {
      const dto = { action: 'reject' as const, adminReply: 'Not appropriate' };
      service.adminUpdateStatus.mockResolvedValue({ id: 'review-1' } as any);

      await controller.updateStatus('review-1', dto);

      expect(service.adminUpdateStatus).toHaveBeenCalledWith('review-1', dto);
    });
  });

  // ─── DELETE /reviews/admin/:id ────────────────────────────────────────────

  describe('delete', () => {
    it('delegates to ReviewsService.adminDelete', async () => {
      service.adminDelete.mockResolvedValue(undefined);

      await controller.delete('review-1');

      expect(service.adminDelete).toHaveBeenCalledWith('review-1');
    });
  });
});
