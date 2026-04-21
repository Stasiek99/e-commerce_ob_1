import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { TuiButton, TuiIcon } from '@taiga-ui/core';
import { environment } from '../../../../environments/environment';
import { PricePipe } from '../../../shared/pipes/price.pipe';

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [PricePipe, TuiButton, TuiIcon],
  template: `
    @if (order()) {
      <div class="page">
        <button tuiButton appearance="flat" size="s" type="button" class="back-btn" (click)="back()">
          <tui-icon icon="@tui.chevron-left" />
          Wróć
        </button>
        <h1>Zamówienie #{{ order()!.orderNumber }}</h1>
        <p class="status">Status: <strong>{{ order()!.status }}</strong></p>

        @for (item of order()!.items; track item.id) {
          <div class="item">
            <span>{{ item.snapshotName }} × {{ item.quantity }}</span>
            <span>{{ item.snapshotPrice * item.quantity | price }}</span>
          </div>
        }

        <div class="totals">
          <div>Dostawa: {{ order()!.shippingCostInCents | price }}</div>
          <div><strong>Łącznie: {{ order()!.totalInCents | price }}</strong></div>
        </div>

        @if (order()!.shipment?.trackingNumber) {
          <p>Numer śledzenia: <strong>{{ order()!.shipment!.trackingNumber }}</strong></p>
        }
      </div>
    }
  `,
  styles: [`
    .page { padding: 32px 0; max-width: 560px; margin: 0 auto; }
    .back-btn { margin-bottom: 8px; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 16px; }
    .status { margin-bottom: 24px; }
    .item { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--color-border); font-size: 14px; }
    .totals { padding: 16px 0; font-size: 14px; }
    .totals div { margin-bottom: 8px; }
  `],
})
export class OrderDetailComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  readonly order = signal<any>(null);

  back(): void { this.location.back(); }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.http.get<any>(`${environment.apiUrl}/orders/${id}`).subscribe({
      next: (o) => this.order.set(o),
    });
  }
}
