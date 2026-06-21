import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CategoriesService } from '../categories.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prisma: any;

  const mockCategory = { id: 'cat-1', name: 'Perfumy', slug: 'perfumy', parentId: null };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        {
          provide: PrismaService,
          useValue: {
            category: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              count: jest.fn(),
            },
            product: {
              count: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get(CategoriesService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── findAll — arbitrary-depth tree assembly ───────────────────────────────
  // Invariant: every category must appear in the tree no matter how deep its
  // ancestor chain goes. The old implementation used a Prisma `include` nested
  // exactly 2 levels (children.children), which silently dropped any category
  // at the 4th level or deeper. The fix fetches the table flat and assembles
  // the tree in memory, so depth is bounded only by the data itself.

  describe('findAll — arbitrary-depth tree assembly', () => {
    it('returns an empty array when there are no categories', async () => {
      prisma.category.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });

    it('returns root categories with an empty children array when none have children', async () => {
      prisma.category.findMany.mockResolvedValue([
        { id: 'a', name: 'A', slug: 'a', parentId: null },
        { id: 'b', name: 'B', slug: 'b', parentId: null },
      ]);

      const result = await service.findAll();

      expect(result).toEqual([
        { id: 'a', name: 'A', slug: 'a', parentId: null, children: [] },
        { id: 'b', name: 'B', slug: 'b', parentId: null, children: [] },
      ]);
    });

    it('nests a direct child under its parent', async () => {
      prisma.category.findMany.mockResolvedValue([
        { id: 'parent', name: 'Parent', slug: 'parent', parentId: null },
        { id: 'child', name: 'Child', slug: 'child', parentId: 'parent' },
      ]);

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].children).toEqual([
        { id: 'child', name: 'Child', slug: 'child', parentId: 'parent', children: [] },
      ]);
    });

    it('builds a tree 5 levels deep — regression guard for the fixed depth cap', async () => {
      prisma.category.findMany.mockResolvedValue([
        { id: 'l1', name: 'L1', slug: 'l1', parentId: null },
        { id: 'l2', name: 'L2', slug: 'l2', parentId: 'l1' },
        { id: 'l3', name: 'L3', slug: 'l3', parentId: 'l2' },
        { id: 'l4', name: 'L4', slug: 'l4', parentId: 'l3' },
        { id: 'l5', name: 'L5', slug: 'l5', parentId: 'l4' },
      ]);

      const result = await service.findAll();

      const l1 = result[0];
      const l2 = l1.children[0];
      const l3 = l2.children[0];
      const l4 = l3.children[0];
      const l5 = l4.children[0];

      expect(l1.id).toBe('l1');
      expect(l2.id).toBe('l2');
      expect(l3.id).toBe('l3');
      expect(l4.id).toBe('l4');
      expect(l5).toMatchObject({ id: 'l5', children: [] });
    });

    it('passes orderBy: { name: "asc" } to findMany', async () => {
      prisma.category.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(prisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'asc' } }),
      );
    });

    it('does not scope the query with a parentId filter — must fetch the whole table', async () => {
      prisma.category.findMany.mockResolvedValue([]);

      await service.findAll();

      const callArg = prisma.category.findMany.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('where');
    });

    it('keeps siblings at every level in the name-ascending order returned by the DB', async () => {
      // findMany already returns name-sorted rows (orderBy: asc) — children should
      // inherit that order since the tree is built by a single pass over that array.
      prisma.category.findMany.mockResolvedValue([
        { id: 'parent', name: 'Parent', slug: 'parent', parentId: null },
        { id: 'child-a', name: 'Child A', slug: 'child-a', parentId: 'parent' },
        { id: 'child-b', name: 'Child B', slug: 'child-b', parentId: 'parent' },
      ]);

      const result = await service.findAll();

      expect(result[0].children.map((c: any) => c.id)).toEqual(['child-a', 'child-b']);
    });

    it('treats a category with a dangling parentId (no matching row) as a root, defensively', async () => {
      prisma.category.findMany.mockResolvedValue([
        { id: 'orphan', name: 'Orphan', slug: 'orphan', parentId: 'does-not-exist' },
      ]);

      const result = await service.findAll();

      expect(result).toEqual([
        { id: 'orphan', name: 'Orphan', slug: 'orphan', parentId: 'does-not-exist', children: [] },
      ]);
    });
  });

  // ── findBySlug — arbitrary-depth children, same as findAll ───────────────
  // Invariant: findBySlug() must not silently cap `children` at depth 1. It
  // previously used a Prisma `include: { children: true, parent: true }`,
  // which only nests one level — the exact bug class findAll() above was
  // already fixed for. It now reuses the same flat-query tree assembly.

  describe('findBySlug — arbitrary-depth children', () => {
    it('throws NotFoundException when no category matches the slug', async () => {
      prisma.category.findMany.mockResolvedValue([]);

      await expect(service.findBySlug('missing')).rejects.toThrow(NotFoundException);
    });

    it('returns an empty children array for a leaf category with no children', async () => {
      prisma.category.findMany.mockResolvedValue([
        { id: 'a', name: 'A', slug: 'a', parentId: null },
      ]);

      const result = await service.findBySlug('a');

      expect(result.children).toEqual([]);
      expect(result.parent).toBeNull();
    });

    it('nests grandchildren under children — regression guard for the depth-1 cap', async () => {
      prisma.category.findMany.mockResolvedValue([
        { id: 'l1', name: 'L1', slug: 'l1', parentId: null },
        { id: 'l2', name: 'L2', slug: 'l2', parentId: 'l1' },
        { id: 'l3', name: 'L3', slug: 'l3', parentId: 'l2' },
        { id: 'l4', name: 'L4', slug: 'l4', parentId: 'l3' },
      ]);

      const result = await service.findBySlug('l1');

      const l2 = result.children[0];
      const l3 = l2.children[0];
      const l4 = l3.children[0];
      expect(l2.id).toBe('l2');
      expect(l3.id).toBe('l3');
      expect(l4).toMatchObject({ id: 'l4', children: [] });
    });

    it('attaches the immediate parent as a flat object, without the parent\'s own children array', async () => {
      prisma.category.findMany.mockResolvedValue([
        { id: 'parent', name: 'Parent', slug: 'parent', parentId: null },
        { id: 'child', name: 'Child', slug: 'child', parentId: 'parent' },
      ]);

      const result = await service.findBySlug('child');

      expect(result.parent).toMatchObject({ id: 'parent', slug: 'parent' });
      expect(result.parent?.children).toBeUndefined();
    });

    it('fetches the whole table flat instead of scoping by slug or parentId', async () => {
      prisma.category.findMany.mockResolvedValue([
        { id: 'a', name: 'A', slug: 'a', parentId: null },
      ]);

      await service.findBySlug('a');

      const callArg = prisma.category.findMany.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('where');
      expect(callArg).toEqual(expect.objectContaining({ orderBy: { name: 'asc' } }));
    });
  });

  // ── remove — pre-checks against FK violation ─────────────────────────────
  // Invariant: remove() must check for assigned products and child categories
  // before calling prisma.category.delete. Without the pre-check Postgres
  // throws a FK violation (P2003) which NestJS surfaces as a 500, not a 409.

  describe('remove — FK pre-check', () => {
    it('throws NotFoundException when category does not exist', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(service.remove('cat-missing')).rejects.toThrow(NotFoundException);
    });

    it('does not call product.count or delete when category is not found', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await service.remove('cat-missing').catch(() => undefined);

      expect(prisma.product.count).not.toHaveBeenCalled();
      expect(prisma.category.delete).not.toHaveBeenCalled();
    });

    it('throws ConflictException when category has 1 assigned product', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(1);
      prisma.category.count.mockResolvedValue(0);

      await expect(service.remove('cat-1')).rejects.toThrow(ConflictException);
    });

    it('includes the product count in the ConflictException message', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(3);
      prisma.category.count.mockResolvedValue(0);

      await expect(service.remove('cat-1')).rejects.toThrow('3');
    });

    it('throws ConflictException when category has multiple assigned products', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(7);
      prisma.category.count.mockResolvedValue(0);

      await expect(service.remove('cat-1')).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when category has 1 child category', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(0);
      prisma.category.count.mockResolvedValue(1);

      await expect(service.remove('cat-1')).rejects.toThrow(ConflictException);
    });

    it('includes the child count in the ConflictException message', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(0);
      prisma.category.count.mockResolvedValue(2);

      await expect(service.remove('cat-1')).rejects.toThrow('2');
    });

    it('product check fires before child check when both are non-zero', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(2);
      prisma.category.count.mockResolvedValue(3);

      await expect(service.remove('cat-1')).rejects.toThrow(ConflictException);
      expect(prisma.category.delete).not.toHaveBeenCalled();
    });

    it('does not call delete when products are assigned', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(1);
      prisma.category.count.mockResolvedValue(0);

      await service.remove('cat-1').catch(() => undefined);

      expect(prisma.category.delete).not.toHaveBeenCalled();
    });

    it('does not call delete when child categories exist', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(0);
      prisma.category.count.mockResolvedValue(1);

      await service.remove('cat-1').catch(() => undefined);

      expect(prisma.category.delete).not.toHaveBeenCalled();
    });

    it('calls delete when category has no products and no children (happy path)', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(0);
      prisma.category.count.mockResolvedValue(0);
      prisma.category.delete.mockResolvedValue(mockCategory);

      const result = await service.remove('cat-1');

      expect(prisma.category.delete).toHaveBeenCalledWith({ where: { id: 'cat-1' } });
      expect(result).toEqual(mockCategory);
    });

    it('scopes product.count to the target category id', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(0);
      prisma.category.count.mockResolvedValue(0);
      prisma.category.delete.mockResolvedValue(mockCategory);

      await service.remove('cat-1');

      expect(prisma.product.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { categoryId: 'cat-1' } }),
      );
    });

    it('scopes category.count child check to the target category id as parentId', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(0);
      prisma.category.count.mockResolvedValue(0);
      prisma.category.delete.mockResolvedValue(mockCategory);

      await service.remove('cat-1');

      expect(prisma.category.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { parentId: 'cat-1' } }),
      );
    });

    it('runs product.count and category.count in parallel (both called per remove)', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.product.count.mockResolvedValue(0);
      prisma.category.count.mockResolvedValue(0);
      prisma.category.delete.mockResolvedValue(mockCategory);

      await service.remove('cat-1');

      expect(prisma.product.count).toHaveBeenCalledTimes(1);
      expect(prisma.category.count).toHaveBeenCalledTimes(1);
    });
  });

  // ── update — cycle detection ──────────────────────────────────────────────
  // Invariant: update() must reject any parentId that would form a cycle in
  // the category tree. Without this guard, sitemap/breadcrumb traversal loops
  // infinitely when A.parentId = B and B.parentId = A.

  describe('update — cycle detection', () => {
    it('throws NotFoundException when category does not exist', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(service.update('cat-missing', { name: 'New' })).rejects.toThrow(NotFoundException);
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when parentId equals the category id (self-reference)', async () => {
      prisma.category.findUnique.mockResolvedValueOnce(mockCategory);

      await expect(service.update('cat-1', { parentId: 'cat-1' })).rejects.toThrow(BadRequestException);
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException with "circular reference" message on self-reference', async () => {
      prisma.category.findUnique.mockResolvedValueOnce(mockCategory);

      await expect(service.update('cat-1', { parentId: 'cat-1' })).rejects.toThrow('circular reference');
    });

    it('throws BadRequestException when candidate parent is a direct child (depth-1 cycle)', async () => {
      // cat-child.parentId = 'cat-1' → setting cat-1.parentId = cat-child creates A↔B
      prisma.category.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 'cat-1') return Promise.resolve(mockCategory);
        if (where.id === 'cat-child') return Promise.resolve({ parentId: 'cat-1' });
        return Promise.resolve(null);
      });

      await expect(service.update('cat-1', { parentId: 'cat-child' })).rejects.toThrow(BadRequestException);
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when cycle exists two levels deep (depth-2 cycle)', async () => {
      // cat-1 → cat-b → cat-c (cat-c.parentId=cat-b, cat-b.parentId=cat-1)
      // setting cat-1.parentId = cat-c creates a 3-node cycle
      prisma.category.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 'cat-1') return Promise.resolve(mockCategory);
        if (where.id === 'cat-c') return Promise.resolve({ parentId: 'cat-b' });
        if (where.id === 'cat-b') return Promise.resolve({ parentId: 'cat-1' });
        return Promise.resolve(null);
      });

      await expect(service.update('cat-1', { parentId: 'cat-c' })).rejects.toThrow(BadRequestException);
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('calls prisma.category.update when candidate parent has no ancestors (happy path)', async () => {
      prisma.category.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 'cat-1') return Promise.resolve(mockCategory);
        if (where.id === 'cat-root') return Promise.resolve({ parentId: null });
        return Promise.resolve(null);
      });
      prisma.category.update.mockResolvedValue({ ...mockCategory, parentId: 'cat-root' });

      const result = await service.update('cat-1', { parentId: 'cat-root' });

      expect(prisma.category.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cat-1' } }),
      );
      expect(result).toMatchObject({ parentId: 'cat-root' });
    });

    it('skips cycle detection and calls update when parentId is omitted', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.category.update.mockResolvedValue({ ...mockCategory, name: 'Renamed' });

      const result = await service.update('cat-1', { name: 'Renamed' });

      expect(prisma.category.update).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ name: 'Renamed' });
    });

    it('disconnects parent without cycle check when parentId is empty string', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategory);
      prisma.category.update.mockResolvedValue({ ...mockCategory, parentId: null });

      const result = await service.update('cat-1', { parentId: '' });

      expect(prisma.category.update).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ parentId: null });
    });
  });
});
