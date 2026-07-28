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
  fixture.detectChanges();

  return { component, fixture, mockToast };
}

describe('CheckoutPageComponent — InPost locker-picker observer cleanup', () => {
  const originalEasyPack = (globalThis as any).easyPack;

  beforeEach(() => {
    (globalThis as any).easyPack = {
      init: jest.fn(),
      modalMap: jest.fn(),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (globalThis as any).easyPack = originalEasyPack;
  });

  it('disconnects the MutationObserver when the component is destroyed before the widget backdrop appears', () => {
    const { component, fixture } = setup();
    const disconnectSpy = jest.spyOn(MutationObserver.prototype, 'disconnect');

    component.openLockerPicker();
    fixture.destroy();

    expect(disconnectSpy).toHaveBeenCalled();
  });

  it('does not throw when destroying the component without ever opening the locker picker', () => {
    const { fixture } = setup();

    expect(() => fixture.destroy()).not.toThrow();
  });

  it('does not throw when destroying the component after a point was already selected (observer already disconnected)', () => {
    const { component, fixture } = setup();
    component.openLockerPicker();

    const onPointSelected = ((globalThis as any).easyPack.modalMap as jest.Mock).mock.calls[0][0];
    onPointSelected(
      { name: 'WAW01A', address_details: { street: 'ul. Testowa', building_number: '1', city: 'Warszawa', post_code: '00-001' } },
      { closeModal: jest.fn() },
    );

    expect(() => fixture.destroy()).not.toThrow();
  });

  it('shows an error toast and never starts an observer when the easyPack widget script has not loaded', () => {
    (globalThis as any).easyPack = undefined;
    const { component, mockToast } = setup();
    const disconnectSpy = jest.spyOn(MutationObserver.prototype, 'disconnect');

    component.openLockerPicker();

    expect(mockToast.error).toHaveBeenCalled();
    expect(disconnectSpy).not.toHaveBeenCalled();
  });
});
