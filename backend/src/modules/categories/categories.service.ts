import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  // Builds the full category tree from a single flat query instead of a manually
  // nested Prisma `include`, which silently dropped any category past a fixed
  // depth. The self-referential parentId relation supports arbitrary depth, so
  // the tree must too — every node gets a `children` array, however deep it goes.
  async findAll() {
    const categories = await this.prisma.category.findMany({
      orderBy: { name: 'asc' },
    });

    type CategoryNode = (typeof categories)[number] & { children: CategoryNode[] };
    const byId = new Map<string, CategoryNode>(
      categories.map((category) => [category.id, { ...category, children: [] }]),
    );

    const roots: CategoryNode[] = [];
    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  async findBySlug(slug: string) {
    const category = await this.prisma.category.findUnique({
      where: { slug },
      include: { children: true, parent: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  create(data: {
    name: string;
    slug: string;
    description?: string;
    imageUrl?: string;
    parentId?: string;
  }) {
    const { parentId, ...rest } = data;
    return this.prisma.category.create({
      data: {
        ...rest,
        ...(parentId && { parent: { connect: { id: parentId } } }),
      },
    });
  }

  async update(id: string, data: {
    name?: string;
    slug?: string;
    description?: string;
    imageUrl?: string;
    parentId?: string;
  }) {
    await this.findById(id);
    const { parentId, ...rest } = data;
    if (parentId) {
      if (await this.wouldCreateCycle(id, parentId)) {
        throw new BadRequestException('Setting this parent would create a circular reference.');
      }
    }
    const prismaData: Prisma.CategoryUpdateInput = { ...rest };
    if (parentId !== undefined) {
      prismaData.parent = parentId ? { connect: { id: parentId } } : { disconnect: true };
    }
    return this.prisma.category.update({ where: { id }, data: prismaData });
  }

  async remove(id: string) {
    await this.findById(id);
    const [productCount, childCount] = await Promise.all([
      this.prisma.product.count({ where: { categoryId: id } }),
      this.prisma.category.count({ where: { parentId: id } }),
    ]);
    if (productCount > 0) throw new ConflictException(`Category has ${productCount} product(s) assigned.`);
    if (childCount > 0) throw new ConflictException(`Category has ${childCount} child category(ies).`);
    return this.prisma.category.delete({ where: { id } });
  }

  private async findById(id: string) {
    const cat = await this.prisma.category.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException('Category not found');
    return cat;
  }

  private async wouldCreateCycle(categoryId: string, newParentId: string): Promise<boolean> {
    if (categoryId === newParentId) return true;
    let currentId: string | null = newParentId;
    for (let depth = 0; depth < 20; depth++) {
      const cat: { parentId: string | null } | null =
        await this.prisma.category.findUnique({
          where: { id: currentId! },
          select: { parentId: true },
        });
      if (!cat || cat.parentId === null) return false;
      if (cat.parentId === categoryId) return true;
      currentId = cat.parentId;
    }
    return false;
  }
}
