import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CarrierCode, Role } from '@prisma/client';
import { ShippingService } from './shipping.service';
import { ShippingRatesService } from './shipping-rates.service';
import { UpdateShippingRateDto } from './dto/update-shipping-rate.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller('shipping')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShippingController {
  constructor(
    private readonly shippingService: ShippingService,
    private readonly shippingRatesService: ShippingRatesService,
  ) {}

  @Public()
  @Get('rates')
  getRates() {
    return this.shippingService.getShippingRates();
  }

  @Get('admin/rates')
  @Roles(Role.ADMIN)
  adminListRates() {
    return this.shippingRatesService.findAll();
  }

  @Patch('admin/rates/:carrier')
  @Roles(Role.ADMIN)
  updateRate(
    @Param('carrier') carrier: CarrierCode,
    @Body() dto: UpdateShippingRateDto,
  ) {
    return this.shippingRatesService.updateRate(carrier, dto.priceInCents, dto.isActive);
  }

  @Post(':orderId/label')
  @Roles(Role.ADMIN)
  generateLabel(@Param('orderId') orderId: string) {
    return this.shippingService.generateLabel(orderId);
  }

  @Get(':orderId/label')
  @Roles(Role.ADMIN)
  getLabel(@Param('orderId') orderId: string) {
    return this.shippingService.getLabel(orderId);
  }
}
