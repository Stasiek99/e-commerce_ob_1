import { Injectable, NotFoundException } from '@nestjs/common';
import { CarrierCode, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { InpostClient } from './carriers/inpost.client';
import { DhlClient } from './carriers/dhl.client';
import { GlsClient } from './carriers/gls.client';

const CARRIER_NAMES: Record<CarrierCode, string> = {
  [CarrierCode.INPOST]: 'InPost',
  [CarrierCode.DHL]: 'DHL Express',
  [CarrierCode.GLS]: 'GLS',
};

const SHIPPING_RATES = [
  {
    carrier: CarrierCode.INPOST,
    name: 'InPost Paczkomat',
    description: 'Dostawa do paczkomatu w 1-2 dni robocze',
    priceInCents: 1499,
    estimatedDays: '1-2 dni robocze',
  },
  {
    carrier: CarrierCode.DHL,
    name: 'DHL Kurier',
    description: 'Dostawa do drzwi w 1-2 dni robocze',
    priceInCents: 1999,
    estimatedDays: '1-2 dni robocze',
  },
  {
    carrier: CarrierCode.GLS,
    name: 'GLS Kurier',
    description: 'Dostawa do drzwi w 2-3 dni robocze',
    priceInCents: 1799,
    estimatedDays: '2-3 dni robocze',
  },
];

@Injectable()
export class ShippingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly inpost: InpostClient,
    private readonly dhl: DhlClient,
    private readonly gls: GlsClient,
  ) {}

  getShippingRates() {
    return SHIPPING_RATES;
  }

  async generateLabel(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { productVariant: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');

    const totalWeightKg = order.items.reduce((sum, item) => {
      const weight = item.productVariant.weight ?? 200;
      return sum + (weight * item.quantity) / 1000;
    }, 0.5); // minimum 0.5kg

    const receiverName = `${order.snapshotFirstName} ${order.snapshotLastName}`;

    let trackingNumber: string;
    let labelUrl: string;
    let shipmentId: string | undefined;
    let targetLockerCode: string | undefined;
    let rawResponse: unknown;

    switch (order.carrierCode) {
      case CarrierCode.INPOST: {
        const result = await this.inpost.createShipment({
          receiver: {
            name: receiverName,
            phone: order.snapshotPhone,
            email: order.snapshotEmail,
          },
          targetLockerCode: order.inpostLockerCode!,
          weightKg: totalWeightKg,
        });
        trackingNumber = result.trackingNumber;
        labelUrl = result.labelUrl;
        shipmentId = result.id;
        targetLockerCode = order.inpostLockerCode ?? undefined;
        rawResponse = result;
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
        shippedAt: new Date(),
        rawCarrierResponse: rawResponse as any,
      },
      update: {
        status: ShipmentStatus.LABEL_GENERATED,
        trackingNumber,
        labelUrl,
        shipmentId,
        shippedAt: new Date(),
        rawCarrierResponse: rawResponse as any,
      },
    });

    const trackingUrl = this.getTrackingUrl(order.carrierCode, trackingNumber);

    // Email notification (fire-and-forget)
    this.emailService
      .sendShippingNotification({
        to: order.snapshotEmail,
        orderNumber: order.orderNumber,
        firstName: order.snapshotFirstName,
        carrier: CARRIER_NAMES[order.carrierCode],
        trackingNumber,
        trackingUrl,
      })
      // Fire-and-forget: EmailService.send already logs + reports to Sentry.
      .catch(() => undefined);

    return shipment;
  }

  async getLabel(orderId: string) {
    const shipment = await this.prisma.shipment.findUnique({ where: { orderId } });
    if (!shipment) throw new NotFoundException('No shipment for this order');
    return { labelUrl: shipment.labelUrl, trackingNumber: shipment.trackingNumber };
  }

  private getTrackingUrl(carrier: CarrierCode, trackingNumber: string): string {
    switch (carrier) {
      case CarrierCode.INPOST:
        return this.inpost.getTrackingUrl(trackingNumber);
      case CarrierCode.DHL:
        return this.dhl.getTrackingUrl(trackingNumber);
      case CarrierCode.GLS:
        return this.gls.getTrackingUrl(trackingNumber);
    }
  }
}
