// Sentry instrumentation must load before any other module.
// eslint-disable-next-line import/order
import './instrument';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { setupAdmin } from './modules/admin/admin.setup';
import { PrismaService } from './modules/prisma/prisma.service';
import { InvoiceService } from './modules/invoice/invoice.service';
import { ShippingService } from './modules/shipping/shipping.service';
import { OrdersService } from './modules/orders/orders.service';
import { PaymentsService } from './modules/payments/payments.service';
import { ReturnsService } from './modules/returns/returns.service';
import { AuthService } from './modules/auth/auth.service';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { PrismaPoolExceptionFilter } from './common/filters/prisma-pool-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Disable the auto-registered body parser so we can configure the limit
    // ourselves below. rawBody capture is re-enabled via useBodyParser(..., true).
    rawBody: true,
    bodyParser: false,
  });

  // Trust Railway's single load-balancer hop so req.ips is populated from
  // X-Forwarded-For and the throttler getTracker reads the real client IP
  // instead of the shared load-balancer IP.
  app.set('trust proxy', 1);

  // Register body parsers manually with an explicit limit.
  // The verify callback re-implements the rawBody capture that NestJS's auto
  // parser provides, so req.rawBody remains available for Stripe HMAC verification.
  const captureRawBody = (req: any, _res: any, buf: Buffer) => {
    if (Buffer.isBuffer(buf)) req.rawBody = buf;
    return true;
  };
  app.use(json({ limit: '5mb', verify: captureRawBody }));
  app.use(urlencoded({ extended: true, limit: '5mb' }));

  // AdminJS uses inline scripts/styles that strict CSP blocks, so disable only CSP
  // for /admin. All other Helmet headers (X-Frame-Options, X-Content-Type-Options,
  // HSTS, Referrer-Policy) remain active on every route including /admin.
  const helmetDefault = helmet();
  const helmetAdminJs = helmet({ contentSecurityPolicy: false });
  app.use((req: any, res: any, next: any) => {
    if (req.path.startsWith('/admin')) return helmetAdminJs(req, res, next);
    helmetDefault(req, res, next);
  });
  app.use(cookieParser());

  app.useGlobalFilters(new PrismaPoolExceptionFilter());
  // 8 s < Railway's SIGTERM→SIGKILL window (≈10 s), so in-flight requests are
  // always aborted by the interceptor before the OS tears the process down.
  app.useGlobalInterceptors(new TimeoutInterceptor(8_000));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const allowedOrigins = (process.env.FRONTEND_URL ?? 'http://localhost:4200')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (
    process.env.NODE_ENV === 'production' &&
    allowedOrigins.some((o) => o.includes('localhost'))
  ) {
    throw new Error(
      'CORS misconfiguration: localhost origin detected in production — set FRONTEND_URL to the deployed frontend URL',
    );
  }

  app.enableCors({
    origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
    credentials: true,
  });

  const prisma = app.get(PrismaService);
  const invoiceService = app.get(InvoiceService);
  const shippingService = app.get(ShippingService);
  const ordersService = app.get(OrdersService);
  const paymentsService = app.get(PaymentsService);
  const returnsService = app.get(ReturnsService);
  const authService = app.get(AuthService);
  await setupAdmin(app, prisma, invoiceService, shippingService, ordersService, paymentsService, returnsService, authService);

  app.useLogger(app.get(Logger));

  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  const server = app.getHttpServer();
  // Idle keep-alive connections hold the process open past Railway's SIGKILL.
  // 5 s < SIGKILL window (≈10 s), so they drain before the OS force-kills.
  server.keepAliveTimeout = 5_000;
  // On SIGTERM, immediately drop idle connections so the process can exit cleanly
  // within the SIGKILL window. Active in-flight requests finish normally (bounded
  // by the 8 s TimeoutInterceptor above).
  process.once('SIGTERM', () => server.closeIdleConnections());

  app.get(Logger).log(`Backend running on http://localhost:${port}`, 'Bootstrap');
}

bootstrap();
