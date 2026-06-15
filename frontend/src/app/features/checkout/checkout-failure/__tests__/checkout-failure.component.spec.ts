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
import { CheckoutFailureComponent } from '../checkout-failure.component';
import { SeoService } from '../../../../core/services/seo.service';

function setup(opts: { orderId?: string | null; guestToken?: string | null } = {}) {
  const { orderId = 'order-1', guestToken = null } = opts;

  const queryParams: Record<string, string | null> = {
    orderId,
    guestToken,
  };

  TestBed.configureTestingModule({
    imports: [CheckoutFailureComponent],
    schemas: [NO_ERRORS_SCHEMA],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            queryParamMap: {
              get: (key: string) => queryParams[key] ?? null,
            },
          },
        },
      },
    ],
  });

  const fixture   = TestBed.createComponent(CheckoutFailureComponent);
  const component = fixture.componentInstance;
  const httpMock  = TestBed.inject(HttpTestingController);
  const router    = TestBed.inject(Router);
  const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);

  fixture.detectChanges();

  return { fixture, component, httpMock, navigateSpy };
}

// ── robots meta tag ───────────────────────────────────────────────────────────

describe('CheckoutFailureComponent — robots meta tag', () => {
  let fixture: ComponentFixture<CheckoutFailureComponent>;
  let mockSeo: { setRobotsTag: jest.Mock };
  let httpMock: HttpTestingController;

  beforeEach(() => {
    mockSeo = { setRobotsTag: jest.fn() };

    TestBed.configureTestingModule({
      imports: [CheckoutFailureComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: () => null } } },
        },
        { provide: SeoService, useValue: mockSeo },
      ],
    });

    fixture = TestBed.createComponent(CheckoutFailureComponent);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  it('sets noindex,nofollow on init so failure pages are never crawled by Googlebot', () => {
    fixture.detectChanges();

    expect(mockSeo.setRobotsTag).toHaveBeenCalledWith('noindex,nofollow');
    expect(mockSeo.setRobotsTag).toHaveBeenCalledTimes(1);
  });
});

// ── guest cancel token ────────────────────────────────────────────────────────

describe('CheckoutFailureComponent — guest cancel token', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  // ── guestToken signal ─────────────────────────────────────────────────────

  it('reads guestToken from query params into the signal', () => {
    const { component, httpMock } = setup({ guestToken: 'abc123' });

    expect(component.guestToken()).toBe('abc123');
    httpMock.expectNone(() => true);
  });

  it('sets guestToken to null when the query param is absent', () => {
    const { component, httpMock } = setup({ guestToken: null });

    expect(component.guestToken()).toBeNull();
    httpMock.expectNone(() => true);
  });

  // ── cancelOrder — token included when present ─────────────────────────────

  it('appends ?token=<guestToken> to the cancel request for guest users', fakeAsync(() => {
    const { component, httpMock, navigateSpy } = setup({ orderId: 'order-42', guestToken: 'secret-token' });

    component.cancelOrder();

    const req = httpMock.expectOne((r) => r.url === '/api/orders/order-42/cancel');
    expect(req.request.params.get('token')).toBe('secret-token');
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(navigateSpy).toHaveBeenCalledWith(['/cart']);
  }));

  // ── cancelOrder — no token param when guestToken is null ─────────────────

  it('sends no token param when guestToken is absent (authenticated user)', fakeAsync(() => {
    const { component, httpMock, navigateSpy } = setup({ orderId: 'order-99', guestToken: null });

    component.cancelOrder();

    const req = httpMock.expectOne((r) => r.url === '/api/orders/order-99/cancel');
    expect(req.request.params.has('token')).toBe(false);
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(navigateSpy).toHaveBeenCalledWith(['/cart']);
  }));

  // ── cancelOrder — success navigates to /cart ─────────────────────────────

  it('navigates to /cart on successful cancel', fakeAsync(() => {
    const { component, httpMock, navigateSpy } = setup({ orderId: 'order-1', guestToken: 'tok' });

    component.cancelOrder();
    httpMock.expectOne((r) => r.url.includes('/cancel')).flush(null, { status: 204, statusText: 'No Content' });

    expect(navigateSpy).toHaveBeenCalledWith(['/cart']);
  }));

  // ── cancelOrder — error shows cancelError message ─────────────────────────

  it('sets cancelError message and resets cancelling when cancel request fails', fakeAsync(() => {
    const { component, httpMock, navigateSpy } = setup({ orderId: 'order-1', guestToken: 'tok' });

    component.cancelOrder();

    const req = httpMock.expectOne((r) => r.url.includes('/cancel'));
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(component.cancelling()).toBe(false);
    expect(component.cancelError()).toBe(
      'Nie udało się anulować zamówienia. Skontaktuj się z obsługą sklepu.',
    );
    expect(navigateSpy).not.toHaveBeenCalled();
  }));

  it('previously shown cancelError is cleared when cancelOrder is called again', fakeAsync(() => {
    const { component, httpMock } = setup({ orderId: 'order-1', guestToken: 'tok' });

    // First attempt — fails
    component.cancelOrder();
    httpMock.expectOne((r) => r.url.includes('/cancel')).flush('Error', { status: 500, statusText: 'Error' });
    expect(component.cancelError()).not.toBeNull();

    // Second attempt — clears the error immediately
    component.cancelOrder();
    expect(component.cancelError()).toBeNull();

    // Drain the in-flight request
    httpMock.expectOne((r) => r.url.includes('/cancel')).flush(null, { status: 204, statusText: 'No Content' });
  }));

  // ── cancelOrder — guards against missing orderId ─────────────────────────

  it('does not fire an HTTP request when orderId is null', fakeAsync(() => {
    const { component, httpMock } = setup({ orderId: null, guestToken: 'tok' });

    component.cancelOrder();

    httpMock.expectNone(() => true);
  }));

  // ── retryPayment — resets retrying on error ───────────────────────────────

  it('resets retrying to false when retryPayment request fails', fakeAsync(() => {
    const { component, httpMock } = setup({ orderId: 'order-1' });

    component.retryPayment();
    expect(component.retrying()).toBe(true);

    httpMock
      .expectOne((r) => r.url.includes('/retry-payment'))
      .flush('Error', { status: 500, statusText: 'Error' });

    expect(component.retrying()).toBe(false);
  }));

  it('does not fire a retry request when orderId is null', fakeAsync(() => {
    const { component, httpMock } = setup({ orderId: null });

    component.retryPayment();

    httpMock.expectNone(() => true);
  }));
});
