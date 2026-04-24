import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TuiButton, TuiIcon } from '@taiga-ui/core';

@Component({
  selector: 'app-checkout-failure',
  standalone: true,
  imports: [RouterLink, TuiButton, TuiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <tui-icon icon="@tui.circle-x" class="page__icon page__icon--error" />
      <h1>Płatność nie powiodła się</h1>
      <p>Coś poszło nie tak. Spróbuj ponownie lub wybierz inną metodę płatności.</p>
      <a routerLink="/cart" tuiButton appearance="outline" size="l" type="button">
        Wróć do koszyka
      </a>
    </div>
  `,
  styles: [`
    .page {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 96px 16px;
      gap: 16px;
    }

    .page__icon {
      font-size: 72px;
      margin-bottom: 8px;
    }

    .page__icon--error {
      color: var(--tui-status-negative);
    }

    h1 {
      font-size: clamp(22px, 5vw, 28px);
      font-weight: 700;
      margin: 0;
    }

    p {
      color: var(--tui-text-secondary);
      font-size: 15px;
      margin: 0 0 8px;
      max-width: 400px;
    }
  `],
})
export class CheckoutFailureComponent {}
