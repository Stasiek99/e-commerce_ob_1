import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { TuiButton, TuiIcon, TuiTextfield } from '@taiga-ui/core';
import { TuiExpand } from '@taiga-ui/experimental';
import { TuiCounter, TuiRating, TuiTextarea } from '@taiga-ui/kit';
import { environment } from '../../../../environments/environment';
import { CartService } from '../../../core/services/cart.service';
import { ToastService } from '../../../core/services/toast.service';
import { SeoService } from '../../../core/services/seo.service';
import { WishlistService } from '../../../core/services/wishlist.service';
import { AuthService } from '../../../core/services/auth.service';
import { ReviewsService, ReviewSummary } from '../../../core/services/reviews.service';
import { PricePipe } from '../../../shared/pipes/price.pipe';
import { ProductCardData } from '../../../shared/product-card/product-card.component';
import { BreadcrumbComponent, Breadcrumb } from '../../../shared/components/breadcrumb/breadcrumb.component';

interface ProductVariantDetail {
  id: string;
  label: string;
  priceInCents: number;
  compareAtPriceInCents?: number | null;
  stock: number;
  sku: string;
  volume?: number | null;
  weight?: number | null;
}

interface ProductDetail {
  id: string;
  name: string;
  slug: string;
  brand?: string | null;
  shortDescription?: string | null;
  description?: string | null;
  concentration?: string | null;
  gender?: string | null;
  images: Array<{ url: string; altText?: string | null }>;
  variants: ProductVariantDetail[];
  category?: { id: string; name: string; slug: string } | null;
  avgRating?: number | null;
  reviewCount?: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  perfume: 'Perfumy',
  diffusers: 'Dyfuzory',
  gels: 'Żele pod prysznic',
};

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [FormsModule, DatePipe, TuiButton, TuiIcon, TuiExpand, TuiCounter, TuiRating, TuiTextfield, TuiTextarea, PricePipe, BreadcrumbComponent],
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
          @if ((product()!.images?.length ?? 0) > 1) {
            <div class="detail__thumbs" role="group" aria-label="Miniatury zdjęć">
              @for (img of product()!.images; track img.url; let i = $index) {
                <button
                  type="button"
                  class="detail__thumb-btn"
                  [class.detail__thumb-btn--active]="activeImage() === img.url"
                  [attr.aria-label]="'Zdjęcie ' + (i + 1)"
                  [attr.aria-pressed]="activeImage() === img.url"
                  (click)="activeImage.set(img.url)">
                  <img [src]="img.url" [alt]="" class="detail__thumb" />
                </button>
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
          @if (product()!.variants.length) {
            <div class="detail__variants">
              <p class="detail__label">Rozmiar</p>
              <div class="detail__variant-btns">
                @for (v of product()!.variants; track v.id) {
                  <button
                    tuiButton
                    type="button"
                    size="s"
                    [appearance]="selectedVariant()?.id === v.id ? 'primary' : 'outline'"
                    [class.detail__variant-btn--oos]="v.stock === 0"
                    [attr.aria-label]="v.label + (v.stock === 0 ? ' – brak w magazynie' : '')"
                    (click)="selectVariant(v)">
                    {{ v.label }}
                  </button>
                }
              </div>
            </div>
          }

          <!-- Rating summary (above price, clickable anchor) -->
          @if ((product()!.reviewCount ?? 0) > 0) {
            <a class="detail__rating-summary" role="button" style="cursor:pointer" aria-label="Przejdź do opinii" (click)="scrollToReviews()">
              <span class="detail__stars" aria-hidden="true">
                @for (s of starsArray(product()!.avgRating ?? 0); track $index) {
                  <tui-icon [icon]="s === 'full' ? '@tui.star' : s === 'half' ? '@tui.star-half' : '@tui.star'"
                            [class.detail__star--filled]="s !== 'empty'"
                            [class.detail__star--empty]="s === 'empty'" />
                }
              </span>
              <span class="detail__rating-value">{{ product()!.avgRating?.toFixed(1) }}</span>
              <span class="detail__rating-count">({{ product()!.reviewCount }} {{ product()!.reviewCount === 1 ? 'opinia' : product()!.reviewCount! <= 4 ? 'opinie' : 'opinii' }})</span>
            </a>
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
                [attr.aria-label]="wishlisted() ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'"
                (click)="toggleWishlist()">
                <tui-icon
                  icon="@tui.heart"
                  [style.color]="wishlisted() ? 'var(--color-error)' : null"
                  aria-hidden="true" />
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
                  <span>{{ product()!.category?.name }}</span>
                </div>
              }
            </div>
          }

          <!-- Description expand -->
          @if (product()!.description) {
            <div class="detail__desc-section">
              <button tuiButton type="button" appearance="flat" size="s"
                class="detail__expand-btn"
                [attr.aria-expanded]="descExpanded"
                aria-controls="product-description"
                (click)="descExpanded = !descExpanded">
                {{ descExpanded ? 'Zwiń opis' : 'Rozwiń opis' }}
                <tui-icon [icon]="descExpanded ? '@tui.chevron-up' : '@tui.chevron-down'" aria-hidden="true" />
              </button>
              <tui-expand [expanded]="descExpanded">
                <div id="product-description" class="detail__desc-body">{{ product()!.description }}</div>
              </tui-expand>
            </div>
          }
        </div>
      </div>

      <!-- ─── Reviews section ─────────────────────────────────────── -->
      <section id="reviews" class="reviews">
        <h2 class="reviews__heading">Opinie klientów</h2>

        <!-- Submit form (auth + ?review=1 auto-opens) -->
        @if (auth.isAuthenticated()) {
          @if (!reviewSubmitted()) {
            <div class="reviews__form-wrap">
              <button tuiButton type="button" appearance="flat" size="s"
                      class="reviews__toggle-btn"
                      (click)="reviewFormOpen.set(!reviewFormOpen())">
                <tui-icon [icon]="reviewFormOpen() ? '@tui.chevron-up' : '@tui.chevron-down'" />
                {{ reviewFormOpen() ? 'Ukryj formularz' : 'Napisz opinię' }}
              </button>
              @if (reviewFormOpen()) {
                <form class="reviews__form" (ngSubmit)="submitReview()">
                  <div class="reviews__form-rating">
                    <span class="reviews__form-label">Twoja ocena *</span>
                    <tui-rating [(ngModel)]="reviewRating" name="rating" [max]="5" />
                  </div>
                  <tui-textfield>
                    <input tuiTextfield [(ngModel)]="reviewTitle" name="title"
                           placeholder="Tytuł (opcjonalnie)" maxlength="100" />
                  </tui-textfield>
                  <tui-textfield>
                    <textarea tuiTextarea [(ngModel)]="reviewBody" name="body"
                              maxlength="2000"
                              placeholder="Twoja opinia (opcjonalnie)…"></textarea>
                  </tui-textfield>
                  @if (reviewError()) {
                    <p class="reviews__form-error">{{ reviewError() }}</p>
                  }
                  <div class="reviews__form-actions">
                    <button tuiButton type="submit" appearance="accent" size="s"
                            [disabled]="reviewSubmitting() || reviewRating === 0">
                      {{ reviewSubmitting() ? 'Wysyłanie…' : 'Wyślij opinię' }}
                    </button>
                  </div>
                </form>
              }
            </div>
          } @else {
            <div class="reviews__submitted">
              <tui-icon icon="@tui.check-circle" />
              Dziękujemy! Twoja opinia zostanie opublikowana po moderacji.
            </div>
          }
        }

        <!-- Sort + list -->
        @if (reviewsLoading()) {
          <p class="reviews__loading">Ładowanie opinii…</p>
        } @else if (reviews().length === 0 && (product()!.reviewCount ?? 0) === 0) {
          <p class="reviews__empty">Bądź pierwszy — oceń ten produkt!</p>
        } @else {
          @if (reviews().length > 0) {
            <div class="reviews__sort">
              <button tuiButton type="button" size="s"
                      [appearance]="reviewSort() === 'recent' ? 'primary' : 'outline'"
                      (click)="setSort('recent')">Najnowsze</button>
              <button tuiButton type="button" size="s"
                      [appearance]="reviewSort() === 'helpful' ? 'primary' : 'outline'"
                      (click)="setSort('helpful')">Najbardziej pomocne</button>
            </div>

            <ul class="reviews__list">
              @for (review of reviews(); track review.id) {
                <li class="review-card">
                  <div class="review-card__header">
                    <span class="review-card__stars" aria-hidden="true">
                      @for (s of starsArray(review.rating); track $index) {
                        <tui-icon [icon]="'@tui.star'"
                                  [class.review-card__star--filled]="s !== 'empty'"
                                  [class.review-card__star--empty]="s === 'empty'" />
                      }
                    </span>
                    <span class="review-card__author">{{ review.authorName }}</span>
                    @if (review.verifiedPurchase) {
                      <span class="review-card__verified">
                        <tui-icon icon="@tui.badge-check" />
                        Zweryfikowany zakup
                      </span>
                    }
                    <time class="review-card__date">
                      {{ review.createdAt | date:'d MMM yyyy' : '' : 'pl' }}
                    </time>
                  </div>
                  @if (review.title) {
                    <p class="review-card__title">{{ review.title }}</p>
                  }
                  @if (review.body) {
                    <p class="review-card__body">{{ review.body }}</p>
                  }
                  @if (review.adminReply) {
                    <div class="review-card__reply">
                      <span class="review-card__reply-label">Odpowiedź Aromaterie:</span>
                      <p class="review-card__reply-body">{{ review.adminReply }}</p>
                    </div>
                  }
                  <button type="button" class="review-card__helpful"
                          (click)="markHelpful(review)">
                    <tui-icon icon="@tui.thumbs-up" />
                    Pomocna ({{ review.helpfulCount }})
                  </button>
                </li>
              }
            </ul>

            @if (reviewsMeta()?.totalPages && reviewsMeta()!.totalPages > reviewsPage()) {
              <button tuiButton type="button" appearance="outline" size="s"
                      class="reviews__load-more"
                      [disabled]="reviewsLoading()"
                      (click)="loadMoreReviews()">
                Załaduj więcej opinii
              </button>
            }
          }
        }
      </section>

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
    .detail__thumb-btn {
      padding: 0;
      background: none;
      border: 2px solid var(--color-border);
      border-radius: var(--border-radius-sm);
      cursor: pointer;
      transition: border-color 0.15s;
      flex-shrink: 0;
    }
    .detail__thumb-btn--active { border-color: var(--color-primary); }
    .detail__thumb-btn:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 2px; }
    .detail__thumb {
      width: 68px; height: 68px; object-fit: cover;
      border-radius: calc(var(--border-radius-sm) - 2px);
      display: block;
    }

    /* Info */
    .detail__brand {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em;
      color: var(--color-accent); margin: 0 0 6px; font-weight: 600;
    }
    .detail__name { font-size: clamp(20px, 4vw, 28px); font-weight: 700; margin: 0 0 12px; line-height: 1.25; }
    .detail__short-desc { color: var(--color-secondary); font-size: 14px; line-height: 1.6; margin: 0 0 24px; }

    /* Variants */
    .detail__label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-secondary); margin: 0 0 10px; }
    .detail__variants { margin-bottom: 24px; }
    .detail__variant-btns { display: flex; flex-wrap: wrap; gap: 8px; }

    .detail__variant-btn--oos {
      opacity: 0.4;
      text-decoration: line-through;
      cursor: not-allowed;
      pointer-events: auto;
    }

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

    /* Rating summary link */
    .detail__rating-summary {
      display: flex; align-items: center; gap: 6px;
      text-decoration: none; color: inherit; margin-bottom: 12px;
      width: fit-content;
    }
    .detail__rating-summary:hover .detail__rating-count { text-decoration: underline; }
    .detail__stars { display: flex; align-items: center; gap: 2px; }
    .detail__star--filled tui-icon, .detail__star--filled { color: #f5a623; font-size: 16px; }
    .detail__star--empty tui-icon, .detail__star--empty { color: var(--color-border); font-size: 16px; }
    .detail__rating-value { font-size: 14px; font-weight: 700; color: var(--color-primary); }
    .detail__rating-count { font-size: 13px; color: var(--color-secondary); }

    @media (max-width: 768px) {
      .detail { grid-template-columns: 1fr; gap: 32px; padding: 24px 0 48px; }
      .detail__gallery { position: static; }
    }
    @media (max-width: 480px) {
      .detail__cta { flex-wrap: wrap; }
      .detail__add-btn { width: 100%; }
    }

    /* ── Reviews section ───────────────────────────────────────── */
    .reviews {
      margin-top: 56px;
      padding-top: 40px;
      border-top: 1px solid var(--color-border);
    }
    .reviews__heading {
      font-size: 20px; font-weight: 700; margin: 0 0 24px;
    }

    /* Submit form */
    .reviews__form-wrap { margin-bottom: 32px; }
    .reviews__toggle-btn { margin-bottom: 16px; gap: 6px; }
    .reviews__form {
      display: flex; flex-direction: column; gap: 12px;
      max-width: 560px;
    }
    .reviews__form-rating {
      display: flex; align-items: center; gap: 12px;
    }
    .reviews__form-label { font-size: 13px; font-weight: 600; color: var(--color-secondary); }
    .reviews__form-error { font-size: 13px; color: var(--color-error); margin: 0; }
    .reviews__form-actions { display: flex; justify-content: flex-end; }
    .reviews__submitted {
      display: flex; align-items: center; gap: 8px;
      font-size: 14px; color: var(--color-success);
      padding: 12px 0; margin-bottom: 24px;
    }
    .reviews__submitted tui-icon { font-size: 18px; }

    /* Sort + list */
    .reviews__sort { display: flex; gap: 8px; margin-bottom: 20px; }
    .reviews__loading, .reviews__empty {
      font-size: 14px; color: var(--color-secondary); padding: 16px 0;
    }
    .reviews__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0; }
    .reviews__load-more { display: block; margin: 24px auto 0; }

    /* Review card */
    .review-card {
      padding: 20px 0;
      border-bottom: 1px solid var(--color-border);
    }
    .review-card:last-child { border-bottom: none; }
    .review-card__header {
      display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;
    }
    .review-card__stars { display: flex; gap: 2px; }
    .review-card__star--filled { color: #f5a623; font-size: 14px; }
    .review-card__star--empty { color: var(--color-border); font-size: 14px; }
    .review-card__author { font-size: 14px; font-weight: 600; color: var(--color-primary); }
    .review-card__verified {
      display: inline-flex; align-items: center; gap: 3px;
      font-size: 11px; font-weight: 600; color: var(--color-success);
      background: rgba(42,157,143,0.08); padding: 2px 6px; border-radius: 3px;
    }
    .review-card__verified tui-icon { font-size: 12px; }
    .review-card__date { font-size: 12px; color: var(--color-secondary); margin-left: auto; }
    .review-card__title { font-size: 14px; font-weight: 600; margin: 0 0 6px; }
    .review-card__body {
      font-size: 14px; color: var(--color-secondary); line-height: 1.6;
      margin: 0 0 10px; white-space: pre-line;
    }
    .review-card__reply {
      background: #fafafa; border-left: 3px solid var(--color-accent);
      padding: 10px 14px; border-radius: 0 4px 4px 0; margin: 8px 0;
    }
    .review-card__reply-label {
      font-size: 12px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--color-accent); display: block; margin-bottom: 4px;
    }
    .review-card__reply-body { font-size: 13px; color: var(--color-secondary); margin: 0; line-height: 1.5; }
    .review-card__helpful {
      background: none; border: none; cursor: pointer; padding: 0;
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 12px; color: var(--color-secondary);
      transition: color 0.15s;
    }
    .review-card__helpful:hover { color: var(--color-primary); }
    .review-card__helpful tui-icon { font-size: 14px; }
  `],
})
export class ProductDetailComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly cartService = inject(CartService);
  private readonly toast = inject(ToastService);
  private readonly seo = inject(SeoService);
  private readonly wishlist = inject(WishlistService);
  readonly auth = inject(AuthService);
  private readonly reviewsService = inject(ReviewsService);

  readonly loading = signal(true);
  readonly product = signal<ProductDetail | null>(null);
  readonly selectedVariant = signal<ProductVariantDetail | null>(null);
  readonly activeImage = signal<string | null>(null);
  readonly adding = signal(false);
  quantity = 1;
  descExpanded = false;

  // ── Reviews ──────────────────────────────────────────────────
  readonly reviews = signal<ReviewSummary[]>([]);
  readonly reviewsMeta = signal<{ totalPages: number; total: number } | null>(null);
  readonly reviewsLoading = signal(false);
  readonly reviewsPage = signal(1);
  readonly reviewSort = signal<'recent' | 'helpful'>('recent');

  readonly reviewFormOpen = signal(false);
  readonly reviewSubmitting = signal(false);
  readonly reviewSubmitted = signal(false);
  readonly reviewError = signal<string | null>(null);
  reviewRating = 0;
  reviewTitle = '';
  reviewBody = '';

  readonly wishlisted = computed(() => this.wishlist.isInWishlist(this.product()?.id ?? ''));

  readonly breadcrumbs = computed<Breadcrumb[]>(() => {
    const p = this.product();
    const catSlug = p?.category?.slug ?? null;
    const catLabel = catSlug ? (CATEGORY_LABELS[catSlug] ?? p?.category?.name ?? catSlug) : null;
    const crumbs: Breadcrumb[] = [{ label: 'Strona główna', link: '/' }];
    if (catSlug && catLabel) crumbs.push({ label: catLabel, link: `/category/${catSlug}` });
    if (p) crumbs.push({ label: p.name });
    return crumbs;
  });

  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('slug')!;
    this.http
      .get<ProductDetail>(`${environment.apiUrl}/products/${slug}`)
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
            avgRating: p.avgRating,
            reviewCount: p.reviewCount,
          };
          this.seo.updateProductMeta(seoInput);
          this.seo.setProductJsonLd(seoInput);
          this.loading.set(false);
          this.loadReviews(p.id);

          if (this.route.snapshot.queryParamMap.get('review') === '1') {
            this.reviewFormOpen.set(true);
            setTimeout(() => {
              document.getElementById('reviews')?.scrollIntoView({ behavior: 'smooth' });
            }, 300);
          }
        },
        error: () => this.loading.set(false),
      });
  }

  private loadReviews(productId: string, append = false): void {
    this.reviewsLoading.set(true);
    this.reviewsService
      .getByProduct(productId, this.reviewsPage(), this.reviewSort())
      .subscribe({
        next: (res) => {
          this.reviews.set(append ? [...this.reviews(), ...res.data] : res.data);
          this.reviewsMeta.set(res.meta);
          this.reviewsLoading.set(false);
        },
        error: () => this.reviewsLoading.set(false),
      });
  }

  setSort(sort: 'recent' | 'helpful'): void {
    if (this.reviewSort() === sort) return;
    this.reviewSort.set(sort);
    this.reviewsPage.set(1);
    const pid = this.product()?.id;
    if (pid) this.loadReviews(pid);
  }

  loadMoreReviews(): void {
    this.reviewsPage.update((p) => p + 1);
    const pid = this.product()?.id;
    if (pid) this.loadReviews(pid, true);
  }

  submitReview(): void {
    if (this.reviewRating === 0) return;
    const productId = this.product()?.id;
    if (!productId) return;

    this.reviewSubmitting.set(true);
    this.reviewError.set(null);

    this.reviewsService
      .submit({
        productId,
        rating: this.reviewRating,
        title: this.reviewTitle.trim() || undefined,
        body: this.reviewBody.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.reviewSubmitted.set(true);
          this.reviewSubmitting.set(false);
          this.reviewFormOpen.set(false);
        },
        error: (err) => {
          const msg = err?.error?.message;
          this.reviewError.set(
            typeof msg === 'string' ? msg : 'Nie udało się wysłać opinii. Spróbuj ponownie.',
          );
          this.reviewSubmitting.set(false);
        },
      });
  }

  markHelpful(review: ReviewSummary): void {
    this.reviewsService.markHelpful(review.id).subscribe({
      next: (res) => {
        this.reviews.update((list) =>
          list.map((r) => (r.id === review.id ? { ...r, helpfulCount: res.helpfulCount } : r)),
        );
      },
    });
  }

  scrollToReviews(): void {
    document.getElementById('reviews')?.scrollIntoView({ behavior: 'smooth' });
  }

  starsArray(rating: number): ('full' | 'half' | 'empty')[] {
    return Array.from({ length: 5 }, (_, i) => {
      const val = i + 1;
      if (rating >= val) return 'full';
      if (rating >= val - 0.5) return 'half';
      return 'empty';
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
    const wasWishlisted = this.wishlisted();
    const data: ProductCardData = {
      id: p.id,
      name: p.name,
      slug: p.slug,
      brand: p.brand,
      images: p.images,
      variants: p.variants,
    };
    this.wishlist.toggle(data);
    if (wasWishlisted) {
      this.toast.info('Usunięto z ulubionych');
    } else {
      this.toast.success('Dodano do ulubionych!');
    }
  }
}
