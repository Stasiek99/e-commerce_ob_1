import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterLink, provideRouter } from '@angular/router';
import { DatePipe, LowerCasePipe, Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { OrderListComponent } from '../order-list.component';
import { PricePipe } from '../../../../shared/pipes/price.pipe';

const API = '/api';

const makeOrdersResponse = (count = 2) => ({
  data: Array.from({ length: count }, (_, i) => ({
    id: `order-${i}`,
    orderNumber: `ORD-2026-00000${i + 1}`,
    status: 'PAID',
    totalInCents: 9900,
    createdAt: '2026-05-01T10:00:00Z',
  })),
  meta: { totalPages: 1 },
});

function setup() {
  TestBed.configureTestingModule({
    imports: [OrderListComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: Location, useValue: { back: jest.fn() } },
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  TestBed.overrideComponent(OrderListComponent, {
    set: { imports: [RouterLink, DatePipe, LowerCasePipe, PricePipe], schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA] },
  });

  const fixture = TestBed.createComponent(OrderListComponent);
  const component = fixture.componentInstance;
  const httpMock = TestBed.inject(HttpTestingController);

  return { component, fixture, httpMock };
}

describe('OrderListComponent — skeleton loading', () => {
  afterEach(() => jest.clearAllMocks());

  // ─── loading signal lifecycle ─────────────────────────────────────────────

  describe('loading signal', () => {
    it('is false before ngOnInit fires', () => {
      const { component } = setup();
      expect(component.loading()).toBe(false);
    });

    it('is true once ngOnInit fires (HTTP request is pending)', () => {
      const { component, fixture } = setup();

      fixture.detectChanges();

      expect(component.loading()).toBe(true);
    });

    it('is false after a successful HTTP response', () => {
      const { component, fixture, httpMock } = setup();

      fixture.detectChanges();

      httpMock
        .expectOne((req) => req.url.includes('/orders'))
        .flush(makeOrdersResponse());

      expect(component.loading()).toBe(false);
      httpMock.verify();
    });

    it('is false after an HTTP error', () => {
      const { component, fixture, httpMock } = setup();

      fixture.detectChanges();

      httpMock
        .expectOne((req) => req.url.includes('/orders'))
        .flush('Server error', { status: 500, statusText: 'Internal Server Error' });

      expect(component.loading()).toBe(false);
      httpMock.verify();
    });
  });

  // ─── template — skeleton rows ─────────────────────────────────────────────

  describe('template rendering', () => {
    it('renders skeleton rows while loading', () => {
      const { fixture } = setup();

      fixture.detectChanges(); // loading = true, HTTP pending
      fixture.detectChanges(); // let Angular update the view

      const skeletonCells = fixture.nativeElement.querySelectorAll('.order-cell [tuiSkeleton]');
      expect(skeletonCells.length).toBeGreaterThan(0);
    });

    it('hides skeleton rows after data loads', () => {
      const { fixture, httpMock } = setup();

      fixture.detectChanges();

      httpMock
        .expectOne((req) => req.url.includes('/orders'))
        .flush(makeOrdersResponse(2));
      fixture.detectChanges();
      httpMock.verify();

      // Orders list now has real data, no skeleton attribute on title cells
      const skeletonCells = fixture.nativeElement.querySelectorAll('[tuiSkeleton]');
      expect(skeletonCells.length).toBe(0);
    });

    it('renders one order cell per order after loading', () => {
      const { fixture, httpMock } = setup();

      fixture.detectChanges();

      httpMock
        .expectOne((req) => req.url.includes('/orders'))
        .flush(makeOrdersResponse(3));
      fixture.detectChanges();
      httpMock.verify();

      const cells = fixture.nativeElement.querySelectorAll('.order-cell');
      expect(cells.length).toBe(3);
    });

    it('renders empty state paragraph when orders list is empty', () => {
      const { fixture, httpMock } = setup();

      fixture.detectChanges();

      httpMock
        .expectOne((req) => req.url.includes('/orders'))
        .flush(makeOrdersResponse(0));
      fixture.detectChanges();
      httpMock.verify();

      const empty = fixture.nativeElement.querySelector('.empty');
      expect(empty).not.toBeNull();
    });
  });
});
