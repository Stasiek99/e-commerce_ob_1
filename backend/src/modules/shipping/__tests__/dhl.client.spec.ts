import axios from 'axios';
import { ServiceUnavailableException } from '@nestjs/common';
import { DhlClient } from '../carriers/dhl.client';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

const RECEIVER = {
  name: 'Jan Kowalski',
  street: 'ul. Odbiorca 1',
  city: 'Warszawa',
  postalCode: '00-001',
  country: 'PL',
  phone: '+48111222333',
  email: 'jan@example.com',
};

describe('DhlClient', () => {
  const mockPost = jest.fn();

  beforeEach(() => {
    mockedAxios.create.mockReturnValue({ post: mockPost } as any);
    jest.clearAllMocks();
  });

  function buildClient(overrides: Record<string, string | undefined> = {}): DhlClient {
    const defaults: Record<string, string> = {
      DHL_MOCK_ENABLED: 'false',
      DHL_ACCOUNT_NUMBER: 'ACC123',
      DHL_API_KEY: 'key',
      DHL_API_SECRET: 'secret',
      DHL_SHIPPER_NAME: 'Test Store',
      DHL_SHIPPER_STREET: 'ul. Magazyn 5',
      DHL_SHIPPER_CITY: 'Gdańsk',
      DHL_SHIPPER_POSTAL_CODE: '80-100',
      DHL_SHIPPER_PHONE: '+48600700800',
      DHL_SHIPPER_EMAIL: 'wysylki@teststore.pl',
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
    return new DhlClient(configService as any);
  }

  // ── Mock mode ─────────────────────────────────────────────────────────────

  describe('mock mode', () => {
    it('returns a mock result without making any HTTP request when DHL_MOCK_ENABLED=true', async () => {
      const client = buildClient({ DHL_MOCK_ENABLED: 'true' });

      const result = await client.createShipment({ receiver: RECEIVER, weightKg: 1, description: 'Perfumy' });

      expect(result.trackingNumber).toMatch(/^MOCK_DHL_/);
      expect(result.labelUrl).toMatch(/^mock-label-dhl-/);
      expect(mockPost).not.toHaveBeenCalled();
    });

    // FIX: missing DHL_ACCOUNT_NUMBER must NOT silently activate mock mode.
    // Before the fix the OR clause `|| !configService.get('DHL_ACCOUNT_NUMBER')` caused
    // real customers to receive MOCK_DHL_* tracking numbers when the env var was absent.
    it('throws at construction when DHL_ACCOUNT_NUMBER is absent and DHL_MOCK_ENABLED is false', () => {
      expect(() =>
        buildClient({ DHL_MOCK_ENABLED: 'false', DHL_ACCOUNT_NUMBER: undefined }),
      ).toThrow();
    });

    it('does NOT activate mock mode when DHL_MOCK_ENABLED is explicitly "false" and credentials are present', async () => {
      const client = buildClient({ DHL_MOCK_ENABLED: 'false' });
      mockPost.mockResolvedValue({ data: { shipmentTrackingNumber: 'JD-REAL', documents: [] } });

      const result = await client.createShipment({ receiver: RECEIVER, weightKg: 1, description: 'Perfumy' });

      expect(result.trackingNumber).not.toMatch(/^MOCK_DHL_/);
      expect(mockPost).toHaveBeenCalledTimes(1);
    });
  });

  // ── Shipper env-var wiring ────────────────────────────────────────────────

  describe('shipper details from env vars', () => {
    it('uses DHL_SHIPPER_CITY from config, not the hardcoded Kraków fallback', async () => {
      const client = buildClient({ DHL_SHIPPER_CITY: 'Wrocław' });
      mockPost.mockResolvedValue({ data: { shipmentTrackingNumber: 'TRK1', documents: [] } });

      await client.createShipment({ receiver: RECEIVER, weightKg: 1, description: 'Test' });

      const payload = mockPost.mock.calls[0][1];
      expect(payload.customerDetails.shipperDetails.postalAddress.cityName).toBe('Wrocław');
    });

    it('uses DHL_SHIPPER_NAME from config, not the hardcoded "Fragrance Store" fallback', async () => {
      const client = buildClient({ DHL_SHIPPER_NAME: 'Mój Sklep' });
      mockPost.mockResolvedValue({ data: { shipmentTrackingNumber: 'TRK1', documents: [] } });

      await client.createShipment({ receiver: RECEIVER, weightKg: 1, description: 'Test' });

      const payload = mockPost.mock.calls[0][1];
      expect(payload.customerDetails.shipperDetails.contactInformation.fullName).toBe('Mój Sklep');
    });

    it('uses DHL_SHIPPER_STREET from config', async () => {
      const client = buildClient({ DHL_SHIPPER_STREET: 'al. Lipowa 7' });
      mockPost.mockResolvedValue({ data: { shipmentTrackingNumber: 'TRK2', documents: [] } });

      await client.createShipment({ receiver: RECEIVER, weightKg: 2, description: 'Test' });

      const payload = mockPost.mock.calls[0][1];
      expect(payload.customerDetails.shipperDetails.postalAddress.addressLine1).toBe('al. Lipowa 7');
    });

    it('uses DHL_SHIPPER_POSTAL_CODE from config', async () => {
      const client = buildClient({ DHL_SHIPPER_POSTAL_CODE: '50-500' });
      mockPost.mockResolvedValue({ data: { shipmentTrackingNumber: 'TRK3', documents: [] } });

      await client.createShipment({ receiver: RECEIVER, weightKg: 1, description: 'Test' });

      const payload = mockPost.mock.calls[0][1];
      expect(payload.customerDetails.shipperDetails.postalAddress.postalCode).toBe('50-500');
    });

    it('uses DHL_SHIPPER_PHONE from config', async () => {
      const client = buildClient({ DHL_SHIPPER_PHONE: '+48999888777' });
      mockPost.mockResolvedValue({ data: { shipmentTrackingNumber: 'TRK4', documents: [] } });

      await client.createShipment({ receiver: RECEIVER, weightKg: 1, description: 'Test' });

      const payload = mockPost.mock.calls[0][1];
      expect(payload.customerDetails.shipperDetails.contactInformation.phone).toBe('+48999888777');
    });

    it('uses DHL_SHIPPER_EMAIL from config', async () => {
      const client = buildClient({ DHL_SHIPPER_EMAIL: 'logistics@myshop.pl' });
      mockPost.mockResolvedValue({ data: { shipmentTrackingNumber: 'TRK5', documents: [] } });

      await client.createShipment({ receiver: RECEIVER, weightKg: 1, description: 'Test' });

      const payload = mockPost.mock.calls[0][1];
      expect(payload.customerDetails.shipperDetails.contactInformation.email).toBe('logistics@myshop.pl');
    });
  });

  // ── Receiver details passthrough ──────────────────────────────────────────

  describe('receiver details', () => {
    it('maps receiver fields from the payload argument into the DHL request', async () => {
      const client = buildClient();
      mockPost.mockResolvedValue({ data: { shipmentTrackingNumber: 'TRK6', documents: [] } });

      await client.createShipment({ receiver: RECEIVER, weightKg: 3, description: 'Zestaw' });

      const payload = mockPost.mock.calls[0][1];
      const receiverDetails = payload.customerDetails.receiverDetails;
      expect(receiverDetails.postalAddress.cityName).toBe(RECEIVER.city);
      expect(receiverDetails.postalAddress.postalCode).toBe(RECEIVER.postalCode);
      expect(receiverDetails.postalAddress.addressLine1).toBe(RECEIVER.street);
      expect(receiverDetails.contactInformation.fullName).toBe(RECEIVER.name);
      expect(receiverDetails.contactInformation.phone).toBe(RECEIVER.phone);
      expect(receiverDetails.contactInformation.email).toBe(RECEIVER.email);
    });
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  describe('createShipment real mode', () => {
    it('returns tracking number and label URL from DHL API response', async () => {
      const client = buildClient();
      mockPost.mockResolvedValue({
        data: {
          shipmentTrackingNumber: 'JD014600006060060058',
          documents: [{ url: 'https://api.dhl.com/labels/abc.pdf' }],
        },
      });

      const result = await client.createShipment({ receiver: RECEIVER, weightKg: 1, description: 'Perfumy' });

      expect(result.trackingNumber).toBe('JD014600006060060058');
      expect(result.labelUrl).toBe('https://api.dhl.com/labels/abc.pdf');
    });

    it('returns empty labelUrl when DHL response has no documents array', async () => {
      const client = buildClient();
      mockPost.mockResolvedValue({ data: { shipmentTrackingNumber: 'TRK9' } });

      const result = await client.createShipment({ receiver: RECEIVER, weightKg: 1, description: 'Test' });

      expect(result.labelUrl).toBe('');
    });

    it('propagates HTTP errors from the DHL API to the caller', async () => {
      const client = buildClient();
      mockPost.mockRejectedValue(new Error('DHL 503'));

      await expect(
        client.createShipment({ receiver: RECEIVER, weightKg: 1, description: 'Test' }),
      ).rejects.toThrow('DHL 503');
    });
  });

  // ── Tracking URL helper ───────────────────────────────────────────────────

  describe('getTrackingUrl', () => {
    it('returns a DHL tracking page URL containing the tracking number', () => {
      const client = buildClient({ DHL_MOCK_ENABLED: 'true' });

      const url = client.getTrackingUrl('JD014600006060060058');

      expect(url).toContain('JD014600006060060058');
      expect(url).toContain('dhl.com');
    });
  });

  // ── HTTP timeout handling ─────────────────────────────────────────────────

  describe('HTTP timeout handling', () => {
    it('passes timeout: 15_000 to axios.create()', () => {
      buildClient();
      const createCall = mockedAxios.create.mock.calls[0][0];
      expect(createCall?.timeout).toBe(15_000);
    });

    it('throws ServiceUnavailableException when DHL API returns ECONNABORTED', async () => {
      const client = buildClient();
      mockedAxios.isAxiosError.mockReturnValue(true);
      mockPost.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));

      await expect(
        client.createShipment({ receiver: RECEIVER, weightKg: 1, description: 'Test' }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ServiceUnavailableException when DHL API returns ETIMEDOUT', async () => {
      const client = buildClient();
      mockedAxios.isAxiosError.mockReturnValue(true);
      mockPost.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));

      await expect(
        client.createShipment({ receiver: RECEIVER, weightKg: 1, description: 'Test' }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('re-throws non-timeout Axios errors without converting them', async () => {
      const client = buildClient();
      mockedAxios.isAxiosError.mockReturnValue(true);
      mockPost.mockRejectedValue(Object.assign(new Error('DHL 401 Unauthorized'), { code: 'ERR_BAD_REQUEST' }));

      await expect(
        client.createShipment({ receiver: RECEIVER, weightKg: 1, description: 'Test' }),
      ).rejects.toThrow('DHL 401 Unauthorized');
    });
  });
});
