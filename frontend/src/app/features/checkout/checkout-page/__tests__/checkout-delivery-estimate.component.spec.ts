import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { CheckoutPageComponent } from '../checkout-page.component';
import { CartService } from '../../../../core/services/cart.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../core/services/toast.service';
import { AnalyticsService } from '../../../../core/services/analytics.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

// const enum CarrierCode is inlined by tsc — use string literals at test time
const carrier = (code: string) =>
  ({ code, name: 'Carrier', price: 1499, desc: 'desc' }) as any;

function setup() {
  const mockCart = {
    items: jest.fn().mockReturnValue([]),
    totalInCents: jest.fn().mockReturnValue(0),
    refreshFromServer: jest.fn(),
  };
  const mockAuth = {
    isAuthenticated: jest.fn().mockReturnValue(false),
    currentUser: jest.fn().mockReturnValue(null),
  };
  const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
  const mockAnalytics = { trackBeginCheckout: jest.fn(), trackPurchase: jest.fn() };
  const mockRoute = {
    snapshot: { queryParamMap: { get: jest.fn().mockReturnValue(null) } },
  };

  TestBed.configureTestingModule({
    imports: [CheckoutPageComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: CartService, useValue: mockCart },
      { provide: AuthService, useValue: mockAuth },
      { provide: ToastService, useValue: mockToast },
      { provide: AnalyticsService, useValue: mockAnalytics },
      // ActivatedRoute is provided via provideRouter; override snapshot only
      { provide: 'ActivatedRoute', useValue: mockRoute },
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

  return { component, fixture };
}

describe('CheckoutPageComponent — deliveryEstimate signal', () => {
  afterEach(() => jest.clearAllMocks());

  it('is null when no carrier is selected', () => {
    const { component } = setup();
    expect(component.deliveryEstimate()).toBeNull();
  });

  it('returns "następny dzień roboczy" for INPOST', () => {
    const { component } = setup();
    component.selectedCarrier.set(carrier('INPOST'));
    expect(component.deliveryEstimate()).toBe('następny dzień roboczy');
  });

  it('returns "1–2 dni robocze" for DHL', () => {
    const { component } = setup();
    component.selectedCarrier.set(carrier('DHL'));
    expect(component.deliveryEstimate()).toBe('1–2 dni robocze');
  });

  it('returns "2–3 dni robocze" for GLS', () => {
    const { component } = setup();
    component.selectedCarrier.set(carrier('GLS'));
    expect(component.deliveryEstimate()).toBe('2–3 dni robocze');
  });

  it('returns null for an unknown carrier code', () => {
    const { component } = setup();
    component.selectedCarrier.set(carrier('FEDEX'));
    expect(component.deliveryEstimate()).toBeNull();
  });

  it('updates when selectedCarrier changes', () => {
    const { component } = setup();

    component.selectedCarrier.set(carrier('DHL'));
    expect(component.deliveryEstimate()).toBe('1–2 dni robocze');

    component.selectedCarrier.set(carrier('GLS'));
    expect(component.deliveryEstimate()).toBe('2–3 dni robocze');

    component.selectedCarrier.set(null);
    expect(component.deliveryEstimate()).toBeNull();
  });
});
