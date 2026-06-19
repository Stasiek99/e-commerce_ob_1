import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { CarrierCode, OrderStatus, ShipmentStatus } from '@prisma/client';
import type IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { EmailQueueService } from '../email/email-queue.service';
import { StorageService } from '../storage/storage.service';
import { InpostClient } from './carriers/inpost.client';
import { DhlClient } from './carriers/dhl.client';
import { GlsClient } from './carriers/gls.client';
import { DpdClient } from './carriers/dpd.client';
import { ShippingRatesService } from './shipping-rates.service';

/** DHL/DPD store the carrier's own externally hosted label URL in `labelUrl`;
 *  InPost/GLS store a bare Supabase storage path. Must be checked before the
 *  `mock-label-` check since carrier URLs never have that prefix either. */
export function isCarrierHostedUrl(labelUrl: string): boolean {
  return labelUrl.startsWith('http');
}

const CARRIER_NAMES: Record<CarrierCode, string> = {
  [CarrierCode.INPOST]:      'InPost',
  [CarrierCode.DHL]:         'DHL Express',
  [CarrierCode.GLS]:         'GLS',
  [CarrierCode.DPD]:         'DPD Pickup',
  [CarrierCode.DPD_COURIER]: 'DPD Kurier',
};

// Static display metadata — only prices come from the DB.
const CARRIER_DISPLAY = [
  { carrier: CarrierCode.INPOST,      name: 'InPost Paczkomat', description: 'Dostawa do paczkomatu w 1-2 dni robocze',    estimatedDays: '1-2 dni robocze' },
  { carrier: CarrierCode.DPD,         name: 'DPD Pickup',       description: 'Odbiór w punkcie DPD w 1-2 dni robocze',     estimatedDays: '1-2 dni robocze' },
  { carrier: CarrierCode.DPD_COURIER, name: 'DPD Kurier',       description: 'Dostawa do drzwi w 1-2 dni robocze',         estimatedDays: '1-2 dni robocze' },
  { carrier: CarrierCode.DHL,         name: 'DHL Kurier',       description: 'Dostawa do drzwi w 1-2 dni robocze',         estimatedDays: '1-2 dni robocze' },
  { carrier: CarrierCode.GLS,         name: 'GLS Kurier',       description: 'Dostawa do drzwi w 2-3 dni robocze',         estimatedDays: '2-3 dni robocze' },
] as const;

@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailQueueService,
    private readonly storage: StorageService,
    private readonly inpost: InpostClient,
    private readonly dhl: DhlClient,
    private readonly gls: GlsClient,
    private readonly dpd: DpdClient,
    private readonly shippingRates: ShippingRatesService,
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
  ) {}

  async getShippingRates() {
    const rateMap = await this.shippingRates.getRateMap();
    return CARRIER_DISPLAY
      .filter((c) => rateMap[c.carrier] !== undefined)
      .map((c) => ({ ...c, priceInCents: rateMap[c.carrier] }));
  }

  async generateLabel(orderId: string) {
    // Distributed lock: prevents two concurrent requests for the same order
    // (admin double-click, or a retry on what looks like a hung request — carrier
    // latency near the 15s axios timeout is a realistic trigger) from both passing
    // the existing-shipment guard and both calling the carrier's real, billable
    // createShipment(). TTL covers the worst case of two sequential 15s carrier
    // calls (createShipment + fetchLabelPdf) plus the Supabase label upload.
    // Mirrors the checkout-lock/cancel-lock pattern in orders.service.ts.
    const lockKey = `label-gen-lock:${orderId}`;
    const lockToken = randomUUID();
    const acquired = await this.redis.set(lockKey, lockToken, 'EX', 60, 'NX');
    if (!acquired) {
      throw new HttpException(
        'Label generation for this order is already in progress — please wait a moment before trying again',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { productVariant: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');

    const allowedStatuses: OrderStatus[] = [OrderStatus.PAID, OrderStatus.PROCESSING];
    if (!allowedStatuses.includes(order.status as OrderStatus)) {
      throw new BadRequestException(
        `Cannot generate label for order in status ${order.status}`,
      );
    }

    const existing = await this.prisma.shipment.findUnique({ where: { orderId } });
    if (existing && existing.status !== ShipmentStatus.LABEL_ERROR) {
      throw new ConflictException('Label already exists for this order');
    }

    const totalWeightKg = order.items.reduce((sum, item) => {
      const weight = item.productVariant.weight ?? 200;
      return sum + (weight * item.quantity) / 1000;
    }, 0.5);

    const receiverName = `${order.snapshotFirstName} ${order.snapshotLastName}`;

    if (!Object.values(CarrierCode).includes(order.carrierCode)) {
      throw new BadRequestException(`Unsupported carrier: ${order.carrierCode}`);
    }

    let trackingNumber: string | undefined;
    let labelUrl: string | undefined;
    let shipmentId: string | undefined;
    let targetLockerCode: string | undefined;
    let rawResponse: unknown;

    try {

      switch (order.carrierCode) {
        case CarrierCode.INPOST: {
          const result = await this.inpost.createShipment({
            receiver: { name: receiverName, phone: order.snapshotPhone, email: order.snapshotEmail },
            targetLockerCode: order.inpostLockerCode!,
            weightKg: totalWeightKg,
          });
          shipmentId = result.id;
          trackingNumber = result.trackingNumber;
          targetLockerCode = order.inpostLockerCode ?? undefined;
          rawResponse = result;

          const pdfBuffer = await this.inpost.fetchLabelPdf(result.id);
          if (pdfBuffer) {
            labelUrl = await this.storage.uploadShippingLabel(
              pdfBuffer,
              `inpost-${result.id}.pdf`,
            );
            this.logger.log(`Label uploaded to Supabase for shipment ${result.id}`);
          } else {
            // Mock mode — no real PDF
            labelUrl = `mock-label-${result.id}.pdf`;
          }
          break;
        }
        case CarrierCode.DHL: {
          const result = await this.dhl.createShipment({
            receiver: {
              name: receiverName,
              street: order.snapshotStreet,
              city: order.snapshotCity,
              postalCode: order.snapshotPostalCode,
              country: order.snapshotCountry,
              phone: order.snapshotPhone,
              email: order.snapshotEmail,
            },
            weightKg: totalWeightKg,
            description: `Zamówienie #${order.orderNumber}`,
          });
          trackingNumber = result.trackingNumber;
          labelUrl = result.labelUrl;
          rawResponse = result;
          break;
        }
        case CarrierCode.GLS: {
          const result = await this.gls.createShipment({
            receiver: {
              name: receiverName,
              street: order.snapshotStreet,
              city: order.snapshotCity,
              postalCode: order.snapshotPostalCode,
              country: order.snapshotCountry,
              phone: order.snapshotPhone,
              email: order.snapshotEmail,
            },
            weightKg: totalWeightKg,
            reference: order.orderNumber,
          });
          trackingNumber = result.trackingNumber;
          rawResponse = result;

          const pdfBuffer = await this.gls.fetchLabelPdf(result.parcelId);
          if (pdfBuffer) {
            labelUrl = await this.storage.uploadShippingLabel(
              pdfBuffer,
              `gls-${result.parcelId}.pdf`,
            );
            this.logger.log(`Label uploaded to Supabase for GLS parcel ${result.parcelId}`);
          } else {
            labelUrl = `mock-label-gls-${result.parcelId}.pdf`;
          }
          break;
        }
        case CarrierCode.DPD:
        case CarrierCode.DPD_COURIER: {
          const result = await this.dpd.createShipment({
            receiver: {
              name: receiverName,
              street: order.snapshotStreet,
              city: order.snapshotCity,
              postalCode: order.snapshotPostalCode,
              country: order.snapshotCountry,
              phone: order.snapshotPhone,
              email: order.snapshotEmail,
            },
            weightKg: totalWeightKg,
            reference: order.orderNumber,
          });
          trackingNumber = result.trackingNumber;
          labelUrl = result.labelUrl;
          rawResponse = result;
          break;
        }
      }

      const shipment = await this.prisma.shipment.upsert({
        where: { orderId },
        create: {
          orderId,
          carrierCode: order.carrierCode,
          status: ShipmentStatus.LABEL_GENERATED,
          trackingNumber,
          labelUrl,
          shipmentId,
          targetLockerCode,
          labelGeneratedAt: new Date(),
          rawCarrierResponse: rawResponse as any,
        },
        update: {
          status: ShipmentStatus.LABEL_GENERATED,
          trackingNumber,
          labelUrl,
          shipmentId,
          labelGeneratedAt: new Date(),
          rawCarrierResponse: rawResponse as any,
        },
      });

      const trackingUrl = this.getTrackingUrl(order.carrierCode, trackingNumber);

      this.emailService
        .sendShippingNotification({
          to: order.snapshotEmail,
          orderNumber: order.orderNumber,
          firstName: order.snapshotFirstName,
          carrier: CARRIER_NAMES[order.carrierCode],
          trackingNumber,
          trackingUrl,
        })
        .catch((err) => this.logger.warn('Shipping notification email failed', err));

      return shipment;
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Label generation failed for order ${orderId}: ${message}`);

      // Preserve any carrier identifiers that were already committed before the
      // failure (e.g. InPost returned shipmentId but Supabase label upload failed).
      // Without these fields a support engineer has no way to locate the shipment
      // on the carrier's dashboard — they would be permanently lost in memory.
      await this.prisma.shipment.upsert({
        where: { orderId },
        create: {
          orderId,
          carrierCode: order.carrierCode,
          status: ShipmentStatus.LABEL_ERROR,
          shipmentId: shipmentId ?? null,
          trackingNumber: trackingNumber ?? null,
          rawCarrierResponse: { error: message, carrierResponse: rawResponse ?? null } as any,
        },
        update: {
          status: ShipmentStatus.LABEL_ERROR,
          shipmentId: shipmentId ?? null,
          trackingNumber: trackingNumber ?? null,
          rawCarrierResponse: { error: message, carrierResponse: rawResponse ?? null } as any,
        },
      });

      throw err;
    }

    } finally {
      // Release the lock only if we still own it (Lua script is atomic).
      await this.redis.eval(
        `if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end`,
        1,
        lockKey,
        lockToken,
      );
    }
  }

  async getLabel(orderId: string) {
    const shipment = await this.prisma.shipment.findUnique({ where: { orderId } });
    if (!shipment) throw new NotFoundException('No shipment for this order');

    let signedLabelUrl: string | null = shipment.labelUrl;
    if (
      shipment.labelUrl &&
      !isCarrierHostedUrl(shipment.labelUrl) &&
      !shipment.labelUrl.startsWith('mock-label-')
    ) {
      signedLabelUrl = await this.storage.getShippingLabelSignedUrl(shipment.labelUrl);
    }

    return { labelUrl: signedLabelUrl, trackingNumber: shipment.trackingNumber };
  }

  // Runs weekly on Monday at 03:00 Warsaw time.
  // Deletes Supabase labels for CANCELLED/REFUNDED orders older than 30 days so
  // PII on shipping labels (name, phone, locker code) is not retained indefinitely.
  @Cron('0 3 * * 1', { timeZone: 'Europe/Warsaw' })
  async cleanupStaleShippingLabels(): Promise<void> {
    const acquired = await this.redis.set('cron:cleanup-stale-shipping-labels:lock', '1', 'EX', 82000, 'NX');
    if (!acquired) return;

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const staleShipments = await this.prisma.shipment.findMany({
      where: {
        labelUrl: { not: null },
        labelGeneratedAt: { lt: cutoff },
        order: {
          status: { in: [OrderStatus.CANCELLED, OrderStatus.REFUNDED] },
        },
      },
      select: { id: true, labelUrl: true },
    });

    if (staleShipments.length === 0) return;

    let deleted = 0;
    let failed = 0;

    for (const shipment of staleShipments) {
      if (!shipment.labelUrl || shipment.labelUrl.startsWith('mock-label-')) continue;
      try {
        await this.storage.deleteShippingLabel(shipment.labelUrl);
        await this.prisma.shipment.update({
          where: { id: shipment.id },
          data: { labelUrl: null },
        });
        deleted++;
      } catch (err) {
        failed++;
        this.logger.warn(`Failed to delete stale label for shipment ${shipment.id}: ${(err as Error).message}`);
      }
    }

    this.logger.log(`Stale shipping label cleanup: ${deleted} deleted, ${failed} failed`);
  }

  private getTrackingUrl(carrier: CarrierCode, trackingNumber: string): string {
    switch (carrier) {
      case CarrierCode.INPOST:
        return this.inpost.getTrackingUrl(trackingNumber);
      case CarrierCode.DHL:
        return this.dhl.getTrackingUrl(trackingNumber);
      case CarrierCode.GLS:
        return this.gls.getTrackingUrl(trackingNumber);
      case CarrierCode.DPD:
      case CarrierCode.DPD_COURIER:
        return this.dpd.getTrackingUrl(trackingNumber);
      default:
        throw new BadRequestException(`Unsupported carrier: ${carrier}`);
    }
  }
}
