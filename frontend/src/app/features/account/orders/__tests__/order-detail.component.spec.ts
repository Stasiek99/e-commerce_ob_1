import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { OrderDetailComponent } from '../order-detail.component';
import { ToastService } from '../../../../core/services/toast.service';

function setup() {
  const mockLocation = { back: jest.fn() };
  const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
  const mockRoute = { snapshot: { paramMap: convertToParamMap({ id: 'order-1' }) } };

  TestBed.configureTestingModule({
    imports: [OrderDetailComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: Location, useValue: mockLocation },
      { provide: ToastService, useValue: mockToast },
      { provide: ActivatedRoute, useValue: mockRoute },
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  TestBed.overrideComponent(OrderDetailComponent, {
    set: { imports: [], providers: [], schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA] },
  });

  const fixture = TestBed.createComponent(OrderDetailComponent);
  const component = fixture.componentInstance;
  const httpMock = TestBed.inject(HttpTestingController);

  fixture.detectChanges();

  // Flush the initial load() GET that ngOnInit fires
  const initReqs = httpMock.match(() => true);
  initReqs.forEach((r) =>
    r.flush({
      id: 'order-1',
      orderNumber: 'ORD-1',
      status: 'DISPUTE_HOLD',
      items: [],
      shippingCostInCents: 0,
      totalInCents: 0,
      refundedAmountInCents: 0,
      invoiceUrl: null,
    }),
  );

  return { fixture, component, httpMock };
}

describe('OrderDetailComponent — statusLabel', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).match(() => true).forEach((r) => r.flush(null));
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  it('returns the Polish label for DISPUTE_HOLD', () => {
    const { component } = setup();

    expect(component.statusLabel('DISPUTE_HOLD')).toBe('Spór płatniczy');
  });

  it('returns the Polish label for DISPUTE_LOST_REVIEW', () => {
    const { component } = setup();

    expect(component.statusLabel('DISPUTE_LOST_REVIEW')).toBe('Weryfikacja zwrotu');
  });

  it('does not fall back to the raw enum string for known statuses', () => {
    const { component } = setup();

    expect(component.statusLabel('DISPUTE_HOLD')).not.toBe('DISPUTE_HOLD');
    expect(component.statusLabel('DISPUTE_LOST_REVIEW')).not.toBe('DISPUTE_LOST_REVIEW');
  });

  it('falls back to the raw status string for an unmapped status', () => {
    const { component } = setup();

    expect(component.statusLabel('SOME_FUTURE_STATUS')).toBe('SOME_FUTURE_STATUS');
  });
});
