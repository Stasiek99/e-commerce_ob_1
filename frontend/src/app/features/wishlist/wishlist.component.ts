import { Component, inject, effect } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TuiButton, TuiIcon } from '@taiga-ui/core';
import { WishlistService } from '../../core/services/wishlist.service';
import { ProductCardComponent } from '../../shared/product-card/product-card.component';

@Component({
  selector: 'app-wishlist',
  standalone: true,
  imports: [RouterLink, TuiButton, TuiIcon, ProductCardComponent],
  template: `
    <div class="page">
      <h1 class="wishlist-heading">
        <tui-icon icon="@tui.heart" class="wishlist-heading__icon" />
        Twoje ulubione produkty
      </h1>

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
            <app-product-card [product]="product" />
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 32px 0; }

    .wishlist-heading {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 28px;
      font-weight: 700;
      margin: 0 0 32px;
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
  `],
})
export class WishlistComponent {
  private readonly router = inject(Router);
  readonly wishlist = inject(WishlistService);

  constructor() {
    // Redirect to /products as soon as the page loads with an empty wishlist
    effect(() => {
      if (this.wishlist.items().length === 0) {
        this.router.navigate(['/products']);
      }
    });
  }
}
