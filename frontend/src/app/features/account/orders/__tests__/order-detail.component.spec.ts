import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { OrderDetailComponent } from '../order-detail.component';
import { ToastService } from '../../../../core/services/toast.service';

function setup(orderOverrides: Record<string, unknown> = {}) {
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
      ...orderOverrides,
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

describe('OrderDetailComponent — canCancel', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).match(() => true).forEach((r) => r.flush(null));
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  it('does not allow cancelling a PARTIALLY_REFUNDED order (backend rejects it with a 409)', () => {
    const { component } = setup();

    expect(component.canCancel('PARTIALLY_REFUNDED')).toBe(false);
  });

  it('allows cancelling PENDING_PAYMENT, PAID, and PROCESSING orders', () => {
    const { component } = setup();

    expect(component.canCancel('PENDING_PAYMENT')).toBe(true);
    expect(component.canCancel('PAID')).toBe(true);
    expect(component.canCancel('PROCESSING')).toBe(true);
  });

  it('still allows the partial-cancel flow for PARTIALLY_REFUNDED orders', () => {
    const { component } = setup();

    expect(component.canPartialCancel('PARTIALLY_REFUNDED')).toBe(true);
  });
});

describe('OrderDetailComponent — canDownloadInvoice', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).match(() => true).forEach((r) => r.flush(null));
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  it.each(['PENDING_PAYMENT', 'CANCELLED', 'FRAUD_REVIEW', 'DISPUTE_HOLD'])(
    'hides the invoice button for %s, matching the backend nonInvoiceable list',
    (status) => {
      const { component } = setup();

      expect(component.canDownloadInvoice(status)).toBe(false);
    },
  );

  it.each(['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'PARTIALLY_REFUNDED', 'REFUNDED'])(
    'shows the invoice button for %s',
    (status) => {
      const { component } = setup();

      expect(component.canDownloadInvoice(status)).toBe(true);
    },
  );
});

// FIX: the full-cancel and partial-cancel zones previously guarded only their own
// signal (cancelling() / submittingPartial()), so a user could fire "cancel whole
// order" then submit a partial cancellation for the same order before the first
// request resolved — two concurrent requests against two different backend code
// paths. actionInFlight() is now the single shared guard both flows set and read.
describe('OrderDetailComponent — shared actionInFlight guard', () => {
  const itemFixture = {
    id: 'item-1',
    snapshotName: 'Rose Oud',
    snapshotSku: 'SKU-1',
    snapshotPrice: 100,
    quantity: 2,
    cancelledQuantity: 0,
    productVariantId: 'pv-1',
  };

  afterEach(() => {
    TestBed.inject(HttpTestingController).match(() => true).forEach((r) => r.flush(null));
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  it('flips actionInFlight on as soon as doCancel is called, before the HTTP response arrives', () => {
    const { component, httpMock } = setup({ status: 'PAID' });

    component.doCancel();

    expect(component.actionInFlight()).toBe(true);
    httpMock.expectOne((req) => req.url === '/api/orders/order-1/cancel').flush({});
  });

  it('clears actionInFlight once doCancel resolves successfully', () => {
    const { component, httpMock } = setup({ status: 'PAID' });

    component.doCancel();
    httpMock.expectOne((req) => req.url === '/api/orders/order-1/cancel').flush({});

    expect(component.actionInFlight()).toBe(false);
  });

  it('clears actionInFlight when doCancel fails', () => {
    const { component, httpMock } = setup({ status: 'PAID' });

    component.doCancel();
    httpMock
      .expectOne((req) => req.url === '/api/orders/order-1/cancel')
      .flush({ message: 'Cannot cancel' }, { status: 409, statusText: 'Conflict' });

    expect(component.actionInFlight()).toBe(false);
  });

  it('flips actionInFlight on as soon as doPartialCancel is called, before the HTTP response arrives', () => {
    const { component, httpMock } = setup({ status: 'PAID', items: [itemFixture] });
    component.startPartialCancel();
    component.partialLines[0].selected = true;

    component.doPartialCancel();

    expect(component.actionInFlight()).toBe(true);
    httpMock.expectOne((req) => req.url === '/api/orders/order-1/cancel-items').flush({});
  });

  it('clears actionInFlight once doPartialCancel resolves successfully', () => {
    const { component, httpMock } = setup({ status: 'PAID', items: [itemFixture] });
    component.startPartialCancel();
    component.partialLines[0].selected = true;

    component.doPartialCancel();
    httpMock.expectOne((req) => req.url === '/api/orders/order-1/cancel-items').flush({});

    expect(component.actionInFlight()).toBe(false);
  });

  it('clears actionInFlight when doPartialCancel fails', () => {
    const { component, httpMock } = setup({ status: 'PAID', items: [itemFixture] });
    component.startPartialCancel();
    component.partialLines[0].selected = true;

    component.doPartialCancel();
    httpMock
      .expectOne((req) => req.url === '/api/orders/order-1/cancel-items')
      .flush({ message: 'Cannot cancel items' }, { status: 409, statusText: 'Conflict' });

    expect(component.actionInFlight()).toBe(false);
  });

  it('reports actionInFlight while a full cancel is outstanding even though submittingPartial was never touched', () => {
    const { component, httpMock } = setup({ status: 'PAID' });

    component.doCancel();

    expect(component.cancelling()).toBe(true);
    expect(component.submittingPartial()).toBe(false);
    expect(component.actionInFlight()).toBe(true);

    httpMock.expectOne((req) => req.url === '/api/orders/order-1/cancel').flush({});
  });

  it('reports actionInFlight while a partial cancel is outstanding even though cancelling was never touched', () => {
    const { component, httpMock } = setup({ status: 'PAID', items: [itemFixture] });
    component.startPartialCancel();
    component.partialLines[0].selected = true;

    component.doPartialCancel();

    expect(component.submittingPartial()).toBe(true);
    expect(component.cancelling()).toBe(false);
    expect(component.actionInFlight()).toBe(true);

    httpMock.expectOne((req) => req.url === '/api/orders/order-1/cancel-items').flush({});
  });
});

