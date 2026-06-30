import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StripeSDK = require('stripe') as {
  new(
    key: string,
    config?: { apiVersion: '2026-05-27.dahlia'; timeout?: number; maxNetworkRetries?: number },
  ): import('stripe/cjs/stripe.core').Stripe;
};
import type { Stripe } from 'stripe/cjs/stripe.core';

// Stripe's minimum is 30 minutes; default matches the reconciliation cron window.
const DEFAULT_SESSION_TTL_MINUTES = 30;

export interface CreateCheckoutSessionInput {
  orderId: string;
  orderNumber: string;
  /** Stable payment row ID used as idempotency key — prevents duplicate sessions on LB retries. */
  paymentId: string;
  customerEmail: string;
  currency: string;
  lineItems: Array<{
    name: string;
    description?: string;
    unitAmount: number;
    quantity: number;
  }>;
  successUrl: string;
  cancelUrl: string;
  /** Coupon discount already deducted in order.totalInCents — creates a Stripe coupon so Checkout charges the correct amount. */
  discountAmountInCents?: number;
  /** Human-readable label shown in the Stripe Checkout UI (e.g. the coupon code). */
  couponLabel?: string;
}

export interface RefundItemInput {
  orderItemId: string;
  productVariantId: string;
  quantity: number;
  discountAppliedInCents?: number;
}

@Injectable()
export class StripeClient {
  private readonly logger = new Logger(StripeClient.name);
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.getOrThrow<string>('STRIPE_SECRET_KEY');
    this.webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
      '',
    );

    // Explicitly pinned (accepted-tradeoffs.md "Stripe API version"): stripe-node
    // always sends a Stripe-Version header — `version: props.apiVersion || DEFAULT_API_VERSION`
    // in the SDK core — so leaving this unset never actually tracked the Stripe
    // account's Dashboard-configured default. It silently tracked whatever
    // version happened to be bundled with the installed `stripe` package instead,
    // which Dependabot's root-minor/root-patch groups can bump without anyone
    // reviewing a webhook/session payload shape change. Bump this string
    // deliberately, in its own commit, when intentionally upgrading the
    // integration — not as a side effect of a routine dependency bump.
    // No explicit timeout/retries previously meant every call rode the SDK's
    // defaults (80s timeout, 0 retries) — risking the synchronous webhook
    // handler (markSessionPaid's Radar check) holding the response open near
    // Stripe's own retry-patience window (business-process-model.md A7). Calls
    // that mutate state already pass an idempotencyKey (stripe.client.ts, see
    // createCheckoutSession/createCoupon), so automatic retries are safe here.
    this.stripe = new StripeSDK(apiKey, {
      apiVersion: '2026-05-27.dahlia',
      timeout: 15000,
      maxNetworkRetries: 2,
    });

    if (!this.webhookSecret) {
      this.logger.warn(
        'STRIPE_WEBHOOK_SECRET not set — webhook signature verification will reject every request until it is configured.',
      );
    }
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<Stripe.Checkout.Session> {
    const ttlMinutes = this.configService.get<number>(
      'STRIPE_CHECKOUT_TTL_MINUTES',
      DEFAULT_SESSION_TTL_MINUTES,
    );
    // Clamp to Stripe's minimum of 30 minutes
    const clampedTtlMinutes = Math.max(ttlMinutes, DEFAULT_SESSION_TTL_MINUTES);
    const expiresAt = Math.floor(Date.now() / 1000) + clampedTtlMinutes * 60;

    let discounts: Array<{ coupon: string }> | undefined;
    if (input.discountAmountInCents && input.discountAmountInCents > 0) {
      const coupon = await this.stripe.coupons.create(
        {
          amount_off: input.discountAmountInCents,
          currency: input.currency.toLowerCase(),
          duration: 'once',
          max_redemptions: 1,
          name: input.couponLabel ?? 'Rabat',
        },
        { idempotencyKey: `coupon-${input.paymentId}` },
      );
      discounts = [{ coupon: coupon.id }];
    }

    const session = await this.stripe.checkout.sessions.create(
      {
      mode: 'payment',
      payment_method_types: ['card', 'blik', 'p24'],
      customer_email: input.customerEmail,
      expires_at: expiresAt,
      line_items: input.lineItems.map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: item.unitAmount,
          product_data: {
            name: item.name,
            ...(item.description ? { description: item.description } : {}),
          },
        },
      })),
      ...(discounts ? { discounts } : {}),
      metadata: {
        orderId: input.orderId,
        orderNumber: input.orderNumber,
      },
      payment_intent_data: {
        metadata: {
          orderId: input.orderId,
          orderNumber: input.orderNumber,
        },
      },
      success_url: `${input.successUrl}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: input.cancelUrl,
      locale: 'pl',
    },
    { idempotencyKey: `checkout-${input.paymentId}` },
    );

    this.logger.log(
      `Stripe Checkout Session created: id=${session.id} order=${input.orderNumber}`,
    );
    return session;
  }

  /**
   * Verifies a webhook signature and returns the parsed Stripe event.
   * Throws if the signature is invalid or the secret is missing.
   *
   * Requires the untouched request body — do NOT pass a re-serialized
   * JSON object, Stripe's HMAC will fail.
   */
  async retrieveCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    return this.stripe.checkout.sessions.retrieve(sessionId);
  }

  async expireCheckoutSession(sessionId: string): Promise<void> {
    await this.stripe.checkout.sessions.expire(sessionId);
  }

  async retrievePaymentIntentWithCharge(paymentIntentId: string): Promise<Stripe.PaymentIntent & { latest_charge: Stripe.Charge | null }> {
    return this.stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge'],
    }) as Promise<Stripe.PaymentIntent & { latest_charge: Stripe.Charge | null }>;
  }

  async createRefund(paymentIntentId: string, idempotencyKey: string): Promise<Stripe.Refund> {
    return this.stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: `refund-${idempotencyKey}` },
    );
  }

  async createPartialRefund(
    paymentIntentId: string,
    amountInCents: number,
    idempotencyKey: string,
    items: RefundItemInput[],
  ): Promise<Stripe.Refund> {
    const metadata = this.buildRefundItemsMetadata(items);
    return this.stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: amountInCents,
        ...(metadata && { metadata }),
      },
      { idempotencyKey: `partial-refund-${idempotencyKey}` },
    );
  }

  /**
   * Encodes the per-item refund breakdown into the Stripe refund's own metadata
   * so handleRefundUpdate's crash-recovery path (payments.service.ts) can
   * reconstruct cancelledQuantity and stock restoration if the synchronous DB
   * write after this call never lands. Tuples (not keyed objects) keep the
   * encoding compact. Stripe caps metadata values at 500 characters — if an
   * order has enough distinct line items to exceed that, metadata is omitted
   * and the pre-existing manual-correction fallback applies. Recovery degrades
   * gracefully; it never corrupts.
   */
  private buildRefundItemsMetadata(items: RefundItemInput[]): Record<string, string> | undefined {
    const encoded = JSON.stringify(
      items.map((i) => [i.orderItemId, i.productVariantId, i.quantity, i.discountAppliedInCents ?? 0]),
    );
    if (encoded.length > 500) {
      this.logger.warn(
        `Refund items metadata (${encoded.length} chars) exceeds Stripe's 500-char limit — ` +
          `omitting; crash recovery for this refund will require manual correction`,
      );
      return undefined;
    }
    return { refundItems: encoded };
  }

  async listDisputesByPaymentIntent(paymentIntentId: string): Promise<Stripe.Dispute[]> {
    const result = await this.stripe.disputes.list({ payment_intent: paymentIntentId });
    return result.data;
  }

  async deleteCoupon(couponId: string): Promise<void> {
    try {
      await this.stripe.coupons.del(couponId);
      this.logger.debug(`One-time Stripe coupon ${couponId} deleted`);
    } catch (err) {
      // Already deleted or never existed — log and continue, do not block the webhook flow.
      this.logger.warn(`Stripe coupon cleanup failed for ${couponId}: ${(err as Error).message}`);
    }
  }

  constructWebhookEvent(rawBody: Buffer, signatureHeader: string): Stripe.Event {
    if (!this.webhookSecret) {
      throw new Error(
        'STRIPE_WEBHOOK_SECRET is not configured — cannot verify webhook signature',
      );
    }
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      this.webhookSecret,
    );
  }
}
