import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrderStatus, Role, User } from '@prisma/client';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  createOrder(
    @CurrentUser() user: User | undefined,
    @Headers('x-session-id') sessionId: string,
    @Body() body: any,
  ) {
    const userEmail = user?.email ?? body.guestEmail;
    return this.ordersService.createFromCart(user?.id, sessionId, userEmail, body);
  }

  @Get()
  getMyOrders(@CurrentUser() user: User) {
    return this.ordersService.findAllForUser(user.id);
  }

  @Get(':id')
  getMyOrder(@CurrentUser() user: User, @Param('id') id: string) {
    return this.ordersService.findOneForUser(id, user.id);
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  @Get('admin/all')
  @Roles(Role.ADMIN)
  getAllOrders(@Query() query: any) {
    return this.ordersService.findAllAdmin(query);
  }

  @Patch('admin/:id/status')
  @Roles(Role.ADMIN)
  updateStatus(@Param('id') id: string, @Body('status') status: OrderStatus) {
    return this.ordersService.updateStatus(id, status);
  }
}
