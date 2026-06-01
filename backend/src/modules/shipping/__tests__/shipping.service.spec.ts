import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CarrierCode, ShipmentStatus } from '@prisma/client';
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

  const mockOrderBase = {
    id: 'order-1',
    orderNumber: 'ORD-2026-000001',
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
  });

  describe('generateLabel', () => {
    it('throws NotFoundException when order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.generateLabel('nonexistent')).rejects.toThrow(NotFoundException);
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
        gls.createShipment.mockResolvedValue({ trackingNumber: 'GLS001', parcelId: 'P001', labelUrl: 'https://gls.pdf' } as any);
        prisma.shipment.upsert.mockResolvedValue({ labelUrl: 'https://gls.pdf', trackingNumber: 'GLS001' });

        await service.generateLabel('order-1');

        expect(gls.createShipment).toHaveBeenCalledWith(
          expect.objectContaining({ reference: 'ORD-2026-000001' }),
        );
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

  describe('getLabel', () => {
    it('returns labelUrl and trackingNumber when shipment exists', async () => {
      prisma.shipment.findUnique.mockResolvedValue({
        labelUrl: 'https://label.pdf',
        trackingNumber: 'TRK123',
      });

      const result = await service.getLabel('order-1');

      expect(result).toEqual({ labelUrl: 'https://label.pdf', trackingNumber: 'TRK123' });
    });

    it('throws NotFoundException when no shipment exists for the order', async () => {
      prisma.shipment.findUnique.mockResolvedValue(null);

      await expect(service.getLabel('order-1')).rejects.toThrow(NotFoundException);
    });
  });
});
