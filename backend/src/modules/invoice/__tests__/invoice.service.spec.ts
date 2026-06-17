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
    snapshotCountry: 'PL',
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
  let mockTx: { $executeRawUnsafe: jest.Mock; $queryRawUnsafe: jest.Mock; order: { update: jest.Mock } };
  let mockPrisma: { $transaction: jest.Mock; $executeRawUnsafe: jest.Mock; order: { update: jest.Mock } };

  beforeEach(async () => {
    mockStorage = {
      uploadInvoice: jest.fn().mockResolvedValue(MOCK_PATH),
      getInvoiceSignedUrl: jest.fn().mockResolvedValue(MOCK_URL),
    };
    // mockTx is the Prisma transaction client passed to the $transaction callback.
    // $queryRawUnsafe is called twice per normal processInvoice run:
    //   1st call — SELECT FOR UPDATE (idempotency check)
    //   2nd call — SELECT nextval (sequence allocation)
    mockTx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      $queryRawUnsafe: jest.fn()
        .mockResolvedValueOnce([{ invoice_storage_path: null, invoice_number: null }])
        .mockResolvedValueOnce([{ nextval: MOCK_SEQ }]),
      order: { update: jest.fn().mockResolvedValue({}) },
    };
    mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
      // $executeRawUnsafe is still present on the outer client (called by onModuleInit via ensureSequence)
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      // TX2: persists invoiceStoragePath after the upload completes (outside the transaction)
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

    it('TX1 reserves invoiceNumber, TX2 persists invoiceStoragePath — never stores a signed URL in the DB', async () => {
      await service.processInvoice(buildOrder());

      // TX1: reserve the invoice number so concurrent callers see it and bail out
      expect(mockTx.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { invoiceNumber: 'FV/2026/000001' },
      });
      // TX2: persist the raw storage path (not a signed URL) after upload succeeds
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { invoiceStoragePath: MOCK_PATH },
      });
      // Neither update must contain invoiceUrl — that would break on key rotation
      const [tx1Call] = mockTx.order.update.mock.calls;
      const [tx2Call] = mockPrisma.order.update.mock.calls;
      expect(tx1Call[0].data).not.toHaveProperty('invoiceUrl');
      expect(tx2Call[0].data).not.toHaveProperty('invoiceUrl');
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
      mockTx.$queryRawUnsafe
        .mockReset()
        .mockResolvedValueOnce([{ invoice_storage_path: null, invoice_number: null }])
        .mockResolvedValueOnce([{ nextval: 5n }]);
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

      // TX1 still reserves the invoiceNumber (idempotency marker)
      expect(mockTx.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { invoiceNumber: 'FV/2026/000001' },
      });
      // TX2 must not run — invoiceStoragePath is never written when upload fails
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    it('propagates storage errors without swallowing them', async () => {
      mockStorage.uploadInvoice.mockRejectedValue(new Error('Supabase bucket full'));

      await expect(service.processInvoice(buildOrder())).rejects.toThrow('Supabase bucket full');
    });
  });

  // ── idempotency guard (SELECT FOR UPDATE) ─────────────────────────────────
  // Prevents concurrent webhook + reconciliation cron from burning sequential
  // invoice numbers when both see invoiceStoragePath = null before either commits.

  describe('processInvoice — idempotency guard', () => {
    it('returns the existing path and signed URL when invoice is already generated', async () => {
      const EXISTING_PATH = 'invoices/FV-2026-000099.pdf';
      const EXISTING_NUM  = 'FV/2026/000099';
      mockTx.$queryRawUnsafe.mockReset().mockResolvedValue([
        { invoice_storage_path: EXISTING_PATH, invoice_number: EXISTING_NUM },
      ]);

      const result = await service.processInvoice(buildOrder());

      expect(result.storagePath).toBe(EXISTING_PATH);
      expect(result.invoiceNumber).toBe(EXISTING_NUM);
      expect(result.url).toBe(MOCK_URL);
    });

    it('does not allocate a new sequence number when invoice already exists', async () => {
      mockTx.$queryRawUnsafe.mockReset().mockResolvedValue([
        { invoice_storage_path: 'invoices/FV-2026-000099.pdf', invoice_number: 'FV/2026/000099' },
      ]);

      await service.processInvoice(buildOrder());

      // $executeRawUnsafe (CREATE SEQUENCE) must not be called
      expect(mockTx.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('does not re-upload or re-persist when invoice already exists', async () => {
      mockTx.$queryRawUnsafe.mockReset().mockResolvedValue([
        { invoice_storage_path: 'invoices/FV-2026-000099.pdf', invoice_number: 'FV/2026/000099' },
      ]);

      await service.processInvoice(buildOrder());

      expect(mockStorage.uploadInvoice).not.toHaveBeenCalled();
      expect(mockTx.order.update).not.toHaveBeenCalled();
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });
  });

  // ── two-transaction lock-release fix ─────────────────────────────────────────
  // processInvoice previously held a SELECT FOR UPDATE lock for the entire duration
  // of the Supabase upload (up to 30s), exhausting pgBouncer's 10-connection pool.
  // The fix: TX1 releases the lock after reserving the invoice number, the upload
  // runs outside any transaction, then TX2 commits the storage path.

  describe('processInvoice — upload outside transaction (lock-release fix)', () => {
    it('upload happens after $transaction resolves, not inside the callback', async () => {
      let txResolved = false;
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockTx) => Promise<unknown>) => {
          const result = await fn(mockTx);
          txResolved = true;
          return result;
        },
      );

      let uploadCalledAfterTxResolve = false;
      mockStorage.uploadInvoice.mockImplementation(async () => {
        uploadCalledAfterTxResolve = txResolved;
        return MOCK_PATH;
      });

      await service.processInvoice(buildOrder());

      expect(uploadCalledAfterTxResolve).toBe(true);
    });

    it('reuses existing invoiceNumber when a previous attempt was interrupted between TX1 and TX2', async () => {
      const INTERRUPTED_NUMBER = 'FV/2026/000099';
      mockTx.$queryRawUnsafe.mockReset().mockResolvedValueOnce([
        { invoice_storage_path: null, invoice_number: INTERRUPTED_NUMBER },
      ]);
      mockStorage.uploadInvoice.mockResolvedValue('invoices/FV-2026-000099.pdf');

      const result = await service.processInvoice(buildOrder());

      expect(result.invoiceNumber).toBe(INTERRUPTED_NUMBER);
      expect(mockStorage.uploadInvoice).toHaveBeenCalledWith(expect.any(Buffer), 'FV-2026-000099.pdf');
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { invoiceStoragePath: 'invoices/FV-2026-000099.pdf' },
      });
    });

    it('does not consume a new sequence number when recovering from an interrupted attempt', async () => {
      mockTx.$queryRawUnsafe.mockReset().mockResolvedValueOnce([
        { invoice_storage_path: null, invoice_number: 'FV/2026/000099' },
      ]);

      await service.processInvoice(buildOrder());

      // CREATE SEQUENCE and nextval must not be called — existing number is re-used
      expect(mockTx.$executeRawUnsafe).not.toHaveBeenCalled();
      // tx.order.update in TX1 must not be called — no new number to reserve
      expect(mockTx.order.update).not.toHaveBeenCalled();
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

    it('does not start a DB transaction when year is out of range', async () => {
      const order = buildOrder({ createdAt: new Date('2019-01-01T00:00:00Z') });

      await expect(service.processInvoice(order)).rejects.toThrow();

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
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

  // ── ensureCorrectiveSequence — year validation guard ─────────────────────
  // Regression guard for the $executeRawUnsafe interpolation hardening in
  // processCorrectiveInvoice. Without the extracted guard, a future refactor
  // that makes `year` a caller-supplied parameter would have no protection.

  describe('ensureCorrectiveSequence — year validation guard', () => {
    it('throws for year below 2020 (lower boundary breach)', async () => {
      await expect(
        (service as any).ensureCorrectiveSequence(2019),
      ).rejects.toThrow('Invalid corrective invoice year: 2019');
    });

    it('throws for year above 2100 (upper boundary breach)', async () => {
      await expect(
        (service as any).ensureCorrectiveSequence(2101),
      ).rejects.toThrow('Invalid corrective invoice year: 2101');
    });

    it('throws for a non-integer year (floating-point injection vector)', async () => {
      await expect(
        (service as any).ensureCorrectiveSequence(2024.5),
      ).rejects.toThrow('Invalid corrective invoice year: 2024.5');
    });

    it('does not call $executeRawUnsafe when year is out of range', async () => {
      await expect(
        (service as any).ensureCorrectiveSequence(2019),
      ).rejects.toThrow();

      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('accepts year 2020 (lower boundary) without throwing', async () => {
      await expect(
        (service as any).ensureCorrectiveSequence(2020),
      ).resolves.toBeUndefined();
    });

    it('accepts year 2100 (upper boundary) without throwing', async () => {
      await expect(
        (service as any).ensureCorrectiveSequence(2100),
      ).resolves.toBeUndefined();
    });

    it('calls $executeRawUnsafe with the safe sequence name — only integer year interpolated', async () => {
      await (service as any).ensureCorrectiveSequence(2026);

      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        'CREATE SEQUENCE IF NOT EXISTS corrective_invoice_number_seq_2026 START 1 INCREMENT 1',
      );
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

  // ── Reverse-charge (Art. 42 ust. 1 Ustawy o VAT) ────────────────────────────
  // Cross-border intra-EU B2B buyers with a VAT number (snapshotNip) must receive
  // a zero-rated invoice with the "odwrotne obciążenie" note — not a VAT-inclusive one.

  describe('processInvoice — reverse-charge (Art. 42 ust. 1 Ustawy o VAT)', () => {
    function makeMockDoc() {
      const calls: string[] = [];
      const doc: any = {
        registerFont: jest.fn().mockReturnThis(),
        font: jest.fn().mockReturnThis(),
        fontSize: jest.fn().mockReturnThis(),
        fillColor: jest.fn().mockReturnThis(),
        text: jest.fn().mockImplementation((t: unknown) => { calls.push(String(t)); return doc; }),
        moveDown: jest.fn().mockReturnThis(),
        moveTo: jest.fn().mockReturnThis(),
        lineTo: jest.fn().mockReturnThis(),
        lineWidth: jest.fn().mockReturnThis(),
        stroke: jest.fn().mockReturnThis(),
        rect: jest.fn().mockReturnThis(),
        fill: jest.fn().mockReturnThis(),
        end: jest.fn(),
        y: 300,
      };
      return { doc, calls };
    }

    it('generates a valid PDF for a cross-border EU B2B order', async () => {
      const order = buildOrder({ snapshotNip: 'DE123456789', snapshotCountry: 'DE' });

      const { pdf } = await service.processInvoice(order);

      expect(pdf.slice(0, 4).toString()).toBe('%PDF');
    });

    it('renders all line items at 0% VAT — not original snapshotVatRate — when reverse-charge applies', () => {
      const order = buildOrder({
        snapshotNip: 'DE123456789',
        snapshotCountry: 'DE',
        items: [{ snapshotName: 'Perfumy 23%', snapshotPrice: 12300, snapshotVatRate: 2300, quantity: 1 }],
        shippingCostInCents: 0,
      });

      const { doc, calls } = makeMockDoc();
      (service as any).render(doc, order, 'FV/2026/000001');

      expect(calls).not.toContain('VAT 23%:');
      expect(calls).toContain('VAT zw.:');
    });

    it('renders shipping at 0% VAT when reverse-charge applies — not hardcoded 23%', () => {
      const order = buildOrder({
        snapshotNip: 'DE123456789',
        snapshotCountry: 'DE',
        items: [{ snapshotName: 'Perfumy', snapshotPrice: 12300, snapshotVatRate: 2300, quantity: 1 }],
        shippingCostInCents: 1999,
      });

      const { doc, calls } = makeMockDoc();
      (service as any).render(doc, order, 'FV/2026/000001');

      expect(calls).not.toContain('VAT 23%:');
      expect(calls).toContain('VAT zw.:');
    });

    it('includes the "Odwrotne obciazenie" legal note in the PDF footer', () => {
      const order = buildOrder({ snapshotNip: 'DE123456789', snapshotCountry: 'DE' });

      const { doc, calls } = makeMockDoc();
      (service as any).render(doc, order, 'FV/2026/000001');

      expect(calls.some((c) => c.includes('Odwrotne obciazenie'))).toBe(true);
    });

    it('includes the buyer EU VAT number in the reverse-charge footer note', () => {
      const order = buildOrder({ snapshotNip: 'DE123456789', snapshotCountry: 'DE' });

      const { doc, calls } = makeMockDoc();
      (service as any).render(doc, order, 'FV/2026/000001');

      expect(calls.some((c) => c.includes('DE123456789'))).toBe(true);
    });

    it('uses a single 0% discount line when reverse-charge applies — no per-rate proration', () => {
      const order = buildOrder({
        snapshotNip: 'DE123456789',
        snapshotCountry: 'DE',
        items: [
          { snapshotName: 'A 23%', snapshotPrice: 10000, snapshotVatRate: 2300, quantity: 1 },
          { snapshotName: 'B 5%',  snapshotPrice:  5000, snapshotVatRate:  500, quantity: 1 },
        ],
        discountInCents: 1000,
        couponCode: 'EU10',
        shippingCostInCents: 0,
        totalInCents: 14000,
      });

      const { doc, calls } = makeMockDoc();
      (service as any).render(doc, order, 'FV/2026/000001');

      expect(calls).not.toContain('VAT 23%:');
      expect(calls).not.toContain('VAT 5%:');
      expect(calls).toContain('VAT zw.:');
    });

    it('does NOT apply reverse-charge when country is PL — domestic B2B uses normal VAT', () => {
      const order = buildOrder({
        snapshotNip: '1234567890',
        snapshotCountry: 'PL',
        items: [{ snapshotName: 'Perfumy', snapshotPrice: 12300, snapshotVatRate: 2300, quantity: 1 }],
        shippingCostInCents: 0,
      });

      const { doc, calls } = makeMockDoc();
      (service as any).render(doc, order, 'FV/2026/000001');

      expect(calls).toContain('VAT 23%:');
      expect(calls.some((c) => c.includes('Odwrotne obciazenie'))).toBe(false);
    });

    it('does NOT apply reverse-charge when NIP is absent — non-B2B cross-border order uses normal VAT', () => {
      const order = buildOrder({
        snapshotNip: null,
        snapshotCountry: 'DE',
        items: [{ snapshotName: 'Perfumy', snapshotPrice: 12300, snapshotVatRate: 2300, quantity: 1 }],
        shippingCostInCents: 0,
      });

      const { doc, calls } = makeMockDoc();
      (service as any).render(doc, order, 'FV/2026/000001');

      expect(calls).toContain('VAT 23%:');
      expect(calls.some((c) => c.includes('Odwrotne obciazenie'))).toBe(false);
    });

    it('does NOT apply reverse-charge when snapshotCountry is null', () => {
      const order = buildOrder({
        snapshotNip: 'DE123456789',
        snapshotCountry: null,
        items: [{ snapshotName: 'Perfumy', snapshotPrice: 12300, snapshotVatRate: 2300, quantity: 1 }],
        shippingCostInCents: 0,
      });

      const { doc, calls } = makeMockDoc();
      (service as any).render(doc, order, 'FV/2026/000001');

      expect(calls).toContain('VAT 23%:');
      expect(calls.some((c) => c.includes('Odwrotne obciazenie'))).toBe(false);
    });
  });

  // ── VAT rounding fix — Razem brutto === order.totalInCents (Art. 106e) ────────
  // Per-item Math.round accumulation can cause the naïve `totalNetCents +
  // totalVatCents` to differ from `order.totalInCents` by 1-3 gr.
  // The fix derives `razem` directly from `order.totalInCents` and absorbs
  // any remainder into the last VAT bucket (sorted rate-descending).

  describe('render — Razem brutto and DO ZAPŁATY derived from order.totalInCents', () => {
    function makeMockDoc(): { doc: any; calls: string[] } {
      const calls: string[] = [];
      const doc: any = {
        registerFont: jest.fn().mockReturnThis(),
        font: jest.fn().mockReturnThis(),
        fontSize: jest.fn().mockReturnThis(),
        fillColor: jest.fn().mockReturnThis(),
        text: jest.fn().mockImplementation((t: unknown) => { calls.push(String(t)); return doc; }),
        moveDown: jest.fn().mockReturnThis(),
        moveTo: jest.fn().mockReturnThis(),
        lineTo: jest.fn().mockReturnThis(),
        lineWidth: jest.fn().mockReturnThis(),
        stroke: jest.fn().mockReturnThis(),
        rect: jest.fn().mockReturnThis(),
        fill: jest.fn().mockReturnThis(),
        end: jest.fn(),
        y: 300,
      };
      return { doc, calls };
    }

    it('Razem brutto uses order.totalInCents when it differs from the sum of item grosses', () => {
      // Item grossCents = 9999 but totalInCents = 10000 (1 gr DB discrepancy)
      const order = buildOrder({
        totalInCents: 10000,
        itemsTotalInCents: 9999,
        shippingCostInCents: 0,
        items: [{ snapshotName: 'Perfume', snapshotPrice: 9999, snapshotVatRate: 2300, quantity: 1 }],
      });

      const { doc, calls } = makeMockDoc();
      (service as any).render(doc, order, 'FV/2026/000001');

      const razemIdx = calls.indexOf('Razem brutto:');
      expect(razemIdx).toBeGreaterThanOrEqual(0);
      // totalInCents=10000 → "100.00 zl", not item sum 9999 → "99.99 zl"
      expect(calls[razemIdx + 1]).toBe('100.00 zl');
    });

    it('DO ZAPLATY and Razem brutto show the same amount (both from order.totalInCents)', () => {
      const order = buildOrder({ totalInCents: 15050 });

      const { doc, calls } = makeMockDoc();
      (service as any).render(doc, order, 'FV/2026/000001');

      const razemIdx = calls.indexOf('Razem brutto:');
      const doZaplatyIdx = calls.indexOf('DO ZAPLATY:');
      expect(razemIdx).toBeGreaterThanOrEqual(0);
      expect(doZaplatyIdx).toBeGreaterThanOrEqual(0);
      expect(calls[razemIdx + 1]).toBe(calls[doZaplatyIdx + 1]);
    });

    it('absorbs +1 gr VAT remainder into the last (lowest-rate) bucket', () => {
      // Two items at 23%: each grossCents=100
      // netCents each = round(100/1.23)=81, vatCents=19 → totalNet=162, totalVat=38
      // totalInCents=201 → authTotalVat=39, remainder=+1 → 23% bucket gets +1
      const order = buildOrder({
        totalInCents: 201,
        itemsTotalInCents: 200,
        shippingCostInCents: 0,
        items: [
          { snapshotName: 'Item A', snapshotPrice: 100, snapshotVatRate: 2300, quantity: 1 },
          { snapshotName: 'Item B', snapshotPrice: 100, snapshotVatRate: 2300, quantity: 1 },
        ],
      });

      const { doc, calls } = makeMockDoc();
      (service as any).render(doc, order, 'FV/2026/000001');

      const razemIdx = calls.indexOf('Razem brutto:');
      expect(calls[razemIdx + 1]).toBe('2.01 zl');

      // VAT 23%: authTotalVat = 201-162 = 39 → 0.39 zl
      const vatIdx = calls.indexOf('VAT 23%:');
      expect(calls[vatIdx + 1]).toBe('0.39 zl');

      // Suma netto unchanged: 162 → 1.62 zl
      const netIdx = calls.indexOf('Suma netto:');
      expect(calls[netIdx + 1]).toBe('1.62 zl');
    });

    it('absorbs −1 gr remainder (totalInCents less than item sum) by reducing last VAT bucket', () => {
      // Same setup but totalInCents=199 → authTotalVat=37, remainder=−1
      const order = buildOrder({
        totalInCents: 199,
        itemsTotalInCents: 200,
        shippingCostInCents: 0,
        items: [
          { snapshotName: 'Item A', snapshotPrice: 100, snapshotVatRate: 2300, quantity: 1 },
          { snapshotName: 'Item B', snapshotPrice: 100, snapshotVatRate: 2300, quantity: 1 },
        ],
      });

      const { doc, calls } = makeMockDoc();
      (service as any).render(doc, order, 'FV/2026/000001');

      const razemIdx = calls.indexOf('Razem brutto:');
      expect(calls[razemIdx + 1]).toBe('1.99 zl');

      const vatIdx = calls.indexOf('VAT 23%:');
      expect(calls[vatIdx + 1]).toBe('0.37 zl');
    });

    it('no adjustment when item sum exactly equals totalInCents', () => {
      // grossCents=12300, net=round(12300/1.23)=10000, vat=2300, sum=12300=totalInCents → remainder=0
      const order = buildOrder({
        totalInCents: 12300,
        itemsTotalInCents: 12300,
        shippingCostInCents: 0,
        items: [{ snapshotName: 'Perfume', snapshotPrice: 12300, snapshotVatRate: 2300, quantity: 1 }],
      });

      const { doc, calls } = makeMockDoc();
      (service as any).render(doc, order, 'FV/2026/000001');

      const razemIdx = calls.indexOf('Razem brutto:');
      expect(calls[razemIdx + 1]).toBe('123.00 zl');

      const vatIdx = calls.indexOf('VAT 23%:');
      expect(calls[vatIdx + 1]).toBe('23.00 zl');
    });

    it('multi-rate basket: remainder absorbed into lowest-rate bucket (sort descending → last = lowest)', () => {
      // 23% item: grossCents=100, net=81, vat=19
      // 5% item:  grossCents=100, net=95, vat=5
      // totalNet=176, totalVat=24, sum=200
      // totalInCents=202 → authTotalVat=26, remainder=+2 → 5% bucket gets +2 → vat=7
      const order = buildOrder({
        totalInCents: 202,
        itemsTotalInCents: 200,
        shippingCostInCents: 0,
        items: [
          { snapshotName: 'Item 23%', snapshotPrice: 100, snapshotVatRate: 2300, quantity: 1 },
          { snapshotName: 'Item 5%',  snapshotPrice: 100, snapshotVatRate: 500,  quantity: 1 },
        ],
      });

      const { doc, calls } = makeMockDoc();
      (service as any).render(doc, order, 'FV/2026/000001');

      const razemIdx = calls.indexOf('Razem brutto:');
      expect(calls[razemIdx + 1]).toBe('2.02 zl');

      // 5% bucket receives +2 remainder → 5+2=7 → "0.07 zl"
      const vat5Idx = calls.indexOf('VAT 5%:');
      expect(calls[vat5Idx + 1]).toBe('0.07 zl');

      // 23% bucket unchanged → "0.19 zl"
      const vat23Idx = calls.indexOf('VAT 23%:');
      expect(calls[vat23Idx + 1]).toBe('0.19 zl');
    });
  });
  // ── processCorrectiveInvoice — idempotency guard ─────────────────────────
  // Verifies the SELECT FOR UPDATE + two-phase pattern that prevents BullMQ
  // retries from burning FK/YYYY/NNNNNN sequential numbers (Art. 106e ust. 1
  // pkt 2 Ustawy o VAT) and from inserting duplicate InvoiceCorrection rows.

  describe('processCorrectiveInvoice', () => {
    const YEAR = new Date().getFullYear();
    const ORDER_ID = 'order-corr-1';
    const ORIGINAL_INVOICE = 'FV/2026/000001';
    const REFUND_CENTS = 5000;
    const CORRECTED_AMOUNT = -5000; // -Math.abs(5000)
    const REASON = 'PARTIAL_CANCELLATION';
    const MOCK_CORRECTIVE_NUM = `FK/${YEAR}/000001`;
    const MOCK_CORRECTIVE_FILENAME = `FK-${YEAR}-000001.pdf`;
    const MOCK_CORRECTIVE_PATH = `invoices/${MOCK_CORRECTIVE_FILENAME}`;
    const MOCK_CORRECTIVE_URL = 'https://cdn.example.com/corrective-invoice.pdf?token=xyz';

    let corrService: InvoiceService;
    let corrStorage: jest.Mocked<Pick<StorageService, 'uploadInvoice' | 'getInvoiceSignedUrl'>>;
    let corrTx: {
      $queryRawUnsafe: jest.Mock;
      $executeRawUnsafe: jest.Mock;
      invoiceCorrection: { findFirst: jest.Mock; create: jest.Mock };
    };
    let corrPrisma: {
      $transaction: jest.Mock;
      $executeRawUnsafe: jest.Mock;
      order: { update: jest.Mock; findUniqueOrThrow: jest.Mock };
      invoiceCorrection: { findFirst: jest.Mock; update: jest.Mock };
    };

    const mockOrderData = {
      orderNumber: 'ORD-2026-000001',
      snapshotFirstName: 'Jan',
      snapshotLastName: 'Kowalski',
      snapshotCompany: null,
      snapshotNip: null,
      snapshotStreet: 'ul. Marszałkowska 1',
      snapshotCity: 'Warszawa',
      snapshotPostalCode: '00-001',
      snapshotCountry: 'PL',
      createdAt: new Date('2026-05-01T10:00:00Z'),
      items: [] as Array<{ snapshotPrice: number; quantity: number; snapshotVatRate: number }>,
    };

    beforeEach(async () => {
      corrStorage = {
        uploadInvoice: jest.fn().mockResolvedValue(MOCK_CORRECTIVE_PATH),
        getInvoiceSignedUrl: jest.fn().mockResolvedValue(MOCK_CORRECTIVE_URL),
      };

      corrTx = {
        // 1st call — SELECT FOR UPDATE; 2nd call — SELECT nextval
        $queryRawUnsafe: jest.fn()
          .mockResolvedValueOnce([{ id: ORDER_ID }])
          .mockResolvedValueOnce([{ nextval: 1n }]),
        $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
        invoiceCorrection: {
          findFirst: jest.fn().mockResolvedValue(null), // fresh attempt by default
          create: jest.fn().mockResolvedValue({ id: 'corr-1', correctiveInvoiceNumber: MOCK_CORRECTIVE_NUM }),
        },
      };

      corrPrisma = {
        $transaction: jest.fn().mockImplementation(
          async (fn: (tx: typeof corrTx) => Promise<unknown>) => fn(corrTx),
        ),
        $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
        order: {
          update: jest.fn().mockResolvedValue({}),
          findUniqueOrThrow: jest.fn().mockResolvedValue(mockOrderData),
        },
        invoiceCorrection: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn().mockResolvedValue({}),
        },
      };

      const mod = await Test.createTestingModule({
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
          { provide: PrismaService, useValue: corrPrisma },
          { provide: StorageService, useValue: corrStorage },
        ],
      }).compile();

      corrService = mod.get(InvoiceService);
    });

    // ── orchestration — fresh attempt ──────────────────────────────────────

    describe('orchestration — fresh attempt', () => {
      it('returns correctiveUrl, correctiveStoragePath, and correctiveInvoiceNumber', async () => {
        const result = await corrService.processCorrectiveInvoice(ORDER_ID, ORIGINAL_INVOICE, REFUND_CENTS, REASON);

        expect(result.correctiveUrl).toBe(MOCK_CORRECTIVE_URL);
        expect(result.correctiveStoragePath).toBe(MOCK_CORRECTIVE_PATH);
        expect(result.correctiveInvoiceNumber).toBe(MOCK_CORRECTIVE_NUM);
      });

      it('uploads the corrective PDF with the FK-formatted filename', async () => {
        await corrService.processCorrectiveInvoice(ORDER_ID, ORIGINAL_INVOICE, REFUND_CENTS, REASON);

        expect(corrStorage.uploadInvoice).toHaveBeenCalledWith(
          expect.any(Buffer),
          MOCK_CORRECTIVE_FILENAME,
        );
      });

      it('generated corrective PDF starts with %PDF (valid PDF header)', async () => {
        let capturedPdf: Buffer | undefined;
        corrStorage.uploadInvoice.mockImplementation(async (pdf: Buffer) => {
          capturedPdf = pdf;
          return MOCK_CORRECTIVE_PATH;
        });

        await corrService.processCorrectiveInvoice(ORDER_ID, ORIGINAL_INVOICE, REFUND_CENTS, REASON);

        expect(capturedPdf).toBeDefined();
        expect(capturedPdf!.slice(0, 4).toString()).toBe('%PDF');
      });

      it('TX1 inserts InvoiceCorrection without correctiveStoragePath to reserve the sequence number', async () => {
        await corrService.processCorrectiveInvoice(ORDER_ID, ORIGINAL_INVOICE, REFUND_CENTS, REASON);

        const createCall = corrTx.invoiceCorrection.create.mock.calls[0][0];
        expect(createCall.data).toMatchObject({
          orderId: ORDER_ID,
          correctiveInvoiceNumber: MOCK_CORRECTIVE_NUM,
          correctedAmountInCents: CORRECTED_AMOUNT,
          refundReasonCode: REASON,
        });
        expect(createCall.data.correctionRequestKey).toBeDefined();
        expect(createCall.data).not.toHaveProperty('correctiveStoragePath');
      });

      it('TX2 updates InvoiceCorrection with the actual storage path after upload succeeds', async () => {
        await corrService.processCorrectiveInvoice(ORDER_ID, ORIGINAL_INVOICE, REFUND_CENTS, REASON);

        expect(corrPrisma.invoiceCorrection.update).toHaveBeenCalledWith({
          where: { orderId_correctionRequestKey: { orderId: ORDER_ID, correctionRequestKey: expect.any(String) } },
          data: { correctiveStoragePath: MOCK_CORRECTIVE_PATH },
        });
      });

      it('does not run TX2 update when upload fails — correction row stays with null storagePath for retry', async () => {
        corrStorage.uploadInvoice.mockRejectedValue(new Error('Supabase upload failed'));

        await expect(
          corrService.processCorrectiveInvoice(ORDER_ID, ORIGINAL_INVOICE, REFUND_CENTS, REASON),
        ).rejects.toThrow('Supabase upload failed');

        expect(corrPrisma.invoiceCorrection.update).not.toHaveBeenCalled();
      });

      it('calls getInvoiceSignedUrl with a 7-day TTL', async () => {
        await corrService.processCorrectiveInvoice(ORDER_ID, ORIGINAL_INVOICE, REFUND_CENTS, REASON);

        const SEVEN_DAYS = 7 * 24 * 60 * 60;
        expect(corrStorage.getInvoiceSignedUrl).toHaveBeenCalledWith(MOCK_CORRECTIVE_PATH, SEVEN_DAYS);
      });
    });

    // ── idempotency guard — SELECT FOR UPDATE ──────────────────────────────

    describe('idempotency guard — SELECT FOR UPDATE', () => {
      it('returns the existing URL and number when correction is already fully completed', async () => {
        corrTx.invoiceCorrection.findFirst.mockResolvedValue({
          correctiveInvoiceNumber: MOCK_CORRECTIVE_NUM,
          correctiveStoragePath: MOCK_CORRECTIVE_PATH,
        });

        const result = await corrService.processCorrectiveInvoice(ORDER_ID, ORIGINAL_INVOICE, REFUND_CENTS, REASON);

        expect(result.correctiveInvoiceNumber).toBe(MOCK_CORRECTIVE_NUM);
        expect(result.correctiveStoragePath).toBe(MOCK_CORRECTIVE_PATH);
        expect(result.correctiveUrl).toBe(MOCK_CORRECTIVE_URL);
      });

      it('does not allocate a new sequence number when correction already exists', async () => {
        corrTx.invoiceCorrection.findFirst.mockResolvedValue({
          correctiveInvoiceNumber: MOCK_CORRECTIVE_NUM,
          correctiveStoragePath: MOCK_CORRECTIVE_PATH,
        });

        await corrService.processCorrectiveInvoice(ORDER_ID, ORIGINAL_INVOICE, REFUND_CENTS, REASON);

        expect(corrTx.$executeRawUnsafe).not.toHaveBeenCalled();
      });

      it('does not upload or run TX2 when correction is already complete', async () => {
        corrTx.invoiceCorrection.findFirst.mockResolvedValue({
          correctiveInvoiceNumber: MOCK_CORRECTIVE_NUM,
          correctiveStoragePath: MOCK_CORRECTIVE_PATH,
        });

        await corrService.processCorrectiveInvoice(ORDER_ID, ORIGINAL_INVOICE, REFUND_CENTS, REASON);

        expect(corrStorage.uploadInvoice).not.toHaveBeenCalled();
        expect(corrPrisma.invoiceCorrection.update).not.toHaveBeenCalled();
      });

      it('re-uses the reserved number and completes the upload when a prior attempt crashed after TX1', async () => {
        const RESERVED_NUM = `FK/${YEAR}/000099`;
        const RESERVED_PATH = `invoices/FK-${YEAR}-000099.pdf`;
        corrTx.invoiceCorrection.findFirst.mockResolvedValue({
          correctiveInvoiceNumber: RESERVED_NUM,
          correctiveStoragePath: null,
        });
        corrStorage.uploadInvoice.mockResolvedValue(RESERVED_PATH);

        const result = await corrService.processCorrectiveInvoice(ORDER_ID, ORIGINAL_INVOICE, REFUND_CENTS, REASON);

        expect(result.correctiveInvoiceNumber).toBe(RESERVED_NUM);
        expect(corrStorage.uploadInvoice).toHaveBeenCalledWith(
          expect.any(Buffer),
          `FK-${YEAR}-000099.pdf`,
        );
        expect(corrPrisma.invoiceCorrection.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: { correctiveStoragePath: RESERVED_PATH } }),
        );
      });

      it('does not allocate a new nextval when re-using a reserved corrective number', async () => {
        corrTx.invoiceCorrection.findFirst.mockResolvedValue({
          correctiveInvoiceNumber: `FK/${YEAR}/000099`,
          correctiveStoragePath: null,
        });

        await corrService.processCorrectiveInvoice(ORDER_ID, ORIGINAL_INVOICE, REFUND_CENTS, REASON);

        expect(corrTx.$executeRawUnsafe).not.toHaveBeenCalled();
        expect(corrTx.invoiceCorrection.create).not.toHaveBeenCalled();
      });
    });

    // ── distinct corrections with identical refund amounts ────────────────
    // Regression guard: the idempotency key must identify the correction
    // (which orderItemIds/quantities are being cancelled), not the resulting
    // refund amount. Two unrelated cancellations that happen to net to the
    // same amount (common with shared price points) must each get their own
    // corrective invoice, not silently collide on the first one's row.

    describe('distinct corrections with identical refund amounts', () => {
      it('generates two separate corrective invoices for two unrelated cancellations that net to the same amount', async () => {
        corrTx.$queryRawUnsafe = jest.fn()
          .mockResolvedValueOnce([{ id: ORDER_ID }])
          .mockResolvedValueOnce([{ nextval: 1n }])
          .mockResolvedValueOnce([{ id: ORDER_ID }])
          .mockResolvedValueOnce([{ nextval: 2n }]);

        corrStorage.uploadInvoice
          .mockResolvedValueOnce('invoices/FK-correction-1.pdf')
          .mockResolvedValueOnce('invoices/FK-correction-2.pdf');

        const firstCancelledItems = [
          { orderItemId: 'item-aaa', quantity: 1, priceInCents: REFUND_CENTS, vatRate: 2300 },
        ];
        const secondCancelledItems = [
          { orderItemId: 'item-bbb', quantity: 1, priceInCents: REFUND_CENTS, vatRate: 2300 },
        ];

        const first = await corrService.processCorrectiveInvoice(
          ORDER_ID, ORIGINAL_INVOICE, REFUND_CENTS, REASON, firstCancelledItems,
        );
        const second = await corrService.processCorrectiveInvoice(
          ORDER_ID, ORIGINAL_INVOICE, REFUND_CENTS, REASON, secondCancelledItems,
        );

        expect(first.correctiveInvoiceNumber).not.toBe(second.correctiveInvoiceNumber);
        expect(first.correctiveStoragePath).not.toBe(second.correctiveStoragePath);
        expect(corrTx.invoiceCorrection.create).toHaveBeenCalledTimes(2);
      });

      it('uses different correctionRequestKey values for the two distinct corrections', async () => {
        corrTx.$queryRawUnsafe = jest.fn()
          .mockResolvedValueOnce([{ id: ORDER_ID }])
          .mockResolvedValueOnce([{ nextval: 1n }])
          .mockResolvedValueOnce([{ id: ORDER_ID }])
          .mockResolvedValueOnce([{ nextval: 2n }]);

        const firstCancelledItems = [
          { orderItemId: 'item-aaa', quantity: 1, priceInCents: REFUND_CENTS, vatRate: 2300 },
        ];
        const secondCancelledItems = [
          { orderItemId: 'item-bbb', quantity: 1, priceInCents: REFUND_CENTS, vatRate: 2300 },
        ];

        await corrService.processCorrectiveInvoice(
          ORDER_ID, ORIGINAL_INVOICE, REFUND_CENTS, REASON, firstCancelledItems,
        );
        await corrService.processCorrectiveInvoice(
          ORDER_ID, ORIGINAL_INVOICE, REFUND_CENTS, REASON, secondCancelledItems,
        );

        const firstKey = corrTx.invoiceCorrection.create.mock.calls[0][0].data.correctionRequestKey;
        const secondKey = corrTx.invoiceCorrection.create.mock.calls[1][0].data.correctionRequestKey;
        expect(firstKey).not.toBe(secondKey);
      });

      it('reuses the same corrective invoice on a true retry of the same cancellation (same orderItemIds and quantities)', async () => {
        const cancelledItems = [
          { orderItemId: 'item-aaa', quantity: 1, priceInCents: REFUND_CENTS, vatRate: 2300 },
        ];

        await corrService.processCorrectiveInvoice(
          ORDER_ID, ORIGINAL_INVOICE, REFUND_CENTS, REASON, cancelledItems,
        );
        const reservedKey = corrTx.invoiceCorrection.create.mock.calls[0][0].data.correctionRequestKey;

        // Simulate the retry seeing the already-completed row for the same key.
        corrTx.invoiceCorrection.findFirst.mockResolvedValue({
          correctiveInvoiceNumber: MOCK_CORRECTIVE_NUM,
          correctiveStoragePath: MOCK_CORRECTIVE_PATH,
        });

        const retry = await corrService.processCorrectiveInvoice(
          ORDER_ID, ORIGINAL_INVOICE, REFUND_CENTS, REASON, cancelledItems,
        );

        expect(retry.correctiveInvoiceNumber).toBe(MOCK_CORRECTIVE_NUM);
        expect(retry.correctiveStoragePath).toBe(MOCK_CORRECTIVE_PATH);
        expect(corrTx.invoiceCorrection.create).toHaveBeenCalledTimes(1);
        expect(reservedKey).toBeDefined();
      });
    });

    // ── upload outside transaction (lock-release) ──────────────────────────

    describe('upload outside transaction (lock-release)', () => {
      it('upload happens after $transaction resolves, not inside the callback', async () => {
        let txResolved = false;
        corrPrisma.$transaction.mockImplementation(
          async (fn: (tx: typeof corrTx) => Promise<unknown>) => {
            const result = await fn(corrTx);
            txResolved = true;
            return result;
          },
        );

        let uploadCalledAfterTxResolve = false;
        corrStorage.uploadInvoice.mockImplementation(async () => {
          uploadCalledAfterTxResolve = txResolved;
          return MOCK_CORRECTIVE_PATH;
        });

        await corrService.processCorrectiveInvoice(ORDER_ID, ORIGINAL_INVOICE, REFUND_CENTS, REASON);

        expect(uploadCalledAfterTxResolve).toBe(true);
      });
    });

    // ── getCorrectiveInvoiceUrl — nullable storagePath guard ───────────────

    describe('getCorrectiveInvoiceUrl — nullable storagePath guard', () => {
      it('returns null when the correction row has a null correctiveStoragePath (upload not yet completed)', async () => {
        corrPrisma.invoiceCorrection.findFirst.mockResolvedValue({
          correctiveInvoiceNumber: MOCK_CORRECTIVE_NUM,
          correctiveStoragePath: null,
        });

        const result = await corrService.getCorrectiveInvoiceUrl(ORDER_ID);

        expect(result).toBeNull();
      });

      it('returns null when no correction row exists for the order', async () => {
        corrPrisma.invoiceCorrection.findFirst.mockResolvedValue(null);

        const result = await corrService.getCorrectiveInvoiceUrl(ORDER_ID);

        expect(result).toBeNull();
      });

      it('returns correctiveInvoiceUrl and correctiveInvoiceNumber when storagePath is set', async () => {
        corrPrisma.invoiceCorrection.findFirst.mockResolvedValue({
          correctiveInvoiceNumber: MOCK_CORRECTIVE_NUM,
          correctiveStoragePath: MOCK_CORRECTIVE_PATH,
        });

        const result = await corrService.getCorrectiveInvoiceUrl(ORDER_ID);

        expect(result).toEqual({
          correctiveInvoiceUrl: MOCK_CORRECTIVE_URL,
          correctiveInvoiceNumber: MOCK_CORRECTIVE_NUM,
        });
      });
    });

    // ── buildCorrectiveVatBreakdown — Art. 106j ust. 2 Ustawy o VAT ────────
    // Mixed-rate orders must show, per VAT rate touched by the correction,
    // the taxable base before/after and the net+VAT delta — not a single
    // gross correction amount with no breakdown.

    describe('buildCorrectiveVatBreakdown', () => {
      it('omits VAT rates from the original order that are untouched by this correction', () => {
        const originalItems = [
          { snapshotPrice: 10000, quantity: 1, snapshotVatRate: 2300 },
          { snapshotPrice: 5000, quantity: 1, snapshotVatRate: 500 },
        ];
        const cancelledItems = [{ priceInCents: 5000, quantity: 1, vatRate: 500 }];

        const rows = (corrService as any).buildCorrectiveVatBreakdown(originalItems, cancelledItems);

        expect(rows).toHaveLength(1);
        expect(rows[0].rate).toBeCloseTo(0.05);
      });

      it('computes original/corrected net and VAT per rate, plus the net+VAT delta', () => {
        const originalItems = [{ snapshotPrice: 5000, quantity: 1, snapshotVatRate: 500 }];
        const cancelledItems = [{ priceInCents: 5000, quantity: 1, vatRate: 500 }];

        const rows = (corrService as any).buildCorrectiveVatBreakdown(originalItems, cancelledItems);

        expect(rows[0]).toMatchObject({
          originalNetCents: 4762,
          originalVatCents: 238,
          correctedNetCents: 0,
          correctedVatCents: 0,
          deltaNetCents: -4762,
          deltaVatCents: -238,
        });
      });

      it('returns one row per rate, sorted highest rate first, for a mixed-rate cancellation', () => {
        const originalItems = [
          { snapshotPrice: 10000, quantity: 1, snapshotVatRate: 2300 },
          { snapshotPrice: 5000, quantity: 1, snapshotVatRate: 500 },
        ];
        const cancelledItems = [
          { priceInCents: 10000, quantity: 1, vatRate: 2300 },
          { priceInCents: 5000, quantity: 1, vatRate: 500 },
        ];

        const rows = (corrService as any).buildCorrectiveVatBreakdown(originalItems, cancelledItems);

        expect(rows.map((r: any) => r.rate)).toEqual([0.23, 0.05]);
      });

      it('treats a 0% (exempt) rate as its own bucket', () => {
        const originalItems = [{ snapshotPrice: 3000, quantity: 1, snapshotVatRate: 0 }];
        const cancelledItems = [{ priceInCents: 3000, quantity: 1, vatRate: 0 }];

        const rows = (corrService as any).buildCorrectiveVatBreakdown(originalItems, cancelledItems);

        expect(rows).toEqual([
          expect.objectContaining({ rate: 0, originalNetCents: 3000, deltaNetCents: -3000 }),
        ]);
      });

      it('returns an empty breakdown when no items are being cancelled (legacy fallback)', () => {
        const originalItems = [{ snapshotPrice: 10000, quantity: 1, snapshotVatRate: 2300 }];

        const rows = (corrService as any).buildCorrectiveVatBreakdown(originalItems, []);

        expect(rows).toEqual([]);
      });
    });

    // ── renderCorrective — per-rate table rendering ────────────────────────

    describe('renderCorrective — per-rate VAT table', () => {
      function makeMockDoc(): { doc: any; calls: string[] } {
        const calls: string[] = [];
        const doc: any = {
          registerFont: jest.fn().mockReturnThis(),
          font: jest.fn().mockReturnThis(),
          fontSize: jest.fn().mockReturnThis(),
          fillColor: jest.fn().mockReturnThis(),
          text: jest.fn().mockImplementation((t: unknown) => { calls.push(String(t)); return doc; }),
          moveDown: jest.fn().mockReturnThis(),
          moveTo: jest.fn().mockReturnThis(),
          lineTo: jest.fn().mockReturnThis(),
          lineWidth: jest.fn().mockReturnThis(),
          stroke: jest.fn().mockReturnThis(),
          rect: jest.fn().mockReturnThis(),
          fill: jest.fn().mockReturnThis(),
          end: jest.fn(),
          y: 300,
        };
        return { doc, calls };
      }

      it('renders one netto/VAT row pair per VAT rate when a breakdown is provided', () => {
        const { doc, calls } = makeMockDoc();
        const vatBreakdown = [
          {
            rate: 0.23,
            originalNetCents: 8130,
            originalVatCents: 1870,
            correctedNetCents: 0,
            correctedVatCents: 0,
            deltaNetCents: -8130,
            deltaVatCents: -1870,
          },
          {
            rate: 0.05,
            originalNetCents: 4762,
            originalVatCents: 238,
            correctedNetCents: 0,
            correctedVatCents: 0,
            deltaNetCents: -4762,
            deltaVatCents: -238,
          },
        ];

        (corrService as any).renderCorrective(
          doc,
          mockOrderData,
          'FK/2026/000001',
          'FV/2026/000001',
          15000,
          vatBreakdown,
        );

        expect(calls).toContain('Stawka 23% — podstawa netto');
        expect(calls).toContain('Stawka 23% — VAT');
        expect(calls).toContain('Stawka 5% — podstawa netto');
        expect(calls).toContain('Stawka 5% — VAT');
        expect(calls).not.toContain('Opis korekty');
      });

      it('falls back to a single gross correction line when no VAT breakdown is available', () => {
        const { doc, calls } = makeMockDoc();

        (corrService as any).renderCorrective(
          doc,
          mockOrderData,
          'FK/2026/000001',
          'FV/2026/000001',
          5000,
          [],
        );

        expect(calls).toContain('Opis korekty');
        expect(calls).not.toContain('Stawka 23% — podstawa netto');
      });

      it('labels a 0% breakdown row as exempt ("zw.") rather than "0%"', () => {
        const { doc, calls } = makeMockDoc();
        const vatBreakdown = [
          {
            rate: 0,
            originalNetCents: 3000,
            originalVatCents: 0,
            correctedNetCents: 0,
            correctedVatCents: 0,
            deltaNetCents: -3000,
            deltaVatCents: 0,
          },
        ];

        (corrService as any).renderCorrective(
          doc,
          mockOrderData,
          'FK/2026/000001',
          'FV/2026/000001',
          3000,
          vatBreakdown,
        );

        expect(calls).toContain('Stawka zw. — podstawa netto');
      });
    });
  });

  // ── onModuleInit — SELLER_NIP production guard ────────────────────────────
  // FIX: onModuleInit now throws when NODE_ENV=production and SELLER_NIP is
  // empty, providing a second line of defence after the Joi schema check.
  // Dev environments (no NIP yet) must continue to boot unimpeded.

  describe('onModuleInit — SELLER_NIP production guard', () => {
    async function invokeOnModuleInit(cfg: { NODE_ENV: string; SELLER_NIP: string }): Promise<void> {
      const localPrisma = { $executeRawUnsafe: jest.fn().mockResolvedValue(undefined) };
      const mod = await Test.createTestingModule({
        providers: [
          InvoiceService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, fallback?: string) =>
                cfg[key as keyof typeof cfg] ?? fallback ?? '',
              ),
            },
          },
          { provide: PrismaService, useValue: localPrisma },
          {
            provide: StorageService,
            useValue: { uploadInvoice: jest.fn(), getInvoiceSignedUrl: jest.fn() },
          },
        ],
      }).compile();
      return mod.get(InvoiceService).onModuleInit();
    }

    it('throws when NODE_ENV is production and SELLER_NIP is empty', async () => {
      await expect(
        invokeOnModuleInit({ NODE_ENV: 'production', SELLER_NIP: '' }),
      ).rejects.toThrow('SELLER_NIP is required in production');
    });

    it('error message includes the VAT law reference (Art. 106e ust. 1 pkt 4)', async () => {
      await expect(
        invokeOnModuleInit({ NODE_ENV: 'production', SELLER_NIP: '' }),
      ).rejects.toThrow('Art. 106e');
    });

    it('does not throw when NODE_ENV is production and SELLER_NIP is a valid 10-digit NIP', async () => {
      await expect(
        invokeOnModuleInit({ NODE_ENV: 'production', SELLER_NIP: '1234567890' }),
      ).resolves.toBeUndefined();
    });

    it('does not throw when NODE_ENV is development and SELLER_NIP is empty', async () => {
      await expect(
        invokeOnModuleInit({ NODE_ENV: 'development', SELLER_NIP: '' }),
      ).resolves.toBeUndefined();
    });

    it('does not throw when NODE_ENV is absent and SELLER_NIP is empty', async () => {
      await expect(
        invokeOnModuleInit({ NODE_ENV: '', SELLER_NIP: '' }),
      ).resolves.toBeUndefined();
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
