import { Injectable, PLATFORM_ID, computed, effect, inject, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { switchMap, catchError, forkJoin, of, map } from 'rxjs';
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

    const sync$ = guestIds.length
      ? this.http.post(`${environment.apiUrl}/wishlist/merge`, { productIds: guestIds }).pipe(
          switchMap(() => fetch$),
          catchError(() => fetch$),
        )
      : fetch$;

    sync$.subscribe({
      next: (items) => {
        this._items.set(items);
        if (this.isBrowser) this.storage.removeItem(this.STORAGE_KEY);
        this.loading.set(false);
      },
      error: () => {
        // Always clear localStorage even on total failure — prevents infinite re-merge
        // on subsequent loads when the guest items were already partially processed.
        if (this.isBrowser) this.storage.removeItem(this.STORAGE_KEY);
        this.loading.set(false);
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
          catchError(() => of(null)),
        ),
      ),
    ).subscribe((results) => {
      const valid = results.filter((r): r is WishlistItemData => r !== null);
      this._items.set(valid);
      this.saveToStorage();
      this.loading.set(false);
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
