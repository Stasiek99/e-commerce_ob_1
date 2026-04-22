/**
 * One-off script to preview the invoice PDF layout locally.
 * Run: npx ts-node -e "require('./scripts/preview-invoice')"
 * or:  npx ts-node scripts/preview-invoice.ts
 */
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit') as typeof import('pdfkit');

const FONTS_DIR = path.join(__dirname, '../src/modules/invoice/fonts');
const OUT_FILE = path.join(__dirname, '../../invoice-preview.pdf');

const VAT_RATE = 0.23;

const mockOrder = {
  id: 'preview-001',
  orderNumber: 'ORD-2024-00042',
  snapshotFirstName: 'Jan',
  snapshotLastName: 'Kowalski',
  snapshotCompany: null,
  snapshotStreet: 'ul. Kwiatowa 12/3',
  snapshotCity: 'Warszawa',
  snapshotPostalCode: '00-001',
  itemsTotalInCents: 28900,
  shippingCostInCents: 1499,
  totalInCents: 30399,
  createdAt: new Date('2024-04-15T10:30:00Z'),
  items: [
    { snapshotName: 'Aromaterie No. 7 – woda perfumowana 50 ml', snapshotPrice: 14900, quantity: 1 },
    { snapshotName: 'Dyfuzor Bamboo & Cedar 200 ml', snapshotPrice: 7000, quantity: 2 },
  ],
};

function fmtDate(date: Date): string {
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const y = date.getFullYear();
  return `${d}.${m}.${y}`;
}

function fmtMoney(cents: number): string {
  return `${(cents / 100).toFixed(2)} zl`;
}

function sumRow(
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

function render(doc: PDFKit.PDFDocument) {
  const order = mockOrder;
  const W = 495;
  const invoiceNumber = `FV-${order.orderNumber}`;
  const issueDate = fmtDate(new Date());
  const saleDate = fmtDate(order.createdAt);

  doc.fontSize(22).font('Inter-Bold').text('FAKTURA VAT', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(11).font('Inter').text(`Nr: ${invoiceNumber}`, { align: 'center' });
  doc.moveDown(0.4);
  doc.fontSize(8).fillColor('#555')
    .text(`Data wystawienia: ${issueDate}   |   Data sprzedazy: ${saleDate}`, { align: 'center' });
  doc.fillColor('#000');
  doc.moveDown(1.5);

  doc.moveTo(50, doc.y).lineTo(545, doc.y).lineWidth(0.5).stroke();
  doc.moveDown(1);

  const colL = 50;
  const colR = 310;
  const partyTop = doc.y;

  doc.fontSize(7).font('Inter-Bold').fillColor('#888').text('SPRZEDAWCA', colL, partyTop);
  doc.fillColor('#000').fontSize(9).font('Inter-Bold');
  doc.text('Aromaterie', colL, partyTop + 14);
  doc.font('Inter').fontSize(8.5);
  doc.text('ul. Przykładowa 1', colL);
  doc.text('00-000 Warszawa', colL);
  doc.text('NIP: 123-456-78-90', colL);

  const buyerName = `${order.snapshotFirstName} ${order.snapshotLastName}`;
  doc.fontSize(7).font('Inter-Bold').fillColor('#888').text('NABYWCA', colR, partyTop);
  doc.fillColor('#000').fontSize(9).font('Inter-Bold');
  doc.text(buyerName, colR, partyTop + 14);
  doc.font('Inter').fontSize(8.5);
  doc.text(order.snapshotStreet, colR);
  doc.text(`${order.snapshotPostalCode} ${order.snapshotCity}`, colR);

  doc.moveDown(3);

  const tableTop = doc.y + 8;
  const ROW_H = 20;
  const cx = { no: 50, name: 72, qty: 290, netUnit: 325, vatPct: 385, vatAmt: 420, gross: 470 };
  const cw = { no: 20, name: 215, qty: 32, netUnit: 57, vatPct: 32, vatAmt: 47, gross: 75 };

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

  doc.fillColor('#000').font('Inter').fontSize(8);
  let y = tableTop + ROW_H;
  let totalNetCents = 0;
  let totalVatCents = 0;

  const allItems = [
    ...order.items.map((i) => ({ name: i.snapshotName, qty: i.quantity, grossCents: i.snapshotPrice * i.quantity })),
    ...(order.shippingCostInCents > 0 ? [{ name: 'Dostawa', qty: 1, grossCents: order.shippingCostInCents }] : []),
  ];

  allItems.forEach((item, idx) => {
    const netCents = Math.round(item.grossCents / (1 + VAT_RATE));
    const vatCents = item.grossCents - netCents;
    totalNetCents += netCents;
    totalVatCents += vatCents;

    doc.rect(50, y, W, ROW_H).fill(idx % 2 === 0 ? '#fff' : '#f9f9f9').stroke();
    doc.fillColor('#000');
    const ry = y + 6;
    doc.text(String(idx + 1), cx.no, ry, { width: cw.no });
    doc.text(item.name, cx.name, ry, { width: cw.name, lineBreak: false });
    doc.text(String(item.qty), cx.qty, ry, { width: cw.qty, align: 'center' });
    doc.text(fmtMoney(netCents), cx.netUnit, ry, { width: cw.netUnit, align: 'right' });
    doc.text('23%', cx.vatPct, ry, { width: cw.vatPct, align: 'center' });
    doc.text(fmtMoney(vatCents), cx.vatAmt, ry, { width: cw.vatAmt, align: 'right' });
    doc.text(fmtMoney(item.grossCents), cx.gross, ry, { width: cw.gross, align: 'right' });
    y += ROW_H;
  });

  const totalGrossCents = totalNetCents + totalVatCents;
  const sumX = 340;
  const sumLabelW = 120;
  const sumValueW = 85;

  y += 14;
  sumRow(doc, 'Suma netto:', fmtMoney(totalNetCents), sumX, y, sumLabelW, sumValueW, false);
  y += 16;
  sumRow(doc, 'VAT 23%:', fmtMoney(totalVatCents), sumX, y, sumLabelW, sumValueW, false);
  y += 16;
  doc.moveTo(sumX, y).lineTo(sumX + sumLabelW + sumValueW, y).lineWidth(0.5).stroke();
  y += 6;
  sumRow(doc, 'Razem brutto:', fmtMoney(totalGrossCents), sumX, y, sumLabelW, sumValueW, false);
  y += 20;
  doc.rect(sumX - 4, y - 4, sumLabelW + sumValueW + 8, 24).fill('#1a1a1a').stroke();
  doc.fillColor('#fff');
  sumRow(doc, 'DO ZAPLATY:', fmtMoney(order.totalInCents), sumX, y + 4, sumLabelW, sumValueW, true);

  doc.fillColor('#888').fontSize(7.5).font('Inter');
  const footerY = y + 50;
  doc.text('Platnosc zrealizowana elektronicznie (Stripe).', 50, footerY);
  doc.text('Faktura wystawiona elektronicznie — wazna bez podpisu i pieczatki.', 50, footerY + 12);
  doc.text(`Wygenerowano: ${fmtDate(new Date())}`, 50, footerY + 24);
}

async function main() {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: 'Invoice Preview' } });

  doc.registerFont('Inter', path.join(FONTS_DIR, 'Inter-Regular.ttf'));
  doc.registerFont('Inter-Bold', path.join(FONTS_DIR, 'Inter-Bold.ttf'));
  doc.font('Inter');

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  doc.on('end', () => {
    const pdf = Buffer.concat(chunks);
    fs.writeFileSync(OUT_FILE, pdf);
    console.log(`✓ PDF written to: ${OUT_FILE}`);
  });

  render(doc);
  doc.end();
}

main().catch(console.error);
