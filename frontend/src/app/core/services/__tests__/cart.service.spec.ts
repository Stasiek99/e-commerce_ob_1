import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { CartService } from '../cart.service';

function setup(platformId: 'browser' | 'server' = 'browser') {
  TestBed.configureTestingModule({
    providers: [
      CartService,
      { provide: PLATFORM_ID, useValue: platformId },
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });

  const service = TestBed.inject(CartService);
  const http = TestBed.inject(HttpTestingController);

  if (platformId === 'browser') {
    // Flush the loadCart() call made in the constructor
    http.expectOne((req) => req.url.includes('/cart')).flush({
      id: 'cart-1',
      items: [],
      itemCount: 0,
      totalInCents: 0,
    });
  }

  return { service, http };
}

const mockItems = [
  {
    id: 'ci-1',
    productVariantId: 'pv-1',
    quantity: 2,
    productName: 'Dior Sauvage',
    variantLabel: '100ml',
    priceInCents: 34900,
    imageUrl: null,
    slug: 'dior-sauvage',
    sku: 'DS-100',
    stock: 5,
  },
  {
    id: 'ci-2',
    productVariantId: 'pv-2',
    quantity: 1,
    productName: 'Chanel No 5',
    variantLabel: '50ml',
    priceInCents: 44900,
    imageUrl: null,
    slug: 'chanel-no-5',
    sku: 'CN5-50',
    stock: 3,
  },
];

describe('CartService', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  // ── clear() ─────────────────────────────────────────────────────────────────

  describe('clear()', () => {
    it('resets items signal to an empty array', () => {
      const { service } = setup();

      service.refreshFromServer({ id: 'cart-1', items: mockItems, itemCount: 3, totalInCents: 114700 });

      service.clear();

      expect(service.items()).toEqual([]);
    });

    it('resets cartId signal to null', () => {
      const { service } = setup();

      service.refreshFromServer({ id: 'cart-1', items: mockItems, itemCount: 3, totalInCents: 114700 });
      expect(service.cartId()).toBe('cart-1');

      service.clear();

      expect(service.cartId()).toBeNull();
    });

    it('reduces itemCount computed signal to 0', () => {
      const { service } = setup();

      service.refreshFromServer({ id: 'cart-1', items: mockItems, itemCount: 3, totalInCents: 114700 });
      expect(service.itemCount()).toBe(3);

      service.clear();

      expect(service.itemCount()).toBe(0);
    });

    it('reduces totalInCents computed signal to 0', () => {
      const { service } = setup();

      service.refreshFromServer({ id: 'cart-1', items: mockItems, itemCount: 3, totalInCents: 114700 });
      expect(service.totalInCents()).toBe(114700);

      service.clear();

      expect(service.totalInCents()).toBe(0);
    });

    it('is idempotent — calling clear() twice leaves cart empty', () => {
      const { service } = setup();

      service.refreshFromServer({ id: 'cart-1', items: mockItems, itemCount: 3, totalInCents: 114700 });

      service.clear();
      service.clear();

      expect(service.items()).toEqual([]);
      expect(service.cartId()).toBeNull();
    });

    it('clear() on an already-empty cart does not throw', () => {
      const { service } = setup();

      expect(() => service.clear()).not.toThrow();
      expect(service.items()).toEqual([]);
      expect(service.cartId()).toBeNull();
    });
  });

  // ── refreshFromServer() ─────────────────────────────────────────────────────

  describe('refreshFromServer()', () => {
    it('updates items and cartId signals from server response', () => {
      const { service } = setup();

      service.refreshFromServer({ id: 'cart-42', items: mockItems, itemCount: 3, totalInCents: 114700 });

      expect(service.cartId()).toBe('cart-42');
      expect(service.items()).toHaveLength(2);
    });
  });
});
