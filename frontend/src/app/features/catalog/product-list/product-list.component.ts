import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { SeoService } from '../../../core/services/seo.service';
import { PricePipe } from '../../../shared/pipes/price.pipe';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [RouterLink, PricePipe],
  template: `
    <div class="page">
      <h1>Produkty</h1>
      @if (loading()) {
        <p>Ładowanie...</p>
      } @else {
        <div class="grid">
          @for (product of products(); track product.id) {
            <a [routerLink]="['/products', product.slug]" class="card">
              @if (product.images?.[0]) {
                <img [src]="product.images[0].url" [alt]="product.name" />
              }
              <div class="card__body">
                <h3>{{ product.name }}</h3>
                @if (product.brand) { <p class="card__brand">{{ product.brand }}</p> }
                <p class="card__price">od {{ product.variants?.[0]?.priceInCents | price }}</p>
              </div>
            </a>
          } @empty {
            <p>Brak produktów.</p>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 32px 0; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 32px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 24px; }
    .card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; transition: box-shadow 0.15s; }
    .card:hover { box-shadow: var(--shadow-md); }
    .card img { width: 100%; aspect-ratio: 1; object-fit: cover; }
    .card__body { padding: 16px; }
    .card__body h3 { font-size: 16px; font-weight: 600; margin: 0 0 4px; }
    .card__brand { font-size: 12px; color: var(--color-secondary); margin: 0 0 8px; }
    .card__price { font-size: 14px; font-weight: 600; color: var(--color-accent); margin: 0; }
  `],
})
export class ProductListComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);

  readonly loading = signal(true);
  readonly products = signal<any[]>([]);

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
