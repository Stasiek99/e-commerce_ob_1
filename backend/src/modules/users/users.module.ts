import { forwardRef, Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';
import { StripeClient } from '../payments/stripe.client';

@Module({
  imports: [forwardRef(() => AuthModule)],
  providers: [UsersService, StripeClient],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
