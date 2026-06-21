import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as supabaseJs from '@supabase/supabase-js';
import { StorageService } from '../storage.service';

describe('StorageService', () => {
  let service: StorageService;
  let mockUpload: jest.Mock;
  let mockCreateSignedUrl: jest.Mock;
  let mockRemove: jest.Mock;

  beforeEach(async () => {
    mockUpload = jest.fn();
    mockCreateSignedUrl = jest.fn();
    mockRemove = jest.fn();

    jest.spyOn(supabaseJs, 'createClient').mockReturnValue({
      storage: {
        from: jest.fn().mockReturnValue({
          upload: mockUpload,
          createSignedUrl: mockCreateSignedUrl,
          remove: mockRemove,
          // getPublicUrl still present for product-images bucket usage
          getPublicUrl: jest.fn().mockReturnValue({
            data: { publicUrl: 'https://cdn.example.com/products/img.jpg' },
          }),
        }),
      },
    } as any);

    const module = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('fake-value') },
        },
      ],
    }).compile();

    service = module.get(StorageService);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // ─── uploadShippingLabel ──────────────────────────────────────────────────────

  describe('uploadShippingLabel — returns storage path (not public URL)', () => {
    it('returns the storage path when the upload succeeds on the first attempt', async () => {
      mockUpload.mockResolvedValue({ error: null });

      const result = await service.uploadShippingLabel(Buffer.from('pdf'), 'order-1.pdf');

      expect(result).toBe('labels/order-1.pdf');
    });

    it('prefixes the filename with labels/ regardless of the filename passed', async () => {
      mockUpload.mockResolvedValue({ error: null });

      const result = await service.uploadShippingLabel(Buffer.from('pdf'), 'inpost-abc.pdf');

      expect(result).toBe('labels/inpost-abc.pdf');
    });

    it('does NOT call getPublicUrl after a successful upload', async () => {
      const mockGetPublicUrl = jest.fn();
      jest.spyOn(supabaseJs, 'createClient').mockReturnValue({
        storage: {
          from: jest.fn().mockReturnValue({
            upload: jest.fn().mockResolvedValue({ error: null }),
            getPublicUrl: mockGetPublicUrl,
            createSignedUrl: jest.fn(),
            remove: jest.fn(),
          }),
        },
      } as any);

      const svc2 = (
        await Test.createTestingModule({
          providers: [
            StorageService,
            { provide: ConfigService, useValue: { getOrThrow: jest.fn().mockReturnValue('x') } },
          ],
        }).compile()
      ).get(StorageService);

      await svc2.uploadShippingLabel(Buffer.from('pdf'), 'order-pii.pdf');

      expect(mockGetPublicUrl).not.toHaveBeenCalled();
    });

    it('retries once and returns the path when the second attempt succeeds', async () => {
      mockUpload
        .mockResolvedValueOnce({ error: { message: 'network blip' } })
        .mockResolvedValueOnce({ error: null });

      const promise = service.uploadShippingLabel(Buffer.from('pdf'), 'order-2.pdf');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(mockUpload).toHaveBeenCalledTimes(2);
      expect(result).toBe('labels/order-2.pdf');
    });

    it('retries twice and returns the path when the third attempt succeeds', async () => {
      mockUpload
        .mockResolvedValueOnce({ error: { message: 'network blip' } })
        .mockResolvedValueOnce({ error: { message: 'server error' } })
        .mockResolvedValueOnce({ error: null });

      const promise = service.uploadShippingLabel(Buffer.from('pdf'), 'order-3.pdf');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(mockUpload).toHaveBeenCalledTimes(3);
      expect(result).toBe('labels/order-3.pdf');
    });

    it('throws after three consecutive failures and makes no fourth attempt', async () => {
      mockUpload.mockResolvedValue({ error: { message: 'storage unavailable' } });

      const promise = service.uploadShippingLabel(Buffer.from('pdf'), 'order-4.pdf');
      const assertion = expect(promise).rejects.toThrow('Label upload failed: storage unavailable');
      await jest.runAllTimersAsync();
      await assertion;

      expect(mockUpload).toHaveBeenCalledTimes(3);
    });
  });

  // ─── getShippingLabelSignedUrl ────────────────────────────────────────────────

  describe('getShippingLabelSignedUrl', () => {
    it('returns the signed URL from Supabase for the given storage path', async () => {
      mockCreateSignedUrl.mockResolvedValue({
        data: { signedUrl: 'https://supabase.io/signed/labels/inpost-123.pdf?token=abc' },
        error: null,
      });

      const result = await service.getShippingLabelSignedUrl('labels/inpost-123.pdf');

      expect(result).toBe('https://supabase.io/signed/labels/inpost-123.pdf?token=abc');
    });

    it('requests a 4-hour TTL by default (14 400 seconds)', async () => {
      mockCreateSignedUrl.mockResolvedValue({
        data: { signedUrl: 'https://supabase.io/signed/labels/test.pdf?t=x' },
        error: null,
      });

      await service.getShippingLabelSignedUrl('labels/test.pdf');

      expect(mockCreateSignedUrl).toHaveBeenCalledWith('labels/test.pdf', 14_400);
    });

    it('uses the caller-supplied TTL when one is passed', async () => {
      mockCreateSignedUrl.mockResolvedValue({
        data: { signedUrl: 'https://supabase.io/signed/labels/test.pdf?t=y' },
        error: null,
      });

      await service.getShippingLabelSignedUrl('labels/test.pdf', 3600);

      expect(mockCreateSignedUrl).toHaveBeenCalledWith('labels/test.pdf', 3600);
    });

    it('throws "Label signing failed" when Supabase returns an error', async () => {
      mockCreateSignedUrl.mockResolvedValue({
        data: null,
        error: { message: 'bucket not found' },
      });

      await expect(service.getShippingLabelSignedUrl('labels/test.pdf')).rejects.toThrow(
        'Label signing failed: bucket not found',
      );
    });

    it('throws "Label signing failed" when Supabase returns no data', async () => {
      mockCreateSignedUrl.mockResolvedValue({ data: null, error: null });

      await expect(service.getShippingLabelSignedUrl('labels/test.pdf')).rejects.toThrow(
        'Label signing failed',
      );
    });

    it('returns null instead of throwing when Supabase reports the object is already gone (statusCode 404)', async () => {
      mockCreateSignedUrl.mockResolvedValue({
        data: null,
        error: { message: 'Object not found', statusCode: '404' },
      });

      const result = await service.getShippingLabelSignedUrl('labels/already-deleted.pdf');

      expect(result).toBeNull();
    });

    it('returns null instead of throwing when Supabase reports the object is already gone (numeric status 404)', async () => {
      mockCreateSignedUrl.mockResolvedValue({
        data: null,
        error: { message: 'Object not found', status: 404 },
      });

      const result = await service.getShippingLabelSignedUrl('labels/already-deleted.pdf');

      expect(result).toBeNull();
    });
  });

  // ─── deleteShippingLabel ──────────────────────────────────────────────────────

  describe('deleteShippingLabel', () => {
    it('calls Supabase remove with the given storage path', async () => {
      mockRemove.mockResolvedValue({ error: null });

      await service.deleteShippingLabel('labels/inpost-456.pdf');

      expect(mockRemove).toHaveBeenCalledWith(['labels/inpost-456.pdf']);
    });

    it('resolves without error when Supabase deletes successfully', async () => {
      mockRemove.mockResolvedValue({ error: null });

      await expect(service.deleteShippingLabel('labels/any.pdf')).resolves.toBeUndefined();
    });

    it('throws "Label delete failed" when Supabase returns an error', async () => {
      mockRemove.mockResolvedValue({ error: { message: 'object not found' } });

      await expect(service.deleteShippingLabel('labels/missing.pdf')).rejects.toThrow(
        'Label delete failed: object not found',
      );
    });
  });
});
