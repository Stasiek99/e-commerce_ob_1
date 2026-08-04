import { CUSTOM_ELEMENTS_SCHEMA } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute } from "@angular/router";
import { Location } from "@angular/common";
import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { OrderDetailComponent } from "../order-detail.component";
import { ToastService } from "../../../../core/services/toast.service";
import { PricePipe } from "../../../../shared/pipes/price.pipe";

function setup() {
  const mockRoute = {
    snapshot: { paramMap: { get: () => "order-abc" } },
  };
  const mockLocation = { back: jest.fn() };
  const mockToast = { success: jest.fn(), error: jest.fn() };

  TestBed.configureTestingModule({
    imports: [OrderDetailComponent, PricePipe],
    schemas: [CUSTOM_ELEMENTS_SCHEMA],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: mockRoute },
      { provide: Location, useValue: mockLocation },
      { provide: ToastService, useValue: mockToast },
    ],
  });

  const fixture = TestBed.createComponent(OrderDetailComponent);
  const component = fixture.componentInstance;
  return { fixture, component };
}

describe("OrderDetailComponent — trackingUrl()", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("returns null when shipment is null", () => {
    const { component } = setup();
    expect(component.trackingUrl(null)).toBeNull();
  });

  it("returns null when shipment is undefined", () => {
    const { component } = setup();
    expect(component.trackingUrl(undefined)).toBeNull();
  });

  it("returns null when trackingNumber is absent", () => {
    const { component } = setup();
    expect(component.trackingUrl({ carrierCode: "INPOST" })).toBeNull();
  });

  it("returns null when carrierCode is absent", () => {
    const { component } = setup();
    expect(component.trackingUrl({ trackingNumber: "123456789" })).toBeNull();
  });

  it("returns null for an unknown carrierCode", () => {
    const { component } = setup();
    expect(
      component.trackingUrl({ trackingNumber: "123", carrierCode: "FEDEX" }),
    ).toBeNull();
  });

  it("builds the InPost tracking URL", () => {
    const { component } = setup();
    const url = component.trackingUrl({
      trackingNumber: "123456789012",
      carrierCode: "INPOST",
    });
    expect(url).toBe(
      "https://inpost.pl/sledzenie-przesylek?number=123456789012",
    );
  });

  it("builds the DHL tracking URL", () => {
    const { component } = setup();
    const url = component.trackingUrl({
      trackingNumber: "1234567890",
      carrierCode: "DHL",
    });
    expect(url).toBe(
      "https://www.dhl.com/pl-pl/home/tracking.html?tracking-id=1234567890",
    );
  });

  it("builds the GLS tracking URL", () => {
    const { component } = setup();
    const url = component.trackingUrl({
      trackingNumber: "987654321",
      carrierCode: "GLS",
    });
    expect(url).toBe("https://gls-group.com/track/?match=987654321");
  });

  it("builds the DPD tracking URL", () => {
    const { component } = setup();
    const url = component.trackingUrl({
      trackingNumber: "00123456789012345678",
      carrierCode: "DPD",
    });
    expect(url).toBe(
      "https://tracktrace.dpd.com.pl/parcelDetails?typ=1&p1=00123456789012345678",
    );
  });

  it("builds the DPD_COURIER tracking URL", () => {
    const { component } = setup();
    const url = component.trackingUrl({
      trackingNumber: "00123456789012345678",
      carrierCode: "DPD_COURIER",
    });
    expect(url).toBe(
      "https://tracktrace.dpd.com.pl/parcelDetails?typ=1&p1=00123456789012345678",
    );
  });

  it("URL-encodes special characters in tracking numbers", () => {
    const { component } = setup();
    const url = component.trackingUrl({
      trackingNumber: "123 / 456",
      carrierCode: "INPOST",
    });
    expect(url).toBe(
      "https://inpost.pl/sledzenie-przesylek?number=123%20%2F%20456",
    );
  });
});
