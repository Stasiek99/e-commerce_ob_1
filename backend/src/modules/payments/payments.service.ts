import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { Przelewy24Client } from './przelewy24.client';
import { OrderStatus, PaymentStatus } from '@prisma/client';

interface P24WebhookBody {
  merchantId: number;
  posId: number;
  sessionId: string;
  amount: number;
  originAmount: number;
  currency: string;
  orderId: number;
  methodId: number;
  statement: string;
  sign: string;
}

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

  async handleWebhook(body: P24WebhookBody) {
    this.logger.log(`P24 webhook received: session=${body.sessionId}`);

    const payment = await this.prisma.payment.findUnique({
      where: { p24SessionId: body.sessionId },
      include: { order: true },
    });

    if (!payment) {
      this.logger.warn(`No payment found for session ${body.sessionId}`);
      return;
    }

    await this.p24.verifyTransaction({
      sessionId: body.sessionId,
      orderId: body.orderId,
      amount: body.amount,
      currency: body.currency,
    });

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

    // Fire-and-forget email
    this.emailService
      .sendPaymentConfirmed({
        to: payment.order.snapshotEmail,
        orderNumber: payment.order.orderNumber,
        firstName: payment.order.snapshotFirstName,
        totalInCents: payment.order.totalInCents,
      })
      .catch((err) => this.logger.error('Failed to send payment email', err));
  }

  async getPaymentStatus(orderId: string) {
    return this.prisma.payment.findUnique({
      where: { orderId },
      select: { status: true, paidAt: true },
    });
  }
}
