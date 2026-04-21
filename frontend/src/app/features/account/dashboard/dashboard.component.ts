import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TuiButton, TuiIcon } from '@taiga-ui/core';
import { AuthService } from '../../../core/services/auth.service';

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
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.07);
      color: inherit;
      text-decoration: none;
      transition: box-shadow 0.2s ease, transform 0.2s ease;
    }
    .card:hover {
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.13);
      transform: translateY(-2px);
    }
    .card:hover .card__icon { color: var(--color-accent); }

    .card__icon {
      font-size: 32px;
      color: var(--color-primary);
      transition: color 0.15s;
      margin-bottom: 4px;
    }
    .card__label { font-size: 15px; font-weight: 600; }
    .card__desc  { font-size: 13px; color: var(--color-secondary); line-height: 1.4; }

    @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
  `],
})
export class DashboardComponent {
  private readonly auth = inject(AuthService);

  firstName(): string {
    return this.auth.currentUser()?.firstName || 'Użytkowniku';
  }

  logout(): void {
    this.auth.logout().subscribe();
  }
}
