import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TuiButton, TuiIcon } from '@taiga-ui/core';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { PwaInstallService } from '../../../core/services/pwa-install.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, TuiButton, TuiIcon],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>Witaj, {{ firstName() }}!</h1>
          <p class="subtitle">Co chcesz dzisiaj zrobić?</p>
        </div>
        <button tuiButton appearance="accent" size="s" type="button" (click)="logout()">
          Wyloguj
        </button>
      </div>

      @if (!isVerified()) {
        <div class="verify-banner">
          <tui-icon icon="@tui.mail" class="verify-banner__icon" />
          <div class="verify-banner__body">
            <strong>Potwierdź swój adres email</strong>
            <span>Sprawdź skrzynkę odbiorczą i kliknij link aktywacyjny, który wysłaliśmy przy rejestracji.</span>
          </div>
          <button tuiButton appearance="outline" size="s" type="button"
                  [disabled]="resending" (click)="resend()">
            {{ resending ? 'Wysyłanie…' : 'Wyślij ponownie' }}
          </button>
        </div>
      }

      @if (pwa.canInstall()) {
        <div class="install-banner">
          <div class="install-banner__icon-wrap">
            <tui-icon icon="@tui.smartphone" class="install-banner__icon" />
          </div>
          <div class="install-banner__body">
            <strong>Zainstaluj aplikację Aromaterie</strong>
            <span>Przeglądaj szybciej bez przeglądarki — prosto z ekranu głównego.</span>
          </div>
          <button tuiButton appearance="accent" size="s" type="button"
                  [disabled]="installing" (click)="install()">
            {{ installing ? 'Instalowanie…' : 'Zainstaluj' }}
          </button>
        </div>
      }

      <div class="grid">

        <a routerLink="orders" class="card">
          <tui-icon icon="@tui.package" class="card__icon" />
          <span class="card__label">Moje zamówienia</span>
          <span class="card__desc">Historia i status Twoich zamówień</span>
        </a>

        <a routerLink="profile" class="card">
          <tui-icon icon="@tui.user-pen" class="card__icon" />
          <span class="card__label">Dane osobowe</span>
          <span class="card__desc">Imię, nazwisko, numer telefonu</span>
        </a>

        <a routerLink="addresses" class="card">
          <tui-icon icon="@tui.map-pinned" class="card__icon" />
          <span class="card__label">Adresy dostawy</span>
          <span class="card__desc">Zarządzaj zapisanymi adresami</span>
        </a>

      </div>
    </div>
  `,
  styles: [`
    .page { padding: 32px 0; }
    .page-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 32px; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 6px; }
    .subtitle { color: var(--color-secondary); font-size: 15px; margin: 0; }

    .verify-banner {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px 20px;
      margin-bottom: 28px;
      background: #fefce8;
      border: 1px solid #fde68a;
      border-radius: var(--border-radius-md);
    }
    .verify-banner__icon { font-size: 22px; color: #b45309; flex-shrink: 0; }
    .verify-banner__body { display: flex; flex-direction: column; gap: 2px; flex: 1; font-size: 14px; }
    .verify-banner__body strong { color: #92400e; }
    .verify-banner__body span { color: #78350f; }

    .install-banner {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px 20px;
      margin-bottom: 28px;
      background: linear-gradient(135deg, rgba(201, 169, 110, 0.10) 0%, rgba(201, 169, 110, 0.04) 100%);
      border: 1px solid rgba(201, 169, 110, 0.35);
      border-radius: var(--border-radius-md);
    }
    .install-banner__icon-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      background: rgba(201, 169, 110, 0.15);
      border-radius: 10px;
      flex-shrink: 0;
    }
    .install-banner__icon { font-size: 20px; color: var(--color-accent-text); }
    .install-banner__body { display: flex; flex-direction: column; gap: 2px; flex: 1; font-size: 14px; }
    .install-banner__body strong { color: var(--color-primary); font-weight: 600; }
    .install-banner__body span { color: var(--color-secondary); }

    .grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 24px;
    }

    .card {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 28px 24px;
      background: var(--color-surface);
      border-radius: var(--border-radius-md);
      box-shadow: var(--shadow-sm);
      color: inherit;
      text-decoration: none;
      transition: box-shadow 0.2s ease, transform 0.2s ease;
    }
    .card:hover {
      box-shadow: var(--shadow-hover);
      transform: translateY(-2px);
    }
    .card:hover .card__icon { color: var(--color-accent-text); }

    .card__icon {
      font-size: 32px;
      color: var(--color-primary);
      transition: color 0.15s;
      margin-bottom: 4px;
    }
    .card__label { font-size: 15px; font-weight: 600; }
    .card__desc  { font-size: 13px; color: var(--color-secondary); line-height: 1.4; }

    @media (max-width: 768px) { .grid { grid-template-columns: repeat(2, 1fr); gap: 16px; } }
    @media (max-width: 480px) { .grid { grid-template-columns: 1fr; gap: 12px; } }
    @media (max-width: 480px) { h1 { font-size: 22px; } }
    @media (max-width: 640px) {
      .verify-banner { flex-wrap: wrap; }
      .install-banner { flex-wrap: wrap; }
    }
  `],
})
export class DashboardComponent {
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  readonly pwa = inject(PwaInstallService);

  resending = false;
  installing = false;

  firstName(): string {
    return this.auth.currentUser()?.firstName || 'Użytkowniku';
  }

  isVerified(): boolean {
    return this.auth.currentUser()?.isEmailVerified ?? true;
  }

  resend(): void {
    this.resending = true;
    this.auth.resendVerification().subscribe({
      next: () => {
        this.toast.success('Link weryfikacyjny został wysłany na Twój adres email.');
        this.resending = false;
      },
      error: () => {
        this.toast.error('Nie udało się wysłać emaila. Spróbuj ponownie za chwilę.');
        this.resending = false;
      },
    });
  }

  async install(): Promise<void> {
    this.installing = true;
    const outcome = await this.pwa.promptInstall();
    this.installing = false;

    if (outcome === 'accepted') {
      this.toast.success('Aplikacja Aromaterie została zainstalowana!');
    }
  }

  logout(): void {
    this.auth.logout().subscribe({
      next: () => this.toast.info('Zostałeś wylogowany.'),
    });
  }
}