import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TuiButton, TuiIcon, TuiLabel, TuiTextfield, TuiTitle } from '@taiga-ui/core';
import { TuiCard, TuiHeader } from '@taiga-ui/layout';
import { TuiCheckbox, TuiNativeSelect } from '@taiga-ui/kit';
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
  cancelledQuantity: number;
  cancelledDiscountInCents: number;
  productVariantId: string;
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  items: OrderItem[];
  shippingCostInCents: number;
  itemsTotalInCents: number;
  discountInCents: number;
  couponDiscountType: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING' | null;
  totalInCents: number;
  refundedAmountInCents: number;
  invoiceUrl: string | null;
  shipment?: { trackingNumber?: string; carrierCode?: string } | null;
}

interface CorrectiveInvoiceResponse {
  correctiveInvoiceUrl: string;
  correctiveInvoiceNumber: string;
}

interface PartialCancelLine {
  orderItemId: string;
  name: string;
  priceInCents: number;
  maxQuantity: number;
  selected: boolean;
  quantity: number;
}

const TRACKING_URL: Record<string, string> = {
  INPOST:      'https://inpost.pl/sledzenie-przesylek?number=',
  DHL:         'https://www.dhl.com/pl-pl/home/tracking.html?tracking-id=',
  GLS:         'https://gls-group.com/track/?match=',
  DPD:         'https://tracktrace.dpd.com.pl/parcelDetails?typ=1&p1=',
  DPD_COURIER: 'https://tracktrace.dpd.com.pl/parcelDetails?typ=1&p1=',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT:     'Oczekuje na płatność',
  FRAUD_REVIEW:        'Weryfikacja',
  PAID:                'Opłacone',
  PROCESSING:          'W realizacji',
  SHIPPED:             'Wysłane',
  DELIVERED:           'Dostarczone',
  CANCELLED:           'Anulowane',
  REFUNDED:            'Zwrócone',
  PARTIALLY_REFUNDED:  'Częściowo zwrócone',
  DISPUTE_HOLD:        'Spór płatniczy',
  DISPUTE_LOST_REVIEW: 'Weryfikacja zwrotu',
};

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [
    PricePipe, FormsModule,
    TuiButton, TuiIcon, TuiLabel, TuiTextfield, TuiTitle,
    TuiCard, TuiHeader,
    TuiCheckbox, TuiNativeSelect,
  ],
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

        <!-- ── Invoice download ───────────────────────────── -->
        @if (canDownloadInvoice(order()!.status) || hasCorrectiveInvoice(order()!.items)) {
          <div class="invoice-row">
            @if (canDownloadInvoice(order()!.status)) {
              <button tuiButton appearance="outline" size="s" type="button"
                      [disabled]="downloadingInvoice()"
                      (click)="downloadInvoice()">
                <tui-icon icon="@tui.file-text" />
                {{ downloadingInvoice() ? 'Generowanie…' : 'Pobierz fakturę' }}
              </button>
            }
            @if (hasCorrectiveInvoice(order()!.items)) {
              <button tuiButton appearance="outline" size="s" type="button"
                      [disabled]="downloadingCorrectiveInvoice()"
                      (click)="downloadCorrectiveInvoice()">
                <tui-icon icon="@tui.file-text" />
                {{ downloadingCorrectiveInvoice() ? 'Generowanie…' : 'Pobierz korektę' }}
              </button>
            }
          </div>
        }

        <!-- ── Items & totals ──────────────────────────────── -->
        <div class="items-card">
          @for (item of order()!.items; track item.id) {
            <div class="item" [class.item--cancelled]="item.cancelledQuantity >= item.quantity">
              <span class="item-name">
                {{ item.snapshotName }} × {{ item.quantity }}
                @if (item.cancelledQuantity > 0) {
                  <span class="item-cancelled-badge">
                    {{ item.cancelledQuantity === item.quantity ? 'anulowano' : 'anulowano ' + item.cancelledQuantity }}
                  </span>
                }
              </span>
              <span class="item-price">{{ item.snapshotPrice * item.quantity | price }}</span>
            </div>
          }
          <div class="totals">
            <div class="totals-row">
              Dostawa: <span>{{ order()!.shippingCostInCents | price }}</span>
            </div>
            @if (order()!.refundedAmountInCents > 0) {
              <div class="totals-row totals-refund">
                Zwrócono: <span>−{{ order()!.refundedAmountInCents | price }}</span>
              </div>
            }
            <div class="totals-row totals-total">
              Łącznie: <span>{{ order()!.totalInCents | price }}</span>
            </div>
          </div>
        </div>

        @if (order()!.shipment?.trackingNumber) {
          <p class="tracking">
            Numer śledzenia:
            @if (trackingUrl(order()!.shipment); as url) {
              <a [href]="url" target="_blank" rel="noopener noreferrer" class="tracking-link">
                {{ order()!.shipment!.trackingNumber }}
              </a>
            } @else {
              <strong>{{ order()!.shipment!.trackingNumber }}</strong>
            }
          </p>
        }

        <!-- ── Full cancel ─────────────────────────────────── -->
        @if (canCancel(order()!.status)) {
          <div class="cancel-zone">
            @if (!confirming()) {
              <button tuiButton appearance="secondary" size="m" type="button"
                      [disabled]="actionInFlight()"
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
                  <button tuiButton appearance="negative" size="m" type="button"
                          [disabled]="actionInFlight()" (click)="doCancel()">
                    {{ cancelling() ? 'Anulowanie…' : 'Tak, anuluj' }}
                  </button>
                  <button tuiButton appearance="secondary" size="m" type="button"
                          [disabled]="actionInFlight()" (click)="confirming.set(false)">
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

        <!-- ── Partial cancel ──────────────────────────────── -->
        @if (canPartialCancel(order()!.status) && !partialCancelling()) {
          <div class="partial-cancel-trigger">
            <button tuiButton appearance="secondary" size="m" type="button"
                    [disabled]="actionInFlight()"
                    (click)="startPartialCancel()">
              Anuluj wybrane produkty
            </button>
          </div>
        }

        @if (partialCancelling()) {
          <div tuiCardLarge class="partial-cancel-card">
            <header tuiHeader>
              <h2 tuiTitle>Wybierz produkty do anulowania</h2>
            </header>

            <div class="partial-items">
              @for (line of partialLines; track line.orderItemId) {
                <div class="partial-item">
                  <label class="partial-item-check">
                    <input type="checkbox" tuiCheckbox [(ngModel)]="line.selected" />
                    <span class="partial-item-name">{{ line.name }}</span>
                  </label>
                  @if (line.selected) {
                    <tui-textfield class="partial-qty-field">
                      <label tuiLabel>Ilość</label>
                      <input tuiTextfield type="number"
                             [min]="1" [max]="line.maxQuantity"
                             [(ngModel)]="line.quantity" />
                    </tui-textfield>
                    <span class="partial-item-price">{{ lineTotal(line) | price }}</span>
                  } @else {
                    <span class="partial-item-max">maks. {{ line.maxQuantity }} szt.</span>
                  }
                </div>
              }
            </div>

            <div class="partial-summary">
              <span class="partial-summary-label">Do zwrotu:</span>
              <strong class="partial-summary-amount">{{ refundPreview() | price }}</strong>
            </div>

            <div class="partial-actions">
              <button tuiButton appearance="negative" size="m" type="button"
                      [disabled]="refundPreview() === 0 || actionInFlight()"
                      (click)="doPartialCancel()">
                {{ submittingPartial() ? 'Przetwarzanie…' : 'Zatwierdź zwrot' }}
              </button>
              <button tuiButton appearance="secondary" size="m" type="button"
                      [disabled]="actionInFlight()"
                      (click)="partialCancelling.set(false)">
                Anuluj
              </button>
            </div>
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

    /* ── Invoice ────────────────────────────────────────── */
    .invoice-row { display: flex; gap: 8px; margin-bottom: 16px; }

    /* ── Items card ─────────────────────────────────────── */
    .items-card {
      background: var(--color-surface);
      border-radius: var(--border-radius-md);
      box-shadow: var(--shadow-sm);
      border: 1px solid var(--color-border);
      overflow: hidden;
      margin-bottom: 20px;
    }
    .item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid var(--color-border);
      font-size: 14px;
      gap: 12px;
    }
    .item:last-child { border-bottom: none; }
    .item--cancelled { opacity: 0.45; }
    .item-name { color: var(--color-primary); flex: 1; }
    .item-cancelled-badge {
      margin-left: 8px;
      font-size: 11px;
      background: var(--color-status-cancelled-bg);
      color: var(--color-status-cancelled-text);
      border-radius: 999px;
      padding: 2px 8px;
      font-weight: 600;
    }
    .item-price { font-weight: 500; white-space: nowrap; }

    /* ── Totals ─────────────────────────────────────────── */
    .totals { padding: 12px 16px; background: var(--color-surface); }
    .totals-row { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 6px; }
    .totals-row:last-child { margin-bottom: 0; }
    .totals-total { font-weight: 700; font-size: 15px; }
    .totals-refund { color: #16a34a; font-weight: 500; }

    /* ── Tracking ───────────────────────────────────────── */
    .tracking { font-size: 14px; color: var(--color-secondary); margin-bottom: 20px; }
    .tracking-link { color: var(--color-primary); font-weight: 500; text-decoration: underline; }

    /* ── Full cancel ────────────────────────────────────── */
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

    /* ── Partial cancel ─────────────────────────────────── */
    .partial-cancel-trigger { margin-top: 12px; }
    .partial-cancel-card { margin-top: 16px; }

    .partial-items { margin-bottom: 4px; }

    .partial-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--color-border);
    }
    .partial-item:last-child { border-bottom: none; }

    .partial-item-check {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      cursor: pointer;
      min-width: 0;
    }
    .partial-item-name {
      font-size: 14px;
      color: var(--color-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .partial-item-max { font-size: 12px; color: var(--color-secondary); white-space: nowrap; }
    .partial-qty-field { width: 80px; flex-shrink: 0; }
    .partial-item-price { font-size: 14px; font-weight: 500; white-space: nowrap; min-width: 72px; text-align: right; }

    .partial-summary {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid var(--color-border);
      font-size: 15px;
    }
    .partial-summary-label { color: var(--color-secondary); }
    .partial-summary-amount { font-size: 16px; }

    .partial-actions { display: flex; gap: 12px; margin-top: 16px; }

    /* ── Shipped note ───────────────────────────────────── */
    .shipped-note {
      font-size: 14px;
      color: var(--color-secondary);
      margin-top: 16px;
      padding: 14px 16px;
      background: var(--color-surface);
      border-radius: var(--border-radius-md);
      border: 1px solid var(--color-border);
    }
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
  readonly partialCancelling = signal(false);
  readonly submittingPartial = signal(false);
  readonly downloadingInvoice = signal(false);
  readonly downloadingCorrectiveInvoice = signal(false);
  // Shared across the full-cancel and partial-cancel zones — without it, a user
  // could fire "cancel whole order" then submit a partial cancellation for the
  // same order before the first request resolves, racing two backend code paths.
  readonly actionInFlight = signal(false);

  cancelReason: string | null = null;
  readonly cancelReasonItems = CANCEL_REASON_ITEMS;

  partialLines: PartialCancelLine[] = [];

  back(): void { this.location.back(); }

  trackingUrl(shipment: { trackingNumber?: string; carrierCode?: string } | null | undefined): string | null {
    if (!shipment?.trackingNumber || !shipment.carrierCode) return null;
    const base = TRACKING_URL[shipment.carrierCode];
    return base ? base + encodeURIComponent(shipment.trackingNumber) : null;
  }

  statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
  }

  canCancel(status: string): boolean {
    return ['PENDING_PAYMENT', 'PAID', 'PROCESSING'].includes(status);
  }

  canPartialCancel(status: string): boolean {
    return ['PAID', 'PROCESSING', 'PARTIALLY_REFUNDED'].includes(status);
  }

  canDownloadInvoice(status: string): boolean {
    return !['PENDING_PAYMENT', 'CANCELLED', 'FRAUD_REVIEW', 'DISPUTE_HOLD'].includes(status);
  }

  hasCorrectiveInvoice(items: OrderItem[]): boolean {
    return items.some((i) => i.cancelledQuantity > 0);
  }

  downloadInvoice(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.downloadingInvoice.set(true);
    this.http.get<{ invoiceUrl: string }>(`${environment.apiUrl}/orders/${id}/invoice`).subscribe({
      next: ({ invoiceUrl }) => {
        this.downloadingInvoice.set(false);
        window.open(invoiceUrl, '_blank', 'noopener');
      },
      error: (err) => {
        this.toast.error(err.error?.message ?? 'Nie udało się wygenerować faktury.');
        this.downloadingInvoice.set(false);
      },
    });
  }

  downloadCorrectiveInvoice(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.downloadingCorrectiveInvoice.set(true);
    this.http.get<CorrectiveInvoiceResponse>(`${environment.apiUrl}/orders/${id}/corrective-invoice`).subscribe({
      next: ({ correctiveInvoiceUrl }) => {
        this.downloadingCorrectiveInvoice.set(false);
        window.open(correctiveInvoiceUrl, '_blank', 'noopener');
      },
      error: (err) => {
        this.toast.error(err.error?.message ?? 'Nie udało się pobrać faktury korygującej.');
        this.downloadingCorrectiveInvoice.set(false);
      },
    });
  }

  startPartialCancel(): void {
    const o = this.order();
    if (!o) return;
    this.partialLines = o.items
      .filter(i => (i.quantity - (i.cancelledQuantity ?? 0)) > 0)
      .map(i => ({
        orderItemId: i.id,
        name: i.snapshotName,
        priceInCents: i.snapshotPrice,
        maxQuantity: i.quantity - (i.cancelledQuantity ?? 0),
        selected: false,
        quantity: 1,
      }));
    this.partialCancelling.set(true);
  }

  // Mirrors PaymentsService.prorateDiscountForRefundItems() so the preview matches
  // what the backend will actually refund for coupon-discounted orders — a flat
  // quantity × priceInCents sum overstates the refund whenever discountInCents > 0.
  private discountFraction(o: OrderDetail): number {
    const discount = o.discountInCents ?? 0;
    const itemsTotal = o.itemsTotalInCents ?? 0;
    if (discount <= 0 || itemsTotal <= 0) return 0;
    // FREE_SHIPPING coupons store the shipping refund in discountInCents, not an
    // items-total discount — prorateDiscountForRefundItems skips proration entirely.
    if (o.couponDiscountType === 'FREE_SHIPPING') return 0;
    return discount / itemsTotal;
  }

  lineTotal(line: PartialCancelLine): number {
    const o = this.order();
    const fraction = o ? this.discountFraction(o) : 0;
    if (!o || fraction === 0) return line.quantity * line.priceInCents;

    const orderItem = o.items.find(i => i.id === line.orderItemId);
    if (!orderItem) return line.quantity * line.priceInCents;

    const maxItemDiscount = Math.round(orderItem.snapshotPrice * fraction * orderItem.quantity);
    const alreadyAppliedDiscount = orderItem.cancelledDiscountInCents ?? 0;
    const remainingItemDiscount = Math.max(0, maxItemDiscount - alreadyAppliedDiscount);
    const wantedDiscount = Math.round(orderItem.snapshotPrice * fraction * line.quantity);
    const appliedDiscount = Math.min(wantedDiscount, remainingItemDiscount);
    const perUnitDiscount = Math.floor(appliedDiscount / line.quantity);

    return line.quantity * (line.priceInCents - perUnitDiscount);
  }

  refundPreview(): number {
    return this.partialLines
      .filter(l => l.selected)
      .reduce((sum, l) => sum + this.lineTotal(l), 0);
  }

  doPartialCancel(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    const items = this.partialLines
      .filter(l => l.selected)
      .map(l => ({ orderItemId: l.orderItemId, quantity: l.quantity }));

    if (!items.length) return;

    this.submittingPartial.set(true);
    this.actionInFlight.set(true);
    this.http.post(`${environment.apiUrl}/orders/${id}/cancel-items`, { items }).subscribe({
      next: () => {
        this.partialCancelling.set(false);
        this.submittingPartial.set(false);
        this.actionInFlight.set(false);
        this.toast.success('Wybrane produkty zostały anulowane. Zwrot pojawi się w ciągu 5–10 dni roboczych.');
        this.load();
      },
      error: (err) => {
        this.toast.error(err.error?.message ?? 'Nie udało się anulować wybranych produktów.');
        this.submittingPartial.set(false);
        this.actionInFlight.set(false);
      },
    });
  }

  ngOnInit() {
    this.load();
  }

  doCancel(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.cancelling.set(true);
    this.actionInFlight.set(true);
    const body = this.cancelReason ? { reason: this.cancelReason } : {};
    this.http.post(`${environment.apiUrl}/orders/${id}/cancel`, body).subscribe({
      next: () => {
        this.confirming.set(false);
        this.cancelling.set(false);
        this.actionInFlight.set(false);
        this.cancelReason = null;
        this.toast.success('Zamówienie zostało anulowane.');
        this.load();
      },
      error: (err) => {
        this.toast.error(err.error?.message ?? 'Nie udało się anulować zamówienia.');
        this.cancelling.set(false);
        this.actionInFlight.set(false);
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
