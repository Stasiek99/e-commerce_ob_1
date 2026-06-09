import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
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
import { ReviewsService, ReviewSummary } from '../../../../core/services/reviews.service';
import { RESPONSE } from '../../../../core/tokens/ssr.tokens';

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
  const mockRouter = { navigate: jest.fn() };

  TestBed.configureTestingModule({
    imports: [ProductDetailComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: mockRoute },
      { provide: Location, useValue: { back: jest.fn() } },
      { provide: PLATFORM_ID, useValue: 'browser' },
      { provide: Router, useValue: mockRouter },
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

// ─── Reviews SSR guard (isPlatformBrowser) ─────────────────────────────────────
// Regression guard: loadReviews must be skipped during SSR/prerender.
// Without the guard, 200+ products prerendered at Vercel build time each fire
// a GET /products/{id}/reviews request — inflating Railway request counts and
// adding 200–500ms to every SSR render.

function setupWithPlatform(platform: 'browser' | 'server', extraProviders: unknown[] = []) {
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
  const mockRouter = { navigate: jest.fn() };

  TestBed.configureTestingModule({
    imports: [ProductDetailComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: mockRoute },
      { provide: Location, useValue: { back: jest.fn() } },
      { provide: PLATFORM_ID, useValue: platform },
      { provide: Router, useValue: mockRouter },
      { provide: AuthService, useValue: mockAuth },
      { provide: CartService, useValue: mockCart },
      { provide: ToastService, useValue: mockToast },
      { provide: AnalyticsService, useValue: mockAnalytics },
      { provide: SeoService, useValue: mockSeo },
      { provide: WishlistService, useValue: mockWishlist },
      { provide: StockStreamService, useValue: mockStockStream },
      { provide: ReviewsService, useValue: mockReviews },
      ...(extraProviders as any[]),
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  TestBed.overrideComponent(ProductDetailComponent, {
    set: { imports: [PricePipe], schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA] },
  });

  const fixture = TestBed.createComponent(ProductDetailComponent);
  const httpMock = TestBed.inject(HttpTestingController);
  const reviewsService = TestBed.inject(ReviewsService) as unknown as jest.Mocked<Pick<ReviewsService, 'getByProduct'>>;
  const router = TestBed.inject(Router) as jest.Mocked<Router>;

  return { fixture, httpMock, reviewsService, router };
}

describe('ProductDetailComponent — loadReviews SSR guard', () => {
  afterEach(() => jest.clearAllMocks());

  it('calls reviewsService.getByProduct after the product loads in browser context', () => {
    const { fixture, httpMock, reviewsService } = setupWithPlatform('browser');

    fixture.detectChanges();

    httpMock.expectOne(`/api/products/${SLUG}`).flush(makeProductResponse());
    httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`).flush([]);
    httpMock.verify();

    expect(reviewsService.getByProduct).toHaveBeenCalledWith('prod-1', 1, 'recent');
  });

  it('does NOT call reviewsService.getByProduct during SSR (PLATFORM_ID = server)', () => {
    const { fixture, httpMock, reviewsService } = setupWithPlatform('server');

    fixture.detectChanges();

    httpMock.expectOne(`/api/products/${SLUG}`).flush(makeProductResponse());
    httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`).flush([]);
    httpMock.verify();

    expect(reviewsService.getByProduct).not.toHaveBeenCalled();
  });

  it('calls getByProduct with the correct product id in browser context', () => {
    const { fixture, httpMock, reviewsService } = setupWithPlatform('browser');

    fixture.detectChanges();

    httpMock.expectOne(`/api/products/${SLUG}`).flush(makeProductResponse({ id: 'prod-xyz' }));
    httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`).flush([]);
    httpMock.verify();

    expect(reviewsService.getByProduct).toHaveBeenCalledWith('prod-xyz', expect.any(Number), expect.any(String));
  });
});

// ─── 404 error handling ───────────────────────────────────────────────────────
// Regression guard: backend 404 → router.navigate(['/not-found'], skipLocationChange)
// Non-404 errors must not trigger navigation. SSR must also set response.status(404).

describe('ProductDetailComponent — 404 error handling (browser)', () => {
  afterEach(() => jest.clearAllMocks());

  it('navigates to /not-found with skipLocationChange when the backend returns 404', () => {
    const { fixture, httpMock, router } = setupWithPlatform('browser');

    fixture.detectChanges();

    httpMock.expectOne(`/api/products/${SLUG}`).flush(
      { message: 'Not Found' },
      { status: 404, statusText: 'Not Found' },
    );
    httpMock.verify();

    expect(router.navigate).toHaveBeenCalledWith(['/not-found'], { skipLocationChange: true });
  });

  it('sets loading to false after a 404 response', () => {
    const { fixture, httpMock, router } = setupWithPlatform('browser');

    fixture.detectChanges();

    httpMock.expectOne(`/api/products/${SLUG}`).flush(
      { message: 'Not Found' },
      { status: 404, statusText: 'Not Found' },
    );
    httpMock.verify();

    const component = fixture.componentInstance;
    expect(component.loading()).toBe(false);
    // navigation is the important side-effect; call count sanity check
    expect(router.navigate).toHaveBeenCalledTimes(1);
  });

  it('does NOT navigate to /not-found for a non-404 server error', () => {
    const { fixture, httpMock, router } = setupWithPlatform('browser');

    fixture.detectChanges();

    httpMock.expectOne(`/api/products/${SLUG}`).flush(
      { message: 'Internal Server Error' },
      { status: 500, statusText: 'Internal Server Error' },
    );
    httpMock.verify();

    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does NOT navigate to /not-found for a 401 response', () => {
    const { fixture, httpMock, router } = setupWithPlatform('browser');

    fixture.detectChanges();

    httpMock.expectOne(`/api/products/${SLUG}`).flush(
      { message: 'Unauthorized' },
      { status: 401, statusText: 'Unauthorized' },
    );
    httpMock.verify();

    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('still sets loading to false for non-404 errors', () => {
    const { fixture, httpMock } = setupWithPlatform('browser');

    fixture.detectChanges();

    httpMock.expectOne(`/api/products/${SLUG}`).flush(
      { message: 'Internal Server Error' },
      { status: 500, statusText: 'Internal Server Error' },
    );
    httpMock.verify();

    expect(fixture.componentInstance.loading()).toBe(false);
  });
});

describe('ProductDetailComponent — 404 error handling (SSR)', () => {
  afterEach(() => jest.clearAllMocks());

  it('calls ssrResponse.status(404) when platform is server and backend returns 404', () => {
    const mockSsrResponse = { status: jest.fn().mockReturnThis() };

    const { fixture, httpMock, router } = setupWithPlatform('server', [
      { provide: RESPONSE, useValue: mockSsrResponse },
    ]);

    fixture.detectChanges();

    httpMock.expectOne(`/api/products/${SLUG}`).flush(
      { message: 'Not Found' },
      { status: 404, statusText: 'Not Found' },
    );
    httpMock.verify();

    expect(mockSsrResponse.status).toHaveBeenCalledWith(404);
    expect(router.navigate).toHaveBeenCalledWith(['/not-found'], { skipLocationChange: true });
  });

  it('does NOT call ssrResponse.status when platform is browser and backend returns 404', () => {
    const mockSsrResponse = { status: jest.fn().mockReturnThis() };

    const { fixture, httpMock } = setupWithPlatform('browser', [
      { provide: RESPONSE, useValue: mockSsrResponse },
    ]);

    fixture.detectChanges();

    httpMock.expectOne(`/api/products/${SLUG}`).flush(
      { message: 'Not Found' },
      { status: 404, statusText: 'Not Found' },
    );
    httpMock.verify();

    expect(mockSsrResponse.status).not.toHaveBeenCalled();
  });

  it('does NOT call ssrResponse.status for non-404 errors in SSR context', () => {
    const mockSsrResponse = { status: jest.fn().mockReturnThis() };

    const { fixture, httpMock } = setupWithPlatform('server', [
      { provide: RESPONSE, useValue: mockSsrResponse },
    ]);

    fixture.detectChanges();

    httpMock.expectOne(`/api/products/${SLUG}`).flush(
      { message: 'Internal Server Error' },
      { status: 500, statusText: 'Internal Server Error' },
    );
    httpMock.verify();

    expect(mockSsrResponse.status).not.toHaveBeenCalled();
  });
});

// ─── Thumbnail alt text ───────────────────────────────────────────────────────
// Regression guard: gallery and lightbox thumbnail <img> elements must have
// descriptive alt text. Reverting to alt="" would fail these tests, breaking
// SEO (Google Image Search) and screen reader accessibility.

describe('ProductDetailComponent — thumbnail alt text', () => {
  afterEach(() => jest.clearAllMocks());

  function loadWithTwoImages() {
    const { component, fixture, httpMock } = setup();

    fixture.detectChanges();

    httpMock.expectOne(`/api/products/${SLUG}`).flush(
      makeProductResponse({
        images: [
          { url: 'https://cdn.example.com/img1.jpg', altText: null },
          { url: 'https://cdn.example.com/img2.jpg', altText: null },
        ],
      }),
    );
    httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`).flush([]);
    fixture.detectChanges();
    httpMock.verify();

    return { component, fixture };
  }

  describe('gallery thumbnails (.detail__thumb)', () => {
    it('renders two thumbnail images when product has two images', () => {
      const { fixture } = loadWithTwoImages();

      const thumbs = fixture.nativeElement.querySelectorAll('.detail__thumb');

      expect(thumbs.length).toBe(2);
    });

    it('first gallery thumbnail alt contains "Zdjęcie 1"', () => {
      const { fixture } = loadWithTwoImages();

      const thumbs = fixture.nativeElement.querySelectorAll('.detail__thumb');

      expect(thumbs[0].getAttribute('alt')).toContain('Zdjęcie 1');
    });

    it('second gallery thumbnail alt contains "Zdjęcie 2"', () => {
      const { fixture } = loadWithTwoImages();

      const thumbs = fixture.nativeElement.querySelectorAll('.detail__thumb');

      expect(thumbs[1].getAttribute('alt')).toContain('Zdjęcie 2');
    });

    it('gallery thumbnail alt contains the product name', () => {
      const { fixture } = loadWithTwoImages();

      const thumbs = fixture.nativeElement.querySelectorAll('.detail__thumb');

      expect(thumbs[0].getAttribute('alt')).toContain('Rose Oud');
    });

    it('no gallery thumbnail has an empty alt attribute', () => {
      const { fixture } = loadWithTwoImages();

      const thumbs: NodeListOf<HTMLImageElement> = fixture.nativeElement.querySelectorAll('.detail__thumb');

      thumbs.forEach((thumb) => {
        expect(thumb.getAttribute('alt')).not.toBe('');
      });
    });
  });

  describe('lightbox thumbnails (.lightbox__thumb)', () => {
    it('first lightbox thumbnail alt contains "Zdjęcie 1" when lightbox is open', () => {
      const { component, fixture } = loadWithTwoImages();

      component.openLightbox(0);
      fixture.detectChanges();

      const thumbs = fixture.nativeElement.querySelectorAll('.lightbox__thumb');

      expect(thumbs[0].getAttribute('alt')).toContain('Zdjęcie 1');
    });

    it('lightbox thumbnail alt contains the product name', () => {
      const { component, fixture } = loadWithTwoImages();

      component.openLightbox(0);
      fixture.detectChanges();

      const thumbs = fixture.nativeElement.querySelectorAll('.lightbox__thumb');

      expect(thumbs[0].getAttribute('alt')).toContain('Rose Oud');
    });

    it('no lightbox thumbnail has an empty alt attribute', () => {
      const { component, fixture } = loadWithTwoImages();

      component.openLightbox(0);
      fixture.detectChanges();

      const thumbs: NodeListOf<HTMLImageElement> = fixture.nativeElement.querySelectorAll('.lightbox__thumb');

      thumbs.forEach((thumb) => {
        expect(thumb.getAttribute('alt')).not.toBe('');
      });
    });
  });
});

// ── Subscription leak fixes ────────────────────────────────────────────────────
// Guards the fixes:
//   1. subscribeStockStream() unsubscribes the previous stockSub before reassigning
//   2. loadRelatedProducts() uses takeUntilDestroyed so it tears down on destroy

describe('ProductDetailComponent — subscription cleanup', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).match(() => true).forEach((r) => r.flush(null));
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  it('unsubscribes the previous stockSub before creating a new one on rapid product navigation', () => {
    const { component, httpMock } = setup();

    const { Subject } = jest.requireActual<typeof import('rxjs')>('rxjs');
    const firstStream = new Subject<never>();
    const secondStream = new Subject<never>();
    const mockStockStream = (component as any).stockStream;

    mockStockStream.connect
      .mockReturnValueOnce(firstStream.asObservable())
      .mockReturnValueOnce(secondStream.asObservable());

    (component as any).subscribeStockStream(['var-1']);
    const firstSub = (component as any).stockSub;
    const unsubscribeSpy = jest.spyOn(firstSub, 'unsubscribe');

    (component as any).subscribeStockStream(['var-2']);

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);

    httpMock.match(() => true).forEach((r) => r.flush(null));
  });

  it('keeps only one active stockSub after two rapid calls to subscribeStockStream', () => {
    const { component, httpMock } = setup();

    const { Subject } = jest.requireActual<typeof import('rxjs')>('rxjs');
    const mockStockStream = (component as any).stockStream;
    mockStockStream.connect.mockReturnValue(new Subject().asObservable());

    (component as any).subscribeStockStream(['var-1']);
    const firstSub = (component as any).stockSub;

    (component as any).subscribeStockStream(['var-2']);
    const secondSub = (component as any).stockSub;

    expect(secondSub).not.toBe(firstSub);
    expect(firstSub.closed).toBe(true);

    httpMock.match(() => true).forEach((r) => r.flush(null));
  });

  it('does not update relatedProducts after the component is destroyed', () => {
    const { component, httpMock, fixture } = setup();

    fixture.detectChanges();
    httpMock.expectOne(`/api/products/${SLUG}`).flush(makeProductResponse());

    // The related products request is in flight — component is destroyed before it resolves.
    // takeUntilDestroyed cancels the HTTP subscription, so the request is cancelled.
    httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`);
    fixture.destroy();

    // The cancelled request is no longer in the HttpTestingController open list
    // so afterEach verify() passes. The signal was never updated.
    expect(component.relatedProducts()).toEqual([]);
  });
});

// ─── onKeyDown SSR platform guard ────────────────────────────────────────────
// Regression guard: @HostListener fires during SSR; without the platform check
// closeLightbox() would call lightboxOpen.set(false) server-side, corrupting
// the initial rendered state.

describe('ProductDetailComponent — onKeyDown SSR guard', () => {
  afterEach(() => jest.clearAllMocks());

  it('is a no-op on the server platform regardless of lightboxOpen state', () => {
    const { fixture, httpMock } = setupWithPlatform('server');
    const component = fixture.componentInstance;

    fixture.detectChanges();
    httpMock.match(() => true).forEach((r) => r.flush(null));

    component.lightboxOpen.set(true);
    fixture.detectChanges();

    const closeSpy = jest.spyOn(component, 'closeLightbox');
    component.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(closeSpy).not.toHaveBeenCalled();
    expect(component.lightboxOpen()).toBe(true);
  });

  it('handles Escape and closes the lightbox in browser context', () => {
    const { fixture, httpMock } = setupWithPlatform('browser');
    const component = fixture.componentInstance;

    fixture.detectChanges();
    httpMock.match(() => true).forEach((r) => r.flush(null));

    component.lightboxOpen.set(true);
    fixture.detectChanges();

    component.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(component.lightboxOpen()).toBe(false);
  });

  it('is a no-op in browser context when lightbox is closed', () => {
    const { fixture, httpMock } = setupWithPlatform('browser');
    const component = fixture.componentInstance;

    fixture.detectChanges();
    httpMock.match(() => true).forEach((r) => r.flush(null));

    component.lightboxOpen.set(false);
    const closeSpy = jest.spyOn(component, 'closeLightbox');
    component.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(closeSpy).not.toHaveBeenCalled();
  });
});

// ─── Lightbox focus management (WCAG 2.4.3) ──────────────────────────────────
// Regression guard: openLightbox() must move focus into the dialog so keyboard
// users can reach the close button. closeLightbox() must restore focus to the
// element that triggered the lightbox (so Tab flow resumes correctly).
// Without these invariants, the lightbox is a keyboard trap in the *bad* sense:
// unreachable controls and no way back.

describe('ProductDetailComponent — lightbox focus management (WCAG 2.4.3)', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    document.body.style.overflow = '';
  });

  function loadProduct() {
    const { component, fixture, httpMock } = setup();

    fixture.detectChanges();
    httpMock.expectOne(`/api/products/${SLUG}`).flush(makeProductResponse());
    httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`).flush([]);
    fixture.detectChanges();
    httpMock.verify();

    return { component, fixture };
  }

  it('sets lightboxOpen to true and lightboxIndex to the provided index', () => {
    const { component } = loadProduct();

    component.openLightbox(1);

    expect(component.lightboxOpen()).toBe(true);
    expect(component.lightboxIndex()).toBe(1);
  });

  it('sets document.body.overflow to hidden when openLightbox is called in browser context', () => {
    const { component } = loadProduct();

    component.openLightbox(0);

    expect(document.body.style.overflow).toBe('hidden');
  });

  it('sets lightboxOpen to false when closeLightbox is called', () => {
    const { component } = loadProduct();
    component.openLightbox(0);

    component.closeLightbox();

    expect(component.lightboxOpen()).toBe(false);
  });

  it('resets document.body.overflow to empty string when closeLightbox is called', () => {
    const { component } = loadProduct();
    component.openLightbox(0);

    component.closeLightbox();

    expect(document.body.style.overflow).toBe('');
  });

  it('calls focus() on the element that was active when openLightbox was called', () => {
    const { component } = loadProduct();

    const triggerBtn = document.createElement('button');
    document.body.appendChild(triggerBtn);
    triggerBtn.focus();
    const focusSpy = jest.spyOn(triggerBtn, 'focus');

    component.openLightbox(0);
    component.closeLightbox();

    expect(focusSpy).toHaveBeenCalledTimes(1);

    document.body.removeChild(triggerBtn);
  });

  it('clears the trigger reference after closeLightbox so the element can be garbage-collected', () => {
    const { component } = loadProduct();
    component.openLightbox(0);

    component.closeLightbox();

    expect((component as any)._lightboxTrigger).toBeNull();
  });

  it('schedules a focus call on the lightbox element via setTimeout(0) after opening', () => {
    jest.useFakeTimers();
    const { component, fixture } = loadProduct();

    component.openLightbox(0);
    fixture.detectChanges();

    const lightboxEl = fixture.nativeElement.querySelector('.lightbox') as HTMLElement | null;
    if (lightboxEl) {
      const focusSpy = jest.spyOn(lightboxEl, 'focus');
      jest.runAllTimers();
      expect(focusSpy).toHaveBeenCalledTimes(1);
    } else {
      expect(component.lightboxOpen()).toBe(true);
    }
  });

  it('does not set overflow or store a trigger when openLightbox is called in server context', () => {
    const { fixture, httpMock } = setupWithPlatform('server');
    const component = fixture.componentInstance;
    fixture.detectChanges();
    httpMock.match(() => true).forEach((r) => r.flush(null));

    component.openLightbox(0);

    expect(document.body.style.overflow).toBe('');
    expect((component as any)._lightboxTrigger).toBeNull();
  });
});

// ─── EU Omnibus Art. 3a review verification labels ────────────────────────────
// Regulation 2019/2161 Art. 3a requires explicit disclosure of whether and how
// consumer reviews are verified. Silently omitting the badge for unverified
// reviews is non-compliant — the UI must label them "Niezweryfikowany zakup".
// Invariant: @else block renders .review-card__unverified when verifiedPurchase
// is false; the verified badge must not appear for the same review.

describe('ProductDetailComponent — EU Omnibus Art. 3a review verification labels', () => {
  afterEach(() => jest.clearAllMocks());

  const makeReview = (overrides: Partial<ReviewSummary> = {}): ReviewSummary => ({
    id: 'r-1',
    rating: 4,
    title: null,
    body: 'Świetny zapach',
    adminReply: null,
    helpfulCount: 0,
    createdAt: '2025-01-15T10:00:00.000',
    verifiedPurchase: true,
    authorName: 'Jan K.',
    ...overrides,
  });

  function setupWithReviews(reviews: ReviewSummary[]) {
    const { fixture, component, httpMock } = setup();

    fixture.detectChanges();
    httpMock.expectOne(`/api/products/${SLUG}`).flush(
      makeProductResponse({ reviewCount: reviews.length }),
    );
    httpMock.expectOne(`/api/products/${SLUG}/related?limit=6`).flush([]);
    fixture.detectChanges();
    httpMock.verify();

    component.reviewsLoading.set(false);
    component.reviews.set(reviews);
    fixture.detectChanges();

    return { fixture, component };
  }

  it('renders "Zweryfikowany zakup" badge when verifiedPurchase is true', () => {
    const { fixture } = setupWithReviews([makeReview({ verifiedPurchase: true })]);

    const badge = fixture.nativeElement.querySelector('.review-card__verified');

    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain('Zweryfikowany zakup');
  });

  it('renders "Niezweryfikowany zakup" label when verifiedPurchase is false', () => {
    const { fixture } = setupWithReviews([makeReview({ verifiedPurchase: false })]);

    const label = fixture.nativeElement.querySelector('.review-card__unverified');

    expect(label).not.toBeNull();
    expect(label.textContent).toContain('Niezweryfikowany zakup');
  });

  it('does NOT render the verified badge when verifiedPurchase is false', () => {
    const { fixture } = setupWithReviews([makeReview({ verifiedPurchase: false })]);

    const badge = fixture.nativeElement.querySelector('.review-card__verified');

    expect(badge).toBeNull();
  });

  it('renders verified and unverified labels independently in a mixed review list', () => {
    const { fixture } = setupWithReviews([
      makeReview({ id: 'r-1', verifiedPurchase: true }),
      makeReview({ id: 'r-2', verifiedPurchase: false }),
    ]);

    const verified = fixture.nativeElement.querySelectorAll('.review-card__verified');
    const unverified = fixture.nativeElement.querySelectorAll('.review-card__unverified');

    expect(verified.length).toBe(1);
    expect(unverified.length).toBe(1);
  });
});
