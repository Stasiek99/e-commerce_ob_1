import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { switchMap, catchError, EMPTY } from 'rxjs';
import { ProductCardData } from '../../shared/product-card/product-card.component';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

export interface WishlistItemData extends ProductCardData {
  notifyOnRestock: boolean;
}

@Injectable({ providedIn: 'root' })
export class WishlistService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private readonly STORAGE_KEY = 'wishlist_v1';
  private readonly _items = signal<WishlistItemData[]>(this.loadFromStorage());

  readonly items = this._items.asReadonly();
  readonly count = computed(() => this._items().length);

  constructor() {
    effect(() => {
      const isAuth = this.auth.isAuthenticated();
      if (isAuth) {
        const guestIds = untracked(() => this._items().map((p) => p.id));
        this.syncFromBackend(guestIds);
      } else {
        this._items.set(this.loadFromStorage());
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
    const fetch$ = this.http.get<ProductCardData[]>(`${environment.apiUrl}/wishlist`);

    const sync$ = guestIds.length
      ? this.http.post(`${environment.apiUrl}/wishlist/merge`, { productIds: guestIds }).pipe(
          switchMap(() => fetch$),
          catchError(() => fetch$),
        )
      : fetch$;

    sync$.subscribe({
      next: (items) => {
        this._items.set(items);
        localStorage.removeItem(this.STORAGE_KEY);
      },
    });
  }

  private loadFromStorage(): WishlistItemData[] {
    try {
      const raw: any[] = JSON.parse(localStorage.getItem(this.STORAGE_KEY) ?? '[]');
      return raw.map((p) => ({ ...p, notifyOnRestock: p.notifyOnRestock ?? false }));
    } catch {
      return [];
    }
  }

  private saveToStorage(): void {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this._items()));
  }
}
