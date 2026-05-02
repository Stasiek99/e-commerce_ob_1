import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ReturnsService } from './returns.service';
import { CreateReturnRequestDto } from './dto/create-return.dto';

@Controller('returns')
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  create(@Body() dto: CreateReturnRequestDto) {
    return this.returns.create(dto);
  }
}
