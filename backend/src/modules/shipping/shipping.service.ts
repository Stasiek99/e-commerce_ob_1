import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
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
import { CarrierTrackingResult } from './carriers/carrier-tracking.types';

// Shipments still being tracked — anything outside this set is terminal (delivered,
// failed, returned, or never got a label) and no longer worth polling the carrier for.
const TRACKED_SHIPMENT_STATUSES: ShipmentStatus[] = [ShipmentStatus.LABEL_GENERATED, ShipmentStatus.IN_TRANSIT];

type TrackedShipment = {
  id: string;
  orderId: string;
  carrierCode: CarrierCode;
  status: ShipmentStatus;
  shipmentId: string | null;
  trackingNumber: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  labelGeneratedAt: Date | null;
  createdAt: Date;
  order: { orderNumber: string };
};

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
    private readonly configService: ConfigService,
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

    // A populated shipmentId on a LABEL_ERROR row means the carrier already created
    // a real, billable shipment on a previous attempt — the failure happened
    // afterward (e.g. the Supabase label upload, or persisting the result). Reuse
    // those identifiers below instead of calling createShipment() again, which
    // would create a second carrier-side shipment under the same order. Only call
    // createShipment() again when no shipmentId was ever recorded (the carrier was
    // never reached, or its response never arrived).
    const resume = existing?.status === ShipmentStatus.LABEL_ERROR && existing.shipmentId ? existing : null;
    if (resume) {
      this.logger.warn(
        `Resuming label generation for order ${orderId} from preserved shipment ${resume.shipmentId} — skipping createShipment`,
      );
    }

    const totalWeightKg = order.items.reduce((sum, item) => {
      const weight = item.productVariant.weight ?? 200;
      return sum + (weight * item.quantity) / 1000;
    }, 0.5);

    const receiverName = `${order.snapshotFirstName} ${order.snapshotLastName}`;

    if (!Object.values(CarrierCode).includes(order.carrierCode)) {
      throw new BadRequestException(`Unsupported carrier: ${order.carrierCode}`);
    }

    let trackingNumber: string | undefined = resume?.trackingNumber ?? undefined;
    let labelUrl: string | undefined = resume?.labelUrl ?? undefined;
    let shipmentId: string | undefined = resume?.shipmentId ?? undefined;
    let targetLockerCode: string | undefined;
    let rawResponse: unknown;

    try {

      switch (order.carrierCode) {
        case CarrierCode.INPOST: {
          if (!shipmentId) {
            const result = await this.inpost.createShipment({
              receiver: { name: receiverName, phone: order.snapshotPhone, email: order.snapshotEmail },
              targetLockerCode: order.inpostLockerCode!,
              weightKg: totalWeightKg,
            });
            shipmentId = result.id;
            trackingNumber = result.trackingNumber;
            this.assertTrackingNumber(trackingNumber, order.carrierCode);
            rawResponse = result;
          }
          targetLockerCode = order.inpostLockerCode ?? undefined;

          if (!labelUrl) {
            const pdfBuffer = await this.inpost.fetchLabelPdf(shipmentId!);
            if (pdfBuffer) {
              labelUrl = await this.storage.uploadShippingLabel(
                pdfBuffer,
                `inpost-${shipmentId}.pdf`,
              );
              this.logger.log(`Label uploaded to Supabase for shipment ${shipmentId}`);
            } else {
              // Mock mode — no real PDF
              labelUrl = `mock-label-${shipmentId}.pdf`;
            }
          }
          break;
        }
        case CarrierCode.DHL: {
          if (!shipmentId) {
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
            this.assertTrackingNumber(trackingNumber, order.carrierCode);
            labelUrl = result.labelUrl;
            // DHL has no separate fetch-label step — the label comes back inline
            // with createShipment, so the tracking number doubles as the
            // identifier that guards against re-creating the shipment on retry.
            shipmentId = result.trackingNumber;
            rawResponse = result;
          }
          break;
        }
        case CarrierCode.GLS: {
          let parcelId = shipmentId;
          if (!parcelId) {
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
            this.assertTrackingNumber(trackingNumber, order.carrierCode);
            parcelId = result.parcelId;
            shipmentId = result.parcelId;
            rawResponse = result;
          }

          if (!labelUrl) {
            const pdfBuffer = await this.gls.fetchLabelPdf(parcelId);
            if (pdfBuffer) {
              labelUrl = await this.storage.uploadShippingLabel(
                pdfBuffer,
                `gls-${parcelId}.pdf`,
              );
              this.logger.log(`Label uploaded to Supabase for GLS parcel ${parcelId}`);
            } else {
              labelUrl = `mock-label-gls-${parcelId}.pdf`;
            }
          }
          break;
        }
        case CarrierCode.DPD:
        case CarrierCode.DPD_COURIER: {
          if (!shipmentId) {
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
            this.assertTrackingNumber(trackingNumber, order.carrierCode);
            labelUrl = result.labelUrl;
            // DPD has no separate fetch-label step either — see DHL comment above.
            shipmentId = result.trackingNumber;
            rawResponse = result;
          }
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

      // trackingNumber is always populated by this point: either resumed from a
      // preserved LABEL_ERROR row, or freshly assigned by the exhaustive switch above.
      const trackingUrl = this.getTrackingUrl(order.carrierCode, trackingNumber!);

      this.emailService
        .sendShippingNotification({
          to: order.snapshotEmail,
          orderNumber: order.orderNumber,
          firstName: order.snapshotFirstName,
          carrier: CARRIER_NAMES[order.carrierCode],
          trackingNumber: trackingNumber!,
          trackingUrl,
        })
        .catch((err) => this.logger.warn('Shipping notification email failed', err));

      return shipment;
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`Label generation failed for order ${orderId}: ${message}`);

      // Preserve any carrier identifiers (and the label, if it was already
      // fetched/uploaded) that were committed before the failure. Without these
      // fields a support engineer has no way to locate the shipment on the
      // carrier's dashboard, and a retry would have no choice but to call
      // createShipment() again — creating a second real, billable shipment.
      await this.prisma.shipment.upsert({
        where: { orderId },
        create: {
          orderId,
          carrierCode: order.carrierCode,
          status: ShipmentStatus.LABEL_ERROR,
          shipmentId: shipmentId ?? null,
          trackingNumber: trackingNumber ?? null,
          labelUrl: labelUrl ?? null,
          rawCarrierResponse: { error: message, carrierResponse: rawResponse ?? null } as any,
        },
        update: {
          status: ShipmentStatus.LABEL_ERROR,
          shipmentId: shipmentId ?? null,
          trackingNumber: trackingNumber ?? null,
          labelUrl: labelUrl ?? null,
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
      if (signedLabelUrl === null) {
        // Object already gone from Supabase (orphaned by a crash mid-cleanup) —
        // self-heal the stale reference instead of returning it as still-valid.
        await this.prisma.shipment.update({
          where: { id: shipment.id },
          data: { labelUrl: null },
        }).catch((err) => this.logger.warn(`Failed to self-heal orphaned labelUrl for shipment ${shipment.id}: ${(err as Error).message}`));
      }
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
      // Carrier-hosted DHL/DPD URLs are never Supabase object keys — passing one to
      // deleteShippingLabel() is a silent no-op (Supabase's remove() doesn't error on
      // a non-matching key), so skip them rather than nulling labelUrl with nothing
      // actually deleted. Retention of those URLs is the carrier's own policy.
      if (!shipment.labelUrl || shipment.labelUrl.startsWith('mock-label-') || isCarrierHostedUrl(shipment.labelUrl)) continue;
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

  // Runs every 15 minutes. Closes the "carrier-blind" gap documented in
  // docs/business-process-model.md §3/A5: IN_TRANSIT/FAILED/RETURNED were dead enum
  // values with no writer, and Shipment.deliveredAt — the sole authoritative source
  // for the Art. 27 UoK 14-day withdrawal clock (see ReturnsService.create) — was only
  // ever set by an admin manually clicking "Delivered", never by an actual carrier
  // signal. This polls each carrier's own tracking status and writes the result.
  @Cron('*/15 * * * *')
  async pollShipmentTracking(): Promise<void> {
    // TTL comfortably covers the 15-minute interval so a slow run can't overlap the next.
    const acquired = await this.redis.set('cron:poll-shipment-tracking:lock', '1', 'EX', 800, 'NX');
    if (!acquired) return;

    const shipments = await this.prisma.shipment.findMany({
      where: {
        status: { in: TRACKED_SHIPMENT_STATUSES },
        order: { status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REFUNDED] } },
      },
      select: {
        id: true,
        orderId: true,
        carrierCode: true,
        status: true,
        shipmentId: true,
        trackingNumber: true,
        shippedAt: true,
        deliveredAt: true,
        labelGeneratedAt: true,
        createdAt: true,
        order: { select: { orderNumber: true } },
      },
    });

    if (shipments.length === 0) return;

    let updated = 0;
    let failed = 0;

    for (const shipment of shipments) {
      try {
        const result = await this.fetchCarrierTrackingStatus(shipment);
        if (result && result.status !== shipment.status) {
          await this.applyTrackingUpdate(shipment, result);
          updated++;
        }
      } catch (err) {
        failed++;
        this.logger.warn(
          `Tracking poll failed for shipment ${shipment.id} (order ${shipment.order.orderNumber}): ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(`Shipment tracking poll: ${shipments.length} checked, ${updated} updated, ${failed} failed`);
  }

  private async fetchCarrierTrackingStatus(shipment: TrackedShipment): Promise<CarrierTrackingResult | null> {
    const since = shipment.labelGeneratedAt ?? shipment.createdAt;
    switch (shipment.carrierCode) {
      case CarrierCode.INPOST:
        return shipment.shipmentId ? this.inpost.getTrackingStatus(shipment.shipmentId, since) : null;
      case CarrierCode.DHL:
        return shipment.trackingNumber ? this.dhl.getTrackingStatus(shipment.trackingNumber, since) : null;
      case CarrierCode.GLS:
        return shipment.shipmentId ? this.gls.getTrackingStatus(shipment.shipmentId, since) : null;
      case CarrierCode.DPD:
      case CarrierCode.DPD_COURIER:
        return shipment.trackingNumber ? this.dpd.getTrackingStatus(shipment.trackingNumber, since) : null;
      default:
        return null;
    }
  }

  private async applyTrackingUpdate(shipment: TrackedShipment, result: CarrierTrackingResult): Promise<void> {
    const newStatus = result.status as ShipmentStatus;

    if (newStatus === ShipmentStatus.DELIVERED) {
      // Authoritative Art. 27 UoK delivery timestamp, sourced from the carrier's own
      // signal. Guarded on deliveredAt: null — same guard OrdersService.updateStatus
      // already uses for its own (admin-driven) write — so whichever of the two writers
      // gets there first wins, and the other becomes a harmless no-op rather than
      // clobbering the first real delivery date.
      const stamped = await this.prisma.shipment.updateMany({
        where: { id: shipment.id, deliveredAt: null },
        data: {
          status: ShipmentStatus.DELIVERED,
          deliveredAt: result.deliveredAt ?? new Date(),
          rawCarrierResponse: (result.raw ?? undefined) as any,
        },
      });
      if (stamped.count === 0) {
        await this.prisma.shipment.update({
          where: { id: shipment.id },
          data: { status: ShipmentStatus.DELIVERED },
        });
      }
      return;
    }

    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        status: newStatus,
        ...(newStatus === ShipmentStatus.IN_TRANSIT && !shipment.shippedAt ? { shippedAt: new Date() } : {}),
        rawCarrierResponse: (result.raw ?? undefined) as any,
      },
    });

    if (newStatus === ShipmentStatus.FAILED || newStatus === ShipmentStatus.RETURNED) {
      const alertStatus = newStatus === ShipmentStatus.FAILED ? 'FAILED' : 'RETURNED';
      this.alertShipmentException(shipment.orderId, shipment.order.orderNumber, alertStatus).catch((err) =>
        this.logger.warn(`Shipment exception alert failed for order ${shipment.order.orderNumber}: ${(err as Error).message}`),
      );
    }
  }

  // A failed/returned parcel needs a human decision (re-ship vs. refund) — this only
  // surfaces it, it never mutates Order.status itself. Mirrors the dispute/payout
  // alert pattern in PaymentsService (sendDisputeAlert/sendPayoutFailedAlert).
  private async alertShipmentException(
    orderId: string,
    orderNumber: string,
    status: 'FAILED' | 'RETURNED',
  ): Promise<void> {
    const adminEmail =
      this.configService.get<string>('ADMIN_ALERT_EMAIL') || this.configService.get<string>('EMAIL_FROM');
    if (!adminEmail) return;

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', '');
    await this.emailService.sendShipmentExceptionAlert({
      to: adminEmail,
      orderNumber,
      status,
      adminUrl: frontendUrl ? `${frontendUrl}/admin/orders/${orderId}` : undefined,
    });
  }

  // Catches a malformed/changed carrier response shape immediately, so it fails
  // loudly into the existing LABEL_ERROR path instead of persisting LABEL_GENERATED
  // with a dead tracking link mailed to the customer.
  private assertTrackingNumber(trackingNumber: string | undefined, carrier: CarrierCode): void {
    if (!trackingNumber) {
      throw new Error(`${CARRIER_NAMES[carrier]} returned no trackingNumber for the shipment`);
    }
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
