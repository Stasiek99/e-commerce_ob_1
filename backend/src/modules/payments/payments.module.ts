import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { StripeClient } from './stripe.client';
import { EmailModule } from '../email/email.module';
import { InvoiceModule } from '../invoice/invoice.module';

@Module({
  imports: [EmailModule, InvoiceModule],
  providers: [PaymentsService, StripeClient],
  controllers: [PaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
