import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { EMPTY } from 'rxjs';
import { StockStreamService } from './stock-stream.service';

describe('StockStreamService', () => {
  // ── SSR guard ─────────────────────────────────────────────────────────────

  describe('server (SSR)', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          StockStreamService,
          { provide: PLATFORM_ID, useValue: 'server' },
        ],
      });
    });

    it('connect() returns the EMPTY observable', () => {
      const svc = TestBed.inject(StockStreamService);
      expect(svc.connect(['var-1', 'var-2'])).toBe(EMPTY);
    });

    it('does not throw a ReferenceError when EventSource is unavailable (Node.js)', () => {
      const saved = (global as Record<string, unknown>)['EventSource'];
      delete (global as Record<string, unknown>)['EventSource'];

      const svc = TestBed.inject(StockStreamService);
      expect(() => svc.connect(['var-1'])).not.toThrow();

      (global as Record<string, unknown>)['EventSource'] = saved;
    });
  });

  // ── Browser ───────────────────────────────────────────────────────────────

  describe('browser', () => {
    let mockSource: {
      onmessage: ((e: MessageEvent) => void) | null;
      onerror: (() => void) | null;
      close: jest.Mock;
    };

    beforeEach(() => {
      mockSource = { onmessage: null, onerror: null, close: jest.fn() };
      global.EventSource = jest.fn(() => mockSource) as unknown as typeof EventSource;

      TestBed.configureTestingModule({
        providers: [
          StockStreamService,
          { provide: PLATFORM_ID, useValue: 'browser' },
        ],
      });
    });

    afterEach(() => jest.restoreAllMocks());

    it('creates an EventSource pointing at the stock-stream SSE endpoint', () => {
      TestBed.inject(StockStreamService).connect(['var-1', 'var-2']).subscribe();
      expect(global.EventSource).toHaveBeenCalledWith(
        expect.stringContaining('/products/variants/stock-stream?ids=var-1,var-2'),
      );
    });

    it('emits parsed JSON payloads delivered via onmessage', (done) => {
      const updates = [{ id: 'var-1', stock: 3 }];

      TestBed.inject(StockStreamService)
        .connect(['var-1'])
        .subscribe((data) => {
          expect(data).toEqual(updates);
          done();
        });

      mockSource.onmessage!({ data: JSON.stringify(updates) } as MessageEvent);
    });

    it('closes the EventSource when the subscriber unsubscribes', () => {
      const sub = TestBed.inject(StockStreamService).connect(['var-1']).subscribe();
      sub.unsubscribe();
      expect(mockSource.close).toHaveBeenCalledTimes(1);
    });
  });
});
