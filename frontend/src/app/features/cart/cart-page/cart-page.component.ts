import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TuiButton, TuiTitle } from '@taiga-ui/core';
import { TuiCounter } from '@taiga-ui/kit';
import { CartService } from '../../../core/services/cart.service';
import { PricePipe } from '../../../shared/pipes/price.pipe';
import { TuiCell } from "@taiga-ui/layout";

@Component({
  selector: 'app-cart-page',
  standalone: true,
  imports: [RouterLink, FormsModule, TuiButton, TuiTitle, TuiCounter, PricePipe, TuiCell],
  template: `
    <div class="page">
      <h1>Koszyk</h1>

      @if (cart.items().length === 0) {
        <div class="empty">
          <p>Twój koszyk jest pusty.</p>
          <a routerLink="/products" tuiButton appearance="accent" size="l">Przeglądaj produkty</a>
        </div>
      } @else {
        <div class="cart-layout">

          <!-- Items list -->
          <div class="cart-items">
            @for (item of cart.items(); track item.productVariantId) {
              <div tuiCell class="cart-cell">
                @if (item.imageUrl) {
                  <img
                    [src]="item.imageUrl"
                    [alt]="item.productName"
                    class="cart-cell__img"
                  />
                }
                <div tuiTitle>
                  <a [routerLink]="['/products', item.slug]">{{ item.productName }}</a>
                  <div tuiSubtitle>{{ item.variantLabel }} · {{ item.priceInCents * item.quantity | price }}</div>
                </div>
                <tui-counter
                  [ngModel]="item.quantity"
                  (ngModelChange)="updateQty(item.productVariantId, $event)"
                  [min]="1"
                  [max]="item.stock"
                  appearance="flat"
                  size="s"
                ></tui-counter>
                <button
                  tuiButton
                  appearance="secondary"
                  class="cart-cell__remove"
                  type="button"
                  [attr.aria-label]="'Usuń ' + item.productName + ' z koszyka'"
                  (click)="remove(item.productVariantId)">
                  <span aria-hidden="true">✕</span>
                </button>
              </div>
            }
          </div>

          <!-- Summary card -->
          <aside class="summary-card">
            <h2 class="summary-card__title">Podsumowanie</h2>
            <div class="summary-card__row">
              <span>Produkty ({{ cart.itemCount() }})</span>
              <strong>{{ cart.totalInCents() | price }}</strong>
            </div>
            <div class="summary-card__row summary-card__row--muted">
              <span>Wysyłka</span>
              <span>obliczona przy zamówieniu</span>
            </div>
            <a routerLink="/checkout" tuiButton appearance="primary" size="l" class="summary-card__cta">
              Przejdź do kasy
            </a>
          </aside>

        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 32px 0; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 32px; }

    .empty { text-align: center; padding: 64px 0; display: flex; flex-direction: column; align-items: center; gap: 16px; }
    .empty p { color: var(--color-secondary); font-size: 16px; margin: 0; }

    .cart-layout { display: grid; grid-template-columns: 1fr 320px; gap: 32px; align-items: start; }

    .cart-items { background: var(--color-surface); border-radius: var(--border-radius-md); box-shadow: var(--shadow-sm); overflow: hidden; }
    .cart-cell { border-bottom: 1px solid var(--color-border); }
    .cart-cell:last-child { border-bottom: none; }
    .cart-cell__img { width: 3.5rem; height: 3.5rem; object-fit: cover; border-radius: var(--border-radius-md); flex-shrink: 0; }
    .cart-cell__remove { background: none; border: none; cursor: pointer; font-size: 16px; color: var(--color-secondary); padding: 4px; transition: color 0.15s; }
    .cart-cell__remove:hover { color: var(--color-primary); }

    /* Summary card — matches product card visual style */
    .summary-card {
      background: var(--color-surface);
      border-radius: var(--border-radius-md);
      box-shadow: var(--shadow-sm);
      padding: 24px;
    }
    .summary-card__title { font-size: 18px; font-weight: 700; margin: 0 0 20px; }
    .summary-card__row { display: flex; justify-content: space-between; align-items: center; font-size: 14px; margin-bottom: 12px; }
    .summary-card__row--muted span { color: var(--color-secondary); font-size: 13px; }
    .summary-card__cta { display: flex; width: 100%; margin-top: 24px; justify-content: center; }

    @media (max-width: 768px) {
      .cart-layout { grid-template-columns: 1fr; }
    }
  `],
})
export class CartPageComponent {
  readonly cart = inject(CartService);

  updateQty(variantId: string, qty: number): void {
    this.cart.updateQuantity(variantId, qty);
  }

  remove(variantId: string): void {
    this.cart.removeItem(variantId).subscribe();
  }
}
