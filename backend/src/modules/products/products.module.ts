import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { StorageModule } from '../storage/storage.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [StorageModule, EmailModule],
  providers: [
    ProductsService,
    {
      provide: 'STOCK_SSE_REDIS_SUBSCRIBER',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const client = new IORedis(config.get<string>('REDIS_URL', 'redis://localhost:6379'), {
          maxRetriesPerRequest: null,
          retryStrategy: (times) => Math.min(times * 500, 5_000),
        });
        client.on('error', (err: Error) => console.warn(`[Redis SSE] ${err.message}`));
        return client;
      },
    },
  ],
  controllers: [ProductsController],
  exports: [ProductsService],
})
export class ProductsModule {}
