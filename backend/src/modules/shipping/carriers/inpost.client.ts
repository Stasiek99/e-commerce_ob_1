import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';

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

  constructor(private readonly configService: ConfigService) {
    this.mockEnabled =
      configService.get<string>('INPOST_MOCK_ENABLED') === 'true' ||
      !configService.get<string>('INPOST_ORGANIZATION_ID');

    const sandbox = configService.get<string>('INPOST_SANDBOX') === 'true';
    const baseURL = sandbox
      ? 'https://sandbox-api-shipx-pl.easypack24.net/v1'
      : 'https://api-shipx-pl.easypack24.net/v1';

    this.organizationId = this.mockEnabled ? '' : configService.getOrThrow<string>('INPOST_ORGANIZATION_ID');

    this.client = axios.create({
      baseURL,
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

    const response = await this.client.post<any>(
      `/organizations/${this.organizationId}/shipments`,
      payload,
    );

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

    const response = await this.client.get<ArrayBuffer>(
      `/organizations/${this.organizationId}/shipments/${shipmentId}/label`,
      { responseType: 'arraybuffer', headers: { Accept: 'application/pdf' } },
    );

    return Buffer.from(response.data);
  }

  getTrackingUrl(trackingNumber: string): string {
    return `https://inpost.pl/sledzenie-przesylek?number=${trackingNumber}`;
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
