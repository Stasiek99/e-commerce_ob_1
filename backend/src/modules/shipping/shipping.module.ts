import { Module } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { ShippingRatesService } from './shipping-rates.service';
import { ShippingController } from './shipping.controller';
import { InpostClient } from './carriers/inpost.client';
import { DhlClient } from './carriers/dhl.client';
import { GlsClient } from './carriers/gls.client';
import { DpdClient } from './carriers/dpd.client';
import { EmailModule } from '../email/email.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [EmailModule, StorageModule],
  providers: [ShippingService, ShippingRatesService, InpostClient, DhlClient, GlsClient, DpdClient],
  controllers: [ShippingController],
  exports: [ShippingService, ShippingRatesService],
})
export class ShippingModule {}
