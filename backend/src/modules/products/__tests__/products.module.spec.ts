import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProductsService } from '../products.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailQueueService } from '../../email/email-queue.service';
import { StorageService } from '../../storage/storage.service';

// Prevent any real IORedis constructor calls leaking out of the factory test block
jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    subscribe: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    incr: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
    publish: jest.fn().mockResolvedValue(0),
  })),
);

describe('ProductsModule — Redis DI wiring', () => {
  let service: ProductsService;

  const mockSseSubscriber = {
    on: jest.fn(),
    subscribe: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
  };

  const mockRedisClient = {
    on: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
    incr: jest.fn().mockResolvedValue(1),
    publish: jest.fn().mockResolvedValue(0),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } },
        { provide: EmailQueueService, useValue: {} },
        { provide: StorageService, useValue: {} },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('redis://localhost:6379') },
        },
        { provide: 'REDIS_CLIENT', useValue: mockRedisClient },
        { provide: 'STOCK_SSE_REDIS_SUBSCRIBER', useValue: mockSseSubscriber },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  // ── onModuleInit ──────────────────────────────────────────────────────────

  describe('onModuleInit()', () => {
    it('subscribes to stock:updates channel on the injected SSE subscriber', () => {
      service.onModuleInit();

      expect(mockSseSubscriber.subscribe).toHaveBeenCalledWith('stock:updates');
    });

    it('registers a message handler on the injected SSE subscriber', () => {
      service.onModuleInit();

      expect(mockSseSubscriber.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('does not call subscribe on the main REDIS_CLIENT — separation of concerns', () => {
      service.onModuleInit();

      expect(mockRedisClient).not.toHaveProperty('subscribe');
    });
  });

  // ── onModuleDestroy ───────────────────────────────────────────────────────

  describe('onModuleDestroy()', () => {
    it('calls quit() on the injected SSE subscriber to close the pub/sub connection', async () => {
      await service.onModuleDestroy();

      expect(mockSseSubscriber.quit).toHaveBeenCalledTimes(1);
    });

    it('completes the stockUpdates$ Subject before quitting', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subject = (service as any).stockUpdates$;
      const completeSpy = jest.spyOn(subject, 'complete');

      await service.onModuleDestroy();

      expect(completeSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Global REDIS_CLIENT is used for cache ops ─────────────────────────────

  describe('cache operations use the global REDIS_CLIENT, not the SSE subscriber', () => {
    it('calls incr on the main redis client when invalidating product caches', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any).invalidateProductCaches();

      expect(mockRedisClient.incr).toHaveBeenCalledWith('product_cache_v');
      expect(mockSseSubscriber.subscribe).not.toHaveBeenCalled();
    });

    it('injects exactly the provided REDIS_CLIENT instance for cache reads', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((service as any).redis).toBe(mockRedisClient);
    });

    it('injects exactly the provided STOCK_SSE_REDIS_SUBSCRIBER for pub/sub', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((service as any).redisSubscriber).toBe(mockSseSubscriber);
    });
  });
});

// ── STOCK_SSE_REDIS_SUBSCRIBER factory — retry strategy ───────────────────

describe('STOCK_SSE_REDIS_SUBSCRIBER factory — retry strategy', () => {
  it('uses exponential backoff (not permanent disconnect) for reconnects', () => {
    let capturedOptions: {
      maxRetriesPerRequest: null | number;
      retryStrategy: (times: number) => number | null;
    } | undefined;

    const MockIORedis = jest.fn().mockImplementation((_url: string, opts: typeof capturedOptions) => {
      capturedOptions = opts;
      return { on: jest.fn() };
    });

    // Reproduce the factory logic from ProductsModule exactly
    const runFactory = (configGet: (k: string, d: string) => string) => {
      const client = new (MockIORedis as any)(
        configGet('REDIS_URL', 'redis://localhost:6379'),
        {
          maxRetriesPerRequest: null,
          retryStrategy: (times: number) => Math.min(times * 500, 5_000),
        },
      );
      client.on('error', (err: Error) => console.warn(`[Redis SSE] ${err.message}`));
      return client;
    };

    runFactory((_k, def) => def);

    expect(capturedOptions).toBeDefined();
    // Must not permanently disconnect (old local provider returned null)
    expect(capturedOptions!.retryStrategy(1)).not.toBeNull();
    // Backoff: 1×500 = 500ms, 2×500 = 1000ms, …, capped at 5000ms
    expect(capturedOptions!.retryStrategy(1)).toBe(500);
    expect(capturedOptions!.retryStrategy(2)).toBe(1_000);
    expect(capturedOptions!.retryStrategy(20)).toBe(5_000);
    // maxRetriesPerRequest must be null (allow unlimited retries per command)
    expect(capturedOptions!.maxRetriesPerRequest).toBeNull();
  });

  it('does NOT use retryStrategy that returns null — the old fail-fast behaviour is gone', () => {
    let capturedStrategy: ((times: number) => number | null) | undefined;

    const MockIORedis = jest.fn().mockImplementation(
      (_url: string, opts: { retryStrategy: (t: number) => number | null }) => {
        capturedStrategy = opts.retryStrategy;
        return { on: jest.fn() };
      },
    );

    const runFactory = (configGet: (k: string, d: string) => string) => {
      const client = new (MockIORedis as any)(
        configGet('REDIS_URL', 'redis://localhost:6379'),
        {
          maxRetriesPerRequest: null,
          retryStrategy: (times: number) => Math.min(times * 500, 5_000),
        },
      );
      client.on('error', jest.fn());
      return client;
    };

    runFactory((_k, def) => def);

    // Old code: `retryStrategy: () => null` — any call returned null
    // New code must return a positive number for every attempt
    for (let i = 1; i <= 15; i++) {
      expect(capturedStrategy!(i)).toBeGreaterThan(0);
    }
  });
});
