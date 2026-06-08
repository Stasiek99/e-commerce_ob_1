import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { EMPTY, of } from 'rxjs';
import { ParamMap } from '@angular/router';
import { ProductListComponent } from '../product-list.component';
import { SeoService } from '../../../../core/services/seo.service';

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
  const mockSeo = { setProductListMeta: jest.fn(), setCategoryMeta: jest.fn(), updateMeta: jest.fn() };

  TestBed.configureTestingModule({
    imports: [ProductListComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: mockRoute },
      { provide: Router, useValue: mockRouter },
      { provide: SeoService, useValue: mockSeo },
      { provide: PLATFORM_ID, useValue: 'browser' },
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

describe('ProductListComponent — Omnibus ranking disclosure', () => {
  afterEach(() => jest.clearAllMocks());

  it('exposes a sort option with value "relevance" and label "Polecane"', () => {
    const { component } = setup();

    const relevanceOption = component.sortOptions.find(o => o.value === 'relevance');

    expect(relevanceOption).toBeDefined();
    expect(relevanceOption!.label).toBe('Polecane');
  });

  it('defaults sortBy to "relevance" so the disclosure tooltip is visible on first load', () => {
    const { fixture, component } = setup();

    fixture.detectChanges();

    expect(component.sortBy()).toBe('relevance');
  });

  it('sortLabel returns "Polecane" by default — matches the disclosed sort option', () => {
    const { fixture, component } = setup();

    fixture.detectChanges();

    expect(component.sortLabel()).toBe('Polecane');
  });

  it('SORT_OPTIONS has exactly 3 entries — relevance, price_asc, price_desc', () => {
    const { component } = setup();

    expect(component.sortOptions).toHaveLength(3);
    expect(component.sortOptions.map(o => o.value)).toEqual([
      'relevance',
      'price_asc',
      'price_desc',
    ]);
  });

  it('sortLabel returns "Cena: rosnąco" when sortBy is price_asc', () => {
    const { fixture, component } = setup();

    fixture.detectChanges();
    component.sortBy.set('price_asc');

    expect(component.sortLabel()).toBe('Cena: rosnąco');
  });

  it('sortLabel returns "Cena: malejąco" when sortBy is price_desc', () => {
    const { fixture, component } = setup();

    fixture.detectChanges();
    component.sortBy.set('price_desc');

    expect(component.sortLabel()).toBe('Cena: malejąco');
  });

  it('sortLabel returns "Polecane" when sortBy is reset to relevance', () => {
    const { fixture, component } = setup();

    fixture.detectChanges();
    component.sortBy.set('price_asc');
    component.sortBy.set('relevance');

    expect(component.sortLabel()).toBe('Polecane');
  });
});
