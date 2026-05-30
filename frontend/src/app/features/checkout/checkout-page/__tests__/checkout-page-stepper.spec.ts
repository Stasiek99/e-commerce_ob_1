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

describe('CheckoutPageComponent — onStep() stepper navigation guard', () => {
  afterEach(() => jest.clearAllMocks());

  // ── backward navigation ─────────────────────────────────────────────

  it('navigates backward when newIndex < current index', () => {
    const { component } = setup();
    component.index = 2;

    component.onStep(0);

    expect(component.index).toBe(0);
  });

  it('sets negative direction when navigating backward', () => {
    const { component } = setup();
    component.index = 2;

    component.onStep(0);

    expect(component.direction).toBe(-2);
  });

  // ── forward navigation — routes through onNext() ────────────────────

  it('stays on step 1 when clicking step 2 tab with no carrier selected', () => {
    const { component } = setup();
    component.index = 1;
    component.selectedCarrier.set(null);

    component.onStep(2);

    expect(component.index).toBe(1);
  });

  it('advances to step 2 when clicking step 2 tab with a valid carrier selected', () => {
    const { component } = setup();
    component.index = 1;
    component.selectCarrier(carrier('DHL'));

    component.onStep(2);

    expect(component.index).toBe(2);
  });

  it('stays on step 1 when clicking step 2 tab with INPOST selected but no locker code', () => {
    const { component } = setup();
    component.index = 1;
    component.selectCarrier(carrier('INPOST'));
    component.lockerCode.set(null);

    component.onStep(2);

    expect(component.index).toBe(1);
    expect(component.lockerPickerTouched()).toBe(true);
  });

  it('stays on step 0 when clicking step 1 tab with an invalid address form', () => {
    const { component } = setup();
    // addressForm starts invalid (required fields empty) — do not fill it

    component.onStep(1);

    expect(component.index).toBe(0);
  });

  // ── regression: the skipping scenario described in the bug report ────

  it('cannot skip carrier validation by going Step2 → Step0 → Step2 via stepper tabs', () => {
    const { component } = setup();

    // Simulate user completing address validation up to step 1
    component.index = 1;
    component.selectedCarrier.set(null);

    // Simulate: user navigates back to step 0 using the stepper pill
    component.onStep(0);
    expect(component.index).toBe(0);

    // Simulate: user clicks the Step 2 pill directly
    // Even though the address form is invalid, onStep delegates to onNext(),
    // which validates step 0 first — form is invalid, so stays at 0.
    component.onStep(2);
    expect(component.index).toBe(0);
  });
});
