import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailService } from './email.service';
import { EmailQueueService } from './email-queue.service';
import { EmailQueueProcessor } from './email-queue.processor';
import { EmailWebhookController } from './email-webhook.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    BullModule.registerQueue({ name: 'email' }),
    BullModule.registerQueue({ name: 'email-dlq' }),
  ],
  controllers: [EmailWebhookController],
  providers: [EmailService, EmailQueueService, EmailQueueProcessor],
  exports: [EmailService, EmailQueueService],
})
export class EmailModule {}
