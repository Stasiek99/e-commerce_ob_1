import axios from 'axios';
import { ServiceUnavailableException } from '@nestjs/common';
import { DpdClient } from '../carriers/dpd.client';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

const RECEIVER = {
  name: 'Anna Nowak',
  street: 'ul. Odbiorcza 5',
  city: 'Wrocław',
  postalCode: '50-001',
  country: 'PL',
  phone: '+48500600700',
  email: 'anna@example.com',
};

const PAYLOAD = { receiver: RECEIVER, weightKg: 2, reference: 'ORD-001' };

describe('DpdClient', () => {
  const mockPost = jest.fn();

  beforeEach(() => {
    mockedAxios.create.mockReturnValue({ post: mockPost } as any);
    jest.clearAllMocks();
  });

  function buildClient(overrides: Record<string, string | undefined> = {}): DpdClient {
    const defaults: Record<string, string> = {
      DPD_MOCK_ENABLED: 'false',
      DPD_SENDER_ID: 'SENDER_XYZ',
      DPD_API_KEY: 'dpd-key-abc',
    };
    const config = { ...defaults, ...overrides };
    const configService = {
      get: jest.fn((key: string, fallback?: unknown) => config[key] ?? fallback),
      getOrThrow: jest.fn((key: string) => {
        const val = config[key];
        if (!val) throw new Error(`Missing config: ${key}`);
        return val;
      }),
    };
    return new DpdClient(configService as any);
  }

  // ── Mock mode ─────────────────────────────────────────────────────────────

  describe('mock mode', () => {
    it('returns a mock result without making any HTTP request when DPD_MOCK_ENABLED=true', async () => {
      const client = buildClient({ DPD_MOCK_ENABLED: 'true' });

      const result = await client.createShipment(PAYLOAD);

      expect(result.trackingNumber).toMatch(/^MOCK_DPD_/);
      expect(result.labelUrl).toMatch(/^mock-label-dpd-/);
      expect(mockPost).not.toHaveBeenCalled();
    });

    // FIX: missing DPD_SENDER_ID must NOT silently activate mock mode.
    // Before the fix the OR clause `|| !configService.get('DPD_SENDER_ID')` caused
    // real customers to receive MOCK_DPD_* tracking numbers when the env var was absent.
    it('throws at construction when DPD_SENDER_ID is absent and DPD_MOCK_ENABLED is false', () => {
      expect(() =>
        buildClient({ DPD_MOCK_ENABLED: 'false', DPD_SENDER_ID: undefined }),
      ).toThrow();
    });

    it('does NOT activate mock mode when DPD_MOCK_ENABLED is explicitly "false" and credentials are present', async () => {
      const client = buildClient({ DPD_MOCK_ENABLED: 'false' });
      mockPost.mockResolvedValue({ data: { trackingNumber: 'DPD-REAL', labelUrl: '' } });

      const result = await client.createShipment(PAYLOAD);

      expect(result.trackingNumber).not.toMatch(/^MOCK_DPD_/);
      expect(mockPost).toHaveBeenCalledTimes(1);
    });
  });

  // ── Real mode — request payload ───────────────────────────────────────────

  describe('createShipment real mode', () => {
    it('returns tracking number and label URL from DPD API response', async () => {
      const client = buildClient();
      mockPost.mockResolvedValue({ data: { trackingNumber: 'DPD123456', labelUrl: 'https://dpd.pl/labels/abc.pdf' } });

      const result = await client.createShipment(PAYLOAD);

      expect(result.trackingNumber).toBe('DPD123456');
      expect(result.labelUrl).toBe('https://dpd.pl/labels/abc.pdf');
    });

    it('falls back to parcels[0].waybill when top-level trackingNumber is absent', async () => {
      const client = buildClient();
      mockPost.mockResolvedValue({ data: { parcels: [{ waybill: 'WAYBILL99', labelUrl: '' }] } });

      const result = await client.createShipment(PAYLOAD);

      expect(result.trackingNumber).toBe('WAYBILL99');
    });

    it('posts receiver details to the DPD API', async () => {
      const client = buildClient();
      mockPost.mockResolvedValue({ data: { trackingNumber: 'T1', labelUrl: '' } });

      await client.createShipment(PAYLOAD);

      const body = mockPost.mock.calls[0][1];
      expect(body.receiver.name).toBe(RECEIVER.name);
      expect(body.receiver.city).toBe(RECEIVER.city);
      expect(body.receiver.postalCode).toBe(RECEIVER.postalCode);
    });

    it('rounds weight to two decimal places with at least 1 kg minimum', async () => {
      const client = buildClient();
      mockPost.mockResolvedValue({ data: { trackingNumber: 'T2', labelUrl: '' } });

      await client.createShipment({ ...PAYLOAD, weightKg: 0.001 });

      const body = mockPost.mock.calls[0][1];
      expect(body.parcels[0].weight).toBeGreaterThanOrEqual(1);
    });

    it('propagates HTTP errors from the DPD API to the caller', async () => {
      const client = buildClient();
      mockPost.mockRejectedValue(new Error('DPD 503'));

      await expect(client.createShipment(PAYLOAD)).rejects.toThrow('DPD 503');
    });
  });

  // ── Tracking URL ──────────────────────────────────────────────────────────

  describe('getTrackingUrl', () => {
    it('returns a DPD tracking URL containing the tracking number', () => {
      const client = buildClient({ DPD_MOCK_ENABLED: 'true' });

      const url = client.getTrackingUrl('DPD123456');

      expect(url).toContain('DPD123456');
      expect(url).toContain('dpd.com.pl');
    });
  });

  // ── HTTP timeout handling ─────────────────────────────────────────────────

  describe('HTTP timeout handling', () => {
    it('passes timeout: 15_000 to axios.create()', () => {
      buildClient();
      const createCall = mockedAxios.create.mock.calls[0][0];
      expect(createCall?.timeout).toBe(15_000);
    });

    it('throws ServiceUnavailableException when DPD API returns ECONNABORTED', async () => {
      const client = buildClient();
      mockedAxios.isAxiosError.mockReturnValue(true);
      mockPost.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));

      await expect(client.createShipment(PAYLOAD)).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException when DPD API returns ETIMEDOUT', async () => {
      const client = buildClient();
      mockedAxios.isAxiosError.mockReturnValue(true);
      mockPost.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));

      await expect(client.createShipment(PAYLOAD)).rejects.toThrow(ServiceUnavailableException);
    });

    it('re-throws non-timeout Axios errors without converting them', async () => {
      const client = buildClient();
      mockedAxios.isAxiosError.mockReturnValue(true);
      mockPost.mockRejectedValue(Object.assign(new Error('DPD 400 Bad Request'), { code: 'ERR_BAD_REQUEST' }));

      await expect(client.createShipment(PAYLOAD)).rejects.toThrow('DPD 400 Bad Request');
    });
  });
});
