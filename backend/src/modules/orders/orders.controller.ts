import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { UserOrdersQueryDto } from './dto/user-orders-query.dto';
import { CancelItemsDto } from './dto/cancel-items.dto';
import { SessionId } from '../../common/decorators/session-id.decorator';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @UseGuards(OptionalJwtGuard)
  createOrder(
    @CurrentUser() user: User | undefined,
    @SessionId() sessionId: string | undefined,
    @Body() dto: CreateOrderDto,
  ) {
    const userEmail = user?.email ?? dto.guestEmail;
    return this.ordersService.createFromCart(user?.id, sessionId, userEmail!, dto);
  }

  @Get('track')
  trackOrder(
    @Query('email') email: string,
    @Query('orderNumber') orderNumber: string,
  ) {
    return this.ordersService.trackByEmailAndNumber(email, orderNumber);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  getMyOrders(@CurrentUser() user: User, @Query() query: UserOrdersQueryDto) {
    return this.ordersService.findAllForUser(user.id, query);
  }

  @Get(':id/events')
  @UseGuards(JwtAuthGuard)
  getOrderEvents(@CurrentUser() user: User, @Param('id') id: string) {
    return this.ordersService.findEventsForUser(id, user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getMyOrder(@CurrentUser() user: User, @Param('id') id: string) {
    return this.ordersService.findOneForUser(id, user.id);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  cancelOrder(@CurrentUser() user: User, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.ordersService.cancelByUser(id, user.id, body.reason);
  }

  @Post(':id/cancel-items')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  cancelItems(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: CancelItemsDto) {
    return this.ordersService.cancelItemsByUser(id, user.id, dto);
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

  @Post('admin/:id/invoice')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  generateInvoice(@Param('id') id: string) {
    return this.ordersService.generateInvoice(id);
  }
}
