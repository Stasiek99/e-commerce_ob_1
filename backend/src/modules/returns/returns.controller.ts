import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { User } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ReturnsService } from './returns.service';
import { CreateReturnRequestDto } from './dto/create-return.dto';

@Controller('returns')
@UseGuards(JwtAuthGuard)
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  create(@CurrentUser() user: User, @Body() dto: CreateReturnRequestDto) {
    return this.returns.create(dto, user.id);
  }
}
