import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ProductCardComponent, ProductCardData } from '../product-card.component';
import { CartService } from '../../../core/services/cart.service';
import { WishlistService } from '../../../core/services/wishlist.service';
import { ToastService } from '../../../core/services/toast.service';
import { AnalyticsService } from '../../../core/services/analytics.service';

const PRODUCT: ProductCardData = {
  id: 'p-1',
  name: 'Wildman Oud',
  slug: 'wildman-oud',
  brand: 'Fragrance Lab',
  variants: [{ id: 'v-1', label: '50ml', priceInCents: 9900, stock: 5 }],
};

const OUT_OF_STOCK_PRODUCT: ProductCardData = {
  ...PRODUCT,
  variants: [{ id: 'v-1', label: '50ml', priceInCents: 9900, stock: 0 }],
};

function setup(product: ProductCardData = PRODUCT) {
  const mockCart      = { addItem: jest.fn(), refreshFromServer: jest.fn() };
  const mockWishlist  = { isInWishlist: jest.fn().mockReturnValue(false), toggle: jest.fn() };
  const mockToast     = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
  const mockAnalytics = { trackAddToCart: jest.fn() };

  TestBed.configureTestingModule({
    imports: [ProductCardComponent],
    providers: [
      provideRouter([]),
      { provide: CartService,      useValue: mockCart },
      { provide: WishlistService,  useValue: mockWishlist },
      { provide: ToastService,     useValue: mockToast },
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

describe('ProductCardComponent — onAddToCart error handling', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('calls toast.error() when addItem fails', () => {
    const { component, mockCart, mockToast } = setup();
    mockCart.addItem.mockReturnValue(throwError(() => new Error('Network error')));

    component.onAddToCart(new MouseEvent('click'));

    expect(mockToast.error).toHaveBeenCalledWith('Nie udało się dodać do koszyka.');
  });

  it('resets adding signal to false after addItem fails', () => {
    const { component, mockCart } = setup();
    mockCart.addItem.mockReturnValue(throwError(() => new Error('Network error')));

    component.onAddToCart(new MouseEvent('click'));

    expect(component.adding()).toBe(false);
  });

  it('does NOT call toast.error() on a successful addItem', () => {
    const { component, mockCart, mockToast } = setup();
    mockCart.addItem.mockReturnValue(of({ items: [] }));

    component.onAddToCart(new MouseEvent('click'));

    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('calls toast.success() on a successful addItem', () => {
    const { component, mockCart, mockToast } = setup();
    mockCart.addItem.mockReturnValue(of({ items: [] }));

    component.onAddToCart(new MouseEvent('click'));

    expect(mockToast.success).toHaveBeenCalledWith('Dodano do koszyka!');
  });

  it('does NOT call addItem when product is out of stock', () => {
    const { component, mockCart } = setup(OUT_OF_STOCK_PRODUCT);

    component.onAddToCart(new MouseEvent('click'));

    expect(mockCart.addItem).not.toHaveBeenCalled();
  });

  it('does NOT call addItem when a previous add is already in progress', () => {
    const { component, mockCart } = setup();
    mockCart.addItem.mockReturnValue(of({ items: [] }));

    component.adding.set(true);
    component.onAddToCart(new MouseEvent('click'));

    expect(mockCart.addItem).not.toHaveBeenCalled();
  });
});
