import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CartService } from '../cart.service';
import { PrismaService } from '../../prisma/prisma.service';


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

// Minimal tx stub reused across transaction-based tests — mirrors the real PrismaService shape
// that the transaction callback receives.
const makeTx = (overrides: Record<string, any> = {}) => ({
  $queryRaw: jest.fn(),
  cart: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  cartItem: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  productVariant: { findUnique: jest.fn() },
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
      const existing = { id: 'ci-1', cartId: 'cart-1', productVariantId: 'pv-1', quantity: 1 };
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'pv-1', isActive: true, stock: 10 }]);
      tx.cart.findFirst.mockResolvedValue(makeCart());
      tx.cartItem.findUnique.mockResolvedValue(existing);
      tx.cartItem.update.mockResolvedValue({});
      setupTx(tx);

      const cartWithItem = { ...makeCart(), items: [makeCartItem(2)] };
      prisma.cart.findFirst.mockResolvedValue(cartWithItem); // getOrCreate re-fetch

      await service.addItem(undefined, 'sess-1', 'pv-1', 1);

      expect(tx.cartItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { quantity: 2 } }),
      );
    });

    it('throws BadRequestException when cumulative quantity exceeds MAX_CART_QTY_PER_VARIANT', async () => {
      const existing = { id: 'ci-1', cartId: 'cart-1', productVariantId: 'pv-1', quantity: 2 };
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'pv-1', isActive: true, stock: 10 }]);
      tx.cart.findFirst.mockResolvedValue(makeCart());
      tx.cartItem.findUnique.mockResolvedValue(existing);
      setupTx(tx);

      // existing qty 2 + requested 1 = 3 > MAX_CART_QTY_PER_VARIANT (2)
      await expect(service.addItem(undefined, 'sess-1', 'pv-1', 1)).rejects.toThrow(
        BadRequestException,
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
    // Wire $transaction so its callback runs with the provided tx stub.
    const setupMergeTx = (tx: ReturnType<typeof makeTx>) => {
      prisma.$transaction.mockImplementation((fn: (tx: any) => Promise<any>) => fn(tx));
    };

    it('does nothing when no guest cart exists (FOR UPDATE returns no rows)', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([]); // no guest cart locked
      setupMergeTx(tx);

      await service.mergeGuestCart('user-1', 'sess-1');

      expect(tx.cart.update).not.toHaveBeenCalled();
      expect(tx.cartItem.create).not.toHaveBeenCalled();
    });

    it('does nothing when guest cart exists but has no items', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'guest-cart' }]);
      tx.cartItem.findMany.mockResolvedValue([]); // empty cart
      setupMergeTx(tx);

      await service.mergeGuestCart('user-1', 'sess-1');

      expect(tx.cart.update).not.toHaveBeenCalled();
    });

    it('claims guest cart by assigning userId when user has no existing cart', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'guest-cart' }]);
      tx.cartItem.findMany.mockResolvedValue([{ productVariantId: 'pv-1', quantity: 2 }]);
      tx.cart.findFirst.mockResolvedValue(null); // no user cart
      tx.cart.update.mockResolvedValue({});
      setupMergeTx(tx);

      await service.mergeGuestCart('user-1', 'sess-1');

      expect(tx.cart.update).toHaveBeenCalledWith({
        where: { id: 'guest-cart' },
        data: { userId: 'user-1', sessionId: null },
      });
      expect(tx.cartItem.create).not.toHaveBeenCalled();
    });

    it('merges new items into user cart and deletes guest cart', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'guest-cart' }]);
      tx.cartItem.findMany.mockResolvedValue([{ productVariantId: 'pv-1', quantity: 2 }]);
      tx.cart.findFirst.mockResolvedValue({ id: 'user-cart' });
      tx.productVariant.findUnique.mockResolvedValue({ stock: 10 });
      tx.cartItem.findUnique.mockResolvedValue(null); // variant not yet in user cart
      tx.cartItem.create.mockResolvedValue({});
      tx.cart.delete.mockResolvedValue({});
      setupMergeTx(tx);

      await service.mergeGuestCart('user-1', 'sess-1');

      expect(tx.cartItem.create).toHaveBeenCalledWith({
        data: { cartId: 'user-cart', productVariantId: 'pv-1', quantity: 2 },
      });
      expect(tx.cart.delete).toHaveBeenCalledWith({ where: { id: 'guest-cart' } });
    });

    it('accumulates quantity when item already exists in user cart (within cap)', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'guest-cart' }]);
      tx.cartItem.findMany.mockResolvedValue([{ productVariantId: 'pv-1', quantity: 1 }]); // guest qty 1
      tx.cart.findFirst.mockResolvedValue({ id: 'user-cart' });
      tx.productVariant.findUnique.mockResolvedValue({ stock: 10 });
      tx.cartItem.findUnique.mockResolvedValue({ id: 'ci-1', quantity: 1 }); // user qty 1
      tx.cartItem.update.mockResolvedValue({});
      tx.cart.delete.mockResolvedValue({});
      setupMergeTx(tx);

      await service.mergeGuestCart('user-1', 'sess-1');

      // 1 + 1 = 2 which equals MAX_CART_QTY_PER_VARIANT — update should fire
      expect(tx.cartItem.update).toHaveBeenCalledWith({
        where: { id: 'ci-1' },
        data: { quantity: 2 },
      });
      expect(tx.cart.delete).toHaveBeenCalledWith({ where: { id: 'guest-cart' } });
    });

    it('acquires FOR UPDATE lock on the guest cart row to prevent concurrent item orphaning', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'guest-cart' }]);
      tx.cartItem.findMany.mockResolvedValue([{ productVariantId: 'pv-1', quantity: 1 }]);
      tx.cart.findFirst.mockResolvedValue({ id: 'user-cart' });
      tx.productVariant.findUnique.mockResolvedValue({ stock: 10 });
      tx.cartItem.findUnique.mockResolvedValue(null);
      tx.cartItem.create.mockResolvedValue({});
      tx.cart.delete.mockResolvedValue({});
      setupMergeTx(tx);

      await service.mergeGuestCart('user-1', 'sess-1');

      const rawQuery: string = (tx.$queryRaw.mock.calls[0][0] as string[]).join('');
      expect(rawQuery).toMatch(/FOR UPDATE/i);
      expect(rawQuery).toMatch(/carts/i);
    });

    it('runs the entire merge atomically inside a single $transaction call', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'guest-cart' }]);
      tx.cartItem.findMany.mockResolvedValue([{ productVariantId: 'pv-1', quantity: 1 }]);
      tx.cart.findFirst.mockResolvedValue({ id: 'user-cart' });
      tx.productVariant.findUnique.mockResolvedValue({ stock: 10 });
      tx.cartItem.findUnique.mockResolvedValue(null);
      tx.cartItem.create.mockResolvedValue({});
      tx.cart.delete.mockResolvedValue({});
      setupMergeTx(tx);

      await service.mergeGuestCart('user-1', 'sess-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    // ── Fix: MAX_CART_QTY_PER_VARIANT and stock guard in mergeGuestCart ────────
    // Invariant: merged quantity must never exceed MAX (2) or variant.stock.
    // An attacker could bypass addItem's per-unit guard by adding 2 as guest
    // then logging in to an account that already has 2 — producing qty=4 and
    // negative stock at checkout time.

    it('caps merged quantity at MAX_CART_QTY_PER_VARIANT when sum would exceed cap', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'guest-cart' }]);
      // Guest has 2 units; user cart also has 2 → uncapped sum = 4, capped = 2
      tx.cartItem.findMany.mockResolvedValue([{ productVariantId: 'pv-1', quantity: 2 }]);
      tx.cart.findFirst.mockResolvedValue({ id: 'user-cart' });
      tx.productVariant.findUnique.mockResolvedValue({ stock: 10 });
      tx.cartItem.findUnique.mockResolvedValue({ id: 'ci-1', quantity: 2 });
      tx.cartItem.update.mockResolvedValue({});
      tx.cart.delete.mockResolvedValue({});
      setupMergeTx(tx);

      await service.mergeGuestCart('user-1', 'sess-1');

      // newQty = min(4, 2, 10) = 2 === existing.quantity → no update should be issued
      expect(tx.cartItem.update).not.toHaveBeenCalled();
    });

    it('caps merged quantity at MAX_CART_QTY_PER_VARIANT when creating a new user cart item', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'guest-cart' }]);
      // Guest has qty 2 but stock is also 2 — cap at min(2, 2, 2) = 2, which is the cap
      tx.cartItem.findMany.mockResolvedValue([{ productVariantId: 'pv-1', quantity: 2 }]);
      tx.cart.findFirst.mockResolvedValue({ id: 'user-cart' });
      tx.productVariant.findUnique.mockResolvedValue({ stock: 10 });
      tx.cartItem.findUnique.mockResolvedValue(null);
      tx.cartItem.create.mockResolvedValue({});
      tx.cart.delete.mockResolvedValue({});
      setupMergeTx(tx);

      await service.mergeGuestCart('user-1', 'sess-1');

      // qty is 2 (at the cap) — valid, create should fire
      expect(tx.cartItem.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ quantity: 2 }) }),
      );
    });

    it('caps merged quantity at available stock when stock is less than MAX', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'guest-cart' }]);
      tx.cartItem.findMany.mockResolvedValue([{ productVariantId: 'pv-1', quantity: 2 }]);
      tx.cart.findFirst.mockResolvedValue({ id: 'user-cart' });
      // Only 1 unit left in stock
      tx.productVariant.findUnique.mockResolvedValue({ stock: 1 });
      tx.cartItem.findUnique.mockResolvedValue(null);
      tx.cartItem.create.mockResolvedValue({});
      tx.cart.delete.mockResolvedValue({});
      setupMergeTx(tx);

      await service.mergeGuestCart('user-1', 'sess-1');

      // newQty = min(2, 2, 1) = 1 — create with stock-capped quantity
      expect(tx.cartItem.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ quantity: 1 }) }),
      );
    });

    it('skips item entirely when variant has zero stock', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'guest-cart' }]);
      tx.cartItem.findMany.mockResolvedValue([{ productVariantId: 'pv-1', quantity: 1 }]);
      tx.cart.findFirst.mockResolvedValue({ id: 'user-cart' });
      tx.productVariant.findUnique.mockResolvedValue({ stock: 0 });
      tx.cartItem.findUnique.mockResolvedValue(null);
      tx.cart.delete.mockResolvedValue({});
      setupMergeTx(tx);

      await service.mergeGuestCart('user-1', 'sess-1');

      // newQty = min(1, 2, 0) = 0 → continue, no create
      expect(tx.cartItem.create).not.toHaveBeenCalled();
    });

    it('skips item when variant lookup returns null (variant deleted between add and merge)', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'guest-cart' }]);
      tx.cartItem.findMany.mockResolvedValue([{ productVariantId: 'pv-deleted', quantity: 2 }]);
      tx.cart.findFirst.mockResolvedValue({ id: 'user-cart' });
      tx.productVariant.findUnique.mockResolvedValue(null); // variant no longer exists
      tx.cartItem.findUnique.mockResolvedValue(null);
      tx.cart.delete.mockResolvedValue({});
      setupMergeTx(tx);

      await service.mergeGuestCart('user-1', 'sess-1');

      // availableStock = 0, newQty = 0 → skip
      expect(tx.cartItem.create).not.toHaveBeenCalled();
    });

    it('does not call update when newQty equals existing quantity after capping', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'guest-cart' }]);
      // Guest has 1 qty, user already has 2 → min(3, 2, 10) = 2 === existing.quantity
      tx.cartItem.findMany.mockResolvedValue([{ productVariantId: 'pv-1', quantity: 1 }]);
      tx.cart.findFirst.mockResolvedValue({ id: 'user-cart' });
      tx.productVariant.findUnique.mockResolvedValue({ stock: 10 });
      tx.cartItem.findUnique.mockResolvedValue({ id: 'ci-1', quantity: 2 });
      tx.cart.delete.mockResolvedValue({});
      setupMergeTx(tx);

      await service.mergeGuestCart('user-1', 'sess-1');

      expect(tx.cartItem.update).not.toHaveBeenCalled();
    });

    it('handles multiple guest items: caps each independently', async () => {
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ id: 'guest-cart' }]);
      tx.cartItem.findMany.mockResolvedValue([
        { productVariantId: 'pv-1', quantity: 2 }, // would exceed cap when merged with existing 2
        { productVariantId: 'pv-2', quantity: 1 }, // within cap — no existing user item
      ]);
      tx.cart.findFirst.mockResolvedValue({ id: 'user-cart' });
      tx.productVariant.findUnique
        .mockResolvedValueOnce({ stock: 10 }) // pv-1
        .mockResolvedValueOnce({ stock: 10 }); // pv-2
      tx.cartItem.findUnique
        .mockResolvedValueOnce({ id: 'ci-1', quantity: 2 }) // pv-1 already at cap
        .mockResolvedValueOnce(null);                         // pv-2 not yet in user cart
      tx.cartItem.create.mockResolvedValue({});
      tx.cart.delete.mockResolvedValue({});
      setupMergeTx(tx);

      await service.mergeGuestCart('user-1', 'sess-1');

      // pv-1: min(4, 2, 10)=2 === existing.quantity=2 → no update
      expect(tx.cartItem.update).not.toHaveBeenCalled();
      // pv-2: min(1, 2, 10)=1 → create with qty 1
      expect(tx.cartItem.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ productVariantId: 'pv-2', quantity: 1 }) }),
      );
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
    const setupUpdateTx = (tx: ReturnType<typeof makeTx>) => {
      prisma.$transaction.mockImplementation((fn: (tx: any) => Promise<any>) => fn(tx));
    };

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

    it('throws NotFoundException when variant does not exist', async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([]); // no rows → variant not found
      setupUpdateTx(tx);

      await expect(
        service.updateItem(undefined, 'sess-1', 'pv-1', 2),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when variant is inactive', async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ stock: 10, isActive: false }]);
      setupUpdateTx(tx);

      await expect(
        service.updateItem(undefined, 'sess-1', 'pv-1', 2),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when requested quantity exceeds stock', async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ stock: 1, isActive: true }]);
      setupUpdateTx(tx);

      await expect(
        service.updateItem(undefined, 'sess-1', 'pv-1', 5),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates item quantity when stock is sufficient', async () => {
      const cart = makeCart();
      const cartWithItem = { ...cart, items: [makeCartItem(2)] };
      prisma.cart.findFirst
        .mockResolvedValueOnce(cart)        // findCart
        .mockResolvedValueOnce(cartWithItem); // getOrCreate re-fetch
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ stock: 10, isActive: true }]);
      tx.cartItem.updateMany.mockResolvedValue({ count: 1 });
      setupUpdateTx(tx);

      await service.updateItem(undefined, 'sess-1', 'pv-1', 2);

      expect(tx.cartItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { quantity: 2 } }),
      );
    });

    it('throws BadRequestException when update quantity exceeds MAX_CART_QTY_PER_VARIANT', async () => {
      const cart = makeCart();
      prisma.cart.findFirst.mockResolvedValue(cart);
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ stock: 10, isActive: true }]);
      setupUpdateTx(tx);

      // quantity=3 > MAX_CART_QTY_PER_VARIANT (2)
      await expect(service.updateItem(undefined, 'sess-1', 'pv-1', 3)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('FOR UPDATE lock serializes concurrent updates: second caller sees depleted stock', async () => {
      prisma.cart.findFirst.mockResolvedValue(makeCart());
      const tx = makeTx();
      // Stock is 0 after a concurrent request already updated the item
      tx.$queryRaw.mockResolvedValue([{ stock: 0, isActive: true }]);
      setupUpdateTx(tx);

      await expect(
        service.updateItem(undefined, 'sess-1', 'pv-1', 1),
      ).rejects.toThrow(BadRequestException);
    });

    it('acquires FOR UPDATE lock on the variant row', async () => {
      const cart = makeCart();
      const cartWithItem = { ...cart, items: [makeCartItem(2)] };
      prisma.cart.findFirst
        .mockResolvedValueOnce(cart)
        .mockResolvedValueOnce(cartWithItem);
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ stock: 10, isActive: true }]);
      tx.cartItem.updateMany.mockResolvedValue({ count: 1 });
      setupUpdateTx(tx);

      await service.updateItem(undefined, 'sess-1', 'pv-1', 2);

      const rawQuery: string = (tx.$queryRaw.mock.calls[0][0] as string[]).join('');
      expect(rawQuery).toMatch(/FOR UPDATE/i);
      expect(rawQuery).toMatch(/product_variants/i);
    });

    it('runs the stock check and cart write inside a single $transaction call', async () => {
      const cart = makeCart();
      const cartWithItem = { ...cart, items: [makeCartItem(2)] };
      prisma.cart.findFirst
        .mockResolvedValueOnce(cart)
        .mockResolvedValueOnce(cartWithItem);
      const tx = makeTx();
      tx.$queryRaw.mockResolvedValue([{ stock: 10, isActive: true }]);
      tx.cartItem.updateMany.mockResolvedValue({ count: 1 });
      setupUpdateTx(tx);

      await service.updateItem(undefined, 'sess-1', 'pv-1', 2);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
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
