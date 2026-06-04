import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = config.get<string>('NODE_ENV') === 'production';
        const redis = new IORedis(config.get<string>('REDIS_URL', 'redis://localhost:6379'), {
          maxRetriesPerRequest: null,
          retryStrategy: isProd ? (times) => Math.min(times * 500, 5_000) : () => 3000,
        });
        redis.on('error', (err: Error) => console.warn(`[Redis] ${err.message}`));
        return redis;
      },
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}
