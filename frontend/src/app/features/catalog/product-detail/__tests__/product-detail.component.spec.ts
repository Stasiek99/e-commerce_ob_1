import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { EMPTY } from 'rxjs';
import { PricePipe } from '../../../../shared/pipes/price.pipe';
import { ProductDetailComponent } from '../product-detail.component';
import { AuthService } from '../../../../core/services/auth.service';
import { CartService } from '../../../../core/services/cart.service';
import { ToastService } from '../../../../core/services/toast.service';
import { AnalyticsService } from '../../../../core/services/analytics.service';
import { SeoService } from '../../../../core/services/seo.service';
import { WishlistService } from '../../../../core/services/wishlist.service';
import { StockStreamService } from '../../../../core/services/stock-stream.service';
import { ReviewsService } from '../../../../core/services/reviews.service';

const SLUG = 'rose-oud';

const makeProductResponse = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'prod-1',
  name: 'Rose Oud',
  slug: SLUG,
  brand: 'Maison',
  shortDescription: 'A timeless scent',
  description: null,
  concentration: null,
  gender: null,
  pyramidTop: null,
  pyramidHeart: null,
  pyramidBase: null,
  images: [{ url: 'https://cdn.example.com/img.jpg', altText: null }],
  variants: [{ id: 'var-1', label: '50ml', priceInCents: 9900, compareAtPriceInCents: null, stock: 5, sku: 'SKU-1', volume: 50, weight: null }],
  category: { id: 'cat-1', name: 'Perfumes', slug: 'perfumes' },
  avgRating: null,
  reviewCount: 0,
  ...overrides,
});

const makeRelatedProduct = (id: string, overrides: Partial<Record<string, unknown>> = {}) => ({
  id,
  name: `Related ${id}`,
  slug: `related-${id}`,
  brand: 'Maison',
  catalogNumber: null,
  gender: null,
  images: [{ url: `https://cdn.example.com/${id}.jpg` }],
  variants: [{ id: `var-${id}`, label: '50ml', priceInCents: 8900, stock: 3 }],
  ...overrides,
});

function setup() {
  const mockRoute = {
    snapshot: {
      paramMap: { get: jest.fn().mockReturnValue(SLUG) },
      queryParamMap: { get: jest.fn().mockReturnValue(null) },
    },
  };

  const mockAuth = { isAuthenticated: jest.fn().mockReturnValue(false) };
  const mockCart = { addItem: jest.fn(), refreshFromServer: jest.fn() };
  const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
  const mockAnalytics = { trackAddToCart: jest.fn(), trackViewItem: jest.fn() };
  const mockSeo = { updateProductMeta: jest.fn(), setProductJsonLd: jest.fn() };
  const mockWishlist = { isInWishlist: jest.fn().mockReturnValue(false), toggle: jest.fn() };
  const mockStockStream = { connect: jest.fn().mockReturnValue(EMPTY) };
  const mockReviews = {
    getByProduct: jest.fn().mockReturnValue(EMPTY),
    submit: jest.fn(),
    markHelpful: jest.fn(),
  };

  TestBed.configureTestingModule({
    imports: [ProductDetailComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: mockRoute },
      { provide: Location, useValue: { back: jest.fn() } },
      { provide: PLATFORM_ID, useValue: 'browser' },
      { provide: AuthService, useValue: mockAuth },
      { provide: CartService, useValue: mockCart },
      { provide: ToastService, useValue: mockToast },
      { provide: AnalyticsService, useValue: mockAnalytics },
      { provide: SeoService, useValue: mockSeo },
      { provide: WishlistService, useValue: mockWishlist },
      { provide: StockStreamService, useValue: mockStockStream },
      { provide: ReviewsService, useValue: mockReviews },
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  // Keep PricePipe (pipes aren't suppressed by NO_ERRORS_SCHEMA).
  // FormsModule is intentionally excluded: activating ngModel on Taiga UI form controls
  // without their ControlValueAccessors causes NG01203 at runtime.
  TestBed.overrideComponent(ProductDetailComponent, {
    set: { imports: [PricePipe], schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA] },
  });

  const fixture = TestBed.createComponent(ProductDetailComponent);
  const component = fixture.componentInstance;
  const httpMock = TestBed.inject(HttpTestingController);

  return { component, fixture, httpMock };
}

describe('ProductDetailComponent — skeleton loading', () => {
  afterEach(() => jest.clearAllMocks());

  it('renders .skeleton-detail while the product is loading (before HTTP response)', () => {
    const { fixture } = setup();

    fixture.detectChanges(); // triggers ngOnInit, HTTP pending → loading() = true

    const skeleton = fixture.nativeElement.querySelector('.skeleton-detail');
    expect(skeleton).not.toBeNull();
  });

  it('does not render .page while loading', () => {
    const { fixture } = setup();

    fixture.detectChanges();

    const page = fixture.nativeElement.querySelector('.page');
    expect(page).toBeNull();
  });

  it('removes the skeleton and renders .page once the product loads', () => {
    const { fixture, httpMock } = setup();

    fixture.detectChanges();

    httpMock.expectOne(`/api/products/${SLUG}`).flush(makeProductResponse());
    httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`).flush([]);
    fixture.detectChanges();
    httpMock.verify();

    expect(fixture.nativeElement.querySelector('.skeleton-detail')).toBeNull();
    expect(fixture.nativeElement.querySelector('.page')).not.toBeNull();
  });
});

describe('ProductDetailComponent — loadRelatedProducts', () => {
  afterEach(() => jest.clearAllMocks());

  // ─── HTTP request ─────────────────────────────────────────────────────────

  describe('HTTP request', () => {
    it('sends GET /api/products/{slug}/related?limit=6 after the main product loads', () => {
      const { httpMock, fixture } = setup();

      fixture.detectChanges();

      httpMock.expectOne(`/api/products/${SLUG}`).flush(makeProductResponse());

      const req = httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`);
      expect(req.request.method).toBe('GET');
      req.flush([]);
      httpMock.verify();
    });
  });

  // ─── Signal update ────────────────────────────────────────────────────────

  describe('relatedProducts signal', () => {
    it('is empty before the main product loads', () => {
      const { component } = setup();
      expect(component.relatedProducts()).toEqual([]);
    });

    it('is populated with the API response', () => {
      const { component, httpMock, fixture } = setup();
      const related = [makeRelatedProduct('a'), makeRelatedProduct('b')];

      fixture.detectChanges();

      httpMock.expectOne(`/api/products/${SLUG}`).flush(makeProductResponse());
      httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`).flush(related);
      httpMock.verify();

      expect(component.relatedProducts()).toEqual(related);
    });

    it('stays empty when the related products endpoint returns an empty array', () => {
      const { component, httpMock, fixture } = setup();

      fixture.detectChanges();

      httpMock.expectOne(`/api/products/${SLUG}`).flush(makeProductResponse());
      httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`).flush([]);
      httpMock.verify();

      expect(component.relatedProducts()).toEqual([]);
    });
  });

  // ─── Error resilience ─────────────────────────────────────────────────────

  describe('error resilience', () => {
    it('silently ignores HTTP errors — signal stays empty', () => {
      const { component, httpMock, fixture } = setup();

      fixture.detectChanges();

      httpMock.expectOne(`/api/products/${SLUG}`).flush(makeProductResponse());
      httpMock
        .expectOne(`/api/products/${SLUG}/related?limit=6`)
        .flush('Server error', { status: 500, statusText: 'Internal Server Error' });
      httpMock.verify();

      expect(component.relatedProducts()).toEqual([]);
    });
  });

  // ─── Template rendering ───────────────────────────────────────────────────

  describe('template rendering', () => {
    it('does not render the related section when relatedProducts is empty', () => {
      const { httpMock, fixture } = setup();

      fixture.detectChanges();

      httpMock.expectOne(`/api/products/${SLUG}`).flush(makeProductResponse());
      httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`).flush([]);
      fixture.detectChanges();
      httpMock.verify();

      const section = fixture.nativeElement.querySelector('.related');
      expect(section).toBeNull();
    });

    it('renders the section heading when related products are present', () => {
      const { httpMock, fixture } = setup();
      const related = [makeRelatedProduct('x'), makeRelatedProduct('y')];

      fixture.detectChanges();

      httpMock.expectOne(`/api/products/${SLUG}`).flush(makeProductResponse());
      httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`).flush(related);
      fixture.detectChanges();
      httpMock.verify();

      const heading = fixture.nativeElement.querySelector('.related__heading');
      expect(heading).not.toBeNull();
      expect(heading.textContent).toContain('Może Ci się spodobać');
    });

    it('renders one product card per related product', () => {
      const { httpMock, fixture } = setup();
      const related = [makeRelatedProduct('1'), makeRelatedProduct('2'), makeRelatedProduct('3')];

      fixture.detectChanges();

      httpMock.expectOne(`/api/products/${SLUG}`).flush(makeProductResponse());
      httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`).flush(related);
      fixture.detectChanges();
      httpMock.verify();

      const cards = fixture.nativeElement.querySelectorAll('app-product-card');
      expect(cards.length).toBe(3);
    });
  });
});

// ─── Carousel (pages / slideIndex) ───────────────────────────────────────────

describe('ProductDetailComponent — related products carousel', () => {
  afterEach(() => jest.clearAllMocks());

  function loadWith(related: unknown[]) {
    const { component, httpMock, fixture } = setup();
    fixture.detectChanges();
    httpMock.expectOne(`/api/products/${SLUG}`).flush(makeProductResponse());
    httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`).flush(related);
    httpMock.verify();
    return { component, fixture };
  }

  describe('pages computed signal', () => {
    it('produces one page when products fit within itemsPerPage', () => {
      const related = [makeRelatedProduct('1'), makeRelatedProduct('2')];
      const { component } = loadWith(related);
      component.itemsPerPage.set(4);
      expect(component.pages().length).toBe(1);
      expect(component.pages()[0].length).toBe(2);
    });

    it('chunks products into multiple pages when count exceeds itemsPerPage', () => {
      const related = Array.from({ length: 6 }, (_, i) => makeRelatedProduct(String(i)));
      const { component } = loadWith(related);
      component.itemsPerPage.set(4);
      expect(component.pages().length).toBe(2);
      expect(component.pages()[0].length).toBe(4);
      expect(component.pages()[1].length).toBe(2);
    });

    it('recomputes when itemsPerPage changes', () => {
      const related = Array.from({ length: 6 }, (_, i) => makeRelatedProduct(String(i)));
      const { component } = loadWith(related);
      component.itemsPerPage.set(3);
      expect(component.pages().length).toBe(2);
      component.itemsPerPage.set(2);
      expect(component.pages().length).toBe(3);
    });

    it('returns an empty array when there are no related products', () => {
      const { component } = loadWith([]);
      expect(component.pages()).toEqual([]);
    });
  });

  describe('circular navigation', () => {
    it('nextSlide wraps from last page to first', () => {
      const related = Array.from({ length: 6 }, (_, i) => makeRelatedProduct(String(i)));
      const { component } = loadWith(related);
      component.itemsPerPage.set(4);
      component.slideIndex.set(1); // last page (pages.length - 1)

      component.nextSlide();

      expect(component.slideIndex()).toBe(0);
    });

    it('prevSlide wraps from first page to last', () => {
      const related = Array.from({ length: 6 }, (_, i) => makeRelatedProduct(String(i)));
      const { component } = loadWith(related);
      component.itemsPerPage.set(4);
      component.slideIndex.set(0);

      component.prevSlide();

      expect(component.slideIndex()).toBe(1);
    });

    it('nextSlide advances normally in the middle', () => {
      const related = Array.from({ length: 9 }, (_, i) => makeRelatedProduct(String(i)));
      const { component } = loadWith(related);
      component.itemsPerPage.set(3); // 3 pages
      component.slideIndex.set(0);

      component.nextSlide();

      expect(component.slideIndex()).toBe(1);
    });
  });
});

// ─── GA4 view_item tracking ───────────────────────────────────────────────────

describe('ProductDetailComponent — view_item tracking', () => {
  afterEach(() => jest.clearAllMocks());

  function getAnalyticsMock() {
    const { component, httpMock, fixture } = setup();
    const analytics = TestBed.inject(AnalyticsService) as jest.Mocked<AnalyticsService>;
    return { component, httpMock, fixture, analytics };
  }

  it('calls trackViewItem once after the product loads', () => {
    const { fixture, httpMock, analytics } = getAnalyticsMock();

    fixture.detectChanges();
    httpMock.expectOne(`/api/products/${SLUG}`).flush(makeProductResponse());
    httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`).flush([]);
    httpMock.verify();

    expect(analytics.trackViewItem).toHaveBeenCalledTimes(1);
  });

  it('passes the first variant id, product name, brand, label, category and price', () => {
    const { fixture, httpMock, analytics } = getAnalyticsMock();

    fixture.detectChanges();
    httpMock.expectOne(`/api/products/${SLUG}`).flush(makeProductResponse());
    httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`).flush([]);
    httpMock.verify();

    expect(analytics.trackViewItem).toHaveBeenCalledWith({
      itemId: 'var-1',
      name: 'Rose Oud',
      brand: 'Maison',
      variantLabel: '50ml',
      category: 'Perfumes',
      priceInCents: 9900,
    });
  });

  it('does not call trackViewItem when the product has no variants', () => {
    const { fixture, httpMock, analytics } = getAnalyticsMock();

    fixture.detectChanges();
    httpMock.expectOne(`/api/products/${SLUG}`).flush(makeProductResponse({ variants: [] }));
    httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`).flush([]);
    httpMock.verify();

    expect(analytics.trackViewItem).not.toHaveBeenCalled();
  });

  it('does not call trackViewItem before the HTTP response arrives', () => {
    const { fixture, analytics } = getAnalyticsMock();

    fixture.detectChanges(); // ngOnInit — HTTP pending

    expect(analytics.trackViewItem).not.toHaveBeenCalled();
  });
});

// ─── Catalog number rendering ─────────────────────────────────────────────────

describe('ProductDetailComponent — catalog number in heading', () => {
  afterEach(() => jest.clearAllMocks());

  it('renders NO. <number> inside the h1 when catalogNumber is set', () => {
    const { httpMock, fixture } = setup();
    fixture.detectChanges();
    httpMock.expectOne(`/api/products/${SLUG}`).flush(
      makeProductResponse({ catalogNumber: '087' }),
    );
    httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`).flush([]);
    fixture.detectChanges();
    httpMock.verify();

    const h1 = fixture.nativeElement.querySelector('.detail__name');
    expect(h1.textContent).toContain('NO.');
    expect(h1.textContent).toContain('087');
  });

  it('does not render a catalog number span when catalogNumber is null', () => {
    const { httpMock, fixture } = setup();
    fixture.detectChanges();
    httpMock.expectOne(`/api/products/${SLUG}`).flush(
      makeProductResponse({ catalogNumber: null }),
    );
    httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`).flush([]);
    fixture.detectChanges();
    httpMock.verify();

    const span = fixture.nativeElement.querySelector('.detail__catalog-no');
    expect(span).toBeNull();
  });
});
