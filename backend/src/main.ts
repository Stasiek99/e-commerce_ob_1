// Sentry instrumentation must load before any other module.
// eslint-disable-next-line import/order
import './instrument';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { setupAdmin } from './modules/admin/admin.setup';
import { PrismaService } from './modules/prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Required for Stripe webhook signature verification — Nest exposes
    // the untouched buffer as `req.rawBody` on routes that opt in.
    rawBody: true,
  });

  // Skip helmet on /admin — AdminJS uses inline scripts/styles that strict CSP blocks.
  app.use((req: any, res: any, next: any) => {
    if (req.path.startsWith('/admin')) return next();
    helmet()(req, res, next);
  });
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:4200',
    credentials: true,
  });

  const prisma = app.get(PrismaService);
  await setupAdmin(app, prisma);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Backend running on http://localhost:${port}`);
}

bootstrap();
