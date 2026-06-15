import { createHash } from 'crypto';
import { Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type IORedis from 'ioredis';
import { StreetCheckDto } from './dto/street-check.dto';

interface ZippopotamResponse {
  places: Array<{ 'place name': string }>;
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

// User-Agent is required by the Nominatim Terms of Use.
const NOMINATIM_UA = 'FragranceStore/1.0 (contact@fragrancestore.pl)';
const NOMINATIM_TIMEOUT_MS = 3_000;
const STREET_CACHE_TTL_SECONDS = 3_600;
const POSTAL_CACHE_TTL_SECONDS = 86_400;
const POSTAL_TIMEOUT_MS = 3_000;

@Controller('location')
export class LocationController {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: IORedis) {}

  @Get('postal-code/:code')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async getCitiesByPostalCode(@Param('code') code: string): Promise<string[]> {
    if (!/^\d{2}-\d{3}$/.test(code)) {
      throw new NotFoundException('Invalid postal code format');
    }

    const cacheKey = `postal:${code}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) return JSON.parse(cached) as string[];
    } catch {}

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), POSTAL_TIMEOUT_MS);

    try {
      const res = await fetch(`https://api.zippopotam.us/pl/${code}`, {
        signal: abortController.signal,
      });
      if (!res.ok) return [];

      const data = (await res.json()) as ZippopotamResponse;
      const cities = [...new Set(data.places.map((p) => p['place name']))];
      this.redis.setex(cacheKey, POSTAL_CACHE_TTL_SECONDS, JSON.stringify(cities)).catch(() => {});
      return cities;
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  @Get('street-check')
  @Throttle({ default: { ttl: 1_000, limit: 1 } })
  async checkStreet(@Query() dto: StreetCheckDto): Promise<{ exists: boolean }> {
    const street = dto.street?.trim() ?? '';
    const city = dto.city?.trim() ?? '';
    if (!street || !city) return { exists: false };

    const cacheKey = `location:street:${createHash('sha256')
      .update(`${city.toLowerCase()}:${street.toLowerCase()}`)
      .digest('hex')
      .slice(0, 16)}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) return { exists: cached === '1' };
    } catch {}

    const params = new URLSearchParams({
      q: `${street}, ${city}, Polska`,
      format: 'json',
      countrycodes: 'pl',
      limit: '1',
    });

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), NOMINATIM_TIMEOUT_MS);

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?${params}`,
        { signal: abortController.signal, headers: { 'User-Agent': NOMINATIM_UA } },
      );
      if (!res.ok) return { exists: false };
      const data = (await res.json()) as NominatimResult[];
      const exists = Array.isArray(data) && data.length > 0;
      this.redis.setex(cacheKey, STREET_CACHE_TTL_SECONDS, exists ? '1' : '0').catch(() => {});
      return { exists };
    } catch {
      return { exists: false };
    } finally {
      clearTimeout(timeout);
    }
  }
}
