import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.category.findMany({
      where: { parentId: null },
      include: { children: { include: { children: true } } },
      orderBy: { name: 'asc' },
    });
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
}
