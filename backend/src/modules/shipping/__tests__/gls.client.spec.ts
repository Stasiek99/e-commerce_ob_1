import axios from 'axios';
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
});
