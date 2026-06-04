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

describe('CheckoutPageComponent — return cost disclosure (Art. 34 ust. 2 UoK)', () => {
  afterEach(() => jest.clearAllMocks());

  it('shows the return cost notice on the summary step (step 2)', () => {
    const { component, fixture } = setup();

    component.index = 2;
    fixture.detectChanges();

    const notice = fixture.debugElement.query(By.css('.return-cost-notice'));
    expect(notice).not.toBeNull();
    expect(notice.nativeElement.textContent).toContain('bezpośrednie koszty zwrotu');
  });

  it('does not show the return cost notice on step 0 (address)', () => {
    const { fixture } = setup();

    const notice = fixture.debugElement.query(By.css('.return-cost-notice'));
    expect(notice).toBeNull();
  });

  it('does not show the return cost notice on step 1 (carrier)', () => {
    const { component, fixture } = setup();

    component.index = 1;
    fixture.detectChanges();

    const notice = fixture.debugElement.query(By.css('.return-cost-notice'));
    expect(notice).toBeNull();
  });

  it('notice text references the legal basis', () => {
    const { component, fixture } = setup();

    component.index = 2;
    fixture.detectChanges();

    const text = fixture.debugElement.query(By.css('.return-cost-notice')).nativeElement.textContent;
    expect(text).toContain('34');
    expect(text).toContain('ustawy o prawach konsumenta');
  });
});
