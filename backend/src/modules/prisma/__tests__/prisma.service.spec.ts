import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const defaults: Record<string, unknown> = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?pgbouncer=true',
    DATABASE_CONNECTION_LIMIT: 10,
  };
  return {
    get: (key: string, fallback?: unknown) => overrides[key] ?? defaults[key] ?? fallback,
    getOrThrow: (key: string) => {
      if (overrides[key] !== undefined) return overrides[key];
      if (defaults[key] !== undefined) return defaults[key];
      throw new Error(`Config key ${key} not found`);
    },
  } as unknown as ConfigService;
}

describe('PrismaService', () => {
  let service: PrismaService;
  let connectSpy: jest.SpyInstance;
  let querySpy: jest.SpyInstance;
  let disconnectSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new PrismaService(makeConfig());
    connectSpy = jest.spyOn(service, '$connect').mockResolvedValue();
    querySpy = jest.spyOn(service, '$queryRaw' as any).mockResolvedValue([{ '?column?': 1 }]);
    disconnectSpy = jest.spyOn(service, '$disconnect').mockResolvedValue();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('calls $connect to establish the database connection', async () => {
      await service.onModuleInit();

      expect(connectSpy).toHaveBeenCalledTimes(1);
    });

    it('executes a warmup SELECT 1 query after $connect to pre-warm the pool', async () => {
      await service.onModuleInit();

      expect(querySpy).toHaveBeenCalledTimes(1);
    });

    it('runs $connect before the warmup query', async () => {
      const callOrder: string[] = [];
      connectSpy.mockImplementation(async () => { callOrder.push('connect'); });
      querySpy.mockImplementation(async () => { callOrder.push('query'); return []; });

      await service.onModuleInit();

      expect(callOrder).toEqual(['connect', 'query']);
    });

    describe('retry on transient failure', () => {
      let setTimeoutSpy: jest.SpyInstance;

      beforeEach(() => {
        // Make retry delays resolve immediately so tests don't take minutes
        setTimeoutSpy = jest
          .spyOn(global, 'setTimeout')
          .mockImplementation((cb) => {
            (cb as () => void)();
            return 0 as unknown as ReturnType<typeof setTimeout>;
          });
      });

      afterEach(() => {
        setTimeoutSpy.mockRestore();
      });

      it('succeeds on the second attempt when the first connect throws', async () => {
        connectSpy
          .mockRejectedValueOnce(new Error('ECONNREFUSED'))
          .mockResolvedValue(undefined);

        await service.onModuleInit();

        expect(connectSpy).toHaveBeenCalledTimes(2);
        expect(querySpy).toHaveBeenCalledTimes(1);
      });

      it('succeeds on the second attempt when the first SELECT 1 throws', async () => {
        querySpy
          .mockRejectedValueOnce(new Error('DB starting up'))
          .mockResolvedValue([{ '?column?': 1 }]);

        await service.onModuleInit();

        expect(querySpy).toHaveBeenCalledTimes(2);
      });

      it('throws after all 6 attempts are exhausted', async () => {
        connectSpy.mockRejectedValue(new Error('ECONNREFUSED'));

        await expect(service.onModuleInit()).rejects.toThrow('ECONNREFUSED');

        expect(connectSpy).toHaveBeenCalledTimes(6);
      });

      it('does not retry beyond maxAttempts even when every attempt fails', async () => {
        connectSpy.mockRejectedValue(new Error('DB down'));

        await expect(service.onModuleInit()).rejects.toThrow();

        expect(connectSpy).toHaveBeenCalledTimes(6);
        expect(querySpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('onModuleDestroy', () => {
    it('calls $disconnect to release the pool on shutdown', async () => {
      await service.onModuleDestroy();

      expect(disconnectSpy).toHaveBeenCalledTimes(1);
    });
  });
});
