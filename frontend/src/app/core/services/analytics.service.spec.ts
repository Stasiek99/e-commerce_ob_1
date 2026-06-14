import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, computed } from '@angular/core';
import { AnalyticsService } from './analytics.service';
import { ConsentService } from './consent.service';

function makeConsentMock(analyticsConsented: boolean) {
  return {
    analyticsConsented: computed(() => analyticsConsented),
    hasDecided: computed(() => true),
    acceptAll: jest.fn(),
    rejectNonEssential: jest.fn(),
  };
}

describe('AnalyticsService', () => {
  function setup(
    platformId: 'browser' | 'server',
    analyticsConsented = true,
  ): AnalyticsService {
    TestBed.configureTestingModule({
      providers: [
        AnalyticsService,
        { provide: PLATFORM_ID, useValue: platformId },
        { provide: ConsentService, useValue: makeConsentMock(analyticsConsented) },
      ],
    });
    return TestBed.inject(AnalyticsService);
  }

  afterEach(() => {
    document.querySelectorAll('script').forEach(el => {
      if ((el as HTMLScriptElement).src?.includes('googletagmanager.com')) el.remove();
    });
    document.querySelectorAll('noscript').forEach(el => el.remove());
  });

  // ── SSR / server ──────────────────────────────────────────────────────────

  describe('server (SSR)', () => {
    it('init() is a no-op and does not throw', () => {
      const svc = setup('server');
      expect(() => svc.init('GTM-TEST')).not.toThrow();
    });

    it('push() is a no-op and does not throw', () => {
      const svc = setup('server');
      expect(() => svc.push({ event: 'test' })).not.toThrow();
    });
  });

  // ── Browser ───────────────────────────────────────────────────────────────

  describe('browser', () => {
    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).dataLayer = undefined;
    });

    // init()
    describe('init()', () => {
      it('is a no-op when gtmId is empty string — no GTM script injected', () => {
        const svc = setup('browser');
        svc.init('');
        const gtmScript = Array.from(document.head.querySelectorAll('script')).find(
          s => (s as HTMLScriptElement).src?.includes('googletagmanager.com'),
        );
        expect(gtmScript).toBeUndefined();
      });

      it('injects an external <script src> into <head> pointing at the GTM container ID', () => {
        const svc = setup('browser');
        svc.init('GTM-TEST123');
        const gtmScript = Array.from(document.head.querySelectorAll('script')).find(
          s => (s as HTMLScriptElement).src?.includes('GTM-TEST123'),
        ) as HTMLScriptElement | undefined;
        expect(gtmScript).toBeTruthy();
        expect(gtmScript!.src).toContain('GTM-TEST123');
        expect(gtmScript!.src).toContain('googletagmanager.com');
        expect(gtmScript!.textContent).toBe('');
      });

      it('initialises window.dataLayer as an array', () => {
        const svc = setup('browser');
        svc.init('GTM-XYZ');
        expect(Array.isArray(window.dataLayer)).toBe(true);
      });

      it('does not inject GTM script when analytics consent is not granted', () => {
        const svc = setup('browser', false);
        svc.init('GTM-BLOCKED');
        const gtmScript = Array.from(document.head.querySelectorAll('script')).find(
          s => (s as HTMLScriptElement).src?.includes('GTM-BLOCKED'),
        );
        expect(gtmScript).toBeUndefined();
      });

      // ── placeholder GTM ID guard (fix #39) ─────────────────────────────────
      // Invariant: init() must not fire a real Google CDN request when the
      // environment file still contains the 'GTM-XXXXXXX' placeholder.

      it('is a no-op when gtmId is the exact placeholder GTM-XXXXXXX', () => {
        const svc = setup('browser');

        svc.init('GTM-XXXXXXX');

        const gtmScript = Array.from(document.head.querySelectorAll('script')).find(
          s => (s as HTMLScriptElement).src?.includes('googletagmanager.com'),
        );
        expect(gtmScript).toBeUndefined();
      });

      it('is a no-op for any id starting with GTM-XXX (placeholder family)', () => {
        const svc = setup('browser');

        svc.init('GTM-XXXABC');

        const gtmScript = Array.from(document.head.querySelectorAll('script')).find(
          s => (s as HTMLScriptElement).src?.includes('googletagmanager.com'),
        );
        expect(gtmScript).toBeUndefined();
      });

      it('proceeds normally for a real container ID that starts with GTM- but not GTM-XXX', () => {
        const svc = setup('browser');

        svc.init('GTM-ABC1234');

        const gtmScript = Array.from(document.head.querySelectorAll('script')).find(
          s => (s as HTMLScriptElement).src?.includes('GTM-ABC1234'),
        );
        expect(gtmScript).toBeDefined();
      });
    });

    // push()
    describe('push()', () => {
      it('sends {ecommerce: null} first to prevent ecommerce data from bleeding', () => {
        const svc = setup('browser');
        svc.push({ event: 'custom_event', ecommerce: { items: [] } });
        expect(window.dataLayer[0]).toEqual({ ecommerce: null });
        expect(window.dataLayer[1]).toEqual({
          event: 'custom_event',
          ecommerce: { items: [] },
        });
      });

      it('drops events silently when analytics consent is not granted', () => {
        const svc = setup('browser', false);
        svc.push({ event: 'add_to_cart' });
        expect(window.dataLayer).toBeUndefined();
      });
    });

    // trackViewItem()
    describe('trackViewItem()', () => {
      it('fires view_item with correct GA4 structure and cents→PLN conversion', () => {
        const svc = setup('browser');
        svc.trackViewItem({
          itemId: 'var-1',
          name: 'Santal 33',
          brand: 'Le Labo',
          variantLabel: '50 ml',
          category: 'Niszowe',
          priceInCents: 49900,
        });

        const event = window.dataLayer[1] as Record<string, unknown>;
        expect(event['event']).toBe('view_item');

        const ec = event['ecommerce'] as Record<string, unknown>;
        expect(ec['currency']).toBe('PLN');
        expect(ec['value']).toBe(499);

        const items = ec['items'] as Record<string, unknown>[];
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
          item_id: 'var-1',
          item_name: 'Santal 33',
          item_brand: 'Le Labo',
          item_variant: '50 ml',
          item_category: 'Niszowe',
          price: 499,
          quantity: 1,
        });
      });

      it('always sends quantity: 1 regardless of params', () => {
        const svc = setup('browser');
        svc.trackViewItem({ itemId: 'v', name: 'X', priceInCents: 1000 });

        const items = (
          (window.dataLayer[1] as Record<string, unknown>)['ecommerce'] as Record<string, unknown>
        )['items'] as Record<string, unknown>[];
        expect(items[0]['quantity']).toBe(1);
      });

      it('omits item_brand / item_category when brand / category are null', () => {
        const svc = setup('browser');
        svc.trackViewItem({
          itemId: 'var-2',
          name: 'Aqua di Gio',
          brand: null,
          category: null,
          variantLabel: '100 ml',
          priceInCents: 30000,
        });

        const items = (
          (window.dataLayer[1] as Record<string, unknown>)['ecommerce'] as Record<string, unknown>
        )['items'] as Record<string, unknown>[];
        expect(items[0]['item_brand']).toBeUndefined();
        expect(items[0]['item_category']).toBeUndefined();
      });

      it('drops the event silently when analytics consent is not granted', () => {
        const svc = setup('browser', false);
        svc.trackViewItem({ itemId: 'v', name: 'X', priceInCents: 1000 });
        expect(window.dataLayer).toBeUndefined();
      });

      it('clears the previous ecommerce object before pushing view_item', () => {
        const svc = setup('browser');
        svc.trackViewItem({ itemId: 'v', name: 'X', priceInCents: 1000 });
        expect(window.dataLayer[0]).toEqual({ ecommerce: null });
      });
    });

    // trackAddToCart()
    describe('trackAddToCart()', () => {
      it('fires add_to_cart with correct GA4 structure and cents→PLN conversion', () => {
        const svc = setup('browser');
        svc.trackAddToCart({
          itemId: 'var-1',
          name: 'Santal 33',
          brand: 'Le Labo',
          variantLabel: '50 ml',
          category: 'Niszowe',
          priceInCents: 49900,
          quantity: 2,
        });

        const event = window.dataLayer[1] as Record<string, unknown>;
        expect(event['event']).toBe('add_to_cart');

        const ec = event['ecommerce'] as Record<string, unknown>;
        expect(ec['currency']).toBe('PLN');
        expect(ec['value']).toBe(499);

        const items = ec['items'] as Record<string, unknown>[];
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
          item_id: 'var-1',
          item_name: 'Santal 33',
          item_brand: 'Le Labo',
          item_variant: '50 ml',
          item_category: 'Niszowe',
          price: 499,
          quantity: 2,
        });
      });

      it('omits item_brand / item_category when brand / category are null', () => {
        const svc = setup('browser');
        svc.trackAddToCart({
          itemId: 'var-2',
          name: 'Aqua di Gio',
          brand: null,
          category: null,
          variantLabel: '100 ml',
          priceInCents: 30000,
          quantity: 1,
        });

        const items = (
          (window.dataLayer[1] as Record<string, unknown>)['ecommerce'] as Record<string, unknown>
        )['items'] as Record<string, unknown>[];
        expect(items[0]['item_brand']).toBeUndefined();
        expect(items[0]['item_category']).toBeUndefined();
      });
    });

    // trackBeginCheckout()
    describe('trackBeginCheckout()', () => {
      it('fires begin_checkout with all items mapped and total in PLN', () => {
        const svc = setup('browser');
        svc.trackBeginCheckout({
          totalInCents: 15999,
          items: [
            {
              productVariantId: 'var-3',
              productName: 'Oud Noir',
              variantLabel: '100 ml',
              priceInCents: 15999,
              quantity: 1,
            },
          ],
        });

        const event = window.dataLayer[1] as Record<string, unknown>;
        expect(event['event']).toBe('begin_checkout');

        const ec = event['ecommerce'] as Record<string, unknown>;
        expect(ec['currency']).toBe('PLN');
        expect(ec['value']).toBe(159.99);

        const items = ec['items'] as Record<string, unknown>[];
        expect(items[0]).toMatchObject({
          item_id: 'var-3',
          item_name: 'Oud Noir',
          item_variant: '100 ml',
          price: 159.99,
          quantity: 1,
        });
      });
    });

    // trackPurchase()
    describe('trackPurchase()', () => {
      it('fires purchase with transaction_id, shipping and items in PLN', () => {
        const svc = setup('browser');
        svc.trackPurchase({
          transactionId: 'order-abc-123',
          totalInCents: 47499,
          shippingInCents: 1499,
          items: [
            {
              productVariantId: 'var-4',
              productName: 'Rose Velvet',
              variantLabel: '30 ml',
              priceInCents: 46000,
              quantity: 1,
            },
          ],
        });

        const event = window.dataLayer[1] as Record<string, unknown>;
        expect(event['event']).toBe('purchase');

        const ec = event['ecommerce'] as Record<string, unknown>;
        expect(ec['transaction_id']).toBe('order-abc-123');
        expect(ec['currency']).toBe('PLN');
        expect(ec['value']).toBeCloseTo(474.99, 2);
        expect(ec['shipping']).toBeCloseTo(14.99, 2);

        const items = ec['items'] as Record<string, unknown>[];
        expect(items[0]).toMatchObject({
          item_id: 'var-4',
          item_name: 'Rose Velvet',
          item_variant: '30 ml',
          price: 460,
          quantity: 1,
        });
      });
    });
  });
});
