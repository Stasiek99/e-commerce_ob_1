import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

interface InpostShipmentPayload {
  receiver: { name: string; phone: string; email: string };
  targetLockerCode: string;
  weightKg: number;
}

interface InpostShipmentResult {
  id: string;
  trackingNumber: string;
  labelUrl: string;
}

@Injectable()
export class InpostClient {
  private readonly client: AxiosInstance;
  private readonly organizationId: string;
  private readonly logger = new Logger(InpostClient.name);

  constructor(private readonly configService: ConfigService) {
    const sandbox = configService.get<string>('INPOST_SANDBOX') === 'true';
    const baseURL = sandbox
      ? 'https://api-shipx-pl.easypack24.net/v1'
      : 'https://api-shipx-pl.easypack24.net/v1';

    this.organizationId = configService.getOrThrow<string>('INPOST_ORGANIZATION_ID');

    this.client = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${configService.getOrThrow('INPOST_API_TOKEN')}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async createShipment(data: InpostShipmentPayload): Promise<InpostShipmentResult> {
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

    const labelUrl = await this.getLabelUrl(shipment.id);

    return {
      id: shipment.id,
      trackingNumber: shipment.tracking_number,
      labelUrl,
    };
  }

  async getLabelUrl(shipmentId: string): Promise<string> {
    const response = await this.client.get<ArrayBuffer>(
      `/shipments/${shipmentId}/label`,
      { responseType: 'arraybuffer', headers: { Accept: 'application/pdf' } },
    );
    // In production: upload PDF to Supabase Storage and return URL
    // For now return a placeholder to be implemented in phase 6
    return `label://${shipmentId}`;
  }

  getTrackingUrl(trackingNumber: string): string {
    return `https://inpost.pl/sledzenie-przesylek?number=${trackingNumber}`;
  }
}
