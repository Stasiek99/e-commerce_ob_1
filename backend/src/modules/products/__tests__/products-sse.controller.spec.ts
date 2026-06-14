import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { EMPTY, Subject } from 'rxjs';
import { ProductsController } from '../products.controller';
import { ProductsService } from '../products.service';
import { StorageService } from '../../storage/storage.service';

describe('ProductsController — streamVariantStock global connection cap', () => {
  let controller: ProductsController;
  let redis: {
    incr: jest.Mock;
    decr: jest.Mock;
  };
  let productsService: jest.Mocked<Pick<ProductsService, 'createStockStream'>>;

  beforeEach(async () => {
    redis = {
      incr: jest.fn().mockResolvedValue(1),
      decr: jest.fn().mockResolvedValue(0),
    };

    productsService = {
      createStockStream: jest.fn().mockReturnValue(EMPTY),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: ProductsService, useValue: productsService },
        { provide: StorageService, useValue: {} },
        { provide: 'REDIS_CLIENT', useValue: redis },
      ],
    }).compile();

    controller = module.get(ProductsController);
  });

  afterEach(() => jest.clearAllMocks());

  // ── happy path: connection within global cap ──────────────────────────────

  it('creates the stock stream when global connection count is within the cap', (done) => {
    redis.incr.mockResolvedValue(1);
    productsService.createStockStream.mockReturnValue(EMPTY);

    controller.streamVariantStock('pv-1,pv-2').subscribe({
      complete: () => {
        expect(productsService.createStockStream).toHaveBeenCalledWith(['pv-1', 'pv-2']);
        done();
      },
      error: done,
    });
  });

  it('allows a connection when the global counter is exactly at the cap (count === 500)', (done) => {
    redis.incr.mockResolvedValue(500);
    productsService.createStockStream.mockReturnValue(EMPTY);

    controller.streamVariantStock('pv-1').subscribe({
      complete: () => done(),
      error: (err) => done(err),
    });
  });

  // ── blocked path: global cap exceeded ─────────────────────────────────────

  it('errors with HttpException(429) when global connection count exceeds 500', (done) => {
    redis.incr.mockResolvedValue(501);

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
    redis.incr.mockResolvedValue(501);

    controller.streamVariantStock('pv-1').subscribe({
      error: () => {
        expect(productsService.createStockStream).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('decrements the global Redis counter when the connection is rejected', (done) => {
    redis.incr.mockResolvedValue(501);

    controller.streamVariantStock('pv-1').subscribe({
      error: async () => {
        await Promise.resolve();
        expect(redis.decr).toHaveBeenCalledWith('sse:global:count');
        done();
      },
    });
  });

  it('uses the shared sse:global:count key, not a per-IP key', (done) => {
    redis.incr.mockResolvedValue(1);
    productsService.createStockStream.mockReturnValue(EMPTY);

    controller.streamVariantStock('pv-1').subscribe({
      complete: () => {
        expect(redis.incr).toHaveBeenCalledWith('sse:global:count');
        done();
      },
      error: done,
    });
  });

  // ── teardown: counter decremented on unsubscribe ─────────────────────────

  it('decrements the global Redis counter when the subscriber unsubscribes', async () => {
    redis.incr.mockResolvedValue(1);
    const subject = new Subject<any>();
    productsService.createStockStream.mockReturnValue(subject.asObservable());

    const subscription = controller.streamVariantStock('pv-1').subscribe();

    // Flush promise microtasks so the incr resolves and the inner Observable starts
    await Promise.resolve();
    await Promise.resolve();

    subscription.unsubscribe();
    await Promise.resolve();

    expect(redis.decr).toHaveBeenCalledWith('sse:global:count');
  });

  // ── idle timeout: stream closes after inactivity ──────────────────────────

  it('sends a reconnect hint and completes the stream after the idle timeout fires', async () => {
    jest.useFakeTimers();
    redis.incr.mockResolvedValue(1);

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
    redis.incr.mockResolvedValue(1);

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
    redis.incr.mockResolvedValue(1);
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
