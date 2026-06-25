import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { CarrierTrackingResult, deriveMockTrackingStatus } from './carrier-tracking.types';

interface DpdShipmentPayload {
  receiver: {
    name: string;
    street: string;
    city: string;
    postalCode: string;
    country: string;
    phone: string;
    email: string;
  };
  weightKg: number;
  reference: string;
}

interface DpdShipmentResult {
  trackingNumber: string;
  labelUrl: string;
}

@Injectable()
export class DpdClient {
  private readonly client: AxiosInstance;
  private readonly senderId: string;
  private readonly logger = new Logger(DpdClient.name);
  private readonly mockEnabled: boolean;
  private readonly mockInTransitAfterMs: number;
  private readonly mockDeliveredAfterMs: number;

  constructor(configService: ConfigService) {
    this.mockEnabled = configService.get<string>('DPD_MOCK_ENABLED') === 'true';

    this.senderId = this.mockEnabled ? '' : configService.getOrThrow<string>('DPD_SENDER_ID');

    this.mockInTransitAfterMs = configService.get<number>('SHIPMENT_MOCK_IN_TRANSIT_AFTER_MINUTES', 2) * 60_000;
    this.mockDeliveredAfterMs = configService.get<number>('SHIPMENT_MOCK_DELIVERED_AFTER_MINUTES', 5) * 60_000;

    this.client = axios.create({
      baseURL: 'https://cig.dpd.com.pl/services/open/v1',
      timeout: 15_000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.mockEnabled ? '' : configService.getOrThrow<string>('DPD_API_KEY')}`,
      },
    });

    if (this.mockEnabled) {
      this.logger.warn('⚠️  MOCK DPD CLIENT ENABLED - No real shipments will be created.');
    }
  }

  async createShipment(data: DpdShipmentPayload): Promise<DpdShipmentResult> {
    if (this.mockEnabled) {
      return this.mockCreateShipment(data);
    }

    const payload = {
      shipmentDate: new Date().toISOString().split('T')[0],
      sender: { id: this.senderId },
      receiver: {
        name: data.receiver.name,
        street: data.receiver.street,
        city: data.receiver.city,
        postalCode: data.receiver.postalCode,
        countryCode: data.receiver.country,
        phone: data.receiver.phone,
        email: data.receiver.email,
      },
      parcels: [
        {
          weight: Math.max(1, Math.round(data.weightKg * 100) / 100),
          reference: data.reference,
        },
      ],
      services: { dox: false },
    };

    let response: Awaited<ReturnType<typeof this.client.post<any>>>;
    try {
      response = await this.client.post<any>('/shipment', payload);
    } catch (err) {
      if (axios.isAxiosError(err) && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT')) {
        throw new ServiceUnavailableException('DPD API timed out');
      }
      throw err;
    }
    const result = response.data;

    this.logger.log(`DPD shipment created: ${result.trackingNumber}`);

    return {
      trackingNumber: result.trackingNumber ?? result.parcels?.[0]?.waybill ?? '',
      labelUrl: result.labelUrl ?? result.parcels?.[0]?.labelUrl ?? '',
    };
  }

  getTrackingUrl(trackingNumber: string): string {
    return `https://tracktrace.dpd.com.pl/findPackage?q=${trackingNumber}`;
  }

  /**
   * Polls DPD Polska's open API for the parcel's latest tracking event. Like GLS above,
   * this API is account-gated with no public field reference — the field/status-code
   * shapes below are a best-effort guess mirroring this file's existing createShipment
   * response-shape assumptions. Confirm against real account docs before relying on
   * this in production.
   */
  async getTrackingStatus(trackingNumber: string, labelGeneratedAt: Date): Promise<CarrierTrackingResult | null> {
    if (this.mockEnabled) {
      return this.mockGetTrackingStatus(labelGeneratedAt);
    }

    let response: Awaited<ReturnType<typeof this.client.get<any>>>;
    try {
      response = await this.client.get<any>(`/parcels/${trackingNumber}/events`);
    } catch (err) {
      if (axios.isAxiosError(err) && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT')) {
        throw new ServiceUnavailableException('DPD tracking lookup timed out');
      }
      throw err;
    }

    const latestEvent = response.data?.events?.[0] ?? response.data?.parcels?.[0]?.events?.[0];
    const code = latestEvent?.statusCode as string | undefined;
    switch (code) {
      case 'DELIVERED':
        return { status: 'DELIVERED', deliveredAt: new Date(), raw: latestEvent };
      case 'RETURNED_TO_SENDER':
        return { status: 'RETURNED', raw: latestEvent };
      case 'UNDELIVERED':
      case 'CANCELED':
        return { status: 'FAILED', raw: latestEvent };
      case 'IN_TRANSIT':
      case 'OUT_FOR_DELIVERY':
      case 'COLLECTED':
        return { status: 'IN_TRANSIT', raw: latestEvent };
      default:
        return null;
    }
  }

  private mockGetTrackingStatus(labelGeneratedAt: Date): CarrierTrackingResult | null {
    const elapsedMs = Date.now() - labelGeneratedAt.getTime();
    const status = deriveMockTrackingStatus(elapsedMs, this.mockInTransitAfterMs, this.mockDeliveredAfterMs);
    if (!status) return null;
    this.logger.log(`[MOCK] DPD tracking status derived from elapsed time: ${status}`);
    return status === 'DELIVERED' ? { status, deliveredAt: new Date() } : { status };
  }

  private mockCreateShipment(data: DpdShipmentPayload): DpdShipmentResult {
    const trackingNumber = `MOCK_DPD_${Math.random().toString(36).substring(2, 12).toUpperCase()}`;
    const labelUrl = `mock-label-dpd-${trackingNumber}.pdf`;
    this.logger.log(
      `[MOCK] DPD shipment created: tracking=${trackingNumber}, ref=${data.reference}, receiver=${data.receiver.name}`,
    );
    return { trackingNumber, labelUrl };
  }
}
