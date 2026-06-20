import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CarrierCode, OrderStatus, ShipmentStatus } from '@prisma/client';
import { ShippingService } from '../shipping.service';
import { ShippingRatesService } from '../shipping-rates.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailQueueService } from '../../email/email-queue.service';
import { StorageService } from '../../storage/storage.service';
import { InpostClient } from '../carriers/inpost.client';
import { DhlClient } from '../carriers/dhl.client';
import { GlsClient } from '../carriers/gls.client';
import { DpdClient } from '../carriers/dpd.client';

const MOCK_RATE_MAP: Record<CarrierCode, number> = {
  [CarrierCode.INPOST]:      1499,
  [CarrierCode.DHL]:         1999,
  [CarrierCode.GLS]:         1799,
  [CarrierCode.DPD]:         1599,
  [CarrierCode.DPD_COURIER]: 1699,
};

describe('ShippingService', () => {
  let service: ShippingService;
  let prisma: any;
  let inpost: jest.Mocked<InpostClient>;
  let dhl: jest.Mocked<DhlClient>;
  let gls: jest.Mocked<GlsClient>;
  let dpd: jest.Mocked<DpdClient>;
  let storage: jest.Mocked<StorageService>;
  let emailService: jest.Mocked<EmailQueueService>;
  let shippingRates: jest.Mocked<ShippingRatesService>;
  let redis: { set: jest.Mock; eval: jest.Mock };

  const mockOrderBase = {
    id: 'order-1',
    orderNumber: 'ORD-2026-000001',
    status: OrderStatus.PAID,
    snapshotFirstName: 'Jan',
    snapshotLastName: 'Kowalski',
    snapshotPhone: '+48123456789',
    snapshotEmail: 'jan@example.com',
    snapshotStreet: 'ul. Marszałkowska 1',
    snapshotCity: 'Warszawa',
    snapshotPostalCode: '00-001',
    snapshotCountry: 'PL',
    inpostLockerCode: 'KRA001',
    items: [
      {
        quantity: 2,
        productVariant: { weight: 200 },
      },
    ],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShippingService,
        {
          provide: PrismaService,
          useValue: {
            order: { findUnique: jest.fn() },
            shipment: {
              findUnique: jest.fn(),
              upsert: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: EmailQueueService,
          useValue: {
            sendShippingNotification: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: StorageService,
          useValue: {
            uploadShippingLabel: jest.fn(),
            getShippingLabelSignedUrl: jest.fn(),
            deleteShippingLabel: jest.fn(),
          },
        },
        {
          provide: InpostClient,
          useValue: {
            createShipment: jest.fn(),
            fetchLabelPdf: jest.fn(),
            getTrackingUrl: jest.fn().mockReturnValue('https://inpost.pl/track/TRK'),
          },
        },
        {
          provide: DhlClient,
          useValue: {
            createShipment: jest.fn(),
            getTrackingUrl: jest.fn().mockReturnValue('https://dhl.com/track/TRK'),
          },
        },
        {
          provide: GlsClient,
          useValue: {
            createShipment: jest.fn(),
            fetchLabelPdf: jest.fn(),
            getTrackingUrl: jest.fn().mockReturnValue('https://gls-group.eu/track/TRK'),
          },
        },
        {
          provide: DpdClient,
          useValue: {
            createShipment: jest.fn(),
            getTrackingUrl: jest.fn().mockReturnValue('https://dpd.com/track/TRK'),
          },
        },
        {
          provide: ShippingRatesService,
          useValue: {
            getRateMap: jest.fn().mockResolvedValue(MOCK_RATE_MAP),
            getRateForCarrier: jest.fn((code: CarrierCode) => Promise.resolve(MOCK_RATE_MAP[code])),
          },
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: {
            set: jest.fn().mockResolvedValue('OK'),
            eval: jest.fn().mockResolvedValue(1),
          },
        },
      ],
    }).compile();

    service = module.get(ShippingService);
    prisma = module.get(PrismaService);
    inpost = module.get(InpostClient);
    dhl = module.get(DhlClient);
    gls = module.get(GlsClient);
    dpd = module.get(DpdClient);
    storage = module.get(StorageService);
    emailService = module.get(EmailQueueService);
    shippingRates = module.get(ShippingRatesService);
    redis = module.get('REDIS_CLIENT');

    // Default: no existing shipment — tests that need a different value override this
    prisma.shipment.findUnique.mockResolvedValue(null);
  });

  describe('getShippingRates', () => {
    it('returns all five carriers with prices from the DB-backed rate map', async () => {
      const rates = await service.getShippingRates();

      expect(rates).toHaveLength(5);
      expect(rates.map((r) => r.carrier)).toEqual(
        expect.arrayContaining([
          CarrierCode.INPOST,
          CarrierCode.DHL,
          CarrierCode.GLS,
          CarrierCode.DPD,
          CarrierCode.DPD_COURIER,
        ]),
      );
      rates.forEach((r) => {
        expect(r.priceInCents).toBeGreaterThan(0);
        expect(r.name).toBeTruthy();
      });
    });

    // Regression harness: a deactivated carrier must disappear from the
    // customer-facing rate list, not keep showing up with a stale/fallback price.
    it('excludes a carrier the rate map omits (deactivated carrier)', async () => {
      const { [CarrierCode.DHL]: _omitted, ...withoutDhl } = MOCK_RATE_MAP;
      shippingRates.getRateMap.mockResolvedValue(withoutDhl);

      const rates = await service.getShippingRates();

      expect(rates).toHaveLength(4);
      expect(rates.map((r) => r.carrier)).not.toContain(CarrierCode.DHL);
    });
  });

  describe('generateLabel', () => {
    it('throws NotFoundException when order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.generateLabel('nonexistent')).rejects.toThrow(NotFoundException);
    });

    // ─── distributed lock — prevents duplicate billable carrier shipments ────
    // Without a lock, two concurrent requests for the same order (admin
    // double-click, or a retry on what looks like a hung request) could both
    // pass the existing-shipment guard and both call the carrier's real,
    // billable createShipment(). The second prisma.shipment.upsert would then
    // silently overwrite the first's shipmentId/trackingNumber, leaving one
    // real carrier-side shipment with no local DB record at all.

    describe('distributed lock', () => {
      it('acquires the lock with NX and a 60-second TTL before doing any work', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.DHL });
        dhl.createShipment.mockResolvedValue({ trackingNumber: 'T', labelUrl: 'U' });
        prisma.shipment.upsert.mockResolvedValue({ labelUrl: 'U', trackingNumber: 'T' });

        await service.generateLabel('order-1');

        expect(redis.set).toHaveBeenCalledWith(
          'label-gen-lock:order-1',
          expect.any(String),
          'EX',
          60,
          'NX',
        );
      });

      it('throws 429 when the lock is already held by a concurrent request', async () => {
        redis.set.mockResolvedValue(null); // SET NX returns null = not acquired

        await expect(service.generateLabel('order-1')).rejects.toMatchObject({ status: 429 });
      });

      it('does not look up the order when the lock cannot be acquired', async () => {
        redis.set.mockResolvedValue(null);

        await expect(service.generateLabel('order-1')).rejects.toMatchObject({ status: 429 });

        expect(prisma.order.findUnique).not.toHaveBeenCalled();
      });

      it('never calls the carrier when the lock cannot be acquired — regression guard for duplicate billable shipments', async () => {
        redis.set.mockResolvedValue(null);

        await expect(service.generateLabel('order-1')).rejects.toMatchObject({ status: 429 });

        expect(dhl.createShipment).not.toHaveBeenCalled();
        expect(inpost.createShipment).not.toHaveBeenCalled();
      });

      it('releases the lock via the Lua script on success', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.DHL });
        dhl.createShipment.mockResolvedValue({ trackingNumber: 'T', labelUrl: 'U' });
        prisma.shipment.upsert.mockResolvedValue({ labelUrl: 'U', trackingNumber: 'T' });

        await service.generateLabel('order-1');

        expect(redis.eval).toHaveBeenCalledTimes(1);
      });

      it('releases the lock via the Lua script even when the carrier call throws', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.DHL });
        dhl.createShipment.mockRejectedValue(new Error('Carrier API down'));
        prisma.shipment.upsert.mockResolvedValue({});

        await expect(service.generateLabel('order-1')).rejects.toThrow('Carrier API down');

        expect(redis.eval).toHaveBeenCalledTimes(1);
      });

      it('releases the lock even when the order is not found', async () => {
        prisma.order.findUnique.mockResolvedValue(null);

        await expect(service.generateLabel('order-1')).rejects.toThrow(NotFoundException);

        expect(redis.eval).toHaveBeenCalledTimes(1);
      });

      it('releases the lock even when the duplicate-shipment guard rejects', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.DHL });
        prisma.shipment.findUnique.mockResolvedValue({ status: ShipmentStatus.LABEL_GENERATED });

        await expect(service.generateLabel('order-1')).rejects.toThrow(ConflictException);

        expect(redis.eval).toHaveBeenCalledTimes(1);
      });
    });

    describe('order status guard', () => {
      it('throws BadRequestException for a CANCELLED order', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.DHL, status: OrderStatus.CANCELLED });

        await expect(service.generateLabel('order-1')).rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException for a PENDING_PAYMENT order', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.DHL, status: OrderStatus.PENDING_PAYMENT });

        await expect(service.generateLabel('order-1')).rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException for a REFUNDED order', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.DHL, status: OrderStatus.REFUNDED });

        await expect(service.generateLabel('order-1')).rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException for a SHIPPED order', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.DHL, status: OrderStatus.SHIPPED });

        await expect(service.generateLabel('order-1')).rejects.toThrow(BadRequestException);
      });

      it('proceeds for a PAID order', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.DHL, status: OrderStatus.PAID });
        dhl.createShipment.mockResolvedValue({ trackingNumber: 'T', labelUrl: 'U' });
        prisma.shipment.upsert.mockResolvedValue({ labelUrl: 'U', trackingNumber: 'T' });

        await expect(service.generateLabel('order-1')).resolves.toBeDefined();
      });

      it('proceeds for a PROCESSING order', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.DHL, status: OrderStatus.PROCESSING });
        dhl.createShipment.mockResolvedValue({ trackingNumber: 'T', labelUrl: 'U' });
        prisma.shipment.upsert.mockResolvedValue({ labelUrl: 'U', trackingNumber: 'T' });

        await expect(service.generateLabel('order-1')).resolves.toBeDefined();
      });
    });

    describe('duplicate shipment guard', () => {
      it('throws ConflictException when a LABEL_GENERATED shipment already exists', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.DHL });
        prisma.shipment.findUnique.mockResolvedValue({ status: ShipmentStatus.LABEL_GENERATED });

        await expect(service.generateLabel('order-1')).rejects.toThrow(ConflictException);
      });

      it('throws ConflictException when an IN_TRANSIT shipment already exists', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.DHL });
        prisma.shipment.findUnique.mockResolvedValue({ status: ShipmentStatus.IN_TRANSIT });

        await expect(service.generateLabel('order-1')).rejects.toThrow(ConflictException);
      });

      it('allows re-generation when the existing shipment is in LABEL_ERROR state', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.DHL });
        prisma.shipment.findUnique.mockResolvedValue({ status: ShipmentStatus.LABEL_ERROR });
        dhl.createShipment.mockResolvedValue({ trackingNumber: 'RETRY_T', labelUrl: 'RETRY_U' });
        prisma.shipment.upsert.mockResolvedValue({ labelUrl: 'RETRY_U', trackingNumber: 'RETRY_T' });

        await expect(service.generateLabel('order-1')).resolves.toBeDefined();
      });

      it('allows generation when no shipment record exists yet', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.DHL });
        prisma.shipment.findUnique.mockResolvedValue(null);
        dhl.createShipment.mockResolvedValue({ trackingNumber: 'NEW_T', labelUrl: 'NEW_U' });
        prisma.shipment.upsert.mockResolvedValue({ labelUrl: 'NEW_U', trackingNumber: 'NEW_T' });

        await expect(service.generateLabel('order-1')).resolves.toBeDefined();
      });
    });

    // Regression harness: a LABEL_ERROR retry must not call the carrier's
    // createShipment() again once a shipmentId was already committed on a prior
    // attempt — doing so creates a second real, billable, dispatchable shipment.
    describe('LABEL_ERROR retry — resumes from a preserved shipmentId instead of recreating the shipment', () => {
      it('InPost: skips createShipment and resumes from fetchLabelPdf when shipmentId is preserved but the label is not', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.INPOST });
        prisma.shipment.findUnique.mockResolvedValue({
          status: ShipmentStatus.LABEL_ERROR,
          shipmentId: 'INPOST_COMMITTED_999',
          trackingNumber: 'TRK-INPOST-999',
          labelUrl: null,
        });
        inpost.fetchLabelPdf.mockResolvedValue(Buffer.from('%PDF-mock'));
        storage.uploadShippingLabel.mockResolvedValue('https://storage.example.com/labels/inpost-INPOST_COMMITTED_999.pdf');
        prisma.shipment.upsert.mockResolvedValue({
          labelUrl: 'https://storage.example.com/labels/inpost-INPOST_COMMITTED_999.pdf',
          trackingNumber: 'TRK-INPOST-999',
        });

        await service.generateLabel('order-1');

        expect(inpost.createShipment).not.toHaveBeenCalled();
        expect(inpost.fetchLabelPdf).toHaveBeenCalledWith('INPOST_COMMITTED_999');
        const upsertCall = prisma.shipment.upsert.mock.calls[0][0];
        expect(upsertCall.update.shipmentId).toBe('INPOST_COMMITTED_999');
        expect(upsertCall.update.status).toBe(ShipmentStatus.LABEL_GENERATED);
      });

      it('InPost: skips both createShipment and fetchLabelPdf when shipmentId and labelUrl are both already preserved', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.INPOST });
        prisma.shipment.findUnique.mockResolvedValue({
          status: ShipmentStatus.LABEL_ERROR,
          shipmentId: 'INPOST_COMMITTED_999',
          trackingNumber: 'TRK-INPOST-999',
          labelUrl: 'https://storage.example.com/labels/inpost-INPOST_COMMITTED_999.pdf',
        });
        prisma.shipment.upsert.mockResolvedValue({
          labelUrl: 'https://storage.example.com/labels/inpost-INPOST_COMMITTED_999.pdf',
          trackingNumber: 'TRK-INPOST-999',
        });

        await service.generateLabel('order-1');

        expect(inpost.createShipment).not.toHaveBeenCalled();
        expect(inpost.fetchLabelPdf).not.toHaveBeenCalled();
        expect(storage.uploadShippingLabel).not.toHaveBeenCalled();
      });

      it('InPost: calls createShipment again when the LABEL_ERROR row has no shipmentId (carrier was never reached)', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.INPOST });
        prisma.shipment.findUnique.mockResolvedValue({
          status: ShipmentStatus.LABEL_ERROR,
          shipmentId: null,
          trackingNumber: null,
          labelUrl: null,
        });
        inpost.createShipment.mockResolvedValue({ id: 'NEW_INPOST_1', trackingNumber: 'TRK-NEW-1' });
        inpost.fetchLabelPdf.mockResolvedValue(null);
        prisma.shipment.upsert.mockResolvedValue({ labelUrl: 'mock-label-NEW_INPOST_1.pdf', trackingNumber: 'TRK-NEW-1' });

        await service.generateLabel('order-1');

        expect(inpost.createShipment).toHaveBeenCalledTimes(1);
      });

      it('GLS: skips createShipment and resumes from fetchLabelPdf using the preserved parcelId', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.GLS });
        prisma.shipment.findUnique.mockResolvedValue({
          status: ShipmentStatus.LABEL_ERROR,
          shipmentId: 'GLS_P999',
          trackingNumber: 'TRK-GLS-999',
          labelUrl: null,
        });
        gls.fetchLabelPdf.mockResolvedValue(Buffer.from('%PDF-mock'));
        storage.uploadShippingLabel.mockResolvedValue('https://storage.example.com/labels/gls-GLS_P999.pdf');
        prisma.shipment.upsert.mockResolvedValue({
          labelUrl: 'https://storage.example.com/labels/gls-GLS_P999.pdf',
          trackingNumber: 'TRK-GLS-999',
        });

        await service.generateLabel('order-1');

        expect(gls.createShipment).not.toHaveBeenCalled();
        expect(gls.fetchLabelPdf).toHaveBeenCalledWith('GLS_P999');
      });

      it('DHL: skips createShipment entirely when shipmentId (tracking number) is already preserved', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.DHL });
        prisma.shipment.findUnique.mockResolvedValue({
          status: ShipmentStatus.LABEL_ERROR,
          shipmentId: 'DHL-COMMITTED-1',
          trackingNumber: 'DHL-COMMITTED-1',
          labelUrl: 'https://dhl.example.com/labels/DHL-COMMITTED-1.pdf',
        });
        prisma.shipment.upsert.mockResolvedValue({
          labelUrl: 'https://dhl.example.com/labels/DHL-COMMITTED-1.pdf',
          trackingNumber: 'DHL-COMMITTED-1',
        });

        await service.generateLabel('order-1');

        expect(dhl.createShipment).not.toHaveBeenCalled();
        const upsertCall = prisma.shipment.upsert.mock.calls[0][0];
        expect(upsertCall.update.status).toBe(ShipmentStatus.LABEL_GENERATED);
        expect(upsertCall.update.trackingNumber).toBe('DHL-COMMITTED-1');
      });

      it('DPD: skips createShipment entirely when shipmentId (tracking number) is already preserved', async () => {
        prisma.order.findUnique.mockResolvedValue({ ...mockOrderBase, carrierCode: CarrierCode.DPD });
        prisma.shipment.findUnique.mockResolvedValue({
          status: ShipmentStatus.LABEL_ERROR,
          shipmentId: 'DPD-COMMITTED-1',
          trackingNumber: 'DPD-COMMITTED-1',
          labelUrl: 'https://dpd.example.com/labels/DPD-COMMITTED-1.pdf',
        });
        prisma.shipment.upsert.mockResolvedValue({
          labelUrl: 'https://dpd.example.com/labels/DPD-COMMITTED-1.pdf',
          trackingNumber: 'DPD-COMMITTED-1',
        });

        await service.generateLabel('order-1');

        expect(dpd.createShipment).not.toHaveBeenCalled();
      });
    });

    describe('InPost carrier', () => {
      const mockOrder = { ...mockOrderBase, carrierCode: CarrierCode.INPOST };

      it('calls inpost.createShipment with receiver and locker code', async () => {
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        inpost.createShipment.mockResolvedValue({ id: 'MOCK_INPOST_123', trackingNumber: 'TRK001' });
        inpost.fetchLabelPdf.mockResolvedValue(null);
        prisma.shipment.upsert.mockResolvedValue({
          labelUrl: 'mock-label-MOCK_INPOST_123.pdf',
          trackingNumber: 'TRK001',
        });

        await service.generateLabel('order-1');

        expect(inpost.createShipment).toHaveBeenCalledWith(
          expect.objectContaining({
            receiver: expect.objectContaining({ name: 'Jan Kowalski', phone: '+48123456789' }),
            targetLockerCode: 'KRA001',
          }),
        );
      });

      it('stores mock label URL when fetchLabelPdf returns null (mock mode)', async () => {
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        inpost.createShipment.mockResolvedValue({ id: 'MOCK_INPOST_ABC', trackingNumber: 'TRK001' });
        inpost.fetchLabelPdf.mockResolvedValue(null);

        const upsertSpy = prisma.shipment.upsert.mockResolvedValue({
          labelUrl: 'mock-label-MOCK_INPOST_ABC.pdf',
          trackingNumber: 'TRK001',
        });

        await service.generateLabel('order-1');

        const createData = upsertSpy.mock.calls[0][0].create;
        expect(createData.labelUrl).toBe('mock-label-MOCK_INPOST_ABC.pdf');
        expect(storage.uploadShippingLabel).not.toHaveBeenCalled();
      });

      it('uploads real PDF to storage when fetchLabelPdf returns a Buffer', async () => {
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        inpost.createShipment.mockResolvedValue({ id: 'REAL_123', trackingNumber: 'TRK002' });
        const pdfBuffer = Buffer.from('%PDF-mock');
        inpost.fetchLabelPdf.mockResolvedValue(pdfBuffer);
        storage.uploadShippingLabel.mockResolvedValue('https://storage.example.com/labels/inpost-REAL_123.pdf');
        prisma.shipment.upsert.mockResolvedValue({
          labelUrl: 'https://storage.example.com/labels/inpost-REAL_123.pdf',
          trackingNumber: 'TRK002',
        });

        await service.generateLabel('order-1');

        expect(storage.uploadShippingLabel).toHaveBeenCalledWith(pdfBuffer, 'inpost-REAL_123.pdf');
      });
    });

    describe('DHL carrier', () => {
      const mockOrder = { ...mockOrderBase, carrierCode: CarrierCode.DHL };

      it('calls dhl.createShipment with receiver address', async () => {
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        dhl.createShipment.mockResolvedValue({ trackingNumber: 'DHL001', labelUrl: 'https://dhl.pdf' });
        prisma.shipment.upsert.mockResolvedValue({ labelUrl: 'https://dhl.pdf', trackingNumber: 'DHL001' });

        await service.generateLabel('order-1');

        expect(dhl.createShipment).toHaveBeenCalledWith(
          expect.objectContaining({
            receiver: expect.objectContaining({
              name: 'Jan Kowalski',
              city: 'Warszawa',
              postalCode: '00-001',
            }),
          }),
        );
      });
    });

    describe('GLS carrier', () => {
      const mockOrder = { ...mockOrderBase, carrierCode: CarrierCode.GLS };

      it('calls gls.createShipment with order reference', async () => {
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        gls.createShipment.mockResolvedValue({ trackingNumber: 'GLS001', parcelId: 'P001', labelUrl: '' });
        gls.fetchLabelPdf.mockResolvedValue(null);
        prisma.shipment.upsert.mockResolvedValue({ labelUrl: 'mock-label-gls-P001.pdf', trackingNumber: 'GLS001' });

        await service.generateLabel('order-1');

        expect(gls.createShipment).toHaveBeenCalledWith(
          expect.objectContaining({ reference: 'ORD-2026-000001' }),
        );
      });

      it('stores mock label URL when fetchLabelPdf returns null (mock mode)', async () => {
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        gls.createShipment.mockResolvedValue({ trackingNumber: 'GLS001', parcelId: 'P001', labelUrl: '' });
        gls.fetchLabelPdf.mockResolvedValue(null);

        const upsertSpy = prisma.shipment.upsert.mockResolvedValue({
          labelUrl: 'mock-label-gls-P001.pdf',
          trackingNumber: 'GLS001',
        });

        await service.generateLabel('order-1');

        const createData = upsertSpy.mock.calls[0][0].create;
        expect(createData.labelUrl).toBe('mock-label-gls-P001.pdf');
        expect(storage.uploadShippingLabel).not.toHaveBeenCalled();
      });

      it('uploads real PDF to storage when fetchLabelPdf returns a Buffer', async () => {
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        gls.createShipment.mockResolvedValue({ trackingNumber: 'GLS002', parcelId: 'REAL_P002', labelUrl: '' });
        const pdfBuffer = Buffer.from('%PDF-mock');
        gls.fetchLabelPdf.mockResolvedValue(pdfBuffer);
        storage.uploadShippingLabel.mockResolvedValue('https://storage.example.com/labels/gls-REAL_P002.pdf');
        prisma.shipment.upsert.mockResolvedValue({
          labelUrl: 'https://storage.example.com/labels/gls-REAL_P002.pdf',
          trackingNumber: 'GLS002',
        });

        await service.generateLabel('order-1');

        expect(storage.uploadShippingLabel).toHaveBeenCalledWith(pdfBuffer, 'gls-REAL_P002.pdf');
      });

      it('preserves GLS trackingNumber in LABEL_ERROR upsert when Supabase upload fails', async () => {
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        gls.createShipment.mockResolvedValue({ trackingNumber: 'TRK-GLS-999', parcelId: 'GLS_P999', labelUrl: '' });
        gls.fetchLabelPdf.mockResolvedValue(Buffer.from('%PDF-mock'));
        storage.uploadShippingLabel.mockRejectedValue(new Error('Supabase upload timeout'));
        prisma.shipment.upsert.mockResolvedValue({});

        await expect(service.generateLabel('order-1')).rejects.toThrow('Supabase upload timeout');

        const upsertCall = prisma.shipment.upsert.mock.calls[0][0];
        expect(upsertCall.create.trackingNumber).toBe('TRK-GLS-999');
        expect(upsertCall.update.trackingNumber).toBe('TRK-GLS-999');
      });
    });

    describe('DPD carrier', () => {
      const mockOrder = { ...mockOrderBase, carrierCode: CarrierCode.DPD };

      it('calls dpd.createShipment with order reference', async () => {
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        dpd.createShipment.mockResolvedValue({ trackingNumber: 'DPD001', labelUrl: 'https://dpd.pdf' });
        prisma.shipment.upsert.mockResolvedValue({ labelUrl: 'https://dpd.pdf', trackingNumber: 'DPD001' });

        await service.generateLabel('order-1');

        expect(dpd.createShipment).toHaveBeenCalledWith(
          expect.objectContaining({ reference: 'ORD-2026-000001' }),
        );
      });
    });

    describe('trackingNumber validation guard', () => {
      it('throws and records LABEL_ERROR (not LABEL_GENERATED) when InPost returns no trackingNumber', async () => {
        const mockOrder = { ...mockOrderBase, carrierCode: CarrierCode.INPOST };
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        inpost.createShipment.mockResolvedValue({ id: 'MOCK_INPOST_999', trackingNumber: undefined as any });
        prisma.shipment.upsert.mockResolvedValue({});

        await expect(service.generateLabel('order-1')).rejects.toThrow('InPost returned no trackingNumber');

        const upsertCall = prisma.shipment.upsert.mock.calls[0][0];
        expect(upsertCall.create.status).toBe(ShipmentStatus.LABEL_ERROR);
        expect(upsertCall.create.shipmentId).toBe('MOCK_INPOST_999');
        expect(prisma.shipment.upsert).not.toHaveBeenCalledWith(
          expect.objectContaining({ create: expect.objectContaining({ status: ShipmentStatus.LABEL_GENERATED }) }),
        );
      });

      it('throws and records LABEL_ERROR when DHL returns an empty-string trackingNumber', async () => {
        const mockOrder = { ...mockOrderBase, carrierCode: CarrierCode.DHL };
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        dhl.createShipment.mockResolvedValue({ trackingNumber: '', labelUrl: 'https://dhl.pdf' });
        prisma.shipment.upsert.mockResolvedValue({});

        await expect(service.generateLabel('order-1')).rejects.toThrow('DHL Express returned no trackingNumber');

        const upsertCall = prisma.shipment.upsert.mock.calls[0][0];
        expect(upsertCall.create.status).toBe(ShipmentStatus.LABEL_ERROR);
      });

      it('throws and records LABEL_ERROR when GLS returns an empty-string trackingNumber', async () => {
        const mockOrder = { ...mockOrderBase, carrierCode: CarrierCode.GLS };
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        gls.createShipment.mockResolvedValue({ trackingNumber: '', parcelId: 'P999', labelUrl: '' });
        prisma.shipment.upsert.mockResolvedValue({});

        await expect(service.generateLabel('order-1')).rejects.toThrow('GLS returned no trackingNumber');

        const upsertCall = prisma.shipment.upsert.mock.calls[0][0];
        expect(upsertCall.create.status).toBe(ShipmentStatus.LABEL_ERROR);
        expect(gls.fetchLabelPdf).not.toHaveBeenCalled();
      });

      it('throws and records LABEL_ERROR when DPD returns no trackingNumber', async () => {
        const mockOrder = { ...mockOrderBase, carrierCode: CarrierCode.DPD };
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        dpd.createShipment.mockResolvedValue({ trackingNumber: undefined as any, labelUrl: 'https://dpd.pdf' });
        prisma.shipment.upsert.mockResolvedValue({});

        await expect(service.generateLabel('order-1')).rejects.toThrow('DPD Pickup returned no trackingNumber');

        const upsertCall = prisma.shipment.upsert.mock.calls[0][0];
        expect(upsertCall.create.status).toBe(ShipmentStatus.LABEL_ERROR);
      });

      it('does not send a shipping notification email when trackingNumber validation fails', async () => {
        const mockOrder = { ...mockOrderBase, carrierCode: CarrierCode.DHL };
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        dhl.createShipment.mockResolvedValue({ trackingNumber: '', labelUrl: 'https://dhl.pdf' });
        prisma.shipment.upsert.mockResolvedValue({});

        await expect(service.generateLabel('order-1')).rejects.toThrow();

        expect(emailService.sendShippingNotification).not.toHaveBeenCalled();
      });
    });

    describe('weight calculation', () => {
      it('sums item weights and adds 0.5 kg base', async () => {
        const order = {
          ...mockOrderBase,
          carrierCode: CarrierCode.DHL,
          items: [
            { quantity: 2, productVariant: { weight: 200 } }, // 2 * 0.2 = 0.4 kg
            { quantity: 1, productVariant: { weight: 100 } }, // 1 * 0.1 = 0.1 kg
          ],
        };
        prisma.order.findUnique.mockResolvedValue(order);
        dhl.createShipment.mockResolvedValue({ trackingNumber: 'T', labelUrl: 'U' });
        prisma.shipment.upsert.mockResolvedValue({ labelUrl: 'U', trackingNumber: 'T' });

        await service.generateLabel('order-1');

        // base 0.5 + 0.4 + 0.1 = 1.0 kg
        expect(dhl.createShipment).toHaveBeenCalledWith(
          expect.objectContaining({ weightKg: expect.closeTo(1.0, 5) }),
        );
      });

      it('falls back to 200g per item when variant has no weight', async () => {
        const order = {
          ...mockOrderBase,
          carrierCode: CarrierCode.DHL,
          items: [{ quantity: 1, productVariant: { weight: null } }],
        };
        prisma.order.findUnique.mockResolvedValue(order);
        dhl.createShipment.mockResolvedValue({ trackingNumber: 'T', labelUrl: 'U' });
        prisma.shipment.upsert.mockResolvedValue({ labelUrl: 'U', trackingNumber: 'T' });

        await service.generateLabel('order-1');

        // base 0.5 + 1 * 200/1000 = 0.7 kg
        expect(dhl.createShipment).toHaveBeenCalledWith(
          expect.objectContaining({ weightKg: expect.closeTo(0.7, 5) }),
        );
      });
    });

    describe('shipment record persistence', () => {
      it('upserts shipment with LABEL_GENERATED status on success', async () => {
        const mockOrder = { ...mockOrderBase, carrierCode: CarrierCode.DHL };
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        dhl.createShipment.mockResolvedValue({ trackingNumber: 'DHL001', labelUrl: 'https://dhl.pdf' });
        prisma.shipment.upsert.mockResolvedValue({ labelUrl: 'https://dhl.pdf', trackingNumber: 'DHL001' });

        await service.generateLabel('order-1');

        expect(prisma.shipment.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { orderId: 'order-1' },
            create: expect.objectContaining({ status: ShipmentStatus.LABEL_GENERATED }),
          }),
        );
      });

      // Fix #52 regression harness — label generation time ≠ actual dispatch time.
      // Invariant: generateLabel must record when the *label was printed*, not when
      // the parcel was handed to the carrier. shippedAt is set separately when the
      // order status transitions to SHIPPED.

      it('sets labelGeneratedAt (not shippedAt) in the upsert create payload', async () => {
        const mockOrder = { ...mockOrderBase, carrierCode: CarrierCode.DHL };
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        dhl.createShipment.mockResolvedValue({ trackingNumber: 'DHL001', labelUrl: 'https://dhl.pdf' });
        prisma.shipment.upsert.mockResolvedValue({ labelUrl: 'https://dhl.pdf', trackingNumber: 'DHL001' });

        await service.generateLabel('order-1');

        const createPayload = prisma.shipment.upsert.mock.calls[0][0].create;
        expect(createPayload).toHaveProperty('labelGeneratedAt');
        expect(createPayload.labelGeneratedAt).toBeInstanceOf(Date);
        expect(createPayload).not.toHaveProperty('shippedAt');
      });

      it('sets labelGeneratedAt (not shippedAt) in the upsert update payload', async () => {
        const mockOrder = { ...mockOrderBase, carrierCode: CarrierCode.DHL };
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        dhl.createShipment.mockResolvedValue({ trackingNumber: 'DHL001', labelUrl: 'https://dhl.pdf' });
        prisma.shipment.upsert.mockResolvedValue({ labelUrl: 'https://dhl.pdf', trackingNumber: 'DHL001' });

        await service.generateLabel('order-1');

        const updatePayload = prisma.shipment.upsert.mock.calls[0][0].update;
        expect(updatePayload).toHaveProperty('labelGeneratedAt');
        expect(updatePayload.labelGeneratedAt).toBeInstanceOf(Date);
        expect(updatePayload).not.toHaveProperty('shippedAt');
      });

      it('upserts shipment with LABEL_ERROR status when carrier throws', async () => {
        const mockOrder = { ...mockOrderBase, carrierCode: CarrierCode.DHL };
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        dhl.createShipment.mockRejectedValue(new Error('Carrier API down'));
        prisma.shipment.upsert.mockResolvedValue({});

        await expect(service.generateLabel('order-1')).rejects.toThrow('Carrier API down');

        expect(prisma.shipment.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            create: expect.objectContaining({ status: ShipmentStatus.LABEL_ERROR }),
          }),
        );
      });

      // Fix #28 regression harness — carrier identifiers must survive a Supabase failure.
      // Invariant: if the carrier API succeeds but the label upload fails, the committed
      // shipmentId and trackingNumber are persisted in the LABEL_ERROR row so support
      // can locate the shipment on the carrier dashboard without manual searching.

      it('preserves InPost shipmentId and trackingNumber in LABEL_ERROR upsert when Supabase upload fails', async () => {
        const mockOrder = { ...mockOrderBase, carrierCode: CarrierCode.INPOST };
        prisma.order.findUnique.mockResolvedValue(mockOrder);

        // InPost API commits the shipment successfully
        inpost.createShipment.mockResolvedValue({ id: 'INPOST_COMMITTED_999', trackingNumber: 'TRK-INPOST-999' });
        // fetchLabelPdf returns a real PDF, so uploadShippingLabel will be called
        inpost.fetchLabelPdf.mockResolvedValue(Buffer.from('%PDF-mock'));
        // Supabase upload fails AFTER InPost has already committed
        storage.uploadShippingLabel.mockRejectedValue(new Error('Supabase upload timeout'));
        prisma.shipment.upsert.mockResolvedValue({});

        await expect(service.generateLabel('order-1')).rejects.toThrow('Supabase upload timeout');

        const upsertCall = prisma.shipment.upsert.mock.calls[0][0];
        expect(upsertCall.create.shipmentId).toBe('INPOST_COMMITTED_999');
        expect(upsertCall.create.trackingNumber).toBe('TRK-INPOST-999');
        expect(upsertCall.update.shipmentId).toBe('INPOST_COMMITTED_999');
        expect(upsertCall.update.trackingNumber).toBe('TRK-INPOST-999');
      });

      it('includes raw carrier response in LABEL_ERROR upsert when Supabase upload fails', async () => {
        const mockOrder = { ...mockOrderBase, carrierCode: CarrierCode.INPOST };
        const carrierResult = { id: 'INPOST_COMMITTED_999', trackingNumber: 'TRK-INPOST-999' };
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        inpost.createShipment.mockResolvedValue(carrierResult);
        inpost.fetchLabelPdf.mockResolvedValue(Buffer.from('%PDF-mock'));
        storage.uploadShippingLabel.mockRejectedValue(new Error('Supabase timeout'));
        prisma.shipment.upsert.mockResolvedValue({});

        await expect(service.generateLabel('order-1')).rejects.toThrow();

        const upsertCall = prisma.shipment.upsert.mock.calls[0][0];
        expect(upsertCall.create.rawCarrierResponse).toMatchObject({
          error: 'Supabase timeout',
          carrierResponse: carrierResult,
        });
      });

      it('upserts null shipmentId and trackingNumber in LABEL_ERROR when carrier itself fails (no carrier ID was ever returned)', async () => {
        const mockOrder = { ...mockOrderBase, carrierCode: CarrierCode.INPOST };
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        inpost.createShipment.mockRejectedValue(new Error('InPost API down'));
        prisma.shipment.upsert.mockResolvedValue({});

        await expect(service.generateLabel('order-1')).rejects.toThrow('InPost API down');

        const upsertCall = prisma.shipment.upsert.mock.calls[0][0];
        expect(upsertCall.create.shipmentId).toBeNull();
        expect(upsertCall.create.trackingNumber).toBeNull();
      });

      // Retry-duplication fix regression harness — without persisting labelUrl here,
      // a retry that resumes from this LABEL_ERROR row would see no preserved label
      // and (for InPost/GLS) re-fetch needlessly, or (for DHL/DPD, which have no
      // separate fetch step) lose the label entirely even though it already exists.
      it('preserves labelUrl in the LABEL_ERROR upsert when the success-path upsert itself fails after the label was already created', async () => {
        const mockOrder = { ...mockOrderBase, carrierCode: CarrierCode.DHL };
        prisma.order.findUnique.mockResolvedValue(mockOrder);
        dhl.createShipment.mockResolvedValue({
          trackingNumber: 'DHL-COMMITTED-2',
          labelUrl: 'https://dhl.example.com/labels/DHL-COMMITTED-2.pdf',
        });
        prisma.shipment.upsert
          .mockRejectedValueOnce(new Error('DB connection dropped'))
          .mockResolvedValueOnce({});

        await expect(service.generateLabel('order-1')).rejects.toThrow('DB connection dropped');

        const errorUpsertCall = prisma.shipment.upsert.mock.calls[1][0];
        expect(errorUpsertCall.create.labelUrl).toBe('https://dhl.example.com/labels/DHL-COMMITTED-2.pdf');
        expect(errorUpsertCall.update.labelUrl).toBe('https://dhl.example.com/labels/DHL-COMMITTED-2.pdf');
        expect(errorUpsertCall.create.shipmentId).toBe('DHL-COMMITTED-2');
      });
    });

    it('sends shipping notification email as fire-and-forget', async () => {
      const mockOrder = { ...mockOrderBase, carrierCode: CarrierCode.DHL };
      prisma.order.findUnique.mockResolvedValue(mockOrder);
      dhl.createShipment.mockResolvedValue({ trackingNumber: 'DHL001', labelUrl: 'https://dhl.pdf' });
      prisma.shipment.upsert.mockResolvedValue({ labelUrl: 'https://dhl.pdf', trackingNumber: 'DHL001' });

      await service.generateLabel('order-1');
      await Promise.resolve();

      expect(emailService.sendShippingNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          orderNumber: 'ORD-2026-000001',
          trackingNumber: 'DHL001',
        }),
      );
    });
  });

  describe('getLabel — signed URL generation', () => {
    it('throws NotFoundException when no shipment exists for the order', async () => {
      prisma.shipment.findUnique.mockResolvedValue(null);

      await expect(service.getLabel('order-1')).rejects.toThrow(NotFoundException);
    });

    it('calls getShippingLabelSignedUrl and returns the signed URL for a real storage path', async () => {
      prisma.shipment.findUnique.mockResolvedValue({
        labelUrl: 'labels/inpost-123.pdf',
        trackingNumber: 'TRK123',
      });
      storage.getShippingLabelSignedUrl.mockResolvedValue('https://supabase.io/signed/labels/inpost-123.pdf?token=xyz');

      const result = await service.getLabel('order-1');

      expect(storage.getShippingLabelSignedUrl).toHaveBeenCalledWith('labels/inpost-123.pdf');
      expect(result).toEqual({
        labelUrl: 'https://supabase.io/signed/labels/inpost-123.pdf?token=xyz',
        trackingNumber: 'TRK123',
      });
    });

    it('returns a carrier-hosted DHL/DPD URL as-is without calling getShippingLabelSignedUrl', async () => {
      prisma.shipment.findUnique.mockResolvedValue({
        labelUrl: 'https://dhl.example.com/labels/external-123.pdf',
        trackingNumber: 'TRK-DHL-123',
      });

      const result = await service.getLabel('order-1');

      expect(storage.getShippingLabelSignedUrl).not.toHaveBeenCalled();
      expect(result).toEqual({
        labelUrl: 'https://dhl.example.com/labels/external-123.pdf',
        trackingNumber: 'TRK-DHL-123',
      });
    });

    it('returns the mock label path as-is without calling getShippingLabelSignedUrl', async () => {
      prisma.shipment.findUnique.mockResolvedValue({
        labelUrl: 'mock-label-MOCK_INPOST_ABC.pdf',
        trackingNumber: 'TRK-MOCK',
      });

      const result = await service.getLabel('order-1');

      expect(storage.getShippingLabelSignedUrl).not.toHaveBeenCalled();
      expect(result).toEqual({
        labelUrl: 'mock-label-MOCK_INPOST_ABC.pdf',
        trackingNumber: 'TRK-MOCK',
      });
    });

    it('returns null labelUrl without calling getShippingLabelSignedUrl when label has not been generated', async () => {
      prisma.shipment.findUnique.mockResolvedValue({
        labelUrl: null,
        trackingNumber: 'TRK-NOLABEL',
      });

      const result = await service.getLabel('order-1');

      expect(storage.getShippingLabelSignedUrl).not.toHaveBeenCalled();
      expect(result.labelUrl).toBeNull();
    });
  });

  // ─── cleanupStaleShippingLabels cron ──────────────────────────────────────────

  describe('cleanupStaleShippingLabels', () => {
    it('does not call deleteShippingLabel when there are no stale shipments', async () => {
      prisma.shipment.findMany.mockResolvedValue([]);

      await service.cleanupStaleShippingLabels();

      expect(storage.deleteShippingLabel).not.toHaveBeenCalled();
    });

    it('calls deleteShippingLabel for each stale shipment with a real label path', async () => {
      prisma.shipment.findMany.mockResolvedValue([
        { id: 'ship-1', labelUrl: 'labels/inpost-111.pdf' },
        { id: 'ship-2', labelUrl: 'labels/gls-222.pdf' },
      ]);
      storage.deleteShippingLabel.mockResolvedValue(undefined);
      prisma.shipment.update.mockResolvedValue({});

      await service.cleanupStaleShippingLabels();

      expect(storage.deleteShippingLabel).toHaveBeenCalledTimes(2);
      expect(storage.deleteShippingLabel).toHaveBeenCalledWith('labels/inpost-111.pdf');
      expect(storage.deleteShippingLabel).toHaveBeenCalledWith('labels/gls-222.pdf');
    });

    it('nulls out labelUrl in DB for each successfully deleted label', async () => {
      prisma.shipment.findMany.mockResolvedValue([
        { id: 'ship-1', labelUrl: 'labels/inpost-111.pdf' },
      ]);
      storage.deleteShippingLabel.mockResolvedValue(undefined);
      prisma.shipment.update.mockResolvedValue({});

      await service.cleanupStaleShippingLabels();

      expect(prisma.shipment.update).toHaveBeenCalledWith({
        where: { id: 'ship-1' },
        data: { labelUrl: null },
      });
    });

    it('skips mock-label-* paths without calling deleteShippingLabel', async () => {
      prisma.shipment.findMany.mockResolvedValue([
        { id: 'ship-m', labelUrl: 'mock-label-MOCK_INPOST_XYZ.pdf' },
      ]);

      await service.cleanupStaleShippingLabels();

      expect(storage.deleteShippingLabel).not.toHaveBeenCalled();
      expect(prisma.shipment.update).not.toHaveBeenCalled();
    });

    it('skips shipments with null labelUrl', async () => {
      prisma.shipment.findMany.mockResolvedValue([
        { id: 'ship-null', labelUrl: null },
      ]);

      await service.cleanupStaleShippingLabels();

      expect(storage.deleteShippingLabel).not.toHaveBeenCalled();
    });

    it('continues processing remaining shipments when one deletion fails', async () => {
      prisma.shipment.findMany.mockResolvedValue([
        { id: 'ship-fail', labelUrl: 'labels/inpost-fail.pdf' },
        { id: 'ship-ok', labelUrl: 'labels/inpost-ok.pdf' },
      ]);
      storage.deleteShippingLabel
        .mockRejectedValueOnce(new Error('Supabase 503'))
        .mockResolvedValueOnce(undefined);
      prisma.shipment.update.mockResolvedValue({});

      // Should not throw even though one deletion failed
      await expect(service.cleanupStaleShippingLabels()).resolves.toBeUndefined();

      // The second label was still processed
      expect(storage.deleteShippingLabel).toHaveBeenCalledTimes(2);
      expect(prisma.shipment.update).toHaveBeenCalledTimes(1);
      expect(prisma.shipment.update).toHaveBeenCalledWith({
        where: { id: 'ship-ok' },
        data: { labelUrl: null },
      });
    });

    it('skips the cleanup when another replica already holds the lock', async () => {
      redis.set.mockResolvedValue(null);

      await service.cleanupStaleShippingLabels();

      expect(prisma.shipment.findMany).not.toHaveBeenCalled();
    });

    it('acquires the lock with NX and an 82000-second TTL', async () => {
      redis.set.mockResolvedValue('OK');
      prisma.shipment.findMany.mockResolvedValue([]);

      await service.cleanupStaleShippingLabels();

      expect(redis.set).toHaveBeenCalledWith(
        'cron:cleanup-stale-shipping-labels:lock',
        '1',
        'EX',
        82000,
        'NX',
      );
    });
  });
});
