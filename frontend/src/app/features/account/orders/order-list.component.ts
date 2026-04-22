import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Location, LowerCasePipe, DatePipe } from '@angular/common';
import { TuiButton, TuiTitle, TuiIcon } from '@taiga-ui/core';
import { TuiCell, } from '@taiga-ui/layout';
import { TuiPagination } from '@taiga-ui/kit';
import { environment } from '../../../../environments/environment';
import { PricePipe } from '../../../shared/pipes/price.pipe';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-order-list',
  standalone: true,
  imports: [RouterLink, PricePipe, LowerCasePipe, DatePipe, TuiButton, TuiTitle, TuiIcon, TuiCell, TuiPagination],
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
      overflow: hidden;
    }

    .order-cell { border-bottom: 1px solid var(--color-border); }
    .order-cell:last-child { border-bottom: none; }

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

    .order-total { font-size: 14px; white-space: nowrap; }
    .empty { padding: 32px; color: var(--color-secondary); text-align: center; }
    .pagination { display: flex; justify-content: center; margin-top: 32px; }
  `],
})
export class OrderListComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly location = inject(Location);

  readonly orders = signal<any[]>([]);
  readonly pageIndex = signal(0);
  readonly totalPages = signal(1);

  ngOnInit(): void {
    this.loadOrders(1);
  }

  goToPage(index: number): void {
    this.pageIndex.set(index);
    this.loadOrders(index + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  back(): void { this.location.back(); }

  private loadOrders(page: number): void {
    this.http
      .get<{ data: any[]; meta: { totalPages: number } }>(
        `${environment.apiUrl}/orders?page=${page}&limit=${PAGE_SIZE}`,
      )
      .subscribe({
        next: (res) => {
          this.orders.set(res.data);
          this.totalPages.set(res.meta?.totalPages ?? 1);
        },
      });
  }
}
