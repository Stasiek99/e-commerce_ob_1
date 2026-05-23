import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Location, LowerCasePipe, DatePipe } from '@angular/common';
import { TuiButton, TuiTitle, TuiIcon } from '@taiga-ui/core';
import { TuiCell } from '@taiga-ui/layout';
import { TuiPagination } from '@taiga-ui/kit';
import { TuiSkeleton } from '@taiga-ui/kit/directives/skeleton';
import { environment } from '../../../../environments/environment';
import { PricePipe } from '../../../shared/pipes/price.pipe';

interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  totalInCents: number;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: 'Oczekuje na płatność',
  PAID:            'Opłacone',
  PROCESSING:      'W realizacji',
  SHIPPED:         'Wysłane',
  DELIVERED:       'Dostarczone',
  CANCELLED:          'Anulowane',
  REFUNDED:           'Zwrócone',
  PARTIALLY_REFUNDED: 'Częściowo zwrócone',
};

const PAGE_SIZE = 20;

@Component({
  selector: 'app-order-list',
  standalone: true,
  imports: [RouterLink, PricePipe, LowerCasePipe, DatePipe, TuiButton, TuiTitle, TuiIcon, TuiCell, TuiPagination, TuiSkeleton],
  template: `
    <div class="page">
      <button tuiButton appearance="flat" size="s" type="button" class="back-btn" (click)="back()">
        <tui-icon icon="@tui.chevron-left" />
        Wróć
      </button>
      <h1>Moje zamówienia</h1>

      <div class="orders-list">
        @if (loading()) {
          @for (_ of skeletonRows; track $index) {
            <div tuiCell class="order-cell">
              <div tuiTitle>
                <span tuiSkeleton>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
                <div tuiSubtitle tuiSkeleton>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</div>
              </div>
              <span tuiSkeleton class="skeleton-status">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
              <strong tuiSkeleton class="order-total">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</strong>
            </div>
          }
        }
        @for (order of orders(); track order.id) {
          <div tuiCell class="order-cell">
            <div tuiTitle>
              <span>#{{ order.orderNumber }}</span>
              <div tuiSubtitle>{{ order.createdAt | date:'dd.MM.yyyy' }}</div>
            </div>
            <span class="status status--{{ order.status | lowercase }}">{{ statusLabel(order.status) }}</span>
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

      @if (totalPages() > 1) {
        <div class="pagination">
          <tui-pagination
            [index]="pageIndex()"
            [length]="totalPages()"
            (indexChange)="goToPage($event)"
          />
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 32px 0; max-width: 560px; margin: 0 auto; }
    .back-btn { margin-bottom: 8px; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 24px; }

    .orders-list {
      background: var(--color-surface);
      border-radius: var(--border-radius-md);
      box-shadow: var(--shadow-sm);
      border: 1px solid var(--color-border);
      overflow: hidden;
    }

    .order-cell { border-bottom: 1px solid var(--color-border); }
    .order-cell:last-child { border-bottom: none; }

    .skeleton-status { display: inline-block; border-radius: 999px; }
    .order-total { font-size: 14px; white-space: nowrap; }
    .empty { padding: 32px; color: var(--color-secondary); text-align: center; }
    .pagination { display: flex; justify-content: center; margin-top: 32px; }
  `],
})
export class OrderListComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly location = inject(Location);

  readonly orders = signal<OrderSummary[]>([]);
  readonly pageIndex = signal(0);
  readonly totalPages = signal(1);
  readonly loading = signal(false);
  readonly skeletonRows = Array(5).fill(null);

  ngOnInit(): void {
    this.loadOrders(1);
  }

  goToPage(index: number): void {
    this.pageIndex.set(index);
    this.loadOrders(index + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  back(): void { this.location.back(); }

  statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
  }

  private loadOrders(page: number): void {
    this.loading.set(true);
    this.http
      .get<{ data: OrderSummary[]; meta: { totalPages: number } }>(
        `${environment.apiUrl}/orders?page=${page}&limit=${PAGE_SIZE}`,
      )
      .subscribe({
        next: (res) => {
          this.orders.set(res.data);
          this.totalPages.set(res.meta?.totalPages ?? 1);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }
}
