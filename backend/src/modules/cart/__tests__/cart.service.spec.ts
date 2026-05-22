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

// Minimal tx stub reused across addItem tests — mirrors the real PrismaService shape
// that the transaction callback receives.
const makeTx = (overrides: Record<string, any> = {}) => ({
  $queryRaw: jest.fn(),
  cart: { findFirst: jest.fn(), create: jest.fn() },
  cartItem: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  ...overrides,
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
            $transaction: jest.fn(),
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
    // Helper: wire $transaction so its callback runs with the provided tx stub.
    // The outer prisma mock is used only by getOrCreate (called after the transaction).
    const setupTx = (tx: ReturnType<typeof makeTx>) => {
      prisma.$transaction.mockImplementation((fn: (tx: any) => Promise<any>) => fn(tx));
    };

    it('throws NotFoundException when variant does not exist', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([]); // no rows → variant not found
      setupTx(tx);

      await expect(service.addItem(undefined, 'sess-1', 'pv-1', 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when variant is inactive', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'pv-1', isActive: false, stock: 10 }]);
      setupTx(tx);

      await expect(service.addItem(undefined, 'sess-1', 'pv-1', 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when requested quantity exceeds stock', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'pv-1', isActive: true, stock: 3 }]);
      tx.cart.findFirst.mockResolvedValue(makeCart());
      tx.cartItem.findUnique.mockResolvedValue(null);
      setupTx(tx);

      await expect(service.addItem(undefined, 'sess-1', 'pv-1', 5)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates a new cart if one does not exist', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'pv-1', isActive: true, stock: 10 }]);
      tx.cart.findFirst.mockResolvedValue(null);
      tx.cart.create.mockResolvedValue(makeCart());
      tx.cartItem.findUnique.mockResolvedValue(null);
      tx.cartItem.create.mockResolvedValue({});
      setupTx(tx);

      const cartWithItem = { ...makeCart(), items: [makeCartItem(1)] };
      prisma.cart.findFirst.mockResolvedValue(cartWithItem); // getOrCreate re-fetch

      await service.addItem(undefined, 'sess-1', 'pv-1', 1);

      expect(tx.cart.create).toHaveBeenCalledTimes(1);
    });

    it('creates a new cart item when variant is not yet in cart', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'pv-1', isActive: true, stock: 10 }]);
      tx.cart.findFirst.mockResolvedValue(makeCart());
      tx.cartItem.findUnique.mockResolvedValue(null);
      tx.cartItem.create.mockResolvedValue({});
      setupTx(tx);

      const cartWithItem = { ...makeCart(), items: [makeCartItem(1)] };
      prisma.cart.findFirst.mockResolvedValue(cartWithItem); // getOrCreate re-fetch

      await service.addItem(undefined, 'sess-1', 'pv-1', 1);

      expect(tx.cartItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ productVariantId: 'pv-1', quantity: 1 }),
        }),
      );
    });

    it('increments quantity when variant is already in cart', async () => {
      const existing = { id: 'ci-1', cartId: 'cart-1', productVariantId: 'pv-1', quantity: 2 };
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'pv-1', isActive: true, stock: 10 }]);
      tx.cart.findFirst.mockResolvedValue(makeCart());
      tx.cartItem.findUnique.mockResolvedValue(existing);
      tx.cartItem.update.mockResolvedValue({});
      setupTx(tx);

      const cartWithItem = { ...makeCart(), items: [makeCartItem(3)] };
      prisma.cart.findFirst.mockResolvedValue(cartWithItem); // getOrCreate re-fetch

      await service.addItem(undefined, 'sess-1', 'pv-1', 1);

      expect(tx.cartItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { quantity: 3 } }),
      );
    });

    it('throws BadRequestException when cumulative quantity exceeds stock', async () => {
      const existing = { id: 'ci-1', cartId: 'cart-1', productVariantId: 'pv-1', quantity: 8 };
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'pv-1', isActive: true, stock: 10 }]);
      tx.cart.findFirst.mockResolvedValue(makeCart());
      tx.cartItem.findUnique.mockResolvedValue(existing);
      setupTx(tx);

      // existing qty 8 + requested 5 = 13 > stock 10
      await expect(service.addItem(undefined, 'sess-1', 'pv-1', 5)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('FOR UPDATE lock serializes concurrent adds: second caller sees updated stock', async () => {
      // Simulate what happens in production: after the first transaction commits,
      // the row lock is released and the next caller reads the fresh (decremented) stock.
      // Here we verify that the service correctly rejects when $queryRaw returns a
      // stock value that already reflects a prior caller's reservation.
      const tx = makeTx();
      // Stock is 0 — a concurrent request already reserved the last unit
      tx.$queryRaw.mockResolvedValue([{ id: 'pv-1', isActive: true, stock: 0 }]);
      tx.cart.findFirst.mockResolvedValue(makeCart()); // reach the stock check
      tx.cartItem.findUnique.mockResolvedValue(null);
      setupTx(tx);

      // Requesting qty=1 against stock=0 must be rejected
      await expect(service.addItem(undefined, 'sess-1', 'pv-1', 1)).rejects.toThrow(
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
