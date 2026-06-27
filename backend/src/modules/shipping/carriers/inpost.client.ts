import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { CarrierTrackingResult, deriveMockTrackingStatus } from './carrier-tracking.types';

interface InpostShipmentPayload {
  receiver: { name: string; phone: string; email: string };
  targetLockerCode: string;
  weightKg: number;
}

interface InpostShipmentResult {
  id: string;
  trackingNumber: string;
}

interface MockShipment {
  id: string;
  trackingNumber: string;
  lockerCode: string;
  createdAt: Date;
}

@Injectable()
export class InpostClient {
  private readonly client: AxiosInstance;
  private readonly organizationId: string;
  private readonly logger = new Logger(InpostClient.name);
  private readonly mockEnabled: boolean;
  private readonly mockShipments = new Map<string, MockShipment>();
  private readonly mockInTransitAfterMs: number;
  private readonly mockDeliveredAfterMs: number;

  constructor(private readonly configService: ConfigService) {
    // Only the explicit flag enables mock mode. The previous OR clause
    // (!INPOST_ORGANIZATION_ID) silently activated mocks when the env var was
    // absent, writing fake tracking URLs to the DB in production.
    this.mockEnabled = configService.get<string>('INPOST_MOCK_ENABLED') === 'true';

    const sandbox = configService.get<string>('INPOST_SANDBOX') === 'true';
    const baseURL = sandbox
      ? 'https://sandbox-api-shipx-pl.easypack24.net/v1'
      : 'https://api-shipx-pl.easypack24.net/v1';

    this.organizationId = this.mockEnabled ? '' : configService.getOrThrow<string>('INPOST_ORGANIZATION_ID');

    this.mockInTransitAfterMs = configService.get<number>('SHIPMENT_MOCK_IN_TRANSIT_AFTER_MINUTES', 2) * 60_000;
    this.mockDeliveredAfterMs = configService.get<number>('SHIPMENT_MOCK_DELIVERED_AFTER_MINUTES', 5) * 60_000;

    this.client = axios.create({
      baseURL,
      timeout: 15_000,
      headers: {
        Authorization: `Bearer ${this.mockEnabled ? '' : configService.getOrThrow('INPOST_API_TOKEN')}`,
        'Content-Type': 'application/json',
      },
    });

    if (this.mockEnabled) {
      this.logger.warn(
        '⚠️  MOCK INPOST CLIENT ENABLED - This is for testing only!',
      );
      this.logger.warn(
        'No real shipments will be created. All tracking numbers are mock values.',
      );
    }
  }

  async createShipment(data: InpostShipmentPayload): Promise<InpostShipmentResult> {
    if (this.mockEnabled) {
      return this.mockCreateShipment(data);
    }

    const payload = {
      receiver: {
        name: data.receiver.name,
        phone: data.receiver.phone,
        email: data.receiver.email,
      },
      service: 'inpost_locker_standard',
      custom_attributes: {
        target_point: data.targetLockerCode,
        sending_method: 'dispatch_order',
      },
      parcels: [
        {
          weight: {
            amount: Math.max(1, Math.round(data.weightKg * 10) / 10),
            unit: 'kg',
          },
          dimensions: { length: 20, width: 15, height: 10, unit: 'cm' },
        },
      ],
    };

    let response: Awaited<ReturnType<typeof this.client.post<any>>>;
    try {
      response = await this.client.post<any>(
        `/organizations/${this.organizationId}/shipments`,
        payload,
      );
    } catch (err) {
      if (axios.isAxiosError(err) && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT')) {
        throw new ServiceUnavailableException('InPost API timed out');
      }
      throw err;
    }

    const shipment = response.data;
    this.logger.log(`InPost shipment created: ${shipment.id}`);

    return {
      id: shipment.id,
      trackingNumber: shipment.tracking_number,
    };
  }

  /**
   * Downloads the shipment label PDF from InPost API.
   * Returns null in mock mode (no real PDF available).
   */
  async fetchLabelPdf(shipmentId: string): Promise<Buffer | null> {
    if (this.mockEnabled) {
      this.logger.log(`[MOCK] Skipping PDF download for ${shipmentId}`);
      return null;
    }

    let response: Awaited<ReturnType<typeof this.client.get<ArrayBuffer>>>;
    try {
      response = await this.client.get<ArrayBuffer>(
        `/organizations/${this.organizationId}/shipments/${shipmentId}/label`,
        { responseType: 'arraybuffer', headers: { Accept: 'application/pdf' } },
      );
    } catch (err) {
      if (axios.isAxiosError(err) && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT')) {
        throw new ServiceUnavailableException('InPost label download timed out');
      }
      throw err;
    }

    return Buffer.from(response.data);
  }

  getTrackingUrl(trackingNumber: string): string {
    return `https://inpost.pl/sledzenie-przesylek?number=${trackingNumber}`;
  }

  /**
   * Polls ShipX for the shipment's current status. Real-branch mapping is against
   * InPost's documented ShipX status enum (confirmed against InPost's developer docs,
   * https://dokumentacja-inpost.atlassian.net/wiki/spaces/PL/pages/18153478, 2026-06).
   * Returns null when the carrier hasn't reported any status this mapping needs to act
   * on yet (e.g. still "created"/"confirmed") — callers should leave the shipment as-is.
   */
  async getTrackingStatus(shipmentId: string, labelGeneratedAt: Date): Promise<CarrierTrackingResult | null> {
    if (this.mockEnabled) {
      return this.mockGetTrackingStatus(labelGeneratedAt);
    }

    let response: Awaited<ReturnType<typeof this.client.get<any>>>;
    try {
      response = await this.client.get<any>(
        `/organizations/${this.organizationId}/shipments/${shipmentId}`,
      );
    } catch (err) {
      if (axios.isAxiosError(err) && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT')) {
        throw new ServiceUnavailableException('InPost tracking lookup timed out');
      }
      throw err;
    }

    return this.mapShipxStatus(response.data?.status, response.data);
  }

  private mapShipxStatus(status: string | undefined, raw: unknown): CarrierTrackingResult | null {
    switch (status) {
      case 'delivered':
        return { status: 'DELIVERED', deliveredAt: new Date(), raw };
      case 'returned_to_sender':
        return { status: 'RETURNED', raw };
      case 'canceled':
      case 'undelivered':
      case 'rejected_by_receiver':
        return { status: 'FAILED', raw };
      case 'dispatched_by_sender':
      case 'taken_by_courier':
      case 'adopted_at_source_branch':
      case 'sent_from_source_branch':
      case 'adopted_at_sorting_center':
      case 'sent_from_sorting_center':
      case 'adopted_at_target_branch':
      case 'out_for_delivery':
      case 'ready_to_pickup':
      case 'ready_to_pickup_from_pok':
      case 'pickup_reminder_sent':
      case 'avizo':
      case 'readdressed':
      case 'delay_in_delivery':
        return { status: 'IN_TRANSIT', raw };
      default:
        // created / offers_prepared / offer_selected / confirmed / claimed / anything
        // unrecognized — no externally-visible movement yet worth writing.
        return null;
    }
  }

  private mockGetTrackingStatus(labelGeneratedAt: Date): CarrierTrackingResult | null {
    const elapsedMs = Date.now() - labelGeneratedAt.getTime();
    const status = deriveMockTrackingStatus(elapsedMs, this.mockInTransitAfterMs, this.mockDeliveredAfterMs);
    if (!status) return null;
    this.logger.log(`[MOCK] InPost tracking status derived from elapsed time: ${status}`);
    return status === 'DELIVERED' ? { status, deliveredAt: new Date() } : { status };
  }

  // Mock implementation methods
  private mockCreateShipment(data: InpostShipmentPayload): InpostShipmentResult {
    const shipmentId = `MOCK_INPOST_${uuidv4().replace(/-/g, '').substring(0, 20).toUpperCase()}`;
    const trackingNumber = `${data.targetLockerCode}${Math.random().toString().substring(2, 12)}`;

    const shipment: MockShipment = {
      id: shipmentId,
      trackingNumber,
      lockerCode: data.targetLockerCode,
      createdAt: new Date(),
    };

    this.mockShipments.set(shipmentId, shipment);

    this.logger.log(
      `[MOCK] InPost shipment created: id=${shipmentId}, tracking=${trackingNumber}, locker=${data.targetLockerCode}`,
    );

    return { id: shipmentId, trackingNumber };
  }
}
