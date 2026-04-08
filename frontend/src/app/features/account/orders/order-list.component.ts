import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { LowerCasePipe, DatePipe } from '@angular/common';
import { environment } from '../../../../environments/environment';
import { PricePipe } from '../../../shared/pipes/price.pipe';

@Component({
  selector: 'app-order-list',
  standalone: true,
  imports: [RouterLink, PricePipe, LowerCasePipe, DatePipe],
  template: `
    <div class="page">
      <h1>Moje zamówienia</h1>
      @for (order of orders(); track order.id) {
        <div class="order-row">
          <div>
            <strong>#{{ order.orderNumber }}</strong>
            <span class="status status--{{ order.status | lowercase }}">{{ order.status }}</span>
          </div>
          <div>{{ order.totalInCents | price }}</div>
          <div>{{ order.createdAt | date:'dd.MM.yyyy' }}</div>
          <a [routerLink]="['/account/orders', order.id]">Szczegóły</a>
        </div>
      } @empty {
        <p>Brak zamówień.</p>
      }
    </div>
  `,
  styles: [`
    .page { padding: 32px 0; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 24px; }
    .order-row { display: flex; align-items: center; gap: 24px; padding: 16px 0; border-bottom: 1px solid var(--color-border); font-size: 14px; }
    .status { margin-left: 8px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: #e5e7eb; }
    a { margin-left: auto; color: var(--color-primary); font-weight: 500; }
  `],
})
export class OrderListComponent implements OnInit {
  private readonly http = inject(HttpClient);
  readonly orders = signal<any[]>([]);

  ngOnInit() {
    this.http.get<any[]>(`${environment.apiUrl}/orders`).subscribe({
      next: (o) => this.orders.set(o),
    });
  }
}
