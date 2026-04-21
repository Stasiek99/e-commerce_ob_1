import { Component, inject } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { ReactiveFormsModule, FormControl, FormGroup } from '@angular/forms';
import { TuiButton, TuiIcon, TuiTextfield, TuiDropdown, TuiDropdownHover, TuiDataList } from '@taiga-ui/core';
import { TuiChevron } from '@taiga-ui/kit';
import { CartService } from '../../../core/services/cart.service';
import { AuthService } from '../../../core/services/auth.service';

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
  ],
  template: `
    <header class="header">
      <div class="header__inner">

        <!-- LEFT: logo + nav -->
        <div class="header__left">
          <a routerLink="/" class="header__logo">
            <span class="header__logo-text">Fragrance</span>
            <span class="header__logo-sub">Store</span>
          </a>
          <nav class="header__nav">
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

        <!-- CENTER: search -->
        <div class="header__search">
          <form class="header__search-form" [formGroup]="searchForm" (ngSubmit)="onSearch()">
            <tui-textfield iconStart="@tui.search" class="header__search-field" tuiTextfieldSize="s">
              <input
                formControlName="q"
                placeholder="Szukaj produktów…"
                tuiTextfield
              />
            </tui-textfield>
            <button size="s" tuiButton type="submit" appearance="primary" class="header__search-btn">Szukaj</button>
          </form>
        </div>

        <!-- RIGHT: actions -->
        <div class="header__actions">
          <a routerLink="/wishlist" class="header__action-link">
            <tui-icon icon="@tui.heart" />
            <span>Ulubione</span>
          </a>

          <a routerLink="/cart" class="header__action-link header__action-link--cart">
            <tui-icon icon="@tui.shopping-cart" />
            @if (cartService.itemCount() > 0) {
              <span class="header__cart-badge">{{ cartService.itemCount() }}</span>
            }
            <span>Koszyk</span>
          </a>

          <a [routerLink]="auth.isAuthenticated() ? '/account' : '/auth/login'" class="header__action-link">
            <tui-icon icon="@tui.user" />
            <span>Konto</span>
          </a>
        </div>

      </div>
    </header>
  `,
  styles: [`
    .header {
      position: sticky;
      top: 0;
      z-index: 100;
      background: var(--color-surface);
      border-bottom: 1px solid var(--color-border);
      height: 64px;
    }
    .header__inner {
      max-width: var(--max-width, 1280px);
      margin: 0 auto;
      padding: 0 24px;
      height: 100%;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 24px;
    }

    /* ── Left ───────────────────────────────── */
    .header__left {
      display: flex;
      align-items: center;
      gap: 32px;
    }
    .header__logo {
      display: flex;
      flex-direction: column;
      line-height: 1;
      font-weight: 700;
      white-space: nowrap;
    }
    .header__logo-text { font-size: 18px; color: var(--color-primary); font-family: var(--tui-font-text); }
    .header__logo-sub  { font-size: 11px; color: var(--color-accent); letter-spacing: 0.1em; text-transform: uppercase; font-family: var(--tui-font-text); }
    .header__nav { display: flex; gap: 20px; }

    .header__nav-link {
      display: inline-flex;
      align-items: center;
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      color: var(--color-primary);
      font-size: 14px;
      font-weight: 500;
      font-family: var(--tui-font-text);
      transition: color 0.15s;
      white-space: nowrap;
    }
    .header__nav-link:hover,
    .header__nav-link.active { color: var(--color-accent); }

    .header__dropdown-divider { border: none; border-top: 1px solid var(--color-border); margin: 4px 0; }
    .header__dropdown-item--all { font-weight: 600; }

    /* ── Center ─────────────────────────────── */
    .header__search { display: flex; justify-content: center; }
    .header__search-form {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      max-width: 480px;
    }
    .header__search-field { flex: 1; min-width: 0; }
    .header__search-btn { flex-shrink: 0; }

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
    .header__action-link tui-icon { font-size: 20px; }
    .header__action-link--cart { position: relative; }
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
    @media (max-width: 999px) {
      .header__nav { display: none; }
      .header__action-link span { display: none; }
      .header__actions { gap: 12px; }
    }
  `],
})
export class HeaderComponent {
  readonly router = inject(Router);
  readonly cartService = inject(CartService);
  readonly auth = inject(AuthService);

  dropdownOpen = false;

  readonly searchForm = new FormGroup({
    q: new FormControl(''),
  });

  isCategoryActive(): boolean {
    return this.router.url.startsWith('/category/');
  }

  onSearch(): void {
    const q = this.searchForm.value.q?.trim();
    if (!q) return;
    this.router.navigate(['/products'], { queryParams: { q } });
    this.searchForm.reset();
  }

  logout(): void {
    this.auth.logout().subscribe();
  }
}
