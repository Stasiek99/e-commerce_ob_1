import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, User } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByGoogleId(googleId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { googleId } });
  }

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }

  async getAddresses(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async createAddress(userId: string, data: Omit<Prisma.AddressCreateInput, 'user'>) {
    if (data.isDefault) {
      await this.prisma.address.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    }
    return this.prisma.address.create({
      data: { ...data, user: { connect: { id: userId } } },
    });
  }

  async updateAddress(userId: string, addressId: string, data: Prisma.AddressUpdateInput) {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });
    if (!address) throw new NotFoundException('Address not found');

    if (data.isDefault) {
      await this.prisma.address.updateMany({
        where: { userId, id: { not: addressId } },
        data: { isDefault: false },
      });
    }
    return this.prisma.address.update({ where: { id: addressId }, data });
  }

  async deleteAddress(userId: string, addressId: string) {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });
    if (!address) throw new NotFoundException('Address not found');
    return this.prisma.address.delete({ where: { id: addressId } });
  }

  async deleteAccount(userId: string): Promise<void> {
    await this.prisma.$transaction([
      // GDPR Art. 17 — scrub PII from order snapshots; the FK is nulled by the
      // cascade below so orders remain intact for accounting/dispute purposes.
      this.prisma.order.updateMany({
        where: { userId },
        data: {
          snapshotFirstName: '[usunięto]',
          snapshotLastName:  '[usunięto]',
          snapshotEmail:     'deleted@deleted',
          snapshotPhone:     '',
          snapshotNip:       null,
        },
      }),
      // Hard-delete — cascade removes addresses, refresh tokens, email tokens,
      // password-reset tokens, wishlist items, reviews, and customer notes.
      // Orders.userId is set to NULL by the schema's onDelete: SetNull rule.
      this.prisma.user.delete({ where: { id: userId } }),
    ]);
  }
}
