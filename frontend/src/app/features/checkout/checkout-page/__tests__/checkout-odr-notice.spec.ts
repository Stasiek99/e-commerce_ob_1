import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ReactiveFormsModule } from '@angular/forms';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { CheckoutPageComponent } from '../checkout-page.component';
import { CartService } from '../../../../core/services/cart.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../core/services/toast.service';
import { AnalyticsService } from '../../../../core/services/analytics.service';
import { TurnstileService } from '../../../../core/services/turnstile.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

function setup() {
  const mockCart = {
    items: jest.fn().mockReturnValue([]),
    totalInCents: jest.fn().mockReturnValue(0),
    refreshFromServer: jest.fn(),
    getSessionId: jest.fn().mockReturnValue('sess-123'),
    clear: jest.fn(),
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
      { provide: AnalyticsService, useValue: { trackBeginCheckout: jest.fn() } },
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
  fixture.detectChanges();

  return { component, fixture };
}

describe('CheckoutPageComponent — ODR platform notice (EU Reg. 524/2013 Art. 14 + UoK Art. 37a)', () => {
  afterEach(() => jest.clearAllMocks());

  describe('visibility', () => {
    it('renders the ODR notice on the summary step (step 2)', () => {
      const { component, fixture } = setup();

      component.index = 2;
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.odr-notice'))).not.toBeNull();
    });

    it('does not render the ODR notice on step 0 (address)', () => {
      const { fixture } = setup();

      expect(fixture.debugElement.query(By.css('.odr-notice'))).toBeNull();
    });

    it('does not render the ODR notice on step 1 (carrier selection)', () => {
      const { component, fixture } = setup();

      component.index = 1;
      fixture.detectChanges();

      expect(fixture.debugElement.query(By.css('.odr-notice'))).toBeNull();
    });
  });

  describe('link attributes', () => {
    it('ODR link points to the EC platform URL', () => {
      const { component, fixture } = setup();
      component.index = 2;
      fixture.detectChanges();

      const link = fixture.debugElement.query(By.css('.odr-notice a'));
      expect(link).not.toBeNull();
      expect(link.nativeElement.getAttribute('href')).toBe('https://ec.europa.eu/consumers/odr');
    });

    it('ODR link opens in a new tab', () => {
      const { component, fixture } = setup();
      component.index = 2;
      fixture.detectChanges();

      const link = fixture.debugElement.query(By.css('.odr-notice a'));
      expect(link.nativeElement.getAttribute('target')).toBe('_blank');
    });

    it('ODR link has rel="noopener" to prevent tab-napping', () => {
      const { component, fixture } = setup();
      component.index = 2;
      fixture.detectChanges();

      const link = fixture.debugElement.query(By.css('.odr-notice a'));
      expect(link.nativeElement.getAttribute('rel')).toContain('noopener');
    });

    it('ODR notice text mentions "ODR"', () => {
      const { component, fixture } = setup();
      component.index = 2;
      fixture.detectChanges();

      const notice = fixture.debugElement.query(By.css('.odr-notice'));
      expect(notice.nativeElement.textContent).toContain('ODR');
    });
  });

  describe('DOM placement (UoK Art. 37a proximity to terms checkbox)', () => {
    it('ODR notice appears before the terms acceptance checkbox in DOM order', () => {
      const { component, fixture } = setup();
      component.index = 2;
      fixture.detectChanges();

      const nativeEl: HTMLElement = fixture.nativeElement;
      const notice = nativeEl.querySelector('.odr-notice');
      const consentLabel = nativeEl.querySelector('.consent-label');

      expect(notice).not.toBeNull();
      expect(consentLabel).not.toBeNull();
      // Node.DOCUMENT_POSITION_FOLLOWING means consentLabel is after notice
      expect(
        notice!.compareDocumentPosition(consentLabel!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });
});
