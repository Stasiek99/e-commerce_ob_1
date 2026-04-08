import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { Przelewy24Client } from './przelewy24.client';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  providers: [PaymentsService, Przelewy24Client],
  controllers: [PaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
