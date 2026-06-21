import { Component, Input, inject, signal, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TuiButton, TuiIcon } from '@taiga-ui/core';
import { PricePipe } from '../pipes/price.pipe';
import { CartService } from '../../core/services/cart.service';
import { WishlistService } from '../../core/services/wishlist.service';
import { ToastService } from '../../core/services/toast.service';
import { AnalyticsService } from '../../core/services/analytics.service';

export interface ProductCardData {
  id: string;
  name: string;
  slug: string;
  brand?: string | null;
  gender?: string | null;
  catalogNumber?: string | null;
  images?: Array<{ url: string }>;
  variants?: Array<{
    id: string;
    label: string;
    priceInCents: number;
    compareAtPriceInCents?: number | null;
    lowestPrice30dInCents?: number | null;
    stock: number;
    volume?: number | null;
  }>;
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
  private readonly toast = inject(ToastService);
  private readonly analytics = inject(AnalyticsService);

  @Input({ required: true }) product!: ProductCardData;

  readonly adding = signal(false);
  readonly wishlisted = computed(() => this.wishlist.isInWishlist(this.product?.id));

  onToggleWishlist(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const wasWishlisted = this.wishlisted();
    this.wishlist.toggle(this.product);
    if (wasWishlisted) {
      this.toast.info(`Usunięto „${this.product.name}" z ulubionych`);
    } else {
      this.toast.success(`Dodano „${this.product.name}" do ulubionych!`);
    }
  }

  get firstVariant() {
    return this.product.variants?.[0];
  }

  // Add-to-cart target: the cheapest variant (firstVariant) is only
  // guaranteed in stock when every variant is — mirrors
  // wishlist.component.ts's addAllToCart() variant pick.
  get cartVariant() {
    return this.product.variants?.find((v) => v.stock > 0) ?? this.firstVariant;
  }

  get outOfStock(): boolean {
    const variants = this.product.variants;
    if (!variants?.length) return true;
    return variants.every((v) => v.stock === 0);
  }

  get unitPriceText(): string | null {
    const v = this.firstVariant;
    if (!v?.volume) return null;
    const per100ml = (v.priceInCents / v.volume) * 100;
    return (per100ml / 100).toFixed(2).replace('.', ',') + ' zł / 100ml';
  }

  onAddToCart(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    const variant = this.cartVariant;
    if (!variant || this.adding() || this.outOfStock) return;

    this.adding.set(true);
    this.cart.addItem(variant.id, 1).subscribe({
      next: (cart) => {
        this.cart.refreshFromServer(cart);
        this.analytics.trackAddToCart({
          itemId: variant.id,
          name: this.product.name,
          brand: this.product.brand,
          variantLabel: variant.label,
          priceInCents: variant.priceInCents,
          quantity: 1,
        });
        this.toast.success('Dodano do koszyka!');
        this.adding.set(false);
      },
      error: () => {
        this.adding.set(false);
        this.toast.error('Nie udało się dodać do koszyka.');
      },
    });
  }
}
