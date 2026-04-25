import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TuiButton, TuiIcon, TuiLabel, TuiTextfield } from '@taiga-ui/core';
import { TuiNativeSelect } from '@taiga-ui/kit';
import { environment } from '../../../../environments/environment';
import { PricePipe } from '../../../shared/pipes/price.pipe';
import { ToastService } from '../../../core/services/toast.service';

const CANCEL_REASON_ITEMS = [
  'Znalazłem(-am) taniej w innym miejscu',
  'Zamówiłem(-am) zły produkt',
  'Zbyt długi czas dostawy',
  'Zmieniłem(-am) zdanie',
  'Inny powód',
] as const;

interface OrderItem {
  id: string;
  snapshotName: string;
  snapshotSku: string;
  snapshotPrice: number;
  quantity: number;
  productVariantId: string;
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  items: OrderItem[];
  shippingCostInCents: number;
  totalInCents: number;
  shipment?: { trackingNumber?: string } | null;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: 'Oczekuje na płatność',
  PAID:            'Opłacone',
  PROCESSING:      'W realizacji',
  SHIPPED:         'Wysłane',
  DELIVERED:       'Dostarczone',
  CANCELLED:       'Anulowane',
  REFUNDED:        'Zwrócone',
};

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [PricePipe, FormsModule, TuiButton, TuiIcon, TuiLabel, TuiTextfield, TuiNativeSelect],
  template: `
    @if (order()) {
      <div class="page">
        <button tuiButton appearance="flat" size="s" type="button" class="back-btn" (click)="back()">
          <tui-icon icon="@tui.chevron-left" />
          Wróć
        </button>

        <div class="order-header">
          <div>
            <h1>Zamówienie #{{ order()!.orderNumber }}</h1>
            <span class="status status--{{ order()!.status.toLowerCase() }}">
              {{ statusLabel(order()!.status) }}
            </span>
          </div>
        </div>

        <div class="items-card">
          @for (item of order()!.items; track item.id) {
            <div class="item">
              <span class="item-name">{{ item.snapshotName }} × {{ item.quantity }}</span>
              <span class="item-price">{{ item.snapshotPrice * item.quantity | price }}</span>
            </div>
          }
          <div class="totals">
            <div class="totals-row">Dostawa: <span>{{ order()!.shippingCostInCents | price }}</span></div>
            <div class="totals-row totals-total">Łącznie: <span>{{ order()!.totalInCents | price }}</span></div>
          </div>
        </div>

        @if (order()!.shipment?.trackingNumber) {
          <p class="tracking">
            Numer śledzenia: <strong>{{ order()!.shipment!.trackingNumber }}</strong>
          </p>
        }

        @if (canCancel(order()!.status)) {
          <div class="cancel-zone">
            @if (!confirming()) {
              <button tuiButton appearance="secondary" size="m" type="button"
                      (click)="confirming.set(true)">
                Anuluj zamówienie
              </button>
            } @else {
              <div class="confirm-box">
                @if (order()!.status === 'PENDING_PAYMENT') {
                  <p>Czy na pewno chcesz anulować to zamówienie? Żadna płatność nie zostanie pobrana.</p>
                } @else {
                  <p>Czy na pewno chcesz zrezygnować z zamówienia? Pełna kwota <strong>{{ order()!.totalInCents | price }}</strong> zostanie zwrócona w ciągu 5–10 dni roboczych zgodnie z prawem odstąpienia od umowy.</p>
                }
                <tui-textfield class="reason-field">
                  <label tuiLabel>Powód anulowania (opcjonalnie)</label>
                  <select tuiSelect
                          [items]="cancelReasonItems"
                          placeholder="— wybierz powód —"
                          [(ngModel)]="cancelReason">
                  </select>
                </tui-textfield>
                <div class="confirm-actions">
                  <button tuiButton appearance="destructive" size="m" type="button"
                          [disabled]="cancelling()" (click)="doCancel()">
                    {{ cancelling() ? 'Anulowanie…' : 'Tak, anuluj' }}
                  </button>
                  <button tuiButton appearance="secondary" size="m" type="button"
                          [disabled]="cancelling()" (click)="confirming.set(false)">
                    Wróć
                  </button>
                </div>
              </div>
            }
            @if (order()!.status === 'PAID' || order()!.status === 'PROCESSING') {
              <p class="legal-note">Prawo odstąpienia od umowy (ustawa z dnia 30 maja 2014 r. o prawach konsumenta)</p>
            }
          </div>
        }

        @if (order()!.status === 'SHIPPED' || order()!.status === 'DELIVERED') {
          <p class="shipped-note">
            Zamówienie zostało już wysłane. Aby zgłosić zwrot, skontaktuj się z nami.
          </p>
        }
      </div>
    }
  `,
  styles: [`
    .page { padding: 32px 0; max-width: 560px; margin: 0 auto; }
    .back-btn { margin-bottom: 8px; }
    .order-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 24px; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; }

    .status {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      background: var(--color-border);
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
      border-radius: var(--border-radius-md);
      box-shadow: var(--shadow-sm);
      border: 1px solid var(--color-border);
      overflow: hidden;
      margin-bottom: 20px;
    }
    .item { display: flex; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--color-border); font-size: 14px; }
    .item:last-child { border-bottom: none; }
    .item-name { color: var(--color-primary); }
    .item-price { font-weight: 500; white-space: nowrap; }
    .totals { padding: 12px 16px; background: var(--color-surface); }
    .totals-row { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 6px; }
    .totals-total { font-weight: 700; font-size: 15px; margin-bottom: 0; }

    .tracking { font-size: 14px; color: var(--color-secondary); margin-bottom: 20px; }

    .cancel-zone { margin-top: 8px; }
    .confirm-box {
      padding: 20px;
      background: #fff7ed;
      border: 1px solid #fdba74;
      border-radius: var(--border-radius-md);
      margin-bottom: 12px;
    }
    .confirm-box p { font-size: 14px; margin: 0 0 16px; line-height: 1.6; }
    .reason-field { display: block; margin-bottom: 16px; }
    .confirm-actions { display: flex; gap: 12px; }
    .legal-note { font-size: 12px; color: var(--color-secondary); margin-top: 10px; }
    .shipped-note { font-size: 14px; color: var(--color-secondary); margin-top: 16px; padding: 14px 16px; background: var(--color-surface); border-radius: var(--border-radius-md); border: 1px solid var(--color-border); }
  `],
})
export class OrderDetailComponent implements OnInit {
  private readonly http     = inject(HttpClient);
  private readonly route    = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly toast    = inject(ToastService);

  readonly order = signal<OrderDetail | null>(null);
  readonly confirming = signal(false);
  readonly cancelling = signal(false);

  cancelReason: string | null = null;
  readonly cancelReasonItems = CANCEL_REASON_ITEMS;

  back(): void { this.location.back(); }

  statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
  }

  canCancel(status: string): boolean {
    return ['PENDING_PAYMENT', 'PAID', 'PROCESSING'].includes(status);
  }

  ngOnInit() {
    this.load();
  }

  doCancel(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.cancelling.set(true);
    const body = this.cancelReason ? { reason: this.cancelReason } : {};
    this.http.post(`${environment.apiUrl}/orders/${id}/cancel`, body).subscribe({
      next: () => {
        this.confirming.set(false);
        this.cancelling.set(false);
        this.cancelReason = null;
        this.toast.success('Zamówienie zostało anulowane.');
        this.load();
      },
      error: (err) => {
        this.toast.error(err.error?.message ?? 'Nie udało się anulować zamówienia.');
        this.cancelling.set(false);
      },
    });
  }

  private load(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.http.get<OrderDetail>(`${environment.apiUrl}/orders/${id}`).subscribe({
      next: (o) => this.order.set(o),
    });
  }
}
