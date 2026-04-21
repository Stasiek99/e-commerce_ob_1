import { Injectable, signal } from '@angular/core';
import { ProductCardData } from '../../shared/product-card/product-card.component';

@Injectable({ providedIn: 'root' })
export class WishlistService {
  private readonly STORAGE_KEY = 'wishlist_v1';
  private readonly _items = signal<ProductCardData[]>(this.load());

  readonly items = this._items.asReadonly();

  private load(): ProductCardData[] {
    try {
      return JSON.parse(localStorage.getItem(this.STORAGE_KEY) ?? '[]');
    } catch {
      return [];
    }
  }

  private save(): void {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this._items()));
  }

  isInWishlist(id: string): boolean {
    return this._items().some((p) => p.id === id);
  }

  toggle(product: ProductCardData): void {
    if (this.isInWishlist(product.id)) {
      this._items.update((items) => items.filter((p) => p.id !== product.id));
    } else {
      this._items.update((items) => [...items, product]);
    }
    this.save();
  }
}
