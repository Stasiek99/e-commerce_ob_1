import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

// Supabase free tier: 60 direct connections, Pro: 200
const DB_WARN_PCT = 0.75;
const DB_CRITICAL_PCT = 0.90;

// Supabase free tier: 1 GB storage total
const STORAGE_WARN_BYTES = 800 * 1024 * 1024;    // 800 MB
const STORAGE_CRITICAL_BYTES = 950 * 1024 * 1024; // 950 MB

interface DbConnectionRow {
  active_count: bigint;
  max_connections: bigint;
}

interface StorageBucketRow {
  bucket_id: string;
  file_count: bigint;
  total_bytes: bigint;
}

@Injectable()
export class SupabaseMonitoringService {
  private readonly logger = new Logger(SupabaseMonitoringService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async runChecks() {
    await Promise.allSettled([
      this.checkDatabaseConnections(),
      this.checkStorageUsage(),
    ]);
  }

  private async checkDatabaseConnections() {
    try {
      const [row] = await this.prisma.$queryRaw<DbConnectionRow[]>`
        SELECT
          (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::bigint AS active_count,
          current_setting('max_connections')::bigint AS max_connections
      `;

      const active = Number(row.active_count);
      const max = Number(row.max_connections);
      const pct = active / max;

      this.logger.log(
        { activeConnections: active, maxConnections: max, usagePct: +(pct * 100).toFixed(1) },
        'DB connection check',
      );

      if (pct >= DB_CRITICAL_PCT) {
        this.logger.error(
          { activeConnections: active, maxConnections: max, usagePct: +(pct * 100).toFixed(1) },
          `CRITICAL: DB connections at ${(pct * 100).toFixed(0)}% — risk of connection exhaustion`,
        );
      } else if (pct >= DB_WARN_PCT) {
        this.logger.warn(
          { activeConnections: active, maxConnections: max, usagePct: +(pct * 100).toFixed(1) },
          `WARNING: DB connections at ${(pct * 100).toFixed(0)}% of max`,
        );
      }
    } catch (err) {
      this.logger.error(`DB connection check failed: ${(err as Error).message}`);
    }
  }

  private async checkStorageUsage() {
    try {
      const rows = await this.prisma.$queryRaw<StorageBucketRow[]>`
        SELECT
          bucket_id,
          count(*)::bigint AS file_count,
          coalesce(sum((metadata->>'size')::bigint), 0)::bigint AS total_bytes
        FROM storage.objects
        WHERE name NOT LIKE '%/.emptyFolderPlaceholder'
        GROUP BY bucket_id
        ORDER BY total_bytes DESC
      `;

      const totalBytes = rows.reduce((sum, r) => sum + Number(r.total_bytes), 0);
      const bucketSummary = rows.map((r) => ({
        bucket: r.bucket_id,
        files: Number(r.file_count),
        sizeMb: +(Number(r.total_bytes) / 1024 / 1024).toFixed(2),
      }));

      this.logger.log(
        { totalStorageMb: +(totalBytes / 1024 / 1024).toFixed(2), buckets: bucketSummary },
        'Storage usage check',
      );

      if (totalBytes >= STORAGE_CRITICAL_BYTES) {
        this.logger.error(
          { totalStorageMb: +(totalBytes / 1024 / 1024).toFixed(2), buckets: bucketSummary },
          `CRITICAL: Supabase storage at ${(totalBytes / 1024 / 1024).toFixed(0)} MB — approaching 1 GB free-tier limit`,
        );
      } else if (totalBytes >= STORAGE_WARN_BYTES) {
        this.logger.warn(
          { totalStorageMb: +(totalBytes / 1024 / 1024).toFixed(2), buckets: bucketSummary },
          `WARNING: Supabase storage at ${(totalBytes / 1024 / 1024).toFixed(0)} MB`,
        );
      }
    } catch (err) {
      this.logger.error(`Storage usage check failed: ${(err as Error).message}`);
    }
  }
}
