import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

const STALE_CART_DAYS = 30;

@Injectable()
export class CartCleanupService {
  private readonly logger = new Logger(CartCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'Europe/Warsaw' })
  async deleteStaleAnonymousCarts(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - STALE_CART_DAYS);

    // Delete cart items first (no CASCADE on CartItem → Cart in schema),
    // then delete the empty anonymous carts in a single transaction.
    const staleCarts = await this.prisma.cart.findMany({
      where: {
        userId: null,
        updatedAt: { lt: cutoff },
      },
      select: { id: true },
    });

    if (staleCarts.length === 0) {
      this.logger.debug('Stale cart cleanup: nothing to delete');
      return;
    }

    const ids = staleCarts.map((c) => c.id);

    const [, { count }] = await this.prisma.$transaction([
      this.prisma.cartItem.deleteMany({ where: { cartId: { in: ids } } }),
      this.prisma.cart.deleteMany({ where: { id: { in: ids } } }),
    ]);

    this.logger.log(`Stale cart cleanup: deleted ${count} anonymous cart(s) inactive for >${STALE_CART_DAYS} days`);
  }
}
