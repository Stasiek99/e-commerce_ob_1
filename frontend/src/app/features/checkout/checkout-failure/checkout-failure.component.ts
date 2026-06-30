import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient, HttpParams } from '@angular/common/http';
import { TuiButton, TuiIcon } from '@taiga-ui/core';
import { environment } from '../../../../environments/environment';
import { SeoService } from '../../../core/services/seo.service';

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
        @if (retryError()) {
          <p class="page__error" role="alert">{{ retryError() }}</p>
        }
        @if (cancelError()) {
          <p class="page__error" role="alert">{{ cancelError() }}</p>
        }
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

    .page__error {
      font-size: 13px;
      color: var(--tui-status-negative);
      margin: 0;
    }
  `],
})
export class CheckoutFailureComponent implements OnInit {
  private readonly route  = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http   = inject(HttpClient);
  private readonly seo    = inject(SeoService);

  readonly orderId    = signal<string | null>(this.route.snapshot.queryParamMap.get('orderId'));
  readonly guestToken = signal<string | null>(this.route.snapshot.queryParamMap.get('guestToken'));
  readonly retrying    = signal(false);
  readonly cancelling  = signal(false);
  readonly retryError  = signal<string | null>(null);
  readonly cancelError = signal<string | null>(null);

  ngOnInit(): void {
    this.seo.setRobotsTag('noindex,nofollow');
  }

  retryPayment(): void {
    const id = this.orderId();
    if (!id) return;
    this.retrying.set(true);
    this.retryError.set(null);
    const token = this.guestToken();
    let params = new HttpParams();
    if (token) params = params.set('token', token);
    this.http.post<{ paymentUrl: string }>(`${environment.apiUrl}/orders/${id}/retry-payment`, {}, { params }).subscribe({
      next: ({ paymentUrl }) => { window.location.href = paymentUrl; },
      error: (err) => {
        this.retrying.set(false);
        this.retryError.set(err.error?.message ?? 'Nie udało się ponowić płatności. Spróbuj ponownie.');
      },
    });
  }

  cancelOrder(): void {
    const id = this.orderId();
    if (!id) return;
    this.cancelling.set(true);
    this.cancelError.set(null);
    const token = this.guestToken();
    let params = new HttpParams();
    if (token) params = params.set('token', token);
    this.http.post(`${environment.apiUrl}/orders/${id}/cancel`, {}, { params }).subscribe({
      next: () => { this.router.navigate(['/cart']); },
      error: () => {
        this.cancelling.set(false);
        this.cancelError.set('Nie udało się anulować zamówienia. Skontaktuj się z obsługą sklepu.');
      },
    });
  }
}
