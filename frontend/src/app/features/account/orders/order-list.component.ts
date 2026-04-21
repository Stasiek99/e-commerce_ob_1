import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Location, LowerCasePipe, DatePipe } from '@angular/common';
import { TuiButton, TuiTitle, TuiIcon } from '@taiga-ui/core';
import { TuiCell } from '@taiga-ui/layout';
import { environment } from '../../../../environments/environment';
import { PricePipe } from '../../../shared/pipes/price.pipe';

@Component({
  selector: 'app-order-list',
  standalone: true,
  imports: [RouterLink, PricePipe, LowerCasePipe, DatePipe, TuiButton, TuiTitle, TuiIcon, TuiCell],
  template: `
    <div class="page">
      <button tuiButton appearance="flat" size="s" type="button" class="back-btn" (click)="back()">
        <tui-icon icon="@tui.chevron-left" />
        Wróć
      </button>
      <h1>Moje zamówienia</h1>

      <div class="orders-list">
        @for (order of orders(); track order.id) {
          <div tuiCell class="order-cell">
            <div tuiTitle>
              <span>#{{ order.orderNumber }}</span>
              <div tuiSubtitle>{{ order.createdAt | date:'dd.MM.yyyy' }}</div>
            </div>
            <span class="status status--{{ order.status | lowercase }}">{{ order.status }}</span>
            <strong class="order-total">{{ order.totalInCents | price }}</strong>
            <a
              tuiButton
              appearance="secondary"
              size="s"
              [routerLink]="['/account/orders', order.id]"
            >
              Szczegóły
            </a>
          </div>
        } @empty {
          <p class="empty">Brak zamówień.</p>
        }
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 32px 0; max-width: 560px; margin: 0 auto; }
    .back-btn { margin-bottom: 8px; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 24px; }

    .orders-list {
      background: var(--color-surface);
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.07);
      overflow: hidden;
    }

    .order-cell { border-bottom: 1px solid var(--color-border); }
    .order-cell:last-child { border-bottom: none; }

    .status {
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: #e5e7eb;
      white-space: nowrap;
    }
    .status--paid      { background: #d1fae5; color: #065f46; }
    .status--pending_payment { background: #fef3c7; color: #92400e; }
    .status--cancelled { background: #fee2e2; color: #991b1b; }
    .status--shipped   { background: #dbeafe; color: #1e40af; }

    .order-total { font-size: 14px; white-space: nowrap; }

    .empty { padding: 32px; color: var(--color-secondary); text-align: center; }
  `],
})
export class OrderListComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly location = inject(Location);
  readonly orders = signal<any[]>([]);

  ngOnInit(): void {
    this.http.get<any[]>(`${environment.apiUrl}/orders`).subscribe({
      next: (o) => this.orders.set(o),
    });
  }

  back(): void { this.location.back(); }
}
