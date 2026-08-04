import { TestBed } from "@angular/core/testing";
import { NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA } from "@angular/core";
import { ReactiveFormsModule } from "@angular/forms";
import { DatePipe } from "@angular/common";
import { RouterLink } from "@angular/router";
import { provideRouter, ActivatedRoute } from "@angular/router";
import { provideHttpClient } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { ReturnRequestComponent } from "../return-request.component";
import { environment } from "../../../../../environments/environment";

const RETURNS_URL = `${environment.apiUrl}/returns`;
// Fixed "today" to make deadline tests deterministic.
const TODAY_MS = new Date("2026-05-22").getTime();

function buildRoute(typeParam: string | null) {
  return {
    snapshot: { queryParamMap: { get: jest.fn().mockReturnValue(typeParam) } },
  };
}

function setup(typeParam: string | null = null) {
  TestBed.configureTestingModule({
    imports: [ReturnRequestComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: buildRoute(typeParam) },
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  // Strip Taiga UI — we test the class, not the template.
  TestBed.overrideComponent(ReturnRequestComponent, {
    set: {
      imports: [ReactiveFormsModule, RouterLink, DatePipe],
      schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
    },
  });

  const fixture = TestBed.createComponent(ReturnRequestComponent);
  const component = fixture.componentInstance;
  const httpMock = TestBed.inject(HttpTestingController);
  return { fixture, component, httpMock };
}

function fillValidWithdrawal(c: ReturnRequestComponent) {
  c.form.patchValue({
    type: "WITHDRAWAL",
    orderNumber: "ORD-2026-001",
    deliveryDate: "2026-05-15", // deadline = 2026-05-30 23:59:59 (delivery +15d, day-end), 9 days left → 'ok'
    firstName: "Jan",
    lastName: "Kowalski",
    sealIntact: true,
    rodoConsent: true,
  });
  c.form
    .get("items")!
    .get([0])!
    .patchValue({ productName: "Perfumy Gold 50ml", quantity: 1 });
}

function fillValidComplaint(c: ReturnRequestComponent) {
  c.form.patchValue({
    type: "COMPLAINT",
    orderNumber: "ORD-2026-001",
    deliveryDate: "2026-05-10",
    firstName: "Jan",
    lastName: "Kowalski",
    requestedResolution: "REFUND",
    reason: "Produkt jest wadliwy i niezgodny z opisem",
    rodoConsent: true,
  });
  c.form
    .get("items")!
    .get([0])!
    .patchValue({ productName: "Perfumy Gold 50ml", quantity: 1 });
}

describe("ReturnRequestComponent", () => {
  afterEach(() => jest.restoreAllMocks());

  // ── Query param pre-selection ─────────────────────────────────────

  describe("query param pre-selection", () => {
    it("defaults to WITHDRAWAL when no query param is present", () => {
      const { component } = setup();
      expect(component.form.value.type).toBe("WITHDRAWAL");
    });

    it("pre-selects WITHDRAWAL for ?type=withdrawal", () => {
      const { component } = setup("withdrawal");
      expect(component.form.value.type).toBe("WITHDRAWAL");
    });

    it("pre-selects COMPLAINT for ?type=complaint", () => {
      const { component } = setup("complaint");
      expect(component.form.value.type).toBe("COMPLAINT");
    });

    it("ignores unknown query param values", () => {
      const { component } = setup("unknown");
      expect(component.form.value.type).toBe("WITHDRAWAL");
    });
  });

  // ── Deadline calculation ──────────────────────────────────────────

  describe("deadlineDate()", () => {
    it("returns null when deliveryDate is empty", () => {
      const { component } = setup();
      expect(component.deadlineDate()).toBeNull();
    });

    it("adds 15 days to the delivery date (covers the full 14-day Art. 27 window, day-end)", () => {
      const { component } = setup();
      component.form.get("deliveryDate")!.setValue("2026-05-01");
      const result = component.deadlineDate();
      expect(result).toBeInstanceOf(Date);
      expect(result!.toISOString().split("T")[0]).toBe("2026-05-16");
    });

    it("handles month boundaries correctly", () => {
      const { component } = setup();
      component.form.get("deliveryDate")!.setValue("2026-01-25");
      expect(component.deadlineDate()!.toISOString().split("T")[0]).toBe(
        "2026-02-09",
      );
    });
  });

  describe("deadlineStatus()", () => {
    it("returns null when deliveryDate is empty", () => {
      const { component } = setup();
      expect(component.deadlineStatus()).toBeNull();
    });

    it('returns "ok" when more than 3 days remain', () => {
      jest.spyOn(Date, "now").mockReturnValue(TODAY_MS);
      const { component } = setup();
      // 2026-05-15 + 15d (day-end) = 2026-05-30 23:59:59, today = 2026-05-22 → 9 days left
      component.form.get("deliveryDate")!.setValue("2026-05-15");
      expect(component.deadlineStatus()).toBe("ok");
    });

    it('returns "urgent" when 1-3 days remain', () => {
      jest.spyOn(Date, "now").mockReturnValue(TODAY_MS);
      const { component } = setup();
      // 2026-05-09 + 15d (day-end) = 2026-05-24 23:59:59, today = 2026-05-22 → 3 days left
      component.form.get("deliveryDate")!.setValue("2026-05-09");
      expect(component.deadlineStatus()).toBe("urgent");
    });

    it('returns "expired" when deadline has passed', () => {
      jest.spyOn(Date, "now").mockReturnValue(TODAY_MS);
      const { component } = setup();
      // 2026-05-01 + 15d (day-end) = 2026-05-16 23:59:59, today = 2026-05-22 → already past
      component.form.get("deliveryDate")!.setValue("2026-05-01");
      expect(component.deadlineStatus()).toBe("expired");
    });
  });

  describe("daysLeft()", () => {
    it("returns 0 when deliveryDate is empty", () => {
      const { component } = setup();
      expect(component.daysLeft()).toBe(0);
    });

    it("returns the correct number of days", () => {
      jest.spyOn(Date, "now").mockReturnValue(TODAY_MS);
      const { component } = setup();
      component.form.get("deliveryDate")!.setValue("2026-05-15");
      expect(component.daysLeft()).toBe(9);
    });
  });

  // ── sealError ─────────────────────────────────────────────────────

  describe("sealError()", () => {
    it("is false when form is untouched", () => {
      const { component } = setup();
      expect(component.sealError()).toBe(false);
    });

    it("is true when withdrawal + form touched + sealIntact unchecked", () => {
      const { component } = setup();
      component.form.patchValue({ type: "WITHDRAWAL", sealIntact: false });
      component.form.markAllAsTouched();
      expect(component.sealError()).toBe(true);
    });

    it("is false when sealIntact is checked", () => {
      const { component } = setup();
      component.form.patchValue({ type: "WITHDRAWAL", sealIntact: true });
      component.form.markAllAsTouched();
      expect(component.sealError()).toBe(false);
    });

    it("is false for COMPLAINT even if sealIntact is unchecked", () => {
      const { component } = setup("complaint");
      component.form.patchValue({ type: "COMPLAINT", sealIntact: false });
      component.form.markAllAsTouched();
      expect(component.sealError()).toBe(false);
    });
  });

  // ── FormArray helpers ─────────────────────────────────────────────

  describe("FormArray helpers", () => {
    it("starts with one item row", () => {
      const { component } = setup();
      expect(component.items.length).toBe(1);
    });

    it("addItem() appends a new item group", () => {
      const { component } = setup();
      component.addItem();
      expect(component.items.length).toBe(2);
    });

    it("removeItem() removes the item at the given index", () => {
      const { component } = setup();
      component.addItem();
      component.items.at(1).get("productName")!.setValue("Second item");
      component.removeItem(1);
      expect(component.items.length).toBe(1);
    });

    it("new item group has correct default values", () => {
      const { component } = setup();
      component.addItem();
      expect(component.items.at(1).value).toEqual({
        productName: "",
        quantity: 1,
      });
    });
  });

  // ── touched() helper ──────────────────────────────────────────────

  describe("touched()", () => {
    it("returns false for a pristine invalid control", () => {
      const { component } = setup();
      expect(component.touched("orderNumber")).toBe(false);
    });

    it("returns true when control is invalid and touched", () => {
      const { component } = setup();
      const ctrl = component.form.get("orderNumber")!;
      ctrl.markAsTouched();
      expect(component.touched("orderNumber")).toBe(true);
    });

    it("returns false when control is valid and touched", () => {
      const { component } = setup();
      const ctrl = component.form.get("orderNumber")!;
      ctrl.setValue("ORD-2026-001");
      ctrl.markAsTouched();
      expect(component.touched("orderNumber")).toBe(false);
    });
  });

  // ── submit() — guards ─────────────────────────────────────────────

  describe("submit() guards", () => {
    it("blocks submission when sealIntact is unchecked (withdrawal)", () => {
      const { component, httpMock } = setup();
      fillValidWithdrawal(component);
      component.form.patchValue({ sealIntact: false });

      component.submit();

      httpMock.expectNone(RETURNS_URL);
    });

    it("blocks submission when withdrawal deadline is expired", () => {
      jest.spyOn(Date, "now").mockReturnValue(TODAY_MS);
      const { component, httpMock } = setup();
      fillValidWithdrawal(component);
      // Override delivery date to something 21 days ago → deadline 7 days ago
      component.form.get("deliveryDate")!.setValue("2026-05-01");

      component.submit();

      httpMock.expectNone(RETURNS_URL);
    });

    it("blocks submission when complaint has no requestedResolution", () => {
      const { component, httpMock } = setup("complaint");
      fillValidComplaint(component);
      component.form.patchValue({ requestedResolution: "" });

      component.submit();

      httpMock.expectNone(RETURNS_URL);
    });

    it("blocks submission when required fields are missing (form.invalid)", () => {
      const { component, httpMock } = setup();
      // sealIntact + rodoConsent ok, but name/email empty → invalid
      component.form.patchValue({
        type: "WITHDRAWAL",
        sealIntact: true,
        rodoConsent: true,
      });

      component.submit();

      httpMock.expectNone(RETURNS_URL);
    });
  });

  // ── submit() — withdrawal success ─────────────────────────────────

  describe("submit() — withdrawal success", () => {
    it("sends the correct payload", () => {
      jest.spyOn(Date, "now").mockReturnValue(TODAY_MS);
      const { component, httpMock } = setup();
      fillValidWithdrawal(component);

      component.submit();

      const req = httpMock.expectOne(RETURNS_URL);
      expect(req.request.method).toBe("POST");
      expect(req.request.body).toMatchObject({
        type: "WITHDRAWAL",
        orderNumber: "ORD-2026-001",
        deliveryDate: "2026-05-15",
        firstName: "Jan",
        lastName: "Kowalski",
        items: [{ productName: "Perfumy Gold 50ml", quantity: 1 }],
      });
      req.flush({ id: "RET-001" });
      httpMock.verify();
    });

    it("omits optional fields when they are empty", () => {
      jest.spyOn(Date, "now").mockReturnValue(TODAY_MS);
      const { component, httpMock } = setup();
      fillValidWithdrawal(component);

      component.submit();

      const req = httpMock.expectOne(RETURNS_URL);
      expect(req.request.body.phone).toBeUndefined();
      expect(req.request.body.reason).toBeUndefined();
      expect(req.request.body.bankAccount).toBeUndefined();
      req.flush({ id: "RET-001" });
      httpMock.verify();
    });

    it("sets submitted/submittedType/requestId signals on success", () => {
      jest.spyOn(Date, "now").mockReturnValue(TODAY_MS);
      const { component, httpMock } = setup();
      fillValidWithdrawal(component);

      component.submit();
      httpMock.expectOne(RETURNS_URL).flush({ id: "RET-001" });

      expect(component.submitted()).toBe(true);
      expect(component.submittedType()).toBe("WITHDRAWAL");
      expect(component.requestId()).toBe("RET-001");
      expect(component.submitting()).toBe(false);
    });

    it("sets submitting to true during in-flight request", () => {
      jest.spyOn(Date, "now").mockReturnValue(TODAY_MS);
      const { component, httpMock } = setup();
      fillValidWithdrawal(component);

      component.submit();

      expect(component.submitting()).toBe(true);
      httpMock.expectOne(RETURNS_URL).flush({ id: "RET-001" });
    });
  });

  // ── submit() — complaint success ──────────────────────────────────

  describe("submit() — complaint success", () => {
    it("sends requestedResolution and reason in payload", () => {
      const { component, httpMock } = setup("complaint");
      fillValidComplaint(component);

      component.submit();

      const req = httpMock.expectOne(RETURNS_URL);
      expect(req.request.body).toMatchObject({
        type: "COMPLAINT",
        requestedResolution: "REFUND",
        reason: "Produkt jest wadliwy i niezgodny z opisem",
      });
      req.flush({ id: "RET-002" });
      httpMock.verify();
    });

    it("sets submittedType to COMPLAINT on success", () => {
      const { component, httpMock } = setup("complaint");
      fillValidComplaint(component);

      component.submit();
      httpMock.expectOne(RETURNS_URL).flush({ id: "RET-002" });

      expect(component.submittedType()).toBe("COMPLAINT");
      expect(component.requestId()).toBe("RET-002");
      expect(component.submitted()).toBe(true);
    });
  });

  // ── submit() — error handling ─────────────────────────────────────

  describe("submit() — error handling", () => {
    it("shows the API error message on failure", () => {
      jest.spyOn(Date, "now").mockReturnValue(TODAY_MS);
      const { component, httpMock } = setup();
      fillValidWithdrawal(component);

      component.submit();
      httpMock
        .expectOne(RETURNS_URL)
        .flush(
          { message: "Zamówienie nie istnieje" },
          { status: 400, statusText: "Bad Request" },
        );

      expect(component.serverError()).toBe("Zamówienie nie istnieje");
      expect(component.submitted()).toBe(false);
      expect(component.submitting()).toBe(false);
    });

    it("shows a fallback message when API returns no message", () => {
      jest.spyOn(Date, "now").mockReturnValue(TODAY_MS);
      const { component, httpMock } = setup();
      fillValidWithdrawal(component);

      component.submit();
      httpMock
        .expectOne(RETURNS_URL)
        .flush({}, { status: 500, statusText: "Internal Server Error" });

      expect(component.serverError()).toContain("zwroty@aromaterie.pl");
    });

    it("clears serverError before each submission attempt", () => {
      jest.spyOn(Date, "now").mockReturnValue(TODAY_MS);
      const { component, httpMock } = setup();
      fillValidWithdrawal(component);

      // First attempt fails
      component.submit();
      httpMock
        .expectOne(RETURNS_URL)
        .flush(
          { message: "Błąd serwera" },
          { status: 500, statusText: "Server Error" },
        );
      expect(component.serverError()).toBeTruthy();

      // Second attempt — serverError should be cleared before request fires
      component.submit();
      expect(component.serverError()).toBeNull();
      httpMock.expectOne(RETURNS_URL).flush({ id: "RET-003" });
      httpMock.verify();
    });
  });
});
