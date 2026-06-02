import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { PrismaClientInitializationError } from '@prisma/client/runtime/library';

@Catch(PrismaClientInitializationError)
export class PrismaPoolExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaPoolExceptionFilter.name);

  catch(exception: PrismaClientInitializationError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (exception.message.includes('pool timeout')) {
      this.logger.warn('Prisma pool timeout on cold start — returning 503');
      res.status(503).json({ error: 'Service temporarily unavailable' });
    } else {
      this.logger.error('PrismaClientInitializationError', exception.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
