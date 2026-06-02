import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { SupabaseMonitoringService } from '../supabase-monitoring.service';
import { PrismaService } from '../../prisma/prisma.service';

const MB = 1024 * 1024;

function dbRow(active: number, max: number) {
  return [{ active_count: BigInt(active), max_connections: BigInt(max) }];
}

function storageRows(totalMb: number) {
  return [{ bucket_id: 'product-images', file_count: BigInt(10), total_bytes: BigInt(Math.round(totalMb * MB)) }];
}

describe('SupabaseMonitoringService', () => {
  let service: SupabaseMonitoringService;
  let prisma: { $queryRaw: jest.Mock };
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupabaseMonitoringService,
        { provide: PrismaService, useValue: prisma },
        { provide: 'REDIS_CLIENT', useValue: { set: jest.fn().mockResolvedValue('OK') } },
      ],
    }).compile();

    service = module.get(SupabaseMonitoringService);

    logSpy   = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy  = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  // ── DB connection checks ─────────────────────────────────────────────────

  describe('checkDatabaseConnections (via runChecks)', () => {
    it('logs info only when usage is below warn threshold (< 75%)', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(dbRow(40, 100))   // 40% — OK
        .mockResolvedValueOnce(storageRows(100)); // storage: irrelevant

      await service.runChecks();

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ activeConnections: 40, maxConnections: 100, usagePct: 40 }),
        'DB connection check',
      );
      expect(warnSpy).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('WARNING: DB'));
      expect(errorSpy).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('CRITICAL: DB'));
    });

    it('logs warn when usage is between 75% and 90%', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(dbRow(80, 100))   // 80%
        .mockResolvedValueOnce(storageRows(100));

      await service.runChecks();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ usagePct: 80 }),
        expect.stringContaining('WARNING: DB connections at 80%'),
      );
      expect(errorSpy).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('CRITICAL: DB'));
    });

    it('logs error when usage is at or above 90%', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(dbRow(95, 100))   // 95%
        .mockResolvedValueOnce(storageRows(100));

      await service.runChecks();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ usagePct: 95 }),
        expect.stringContaining('CRITICAL: DB connections at 95%'),
      );
    });

    it('logs error on query failure without throwing', async () => {
      prisma.$queryRaw
        .mockRejectedValueOnce(new Error('connection refused'))
        .mockResolvedValueOnce(storageRows(100));

      await expect(service.runChecks()).resolves.not.toThrow();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('DB connection check failed: connection refused'),
      );
    });
  });

  // ── Storage checks ───────────────────────────────────────────────────────

  describe('checkStorageUsage (via runChecks)', () => {
    it('logs info only when storage is below warn threshold (< 800 MB)', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(dbRow(10, 100))
        .mockResolvedValueOnce(storageRows(400)); // 400 MB — OK

      await service.runChecks();

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ totalStorageMb: expect.any(Number) }),
        'Storage usage check',
      );
      expect(warnSpy).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('WARNING: Supabase'));
      expect(errorSpy).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('CRITICAL: Supabase'));
    });

    it('logs warn when storage is between 800 MB and 950 MB', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(dbRow(10, 100))
        .mockResolvedValueOnce(storageRows(850)); // 850 MB

      await service.runChecks();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ totalStorageMb: expect.any(Number) }),
        expect.stringContaining('WARNING: Supabase storage at 850 MB'),
      );
    });

    it('logs error when storage is at or above 950 MB', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(dbRow(10, 100))
        .mockResolvedValueOnce(storageRows(960)); // 960 MB

      await service.runChecks();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ totalStorageMb: expect.any(Number) }),
        expect.stringContaining('CRITICAL: Supabase storage at 960 MB'),
      );
    });

    it('aggregates totals across multiple buckets', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(dbRow(10, 100))
        .mockResolvedValueOnce([
          { bucket_id: 'images',    file_count: BigInt(100), total_bytes: BigInt(500 * MB) },
          { bucket_id: 'invoices',  file_count: BigInt(50),  total_bytes: BigInt(400 * MB) },
        ]); // 900 MB total — warn

      await service.runChecks();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ totalStorageMb: expect.any(Number) }),
        expect.stringContaining('WARNING: Supabase storage at 900 MB'),
      );
    });

    it('logs error on query failure without throwing', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce(dbRow(10, 100))
        .mockRejectedValueOnce(new Error('schema missing'));

      await expect(service.runChecks()).resolves.not.toThrow();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Storage usage check failed: schema missing'),
      );
    });
  });

  // ── runChecks ────────────────────────────────────────────────────────────

  describe('runChecks', () => {
    it('runs both checks even when the first one rejects', async () => {
      prisma.$queryRaw
        .mockRejectedValueOnce(new Error('db down'))     // DB check fails
        .mockResolvedValueOnce(storageRows(100));         // storage check succeeds

      await expect(service.runChecks()).resolves.not.toThrow();

      // Storage check ran — its info log should appear
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ totalStorageMb: expect.any(Number) }),
        'Storage usage check',
      );
    });
  });
});
