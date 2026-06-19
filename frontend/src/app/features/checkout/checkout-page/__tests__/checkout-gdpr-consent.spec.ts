import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
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

function buildSetup(authenticated = true) {
  const mockCart = {
    items: jest.fn().mockReturnValue([]),
    totalInCents: jest.fn().mockReturnValue(0),
    refreshFromServer: jest.fn(),
    getSessionId: jest.fn().mockReturnValue('sess-123'),
    clear: jest.fn(),
  };
  const mockAuth = {
    isAuthenticated: jest.fn().mockReturnValue(authenticated),
    currentUser: jest.fn().mockReturnValue(
      authenticated ? { id: 'u1', email: 'test@example.com' } : null,
    ),
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
      { provide: TurnstileService, useValue: { getToken: jest.fn().mockResolvedValue('') } },
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

  http.expectOne(RATES_URL).flush([]);

  if (authenticated) {
    http.expectOne(ADDRESSES_URL).flush([]);
  }

  return { fixture, component, http };
}

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

describe('CheckoutPageComponent — GDPR consent separation', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('placeOrder() payload — marketingConsent absent', () => {
    it('does not include marketingConsent in the order request body', async () => {
      const { component, http } = buildSetup();
      fillAddress(component);
      component.selectedCarrier.set({ code: 'DHL', name: 'DHL', price: 1999, desc: '' } as any);
      component.termsAccepted.set(true);

      component.placeOrder();
      await Promise.resolve();

      const req = http.expectOne(ORDERS_URL);
      expect(req.request.body).not.toHaveProperty('marketingConsent');
      req.flush({ paymentUrl: 'https://stripe.test/pay' });
      http.verify();
    });

    it('does not include marketingConsent even when the user is authenticated', async () => {
      const { component, http } = buildSetup(true);
      fillAddress(component);
      component.selectedCarrier.set({ code: 'GLS', name: 'GLS', price: 1799, desc: '' } as any);
      component.termsAccepted.set(true);

      component.placeOrder();
      await Promise.resolve();

      const req = http.expectOne(ORDERS_URL);
      expect(req.request.body.marketingConsent).toBeUndefined();
      req.flush({ paymentUrl: 'https://stripe.test/pay' });
      http.verify();
    });

    it('does not include marketingConsent for a guest checkout', async () => {
      const { component, http } = buildSetup(false);
      fillAddress(component);
      component.selectedCarrier.set({ code: 'DPD_COURIER', name: 'DPD Kurier', price: 1699, desc: '' } as any);
      component.termsAccepted.set(true);

      component.placeOrder();
      await Promise.resolve();

      const req = http.expectOne(ORDERS_URL);
      expect(req.request.body.marketingConsent).toBeUndefined();
      req.flush({ paymentUrl: 'https://stripe.test/pay' });
      http.verify();
    });
  });

  describe('component class — no marketingConsent signal', () => {
    it('does not expose a marketingConsent signal on the component instance', () => {
      const { component, http } = buildSetup();
      expect((component as any).marketingConsent).toBeUndefined();
      http.verify();
    });
  });

  describe('Step 2 template — combined consent checkbox removed', () => {
    it('does not render the review-request consent checkbox in the summary step', () => {
      const { fixture, component, http } = buildSetup();

      // Navigate to Step 2 (summary)
      component.index = 2;
      fixture.detectChanges();

      const checkboxes = fixture.debugElement.queryAll(By.css('.consent-checkbox'));
      // Only the mandatory T&C checkbox should be present, not the former marketing/review checkbox
      const labels = fixture.debugElement.queryAll(By.css('.consent-label'));
      const labelTexts = labels.map((l) => l.nativeElement.textContent as string);
      const hasReviewLabel = labelTexts.some((t) =>
        t.includes('ocenę') || t.includes('marketingConsent') || t.includes('wiadomości e-mail z prośbą'),
      );

      expect(hasReviewLabel).toBe(false);
      expect(checkboxes.length).toBe(1); // only the T&C checkbox remains

      http.verify();
    });

    it('renders only the mandatory T&C consent checkbox in step 2', () => {
      const { fixture, component, http } = buildSetup();

      component.index = 2;
      fixture.detectChanges();

      const labels = fixture.debugElement.queryAll(By.css('.consent-label'));
      // Exactly one consent label: the T&C checkbox
      expect(labels.length).toBe(1);
      expect(labels[0].nativeElement.textContent).toContain('regulamin');

      http.verify();
    });
  });
});
