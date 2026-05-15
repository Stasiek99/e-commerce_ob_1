import { Component, computed, inject, effect, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { from, mergeMap, toArray } from 'rxjs';
import { TuiButton, TuiIcon } from '@taiga-ui/core';
import { WishlistService, WishlistItemData } from '../../core/services/wishlist.service';
import { CartService } from '../../core/services/cart.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { ProductCardComponent } from '../../shared/product-card/product-card.component';

@Component({
  selector: 'app-wishlist',
  standalone: true,
  imports: [RouterLink, TuiButton, TuiIcon, ProductCardComponent],
  template: `
    <div class="page">
      <div class="wishlist-header">
        <h1 class="wishlist-heading">
          <tui-icon icon="@tui.heart" class="wishlist-heading__icon" />
          Twoje ulubione produkty
        </h1>
        @if (inStockCount() > 0) {
          <button
            tuiButton
            appearance="accent"
            size="s"
            type="button"
            [disabled]="addingAll()"
            (click)="addAllToCart()"
          >
            {{ addingAll() ? 'Dodawanie…' : 'Dodaj wszystkie do koszyka (' + inStockCount() + ')' }}
          </button>
        }
      </div>

      @if (wishlist.items().length === 0) {
        <div class="empty">
          <p>Nie masz jeszcze żadnych ulubionych produktów.</p>
          <a routerLink="/products" tuiButton appearance="accent" size="l">
            Przeglądaj produkty
          </a>
        </div>
      } @else {
        <div class="grid">
          @for (product of wishlist.items(); track product.id) {
            <div class="wishlist-item">
              <app-product-card [product]="product" />
              @if (auth.isAuthenticated() && isOutOfStock(product)) {
                <button
                  tuiButton
                  type="button"
                  [appearance]="product.notifyOnRestock ? 'accent' : 'secondary'"
                  size="s"
                  class="notify-btn"
                  (click)="wishlist.setNotify(product.id, !product.notifyOnRestock)"
                >
                  <tui-icon [icon]="product.notifyOnRestock ? '@tui.bell-ring' : '@tui.bell'" />
                  {{ product.notifyOnRestock ? 'Powiadomienie włączone' : 'Powiadom gdy wróci' }}
                </button>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 32px 0; }

    .wishlist-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 32px;
      flex-wrap: wrap;
    }
    .wishlist-heading {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 28px;
      font-weight: 700;
      margin: 0;
    }
    .wishlist-heading__icon {
      font-size: 28px;
      color: var(--color-accent);
    }

    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      padding: 64px 0;
      text-align: center;
    }
    .empty p { font-size: 16px; color: var(--color-secondary); margin: 0; }

    .grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 24px;
    }
    @media (max-width: 1024px) { .grid { grid-template-columns: repeat(3, 1fr); gap: 24px; } }
    @media (max-width: 768px)  { .grid { grid-template-columns: repeat(2, 1fr); gap: 20px; } }
    @media (max-width: 480px)  { .grid { grid-template-columns: 1fr; } }

    .wishlist-item { display: flex; flex-direction: column; gap: 8px; }
    .notify-btn { width: 100%; }
  `],
})
export class WishlistComponent {
  private readonly router = inject(Router);
  private readonly cart = inject(CartService);
  private readonly toast = inject(ToastService);
  readonly wishlist = inject(WishlistService);
  readonly auth = inject(AuthService);

  isOutOfStock(product: WishlistItemData): boolean {
    if (!product.variants?.length) return true;
    return product.variants.every((v) => v.stock === 0);
  }

  readonly addingAll = signal(false);

  readonly inStockCount = computed(() =>
    this.wishlist.items().filter((p) => p.variants?.some((v) => v.stock > 0)).length,
  );

  constructor() {
    effect(() => {
      if (!this.wishlist.loading() && this.wishlist.items().length === 0) {
        this.router.navigate(['/products']);
      }
    });
  }

  addAllToCart(): void {
    const inStockProducts = this.wishlist
      .items()
      .filter((p) => p.variants?.some((v) => v.stock > 0));

    if (!inStockProducts.length) return;

    this.addingAll.set(true);

    from(inStockProducts).pipe(
      mergeMap((product) => {
        const variant = product.variants!.find((v) => v.stock > 0)!;
        return this.cart.addItem(variant.id, 1);
      }, 5),
      toArray(),
    ).subscribe({
      next: (carts) => {
        this.cart.refreshFromServer(carts[carts.length - 1]);
        this.toast.success(`Dodano ${inStockProducts.length} ${inStockProducts.length === 1 ? 'produkt' : 'produkty'} do koszyka!`);
        this.addingAll.set(false);
      },
      error: () => {
        this.cart.loadCart();
        this.toast.error('Nie udało się dodać wszystkich produktów.');
        this.addingAll.set(false);
      },
    });
  }
}
