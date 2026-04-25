import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { InvoiceService } from '../invoice/invoice.service';
import { StripeClient } from './stripe.client';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeClient: StripeClient,
    private readonly emailService: EmailService,
    private readonly invoiceService: InvoiceService,
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
      this.prisma.orderEvent.create({
        data: {
          orderId: payment.orderId,
          fromStatus: OrderStatus.PENDING_PAYMENT,
          toStatus: OrderStatus.PAID,
          actor: 'SYSTEM:stripe-webhook',
          note: `Stripe session ${session.id}`,
        },
      }),
    ]);

    this.logger.log(
      `Payment completed for order ${payment.order.orderNumber} (session ${session.id})`,
    );

    // Internal admin notification (fire-and-forget)
    const adminEmail = this.configService.get<string>('ADMIN_ALERT_EMAIL');
    if (adminEmail) {
      const frontendUrl = this.configService.get<string>('FRONTEND_URL', '');
      this.emailService
        .sendNewOrderNotification({
          to: adminEmail,
          orderNumber: payment.order.orderNumber,
          customerEmail: payment.order.snapshotEmail,
          totalInCents: payment.order.totalInCents,
          items: payment.order.items.map((i) => ({
            name: i.snapshotName,
            quantity: i.quantity,
            price: i.snapshotPrice,
          })),
          carrierCode: payment.order.carrierCode,
          adminUrl: frontendUrl ? `${frontendUrl}/admin` : undefined,
        })
        .catch(() => undefined);
    }

    // Fire-and-forget: generate invoice PDF, upload, then email with attachment.
    // Falls back to a plain payment confirmation if invoice generation fails.
    this.invoiceService
      .processInvoice(payment.order)
      .then(({ url: _url, pdf }) =>
        this.emailService.sendPaymentConfirmedWithInvoice({
          to: payment.order.snapshotEmail,
          orderNumber: payment.order.orderNumber,
          firstName: payment.order.snapshotFirstName,
          items: payment.order.items.map((i) => ({
            name: i.snapshotName,
            quantity: i.quantity,
            price: i.snapshotPrice,
          })),
          shippingCostInCents: payment.order.shippingCostInCents,
          totalInCents: payment.order.totalInCents,
          invoiceUrl: _url,
          invoicePdf: pdf,
        }),
      )
      .catch((err: Error) => {
        this.logger.error(`Invoice generation failed for order ${payment.order.orderNumber}: ${err.message}`);
        // Still deliver payment confirmation even if invoice failed
        this.emailService
          .sendPaymentConfirmed({
            to: payment.order.snapshotEmail,
            orderNumber: payment.order.orderNumber,
            firstName: payment.order.snapshotFirstName,
            totalInCents: payment.order.totalInCents,
          })
          .catch(() => undefined);
      });
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

  async getPaymentStatus(orderId: string, requestingUserId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { orderId },
      select: { status: true, paidAt: true, order: { select: { userId: true } } },
    });

    if (!payment) throw new NotFoundException(`No payment found for order ${orderId}`);

    if (payment.order.userId !== requestingUserId) {
      throw new ForbiddenException('You do not have access to this order');
    }

    return { status: payment.status, paidAt: payment.paidAt };
  }

  /**
   * Reconciliation cron — runs every 10 minutes.
   * Finds payments stuck in PENDING for >30 min and reconciles against
   * Stripe. Catches webhook delivery failures or server restarts mid-flow.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async reconcilePendingPayments() {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    const stale = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.PENDING,
        createdAt: { lt: cutoff },
        stripeCheckoutSessionId: { not: null },
      },
      include: { order: { include: { items: true } } },
    });

    if (stale.length === 0) return;
    this.logger.log(`Reconciliation: found ${stale.length} stale PENDING payment(s)`);

    for (const payment of stale) {
      try {
        const session = await this.stripeClient.retrieveCheckoutSession(
          payment.stripeCheckoutSessionId!,
        );

        if (session.payment_status === 'paid') {
          await this.markSessionPaid(session);
        } else if (session.status === 'expired') {
          await this.handlePaymentFailure(
            payment.id,
            payment.orderId,
            payment.order.items,
            'Reconciliation: session expired',
          );
        }
        // status=open means the customer may still complete payment — leave it
      } catch (err) {
        this.logger.error(
          `Reconciliation failed for payment ${payment.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Expires a pending Stripe Checkout Session for a PENDING_PAYMENT order.
   * Best-effort — session may already be expired or non-existent.
   */
  async expirePendingCheckoutSession(orderId: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({ where: { orderId } });
    if (!payment?.stripeCheckoutSessionId) return;
    await this.stripeClient.expireCheckoutSession(payment.stripeCheckoutSessionId).catch(() => {});
  }

  /**
   * Issues a full Stripe refund, restores stock, and marks order as REFUNDED.
   * Call from the admin panel or an admin-only API endpoint.
   */
  async refundPayment(orderId: string, actor = 'ADMIN'): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { orderId },
      include: { order: { include: { items: true } } },
    });

    if (!payment) throw new NotFoundException(`No payment found for order ${orderId}`);

    if (payment.status === PaymentStatus.REFUNDED) {
      this.logger.warn(`Payment for order ${orderId} is already refunded`);
      return;
    }

    if (payment.status !== PaymentStatus.COMPLETED) {
      throw new Error(`Cannot refund payment with status ${payment.status}`);
    }

    if (!payment.stripePaymentIntentId) {
      throw new Error(`No Stripe PaymentIntent ID on payment ${payment.id}`);
    }

    await this.stripeClient.createRefund(payment.stripePaymentIntentId, orderId);

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.REFUNDED },
      });

      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.REFUNDED },
      });

      for (const item of payment.order.items) {
        await tx.productVariant.update({
          where: { id: item.productVariantId },
          data: { stock: { increment: item.quantity } },
        });
      }

      await tx.orderEvent.create({
        data: {
          orderId,
          fromStatus: OrderStatus.PAID,
          toStatus: OrderStatus.REFUNDED,
          actor,
          note: `Stripe refund issued for PaymentIntent ${payment.stripePaymentIntentId}`,
        },
      });
    });

    this.logger.log(
      `Refund issued for order ${payment.order.orderNumber} — stock restored`,
    );
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

      await tx.orderEvent.create({
        data: {
          orderId,
          fromStatus: OrderStatus.PENDING_PAYMENT,
          toStatus: OrderStatus.CANCELLED,
          actor: 'SYSTEM:stripe-webhook',
          note: failureReason,
        },
      });
    });

    this.logger.log(
      `Payment failed for order ${orderId} — stock restored, order cancelled (${failureReason})`,
    );
  }
}
