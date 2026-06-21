import {
  ComponentFixture,
  TestBed,
  fakeAsync,
  tick,
} from '@angular/core/testing';
import {
  provideHttpClient,
} from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { NO_ERRORS_SCHEMA, PLATFORM_ID } from '@angular/core';
import { CheckoutSuccessComponent } from '../checkout-success.component';
import { CartService } from '../../../../core/services/cart.service';
import { AuthService } from '../../../../core/services/auth.service';
import { AnalyticsService } from '../../../../core/services/analytics.service';
import { SeoService } from '../../../../core/services/seo.service';

function setup(orderId: string | null = 'order-1') {
  const mockCart     = { clear: jest.fn() };
  const mockAnalytics = { trackPurchase: jest.fn(), push: jest.fn() };
  const mockAuth = { currentUser: jest.fn().mockReturnValue(null) };

  TestBed.configureTestingModule({
    imports: [CheckoutSuccessComponent],
    schemas: [NO_ERRORS_SCHEMA],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: { get: (key: string) => (key === 'orderId' ? orderId : null) },
          },
        },
      },
      { provide: CartService,      useValue: mockCart },
      { provide: AuthService,      useValue: mockAuth },
      { provide: AnalyticsService, useValue: mockAnalytics },
    ],
  });

  const fixture   = TestBed.createComponent(CheckoutSuccessComponent);
  const component = fixture.componentInstance;
  const httpMock  = TestBed.inject(HttpTestingController);
  const router    = TestBed.inject(Router);
  const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);

  return { fixture, component, httpMock, mockCart, mockAnalytics, navigateSpy };
}

const statusUrl = (id = 'order-1') => (req: { url: string }) =>
  req.url.includes(`/payments/${id}/status`);

// ── robots meta tag ───────────────────────────────────────────────────────────

describe('CheckoutSuccessComponent — robots meta tag', () => {
  let fixture: ComponentFixture<CheckoutSuccessComponent>;
  let mockSeo: { setRobotsTag: jest.Mock; updatePageMeta: jest.Mock };
  let httpMock: HttpTestingController;

  beforeEach(() => {
    mockSeo = { setRobotsTag: jest.fn(), updatePageMeta: jest.fn() };

    TestBed.configureTestingModule({
      imports: [CheckoutSuccessComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: () => null } } },
        },
        { provide: CartService,      useValue: { clear: jest.fn() } },
        { provide: AuthService,      useValue: { currentUser: jest.fn().mockReturnValue(null) } },
        { provide: AnalyticsService, useValue: { trackPurchase: jest.fn(), push: jest.fn() } },
        { provide: SeoService,       useValue: mockSeo },
      ],
    });

    fixture = TestBed.createComponent(CheckoutSuccessComponent);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  it('sets noindex,nofollow on init so order IDs are never crawled by Googlebot', () => {
    fixture.detectChanges();

    expect(mockSeo.setRobotsTag).toHaveBeenCalledWith('noindex,nofollow');
    expect(mockSeo.setRobotsTag).toHaveBeenCalledTimes(1);
  });
});

// ── SSR platform guard ─────────────────────────────────────────────────────────
// Stripe redirects every successful payment to this route, and the prior bug
// ran the poll/navigate/cart-clear/analytics sequence unconditionally during SSR —
// wasting up to 10 backend round-trips per render and risking the GA4 purchase
// event firing from a discarded server render. These tests pin PLATFORM_ID to
// 'server' to guard against that regression.

describe('CheckoutSuccessComponent — SSR platform guard', () => {
  function setupOnServer(orderId: string | null = 'order-1') {
    const mockCart = { clear: jest.fn() };
    const mockAnalytics = { trackPurchase: jest.fn(), push: jest.fn() };
    const mockAuth = { currentUser: jest.fn().mockReturnValue(null) };
    const mockSeo = { setRobotsTag: jest.fn(), updatePageMeta: jest.fn() };

    TestBed.configureTestingModule({
      imports: [CheckoutSuccessComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'server' },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: { get: (key: string) => (key === 'orderId' ? orderId : null) },
            },
          },
        },
        { provide: CartService, useValue: mockCart },
        { provide: AuthService, useValue: mockAuth },
        { provide: AnalyticsService, useValue: mockAnalytics },
        { provide: SeoService, useValue: mockSeo },
      ],
    });

    const fixture = TestBed.createComponent(CheckoutSuccessComponent);
    const component = fixture.componentInstance;
    const httpMock = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);

    return { fixture, component, httpMock, mockCart, mockAnalytics, mockSeo, navigateSpy };
  }

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  it('does not strip session_id via router.navigate when rendered on the server', () => {
    const { fixture, navigateSpy } = setupOnServer();

    fixture.detectChanges();

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('does not issue the payment-status HTTP poll when rendered on the server, even after the timer would have fired', fakeAsync(() => {
    const { fixture, httpMock } = setupOnServer();

    fixture.detectChanges();
    tick(3000); // past the timer(0, 3000) first tick — would have fired on the browser

    httpMock.expectNone(statusUrl());
  }));

  it('does not clear the cart or fire any analytics event when rendered on the server, even after the timer would have fired', fakeAsync(() => {
    const { fixture, mockCart, mockAnalytics } = setupOnServer();

    fixture.detectChanges();
    tick(3000);

    expect(mockCart.clear).not.toHaveBeenCalled();
    expect(mockAnalytics.trackPurchase).not.toHaveBeenCalled();
    expect(mockAnalytics.push).not.toHaveBeenCalled();
  }));

  it('leaves loading=true on the server since the poll never ran (no false "payment failed" flash)', fakeAsync(() => {
    const { fixture, component } = setupOnServer();

    fixture.detectChanges();
    tick(3000);

    expect(component.loading()).toBe(true);
    expect(component.paid()).toBe(false);
  }));

  it('still sets the noindex robots tag on the server so the SSR HTML carries it for crawlers', () => {
    const { fixture, mockSeo } = setupOnServer();

    fixture.detectChanges();

    expect(mockSeo.setRobotsTag).toHaveBeenCalledWith('noindex,nofollow');
  });

  it('skips the guard entirely on the client even when orderId is absent', () => {
    const { fixture, navigateSpy } = setupOnServer(null);

    fixture.detectChanges();

    // Absent orderId never reaches the early-return inside the browser branch
    // because the server-platform guard returns first.
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

// ── payment status polling ────────────────────────────────────────────────────

describe('CheckoutSuccessComponent — payment status polling', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  // ── session_id cleanup ────────────────────────────────────────────────────

  it('replaces the URL with only orderId to strip session_id from browser history', fakeAsync(() => {
    const { fixture, navigateSpy, httpMock } = setup('order-1');

    fixture.detectChanges();
    tick(0);
    httpMock.expectOne(statusUrl()).flush({ status: 'COMPLETED', orderId: 'order-1' });

    expect(navigateSpy).toHaveBeenCalledWith([], {
      queryParams: { orderId: 'order-1' },
      replaceUrl: true,
    });
  }));

  it('navigates with orderId undefined when no orderId in query params', fakeAsync(() => {
    const { fixture, navigateSpy, httpMock } = setup(null);

    fixture.detectChanges();

    expect(navigateSpy).toHaveBeenCalledWith([], {
      queryParams: { orderId: undefined },
      replaceUrl: true,
    });
    httpMock.expectNone(statusUrl());
  }));

  // ── no orderId ─────────────────────────────────────────────────────────────

  it('sets loading to false immediately and makes no HTTP call when orderId is absent', fakeAsync(() => {
    const { fixture, component, httpMock } = setup(null);

    fixture.detectChanges();

    expect(component.loading()).toBe(false);
    expect(component.paid()).toBe(false);
    httpMock.expectNone(statusUrl());
  }));

  // ── first poll COMPLETED ───────────────────────────────────────────────────

  it('sets paid=true and loading=false when the first poll returns COMPLETED', fakeAsync(() => {
    const { fixture, component, httpMock, mockCart } = setup();

    fixture.detectChanges();
    tick(0); // timer(0, 3000) fires first tick immediately

    httpMock.expectOne(statusUrl()).flush({ status: 'COMPLETED', orderId: 'order-1' });

    expect(component.paid()).toBe(true);
    expect(component.loading()).toBe(false);
    expect(mockCart.clear).toHaveBeenCalledTimes(1);
  }));

  it('calls cart.clear() exactly once even if COMPLETED is received after several polls', fakeAsync(() => {
    const { fixture, component, httpMock, mockCart } = setup();

    fixture.detectChanges();

    tick(0);
    httpMock.expectOne(statusUrl()).flush({ status: 'PENDING', orderId: 'order-1' });

    tick(3000);
    httpMock.expectOne(statusUrl()).flush({ status: 'COMPLETED', orderId: 'order-1' });

    expect(mockCart.clear).toHaveBeenCalledTimes(1);
    expect(component.paid()).toBe(true);
  }));

  // ── polling advances through PENDING ──────────────────────────────────────

  it('keeps loading=true and paid=false while status is PENDING', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();

    fixture.detectChanges();
    tick(0);
    httpMock.expectOne(statusUrl()).flush({ status: 'PENDING', orderId: 'order-1' });

    // Still waiting after first PENDING response
    expect(component.paid()).toBe(false);
    expect(component.loading()).toBe(true);

    // Destroy to cancel the repeating timer via takeUntilDestroyed
    fixture.destroy();
    // Discard any remaining scheduled timer tick before the destroy propagated
    httpMock.match(statusUrl()); // drain any in-flight request
  }));

  it('sets paid=true after two PENDING responses followed by COMPLETED', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();

    fixture.detectChanges();

    tick(0);
    httpMock.expectOne(statusUrl()).flush({ status: 'PENDING', orderId: 'order-1' });

    tick(3000);
    httpMock.expectOne(statusUrl()).flush({ status: 'PENDING', orderId: 'order-1' });

    tick(3000);
    httpMock.expectOne(statusUrl()).flush({ status: 'COMPLETED', orderId: 'order-1' });

    expect(component.paid()).toBe(true);
    expect(component.loading()).toBe(false);
  }));

  // ── 30-second timeout ─────────────────────────────────────────────────────

  it('stops polling and sets loading=false after 10 PENDING responses (30 s timeout)', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();

    fixture.detectChanges();

    for (let i = 0; i < 10; i++) {
      tick(i === 0 ? 0 : 3000);
      httpMock.expectOne(statusUrl()).flush({ status: 'PENDING', orderId: 'order-1' });
    }

    expect(component.paid()).toBe(false);
    expect(component.loading()).toBe(false);
    expect(component.orderId()).toBe('order-1');

    // Confirm no further requests are pending
    httpMock.expectNone(statusUrl());
  }));

  // ── HTTP error ─────────────────────────────────────────────────────────────

  it('sets loading=false and keeps paid=false when the HTTP call errors', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();

    fixture.detectChanges();
    tick(0);

    httpMock.expectOne(statusUrl()).flush('Server Error', {
      status: 500,
      statusText: 'Internal Server Error',
    });

    expect(component.loading()).toBe(false);
    expect(component.paid()).toBe(false);
  }));

  // ── orderId signal ─────────────────────────────────────────────────────────

  it('sets orderId signal from the route query param', fakeAsync(() => {
    const { fixture, component, httpMock } = setup('abc-123');

    fixture.detectChanges();
    tick(0);
    httpMock.expectOne(statusUrl('abc-123')).flush({ status: 'COMPLETED', orderId: 'abc-123' });

    expect(component.orderId()).toBe('abc-123');
  }));
});

// ── firePurchaseEvent — backend-sourced GA4 data ──────────────────────────────

describe('CheckoutSuccessComponent — firePurchaseEvent uses backend data', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
    sessionStorage.removeItem('_pending_purchase');
  });

  it('calls trackPurchase with backend items and the backend-supplied totalInCents when response includes items, shippingInCents, and totalInCents', fakeAsync(() => {
    const { fixture, mockAnalytics, httpMock } = setup();

    fixture.detectChanges();
    tick(0);

    httpMock.expectOne(statusUrl()).flush({
      status: 'COMPLETED',
      orderNumber: 'ORD-001',
      shippingInCents: 1200,
      totalInCents: 39700,
      items: [
        { productVariantId: 'pv-1', productName: 'Noir', variantLabel: 'EDP 50ml', priceInCents: 15000, quantity: 2 },
        { productVariantId: 'pv-2', productName: 'Rose', variantLabel: 'EDT 30ml', priceInCents: 8500, quantity: 1 },
      ],
    });

    expect(mockAnalytics.trackPurchase).toHaveBeenCalledWith({
      transactionId: 'order-1',
      totalInCents: 39700,
      shippingInCents: 1200,
      items: [
        { productVariantId: 'pv-1', productName: 'Noir', variantLabel: 'EDP 50ml', priceInCents: 15000, quantity: 2 },
        { productVariantId: 'pv-2', productName: 'Rose', variantLabel: 'EDT 30ml', priceInCents: 8500, quantity: 1 },
      ],
    });
    expect(mockAnalytics.push).not.toHaveBeenCalled();
  }));

  it('correctly forwards totalInCents when shipping is zero', fakeAsync(() => {
    const { fixture, mockAnalytics, httpMock } = setup();

    fixture.detectChanges();
    tick(0);

    httpMock.expectOne(statusUrl()).flush({
      status: 'COMPLETED',
      orderNumber: 'ORD-002',
      shippingInCents: 0,
      totalInCents: 1500,
      items: [
        { productVariantId: 'pv-1', productName: 'Sample', variantLabel: '5ml', priceInCents: 500, quantity: 3 },
      ],
    });

    expect(mockAnalytics.trackPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ totalInCents: 1500, shippingInCents: 0 }),
    );
  }));

  // FIX: firePurchaseEvent previously recomputed the GA4 value as
  // itemsGross + shipping, which has no discount awareness and overstates
  // revenue on every coupon order. It must now use the backend's authoritative
  // totalInCents (already net of any coupon discount) instead.
  it('uses the backend totalInCents (net of coupon discount) instead of recomputing items gross + shipping', fakeAsync(() => {
    const { fixture, mockAnalytics, httpMock } = setup();

    fixture.detectChanges();
    tick(0);

    // items gross + shipping = 15000*2 + 8500*1 + 1200 = 39700, but a 5000 coupon
    // discount brings the real total down to 34700 — trackPurchase must report 34700.
    httpMock.expectOne(statusUrl()).flush({
      status: 'COMPLETED',
      orderNumber: 'ORD-DISCOUNT',
      shippingInCents: 1200,
      totalInCents: 34700,
      items: [
        { productVariantId: 'pv-1', productName: 'Noir', variantLabel: 'EDP 50ml', priceInCents: 15000, quantity: 2 },
        { productVariantId: 'pv-2', productName: 'Rose', variantLabel: 'EDT 30ml', priceInCents: 8500, quantity: 1 },
      ],
    });

    expect(mockAnalytics.trackPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ totalInCents: 34700 }),
    );
  }));

  it('falls back to push when totalInCents is absent even though items and shippingInCents are present', fakeAsync(() => {
    const { fixture, mockAnalytics, httpMock } = setup();

    fixture.detectChanges();
    tick(0);

    httpMock.expectOne(statusUrl()).flush({
      status: 'COMPLETED',
      orderNumber: 'ORD-NO-TOTAL',
      shippingInCents: 1200,
      items: [
        { productVariantId: 'pv-1', productName: 'Noir', variantLabel: 'EDP 50ml', priceInCents: 15000, quantity: 2 },
      ],
    });

    expect(mockAnalytics.push).toHaveBeenCalledWith({
      event: 'purchase',
      ecommerce: { transaction_id: 'order-1', currency: 'PLN' },
    });
    expect(mockAnalytics.trackPurchase).not.toHaveBeenCalled();
  }));

  it('falls back to push with only transaction_id when response lacks items', fakeAsync(() => {
    const { fixture, mockAnalytics, httpMock } = setup();

    fixture.detectChanges();
    tick(0);

    httpMock.expectOne(statusUrl()).flush({ status: 'COMPLETED', orderNumber: 'ORD-003' });

    expect(mockAnalytics.push).toHaveBeenCalledWith({
      event: 'purchase',
      ecommerce: { transaction_id: 'order-1', currency: 'PLN' },
    });
    expect(mockAnalytics.trackPurchase).not.toHaveBeenCalled();
  }));

  it('falls back to push when items array is empty', fakeAsync(() => {
    const { fixture, mockAnalytics, httpMock } = setup();

    fixture.detectChanges();
    tick(0);

    httpMock.expectOne(statusUrl()).flush({
      status: 'COMPLETED',
      orderNumber: 'ORD-004',
      shippingInCents: 0,
      items: [],
    });

    expect(mockAnalytics.push).toHaveBeenCalledWith({
      event: 'purchase',
      ecommerce: { transaction_id: 'order-1', currency: 'PLN' },
    });
    expect(mockAnalytics.trackPurchase).not.toHaveBeenCalled();
  }));

  it('falls back to push when shippingInCents is absent even if items are present', fakeAsync(() => {
    const { fixture, mockAnalytics, httpMock } = setup();

    fixture.detectChanges();
    tick(0);

    httpMock.expectOne(statusUrl()).flush({
      status: 'COMPLETED',
      orderNumber: 'ORD-005',
      items: [{ productVariantId: 'pv-1', productName: 'X', variantLabel: 'Y', priceInCents: 100, quantity: 1 }],
    });

    expect(mockAnalytics.push).toHaveBeenCalledWith({
      event: 'purchase',
      ecommerce: { transaction_id: 'order-1', currency: 'PLN' },
    });
    expect(mockAnalytics.trackPurchase).not.toHaveBeenCalled();
  }));

  it('does not read _pending_purchase from sessionStorage even when it contains stale data', fakeAsync(() => {
    // Populate sessionStorage with data from the old code path
    sessionStorage.setItem('_pending_purchase', JSON.stringify({
      items: [{ productVariantId: 'pv-stale', productName: 'Stale', variantLabel: 'old', priceInCents: 99999, quantity: 5 }],
      shippingInCents: 9999,
    }));

    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem');
    const { fixture, mockAnalytics, httpMock } = setup();

    fixture.detectChanges();
    tick(0);

    httpMock.expectOne(statusUrl()).flush({
      status: 'COMPLETED',
      orderNumber: 'ORD-006',
      shippingInCents: 500,
      totalInCents: 10500,
      items: [{ productVariantId: 'pv-real', productName: 'Real', variantLabel: 'real', priceInCents: 10000, quantity: 1 }],
    });

    // sessionStorage must not have been read for this key
    const pendingPurchaseReads = getItemSpy.mock.calls.filter(([key]) => key === '_pending_purchase');
    expect(pendingPurchaseReads).toHaveLength(0);

    // The real backend data (not stale sessionStorage) was used
    expect(mockAnalytics.trackPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ totalInCents: 10500, shippingInCents: 500 }),
    );

    getItemSpy.mockRestore();
  }));
});
