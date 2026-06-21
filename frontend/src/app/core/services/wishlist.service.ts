import { Injectable, PLATFORM_ID, computed, effect, inject, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { switchMap, catchError, forkJoin, of, map, from, concatMap, toArray } from 'rxjs';
import { ProductCardData } from '../../shared/product-card/product-card.component';
import { AuthService } from './auth.service';
import { LOCAL_STORAGE } from '../tokens/storage.tokens';
import { environment } from '../../../environments/environment';

export interface WishlistItemData extends ProductCardData {
  notifyOnRestock: boolean;
}

@Injectable({ providedIn: 'root' })
export class WishlistService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly storage = inject(LOCAL_STORAGE);

  private readonly STORAGE_KEY = 'wishlist_v1';
  // Matches the backend's MergeWishlistDto ArrayMaxSize(100) — batching keeps a long-lived
  // guest session's wishlist from being rejected wholesale on login.
  private readonly MERGE_CHUNK_SIZE = 100;
  private readonly _items = signal<WishlistItemData[]>(this.loadFromStorage());

  readonly items = this._items.asReadonly();
  readonly count = computed(() => this._items().length);
  readonly loading = signal(false);

  constructor() {
    effect(() => {
      const isAuth = this.auth.isAuthenticated();
      if (isAuth) {
        const guestIds = untracked(() => this._items().map((p) => p.id));
        this.syncFromBackend(guestIds);
      } else {
        const stored = this.loadFromStorage();
        this._items.set(stored);
        this.revalidateGuestItems(stored);
      }
    });
  }

  isInWishlist(id: string): boolean {
    return this._items().some((p) => p.id === id);
  }

  toggle(product: ProductCardData): void {
    const inWishlist = this.isInWishlist(product.id);
    const item: WishlistItemData = { ...product, notifyOnRestock: false };

    if (this.auth.isAuthenticated()) {
      if (inWishlist) {
        this._items.update((items) => items.filter((p) => p.id !== product.id));
        this.http.delete(`${environment.apiUrl}/wishlist/${product.id}`).subscribe({
          error: () => this._items.update((items) => [...items, item]),
        });
      } else {
        this._items.update((items) => [...items, item]);
        this.http.post(`${environment.apiUrl}/wishlist/${product.id}`, {}).subscribe({
          error: () => this._items.update((items) => items.filter((p) => p.id !== product.id)),
        });
      }
    } else {
      if (inWishlist) {
        this._items.update((items) => items.filter((p) => p.id !== product.id));
      } else {
        this._items.update((items) => [...items, item]);
      }
      this.saveToStorage();
    }
  }

  setNotify(productId: string, notify: boolean): void {
    if (!this.auth.isAuthenticated()) return;

    this._items.update((items) =>
      items.map((p) => (p.id === productId ? { ...p, notifyOnRestock: notify } : p)),
    );

    this.http.patch(`${environment.apiUrl}/wishlist/${productId}/notify`, { notify }).subscribe({
      error: () =>
        this._items.update((items) =>
          items.map((p) => (p.id === productId ? { ...p, notifyOnRestock: !notify } : p)),
        ),
    });
  }

  private syncFromBackend(guestIds: string[]): void {
    this.loading.set(true);

    const fetch$ = this.http.get<WishlistItemData[]>(`${environment.apiUrl}/wishlist`);

    if (!guestIds.length) {
      fetch$.subscribe({
        next: (items) => {
          this._items.set(items);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
      return;
    }

    const chunks: string[][] = [];
    for (let i = 0; i < guestIds.length; i += this.MERGE_CHUNK_SIZE) {
      chunks.push(guestIds.slice(i, i + this.MERGE_CHUNK_SIZE));
    }

    from(chunks)
      .pipe(
        concatMap((chunk) => this.http.post(`${environment.apiUrl}/wishlist/merge`, { productIds: chunk })),
        toArray(),
        switchMap(() => fetch$),
      )
      .subscribe({
        next: (items) => {
          this._items.set(items);
          if (this.isBrowser) this.storage.removeItem(this.STORAGE_KEY);
          this.loading.set(false);
        },
        error: () => {
          // A merge batch (or the post-merge fetch) failed — leave localStorage intact so
          // the not-yet-merged guest items aren't lost, and retry on the next sync instead.
          fetch$.subscribe({
            next: (items) => {
              this._items.set(items);
              this.loading.set(false);
            },
            error: () => this.loading.set(false),
          });
        },
      });
  }

  // Guest items are a frozen localStorage snapshot with no isActive field. Re-fetch each
  // by slug — the same public endpoint the catalog uses, which already 404s on inactive
  // products — so a deactivated/re-priced/restocked product never displays stale data.
  private revalidateGuestItems(items: WishlistItemData[]): void {
    if (!this.isBrowser || !items.length) return;

    this.loading.set(true);
    forkJoin(
      items.map((item) =>
        this.http.get<ProductCardData>(`${environment.apiUrl}/products/${item.slug}`).pipe(
          map((fresh): WishlistItemData => ({
            id: fresh.id,
            name: fresh.name,
            slug: fresh.slug,
            brand: fresh.brand,
            gender: fresh.gender,
            catalogNumber: fresh.catalogNumber,
            images: fresh.images,
            variants: fresh.variants,
            notifyOnRestock: item.notifyOnRestock,
          })),
          catchError(() => of({ id: item.id, invalid: true as const })),
        ),
      ),
    ).subscribe((results) => {
      this.loading.set(false);

      // Auth state flipped to true while these requests were in flight — syncFromBackend
      // already replaced `_items` with the authenticated set, so applying this stale
      // guest-snapshot result here would clobber it.
      if (this.auth.isAuthenticated()) return;

      const refreshed = new Map<string, WishlistItemData>();
      const invalidIds = new Set<string>();
      for (const r of results) {
        if ('invalid' in r) invalidIds.add(r.id);
        else refreshed.set(r.id, r);
      }

      // Merge into the *current* items rather than replacing outright, so a toggle()
      // that landed after this revalidation started is never discarded.
      this._items.update((current) =>
        current.filter((p) => !invalidIds.has(p.id)).map((p) => refreshed.get(p.id) ?? p),
      );
      this.saveToStorage();
    });
  }

  private loadFromStorage(): WishlistItemData[] {
    if (!this.isBrowser) return [];
    try {
      const raw: any[] = JSON.parse(this.storage.getItem(this.STORAGE_KEY) ?? '[]');
      return raw.map((p) => ({ ...p, notifyOnRestock: p.notifyOnRestock ?? false }));
    } catch {
      return [];
    }
  }

  private saveToStorage(): void {
    if (!this.isBrowser) return;
    this.storage.setItem(this.STORAGE_KEY, JSON.stringify(this._items()));
  }
}
