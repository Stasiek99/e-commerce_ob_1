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
      get: jest.fn((key: string) => config[key] ?? undefined),
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

    it('returns null without any HTTP request when GLS_SENDER_ID is absent (auto-mock fallback)', async () => {
      const client = buildClient({ GLS_MOCK_ENABLED: 'false', GLS_SENDER_ID: undefined });

      const result = await client.fetchLabelPdf('P001');

      expect(result).toBeNull();
      expect(mockPost).not.toHaveBeenCalled();
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
});
