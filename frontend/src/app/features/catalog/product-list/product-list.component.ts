import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TuiButton, TuiDataList, TuiDropdown, TuiIcon, TuiLink, TuiPopup } from '@taiga-ui/core';
import { TuiAccordion, TuiCheckbox, TuiChevron, TuiChip, TuiDrawer, TuiPagination, TuiSwitch } from '@taiga-ui/kit';
import { environment } from '../../../../environments/environment';
import { SeoService } from '../../../core/services/seo.service';
import { ProductCardComponent, ProductCardData } from '../../../shared/product-card/product-card.component';
import { BreadcrumbComponent, Breadcrumb } from '../../../shared/components/breadcrumb/breadcrumb.component';

const CATEGORY_LABELS: Record<string, string> = {
  perfume: 'Perfumy',
  'perfume-luxury': 'Perfumy Luksusowe',
  diffusers: 'Dyfuzory',
  gels: 'Żele pod prysznic',
};

const PAGE_SIZE = 20;

interface FilterGroup {
  label: string;
  key: string;
  options: string[];
}

const VOLUME_OPTIONS: Record<string, string[]> = {
  perfume: ['30ml', '50ml', '70ml'],
  'perfume-luxury': ['50ml'],
  diffusers: ['100ml', '200ml', '500ml'],
  gels: ['250ml'],
};
const ALL_VOLUMES = ['30ml', '50ml', '70ml', '100ml', '200ml', '250ml', '500ml'];

const LINE_OPTIONS: Record<string, string[]> = {
  perfume: ['Millesime', 'Luxury'],
  'perfume-luxury': ['Luxury'],
};
const ALL_LINE_OPTIONS = ['Millesime', 'Luxury'];

const LINE_VOLUMES: Record<string, string[]> = {
  Millesime: ['30ml', '70ml'],
  Luxury: ['50ml'],
};

function getVolumeOptions(slug: string | null, stagedLines: string[]): string[] {
  if (slug === 'perfume' && stagedLines.length > 0) {
    const allowed = [...new Set(stagedLines.flatMap(l => LINE_VOLUMES[l] ?? []))];
    if (allowed.length > 0) return allowed.sort((a, b) => parseInt(a) - parseInt(b));
  }
  return slug ? (VOLUME_OPTIONS[slug] ?? []) : ALL_VOLUMES;
}

const VOLUME_LINES: Record<string, string[]> = {
  '30ml': ['Millesime'],
  '50ml': ['Luxury'],
  '70ml': ['Millesime'],
};

function getLineOptions(slug: string | null, stagedVolumes: string[]): string[] {
  if (slug === 'perfume' && stagedVolumes.length > 0) {
    const allowed = [...new Set(stagedVolumes.flatMap(v => VOLUME_LINES[v] ?? []))];
    if (allowed.length > 0) return allowed;
  }
  return slug ? (LINE_OPTIONS[slug] ?? []) : ALL_LINE_OPTIONS;
}

const APPLICABLE_FILTERS: Record<string, Set<string>> = {
  'perfume': new Set(['gender', 'volume', 'line', 'scentFamily']),
  'perfume-luxury': new Set(['gender', 'scentFamily']),
  'diffusers': new Set(['volume']),
  'gels': new Set(['gender', 'scentFamily']),
};

const SCENT_FAMILY_OPTIONS = [
  'Ambra', 'Aromatyczny', 'Chypre', 'Cytrusowy', 'Kwiatowy',
  'Fougère', 'Owocowy', 'Skórzany', 'Piżmowy', 'Korzenny', 'Drzewny',
];

interface CategoryFacets {
  scentFamilies: string[];
  genders: string[];
}

function buildFilterGroups(
  slug: string | null,
  staged: FilterState = {},
  facets?: CategoryFacets | null,
): FilterGroup[] {
  const stagedLines = staged['line'] ?? [];
  const stagedVolumes = staged['volume'] ?? [];
  const applicable = slug ? APPLICABLE_FILTERS[slug] : null;

  const genderOptions = facets?.genders?.length
    ? ['Kobieta', 'Mężczyzna', 'Unisex'].filter(o => facets.genders.includes(o))
    : ['Kobieta', 'Mężczyzna', 'Unisex'];

  const scentOptions = facets?.scentFamilies?.length
    ? SCENT_FAMILY_OPTIONS.filter(o => facets.scentFamilies.includes(o))
    : SCENT_FAMILY_OPTIONS;

  const all: FilterGroup[] = [
    { label: 'Płeć', key: 'gender', options: genderOptions },
    { label: 'Pojemność', key: 'volume', options: getVolumeOptions(slug, stagedLines) },
    { label: 'Linia', key: 'line', options: getLineOptions(slug, stagedVolumes) },
    { label: 'Grupa olfaktoryczna', key: 'scentFamily', options: scentOptions },
  ];

  return applicable ? all.filter(g => applicable.has(g.key)) : all;
}

type FilterState = Record<string, string[]>;
const emptyFilters = (): FilterState =>
  Object.fromEntries(buildFilterGroups(null, {}).map((g: FilterGroup) => [g.key, []]));

type SortOption = 'relevance' | 'price_asc' | 'price_desc';
const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'relevance', label: 'Polecane' },
  { value: 'price_asc', label: 'Cena: rosnąco' },
  { value: 'price_desc', label: 'Cena: malejąco' },
];

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [
    FormsModule,
    TuiButton,
    TuiDataList,
    TuiDropdown,
    TuiIcon,
    TuiLink,
    TuiPopup,
    TuiAccordion,
    TuiCheckbox,
    TuiChevron,
    TuiChip,
    TuiDrawer,
    TuiPagination,
    TuiSwitch,
    ProductCardComponent,
    BreadcrumbComponent,
  ],
  template: `
    <div class="page">
      @if (slug()) {
        <app-breadcrumb [crumbs]="breadcrumbs()" />
      }

      <h1>{{ pageTitle() }}</h1>

      <div class="toolbar">
        <button tuiButton appearance="secondary" size="s" type="button" (click)="openDrawer()">
          <tui-icon icon="@tui.sliders-horizontal" />
          Filtry
          @if (activeFilterCount() > 0) {
            <span class="filter-count">{{ activeFilterCount() }}</span>
          }
        </button>

        <button
          tuiChevron
          tuiLink
          type="button"
          class="sort-btn"
          [tuiDropdown]="sortDropdown"
          [(tuiDropdownOpen)]="sortOpen"
        >{{ sortLabel() }}</button>
      </div>

      <ng-template #sortDropdown>
        <tui-data-list>
          @for (option of sortOptions; track option.value) {
            <button tuiOption type="button" (click)="setSortBy(option.value)">
              {{ option.label }}
              @if (sortBy() === option.value) {
                <tui-icon icon="@tui.check" />
              }
            </button>
          }
        </tui-data-list>
      </ng-template>

      @if (activeChips().length > 0 || appliedInStock()) {
        <div class="filter-chips">
          @for (chip of activeChips(); track chip.key + chip.value) {
            <span tuiChip size="s" appearance="outline">
              {{ chip.value }}
              <button
                iconStart="@tui.x"
                size="s"
                tuiIconButton
                type="button"
                (click)="removeFilter(chip.key, chip.value)"
              >Usuń</button>
            </span>
          }
          @if (appliedInStock()) {
            <span tuiChip size="s">
              Dostępne
              <button
                iconStart="@tui.x"
                size="s"
                tuiIconButton
                type="button"
                (click)="removeInStock()"
              >Usuń</button>
            </span>
          }
          <button tuiButton size="s" appearance="outline" type="button" class="clear-chips-btn" (click)="clearAllFilters()">Wyczyść wszystko</button>
        </div>
      }

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
            <p class="empty">Brak produktów w tej kategorii.</p>
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

    <!-- ── Filter drawer ──────────────────────────────────────── -->
    <ng-template [tuiPopup]="drawerOpen()">
      <!-- Real DOM backdrop — pseudo-elements can't be event targets -->
      <div class="filter-overlay" (click)="closeDrawer()"></div>

      <tui-drawer direction="left">
        <!-- Header in default slot so our CSS fully controls it -->
        <div class="drawer-header">
          <span class="drawer-title">Filtry</span>
          <button
            appearance="icon"
            iconStart="@tui.x"
            tuiIconButton
            type="button"
            (click)="closeDrawer()"
          >Zamknij</button>
        </div>

        <div class="filter-instock">
          <span>Pokaż tylko dostępne</span>
          <input
            type="checkbox"
            tuiSwitch
            [ngModel]="stagedInStock()"
            [ngModelOptions]="{ standalone: true }"
            (ngModelChange)="stagedInStock.set($event)"
          />
        </div>

        <tui-accordion>
          @for (group of filterGroups(); track group.key) {
            <tui-accordion-item
              [open]="openGroups()[group.key]"
              (openChange)="setGroupOpen(group.key, $event)"
            >
              {{ group.label }}
              <div tuiAccordionItemContent class="filter-group-content">
                @if (group.options.length > 0) {
                  @for (option of group.options; track option) {
                    <label class="filter-option">
                      <input
                        type="checkbox"
                        tuiCheckbox
                        [ngModel]="isSelected(group.key, option)"
                        [ngModelOptions]="{ standalone: true }"
                        (ngModelChange)="onCheckboxChange(group.key, option, $event)"
                      />
                      <span>{{ option }}</span>
                    </label>
                  }
                } @else {
                  <p class="filter-empty">Wkrótce dostępne</p>
                }
              </div>
            </tui-accordion-item>
          }
        </tui-accordion>

        <footer class="drawer-footer">
          <button
            tuiButton
            appearance="primary"
            size="m"
            type="button"
            style="width: 100%"
            (click)="applyFilters()"
          >
            Zastosuj filtry
          </button>
        </footer>
      </tui-drawer>
    </ng-template>
  `,
  styles: [`
    /* ── Page layout ─────────────────────────────────────────── */
    .page { padding: 32px 0; }

    h1 { font-size: 1.75rem; font-weight: 700; color: var(--color-primary); margin: 0 0 24px; }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 28px;
    }
    .sort-btn { font-size: 14px; }

    .filter-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 4px;
      border-radius: 999px;
      background: var(--color-accent);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
    }

    /* ── Active filter chips ─────────────────────────────────── */
    .filter-chips {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
    }
    .clear-chips-btn {
      padding: 5px 12px;
      border: 1px solid var(--color-border);
      border-radius: 999px;
      background: none;
      font-size: 13px;
      color: var(--color-secondary);
      cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
    }
    .clear-chips-btn:hover { color: var(--color-primary); border-color: var(--color-primary); }

    /* ── Grid ────────────────────────────────────────────────── */
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

    /* ── Drawer ──────────────────────────────────────────────── */
    /* Real backdrop div — lets us detect outside-clicks reliably */
    .filter-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.35);
    }
    /* Header lives in the default content slot so our CSS fully controls it.
       Counteract t-content's 1.25rem/1.5rem padding to sit flush at the top. */
    .drawer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 4px 0 0;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--color-border);
      margin-bottom: 4px;
    }
    .drawer-title {
      font-size: 18px;
      font-weight: 700;
      color: var(--color-primary);
    }
    .filter-instock {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 0 16px;
      border-bottom: 1px solid var(--color-border);
      margin-bottom: 4px;
    }
    .filter-instock span { font-size: 14px; color: var(--color-primary); }

    .filter-group-content {
      display: flex;
      flex-direction: column;
      padding: 4px 0 8px;
    }
    .filter-option {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .filter-option:hover { background: var(--tui-background-neutral-1-hover, rgba(0,0,0,.04)); }
    .filter-option span { font-size: 14px; color: var(--color-primary); }
    .filter-empty {
      font-size: 13px;
      color: var(--color-secondary);
      padding: 10px 16px;
      margin: 0;
    }
    .drawer-footer {
      padding: 16px 20px;
      border-top: 1px solid var(--color-border);
      background: var(--color-surface);
    }

    /* ── Skeleton loader ─────────────────────────────────────── */
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
  readonly facets = signal<CategoryFacets | null>(null);
  readonly pageIndex = signal(0);
  readonly totalPages = signal(1);
  readonly skeletons = Array(8);

  readonly slug = signal<string | null>(null);
  readonly drawerOpen = signal(false);
  readonly featuredMode = signal(false);

  // staged = what's being edited in the drawer; applied = what drives the fetch
  readonly staged = signal<FilterState>(emptyFilters());
  readonly appliedFilters = signal<FilterState>(emptyFilters());

  // Per-group open state — first group open by default (keys are stable across slugs)
  readonly openGroups = signal<Record<string, boolean>>(
    Object.fromEntries(buildFilterGroups(null).map((g, i) => [g.key, i === 0])),
  );

  readonly sortOptions = SORT_OPTIONS;

  // Sort — applied immediately, backend connection comes in the next step
  readonly sortBy = signal<SortOption>('relevance');
  sortOpen = false;

  // In-stock toggle — staged with the rest of the drawer filters, default OFF (show all)
  readonly stagedInStock = signal(false);
  readonly appliedInStock = signal(false);

  readonly sortLabel = computed(
    () => SORT_OPTIONS.find(o => o.value === this.sortBy())?.label ?? 'Sortuj',
  );

  // Filter groups are slug-, staged-, and facets-aware: options narrow to what exists in the category
  readonly filterGroups = computed(() => buildFilterGroups(this.slug(), this.staged(), this.facets()));

  readonly pageTitle = computed(() => {
    if (this.featuredMode()) return 'Bestsellery';
    const s = this.slug();
    return s ? (CATEGORY_LABELS[s] ?? s) : 'Wszystkie produkty';
  });

  readonly breadcrumbs = computed<Breadcrumb[]>(() => [
    { label: 'Strona główna', link: '/' },
    { label: this.pageTitle() },
  ]);

  readonly activeFilterCount = computed(() =>
    Object.values(this.appliedFilters()).reduce((sum, arr) => sum + arr.length, 0),
  );

  readonly activeChips = computed(() => {
    const chips: { key: string; value: string }[] = [];
    for (const [key, values] of Object.entries(this.appliedFilters())) {
      for (const value of values) chips.push({ key, value });
    }
    return chips;
  });

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const slug = params.get('slug');
      this.slug.set(slug);
      this.pageIndex.set(0);

      const qp = this.route.snapshot.queryParamMap;
      const genders = qp.getAll('gender');
      const featured = qp.get('featured') === 'true';
      const initialFilters = emptyFilters();
      if (genders.length) initialFilters['gender'] = genders;
      this.appliedFilters.set(initialFilters);
      this.staged.set({ ...initialFilters });
      this.featuredMode.set(featured);
      this.appliedInStock.set(false);
      this.stagedInStock.set(false);

      const label = featured ? 'Bestsellery' : slug ? (CATEGORY_LABELS[slug] ?? slug) : 'Wszystkie produkty';
      this.seo.updatePageMeta({
        title: label,
        description: slug
          ? `${label} — premium zapachy w Aromaterie.`
          : 'Odkryj pełną kolekcję perfum, dyfuzorów i żeli pod prysznic premium.',
      });

      this.loadFacets(slug);
      this.loadProducts(1);
    });
  }

  openDrawer(): void {
    this.staged.set(
      Object.fromEntries(
        Object.entries(this.appliedFilters()).map(([k, v]) => [k, [...v]]),
      ),
    );
    this.stagedInStock.set(this.appliedInStock());
    this.drawerOpen.set(true);
  }

  closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  applyFilters(): void {
    this.appliedFilters.set(
      Object.fromEntries(
        Object.entries(this.staged()).map(([k, v]) => [k, [...v]]),
      ),
    );
    this.appliedInStock.set(this.stagedInStock());
    this.drawerOpen.set(false);
    this.pageIndex.set(0);
    this.loadProducts(1);
  }

  removeFilter(key: string, value: string): void {
    const updated = Object.fromEntries(
      Object.entries(this.appliedFilters()).map(([k, v]) =>
        [k, k === key ? v.filter(x => x !== value) : v],
      ),
    );
    this.appliedFilters.set(updated);
    this.staged.set(Object.fromEntries(Object.entries(updated).map(([k, v]) => [k, [...v]])));
    this.pageIndex.set(0);
    this.loadProducts(1);
  }

  removeInStock(): void {
    this.appliedInStock.set(false);
    this.stagedInStock.set(false);
    this.pageIndex.set(0);
    this.loadProducts(1);
  }

  clearAllFilters(): void {
    const empty = emptyFilters();
    this.appliedFilters.set(empty);
    this.staged.set(emptyFilters());
    this.appliedInStock.set(false);
    this.stagedInStock.set(false);
    this.pageIndex.set(0);
    this.loadProducts(1);
  }

  setSortBy(value: SortOption): void {
    this.sortBy.set(value);
    this.sortOpen = false;
    this.pageIndex.set(0);
    this.loadProducts(1);
  }

  setGroupOpen(key: string, open: boolean): void {
    this.openGroups.update(s => ({ ...s, [key]: open }));
  }

  isSelected(key: string, option: string): boolean {
    return this.staged()[key]?.includes(option) ?? false;
  }

  onCheckboxChange(key: string, option: string, checked: boolean): void {
    this.staged.update(s => {
      const updated = {
        ...s,
        [key]: checked
          ? [...(s[key] ?? []), option]
          : (s[key] ?? []).filter(v => v !== option),
      };
      if (this.slug() === 'perfume') {
        if (key === 'line') {
          const newLines = updated['line'] ?? [];
          const allowed = new Set(
            newLines.length > 0
              ? newLines.flatMap(l => LINE_VOLUMES[l] ?? [])
              : VOLUME_OPTIONS['perfume'] ?? [],
          );
          updated['volume'] = (updated['volume'] ?? []).filter(v => allowed.has(v));
        } else if (key === 'volume') {
          const newVols = updated['volume'] ?? [];
          const allowed = new Set(
            newVols.length > 0
              ? newVols.flatMap(v => VOLUME_LINES[v] ?? [])
              : LINE_OPTIONS['perfume'] ?? [],
          );
          updated['line'] = (updated['line'] ?? []).filter(l => allowed.has(l));
        }
      }
      return updated;
    });
  }

  goToPage(index: number): void {
    this.pageIndex.set(index);
    this.loadProducts(index + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  private loadFacets(slug: string | null): void {
    if (!slug) { this.facets.set(null); return; }
    const params = new URLSearchParams({ category: slug });
    this.http
      .get<CategoryFacets>(`${environment.apiUrl}/products/facets?${params.toString()}`)
      .subscribe({ next: (res) => this.facets.set(res), error: () => this.facets.set(null) });
  }

  private loadProducts(page: number): void {
    this.loading.set(true);
    const slug = this.slug();
    const filters = this.appliedFilters();
    const inStock = this.appliedInStock();
    const sortBy = this.sortBy();
    const featured = this.featuredMode();

    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(PAGE_SIZE));
    if (slug) params.set('category', slug);
    if (featured) params.set('featured', 'true');

    filters['gender']?.forEach(v => params.append('gender', v));
    filters['scentFamily']?.forEach(v => params.append('scentFamily', v));
    filters['line']?.forEach(v => params.append('line', v));
    filters['volume']?.forEach(v => {
      const ml = parseInt(v, 10);
      if (!isNaN(ml)) params.append('volumes', String(ml));
    });
    if (inStock) params.set('inStock', 'true');
    if (sortBy !== 'relevance') params.set('sortBy', sortBy);

    this.http
      .get<{ data: ProductCardData[]; meta: { totalPages: number } }>(
        `${environment.apiUrl}/products?${params.toString()}`,
      )
      .subscribe({
        next: (res) => {
          this.products.set(res.data ?? []);
          this.totalPages.set(res.meta?.totalPages ?? 1);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }
}
