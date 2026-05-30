import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CarrierCode } from '@prisma/client';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

const CACHE_TTL_SECONDS = 5 * 60; // 5 minutes
const CACHE_KEY = 'shipping:rates';

// Compile-time fallback used when the DB is unreachable at startup or during a
// migration window. Values match the seeded rows so behaviour is identical.
const FALLBACK_RATES: Record<CarrierCode, number> = {
  [CarrierCode.INPOST]:      1499,
  [CarrierCode.DHL]:         1999,
  [CarrierCode.GLS]:         1799,
  [CarrierCode.DPD]:         1599,
  [CarrierCode.DPD_COURIER]: 1699,
};

@Injectable()
export class ShippingRatesService {
  private readonly logger = new Logger(ShippingRatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
  ) {}

  async getRateMap(): Promise<Record<CarrierCode, number>> {
    try {
      const cached = await this.redis.get(CACHE_KEY);
      if (cached) {
        return JSON.parse(cached) as Record<CarrierCode, number>;
      }
    } catch (err) {
      this.logger.warn(`Redis read failed for ${CACHE_KEY}: ${(err as Error).message}`);
    }

    try {
      const rows = await this.prisma.shippingRate.findMany({
        where: { isActive: true },
      });

      const map = { ...FALLBACK_RATES };
      for (const row of rows) {
        map[row.carrierCode] = row.priceInCents;
      }

      try {
        await this.redis.set(CACHE_KEY, JSON.stringify(map), 'EX', CACHE_TTL_SECONDS);
      } catch (err) {
        this.logger.warn(`Redis write failed for ${CACHE_KEY}: ${(err as Error).message}`);
      }

      return map;
    } catch (err) {
      this.logger.warn(
        `Failed to load shipping rates from DB — using fallback constants: ${(err as Error).message}`,
      );
      return FALLBACK_RATES;
    }
  }

  async getRateForCarrier(code: CarrierCode): Promise<number> {
    const map = await this.getRateMap();
    return map[code];
  }

  async findAll() {
    return this.prisma.shippingRate.findMany({
      orderBy: { carrierCode: 'asc' },
    });
  }

  async updateRate(
    carrierCode: CarrierCode,
    priceInCents: number,
    isActive?: boolean,
  ) {
    const existing = await this.prisma.shippingRate.findUnique({
      where: { carrierCode },
    });
    if (!existing) {
      throw new NotFoundException(`No shipping rate found for carrier ${carrierCode}`);
    }

    const updated = await this.prisma.shippingRate.update({
      where: { carrierCode },
      data: {
        priceInCents,
        ...(isActive !== undefined && { isActive }),
      },
    });

    await this.invalidateCache();
    this.logger.log(
      `Shipping rate updated: ${carrierCode} → ${priceInCents} gr (isActive=${updated.isActive})`,
    );

    return updated;
  }

  private async invalidateCache() {
    try {
      await this.redis.del(CACHE_KEY);
    } catch (err) {
      this.logger.warn(`Redis delete failed for ${CACHE_KEY}: ${(err as Error).message}`);
    }
  }
}
