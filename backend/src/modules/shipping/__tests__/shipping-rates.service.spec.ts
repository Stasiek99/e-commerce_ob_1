import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CarrierCode } from '@prisma/client';
import { ShippingRatesService } from '../shipping-rates.service';
import { PrismaService } from '../../prisma/prisma.service';

const CACHE_KEY = 'shipping:rates';
const CACHE_TTL_SECONDS = 5 * 60;

describe('ShippingRatesService', () => {
  let service: ShippingRatesService;
  let prisma: {
    shippingRate: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let mockRedis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  const makeDbRow = (carrier: CarrierCode, price: number, isActive = true) => ({
    carrierCode: carrier,
    priceInCents: price,
    isActive,
    updatedAt: new Date(),
  });

  const allDbRows = [
    makeDbRow(CarrierCode.INPOST,      1499),
    makeDbRow(CarrierCode.DHL,         1999),
    makeDbRow(CarrierCode.GLS,         1799),
    makeDbRow(CarrierCode.DPD,         1599),
    makeDbRow(CarrierCode.DPD_COURIER, 1699),
  ];

  const cachedRates = {
    [CarrierCode.INPOST]:      1499,
    [CarrierCode.DHL]:         1999,
    [CarrierCode.GLS]:         1799,
    [CarrierCode.DPD]:         1599,
    [CarrierCode.DPD_COURIER]: 1699,
  };

  beforeEach(async () => {
    prisma = {
      shippingRate: {
        findMany:   jest.fn().mockResolvedValue(allDbRows),
        findUnique: jest.fn(),
        update:     jest.fn(),
      },
    };

    mockRedis = {
      get: jest.fn().mockResolvedValue(null), // default: cache miss
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShippingRatesService,
        { provide: PrismaService, useValue: prisma },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ShippingRatesService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  // ─── getRateMap ──────────────────────────────────────────────────────────────

  describe('getRateMap', () => {
    it('loads rates from DB on first call and returns a map keyed by CarrierCode', async () => {
      const map = await service.getRateMap();

      expect(prisma.shippingRate.findMany).toHaveBeenCalledTimes(1);
      expect(map[CarrierCode.INPOST]).toBe(1499);
      expect(map[CarrierCode.DHL]).toBe(1999);
      expect(map[CarrierCode.GLS]).toBe(1799);
      expect(map[CarrierCode.DPD]).toBe(1599);
      expect(map[CarrierCode.DPD_COURIER]).toBe(1699);
    });

    it('queries only isActive rows', async () => {
      await service.getRateMap();

      expect(prisma.shippingRate.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
      });
    });

    it('DB price overrides the compile-time fallback for that carrier', async () => {
      prisma.shippingRate.findMany.mockResolvedValue([
        ...allDbRows.filter((r) => r.carrierCode !== CarrierCode.DHL),
        makeDbRow(CarrierCode.DHL, 2499),
      ]);

      const map = await service.getRateMap();

      expect(map[CarrierCode.DHL]).toBe(2499);
      expect(map[CarrierCode.INPOST]).toBe(1499);
    });

    // Regression harness: deactivating a carrier must remove it from the map
    // entirely, not leave it pointing at FALLBACK_RATES or its last DB price.
    // Without this, GET /shipping/rates keeps listing a disabled carrier and
    // order creation keeps accepting (and charging for) it.
    it('omits a carrier from the map entirely when it has no active row in the DB', async () => {
      prisma.shippingRate.findMany.mockResolvedValue(
        allDbRows.filter((r) => r.carrierCode !== CarrierCode.DHL),
      );

      const map = await service.getRateMap();

      expect(map[CarrierCode.DHL]).toBeUndefined();
      expect(Object.keys(map)).not.toContain(CarrierCode.DHL);
      expect(map[CarrierCode.INPOST]).toBe(1499);
    });

    it('returns an empty map when every carrier has been deactivated', async () => {
      prisma.shippingRate.findMany.mockResolvedValue([]);

      const map = await service.getRateMap();

      expect(map).toEqual({});
    });

    // ── Redis cache behaviour ────────────────────────────────────────────────

    it('returns cached map from Redis without querying DB when key is present', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedRates));

      const map = await service.getRateMap();

      expect(prisma.shippingRate.findMany).not.toHaveBeenCalled();
      expect(map[CarrierCode.INPOST]).toBe(1499);
      expect(map[CarrierCode.DHL]).toBe(1999);
    });

    it('returns cached map on second call without hitting DB again', async () => {
      mockRedis.get
        .mockResolvedValueOnce(null)                           // first call: cache miss
        .mockResolvedValueOnce(JSON.stringify(cachedRates));  // second call: cache hit

      await service.getRateMap();
      await service.getRateMap();

      expect(prisma.shippingRate.findMany).toHaveBeenCalledTimes(1);
    });

    it('stores rate map in Redis with 5-minute TTL after DB load', async () => {
      await service.getRateMap();

      expect(mockRedis.set).toHaveBeenCalledWith(
        CACHE_KEY,
        expect.any(String),
        'EX',
        CACHE_TTL_SECONDS,
      );
    });

    it('stored JSON in Redis is parseable and contains correct rates', async () => {
      await service.getRateMap();

      const stored = JSON.parse(mockRedis.set.mock.calls[0][1]) as Record<string, number>;
      expect(stored[CarrierCode.INPOST]).toBe(1499);
      expect(stored[CarrierCode.DHL]).toBe(1999);
    });

    it('falls through to DB when Redis read throws', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis unavailable'));

      const map = await service.getRateMap();

      expect(prisma.shippingRate.findMany).toHaveBeenCalledTimes(1);
      expect(map[CarrierCode.INPOST]).toBe(1499);
    });

    it('still returns result when Redis write throws after successful DB load', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockRejectedValue(new Error('Redis write failed'));

      const map = await service.getRateMap();

      expect(map[CarrierCode.INPOST]).toBe(1499);
    });

    it('returns fallback rates without throwing when DB call fails', async () => {
      prisma.shippingRate.findMany.mockRejectedValue(new Error('DB connection refused'));

      const result = await service.getRateMap();

      expect(result[CarrierCode.INPOST]).toBe(1499);
      expect(result[CarrierCode.DHL]).toBe(1999);
    });

    it('does not cache the fallback response — next call retries the DB', async () => {
      prisma.shippingRate.findMany
        .mockRejectedValueOnce(new Error('transient failure'))
        .mockResolvedValue(allDbRows);

      await service.getRateMap(); // first call: DB fails → fallback returned, not cached
      await service.getRateMap(); // second call: DB works → cached

      expect(prisma.shippingRate.findMany).toHaveBeenCalledTimes(2);
      // Fallback path must NOT write to Redis
      expect(mockRedis.set).toHaveBeenCalledTimes(1); // only the second successful call
    });
  });

  // ─── getRateForCarrier ───────────────────────────────────────────────────────

  describe('getRateForCarrier', () => {
    it('returns the correct price for each known carrier', async () => {
      const cases: Array<[CarrierCode, number]> = [
        [CarrierCode.INPOST,      1499],
        [CarrierCode.DHL,         1999],
        [CarrierCode.GLS,         1799],
        [CarrierCode.DPD,         1599],
        [CarrierCode.DPD_COURIER, 1699],
      ];

      for (const [code, expectedPrice] of cases) {
        mockRedis.get.mockResolvedValue(null);
        const price = await service.getRateForCarrier(code);
        expect(price).toBe(expectedPrice);
      }
    });

    it('serves from Redis cache on repeated calls without extra DB round-trips', async () => {
      mockRedis.get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(JSON.stringify(cachedRates));

      await service.getRateForCarrier(CarrierCode.DHL);
      await service.getRateForCarrier(CarrierCode.INPOST);

      expect(prisma.shippingRate.findMany).toHaveBeenCalledTimes(1);
    });

    // Regression harness: order creation calls getRateForCarrier() authoritatively
    // to price and validate the order server-side. A deactivated carrier (e.g.
    // credentials revoked) must hard-fail here instead of silently returning a
    // stale price — otherwise payment gets captured for a carrier that can never
    // generate a label.
    it('throws NotFoundException for a carrier with no active row in the DB', async () => {
      prisma.shippingRate.findMany.mockResolvedValue(
        allDbRows.filter((r) => r.carrierCode !== CarrierCode.DHL),
      );

      await expect(service.getRateForCarrier(CarrierCode.DHL)).rejects.toThrow(NotFoundException);
    });

    it('still resolves active carriers when a different carrier has been deactivated', async () => {
      prisma.shippingRate.findMany.mockResolvedValue(
        allDbRows.filter((r) => r.carrierCode !== CarrierCode.DHL),
      );

      const price = await service.getRateForCarrier(CarrierCode.INPOST);

      expect(price).toBe(1499);
    });
  });

  // ─── findAll ─────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns all rows ordered by carrierCode', async () => {
      prisma.shippingRate.findMany.mockResolvedValue(allDbRows);

      const result = await service.findAll();

      expect(result).toEqual(allDbRows);
      expect(prisma.shippingRate.findMany).toHaveBeenCalledWith({
        orderBy: { carrierCode: 'asc' },
      });
    });
  });

  // ─── updateRate ──────────────────────────────────────────────────────────────

  describe('updateRate', () => {
    const existingRow = makeDbRow(CarrierCode.DHL, 1999);
    const updatedRow  = makeDbRow(CarrierCode.DHL, 2499);

    it('throws NotFoundException when the carrier has no row in the DB', async () => {
      prisma.shippingRate.findUnique.mockResolvedValue(null);

      await expect(
        service.updateRate(CarrierCode.DHL, 2499),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the updated row on success', async () => {
      prisma.shippingRate.findUnique.mockResolvedValue(existingRow);
      prisma.shippingRate.update.mockResolvedValue(updatedRow);

      const result = await service.updateRate(CarrierCode.DHL, 2499);

      expect(result).toEqual(updatedRow);
    });

    it('persists the new priceInCents via prisma.shippingRate.update', async () => {
      prisma.shippingRate.findUnique.mockResolvedValue(existingRow);
      prisma.shippingRate.update.mockResolvedValue(updatedRow);

      await service.updateRate(CarrierCode.DHL, 2499);

      expect(prisma.shippingRate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { carrierCode: CarrierCode.DHL },
          data: expect.objectContaining({ priceInCents: 2499 }),
        }),
      );
    });

    it('includes isActive in update data when provided', async () => {
      prisma.shippingRate.findUnique.mockResolvedValue(existingRow);
      prisma.shippingRate.update.mockResolvedValue({ ...updatedRow, isActive: false });

      await service.updateRate(CarrierCode.DHL, 2499, false);

      expect(prisma.shippingRate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priceInCents: 2499, isActive: false }),
        }),
      );
    });

    it('does NOT include isActive in update data when omitted', async () => {
      prisma.shippingRate.findUnique.mockResolvedValue(existingRow);
      prisma.shippingRate.update.mockResolvedValue(updatedRow);

      await service.updateRate(CarrierCode.DHL, 2499);

      const updateCall = prisma.shippingRate.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('isActive');
    });

    // Regression harness for the read-repopulate race (see CACHE_KEY comment in
    // shipping-rates.service.ts): updateRate() must directly SET the freshly
    // computed map rather than DEL the key. A DEL leaves a window where a
    // concurrent getRateMap() cache-miss — already mid-flight with stale
    // pre-update data — can SET that stale value back in after the DEL, and it
    // would then be served for the full TTL. Writing the fresh map directly makes
    // this update the sole, final write for the key.
    it('SETs the freshly computed rate map into Redis instead of deleting the key', async () => {
      prisma.shippingRate.findUnique.mockResolvedValue(existingRow);
      prisma.shippingRate.update.mockResolvedValue(updatedRow);
      prisma.shippingRate.findMany.mockResolvedValue([
        ...allDbRows.filter((r) => r.carrierCode !== CarrierCode.DHL),
        makeDbRow(CarrierCode.DHL, 2499),
      ]);

      await service.updateRate(CarrierCode.DHL, 2499);

      expect(mockRedis.del).not.toHaveBeenCalled();
      expect(mockRedis.set).toHaveBeenCalledWith(
        CACHE_KEY,
        expect.any(String),
        'EX',
        CACHE_TTL_SECONDS,
      );
      const stored = JSON.parse(mockRedis.set.mock.calls[0][1]) as Record<string, number>;
      expect(stored[CarrierCode.DHL]).toBe(2499);
    });

    it('reflects the updated price on the next getRateMap() call regardless of cache state', async () => {
      mockRedis.get
        .mockResolvedValueOnce(null)  // first getRateMap: miss
        .mockResolvedValueOnce(null); // getRateMap after update: miss again

      await service.getRateMap();
      expect(prisma.shippingRate.findMany).toHaveBeenCalledTimes(1);

      prisma.shippingRate.findUnique.mockResolvedValue(existingRow);
      prisma.shippingRate.update.mockResolvedValue(updatedRow);
      await service.updateRate(CarrierCode.DHL, 2499); // repopulateCache() makes its own findMany call

      await service.getRateMap();
      expect(prisma.shippingRate.findMany).toHaveBeenCalledTimes(3);
    });

    it('reflects the updated price in getRateForCarrier after cache refresh', async () => {
      // First load: DHL = 1999
      await service.getRateForCarrier(CarrierCode.DHL);

      // Update to 2499
      prisma.shippingRate.findUnique.mockResolvedValue(existingRow);
      prisma.shippingRate.update.mockResolvedValue(updatedRow);
      await service.updateRate(CarrierCode.DHL, 2499);

      // Simulate the cache having since expired; DB returns the new price
      mockRedis.get.mockResolvedValue(null);
      prisma.shippingRate.findMany.mockResolvedValue([
        makeDbRow(CarrierCode.DHL, 2499),
      ]);

      const price = await service.getRateForCarrier(CarrierCode.DHL);
      expect(price).toBe(2499);
    });

    it('does not throw when the Redis repopulation write fails after update', async () => {
      prisma.shippingRate.findUnique.mockResolvedValue(existingRow);
      prisma.shippingRate.update.mockResolvedValue(updatedRow);
      mockRedis.set.mockRejectedValue(new Error('Redis unavailable'));

      await expect(service.updateRate(CarrierCode.DHL, 2499)).resolves.toEqual(updatedRow);
    });
  });
});
