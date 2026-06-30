import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { OrderDetailComponent } from '../order-detail.component';
import { ToastService } from '../../../../core/services/toast.service';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

const ORDER_ID = 'order-abc';
const API = '/api';

const makeOrder = (items: Array<{ cancelledQuantity: number }> = [], status = 'PARTIALLY_REFUNDED') => ({
  id: ORDER_ID,
  orderNumber: 'ORD-2026-000001',
  status,
  items: items.map((i, idx) => ({
    id: `item-${idx}`,
    snapshotName: `Product ${idx}`,
    snapshotSku: `SKU-${idx}`,
    snapshotPrice: 1000,
    quantity: 2,
    cancelledQuantity: i.cancelledQuantity,
    cancelledDiscountInCents: 0,
    productVariantId: `pv-${idx}`,
  })),
  shippingCostInCents: 1999,
  itemsTotalInCents: 2000,
  discountInCents: 0,
  couponDiscountType: null,
  totalInCents: 36899,
  refundedAmountInCents: 1000,
  invoiceUrl: null,
  shipment: null,
});

function setup() {
  const mockRoute = {
    snapshot: { paramMap: { get: jest.fn().mockReturnValue(ORDER_ID) } },
  };
  const mockLocation = { back: jest.fn() };
  const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };

  // jsdom does not implement window.open — stub it so the success path doesn't throw
  Object.defineProperty(window, 'open', { value: jest.fn(), writable: true });

  TestBed.configureTestingModule({
    imports: [OrderDetailComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: mockRoute },
      { provide: Location, useValue: mockLocation },
      { provide: ToastService, useValue: mockToast },
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  TestBed.overrideComponent(OrderDetailComponent, {
    set: { imports: [FormsModule, PricePipe], schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA] },
  });

  const fixture = TestBed.createComponent(OrderDetailComponent);
  const component = fixture.componentInstance;
  const httpMock = TestBed.inject(HttpTestingController);

  return { component, fixture, httpMock, mockToast };
}

describe('OrderDetailComponent — corrective invoice download', () => {
  afterEach(() => jest.clearAllMocks());

  // ─── hasCorrectiveInvoice ─────────────────────────────────────────────────
  // Pure function — no HTTP involved; ngOnInit is not triggered (no detectChanges)

  describe('hasCorrectiveInvoice', () => {
    it('returns false when no item has a cancelledQuantity above 0', () => {
      const { component } = setup();
      expect(component.hasCorrectiveInvoice(makeOrder([{ cancelledQuantity: 0 }]))).toBe(false);
    });

    it('returns true when at least one item has cancelledQuantity > 0 and invoiceUrl is set', () => {
      const { component } = setup();
      const order = { ...makeOrder([{ cancelledQuantity: 0 }, { cancelledQuantity: 1 }]), invoiceUrl: 'https://cdn.example.com/invoice.pdf' };
      expect(component.hasCorrectiveInvoice(order)).toBe(true);
    });

    it('returns false when items are cancelled but invoiceUrl is null', () => {
      const { component } = setup();
      expect(component.hasCorrectiveInvoice(makeOrder([{ cancelledQuantity: 1 }]))).toBe(false);
    });

    it('returns false for an order with no items', () => {
      const { component } = setup();
      expect(component.hasCorrectiveInvoice(makeOrder([]))).toBe(false);
    });
  });

  // ─── downloadCorrectiveInvoice — HTTP ─────────────────────────────────────

  describe('downloadCorrectiveInvoice — HTTP behaviour', () => {
    it('sends GET /api/orders/:id/corrective-invoice', () => {
      const { component, httpMock, fixture } = setup();

      fixture.detectChanges();
      httpMock.expectOne(`${API}/orders/${ORDER_ID}`).flush(makeOrder([{ cancelledQuantity: 1 }]));
      fixture.detectChanges();

      component.downloadCorrectiveInvoice();

      const req = httpMock.expectOne(`${API}/orders/${ORDER_ID}/corrective-invoice`);
      expect(req.request.method).toBe('GET');
      req.flush({ correctiveInvoiceUrl: 'https://cdn.example.com/correction.pdf', correctiveInvoiceNumber: 'FK/2026/000001' });
      httpMock.verify();
    });

    it('opens the returned URL in a new tab on success', () => {
      const { component, httpMock, fixture } = setup();

      fixture.detectChanges();
      httpMock.expectOne(`${API}/orders/${ORDER_ID}`).flush(makeOrder([{ cancelledQuantity: 1 }]));

      component.downloadCorrectiveInvoice();
      httpMock.expectOne(`${API}/orders/${ORDER_ID}/corrective-invoice`).flush({
        correctiveInvoiceUrl: 'https://cdn.example.com/correction.pdf',
        correctiveInvoiceNumber: 'FK/2026/000001',
      });

      expect(window.open).toHaveBeenCalledWith('https://cdn.example.com/correction.pdf', '_blank', 'noopener');
      httpMock.verify();
    });

    it('clears the downloadingCorrectiveInvoice flag after success', () => {
      const { component, httpMock, fixture } = setup();

      fixture.detectChanges();
      httpMock.expectOne(`${API}/orders/${ORDER_ID}`).flush(makeOrder([{ cancelledQuantity: 1 }]));

      component.downloadCorrectiveInvoice();
      expect(component.downloadingCorrectiveInvoice()).toBe(true);

      httpMock.expectOne(`${API}/orders/${ORDER_ID}/corrective-invoice`).flush({
        correctiveInvoiceUrl: 'https://cdn.example.com/correction.pdf',
        correctiveInvoiceNumber: 'FK/2026/000001',
      });

      expect(component.downloadingCorrectiveInvoice()).toBe(false);
      httpMock.verify();
    });

    it('clears the downloadingCorrectiveInvoice flag and shows toast on HTTP error', () => {
      const { component, httpMock, fixture, mockToast } = setup();

      fixture.detectChanges();
      httpMock.expectOne(`${API}/orders/${ORDER_ID}`).flush(makeOrder([{ cancelledQuantity: 1 }]));

      component.downloadCorrectiveInvoice();

      httpMock
        .expectOne(`${API}/orders/${ORDER_ID}/corrective-invoice`)
        .flush('Not found', { status: 404, statusText: 'Not Found' });

      expect(component.downloadingCorrectiveInvoice()).toBe(false);
      expect(mockToast.error).toHaveBeenCalledTimes(1);
      httpMock.verify();
    });
  });

  // ─── Template — button visibility ────────────────────────────────────────

  describe('template — corrective invoice button visibility', () => {
    it('renders the corrective invoice button when an item was partially cancelled and invoice exists', () => {
      const { fixture, httpMock } = setup();

      fixture.detectChanges();
      httpMock.expectOne(`${API}/orders/${ORDER_ID}`).flush({ ...makeOrder([{ cancelledQuantity: 1 }]), invoiceUrl: 'https://cdn.example.com/invoice.pdf' });
      fixture.detectChanges();
      httpMock.verify();

      const buttons = fixture.nativeElement.querySelectorAll('.invoice-row button');
      const labels = Array.from(buttons as NodeListOf<HTMLElement>).map((b) => b.textContent ?? '');
      expect(labels.some((t) => t.includes('Pobierz korektę'))).toBe(true);
    });

    it('does not render the corrective invoice button when no item was cancelled', () => {
      const { fixture, httpMock } = setup();

      fixture.detectChanges();
      httpMock.expectOne(`${API}/orders/${ORDER_ID}`).flush(makeOrder([{ cancelledQuantity: 0 }]));
      fixture.detectChanges();
      httpMock.verify();

      const buttons = fixture.nativeElement.querySelectorAll('.invoice-row button');
      const labels = Array.from(buttons as NodeListOf<HTMLElement>).map((b) => b.textContent ?? '');
      expect(labels.some((t) => t.includes('Pobierz korektę'))).toBe(false);
    });

    it('renders the corrective invoice button for a CANCELLED order that has both an invoice and a partially cancelled item', () => {
      const { fixture, httpMock } = setup();

      fixture.detectChanges();
      httpMock.expectOne(`${API}/orders/${ORDER_ID}`).flush({
        ...makeOrder([{ cancelledQuantity: 1 }], 'CANCELLED'),
        invoiceUrl: 'https://cdn.example.com/invoice.pdf',
      });
      fixture.detectChanges();
      httpMock.verify();

      // canDownloadInvoice is false for CANCELLED, but the invoice-row must still render
      // because hasCorrectiveInvoice is true — otherwise the corrective button is unreachable.
      const row = fixture.nativeElement.querySelector('.invoice-row');
      expect(row).not.toBeNull();
      const buttons = row.querySelectorAll('button');
      const labels = Array.from(buttons as NodeListOf<HTMLElement>).map((b: HTMLElement) => b.textContent ?? '');
      expect(labels.some((t) => t.includes('Pobierz korektę'))).toBe(true);
      expect(labels.some((t) => t.includes('Pobierz fakturę'))).toBe(false);
    });
  });
});
