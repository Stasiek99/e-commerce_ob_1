import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CartService } from '../../../core/services/cart.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <header class="header">
      <div class="header__inner">
        <a routerLink="/" class="header__logo">
          <span class="header__logo-text">Fragrance</span>
          <span class="header__logo-sub">Store</span>
        </a>

        <nav class="header__nav">
          <a routerLink="/products" routerLinkActive="active">Perfumy</a>
          <a routerLink="/category/dyfuzory" routerLinkActive="active">Dyfuzory</a>
        </nav>

        <div class="header__actions">
          @if (auth.isAuthenticated()) {
            <a routerLink="/account">Konto</a>
            <button (click)="logout()">Wyloguj</button>
          } @else {
            <a routerLink="/auth/login">Zaloguj się</a>
          }
          <a routerLink="/cart" class="header__cart">
            Koszyk
            @if (cartService.itemCount() > 0) {
              <span class="header__cart-badge">{{ cartService.itemCount() }}</span>
            }
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
      max-width: var(--max-width);
      margin: 0 auto;
      padding: 0 16px;
      height: 100%;
      display: flex;
      align-items: center;
      gap: 32px;
    }
    .header__logo {
      display: flex;
      flex-direction: column;
      line-height: 1;
      font-weight: 700;
    }
    .header__logo-text { font-size: 18px; color: var(--color-primary); }
    .header__logo-sub { font-size: 11px; color: var(--color-accent); letter-spacing: 0.1em; text-transform: uppercase; }
    .header__nav { display: flex; gap: 24px; margin-left: auto; }
    .header__nav a { color: var(--color-secondary); font-size: 14px; transition: color 0.15s; }
    .header__nav a:hover, .header__nav a.active { color: var(--color-primary); }
    .header__actions { display: flex; align-items: center; gap: 16px; font-size: 14px; }
    .header__cart { position: relative; font-weight: 500; }
    .header__cart-badge {
      position: absolute;
      top: -8px;
      right: -12px;
      background: var(--color-accent);
      color: white;
      border-radius: 50%;
      width: 18px;
      height: 18px;
      font-size: 11px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    button { background: none; border: none; cursor: pointer; font-size: 14px; color: var(--color-secondary); padding: 0; }
  `],
})
export class HeaderComponent {
  readonly cartService = inject(CartService);
  readonly auth = inject(AuthService);

  logout() {
    this.auth.logout().subscribe();
  }
}
