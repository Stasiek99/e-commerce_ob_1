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

const makeCarrier = (code: string, price: number) =>
  ({ code, name: 'Carrier', price, desc: 'desc' }) as any;

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
  fixture.detectChanges();

  return { component, fixture };
}

describe('CheckoutPageComponent — FREE_SHIPPING coupon carrier sync effect', () => {
  afterEach(() => jest.clearAllMocks());

  // ── happy path: discount amount tracks the new carrier price ──────────

  it('updates discountAmountInCents to the new carrier price when carrier changes with a FREE_SHIPPING coupon', () => {
    const { component, fixture } = setup();

    component.selectedCarrier.set(makeCarrier('DHL', 1499));
    component.appliedCoupon.set({ code: 'FREESHIP', discountAmountInCents: 1499, isFreeShipping: true });

    component.selectedCarrier.set(makeCarrier('GLS', 999));
    fixture.detectChanges();

    expect(component.appliedCoupon()!.discountAmountInCents).toBe(999);
  });

  it('updates discountAmountInCents when switching to a more expensive carrier', () => {
    const { component, fixture } = setup();

    component.selectedCarrier.set(makeCarrier('GLS', 999));
    component.appliedCoupon.set({ code: 'FREESHIP', discountAmountInCents: 999, isFreeShipping: true });

    component.selectedCarrier.set(makeCarrier('DHL', 1999));
    fixture.detectChanges();

    expect(component.appliedCoupon()!.discountAmountInCents).toBe(1999);
  });

  // ── coupon identity preserved ─────────────────────────────────────────

  it('preserves the coupon code and isFreeShipping flag when recomputing discountAmountInCents', () => {
    const { component, fixture } = setup();

    component.selectedCarrier.set(makeCarrier('DHL', 1499));
    component.appliedCoupon.set({ code: 'FREESHIP', discountAmountInCents: 1499, isFreeShipping: true });
    component.selectedCarrier.set(makeCarrier('INPOST', 1299));
    fixture.detectChanges();

    const coupon = component.appliedCoupon()!;
    expect(coupon.code).toBe('FREESHIP');
    expect(coupon.isFreeShipping).toBe(true);
  });

  // ── edge case: carrier cleared ────────────────────────────────────────

  it('sets discountAmountInCents to 0 when carrier is cleared while a FREE_SHIPPING coupon is active', () => {
    const { component, fixture } = setup();

    component.selectedCarrier.set(makeCarrier('DHL', 1499));
    component.appliedCoupon.set({ code: 'FREESHIP', discountAmountInCents: 1499, isFreeShipping: true });
    component.selectedCarrier.set(null);
    fixture.detectChanges();

    expect(component.appliedCoupon()!.discountAmountInCents).toBe(0);
  });

  // ── non-free-shipping coupon is untouched ─────────────────────────────

  it('does not mutate discountAmountInCents for a fixed-amount coupon when carrier changes', () => {
    const { component, fixture } = setup();

    component.selectedCarrier.set(makeCarrier('DHL', 1499));
    component.appliedCoupon.set({ code: 'SALE10', discountAmountInCents: 500, isFreeShipping: false });
    component.selectedCarrier.set(makeCarrier('GLS', 999));
    fixture.detectChanges();

    expect(component.appliedCoupon()!.discountAmountInCents).toBe(500);
  });

  // ── no coupon applied: effect is a no-op ─────────────────────────────

  it('does not throw and leaves appliedCoupon null when carrier changes with no coupon applied', () => {
    const { component, fixture } = setup();

    component.selectedCarrier.set(makeCarrier('DHL', 1499));
    component.appliedCoupon.set(null);

    expect(() => {
      component.selectedCarrier.set(makeCarrier('GLS', 999));
      fixture.detectChanges();
    }).not.toThrow();

    expect(component.appliedCoupon()).toBeNull();
  });

  // ── regression: allowSignalWrites: true is required ──────────────────

  it('does not throw Angular signal-write guard when coupon.set() is called inside the carrier-sync effect', () => {
    // Without { allowSignalWrites: true }, Angular 18 throws
    // "Writing to signals is not allowed in a computed or an effect by default"
    // in dev mode whenever appliedCoupon.set() runs inside the effect.
    const { component, fixture } = setup();

    component.appliedCoupon.set({ code: 'FREESHIP', discountAmountInCents: 1499, isFreeShipping: true });

    expect(() => {
      component.selectedCarrier.set(makeCarrier('DHL', 1999));
      fixture.detectChanges();
    }).not.toThrow();
  });

  // ── effectiveTotal correctness (the displayed price) ─────────────────

  it('effectiveTotal equals cart items only (no shipping) after carrier switch with FREE_SHIPPING coupon', () => {
    const { component, fixture } = setup();

    // cart mock returns 5000 cents
    component.selectedCarrier.set(makeCarrier('DHL', 1499));
    component.appliedCoupon.set({ code: 'FREESHIP', discountAmountInCents: 1499, isFreeShipping: true });

    component.selectedCarrier.set(makeCarrier('GLS', 999));
    fixture.detectChanges();

    // effectiveTotal for FREE_SHIPPING coupon always = items total, ignoring shipping
    expect(component.effectiveTotal()).toBe(5000);
  });
});
