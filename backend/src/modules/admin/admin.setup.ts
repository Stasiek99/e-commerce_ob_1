import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as bcrypt from 'bcrypt';
import * as session from 'express-session';
import connectPgSimple = require('connect-pg-simple');
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceService } from '../invoice/invoice.service';
import { ShippingService } from '../shipping/shipping.service';

const logger = new Logger('AdminJS');

async function updateReviewStats(prisma: PrismaService, productId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE products SET
      review_count = (
        SELECT COUNT(*) FROM reviews
        WHERE product_id = ${productId}::uuid AND status = 'APPROVED'
      ),
      avg_rating = (
        SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews
        WHERE product_id = ${productId}::uuid AND status = 'APPROVED'
      )
    WHERE id = ${productId}::uuid
  `;
}

export async function setupAdmin(
  app: NestExpressApplication,
  prisma: PrismaService,
  invoiceService: InvoiceService,
  shippingService: ShippingService,
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
          sort: { sortBy: 'stock', direction: 'asc' },
          listProperties: ['sku', 'label', 'stock', 'reorderThreshold', 'isActive', 'productId'],
          filterProperties: ['isActive', 'productId'],
          properties: {
            stock: {
              isVisible: { list: true, show: true, edit: true, filter: false },
            },
            reorderThreshold: {
              isVisible: { list: true, show: true, edit: true, filter: false },
              description: 'Wyślij alert gdy stan ≤ tej wartości',
            },
          },
          actions: {
            list: {
              after: async (response: any) => {
                // noinspection SqlNoDataSourceInspection
                const result = await prisma.$queryRaw<[{ count: number }]>`
                  SELECT COUNT(*)::int AS count
                  FROM product_variants
                  WHERE "isActive" = true AND stock <= "reorderThreshold"
                `;
                const count = Number(result[0]?.count ?? 0);
                if (count > 0) {
                  response.notice = {
                    message: `Niski stan: ${count} ${count === 1 ? 'wariant wymaga' : 'warianty wymagają'} uzupełnienia`,
                    type: 'error',
                  };
                }
                return response;
              },
            },
          },
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
          properties: {
            invoiceUrl: {
              isVisible: { list: false, show: true, edit: false, filter: false },
            },
          },
          actions: {
            new: { isAccessible: false },
            delete: { isAccessible: false },
            downloadInvoice: {
              actionType: 'record',
              icon: 'Download',
              label: 'Pobierz fakturę',
              isVisible: true,
              handler: async (_request: any, _response: any, context: any) => {
                const { record } = context;
                const orderId: string = record.params.id;

                const order = await prisma.order.findUnique({
                  where: { id: orderId },
                  include: { items: true },
                });

                if (!order) {
                  return {
                    record: record.toJSON(),
                    notice: { message: 'Zamówienie nie istnieje.', type: 'error' },
                  };
                }

                let invoiceUrl = order.invoiceUrl;

                if (!invoiceUrl) {
                  const result = await invoiceService.processInvoice({
                    id: order.id,
                    orderNumber: order.orderNumber,
                    snapshotFirstName: order.snapshotFirstName,
                    snapshotLastName: order.snapshotLastName,
                    snapshotCompany: order.snapshotCompany,
                    snapshotStreet: order.snapshotStreet,
                    snapshotCity: order.snapshotCity,
                    snapshotPostalCode: order.snapshotPostalCode,
                    itemsTotalInCents: order.itemsTotalInCents,
                    shippingCostInCents: order.shippingCostInCents,
                    totalInCents: order.totalInCents,
                    createdAt: order.createdAt,
                    items: order.items.map((i) => ({
                      snapshotName: i.snapshotName,
                      snapshotPrice: i.snapshotPrice,
                      quantity: i.quantity,
                    })),
                  });
                  invoiceUrl = result.url;
                }

                return {
                  redirectUrl: invoiceUrl,
                  record: record.toJSON(),
                };
              },
            },
            generateLabel: {
              actionType: 'record',
              icon: 'Truck',
              label: 'Generuj etykietę',
              // Only relevant for orders that are in an active fulfillment state
              isVisible: (context: any) => {
                const status = context.record?.params?.status;
                return !['PENDING_PAYMENT', 'CANCELLED', 'REFUNDED', 'DELIVERED'].includes(status);
              },
              handler: async (_request: any, _response: any, context: any) => {
                const { record } = context;
                const orderId: string = record.params.id;

                try {
                  // If a label was already generated, redirect to the existing URL rather
                  // than hitting the carrier API again.
                  const existing = await prisma.shipment.findUnique({ where: { orderId } });
                  if (existing?.status === 'LABEL_GENERATED' && existing.labelUrl) {
                    if (existing.labelUrl.startsWith('http')) {
                      return { redirectUrl: existing.labelUrl, record: record.toJSON() };
                    }
                    return {
                      record: record.toJSON(),
                      notice: {
                        message: `Etykieta już wygenerowana (tryb mock). Nr śledzenia: ${existing.trackingNumber ?? 'N/A'}`,
                        type: 'success',
                      },
                    };
                  }

                  const shipment = await shippingService.generateLabel(orderId);

                  if (shipment.labelUrl?.startsWith('http')) {
                    return { redirectUrl: shipment.labelUrl, record: record.toJSON() };
                  }

                  // Mock mode — no real PDF URL, just surface the tracking number
                  return {
                    record: record.toJSON(),
                    notice: {
                      message: `Etykieta wygenerowana (tryb mock). Nr śledzenia: ${shipment.trackingNumber ?? 'N/A'}`,
                      type: 'success',
                    },
                  };
                } catch (err) {
                  return {
                    record: record.toJSON(),
                    notice: {
                      message: `Błąd generowania etykiety: ${(err as Error).message}`,
                      type: 'error',
                    },
                  };
                }
              },
            },
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
      // ── Moderation ───────────────────────────────────────────────────
      {
        resource: { model: getModelByName('Review'), client: prisma },
        options: {
          navigation: { name: 'Moderacja' },
          sort: { direction: 'desc', sortBy: 'createdAt' },
          properties: {
            body: {
              type: 'textarea',
              isVisible: { list: false, show: true, edit: false, filter: false },
            },
            adminReply: {
              type: 'textarea',
              isVisible: { list: false, show: true, edit: true, filter: false },
              description: 'Publiczna odpowiedź marki (widoczna pod recenzją)',
            },
            userId: { isVisible: { list: false, show: true, edit: false, filter: true } },
            orderId: { isVisible: { list: false, show: true, edit: false, filter: false } },
            helpfulCount: { isVisible: { list: true, show: true, edit: false, filter: false } },
            updatedAt: { isVisible: false },
          },
          actions: {
            new: { isAccessible: false },
            delete: { isAccessible: false },
            // Plain edit is kept only for writing adminReply — status changes go through approve/reject
            edit: {
              isAccessible: true,
              // Limit editable fields to adminReply only
              after: async (response: any) => response,
            },
            approve: {
              actionType: 'record',
              icon: 'CheckCircle',
              label: 'Zatwierdź',
              isVisible: (context: any) => context.record?.params?.status !== 'APPROVED',
              handler: async (request: any, _response: any, context: any) => {
                const { record } = context;
                const reviewId: string = record.params.id;
                const adminReply = (request.payload?.adminReply as string | undefined)?.trim();

                const review = await prisma.review.findUnique({ where: { id: reviewId } });
                if (!review) {
                  return {
                    record: record.toJSON(),
                    notice: { message: 'Opinia nie istnieje.', type: 'error' },
                  };
                }

                await prisma.review.update({
                  where: { id: reviewId },
                  data: {
                    status: 'APPROVED',
                    ...(adminReply !== undefined && { adminReply: adminReply || null }),
                  },
                });

                await updateReviewStats(prisma, review.productId);

                return {
                  record: record.toJSON(),
                  notice: { message: 'Opinia zatwierdzona i opublikowana.', type: 'success' },
                };
              },
            },
            reject: {
              actionType: 'record',
              icon: 'XCircle',
              label: 'Odrzuć',
              isVisible: (context: any) => context.record?.params?.status !== 'REJECTED',
              handler: async (_request: any, _response: any, context: any) => {
                const { record } = context;
                const reviewId: string = record.params.id;

                const review = await prisma.review.findUnique({ where: { id: reviewId } });
                if (!review) {
                  return {
                    record: record.toJSON(),
                    notice: { message: 'Opinia nie istnieje.', type: 'error' },
                  };
                }

                await prisma.review.update({
                  where: { id: reviewId },
                  data: { status: 'REJECTED' },
                });

                await updateReviewStats(prisma, review.productId);

                return {
                  record: record.toJSON(),
                  notice: { message: 'Opinia odrzucona.', type: 'success' },
                };
              },
            },
            bulkApprove: {
              actionType: 'bulk',
              icon: 'CheckCircle',
              label: 'Zatwierdź zaznaczone',
              isVisible: true,
              handler: async (_request: any, _response: any, context: any) => {
                const { records } = context;
                const productIds = new Set<string>();

                await Promise.allSettled(
                  records.map(async (r: any) => {
                    const review = await prisma.review.findUnique({ where: { id: r.params.id } });
                    if (!review) return;
                    await prisma.review.update({
                      where: { id: review.id },
                      data: { status: 'APPROVED' },
                    });
                    productIds.add(review.productId);
                  }),
                );

                await Promise.allSettled(
                  [...productIds].map((pid) => updateReviewStats(prisma, pid)),
                );

                return {
                  records: records.map((r: any) => r.toJSON()),
                  notice: {
                    message: `Zatwierdzono ${records.length} ${records.length === 1 ? 'opinię' : 'opinii'}.`,
                    type: 'success',
                  },
                };
              },
            },
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
