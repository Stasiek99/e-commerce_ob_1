import { randomBytes } from 'crypto';
import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type IORedis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import type { Stripe } from 'stripe/cjs/stripe.core';
import * as Sentry from '@sentry/nestjs';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { EmailQueueService } from '../email/email-queue.service';
import { InvoiceService } from '../invoice/invoice.service';
import { StripeClient } from './stripe.client';
import { InvoiceOrder } from '../invoice/invoice.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeClient: StripeClient,
    private readonly emailService: EmailQueueService,
    private readonly invoiceService: InvoiceService,
    private readonly configService: ConfigService,
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
  ) {}

  async initiatePayment(orderId: string): Promise<{ paymentUrl: string }> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });

    // Pre-checkout velocity guard: BLIK/P24 settles before Stripe Radar can block,
    // so we check for suspicious order bursts from the same city before issuing a session.
    const windowStart = new Date(Date.now() - 30 * 60 * 1000);
    const recentOrderCount = await this.prisma.order.count({
      where: { snapshotCity: order.snapshotCity, createdAt: { gte: windowStart } },
    });
    if (recentOrderCount > 3) {
      throw new HttpException('Order velocity limit reached', HttpStatus.TOO_MANY_REQUESTS);
    }

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

    // Upsert the Payment row — Payment.orderId is @unique so a plain create throws
    // P2002 on any retry. Three cases:
    //   1. PENDING + open session: customer navigated away and came back — reuse URL.
    //   2. PENDING + expired/missing session, or FAILED: reset the row, create new session.
    //   3. No prior row: create fresh.
    const existingPayment = await this.prisma.payment.findUnique({ where: { orderId } });
    let payment: { id: string };

    if (existingPayment?.status === PaymentStatus.PENDING && existingPayment.stripeCheckoutSessionId) {
      try {
        const existingSession = await this.stripeClient.retrieveCheckoutSession(
          existingPayment.stripeCheckoutSessionId,
        );
        if (existingSession.status === 'open' && existingSession.url) {
          return { paymentUrl: existingSession.url };
        }
      } catch {
        // Session not retrievable — fall through to reset and create a fresh session
      }
    }

    if (existingPayment?.status === PaymentStatus.FAILED ||
        existingPayment?.status === PaymentStatus.PENDING) {
      if (existingPayment.stripeCheckoutSessionId) {
        await this.stripeClient
          .expireCheckoutSession(existingPayment.stripeCheckoutSessionId)
          .catch(() => {});
      }
      payment = await this.prisma.payment.update({
        where: { id: existingPayment.id },
        data: {
          status: PaymentStatus.PENDING,
          stripeCheckoutSessionId: null,
          stripePaymentIntentId: null,
          failureReason: null,
        },
      });
    } else {
      payment = await this.prisma.payment.create({
        data: {
          orderId,
          amountInCents: order.totalInCents,
          currency: currency.toUpperCase(),
          provider: 'stripe',
          // stripeCheckoutSessionId / stripePaymentIntentId filled in after Stripe confirms
        },
      });
    }

    const guestToken = randomBytes(32).toString('hex');
    await this.redis.set(`order-token:${order.id}`, guestToken, 'EX', 3600);

    let session: Awaited<ReturnType<StripeClient['createCheckoutSession']>>;
    try {
      session = await this.stripeClient.createCheckoutSession({
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerEmail: order.snapshotEmail,
        currency,
        lineItems,
        successUrl: `${successUrl}?orderId=${order.id}&token=${guestToken}`,
        cancelUrl: `${cancelUrl}?orderId=${order.id}`,
        ...(order.discountInCents > 0 && {
          discountAmountInCents: order.discountInCents,
          couponLabel: order.couponCode ?? undefined,
        }),
      });
    } catch (stripeErr) {
      // Mark the row FAILED so the reconciliation cron (which filters on
      // stripeCheckoutSessionId != null) does not attempt to reconcile it.
      await this.prisma.payment
        .update({
          where: { id: payment.id },
          data: { status: PaymentStatus.FAILED, failureReason: (stripeErr as Error).message },
        })
        .catch(() => {});
      throw stripeErr;
    }

    if (!session.url) {
      await this.prisma.payment
        .update({
          where: { id: payment.id },
          data: { status: PaymentStatus.FAILED, failureReason: 'Stripe session missing redirect URL' },
        })
        .catch(() => {});
      throw new Error('Stripe Checkout Session missing redirect URL');
    }

    // Stripe confirmed — attach the session identifiers so the webhook and
    // reconciliation cron can find this record by stripeCheckoutSessionId.
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : (session.payment_intent?.id ?? null),
      },
    });

    return { paymentUrl: session.url };
  }

  /**
   * Handles a Stripe webhook event whose signature has already been verified
   * by the controller. Dispatches on event type and updates the matching
   * payment record idempotently.
   */
  async handleWebhookEvent(event: Stripe.Event) {
    this.logger.log(`Stripe webhook received: type=${event.type} id=${event.id}`);

    // Idempotency is enforced atomically inside each handler's $transaction:
    // processedStripeEvent.create is committed together with the state change,
    // so a crash between the two can never leave the event permanently skipped.
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await this.markSessionPaid(event.data.object as Stripe.Checkout.Session, event.id);
        break;

      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed':
        await this.markSessionFailed(
          event.data.object as Stripe.Checkout.Session,
          event.type,
          event.id,
        );
        break;

      case 'charge.refund.updated':
      case 'refund.updated':
        await this.handleRefundUpdate(event.data.object as Stripe.Refund, event.id);
        break;

      case 'charge.dispute.created':
        await this.handleDisputeCreated(event.data.object as Stripe.Dispute, event.id);
        break;

      case 'charge.dispute.closed':
        await this.handleDisputeClosed(event.data.object as Stripe.Dispute, event.id);
        break;

      default:
        // Stripe sends ~100 event types. We only react to the ones we care
        // about; everything else is ACKed with 200 so Stripe doesn't retry.
        this.logger.debug(`Ignoring Stripe event: ${event.type}`);
    }
  }

  private async markSessionPaid(session: Stripe.Checkout.Session, eventId?: string) {
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

    // Check Stripe Radar risk score before deciding final order status.
    // Defaults to 'normal' on any error so the payment is never silently dropped.
    let radarRiskLevel = 'normal';
    if (paymentIntentId) {
      try {
        const pi = await this.stripeClient.retrievePaymentIntentWithCharge(paymentIntentId);
        radarRiskLevel = pi.latest_charge?.outcome?.risk_level ?? 'normal';
      } catch (err: unknown) {
        this.logger.warn(
          `Could not retrieve Stripe charge for Radar risk check on order ${payment.order.orderNumber}: ${(err as Error).message}`,
        );
      }
    }

    const isFraudFlagged = radarRiskLevel === 'elevated' || radarRiskLevel === 'highest';
    const newOrderStatus = isFraudFlagged ? OrderStatus.FRAUD_REVIEW : OrderStatus.PAID;

    try {
      await this.prisma.$transaction([
        // Always insert a session-scoped key so concurrent callers (webhook + reconcile cron)
        // racing on the same session both hit P2002 — only one commit wins.
        this.prisma.processedStripeEvent.create({ data: { eventId: `paid-${session.id}` } }),
        // Additionally record the webhook event ID when present to deduplicate
        // multiple deliveries of the exact same Stripe event.
        ...(eventId ? [this.prisma.processedStripeEvent.create({ data: { eventId } })] : []),
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
          data: { status: newOrderStatus },
        }),
        this.prisma.orderEvent.create({
          data: {
            orderId: payment.orderId,
            fromStatus: payment.order.status as OrderStatus,
            toStatus: newOrderStatus,
            actor: 'SYSTEM:stripe-webhook',
            note: isFraudFlagged
              ? `Stripe session ${session.id} — held for fraud review (Radar risk: ${radarRiskLevel})`
              : `Stripe session ${session.id}`,
          },
        }),
      ]);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.warn(
          `Session ${session.id} already processed (eventId: ${eventId ?? 'reconcile'}) — skipping duplicate`,
        );
        return;
      }
      throw err;
    }

    // Delete the single-use Stripe coupon created for this checkout session.
    // Each discounted order produces a max_redemptions=1 coupon that Stripe never
    // auto-deletes; leaving them orphaned makes the Stripe Dashboard unnavigable
    // and risks hitting object limits at scale.
    const paidSessionCouponId = this.extractSessionCouponId(session);
    if (paidSessionCouponId) await this.stripeClient.deleteCoupon(paidSessionCouponId);

    if (isFraudFlagged) {
      this.logger.warn(
        `Order ${payment.order.orderNumber} held for FRAUD_REVIEW — Radar risk level: ${radarRiskLevel}`,
      );
      const adminEmail =
        this.configService.get<string>('ADMIN_ALERT_EMAIL') ||
        this.configService.get<string>('EMAIL_FROM');
      if (adminEmail) {
        const frontendUrl = this.configService.get<string>('FRONTEND_URL', '');
        this.emailService
          .sendFraudReviewAlert({
            to: adminEmail,
            orderNumber: payment.order.orderNumber,
            customerEmail: payment.order.snapshotEmail,
            totalInCents: payment.order.totalInCents,
            radarRiskLevel,
            adminUrl: frontendUrl
              ? `${frontendUrl}/admin/orders/${payment.orderId}`
              : undefined,
          })
          .catch((err: Error) => {
            this.logger.error(
              `Fraud review alert email failed for order ${payment.order.orderNumber}: ${err.message}`,
            );
            Sentry.captureException(err);
          });
      }
      // Customer is NOT notified until admin approves — do not reveal the hold.
      return;
    }

    this.logger.log(
      `Payment completed for order ${payment.order.orderNumber} (session ${session.id})`,
    );

    this.dispatchPostPaymentNotifications(payment.order, paymentIntentId);
  }

  /**
   * Admin approves a FRAUD_REVIEW order: moves to PAID and triggers the normal
   * post-payment notifications (invoice PDF + customer confirmation email).
   */
  async approveFraudReview(orderId: string, actor = 'ADMIN'): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: {
          select: {
            snapshotName: true,
            snapshotPrice: true,
            snapshotVatRate: true,
            quantity: true,
          },
        },
      },
    });

    if (order.status !== OrderStatus.FRAUD_REVIEW) {
      throw new Error(`Cannot approve order ${orderId}: status is ${order.status}, expected FRAUD_REVIEW`);
    }

    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { orderId } });

    await this.prisma.$transaction([
      this.prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.PAID } }),
      this.prisma.orderEvent.create({
        data: {
          orderId,
          fromStatus: OrderStatus.FRAUD_REVIEW,
          toStatus: OrderStatus.PAID,
          actor,
          note: 'Fraud review cleared — order approved',
        },
      }),
    ]);

    this.logger.log(`Fraud review approved for order ${order.orderNumber} by ${actor}`);
    this.dispatchPostPaymentNotifications(order, payment.stripePaymentIntentId);
  }

  private dispatchPostPaymentNotifications(
    order: InvoiceOrder & { snapshotEmail: string; carrierCode: string },
    _paymentIntentId: string | null,
  ) {
    const adminEmail =
      this.configService.get<string>('ADMIN_ALERT_EMAIL') ||
      this.configService.get<string>('EMAIL_FROM');
    if (adminEmail) {
      const frontendUrl = this.configService.get<string>('FRONTEND_URL', '');
      this.emailService
        .sendNewOrderNotification({
          to: adminEmail,
          orderNumber: order.orderNumber,
          customerEmail: order.snapshotEmail,
          totalInCents: order.totalInCents,
          items: order.items.map((i) => ({
            name: i.snapshotName,
            quantity: i.quantity,
            price: i.snapshotPrice,
          })),
          carrierCode: order.carrierCode,
          adminUrl: frontendUrl
            ? `${frontendUrl}/admin/orders/${order.id}`
            : undefined,
        })
        .catch((err: Error) => {
          this.logger.error(
            `Merchant email notification failed for order ${order.orderNumber}: ${err.message}`,
          );
          Sentry.captureException(err, {
            tags: { 'notification.channel': 'email', 'order.number': order.orderNumber },
          });
        });
    }

    const slackWebhookUrl = this.configService.get<string>('MERCHANT_SLACK_WEBHOOK_URL');
    if (slackWebhookUrl) {
      this.postSlackOrderAlert(slackWebhookUrl, {
        orderNumber: order.orderNumber,
        snapshotEmail: order.snapshotEmail,
        totalInCents: order.totalInCents,
      }).catch((err: Error) => {
        this.logger.warn(
          `Slack merchant notification failed for order ${order.orderNumber}: ${err.message}`,
        );
      });
    }

    // Fire-and-forget: generate invoice PDF, upload, then email with attachment.
    // Falls back to a plain payment confirmation if invoice generation fails.
    this.invoiceService
      .processInvoice(order)
      .then(({ url: invoiceUrl }) =>
        this.emailService.sendPaymentConfirmedWithInvoice({
          to: order.snapshotEmail,
          orderNumber: order.orderNumber,
          firstName: order.snapshotFirstName,
          items: order.items.map((i) => ({
            name: i.snapshotName,
            quantity: i.quantity,
            price: i.snapshotPrice,
          })),
          shippingCostInCents: order.shippingCostInCents,
          totalInCents: order.totalInCents,
          invoiceUrl,
        }),
      )
      .catch((err: Error) => {
        this.logger.error(`Invoice generation failed for order ${order.orderNumber}: ${err.message}`);
        Sentry.withScope((scope) => {
          scope.setTag('payment.event', 'invoice_generation_failed');
          scope.setContext('order', { orderNumber: order.orderNumber });
          Sentry.captureException(err);
        });
        this.emailService
          .sendPaymentConfirmed({
            to: order.snapshotEmail,
            orderNumber: order.orderNumber,
            firstName: order.snapshotFirstName,
            totalInCents: order.totalInCents,
          })
          .catch((e) => this.logger.warn('Payment confirmed email failed', e));
      });
  }

  private async markSessionFailed(
    session: Stripe.Checkout.Session,
    reasonType: string,
    eventId?: string,
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

    if (payment.status === PaymentStatus.FAILED) {
      // Already failed — stock was restored on first delivery; skip to prevent
      // double-restore if the processedStripeEvent insert ever races a crash.
      this.logger.log(
        `Payment ${payment.id} already FAILED — skipping duplicate failure event`,
      );
      return;
    }

    await this.handlePaymentFailure(
      payment.id,
      payment.orderId,
      payment.order.items,
      `Stripe event: ${reasonType}`,
      eventId,
    );

    const failedSessionCouponId = this.extractSessionCouponId(session);
    if (failedSessionCouponId) await this.stripeClient.deleteCoupon(failedSessionCouponId);
  }

  /**
   * Handles `charge.refund.updated` and `refund.updated` webhook events.
   *
   * Acts as a safety net for async payment methods (e.g. bank transfers) where
   * Stripe may return a `pending` refund from the API call and only later confirm
   * it via webhook — or for rare server-crash scenarios where the sync DB update
   * never completed.
   *
   * For full refunds: idempotently applies REFUNDED state + stock restoration.
   * For partial refunds: the sync path in `partialRefund()` is authoritative;
   * the webhook validates state consistency and logs if something looks wrong.
   */
  private async handleRefundUpdate(refund: Stripe.Refund, eventId?: string): Promise<void> {
    if (refund.status !== 'succeeded' && refund.status !== 'failed') {
      this.logger.debug(`Skipping refund ${refund.id} with transitional status "${refund.status}"`);
      return;
    }

    const paymentIntentId =
      typeof refund.payment_intent === 'string'
        ? refund.payment_intent
        : (refund.payment_intent?.id ?? null);

    if (!paymentIntentId) {
      this.logger.warn(`Refund ${refund.id} has no payment_intent — cannot reconcile`);
      return;
    }

    const payment = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      include: { order: { include: { items: true } } },
    });

    if (!payment) {
      this.logger.warn(`No payment found for PaymentIntent ${paymentIntentId} (refund ${refund.id})`);
      return;
    }

    if (refund.status === 'failed') {
      this.logger.error(
        `Stripe refund ${refund.id} FAILED for order ${payment.order.orderNumber} — manual review required`,
      );
      Sentry.withScope((scope) => {
        scope.setLevel('error');
        scope.setTag('payment.event', 'refund_failed');
        scope.setContext('refund', { refundId: refund.id, orderNumber: payment.order.orderNumber, paymentId: payment.id });
        Sentry.captureMessage(`Stripe refund failed: ${refund.id} for order ${payment.order.orderNumber}`, 'error');
      });
      return;
    }

    // status === 'succeeded' ────────────────────────────────────────────────

    if (payment.status === PaymentStatus.REFUNDED) {
      this.logger.debug(`Payment ${payment.id} already REFUNDED — refund webhook is a no-op`);
      return;
    }

    const isFullRefund = refund.amount >= payment.amountInCents;

    if (isFullRefund) {
      try {
        await this.prisma.$transaction(async (tx) => {
          if (eventId) {
            await tx.processedStripeEvent.create({ data: { eventId } });
          }
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.REFUNDED },
          });
          await tx.order.update({
            where: { id: payment.orderId },
            data: { status: OrderStatus.REFUNDED },
          });
          // Restore stock only for units not already restored by a prior partial cancel
          for (const item of payment.order.items) {
            const activeQty = item.quantity - (item.cancelledQuantity ?? 0);
            if (activeQty > 0) {
              await tx.productVariant.update({
                where: { id: item.productVariantId },
                data: { stock: { increment: activeQty } },
              });
            }
          }
          await tx.orderEvent.create({
            data: {
              orderId: payment.orderId,
              fromStatus: payment.order.status,
              toStatus: OrderStatus.REFUNDED,
              actor: 'SYSTEM:stripe-webhook',
              note: `Async refund ${refund.id} confirmed succeeded`,
            },
          });
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          this.logger.debug(`Stripe event ${eventId} already processed — skipping duplicate refund update`);
          return;
        }
        throw err;
      }

      this.logger.log(
        `Async full refund ${refund.id} applied for order ${payment.order.orderNumber}`,
      );
    } else {
      // Partial refund: `partialRefund()` is the authoritative sync path and updates
      // cancelledQuantity + stock + order status atomically. The webhook just validates.
      const alreadyHandled =
        payment.order.status === OrderStatus.PARTIALLY_REFUNDED ||
        payment.order.status === OrderStatus.REFUNDED;

      if (!alreadyHandled) {
        // Sync path failed (likely a DB crash after Stripe succeeded). Apply best-effort
        // recovery: mark the order PARTIALLY_REFUNDED and record the refunded amount so
        // financials are correct. cancelledQuantity per item cannot be reconstructed here —
        // it requires manual correction in the admin panel.
        this.logger.error(
          `[CRITICAL] Partial refund ${refund.id} succeeded for order ${payment.order.orderNumber} ` +
            `but order is still ${payment.order.status} — sync path failed. ` +
            `Applying best-effort recovery; cancelledQuantity requires manual correction.`,
        );
        Sentry.withScope((scope) => {
          scope.setLevel('fatal');
          scope.setTag('payment.event', 'partial_refund_sync_failed');
          scope.setContext('refund', {
            refundId: refund.id,
            orderNumber: payment.order.orderNumber,
            orderStatus: payment.order.status,
            paymentId: payment.id,
          });
          Sentry.captureMessage(
            `[CRITICAL] Partial refund sync failure: order ${payment.order.orderNumber} requires manual correction`,
            'fatal',
          );
        });
        try {
          await this.prisma.$transaction([
            ...(eventId ? [this.prisma.processedStripeEvent.create({ data: { eventId } })] : []),
            this.prisma.order.update({
              where: { id: payment.orderId },
              data: { status: OrderStatus.PARTIALLY_REFUNDED },
            }),
            this.prisma.payment.update({
              where: { id: payment.id },
              data: { refundedAmountInCents: { increment: refund.amount } },
            }),
            this.prisma.orderEvent.create({
              data: {
                orderId: payment.orderId,
                fromStatus: payment.order.status,
                toStatus: OrderStatus.PARTIALLY_REFUNDED,
                actor: 'SYSTEM:stripe-webhook',
                note: `Async partial refund ${refund.id} — cancelledQuantity requires manual correction`,
              },
            }),
          ]);
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            return;
          }
          throw err;
        }
      } else {
        this.logger.log(
          `Partial refund ${refund.id} confirmed for order ${payment.order.orderNumber} (sync path already applied)`,
        );
      }
    }
  }

  async getPaymentStatus(orderId: string, requestingUserId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { orderId },
      select: { status: true, paidAt: true, order: { select: { userId: true, orderNumber: true } } },
    });

    if (!payment) throw new NotFoundException(`No payment found for order ${orderId}`);

    if (payment.order.userId !== requestingUserId) {
      throw new ForbiddenException('You do not have access to this order');
    }

    return { status: payment.status, paidAt: payment.paidAt, orderNumber: payment.order.orderNumber };
  }

  async getPaymentStatusByToken(orderId: string, token: string) {
    const [payment, storedToken] = await Promise.all([
      this.prisma.payment.findUnique({
        where: { orderId },
        select: { status: true, paidAt: true, order: { select: { orderNumber: true } } },
      }),
      this.redis.get(`order-token:${orderId}`),
    ]);

    if (!payment) throw new NotFoundException(`No payment found for order ${orderId}`);

    if (!storedToken || storedToken !== token) {
      throw new UnauthorizedException('Invalid order token');
    }

    return { status: payment.status, paidAt: payment.paidAt, orderNumber: payment.order.orderNumber };
  }

  /**
   * Reconciliation cron — runs every 10 minutes.
   * Finds payments stuck in PENDING for >30 min and reconciles against
   * Stripe. Catches webhook delivery failures or server restarts mid-flow.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, { timeZone: 'Europe/Warsaw' })
  async reconcilePendingPayments() {
    const acquired = await this.redis.set('cron:reconcile-payments:lock', '1', 'EX', 540, 'NX');
    if (!acquired) return;

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
        Sentry.withScope((scope) => {
          scope.setTag('payment.event', 'reconciliation_failed');
          scope.setContext('payment', { paymentId: payment.id });
          Sentry.captureException(err);
        });
      }
    }
  }

  /**
   * Nightly cleanup of the processedStripeEvent deduplication log.
   * Stripe retries webhooks for up to 72 hours; 7 days gives a safe margin before rows are purged.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: 'Europe/Warsaw' })
  async pruneProcessedStripeEvents() {
    const acquired = await this.redis.set('cron:prune-stripe-events:lock', '1', 'EX', 82800, 'NX');
    if (!acquired) return;

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.processedStripeEvent.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (count > 0) {
      this.logger.log(`Pruned ${count} processed Stripe event(s) older than 7 days`);
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
      include: { order: { select: { orderNumber: true, status: true, items: true } } },
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

    // Stripe refund is now in flight. If the DB transaction below fails or the process
    // crashes, the charge.refund.updated webhook will fire and handleRefundUpdate() will
    // apply this state idempotently.
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.REFUNDED },
        });

        await tx.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.REFUNDED },
        });

        // Only restore units not already returned by a prior partial refund
        for (const item of payment.order.items) {
          const activeQuantity = item.quantity - (item.cancelledQuantity ?? 0);
          if (activeQuantity > 0) {
            await tx.productVariant.update({
              where: { id: item.productVariantId },
              data: { stock: { increment: activeQuantity } },
            });
          }
        }

        await tx.orderEvent.create({
          data: {
            orderId,
            fromStatus: payment.order.status,
            toStatus: OrderStatus.REFUNDED,
            actor,
            note: `Stripe refund issued for PaymentIntent ${payment.stripePaymentIntentId}`,
          },
        });
      });
    } catch (dbErr) {
      this.logger.error(
        `[CRITICAL] Full refund DB update failed for order ${payment.order.orderNumber} after Stripe refund succeeded. ` +
          `PaymentIntent: ${payment.stripePaymentIntentId}. ` +
          `charge.refund.updated webhook will recover automatically. DB error: ${(dbErr as Error).message}`,
      );
      throw dbErr;
    }

    this.logger.log(
      `Refund issued for order ${payment.order.orderNumber} — stock restored`,
    );
  }

  /**
   * Issues a Stripe partial refund for specific order items, restores their stock,
   * and transitions the order to PARTIALLY_REFUNDED (or REFUNDED if all items are cancelled).
   */
  async partialRefund(
    orderId: string,
    items: Array<{ orderItemId: string; productVariantId: string; quantity: number; priceInCents: number }>,
    currentOrderStatus: OrderStatus,
    actor: string,
  ): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { orderId },
      select: { id: true, status: true, stripePaymentIntentId: true, order: { select: { orderNumber: true } } },
    });

    if (!payment) throw new NotFoundException(`No payment found for order ${orderId}`);
    if (payment.status !== PaymentStatus.COMPLETED) {
      throw new Error(`Cannot issue a partial refund for payment with status ${payment.status}`);
    }
    if (!payment.stripePaymentIntentId) {
      throw new Error(`No Stripe PaymentIntent ID on payment ${payment.id}`);
    }

    const refundAmountInCents = items.reduce((s, i) => s + i.quantity * i.priceInCents, 0);
    const idempotencyKey = `${orderId}-${items.map(i => `${i.orderItemId}:${i.quantity}`).sort().join(',')}`;

    await this.stripeClient.createPartialRefund(payment.stripePaymentIntentId, refundAmountInCents, idempotencyKey);

    // Stripe partial refund is now in flight. If the DB transaction below fails or the
    // process crashes, the charge.refund.updated webhook fires and handleRefundUpdate()
    // will apply best-effort recovery (order → PARTIALLY_REFUNDED; cancelledQuantity
    // may need manual correction since per-item details aren't available to the webhook).
    try {
    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        await tx.orderItem.update({
          where: { id: item.orderItemId },
          data: { cancelledQuantity: { increment: item.quantity } },
        });
        await tx.productVariant.update({
          where: { id: item.productVariantId },
          data: { stock: { increment: item.quantity } },
        });
      }

      const updatedItems = await tx.orderItem.findMany({ where: { orderId } });
      const allCancelled = updatedItems.every(i => i.cancelledQuantity >= i.quantity);
      const newOrderStatus = allCancelled ? OrderStatus.REFUNDED : OrderStatus.PARTIALLY_REFUNDED;

      await tx.order.update({
        where: { id: orderId },
        data: { status: newOrderStatus },
      });

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          refundedAmountInCents: { increment: refundAmountInCents },
          ...(allCancelled && { status: PaymentStatus.REFUNDED }),
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId,
          fromStatus: currentOrderStatus,
          toStatus: newOrderStatus,
          actor,
          note: `Partial refund of ${refundAmountInCents} gr for ${items.length} item line(s)`,
        },
      });
    });
    } catch (dbErr) {
      this.logger.error(
        `[CRITICAL] Partial refund DB update failed for order ${payment.order.orderNumber} after Stripe refund succeeded. ` +
          `PaymentIntent: ${payment.stripePaymentIntentId}. ` +
          `Refund: ${refundAmountInCents} gr. ` +
          `Items: ${JSON.stringify(items.map(i => ({ orderItemId: i.orderItemId, qty: i.quantity })))}. ` +
          `charge.refund.updated webhook will attempt best-effort recovery. DB error: ${(dbErr as Error).message}`,
      );
      throw dbErr;
    }

    this.logger.log(
      `Partial refund of ${refundAmountInCents} gr issued for order ${payment.order.orderNumber}`,
    );
  }

  private async handleDisputeCreated(dispute: Stripe.Dispute, eventId?: string): Promise<void> {
    const paymentIntentId =
      typeof dispute.payment_intent === 'string'
        ? dispute.payment_intent
        : (dispute.payment_intent?.id ?? null);

    if (!paymentIntentId) {
      this.logger.warn(`Dispute ${dispute.id} has no payment_intent — cannot find order`);
      return;
    }

    const payment = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      include: { order: true },
    });

    if (!payment) {
      this.logger.warn(`No payment found for PaymentIntent ${paymentIntentId} (dispute ${dispute.id})`);
      return;
    }

    if (payment.order.status === OrderStatus.DISPUTE_HOLD) {
      this.logger.log(`Order ${payment.order.orderNumber} already in DISPUTE_HOLD — skipping`);
      return;
    }

    const priorStatus = payment.order.status;
    const evidenceDeadline = dispute.evidence_details?.due_by
      ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
      : 'unknown';

    try {
      await this.prisma.$transaction(async (tx) => {
        if (eventId) {
          await tx.processedStripeEvent.create({ data: { eventId } });
        }
        await tx.order.update({
          where: { id: payment.orderId },
          data: { status: OrderStatus.DISPUTE_HOLD },
        });
        await tx.orderEvent.create({
          data: {
            orderId: payment.orderId,
            fromStatus: priorStatus,
            toStatus: OrderStatus.DISPUTE_HOLD,
            actor: 'SYSTEM:stripe-webhook',
            note: `Dispute ${dispute.id} opened — reason: ${dispute.reason}, evidence due: ${evidenceDeadline}`,
          },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.log(`Dispute event ${eventId} already processed — skipping`);
        return;
      }
      throw err;
    }

    this.logger.warn(
      `Dispute opened: order ${payment.order.orderNumber} → DISPUTE_HOLD. Reason: ${dispute.reason}. Evidence due: ${evidenceDeadline}`,
    );

    Sentry.withScope((scope) => {
      scope.setLevel('error');
      scope.setTag('payment.event', 'dispute_created');
      scope.setContext('dispute', {
        disputeId: dispute.id,
        orderNumber: payment.order.orderNumber,
        reason: dispute.reason,
        amount: dispute.amount,
        currency: dispute.currency,
        evidenceDeadline,
      });
      Sentry.captureMessage(
        `Stripe dispute opened: order ${payment.order.orderNumber} — reason: ${dispute.reason} — evidence due ${evidenceDeadline}`,
        'error',
      );
    });

    const adminEmail =
      this.configService.get<string>('ADMIN_ALERT_EMAIL') ||
      this.configService.get<string>('EMAIL_FROM');
    if (adminEmail) {
      const frontendUrl = this.configService.get<string>('FRONTEND_URL', '');
      this.emailService
        .sendDisputeAlert({
          to: adminEmail,
          orderNumber: payment.order.orderNumber,
          customerEmail: payment.order.snapshotEmail,
          amountInCents: dispute.amount,
          reason: dispute.reason,
          evidenceDeadline,
          disputeId: dispute.id,
          adminUrl: frontendUrl ? `${frontendUrl}/admin/orders/${payment.orderId}` : undefined,
        })
        .catch((err: Error) => {
          this.logger.error(
            `Dispute alert email failed for order ${payment.order.orderNumber}: ${err.message}`,
          );
          Sentry.captureException(err);
        });
    }
  }

  private async handleDisputeClosed(dispute: Stripe.Dispute, eventId?: string): Promise<void> {
    const paymentIntentId =
      typeof dispute.payment_intent === 'string'
        ? dispute.payment_intent
        : (dispute.payment_intent?.id ?? null);

    if (!paymentIntentId) {
      this.logger.warn(`Dispute ${dispute.id} closed — no payment_intent, cannot find order`);
      return;
    }

    const payment = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      include: { order: { include: { items: true, shipment: true } } },
    });

    if (!payment) {
      this.logger.warn(`No payment found for PaymentIntent ${paymentIntentId} (dispute ${dispute.id})`);
      return;
    }

    if (payment.order.status !== OrderStatus.DISPUTE_HOLD) {
      this.logger.log(
        `Order ${payment.order.orderNumber} is ${payment.order.status}, not DISPUTE_HOLD — ignoring dispute closed event`,
      );
      return;
    }

    if (dispute.status === 'won') {
      const disputeEvent = await this.prisma.orderEvent.findFirst({
        where: { orderId: payment.orderId, toStatus: OrderStatus.DISPUTE_HOLD },
        orderBy: { createdAt: 'desc' },
      });
      const restoreStatus = disputeEvent?.fromStatus ?? OrderStatus.PAID;

      try {
        await this.prisma.$transaction(async (tx) => {
          if (eventId) {
            await tx.processedStripeEvent.create({ data: { eventId } });
          }
          await tx.order.update({
            where: { id: payment.orderId },
            data: { status: restoreStatus },
          });
          await tx.orderEvent.create({
            data: {
              orderId: payment.orderId,
              fromStatus: OrderStatus.DISPUTE_HOLD,
              toStatus: restoreStatus,
              actor: 'SYSTEM:stripe-webhook',
              note: `Dispute ${dispute.id} closed WON — order restored to ${restoreStatus}`,
            },
          });
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          this.logger.log(`Dispute closed event ${eventId} already processed — skipping`);
          return;
        }
        throw err;
      }

      this.logger.log(
        `Dispute ${dispute.id} WON: order ${payment.order.orderNumber} restored to ${restoreStatus}`,
      );
    } else if (dispute.status === 'lost') {
      // Funds already taken by Stripe. Restore stock only if label was never generated.
      const goodsShipped = !!payment.order.shipment?.labelUrl;

      try {
        await this.prisma.$transaction(async (tx) => {
          if (eventId) {
            await tx.processedStripeEvent.create({ data: { eventId } });
          }
          await tx.order.update({
            where: { id: payment.orderId },
            data: { status: OrderStatus.CANCELLED },
          });
          if (!goodsShipped) {
            for (const item of payment.order.items) {
              const activeQty = item.quantity - (item.cancelledQuantity ?? 0);
              if (activeQty > 0) {
                await tx.productVariant.update({
                  where: { id: item.productVariantId },
                  data: { stock: { increment: activeQty } },
                });
              }
            }
          }
          await tx.orderEvent.create({
            data: {
              orderId: payment.orderId,
              fromStatus: OrderStatus.DISPUTE_HOLD,
              toStatus: OrderStatus.CANCELLED,
              actor: 'SYSTEM:stripe-webhook',
              note: `Dispute ${dispute.id} closed LOST${goodsShipped ? ' — goods shipped, stock not restored' : ' — stock restored'}`,
            },
          });
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          this.logger.log(`Dispute closed event ${eventId} already processed — skipping`);
          return;
        }
        throw err;
      }

      this.logger.error(
        `Dispute ${dispute.id} LOST: order ${payment.order.orderNumber} cancelled. Goods shipped: ${goodsShipped}`,
      );
      Sentry.withScope((scope) => {
        scope.setLevel('fatal');
        scope.setTag('payment.event', 'dispute_lost');
        scope.setContext('dispute', {
          disputeId: dispute.id,
          orderNumber: payment.order.orderNumber,
          amount: dispute.amount,
          goodsShipped,
        });
        Sentry.captureMessage(
          `Stripe dispute LOST: order ${payment.order.orderNumber} — double loss confirmed`,
          'fatal',
        );
      });
    } else {
      this.logger.debug(`Dispute ${dispute.id} closed with status "${dispute.status}" — no action taken`);
    }
  }

  /**
   * Handles payment failure: marks payment as FAILED, cancels order,
   * and restores stock for all order items.
   */
  private extractSessionCouponId(session: Stripe.Checkout.Session): string | null {
    const discounts = (session as any).discounts as Array<{ coupon: string | { id: string } }> | undefined;
    const coupon = discounts?.[0]?.coupon;
    if (!coupon) return null;
    return typeof coupon === 'string' ? coupon : (coupon?.id ?? null);
  }

  private async handlePaymentFailure(
    paymentId: string,
    orderId: string,
    orderItems: Array<{ productVariantId: string; quantity: number }>,
    failureReason: string,
    eventId?: string,
  ) {
    try {
      await this.prisma.$transaction(async (tx) => {
        if (eventId) {
          await tx.processedStripeEvent.create({ data: { eventId } });
        }

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
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.warn(
          `Stripe event ${eventId} already processed — skipping duplicate failure event`,
        );
        return;
      }
      throw err;
    }

    this.logger.log(
      `Payment failed for order ${orderId} — stock restored, order cancelled (${failureReason})`,
    );
  }

  private async postSlackOrderAlert(
    webhookUrl: string,
    order: { orderNumber: string; snapshotEmail: string; totalInCents: number },
  ): Promise<void> {
    const total = (order.totalInCents / 100).toFixed(2);
    await axios.post(webhookUrl, {
      text: `🛍️ New paid order *#${order.orderNumber}* — ${total} PLN — ${order.snapshotEmail}`,
    });
  }
}
