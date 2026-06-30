// Sentry instrumentation must load before any other module.
// eslint-disable-next-line import/order
import './instrument';

import * as crypto from 'crypto';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import * as cookieParser from 'cookie-parser';
import * as session from 'express-session';
import connectPgSimple = require('connect-pg-simple');
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

  // Passport's built-in OAuth `state` CSRF check uses `req.session` to store
  // and verify the nonce between the initial redirect and the callback. Scoped
  // to the two OAuth routes only — a global session is unnecessary and heavy.
  // Uses connect-pg-simple over DIRECT_URL (port 5432, bypasses pgbouncer) so
  // the state survives across Railway replicas. Falls back to MemoryStore in
  // dev when DIRECT_URL is absent (single-instance, short-lived flow).
  const oauthStore = process.env.DIRECT_URL
    ? new (connectPgSimple(session))({
        conString: process.env.DIRECT_URL,
        tableName: 'oauth_sessions',
        createTableIfMissing: true,
        pool: { max: 2 } as any,
      })
    : undefined;
  const oauthSession = session({
    store: oauthStore,
    name: 'oauth_state',
    secret: process.env.ADMIN_SESSION_SECRET ?? crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 5 * 60 * 1000, // 5 min is sufficient for the OAuth round-trip
    },
  });
  app.use('/auth/google', oauthSession);
  app.use('/auth/google/callback', oauthSession);

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

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  const server = app.getHttpServer();
  // Idle keep-alive connections hold the process open past Railway's SIGKILL.
  // 5 s < SIGKILL window (≈10 s), so they drain before the OS force-kills.
  server.keepAliveTimeout = 5_000;

  // Graceful shutdown, driven manually instead of Nest's built-in shutdown-hook
  // signal listener. That built-in path runs callDestroyHook() — which disconnects
  // Prisma process-wide via PrismaService.onModuleDestroy() — BEFORE dispose()
  // closes the HTTP server. That order means any request still in flight when
  // the signal arrives would have its next Prisma call fail, instead of finishing
  // normally. Closing the HTTP server first (and only tearing providers down once
  // it has drained) fixes the ordering.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.get(Logger).log(`${signal} received, draining HTTP server…`, 'Bootstrap');

    server.closeIdleConnections();
    const drained = new Promise<void>((resolve) => server.close(() => resolve()));
    // Bounded by the same budget as TimeoutInterceptor above, so we never wait
    // past Railway's SIGTERM→SIGKILL window (≈10 s) on a stuck connection.
    const timedOut = new Promise<void>((resolve) => setTimeout(resolve, 8_000));

    Promise.race([drained, timedOut])
      .then(() => app.close())
      .then(() => process.exit(0))
      .catch((err) => {
        app.get(Logger).error('Error during shutdown', (err as Error)?.stack, 'Bootstrap');
        process.exit(1);
      });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  app.get(Logger).log(`Backend running on http://localhost:${port}`, 'Bootstrap');
}

bootstrap();
