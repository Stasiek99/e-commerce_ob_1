import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { WebhookPayloadDto } from './dto/webhook-payload.dto';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Przelewy24 IPN (Instant Payment Notification) webhook.
   * Must be Public — P24 calls this without any auth token.
   * P24 expects HTTP 200 on success, retries on non-200.
   */
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 30 } })  // 30 webhooks per minute
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Body() body: WebhookPayloadDto) {
    await this.paymentsService.handleWebhook(body);
    return { status: 'ok' };
  }

  @Get(':orderId/status')
  getStatus(@Param('orderId') orderId: string) {
    return this.paymentsService.getPaymentStatus(orderId);
  }
}
