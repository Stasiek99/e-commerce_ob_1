import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EmailQueueProcessor } from '../email-queue.processor';
import { EmailService } from '../email.service';
import { StorageService } from '../../storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailJobData } from '../email-queue.types';

const makeJob = (payload: Extract<EmailJobData, { type: 'back_in_stock' }>['payload']): Job<EmailJobData> =>
  ({
    id: 'job-1',
    name: 'back_in_stock',
    data: { type: 'back_in_stock', payload },
  }) as unknown as Job<EmailJobData>;

const WISHLIST_ITEM_ID = 'wl-abc';

const backInStockPayload = {
  to: 'alice@example.com',
  firstName: 'Alice',
  productName: 'Rose Oud',
  variantLabel: '50ml',
  productUrl: 'http://localhost:4200/products/rose-oud',
  wishlistItemId: WISHLIST_ITEM_ID,
};

describe('EmailQueueProcessor — back_in_stock job', () => {
  let processor: EmailQueueProcessor;

  const mockEmailService = {
    sendBackInStock: jest.fn(),
  };

  const mockStorageService = {};

  const mockPrisma = {
    wishlistItem: {
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EmailQueueProcessor,
        { provide: EmailService, useValue: mockEmailService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken('email-dlq'), useValue: { add: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();

    processor = module.get(EmailQueueProcessor);
    jest.clearAllMocks();
  });

  describe('idempotency guard — flag-first pattern', () => {
    it('clears notifyOnRestock before sending so a BullMQ retry cannot send a duplicate', async () => {
      const callOrder: string[] = [];
      mockPrisma.wishlistItem.updateMany.mockImplementation(async () => {
        callOrder.push('updateFlag');
        return { count: 1 };
      });
      mockEmailService.sendBackInStock.mockImplementation(async () => {
        callOrder.push('sendBackInStock');
      });

      await processor.process(makeJob(backInStockPayload));

      expect(callOrder).toEqual(['updateFlag', 'sendBackInStock']);
    });

    it('uses updateMany with notifyOnRestock:true condition to make the check atomic', async () => {
      mockPrisma.wishlistItem.updateMany.mockResolvedValue({ count: 1 });
      mockEmailService.sendBackInStock.mockResolvedValue(undefined);

      await processor.process(makeJob(backInStockPayload));

      expect(mockPrisma.wishlistItem.updateMany).toHaveBeenCalledWith({
        where: { id: WISHLIST_ITEM_ID, notifyOnRestock: true },
        data: { notifyOnRestock: false },
      });
    });

    it('skips email send when count === 0 (flag already cleared — idempotency guard on retry)', async () => {
      mockPrisma.wishlistItem.updateMany.mockResolvedValue({ count: 0 });

      await processor.process(makeJob(backInStockPayload));

      expect(mockEmailService.sendBackInStock).not.toHaveBeenCalled();
    });

    it('resolves without throwing when skipping a duplicate (count === 0)', async () => {
      mockPrisma.wishlistItem.updateMany.mockResolvedValue({ count: 0 });

      await expect(processor.process(makeJob(backInStockPayload))).resolves.toBeUndefined();
    });
  });

  describe('successful delivery', () => {
    it('sends the email when count === 1 (flag was still true)', async () => {
      mockPrisma.wishlistItem.updateMany.mockResolvedValue({ count: 1 });
      mockEmailService.sendBackInStock.mockResolvedValue(undefined);

      await processor.process(makeJob(backInStockPayload));

      expect(mockEmailService.sendBackInStock).toHaveBeenCalledTimes(1);
    });

    it('strips wishlistItemId from the payload before calling emailService.sendBackInStock', async () => {
      mockPrisma.wishlistItem.updateMany.mockResolvedValue({ count: 1 });
      mockEmailService.sendBackInStock.mockResolvedValue(undefined);

      await processor.process(makeJob(backInStockPayload));

      const receivedPayload = mockEmailService.sendBackInStock.mock.calls[0][0];
      expect(receivedPayload).not.toHaveProperty('wishlistItemId');
      expect(receivedPayload).toMatchObject({
        to: 'alice@example.com',
        firstName: 'Alice',
        productName: 'Rose Oud',
        variantLabel: '50ml',
        productUrl: 'http://localhost:4200/products/rose-oud',
      });
    });
  });

  describe('delivery failure', () => {
    it('propagates the send error so BullMQ can apply its retry/backoff policy', async () => {
      mockPrisma.wishlistItem.updateMany.mockResolvedValue({ count: 1 });
      const sendError = new Error('network failure');
      mockEmailService.sendBackInStock.mockRejectedValue(sendError);

      await expect(processor.process(makeJob(backInStockPayload))).rejects.toBe(sendError);
    });

    it('has already set notifyOnRestock=false when send throws — retry will skip re-send', async () => {
      mockPrisma.wishlistItem.updateMany.mockResolvedValue({ count: 1 });
      mockEmailService.sendBackInStock.mockRejectedValue(new Error('Resend API timeout'));

      await expect(processor.process(makeJob(backInStockPayload))).rejects.toThrow('Resend API timeout');

      // The flag was already cleared BEFORE the failed send — the idempotency guard holds
      expect(mockPrisma.wishlistItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { notifyOnRestock: false } }),
      );
    });
  });
});
