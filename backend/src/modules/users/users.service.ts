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

  async exportData(userId: string, userEmail: string) {
    const [user, orders, reviews, wishlistItems, returnRequests] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        include: { addresses: true },
      }),
      this.prisma.order.findMany({
        where: { userId },
        select: {
          orderNumber: true,
          status: true,
          snapshotFirstName: true,
          snapshotLastName: true,
          snapshotCompany: true,
          snapshotStreet: true,
          snapshotCity: true,
          snapshotPostalCode: true,
          snapshotCountry: true,
          snapshotPhone: true,
          snapshotEmail: true,
          snapshotNip: true,
          itemsTotalInCents: true,
          shippingCostInCents: true,
          discountInCents: true,
          totalInCents: true,
          couponCode: true,
          carrierCode: true,
          notes: true,
          createdAt: true,
          items: {
            select: {
              snapshotName: true,
              snapshotSku: true,
              snapshotPrice: true,
              quantity: true,
            },
          },
          payment: {
            select: {
              status: true,
              provider: true,
              amountInCents: true,
              refundedAmountInCents: true,
              currency: true,
              paidAt: true,
            },
          },
          shipment: {
            select: {
              status: true,
              carrierCode: true,
              trackingNumber: true,
              shippedAt: true,
              deliveredAt: true,
              estimatedDelivery: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.review.findMany({
        where: { userId },
        select: {
          rating: true,
          title: true,
          body: true,
          status: true,
          createdAt: true,
          product: { select: { name: true, slug: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.wishlistItem.findMany({
        where: { userId },
        select: {
          addedAt: true,
          notifyOnRestock: true,
          product: { select: { name: true, slug: true } },
        },
      }),
      this.prisma.returnRequest.findMany({
        where: { email: userEmail },
        select: {
          orderNumber: true,
          type: true,
          status: true,
          reason: true,
          requestedResolution: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const { passwordHash, googleId, ...profile } = user!;

    return {
      exportedAt: new Date().toISOString(),
      profile,
      orders,
      reviews,
      wishlist: wishlistItems,
      returnRequests,
    };
  }

  async deleteAccount(userId: string): Promise<void> {
    // Fetch the email before deletion — needed to match ReturnRequest records
    // which have no FK to User (by design, so returns survive account deletion).
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) throw new NotFoundException('User not found');

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
      // GDPR Art. 17 — scrub PII from ReturnRequest records that have no FK to
      // User; matched by email because that is the only persistent link after the
      // user row is deleted.
      this.prisma.returnRequest.updateMany({
        where: { email: user.email },
        data: {
          firstName:   '[usunięto]',
          lastName:    '[usunięto]',
          email:       'deleted@deleted',
          phone:       null,
          bankAccount: null,
        },
      }),
      // Hard-delete — cascade removes addresses, refresh tokens, email tokens,
      // password-reset tokens, wishlist items, reviews, and customer notes.
      // Orders.userId is set to NULL by the schema's onDelete: SetNull rule.
      this.prisma.user.delete({ where: { id: userId } }),
    ]);
  }
}
