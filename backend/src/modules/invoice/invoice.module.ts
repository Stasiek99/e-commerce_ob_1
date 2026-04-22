import { Module } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [InvoiceService],
  exports: [InvoiceService],
})
export class InvoiceModule {}
