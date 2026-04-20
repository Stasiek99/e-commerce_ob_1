import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

const TILES = [
  {
    route: 'orders',
    icon: '📦',
    label: 'Moje zamówienia',
    description: 'Historia i status Twoich zamówień',
  },
  {
    route: 'profile',
    icon: '👤',
    label: 'Dane osobowe',
    description: 'Imię, nazwisko, numer telefonu',
  },
  {
    route: 'addresses',
    icon: '📍',
    label: 'Adresy dostawy',
    description: 'Zarządzaj zapisanymi adresami',
  },
];

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="page">
      <h1>Witaj, {{ firstName() }}!</h1>
      <p class="subtitle">Co chcesz dzisiaj zrobić?</p>

      <div class="grid">
        @for (tile of tiles; track tile.route) {
          <a [routerLink]="tile.route" class="tile">
            <span class="tile__icon">{{ tile.icon }}</span>
            <span class="tile__label">{{ tile.label }}</span>
            <span class="tile__desc">{{ tile.description }}</span>
          </a>
        }
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 40px 0; max-width: 640px; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 6px; }
    .subtitle { color: var(--color-secondary); margin-bottom: 32px; font-size: 15px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .tile {
      display: flex; flex-direction: column; gap: 6px;
      background: var(--color-surface); border: 1px solid var(--color-border);
      border-radius: var(--radius-md); padding: 24px 20px;
      text-decoration: none; color: inherit;
      transition: box-shadow 0.15s, border-color 0.15s;
    }
    .tile:hover { border-color: var(--color-primary); box-shadow: 0 4px 12px rgba(0,0,0,.07); }
    .tile__icon { font-size: 28px; }
    .tile__label { font-size: 15px; font-weight: 600; margin-top: 4px; }
    .tile__desc { font-size: 13px; color: var(--color-secondary); line-height: 1.4; }
    @media (max-width: 520px) { .grid { grid-template-columns: 1fr; } }
  `],
})
export class DashboardComponent {
  readonly tiles = TILES;
  private readonly auth = inject(AuthService);

  firstName() {
    return this.auth.currentUser()?.firstName || 'Użytkowniku';
  }
}
