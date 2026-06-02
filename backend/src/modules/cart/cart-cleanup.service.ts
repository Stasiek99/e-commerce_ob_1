import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

const STALE_CART_DAYS = 30;
const AUTH_CART_ITEM_TTL_HOURS = 4;

@Injectable()
export class CartCleanupService {
  private readonly logger = new Logger(CartCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'Europe/Warsaw' })
  async deleteStaleAnonymousCarts(): Promise<void> {
    const acquired = await this.redis.set('cron:cleanup-carts:lock', '1', 'EX', 82800, 'NX');
    if (!acquired) return;

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

  @Cron(CronExpression.EVERY_HOUR, { timeZone: 'Europe/Warsaw' })
  async expireAuthenticatedCartItems(): Promise<void> {
    const acquired = await this.redis.set('cron:expire-auth-cart-items:lock', '1', 'EX', 3540, 'NX');
    if (!acquired) return;

    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - AUTH_CART_ITEM_TTL_HOURS);

    // Find cart items in authenticated carts that haven't been touched in 4 hours.
    // Stock is not held at the DB level during cart reservation, so no stock
    // restoration is needed — we only clean up the stale items.
    const staleCarts = await this.prisma.cart.findMany({
      where: { userId: { not: null } },
      select: { id: true },
    });

    if (staleCarts.length === 0) return;

    const cartIds = staleCarts.map((c) => c.id);

    const { count } = await this.prisma.cartItem.deleteMany({
      where: {
        cartId: { in: cartIds },
        updatedAt: { lt: cutoff },
      },
    });

    if (count > 0) {
      this.logger.log(`Auth cart expiry: removed ${count} stale cart item(s) older than ${AUTH_CART_ITEM_TTL_HOURS}h`);
    }
  }
}
