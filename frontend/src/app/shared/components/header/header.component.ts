import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, Router } from '@angular/router';
import { ReactiveFormsModule, FormControl, FormGroup } from '@angular/forms';
import { TuiButton, TuiIcon, TuiTextfield } from '@taiga-ui/core';
import { TuiSearch } from '@taiga-ui/layout';
import { CartService } from '../../../core/services/cart.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    RouterLink,
    RouterLinkActive,
    ReactiveFormsModule,
    TuiButton,
    TuiIcon,
    TuiTextfield,
    TuiSearch,
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
            <a routerLink="/products" routerLinkActive="active">Perfumy</a>
            <a routerLink="/category/dyfuzory" routerLinkActive="active">Dyfuzory</a>
          </nav>
        </div>

        <!-- CENTER: search -->
        <div class="header__search">
          <search tuiSearch>
            <form [formGroup]="searchForm" (ngSubmit)="onSearch()">
              <fieldset tuiTextfieldSize="s">
                <tui-textfield iconStart="@tui.search">
                  <input
                    formControlName="q"
                    placeholder="Szukaj produktów…"
                    tuiTextfield
                  />
                </tui-textfield>
              </fieldset>
              <button size="s" tuiButton type="submit">Szukaj</button>
            </form>
          </search>
        </div>

        <!-- RIGHT: actions -->
        <div class="header__actions">
          <a routerLink="/account/wishlist" class="header__action-link">
            <tui-icon src="@tui.heart" class="header__action-icon" />
            <span>Ulubione</span>
          </a>

          <a routerLink="/cart" class="header__action-link header__action-link--cart">
            <tui-icon src="@tui.shopping-cart" class="header__action-icon" />
            <span>Koszyk</span>
            @if (cartService.itemCount() > 0) {
              <span class="header__cart-badge">{{ cartService.itemCount() }}</span>
            }
          </a>

          @if (auth.isAuthenticated()) {
            <a routerLink="/account" class="header__action-link">Konto</a>
            <button class="header__logout" (click)="logout()">Wyloguj</button>
          } @else {
            <a routerLink="/auth/login" class="header__action-link">Zaloguj się</a>
          }
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
    .header__logo-text { font-size: 18px; color: var(--color-primary); }
    .header__logo-sub  { font-size: 11px; color: var(--color-accent); letter-spacing: 0.1em; text-transform: uppercase; }
    .header__nav { display: flex; gap: 20px; }
    .header__nav a { color: var(--color-secondary); font-size: 14px; transition: color 0.15s; white-space: nowrap; }
    .header__nav a:hover, .header__nav a.active { color: var(--color-primary); }

    /* ── Center ─────────────────────────────── */
    .header__search {
      display: flex;
      justify-content: center;
    }
    .header__search search {
      width: 100%;
      max-width: 480px;
    }

    /* ── Right ──────────────────────────────── */
    .header__actions {
      display: flex;
      align-items: center;
      gap: 20px;
    }
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
    .header__action-icon { font-size: 18px; }

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
    .header__logout {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 13px;
      color: var(--color-secondary);
      padding: 0;
      transition: color 0.15s;
    }
    .header__logout:hover { color: var(--color-primary); }
  `],
})
export class HeaderComponent {
  private readonly router = inject(Router);
  readonly cartService = inject(CartService);
  readonly auth = inject(AuthService);

  readonly searchForm = new FormGroup({
    q: new FormControl(''),
  });

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
