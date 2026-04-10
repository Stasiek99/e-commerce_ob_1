import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { Przelewy24Client } from './przelewy24.client';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { WebhookPayloadDto } from './dto/webhook-payload.dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly p24: Przelewy24Client,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  async initiatePayment(orderId: string): Promise<{ paymentUrl: string }> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });

    const sessionId = uuidv4();

    const { token } = await this.p24.registerTransaction({
      sessionId,
      amount: order.totalInCents,
      currency: 'PLN',
      description: `Zamówienie #${order.orderNumber}`,
      email: order.snapshotEmail,
      client: `${order.snapshotFirstName} ${order.snapshotLastName}`,
      urlReturn: `${this.configService.get('P24_RETURN_URL')}?orderId=${orderId}`,
      urlNotify: this.configService.getOrThrow('P24_NOTIFY_URL'),
    });

    await this.prisma.payment.create({
      data: {
        orderId,
        p24SessionId: sessionId,
        p24Token: token,
        amountInCents: order.totalInCents,
        currency: 'PLN',
      },
    });

    return { paymentUrl: this.p24.getPaymentUrl(token) };
  }

  async handleWebhook(body: WebhookPayloadDto) {
    this.logger.log(`P24 webhook received: session=${body.sessionId}`);

    // 1. Verify signature BEFORE any DB access
    if (!this.p24.verifyWebhookSignature(body)) {
      this.logger.error(
        `Invalid webhook signature for session ${body.sessionId}`,
      );
      throw new ForbiddenException('Invalid webhook signature');
    }

    // 2. Look up payment
    const payment = await this.prisma.payment.findUnique({
      where: { p24SessionId: body.sessionId },
      include: { order: { include: { items: true } } },
    });

    if (!payment) {
      this.logger.warn(`No payment found for session ${body.sessionId}`);
      return;
    }

    // 3. Idempotency — skip if already completed
    if (payment.status === PaymentStatus.COMPLETED) {
      this.logger.log(
        `Payment already completed for session ${body.sessionId}, skipping`,
      );
      return;
    }

    // 4. Verify transaction with P24
    try {
      await this.p24.verifyTransaction({
        sessionId: body.sessionId,
        orderId: body.orderId,
        amount: body.amount,
        currency: body.currency,
      });
    } catch (err) {
      this.logger.error(
        `P24 verification failed for session ${body.sessionId}`,
        err,
      );

      // Payment failed — restore stock and mark as failed
      await this.handlePaymentFailure(payment.id, payment.orderId, payment.order.items);
      return;
    }

    // 5. Confirm payment + update order in a single transaction
    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.COMPLETED,
          p24OrderId: String(body.orderId),
          paidAt: new Date(),
          rawWebhookPayload: body as any,
        },
      }),
      this.prisma.order.update({
        where: { id: payment.orderId },
        data: { status: OrderStatus.PAID },
      }),
    ]);

    // 6. Send confirmation email (fire-and-forget with logging)
    this.emailService
      .sendPaymentConfirmed({
        to: payment.order.snapshotEmail,
        orderNumber: payment.order.orderNumber,
        firstName: payment.order.snapshotFirstName,
        totalInCents: payment.order.totalInCents,
      })
      // Fire-and-forget: EmailService.send already logs + reports to Sentry.
      .catch(() => undefined);
  }

  async getPaymentStatus(orderId: string) {
    return this.prisma.payment.findUnique({
      where: { orderId },
      select: { status: true, paidAt: true },
    });
  }

  /**
   * Handles payment failure: marks payment as FAILED, cancels order,
   * and restores stock for all order items.
   */
  private async handlePaymentFailure(
    paymentId: string,
    orderId: string,
    orderItems: Array<{ productVariantId: string; quantity: number }>,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.FAILED,
          failureReason: 'P24 verification failed',
        },
      });

      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
      });

      // Restore stock for each item
      for (const item of orderItems) {
        await tx.productVariant.update({
          where: { id: item.productVariantId },
          data: { stock: { increment: item.quantity } },
        });
      }
    });

    this.logger.log(
      `Payment failed for order ${orderId} — stock restored, order cancelled`,
    );
  }
}
