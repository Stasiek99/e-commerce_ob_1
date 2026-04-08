import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-checkout-success',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="success">
      @if (loading()) {
        <p>Sprawdzanie płatności...</p>
      } @else if (paid()) {
        <div class="success__icon">✓</div>
        <h1>Dziękujemy za zamówienie!</h1>
        <p>Potwierdzenie zostało wysłane na Twój email.</p>
        <a routerLink="/account/orders">Moje zamówienia</a>
      } @else {
        <h1>Płatność w toku…</h1>
        <p>Weryfikacja może potrwać chwilę. Odśwież stronę za kilka sekund.</p>
      }
    </div>
  `,
  styles: [`
    .success { text-align: center; padding: 96px 0; }
    .success__icon { font-size: 64px; color: var(--color-success); margin-bottom: 16px; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 12px; }
    p { color: var(--color-secondary); margin-bottom: 24px; }
    a { display: inline-block; padding: 12px 24px; background: var(--color-primary); color: white; border-radius: var(--radius-md); }
  `],
})
export class CheckoutSuccessComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);

  readonly loading = signal(true);
  readonly paid = signal(false);

  ngOnInit() {
    const orderId = this.route.snapshot.queryParamMap.get('orderId');
    if (!orderId) { this.loading.set(false); return; }

    this.http
      .get<any>(`${environment.apiUrl}/payments/${orderId}/status`)
      .subscribe({
        next: (res) => {
          this.paid.set(res.status === 'COMPLETED');
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }
}
