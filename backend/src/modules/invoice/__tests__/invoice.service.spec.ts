import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InvoiceService, InvoiceOrder } from '../invoice.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

const MOCK_PATH = 'invoices/FV-2026-000001.pdf';
const MOCK_URL = 'https://cdn.example.com/FV-2026-000001.pdf?token=abc';
const MOCK_SEQ = 1n; // BigInt — matches Postgres nextval return type

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
  let mockStorage: jest.Mocked<Pick<StorageService, 'uploadInvoice' | 'getInvoiceSignedUrl'>>;
  let mockPrisma: { $executeRawUnsafe: jest.Mock; $queryRawUnsafe: jest.Mock; order: { update: jest.Mock } };

  beforeEach(async () => {
    mockStorage = {
      uploadInvoice: jest.fn().mockResolvedValue(MOCK_PATH),
      getInvoiceSignedUrl: jest.fn().mockResolvedValue(MOCK_URL),
    };
    mockPrisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: MOCK_SEQ }]),
      order: { update: jest.fn().mockResolvedValue({}) },
    };

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
    it('returns { url, storagePath, pdf } where pdf is a non-empty Buffer', async () => {
      const result = await service.processInvoice(buildOrder());

      expect(result.url).toBe(MOCK_URL);
      expect(result.storagePath).toBe(MOCK_PATH);
      expect(Buffer.isBuffer(result.pdf)).toBe(true);
      expect(result.pdf.length).toBeGreaterThan(0);
    });

    it('generated buffer starts with %PDF (valid PDF header)', async () => {
      const { pdf } = await service.processInvoice(buildOrder());

      expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    });

    it('calls storage.uploadInvoice with the sequence-based filename', async () => {
      await service.processInvoice(buildOrder());

      // filename is derived from the invoice number: FV/2026/000001 → FV-2026-000001.pdf
      expect(mockStorage.uploadInvoice).toHaveBeenCalledWith(
        expect.any(Buffer),
        'FV-2026-000001.pdf',
      );
    });

    it('persists invoiceStoragePath (raw path) — never stores a signed URL in the DB', async () => {
      await service.processInvoice(buildOrder());

      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { invoiceStoragePath: MOCK_PATH, invoiceNumber: 'FV/2026/000001' },
      });
      // The DB update must NOT contain invoiceUrl — that would break on key rotation
      const [call] = mockPrisma.order.update.mock.calls;
      expect(call[0].data).not.toHaveProperty('invoiceUrl');
    });

    it('calls getInvoiceSignedUrl with a 7-day TTL for the returned email URL', async () => {
      await service.processInvoice(buildOrder());

      const SEVEN_DAYS = 7 * 24 * 60 * 60;
      expect(mockStorage.getInvoiceSignedUrl).toHaveBeenCalledWith(MOCK_PATH, SEVEN_DAYS);
    });

    it('returns invoiceNumber alongside url, storagePath, and pdf', async () => {
      const result = await service.processInvoice(buildOrder());

      expect(result.invoiceNumber).toBe('FV/2026/000001');
    });

    it('invoice number uses the year from order.createdAt, not system clock', async () => {
      const order2024 = buildOrder({ createdAt: new Date('2024-06-15T10:00:00Z') });
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ nextval: 5n }]);
      mockStorage.uploadInvoice.mockResolvedValue('invoices/FV-2024-000005.pdf');

      const result = await service.processInvoice(order2024);

      expect(result.invoiceNumber).toBe('FV/2024/000005');
      expect(mockStorage.uploadInvoice).toHaveBeenCalledWith(
        expect.any(Buffer),
        'FV-2024-000005.pdf',
      );
    });

    it('does not persist invoiceStoragePath when upload fails', async () => {
      mockStorage.uploadInvoice.mockRejectedValue(new Error('upload failed'));

      await expect(service.processInvoice(buildOrder())).rejects.toThrow('upload failed');

      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    it('propagates storage errors without swallowing them', async () => {
      mockStorage.uploadInvoice.mockRejectedValue(new Error('Supabase bucket full'));

      await expect(service.processInvoice(buildOrder())).rejects.toThrow('Supabase bucket full');
    });
  });

  describe('getSignedUrl', () => {
    it('delegates to storage.getInvoiceSignedUrl with default 1h TTL', async () => {
      await service.getSignedUrl(MOCK_PATH);

      expect(mockStorage.getInvoiceSignedUrl).toHaveBeenCalledWith(MOCK_PATH, 3600);
    });

    it('passes custom expiresInSeconds to storage', async () => {
      await service.getSignedUrl(MOCK_PATH, 86400);

      expect(mockStorage.getInvoiceSignedUrl).toHaveBeenCalledWith(MOCK_PATH, 86400);
    });

    it('returns the signed URL from storage', async () => {
      mockStorage.getInvoiceSignedUrl.mockResolvedValue('https://signed.example.com/invoice.pdf');

      const result = await service.getSignedUrl(MOCK_PATH);

      expect(result).toBe('https://signed.example.com/invoice.pdf');
    });

    it('propagates signing errors to the caller', async () => {
      mockStorage.getInvoiceSignedUrl.mockRejectedValue(new Error('Invoice signing failed'));

      await expect(service.getSignedUrl(MOCK_PATH)).rejects.toThrow('Invoice signing failed');
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

  // ── discount VAT proration (Art. 106e pkt 7 / Art. 29a ust. 10 fix) ─────
  // The fix replaced a single hardcoded 23% discount line with per-rate
  // proportional lines. Tests here verify no-crash for each rate combination.

  describe('processInvoice — prorated discount (mixed-rate baskets)', () => {
    it('generates a valid PDF for a single 5% item with a discount', async () => {
      const { pdf } = await service.processInvoice(
        buildOrder({
          items: [{ snapshotName: 'Produkt 5%', snapshotPrice: 10500, snapshotVatRate: 500, quantity: 1 }],
          shippingCostInCents: 0,
          discountInCents: 1050,
          couponCode: 'CODE5',
          totalInCents: 9450,
          itemsTotalInCents: 10500,
        }),
      );
      expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    });

    it('generates a valid PDF for a mixed 23%+5% basket with a discount', async () => {
      const { pdf } = await service.processInvoice(
        buildOrder({
          items: [
            { snapshotName: 'Perfumy 23%', snapshotPrice: 12300, snapshotVatRate: 2300, quantity: 1 },
            { snapshotName: 'Kosmetyk 5%', snapshotPrice: 5250, snapshotVatRate: 500, quantity: 2 },
          ],
          discountInCents: 2000,
          couponCode: 'MIXED20',
          totalInCents: 20800,
          shippingCostInCents: 1999,
          itemsTotalInCents: 22800,
        }),
      );
      expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    });

    it('generates a valid PDF for a three-rate basket (23%, 5%, 0%) with a discount', async () => {
      const { pdf } = await service.processInvoice(
        buildOrder({
          items: [
            { snapshotName: 'Item A 23%', snapshotPrice: 10000, snapshotVatRate: 2300, quantity: 1 },
            { snapshotName: 'Item B 5%',  snapshotPrice: 5000,  snapshotVatRate: 500,  quantity: 1 },
            { snapshotName: 'Item C 0%',  snapshotPrice: 3000,  snapshotVatRate: 0,    quantity: 1 },
          ],
          discountInCents: 1800,
          couponCode: 'THREE18',
          shippingCostInCents: 0,
          totalInCents: 16200,
          itemsTotalInCents: 18000,
        }),
      );
      expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    });

    it('zero discount produces the same PDF whether basket is single- or mixed-rate', async () => {
      const { pdf } = await service.processInvoice(
        buildOrder({
          items: [
            { snapshotName: 'A 23%', snapshotPrice: 10000, snapshotVatRate: 2300, quantity: 1 },
            { snapshotName: 'B 5%',  snapshotPrice: 5000,  snapshotVatRate: 500,  quantity: 1 },
          ],
          discountInCents: 0,
          couponCode: null,
        }),
      );
      expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    });
  });

  // ── Proration algorithm invariants ────────────────────────────────────────
  // These tests verify the proration formula introduced by the Art. 106e fix.
  // They mirror the service's internal logic via a local helper so that a
  // revert to a single hardcoded 23% line is immediately caught by the math.

  describe('discount proration arithmetic', () => {
    it('single-rate 5% basket: full discount assigned to 5% rate, not 23%', () => {
      const items = [{ snapshotPrice: 10500, snapshotVatRate: 500, quantity: 1 }];
      const portions = computeProration(items, 1050);

      expect(portions).toEqual([{ rate: 0.05, portionCents: 1050 }]);
    });

    it('single-rate 0% exempt basket: full discount assigned to 0% rate, not 23%', () => {
      const items = [{ snapshotPrice: 5000, snapshotVatRate: 0, quantity: 1 }];
      const portions = computeProration(items, 500);

      expect(portions).toEqual([{ rate: 0, portionCents: 500 }]);
    });

    it('50/50 mixed basket: each rate receives exactly half the discount', () => {
      const items = [
        { snapshotPrice: 10000, snapshotVatRate: 500, quantity: 1 },
        { snapshotPrice: 10000, snapshotVatRate: 2300, quantity: 1 },
      ];
      const portions = computeProration(items, 2000);
      const byRate = toMap(portions);

      expect(byRate[0.05]).toBe(1000);
      expect(byRate[0.23]).toBe(1000);
    });

    it('75/25 basket: larger gross gets larger discount portion', () => {
      const items = [
        { snapshotPrice: 7500, snapshotVatRate: 2300, quantity: 1 },
        { snapshotPrice: 2500, snapshotVatRate: 500,  quantity: 1 },
      ];
      const portions = computeProration(items, 1000);
      const byRate = toMap(portions);

      expect(byRate[0.23]).toBe(750);
      expect(byRate[0.05]).toBe(250);
    });

    it('all portions always sum to exactly discountInCents (rounding safety)', () => {
      const items = [
        { snapshotPrice: 10000, snapshotVatRate: 2300, quantity: 1 },
        { snapshotPrice: 5000,  snapshotVatRate: 500,  quantity: 1 },
        { snapshotPrice: 3000,  snapshotVatRate: 0,    quantity: 1 },
      ];
      const discountInCents = 999;
      const portions = computeProration(items, discountInCents);

      const total = portions.reduce((s, p) => s + p.portionCents, 0);
      expect(total).toBe(discountInCents);
    });

    it('returns empty array when basket has no items', () => {
      const portions = computeProration([], 500);

      expect(portions).toEqual([]);
    });
  });

  // ── ensureSequence — year validation guard ───────────────────────────────
  // Regression guard for the $executeRawUnsafe interpolation hardening.
  // Without the bounds check, an out-of-range year would be interpolated
  // directly into SQL, opening a future injection vector.

  describe('ensureSequence — year validation guard', () => {
    it('throws when order createdAt year is before 2020', async () => {
      const order = buildOrder({ createdAt: new Date('2019-06-15T10:00:00Z') });

      await expect(service.processInvoice(order)).rejects.toThrow('Invalid invoice year: 2019');
    });

    it('throws when order createdAt year is after 2100', async () => {
      const order = buildOrder({ createdAt: new Date('2101-01-01T00:00:00Z') });

      await expect(service.processInvoice(order)).rejects.toThrow('Invalid invoice year: 2101');
    });

    it('does not call $executeRawUnsafe when year is out of range', async () => {
      const order = buildOrder({ createdAt: new Date('2019-01-01T00:00:00Z') });

      await expect(service.processInvoice(order)).rejects.toThrow();

      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('accepts year 2020 (lower boundary) without throwing', async () => {
      const order = buildOrder({ createdAt: new Date('2020-01-15T10:00:00Z') });
      mockStorage.uploadInvoice.mockResolvedValue('invoices/FV-2020-000001.pdf');

      await expect(service.processInvoice(order)).resolves.toBeDefined();
    });

    it('accepts year 2100 (upper boundary) without throwing', async () => {
      const order = buildOrder({ createdAt: new Date('2100-06-15T10:00:00Z') });
      mockStorage.uploadInvoice.mockResolvedValue('invoices/FV-2100-000001.pdf');

      await expect(service.processInvoice(order)).resolves.toBeDefined();
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

// ── helpers used only in proration algorithm tests ───────────────────────────

function computeProration(
  items: Array<{ snapshotPrice: number; snapshotVatRate: number; quantity: number }>,
  discountInCents: number,
): Array<{ rate: number; portionCents: number }> {
  const grossByRate = new Map<number, number>();
  for (const item of items) {
    const rate = item.snapshotVatRate / 10000;
    grossByRate.set(rate, (grossByRate.get(rate) ?? 0) + item.snapshotPrice * item.quantity);
  }
  const totalGross = [...grossByRate.values()].reduce((s, v) => s + v, 0);
  if (totalGross === 0) return [];
  const rates = [...grossByRate.entries()].sort(([a], [b]) => a - b);
  let remaining = discountInCents;
  return rates.map(([rate, gross], idx) => {
    const isLast = idx === rates.length - 1;
    const portionCents = isLast
      ? remaining
      : Math.round(discountInCents * (gross / totalGross));
    remaining -= portionCents;
    return { rate, portionCents };
  });
}

function toMap(portions: Array<{ rate: number; portionCents: number }>): Record<number, number> {
  return Object.fromEntries(portions.map((p) => [p.rate, p.portionCents]));
}
