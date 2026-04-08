import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-checkout-failure',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="failure">
      <div class="failure__icon">✕</div>
      <h1>Płatność nie powiodła się</h1>
      <p>Spróbuj ponownie lub wybierz inną metodę płatności.</p>
      <a routerLink="/cart">Wróć do koszyka</a>
    </div>
  `,
  styles: [`
    .failure { text-align: center; padding: 96px 0; }
    .failure__icon { font-size: 64px; color: var(--color-error); margin-bottom: 16px; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 12px; }
    p { color: var(--color-secondary); margin-bottom: 24px; }
    a { display: inline-block; padding: 12px 24px; background: var(--color-primary); color: white; border-radius: var(--radius-md); }
  `],
})
export class CheckoutFailureComponent {}
