import { escapeHtml } from './html-escape.util';

export function newOrderNotificationTemplate(data: {
  orderNumber: string;
  customerEmail: string;
  totalInCents: number;
  items: Array<{ name: string; quantity: number; price: number }>;
  carrierCode: string;
  adminUrl?: string;
}): { subject: string; html: string } {
  const subject = `🛍️ Nowe zamówienie #${data.orderNumber}`;
  const total = (data.totalInCents / 100).toFixed(2).replace('.', ',');

  const rows = data.items
    .map(
      (i) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;">${escapeHtml(i.name)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;text-align:center;">${i.quantity}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;text-align:right;">${((i.price * i.quantity) / 100).toFixed(2).replace('.', ',')} zł</td>
        </tr>`,
    )
    .join('');

  const adminLink = data.adminUrl
    ? `<p style="margin-top:20px;"><a href="${data.adminUrl}" style="background:#1f2937;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">Otwórz w panelu admina</a></p>`
    : '';

  const html = `
<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"/></head>
<body style="font-family:sans-serif;background:#f9fafb;padding:32px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
    <div style="background:#1f2937;padding:20px 24px;">
      <h1 style="color:#fff;margin:0;font-size:18px;">Nowe zamówienie</h1>
      <p style="color:#9ca3af;margin:4px 0 0;font-size:13px;">#${data.orderNumber}</p>
    </div>
    <div style="padding:24px;">
      <p style="font-size:14px;margin:0 0 4px;"><strong>Klient:</strong> ${escapeHtml(data.customerEmail)}</p>
      <p style="font-size:14px;margin:0 0 16px;"><strong>Dostawa:</strong> ${data.carrierCode}</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="text-align:left;padding:8px 12px;font-size:12px;color:#6b7280;font-weight:600;">Produkt</th>
            <th style="text-align:center;padding:8px 12px;font-size:12px;color:#6b7280;font-weight:600;">Szt.</th>
            <th style="text-align:right;padding:8px 12px;font-size:12px;color:#6b7280;font-weight:600;">Kwota</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr style="background:#f9fafb;">
            <td colspan="2" style="padding:10px 12px;font-size:14px;font-weight:700;">Łącznie</td>
            <td style="padding:10px 12px;font-size:14px;font-weight:700;text-align:right;">${total} zł</td>
          </tr>
        </tfoot>
      </table>
      ${adminLink}
    </div>
  </div>
</body>
</html>`;

  return { subject, html };
}
