import { Component, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TuiButton, TuiTitle, TuiIcon } from '@taiga-ui/core';
import { TuiCard } from '@taiga-ui/layout';
import { CartService } from '../../../core/services/cart.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-checkout-auth-choice',
  standalone: true,
  imports: [RouterLink, TuiButton, TuiTitle, TuiIcon, TuiCard],
  template: `
    <div class="page">
      <h1>Przejdź do kasy</h1>
      <p class="subtitle">Wybierz sposób, w jaki chcesz złożyć zamówienie</p>

      <div class="options">

        <!-- Login -->
        <div tuiCardLarge appearance="elevated" class="option-card">
          <div class="option-icon">
            <tui-icon icon="@tui.user" />
          </div>
          <div tuiTitle class="option-text">
            <span class="option-title">Mam już konto</span>
            <span class="option-desc">Zaloguj się, aby skorzystać z zapisanych adresów i śledzić zamówienia</span>
          </div>
          <a tuiButton
            [routerLink]="['/auth/login']"
            [queryParams]="{ returnTo: '/checkout' }"
          >
            Zaloguj się
          </a>
        </div>

        <!-- Register -->
        <div tuiCardLarge appearance="elevated" class="option-card">
          <div class="option-icon">
            <tui-icon icon="@tui.user-plus" />
          </div>
          <div tuiTitle class="option-text">
            <span class="option-title">Chcę założyć konto</span>
            <span class="option-desc">Utwórz konto, aby zarządzać zamówieniami i szybciej robić zakupy w przyszłości</span>
          </div>
          <a tuiButton appearance="secondary"
            [routerLink]="['/auth/register']"
            [queryParams]="{ returnTo: '/checkout' }"
          >
            Utwórz konto
          </a>
        </div>

      </div>

      <!-- Guest -->
      <div class="guest-section">
        <span class="divider-text">lub</span>
        <button tuiButton appearance="flat" type="button" (click)="continueAsGuest()">
          Kontynuuj bez logowania
        </button>
      </div>
    </div>
  `,
  styles: [`
    .page {
      max-width: 600px;
      margin: 0 auto;
      padding: 48px 16px;
      text-align: center;
    }

    h1 { font-size: clamp(22px, 5vw, 30px); font-weight: 700; margin-bottom: 8px; }
    .subtitle { font-size: 15px; color: var(--color-secondary); margin-bottom: 40px; }

    .options { display: flex; flex-direction: column; gap: 16px; text-align: left; }

    .option-card {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .option-icon {
      flex-shrink: 0;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--tui-background-neutral-1, #f0f0f5);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }

    .option-text {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .option-title { font-weight: 600; font-size: 15px; }
    .option-desc  { font-size: 13px; color: var(--color-secondary); }

    .guest-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      margin-top: 32px;
    }

    .divider-text {
      font-size: 13px;
      color: var(--color-secondary);
      position: relative;
      display: flex;
      align-items: center;
      width: 100%;
      gap: 12px;
    }
    .divider-text::before,
    .divider-text::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--color-border);
    }

    @media (max-width: 480px) {
      .option-card { flex-wrap: wrap; }
    }
  `],
})
export class CheckoutAuthChoiceComponent implements OnInit {
  private readonly router     = inject(Router);
  private readonly cart       = inject(CartService);
  private readonly auth       = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);

  ngOnInit(): void {
    if (!this.cart.items().length) {
      this.router.navigate(['/cart']);
      return;
    }
    // Already logged in — skip straight to checkout
    if (this.auth.isAuthenticated()) {
      this.router.navigate(['/checkout']);
    }
  }

  continueAsGuest(): void {
    if (isPlatformBrowser(this.platformId)) sessionStorage.setItem('checkout_guest', '1');
    this.router.navigate(['/checkout']);
  }
}
