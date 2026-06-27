import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { CarrierTrackingResult, deriveMockTrackingStatus } from './carrier-tracking.types';

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
  private readonly trackingClient: AxiosInstance;
  private readonly trackingApiKey: string;
  private readonly accountNumber: string;
  private readonly logger = new Logger(DhlClient.name);
  private readonly mockEnabled: boolean;
  private readonly mockInTransitAfterMs: number;
  private readonly mockDeliveredAfterMs: number;

  private readonly shipperName: string;
  private readonly shipperStreet: string;
  private readonly shipperCity: string;
  private readonly shipperPostalCode: string;
  private readonly shipperPhone: string;
  private readonly shipperEmail: string;

  constructor(configService: ConfigService) {
    this.mockEnabled = configService.get<string>('DHL_MOCK_ENABLED') === 'true';

    const sandbox = configService.get<string>('DHL_SANDBOX') === 'true';
    const baseURL = sandbox
      ? 'https://api-sandbox.dhl.com/mydhlapi'
      : 'https://express.api.dhl.com/mydhlapi';

    this.accountNumber = this.mockEnabled ? '' : configService.getOrThrow<string>('DHL_ACCOUNT_NUMBER');

    this.client = axios.create({
      baseURL,
      timeout: 15_000,
      auth: {
        username: this.mockEnabled ? '' : configService.getOrThrow<string>('DHL_API_KEY'),
        password: this.mockEnabled ? '' : configService.getOrThrow<string>('DHL_API_SECRET'),
      },
      headers: { 'Content-Type': 'application/json' },
    });

    // DHL's "Shipment Tracking - Unified" API is a separate product/subscription from
    // MyDHL API (used above for shipment creation) — different base URL, different
    // DHL-API-Key header auth instead of the Basic Auth used for createShipment.
    this.trackingApiKey = configService.get<string>('DHL_TRACKING_API_KEY', '');
    this.trackingClient = axios.create({
      baseURL: 'https://api-eu.dhl.com/track',
      timeout: 15_000,
      headers: { 'DHL-API-Key': this.trackingApiKey },
    });

    this.mockInTransitAfterMs = configService.get<number>('SHIPMENT_MOCK_IN_TRANSIT_AFTER_MINUTES', 2) * 60_000;
    this.mockDeliveredAfterMs = configService.get<number>('SHIPMENT_MOCK_DELIVERED_AFTER_MINUTES', 5) * 60_000;

    this.shipperName = configService.get<string>('DHL_SHIPPER_NAME', 'Fragrance Store');
    this.shipperStreet = configService.get<string>('DHL_SHIPPER_STREET', 'ul. Sklep 1');
    this.shipperCity = configService.get<string>('DHL_SHIPPER_CITY', 'Kraków');
    this.shipperPostalCode = configService.get<string>('DHL_SHIPPER_POSTAL_CODE', '30-001');
    this.shipperPhone = configService.get<string>('DHL_SHIPPER_PHONE', '+48000000000');
    this.shipperEmail = configService.get<string>('DHL_SHIPPER_EMAIL', 'sklep@example.com');

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
          postalAddress: { cityName: this.shipperCity, countryCode: 'PL', postalCode: this.shipperPostalCode, addressLine1: this.shipperStreet },
          contactInformation: { fullName: this.shipperName, phone: this.shipperPhone, email: this.shipperEmail },
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

    let response: Awaited<ReturnType<typeof this.client.post<any>>>;
    try {
      response = await this.client.post<any>('/shipments', payload);
    } catch (err) {
      if (axios.isAxiosError(err) && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT')) {
        throw new ServiceUnavailableException('DHL API timed out');
      }
      throw err;
    }
    const result = response.data;

    this.logger.log(`DHL shipment created: ${result.shipmentTrackingNumber}`);

    const labelUrl = result.documents?.[0]?.url ?? '';

    return { trackingNumber: result.shipmentTrackingNumber, labelUrl };
  }

  getTrackingUrl(trackingNumber: string): string {
    return `https://www.dhl.com/pl-pl/home/tracking/tracking-express.html?submit=1&tracking-id=${trackingNumber}`;
  }

  /**
   * Polls DHL's "Shipment Tracking - Unified" API (developer.dhl.com/api-reference/
   * shipment-tracking, confirmed 2026-06) for the shipment's normalized status, which
   * the API reports as one of: pre-transit | transit | delivered | failure | unknown.
   * Requires DHL_TRACKING_API_KEY — a separate subscription from the MyDHL API
   * credentials used for shipment creation. Without it, polling is skipped (warned
   * once) rather than failing the whole cron run.
   */
  async getTrackingStatus(trackingNumber: string, labelGeneratedAt: Date): Promise<CarrierTrackingResult | null> {
    if (this.mockEnabled) {
      return this.mockGetTrackingStatus(labelGeneratedAt);
    }

    if (!this.trackingApiKey) {
      this.logger.warn(
        'DHL_TRACKING_API_KEY not set — skipping tracking poll for DHL shipments (separate subscription from the MyDHL API key used for label creation)',
      );
      return null;
    }

    let response: Awaited<ReturnType<typeof this.trackingClient.get<any>>>;
    try {
      response = await this.trackingClient.get<any>('/shipments', { params: { trackingNumber } });
    } catch (err) {
      if (axios.isAxiosError(err) && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT')) {
        throw new ServiceUnavailableException('DHL tracking lookup timed out');
      }
      throw err;
    }

    const shipment = response.data?.shipments?.[0];
    const statusCode = shipment?.status?.statusCode as string | undefined;
    switch (statusCode) {
      case 'delivered':
        return { status: 'DELIVERED', deliveredAt: new Date(), raw: shipment };
      case 'transit':
        return { status: 'IN_TRANSIT', raw: shipment };
      case 'failure':
        return { status: 'FAILED', raw: shipment };
      default:
        // pre-transit / unknown — nothing worth writing yet.
        return null;
    }
  }

  private mockGetTrackingStatus(labelGeneratedAt: Date): CarrierTrackingResult | null {
    const elapsedMs = Date.now() - labelGeneratedAt.getTime();
    const status = deriveMockTrackingStatus(elapsedMs, this.mockInTransitAfterMs, this.mockDeliveredAfterMs);
    if (!status) return null;
    this.logger.log(`[MOCK] DHL tracking status derived from elapsed time: ${status}`);
    return status === 'DELIVERED' ? { status, deliveredAt: new Date() } : { status };
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
