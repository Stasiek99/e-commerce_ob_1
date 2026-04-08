import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CartService } from '../../../core/services/cart.service';
import { PricePipe } from '../../../shared/pipes/price.pipe';

@Component({
  selector: 'app-cart-page',
  standalone: true,
  imports: [RouterLink, PricePipe],
  template: `
    <div class="page">
      <h1>Koszyk</h1>
      @if (cart.items().length === 0) {
        <div class="empty">
          <p>Twój koszyk jest pusty.</p>
          <a routerLink="/products" class="btn-link">Przeglądaj produkty</a>
        </div>
      } @else {
        <div class="cart-layout">
          <div class="cart-items">
            @for (item of cart.items(); track item.productVariantId) {
              <div class="cart-item">
                @if (item.imageUrl) {
                  <img [src]="item.imageUrl" [alt]="item.productName" />
                }
                <div class="cart-item__info">
                  <a [routerLink]="['/products', item.slug]">{{ item.productName }}</a>
                  <span class="cart-item__variant">{{ item.variantLabel }}</span>
                  <span class="cart-item__sku">SKU: {{ item.sku }}</span>
                </div>
                <div class="cart-item__qty">
                  <button (click)="decrement(item)" [disabled]="item.quantity <= 1">−</button>
                  <span>{{ item.quantity }}</span>
                  <button (click)="increment(item)" [disabled]="item.quantity >= item.stock">+</button>
                </div>
                <div class="cart-item__price">{{ item.priceInCents * item.quantity | price }}</div>
                <button class="cart-item__remove" (click)="remove(item.productVariantId)">✕</button>
              </div>
            }
          </div>
          <div class="cart-summary">
            <h2>Podsumowanie</h2>
            <div class="summary-row">
              <span>Produkty ({{ cart.itemCount() }})</span>
              <span>{{ cart.totalInCents() | price }}</span>
            </div>
            <div class="summary-row">
              <span>Wysyłka</span>
              <span>obliczona przy zamówieniu</span>
            </div>
            <a routerLink="/checkout" class="btn-checkout">Przejdź do kasy</a>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 32px 0; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 32px; }
    .empty { text-align: center; padding: 64px 0; }
    .btn-link { display: inline-block; margin-top: 16px; padding: 12px 24px; background: var(--color-primary); color: white; border-radius: var(--radius-md); }
    .cart-layout { display: grid; grid-template-columns: 1fr 320px; gap: 32px; }
    .cart-item { display: flex; align-items: center; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--color-border); }
    .cart-item img { width: 72px; height: 72px; object-fit: cover; border-radius: var(--radius-sm); }
    .cart-item__info { flex: 1; }
    .cart-item__info a { font-weight: 600; font-size: 14px; }
    .cart-item__variant, .cart-item__sku { display: block; font-size: 12px; color: var(--color-secondary); }
    .cart-item__qty { display: flex; align-items: center; gap: 12px; }
    .cart-item__qty button { width: 28px; height: 28px; border: 1px solid var(--color-border); background: none; border-radius: var(--radius-sm); cursor: pointer; font-size: 16px; }
    .cart-item__qty button:disabled { opacity: 0.3; }
    .cart-item__price { font-weight: 600; min-width: 80px; text-align: right; }
    .cart-item__remove { background: none; border: none; cursor: pointer; color: var(--color-secondary); font-size: 16px; padding: 4px; }
    .cart-summary { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 24px; align-self: start; }
    .cart-summary h2 { font-size: 18px; font-weight: 700; margin: 0 0 20px; }
    .summary-row { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 12px; }
    .btn-checkout { display: block; margin-top: 24px; background: var(--color-primary); color: white; text-align: center; padding: 14px; border-radius: var(--radius-md); font-weight: 600; font-size: 16px; }
  `],
})
export class CartPageComponent {
  readonly cart = inject(CartService);

  increment(item: any) {
    this.cart.updateQuantity(item.productVariantId, item.quantity + 1);
  }

  decrement(item: any) {
    if (item.quantity > 1) this.cart.updateQuantity(item.productVariantId, item.quantity - 1);
  }

  remove(variantId: string) {
    this.cart.removeItem(variantId).subscribe();
  }
}
