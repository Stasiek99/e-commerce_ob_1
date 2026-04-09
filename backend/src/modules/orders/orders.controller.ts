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
import { Role, User } from '@prisma/client';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { AdminOrdersQueryDto } from './dto/admin-orders-query.dto';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  createOrder(
    @CurrentUser() user: User | undefined,
    @Headers('x-session-id') sessionId: string,
    @Body() dto: CreateOrderDto,
  ) {
    const userEmail = user?.email ?? dto.guestEmail;
    return this.ordersService.createFromCart(user?.id, sessionId, userEmail!, dto);
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
  getAllOrders(@Query() query: AdminOrdersQueryDto) {
    return this.ordersService.findAllAdmin(query);
  }

  @Patch('admin/:id/status')
  @Roles(Role.ADMIN)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, dto.status);
  }
}
