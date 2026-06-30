import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role, User } from '@prisma/client';
import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ReturnsService } from './returns.service';
import { CreateReturnRequestDto } from './dto/create-return.dto';

class RecordTrackingDto {
  @IsString()
  @MinLength(3)
  trackingNumber!: string;
}

class SetReplacementDeliveredDto {
  @IsDateString()
  deliveredAt!: string;
}

class AdminNoteDto {
  @IsOptional()
  @IsString()
  adminNote?: string;
}

@Controller('returns')
@UseGuards(JwtAuthGuard)
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  create(@CurrentUser() user: User, @Body() dto: CreateReturnRequestDto) {
    return this.returns.create(dto, user.id);
  }

  @Patch(':id/in-review')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  setInReview(@Param('id') id: string, @Body() dto: AdminNoteDto) {
    return this.returns.setInReview(id, dto.adminNote);
  }

  @Patch(':id/tracking')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  recordTracking(@Param('id') id: string, @Body() dto: RecordTrackingDto) {
    return this.returns.recordReturnTracking(id, dto.trackingNumber);
  }

  @Patch(':id/replacement-delivered')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  setReplacementDelivered(@Param('id') id: string, @Body() dto: SetReplacementDeliveredDto) {
    return this.returns.setReplacementDeliveredAt(id, new Date(dto.deliveredAt));
  }
}
