import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, EMPTY } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface StockUpdate {
  id: string;
  stock: number;
}

@Injectable({ providedIn: 'root' })
export class StockStreamService {
  private readonly platformId = inject(PLATFORM_ID);

  connect(variantIds: string[]): Observable<StockUpdate[]> {
    if (!isPlatformBrowser(this.platformId)) return EMPTY;

    return new Observable<StockUpdate[]>((subscriber) => {
      const url = `${environment.apiUrl}/products/variants/stock-stream?ids=${variantIds.join(',')}`;
      const source = new EventSource(url);

      source.onmessage = (event) => {
        try {
          subscriber.next(JSON.parse(event.data) as StockUpdate[]);
        } catch { /* skip malformed frame */ }
      };

      // EventSource reconnects automatically per SSE spec — don't error here
      source.onerror = () => { /* reconnecting… */ };

      return () => source.close();
    });
  }
}
