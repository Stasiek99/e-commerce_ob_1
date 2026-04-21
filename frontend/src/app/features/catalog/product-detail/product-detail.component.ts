import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { TuiButton, TuiIcon, TuiExpand } from '@taiga-ui/core';
import { TuiCounter } from '@taiga-ui/kit';
import { environment } from '../../../../environments/environment';
import { CartService } from '../../../core/services/cart.service';
import { ToastService } from '../../../core/services/toast.service';
import { SeoService } from '../../../core/services/seo.service';
import { WishlistService } from '../../../core/services/wishlist.service';
import { PricePipe } from '../../../shared/pipes/price.pipe';
import { ProductCardData } from '../../../shared/product-card/product-card.component';
import { BreadcrumbComponent, Breadcrumb } from '../../../shared/components/breadcrumb/breadcrumb.component';

const CATEGORY_LABELS: Record<string, string> = {
  perfume: 'Perfumy',
  diffusers: 'Dyfuzory',
  gels: 'Żele pod prysznic',
};

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [FormsModule, TuiButton, TuiIcon, TuiExpand, TuiCounter, PricePipe, BreadcrumbComponent],
  template: `
    @if (loading()) {
      <p class="loading">Ładowanie...</p>
    } @else if (product()) {
      <app-breadcrumb [crumbs]="breadcrumbs()" />
      <div class="detail">

        <!-- Gallery -->
        <div class="detail__gallery">
          @if (activeImage()) {
            <img [src]="activeImage()!" [alt]="product()!.name" class="detail__main-img" />
          }
          @if (product()!.images?.length > 1) {
            <div class="detail__thumbs">
              @for (img of product()!.images; track img.url) {
                <img [src]="img.url" [alt]="product()!.name"
                  class="detail__thumb" [class.detail__thumb--active]="activeImage() === img.url"
                  (click)="activeImage.set(img.url)" />
              }
            </div>
          }
        </div>

        <!-- Info -->
        <div class="detail__info">
          @if (product()!.brand) {
            <p class="detail__brand">{{ product()!.brand }}</p>
          }
          <h1 class="detail__name">{{ product()!.name }}</h1>

          @if (product()!.shortDescription) {
            <p class="detail__short-desc">{{ product()!.shortDescription }}</p>
          }

          <!-- Variant selection -->
          @if (product()!.variants?.length) {
            <div class="detail__variants">
              <p class="detail__label">Rozmiar</p>
              <div class="detail__variant-btns">
                @for (v of product()!.variants; track v.id) {
                  <button
                    tuiButton
                    type="button"
                    size="s"
                    [appearance]="selectedVariant()?.id === v.id ? 'primary' : 'outline'"
                    (click)="selectVariant(v)">
                    {{ v.label }}
                  </button>
                }
              </div>
            </div>
          }

          <!-- Price + stock -->
          @if (selectedVariant()) {
            <div class="detail__price-row">
              <span class="detail__price">{{ selectedVariant()!.priceInCents | price }}</span>
              @if (selectedVariant()!.stock > 0) {
                <span class="detail__stock detail__stock--ok">
                  <tui-icon icon="@tui.check-circle" />
                  Dostępny · {{ selectedVariant()!.stock }} szt.
                </span>
              } @else {
                <span class="detail__stock detail__stock--out">
                  <tui-icon icon="@tui.x-circle" />
                  Brak w magazynie
                </span>
              }
            </div>

            <!-- Quantity + Add to cart + Wishlist -->
            <div class="detail__cta">
              <tui-counter
                [(ngModel)]="quantity"
                [min]="1"
                [max]="selectedVariant()!.stock || 1"
                appearance="secondary"
                size="m"
              ></tui-counter>
              <button
                tuiButton
                type="button"
                appearance="primary"
                size="l"
                class="detail__add-btn"
                [disabled]="adding() || selectedVariant()!.stock === 0"
                (click)="addToCart()">
                {{ adding() ? 'Dodawanie…' : 'Dodaj do koszyka' }}
              </button>
              <button
                tuiButton
                type="button"
                appearance="secondary"
                size="l"
                class="detail__wishlist-btn"
                [class.detail__wishlist-btn--active]="wishlisted()"
                (click)="toggleWishlist()">
                <tui-icon [icon]="wishlisted() ? '@tui.heart-fill' : '@tui.heart'" />
              </button>
            </div>
          }

          <!-- Additional info -->
          @if (product()!.concentration || product()!.gender || product()!.category) {
            <div class="detail__meta">
              @if (product()!.concentration) {
                <div class="detail__meta-row">
                  <span class="detail__meta-label">Stężenie</span>
                  <span>{{ product()!.concentration }}</span>
                </div>
              }
              @if (product()!.gender) {
                <div class="detail__meta-row">
                  <span class="detail__meta-label">Płeć</span>
                  <span>{{ product()!.gender }}</span>
                </div>
              }
              @if (product()!.category?.name) {
                <div class="detail__meta-row">
                  <span class="detail__meta-label">Kategoria</span>
                  <span>{{ product()!.category.name }}</span>
                </div>
              }
            </div>
          }

          <!-- Description expand -->
          @if (product()!.description) {
            <div class="detail__desc-section">
              <button tuiButton type="button" appearance="flat" size="s"
                class="detail__expand-btn"
                (click)="descExpanded = !descExpanded">
                {{ descExpanded ? 'Zwiń opis' : 'Rozwiń opis' }}
                <tui-icon [icon]="descExpanded ? '@tui.chevron-up' : '@tui.chevron-down'" />
              </button>
              <tui-expand [expanded]="descExpanded">
                <div class="detail__desc-body">{{ product()!.description }}</div>
              </tui-expand>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .loading { padding: 32px 0; color: var(--color-secondary); }

    .detail {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 56px;
      padding: 32px 0 64px;
      align-items: start;
    }

    /* Gallery */
    .detail__gallery { position: sticky; top: 80px; }
    .detail__main-img { width: 100%; border-radius: var(--border-radius-md); display: block; }
    .detail__thumbs { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .detail__thumb {
      width: 72px; height: 72px; object-fit: cover;
      border-radius: var(--border-radius-sm);
      border: 2px solid var(--color-border);
      cursor: pointer; transition: border-color 0.15s;
    }
    .detail__thumb--active { border-color: var(--color-primary); }

    /* Info */
    .detail__brand {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em;
      color: var(--color-accent); margin: 0 0 6px; font-weight: 600;
    }
    .detail__name { font-size: 28px; font-weight: 700; margin: 0 0 12px; line-height: 1.25; }
    .detail__short-desc { color: var(--color-secondary); font-size: 14px; line-height: 1.6; margin: 0 0 24px; }

    /* Variants */
    .detail__label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-secondary); margin: 0 0 10px; }
    .detail__variants { margin-bottom: 24px; }
    .detail__variant-btns { display: flex; flex-wrap: wrap; gap: 8px; }

    /* Price + stock */
    .detail__price-row { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
    .detail__price { font-size: 26px; font-weight: 700; color: var(--color-primary); }
    .detail__stock { display: flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 500; }
    .detail__stock tui-icon { font-size: 14px; }
    .detail__stock--ok { color: var(--color-success); }
    .detail__stock--out { color: var(--color-error); }

    /* CTA row */
    .detail__cta { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
    .detail__add-btn { flex: 1; }
    .detail__wishlist-btn { flex-shrink: 0; }
    .detail__wishlist-btn--active tui-icon { color: var(--color-error); }

    /* Description expand */
    .detail__desc-section { border-top: 1px solid var(--color-border); padding-top: 16px; margin-bottom: 16px; }
    .detail__expand-btn { display: flex; align-items: center; gap: 6px; }
    .detail__desc-body { padding: 16px 0 4px; font-size: 14px; line-height: 1.7; color: var(--color-secondary); white-space: pre-line; }

    /* Meta */
    .detail__meta { border-top: 1px solid var(--color-border); padding-top: 16px; }
    .detail__meta-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 0; border-bottom: 1px solid var(--color-border);
      font-size: 14px;
    }
    .detail__meta-row:last-child { border-bottom: none; }
    .detail__meta-label { color: var(--color-secondary); font-weight: 500; }

    @media (max-width: 768px) {
      .detail { grid-template-columns: 1fr; gap: 32px; }
      .detail__gallery { position: static; }
    }
  `],
})
export class ProductDetailComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly cartService = inject(CartService);
  private readonly toast = inject(ToastService);
  private readonly seo = inject(SeoService);
  private readonly wishlist = inject(WishlistService);
  private readonly location = inject(Location);

  readonly loading = signal(true);
  readonly product = signal<any>(null);
  readonly selectedVariant = signal<any>(null);
  readonly activeImage = signal<string | null>(null);
  readonly adding = signal(false);
  quantity = 1;
  descExpanded = false;

  readonly wishlisted = computed(() => this.wishlist.isInWishlist(this.product()?.id ?? ''));

  readonly breadcrumbs = computed<Breadcrumb[]>(() => {
    const p = this.product();
    const catSlug = p?.category?.slug ?? null;
    const catLabel = catSlug ? (CATEGORY_LABELS[catSlug] ?? p.category?.name ?? catSlug) : null;
    const crumbs: Breadcrumb[] = [{ label: 'Strona główna', link: '/' }];
    if (catSlug && catLabel) crumbs.push({ label: catLabel, link: `/category/${catSlug}` });
    if (p) crumbs.push({ label: p.name });
    return crumbs;
  });

  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('slug')!;
    this.http
      .get<any>(`${environment.apiUrl}/products/${slug}`)
      .subscribe({
        next: (p) => {
          this.product.set(p);
          if (p.variants?.length) this.selectedVariant.set(p.variants[0]);
          if (p.images?.length) this.activeImage.set(p.images[0].url);
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

  selectVariant(variant: any): void {
    this.selectedVariant.set(variant);
    this.quantity = 1;
  }

  addToCart(): void {
    const variant = this.selectedVariant();
    if (!variant || variant.stock === 0) return;
    this.adding.set(true);
    this.cartService
      .addItem(variant.id, this.quantity)
      .subscribe({
        next: (cart) => {
          this.cartService.refreshFromServer(cart);
          this.toast.success('Dodano do koszyka!');
          this.adding.set(false);
        },
        error: () => {
          this.toast.error('Nie udało się dodać do koszyka.');
          this.adding.set(false);
        },
      });
  }

  toggleWishlist(): void {
    const p = this.product();
    if (!p) return;
    const data: ProductCardData = {
      id: p.id,
      name: p.name,
      slug: p.slug,
      brand: p.brand,
      images: p.images,
      variants: p.variants,
    };
    this.wishlist.toggle(data);
  }
}
