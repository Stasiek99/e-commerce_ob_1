import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InvoiceService, InvoiceOrder } from '../invoice.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

const MOCK_URL = 'https://cdn.example.com/FV-ORD-2026-000001.pdf';

function buildOrder(overrides: Partial<InvoiceOrder> = {}): InvoiceOrder {
  return {
    id: 'order-1',
    orderNumber: 'ORD-2026-000001',
    snapshotFirstName: 'Jan',
    snapshotLastName: 'Kowalski',
    snapshotCompany: null,
    snapshotNip: null,
    snapshotStreet: 'ul. Marszałkowska 1',
    snapshotCity: 'Warszawa',
    snapshotPostalCode: '00-001',
    itemsTotalInCents: 34900,
    shippingCostInCents: 1999,
    discountInCents: 0,
    couponCode: null,
    totalInCents: 36899,
    createdAt: new Date('2026-05-01T10:00:00Z'),
    items: [
      { snapshotName: 'Dior Sauvage 100ml', snapshotPrice: 34900, snapshotVatRate: 2300, quantity: 1 },
    ],
    ...overrides,
  };
}

describe('InvoiceService', () => {
  let service: InvoiceService;
  let mockStorage: jest.Mocked<Pick<StorageService, 'uploadInvoice'>>;
  let mockPrisma: { order: { update: jest.Mock } };

  beforeEach(async () => {
    mockStorage = { uploadInvoice: jest.fn().mockResolvedValue(MOCK_URL) };
    mockPrisma = { order: { update: jest.fn().mockResolvedValue({}) } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoiceService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) => {
              const cfg: Record<string, string> = {
                SELLER_NAME: 'Aromaterie',
                SELLER_NIP: '1234567890',
                SELLER_STREET: 'ul. Testowa 1',
                SELLER_CITY: 'Kraków',
                SELLER_POSTAL_CODE: '30-001',
              };
              return cfg[key] ?? fallback ?? '';
            }),
          },
        },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();

    service = module.get(InvoiceService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── orchestration ──────────────────────────────────────────────────────────

  describe('processInvoice — orchestration', () => {
    it('returns { url, pdf } where pdf is a non-empty Buffer', async () => {
      const result = await service.processInvoice(buildOrder());

      expect(result.url).toBe(MOCK_URL);
      expect(Buffer.isBuffer(result.pdf)).toBe(true);
      expect(result.pdf.length).toBeGreaterThan(0);
    });

    it('generated buffer starts with %PDF (valid PDF header)', async () => {
      const { pdf } = await service.processInvoice(buildOrder());

      expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    });

    it('calls storage.uploadInvoice with the correct filename', async () => {
      await service.processInvoice(buildOrder());

      expect(mockStorage.uploadInvoice).toHaveBeenCalledWith(
        expect.any(Buffer),
        'FV-ORD-2026-000001.pdf',
      );
    });

    it('saves the invoice URL on the order via prisma', async () => {
      await service.processInvoice(buildOrder());

      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { invoiceUrl: MOCK_URL },
      });
    });

    it('propagates storage errors without swallowing them', async () => {
      mockStorage.uploadInvoice.mockRejectedValue(new Error('Supabase bucket full'));

      await expect(service.processInvoice(buildOrder())).rejects.toThrow('Supabase bucket full');
    });
  });

  // ── per-item VAT rate — does not crash ─────────────────────────────────────

  describe('processInvoice — per-item VAT rate rendering', () => {
    it('generates a valid PDF for a standard 23% rate item', async () => {
      const { pdf } = await service.processInvoice(
        buildOrder({
          items: [{ snapshotName: 'Perfumy Gold 50ml', snapshotPrice: 19900, snapshotVatRate: 2300, quantity: 2 }],
        }),
      );

      expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    });

    it('generates a valid PDF for a 5% VAT item', async () => {
      const { pdf } = await service.processInvoice(
        buildOrder({
          items: [{ snapshotName: 'Produkt 5%', snapshotPrice: 10000, snapshotVatRate: 500, quantity: 1 }],
        }),
      );

      expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    });

    it('generates a valid PDF for an exempt (0%) item', async () => {
      const { pdf } = await service.processInvoice(
        buildOrder({
          items: [{ snapshotName: 'Produkt zwolniony', snapshotPrice: 5000, snapshotVatRate: 0, quantity: 1 }],
        }),
      );

      expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    });

    it('generates a valid PDF for a mixed-rate order (23% and 5%)', async () => {
      const { pdf } = await service.processInvoice(
        buildOrder({
          items: [
            { snapshotName: 'Perfumy 23%', snapshotPrice: 34900, snapshotVatRate: 2300, quantity: 1 },
            { snapshotName: 'Produkt 5%',  snapshotPrice: 10000, snapshotVatRate: 500,  quantity: 2 },
          ],
        }),
      );

      expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    });

    it('generates a valid PDF when shipping cost is zero', async () => {
      const { pdf } = await service.processInvoice(
        buildOrder({ shippingCostInCents: 0 }),
      );

      expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    });

    it('generates a valid PDF for a multi-item order with quantity > 1', async () => {
      const { pdf } = await service.processInvoice(
        buildOrder({
          items: [
            { snapshotName: 'Oud 100ml',  snapshotPrice: 29900, snapshotVatRate: 2300, quantity: 3 },
            { snapshotName: 'Rose 50ml',  snapshotPrice: 19900, snapshotVatRate: 2300, quantity: 2 },
          ],
        }),
      );

      expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    });
  });

  // ── discount line item (Art. 106e pkt 7 Ustawy o VAT) ────────────────────

  describe('processInvoice — discount / coupon line item', () => {
    it('generates a valid PDF when order has a coupon discount', async () => {
      const { pdf } = await service.processInvoice(
        buildOrder({
          discountInCents: 5000,
          couponCode: 'SUMMER10',
          totalInCents: 31899, // 36899 - 5000
        }),
      );

      expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    });

    it('generates a valid PDF when discountInCents is 0 (no coupon)', async () => {
      const { pdf } = await service.processInvoice(
        buildOrder({ discountInCents: 0, couponCode: null }),
      );

      expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    });

    it('generates a valid PDF when couponCode is null but discount is non-zero', async () => {
      const { pdf } = await service.processInvoice(
        buildOrder({ discountInCents: 2000, couponCode: null, totalInCents: 34899 }),
      );

      expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    });
  });

  // ── VAT arithmetic invariants ──────────────────────────────────────────────
  // These verify the math: netCents = round(grossCents / (1 + rate))
  // We confirm the expected formula holds for the rates we support.

  describe('VAT basis-point conversion', () => {
    it('converts 2300 basis points to 0.23 rate: round(10000/1.23) = 8130', () => {
      const grossCents = 10000;
      const rate = 2300 / 10000;
      const netCents = Math.round(grossCents / (1 + rate));
      const vatCents = grossCents - netCents;

      expect(netCents).toBe(8130);
      expect(vatCents).toBe(1870);
    });

    it('converts 500 basis points to 0.05 rate: round(10500/1.05) = 10000', () => {
      const grossCents = 10500;
      const rate = 500 / 10000;
      const netCents = Math.round(grossCents / (1 + rate));
      const vatCents = grossCents - netCents;

      expect(netCents).toBe(10000);
      expect(vatCents).toBe(500);
    });

    it('converts 0 basis points (exempt): netCents equals grossCents, vatCents is 0', () => {
      const grossCents = 5000;
      const rate = 0 / 10000;
      const netCents = Math.round(grossCents / (1 + rate));
      const vatCents = grossCents - netCents;

      expect(netCents).toBe(5000);
      expect(vatCents).toBe(0);
    });
  });
});
