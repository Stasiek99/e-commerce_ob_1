import { Component, DestroyRef, ElementRef, OnInit, inject, signal } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { debounceTime, distinctUntilChanged, switchMap, catchError, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TuiButton, TuiIcon, TuiTextfield, TuiDropdown, TuiDropdownHover, TuiDataList } from '@taiga-ui/core';
import { TuiChevron } from '@taiga-ui/kit';
import { TuiList } from '@taiga-ui/layout';
import { CartService } from '../../../core/services/cart.service';
import { AuthService } from '../../../core/services/auth.service';
import { WishlistService } from '../../../core/services/wishlist.service';
import { PricePipe } from '../../pipes/price.pipe';
import { environment } from '../../../../environments/environment';

interface SuggestResult {
  id: string;
  name: string;
  slug: string;
  images: Array<{ url: string }>;
  variants: Array<{ priceInCents: number; label: string }>;
}

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    TuiButton,
    TuiIcon,
    TuiTextfield,
    TuiDropdown,
    TuiDropdownHover,
    TuiDataList,
    TuiChevron,
    TuiList,
    PricePipe,
  ],
  template: `
    <header class="header">
      <div class="header__inner">

        <!-- LEFT: logo + nav -->
        <div class="header__left">
          <a routerLink="/" class="header__logo" (click)="closeMobileMenu()">
            <img src="assets/images/logo_full.png" alt="Aromaterie" class="header__logo-img" />
          </a>
          <nav class="header__nav" aria-label="Nawigacja główna">
            <button
              tuiChevron
              tuiDropdownHover
              type="button"
              class="header__nav-link"
              [class.active]="isCategoryActive()"
              [tuiDropdown]="categoryDropdown"
              [(tuiDropdownOpen)]="dropdownOpen"
              (click)="router.navigate(['/products'])"
            >
              Produkty
            </button>

            <ng-template #categoryDropdown>
              <tui-data-list (click)="dropdownOpen = false">
                <a tuiOption new routerLink="/category/perfume">Perfumy</a>
                <a tuiOption new routerLink="/category/diffusers">Dyfuzory</a>
                <a tuiOption new routerLink="/category/gels">Żele pod prysznic</a>
                <hr class="header__dropdown-divider" />
                <a tuiOption new routerLink="/products" class="header__dropdown-item--all">Wszystkie produkty</a>
              </tui-data-list>
            </ng-template>
          </nav>
        </div>

        <!-- CENTER: search (hidden on mobile, lives in mobile menu instead) -->
        <div class="header__search">
          <div class="header__search-container">
            <form class="header__search-form" (submit)="onSearch()">
              <tui-textfield iconStart="@tui.search" class="header__search-field" tuiTextfieldSize="s">
                <input
                  [formControl]="searchControl"
                  placeholder="Szukaj produktów…"
                  aria-label="Szukaj produktów"
                  tuiTextfield
                  autocomplete="off"
                  role="combobox"
                  aria-haspopup="listbox"
                  [attr.aria-expanded]="showAutocomplete && autocomplete().length > 0"
                  [attr.aria-activedescendant]="activeIndex() >= 0 ? 'ac-item-' + activeIndex() : null"
                  (focus)="onInputFocus()"
                  (blur)="onInputBlur()"
                  (keydown)="onKeydown($event)"
                />
              </tui-textfield>
              <button size="s" tuiButton type="submit" appearance="primary" class="header__search-btn">Szukaj</button>
            </form>

            @if (showAutocomplete && autocomplete().length > 0) {
              <ul tuiList="s" class="autocomplete-list" role="listbox" aria-label="Wyniki wyszukiwania">
                @for (item of autocomplete(); track item.id; let i = $index) {
                  <li
                    [id]="'ac-item-' + i"
                    class="autocomplete-item"
                    [class.is-active]="activeIndex() === i"
                    role="option"
                    [attr.aria-selected]="activeIndex() === i"
                    (mousedown)="selectSuggestion(item)"
                    (mouseenter)="activeIndex.set(i)"
                    (mouseleave)="activeIndex.set(-1)"
                  >
                    @if (item.images[0]?.url) {
                      <img
                        class="autocomplete-img"
                        [src]="item.images[0].url"
                        [alt]="item.name"
                        width="40"
                        height="40"
                        loading="lazy"
                      />
                    } @else {
                      <div class="autocomplete-img autocomplete-img--placeholder"></div>
                    }
                    <span class="autocomplete-name">{{ item.name }}</span>
                    <span class="autocomplete-price">{{ item.variants[0]?.priceInCents | price }}</span>
                  </li>
                }
              </ul>
            }
          </div>
        </div>

        <!-- RIGHT: actions -->
        <div class="header__actions">
          <a routerLink="/wishlist" class="header__action-link header__action-link--wishlist" (click)="closeMobileMenu()"
             [attr.aria-label]="wishlist.count() > 0 ? 'Ulubione (' + wishlist.count() + ' produktów)' : 'Ulubione'">
            <tui-icon icon="@tui.heart" aria-hidden="true" />
            @defer (on immediate) {
              @if (wishlist.count() > 0) {
                <span class="header__wishlist-badge" aria-hidden="true">{{ wishlist.count() }}</span>
              }
            }
            <span aria-hidden="true">Ulubione</span>
          </a>

          <a routerLink="/cart" class="header__action-link header__action-link--cart" (click)="closeMobileMenu()"
             [attr.aria-label]="cartService.itemCount() > 0 ? 'Koszyk (' + cartService.itemCount() + ' produktów)' : 'Koszyk'">
            <tui-icon icon="@tui.shopping-cart" aria-hidden="true" />
            @if (cartService.itemCount() > 0) {
              <span class="header__cart-badge" aria-hidden="true">{{ cartService.itemCount() }}</span>
            }
            <span aria-hidden="true">Koszyk</span>
          </a>

          <a [routerLink]="auth.isAuthenticated() ? '/account' : '/auth/login'" class="header__action-link" (click)="closeMobileMenu()">
            <tui-icon icon="@tui.user" />
            <span>Konto</span>
          </a>

          <!-- Hamburger — mobile only -->
          <button
            type="button"
            class="header__hamburger"
            (click)="toggleMobileMenu()"
            [attr.aria-expanded]="mobileMenuOpen"
            aria-label="Menu"
          >
            <tui-icon [icon]="mobileMenuOpen ? '@tui.x' : '@tui.menu'" />
          </button>
        </div>

      </div>

      <!-- Mobile navigation panel -->
      @if (mobileMenuOpen) {
        <div class="mobile-nav" (click)="closeMobileMenu()" (keydown.escape)="closeMobileMenu()">
          <nav class="mobile-nav__links" aria-label="Nawigacja mobilna" (click)="$event.stopPropagation()">
            <a routerLink="/products" class="mobile-nav__link" (click)="closeMobileMenu()">Wszystkie produkty</a>
            <a routerLink="/category/perfume" class="mobile-nav__link" (click)="closeMobileMenu()">Perfumy</a>
            <a routerLink="/category/diffusers" class="mobile-nav__link" (click)="closeMobileMenu()">Dyfuzory</a>
            <a routerLink="/category/gels" class="mobile-nav__link" (click)="closeMobileMenu()">Żele pod prysznic</a>
            <hr class="mobile-nav__divider" />
            <form class="mobile-nav__search" (submit)="onMobileSearch()">
              <tui-textfield iconStart="@tui.search" tuiTextfieldSize="s" class="mobile-nav__search-field">
                <input [formControl]="searchControl" placeholder="Szukaj produktów…" aria-label="Szukaj produktów" tuiTextfield />
              </tui-textfield>
              <button tuiButton type="submit" appearance="primary" size="s">Szukaj</button>
            </form>
          </nav>
        </div>
      }
    </header>
  `,
  styles: [`
    .header {
      position: sticky;
      top: 0;
      z-index: 100;
      background: var(--color-surface);
      border-bottom: 1px solid var(--color-border);
    }
    .header__inner {
      max-width: var(--max-width, 1280px);
      margin: 0 auto;
      padding: 0 24px;
      height: 64px;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 24px;
    }

    /* ── Left ───────────────────────────────── */
    .header__left {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .header__logo {
      display: flex;
      align-items: center;
      line-height: 1;
    }
    .header__logo-img { height: 60px; width: auto; display: block; margin-top: 10px; }
    .header__nav { display: flex; gap: 20px; }

    .header__nav-link {
      display: inline-flex;
      align-items: center;
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      color: var(--color-primary);
      font-size: 13px;
      font-weight: 400;
      font-family: var(--tui-font-text), sans-serif;
      transition: color 0.15s;
      white-space: nowrap;
    }
    .header__nav-link:hover,
    .header__nav-link.active { color: var(--color-accent); }
    .header__nav-link:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 3px; border-radius: 3px; }

    .header__dropdown-divider { border: none; border-top: 1px solid var(--color-border); margin: 4px 0; }
    .header__dropdown-item--all { font-weight: 600; }

    /* ── Center: search ─────────────────────── */
    .header__search { display: flex; justify-content: center; }
    .header__search-container {
      position: relative;
      width: 100%;
      max-width: 480px;
    }
    .header__search-form {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
    }
    .header__search-field { flex: 1; min-width: 0; }
    .header__search-btn { flex-shrink: 0; }

    /* ── Autocomplete dropdown ──────────────── */
    /* tuiList adds margin-inline-start and li::before bullets — reset both */
    .autocomplete-list {
      position: absolute;
      top: calc(100% + 2px);
      left: 0;
      right: 0;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 0 0 8px 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
      z-index: 200;
      margin-inline-start: 0;
      padding: 0;
      max-height: 360px;
      overflow-y: auto;
    }
    .autocomplete-list > li {
      margin: 0;
    }
    .autocomplete-list > li::before {
      display: none;
    }
    .autocomplete-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      cursor: pointer;
      transition: background 0.12s;
      max-width: none;
    }
    .autocomplete-item:hover,
    .autocomplete-item.is-active { background: var(--tui-background-neutral-1-hover, rgba(0, 0, 0, 0.04)); }
    .autocomplete-img {
      width: 40px;
      height: 40px;
      border-radius: 4px;
      object-fit: cover;
      flex-shrink: 0;
    }
    .autocomplete-img--placeholder { background: var(--tui-background-neutral-1, #f5f5f5); }
    .autocomplete-name {
      flex: 1;
      font-size: 14px;
      font-weight: 500;
      color: var(--color-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .autocomplete-price {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-accent);
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* ── Right ──────────────────────────────── */
    .header__actions { display: flex; align-items: center; gap: 20px; }
    .header__action-link {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--color-primary);
      white-space: nowrap;
      transition: color 0.15s;
      position: relative;
    }
    .header__action-link:hover { color: var(--color-accent); }
    .header__action-link:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 3px; border-radius: 3px; }
    .header__action-link tui-icon { font-size: 20px; }
    .header__action-link--cart,
    .header__action-link--wishlist { position: relative; }
    .header__wishlist-badge,
    .header__cart-badge {
      position: absolute;
      top: -7px;
      right: -10px;
      background: var(--color-accent);
      color: #fff;
      border-radius: 50%;
      min-width: 17px;
      height: 17px;
      font-size: 10px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 3px;
    }

    /* ── Hamburger ──────────────────────────── */
    .header__hamburger {
      display: none;
      align-items: center;
      justify-content: center;
      background: none;
      border: none;
      cursor: pointer;
      color: var(--color-primary);
      padding: 4px;
      border-radius: var(--border-radius-sm);
      transition: color 0.15s;
    }
    .header__hamburger tui-icon { font-size: 22px; }
    .header__hamburger:hover { color: var(--color-accent); }

    /* ── Mobile nav panel ───────────────────── */
    .mobile-nav {
      background: rgba(0, 0, 0, 0.35);
      position: fixed;
      inset: 64px 0 0 0;
      z-index: 99;
    }
    .mobile-nav__links {
      background: var(--color-surface);
      border-bottom: 1px solid var(--color-border);
      padding: 16px 24px 20px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .mobile-nav__link {
      display: block;
      padding: 12px 0;
      font-size: 16px;
      font-weight: 500;
      color: var(--color-primary);
      border-bottom: 1px solid var(--color-border);
      transition: color 0.15s;
    }
    .mobile-nav__link:last-of-type { border-bottom: none; }
    .mobile-nav__link:hover { color: var(--color-accent); }
    .mobile-nav__divider { border: none; border-top: 1px solid var(--color-border); margin: 8px 0; }
    .mobile-nav__search {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-top: 12px;
    }
    .mobile-nav__search-field { flex: 1; min-width: 0; }

    /* ── Breakpoints ────────────────────────── */
    @media (max-width: 999px) {
      .header__nav { display: none; }
      .header__action-link span { display: none; }
      .header__actions { gap: 12px; }
      .header__hamburger { display: flex; }
    }
    @media (max-width: 768px) {
      .header__search { display: none; }
      .header__inner { grid-template-columns: auto auto; justify-content: space-between; gap: 0; }
    }
  `],
})
export class HeaderComponent implements OnInit {
  readonly router = inject(Router);
  readonly cartService = inject(CartService);
  readonly auth = inject(AuthService);
  readonly wishlist = inject(WishlistService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly elRef = inject(ElementRef);

  dropdownOpen = false;
  mobileMenuOpen = false;
  showAutocomplete = false;

  readonly autocomplete = signal<SuggestResult[]>([]);
  readonly activeIndex = signal(-1);

  readonly searchControl = new FormControl<string>('');

  ngOnInit(): void {
    // Autocomplete pipeline — 250ms, hits cached suggest endpoint
    this.searchControl.valueChanges.pipe(
      debounceTime(250),
      distinctUntilChanged(),
      switchMap(q => {
        const term = q?.trim() ?? '';
        if (term.length < 2) {
          this.autocomplete.set([]);
          return of([]);
        }
        return this.http
          .get<SuggestResult[]>(`${environment.apiUrl}/products/suggest`, { params: { q: term } })
          .pipe(catchError(() => of([])));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(results => {
      this.autocomplete.set(results);
      this.activeIndex.set(-1);
    });

    // Search-as-you-type pipeline — 400ms, updates catalog URL only when already on /products
    this.searchControl.valueChanges.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(q => {
      const currentPath = this.router.url.split('?')[0];
      if (currentPath !== '/products') return;
      const term = q?.trim() ?? '';
      this.router.navigate(['/products'], {
        queryParams: { q: term || null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });
  }

  isCategoryActive(): boolean {
    return this.router.url.startsWith('/category/');
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen = !this.mobileMenuOpen;
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen = false;
  }

  onInputFocus(): void {
    this.showAutocomplete = true;
  }

  onInputBlur(): void {
    // Delay allows (mousedown) on suggestion items to fire before the dropdown hides
    setTimeout(() => {
      this.showAutocomplete = false;
      this.activeIndex.set(-1);
    }, 150);
  }

  onKeydown(event: KeyboardEvent): void {
    const items = this.autocomplete();
    if (!this.showAutocomplete || items.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.activeIndex.update(i => Math.min(i + 1, items.length - 1));
        this.scrollActiveIntoView();
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.activeIndex.update(i => Math.max(i - 1, -1));
        this.scrollActiveIntoView();
        break;
      case 'Enter':
        if (this.activeIndex() >= 0) {
          event.preventDefault();
          this.selectSuggestion(items[this.activeIndex()]);
        }
        break;
      case 'Escape':
        this.showAutocomplete = false;
        this.activeIndex.set(-1);
        break;
    }
  }

  private scrollActiveIntoView(): void {
    setTimeout(() => {
      const el = this.elRef.nativeElement.querySelector('.autocomplete-item.is-active') as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest' });
    }, 0);
  }

  selectSuggestion(item: SuggestResult): void {
    this.showAutocomplete = false;
    this.autocomplete.set([]);
    this.activeIndex.set(-1);
    this.searchControl.setValue('', { emitEvent: false });
    this.closeMobileMenu();
    this.router.navigate(['/products', item.slug]);
  }

  onSearch(): void {
    const q = this.searchControl.value?.trim();
    this.showAutocomplete = false;
    this.autocomplete.set([]);
    if (!q) return;
    this.searchControl.setValue('', { emitEvent: false });
    this.router.navigate(['/products'], { queryParams: { q } });
  }

  onMobileSearch(): void {
    this.onSearch();
    this.closeMobileMenu();
  }

  logout(): void {
    this.auth.logout().subscribe();
  }
}
