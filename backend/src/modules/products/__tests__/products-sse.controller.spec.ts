import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { EMPTY, Subject } from 'rxjs';
import { ProductsController } from '../products.controller';
import { ProductsService } from '../products.service';
import { StorageService } from '../../storage/storage.service';

describe('ProductsController — streamVariantStock global connection cap', () => {
  let controller: ProductsController;
  let productsService: jest.Mocked<Pick<ProductsService, 'createStockStream'>>;

  beforeEach(async () => {
    productsService = {
      createStockStream: jest.fn().mockReturnValue(EMPTY),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: ProductsService, useValue: productsService },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();

    controller = module.get(ProductsController);
  });

  afterEach(() => jest.clearAllMocks());

  // ── server-local counter — crash-safe by design ───────────────────────────

  it('initialises sseConnCount at 0 so a prior crash leaves no stale state', () => {
    expect((controller as any).sseConnCount).toBe(0);
  });

  it('increments sseConnCount synchronously when a connection is established', () => {
    const subject = new Subject<any>();
    productsService.createStockStream.mockReturnValue(subject.asObservable());

    controller.streamVariantStock('pv-1').subscribe();

    expect((controller as any).sseConnCount).toBe(1);
  });

  // ── happy path: connection within global cap ──────────────────────────────

  it('creates the stock stream when global connection count is within the cap', (done) => {
    productsService.createStockStream.mockReturnValue(EMPTY);

    controller.streamVariantStock('pv-1,pv-2').subscribe({
      complete: () => {
        expect(productsService.createStockStream).toHaveBeenCalledWith(['pv-1', 'pv-2']);
        done();
      },
      error: done,
    });
  });

  it('allows a connection when the in-process counter is exactly one below the cap (499)', (done) => {
    (controller as any).sseConnCount = 499;
    productsService.createStockStream.mockReturnValue(EMPTY);

    controller.streamVariantStock('pv-1').subscribe({
      complete: () => done(),
      error: (err) => done(err),
    });
  });

  // ── blocked path: global cap exceeded ─────────────────────────────────────

  it('errors with HttpException(429) when sseConnCount equals or exceeds 500', (done) => {
    (controller as any).sseConnCount = 500;

    controller.streamVariantStock('pv-1').subscribe({
      next: () => done(new Error('should not emit a value')),
      error: (err: HttpException) => {
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        done();
      },
      complete: () => done(new Error('should have errored, not completed')),
    });
  });

  it('does not call createStockStream when the global cap is exceeded', (done) => {
    (controller as any).sseConnCount = 500;

    controller.streamVariantStock('pv-1').subscribe({
      error: () => {
        expect(productsService.createStockStream).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('does not increment the counter when the connection is rejected', (done) => {
    (controller as any).sseConnCount = 500;

    controller.streamVariantStock('pv-1').subscribe({
      error: () => {
        expect((controller as any).sseConnCount).toBe(500);
        done();
      },
    });
  });

  // ── teardown: counter decremented on unsubscribe ─────────────────────────

  it('decrements sseConnCount synchronously when the subscriber unsubscribes', () => {
    const subject = new Subject<any>();
    productsService.createStockStream.mockReturnValue(subject.asObservable());

    const subscription = controller.streamVariantStock('pv-1').subscribe();
    expect((controller as any).sseConnCount).toBe(1);

    subscription.unsubscribe();
    expect((controller as any).sseConnCount).toBe(0);
  });

  // ── idle timeout: stream closes after inactivity ──────────────────────────

  it('sends a reconnect hint and completes the stream after the idle timeout fires', async () => {
    jest.useFakeTimers();

    const subject = new Subject<any>();
    productsService.createStockStream.mockReturnValue(subject.asObservable());

    const received: any[] = [];
    let completed = false;

    controller.streamVariantStock('pv-1').subscribe({
      next: (event) => received.push(event),
      complete: () => { completed = true; },
    });

    await jest.advanceTimersByTimeAsync(5 * 60 * 1_000 + 100);

    expect(completed).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ data: { reconnect: true } });

    jest.useRealTimers();
  });

  it('resets the idle timer when a stock update event arrives', async () => {
    jest.useFakeTimers();

    const subject = new Subject<any>();
    productsService.createStockStream.mockReturnValue(subject.asObservable());

    let completed = false;

    controller.streamVariantStock('pv-1').subscribe({
      complete: () => { completed = true; },
    });

    // 4 min — idle not yet fired
    await jest.advanceTimersByTimeAsync(4 * 60 * 1_000);
    // Emit to reset idle timer
    subject.next({ data: [{ id: 'pv-1', stock: 5 }] });
    // Another 4 min — still within 5 min window from last event
    await jest.advanceTimersByTimeAsync(4 * 60 * 1_000);

    expect(completed).toBe(false);

    jest.useRealTimers();
  });

  // ── variant ID parsing ─────────────────────────────────────────────────────

  it('passes up to 10 parsed variant IDs to createStockStream', (done) => {
    const ids = Array.from({ length: 15 }, (_, i) => `pv-${i + 1}`).join(',');
    productsService.createStockStream.mockReturnValue(EMPTY);

    controller.streamVariantStock(ids).subscribe({
      complete: () => {
        const called = productsService.createStockStream.mock.calls[0][0] as string[];
        expect(called).toHaveLength(10);
        done();
      },
      error: done,
    });
  });
});
