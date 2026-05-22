import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

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

  init(gtmId: string): void {
    if (!this.isBrowser || !gtmId) return;
    window.dataLayer = window.dataLayer || [];
    const script = document.createElement('script');
    script.textContent = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');`;
    document.head.appendChild(script);
    const noscript = document.createElement('noscript');
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.googletagmanager.com/ns.html?id=${gtmId}`;
    iframe.height = '0';
    iframe.width = '0';
    iframe.style.cssText = 'display:none;visibility:hidden';
    noscript.appendChild(iframe);
    document.body.prepend(noscript);
  }

  push(event: Record<string, unknown>): void {
    if (!this.isBrowser) return;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push(event);
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
}
