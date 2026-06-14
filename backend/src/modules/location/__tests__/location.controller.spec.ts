import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { LocationController } from '../location.controller';

// Throttler metadata key format from @nestjs/throttler v6
const THROTTLER_TTL   = 'THROTTLER:TTL';
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';

const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  setex: jest.fn().mockResolvedValue('OK'),
};

describe('LocationController', () => {
  let controller: LocationController;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LocationController],
      providers: [{ provide: 'REDIS_CLIENT', useValue: mockRedis }],
    }).compile();

    controller = module.get(LocationController);
    fetchSpy = jest.spyOn(global, 'fetch');
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue('OK');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── Fix #55 — throttle metadata verification ─────────────────────────────

  describe('throttle metadata — checkStreet (Nominatim ToU: 1 req/s)', () => {
    it('has THROTTLER:LIMITdefault = 1 on the method prototype', () => {
      const limit = Reflect.getMetadata(
        `${THROTTLER_LIMIT}default`,
        controller.checkStreet,
      );
      expect(limit).toBe(1);
    });

    it('has THROTTLER:TTLdefault = 1000 ms on the method prototype', () => {
      const ttl = Reflect.getMetadata(
        `${THROTTLER_TTL}default`,
        controller.checkStreet,
      );
      expect(ttl).toBe(1_000);
    });
  });

  describe('throttle metadata — getCitiesByPostalCode (20 req / 60 s)', () => {
    it('has THROTTLER:LIMITdefault = 20 on the method prototype', () => {
      const limit = Reflect.getMetadata(
        `${THROTTLER_LIMIT}default`,
        controller.getCitiesByPostalCode,
      );
      expect(limit).toBe(20);
    });

    it('has THROTTLER:TTLdefault = 60000 ms on the method prototype', () => {
      const ttl = Reflect.getMetadata(
        `${THROTTLER_TTL}default`,
        controller.getCitiesByPostalCode,
      );
      expect(ttl).toBe(60_000);
    });
  });

  // ─── getCitiesByPostalCode — business logic ────────────────────────────────

  describe('getCitiesByPostalCode', () => {
    it('throws NotFoundException for malformed postal code (no dash)', async () => {
      await expect(controller.getCitiesByPostalCode('00001')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for malformed postal code (wrong format)', async () => {
      await expect(controller.getCitiesByPostalCode('ABC-DE')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when Zippopotam returns non-OK', async () => {
      fetchSpy.mockResolvedValue({ ok: false } as Response);

      await expect(controller.getCitiesByPostalCode('00-001')).rejects.toThrow(NotFoundException);
    });

    it('returns deduplicated city names from Zippopotam response', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({
          places: [
            { 'place name': 'Warszawa' },
            { 'place name': 'Warszawa' }, // duplicate
            { 'place name': 'Śródmieście' },
          ],
        }),
      } as unknown as Response);

      const result = await controller.getCitiesByPostalCode('00-001');

      expect(result).toEqual(['Warszawa', 'Śródmieście']);
    });

    it('calls Zippopotam API with correct URL', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ places: [{ 'place name': 'Kraków' }] }),
      } as unknown as Response);

      await controller.getCitiesByPostalCode('30-001');

      expect(fetchSpy).toHaveBeenCalledWith('https://api.zippopotam.us/pl/30-001');
    });
  });

  // ─── checkStreet — business logic ─────────────────────────────────────────

  describe('checkStreet', () => {
    it('returns { exists: false } when street is empty', async () => {
      const result = await controller.checkStreet({ street: '', city: 'Warszawa' });
      expect(result).toEqual({ exists: false });
    });

    it('returns { exists: false } when city is empty', async () => {
      const result = await controller.checkStreet({ street: 'ul. Marszałkowska', city: '' });
      expect(result).toEqual({ exists: false });
    });

    it('returns { exists: false } when city is whitespace-only', async () => {
      const result = await controller.checkStreet({ street: 'ul. Marszałkowska', city: '   ' });
      expect(result).toEqual({ exists: false });
    });

    it('returns { exists: false } when street is absent', async () => {
      const result = await controller.checkStreet({ city: 'Warszawa' });
      expect(result).toEqual({ exists: false });
    });

    it('returns { exists: true } when Nominatim returns a result', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => [{ display_name: 'ul. Marszałkowska, Warszawa', lat: '52.2', lon: '21.0' }],
      } as unknown as Response);

      const result = await controller.checkStreet({ street: 'ul. Marszałkowska', city: 'Warszawa' });

      expect(result).toEqual({ exists: true });
    });

    it('returns { exists: false } when Nominatim returns empty array', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => [],
      } as unknown as Response);

      const result = await controller.checkStreet({ street: 'ul. Nieistniejąca', city: 'Kraków' });

      expect(result).toEqual({ exists: false });
    });

    it('returns { exists: false } when Nominatim returns non-OK response', async () => {
      fetchSpy.mockResolvedValue({ ok: false } as Response);

      const result = await controller.checkStreet({ street: 'ul. Testowa', city: 'Gdańsk' });

      expect(result).toEqual({ exists: false });
    });

    it('returns { exists: false } when fetch throws (network error)', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));

      const result = await controller.checkStreet({ street: 'ul. Testowa', city: 'Gdańsk' });

      expect(result).toEqual({ exists: false });
    });

    it('trims whitespace from street and city before sending to Nominatim', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => [{ display_name: 'result', lat: '0', lon: '0' }],
      } as unknown as Response);

      await controller.checkStreet({ street: '  ul. Testowa  ', city: '  Kraków  ' });

      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(calledUrl).toContain('ul.+Testowa');
      expect(calledUrl).toContain('Krak%C3%B3w'); // URL-encoded 'ó'
    });

    // ── AbortController timeout ───────────────────────────────────────────────

    it('returns { exists: false } when fetch is aborted by the 3s timeout', async () => {
      fetchSpy.mockImplementation(() =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new DOMException('The operation was aborted.', 'AbortError')), 10),
        ),
      );

      const result = await controller.checkStreet({ street: 'ul. Testowa', city: 'Warszawa' });

      expect(result).toEqual({ exists: false });
    });

    // ── Redis cache ───────────────────────────────────────────────────────────

    it('returns cached { exists: true } without calling Nominatim when cache hit is "1"', async () => {
      mockRedis.get.mockResolvedValue('1');

      const result = await controller.checkStreet({ street: 'ul. Marszałkowska', city: 'Warszawa' });

      expect(result).toEqual({ exists: true });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns cached { exists: false } without calling Nominatim when cache hit is "0"', async () => {
      mockRedis.get.mockResolvedValue('0');

      const result = await controller.checkStreet({ street: 'ul. Nieistniejąca', city: 'Kraków' });

      expect(result).toEqual({ exists: false });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('calls Nominatim and caches result when cache misses', async () => {
      mockRedis.get.mockResolvedValue(null);
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => [{ display_name: 'ul. Marszałkowska, Warszawa', lat: '52.2', lon: '21.0' }],
      } as unknown as Response);

      const result = await controller.checkStreet({ street: 'ul. Marszałkowska', city: 'Warszawa' });

      expect(result).toEqual({ exists: true });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringMatching(/^location:street:/),
        3_600,
        '1',
      );
    });

    it('caches "0" for a street that does not exist in Nominatim', async () => {
      mockRedis.get.mockResolvedValue(null);
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => [],
      } as unknown as Response);

      await controller.checkStreet({ street: 'ul. Fantazyjna', city: 'Kraków' });

      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringMatching(/^location:street:/),
        3_600,
        '0',
      );
    });

    it('still returns a result when Redis.get throws (Redis is down)', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis ECONNREFUSED'));
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => [{ display_name: 'ul. Testowa, Gdańsk', lat: '54.3', lon: '18.6' }],
      } as unknown as Response);

      const result = await controller.checkStreet({ street: 'ul. Testowa', city: 'Gdańsk' });

      expect(result).toEqual({ exists: true });
    });

    it('uses the same cache key for the same street+city regardless of input case', async () => {
      mockRedis.get.mockResolvedValue('1');

      const r1 = await controller.checkStreet({ street: 'ul. Testowa', city: 'Gdańsk' });
      const r2 = await controller.checkStreet({ street: 'UL. TESTOWA', city: 'GDAŃSK' });

      expect(r1).toEqual({ exists: true });
      expect(r2).toEqual({ exists: true });

      // Both calls must look up the same cache key
      expect(mockRedis.get).toHaveBeenCalledTimes(2);
      expect(mockRedis.get.mock.calls[0][0]).toBe(mockRedis.get.mock.calls[1][0]);
    });
  });
});
