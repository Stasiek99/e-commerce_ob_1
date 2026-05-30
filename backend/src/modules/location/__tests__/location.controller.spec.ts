import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { LocationController } from '../location.controller';

// Throttler metadata key format from @nestjs/throttler v6
const THROTTLER_TTL   = 'THROTTLER:TTL';
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';

describe('LocationController', () => {
  let controller: LocationController;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LocationController],
    }).compile();

    controller = module.get(LocationController);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── Fix #55 — throttle metadata verification ─────────────────────────────
  // Invariant: both endpoints must carry @Throttle metadata so the global
  // ThrottlerGuard enforces rate limits and prevents Nominatim/Zippopotam
  // from banning the backend IP.

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
      const result = await controller.checkStreet('', 'Warszawa');
      expect(result).toEqual({ exists: false });
    });

    it('returns { exists: false } when city is empty', async () => {
      const result = await controller.checkStreet('ul. Marszałkowska', '');
      expect(result).toEqual({ exists: false });
    });

    it('returns { exists: false } when city is whitespace-only', async () => {
      const result = await controller.checkStreet('ul. Marszałkowska', '   ');
      expect(result).toEqual({ exists: false });
    });

    it('returns { exists: true } when Nominatim returns a result', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => [{ display_name: 'ul. Marszałkowska, Warszawa', lat: '52.2', lon: '21.0' }],
      } as unknown as Response);

      const result = await controller.checkStreet('ul. Marszałkowska', 'Warszawa');

      expect(result).toEqual({ exists: true });
    });

    it('returns { exists: false } when Nominatim returns empty array', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => [],
      } as unknown as Response);

      const result = await controller.checkStreet('ul. Nieistniejąca', 'Kraków');

      expect(result).toEqual({ exists: false });
    });

    it('returns { exists: false } when Nominatim returns non-OK response', async () => {
      fetchSpy.mockResolvedValue({ ok: false } as Response);

      const result = await controller.checkStreet('ul. Testowa', 'Gdańsk');

      expect(result).toEqual({ exists: false });
    });

    it('returns { exists: false } when fetch throws (network error)', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));

      const result = await controller.checkStreet('ul. Testowa', 'Gdańsk');

      expect(result).toEqual({ exists: false });
    });

    it('trims whitespace from street and city before sending to Nominatim', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => [{ display_name: 'result', lat: '0', lon: '0' }],
      } as unknown as Response);

      await controller.checkStreet('  ul. Testowa  ', '  Kraków  ');

      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(calledUrl).toContain('ul.+Testowa');
      expect(calledUrl).toContain('Krak%C3%B3w'); // URL-encoded 'ó'
    });
  });
});
