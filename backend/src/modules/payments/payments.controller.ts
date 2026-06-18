import { timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { User } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { StripeClient } from './stripe.client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtGuard } from '../auth/guards/optional-jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '@fragrance-store/shared-types';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly stripeClient: StripeClient,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Stripe webhook endpoint. Public because Stripe calls it without any
   * auth token — security is provided by the HMAC signature header
   * (`stripe-signature`) which we verify against STRIPE_WEBHOOK_SECRET
   * using the untouched raw request body.
   *
   * Returns 200 on success so Stripe stops retrying. Returns 400 on
   * signature mismatch (Stripe will retry with exponential backoff).
   */
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @SkipThrottle({ burst: true, sustained: true })
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    if (!req.rawBody) {
      throw new BadRequestException('Raw body not available for signature verification');
    }

    let event;
    try {
      event = this.stripeClient.constructWebhookEvent(req.rawBody, signature);
    } catch (err) {
      this.logger.error(
        `Stripe webhook signature verification failed: ${(err as Error).message}`,
      );
      throw new BadRequestException('Invalid Stripe webhook signature');
    }

    await this.paymentsService.handleWebhookEvent(event);
    return { received: true };
  }

  @Public()
  @UseGuards(OptionalJwtGuard)
  @Get(':orderId/status')
  getStatus(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @CurrentUser() user: User | undefined,
    @Query('token') token: string | undefined,
  ) {
    if (user) return this.paymentsService.getPaymentStatus(orderId, user.id);
    if (token) return this.paymentsService.getPaymentStatusByToken(orderId, token);
    throw new UnauthorizedException('Authentication or order token required');
  }

  @Post(':orderId/refund')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async refund(@Param('orderId', ParseUUIDPipe) orderId: string) {
    await this.paymentsService.refundPayment(orderId);
    return { refunded: true };
  }

  /**
   * External-cron trigger for the reconciliation job.
   *
   * The in-process @Cron decorator does not fire when Railway's hobby-tier
   * container is sleeping. This endpoint is the external wake-up hook:
   * configure a Railway Cron Job service (or cron-job.org / UptimeRobot) to
   * POST here every 10 minutes with Authorization: Bearer <PAYMENTS_RECONCILE_SECRET>.
   *
   * Returns 200 synchronously — reconciliation runs in the background so the
   * cron caller does not need to wait for Stripe API round-trips.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  async triggerReconciliation(
    @Headers('authorization') authorization: string,
  ) {
    const secret = this.configService.get<string>('PAYMENTS_RECONCILE_SECRET', '');
    const expected = Buffer.from(`Bearer ${secret}`);
    const actual = Buffer.from(authorization ?? '');
    if (!secret || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException('Invalid reconcile secret');
    }

    // Fire-and-forget: the cron caller gets 200 immediately; reconciliation
    // runs asynchronously and logs any errors via the existing @Cron path.
    this.paymentsService.reconcilePendingPayments().catch((err) => this.logger.warn('reconcilePendingPayments failed', err));

    return { triggered: true };
  }
}
