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
import { ActivatedRoute } from '@angular/router';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CheckoutSuccessComponent } from '../checkout-success.component';
import { CartService } from '../../../../core/services/cart.service';
import { AnalyticsService } from '../../../../core/services/analytics.service';

function setup(orderId: string | null = 'order-1') {
  const mockCart     = { clear: jest.fn() };
  const mockAnalytics = { trackPurchase: jest.fn(), push: jest.fn() };

  TestBed.configureTestingModule({
    imports: [CheckoutSuccessComponent],
    schemas: [NO_ERRORS_SCHEMA],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: { get: (key: string) => (key === 'orderId' ? orderId : null) },
          },
        },
      },
      { provide: CartService,      useValue: mockCart },
      { provide: AnalyticsService, useValue: mockAnalytics },
    ],
  });

  const fixture   = TestBed.createComponent(CheckoutSuccessComponent);
  const component = fixture.componentInstance;
  const httpMock  = TestBed.inject(HttpTestingController);

  return { fixture, component, httpMock, mockCart, mockAnalytics };
}

const statusUrl = (id = 'order-1') => (req: { url: string }) =>
  req.url.includes(`/payments/${id}/status`);

describe('CheckoutSuccessComponent — payment status polling', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

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
