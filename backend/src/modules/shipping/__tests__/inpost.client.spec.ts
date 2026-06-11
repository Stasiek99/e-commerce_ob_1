import axios from 'axios';
import { ServiceUnavailableException } from '@nestjs/common';
import { InpostClient } from '../carriers/inpost.client';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

const PAYLOAD = {
  receiver: { name: 'Jan Kowalski', phone: '+48111222333', email: 'jan@example.com' },
  targetLockerCode: 'KRA010',
  weightKg: 1,
};

describe('InpostClient', () => {
  const mockPost = jest.fn();
  const mockGet = jest.fn();

  beforeEach(() => {
    mockedAxios.create.mockReturnValue({ post: mockPost, get: mockGet } as any);
    jest.clearAllMocks();
  });

  function buildClient(overrides: Record<string, string | undefined> = {}): InpostClient {
    const defaults: Record<string, string> = {
      INPOST_MOCK_ENABLED: 'false',
      INPOST_ORGANIZATION_ID: 'org-123',
      INPOST_API_TOKEN: 'tok-abc',
      INPOST_SANDBOX: 'false',
    };
    const config = { ...defaults, ...overrides };
    const configService = {
      get: jest.fn((key: string, fallback?: unknown) => config[key] ?? fallback),
      getOrThrow: jest.fn((key: string) => {
        const val = config[key];
        if (val === undefined || val === '') throw new Error(`Missing config: ${key}`);
        return val;
      }),
    };
    return new InpostClient(configService as any);
  }

  // ── Mock mode activation (explicit flag only) ─────────────────────────────

  describe('mock mode — explicit INPOST_MOCK_ENABLED=true', () => {
    it('returns a mock result without making any HTTP request', async () => {
      const client = buildClient({ INPOST_MOCK_ENABLED: 'true' });

      const result = await client.createShipment(PAYLOAD);

      expect(result.id).toMatch(/^MOCK_INPOST_/);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('includes the locker code in the mock tracking number', async () => {
      const client = buildClient({ INPOST_MOCK_ENABLED: 'true' });

      const result = await client.createShipment({ ...PAYLOAD, targetLockerCode: 'WAW015' });

      expect(result.trackingNumber).toContain('WAW015');
    });

    it('returns null from fetchLabelPdf without making any HTTP request', async () => {
      const client = buildClient({ INPOST_MOCK_ENABLED: 'true' });

      const label = await client.fetchLabelPdf('MOCK_INPOST_ABCD');

      expect(label).toBeNull();
      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  // ── FIX: missing INPOST_ORGANIZATION_ID must NOT activate mock mode ────────
  // Before the fix, the OR clause `|| !configService.get('INPOST_ORGANIZATION_ID')`
  // silently enabled mock mode when the env var was absent, writing fake tracking
  // URLs to the DB and sending shipping emails with invalid tracking numbers.

  describe('mock mode — NOT activated by missing INPOST_ORGANIZATION_ID', () => {
    it('does NOT use mock mode when INPOST_ORGANIZATION_ID is absent but INPOST_MOCK_ENABLED is false', () => {
      // Before the fix this would silently activate mock mode; now it should
      // throw at construction time via configService.getOrThrow (or in real prod
      // the Joi schema enforces INPOST_ORGANIZATION_ID as required).
      expect(() =>
        buildClient({ INPOST_MOCK_ENABLED: 'false', INPOST_ORGANIZATION_ID: undefined }),
      ).toThrow();
    });

    it('uses real HTTP mode when INPOST_ORGANIZATION_ID is present and INPOST_MOCK_ENABLED is false', async () => {
      const client = buildClient({ INPOST_MOCK_ENABLED: 'false', INPOST_ORGANIZATION_ID: 'org-real' });

      mockPost.mockResolvedValue({ data: { id: 'real-shipment-id', tracking_number: 'TRK123' } });

      const result = await client.createShipment(PAYLOAD);

      expect(result.id).toBe('real-shipment-id');
      expect(result.trackingNumber).toBe('TRK123');
      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    it('does NOT activate mock mode when INPOST_MOCK_ENABLED is explicitly "false"', async () => {
      const client = buildClient({ INPOST_MOCK_ENABLED: 'false' });
      mockPost.mockResolvedValue({ data: { id: 'srv-id', tracking_number: 'TRK-REAL' } });

      const result = await client.createShipment(PAYLOAD);

      expect(result.id).not.toMatch(/^MOCK_INPOST_/);
      expect(mockPost).toHaveBeenCalledTimes(1);
    });
  });

  // ── Real mode — HTTP payload and response mapping ─────────────────────────

  describe('createShipment real mode', () => {
    it('posts to the correct InPost organization endpoint', async () => {
      const client = buildClient({ INPOST_ORGANIZATION_ID: 'org-456' });
      mockPost.mockResolvedValue({ data: { id: 'ship-id', tracking_number: 'TRK-001' } });

      await client.createShipment(PAYLOAD);

      const [url] = mockPost.mock.calls[0];
      expect(url).toContain('/organizations/org-456/shipments');
    });

    it('includes the locker code as target_point in the request payload', async () => {
      const client = buildClient();
      mockPost.mockResolvedValue({ data: { id: 'ship-id', tracking_number: 'TRK-002' } });

      await client.createShipment({ ...PAYLOAD, targetLockerCode: 'GDA099' });

      const body = mockPost.mock.calls[0][1];
      expect(body.custom_attributes.target_point).toBe('GDA099');
    });

    it('sends inpost_locker_standard as the service name', async () => {
      const client = buildClient();
      mockPost.mockResolvedValue({ data: { id: 's', tracking_number: 't' } });

      await client.createShipment(PAYLOAD);

      const body = mockPost.mock.calls[0][1];
      expect(body.service).toBe('inpost_locker_standard');
    });

    it('returns id and trackingNumber from the API response', async () => {
      const client = buildClient();
      mockPost.mockResolvedValue({
        data: { id: 'api-ship-99', tracking_number: 'PL123456789PL' },
      });

      const result = await client.createShipment(PAYLOAD);

      expect(result.id).toBe('api-ship-99');
      expect(result.trackingNumber).toBe('PL123456789PL');
    });

    it('rounds weight to one decimal place', async () => {
      const client = buildClient();
      mockPost.mockResolvedValue({ data: { id: 's', tracking_number: 't' } });

      await client.createShipment({ ...PAYLOAD, weightKg: 1.567 });

      const body = mockPost.mock.calls[0][1];
      expect(body.parcels[0].weight.amount).toBe(1.6);
    });

    it('floors weight to 1 kg minimum when given a very small value', async () => {
      const client = buildClient();
      mockPost.mockResolvedValue({ data: { id: 's', tracking_number: 't' } });

      await client.createShipment({ ...PAYLOAD, weightKg: 0.05 });

      const body = mockPost.mock.calls[0][1];
      expect(body.parcels[0].weight.amount).toBeGreaterThanOrEqual(1);
    });
  });

  // ── fetchLabelPdf real mode ───────────────────────────────────────────────

  describe('fetchLabelPdf real mode', () => {
    it('requests the label at the correct URL for the given shipment ID', async () => {
      const client = buildClient({ INPOST_ORGANIZATION_ID: 'org-456' });
      mockGet.mockResolvedValue({ data: Buffer.from('PDF') });

      await client.fetchLabelPdf('ship-99');

      const [url] = mockGet.mock.calls[0];
      expect(url).toContain('/organizations/org-456/shipments/ship-99/label');
    });

    it('returns the response as a Buffer', async () => {
      const client = buildClient();
      const pdfBytes = Buffer.from('%PDF-1.4');
      mockGet.mockResolvedValue({ data: pdfBytes });

      const result = await client.fetchLabelPdf('ship-id');

      expect(Buffer.isBuffer(result)).toBe(true);
    });
  });

  // ── Tracking URL ──────────────────────────────────────────────────────────

  describe('getTrackingUrl', () => {
    it('returns the InPost tracking URL with the tracking number embedded', () => {
      const client = buildClient({ INPOST_MOCK_ENABLED: 'true' });

      const url = client.getTrackingUrl('PL123456789PL');

      expect(url).toContain('PL123456789PL');
      expect(url).toContain('inpost.pl');
    });
  });

  // ── Sandbox vs production base URL ───────────────────────────────────────

  describe('base URL selection', () => {
    it('uses the sandbox endpoint when INPOST_SANDBOX=true', () => {
      buildClient({ INPOST_SANDBOX: 'true' });

      const createCall = mockedAxios.create.mock.calls[0][0];
      expect(createCall?.baseURL).toContain('sandbox');
    });

    it('uses the production endpoint when INPOST_SANDBOX=false', () => {
      buildClient({ INPOST_SANDBOX: 'false' });

      const createCall = mockedAxios.create.mock.calls[0][0];
      expect(createCall?.baseURL).not.toContain('sandbox');
    });
  });

  // ── HTTP timeout handling ─────────────────────────────────────────────────

  describe('HTTP timeout handling', () => {
    it('passes timeout: 15_000 to axios.create()', () => {
      buildClient();
      const createCall = mockedAxios.create.mock.calls[0][0];
      expect(createCall?.timeout).toBe(15_000);
    });

    describe('createShipment', () => {
      it('throws ServiceUnavailableException when InPost API returns ECONNABORTED', async () => {
        const client = buildClient();
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockPost.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));

        await expect(client.createShipment(PAYLOAD)).rejects.toThrow(ServiceUnavailableException);
      });

      it('throws ServiceUnavailableException when InPost API returns ETIMEDOUT', async () => {
        const client = buildClient();
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockPost.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));

        await expect(client.createShipment(PAYLOAD)).rejects.toThrow(ServiceUnavailableException);
      });

      it('re-throws non-timeout Axios errors without converting them', async () => {
        const client = buildClient();
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockPost.mockRejectedValue(Object.assign(new Error('InPost 422'), { code: 'ERR_BAD_REQUEST' }));

        await expect(client.createShipment(PAYLOAD)).rejects.toThrow('InPost 422');
      });
    });

    describe('fetchLabelPdf', () => {
      it('throws ServiceUnavailableException when label download returns ECONNABORTED', async () => {
        const client = buildClient();
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockGet.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));

        await expect(client.fetchLabelPdf('ship-99')).rejects.toThrow(ServiceUnavailableException);
      });

      it('throws ServiceUnavailableException when label download returns ETIMEDOUT', async () => {
        const client = buildClient();
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockGet.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));

        await expect(client.fetchLabelPdf('ship-99')).rejects.toThrow(ServiceUnavailableException);
      });
    });
  });
});
