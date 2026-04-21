import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { CartService } from '../../../core/services/cart.service';
import { ToastService } from '../../../core/services/toast.service';
import { SeoService } from '../../../core/services/seo.service';
import { PricePipe } from '../../../shared/pipes/price.pipe';

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [PricePipe],
  template: `
    @if (loading()) {
      <p>Ładowanie...</p>
    } @else if (product()) {
      <div class="detail">
        <div class="detail__gallery">
          @if (product()!.images?.[0]) {
            <img [src]="product()!.images[0].url" [alt]="product()!.name" />
          }
        </div>
        <div class="detail__info">
          @if (product()!.brand) { <p class="detail__brand">{{ product()!.brand }}</p> }
          <h1>{{ product()!.name }}</h1>
          <p class="detail__desc">{{ product()!.shortDescription }}</p>

          <div class="detail__variants">
            @for (variant of product()!.variants; track variant.id) {
              <button
                class="variant-btn"
                [class.variant-btn--selected]="selectedVariant()?.id === variant.id"
                (click)="selectedVariant.set(variant)">
                {{ variant.label }}
                <span>{{ variant.priceInCents | price }}</span>
              </button>
            }
          </div>

          @if (selectedVariant()) {
            <button class="btn-add" (click)="addToCart()">
              Dodaj do koszyka — {{ selectedVariant()!.priceInCents | price }}
            </button>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .detail { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; padding: 32px 0; }
    .detail__gallery img { width: 100%; border-radius: var(--radius-md); }
    .detail__brand { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-accent); margin: 0 0 8px; }
    h1 { font-size: 28px; font-weight: 700; margin: 0 0 16px; }
    .detail__desc { color: var(--color-secondary); line-height: 1.6; }
    .detail__variants { display: flex; flex-wrap: wrap; gap: 8px; margin: 24px 0; }
    .variant-btn { border: 1px solid var(--color-border); background: none; border-radius: var(--radius-sm); padding: 8px 16px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 13px; transition: all 0.15s; }
    .variant-btn:hover { border-color: var(--color-primary); }
    .variant-btn--selected { border-color: var(--color-primary); background: var(--color-primary); color: white; }
    .btn-add { width: 100%; background: var(--color-primary); color: white; border: none; padding: 16px; border-radius: var(--radius-md); font-size: 16px; font-weight: 600; cursor: pointer; transition: opacity 0.15s; }
    .btn-add:hover { opacity: 0.85; }
  `],
})
export class ProductDetailComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly cartService = inject(CartService);
  private readonly toast = inject(ToastService);
  private readonly seo = inject(SeoService);

  readonly loading = signal(true);
  readonly product = signal<any>(null);
  readonly selectedVariant = signal<any>(null);

  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('slug')!;
    this.http
      .get<any>(`${environment.apiUrl}/products/${slug}`)
      .subscribe({
        next: (p) => {
          this.product.set(p);
          if (p.variants?.length) this.selectedVariant.set(p.variants[0]);
          const seoInput = {
            name: p.name,
            brand: p.brand,
            shortDescription: p.shortDescription,
            slug: p.slug ?? slug,
            images: p.images,
            variants: p.variants,
          };
          this.seo.updateProductMeta(seoInput);
          this.seo.setProductJsonLd(seoInput);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  addToCart() {
    const variant = this.selectedVariant();
    if (!variant) return;
    this.cartService
      .addItem(variant.id, 1)
      .subscribe({
        next: (cart) => {
          this.cartService.refreshFromServer(cart);
          this.toast.success('Dodano do koszyka!');
        },
        error: () => this.toast.error('Nie udało się dodać do koszyka.'),
      });
  }
}
