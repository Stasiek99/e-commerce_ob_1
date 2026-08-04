import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { of, throwError } from "rxjs";
import {
  ProductCardComponent,
  ProductCardData,
} from "../product-card.component";
import { CartService } from "../../../core/services/cart.service";
import { WishlistService } from "../../../core/services/wishlist.service";
import { ToastService } from "../../../core/services/toast.service";
import { AnalyticsService } from "../../../core/services/analytics.service";

const PRODUCT: ProductCardData = {
  id: "p-1",
  name: "Wildman Oud",
  slug: "wildman-oud",
  brand: "Fragrance Lab",
  variants: [{ id: "v-1", label: "50ml", priceInCents: 9900, stock: 5 }],
};

const PRODUCT_WITH_VOLUME: ProductCardData = {
  ...PRODUCT,
  // 99.00 zł for 50ml → 198,00 zł / 100ml
  variants: [
    { id: "v-1", label: "50ml", priceInCents: 9900, stock: 5, volume: 50 },
  ],
};

const OUT_OF_STOCK_PRODUCT: ProductCardData = {
  ...PRODUCT,
  variants: [{ id: "v-1", label: "50ml", priceInCents: 9900, stock: 0 }],
};

// Backend always orders variants cheapest-first, so v-cheap (sold out) is
// variants[0] and v-pricier (in stock) is variants[1].
const CHEAPEST_SOLD_OUT_PRODUCT: ProductCardData = {
  ...PRODUCT,
  variants: [
    { id: "v-cheap", label: "30ml", priceInCents: 4900, stock: 0 },
    { id: "v-pricier", label: "100ml", priceInCents: 14900, stock: 5 },
  ],
};

function setup(product: ProductCardData = PRODUCT) {
  const mockCart = { addItem: jest.fn(), refreshFromServer: jest.fn() };
  const mockWishlist = {
    isInWishlist: jest.fn().mockReturnValue(false),
    toggle: jest.fn(),
  };
  const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
  const mockAnalytics = { trackAddToCart: jest.fn() };

  TestBed.configureTestingModule({
    imports: [ProductCardComponent],
    providers: [
      provideRouter([]),
      { provide: CartService, useValue: mockCart },
      { provide: WishlistService, useValue: mockWishlist },
      { provide: ToastService, useValue: mockToast },
      { provide: AnalyticsService, useValue: mockAnalytics },
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  TestBed.overrideComponent(ProductCardComponent, {
    set: { imports: [], schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA] },
  });

  const fixture = TestBed.createComponent(ProductCardComponent);
  const component = fixture.componentInstance;
  component.product = product;
  fixture.detectChanges();

  return { fixture, component, mockCart, mockToast, mockAnalytics };
}

describe("ProductCardComponent — onAddToCart error handling", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("calls toast.error() when addItem fails", () => {
    const { component, mockCart, mockToast } = setup();
    mockCart.addItem.mockReturnValue(
      throwError(() => new Error("Network error")),
    );

    component.onAddToCart(new MouseEvent("click"));

    expect(mockToast.error).toHaveBeenCalledWith(
      "Nie udało się dodać do koszyka.",
    );
  });

  it("resets adding signal to false after addItem fails", () => {
    const { component, mockCart } = setup();
    mockCart.addItem.mockReturnValue(
      throwError(() => new Error("Network error")),
    );

    component.onAddToCart(new MouseEvent("click"));

    expect(component.adding()).toBe(false);
  });

  it("does NOT call toast.error() on a successful addItem", () => {
    const { component, mockCart, mockToast } = setup();
    mockCart.addItem.mockReturnValue(of({ items: [] }));

    component.onAddToCart(new MouseEvent("click"));

    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("calls toast.success() on a successful addItem", () => {
    const { component, mockCart, mockToast } = setup();
    mockCart.addItem.mockReturnValue(of({ items: [] }));

    component.onAddToCart(new MouseEvent("click"));

    expect(mockToast.success).toHaveBeenCalledWith("Dodano do koszyka!");
  });

  it("does NOT call addItem when product is out of stock", () => {
    const { component, mockCart } = setup(OUT_OF_STOCK_PRODUCT);

    component.onAddToCart(new MouseEvent("click"));

    expect(mockCart.addItem).not.toHaveBeenCalled();
  });

  it("does NOT call addItem when a previous add is already in progress", () => {
    const { component, mockCart } = setup();
    mockCart.addItem.mockReturnValue(of({ items: [] }));

    component.adding.set(true);
    component.onAddToCart(new MouseEvent("click"));

    expect(mockCart.addItem).not.toHaveBeenCalled();
  });
});

describe("ProductCardComponent — cartVariant (sold-out cheapest variant)", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("is not disabled when only the cheapest variant is out of stock and a pricier one has stock", () => {
    const { component } = setup(CHEAPEST_SOLD_OUT_PRODUCT);

    expect(component.outOfStock).toBe(false);
  });

  it("adds the in-stock pricier variant to cart, not the sold-out cheapest one", () => {
    const { component, mockCart } = setup(CHEAPEST_SOLD_OUT_PRODUCT);
    mockCart.addItem.mockReturnValue(of({ items: [] }));

    component.onAddToCart(new MouseEvent("click"));

    expect(mockCart.addItem).toHaveBeenCalledWith("v-pricier", 1);
    expect(mockCart.addItem).not.toHaveBeenCalledWith("v-cheap", 1);
  });

  it("cartVariant returns the first variant with stock > 0", () => {
    const { component } = setup(CHEAPEST_SOLD_OUT_PRODUCT);

    expect(component.cartVariant?.id).toBe("v-pricier");
  });

  it("cartVariant falls back to firstVariant when every variant is out of stock", () => {
    const { component } = setup(OUT_OF_STOCK_PRODUCT);

    expect(component.cartVariant?.id).toBe(component.firstVariant?.id);
  });

  it("still displays the cheapest variant price regardless of stock", () => {
    const { component } = setup(CHEAPEST_SOLD_OUT_PRODUCT);

    expect(component.firstVariant?.id).toBe("v-cheap");
  });
});

describe("ProductCardComponent — unitPriceText (EU Price Indication Directive)", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("returns null when variant has no volume", () => {
    const { component } = setup(PRODUCT);

    expect(component.unitPriceText).toBeNull();
  });

  it("returns null when product has no variants", () => {
    const { component } = setup({ ...PRODUCT, variants: [] });

    expect(component.unitPriceText).toBeNull();
  });

  it("computes correct unit price for 50ml variant at 99,00 zł", () => {
    const { component } = setup(PRODUCT_WITH_VOLUME);

    expect(component.unitPriceText).toBe("198,00 zł / 100ml");
  });

  it("computes correct unit price for 100ml variant (price per 100ml equals full price)", () => {
    const product: ProductCardData = {
      ...PRODUCT,
      variants: [
        {
          id: "v-2",
          label: "100ml",
          priceInCents: 14900,
          stock: 3,
          volume: 100,
        },
      ],
    };
    const { component } = setup(product);

    expect(component.unitPriceText).toBe("149,00 zł / 100ml");
  });

  it("uses comma as decimal separator (Polish locale format)", () => {
    const product: ProductCardData = {
      ...PRODUCT,
      variants: [
        { id: "v-3", label: "30ml", priceInCents: 5000, stock: 2, volume: 30 },
      ],
    };
    const { component } = setup(product);

    // 50.00 zł / 30ml = 166.666... → 166,67 zł / 100ml
    expect(component.unitPriceText).not.toContain(".");
    expect(component.unitPriceText).toContain(",");
  });
});
