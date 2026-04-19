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
import { OptionalJwtGuard } from '../auth/guards/optional-jwt.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { AdminOrdersQueryDto } from './dto/admin-orders-query.dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @UseGuards(OptionalJwtGuard)
  createOrder(
    @CurrentUser() user: User | undefined,
    @Headers('x-session-id') sessionId: string,
    @Body() dto: CreateOrderDto,
  ) {
    const userEmail = user?.email ?? dto.guestEmail;
    return this.ordersService.createFromCart(user?.id, sessionId, userEmail!, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  getMyOrders(@CurrentUser() user: User) {
    return this.ordersService.findAllForUser(user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getMyOrder(@CurrentUser() user: User, @Param('id') id: string) {
    return this.ordersService.findOneForUser(id, user.id);
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  getAllOrders(@Query() query: AdminOrdersQueryDto) {
    return this.ordersService.findAllAdmin(query);
  }

  @Patch('admin/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, dto.status);
  }
}
