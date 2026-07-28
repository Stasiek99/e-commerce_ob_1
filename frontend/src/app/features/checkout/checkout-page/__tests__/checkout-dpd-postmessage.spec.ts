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

  return { component, fixture };
}

function dpdMessage(origin: string, payload: unknown): MessageEvent {
  return new MessageEvent('message', { origin, data: payload });
}

describe('CheckoutPageComponent — DPD postMessage origin guard', () => {
  afterEach(() => jest.clearAllMocks());

  it('ignores messages from an arbitrary third-party origin', () => {
    const { component } = setup();
    component.openDpdPicker();

    window.dispatchEvent(
      dpdMessage('https://evil.example.com', { dpdWidget: { id: 'FAKE001', street: 'Fake St', zip_code: '00-000', city: 'Faketown' } }),
    );

    expect(component.selectedDpdPoint()).toBeNull();
  });

  it('ignores messages from an empty origin', () => {
    const { component } = setup();
    component.openDpdPicker();

    window.dispatchEvent(dpdMessage('', { dpdWidget: { id: 'FAKE002' } }));

    expect(component.selectedDpdPoint()).toBeNull();
  });

  it('ignores messages from a subdomain of the trusted origin', () => {
    const { component } = setup();
    component.openDpdPicker();

    window.dispatchEvent(
      dpdMessage('https://sub.api.dpd.cz', { dpdWidget: { id: 'FAKE003' } }),
    );

    expect(component.selectedDpdPoint()).toBeNull();
  });

  it('ignores messages from http:// instead of https:// on the trusted domain', () => {
    const { component } = setup();
    component.openDpdPicker();

    window.dispatchEvent(
      dpdMessage('http://api.dpd.cz', { dpdWidget: { id: 'FAKE004' } }),
    );

    expect(component.selectedDpdPoint()).toBeNull();
  });

  it('processes a valid dpdWidget message from the trusted origin', () => {
    const { component } = setup();
    component.openDpdPicker();

    window.dispatchEvent(
      dpdMessage('https://api.dpd.cz', {
        dpdWidget: { id: 'KRK01A', street: 'ul. Floriańska 1', zip_code: '31-019', city: 'Kraków' },
      }),
    );

    expect(component.selectedDpdPoint()).toEqual({
      code: 'KRK01A',
      address: 'ul. Floriańska 1, 31-019, Kraków',
    });
  });

  it('does not register the listener before openDpdPicker is called', () => {
    const { component } = setup();

    window.dispatchEvent(
      dpdMessage('https://api.dpd.cz', { dpdWidget: { id: 'EARLY001' } }),
    );

    expect(component.selectedDpdPoint()).toBeNull();
  });

  it('ignores messages that have no dpdWidget property even from the trusted origin', () => {
    const { component } = setup();
    component.openDpdPicker();

    window.dispatchEvent(dpdMessage('https://api.dpd.cz', { someOtherKey: 'value' }));

    expect(component.selectedDpdPoint()).toBeNull();
  });
});

describe('CheckoutPageComponent — DPD modal listener cleanup on destroy', () => {
  afterEach(() => jest.clearAllMocks());

  it('removes the window message listener when the component is destroyed while the modal is open', () => {
    const { component, fixture } = setup();
    const removeSpy = jest.spyOn(window, 'removeEventListener');
    component.openDpdPicker();

    fixture.destroy();

    expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('a postMessage delivered after destroy no longer updates selectedDpdPoint (no stale listener)', () => {
    const { component, fixture } = setup();
    component.openDpdPicker();

    fixture.destroy();

    window.dispatchEvent(
      dpdMessage('https://api.dpd.cz', { dpdWidget: { id: 'AFTER001', street: 'ul. Testowa', zip_code: '00-001', city: 'Warszawa' } }),
    );

    expect(component.selectedDpdPoint()).toBeNull();
  });

  it('destroying the component without ever opening the modal does not throw', () => {
    const { fixture } = setup();

    expect(() => fixture.destroy()).not.toThrow();
  });
});
