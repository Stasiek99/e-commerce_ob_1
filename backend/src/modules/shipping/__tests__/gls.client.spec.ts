import axios from 'axios';
import { ServiceUnavailableException } from '@nestjs/common';
import { GlsClient } from '../carriers/gls.client';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GlsClient', () => {
  const mockPost = jest.fn();

  beforeEach(() => {
    mockedAxios.create.mockReturnValue({ post: mockPost } as any);
    jest.clearAllMocks();
  });

  function buildClient(overrides: Record<string, string | undefined> = {}): GlsClient {
    const defaults: Record<string, string> = {
      GLS_MOCK_ENABLED: 'false',
      GLS_SENDER_ID: 'SENDER_123',
      GLS_USERNAME: 'user',
      GLS_PASSWORD: 'pass',
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
    return new GlsClient(configService as any);
  }

  describe('fetchLabelPdf', () => {
    it('returns null without making any HTTP request when mock mode is explicitly enabled', async () => {
      const client = buildClient({ GLS_MOCK_ENABLED: 'true' });

      const result = await client.fetchLabelPdf('P001');

      expect(result).toBeNull();
      expect(mockPost).not.toHaveBeenCalled();
    });

    // FIX: missing GLS_SENDER_ID must NOT silently activate mock mode.
    // Before the fix the OR clause `|| !configService.get('GLS_SENDER_ID')` caused
    // real customers to receive MOCK_GLS_* tracking numbers when the env var was absent.
    it('throws at construction when GLS_SENDER_ID is absent and GLS_MOCK_ENABLED is false', () => {
      expect(() =>
        buildClient({ GLS_MOCK_ENABLED: 'false', GLS_SENDER_ID: undefined }),
      ).toThrow();
    });

    it('POSTs to ?labels with the parcel number and arraybuffer responseType in real mode', async () => {
      const client = buildClient();
      mockPost.mockResolvedValue({ data: new Uint8Array([37, 80, 68, 70]).buffer }); // %PDF

      await client.fetchLabelPdf('P12345');

      expect(mockPost).toHaveBeenCalledWith(
        '?labels',
        { Parcels: ['P12345'] },
        expect.objectContaining({ responseType: 'arraybuffer' }),
      );
    });

    it('returns a Buffer containing the PDF bytes returned by the GLS API', async () => {
      const client = buildClient();
      const pdfBytes = new Uint8Array([37, 80, 68, 70, 45]); // %PDF-
      mockPost.mockResolvedValue({ data: pdfBytes.buffer });

      const result = await client.fetchLabelPdf('P12345');

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result).not.toBeNull();
      expect((result as Buffer).length).toBe(pdfBytes.length);
    });

    it('propagates HTTP errors from the GLS API to the caller', async () => {
      const client = buildClient();
      mockPost.mockRejectedValue(new Error('GLS API 503'));

      await expect(client.fetchLabelPdf('P_BAD')).rejects.toThrow('GLS API 503');
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
      it('throws ServiceUnavailableException when GLS API returns ECONNABORTED', async () => {
        const client = buildClient();
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockPost.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));

        await expect(
          client.createShipment({ receiver: { name: 'Test', street: 'ul. 1', city: 'Kraków', postalCode: '30-001', country: 'PL', phone: '+48100200300', email: 't@t.pl' }, weightKg: 1, reference: 'REF1' }),
        ).rejects.toThrow(ServiceUnavailableException);
      });

      it('throws ServiceUnavailableException when GLS API returns ETIMEDOUT', async () => {
        const client = buildClient();
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockPost.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));

        await expect(
          client.createShipment({ receiver: { name: 'Test', street: 'ul. 1', city: 'Kraków', postalCode: '30-001', country: 'PL', phone: '+48100200300', email: 't@t.pl' }, weightKg: 1, reference: 'REF1' }),
        ).rejects.toThrow(ServiceUnavailableException);
      });
    });

    describe('fetchLabelPdf', () => {
      it('throws ServiceUnavailableException when label download returns ECONNABORTED', async () => {
        const client = buildClient();
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockPost.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));

        await expect(client.fetchLabelPdf('P_TIMEOUT')).rejects.toThrow(ServiceUnavailableException);
      });

      it('throws ServiceUnavailableException when label download returns ETIMEDOUT', async () => {
        const client = buildClient();
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockPost.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));

        await expect(client.fetchLabelPdf('P_TIMEOUT')).rejects.toThrow(ServiceUnavailableException);
      });
    });
  });

  // ── getTrackingStatus ──────────────────────────────────────────────────────

  describe('getTrackingStatus', () => {
    describe('mock mode', () => {
      it('returns null before the configured IN_TRANSIT threshold elapses', async () => {
        const client = buildClient({ GLS_MOCK_ENABLED: 'true' });

        const result = await client.getTrackingStatus('P001', new Date(Date.now() - 60_000));

        expect(result).toBeNull();
      });

      it('returns DELIVERED with a deliveredAt timestamp once the DELIVERED threshold elapses', async () => {
        const client = buildClient({ GLS_MOCK_ENABLED: 'true' });

        const result = await client.getTrackingStatus('P001', new Date(Date.now() - 6 * 60_000));

        expect(result?.status).toBe('DELIVERED');
        expect(result?.deliveredAt).toBeInstanceOf(Date);
      });
    });

    describe('real mode', () => {
      it('POSTs to ?track with the parcel ID', async () => {
        const client = buildClient();
        mockPost.mockResolvedValue({ data: { Parcel: [{ Events: [{ StatusCode: 'IN_TRANSIT' }] }] } });

        await client.getTrackingStatus('P12345', new Date());

        expect(mockPost).toHaveBeenCalledWith('?track', { Parcels: ['P12345'] });
      });

      it('maps StatusCode "DELIVERED" to DELIVERED with a deliveredAt timestamp', async () => {
        const client = buildClient();
        mockPost.mockResolvedValue({ data: { Parcel: [{ Events: [{ StatusCode: 'DELIVERED' }] }] } });

        const result = await client.getTrackingStatus('P1', new Date());

        expect(result?.status).toBe('DELIVERED');
        expect(result?.deliveredAt).toBeInstanceOf(Date);
      });

      it('maps StatusCode "RETURNED" to RETURNED', async () => {
        const client = buildClient();
        mockPost.mockResolvedValue({ data: { Parcel: [{ Events: [{ StatusCode: 'RETURNED' }] }] } });

        const result = await client.getTrackingStatus('P1', new Date());

        expect(result?.status).toBe('RETURNED');
      });

      it('returns null for an unrecognized StatusCode', async () => {
        const client = buildClient();
        mockPost.mockResolvedValue({ data: { Parcel: [{ Events: [{ StatusCode: 'SOMETHING_NEW' }] }] } });

        const result = await client.getTrackingStatus('P1', new Date());

        expect(result).toBeNull();
      });

      it('throws ServiceUnavailableException on a timed-out tracking lookup', async () => {
        const client = buildClient();
        mockedAxios.isAxiosError.mockReturnValue(true);
        mockPost.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));

        await expect(client.getTrackingStatus('P1', new Date())).rejects.toThrow(ServiceUnavailableException);
      });
    });
  });
});
