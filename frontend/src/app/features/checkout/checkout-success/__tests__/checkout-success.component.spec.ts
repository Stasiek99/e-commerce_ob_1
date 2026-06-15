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
import { NO_ERRORS_SCHEMA } from '@angular/core';
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
