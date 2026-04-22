import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailWebhookController } from './email-webhook.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EmailWebhookController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
