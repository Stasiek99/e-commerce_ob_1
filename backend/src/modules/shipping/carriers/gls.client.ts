import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

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

  constructor(configService: ConfigService) {
    this.mockEnabled =
      configService.get<string>('GLS_MOCK_ENABLED') === 'true' ||
      !configService.get<string>('GLS_SENDER_ID');

    this.senderId = this.mockEnabled ? '' : configService.getOrThrow<string>('GLS_SENDER_ID');

    this.client = axios.create({
      baseURL: 'https://adeplus.gls-poland.com/adeplus/pm1/ade_webapi2.php',
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

    const response = await this.client.post<any>('?wsdl', payload);
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

    const response = await this.client.post<ArrayBuffer>(
      '?labels',
      { Parcels: [parcelNumber] },
      { responseType: 'arraybuffer', headers: { Accept: 'application/pdf' } },
    );

    return Buffer.from(response.data);
  }

  getTrackingUrl(trackingNumber: string): string {
    return `https://gls-group.eu/PL/pl/sledzenie-paczek?match=${trackingNumber}`;
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
