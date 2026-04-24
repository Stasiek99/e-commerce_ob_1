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
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { User } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { StripeClient } from './stripe.client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly stripeClient: StripeClient,
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

  @Get(':orderId/status')
  getStatus(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @CurrentUser() user: User,
  ) {
    return this.paymentsService.getPaymentStatus(orderId, user.id);
  }

  @Post(':orderId/refund')
  @HttpCode(HttpStatus.OK)
  async refund(@Param('orderId', ParseUUIDPipe) orderId: string) {
    await this.paymentsService.refundPayment(orderId);
    return { refunded: true };
  }
}
