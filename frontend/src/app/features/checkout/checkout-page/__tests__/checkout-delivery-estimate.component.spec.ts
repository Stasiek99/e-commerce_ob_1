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

  it('returns "1–2 dni robocze" for DPD', () => {
    const { component } = setup();
    component.selectedCarrier.set(carrier('DPD'));
    expect(component.deliveryEstimate()).toBe('1–2 dni robocze');
  });

  it('returns "1–2 dni robocze" for DPD_COURIER', () => {
    const { component } = setup();
    component.selectedCarrier.set(carrier('DPD_COURIER'));
    expect(component.deliveryEstimate()).toBe('1–2 dni robocze');
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

describe('CheckoutPageComponent — DPD picker state', () => {
  afterEach(() => jest.clearAllMocks());

  it('openDpdPicker sets dpdModalOpen to true', () => {
    const { component } = setup();
    expect(component.dpdModalOpen()).toBe(false);
    component.openDpdPicker();
    expect(component.dpdModalOpen()).toBe(true);
    component.closeDpdModal(); // cleanup listener
  });

  it('closeDpdModal sets dpdModalOpen to false', () => {
    const { component } = setup();
    component.openDpdPicker();
    component.closeDpdModal();
    expect(component.dpdModalOpen()).toBe(false);
  });

  it('selectCarrier non-DPD resets selectedDpdPoint', () => {
    const { component } = setup();
    component.selectedDpdPoint.set({ code: 'KRK01', address: 'ul. Testowa 1' });
    component.selectCarrier(carrier('DHL'));
    expect(component.selectedDpdPoint()).toBeNull();
  });

  it('selectCarrier DPD preserves selectedDpdPoint if already set', () => {
    const { component } = setup();
    component.selectedDpdPoint.set({ code: 'KRK01', address: 'ul. Testowa 1' });
    component.selectCarrier(carrier('DPD'));
    expect(component.selectedDpdPoint()).toEqual({ code: 'KRK01', address: 'ul. Testowa 1' });
  });

  it('selectCarrier non-DPD resets dpdPickerTouched', () => {
    const { component } = setup();
    component.dpdPickerTouched.set(true);
    component.selectCarrier(carrier('GLS'));
    expect(component.dpdPickerTouched()).toBe(false);
  });

  it('postMessage with dpdWidget data sets selectedDpdPoint and closes modal', () => {
    const { component } = setup();
    component.openDpdPicker();

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://api.dpd.cz',
      data: {
        dpdWidget: {
          id: 'WAW001',
          company: 'DPD Punkt Testowy',
          street: 'ul. Testowa 10',
          zip_code: '00-001',
          city: 'Warszawa',
        },
      },
    }));

    expect(component.selectedDpdPoint()).toEqual({
      code: 'WAW001',
      address: 'ul. Testowa 10, 00-001, Warszawa',
    });
    expect(component.dpdModalOpen()).toBe(false);
    expect(component.dpdPickerTouched()).toBe(false);
  });

  it('postMessage without dpdWidget key is ignored', () => {
    const { component } = setup();
    component.openDpdPicker();

    window.dispatchEvent(new MessageEvent('message', { data: { someOtherKey: 'value' } }));

    expect(component.selectedDpdPoint()).toBeNull();
    expect(component.dpdModalOpen()).toBe(true);
    component.closeDpdModal(); // cleanup
  });

  it('step 1 navigation with DPD and no selectedDpdPoint sets dpdPickerTouched and stays on step 1', () => {
    const { component } = setup();
    component.index = 1;
    component.selectCarrier(carrier('DPD'));
    component.selectedDpdPoint.set(null);

    component.onNext();

    expect(component.dpdPickerTouched()).toBe(true);
    expect(component.index).toBe(1);
  });

  it('step 1 navigation with DPD and selectedDpdPoint advances to step 2', () => {
    const { component } = setup();
    component.index = 1;
    component.selectCarrier(carrier('DPD'));
    component.selectedDpdPoint.set({ code: 'KRK01', address: 'ul. X' });

    component.onNext();

    expect(component.index).toBe(2);
    expect(component.dpdPickerTouched()).toBe(false);
  });

  it('step 1 navigation with DPD_COURIER advances to step 2 without requiring pickup code', () => {
    const { component } = setup();
    component.index = 1;
    component.selectCarrier(carrier('DPD_COURIER'));

    component.onNext();

    expect(component.index).toBe(2);
  });
});
