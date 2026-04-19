import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

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
}

@Injectable()
export class StripeClient {
  private readonly logger = new Logger(StripeClient.name);
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;
  private readonly paymentMethods: Stripe.Checkout.SessionCreateParams.PaymentMethodType[];

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.getOrThrow<string>('STRIPE_SECRET_KEY');
    this.webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
      '',
    );

    // Omit apiVersion to pin to the account default — avoids hardcoding a
    // version string that rots and requires manual bumps every few months.
    this.stripe = new Stripe(apiKey, { typescript: true });

    // Polish market: cards + BLIK + P24 + Apple/Google Pay (last two auto via 'card').
    this.paymentMethods = ['card'];

    if (!this.webhookSecret) {
      this.logger.warn(
        'STRIPE_WEBHOOK_SECRET not set — webhook signature verification will reject every request until it is configured.',
      );
    }
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<Stripe.Checkout.Session> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: this.paymentMethods,
      customer_email: input.customerEmail,
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
