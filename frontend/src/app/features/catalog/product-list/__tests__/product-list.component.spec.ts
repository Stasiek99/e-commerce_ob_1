import {
  CUSTOM_ELEMENTS_SCHEMA,
  NO_ERRORS_SCHEMA,
  PLATFORM_ID,
} from "@angular/core";
import { fakeAsync, TestBed, tick } from "@angular/core/testing";
import { ActivatedRoute, Router } from "@angular/router";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouterMock = { navigate: jest.Mock };
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { provideHttpClient } from "@angular/common/http";
import { EMPTY, of } from "rxjs";
import { ParamMap } from "@angular/router";
import { ProductListComponent } from "../product-list.component";
import { SeoService } from "../../../../core/services/seo.service";

const makeParamMap = (params: Record<string, string | null>): ParamMap => ({
  has: (key: string) => key in params,
  get: (key: string) => params[key] ?? null,
  getAll: (key: string) => (params[key] ? [params[key] as string] : []),
  keys: Object.keys(params),
});

function setup() {
  const mockRoute = {
    paramMap: of(makeParamMap({})),
    queryParamMap: of(makeParamMap({})),
  };

  const mockRouter = { navigate: jest.fn() };
  const mockSeo = {
    setProductListMeta: jest.fn(),
    setCategoryMeta: jest.fn(),
    updateMeta: jest.fn(),
  };

  TestBed.configureTestingModule({
    imports: [ProductListComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: mockRoute },
      { provide: Router, useValue: mockRouter },
      { provide: SeoService, useValue: mockSeo },
      { provide: PLATFORM_ID, useValue: "browser" },
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  TestBed.overrideComponent(ProductListComponent, {
    set: { imports: [], schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA] },
  });

  const fixture = TestBed.createComponent(ProductListComponent);
  const component = fixture.componentInstance;
  const httpMock = TestBed.inject(HttpTestingController);

  return { fixture, component, httpMock };
}

// ── Omnibus ranking disclosure — EU 2019/2161 Art. 6a ─────────────────────────
// The 'relevance' / 'Polecane' sort option must expose an info icon with a
// one-sentence disclosure so UOKiK can verify the ranking criteria are disclosed.
// Invariant: SORT_OPTIONS includes a 'relevance' entry with the correct label,
// and the component's default sort is 'relevance' with label 'Polecane'.

describe("ProductListComponent — Omnibus ranking disclosure", () => {
  afterEach(() => jest.clearAllMocks());

  it('exposes a sort option with value "relevance" and label "Polecane"', () => {
    const { component } = setup();

    const relevanceOption = component.sortOptions.find(
      (o) => o.value === "relevance",
    );

    expect(relevanceOption).toBeDefined();
    expect(relevanceOption!.label).toBe("Polecane");
  });

  it('defaults sortBy to "relevance" so the disclosure tooltip is visible on first load', () => {
    const { fixture, component } = setup();

    fixture.detectChanges();

    expect(component.sortBy()).toBe("relevance");
  });

  it('sortLabel returns "Polecane" by default — matches the disclosed sort option', () => {
    const { fixture, component } = setup();

    fixture.detectChanges();

    expect(component.sortLabel()).toBe("Polecane");
  });

  it("SORT_OPTIONS has exactly 3 entries — relevance, price_asc, price_desc", () => {
    const { component } = setup();

    expect(component.sortOptions).toHaveLength(3);
    expect(component.sortOptions.map((o) => o.value)).toEqual([
      "relevance",
      "price_asc",
      "price_desc",
    ]);
  });

  it('sortLabel returns "Cena: rosnąco" when sortBy is price_asc', () => {
    const { fixture, component } = setup();

    fixture.detectChanges();
    component.sortBy.set("price_asc");

    expect(component.sortLabel()).toBe("Cena: rosnąco");
  });

  it('sortLabel returns "Cena: malejąco" when sortBy is price_desc', () => {
    const { fixture, component } = setup();

    fixture.detectChanges();
    component.sortBy.set("price_desc");

    expect(component.sortLabel()).toBe("Cena: malejąco");
  });

  it('sortLabel returns "Polecane" when sortBy is reset to relevance', () => {
    const { fixture, component } = setup();

    fixture.detectChanges();
    component.sortBy.set("price_asc");
    component.sortBy.set("relevance");

    expect(component.sortLabel()).toBe("Polecane");
  });
});

// ── In-stock filter — WCAG 2.4.6 label association ────────────────────────────
// The in-stock checkbox is wrapped in <label class="filter-instock"> so that
// clicking the visible text "Pokaż tylko dostępne" also activates the input.
// Invariant: stagedInStock defaults to false; openDrawer syncs appliedInStock
// into stagedInStock; applyFilters encodes the staged value in the URL.

describe("ProductListComponent — in-stock filter", () => {
  afterEach(() => jest.clearAllMocks());

  it("stagedInStock defaults to false — checkbox is unchecked when drawer first opens", () => {
    const { component } = setup();

    expect(component.stagedInStock()).toBe(false);
  });

  it("openDrawer syncs appliedInStock=true into stagedInStock", () => {
    const { component } = setup();

    component.appliedInStock.set(true);
    component.openDrawer();

    expect(component.stagedInStock()).toBe(true);
    expect(component.drawerOpen()).toBe(true);
  });

  it("openDrawer syncs appliedInStock=false into stagedInStock", () => {
    const { component } = setup();

    component.appliedInStock.set(false);
    component.openDrawer();

    expect(component.stagedInStock()).toBe(false);
    expect(component.drawerOpen()).toBe(true);
  });

  it("closeDrawer sets drawerOpen to false and preserves the staged value", () => {
    const { component } = setup();

    component.drawerOpen.set(true);
    component.stagedInStock.set(true);
    component.closeDrawer();

    expect(component.drawerOpen()).toBe(false);
    expect(component.stagedInStock()).toBe(true);
  });

  it('applyFilters navigates with inStock="true" when stagedInStock is true', () => {
    const { component } = setup();
    const router = TestBed.inject(Router) as unknown as RouterMock;

    component.stagedInStock.set(true);
    component.applyFilters();

    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ inStock: "true" }),
      }),
    );
  });

  it("applyFilters navigates with inStock=null when stagedInStock is false — clears the filter", () => {
    const { component } = setup();
    const router = TestBed.inject(Router) as unknown as RouterMock;

    component.stagedInStock.set(false);
    component.applyFilters();

    expect(router.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ inStock: null }),
      }),
    );
  });
});

// ── Canonical URL fix — /category/:slug must not point to /products/:slug ──────
// FIX: updateSeo() previously built the canonical as `/products/${slug}` for all
// routes. The /products/:slug path does not exist — categories live at
// /category/:slug. Google sees two URLs both claiming the other as canonical and
// may decline to index either. The fix emits `/category/${slug}` for slug routes.

describe("ProductListComponent — canonical URL (updateSeo)", () => {
  function setupForCanonical(slug: string | null) {
    const mockRoute = {
      paramMap: of(makeParamMap(slug ? { slug } : {})),
      queryParamMap: of(makeParamMap({})),
    };
    const mockRouter = { navigate: jest.fn() };
    const mockSeo = { updatePageMeta: jest.fn(), setRobotsTag: jest.fn() };

    TestBed.configureTestingModule({
      imports: [ProductListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: mockRoute },
        { provide: Router, useValue: mockRouter },
        { provide: SeoService, useValue: mockSeo },
        { provide: PLATFORM_ID, useValue: "browser" },
      ],
      schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
    });

    TestBed.overrideComponent(ProductListComponent, {
      set: { imports: [], schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA] },
    });

    const fixture = TestBed.createComponent(ProductListComponent);
    const httpMock = TestBed.inject(HttpTestingController);

    return { fixture, httpMock, mockSeo };
  }

  afterEach(() => jest.clearAllMocks());

  it('calls updatePageMeta with path=/category/perfume when slug is "perfume"', fakeAsync(() => {
    const { fixture, httpMock, mockSeo } = setupForCanonical("perfume");

    fixture.detectChanges();
    tick(0);

    expect(mockSeo.updatePageMeta).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/category/perfume" }),
    );

    httpMock
      .expectOne((req) => req.url.includes("/products/facets"))
      .flush({ scentFamilies: [], genders: [] });
    httpMock
      .expectOne(
        (req) =>
          req.url.includes("/api/products") && !req.url.includes("/facets"),
      )
      .flush({ data: [], meta: { totalPages: 1 } });
    httpMock.verify();
  }));

  it("does not emit canonical pointing at the non-existent /products/perfume path", fakeAsync(() => {
    const { fixture, httpMock, mockSeo } = setupForCanonical("perfume");

    fixture.detectChanges();
    tick(0);

    const calledPath: string = mockSeo.updatePageMeta.mock.calls[0][0].path;
    expect(calledPath).not.toContain("/products/");

    httpMock
      .expectOne((req) => req.url.includes("/products/facets"))
      .flush({ scentFamilies: [], genders: [] });
    httpMock
      .expectOne(
        (req) =>
          req.url.includes("/api/products") && !req.url.includes("/facets"),
      )
      .flush({ data: [], meta: { totalPages: 1 } });
    httpMock.verify();
  }));

  it('calls updatePageMeta with path=/category/diffusers when slug is "diffusers"', fakeAsync(() => {
    const { fixture, httpMock, mockSeo } = setupForCanonical("diffusers");

    fixture.detectChanges();
    tick(0);

    expect(mockSeo.updatePageMeta).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/category/diffusers" }),
    );

    httpMock
      .expectOne((req) => req.url.includes("/products/facets"))
      .flush({ scentFamilies: [], genders: [] });
    httpMock
      .expectOne(
        (req) =>
          req.url.includes("/api/products") && !req.url.includes("/facets"),
      )
      .flush({ data: [], meta: { totalPages: 1 } });
    httpMock.verify();
  }));

  it("calls updatePageMeta with path=/products when no slug is present (all-products view)", fakeAsync(() => {
    const { fixture, httpMock, mockSeo } = setupForCanonical(null);

    fixture.detectChanges();
    tick(0);

    expect(mockSeo.updatePageMeta).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/products" }),
    );

    httpMock
      .expectOne(
        (req) =>
          req.url.includes("/api/products") && !req.url.includes("/facets"),
      )
      .flush({ data: [], meta: { totalPages: 1 } });
    httpMock.verify();
  }));
});

// ── hasFilters includes sort — non-default sort triggers noindex ──────────────
// FIX: sort !== 'relevance' was missing from hasFilters. /products?sort=price_asc
// was indexable as a separate page despite having the same canonical as /products.
// The fix treats any non-default sort value as a filtering condition.

describe("ProductListComponent — hasFilters includes sort", () => {
  function setupWithQueryParams(params: Record<string, string | null>) {
    const mockRoute = {
      paramMap: of(makeParamMap({})),
      queryParamMap: of(makeParamMap(params)),
    };
    const mockRouter = { navigate: jest.fn() };
    const mockSeo = { updatePageMeta: jest.fn(), setRobotsTag: jest.fn() };

    TestBed.configureTestingModule({
      imports: [ProductListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: mockRoute },
        { provide: Router, useValue: mockRouter },
        { provide: SeoService, useValue: mockSeo },
        { provide: PLATFORM_ID, useValue: "browser" },
      ],
      schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
    });

    TestBed.overrideComponent(ProductListComponent, {
      set: { imports: [], schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA] },
    });

    const fixture = TestBed.createComponent(ProductListComponent);
    const httpMock = TestBed.inject(HttpTestingController);

    return { fixture, httpMock, mockSeo };
  }

  afterEach(() => jest.clearAllMocks());

  it("calls setRobotsTag noindex,follow when sort=price_asc", fakeAsync(() => {
    const { fixture, httpMock, mockSeo } = setupWithQueryParams({
      sort: "price_asc",
    });

    fixture.detectChanges();
    tick(0);

    expect(mockSeo.setRobotsTag).toHaveBeenCalledWith("noindex,follow");

    httpMock
      .expectOne(
        (req) =>
          req.url.includes("/api/products") && !req.url.includes("/facets"),
      )
      .flush({ data: [], meta: { totalPages: 1 } });
    httpMock.verify();
  }));

  it("calls setRobotsTag noindex,follow when sort=price_desc", fakeAsync(() => {
    const { fixture, httpMock, mockSeo } = setupWithQueryParams({
      sort: "price_desc",
    });

    fixture.detectChanges();
    tick(0);

    expect(mockSeo.setRobotsTag).toHaveBeenCalledWith("noindex,follow");

    httpMock
      .expectOne(
        (req) =>
          req.url.includes("/api/products") && !req.url.includes("/facets"),
      )
      .flush({ data: [], meta: { totalPages: 1 } });
    httpMock.verify();
  }));

  it("does not call setRobotsTag when sort=relevance with no other filters", fakeAsync(() => {
    const { fixture, httpMock, mockSeo } = setupWithQueryParams({
      sort: "relevance",
    });

    fixture.detectChanges();
    tick(0);

    expect(mockSeo.setRobotsTag).not.toHaveBeenCalled();

    httpMock
      .expectOne(
        (req) =>
          req.url.includes("/api/products") && !req.url.includes("/facets"),
      )
      .flush({ data: [], meta: { totalPages: 1 } });
    httpMock.verify();
  }));

  it("does not call setRobotsTag when no sort param is present (defaults to relevance)", fakeAsync(() => {
    const { fixture, httpMock, mockSeo } = setupWithQueryParams({});

    fixture.detectChanges();
    tick(0);

    expect(mockSeo.setRobotsTag).not.toHaveBeenCalled();

    httpMock
      .expectOne(
        (req) =>
          req.url.includes("/api/products") && !req.url.includes("/facets"),
      )
      .flush({ data: [], meta: { totalPages: 1 } });
    httpMock.verify();
  }));
});

// ── loadFacets subscription lifecycle ─────────────────────────────────────────
// Invariant: takeUntilDestroyed must cancel the in-flight facets HTTP request
// when the component is destroyed, so facets.set(res) never executes on a dead
// component instance.

describe("ProductListComponent — loadFacets subscription lifecycle", () => {
  const PERFUME_FACETS = { scentFamilies: ["woody"], genders: ["unisex"] };

  function setupWithSlug(slug: string | null) {
    const mockRoute = {
      paramMap: of(makeParamMap(slug ? { slug } : {})),
      queryParamMap: of(makeParamMap({})),
    };
    const mockRouter = { navigate: jest.fn() };
    const mockSeo = { updatePageMeta: jest.fn(), setRobotsTag: jest.fn() };

    TestBed.configureTestingModule({
      imports: [ProductListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: mockRoute },
        { provide: Router, useValue: mockRouter },
        { provide: SeoService, useValue: mockSeo },
        { provide: PLATFORM_ID, useValue: "browser" },
      ],
      schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
    });

    TestBed.overrideComponent(ProductListComponent, {
      set: { imports: [], schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA] },
    });

    const fixture = TestBed.createComponent(ProductListComponent);
    const component = fixture.componentInstance;
    const httpMock = TestBed.inject(HttpTestingController);

    return { fixture, component, httpMock };
  }

  afterEach(() => jest.clearAllMocks());

  it("sets facets to null and makes no HTTP request when slug is null", fakeAsync(() => {
    const { fixture, component, httpMock } = setupWithSlug(null);

    fixture.detectChanges();
    tick(0); // advance past debounceTime(0) in ngOnInit

    httpMock.expectNone((req) => req.url.includes("/products/facets"));
    expect(component.facets()).toBeNull();

    httpMock
      .expectOne((req) => req.url.includes("/api/products"))
      .flush({ data: [], meta: { totalPages: 1 } });
    httpMock.verify();
  }));

  it("updates the facets signal with the HTTP response when the component is alive", fakeAsync(() => {
    const { fixture, component, httpMock } = setupWithSlug("perfume");

    fixture.detectChanges();
    tick(0); // advance past debounceTime(0) in ngOnInit

    httpMock
      .expectOne((req) => req.url.includes("/products/facets"))
      .flush(PERFUME_FACETS);

    expect(component.facets()).toEqual(PERFUME_FACETS);

    httpMock
      .expectOne(
        (req) =>
          req.url.includes("/api/products") && !req.url.includes("/facets"),
      )
      .flush({ data: [], meta: { totalPages: 1 } });
    httpMock.verify();
  }));

  it("cancels the in-flight facets HTTP request when the component is destroyed mid-flight", fakeAsync(() => {
    const { fixture, component, httpMock } = setupWithSlug("perfume");

    fixture.detectChanges();
    tick(0); // advance past debounceTime(0) in ngOnInit

    const facetsReq = httpMock.expectOne((req) =>
      req.url.includes("/products/facets"),
    );
    expect(facetsReq.cancelled).toBe(false); // request is pending before destruction

    // Destroy triggers DestroyRef → takeUntilDestroyed unsubscribes the facets observable
    fixture.destroy();

    // Angular HttpClient must have cancelled the in-flight request
    expect(facetsReq.cancelled).toBe(true);
    // facets signal must remain null — facets.set(res) was never called
    expect(component.facets()).toBeNull();
  }));
});
