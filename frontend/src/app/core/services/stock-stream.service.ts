import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface StockUpdate {
  id: string;
  stock: number;
}

@Injectable({ providedIn: 'root' })
export class StockStreamService {
  connect(variantIds: string[]): Observable<StockUpdate[]> {
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
