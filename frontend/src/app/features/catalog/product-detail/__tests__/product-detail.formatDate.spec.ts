/**
 * @jest-environment-options { "timezone": "Europe/Warsaw" }
 *
 * Runs in the Europe/Warsaw timezone (UTC+1 winter, UTC+2 summer) to reproduce
 * the same parsing difference that causes Angular SSR hydration mismatches.
 * In UTC+1, `new Date('2026-01-01T00:30:00')` (no 'Z') is treated as local time
 * and resolves to December 31 — a different day than the server sees (UTC).
 */
import {
  CUSTOM_ELEMENTS_SCHEMA,
  NO_ERRORS_SCHEMA,
  PLATFORM_ID,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { ActivatedRoute } from "@angular/router";
import { Location } from "@angular/common";
import { EMPTY } from "rxjs";
import { PricePipe } from "../../../../shared/pipes/price.pipe";
import { ProductDetailComponent } from "../product-detail.component";
import { AuthService } from "../../../../core/services/auth.service";
import { CartService } from "../../../../core/services/cart.service";
import { ToastService } from "../../../../core/services/toast.service";
import { AnalyticsService } from "../../../../core/services/analytics.service";
import { SeoService } from "../../../../core/services/seo.service";
import { WishlistService } from "../../../../core/services/wishlist.service";
import { StockStreamService } from "../../../../core/services/stock-stream.service";
import { ReviewsService } from "../../../../core/services/reviews.service";

const SLUG = "rose-oud";

function setup() {
  const mockRoute = {
    snapshot: {
      paramMap: { get: jest.fn().mockReturnValue(SLUG) },
      queryParamMap: { get: jest.fn().mockReturnValue(null) },
    },
  };

  TestBed.configureTestingModule({
    imports: [ProductDetailComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: mockRoute },
      { provide: Location, useValue: { back: jest.fn() } },
      { provide: PLATFORM_ID, useValue: "browser" },
      {
        provide: AuthService,
        useValue: { isAuthenticated: jest.fn().mockReturnValue(false) },
      },
      {
        provide: CartService,
        useValue: { addItem: jest.fn(), refreshFromServer: jest.fn() },
      },
      {
        provide: ToastService,
        useValue: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
      },
      {
        provide: AnalyticsService,
        useValue: { trackAddToCart: jest.fn(), trackViewItem: jest.fn() },
      },
      {
        provide: SeoService,
        useValue: { updateProductMeta: jest.fn(), setProductJsonLd: jest.fn() },
      },
      {
        provide: WishlistService,
        useValue: {
          isInWishlist: jest.fn().mockReturnValue(false),
          toggle: jest.fn(),
        },
      },
      {
        provide: StockStreamService,
        useValue: { connect: jest.fn().mockReturnValue(EMPTY) },
      },
      {
        provide: ReviewsService,
        useValue: {
          getByProduct: jest.fn().mockReturnValue(EMPTY),
          submit: jest.fn(),
          markHelpful: jest.fn(),
        },
      },
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  TestBed.overrideComponent(ProductDetailComponent, {
    set: {
      imports: [PricePipe],
      schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
    },
  });

  const component = TestBed.createComponent(
    ProductDetailComponent,
  ).componentInstance;
  return { component };
}

const fmt = (d: Date) =>
  new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);

describe("ProductDetailComponent.formatDate — UTC parsing invariant (Warsaw timezone)", () => {
  afterEach(() => {
    jest.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it("returns January 1 for 2026-01-01T00:30:00 (UTC) — not December 31 as bare local-time parsing would yield in UTC+1", () => {
    const { component } = setup();

    // In Warsaw (UTC+1 winter), new Date('2026-01-01T00:30:00') without 'Z' resolves
    // to 2025-12-31T23:30:00Z → December 31.  The fix appends 'Z' to lock parsing to UTC.
    const result = component.formatDate("2026-01-01T00:30:00");

    const expectedUtcDate = new Date("2026-01-01T00:30:00Z");
    expect(result).toBe(fmt(expectedUtcDate));
  });

  it("returns July 1 for 2025-07-01T00:30:00 (UTC) — not June 30 as bare CEST (UTC+2) local-time parsing would yield", () => {
    const { component } = setup();

    // In Warsaw CEST (UTC+2 summer), new Date('2025-07-01T00:30:00') resolves to
    // 2025-06-30T22:30:00Z → June 30.  The fix forces UTC.
    const result = component.formatDate("2025-07-01T00:30:00");

    const expectedUtcDate = new Date("2025-07-01T00:30:00Z");
    expect(result).toBe(fmt(expectedUtcDate));
  });

  it("produces the same output for an ISO string and its equivalent Date object", () => {
    const { component } = setup();

    const isoString = "2026-06-15T14:00:00";
    const dateObject = new Date(isoString + "Z");

    expect(component.formatDate(isoString)).toBe(
      component.formatDate(dateObject),
    );
  });

  it("passes a Date object through without modification — no double timezone shift", () => {
    const { component } = setup();

    const dateObject = new Date("2026-03-15T12:00:00Z");

    expect(component.formatDate(dateObject)).toBe(fmt(dateObject));
  });

  it("formats a midday UTC string the same regardless of local timezone", () => {
    const { component } = setup();

    // Midday UTC timestamps are safe — both interpretations give the same calendar day
    const result = component.formatDate("2026-05-20T12:00:00");

    expect(result).toBe(fmt(new Date("2026-05-20T12:00:00Z")));
  });
});
