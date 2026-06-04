import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as supabaseJs from '@supabase/supabase-js';
import { StorageService } from '../storage.service';

describe('StorageService', () => {
  let service: StorageService;
  let mockUpload: jest.Mock;
  let mockGetPublicUrl: jest.Mock;

  beforeEach(async () => {
    mockUpload = jest.fn();
    mockGetPublicUrl = jest.fn().mockReturnValue({
      data: { publicUrl: 'https://cdn.example.com/labels/test.pdf' },
    });

    jest.spyOn(supabaseJs, 'createClient').mockReturnValue({
      storage: {
        from: jest.fn().mockReturnValue({
          upload: mockUpload,
          getPublicUrl: mockGetPublicUrl,
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

  describe('uploadShippingLabel — retry invariant', () => {
    const LABEL_URL = 'https://cdn.example.com/labels/test.pdf';

    it('returns the public URL when the upload succeeds on the first attempt', async () => {
      mockUpload.mockResolvedValue({ error: null });

      const result = await service.uploadShippingLabel(Buffer.from('pdf'), 'order-1.pdf');

      expect(mockUpload).toHaveBeenCalledTimes(1);
      expect(result).toBe(LABEL_URL);
    });

    it('retries once and returns the public URL when the second attempt succeeds', async () => {
      mockUpload
        .mockResolvedValueOnce({ error: { message: 'network blip' } })
        .mockResolvedValueOnce({ error: null });

      const promise = service.uploadShippingLabel(Buffer.from('pdf'), 'order-2.pdf');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(mockUpload).toHaveBeenCalledTimes(2);
      expect(result).toBe(LABEL_URL);
    });

    it('retries twice and returns the public URL when the third attempt succeeds', async () => {
      mockUpload
        .mockResolvedValueOnce({ error: { message: 'network blip' } })
        .mockResolvedValueOnce({ error: { message: 'server error' } })
        .mockResolvedValueOnce({ error: null });

      const promise = service.uploadShippingLabel(Buffer.from('pdf'), 'order-3.pdf');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(mockUpload).toHaveBeenCalledTimes(3);
      expect(result).toBe(LABEL_URL);
    });

    it('throws after three consecutive failures and makes no fourth attempt', async () => {
      mockUpload.mockResolvedValue({ error: { message: 'storage unavailable' } });

      const promise = service.uploadShippingLabel(Buffer.from('pdf'), 'order-4.pdf');
      // Attach the rejection handler before advancing timers so Node does not flag
      // the rejection as unhandled while timers are running.
      const assertion = expect(promise).rejects.toThrow('Label upload failed: storage unavailable');
      await jest.runAllTimersAsync();
      await assertion;

      expect(mockUpload).toHaveBeenCalledTimes(3);
    });
  });
});
