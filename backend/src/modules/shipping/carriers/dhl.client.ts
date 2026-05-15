import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

interface DhlShipmentPayload {
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
  description: string;
}

interface DhlShipmentResult {
  trackingNumber: string;
  labelUrl: string;
}

@Injectable()
export class DhlClient {
  private readonly client: AxiosInstance;
  private readonly accountNumber: string;
  private readonly logger = new Logger(DhlClient.name);
  private readonly mockEnabled: boolean;

  constructor(configService: ConfigService) {
    this.mockEnabled = configService.get<string>('DHL_MOCK_ENABLED') === 'true';

    const sandbox = configService.get<string>('DHL_SANDBOX') === 'true';
    const baseURL = sandbox
      ? 'https://api-sandbox.dhl.com/mydhlapi'
      : 'https://express.api.dhl.com/mydhlapi';

    this.accountNumber = this.mockEnabled ? '' : configService.getOrThrow<string>('DHL_ACCOUNT_NUMBER');

    this.client = axios.create({
      baseURL,
      auth: {
        username: this.mockEnabled ? '' : configService.getOrThrow<string>('DHL_API_KEY'),
        password: this.mockEnabled ? '' : configService.getOrThrow<string>('DHL_API_SECRET'),
      },
      headers: { 'Content-Type': 'application/json' },
    });

    if (this.mockEnabled) {
      this.logger.warn('⚠️  MOCK DHL CLIENT ENABLED - No real shipments will be created.');
    }
  }

  async createShipment(data: DhlShipmentPayload): Promise<DhlShipmentResult> {
    if (this.mockEnabled) {
      return this.mockCreateShipment(data);
    }

    const now = new Date();
    const plannedShipping = now.toISOString().split('T')[0];

    const payload = {
      plannedShippingDateAndTime: `${plannedShipping}T10:00:00 GMT+02:00`,
      pickup: { isRequested: false },
      productCode: 'N',
      accounts: [{ typeCode: 'shipper', number: this.accountNumber }],
      outputImageProperties: {
        printerDPI: 300,
        encodingFormat: 'pdf',
        imageOptions: [{ typeCode: 'label', templateName: 'ECOM26_84_001' }],
      },
      customerDetails: {
        shipperDetails: {
          postalAddress: { cityName: 'Kraków', countryCode: 'PL', postalCode: '30-001', addressLine1: 'ul. Sklep 1' },
          contactInformation: { fullName: 'Fragrance Store', phone: '+48000000000', email: 'sklep@example.com' },
        },
        receiverDetails: {
          postalAddress: {
            cityName: data.receiver.city,
            countryCode: data.receiver.country,
            postalCode: data.receiver.postalCode,
            addressLine1: data.receiver.street,
          },
          contactInformation: {
            fullName: data.receiver.name,
            phone: data.receiver.phone,
            email: data.receiver.email,
          },
        },
      },
      content: {
        packages: [{ weight: data.weightKg, dimensions: { length: 20, width: 15, height: 10 } }],
        isCustomsDeclarable: false,
        description: data.description,
        incoterm: 'DAP',
        unitOfMeasurement: 'metric',
      },
    };

    const response = await this.client.post<any>('/shipments', payload);
    const result = response.data;

    this.logger.log(`DHL shipment created: ${result.shipmentTrackingNumber}`);

    const labelUrl = result.documents?.[0]?.url ?? '';

    return { trackingNumber: result.shipmentTrackingNumber, labelUrl };
  }

  getTrackingUrl(trackingNumber: string): string {
    return `https://www.dhl.com/pl-pl/home/tracking/tracking-express.html?submit=1&tracking-id=${trackingNumber}`;
  }

  private mockCreateShipment(data: DhlShipmentPayload): DhlShipmentResult {
    const trackingNumber = `MOCK_DHL_${Math.random().toString(36).substring(2, 12).toUpperCase()}`;
    const labelUrl = `mock-label-dhl-${trackingNumber}.pdf`;
    this.logger.log(
      `[MOCK] DHL shipment created: tracking=${trackingNumber}, receiver=${data.receiver.name}`,
    );
    return { trackingNumber, labelUrl };
  }
}
