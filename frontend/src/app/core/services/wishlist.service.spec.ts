import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { WishlistService, WishlistItemData } from './wishlist.service';
import { AuthService } from './auth.service';
import { LOCAL_STORAGE } from '../tokens/storage.tokens';

const STORAGE_KEY = 'wishlist_v1';

const MOCK_ITEM: WishlistItemData = {
  id: 'product-1',
  name: 'Rose Oud 50ml',
  slug: 'rose-oud',
  notifyOnRestock: false,
};

function createMockStorage(initial: Record<string, string> = {}): Storage & jest.Mocked<Storage> {
  const store: Record<string, string> = { ...initial };
  return {
    getItem:    jest.fn((k: string)         => store[k] ?? null),
    setItem:    jest.fn((k: string, v: string) => { store[k] = String(v); }),
    removeItem: jest.fn((k: string)         => { delete store[k]; }),
    clear:      jest.fn(()                  => Object.keys(store).forEach(k => delete store[k])),
    key:        jest.fn((i: number)         => Object.keys(store)[i] ?? null),
    get length() { return Object.keys(store).length; },
  } as Storage & jest.Mocked<Storage>;
}

describe('WishlistService', () => {
  let service: WishlistService;
  let mockStorage: ReturnType<typeof createMockStorage>;

  function setup(
    platform: 'browser' | 'server' = 'browser',
    storageInitial: Record<string, string> = {},
  ): WishlistService {
    mockStorage = createMockStorage(storageInitial);

    TestBed.configureTestingModule({
      providers: [
        WishlistService,
        { provide: PLATFORM_ID, useValue: platform },
        { provide: LOCAL_STORAGE, useValue: mockStorage },
        { provide: AuthService, useValue: { isAuthenticated: jest.fn().mockReturnValue(false) } },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(WishlistService);
    return service;
  }

  afterEach(() => TestBed.resetTestingModule());

  // ── SSR / server platform ─────────────────────────────────────────────────
  // Guards the fix: loadFromStorage() must never access the injected storage on
  // the server so a shared global cannot leak cross-request wishlist state.

  describe('server platform (SSR)', () => {
    it('items signal starts empty even when injected storage contains wishlist data', () => {
      setup('server', { [STORAGE_KEY]: JSON.stringify([MOCK_ITEM]) });

      expect(service.items()).toEqual([]);
    });

    it('never calls storage.getItem during service initialization', () => {
      setup('server', { [STORAGE_KEY]: JSON.stringify([MOCK_ITEM]) });

      expect(mockStorage.getItem).not.toHaveBeenCalled();
    });

    it('does not call storage.setItem when toggle() adds an item in guest mode', () => {
      setup('server');

      service.toggle(MOCK_ITEM);

      expect(mockStorage.setItem).not.toHaveBeenCalled();
    });

    it('does not call storage.setItem when toggle() removes an item in guest mode', () => {
      setup('server');
      service.toggle(MOCK_ITEM); // add
      jest.clearAllMocks();      // clear the first toggle call

      service.toggle(MOCK_ITEM); // remove

      expect(mockStorage.setItem).not.toHaveBeenCalled();
    });
  });

  // ── Browser platform — DI token, not globalThis ───────────────────────────
  // Guards the fix: the service must read from the injected LOCAL_STORAGE token.
  // In jsdom, globalThis.localStorage exists but is empty. If the service falls
  // back to it, items() would be [] regardless of what the token provides.

  describe('browser platform', () => {
    it('loads items from the injected LOCAL_STORAGE token on initialization', () => {
      setup('browser', { [STORAGE_KEY]: JSON.stringify([MOCK_ITEM]) });

      expect(service.items()).toEqual([MOCK_ITEM]);
    });

    it('does NOT fall back to globalThis.localStorage — uses the injected token', () => {
      // globalThis.localStorage (jsdom) is empty; injected token has data.
      // A revert to globalThis would yield [] — this assertion proves the token is used.
      setup('browser', { [STORAGE_KEY]: JSON.stringify([MOCK_ITEM]) });

      expect(service.items().length).toBe(1);
    });

    it('writes to the injected token when toggle() adds an item in guest mode', () => {
      setup('browser');

      service.toggle(MOCK_ITEM);

      expect(mockStorage.setItem).toHaveBeenCalledWith(
        STORAGE_KEY,
        expect.stringContaining('"id":"product-1"'),
      );
    });

    it('writes empty array to the injected token when toggle() removes the last item', () => {
      setup('browser', { [STORAGE_KEY]: JSON.stringify([MOCK_ITEM]) });

      service.toggle(MOCK_ITEM); // item is already in list — this removes it

      expect(mockStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, '[]');
    });

    it('returns empty array when storage contains malformed JSON', () => {
      setup('browser', { [STORAGE_KEY]: 'not-valid-json{{{' });

      expect(service.items()).toEqual([]);
    });

    it('returns empty array when storage has no wishlist entry', () => {
      setup('browser', {});

      expect(service.items()).toEqual([]);
    });

    it('defaults notifyOnRestock to false for items stored without that field', () => {
      const legacy = [{ id: 'p-1', name: 'Perfume', slug: 'perfume' }];
      setup('browser', { [STORAGE_KEY]: JSON.stringify(legacy) });

      expect(service.items()[0].notifyOnRestock).toBe(false);
    });
  });

  // ── Storage isolation — per-request token independence ────────────────────
  // Before the fix, both instances shared globalThis.localStorage (or the
  // global singleton from main.server.ts), causing cross-request PII leakage.

  describe('storage isolation between instances', () => {
    it('a second instance with a separate storage mock does not see data from the first', () => {
      setup('browser');
      service.toggle(MOCK_ITEM); // writes product-1 into mockStorage A
      TestBed.resetTestingModule();

      // Fresh module backed by a completely independent storage mock
      const storageB = createMockStorage({});
      TestBed.configureTestingModule({
        providers: [
          WishlistService,
          { provide: PLATFORM_ID, useValue: 'browser' },
          { provide: LOCAL_STORAGE, useValue: storageB },
          { provide: AuthService, useValue: { isAuthenticated: jest.fn().mockReturnValue(false) } },
          provideHttpClient(),
          provideHttpClientTesting(),
        ],
      });
      const serviceB = TestBed.inject(WishlistService);

      expect(serviceB.items()).toEqual([]);
    });
  });

  // ── Guest wishlist revalidation against backend isActive filter ──────────
  // Guards the fix: a frozen localStorage snapshot must never be trusted as
  // ground truth for purchasability — each guest item is re-fetched by slug
  // from the public products endpoint, which 404s for inactive products.

  describe('guest wishlist revalidation', () => {
    let httpMock: HttpTestingController;

    afterEach(() => httpMock.verify());

    it('replaces the stale snapshot with fresh data from the products endpoint', () => {
      setup('browser', { [STORAGE_KEY]: JSON.stringify([MOCK_ITEM]) });
      httpMock = TestBed.inject(HttpTestingController);
      TestBed.tick();

      const freshProduct = {
        id: 'product-1',
        name: 'Rose Oud 50ml (Updated)',
        slug: 'rose-oud',
        brand: 'Aromaterie',
        gender: 'unisex',
        catalogNumber: 'RO-50',
        images: [{ url: 'https://cdn.example.com/rose-oud.jpg' }],
        variants: [{ id: 'v-1', label: '50ml', priceInCents: 19900, stock: 3 }],
        description: 'internal-only field that must not leak into the wishlist cache',
      };
      httpMock.expectOne('/api/products/rose-oud').flush(freshProduct);

      expect(service.items()).toEqual([
        {
          id: 'product-1',
          name: 'Rose Oud 50ml (Updated)',
          slug: 'rose-oud',
          brand: 'Aromaterie',
          gender: 'unisex',
          catalogNumber: 'RO-50',
          images: [{ url: 'https://cdn.example.com/rose-oud.jpg' }],
          variants: [{ id: 'v-1', label: '50ml', priceInCents: 19900, stock: 3 }],
          notifyOnRestock: false,
        },
      ]);
    });

    it('drops an item whose product has been deactivated (404 from backend)', () => {
      setup('browser', { [STORAGE_KEY]: JSON.stringify([MOCK_ITEM]) });
      httpMock = TestBed.inject(HttpTestingController);
      TestBed.tick();

      httpMock.expectOne('/api/products/rose-oud').flush(null, {
        status: 404,
        statusText: 'Not Found',
      });

      expect(service.items()).toEqual([]);
    });

    it('persists the revalidated items back to the injected storage token', () => {
      setup('browser', { [STORAGE_KEY]: JSON.stringify([MOCK_ITEM]) });
      httpMock = TestBed.inject(HttpTestingController);
      TestBed.tick();

      httpMock.expectOne('/api/products/rose-oud').flush(null, {
        status: 404,
        statusText: 'Not Found',
      });

      expect(mockStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, '[]');
    });

    it('revalidates every guest item independently — one 404 does not drop the others', () => {
      const second: WishlistItemData = {
        id: 'product-2',
        name: 'Amber Oud',
        slug: 'amber-oud',
        notifyOnRestock: false,
      };
      setup('browser', { [STORAGE_KEY]: JSON.stringify([MOCK_ITEM, second]) });
      httpMock = TestBed.inject(HttpTestingController);
      TestBed.tick();

      httpMock.expectOne('/api/products/rose-oud').flush(null, { status: 404, statusText: 'Not Found' });
      httpMock.expectOne('/api/products/amber-oud').flush({
        id: 'product-2',
        name: 'Amber Oud',
        slug: 'amber-oud',
      });

      expect(service.items()).toEqual([
        { id: 'product-2', name: 'Amber Oud', slug: 'amber-oud', notifyOnRestock: false },
      ]);
    });

    it('makes no HTTP request when the guest wishlist is empty', () => {
      setup('browser', {});
      httpMock = TestBed.inject(HttpTestingController);
      TestBed.tick();

      httpMock.expectNone('/api/products/rose-oud');
    });

    it('makes no HTTP request on the server platform (SSR)', () => {
      setup('server', { [STORAGE_KEY]: JSON.stringify([MOCK_ITEM]) });
      httpMock = TestBed.inject(HttpTestingController);
      TestBed.tick();

      httpMock.expectNone('/api/products/rose-oud');
    });
  });
});
