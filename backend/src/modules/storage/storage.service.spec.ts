import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

const mockFrom = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    storage: { from: mockFrom },
  })),
}));

describe('StorageService', () => {
  let service: StorageService;
  let mockBucket: {
    upload: jest.Mock;
    getPublicUrl: jest.Mock;
    createSignedUrl: jest.Mock;
    remove: jest.Mock;
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    mockBucket = {
      upload: jest.fn(),
      getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.test/image.jpg' } }),
      createSignedUrl: jest.fn(),
      remove: jest.fn(),
    };
    mockFrom.mockReturnValue(mockBucket);

    const module = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('test-value') },
        },
      ],
    }).compile();

    service = module.get(StorageService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  const fakeFile = { buffer: Buffer.from('fake-image') } as Express.Multer.File;

  describe('uploadProductImage', () => {
    it('returns the public url and path on first-attempt success', async () => {
      mockBucket.upload.mockResolvedValue({ error: null });

      const result = await service.uploadProductImage('product-1', fakeFile, 'image/jpeg');

      expect(result).toEqual({ url: 'https://cdn.test/image.jpg', path: expect.stringMatching(/^product-1\/\d+\.jpg$/) });
      expect(mockBucket.upload).toHaveBeenCalledTimes(1);
    });

    it('retries and succeeds after a transient failure instead of throwing immediately', async () => {
      mockBucket.upload
        .mockResolvedValueOnce({ error: { message: 'transient network error' } })
        .mockResolvedValueOnce({ error: null });

      const promise = service.uploadProductImage('product-1', fakeFile, 'image/png');
      await jest.advanceTimersByTimeAsync(500);
      const result = await promise;

      expect(result.url).toBe('https://cdn.test/image.jpg');
      expect(mockBucket.upload).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting all retry attempts', async () => {
      mockBucket.upload.mockResolvedValue({ error: { message: 'bucket unavailable' } });

      const promise = service.uploadProductImage('product-1', fakeFile, 'image/jpeg');
      const assertion = expect(promise).rejects.toThrow('Storage upload failed: bucket unavailable');
      await jest.advanceTimersByTimeAsync(500 + 1000);
      await assertion;

      expect(mockBucket.upload).toHaveBeenCalledTimes(3);
    });
  });

  describe('uploadInvoice', () => {
    it('returns the storage path on first-attempt success', async () => {
      mockBucket.upload.mockResolvedValue({ error: null });

      const result = await service.uploadInvoice(Buffer.from('pdf'), 'invoice-1.pdf');

      expect(result).toBe('invoices/invoice-1.pdf');
      expect(mockBucket.upload).toHaveBeenCalledTimes(1);
    });

    it('retries and succeeds after a transient failure instead of throwing immediately', async () => {
      mockBucket.upload
        .mockResolvedValueOnce({ error: { message: 'transient network error' } })
        .mockResolvedValueOnce({ error: null });

      const promise = service.uploadInvoice(Buffer.from('pdf'), 'invoice-1.pdf');
      await jest.advanceTimersByTimeAsync(500);
      const result = await promise;

      expect(result).toBe('invoices/invoice-1.pdf');
      expect(mockBucket.upload).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting all retry attempts', async () => {
      mockBucket.upload.mockResolvedValue({ error: { message: 'bucket unavailable' } });

      const promise = service.uploadInvoice(Buffer.from('pdf'), 'invoice-1.pdf');
      const assertion = expect(promise).rejects.toThrow('Invoice upload failed: bucket unavailable');
      await jest.advanceTimersByTimeAsync(500 + 1000);
      await assertion;

      expect(mockBucket.upload).toHaveBeenCalledTimes(3);
    });
  });

  describe('uploadShippingLabel', () => {
    it('returns the storage path on first-attempt success', async () => {
      mockBucket.upload.mockResolvedValue({ error: null });

      const result = await service.uploadShippingLabel(Buffer.from('pdf'), 'label-1.pdf');

      expect(result).toBe('labels/label-1.pdf');
      expect(mockBucket.upload).toHaveBeenCalledTimes(1);
    });

    it('retries and succeeds after a transient failure', async () => {
      mockBucket.upload
        .mockResolvedValueOnce({ error: { message: 'transient network error' } })
        .mockResolvedValueOnce({ error: null });

      const promise = service.uploadShippingLabel(Buffer.from('pdf'), 'label-1.pdf');
      await jest.advanceTimersByTimeAsync(500);
      const result = await promise;

      expect(result).toBe('labels/label-1.pdf');
      expect(mockBucket.upload).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting all retry attempts', async () => {
      mockBucket.upload.mockResolvedValue({ error: { message: 'bucket unavailable' } });

      const promise = service.uploadShippingLabel(Buffer.from('pdf'), 'label-1.pdf');
      const assertion = expect(promise).rejects.toThrow('Label upload failed: bucket unavailable');
      await jest.advanceTimersByTimeAsync(500 + 1000);
      await assertion;

      expect(mockBucket.upload).toHaveBeenCalledTimes(3);
    });
  });
});
