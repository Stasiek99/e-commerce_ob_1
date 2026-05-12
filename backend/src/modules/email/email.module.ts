import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailQueueService } from './email-queue.service';
import { EmailWebhookController } from './email-webhook.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EmailWebhookController],
  providers: [EmailService, EmailQueueService],
  exports: [EmailService, EmailQueueService],
})
export class EmailModule {}
