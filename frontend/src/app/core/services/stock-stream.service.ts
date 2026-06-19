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

    const url = `${environment.apiUrl}/products/variants/stock-stream?ids=${variantIds.join(',')}`;

    return new Observable<StockUpdate[]>((subscriber) => {
      let source: EventSource;

      const open = () => {
        source = new EventSource(url);

        source.onmessage = (event) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(event.data);
          } catch {
            return; // skip malformed frame
          }

          // Backend sends this after SSE_IDLE_TIMEOUT_MS then completes the response
          // to free server resources. EventSource only auto-reconnects on transient
          // network drops, not on a response the server closed deliberately — so we
          // have to open a fresh connection ourselves rather than forward this as data.
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'reconnect' in parsed) {
            source.close();
            open();
            return;
          }

          subscriber.next(parsed as StockUpdate[]);
        };

        // EventSource reconnects automatically per SSE spec for transient drops — don't error here
        source.onerror = () => { /* reconnecting… */ };
      };

      open();

      return () => source.close();
    });
  }
}
