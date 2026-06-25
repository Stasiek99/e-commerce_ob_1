import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { CarrierTrackingResult, deriveMockTrackingStatus } from './carrier-tracking.types';

interface GlsShipmentPayload {
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

interface GlsShipmentResult {
  trackingNumber: string;
  parcelId: string;
  labelUrl: string;
}

@Injectable()
export class GlsClient {
  private readonly client: AxiosInstance;
  private readonly senderId: string;
  private readonly logger = new Logger(GlsClient.name);
  private readonly mockEnabled: boolean;
  private readonly mockInTransitAfterMs: number;
  private readonly mockDeliveredAfterMs: number;

  constructor(configService: ConfigService) {
    this.mockEnabled = configService.get<string>('GLS_MOCK_ENABLED') === 'true';

    this.senderId = this.mockEnabled ? '' : configService.getOrThrow<string>('GLS_SENDER_ID');

    this.mockInTransitAfterMs = configService.get<number>('SHIPMENT_MOCK_IN_TRANSIT_AFTER_MINUTES', 2) * 60_000;
    this.mockDeliveredAfterMs = configService.get<number>('SHIPMENT_MOCK_DELIVERED_AFTER_MINUTES', 5) * 60_000;

    this.client = axios.create({
      baseURL: 'https://adeplus.gls-poland.com/adeplus/pm1/ade_webapi2.php',
      timeout: 15_000,
      auth: {
        username: this.mockEnabled ? '' : configService.getOrThrow<string>('GLS_USERNAME'),
        password: this.mockEnabled ? '' : configService.getOrThrow<string>('GLS_PASSWORD'),
      },
      headers: { 'Content-Type': 'application/json' },
    });

    if (this.mockEnabled) {
      this.logger.warn('⚠️  MOCK GLS CLIENT ENABLED - No real shipments will be created.');
    }
  }

  async createShipment(data: GlsShipmentPayload): Promise<GlsShipmentResult> {
    if (this.mockEnabled) {
      return this.mockCreateShipment(data);
    }

    const payload = {
      Shipment: {
        ShipmentDate: new Date().toISOString().split('T')[0],
        References: [data.reference],
        Consignee: {
          Name1: data.receiver.name,
          Street1: data.receiver.street,
          City: data.receiver.city,
          ZIPCode: data.receiver.postalCode,
          CountryIsoCode: data.receiver.country,
          Phone: data.receiver.phone,
          Email: data.receiver.email,
        },
        Parcels: [{ Weight: data.weightKg }],
        Sender: { ContactID: this.senderId },
      },
    };

    let response: Awaited<ReturnType<typeof this.client.post<any>>>;
    try {
      response = await this.client.post<any>('?wsdl', payload);
    } catch (err) {
      if (axios.isAxiosError(err) && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT')) {
        throw new ServiceUnavailableException('GLS API timed out');
      }
      throw err;
    }
    const parcel = response.data?.Parcel?.[0];

    this.logger.log(`GLS shipment created: ${parcel?.TrackID}`);

    return {
      trackingNumber: parcel?.TrackID ?? '',
      parcelId: parcel?.ParcelNumber ?? '',
      labelUrl: '',
    };
  }

  /**
   * Downloads the shipment label PDF from the GLS ADE API using the ParcelNumber
   * returned by createShipment. Returns null in mock mode.
   */
  async fetchLabelPdf(parcelNumber: string): Promise<Buffer | null> {
    if (this.mockEnabled) {
      this.logger.log(`[MOCK] Skipping PDF download for GLS parcel ${parcelNumber}`);
      return null;
    }

    let response: Awaited<ReturnType<typeof this.client.post<ArrayBuffer>>>;
    try {
      response = await this.client.post<ArrayBuffer>(
        '?labels',
        { Parcels: [parcelNumber] },
        { responseType: 'arraybuffer', headers: { Accept: 'application/pdf' } },
      );
    } catch (err) {
      if (axios.isAxiosError(err) && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT')) {
        throw new ServiceUnavailableException('GLS label download timed out');
      }
      throw err;
    }

    return Buffer.from(response.data);
  }

  getTrackingUrl(trackingNumber: string): string {
    return `https://gls-group.eu/PL/pl/sledzenie-paczek?match=${trackingNumber}`;
  }

  /**
   * Polls the GLS ADE WebAPI2 for the parcel's latest tracking event. GLS Poland's
   * ADE-Plus API is account-gated with no public field reference (same constraint as
   * createShipment/fetchLabelPdf above) — the field/status-code shapes below are a
   * best-effort guess mirroring this file's existing response-shape assumptions.
   * Confirm against real account docs before relying on this in production.
   */
  async getTrackingStatus(parcelId: string, labelGeneratedAt: Date): Promise<CarrierTrackingResult | null> {
    if (this.mockEnabled) {
      return this.mockGetTrackingStatus(labelGeneratedAt);
    }

    let response: Awaited<ReturnType<typeof this.client.post<any>>>;
    try {
      response = await this.client.post<any>('?track', { Parcels: [parcelId] });
    } catch (err) {
      if (axios.isAxiosError(err) && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT')) {
        throw new ServiceUnavailableException('GLS tracking lookup timed out');
      }
      throw err;
    }

    const event = response.data?.Parcel?.[0]?.Events?.[0];
    const code = event?.StatusCode as string | undefined;
    switch (code) {
      case 'DELIVERED':
        return { status: 'DELIVERED', deliveredAt: new Date(), raw: event };
      case 'RETURNED':
        return { status: 'RETURNED', raw: event };
      case 'UNDELIVERED':
      case 'CANCELED':
        return { status: 'FAILED', raw: event };
      case 'IN_TRANSIT':
      case 'OUT_FOR_DELIVERY':
      case 'PICKED_UP':
        return { status: 'IN_TRANSIT', raw: event };
      default:
        return null;
    }
  }

  private mockGetTrackingStatus(labelGeneratedAt: Date): CarrierTrackingResult | null {
    const elapsedMs = Date.now() - labelGeneratedAt.getTime();
    const status = deriveMockTrackingStatus(elapsedMs, this.mockInTransitAfterMs, this.mockDeliveredAfterMs);
    if (!status) return null;
    this.logger.log(`[MOCK] GLS tracking status derived from elapsed time: ${status}`);
    return status === 'DELIVERED' ? { status, deliveredAt: new Date() } : { status };
  }

  private mockCreateShipment(data: GlsShipmentPayload): GlsShipmentResult {
    const trackingNumber = `MOCK_GLS_${Math.random().toString(36).substring(2, 12).toUpperCase()}`;
    const parcelId = Math.random().toString().substring(2, 12);
    const labelUrl = `mock-label-gls-${trackingNumber}.pdf`;
    this.logger.log(
      `[MOCK] GLS shipment created: tracking=${trackingNumber}, ref=${data.reference}`,
    );
    return { trackingNumber, parcelId, labelUrl };
  }
}
