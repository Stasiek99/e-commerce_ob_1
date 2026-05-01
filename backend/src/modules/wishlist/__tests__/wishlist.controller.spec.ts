import { Test, TestingModule } from '@nestjs/testing';
import { WishlistController } from '../wishlist.controller';
import { WishlistService } from '../wishlist.service';

const mockUser = { id: 'user-1' } as any;

const makeWishlistItem = (overrides: Partial<Record<string, any>> = {}) => ({
  id: 'product-1',
  name: 'Test Perfume',
  slug: 'test-perfume',
  brand: 'Maison',
  images: [{ url: 'https://cdn.example.com/img.jpg' }],
  variants: [{ id: 'var-1', label: '50ml', priceInCents: 9900, stock: 10 }],
  notifyOnRestock: false,
  ...overrides,
});

describe('WishlistController', () => {
  let controller: WishlistController;
  let service: jest.Mocked<WishlistService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WishlistController],
      providers: [
        {
          provide: WishlistService,
          useValue: {
            getItems: jest.fn(),
            addItem: jest.fn(),
            removeItem: jest.fn(),
            setNotify: jest.fn(),
            mergeGuestItems: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(WishlistController);
    service = module.get(WishlistService) as jest.Mocked<WishlistService>;
  });

  afterEach(() => jest.clearAllMocks());

  // ─── GET /wishlist ────────────────────────────────────────────────────────

  describe('getWishlist', () => {
    it('delegates to WishlistService.getItems using current user id', async () => {
      const items = [makeWishlistItem()];
      service.getItems.mockResolvedValue(items as any);

      const result = await controller.getWishlist(mockUser);

      expect(service.getItems).toHaveBeenCalledWith('user-1');
      expect(result).toBe(items);
    });

    it('returns empty array when wishlist is empty', async () => {
      service.getItems.mockResolvedValue([]);

      const result = await controller.getWishlist(mockUser);

      expect(result).toEqual([]);
    });

    it('passes the correct userId from the JWT user object', async () => {
      service.getItems.mockResolvedValue([]);

      await controller.getWishlist({ id: 'user-42' } as any);

      expect(service.getItems).toHaveBeenCalledWith('user-42');
    });
  });

  // ─── POST /wishlist/:productId ────────────────────────────────────────────

  describe('add', () => {
    it('delegates to WishlistService.addItem with userId and productId', async () => {
      service.addItem.mockResolvedValue(undefined);

      await controller.add(mockUser, 'product-1');

      expect(service.addItem).toHaveBeenCalledWith('user-1', 'product-1');
    });

    it('propagates NotFoundException when service throws', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      service.addItem.mockRejectedValue(new NotFoundException());

      await expect(controller.add(mockUser, 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── DELETE /wishlist/:productId ──────────────────────────────────────────

  describe('remove', () => {
    it('delegates to WishlistService.removeItem with userId and productId', async () => {
      service.removeItem.mockResolvedValue(undefined);

      await controller.remove(mockUser, 'product-1');

      expect(service.removeItem).toHaveBeenCalledWith('user-1', 'product-1');
    });

    it('does not throw when item does not exist (service is idempotent)', async () => {
      service.removeItem.mockResolvedValue(undefined);

      await expect(controller.remove(mockUser, 'nonexistent')).resolves.not.toThrow();
    });
  });

  // ─── PATCH /wishlist/:productId/notify ───────────────────────────────────

  describe('setNotify', () => {
    it('enables notify flag', async () => {
      service.setNotify.mockResolvedValue(undefined);

      await controller.setNotify(mockUser, 'product-1', true);

      expect(service.setNotify).toHaveBeenCalledWith('user-1', 'product-1', true);
    });

    it('disables notify flag', async () => {
      service.setNotify.mockResolvedValue(undefined);

      await controller.setNotify(mockUser, 'product-1', false);

      expect(service.setNotify).toHaveBeenCalledWith('user-1', 'product-1', false);
    });

    it('passes userId, productId, and notify value from request', async () => {
      service.setNotify.mockResolvedValue(undefined);

      await controller.setNotify({ id: 'user-99' } as any, 'product-abc', true);

      expect(service.setNotify).toHaveBeenCalledWith('user-99', 'product-abc', true);
    });
  });

  // ─── POST /wishlist/merge ─────────────────────────────────────────────────

  describe('mergeGuest', () => {
    it('delegates to WishlistService.mergeGuestItems with userId and productIds', async () => {
      service.mergeGuestItems.mockResolvedValue(undefined);

      await controller.mergeGuest(mockUser, { productIds: ['product-1', 'product-2'] });

      expect(service.mergeGuestItems).toHaveBeenCalledWith('user-1', ['product-1', 'product-2']);
    });

    it('passes empty array when dto has no productIds', async () => {
      service.mergeGuestItems.mockResolvedValue(undefined);

      await controller.mergeGuest(mockUser, { productIds: [] });

      expect(service.mergeGuestItems).toHaveBeenCalledWith('user-1', []);
    });

    it('passes the correct userId from the JWT user object', async () => {
      service.mergeGuestItems.mockResolvedValue(undefined);

      await controller.mergeGuest({ id: 'user-77' } as any, { productIds: ['p-1'] });

      expect(service.mergeGuestItems).toHaveBeenCalledWith('user-77', ['p-1']);
    });
  });
});
