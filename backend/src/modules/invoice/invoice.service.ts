import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import * as path from 'path';
import * as PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const FONTS_DIR = path.join(__dirname, 'fonts');

export interface CorrectiveInvoiceItem {
  orderItemId: string;
  quantity: number;
  priceInCents: number; // per-unit price actually refunded (post-discount)
  vatRate: number; // basis points — 2300 = 23%, 500 = 5%, 0 = exempt
}

interface CorrectiveVatBreakdownRow {
  rate: number; // fraction, e.g. 0.23
  originalNetCents: number;
  originalVatCents: number;
  correctedNetCents: number;
  correctedVatCents: number;
  deltaNetCents: number;
  deltaVatCents: number;
}

export interface InvoiceOrder {
  id: string;
  orderNumber: string;
  snapshotFirstName: string;
  snapshotLastName: string;
  snapshotCompany?: string | null;
  snapshotNip?: string | null;
  snapshotStreet: string;
  snapshotCity: string;
  snapshotPostalCode: string;
  snapshotCountry?: string | null;
  itemsTotalInCents: number;
  shippingCostInCents: number;
  discountInCents: number;
  couponCode?: string | null;
  totalInCents: number;
  createdAt: Date;
  items: Array<{
    snapshotName: string;
    snapshotPrice: number;
    snapshotVatRate: number; // basis points — 2300 = 23%, 500 = 5%, 0 = exempt
    quantity: number;
  }>;
}

@Injectable()
export class InvoiceService implements OnModuleInit {
  private readonly logger = new Logger(InvoiceService.name);

  private readonly sellerName: string;
  private readonly sellerNip: string;
  private readonly sellerStreet: string;
  private readonly sellerCity: string;
  private readonly sellerPostalCode: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    this.sellerName = config.get('SELLER_NAME', 'Aromaterie');
    this.sellerNip = config.get('SELLER_NIP', '');
    this.sellerStreet = config.get('SELLER_STREET', '');
    this.sellerCity = config.get('SELLER_CITY', '');
    this.sellerPostalCode = config.get('SELLER_POSTAL_CODE', '');
  }

  async onModuleInit() {
    if (this.config.get<string>('NODE_ENV') === 'production' && !this.sellerNip) {
      throw new Error(
        'SELLER_NIP is required in production — Polish VAT invoices cannot be issued without the seller NIP (Art. 106e ust. 1 pkt 4 Ustawy o VAT)',
      );
    }
    const year = new Date().getFullYear();
    await this.ensureSequence(year);
  }

  private async ensureSequence(year: number): Promise<void> {
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      throw new Error(`Invalid invoice year: ${year}`);
    }
    await this.prisma.$executeRawUnsafe(
      `CREATE SEQUENCE IF NOT EXISTS invoice_number_seq_${year} START 1 INCREMENT 1`,
    );
  }

  private async ensureCorrectiveSequence(year: number): Promise<void> {
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      throw new Error(`Invalid corrective invoice year: ${year}`);
    }
    await this.prisma.$executeRawUnsafe(
      `CREATE SEQUENCE IF NOT EXISTS corrective_invoice_number_seq_${year} START 1 INCREMENT 1`,
    );
  }

  /**
   * Generates the invoice PDF, uploads it to Supabase, persists the raw storage
   * path and invoice number on the order, then returns all four values.
   * The path (not a signed URL) is stored so that key rotations and project
   * migrations never invalidate historical invoice access — callers re-sign on
   * demand via getSignedUrl(). The returned url is a 7-day signed URL suitable
   * for embedding in transactional emails at send time.
   *
   * A SELECT FOR UPDATE lock on the order row ensures idempotency: if the Stripe
   * webhook and the reconciliation cron race on the same order, only one wins the
   * lock and generates an invoice; the second sees invoiceStoragePath already set
   * and returns early, preventing orphaned sequence numbers (gap in the legally-
   * required sequential series per Art. 106e pkt 2 Ustawy o VAT).
   */
  async processInvoice(order: InvoiceOrder): Promise<{ url: string; storagePath: string; pdf: Buffer; invoiceNumber: string }> {
    const year = order.createdAt.getFullYear();
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      throw new Error(`Invalid invoice year: ${year}`);
    }

    // TX1 — short lock: check idempotency and reserve the invoice number.
    // Lock-hold time is microseconds; PDF generation and upload happen outside.
    const reserved = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{ invoice_storage_path: string | null; invoice_number: string | null }>
      >(
        `SELECT invoice_storage_path, invoice_number FROM orders WHERE id = $1 FOR UPDATE`,
        order.id,
      );

      if (rows[0]?.invoice_storage_path && rows[0]?.invoice_number) {
        return {
          invoiceNumber: rows[0].invoice_number,
          storagePath: rows[0].invoice_storage_path as string,
          alreadyDone: true as const,
        };
      }

      // invoice_number may already be set if a previous attempt was interrupted
      // after TX1 but before TX2 — re-use it to avoid a gap in the legal sequence.
      if (rows[0]?.invoice_number) {
        return { invoiceNumber: rows[0].invoice_number, storagePath: null, alreadyDone: false as const };
      }

      await tx.$executeRawUnsafe(
        `CREATE SEQUENCE IF NOT EXISTS invoice_number_seq_${year} START 1 INCREMENT 1`,
      );
      const seqRows = await tx.$queryRawUnsafe<Array<{ nextval: bigint }>>(
        `SELECT nextval('invoice_number_seq_${year}')`,
      );
      const invoiceNumber = `FV/${year}/${Number(seqRows[0].nextval).toString().padStart(6, '0')}`;

      // Persist the reserved number so concurrent callers see it and skip TX1
      await tx.order.update({ where: { id: order.id }, data: { invoiceNumber } });

      return { invoiceNumber, storagePath: null, alreadyDone: false as const };
    });

    if (reserved.alreadyDone) {
      const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;
      const url = await this.storage.getInvoiceSignedUrl(reserved.storagePath, SEVEN_DAYS_SECONDS);
      return { url, storagePath: reserved.storagePath, pdf: Buffer.alloc(0), invoiceNumber: reserved.invoiceNumber };
    }

    // Outside any transaction: generate PDF and upload to Supabase.
    // No Postgres connection is held during this I/O, eliminating the lock that
    // could exhaust pgBouncer under concurrent invoice generation.
    const { invoiceNumber } = reserved;
    const pdf = await this.generatePdf(order, invoiceNumber);
    const filename = `${invoiceNumber.replace(/\//g, '-')}.pdf`;
    const storagePath = await this.storage.uploadInvoice(pdf, filename);

    // TX2 — short write: persist the storage path now that upload succeeded
    await this.prisma.order.update({
      where: { id: order.id },
      data: { invoiceStoragePath: storagePath },
    });

    this.logger.log(`Invoice ${invoiceNumber} generated for order ${order.orderNumber}: ${storagePath}`);

    const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;
    const url = await this.storage.getInvoiceSignedUrl(storagePath, SEVEN_DAYS_SECONDS);
    return { url, storagePath, pdf, invoiceNumber };
  }

  async getSignedUrl(storagePath: string, expiresInSeconds = 3600): Promise<string> {
    return this.storage.getInvoiceSignedUrl(storagePath, expiresInSeconds);
  }

  /**
   * Generates and persists a corrective invoice (faktura korygująca) per
   * Art. 106j Ustawy o VAT. Called after each successful partial refund.
   * Uses its own sequential series (FK/YYYY/NNNNNN).
   *
   * A SELECT FOR UPDATE lock on the order row ensures idempotency against
   * BullMQ retries: only one caller can allocate the sequence and insert the
   * InvoiceCorrection row; a retry sees the existing row and returns early,
   * preventing gaps in the FK/YYYY/NNNNNN series (Art. 106e ust. 1 pkt 2
   * Ustawy o VAT). The composite unique index on (orderId, correctionRequestKey)
   * is the DB-level backstop if two callers race past the application check.
   * correctionRequestKey is derived from the specific orderItemIds/quantities
   * being cancelled in this call — not from the refund amount — so two
   * unrelated cancellations that happen to total the same refund (common with
   * shared price points) are never treated as the same correction.
   */
  async processCorrectiveInvoice(
    orderId: string,
    originalInvoiceNumber: string,
    refundAmountInCents: number,
    reasonCode: string,
    cancelledItems: CorrectiveInvoiceItem[] = [],
  ): Promise<{ correctiveUrl: string; correctiveStoragePath: string; correctiveInvoiceNumber: string }> {
    const correctedAmountInCents = -Math.abs(refundAmountInCents);
    const correctionRequestKey = this.buildCorrectionRequestKey(cancelledItems);
    const year = new Date().getFullYear();

    // TX1 — short lock: check idempotency and reserve the corrective invoice number.
    // Lock-hold time is microseconds; PDF generation and upload happen outside.
    const reserved = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, orderId);

      const existing = await tx.invoiceCorrection.findFirst({
        where: { orderId, correctionRequestKey },
        select: { correctiveInvoiceNumber: true, correctiveStoragePath: true },
      });

      if (existing?.correctiveStoragePath) {
        return {
          correctiveInvoiceNumber: existing.correctiveInvoiceNumber,
          correctiveStoragePath: existing.correctiveStoragePath,
          alreadyDone: true as const,
        };
      }

      if (existing) {
        // Number reserved but upload failed on a prior attempt — re-use to avoid gap
        return {
          correctiveInvoiceNumber: existing.correctiveInvoiceNumber,
          correctiveStoragePath: null,
          alreadyDone: false as const,
        };
      }

      await tx.$executeRawUnsafe(
        `CREATE SEQUENCE IF NOT EXISTS corrective_invoice_number_seq_${year} START 1 INCREMENT 1`,
      );
      const seqRows = await tx.$queryRawUnsafe<Array<{ nextval: bigint }>>(
        `SELECT nextval('corrective_invoice_number_seq_${year}')`,
      );
      const correctiveInvoiceNumber = `FK/${year}/${Number(seqRows[0].nextval).toString().padStart(6, '0')}`;

      // Insert with null storage path to reserve the number before the upload
      await tx.invoiceCorrection.create({
        data: {
          orderId,
          correctiveInvoiceNumber,
          correctedAmountInCents,
          correctionRequestKey,
          refundReasonCode: reasonCode,
        },
      });

      return { correctiveInvoiceNumber, correctiveStoragePath: null, alreadyDone: false as const };
    });

    if (reserved.alreadyDone) {
      const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;
      const correctiveUrl = await this.storage.getInvoiceSignedUrl(reserved.correctiveStoragePath, SEVEN_DAYS_SECONDS);
      return { correctiveUrl, correctiveStoragePath: reserved.correctiveStoragePath, correctiveInvoiceNumber: reserved.correctiveInvoiceNumber };
    }

    // Outside any transaction: fetch order data, generate PDF and upload.
    // No Postgres connection is held during this I/O.
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        orderNumber: true,
        snapshotFirstName: true,
        snapshotLastName: true,
        snapshotCompany: true,
        snapshotNip: true,
        snapshotStreet: true,
        snapshotCity: true,
        snapshotPostalCode: true,
        snapshotCountry: true,
        createdAt: true,
        items: { select: { snapshotPrice: true, quantity: true, snapshotVatRate: true } },
      },
    });

    // Sum every earlier correction's per-rate delta so the breakdown below
    // uses the taxable base as it stood immediately before THIS correction
    // (Art. 106j ust. 2), not the order's pristine pre-any-correction total.
    const priorCorrections = await this.prisma.invoiceCorrection.findMany({
      where: { orderId, correctionRequestKey: { not: correctionRequestKey } },
      select: { vatBreakdownByRate: true },
    });
    const priorDeltaGrossByRate = new Map<number, number>();
    for (const correction of priorCorrections) {
      const breakdown = correction.vatBreakdownByRate as Record<string, number> | null;
      if (!breakdown) continue;
      for (const [rateBasisPoints, deltaGross] of Object.entries(breakdown)) {
        const rate = Number(rateBasisPoints);
        priorDeltaGrossByRate.set(rate, (priorDeltaGrossByRate.get(rate) ?? 0) + deltaGross);
      }
    }

    const vatBreakdown = this.buildCorrectiveVatBreakdown(order.items, cancelledItems, priorDeltaGrossByRate);

    const pdf = await this.generateCorrectivePdf(
      order,
      reserved.correctiveInvoiceNumber,
      originalInvoiceNumber,
      refundAmountInCents,
      vatBreakdown,
    );
    const filename = `${reserved.correctiveInvoiceNumber.replace(/\//g, '-')}.pdf`;
    const correctiveStoragePath = await this.storage.uploadInvoice(pdf, filename);

    // This correction's own per-rate delta, persisted so later corrections
    // can include it in their prior-corrections sum above.
    const thisDeltaGrossByRate: Record<string, number> = {};
    for (const item of cancelledItems) {
      const key = String(item.vatRate);
      thisDeltaGrossByRate[key] = (thisDeltaGrossByRate[key] ?? 0) + item.priceInCents * item.quantity;
    }

    // TX2 — short write: persist the storage path now that upload succeeded
    await this.prisma.invoiceCorrection.update({
      where: { orderId_correctionRequestKey: { orderId, correctionRequestKey } },
      data: { correctiveStoragePath, vatBreakdownByRate: thisDeltaGrossByRate },
    });

    this.logger.log(
      `Corrective invoice ${reserved.correctiveInvoiceNumber} generated for order ${order.orderNumber} (refund: ${refundAmountInCents} gr)`,
    );

    const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;
    const correctiveUrl = await this.storage.getInvoiceSignedUrl(correctiveStoragePath, SEVEN_DAYS_SECONDS);
    return { correctiveUrl, correctiveStoragePath, correctiveInvoiceNumber: reserved.correctiveInvoiceNumber };
  }

  async getCorrectiveInvoiceUrl(orderId: string): Promise<{ correctiveInvoiceUrl: string; correctiveInvoiceNumber: string } | null> {
    const correction = await this.prisma.invoiceCorrection.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      select: { correctiveStoragePath: true, correctiveInvoiceNumber: true },
    });
    if (!correction || !correction.correctiveStoragePath) return null;
    const correctiveInvoiceUrl = await this.storage.getInvoiceSignedUrl(correction.correctiveStoragePath);
    return { correctiveInvoiceUrl, correctiveInvoiceNumber: correction.correctiveInvoiceNumber };
  }

  /**
   * Deterministic identity for "the set of order items being cancelled in
   * this call" — sorted by orderItemId so argument order never matters.
   * Used as the idempotency key instead of the resulting refund amount,
   * which two distinct corrections can otherwise share.
   */
  private buildCorrectionRequestKey(cancelledItems: CorrectiveInvoiceItem[]): string {
    const fingerprint = cancelledItems
      .map((item) => `${item.orderItemId}:${item.quantity}`)
      .sort()
      .join('|');
    return createHash('sha256').update(fingerprint).digest('hex');
  }

  /**
   * Groups the original order items and the items being cancelled in this
   * correction by VAT rate, so the corrective invoice can show, per rate,
   * the taxable base before and after the correction plus the net/VAT delta
   * — required by Art. 106j ust. 2 Ustawy o VAT. Rates untouched by this
   * correction (no cancelled items) are omitted from the breakdown.
   *
   * priorDeltaGrossByRate (keyed by VAT rate basis points, e.g. 2300 for 23%)
   * is the sum of every earlier correction's deltaGross for that rate. It is
   * subtracted from the pristine per-rate total so "original" reflects the
   * taxable base as of immediately before THIS correction — not the order's
   * pristine pre-any-correction total — keeping sequential corrective
   * invoices internally consistent (corrected_invoice_N.original ==
   * corrected_invoice_N-1.corrected).
   */
  private buildCorrectiveVatBreakdown(
    originalItems: Array<{ snapshotPrice: number; quantity: number; snapshotVatRate: number }>,
    cancelledItems: CorrectiveInvoiceItem[],
    priorDeltaGrossByRate: Map<number, number> = new Map(),
  ): CorrectiveVatBreakdownRow[] {
    const byRate = new Map<number, { originalGross: number; deltaGross: number }>();

    for (const item of originalItems) {
      const bucket = byRate.get(item.snapshotVatRate) ?? { originalGross: 0, deltaGross: 0 };
      bucket.originalGross += item.snapshotPrice * item.quantity;
      byRate.set(item.snapshotVatRate, bucket);
    }

    for (const item of cancelledItems) {
      const bucket = byRate.get(item.vatRate) ?? { originalGross: 0, deltaGross: 0 };
      bucket.deltaGross += item.priceInCents * item.quantity;
      byRate.set(item.vatRate, bucket);
    }

    return Array.from(byRate.entries())
      .filter(([, bucket]) => bucket.deltaGross !== 0)
      .sort(([a], [b]) => b - a)
      .map(([vatRateBasisPoints, bucket]) => {
        const rate = vatRateBasisPoints / 10000;
        const priorDeltaGross = priorDeltaGrossByRate.get(vatRateBasisPoints) ?? 0;
        const adjustedOriginalGross = bucket.originalGross - priorDeltaGross;
        const originalNetCents = Math.round(adjustedOriginalGross / (1 + rate));
        const originalVatCents = adjustedOriginalGross - originalNetCents;
        const correctedGross = adjustedOriginalGross - bucket.deltaGross;
        const correctedNetCents = Math.round(correctedGross / (1 + rate));
        const correctedVatCents = correctedGross - correctedNetCents;
        return {
          rate,
          originalNetCents,
          originalVatCents,
          correctedNetCents,
          correctedVatCents,
          deltaNetCents: correctedNetCents - originalNetCents,
          deltaVatCents: correctedVatCents - originalVatCents,
        };
      });
  }

  private generateCorrectivePdf(
    order: {
      orderNumber: string;
      snapshotFirstName: string;
      snapshotLastName: string;
      snapshotCompany?: string | null;
      snapshotNip?: string | null;
      snapshotStreet: string;
      snapshotCity: string;
      snapshotPostalCode: string;
      snapshotCountry?: string | null;
      createdAt: Date;
    },
    correctiveNumber: string,
    originalInvoiceNumber: string,
    refundAmountInCents: number,
    vatBreakdown: CorrectiveVatBreakdownRow[],
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: { Title: `Faktura korygujaca ${correctiveNumber}`, Author: this.sellerName },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.registerFont('Inter', path.join(FONTS_DIR, 'Inter-Regular.ttf'));
      doc.registerFont('Inter-Bold', path.join(FONTS_DIR, 'Inter-Bold.ttf'));
      doc.font('Inter');

      this.renderCorrective(doc, order, correctiveNumber, originalInvoiceNumber, refundAmountInCents, vatBreakdown);
      doc.end();
    });
  }

  private renderCorrective(
    doc: PDFKit.PDFDocument,
    order: {
      orderNumber: string;
      snapshotFirstName: string;
      snapshotLastName: string;
      snapshotCompany?: string | null;
      snapshotNip?: string | null;
      snapshotStreet: string;
      snapshotCity: string;
      snapshotPostalCode: string;
      snapshotCountry?: string | null;
      createdAt: Date;
    },
    correctiveNumber: string,
    originalInvoiceNumber: string,
    refundAmountInCents: number,
    vatBreakdown: CorrectiveVatBreakdownRow[],
  ) {
    const W = 495;
    const issueDate = this.fmtDate(new Date());

    // ── Title ──────────────────────────────────────────────────────────────
    doc.fontSize(22).font('Inter-Bold').text('FAKTURA KORYGUJACA', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).font('Inter').text(`Nr: ${correctiveNumber}`, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#555')
      .text(`do faktury nr: ${originalInvoiceNumber}`, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(8).fillColor('#555')
      .text(`Data wystawienia: ${issueDate}   |   Zamowienie: ${order.orderNumber}`, { align: 'center' });
    doc.fillColor('#000');
    doc.moveDown(1.5);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).lineWidth(0.5).stroke();
    doc.moveDown(1);

    // ── Seller / Buyer ─────────────────────────────────────────────────────
    const colL = 50;
    const colR = 310;
    const partyTop = doc.y;

    doc.fontSize(7).font('Inter-Bold').fillColor('#888').text('SPRZEDAWCA', colL, partyTop);
    doc.fillColor('#000').fontSize(9).font('Inter-Bold');
    doc.text(this.sellerName, colL, partyTop + 14);
    doc.font('Inter').fontSize(8.5);
    if (this.sellerStreet) doc.text(this.sellerStreet, colL);
    if (this.sellerPostalCode || this.sellerCity)
      doc.text(`${this.sellerPostalCode} ${this.sellerCity}`.trim(), colL);
    if (this.sellerNip) doc.text(`NIP: ${this.sellerNip}`, colL);

    const buyerName = `${order.snapshotFirstName} ${order.snapshotLastName}`;
    doc.fontSize(7).font('Inter-Bold').fillColor('#888').text('NABYWCA', colR, partyTop);
    doc.fillColor('#000').fontSize(9).font('Inter-Bold');
    doc.text(buyerName, colR, partyTop + 14);
    doc.font('Inter').fontSize(8.5);
    if (order.snapshotCompany) doc.text(order.snapshotCompany, colR);
    doc.text(order.snapshotStreet, colR);
    doc.text(`${order.snapshotPostalCode} ${order.snapshotCity}`, colR);
    if (order.snapshotNip) doc.text(`NIP: ${order.snapshotNip}`, colR);

    doc.moveDown(3);

    // ── Correction table ───────────────────────────────────────────────────
    // Art. 106j ust. 2 Ustawy o VAT: a corrective invoice must state the
    // taxable base and tax amount before and after the correction, per VAT
    // rate. When no per-rate breakdown is available (legacy callers that
    // don't pass cancelled items), fall back to a single gross correction
    // line so the invoice is still generated.
    const tableTop = doc.y + 8;
    const ROW_H = 20;
    let rowY: number;

    if (vatBreakdown.length === 0) {
      const cx = { no: 50, desc: 72, gross: 470 };
      const cw = { no: 20, desc: 395, gross: 75 };

      doc.rect(50, tableTop, W, ROW_H).fill('#1a1a1a').stroke();
      doc.fillColor('#fff').fontSize(7).font('Inter-Bold');
      const th = tableTop + 6;
      doc.text('Lp.', cx.no, th, { width: cw.no });
      doc.text('Opis korekty', cx.desc, th, { width: cw.desc });
      doc.text('Kwota korekty', cx.gross, th, { width: cw.gross, align: 'right' });

      doc.fillColor('#000').font('Inter').fontSize(8);
      rowY = tableTop + ROW_H;
      doc.rect(50, rowY, W, ROW_H).fill('#fff').stroke();
      doc.fillColor('#000');
      doc.text('1', cx.no, rowY + 6, { width: cw.no });
      doc.text('Zwrot czesciowy — korekta platnosci (Art. 106j Ustawy o VAT)', cx.desc, rowY + 6, { width: cw.desc });
      doc.text(this.fmtMoney(-Math.abs(refundAmountInCents)), cx.gross, rowY + 6, { width: cw.gross, align: 'right' });
      rowY += ROW_H;
    } else {
      const cx = { label: 50, before: 230, after: 340, delta: 450 };
      const cw = { label: 180, before: 110, after: 110, delta: 95 };

      doc.rect(50, tableTop, W, ROW_H).fill('#1a1a1a').stroke();
      doc.fillColor('#fff').fontSize(7).font('Inter-Bold');
      const th = tableTop + 6;
      doc.text('Pozycja korekty', cx.label, th, { width: cw.label });
      doc.text('Przed korekta', cx.before, th, { width: cw.before, align: 'right' });
      doc.text('Po korekcie', cx.after, th, { width: cw.after, align: 'right' });
      doc.text('Korekta', cx.delta, th, { width: cw.delta, align: 'right' });

      doc.font('Inter').fontSize(8);
      rowY = tableTop + ROW_H;
      let rowIdx = 0;
      for (const row of vatBreakdown) {
        const rateLabel = row.rate === 0 ? 'zw.' : `${Math.round(row.rate * 100)}%`;

        doc.rect(50, rowY, W, ROW_H).fill(rowIdx % 2 === 0 ? '#fff' : '#f9f9f9').stroke();
        doc.fillColor('#000');
        doc.text(`Stawka ${rateLabel} — podstawa netto`, cx.label, rowY + 6, { width: cw.label });
        doc.text(this.fmtMoney(row.originalNetCents), cx.before, rowY + 6, { width: cw.before, align: 'right' });
        doc.text(this.fmtMoney(row.correctedNetCents), cx.after, rowY + 6, { width: cw.after, align: 'right' });
        doc.text(this.fmtMoney(row.deltaNetCents), cx.delta, rowY + 6, { width: cw.delta, align: 'right' });
        rowY += ROW_H;
        rowIdx += 1;

        doc.rect(50, rowY, W, ROW_H).fill(rowIdx % 2 === 0 ? '#fff' : '#f9f9f9').stroke();
        doc.fillColor('#000');
        doc.text(`Stawka ${rateLabel} — VAT`, cx.label, rowY + 6, { width: cw.label });
        doc.text(this.fmtMoney(row.originalVatCents), cx.before, rowY + 6, { width: cw.before, align: 'right' });
        doc.text(this.fmtMoney(row.correctedVatCents), cx.after, rowY + 6, { width: cw.after, align: 'right' });
        doc.text(this.fmtMoney(row.deltaVatCents), cx.delta, rowY + 6, { width: cw.delta, align: 'right' });
        rowY += ROW_H;
        rowIdx += 1;
      }
    }

    // ── Totals ─────────────────────────────────────────────────────────────
    const sumX = 340;
    const sumLabelW = 120;
    const sumValueW = 85;
    let y = rowY + 14;

    doc.moveTo(sumX, y).lineTo(sumX + sumLabelW + sumValueW, y).lineWidth(0.5).stroke();
    y += 6;
    doc.rect(sumX - 4, y - 4, sumLabelW + sumValueW + 8, 24).fill('#1a1a1a').stroke();
    doc.fillColor('#fff');
    this.sumRow(doc, 'KOREKTA RAZEM:', this.fmtMoney(-Math.abs(refundAmountInCents)), sumX, y + 4, sumLabelW, sumValueW, true);

    // ── Footer ─────────────────────────────────────────────────────────────
    doc.fillColor('#888').fontSize(7.5).font('Inter');
    const footerY = y + 50;
    doc.text('Zwrot srodkow zostal zrealizowany na oryginalna metode platnosci (Stripe).', 50, footerY);
    doc.text('Faktura korygujaca wystawiona elektronicznie — wazna bez podpisu i pieczatki.', 50, footerY + 12);
    doc.text(`Wygenerowano: ${issueDate}`, 50, footerY + 24);
  }

  private generatePdf(order: InvoiceOrder, invoiceNumber: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: { Title: `Faktura VAT ${invoiceNumber}`, Author: this.sellerName },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Inter TTF — full glyph set including Polish (Latin Extended A/B).
      // woff/woff2 cause fontkit subsetting errors; TTF embeds cleanly.
      doc.registerFont('Inter', path.join(FONTS_DIR, 'Inter-Regular.ttf'));
      doc.registerFont('Inter-Bold', path.join(FONTS_DIR, 'Inter-Bold.ttf'));
      doc.font('Inter');

      this.render(doc, order, invoiceNumber);
      doc.end();
    });
  }

  private render(doc: PDFKit.PDFDocument, order: InvoiceOrder, invoiceNumber: string) {
    const W = 495; // usable width (595 - 2*50)
    const issueDate = this.fmtDate(new Date());
    const saleDate = this.fmtDate(order.createdAt);

    // Art. 42 ust. 1 Ustawy o VAT: intra-EU cross-border B2B dispatches are zero-rated
    // with reverse-charge obligation on the buyer. Both conditions must be met:
    // buyer has an EU VAT number (snapshotNip) AND shipment is outside Poland.
    const isReverseCharge =
      !!order.snapshotNip && !!order.snapshotCountry && order.snapshotCountry !== 'PL';

    // ── Title ──────────────────────────────────────────────────────────────
    doc.fontSize(22).font('Inter-Bold').text('FAKTURA VAT', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).font('Inter').text(`Nr: ${invoiceNumber}`, { align: 'center' });
    doc.moveDown(0.4);
    doc.fontSize(8).fillColor('#555')
      .text(`Data wystawienia: ${issueDate}   |   Data sprzedazy: ${saleDate}`, { align: 'center' });
    doc.fillColor('#000');
    doc.moveDown(1.5);

    // ── Horizontal rule ────────────────────────────────────────────────────
    doc.moveTo(50, doc.y).lineTo(545, doc.y).lineWidth(0.5).stroke();
    doc.moveDown(1);

    // ── Seller / Buyer ─────────────────────────────────────────────────────
    const colL = 50;
    const colR = 310;
    const partyTop = doc.y;

    doc.fontSize(7).font('Inter-Bold').fillColor('#888').text('SPRZEDAWCA', colL, partyTop);
    doc.fillColor('#000').fontSize(9).font('Inter-Bold');
    doc.text(this.sellerName, colL, partyTop + 14);
    doc.font('Inter').fontSize(8.5);
    if (this.sellerStreet) doc.text(this.sellerStreet, colL);
    if (this.sellerPostalCode || this.sellerCity)
      doc.text(`${this.sellerPostalCode} ${this.sellerCity}`.trim(), colL);
    if (this.sellerNip) doc.text(`NIP: ${this.sellerNip}`, colL);

    const buyerName = `${order.snapshotFirstName} ${order.snapshotLastName}`;
    doc.fontSize(7).font('Inter-Bold').fillColor('#888').text('NABYWCA', colR, partyTop);
    doc.fillColor('#000').fontSize(9).font('Inter-Bold');
    doc.text(buyerName, colR, partyTop + 14);
    doc.font('Inter').fontSize(8.5);
    if (order.snapshotCompany) doc.text(order.snapshotCompany, colR);
    doc.text(order.snapshotStreet, colR);
    doc.text(`${order.snapshotPostalCode} ${order.snapshotCity}`, colR);
    if (order.snapshotNip) doc.text(`NIP: ${order.snapshotNip}`, colR);

    // Advance past the taller column
    doc.moveDown(3);

    // ── Items table ────────────────────────────────────────────────────────
    const tableTop = doc.y + 8;
    const ROW_H = 20;

    // Column x-offsets (within 50–545)
    const cx = { no: 50, name: 72, qty: 290, netUnit: 325, vatPct: 385, vatAmt: 420, gross: 470 };
    const cw = { no: 20, name: 215, qty: 32, netUnit: 57, vatPct: 32, vatAmt: 47, gross: 75 };

    // Header
    doc.rect(50, tableTop, W, ROW_H).fill('#1a1a1a').stroke();
    doc.fillColor('#fff').fontSize(7).font('Inter-Bold');
    const th = tableTop + 6;
    doc.text('Lp.', cx.no, th, { width: cw.no });
    doc.text('Nazwa towaru / uslugi', cx.name, th, { width: cw.name });
    doc.text('Ilosc', cx.qty, th, { width: cw.qty, align: 'center' });
    doc.text('Cena netto', cx.netUnit, th, { width: cw.netUnit, align: 'right' });
    doc.text('VAT%', cx.vatPct, th, { width: cw.vatPct, align: 'center' });
    doc.text('Kw.VAT', cx.vatAmt, th, { width: cw.vatAmt, align: 'right' });
    doc.text('Brutto', cx.gross, th, { width: cw.gross, align: 'right' });

    // Items
    doc.fillColor('#000').font('Inter').fontSize(8);
    let y = tableTop + ROW_H;
    let totalNetCents = 0;
    let totalVatCents = 0;

    const allItems: Array<{ name: string; qty: number; grossCents: number; vatRate: number }> = [
      ...order.items.map((i) => ({
        name: i.snapshotName,
        qty: i.quantity,
        grossCents: i.snapshotPrice * i.quantity,
        // Reverse-charge: zero-rate all items per Art. 42 ust. 1 Ustawy o VAT
        vatRate: isReverseCharge ? 0 : i.snapshotVatRate / 10000,
      })),
      ...(order.shippingCostInCents > 0
        ? [{ name: 'Dostawa', qty: 1, grossCents: order.shippingCostInCents, vatRate: isReverseCharge ? 0 : 0.23 }]
        : []),
      // Art. 106e pkt 7 Ustawy o VAT: discount must appear as a separate line
      // Art. 106e pkt 7 / Art. 29a ust. 10 — discount must be prorated across each VAT
      // rate proportional to the gross amount of items at that rate. A single 23% line
      // produces an incorrect VAT split for mixed-rate baskets (KAS audit finding).
      ...(order.discountInCents > 0
        ? (() => {
            if (isReverseCharge) {
              // All items are zero-rated — single discount line at 0%
              return [{
                name: `Rabat: ${order.couponCode ?? 'kupon'}`,
                qty: 1,
                grossCents: -order.discountInCents,
                vatRate: 0,
              }];
            }
            const grossByRate = new Map<number, number>();
            for (const item of order.items) {
              const rate = item.snapshotVatRate / 10000;
              grossByRate.set(rate, (grossByRate.get(rate) ?? 0) + item.snapshotPrice * item.quantity);
            }
            const totalItemsGross = [...grossByRate.values()].reduce((s, v) => s + v, 0);
            if (totalItemsGross === 0) return [];
            const rates = [...grossByRate.entries()].sort(([a], [b]) => a - b);
            let remaining = order.discountInCents;
            return rates.map(([rate, gross], idx) => {
              const isLast = idx === rates.length - 1;
              const portionCents = isLast
                ? remaining
                : Math.round(order.discountInCents * (gross / totalItemsGross));
              remaining -= portionCents;
              return {
                name: `Rabat: ${order.couponCode ?? 'kupon'}`,
                qty: 1,
                grossCents: -portionCents,
                vatRate: rate,
              };
            });
          })()
        : []),
    ];

    // Per-rate accumulators for the legally-required split VAT summary
    const vatByRate = new Map<number, { netCents: number; vatCents: number }>();

    allItems.forEach((item, idx) => {
      const netCents = Math.round(item.grossCents / (1 + item.vatRate));
      const vatCents = item.grossCents - netCents;
      totalNetCents += netCents;
      totalVatCents += vatCents;

      const bucket = vatByRate.get(item.vatRate) ?? { netCents: 0, vatCents: 0 };
      bucket.netCents += netCents;
      bucket.vatCents += vatCents;
      vatByRate.set(item.vatRate, bucket);

      const vatPctLabel = item.vatRate === 0 ? 'zw.' : `${Math.round(item.vatRate * 100)}%`;

      doc.rect(50, y, W, ROW_H).fill(idx % 2 === 0 ? '#fff' : '#f9f9f9').stroke();
      doc.fillColor('#000');
      const ry = y + 6;
      doc.text(String(idx + 1), cx.no, ry, { width: cw.no });
      doc.text(item.name, cx.name, ry, { width: cw.name, lineBreak: false });
      doc.text(String(item.qty), cx.qty, ry, { width: cw.qty, align: 'center' });
      doc.text(this.fmtMoney(netCents), cx.netUnit, ry, { width: cw.netUnit, align: 'right' });
      doc.text(vatPctLabel, cx.vatPct, ry, { width: cw.vatPct, align: 'center' });
      doc.text(this.fmtMoney(vatCents), cx.vatAmt, ry, { width: cw.vatAmt, align: 'right' });
      doc.text(this.fmtMoney(item.grossCents), cx.gross, ry, { width: cw.gross, align: 'right' });
      y += ROW_H;
    });

    // ── Totals ─────────────────────────────────────────────────────────────
    // order.totalInCents is the single authoritative source of truth for the
    // invoice total. Per-item VAT rounding can accumulate 1-3 gr on multi-item
    // orders; absorbing the remainder into the last VAT bucket keeps the
    // breakdown consistent with Art. 106e Ustawy o VAT.
    const razem = order.totalInCents;
    const authTotalVat = razem - totalNetCents;
    const vatRemainder = authTotalVat - totalVatCents;
    if (vatRemainder !== 0) {
      const sortedForAdj = Array.from(vatByRate.entries()).sort(([a], [b]) => b - a);
      const [lastRate, lastBucket] = sortedForAdj[sortedForAdj.length - 1];
      lastBucket.vatCents += vatRemainder;
      vatByRate.set(lastRate, lastBucket);
    }

    const sumX = 340;
    const sumLabelW = 120;
    const sumValueW = 85;

    y += 14;
    this.sumRow(doc, 'Suma netto:', this.fmtMoney(totalNetCents), sumX, y, sumLabelW, sumValueW, false);

    // One VAT line per rate (art. 106e pkt 10 Ustawy o VAT)
    const sortedRates = Array.from(vatByRate.entries()).sort(([a], [b]) => b - a);
    for (const [rate, bucket] of sortedRates) {
      y += 16;
      const rateLabel = rate === 0 ? 'VAT zw.:' : `VAT ${Math.round(rate * 100)}%:`;
      this.sumRow(doc, rateLabel, this.fmtMoney(bucket.vatCents), sumX, y, sumLabelW, sumValueW, false);
    }

    y += 16;
    doc.moveTo(sumX, y).lineTo(sumX + sumLabelW + sumValueW, y).lineWidth(0.5).stroke();
    y += 6;
    this.sumRow(doc, 'Razem brutto:', this.fmtMoney(razem), sumX, y, sumLabelW, sumValueW, false);
    y += 20;
    doc.rect(sumX - 4, y - 4, sumLabelW + sumValueW + 8, 24).fill('#1a1a1a').stroke();
    doc.fillColor('#fff');
    this.sumRow(doc, 'DO ZAPLATY:', this.fmtMoney(razem), sumX, y + 4, sumLabelW, sumValueW, true);

    // ── Footer ─────────────────────────────────────────────────────────────
    doc.fillColor('#888').fontSize(7.5).font('Inter');
    const footerY = y + 50;
    doc.text('Platnosc zrealizowana elektronicznie (Stripe).', 50, footerY);
    doc.text('Faktura wystawiona elektronicznie — wazna bez podpisu i pieczatki.', 50, footerY + 12);
    doc.text(`Wygenerowano: ${this.fmtDate(new Date())}`, 50, footerY + 24);
    if (isReverseCharge) {
      doc.fillColor('#333').fontSize(7.5).font('Inter-Bold');
      doc.text(
        'Odwrotne obciazenie / Reverse charge — Art. 42 ust. 1 Ustawy o VAT z dnia 11.03.2004.',
        50,
        footerY + 40,
      );
      doc.font('Inter').fillColor('#888');
      doc.text(
        `Nabywca: NIP UE ${order.snapshotNip} — podatek rozlicza nabywca (Art. 196 Dyrektywy 2006/112/WE).`,
        50,
        footerY + 52,
      );
    }
  }

  private sumRow(
    doc: PDFKit.PDFDocument,
    label: string,
    value: string,
    x: number,
    y: number,
    labelW: number,
    valueW: number,
    bold: boolean,
  ) {
    const font = bold ? 'Inter-Bold' : 'Inter';
    const size = bold ? 10 : 8.5;
    doc.font(font).fontSize(size).text(label, x, y, { width: labelW });
    doc.text(value, x + labelW, y, { width: valueW, align: 'right' });
  }

  private fmtDate(date: Date): string {
    const d = date.getDate().toString().padStart(2, '0');
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const y = date.getFullYear();
    return `${d}.${m}.${y}`;
  }

  private fmtMoney(cents: number): string {
    return `${(cents / 100).toFixed(2)} zl`;
  }
}
