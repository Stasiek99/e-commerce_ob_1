import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

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

@Controller('location')
export class LocationController {
  @Get('postal-code/:code')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async getCitiesByPostalCode(@Param('code') code: string): Promise<string[]> {
    if (!/^\d{2}-\d{3}$/.test(code)) {
      throw new NotFoundException('Invalid postal code format');
    }

    const res = await fetch(`https://api.zippopotam.us/pl/${code}`);
    if (!res.ok) throw new NotFoundException('Postal code not found');

    const data = (await res.json()) as ZippopotamResponse;
    return [...new Set(data.places.map((p) => p['place name']))];
  }

  @Get('street-check')
  @Throttle({ default: { ttl: 1_000, limit: 1 } })
  async checkStreet(
    @Query('street') street: string,
    @Query('city') city: string,
  ): Promise<{ exists: boolean }> {
    if (!street?.trim() || !city?.trim()) return { exists: false };

    const params = new URLSearchParams({
      q: `${street.trim()}, ${city.trim()}, Polska`,
      format: 'json',
      countrycodes: 'pl',
      limit: '1',
    });

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?${params}`,
        { headers: { 'User-Agent': NOMINATIM_UA } },
      );
      if (!res.ok) return { exists: false };
      const data = (await res.json()) as NominatimResult[];
      return { exists: Array.isArray(data) && data.length > 0 };
    } catch {
      return { exists: false };
    }
  }
}
