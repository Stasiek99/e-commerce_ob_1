import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StripeClient } from '../payments/stripe.client';
import { Prisma, User } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeClient,
  ) {}

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
    // GDPR Art. 7(1) — marketingConsentAt is the only proof of when consent
    // was given or withdrawn, so it must track every change to the flag.
    if ('marketingConsent' in data) {
      data = { ...data, marketingConsentAt: new Date() };
    }
    return this.prisma.user.update({ where: { id }, data });
  }

  async getAddresses(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async createAddress(userId: string, data: Omit<Prisma.AddressCreateInput, 'user'>) {
    if (!data.isDefault) {
      return this.prisma.address.create({
        data: { ...data, user: { connect: { id: userId } } },
      });
    }

    // Demote-then-promote as two separate statements is not atomic — concurrent
    // requests promoting different addresses can interleave and leave two rows
    // isDefault=true. Insert the new row as non-default first (an INSERT is a
    // single-row statement, so inserting it as true directly would collide
    // immediately with the addresses_one_default_per_user partial unique index
    // if another default already exists), then flip old + new in one UPDATE —
    // Postgres defers unique-index checks on multi-row UPDATEs to end-of-
    // statement, so the momentary "two defaults" state never trips the index.
    return this.prisma.$transaction(async (tx) => {
      const address = await tx.address.create({
        data: { ...data, isDefault: false, user: { connect: { id: userId } } },
      });
      await tx.$executeRaw`UPDATE "addresses" SET "isDefault" = ("id" = ${address.id}) WHERE "userId" = ${userId}`;
      return tx.address.findUniqueOrThrow({ where: { id: address.id } });
    });
  }

  async updateAddress(userId: string, addressId: string, data: Prisma.AddressUpdateInput) {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });
    if (!address) throw new NotFoundException('Address not found');

    if (!data.isDefault) {
      return this.prisma.address.update({ where: { id: addressId }, data });
    }

    // Single atomic UPDATE instead of demote-then-promote — see createAddress.
    const { isDefault: _isDefault, ...rest } = data;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "addresses" SET "isDefault" = ("id" = ${addressId}) WHERE "userId" = ${userId}`;
      if (Object.keys(rest).length > 0) {
        await tx.address.update({ where: { id: addressId }, data: rest });
      }
      return tx.address.findUniqueOrThrow({ where: { id: addressId } });
    });
  }

  async deleteAddress(userId: string, addressId: string) {
    const address = await this.prisma.address.findFirst({
      where: { id: addressId, userId },
    });
    if (!address) throw new NotFoundException('Address not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id: addressId } });

      if (!address.isDefault) return;

      // Single atomic UPDATE instead of findFirst-then-update — see createAddress.
      // Unlike that one, this isn't given an explicit target id by the caller, so the
      // NOT EXISTS guard re-checks under the transaction's row locks whether some other
      // request (e.g. a concurrent updateAddress explicitly promoting a different
      // address) already set a default in the meantime — if so this becomes a no-op
      // instead of overwriting that explicit choice.
      await tx.$executeRaw`
        UPDATE "addresses" SET "isDefault" = true
        WHERE "userId" = ${userId}
          AND "id" = (SELECT "id" FROM "addresses" WHERE "userId" = ${userId} ORDER BY "createdAt" DESC LIMIT 1)
          AND NOT EXISTS (SELECT 1 FROM "addresses" WHERE "userId" = ${userId} AND "isDefault" = true)
      `;
    });
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

    // GDPR Art. 17(3)(b) exemption: erasure must not destroy evidence needed for
    // an open chargeback. Check all Stripe payment intents on this user's orders.
    const payments = await this.prisma.payment.findMany({
      where: { order: { userId } },
      select: { stripePaymentIntentId: true },
    });
    const intentIds = payments
      .map((p) => p.stripePaymentIntentId)
      .filter((id): id is string => id !== null);

    for (const intentId of intentIds) {
      const disputes = await this.stripe.listDisputesByPaymentIntent(intentId);
      if (disputes.some((d) => d.status === 'needs_response')) {
        throw new ConflictException(
          'Account erasure is temporarily blocked due to an open payment dispute. Try again in 30 days.',
        );
      }
    }

    await this.prisma.$transaction([
      // GDPR Art. 17 — scrub PII from order snapshots; the FK is nulled by the
      // cascade below so orders remain intact for accounting/dispute purposes.
      this.prisma.order.updateMany({
        where: { userId },
        data: {
          snapshotFirstName:  '[usunięto]',
          snapshotLastName:   '[usunięto]',
          snapshotEmail:      `deleted+${randomUUID()}@deleted.invalid`,
          snapshotPhone:      '',
          snapshotNip:        null,
          snapshotStreet:     '[usunięto]',
          snapshotCity:       '[usunięto]',
          snapshotPostalCode: '[usunięto]',
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

  async recordConsent(userId: string, analytics: boolean): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { analyticsConsent: analytics, analyticsConsentAt: new Date() },
    });
  }

  async recordAnonymousConsent(consentId: string, analytics: boolean): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 5);
    await this.prisma.consentLog.create({
      data: { consentId, analytics, expiresAt },
    });
  }
}
