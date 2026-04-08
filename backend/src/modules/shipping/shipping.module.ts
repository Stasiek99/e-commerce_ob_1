import { Module } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { ShippingController } from './shipping.controller';
import { InpostClient } from './carriers/inpost.client';
import { DhlClient } from './carriers/dhl.client';
import { GlsClient } from './carriers/gls.client';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  providers: [ShippingService, InpostClient, DhlClient, GlsClient],
  controllers: [ShippingController],
  exports: [ShippingService],
})
export class ShippingModule {}
