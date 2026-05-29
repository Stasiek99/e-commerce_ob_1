import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CarrierCode } from '@prisma/client';
import { ShippingRatesService } from '../shipping-rates.service';
import { PrismaService } from '../../prisma/prisma.service';

const FIVE_MIN_MS = 5 * 60 * 1000;

describe('ShippingRatesService', () => {
  let service: ShippingRatesService;
  let prisma: {
    shippingRate: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

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

  beforeEach(async () => {
    prisma = {
      shippingRate: {
        findMany:   jest.fn().mockResolvedValue(allDbRows),
        findUnique: jest.fn(),
        update:     jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShippingRatesService,
        { provide: PrismaService, useValue: prisma },
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
        makeDbRow(CarrierCode.DHL, 2499), // raised from 1999
      ]);

      const map = await service.getRateMap();

      expect(map[CarrierCode.DHL]).toBe(2499);
      // Carriers not in the DB row still come from fallback
      expect(map[CarrierCode.INPOST]).toBe(1499);
    });

    it('returns cached map on second call within TTL without hitting DB again', async () => {
      await service.getRateMap();
      await service.getRateMap();

      expect(prisma.shippingRate.findMany).toHaveBeenCalledTimes(1);
    });

    it('re-fetches from DB after the cache TTL has expired', async () => {
      const now = Date.now();
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

      await service.getRateMap(); // populates cache

      // Advance past the 5-minute TTL
      dateSpy.mockReturnValue(now + FIVE_MIN_MS + 1);

      await service.getRateMap(); // cache expired → DB hit

      expect(prisma.shippingRate.findMany).toHaveBeenCalledTimes(2);
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
        const price = await service.getRateForCarrier(code);
        expect(price).toBe(expectedPrice);
      }
    });

    it('uses the cache on repeated calls without extra DB round-trips', async () => {
      await service.getRateForCarrier(CarrierCode.DHL);
      await service.getRateForCarrier(CarrierCode.INPOST);

      expect(prisma.shippingRate.findMany).toHaveBeenCalledTimes(1);
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

      await service.updateRate(CarrierCode.DHL, 2499); // isActive omitted

      const updateCall = prisma.shippingRate.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('isActive');
    });

    it('invalidates the cache so the next getRateMap() re-fetches from DB', async () => {
      // Warm the cache
      await service.getRateMap();
      expect(prisma.shippingRate.findMany).toHaveBeenCalledTimes(1);

      // Update invalidates cache
      prisma.shippingRate.findUnique.mockResolvedValue(existingRow);
      prisma.shippingRate.update.mockResolvedValue(updatedRow);
      await service.updateRate(CarrierCode.DHL, 2499);

      // Next getRateMap() must hit DB (cache was cleared)
      await service.getRateMap();
      expect(prisma.shippingRate.findMany).toHaveBeenCalledTimes(2);
    });

    it('reflects the updated price in getRateForCarrier after the cache is refreshed', async () => {
      // First load: DHL = 1999
      await service.getRateForCarrier(CarrierCode.DHL);

      // Update to 2499
      prisma.shippingRate.findUnique.mockResolvedValue(existingRow);
      prisma.shippingRate.update.mockResolvedValue(updatedRow);
      await service.updateRate(CarrierCode.DHL, 2499);

      // DB now returns updated price
      prisma.shippingRate.findMany.mockResolvedValue([
        makeDbRow(CarrierCode.DHL, 2499),
      ]);

      const price = await service.getRateForCarrier(CarrierCode.DHL);
      expect(price).toBe(2499);
    });
  });
});
