import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as bcrypt from 'bcrypt';
import * as session from 'express-session';
import connectPgSimple = require('connect-pg-simple');
import { PrismaService } from '../prisma/prisma.service';

const logger = new Logger('AdminJS');

export async function setupAdmin(
  app: NestExpressApplication,
  prisma: PrismaService,
): Promise<void> {
  const adminEmail = process.env.ADMIN_DEFAULT_EMAIL;
  const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD;
  const sessionSecret =
    process.env.ADMIN_SESSION_SECRET ?? adminPassword ?? 'dev-admin-secret';

  if (!adminEmail || !adminPassword) {
    logger.warn('ADMIN_DEFAULT_EMAIL / ADMIN_DEFAULT_PASSWORD not set — /admin is UNPROTECTED');
  }

  // @adminjs/* packages are ESM-only (no "require" export condition).
  // TypeScript compiles `await import()` to `require()` in commonjs mode, which
  // fails for ESM-only packages. Using new Function bypasses the transformation
  // so Node.js emits a native import() call that respects the "import" condition.
  const esmImport = new Function('m', 'return import(m)') as <T>(m: string) => Promise<T>;
  const { default: AdminJS } = await esmImport<typeof import('adminjs')>('adminjs');
  const { Database, Resource, getModelByName } = await esmImport<typeof import('@adminjs/prisma')>('@adminjs/prisma');
  const { default: AdminJSExpress } = await esmImport<typeof import('@adminjs/express')>('@adminjs/express');

  AdminJS.registerAdapter({ Database, Resource });

  const readOnly = {
    actions: {
      new: { isAccessible: false },
      edit: { isAccessible: false },
      delete: { isAccessible: false },
    },
  };

  const admin = new AdminJS({
    rootPath: '/admin',
    resources: [
      // ── Catalog ──────────────────────────────────────────────────────
      {
        resource: { model: getModelByName('Category'), client: prisma },
        options: {
          navigation: { name: 'Katalog' },
        },
      },
      {
        resource: { model: getModelByName('Product'), client: prisma },
        options: {
          navigation: { name: 'Katalog' },
          properties: {
            notes: { isVisible: { list: false, show: true, edit: true, filter: false } },
            description: { type: 'textarea' },
            shortDescription: { type: 'textarea' },
          },
        },
      },
      {
        resource: { model: getModelByName('ProductVariant'), client: prisma },
        options: {
          navigation: { name: 'Katalog' },
        },
      },
      {
        resource: { model: getModelByName('ProductImage'), client: prisma },
        options: {
          navigation: { name: 'Katalog' },
          ...readOnly,
        },
      },
      // ── Orders ───────────────────────────────────────────────────────
      {
        resource: { model: getModelByName('Order'), client: prisma },
        options: {
          navigation: { name: 'Zamówienia' },
          actions: {
            new: { isAccessible: false },
            delete: { isAccessible: false },
          },
        },
      },
      {
        resource: { model: getModelByName('OrderItem'), client: prisma },
        options: {
          navigation: { name: 'Zamówienia' },
          ...readOnly,
        },
      },
      {
        resource: { model: getModelByName('Address'), client: prisma },
        options: {
          navigation: { name: 'Zamówienia' },
          ...readOnly,
        },
      },
      {
        resource: { model: getModelByName('Payment'), client: prisma },
        options: {
          navigation: { name: 'Zamówienia' },
          ...readOnly,
        },
      },
      {
        resource: { model: getModelByName('Shipment'), client: prisma },
        options: {
          navigation: { name: 'Zamówienia' },
          actions: {
            new: { isAccessible: false },
            delete: { isAccessible: false },
          },
        },
      },
      // ── Users ────────────────────────────────────────────────────────
      {
        resource: { model: getModelByName('User'), client: prisma },
        options: {
          navigation: { name: 'Użytkownicy' },
          properties: {
            passwordHash: { isVisible: false },
          },
          actions: {
            new: { isAccessible: false },
            edit: { isAccessible: false },
            delete: { isAccessible: false },
          },
        },
      },
    ],
  });

  const PgSession = connectPgSimple(session);

  // DIRECT_URL (port 5432) — pgbouncer transaction mode doesn't support
  // advisory locks used internally by connect-pg-simple.
  const store = new PgSession({
    conString: process.env.DIRECT_URL,
    tableName: 'admin_sessions',
    createTableIfMissing: true,
  });

  const router =
    adminEmail && adminPassword
      ? AdminJSExpress.buildAuthenticatedRouter(
          admin,
          {
            authenticate: async (email: string, password: string) => {
              if (email !== adminEmail) return null;
              const valid = await bcrypt.compare(password, adminPassword);
              return valid ? { email } : null;
            },
            cookieName: 'adminjs',
            cookiePassword: sessionSecret,
          },
          null,
          {
            store,
            resave: false,
            saveUninitialized: false,
            secret: sessionSecret,
          },
        )
      : AdminJSExpress.buildRouter(admin);

  app.use(admin.options.rootPath, router);

  logger.log(`AdminJS panel available at ${admin.options.rootPath}`);
}
