import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { StripeClient } from './stripe.client';
import { OutboxProcessorService } from './outbox-processor.service';
import { EmailModule } from '../email/email.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ConfigModule, EmailModule, InvoiceModule, PrismaModule],
  providers: [PaymentsService, StripeClient, OutboxProcessorService],
  controllers: [PaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
