import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { TuiPagination } from '@taiga-ui/kit';
import { environment } from '../../../../environments/environment';
import { SeoService } from '../../../core/services/seo.service';
import { ProductCardComponent, ProductCardData } from '../../../shared/product-card/product-card.component';
import { BreadcrumbComponent, Breadcrumb } from '../../../shared/components/breadcrumb/breadcrumb.component';

const CATEGORY_LABELS: Record<string, string> = {
  perfume: 'Perfumy',
  diffusers: 'Dyfuzory',
  gels: 'Żele pod prysznic',
};

const PAGE_SIZE = 20;

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [ProductCardComponent, BreadcrumbComponent, TuiPagination],
  template: `
    <div class="page">
      @if (slug()) {
        <app-breadcrumb [crumbs]="breadcrumbs()" />
      }
      <h1>{{ pageTitle() }}</h1>
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

        @if (totalPages() > 1) {
          <div class="pagination">
            <tui-pagination
              [index]="pageIndex()"
              [length]="totalPages()"
              (indexChange)="goToPage($event)"
            />
          </div>
        }
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
    .pagination { display: flex; justify-content: center; margin-top: 40px; }

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
  readonly pageIndex = signal(0);
  readonly totalPages = signal(1);
  readonly skeletons = Array(8);

  readonly slug = signal<string | null>(null);

  readonly pageTitle = computed(() => {
    const s = this.slug();
    return s ? (CATEGORY_LABELS[s] ?? s) : 'Wszystkie produkty';
  });

  readonly breadcrumbs = computed<Breadcrumb[]>(() => [
    { label: 'Strona główna', link: '/' },
    { label: this.pageTitle() },
  ]);

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const slug = params.get('slug');
      this.slug.set(slug);
      this.pageIndex.set(0);

      const label = slug ? (CATEGORY_LABELS[slug] ?? slug) : 'Wszystkie produkty';
      this.seo.updatePageMeta({
        title: label,
        description: slug
          ? `${label} — premium zapachy w Aromaterie.`
          : 'Odkryj pełną kolekcję perfum, dyfuzorów i żeli pod prysznic premium.',
      });

      this.loadProducts(1);
    });
  }

  goToPage(index: number): void {
    this.pageIndex.set(index);
    this.loadProducts(index + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  private loadProducts(page: number): void {
    this.loading.set(true);
    const slug = this.slug();
    const categoryParam = slug ? `&category=${slug}` : '';
    const url = `${environment.apiUrl}/products?page=${page}&limit=${PAGE_SIZE}${categoryParam}`;

    this.http.get<{ data: ProductCardData[]; meta: { totalPages: number } }>(url).subscribe({
      next: (res) => {
        this.products.set(res.data ?? []);
        this.totalPages.set(res.meta?.totalPages ?? 1);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
