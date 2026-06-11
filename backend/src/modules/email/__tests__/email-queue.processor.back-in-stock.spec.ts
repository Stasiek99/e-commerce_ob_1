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
      update: jest.fn(),
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

  describe('successful delivery', () => {
    it('resets notifyOnRestock to false for the specific wishlist item after email is sent', async () => {
      mockEmailService.sendBackInStock.mockResolvedValue(undefined);
      mockPrisma.wishlistItem.update.mockResolvedValue({ id: WISHLIST_ITEM_ID, notifyOnRestock: false });

      await processor.process(makeJob(backInStockPayload));

      expect(mockPrisma.wishlistItem.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.wishlistItem.update).toHaveBeenCalledWith({
        where: { id: WISHLIST_ITEM_ID },
        data: { notifyOnRestock: false },
      });
    });

    it('resets the flag AFTER email send, not before — so a send failure still leaves the flag true', async () => {
      const callOrder: string[] = [];
      mockEmailService.sendBackInStock.mockImplementation(async () => {
        callOrder.push('sendBackInStock');
      });
      mockPrisma.wishlistItem.update.mockImplementation(async () => {
        callOrder.push('updateFlag');
        return { id: WISHLIST_ITEM_ID, notifyOnRestock: false };
      });

      await processor.process(makeJob(backInStockPayload));

      expect(callOrder).toEqual(['sendBackInStock', 'updateFlag']);
    });

    it('strips wishlistItemId from the payload before calling emailService.sendBackInStock', async () => {
      mockEmailService.sendBackInStock.mockResolvedValue(undefined);
      mockPrisma.wishlistItem.update.mockResolvedValue({});

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
    it('does NOT reset notifyOnRestock when email send throws — flag stays true for BullMQ retry', async () => {
      mockEmailService.sendBackInStock.mockRejectedValue(new Error('Resend API timeout'));

      await expect(processor.process(makeJob(backInStockPayload))).rejects.toThrow('Resend API timeout');

      expect(mockPrisma.wishlistItem.update).not.toHaveBeenCalled();
    });

    it('propagates the send error so BullMQ can apply its retry/backoff policy', async () => {
      const sendError = new Error('network failure');
      mockEmailService.sendBackInStock.mockRejectedValue(sendError);

      await expect(processor.process(makeJob(backInStockPayload))).rejects.toBe(sendError);
    });
  });
});
