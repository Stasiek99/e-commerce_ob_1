import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { timer, switchMap, takeWhile, take } from 'rxjs';
import { TuiButton, TuiIcon, TuiLoader } from '@taiga-ui/core';
import { environment } from '../../../../environments/environment';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { CartService } from '../../../core/services/cart.service';

interface PaymentStatusResponse {
  status: string;
  orderId: string;
}

@Component({
  selector: 'app-checkout-success',
  standalone: true,
  imports: [RouterLink, TuiButton, TuiIcon, TuiLoader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">

      @if (loading()) {
        <tui-loader [showLoader]="true" class="page__loader" />
        <p class="page__loading-text">Sprawdzamy status płatności…</p>
      } @else if (paid()) {
        <tui-icon icon="@tui.circle-check" class="page__icon page__icon--success" />
        <h1>Dziękujemy za zamówienie!</h1>
        <p>Potwierdzenie zostało wysłane na Twój adres e-mail.</p>

        @if (orderId()) {
          <div class="page__details">
            <h2>Szczegóły transakcji</h2>
            <div class="page__detail-row">
              <span>Numer zamówienia</span>
              <strong>{{ orderId() }}</strong>
            </div>
            <div class="page__detail-row">
              <span>Status płatności</span>
              <strong class="page__status--paid">Opłacono</strong>
            </div>
          </div>
        }

        <div class="page__actions">
          <a routerLink="/account/orders" tuiButton appearance="primary" size="l" type="button">
            Moje zamówienia
          </a>
          <a routerLink="/" tuiButton appearance="outline" size="l" type="button">
            Strona główna
          </a>
        </div>
        <p class="page__track-hint">
          Gość? <a routerLink="/orders/track">Sprawdź status zamówienia</a> podając email i numer zamówienia.
        </p>
      } @else {
        <tui-icon icon="@tui.clock" class="page__icon page__icon--pending" />
        <h1>Płatność w toku…</h1>
        <p>Weryfikacja może potrwać chwilę. Odśwież stronę za kilka sekund.</p>
        <a routerLink="/" tuiButton appearance="outline" size="l" type="button">
          Strona główna
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

    .page__loader {
      font-size: 48px;
      margin-bottom: 8px;
    }

    .page__loading-text {
      color: var(--tui-text-secondary);
      font-size: 15px;
      margin: 0;
    }

    .page__icon {
      font-size: 72px;
      margin-bottom: 8px;
    }

    .page__icon--success { color: var(--tui-status-positive); }
    .page__icon--pending { color: var(--tui-status-warning); }

    h1 {
      font-size: clamp(22px, 5vw, 28px);
      font-weight: 700;
      margin: 0;
    }

    p {
      color: var(--tui-text-secondary);
      font-size: 15px;
      margin: 0 0 8px;
      max-width: 420px;
    }

    .page__details {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--border-radius-md);
      padding: 20px 28px;
      min-width: 320px;
      margin: 8px 0;
    }

    h2 {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--tui-text-secondary);
      margin: 0 0 14px;
    }

    .page__detail-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 14px;
      padding: 6px 0;
      border-bottom: 1px solid var(--color-border);
      gap: 24px;
    }

    .page__detail-row:last-child { border-bottom: none; }

    .page__detail-row span { color: var(--tui-text-secondary); }

    .page__status--paid { color: var(--tui-status-positive); }

    .page__actions {
      display: flex;
      gap: 12px;
      margin-top: 8px;
      flex-wrap: wrap;
      justify-content: center;
    }

    .page__track-hint {
      font-size: 13px;
      color: var(--color-secondary);
      margin: 0;
    }
    .page__track-hint a { color: var(--color-primary); font-weight: 500; text-decoration: underline; }
  `],
})
export class CheckoutSuccessComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly analytics = inject(AnalyticsService);
  private readonly cart = inject(CartService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly paid = signal(false);
  readonly orderId = signal<string | null>(null);

  ngOnInit(): void {
    const id = this.route.snapshot.queryParamMap.get('orderId');
    const token = this.route.snapshot.queryParamMap.get('token');
    this.orderId.set(id);

    if (!id) {
      this.loading.set(false);
      return;
    }

    const statusUrl = token
      ? `${environment.apiUrl}/payments/${id}/status?token=${encodeURIComponent(token)}`
      : `${environment.apiUrl}/payments/${id}/status`;

    // Poll every 3 s for up to 30 s (10 ticks) so a slow webhook race
    // doesn't leave the user stuck on "Płatność w toku" forever.
    timer(0, 3000).pipe(
      switchMap(() =>
        this.http.get<PaymentStatusResponse>(statusUrl),
      ),
      takeWhile((res) => res.status !== 'COMPLETED', true),
      take(10),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (res) => {
        if (res.status === 'COMPLETED') {
          this.paid.set(true);
          this.cart.clear();
          this.firePurchaseEvent(id);
          this.loading.set(false);
        }
      },
      error: () => this.loading.set(false),
      complete: () => this.loading.set(false),
    });
  }

  private firePurchaseEvent(orderId: string): void {
    try {
      const raw = sessionStorage.getItem('_pending_purchase');
      if (raw) {
        const data = JSON.parse(raw) as {
          items: Array<{ productVariantId: string; productName: string; variantLabel: string; priceInCents: number; quantity: number }>;
          shippingInCents: number;
        };
        const totalInCents = data.items.reduce((s, i) => s + i.priceInCents * i.quantity, 0) + data.shippingInCents;
        this.analytics.trackPurchase({ transactionId: orderId, totalInCents, shippingInCents: data.shippingInCents, items: data.items });
        sessionStorage.removeItem('_pending_purchase');
        return;
      }
    } catch { /* sessionStorage unavailable */ }
    this.analytics.push({ event: 'purchase', ecommerce: { transaction_id: orderId, currency: 'PLN' } });
  }
}
