import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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
import { TurnstileGuard } from '../../common/guards/turnstile.guard';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @UseGuards(OptionalJwtGuard, TurnstileGuard)
  createOrder(
    @CurrentUser() user: User | undefined,
    @SessionId() sessionId: string | undefined,
    @Body() dto: CreateOrderDto,
  ) {
    const userEmail = user?.email ?? dto.guestEmail;
    if (!userEmail) {
      throw new BadRequestException('Guest email is required for unauthenticated orders');
    }
    return this.ordersService.createFromCart(user?.id, sessionId, userEmail, dto);
  }

  @Get('track')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
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

  @Get(':id/invoice')
  @UseGuards(JwtAuthGuard)
  getInvoice(@CurrentUser() user: User, @Param('id') id: string) {
    return this.ordersService.generateInvoiceForUser(id, user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getMyOrder(@CurrentUser() user: User, @Param('id') id: string) {
    return this.ordersService.findOneForUser(id, user.id);
  }

  @Post(':id/retry-payment')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  retryPayment(@CurrentUser() user: User, @Param('id') id: string) {
    return this.ordersService.retryPayment(id, user.id);
  }

  @Post(':id/cancel')
  @UseGuards(OptionalJwtGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  cancelOrder(
    @CurrentUser() user: User | undefined,
    @Param('id') id: string,
    @Query('token') token: string | undefined,
    @Body() body: { reason?: string },
  ) {
    if (user) return this.ordersService.cancelByUser(id, user.id, body.reason);
    if (token) return this.ordersService.cancelByToken(id, token, body.reason);
    throw new UnauthorizedException('Authentication or cancel token required');
  }

  @Post(':id/cancel-items')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  cancelItems(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: CancelItemsDto) {
    return this.ordersService.cancelItemsByUser(id, user.id, dto);
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  @Get('admin/unread-count')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  getUnreadCount() {
    return this.ordersService.getUnreadCount();
  }

  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  getAllOrders(@Query() query: AdminOrdersQueryDto) {
    return this.ordersService.findAllAdmin(query);
  }

  @Get('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  getOneAdmin(@Param('id') id: string) {
    return this.ordersService.findOneAdmin(id);
  }

  @Get('admin/:id/events')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  getOrderEventsAdmin(@Param('id') id: string) {
    return this.ordersService.findEventsAdmin(id);
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

  @Post('admin/:id/fraud-review/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  approveFraudReview(@Param('id') id: string) {
    return this.ordersService.approveFraudReview(id);
  }

  @Post('admin/:id/fraud-review/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  rejectFraudReview(@Param('id') id: string) {
    return this.ordersService.rejectFraudReview(id);
  }

  @Post('admin/:id/invoice')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  generateInvoice(@Param('id') id: string) {
    return this.ordersService.generateInvoice(id);
  }
}
