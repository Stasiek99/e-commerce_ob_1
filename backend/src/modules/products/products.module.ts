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
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const client = new IORedis(config.get<string>('REDIS_URL', 'redis://localhost:6379'), {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          retryStrategy: () => null,
        });
        client.on('error', () => {});
        return client;
      },
    },
  ],
  controllers: [ProductsController],
  exports: [ProductsService],
})
export class ProductsModule {}
