import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const FONTS_DIR = path.join(__dirname, 'fonts');

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
export class InvoiceService {
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

  /**
   * Generates the invoice PDF, uploads it to Supabase, saves the URL on the
   * order, and returns both the URL and the raw buffer for email attachment.
   */
  async processInvoice(order: InvoiceOrder): Promise<{ url: string; pdf: Buffer }> {
    const pdf = await this.generatePdf(order);
    const filename = `FV-${order.orderNumber}.pdf`;
    const url = await this.storage.uploadInvoice(pdf, filename);
    await this.prisma.order.update({ where: { id: order.id }, data: { invoiceUrl: url } });
    this.logger.log(`Invoice generated for order ${order.orderNumber}: ${url}`);
    return { url, pdf };
  }

  private generatePdf(order: InvoiceOrder): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: { Title: `Faktura VAT FV-${order.orderNumber}`, Author: this.sellerName },
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

      this.render(doc, order);
      doc.end();
    });
  }

  private render(doc: PDFKit.PDFDocument, order: InvoiceOrder) {
    const W = 495; // usable width (595 - 2*50)
    const invoiceNumber = `FV-${order.orderNumber}`;
    const issueDate = this.fmtDate(new Date());
    const saleDate = this.fmtDate(order.createdAt);

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
        vatRate: i.snapshotVatRate / 10000, // basis points → decimal (2300 → 0.23)
      })),
      ...(order.shippingCostInCents > 0
        ? [{ name: 'Dostawa', qty: 1, grossCents: order.shippingCostInCents, vatRate: 0.23 }]
        : []),
      // Art. 106e pkt 7 Ustawy o VAT: discount must appear as a separate line
      ...(order.discountInCents > 0
        ? [
            {
              name: `Rabat: ${order.couponCode ?? 'kupon'}`,
              qty: 1,
              grossCents: -order.discountInCents,
              vatRate: 0.23,
            },
          ]
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
    const totalGrossCents = totalNetCents + totalVatCents;
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
    this.sumRow(doc, 'Razem brutto:', this.fmtMoney(totalGrossCents), sumX, y, sumLabelW, sumValueW, false);
    y += 20;
    doc.rect(sumX - 4, y - 4, sumLabelW + sumValueW + 8, 24).fill('#1a1a1a').stroke();
    doc.fillColor('#fff');
    this.sumRow(doc, 'DO ZAPLATY:', this.fmtMoney(order.totalInCents), sumX, y + 4, sumLabelW, sumValueW, true);

    // ── Footer ─────────────────────────────────────────────────────────────
    doc.fillColor('#888').fontSize(7.5).font('Inter');
    const footerY = y + 50;
    doc.text('Platnosc zrealizowana elektronicznie (Stripe).', 50, footerY);
    doc.text('Faktura wystawiona elektronicznie — wazna bez podpisu i pieczatki.', 50, footerY + 12);
    doc.text(`Wygenerowano: ${this.fmtDate(new Date())}`, 50, footerY + 24);
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
