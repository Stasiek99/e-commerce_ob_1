import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { SeoService } from '../../../core/services/seo.service';
import { ProductCardComponent, ProductCardData } from '../../../shared/product-card/product-card.component';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [ProductCardComponent],
  template: `
    <div class="page">
      <h1>Produkty</h1>
      @if (loading()) {
        <div class="grid">
          @for (_ of skeletons; track $index) {
            <div class="skeleton-card">
              <div class="skeleton-image"></div>
              <div class="skeleton-body">
                <div class="skeleton-line skeleton-line--title"></div>
                <div class="skeleton-line skeleton-line--brand"></div>
                <div class="skeleton-line skeleton-line--price"></div>
              </div>
              <div class="skeleton-btn"></div>
            </div>
          }
        </div>
      } @else {
        <div class="grid">
          @for (product of products(); track product.id) {
            <app-product-card [product]="product" />
          } @empty {
            <p class="empty">Brak produktów.</p>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 32px 0; }
    h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: 32px; color: var(--color-primary); }
    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
    }
    @media (min-width: 480px) {
      .grid { grid-template-columns: repeat(2, 1fr); gap: 20px; }
    }
    @media (min-width: 768px) {
      .grid { grid-template-columns: repeat(3, 1fr); gap: 24px; }
    }
    @media (min-width: 1200px) {
      .grid { grid-template-columns: repeat(4, 1fr); }
    }
    .empty { color: var(--color-secondary); }

    /* ── Skeleton loader ─────────────────────────────────── */
    @keyframes shimmer {
      0%   { background-position: -400% 0; }
      100% { background-position:  400% 0; }
    }
    .skeleton-card {
      border-radius: 8px;
      overflow: hidden;
      background: var(--color-surface);
      box-shadow: 0 2px 8px rgba(0,0,0,.07);
      display: flex;
      flex-direction: column;
    }
    .skeleton-image {
      aspect-ratio: 1;
      background: linear-gradient(90deg, #f0ede8 25%, #e8e3dc 50%, #f0ede8 75%);
      background-size: 400% 100%;
      animation: shimmer 1.6s infinite;
    }
    .skeleton-body { padding: 14px 16px 8px; display: flex; flex-direction: column; gap: 8px; }
    .skeleton-line {
      border-radius: 4px;
      background: linear-gradient(90deg, #f0ede8 25%, #e8e3dc 50%, #f0ede8 75%);
      background-size: 400% 100%;
      animation: shimmer 1.6s infinite;
    }
    .skeleton-line--title  { height: 16px; width: 80%; animation-delay: .1s; }
    .skeleton-line--brand  { height: 11px; width: 45%; animation-delay: .15s; }
    .skeleton-line--price  { height: 14px; width: 35%; margin-top: 4px; animation-delay: .2s; }
    .skeleton-btn {
      margin: 8px 12px 12px;
      height: 40px;
      border-radius: 6px;
      background: linear-gradient(90deg, #f0ede8 25%, #e8e3dc 50%, #f0ede8 75%);
      background-size: 400% 100%;
      animation: shimmer 1.6s infinite;
      animation-delay: .25s;
    }
  `],
})
export class ProductListComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);

  readonly loading = signal(true);
  readonly products = signal<ProductCardData[]>([]);
  readonly skeletons = Array(8);

  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('slug');
    const params = slug ? `?category=${slug}` : '';

    this.seo.updatePageMeta({
      title: slug ? `Kategoria: ${slug}` : 'Wszystkie produkty',
      description: slug
        ? `Perfumy, dyfuzory i żele z kategorii ${slug}. Premium zapachy w Fragrance Store.`
        : 'Odkryj pełną kolekcję perfum, dyfuzorów i żeli pod prysznic premium.',
    });

    this.http
      .get<any>(`${environment.apiUrl}/products${params}`)
      .subscribe({
        next: (res) => {
          this.products.set(res.data ?? []);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }
}
