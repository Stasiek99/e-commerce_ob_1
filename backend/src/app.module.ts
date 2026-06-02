import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import IORedis from 'ioredis';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { LoggerModule } from 'nestjs-pino';
import { HealthController } from './health.controller';
import { LocationController } from './modules/location/location.controller';
import { envValidationSchema } from './config.validation';
import { getCorrelationId } from './modules/correlation/correlation-id.storage';
import { CorrelationModule } from './modules/correlation/correlation.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ProductsModule } from './modules/products/products.module';
import { CartModule } from './modules/cart/cart.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ShippingModule } from './modules/shipping/shipping.module';
import { EmailModule } from './modules/email/email.module';
import { StorageModule } from './modules/storage/storage.module';
import { AdminModule } from './modules/admin/admin.module';
import { CouponModule } from './modules/coupons/coupon.module';
import { WishlistModule } from './modules/wishlist/wishlist.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { InvoiceModule } from './modules/invoice/invoice.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { RedisModule } from './modules/redis/redis.module';
import { PINO_REDACT_PATHS } from './logger-redact-paths';

export { PINO_REDACT_PATHS };

@Module({
  imports: [
    SentryModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        transport: process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
          : undefined,
        level: process.env.LOG_LEVEL ?? 'info',
        redact: [...PINO_REDACT_PATHS],
        mixin: () => {
          const correlationId = getCorrelationId();
          return correlationId ? { correlationId } : {};
        },
        customProps: () => ({ environment: process.env.NODE_ENV ?? 'development' }),
      },
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: true },
    }),
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [ConfigService, 'REDIS_CLIENT'],
      useFactory: (config: ConfigService, redis: IORedis) => {
        const isProd = config.get<string>('NODE_ENV') === 'production';
        return {
          throttlers: [
            { name: 'burst',     ttl: 1_000,  limit: 5  },  // 5 req/s per IP
            { name: 'sustained', ttl: 60_000, limit: 60 },  // 60 req/min per IP
          ],
          // Reuse the shared REDIS_CLIENT (retryStrategy + error handler already
          // wired). Avoids a second disconnected IORedis connection whose silent
          // failure would degrade per-replica in-memory throttling for all replicas.
          ...(isProd && {
            storage: new ThrottlerStorageRedisService(redis),
          }),
          // Honour X-Forwarded-For behind Railway's proxy (requires trust proxy=1 in main.ts)
          getTracker: (req: Record<string, unknown>) =>
            String((req['ips'] as string[] | undefined)?.[0] ?? req['ip'] ?? ''),
        };
      },
    }),
    ScheduleModule.forRoot(),
    RedisModule,
    BullModule.forRootAsync({
      imports: [RedisModule],
      inject: ['REDIS_CLIENT'],
      useFactory: (redis: IORedis) => ({ connection: redis }),
    }),
    BullModule.registerQueue({ name: 'email' }),
    CorrelationModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    ProductsModule,
    CartModule,
    CouponModule,
    WishlistModule,
    ReviewsModule,
    ReturnsModule,
    OrdersModule,
    PaymentsModule,
    ShippingModule,
    EmailModule,
    StorageModule,
    InvoiceModule,
    MonitoringModule,
    // AdminModule must be last — depends on PrismaModule being initialized
    AdminModule,
  ],
  controllers: [HealthController, LocationController],
  providers: [
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
