import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role, User } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ReturnsService } from './returns.service';
import { CreateReturnRequestDto } from './dto/create-return.dto';
import { IsString, MinLength } from 'class-validator';

class RecordTrackingDto {
  @IsString()
  @MinLength(3)
  trackingNumber!: string;
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

  @Patch(':id/tracking')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  recordTracking(@Param('id') id: string, @Body() dto: RecordTrackingDto) {
    return this.returns.recordReturnTracking(id, dto.trackingNumber);
  }
}
