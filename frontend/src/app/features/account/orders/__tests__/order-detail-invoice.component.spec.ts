import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute } from "@angular/router";
import { Location } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { OrderDetailComponent } from "../order-detail.component";
import { ToastService } from "../../../../core/services/toast.service";
import { PricePipe } from "../../../../shared/pipes/price.pipe";

const ORDER_ID = "order-abc";
const API = "/api";

const makeOrder = (status = "PAID") => ({
  id: ORDER_ID,
  orderNumber: "ORD-2026-000001",
  status,
  items: [],
  shippingCostInCents: 1999,
  totalInCents: 36899,
  refundedAmountInCents: 0,
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
  Object.defineProperty(window, "open", { value: jest.fn(), writable: true });

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
    set: {
      imports: [FormsModule, PricePipe],
      schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
    },
  });

  const fixture = TestBed.createComponent(OrderDetailComponent);
  const component = fixture.componentInstance;
  const httpMock = TestBed.inject(HttpTestingController);

  return { component, fixture, httpMock, mockToast };
}

describe("OrderDetailComponent — invoice download", () => {
  afterEach(() => jest.clearAllMocks());

  // ─── canDownloadInvoice ───────────────────────────────────────────────────
  // Pure function — no HTTP involved; ngOnInit is not triggered (no detectChanges)

  describe("canDownloadInvoice", () => {
    it("returns false for PENDING_PAYMENT", () => {
      const { component } = setup();
      expect(component.canDownloadInvoice("PENDING_PAYMENT")).toBe(false);
    });

    it("returns false for CANCELLED", () => {
      const { component } = setup();
      expect(component.canDownloadInvoice("CANCELLED")).toBe(false);
    });

    it.each([
      "PAID",
      "PROCESSING",
      "SHIPPED",
      "DELIVERED",
      "REFUNDED",
      "PARTIALLY_REFUNDED",
    ])("returns true for %s", (status) => {
      const { component } = setup();
      expect(component.canDownloadInvoice(status)).toBe(true);
    });
  });

  // ─── downloadInvoice — HTTP ───────────────────────────────────────────────

  describe("downloadInvoice — HTTP behaviour", () => {
    it("sends GET /api/orders/:id/invoice", () => {
      const { component, httpMock, fixture } = setup();

      fixture.detectChanges();
      httpMock.expectOne(`${API}/orders/${ORDER_ID}`).flush(makeOrder());
      fixture.detectChanges();

      component.downloadInvoice();

      const req = httpMock.expectOne(`${API}/orders/${ORDER_ID}/invoice`);
      expect(req.request.method).toBe("GET");
      req.flush({ invoiceUrl: "https://cdn.example.com/invoice.pdf" });
      httpMock.verify();
    });

    it("clears the downloadingInvoice flag after success", () => {
      const { component, httpMock, fixture } = setup();

      fixture.detectChanges();
      httpMock.expectOne(`${API}/orders/${ORDER_ID}`).flush(makeOrder());

      component.downloadInvoice();
      expect(component.downloadingInvoice()).toBe(true);

      httpMock.expectOne(`${API}/orders/${ORDER_ID}/invoice`).flush({
        invoiceUrl: "https://cdn.example.com/invoice.pdf",
      });

      expect(component.downloadingInvoice()).toBe(false);
      httpMock.verify();
    });

    it("clears the downloadingInvoice flag and shows toast on HTTP error", () => {
      const { component, httpMock, fixture, mockToast } = setup();

      fixture.detectChanges();
      httpMock.expectOne(`${API}/orders/${ORDER_ID}`).flush(makeOrder());

      component.downloadInvoice();

      httpMock
        .expectOne(`${API}/orders/${ORDER_ID}/invoice`)
        .flush("Server error", {
          status: 500,
          statusText: "Internal Server Error",
        });

      expect(component.downloadingInvoice()).toBe(false);
      expect(mockToast.error).toHaveBeenCalledTimes(1);
      httpMock.verify();
    });
  });

  // ─── Template — button visibility ────────────────────────────────────────

  describe("template — invoice button visibility", () => {
    it("renders the invoice button for a PAID order", () => {
      const { fixture, httpMock } = setup();

      fixture.detectChanges();
      httpMock.expectOne(`${API}/orders/${ORDER_ID}`).flush(makeOrder("PAID"));
      fixture.detectChanges();
      httpMock.verify();

      const btn = fixture.nativeElement.querySelector(".invoice-row button");
      expect(btn).not.toBeNull();
    });

    it("does not render the invoice button for PENDING_PAYMENT", () => {
      const { fixture, httpMock } = setup();

      fixture.detectChanges();
      httpMock
        .expectOne(`${API}/orders/${ORDER_ID}`)
        .flush(makeOrder("PENDING_PAYMENT"));
      fixture.detectChanges();
      httpMock.verify();

      const btn = fixture.nativeElement.querySelector(".invoice-row");
      expect(btn).toBeNull();
    });

    it("does not render the invoice button for CANCELLED", () => {
      const { fixture, httpMock } = setup();

      fixture.detectChanges();
      httpMock
        .expectOne(`${API}/orders/${ORDER_ID}`)
        .flush(makeOrder("CANCELLED"));
      fixture.detectChanges();
      httpMock.verify();

      const btn = fixture.nativeElement.querySelector(".invoice-row");
      expect(btn).toBeNull();
    });
  });
});
