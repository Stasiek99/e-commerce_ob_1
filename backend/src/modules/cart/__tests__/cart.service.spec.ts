import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CartService } from '../cart.service';
import { PrismaService } from '../../prisma/prisma.service';

const makeVariant = (overrides: Partial<{ stock: number; isActive: boolean }> = {}) => ({
  id: 'pv-1',
  stock: 10,
  isActive: true,
  priceInCents: 4999,
  label: '50ml',
  sku: 'SKU-001',
  weight: 200,
  ...overrides,
});

const makeCart = (id = 'cart-1') => ({
  id,
  userId: null,
  sessionId: 'sess-1',
  items: [],
});

const makeCartItem = (qty = 2) => ({
  id: 'ci-1',
  cartId: 'cart-1',
  productVariantId: 'pv-1',
  quantity: qty,
  productVariant: {
    priceInCents: 4999,
    label: '50ml',
    sku: 'SKU-001',
    stock: 10,
    product: { name: 'Perfume', slug: 'perfume', images: [] },
  },
});

describe('CartService', () => {
  let service: CartService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        {
          provide: PrismaService,
          useValue: {
            productVariant: { findUnique: jest.fn() },
            cart: {
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            cartItem: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              deleteMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get(CartService);
    prisma = module.get(PrismaService);
  });

  describe('addItem', () => {
    it('throws NotFoundException when variant does not exist', async () => {
      prisma.productVariant.findUnique.mockResolvedValue(null);

      await expect(service.addItem(undefined, 'sess-1', 'pv-1', 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when variant is inactive', async () => {
      prisma.productVariant.findUnique.mockResolvedValue(makeVariant({ isActive: false }));

      await expect(service.addItem(undefined, 'sess-1', 'pv-1', 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when requested quantity exceeds stock', async () => {
      prisma.productVariant.findUnique.mockResolvedValue(makeVariant({ stock: 3 }));
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      prisma.cartItem.findUnique.mockResolvedValue(null);

      await expect(service.addItem(undefined, 'sess-1', 'pv-1', 5)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates a new cart if one does not exist', async () => {
      const cartWithItem = { ...makeCart(), items: [makeCartItem(1)] };
      prisma.productVariant.findUnique.mockResolvedValue(makeVariant());
      prisma.cart.findFirst
        .mockResolvedValueOnce(null) // findCart (addItem)
        .mockResolvedValueOnce(cartWithItem); // findCart (getOrCreate after add)
      prisma.cart.create.mockResolvedValue(makeCart());
      prisma.cartItem.findUnique.mockResolvedValue(null);
      prisma.cartItem.create.mockResolvedValue({});

      await service.addItem(undefined, 'sess-1', 'pv-1', 1);

      expect(prisma.cart.create).toHaveBeenCalledTimes(1);
    });

    it('creates a new cart item when variant is not yet in cart', async () => {
      const cartWithItem = { ...makeCart(), items: [makeCartItem(1)] };
      prisma.productVariant.findUnique.mockResolvedValue(makeVariant());
      prisma.cart.findFirst
        .mockResolvedValueOnce(makeCart())
        .mockResolvedValueOnce(cartWithItem);
      prisma.cartItem.findUnique.mockResolvedValue(null);
      prisma.cartItem.create.mockResolvedValue({});

      await service.addItem(undefined, 'sess-1', 'pv-1', 1);

      expect(prisma.cartItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ productVariantId: 'pv-1', quantity: 1 }),
        }),
      );
    });

    it('increments quantity when variant is already in cart', async () => {
      const existing = { id: 'ci-1', cartId: 'cart-1', productVariantId: 'pv-1', quantity: 2 };
      const cartWithItem = { ...makeCart(), items: [makeCartItem(3)] };
      prisma.productVariant.findUnique.mockResolvedValue(makeVariant({ stock: 10 }));
      prisma.cart.findFirst
        .mockResolvedValueOnce(makeCart())
        .mockResolvedValueOnce(cartWithItem);
      prisma.cartItem.findUnique.mockResolvedValue(existing);
      prisma.cartItem.update.mockResolvedValue({});

      await service.addItem(undefined, 'sess-1', 'pv-1', 1);

      expect(prisma.cartItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { quantity: 3 } }),
      );
    });

    it('throws BadRequestException when cumulative quantity exceeds stock', async () => {
      const existing = { id: 'ci-1', cartId: 'cart-1', productVariantId: 'pv-1', quantity: 8 };
      prisma.productVariant.findUnique.mockResolvedValue(makeVariant({ stock: 10 }));
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      prisma.cartItem.findUnique.mockResolvedValue(existing);

      await expect(service.addItem(undefined, 'sess-1', 'pv-1', 5)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('mergeGuestCart', () => {
    it('does nothing when no guest cart exists', async () => {
      prisma.cart.findFirst.mockResolvedValue(null);

      await service.mergeGuestCart('user-1', 'sess-1');

      expect(prisma.cart.update).not.toHaveBeenCalled();
      expect(prisma.cartItem.create).not.toHaveBeenCalled();
    });

    it('does nothing when guest cart is empty', async () => {
      prisma.cart.findFirst.mockResolvedValue({ ...makeCart(), items: [] });

      await service.mergeGuestCart('user-1', 'sess-1');

      expect(prisma.cart.update).not.toHaveBeenCalled();
    });

    it('claims guest cart by assigning userId when user has no cart', async () => {
      const guestCart = { ...makeCart(), items: [{ productVariantId: 'pv-1', quantity: 2 }] };
      prisma.cart.findFirst
        .mockResolvedValueOnce(guestCart) // guest cart lookup
        .mockResolvedValueOnce(null); // user cart lookup
      prisma.cart.update.mockResolvedValue({});

      await service.mergeGuestCart('user-1', 'sess-1');

      expect(prisma.cart.update).toHaveBeenCalledWith({
        where: { id: 'cart-1' },
        data: { userId: 'user-1', sessionId: null },
      });
      expect(prisma.cartItem.create).not.toHaveBeenCalled();
    });

    it('merges items into user cart and deletes guest cart', async () => {
      const guestCart = {
        id: 'guest-cart',
        items: [{ productVariantId: 'pv-1', quantity: 2 }],
      };
      const userCart = { id: 'user-cart' };
      prisma.cart.findFirst
        .mockResolvedValueOnce(guestCart) // guest cart
        .mockResolvedValueOnce(userCart); // user cart
      prisma.cartItem.findUnique.mockResolvedValue(null); // variant not in user cart
      prisma.cartItem.create.mockResolvedValue({});
      prisma.cart.delete.mockResolvedValue({});

      await service.mergeGuestCart('user-1', 'sess-1');

      expect(prisma.cartItem.create).toHaveBeenCalledWith({
        data: { cartId: 'user-cart', productVariantId: 'pv-1', quantity: 2 },
      });
      expect(prisma.cart.delete).toHaveBeenCalledWith({ where: { id: 'guest-cart' } });
    });

    it('increments existing items in user cart during merge (quantity accumulation)', async () => {
      const guestCart = {
        id: 'guest-cart',
        items: [{ productVariantId: 'pv-1', quantity: 3 }],
      };
      const userCart = { id: 'user-cart' };
      const existingItem = { id: 'ci-1', quantity: 2 };
      prisma.cart.findFirst
        .mockResolvedValueOnce(guestCart)
        .mockResolvedValueOnce(userCart);
      prisma.cartItem.findUnique.mockResolvedValue(existingItem);
      prisma.cartItem.update.mockResolvedValue({});
      prisma.cart.delete.mockResolvedValue({});

      await service.mergeGuestCart('user-1', 'sess-1');

      expect(prisma.cartItem.update).toHaveBeenCalledWith({
        where: { id: 'ci-1' },
        data: { quantity: 5 },
      });
      expect(prisma.cart.delete).toHaveBeenCalledWith({ where: { id: 'guest-cart' } });
    });
  });

  describe('getOrCreate', () => {
    it('returns existing cart when found', async () => {
      const fullCart = {
        ...makeCart(),
        items: [makeCartItem(1)],
      };
      prisma.cart.findFirst.mockResolvedValue(fullCart);

      const result = await service.getOrCreate('user-1', undefined);

      expect(prisma.cart.create).not.toHaveBeenCalled();
      expect(result.id).toBe('cart-1');
    });

    it('creates a new cart when none exists', async () => {
      const emptyCart = { ...makeCart(), items: [] };
      prisma.cart.findFirst.mockResolvedValue(null);
      prisma.cart.create.mockResolvedValue(emptyCart);

      const result = await service.getOrCreate(undefined, 'sess-1');

      expect(prisma.cart.create).toHaveBeenCalledTimes(1);
      expect(result.items).toHaveLength(0);
    });
  });

  describe('updateItem', () => {
    it('throws NotFoundException when cart does not exist', async () => {
      prisma.cart.findFirst.mockResolvedValue(null);

      await expect(
        service.updateItem(undefined, 'sess-1', 'pv-1', 2),
      ).rejects.toThrow(NotFoundException);
    });

    it('delegates to removeItem when quantity is 0 or less', async () => {
      prisma.cart.findFirst.mockResolvedValue({ ...makeCart(), items: [] });
      prisma.cartItem.deleteMany.mockResolvedValue({});

      await service.updateItem(undefined, 'sess-1', 'pv-1', 0);

      expect(prisma.cartItem.deleteMany).toHaveBeenCalled();
    });

    it('throws BadRequestException when requested quantity exceeds stock', async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      prisma.productVariant.findUnique.mockResolvedValue(makeVariant({ stock: 1 }));

      await expect(
        service.updateItem(undefined, 'sess-1', 'pv-1', 5),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates item quantity when stock is sufficient', async () => {
      const cart = makeCart();
      const cartWithItem = { ...cart, items: [makeCartItem(3)] };
      prisma.cart.findFirst
        .mockResolvedValueOnce(cart)
        .mockResolvedValueOnce(cartWithItem);
      prisma.productVariant.findUnique.mockResolvedValue(makeVariant({ stock: 10 }));
      prisma.cartItem.updateMany.mockResolvedValue({});

      await service.updateItem(undefined, 'sess-1', 'pv-1', 3);

      expect(prisma.cartItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { quantity: 3 } }),
      );
    });
  });

  describe('removeItem', () => {
    it('throws NotFoundException when cart does not exist', async () => {
      prisma.cart.findFirst.mockResolvedValue(null);

      await expect(
        service.removeItem(undefined, 'sess-1', 'pv-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deletes the item and returns the updated cart', async () => {
      const cart = makeCart();
      const emptyCart = { ...cart, items: [] };
      prisma.cart.findFirst
        .mockResolvedValueOnce(cart)      // removeItem → findCart
        .mockResolvedValueOnce(emptyCart); // getOrCreate → findCart
      prisma.cartItem.deleteMany.mockResolvedValue({});

      const result = await service.removeItem(undefined, 'sess-1', 'pv-1');

      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId: 'cart-1', productVariantId: 'pv-1' },
      });
      expect(result.items).toHaveLength(0);
    });
  });
});
