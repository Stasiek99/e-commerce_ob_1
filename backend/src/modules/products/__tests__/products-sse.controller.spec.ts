import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { EMPTY, Observable, Subject } from 'rxjs';
import { ProductsController } from '../products.controller';
import { ProductsService } from '../products.service';
import { StorageService } from '../../storage/storage.service';

function makeRequest(ip: string, xForwardedFor?: string): any {
  return {
    ip,
    headers: xForwardedFor ? { 'x-forwarded-for': xForwardedFor } : {},
  };
}

describe('ProductsController — streamVariantStock per-IP connection cap', () => {
  let controller: ProductsController;
  let redis: {
    incr: jest.Mock;
    decr: jest.Mock;
    expire: jest.Mock;
  };
  let productsService: jest.Mocked<Pick<ProductsService, 'createStockStream'>>;

  beforeEach(async () => {
    redis = {
      incr: jest.fn().mockResolvedValue(1),
      decr: jest.fn().mockResolvedValue(0),
      expire: jest.fn().mockResolvedValue(1),
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

  // ── happy path: connection within cap ────────────────────────────────────

  it('creates the stock stream when IP is below the connection cap', (done) => {
    redis.incr.mockResolvedValue(1);
    productsService.createStockStream.mockReturnValue(EMPTY);

    controller.streamVariantStock('pv-1,pv-2', makeRequest('10.0.0.1')).subscribe({
      complete: () => {
        expect(productsService.createStockStream).toHaveBeenCalledWith(['pv-1', 'pv-2']);
        done();
      },
      error: done,
    });
  });

  it('allows a connection when IP count is exactly at the cap (count === 5)', (done) => {
    redis.incr.mockResolvedValue(5);
    productsService.createStockStream.mockReturnValue(EMPTY);

    controller.streamVariantStock('pv-1', makeRequest('10.0.0.2')).subscribe({
      complete: () => done(),
      error: (err) => done(err),
    });
  });

  // ── blocked path: cap exceeded ────────────────────────────────────────────

  it('errors with HttpException(429) when IP has more than 5 concurrent connections', (done) => {
    redis.incr.mockResolvedValue(6);

    controller.streamVariantStock('pv-1', makeRequest('10.0.0.3')).subscribe({
      next: () => done(new Error('should not emit a value')),
      error: (err: HttpException) => {
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        done();
      },
      complete: () => done(new Error('should have errored, not completed')),
    });
  });

  it('does not call createStockStream when connection is rejected for exceeding cap', (done) => {
    redis.incr.mockResolvedValue(10);

    controller.streamVariantStock('pv-1', makeRequest('10.0.0.4')).subscribe({
      error: () => {
        expect(productsService.createStockStream).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('decrements the Redis counter immediately when the connection is rejected for exceeding cap', (done) => {
    redis.incr.mockResolvedValue(6);

    controller.streamVariantStock('pv-1', makeRequest('10.0.0.5')).subscribe({
      error: async () => {
        // decr is fire-and-forget — give microtasks a tick to execute
        await Promise.resolve();
        expect(redis.decr).toHaveBeenCalledWith('sse:conn:10.0.0.5');
        done();
      },
    });
  });

  // ── connection key TTL ────────────────────────────────────────────────────

  it('sets a TTL on the Redis connection key after incrementing', (done) => {
    redis.incr.mockResolvedValue(1);
    productsService.createStockStream.mockReturnValue(EMPTY);

    controller.streamVariantStock('pv-1', makeRequest('10.0.0.6')).subscribe({
      complete: async () => {
        await Promise.resolve();
        expect(redis.expire).toHaveBeenCalledWith('sse:conn:10.0.0.6', expect.any(Number));
        done();
      },
      error: done,
    });
  });

  // ── teardown: counter decremented on unsubscribe ─────────────────────────

  it('decrements the Redis counter when the subscriber unsubscribes', async () => {
    redis.incr.mockResolvedValue(1);
    const subject = new Subject<any>();
    productsService.createStockStream.mockReturnValue(subject.asObservable());

    const subscription = controller
      .streamVariantStock('pv-1', makeRequest('10.0.0.7'))
      .subscribe();

    // Flush the initial async Redis.incr so the subscription is live
    await Promise.resolve();
    await Promise.resolve();

    subscription.unsubscribe();
    await Promise.resolve();

    expect(redis.decr).toHaveBeenCalledWith('sse:conn:10.0.0.7');
  });

  // ── IP extraction ─────────────────────────────────────────────────────────

  it('uses x-forwarded-for header as the connection key IP when present', (done) => {
    redis.incr.mockResolvedValue(1);
    productsService.createStockStream.mockReturnValue(EMPTY);

    controller
      .streamVariantStock('pv-1', makeRequest('10.0.0.99', '203.0.113.42, 10.0.0.1'))
      .subscribe({
        complete: () => {
          expect(redis.incr).toHaveBeenCalledWith('sse:conn:203.0.113.42');
          done();
        },
        error: done,
      });
  });

  it('falls back to req.ip when x-forwarded-for header is absent', (done) => {
    redis.incr.mockResolvedValue(1);
    productsService.createStockStream.mockReturnValue(EMPTY);

    controller.streamVariantStock('pv-1', makeRequest('172.16.0.1')).subscribe({
      complete: () => {
        expect(redis.incr).toHaveBeenCalledWith('sse:conn:172.16.0.1');
        done();
      },
      error: done,
    });
  });

  // ── idle timeout: stream closes after inactivity ──────────────────────────

  it('sends a reconnect hint and completes the stream after the idle timeout fires', async () => {
    jest.useFakeTimers();
    redis.incr.mockResolvedValue(1);

    const subject = new Subject<any>();
    productsService.createStockStream.mockReturnValue(subject.asObservable());

    const received: any[] = [];
    let completed = false;

    controller.streamVariantStock('pv-1', makeRequest('10.0.0.8')).subscribe({
      next: (event) => received.push(event),
      complete: () => { completed = true; },
    });

    // Flush promises (redis.incr resolution) then advance past the 5-minute idle timeout
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

    controller.streamVariantStock('pv-1', makeRequest('10.0.0.9')).subscribe({
      complete: () => { completed = true; },
    });

    // Advance 4 min — idle timeout has not fired yet
    await jest.advanceTimersByTimeAsync(4 * 60 * 1_000);
    // Emit an event to reset the idle timer
    subject.next({ data: [{ id: 'pv-1', stock: 5 }] });
    // Advance another 4 min — only 4 min since last event, still within 5 min window
    await jest.advanceTimersByTimeAsync(4 * 60 * 1_000);

    expect(completed).toBe(false);

    jest.useRealTimers();
  });
});
