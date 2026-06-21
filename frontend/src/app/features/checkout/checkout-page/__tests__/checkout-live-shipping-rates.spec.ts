import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { CheckoutPageComponent } from '../checkout-page.component';
import { CartService } from '../../../../core/services/cart.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../core/services/toast.service';
import { AnalyticsService } from '../../../../core/services/analytics.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';
import { environment } from '../../../../../environments/environment';

const RATES_URL = `${environment.apiUrl}/shipping/rates`;

function setup() {
  const mockCart = {
    items: jest.fn().mockReturnValue([]),
    totalInCents: jest.fn().mockReturnValue(5000),
    refreshFromServer: jest.fn(),
  };
  const mockAuth = {
    isAuthenticated: jest.fn().mockReturnValue(false),
    currentUser: jest.fn().mockReturnValue(null),
  };

  TestBed.configureTestingModule({
    imports: [CheckoutPageComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: CartService, useValue: mockCart },
      { provide: AuthService, useValue: mockAuth },
      { provide: ToastService, useValue: { success: jest.fn(), error: jest.fn(), info: jest.fn() } },
      { provide: AnalyticsService, useValue: { trackBeginCheckout: jest.fn(), trackPurchase: jest.fn() } },
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  TestBed.overrideComponent(CheckoutPageComponent, {
    set: {
      imports: [ReactiveFormsModule, PricePipe],
      schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
    },
  });

  const fixture = TestBed.createComponent(CheckoutPageComponent);
  const component = fixture.componentInstance;
  const http = TestBed.inject(HttpTestingController);

  fixture.detectChanges();

  return { component, fixture, http };
}

describe('CheckoutPageComponent — live shipping rates sync (GET /shipping/rates)', () => {
  afterEach(() => jest.clearAllMocks());

  // ── fetches live rates on init ────────────────────────────────────────

  it('issues a GET to /shipping/rates on ngOnInit', () => {
    const { http } = setup();

    const req = http.expectOne(RATES_URL);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  // ── happy path: hardcoded price is replaced by the live DB price ─────

  it('replaces the hardcoded DHL price with the live priceInCents from the API', () => {
    const { component, http } = setup();

    http.expectOne(RATES_URL).flush([
      { carrier: 'DHL', name: 'DHL Kurier', priceInCents: 2599, estimatedDays: '1-2 dni robocze' },
    ]);

    const dhl = component.carriers().find((c) => c.code === 'DHL');
    expect(dhl?.price).toBe(2599);
  });

  it('updates every carrier whose code is present in the live rates response', () => {
    const { component, http } = setup();

    http.expectOne(RATES_URL).flush([
      { carrier: 'INPOST', priceInCents: 1111 },
      { carrier: 'GLS', priceInCents: 2222 },
    ]);

    const byCode = (code: string) => component.carriers().find((c) => c.code === code)?.price;
    expect(byCode('INPOST')).toBe(1111);
    expect(byCode('GLS')).toBe(2222);
  });

  // ── carrier absent from the live response is deactivated, not stale ──

  it('removes a carrier from the list when it is absent from the live rates response', () => {
    const { component, http } = setup();

    http.expectOne(RATES_URL).flush([{ carrier: 'DHL', priceInCents: 2599 }]);

    expect(component.carriers().find((c) => c.code === 'GLS')).toBeUndefined();
    expect(component.carriers().map((c) => c.code)).toEqual(['DHL']);
  });

  it('clears selectedCarrier when the previously-selected carrier is absent from the live rates response', () => {
    const { component, http } = setup();

    component.selectCarrier(component.carriers().find((c) => c.code === 'GLS')!);
    expect(component.selectedCarrier()).not.toBeNull();

    http.expectOne(RATES_URL).flush([{ carrier: 'DHL', priceInCents: 2599 }]);

    expect(component.selectedCarrier()).toBeNull();
  });

  it('keeps selectedCarrier set when it is still present in the live rates response', () => {
    const { component, http } = setup();

    component.selectCarrier(component.carriers().find((c) => c.code === 'DHL')!);

    http.expectOne(RATES_URL).flush([{ carrier: 'DHL', priceInCents: 2599 }]);

    expect(component.selectedCarrier()?.code).toBe('DHL');
  });

  // ── selectedCarrier re-synced if chosen before the fetch resolves ─────

  it('re-syncs the already-selected carrier object with the new live price', () => {
    const { component, http } = setup();

    component.selectCarrier(component.carriers().find((c) => c.code === 'DHL')!);
    expect(component.selectedCarrier()?.price).toBe(1999); // stale fallback

    http.expectOne(RATES_URL).flush([{ carrier: 'DHL', priceInCents: 2599 }]);

    expect(component.selectedCarrier()?.price).toBe(2599);
  });

  // ── effectiveTotal reflects the live price, not the stale fallback ───

  it('effectiveTotal uses the live shipping price once the rates request resolves', () => {
    const { component, http } = setup();

    component.selectCarrier(component.carriers().find((c) => c.code === 'DHL')!);
    http.expectOne(RATES_URL).flush([{ carrier: 'DHL', priceInCents: 2599 }]);

    // mockCart.totalInCents() = 5000
    expect(component.effectiveTotal()).toBe(5000 + 2599);
  });

  // ── graceful degradation: request failure keeps the offline fallback ─

  it('keeps the hardcoded fallback prices when the rates request errors', () => {
    const { component, http } = setup();

    http.expectOne(RATES_URL).error(new ProgressEvent('error'));

    const dhl = component.carriers().find((c) => c.code === 'DHL');
    expect(dhl?.price).toBe(1999);
  });

  it('does not throw when the rates request errors', () => {
    const { http } = setup();

    expect(() => {
      http.expectOne(RATES_URL).error(new ProgressEvent('error'));
    }).not.toThrow();
  });

  // ── empty response is a no-op, not a wipe ─────────────────────────────

  it('keeps fallback prices when the rates response is an empty array', () => {
    const { component, http } = setup();

    http.expectOne(RATES_URL).flush([]);

    const dhl = component.carriers().find((c) => c.code === 'DHL');
    expect(dhl?.price).toBe(1999);
  });
});
