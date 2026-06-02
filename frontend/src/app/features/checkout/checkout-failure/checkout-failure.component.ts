import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { TuiButton, TuiIcon } from '@taiga-ui/core';
import { environment } from '../../../../environments/environment';

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

      @if (orderId()) {
        <div class="actions">
          <button
            tuiButton
            appearance="primary"
            size="l"
            type="button"
            [disabled]="retrying()"
            (click)="retryPayment()"
          >
            {{ retrying() ? 'Przekierowuję...' : 'Spróbuj ponownie' }}
          </button>
          <button
            tuiButton
            appearance="outline"
            size="l"
            type="button"
            [disabled]="cancelling()"
            (click)="cancelOrder()"
          >
            {{ cancelling() ? 'Anulowanie...' : 'Anuluj zamówienie' }}
          </button>
        </div>
      } @else {
        <a routerLink="/cart" tuiButton appearance="outline" size="l" type="button">
          Wróć do koszyka
        </a>
      }
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

    .actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      justify-content: center;
    }
  `],
})
export class CheckoutFailureComponent {
  private readonly route  = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http   = inject(HttpClient);

  readonly orderId   = signal<string | null>(this.route.snapshot.queryParamMap.get('orderId'));
  readonly retrying  = signal(false);
  readonly cancelling = signal(false);

  retryPayment(): void {
    const id = this.orderId();
    if (!id) return;
    this.retrying.set(true);
    this.http.post<{ paymentUrl: string }>(`${environment.apiUrl}/orders/${id}/retry-payment`, {}).subscribe({
      next: ({ paymentUrl }) => { window.location.href = paymentUrl; },
      error: () => { this.retrying.set(false); },
    });
  }

  cancelOrder(): void {
    const id = this.orderId();
    if (!id) return;
    this.cancelling.set(true);
    this.http.post(`${environment.apiUrl}/orders/${id}/cancel`, {}).subscribe({
      next: () => { this.router.navigate(['/cart']); },
      error: () => { this.cancelling.set(false); },
    });
  }
}
