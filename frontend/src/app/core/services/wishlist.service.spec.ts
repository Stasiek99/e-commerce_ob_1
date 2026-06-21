import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, signal } from '@angular/core';
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

  // Auth starts true so the constructor's effect calls syncFromBackend() directly on the
  // very first run, with `items` as the guest ids to merge — skips guest revalidation
  // entirely, which is irrelevant to the merge-batching/failure tests below.
  function setupAuthenticated(items: WishlistItemData[]): WishlistService {
    mockStorage = createMockStorage({ [STORAGE_KEY]: JSON.stringify(items) });

    TestBed.configureTestingModule({
      providers: [
        WishlistService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: LOCAL_STORAGE, useValue: mockStorage },
        { provide: AuthService, useValue: { isAuthenticated: signal(true) } },
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

  // ── Revalidation overwrite races ──────────────────────────────────────────
  // Guards the fix: revalidateGuestItems()'s completion callback must not blindly
  // replace `_items` once the in-flight forkJoin resolves, since auth state or a
  // user toggle() can have changed `_items` underneath it in the meantime.

  describe('revalidation overwrite races', () => {
    let httpMock: HttpTestingController;

    afterEach(() => httpMock.verify());

    it('does not overwrite the authenticated wishlist when guest revalidation resolves after login', () => {
      const authState = signal(false);
      mockStorage = createMockStorage({ [STORAGE_KEY]: JSON.stringify([MOCK_ITEM]) });

      TestBed.configureTestingModule({
        providers: [
          WishlistService,
          { provide: PLATFORM_ID, useValue: 'browser' },
          { provide: LOCAL_STORAGE, useValue: mockStorage },
          { provide: AuthService, useValue: { isAuthenticated: authState } },
          provideHttpClient(),
          provideHttpClientTesting(),
        ],
      });
      service = TestBed.inject(WishlistService);
      httpMock = TestBed.inject(HttpTestingController);
      TestBed.tick();

      // Guest revalidation request is now in flight — do not resolve it yet.
      const revalidateReq = httpMock.expectOne('/api/products/rose-oud');

      // User logs in while that request is still pending.
      authState.set(true);
      TestBed.tick();

      const backendItems: WishlistItemData[] = [
        { id: 'backend-item', name: 'Backend Item', slug: 'backend-item', notifyOnRestock: true },
      ];
      httpMock.expectOne('/api/wishlist/merge').flush({});
      httpMock.expectOne('/api/wishlist').flush(backendItems);

      expect(service.items()).toEqual(backendItems);

      // The slow guest revalidation resolves after login finished syncing — it must
      // not clobber the now-authenticated state.
      revalidateReq.flush({ id: 'product-1', name: 'Rose Oud 50ml', slug: 'rose-oud' });

      expect(service.items()).toEqual(backendItems);
      expect(mockStorage.setItem).not.toHaveBeenCalled();
    });

    it('preserves an item added by toggle() while guest revalidation is still in flight', () => {
      setup('browser', { [STORAGE_KEY]: JSON.stringify([MOCK_ITEM]) });
      httpMock = TestBed.inject(HttpTestingController);
      TestBed.tick();

      const revalidateReq = httpMock.expectOne('/api/products/rose-oud');

      const newItem: WishlistItemData = {
        id: 'product-2',
        name: 'Amber Oud',
        slug: 'amber-oud',
        notifyOnRestock: false,
      };
      service.toggle(newItem);

      revalidateReq.flush({ id: 'product-1', name: 'Rose Oud 50ml (Updated)', slug: 'rose-oud' });

      expect(service.items()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'product-2' }),
          expect.objectContaining({ id: 'product-1', name: 'Rose Oud 50ml (Updated)' }),
        ]),
      );
      expect(service.items().length).toBe(2);
    });

    it('does not resurrect an item removed by toggle() while its revalidation request is still in flight', () => {
      setup('browser', { [STORAGE_KEY]: JSON.stringify([MOCK_ITEM]) });
      httpMock = TestBed.inject(HttpTestingController);
      TestBed.tick();

      const revalidateReq = httpMock.expectOne('/api/products/rose-oud');

      service.toggle(MOCK_ITEM); // removes product-1 before revalidation resolves

      revalidateReq.flush({ id: 'product-1', name: 'Rose Oud 50ml', slug: 'rose-oud' });

      expect(service.items()).toEqual([]);
    });
  });

  // ── Guest wishlist merge batching (>100 items) ────────────────────────────
  // Guards the fix: MergeWishlistDto caps productIds at 100 — a guest wishlist
  // larger than that must be chunked into sequential batches, not sent in one
  // request that the backend rejects wholesale.

  describe('guest wishlist merge batching', () => {
    let httpMock: HttpTestingController;

    afterEach(() => httpMock.verify());

    function makeGuestItems(count: number): WishlistItemData[] {
      return Array.from({ length: count }, (_, i) => ({
        id: `product-${i}`,
        name: `Item ${i}`,
        slug: `item-${i}`,
        notifyOnRestock: false,
      }));
    }

    it('splits a 150-item guest wishlist into two merge batches of 100 and 50 ids', () => {
      setupAuthenticated(makeGuestItems(150));
      httpMock = TestBed.inject(HttpTestingController);
      TestBed.tick();

      const firstBatch = httpMock.expectOne('/api/wishlist/merge');
      expect((firstBatch.request.body as { productIds: string[] }).productIds).toHaveLength(100);
      firstBatch.flush({});

      const secondBatch = httpMock.expectOne('/api/wishlist/merge');
      expect((secondBatch.request.body as { productIds: string[] }).productIds).toHaveLength(50);
      secondBatch.flush({});

      httpMock.expectOne('/api/wishlist').flush([]);
    });

    it('does not issue the second batch until the first batch resolves', () => {
      setupAuthenticated(makeGuestItems(150));
      httpMock = TestBed.inject(HttpTestingController);
      TestBed.tick();

      const firstPending = httpMock.match('/api/wishlist/merge');
      expect(firstPending).toHaveLength(1);
      firstPending[0].flush({});

      const secondPending = httpMock.match('/api/wishlist/merge');
      expect(secondPending).toHaveLength(1);
      secondPending[0].flush({});

      httpMock.expectOne('/api/wishlist').flush([]);
    });

    it('clears localStorage only after every batch and the final fetch succeed', () => {
      setupAuthenticated(makeGuestItems(150));
      httpMock = TestBed.inject(HttpTestingController);
      TestBed.tick();

      httpMock.expectOne('/api/wishlist/merge').flush({});
      httpMock.expectOne('/api/wishlist/merge').flush({});
      httpMock.expectOne('/api/wishlist').flush([]);

      expect(mockStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    });

    it('sends a single batch for a wishlist of exactly 100 items', () => {
      setupAuthenticated(makeGuestItems(100));
      httpMock = TestBed.inject(HttpTestingController);
      TestBed.tick();

      const batch = httpMock.expectOne('/api/wishlist/merge');
      expect((batch.request.body as { productIds: string[] }).productIds).toHaveLength(100);
      batch.flush({});

      httpMock.expectOne('/api/wishlist').flush([]);
    });
  });

  // ── Merge failure must not discard the guest wishlist ─────────────────────
  // Guards the fix: a failed merge batch left localStorage cleared unconditionally,
  // silently discarding the unmerged guest items. It must now be preserved so the
  // next sync attempt (e.g. on the next page load) can retry — mergeGuestItems()
  // on the backend is idempotent (skipDuplicates), so a retry is always safe.

  describe('merge failure handling', () => {
    let httpMock: HttpTestingController;

    afterEach(() => httpMock.verify());

    it('does not clear localStorage when the merge request fails, and falls back to the current backend wishlist', () => {
      setupAuthenticated([MOCK_ITEM]);
      httpMock = TestBed.inject(HttpTestingController);
      TestBed.tick();

      httpMock
        .expectOne('/api/wishlist/merge')
        .flush('merge failed', { status: 500, statusText: 'Server Error' });

      const backendItems: WishlistItemData[] = [
        { id: 'backend-item', name: 'Backend Item', slug: 'backend-item', notifyOnRestock: true },
      ];
      httpMock.expectOne('/api/wishlist').flush(backendItems);

      expect(service.items()).toEqual(backendItems);
      expect(mockStorage.removeItem).not.toHaveBeenCalled();
    });

    it('does not clear localStorage when a later batch fails partway through a multi-batch sync', () => {
      setupAuthenticated(
        Array.from({ length: 150 }, (_, i) => ({
          id: `product-${i}`,
          name: `Item ${i}`,
          slug: `item-${i}`,
          notifyOnRestock: false,
        })),
      );
      httpMock = TestBed.inject(HttpTestingController);
      TestBed.tick();

      httpMock.expectOne('/api/wishlist/merge').flush({}); // first batch (100) succeeds
      httpMock
        .expectOne('/api/wishlist/merge')
        .flush('boom', { status: 500, statusText: 'Server Error' }); // second batch (50) fails

      httpMock.expectOne('/api/wishlist').flush([]);

      expect(mockStorage.removeItem).not.toHaveBeenCalled();
    });
  });
});
