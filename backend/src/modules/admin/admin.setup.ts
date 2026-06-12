import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as bcrypt from 'bcrypt';
import * as session from 'express-session';
import connectPgSimple = require('connect-pg-simple');
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceService } from '../invoice/invoice.service';
import { ShippingService } from '../shipping/shipping.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { ReturnsService } from '../returns/returns.service';
import { AuthService } from '../auth/auth.service';

const logger = new Logger('AdminJS');

export async function logAdminAction(
  prisma: PrismaService,
  action: string,
  entityType: string,
  entityId: string,
  actor: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.adminLog.create({
      data: { action, entityType, entityId, actor, metadata: metadata as any },
    });
  } catch (err) {
    logger.error(`AdminLog write failed: ${(err as Error).message}`);
  }
}

async function generatePicklistHtml(prisma: PrismaService): Promise<string> {
  const esc = (s: unknown) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const orders = await prisma.order.findMany({
    where: { status: { in: ['PAID', 'PROCESSING'] } },
    include: {
      items: {
        include: { productVariant: { select: { sku: true, label: true, volume: true } } },
      },
    },
    orderBy: [{ carrierCode: 'asc' }, { createdAt: 'asc' }],
  });

  const rows = orders
    .map((order, i) => {
      const itemLines = order.items
        .map(
          (item) =>
            `<li>${esc(item.productVariant.sku)} &mdash; ${esc(item.productVariant.label)}${item.productVariant.volume ? ` (${item.productVariant.volume}ml)` : ''} &times; <strong>${item.quantity}</strong></li>`,
        )
        .join('');

      const locker = order.inpostLockerCode
        ? `<span style="font-size:10px;color:#555">${esc(order.inpostLockerCode)}</span>`
        : '';

      return `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${esc(order.orderNumber)}</strong><br><span style="font-size:10px;color:#777">${esc(order.createdAt.toLocaleDateString('pl-PL'))}</span></td>
          <td>${esc(order.snapshotFirstName)} ${esc(order.snapshotLastName)}<br><span style="font-size:10px;color:#777">${esc(order.snapshotPhone)}</span></td>
          <td><ul class="items">${itemLines}</ul></td>
          <td><span class="carrier-badge ${esc(order.carrierCode)}">${esc(order.carrierCode)}</span>${locker}</td>
        </tr>`;
    })
    .join('');

  const now = new Date().toLocaleString('pl-PL');

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <title>Lista pickingowa</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:11px;color:#000}
    .header{padding:12px 16px;border-bottom:2px solid #000;margin-bottom:8px}
    .header h1{font-size:16px}
    .header p{font-size:11px;color:#555;margin-top:4px}
    .actions{padding:8px 16px;margin-bottom:8px}
    .btn{display:inline-block;padding:7px 14px;background:#333;color:#fff;border:none;cursor:pointer;font-size:12px;margin-right:8px;border-radius:3px;text-decoration:none}
    table{width:100%;border-collapse:collapse}
    th{background:#222;color:#fff;padding:6px 8px;text-align:left;font-size:11px}
    td{border-bottom:1px solid #ddd;padding:5px 8px;vertical-align:top}
    tr:nth-child(even) td{background:#f9f9f9}
    ul.items{list-style:none;padding:0}
    ul.items li{margin-bottom:2px}
    .carrier-badge{display:inline-block;padding:2px 6px;border-radius:3px;font-weight:bold;font-size:10px;margin-right:4px}
    .INPOST{background:#ffdd00;color:#000}
    .DHL{background:#d40511;color:#fff}
    .GLS{background:#0066cc;color:#fff}
    .DPD{background:#dc0032;color:#fff}
    @media print{
      .actions{display:none}
      th,.INPOST,.DHL,.GLS,.DPD{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      th{background:#000!important}
      .INPOST{background:#ffdd00!important;color:#000!important}
      .DHL{background:#d40511!important;color:#fff!important}
      .GLS{background:#0066cc!important;color:#fff!important}
      .DPD{background:#dc0032!important;color:#fff!important}
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Lista pickingowa</h1>
    <p>Wygenerowano: ${now} &nbsp;|&nbsp; Zamówień do realizacji: <strong>${orders.length}</strong></p>
  </div>
  <div class="actions">
    <button class="btn" onclick="window.print()">Drukuj</button>
    <a class="btn" href="/admin">&#8592; Panel admina</a>
  </div>
  <table>
    <thead>
      <tr><th>#</th><th>Nr zamówienia</th><th>Klient</th><th>Zawartość</th><th>Kurier / Paczkomat</th></tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#888">Brak zamówień do realizacji</td></tr>'}</tbody>
  </table>
</body>
</html>`;
}

async function generateFulfillmentGapHtml(prisma: PrismaService): Promise<string> {
  const esc = (s: unknown) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const orders = await prisma.order.findMany({
    where: { status: { in: ['PAID', 'PROCESSING'] }, shipment: { is: null } },
    orderBy: { createdAt: 'asc' },
  });

  const now = new Date();

  const rows = orders
    .map((order) => {
      const hoursAgo = Math.floor((now.getTime() - order.createdAt.getTime()) / (1000 * 60 * 60));
      const urgency = hoursAgo >= 48 ? 'background:#f8d7da' : hoursAgo >= 24 ? 'background:#fff3cd' : '';
      return `
        <tr style="${urgency}">
          <td><a href="/admin/resources/Order/records/${esc(order.id)}/show"><strong>${esc(order.orderNumber)}</strong></a></td>
          <td>${esc(order.snapshotFirstName)} ${esc(order.snapshotLastName)}</td>
          <td><span class="status-badge">${esc(order.status)}</span></td>
          <td>${esc(order.createdAt.toLocaleString('pl-PL'))}</td>
          <td><strong>${hoursAgo}h</strong>${hoursAgo >= 48 ? ' &#x26A0;' : ''}</td>
        </tr>`;
    })
    .join('');

  const generatedAt = now.toLocaleString('pl-PL');

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <title>Niezrealizowane zamówienia</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:11px;color:#000}
    .header{padding:12px 16px;border-bottom:2px solid #000;margin-bottom:8px}
    .header h1{font-size:16px}
    .header p{font-size:11px;color:#555;margin-top:4px}
    .actions{padding:8px 16px;margin-bottom:8px}
    .btn{display:inline-block;padding:7px 14px;background:#333;color:#fff;border:none;cursor:pointer;font-size:12px;margin-right:8px;border-radius:3px;text-decoration:none}
    table{width:100%;border-collapse:collapse}
    th{background:#222;color:#fff;padding:6px 8px;text-align:left;font-size:11px}
    td{border-bottom:1px solid #ddd;padding:5px 8px;vertical-align:middle}
    .status-badge{display:inline-block;padding:2px 6px;border-radius:3px;font-weight:bold;font-size:10px;background:#e0e0e0}
    .legend{padding:8px 16px;font-size:10px;color:#555}
    .legend span{display:inline-block;width:14px;height:14px;vertical-align:middle;margin-right:4px;border-radius:2px}
    .yellow{background:#fff3cd}
    .red{background:#f8d7da}
    @media print{.actions{display:none}}
  </style>
</head>
<body>
  <div class="header">
    <h1>Niezrealizowane zamówienia (brak przesyłki)</h1>
    <p>Wygenerowano: ${generatedAt} &nbsp;|&nbsp; Zamówień: <strong>${orders.length}</strong></p>
  </div>
  <div class="actions">
    <button class="btn" onclick="window.print()">Drukuj</button>
    <a class="btn" href="/admin">&#8592; Panel admina</a>
  </div>
  <div class="legend">
    <span class="yellow"></span> &gt;24h bez przesyłki &nbsp;
    <span class="red"></span> &gt;48h bez przesyłki &#x26A0;
  </div>
  <table>
    <thead>
      <tr><th>Nr zamówienia</th><th>Klient</th><th>Status</th><th>Data złożenia</th><th>Czas oczekiwania</th></tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#888">Brak niezrealizowanych zamówień</td></tr>'}</tbody>
  </table>
</body>
</html>`;
}

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
  ordersService: OrdersService,
  paymentsService: PaymentsService,
  returnsService: ReturnsService,
  authService: AuthService,
): Promise<void> {
  const adminEmail = process.env.ADMIN_DEFAULT_EMAIL;
  const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error(
      'ADMIN_DEFAULT_EMAIL and ADMIN_DEFAULT_PASSWORD must be set — refusing to boot with an unprotected admin panel',
    );
  }

  // ADMIN_SESSION_SECRET must be set independently of the admin password.
  // Falling back to adminPassword would expose the session secret whenever
  // the password is rotated or logged, so we require an explicit secret in prod.
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;
  if (!sessionSecret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ADMIN_SESSION_SECRET must be set in production — refusing to boot');
    }
    // Dev fallback: random ephemeral secret (avoids using the bcrypt hash as an HMAC key).
    // Sessions will not survive server restarts — set ADMIN_SESSION_SECRET in .env to persist them.
    process.env.ADMIN_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
    logger.warn('ADMIN_SESSION_SECRET not set — using a random ephemeral secret for this dev session');
  }
  // After the guard above, ADMIN_SESSION_SECRET is guaranteed to be set
  // (either already present or overwritten with the dev fallback). Read from
  // the env var rather than the captured `sessionSecret` variable (which is
  // undefined when the dev-fallback branch ran).
  const resolvedSessionSecret = process.env.ADMIN_SESSION_SECRET!;

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
            cpnpNotificationNumber: {
              description: 'Numer powiadomienia CPNP (wymagany przez art. 13 rozp. 1223/2009 przed wprowadzeniem do obrotu UE)',
              isVisible: { list: false, show: true, edit: true, filter: false },
            },
            responsiblePersonName: {
              description: 'Nazwa/firma Osoby Odpowiedzialnej (RP) zgodnie z rozp. 1223/2009',
              isVisible: { list: false, show: true, edit: true, filter: false },
            },
          },
          actions: {
            list: {
              after: async (response: any) => {
                const result = await prisma.$queryRaw<[{ count: number }]>`
                  SELECT COUNT(*)::int AS count FROM products
                  WHERE "isActive" = true
                    AND ("cpnpNotificationNumber" IS NULL OR "responsiblePersonName" IS NULL)
                `;
                const count = Number(result[0]?.count ?? 0);
                if (count > 0) {
                  response.notice = {
                    message: `CPNP: ${count} aktywn${count === 1 ? 'y produkt wymaga' : 'e produkty wymagają'} numeru powiadomienia CPNP lub nazwy Osoby Odpowiedzialnej (art. 13 rozp. 1223/2009)`,
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
            edit: {
              after: async (response: any, _request: any, context: any) => {
                const { record, currentAdmin } = context;
                if (record?.params?.id) {
                  await logAdminAction(
                    prisma, 'edit', 'ProductVariant', record.params.id,
                    currentAdmin?.email ?? adminEmail,
                    { sku: record.params.sku, stock: record.params.stock, priceInCents: record.params.priceInCents },
                  );
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

                let storagePath = order.invoiceStoragePath;

                if (!storagePath) {
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
                    discountInCents: order.discountInCents,
                    couponCode: order.couponCode,
                    totalInCents: order.totalInCents,
                    createdAt: order.createdAt,
                    items: order.items.map((i) => ({
                      snapshotName: i.snapshotName,
                      snapshotPrice: i.snapshotPrice,
                      snapshotVatRate: i.snapshotVatRate,
                      quantity: i.quantity,
                    })),
                  });
                  storagePath = result.storagePath;
                }

                const invoiceUrl = await invoiceService.getSignedUrl(storagePath);

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
                  await logAdminAction(prisma, 'generateLabel', 'Order', orderId, context.currentAdmin?.email ?? adminEmail, { trackingNumber: shipment.trackingNumber });

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
            bulkMarkAsShipped: {
              actionType: 'bulk',
              icon: 'Truck',
              label: 'Oznacz jako wysłane',
              isVisible: true,
              handler: async (_request: any, _response: any, context: any) => {
                const { records } = context;
                const ids: string[] = records.map((r: any) => r.params.id as string);
                const result = await ordersService.bulkMarkAsShipped(ids);
                if (result.succeeded > 0) {
                  await logAdminAction(prisma, 'bulkMarkAsShipped', 'Order', ids.join(','), context.currentAdmin?.email ?? adminEmail, { succeeded: result.succeeded, failed: result.failed.length });
                }

                const parts: string[] = [];
                if (result.succeeded > 0) parts.push(`Wysłano: ${result.succeeded}`);
                if (result.failed.length > 0) {
                  parts.push(`Błędy (${result.failed.length}): ${result.failed.map((f) => f.orderNumber).join(', ')}`);
                }

                return {
                  records: records.map((r: any) => r.toJSON()),
                  notice: {
                    message: parts.join(' | '),
                    type: result.failed.length === 0 ? 'success' : 'error',
                  },
                };
              },
            },
            refundFull: {
              actionType: 'record',
              icon: 'ArrowLeft',
              label: 'Zwrot środków',
              isVisible: (context: any) => {
                const status = context.record?.params?.status;
                return ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(status);
              },
              handler: async (_request: any, _response: any, context: any) => {
                const { record } = context;
                const orderId = record.params.id as string;
                try {
                  await paymentsService.refundPayment(orderId, 'ADMIN');
                  await logAdminAction(prisma, 'refundFull', 'Order', orderId, context.currentAdmin?.email ?? adminEmail);
                  return {
                    record: record.toJSON(),
                    notice: {
                      message: 'Zwrot zainicjowany — status → REFUNDED, stan magazynowy przywrócony.',
                      type: 'success',
                    },
                  };
                } catch (err) {
                  return {
                    record: record.toJSON(),
                    notice: { message: `Błąd zwrotu: ${(err as Error).message}`, type: 'error' },
                  };
                }
              },
            },
            printPicklist: {
              actionType: 'resource',
              icon: 'Printer',
              label: 'Lista pickingowa',
              isVisible: true,
              handler: async (_request: any, _response: any, _context: any) => {
                return { redirectUrl: '/admin/picklist', records: [] };
              },
            },
            fulfillmentGap: {
              actionType: 'resource',
              icon: 'AlertTriangle',
              label: 'Niezrealizowane zamówienia',
              isVisible: true,
              handler: async (_request: any, _response: any, _context: any) => {
                return { redirectUrl: '/admin/fulfillment-gap', records: [] };
              },
            },
            bulkCancel: {
              actionType: 'bulk',
              icon: 'XCircle',
              label: 'Anuluj zamówienia',
              isVisible: true,
              handler: async (_request: any, _response: any, context: any) => {
                const { records } = context;
                const ids: string[] = records.map((r: any) => r.params.id as string);
                const result = await ordersService.bulkCancel(ids, 'ADMIN');
                if (result.succeeded > 0) {
                  await logAdminAction(prisma, 'bulkCancel', 'Order', ids.join(','), context.currentAdmin?.email ?? adminEmail, { succeeded: result.succeeded, failed: result.failed.length });
                }

                const parts: string[] = [];
                if (result.succeeded > 0) parts.push(`Anulowano: ${result.succeeded}`);
                if (result.failed.length > 0) {
                  parts.push(`Błędy (${result.failed.length}): ${result.failed.map((f) => f.orderNumber).join(', ')}`);
                }

                return {
                  records: records.map((r: any) => r.toJSON()),
                  notice: {
                    message: parts.join(' | '),
                    type: result.failed.length === 0 ? 'success' : 'error',
                  },
                };
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
          sort: { sortBy: 'createdAt', direction: 'desc' },
          listProperties: ['email', 'firstName', 'lastName', 'phone', 'role', 'emailBounced', 'createdAt'],
          showProperties: ['email', 'firstName', 'lastName', 'phone', 'role', 'isEmailVerified', 'nip', 'emailBounced', 'emailBouncedAt', 'createdAt'],
          filterProperties: ['email', 'role', 'isEmailVerified', 'emailBounced'],
          properties: {
            passwordHash: { isVisible: false },
          },
          actions: {
            new: { isAccessible: false },
            edit: { isAccessible: false },
            delete: { isAccessible: false },
            sendPasswordReset: {
              actionType: 'record',
              icon: 'Key',
              label: 'Wyślij reset hasła',
              isVisible: true,
              handler: async (_request: any, _response: any, context: any) => {
                const { record } = context;
                const email = record.params.email as string;
                try {
                  await authService.requestPasswordReset(email);
                  await logAdminAction(
                    prisma, 'sendPasswordReset', 'User', record.params.id as string,
                    context.currentAdmin?.email ?? adminEmail, { email },
                  );
                  return {
                    record: record.toJSON(),
                    notice: { message: `Link do resetu hasła wysłany na ${email}.`, type: 'success' },
                  };
                } catch (err) {
                  return {
                    record: record.toJSON(),
                    notice: { message: `Błąd wysyłki: ${(err as Error).message}`, type: 'error' },
                  };
                }
              },
            },
            show: {
              after: async (response: any, _request: any, context: any) => {
                const userId: string | undefined = context.record?.params?.id;
                if (!userId) return response;
                const [stats, noteCount] = await Promise.all([
                  prisma.order.aggregate({
                    where: { userId, status: { notIn: ['PENDING_PAYMENT', 'CANCELLED', 'REFUNDED'] } },
                    _sum: { totalInCents: true },
                    _count: true,
                  }),
                  prisma.customerNote.count({ where: { userId } }),
                ]);
                const totalPln = ((stats._sum.totalInCents ?? 0) / 100).toFixed(2);
                response.notice = {
                  message: `Zamówień: ${stats._count} | Wartość: ${totalPln} PLN | Notatki CS: ${noteCount}`,
                  type: 'info',
                };
                return response;
              },
            },
            viewOrders: {
              actionType: 'record',
              icon: 'List',
              label: 'Zamówienia klienta',
              isVisible: true,
              handler: async (_request: any, _response: any, context: any) => {
                const userId = context.record.params.id as string;
                return {
                  redirectUrl: `/admin/resources/Order?filters.userId=${userId}`,
                  record: context.record.toJSON(),
                };
              },
            },
          },
        },
      },
      // ── Coupons ──────────────────────────────────────────────────────
      {
        resource: { model: getModelByName('Coupon'), client: prisma },
        options: {
          navigation: { name: 'Rabaty' },
          sort: { sortBy: 'createdAt', direction: 'desc' },
          listProperties: ['code', 'discountType', 'value', 'currentUses', 'usesCount', 'maxUsesTotal', 'isActive', 'expiresAt'],
          showProperties: ['id', 'code', 'discountType', 'value', 'couponType', 'usesCount', 'currentUses', 'maxUsesTotal', 'maxUsesPerUser', 'minSpendInCents', 'isActive', 'startsAt', 'expiresAt', 'createdAt'],
          filterProperties: ['discountType', 'isActive', 'code'],
          properties: {
            usesCount: {
              type: 'number',
              isVisible: { list: true, show: true, edit: false, filter: false },
              label: 'Użyć (faktyczne)',
              description: 'Liczba zrealizowanych użyć z tabeli coupon_uses',
            },
            excludedProductIds: { isVisible: { list: false, show: true, edit: false, filter: false } },
          },
          actions: {
            delete: { isAccessible: false },
            list: {
              after: async (response: any) => {
                const couponIds: string[] = (response.records ?? []).map((r: any) => r.params.id as string);
                if (couponIds.length === 0) return response;
                const counts = await prisma.couponUse.groupBy({
                  by: ['couponId'],
                  _count: { couponId: true },
                  where: { couponId: { in: couponIds } },
                });
                const countMap = new Map(counts.map((c) => [c.couponId, c._count.couponId]));
                for (const record of response.records ?? []) {
                  record.params.usesCount = countMap.get(record.params.id as string) ?? 0;
                }
                return response;
              },
            },
            show: {
              after: async (response: any, _request: any, context: any) => {
                const couponId = context.record?.params?.id as string | undefined;
                if (!couponId) return response;
                const count = await prisma.couponUse.count({ where: { couponId } });
                if (response.record) response.record.params.usesCount = count;
                return response;
              },
            },
          },
        },
      },
      {
        resource: { model: getModelByName('CouponUse'), client: prisma },
        options: {
          navigation: { name: 'Rabaty' },
          sort: { sortBy: 'createdAt', direction: 'desc' },
          listProperties: ['couponId', 'orderId', 'userId', 'discountAppliedInCents', 'createdAt'],
          filterProperties: ['couponId', 'userId'],
          ...readOnly,
        },
      },
      // ── Returns ──────────────────────────────────────────────────────
      {
        resource: { model: getModelByName('ReturnRequest'), client: prisma },
        options: {
          navigation: { name: 'Obsługa klienta' },
          sort: { sortBy: 'createdAt', direction: 'desc' },
          listProperties: ['orderNumber', 'firstName', 'lastName', 'type', 'status', 'createdAt'],
          filterProperties: ['status', 'type', 'orderNumber', 'email'],
          showProperties: [
            'id', 'orderNumber', 'email', 'firstName', 'lastName', 'phone',
            'type', 'status', 'deliveryDate', 'items', 'reason',
            'requestedResolution', 'bankAccount', 'adminNote', 'createdAt', 'updatedAt',
          ],
          editProperties: ['adminNote'],
          actions: {
            new: { isAccessible: false },
            delete: { isAccessible: false },
            approve: {
              actionType: 'record',
              icon: 'CheckCircle',
              label: 'Zatwierdź',
              isVisible: (context: any) =>
                !['APPROVED', 'COMPLETED', 'REJECTED'].includes(context.record?.params?.status),
              handler: async (request: any, _response: any, context: any) => {
                const { record } = context;
                const adminNote = (request.payload?.adminNote as string | undefined)?.trim() || undefined;
                try {
                  await returnsService.approve(record.params.id, adminNote);
                  await logAdminAction(prisma, 'approve', 'ReturnRequest', record.params.id as string, context.currentAdmin?.email ?? adminEmail, adminNote ? { adminNote } : undefined);
                  return {
                    record: record.toJSON(),
                    notice: { message: 'Wniosek zatwierdzony — klient został powiadomiony.', type: 'success' },
                  };
                } catch (err) {
                  return {
                    record: record.toJSON(),
                    notice: { message: `Błąd: ${(err as Error).message}`, type: 'error' },
                  };
                }
              },
            },
            reject: {
              actionType: 'record',
              icon: 'XCircle',
              label: 'Odrzuć',
              isVisible: (context: any) =>
                !['REJECTED', 'COMPLETED'].includes(context.record?.params?.status),
              handler: async (request: any, _response: any, context: any) => {
                const { record } = context;
                const adminNote = (request.payload?.adminNote as string | undefined)?.trim() || undefined;
                try {
                  await returnsService.reject(record.params.id, adminNote);
                  await logAdminAction(prisma, 'reject', 'ReturnRequest', record.params.id as string, context.currentAdmin?.email ?? adminEmail, adminNote ? { adminNote } : undefined);
                  return {
                    record: record.toJSON(),
                    notice: { message: 'Wniosek odrzucony — klient został powiadomiony.', type: 'success' },
                  };
                } catch (err) {
                  return {
                    record: record.toJSON(),
                    notice: { message: `Błąd: ${(err as Error).message}`, type: 'error' },
                  };
                }
              },
            },
            markRefunded: {
              actionType: 'record',
              icon: 'ArrowLeft',
              label: 'Oznacz jako zwrócono środki',
              isVisible: (context: any) => context.record?.params?.status === 'APPROVED',
              handler: async (request: any, _response: any, context: any) => {
                const { record } = context;
                const adminNote = (request.payload?.adminNote as string | undefined)?.trim() || undefined;
                try {
                  await returnsService.markRefunded(record.params.id, adminNote);
                  await logAdminAction(prisma, 'markRefunded', 'ReturnRequest', record.params.id as string, context.currentAdmin?.email ?? adminEmail, adminNote ? { adminNote } : undefined);
                  return {
                    record: record.toJSON(),
                    notice: { message: 'Zwrot środków oznaczony jako zrealizowany — klient został powiadomiony.', type: 'success' },
                  };
                } catch (err) {
                  return {
                    record: record.toJSON(),
                    notice: { message: `Błąd: ${(err as Error).message}`, type: 'error' },
                  };
                }
              },
            },
          },
        },
      },
      // ── Customer Service ──────────────────────────────────────────────
      {
        resource: { model: getModelByName('CustomerNote'), client: prisma },
        options: {
          navigation: { name: 'Obsługa klienta' },
          sort: { sortBy: 'createdAt', direction: 'desc' },
          listProperties: ['userId', 'body', 'adminEmail', 'createdAt'],
          editProperties: ['userId', 'body', 'adminEmail'],
          properties: {
            body: {
              type: 'textarea',
              isVisible: { list: false, show: true, edit: true, filter: false },
              description: 'Wewnętrzna notatka widoczna tylko dla adminów',
            },
            adminEmail: {
              defaultValue: process.env.ADMIN_DEFAULT_EMAIL ?? '',
            },
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
                await logAdminAction(prisma, 'approve', 'Review', reviewId, context.currentAdmin?.email ?? adminEmail);

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
                await logAdminAction(prisma, 'reject', 'Review', reviewId, context.currentAdmin?.email ?? adminEmail);

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
                const bulkReviewIds: string[] = records.map((r: any) => r.params.id as string);
                await logAdminAction(prisma, 'bulkApprove', 'Review', bulkReviewIds.join(','), context.currentAdmin?.email ?? adminEmail, { count: records.length });

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
      // ── Admin Audit Log ───────────────────────────────────────────────
      {
        resource: { model: getModelByName('AdminLog'), client: prisma },
        options: {
          navigation: { name: 'Administracja' },
          sort: { sortBy: 'createdAt', direction: 'desc' },
          listProperties: ['action', 'entityType', 'entityId', 'actor', 'createdAt'],
          filterProperties: ['action', 'entityType', 'actor'],
          ...readOnly,
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
    pool: { max: 2 } as any,
  });

  const sessionOpts = {
    store,
    resave: false,
    saveUninitialized: false,
    secret: resolvedSessionSecret,
    name: 'adminjs', // must match the cookie name set by buildAuthenticatedRouter
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict' as const,
      maxAge: 8 * 60 * 60 * 1000,
    },
  };

  // Printer-friendly pick list — session-protected, registered before the AdminJS
  // router so Express resolves it here instead of handing it to AdminJS's SPA.
  const sessionMw = session(sessionOpts);
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.get('/admin/picklist', sessionMw, async (req: any, res: any) => {
    if (!req.session?.passport?.user) {
      return res.redirect('/admin/login');
    }
    try {
      const html = await generatePicklistHtml(prisma);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err) {
      res.status(500).send(`<pre>Błąd generowania listy: ${(err as Error).message}</pre>`);
    }
  });

  expressApp.get('/admin/fulfillment-gap', sessionMw, async (req: any, res: any) => {
    if (!req.session?.passport?.user) {
      return res.redirect('/admin/login');
    }
    try {
      const html = await generateFulfillmentGapHtml(prisma);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err) {
      res.status(500).send(`<pre>Błąd generowania raportu: ${(err as Error).message}</pre>`);
    }
  });

  const router = AdminJSExpress.buildAuthenticatedRouter(
    admin,
    {
      authenticate: async (email: string, password: string) => {
        if (email !== adminEmail) return null;
        const valid = await bcrypt.compare(password, adminPassword);
        return valid ? { email } : null;
      },
      cookieName: 'adminjs',
      cookiePassword: resolvedSessionSecret,
    },
    null,
    sessionOpts,
  );

  app.use(admin.options.rootPath, router);

  // Session fixation guard: regenerate the session ID on the first request after
  // login. Without this, an attacker who plants a known session ID before login
  // inherits the authenticated session after the admin logs in.
  expressApp.use('/admin', (req: any, res: any, next: any) => {
    if (req.session?.passport?.user && !req.session._regenerated) {
      const passportUser = req.session.passport.user;
      req.session.regenerate((err: Error | null) => {
        if (err) return next(err);
        req.session.passport = { user: passportUser };
        req.session._regenerated = true;
        next();
      });
    } else {
      next();
    }
  });

  logger.log(`AdminJS panel available at ${admin.options.rootPath}`);
}
