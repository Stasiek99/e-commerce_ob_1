import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { TuiButton, TuiLabel, TuiTextfield } from '@taiga-ui/core';
import { environment } from '../../../../environments/environment';
import { PricePipe } from '../../../shared/pipes/price.pipe';

const TRACKING_URLS: Record<string, string> = {
  INPOST:      'https://inpost.pl/sledzenie-przesylek?number=',
  DHL:         'https://www.dhl.com/pl-pl/home/tracking.html?tracking-id=',
  GLS:         'https://gls-group.com/track/?match=',
  DPD:         'https://tracktrace.dpd.com.pl/parcelDetails?typ=1&p1=',
  DPD_COURIER: 'https://tracktrace.dpd.com.pl/parcelDetails?typ=1&p1=',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: 'Oczekuje na płatność',
  FRAUD_REVIEW:    'Weryfikacja',
  PAID:            'Opłacone',
  PROCESSING:      'W realizacji',
  SHIPPED:         'Wysłane',
  DELIVERED:       'Dostarczone',
  CANCELLED:       'Anulowane',
  REFUNDED:        'Zwrócone',
};

interface TrackResult {
  orderNumber: string;
  status: string;
  createdAt: string;
  totalInCents: number;
  items: Array<{ snapshotName: string; quantity: number; snapshotPrice: number }>;
  trackingNumber: string | null;
  carrier: string | null;
}

@Component({
  selector: 'app-track-order',
  standalone: true,
  imports: [ReactiveFormsModule, DatePipe, TuiButton, TuiLabel, TuiTextfield, PricePipe],
  template: `
    <div class="page">
      <div class="card">
        <h1>Sprawdź status zamówienia</h1>
        <p class="subtitle">Podaj adres email użyty przy składaniu zamówienia oraz numer zamówienia.</p>

        <form [formGroup]="form" (ngSubmit)="track()" class="track-form">
          <tui-textfield>
            <label tuiLabel>Adres email</label>
            <input tuiTextfield type="email" formControlName="email" autocomplete="email" />
          </tui-textfield>
          <tui-textfield>
            <label tuiLabel>Numer zamówienia (np. ORD-2026-000001)</label>
            <input tuiTextfield type="text" formControlName="orderNumber" autocomplete="off" />
          </tui-textfield>
          <button tuiButton type="submit" [disabled]="form.invalid || loading()">
            {{ loading() ? 'Szukanie…' : 'Sprawdź zamówienie' }}
          </button>
          @if (notFound()) {
            <p class="error">Nie znaleziono zamówienia. Sprawdź poprawność danych.</p>
          }
        </form>
      </div>

      @if (result()) {
        <div class="result">
          <div class="result-header">
            <div>
              <h2>#{{ result()!.orderNumber }}</h2>
              <p class="result-date">{{ result()!.createdAt | date:'dd.MM.yyyy' }}</p>
            </div>
            <span class="status"
              [class.status--paid]="result()!.status === 'PAID'"
              [class.status--pending_payment]="result()!.status === 'PENDING_PAYMENT'"
              [class.status--processing]="result()!.status === 'PROCESSING'"
              [class.status--shipped]="result()!.status === 'SHIPPED'"
              [class.status--delivered]="result()!.status === 'DELIVERED'"
              [class.status--cancelled]="result()!.status === 'CANCELLED'"
              [class.status--refunded]="result()!.status === 'REFUNDED'">
              {{ statusLabel(result()!.status) }}
            </span>
          </div>

          <div class="items-card">
            @for (item of result()!.items; track item.snapshotName) {
              <div class="item">
                <span>{{ item.snapshotName }} × {{ item.quantity }}</span>
                <span>{{ item.snapshotPrice * item.quantity | price }}</span>
              </div>
            }
            <div class="item item--total">
              <strong>Łącznie</strong>
              <strong>{{ result()!.totalInCents | price }}</strong>
            </div>
          </div>

          @if (result()!.trackingNumber) {
            <div class="tracking">
              <p class="tracking-label">Numer śledzenia przesyłki</p>
              @if (trackingUrl(result()!.carrier, result()!.trackingNumber)) {
                <a class="tracking-number" [href]="trackingUrl(result()!.carrier, result()!.trackingNumber)!" target="_blank" rel="noopener noreferrer">
                  {{ result()!.trackingNumber }}
                </a>
              } @else {
                <p class="tracking-number">{{ result()!.trackingNumber }}</p>
              }
              @if (result()!.carrier) {
                <p class="tracking-carrier">{{ result()!.carrier }}</p>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .page { max-width: 540px; margin: 0 auto; padding: 32px 0 64px; }

    .card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--border-radius-md);
      padding: 28px;
      margin-bottom: 28px;
    }
    h1 { font-size: 22px; font-weight: 700; margin: 0 0 8px; }
    .subtitle { font-size: 14px; color: var(--color-secondary); margin: 0 0 24px; line-height: 1.5; }

    .track-form { display: flex; flex-direction: column; gap: 16px; }
    .error { font-size: 13px; color: var(--color-error); margin: 0; }

    .result-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
    h2 { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
    .result-date { font-size: 13px; color: var(--color-secondary); margin: 0; }

    .status {
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: var(--color-border);
      white-space: nowrap;
    }
    .status--paid            { background: var(--color-status-paid-bg);      color: var(--color-status-paid-text); }
    .status--pending_payment { background: var(--color-status-pending-bg);   color: var(--color-status-pending-text); }
    .status--cancelled       { background: var(--color-status-cancelled-bg); color: var(--color-status-cancelled-text); }
    .status--shipped         { background: var(--color-status-shipped-bg);   color: var(--color-status-shipped-text); }
    .status--refunded        { background: #f3f4f6; color: #6b7280; }
    .status--processing      { background: #eff6ff; color: #1d4ed8; }
    .status--delivered       { background: #f0fdf4; color: #166534; }

    .items-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--border-radius-md);
      overflow: hidden;
      margin-bottom: 16px;
    }
    .item { display: flex; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--color-border); font-size: 14px; }
    .item:last-child { border-bottom: none; }
    .item--total { font-weight: 600; background: var(--color-surface); }

    .tracking {
      padding: 16px;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: var(--border-radius-md);
    }
    .tracking-label { font-size: 12px; color: #166534; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 4px; }
    .tracking-number { font-size: 16px; font-weight: 700; color: #14532d; margin: 0 0 2px; font-family: monospace; }
    .tracking-carrier { font-size: 13px; color: #166534; margin: 0; }
  `],
})
export class TrackOrderComponent {
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);

  readonly loading = signal(false);
  readonly notFound = signal(false);
  readonly result = signal<TrackResult | null>(null);

  readonly form = this.fb.group({
    email:       ['', [Validators.required, Validators.email]],
    orderNumber: ['', [Validators.required, Validators.minLength(5)]],
  });

  statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
  }

  trackingUrl(carrier: string | null, number: string | null): string | null {
    if (!carrier || !number) return null;
    const base = TRACKING_URLS[carrier];
    return base ? base + encodeURIComponent(number) : null;
  }

  track(): void {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.notFound.set(false);
    this.result.set(null);

    const { email, orderNumber } = this.form.getRawValue();
    this.http
      .get<TrackResult>(`${environment.apiUrl}/orders/track`, {
        params: { email: email!, orderNumber: orderNumber! },
      })
      .subscribe({
        next: (res) => {
          this.result.set(res);
          this.loading.set(false);
        },
        error: () => {
          this.notFound.set(true);
          this.loading.set(false);
        },
      });
  }
}
