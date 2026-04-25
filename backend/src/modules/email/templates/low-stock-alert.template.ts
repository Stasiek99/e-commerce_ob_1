interface StockAlertItem {
  sku: string;
  name: string;
  stock: number;
  isOutOfStock: boolean;
}

export function lowStockAlertTemplate(data: {
  orderNumber: string;
  items: StockAlertItem[];
}): { subject: string; html: string } {
  const outOfStock = data.items.filter((i) => i.isOutOfStock);

  const subjectPrefix = outOfStock.length > 0 ? '🚨 Brak towaru' : '⚠️ Niski stan magazynowy';
  const subject = `${subjectPrefix} — zamówienie #${data.orderNumber}`;

  const rowStyle = 'padding: 10px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px;';
  const rowStyleMono = `${rowStyle} font-family: monospace;`;
  const rowStyleCenter = `${rowStyle} text-align: center;`;
  const badgeOut = 'display:inline-block;padding:2px 8px;border-radius:999px;background:#fee2e2;color:#991b1b;font-weight:600;font-size:12px;';
  const badgeLow = 'display:inline-block;padding:2px 8px;border-radius:999px;background:#fef3c7;color:#92400e;font-weight:600;font-size:12px;';

  const rows = data.items
    .map(
      (item) => `
      <tr>
        <td style="${rowStyle}">${item.name}</td>
        <td style="${rowStyleMono}">${item.sku}</td>
        <td style="${rowStyleCenter}">
          <span style="${item.isOutOfStock ? badgeOut : badgeLow}">
            ${item.isOutOfStock ? 'BRAK' : `${item.stock} szt.`}
          </span>
        </td>
      </tr>`,
    )
    .join('');

  const summary =
    outOfStock.length > 0
      ? `<p style="color:#991b1b;font-weight:600;">Uwaga: ${outOfStock.length} SKU osiągnęło stan zerowy po realizacji tego zamówienia.</p>`
      : '';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /></head>
<body style="font-family:sans-serif;background:#f9fafb;padding:32px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
    <div style="background:#1f2937;padding:20px 24px;">
      <h1 style="color:#fff;margin:0;font-size:18px;">Alert magazynowy</h1>
      <p style="color:#9ca3af;margin:4px 0 0;font-size:13px;">Zamówienie #${data.orderNumber}</p>
    </div>
    <div style="padding:24px;">
      ${summary}
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="text-align:left;padding:10px 16px;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;">Produkt</th>
            <th style="text-align:left;padding:10px 16px;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;">SKU</th>
            <th style="text-align:center;padding:10px 16px;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;">Stan</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="font-size:13px;color:#6b7280;margin-top:20px;">
        Przejdź do panelu administracyjnego, aby uzupełnić stany magazynowe.
      </p>
    </div>
  </div>
</body>
</html>`;

  return { subject, html };
}
