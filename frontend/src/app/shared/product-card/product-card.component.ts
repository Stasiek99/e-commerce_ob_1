import { Component, Input, inject, signal, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TuiButton, TuiIcon } from '@taiga-ui/core';
import { PricePipe } from '../pipes/price.pipe';
import { CartService } from '../../core/services/cart.service';
import { WishlistService } from '../../core/services/wishlist.service';

export interface ProductCardData {
  id: string;
  name: string;
  slug: string;
  brand?: string | null;
  images?: Array<{ url: string }>;
  variants?: Array<{ id: string; label: string; priceInCents: number; stock: number }>;
}

@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [RouterLink, TuiButton, TuiIcon, PricePipe],
  templateUrl: './product-card.component.html',
  styleUrl: './product-card.component.scss',
})
export class ProductCardComponent {
  private readonly cart = inject(CartService);
  private readonly wishlist = inject(WishlistService);

  @Input({ required: true }) product!: ProductCardData;

  readonly adding = signal(false);
  readonly wishlisted = computed(() => this.wishlist.isInWishlist(this.product?.id));

  onToggleWishlist(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.wishlist.toggle(this.product);
  }

  get firstVariant() {
    return this.product.variants?.[0];
  }

  get outOfStock(): boolean {
    return (this.firstVariant?.stock ?? 0) === 0;
  }

  onAddToCart(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    const variant = this.firstVariant;
    if (!variant || this.adding() || this.outOfStock) return;

    this.adding.set(true);
    this.cart.addItem(variant.id, 1).subscribe({
      next: (cart) => {
        this.cart.refreshFromServer(cart);
        this.adding.set(false);
      },
      error: () => this.adding.set(false),
    });
  }
}
