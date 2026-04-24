import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
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
import { InvoiceModule } from './modules/invoice/invoice.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        transport: process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
          : undefined,
        level: process.env.LOG_LEVEL ?? 'info',
        // Redact sensitive headers from request logs
        redact: ['req.headers.authorization', 'req.headers.cookie'],
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
    ThrottlerModule.forRoot([{
      ttl: 60000,  // 1 minute window
      limit: 60,   // 60 requests/min default
    }]),
    ScheduleModule.forRoot(),
    CorrelationModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    ProductsModule,
    CartModule,
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
