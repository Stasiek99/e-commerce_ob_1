import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { StripeClient } from './stripe.client';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeClient: StripeClient,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  async initiatePayment(orderId: string): Promise<{ paymentUrl: string }> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });

    const currency = this.configService.get<string>('STRIPE_CURRENCY', 'pln');
    const successUrl = this.configService.getOrThrow<string>('STRIPE_SUCCESS_URL');
    const cancelUrl = this.configService.getOrThrow<string>('STRIPE_CANCEL_URL');

    const lineItems = order.items.map((item) => ({
      name: item.snapshotName,
      description: item.snapshotSku,
      unitAmount: item.snapshotPrice,
      quantity: item.quantity,
    }));

    if (order.shippingCostInCents > 0) {
      lineItems.push({
        name: 'Dostawa',
        description: order.carrierCode,
        unitAmount: order.shippingCostInCents,
        quantity: 1,
      });
    }

    const session = await this.stripeClient.createCheckoutSession({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerEmail: order.snapshotEmail,
      currency,
      lineItems,
      successUrl,
      cancelUrl,
    });

    await this.prisma.payment.create({
      data: {
        orderId,
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : (session.payment_intent?.id ?? null),
        amountInCents: order.totalInCents,
        currency: currency.toUpperCase(),
        provider: 'stripe',
      },
    });

    if (!session.url) {
      throw new Error('Stripe Checkout Session missing redirect URL');
    }

    return { paymentUrl: session.url };
  }

  /**
   * Handles a Stripe webhook event whose signature has already been verified
   * by the controller. Dispatches on event type and updates the matching
   * payment record idempotently.
   */
  async handleWebhookEvent(event: Stripe.Event) {
    this.logger.log(`Stripe webhook received: type=${event.type} id=${event.id}`);

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await this.markSessionPaid(event.data.object as Stripe.Checkout.Session);
        break;

      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed':
        await this.markSessionFailed(
          event.data.object as Stripe.Checkout.Session,
          event.type,
        );
        break;

      default:
        // Stripe sends ~100 event types. We only react to the ones we care
        // about; everything else is ACKed with 200 so Stripe doesn't retry.
        this.logger.debug(`Ignoring Stripe event: ${event.type}`);
    }
  }

  private async markSessionPaid(session: Stripe.Checkout.Session) {
    const payment = await this.prisma.payment.findUnique({
      where: { stripeCheckoutSessionId: session.id },
      include: { order: { include: { items: true } } },
    });

    if (!payment) {
      this.logger.warn(`No payment found for Stripe session ${session.id}`);
      return;
    }

    // Idempotency — skip if already completed
    if (payment.status === PaymentStatus.COMPLETED) {
      this.logger.log(
        `Payment already completed for session ${session.id}, skipping`,
      );
      return;
    }

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);

    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.COMPLETED,
          stripePaymentIntentId: paymentIntentId,
          paidAt: new Date(),
          rawWebhookPayload: session as unknown as object,
        },
      }),
      this.prisma.order.update({
        where: { id: payment.orderId },
        data: { status: OrderStatus.PAID },
      }),
    ]);

    this.logger.log(
      `Payment completed for order ${payment.order.orderNumber} (session ${session.id})`,
    );

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

  private async markSessionFailed(
    session: Stripe.Checkout.Session,
    reasonType: string,
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { stripeCheckoutSessionId: session.id },
      include: { order: { include: { items: true } } },
    });

    if (!payment) {
      this.logger.warn(`No payment found for Stripe session ${session.id}`);
      return;
    }

    if (payment.status === PaymentStatus.COMPLETED) {
      // Already paid — ignore stray expired/failed event.
      return;
    }

    await this.handlePaymentFailure(
      payment.id,
      payment.orderId,
      payment.order.items,
      `Stripe event: ${reasonType}`,
    );
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
    failureReason: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.FAILED,
          failureReason,
        },
      });

      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
      });

      for (const item of orderItems) {
        await tx.productVariant.update({
          where: { id: item.productVariantId },
          data: { stock: { increment: item.quantity } },
        });
      }
    });

    this.logger.log(
      `Payment failed for order ${orderId} — stock restored, order cancelled (${failureReason})`,
    );
  }
}
