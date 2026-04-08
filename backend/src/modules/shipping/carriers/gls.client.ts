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

  constructor(configService: ConfigService) {
    const sandbox = configService.get<string>('GLS_SANDBOX') === 'true';
    const baseURL = sandbox
      ? 'https://adeplus.gls-poland.com/adeplus/pm1/ade_webapi2.php'
      : 'https://adeplus.gls-poland.com/adeplus/pm1/ade_webapi2.php';

    this.senderId = configService.getOrThrow<string>('GLS_SENDER_ID');

    this.client = axios.create({
      baseURL,
      auth: {
        username: configService.getOrThrow<string>('GLS_USERNAME'),
        password: configService.getOrThrow<string>('GLS_PASSWORD'),
      },
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async createShipment(data: GlsShipmentPayload): Promise<GlsShipmentResult> {
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
      labelUrl: '',  // GLS labels retrieved separately via GetLabel
    };
  }

  getTrackingUrl(trackingNumber: string): string {
    return `https://gls-group.eu/PL/pl/sledzenie-paczek?match=${trackingNumber}`;
  }
}
