import { Injectable, PLATFORM_ID, effect, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ConsentService } from './consent.service';

export interface AnalyticsItem {
  item_id: string;
  item_name: string;
  item_brand?: string;
  item_variant?: string;
  item_category?: string;
  price: number;
  quantity: number;
}

declare global {
  interface Window {
    dataLayer: unknown[];
  }
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly consent = inject(ConsentService);

  private gtmId = '';
  private gtmLoaded = false;

  constructor() {
    // Load GTM as soon as analytics consent is (or was already) granted.
    // Runs synchronously on init for returning visitors who already accepted.
    effect(() => {
      if (this.consent.analyticsConsented() && this.gtmId && !this.gtmLoaded) {
        this.loadGtm();
      }
    });
  }

  // Called from app.config.ts — registers the ID and fires GTM immediately
  // if the user already consented on a prior visit. For new visitors the
  // effect() above handles loading once they click "Accept all".
  init(gtmId: string): void {
    if (!this.isBrowser || !gtmId || gtmId.startsWith('GTM-XXX')) return;
    this.gtmId = gtmId;
    if (this.consent.analyticsConsented() && !this.gtmLoaded) {
      this.loadGtm();
    }
  }

  push(event: Record<string, unknown>): void {
    if (!this.isBrowser || !this.consent.analyticsConsented()) return;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push(event);
  }

  trackViewItem(params: {
    itemId: string;
    name: string;
    brand?: string | null;
    variantLabel?: string;
    category?: string | null;
    priceInCents: number;
  }): void {
    this.push({
      event: 'view_item',
      ecommerce: {
        currency: 'PLN',
        value: params.priceInCents / 100,
        items: [
          {
            item_id: params.itemId,
            item_name: params.name,
            item_brand: params.brand ?? undefined,
            item_variant: params.variantLabel,
            item_category: params.category ?? undefined,
            price: params.priceInCents / 100,
            quantity: 1,
          } satisfies AnalyticsItem,
        ],
      },
    });
  }

  trackAddToCart(params: {
    itemId: string;
    name: string;
    brand?: string | null;
    variantLabel?: string;
    category?: string | null;
    priceInCents: number;
    quantity: number;
  }): void {
    this.push({
      event: 'add_to_cart',
      ecommerce: {
        currency: 'PLN',
        value: params.priceInCents / 100,
        items: [
          {
            item_id: params.itemId,
            item_name: params.name,
            item_brand: params.brand ?? undefined,
            item_variant: params.variantLabel,
            item_category: params.category ?? undefined,
            price: params.priceInCents / 100,
            quantity: params.quantity,
          } satisfies AnalyticsItem,
        ],
      },
    });
  }

  trackBeginCheckout(params: {
    totalInCents: number;
    items: Array<{
      productVariantId: string;
      productName: string;
      variantLabel: string;
      priceInCents: number;
      quantity: number;
    }>;
  }): void {
    this.push({
      event: 'begin_checkout',
      ecommerce: {
        currency: 'PLN',
        value: params.totalInCents / 100,
        items: params.items.map(
          (i): AnalyticsItem => ({
            item_id: i.productVariantId,
            item_name: i.productName,
            item_variant: i.variantLabel,
            price: i.priceInCents / 100,
            quantity: i.quantity,
          }),
        ),
      },
    });
  }

  trackPurchase(params: {
    transactionId: string;
    totalInCents: number;
    shippingInCents: number;
    items: Array<{
      productVariantId: string;
      productName: string;
      variantLabel: string;
      priceInCents: number;
      quantity: number;
    }>;
  }): void {
    this.push({
      event: 'purchase',
      ecommerce: {
        transaction_id: params.transactionId,
        currency: 'PLN',
        value: params.totalInCents / 100,
        shipping: params.shippingInCents / 100,
        items: params.items.map(
          (i): AnalyticsItem => ({
            item_id: i.productVariantId,
            item_name: i.productName,
            item_variant: i.variantLabel,
            price: i.priceInCents / 100,
            quantity: i.quantity,
          }),
        ),
      },
    });
  }

  private loadGtm(): void {
    this.gtmLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${this.gtmId}`;
    const firstScript = document.getElementsByTagName('script')[0];
    if (firstScript?.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript);
    } else {
      document.head.appendChild(script);
    }

    const noscript = document.createElement('noscript');
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.googletagmanager.com/ns.html?id=${this.gtmId}`;
    iframe.height = '0';
    iframe.width = '0';
    iframe.style.cssText = 'display:none;visibility:hidden';
    noscript.appendChild(iframe);
    document.body.prepend(noscript);
  }
}
