import { Component, HostListener, OnDestroy, OnInit, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { Subscription } from 'rxjs';
import { isPlatformBrowser, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { TuiButton, TuiGroup, TuiIcon, TuiTextfield } from '@taiga-ui/core';
import { TuiElasticContainer, TuiSlides } from '@taiga-ui/kit';
import { TuiExpand } from '@taiga-ui/experimental';
import { TuiCounter, TuiRating, TuiTextarea } from '@taiga-ui/kit';
import { TuiSkeleton } from '@taiga-ui/kit/directives/skeleton';
import { environment } from '../../../../environments/environment';
import { CartService } from '../../../core/services/cart.service';
import { ToastService } from '../../../core/services/toast.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { SeoService } from '../../../core/services/seo.service';
import { WishlistService } from '../../../core/services/wishlist.service';
import { AuthService } from '../../../core/services/auth.service';
import { StockStreamService } from '../../../core/services/stock-stream.service';
import { ReviewsService, ReviewSummary } from '../../../core/services/reviews.service';
import { PricePipe } from '../../../shared/pipes/price.pipe';
import { ProductCardComponent, ProductCardData } from '../../../shared/product-card/product-card.component';
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
  catalogNumber?: string | null;
  pyramidTop?: string | null;
  pyramidHeart?: string | null;
  pyramidBase?: string | null;
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
  imports: [FormsModule, TuiButton, TuiGroup, TuiIcon, TuiExpand, TuiCounter, TuiRating, TuiTextfield, TuiTextarea, TuiElasticContainer, TuiSlides, PricePipe, BreadcrumbComponent, ProductCardComponent, TuiSkeleton],
  template: `
    @if (loading()) {
      <div class="skeleton-detail">
        <div class="skeleton-detail__gallery">
          <div class="skeleton-detail__main-img" tuiSkeleton></div>
          <div class="skeleton-detail__thumbs">
            <div class="skeleton-detail__thumb" tuiSkeleton></div>
            <div class="skeleton-detail__thumb" tuiSkeleton></div>
            <div class="skeleton-detail__thumb" tuiSkeleton></div>
          </div>
        </div>
        <div class="skeleton-detail__info">
          <div class="skeleton-detail__brand" tuiSkeleton>Brand name</div>
          <div class="skeleton-detail__name" tuiSkeleton>Product name placeholder long text</div>
          <div class="skeleton-detail__price" tuiSkeleton>000,00 zł</div>
          <div class="skeleton-detail__variants">
            <div class="skeleton-detail__variant" tuiSkeleton>50ml</div>
            <div class="skeleton-detail__variant" tuiSkeleton>100ml</div>
            <div class="skeleton-detail__variant" tuiSkeleton>200ml</div>
          </div>
          <div class="skeleton-detail__btn" tuiSkeleton>Dodaj do koszyka</div>
        </div>
      </div>
    } @else if (product()) {
      <div class="page">
        <app-breadcrumb [crumbs]="breadcrumbs()"/>
        <button tuiButton appearance="flat" size="s" type="button" class="back-btn" (click)="back()">
          <tui-icon icon="@tui.chevron-left" />
          Wróć
        </button>
      </div>
      <div class="detail">

        <!-- Gallery -->
        <div class="detail__gallery">
          @if (activeImage()) {
            <button type="button" class="detail__main-img-btn" (click)="openLightbox(activeImageIndex())" aria-label="Powiększ zdjęcie">
              <img [src]="activeImage()!" [alt]="product()!.name" class="detail__main-img"/>
              <span class="detail__zoom-icon" aria-hidden="true"><tui-icon icon="@tui.zoom-in"/></span>
            </button>
          }
          @if (product()!.images.length > 1) {
            <div class="detail__thumbs" role="group" aria-label="Miniatury zdjęć">
              @for (img of product()!.images; track img.url; let i = $index) {
                <button
                    type="button"
                    class="detail__thumb-btn"
                    [class.detail__thumb-btn--active]="activeImage() === img.url"
                    [attr.aria-label]="'Zdjęcie ' + (i + 1)"
                    [attr.aria-pressed]="activeImage() === img.url"
                    (click)="activeImage.set(img.url)">
                  <img [src]="img.url" [alt]="" class="detail__thumb"/>
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
          <h1 class="detail__name">
            {{ product()!.name }}@if (product()!.catalogNumber) {<span class="detail__catalog-no"> NO.&nbsp;{{ product()!.catalogNumber }}</span>}
          </h1>

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
            <a class="detail__rating-summary" role="button" style="cursor:pointer" aria-label="Przejdź do opinii"
               (click)="scrollToReviews()">
              <span class="detail__stars" aria-hidden="true">
                @for (s of starsArray(product()!.avgRating ?? 0); track $index) {
                  <tui-icon [icon]="s === 'full' ? '@tui.star' : s === 'half' ? '@tui.star-half' : '@tui.star'"
                            [class.detail__star--filled]="s !== 'empty'"
                            [class.detail__star--empty]="s === 'empty'"></tui-icon>
                }
              </span>
              <span class="detail__rating-value">{{ product()!.avgRating?.toFixed(1) }}</span>
              <span
                  class="detail__rating-count">({{ product()!.reviewCount }} {{ product()!.reviewCount === 1 ? 'opinia' : product()!.reviewCount! <= 4 ? 'opinie' : 'opinii' }}
                )</span>
            </a>
          }

          <!-- Price + stock -->
          @if (selectedVariant()) {
            <div class="detail__price-row">
              <span class="detail__price">{{ selectedVariant()!.priceInCents | price }}</span>
              @if (selectedVariant()!.stock > 0) {
                <span class="detail__stock detail__stock--ok">
                  <tui-icon icon="@tui.check-circle"></tui-icon>
                  Dostępny · {{ selectedVariant()!.stock }} szt.
                  @if (stockLive()) {
                    <span class="detail__live-badge" title="Stan aktualizowany na bieżąco">
                      <span class="detail__live-dot"></span>live
                    </span>
                  }
                </span>
              } @else {
                <span class="detail__stock detail__stock--out">
                  <tui-icon icon="@tui.x-circle"></tui-icon>
                  Brak w magazynie
                  @if (stockLive()) {
                    <span class="detail__live-badge detail__live-badge--out" title="Stan aktualizowany na bieżąco">
                      <span class="detail__live-dot"></span>live
                    </span>
                  }
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
                    aria-hidden="true">
                </tui-icon>
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
                <tui-icon [icon]="descExpanded ? '@tui.chevron-up' : '@tui.chevron-down'" aria-hidden="true"></tui-icon>
              </button>
              <tui-expand [expanded]="descExpanded">
                <div id="product-description" class="detail__desc-body">{{ product()!.description }}</div>
              </tui-expand>
            </div>
          }

          <!-- Olfactory pyramid -->
          @if (product()!.pyramidTop || product()!.pyramidHeart || product()!.pyramidBase) {
            <div class="detail__pyramid">
              <p class="detail__pyramid-title">Piramida zapachowa</p>
              @if (product()!.pyramidTop) {
                <div class="detail__pyramid-row">
                  <span class="detail__pyramid-label">Głowa</span>
                  <span class="detail__pyramid-notes">{{ product()!.pyramidTop }}</span>
                </div>
              }
              @if (product()!.pyramidHeart) {
                <div class="detail__pyramid-row">
                  <span class="detail__pyramid-label">Serce</span>
                  <span class="detail__pyramid-notes">{{ product()!.pyramidHeart }}</span>
                </div>
              }
              @if (product()!.pyramidBase) {
                <div class="detail__pyramid-row">
                  <span class="detail__pyramid-label">Baza</span>
                  <span class="detail__pyramid-notes">{{ product()!.pyramidBase }}</span>
                </div>
              }
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
                <tui-icon [icon]="reviewFormOpen() ? '@tui.chevron-up' : '@tui.chevron-down'"></tui-icon>
                {{ reviewFormOpen() ? 'Ukryj formularz' : 'Napisz opinię' }}
              </button>
              @if (reviewFormOpen()) {
                <form class="reviews__form" (ngSubmit)="submitReview()">
                  <div class="reviews__form-rating">
                    <span class="reviews__form-label">Twoja ocena *</span>
                    <tui-rating [(ngModel)]="reviewRating" name="rating" [max]="5"></tui-rating>
                  </div>
                  <tui-textfield>
                    <input tuiTextfield [(ngModel)]="reviewTitle" name="title"
                           placeholder="Tytuł (opcjonalnie)" maxlength="100"/>
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
              <tui-icon icon="@tui.check-circle"></tui-icon>
              Dziękujemy! Twoja opinia zostanie opublikowana po moderacji.
            </div>
          }
        }

        <!-- Sort + list -->
        @if (reviewsLoading()) {
          <p class="reviews__loading">Ładowanie opinii…</p>
        } @else if (reviews().length === 0 && (product()!.reviewCount ?? 0) === 0) {
          <p class="reviews__empty">Bądź pierwszy/a — oceń ten produkt!</p>
        } @else {
          @if (reviews().length > 0) {
            <div class="reviews__sort">
              <button tuiButton type="button" size="s"
                      [appearance]="reviewSort() === 'recent' ? 'primary' : 'outline'"
                      (click)="setSort('recent')">Najnowsze
              </button>
              <button tuiButton type="button" size="s"
                      [appearance]="reviewSort() === 'helpful' ? 'primary' : 'outline'"
                      (click)="setSort('helpful')">Najbardziej pomocne
              </button>
            </div>

            <ul class="reviews__list">
              @for (review of reviews(); track review.id) {
                <li class="review-card">
                  <div class="review-card__header">
                    <span class="review-card__stars" aria-hidden="true">
                      @for (s of starsArray(review.rating); track $index) {
                        <tui-icon [icon]="'@tui.star'"
                                  [class.review-card__star--filled]="s !== 'empty'"
                                  [class.review-card__star--empty]="s === 'empty'"></tui-icon>
                      }
                    </span>
                    <span class="review-card__author">{{ review.authorName }}</span>
                    @if (review.verifiedPurchase) {
                      <span class="review-card__verified">
                        <tui-icon icon="@tui.badge-check"></tui-icon>
                        Zweryfikowany zakup
                      </span>
                    }
                    <time class="review-card__date">
                      {{ formatDate(review.createdAt) }}
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
                    <tui-icon icon="@tui.thumbs-up"></tui-icon>
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

      <!-- Related products -->
      @if (pages().length > 0) {
        <section class="related">
          <div class="related__header">
            <h2 class="related__heading">Może Ci się spodobać</h2>
            @if (pages().length > 1) {
              <div tuiGroup>
                <button
                  appearance="secondary"
                  iconStart="@tui.chevron-left"
                  size="m"
                  tuiIconButton
                  type="button"
                  (click)="prevSlide()">
                  Previous
                </button>
                <button
                  appearance="secondary"
                  iconStart="@tui.chevron-right"
                  size="m"
                  tuiIconButton
                  type="button"
                  (click)="nextSlide()">
                  Next
                </button>
              </div>
            }
          </div>
          <tui-elastic-container>
            <section tuiSlides>
              @for (page of pages(); track $index) {
                @if ($index === slideIndex()) {
                  <div class="related__grid">
                    @for (p of page; track p.id) {
                      <app-product-card [product]="p"/>
                    }
                  </div>
                }
              }
            </section>
          </tui-elastic-container>
        </section>
      }

      <!-- Lightbox -->
      @if (lightboxOpen()) {
        <div class="lightbox" role="dialog" aria-modal="true" aria-label="Galeria zdjęć" tabindex="-1">
          <div class="lightbox__backdrop" (click)="closeLightbox()"></div>
          <div class="lightbox__ui">
            <div class="lightbox__header">
              @if (product()!.images.length > 1) {
                <span class="lightbox__counter">{{ lightboxIndex() + 1 }} / {{ product()!.images.length }}</span>
              }
              <button type="button" class="lightbox__close" (click)="closeLightbox()" aria-label="Zamknij">
                <tui-icon icon="@tui.x"/>
              </button>
            </div>
            <div class="lightbox__stage">
              @if (product()!.images.length > 1) {
                <button type="button" class="lightbox__nav lightbox__nav--prev" (click)="lightboxPrev()" aria-label="Poprzednie zdjęcie">
                  <tui-icon icon="@tui.chevron-left"/>
                </button>
              }
              <img [src]="product()!.images[lightboxIndex()].url" [alt]="product()!.name" class="lightbox__img"/>
              @if (product()!.images.length > 1) {
                <button type="button" class="lightbox__nav lightbox__nav--next" (click)="lightboxNext()" aria-label="Następne zdjęcie">
                  <tui-icon icon="@tui.chevron-right"/>
                </button>
              }
            </div>
            @if (product()!.images.length > 1) {
              <div class="lightbox__thumbs">
                @for (img of product()!.images; track img.url; let i = $index) {
                  <button type="button"
                          class="lightbox__thumb-btn"
                          [class.lightbox__thumb-btn--active]="i === lightboxIndex()"
                          [attr.aria-label]="'Zdjęcie ' + (i + 1)"
                          [attr.aria-pressed]="i === lightboxIndex()"
                          (click)="lightboxGoTo(i)">
                    <img [src]="img.url" [alt]="" class="lightbox__thumb"/>
                  </button>
                }
              </div>
            }
          </div>
        </div>
      }

    }
  `,
  styles: [`
    /* ── Skeleton ───────────────────────────────────────────── */
    .skeleton-detail {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 56px;
      padding: 32px 0 64px;
      align-items: start;
    }
    .skeleton-detail__gallery { display: flex; flex-direction: column; gap: 12px; }
    .skeleton-detail__main-img { aspect-ratio: 1/1; border-radius: var(--border-radius-md); width: 100%; }
    .skeleton-detail__thumbs { display: flex; gap: 8px; }
    .skeleton-detail__thumb { width: 72px; height: 72px; border-radius: var(--border-radius-sm); flex-shrink: 0; }
    .skeleton-detail__info { display: flex; flex-direction: column; gap: 16px; }
    .skeleton-detail__brand { height: 16px; width: 30%; border-radius: 4px; }
    .skeleton-detail__name { height: 32px; width: 80%; border-radius: 4px; }
    .skeleton-detail__price { height: 28px; width: 40%; border-radius: 4px; }
    .skeleton-detail__variants { display: flex; gap: 8px; }
    .skeleton-detail__variant { height: 36px; width: 64px; border-radius: var(--border-radius-sm); }
    .skeleton-detail__btn { height: 48px; width: 100%; border-radius: var(--border-radius-sm); margin-top: 8px; }
    @media (max-width: 768px) {
      .skeleton-detail { grid-template-columns: 1fr; gap: 24px; }
    }

    .page { padding: 32px 0 0; }
    .back-btn { margin-bottom: 8px; }

    .detail {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 56px;
      padding: 0 0 64px;
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
    .detail__name { font-size: clamp(20px, 4vw, 28px); font-weight: 700; margin: 0 0 12px; line-height: 1.35; }
    .detail__catalog-no { font-size: 0.72em; font-weight: 500; color: var(--color-secondary); letter-spacing: 0.03em; white-space: nowrap; }

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
    .detail__live-badge {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
      text-transform: uppercase; color: var(--color-success);
      background: rgba(42,157,143,0.1); padding: 2px 6px; border-radius: 3px;
    }
    .detail__live-badge--out { color: var(--color-error); background: rgba(220,53,69,0.08); }
    .detail__live-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: currentColor; flex-shrink: 0;
      animation: live-pulse 1.8s ease-in-out infinite;
    }
    @keyframes live-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.35; transform: scale(0.7); }
    }

    /* CTA row */
    .detail__cta { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
    .detail__add-btn { flex: 1; }
    .detail__wishlist-btn { flex-shrink: 0; }
    .detail__wishlist-btn--active tui-icon { color: var(--color-error); }

    /* Description expand */
    .detail__desc-section { border-top: 1px solid var(--color-border); padding-top: 16px; margin-bottom: 16px; }
    .detail__expand-btn { display: flex; align-items: center; gap: 6px; }
    .detail__desc-body { padding: 16px 0 4px; font-size: 14px; line-height: 1.7; color: var(--color-secondary); white-space: pre-line; }

    /* Olfactory pyramid */
    .detail__pyramid {
      border-top: 1px solid var(--color-border);
      padding-top: 16px;
      margin-top: 4px;
    }
    .detail__pyramid-title {
      font-size: 12px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--color-secondary);
      margin: 0 0 12px;
    }
    .detail__pyramid-row {
      display: flex; justify-content: space-between; align-items: baseline;
      padding: 8px 0; border-bottom: 1px solid var(--color-border);
      font-size: 14px; gap: 16px;
    }
    .detail__pyramid-row:last-child { border-bottom: none; }
    .detail__pyramid-label {
      flex-shrink: 0; font-weight: 600; color: var(--color-accent);
      font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;
      min-width: 52px;
    }
    .detail__pyramid-notes { color: var(--color-secondary); text-align: right; line-height: 1.5; }

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
      .page { padding-top: 24px; }
      .detail { grid-template-columns: 1fr; gap: 32px; padding: 0 0 48px; }
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

    /* ── Zoom button ───────────────────────────────────────────── */
    .detail__main-img-btn {
      position: relative; display: block; padding: 0;
      background: none; border: none; cursor: zoom-in;
      width: 100%; border-radius: var(--border-radius-md); overflow: hidden;
    }
    .detail__main-img-btn .detail__main-img { transition: transform 0.3s ease; }
    .detail__main-img-btn:hover .detail__main-img { transform: scale(1.025); }
    .detail__zoom-icon {
      position: absolute; bottom: 12px; right: 12px;
      width: 36px; height: 36px; border-radius: 50%;
      background: rgba(0,0,0,0.48); color: #fff; font-size: 16px;
      display: flex; align-items: center; justify-content: center;
      opacity: 0; transition: opacity 0.2s; pointer-events: none;
    }
    .detail__main-img-btn:hover .detail__zoom-icon { opacity: 1; }

    /* ── Related products ─────────────────────────────────────── */
    .related {
      margin-top: 64px;
      padding-top: 40px;
      padding-bottom: 40px;
      border-top: 1px solid var(--color-border);
    }
    .related__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 28px;
    }
    .related__heading {
      font-size: 20px; font-weight: 700; margin: 0;
    }
    .related__grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 24px;
      --tui-duration: 0.5s;
    }
    @media (max-width: 1024px) {
      .related__grid { grid-template-columns: repeat(3, 1fr); }
    }
    @media (max-width: 768px) {
      .related__grid { grid-template-columns: repeat(2, 1fr); gap: 16px; }
    }
    @media (max-width: 480px) {
      .related__grid { grid-template-columns: 1fr; gap: 12px; }
    }

    /* ── Lightbox ──────────────────────────────────────────────── */
    @keyframes lb-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes lb-scale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }

    .lightbox {
      position: fixed; inset: 0; z-index: 9999;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      animation: lb-fade 0.2s ease;
    }
    .lightbox__backdrop {
      position: absolute; inset: 0;
      background: rgba(0,0,0,0.92);
      backdrop-filter: blur(4px);
    }
    .lightbox__ui {
      position: relative; z-index: 1;
      display: flex; flex-direction: column; align-items: center;
      width: 100%; height: 100%; padding: 16px; box-sizing: border-box;
    }
    .lightbox__header {
      display: flex; align-items: center; justify-content: space-between;
      width: 100%; max-width: 1200px; padding-bottom: 12px;
    }
    .lightbox__counter { font-size: 13px; color: rgba(255,255,255,0.65); font-weight: 500; }
    .lightbox__close {
      margin-left: auto; width: 40px; height: 40px; border-radius: 50%;
      border: none; background: rgba(255,255,255,0.12); color: #fff;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      font-size: 18px; transition: background 0.15s;
    }
    .lightbox__close:hover { background: rgba(255,255,255,0.22); }
    .lightbox__stage {
      flex: 1; display: flex; align-items: center; justify-content: center;
      position: relative; width: 100%; max-width: 1200px; min-height: 0;
    }
    .lightbox__img {
      max-width: 100%; max-height: 100%; object-fit: contain;
      border-radius: var(--border-radius-md);
      animation: lb-scale 0.25s ease; user-select: none;
    }
    .lightbox__nav {
      position: absolute; top: 50%; transform: translateY(-50%);
      width: 48px; height: 48px; border-radius: 50%;
      border: none; background: rgba(255,255,255,0.12); color: #fff;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      font-size: 20px; transition: background 0.15s; z-index: 2;
    }
    .lightbox__nav:hover { background: rgba(255,255,255,0.22); }
    .lightbox__nav--prev { left: 0; }
    .lightbox__nav--next { right: 0; }
    .lightbox__thumbs {
      display: flex; gap: 8px; padding: 12px 0 4px;
      overflow-x: auto; justify-content: center; max-width: 100%;
    }
    .lightbox__thumb-btn {
      flex-shrink: 0; padding: 0; background: none;
      border: 2px solid transparent; border-radius: var(--border-radius-sm);
      cursor: pointer; opacity: 0.45; transition: opacity 0.15s, border-color 0.15s;
    }
    .lightbox__thumb-btn--active { opacity: 1; border-color: #fff; }
    .lightbox__thumb-btn:hover { opacity: 0.8; }
    .lightbox__thumb {
      width: 60px; height: 60px; object-fit: cover;
      border-radius: calc(var(--border-radius-sm) - 2px); display: block;
    }
  `],
})
export class ProductDetailComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly cartService = inject(CartService);
  private readonly toast = inject(ToastService);
  private readonly seo = inject(SeoService);
  private readonly wishlist = inject(WishlistService);
  readonly auth = inject(AuthService);
  private readonly reviewsService = inject(ReviewsService);
  private readonly stockStream = inject(StockStreamService);
  private readonly analytics = inject(AnalyticsService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly loading = signal(true);
  readonly product = signal<ProductDetail | null>(null);
  readonly relatedProducts = signal<ProductCardData[]>([]);
  readonly slideIndex = signal(0);
  readonly itemsPerPage = signal(4);
  readonly pages = computed(() => {
    const items = this.relatedProducts();
    const n = this.itemsPerPage();
    const result: ProductCardData[][] = [];
    for (let i = 0; i < items.length; i += n) result.push(items.slice(i, i + n));
    return result;
  });
  readonly selectedVariant = signal<ProductVariantDetail | null>(null);
  readonly activeImage = signal<string | null>(null);
  readonly adding = signal(false);
  quantity = 1;
  descExpanded = true;

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

  readonly stockLive = signal(false);
  private stockSub?: Subscription;

  readonly lightboxOpen = signal(false);
  readonly lightboxIndex = signal(0);
  readonly activeImageIndex = computed(() => {
    const url = this.activeImage();
    const imgs = this.product()?.images ?? [];
    const idx = imgs.findIndex(i => i.url === url);
    return idx >= 0 ? idx : 0;
  });

  readonly breadcrumbs = computed<Breadcrumb[]>(() => {
    const p = this.product();
    const catSlug = p?.category?.slug ?? null;
    const catLabel = catSlug ? (CATEGORY_LABELS[catSlug] ?? p?.category?.name ?? catSlug) : null;
    const crumbs: Breadcrumb[] = [{ label: 'Strona główna', link: '/' }];
    if (catSlug && catLabel) crumbs.push({ label: catLabel, link: `/category/${catSlug}` });
    if (p) crumbs.push({ label: p.name });
    return crumbs;
  });

  openLightbox(index: number): void {
    this.lightboxIndex.set(index);
    this.lightboxOpen.set(true);
    if (isPlatformBrowser(this.platformId)) document.body.style.overflow = 'hidden';
  }

  closeLightbox(): void {
    this.lightboxOpen.set(false);
    if (isPlatformBrowser(this.platformId)) document.body.style.overflow = '';
  }

  lightboxNext(): void {
    const imgs = this.product()?.images ?? [];
    if (!imgs.length) return;
    const next = (this.lightboxIndex() + 1) % imgs.length;
    this.lightboxIndex.set(next);
    this.activeImage.set(imgs[next].url);
  }

  lightboxPrev(): void {
    const imgs = this.product()?.images ?? [];
    if (!imgs.length) return;
    const prev = (this.lightboxIndex() - 1 + imgs.length) % imgs.length;
    this.lightboxIndex.set(prev);
    this.activeImage.set(imgs[prev].url);
  }

  lightboxGoTo(index: number): void {
    const imgs = this.product()?.images ?? [];
    this.lightboxIndex.set(index);
    this.activeImage.set(imgs[index].url);
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent): void {
    if (!this.lightboxOpen()) return;
    if (e.key === 'Escape') this.closeLightbox();
    else if (e.key === 'ArrowRight') this.lightboxNext();
    else if (e.key === 'ArrowLeft') this.lightboxPrev();
  }

  ngOnDestroy(): void {
    if (isPlatformBrowser(this.platformId)) {
      document.body.style.overflow = '';
    }
    this.stockSub?.unsubscribe();
  }

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) this.updateItemsPerPage();
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
          this.loadRelatedProducts(p.slug);
          this.subscribeStockStream(p.variants.map((v) => v.id));

          if (this.route.snapshot.queryParamMap.get('review') === '1') {
            this.reviewFormOpen.set(true);
            if (isPlatformBrowser(this.platformId)) {
              setTimeout(() => {
                document.getElementById('reviews')?.scrollIntoView({ behavior: 'smooth' });
              }, 300);
            }
          }
        },
        error: () => this.loading.set(false),
      });
  }

  private subscribeStockStream(variantIds: string[]): void {
    if (!variantIds.length) return;
    this.stockSub = this.stockStream.connect(variantIds).subscribe({
      next: (updates) => {
        this.stockLive.set(true);
        this.product.update((prod) => {
          if (!prod) return prod;
          return {
            ...prod,
            variants: prod.variants.map((v) => {
              const u = updates.find((u) => u.id === v.id);
              return u ? { ...v, stock: u.stock } : v;
            }),
          };
        });
        const sv = this.selectedVariant();
        if (sv) {
          const u = updates.find((u) => u.id === sv.id);
          if (u && u.stock !== sv.stock) this.selectedVariant.set({ ...sv, stock: u.stock });
        }
      },
      error: () => this.stockLive.set(false),
    });
  }

  private loadRelatedProducts(slug: string): void {
    this.http
      .get<ProductCardData[]>(`${environment.apiUrl}/products/${slug}/related?limit=6`)
      .subscribe({ next: (data) => this.relatedProducts.set(data) });
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
    if (isPlatformBrowser(this.platformId)) {
      document.getElementById('reviews')?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  formatDate(value: string | Date): string {
    return new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
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
          const p = this.product();
          this.analytics.trackAddToCart({
            itemId: variant.id,
            name: p?.name ?? '',
            brand: p?.brand,
            variantLabel: variant.label,
            category: p?.category?.name,
            priceInCents: variant.priceInCents,
            quantity: this.quantity,
          });
          this.toast.success('Dodano do koszyka!');
          this.adding.set(false);
        },
        error: () => {
          this.toast.error('Nie udało się dodać do koszyka.');
          this.adding.set(false);
        },
      });
  }

  back(): void { this.location.back(); }

  nextSlide(): void {
    this.slideIndex.update(i => (i + 1) % this.pages().length);
  }

  prevSlide(): void {
    this.slideIndex.update(i => (i - 1 + this.pages().length) % this.pages().length);
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (isPlatformBrowser(this.platformId)) this.updateItemsPerPage();
  }

  private updateItemsPerPage(): void {
    const w = window.innerWidth;
    const n = w >= 1024 ? 4 : w >= 768 ? 3 : w >= 480 ? 2 : 1;
    if (n !== this.itemsPerPage()) {
      this.itemsPerPage.set(n);
      this.slideIndex.set(0);
    }
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
