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
import { TurnstileService } from '../../../../core/services/turnstile.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';
import { environment } from '../../../../../environments/environment';

const ORDERS_URL = `${environment.apiUrl}/orders`;
const ADDRESSES_URL = `${environment.apiUrl}/users/me/addresses`;
const RATES_URL = `${environment.apiUrl}/shipping/rates`;

function buildSetup() {
  const mockCart = {
    items: jest.fn().mockReturnValue([]),
    totalInCents: jest.fn().mockReturnValue(0),
    refreshFromServer: jest.fn(),
    getSessionId: jest.fn().mockReturnValue('sess-123'),
    clear: jest.fn(),
  };
  const mockAuth = {
    isAuthenticated: jest.fn().mockReturnValue(true),
    currentUser: jest.fn().mockReturnValue({ id: 'u1', email: 'test@example.com' }),
  };
  const mockTurnstile = { getToken: jest.fn().mockResolvedValue('') };

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
      { provide: TurnstileService, useValue: mockTurnstile },
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
  // Flush the GET /shipping/rates that ngOnInit always fires
  http.expectOne(RATES_URL).flush([]);
  // Flush the GET /users/me/addresses that ngOnInit fires for authenticated users
  http.expectOne(ADDRESSES_URL).flush([]);

  return { component, http };
}

/** Fill the address form fields that map to the newAddress payload. */
function fillAddress(component: CheckoutPageComponent) {
  component.addressForm.setValue({
    firstName: 'Jan',
    lastName: 'Kowalski',
    company: '',
    street: 'Marszałkowska 1',
    city: 'Warszawa',
    postalCode: '00-001',
    phone: '+48123456789',
    email: 'jan@example.com',
  });
}

describe('CheckoutPageComponent — placeOrder() address routing', () => {
  let http: HttpTestingController;

  afterEach(() => {
    http?.verify();
    jest.clearAllMocks();
  });

  describe('new address (selectedSavedId = null)', () => {
    it('sends newAddress payload when no saved address is selected', async () => {
      ({ http } = buildSetup());
      const component = TestBed.createComponent(CheckoutPageComponent).componentInstance;
      fillAddress(component);
      component.selectedCarrier.set({ code: 'DHL', name: 'DHL', price: 1499, desc: '' } as any);
      component.selectedSavedId.set(null);

      component.placeOrder();
      await Promise.resolve();

      const req = http.expectOne(ORDERS_URL);
      expect(req.request.body).toMatchObject({
        newAddress: expect.objectContaining({ firstName: 'Jan', city: 'Warszawa' }),
      });
      expect(req.request.body.addressId).toBeUndefined();
      req.flush({ paymentUrl: 'https://stripe.test/pay' });
    });
  });

  describe('saved address (selectedSavedId = <id>)', () => {
    it('sends addressId and omits newAddress when a saved address is selected', async () => {
      ({ http } = buildSetup());
      const component = TestBed.createComponent(CheckoutPageComponent).componentInstance;
      fillAddress(component);
      component.selectedCarrier.set({ code: 'DHL', name: 'DHL', price: 1499, desc: '' } as any);
      component.selectedSavedId.set('addr-saved-42');

      component.placeOrder();
      await Promise.resolve();

      const req = http.expectOne(ORDERS_URL);
      expect(req.request.body).toMatchObject({ addressId: 'addr-saved-42' });
      expect(req.request.body.newAddress).toBeUndefined();
      req.flush({ paymentUrl: 'https://stripe.test/pay' });
    });

    it('uses the exact saved address ID from selectedSavedId()', async () => {
      ({ http } = buildSetup());
      const component = TestBed.createComponent(CheckoutPageComponent).componentInstance;
      fillAddress(component);
      component.selectedCarrier.set({ code: 'DHL', name: 'DHL', price: 1499, desc: '' } as any);
      component.selectedSavedId.set('addr-99');

      component.placeOrder();
      await Promise.resolve();

      const req = http.expectOne(ORDERS_URL);
      expect(req.request.body.addressId).toBe('addr-99');
      req.flush({ paymentUrl: 'https://stripe.test/pay' });
    });
  });
});
