/**
 * Regression guard for invoice bucket access control.
 *
 * Invariant: invoice PDFs must NEVER be accessed via getPublicUrl().
 * The invoices bucket is private (public = false, see invoices-rls.sql).
 * All invoice reads must go through createSignedUrl() with a 1h TTL so
 * only the authenticated order owner can download their invoice.
 *
 * If someone changes getInvoiceSignedUrl() to call getPublicUrl(), the
 * presigned-URL guard breaks and every invoice becomes permanently public
 * via a predictable CDN path.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { StorageService } from '../storage.service';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;

const MOCK_STORAGE_PATH = 'invoices/FV-2026-000001.pdf';
const MOCK_SIGNED_URL =
  'https://project.supabase.co/storage/v1/object/sign/invoices/FV-2026-000001.pdf?token=xyz';
const MOCK_PDF = Buffer.from('%PDF-1.4 mock invoice content');

function buildSupabaseMock() {
  const mockUpload         = jest.fn().mockResolvedValue({ error: null });
  const mockCreateSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl: MOCK_SIGNED_URL }, error: null });
  const mockGetPublicUrl   = jest.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.supabase.co/public/invoices/test.pdf' } });
  const mockFrom           = jest.fn().mockReturnValue({ upload: mockUpload, createSignedUrl: mockCreateSignedUrl, getPublicUrl: mockGetPublicUrl, remove: jest.fn().mockResolvedValue({ error: null }) });

  mockCreateClient.mockReturnValue({ storage: { from: mockFrom } } as any);

  return { mockUpload, mockCreateSignedUrl, mockGetPublicUrl, mockFrom };
}

describe('StorageService — invoice bucket security', () => {
  let service: StorageService;
  let mocks: ReturnType<typeof buildSupabaseMock>;

  beforeEach(async () => {
    mocks = buildSupabaseMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const cfg: Record<string, string> = {
                SUPABASE_URL: 'https://project.supabase.co',
                SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
              };
              if (!cfg[key]) throw new Error(`Missing config: ${key}`);
              return cfg[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get(StorageService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── uploadInvoice: must return path only (never a public URL) ─────────────

  it('uploadInvoice returns the storage path (not a public URL)', async () => {
    const path = await service.uploadInvoice(MOCK_PDF, 'FV-2026-000001.pdf');

    expect(path).toBe('invoices/FV-2026-000001.pdf');
    expect(path).not.toMatch(/^https?:\/\//);
  });

  it('uploadInvoice targets the invoices bucket, not product-images or shipping-labels', async () => {
    await service.uploadInvoice(MOCK_PDF, 'FV-2026-000001.pdf');

    expect(mocks.mockFrom).toHaveBeenCalledWith('invoices');
    expect(mocks.mockFrom).not.toHaveBeenCalledWith('product-images');
    expect(mocks.mockFrom).not.toHaveBeenCalledWith('shipping-labels');
  });

  it('uploadInvoice does NOT call getPublicUrl — invoices bucket is private', async () => {
    await service.uploadInvoice(MOCK_PDF, 'FV-2026-000001.pdf');

    expect(mocks.mockGetPublicUrl).not.toHaveBeenCalled();
  });

  it('uploadInvoice sets contentType to application/pdf', async () => {
    await service.uploadInvoice(MOCK_PDF, 'FV-2026-000001.pdf');

    expect(mocks.mockUpload).toHaveBeenCalledWith(
      'invoices/FV-2026-000001.pdf',
      MOCK_PDF,
      expect.objectContaining({ contentType: 'application/pdf' }),
    );
  });

  it('uploadInvoice throws when Supabase upload fails', async () => {
    mocks.mockUpload.mockResolvedValue({ error: { message: 'storage quota exceeded' } });

    await expect(service.uploadInvoice(MOCK_PDF, 'FV-2026-000001.pdf')).rejects.toThrow(
      'Invoice upload failed: storage quota exceeded',
    );
  });

  // ── getInvoiceSignedUrl: must use createSignedUrl, never getPublicUrl ─────

  it('getInvoiceSignedUrl returns a time-limited signed URL', async () => {
    const url = await service.getInvoiceSignedUrl(MOCK_STORAGE_PATH);

    expect(url).toBe(MOCK_SIGNED_URL);
  });

  it('getInvoiceSignedUrl calls createSignedUrl with a 1-hour TTL by default', async () => {
    await service.getInvoiceSignedUrl(MOCK_STORAGE_PATH);

    expect(mocks.mockCreateSignedUrl).toHaveBeenCalledWith(MOCK_STORAGE_PATH, 3600);
  });

  it('getInvoiceSignedUrl accepts a custom TTL', async () => {
    await service.getInvoiceSignedUrl(MOCK_STORAGE_PATH, 300);

    expect(mocks.mockCreateSignedUrl).toHaveBeenCalledWith(MOCK_STORAGE_PATH, 300);
  });

  it('getInvoiceSignedUrl does NOT call getPublicUrl — that would bypass the private bucket', async () => {
    await service.getInvoiceSignedUrl(MOCK_STORAGE_PATH);

    expect(mocks.mockGetPublicUrl).not.toHaveBeenCalled();
  });

  it('getInvoiceSignedUrl throws when Supabase signing fails', async () => {
    mocks.mockCreateSignedUrl.mockResolvedValue({ data: null, error: { message: 'bucket not found' } });

    await expect(service.getInvoiceSignedUrl(MOCK_STORAGE_PATH)).rejects.toThrow(
      'Invoice signing failed: bucket not found',
    );
  });

  it('getInvoiceSignedUrl throws when data is null without an explicit error', async () => {
    mocks.mockCreateSignedUrl.mockResolvedValue({ data: null, error: null });

    await expect(service.getInvoiceSignedUrl(MOCK_STORAGE_PATH)).rejects.toThrow(
      'Invoice signing failed',
    );
  });
});
