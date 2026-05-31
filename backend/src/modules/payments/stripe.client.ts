import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StripeSDK = require('stripe') as { new(key: string): import('stripe/cjs/stripe.core').Stripe };
import type { Stripe } from 'stripe/cjs/stripe.core';

// Stripe's minimum is 30 minutes; default matches the reconciliation cron window.
const DEFAULT_SESSION_TTL_MINUTES = 30;

export interface CreateCheckoutSessionInput {
  orderId: string;
  orderNumber: string;
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

    // Omit apiVersion to pin to the account default — avoids hardcoding a
    // version string that rots and requires manual bumps every few months.
    this.stripe = new StripeSDK(apiKey);

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
      const coupon = await this.stripe.coupons.create({
        amount_off: input.discountAmountInCents,
        currency: input.currency.toLowerCase(),
        duration: 'once',
        max_redemptions: 1,
        name: input.couponLabel ?? 'Rabat',
      });
      discounts = [{ coupon: coupon.id }];
    }

    const session = await this.stripe.checkout.sessions.create({
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
      success_url: `${input.successUrl}?orderId=${input.orderId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: input.cancelUrl,
      locale: 'pl',
    });

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
  ): Promise<Stripe.Refund> {
    return this.stripe.refunds.create(
      { payment_intent: paymentIntentId, amount: amountInCents },
      { idempotencyKey: `partial-refund-${idempotencyKey}` },
    );
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
