import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ShippingService } from './shipping.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller('shipping')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Public()
  @Get('rates')
  getRates() {
    return this.shippingService.getShippingRates();
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
