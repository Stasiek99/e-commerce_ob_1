import { escapeHtml, sanitizeUrl } from './html-escape.util';

interface Data {
  orderNumber: string;
  firstName: string;
  carrier: string;
  trackingNumber: string;
  trackingUrl?: string;
}

export function shippingNotificationTemplate(data: Data): { subject: string; html: string } {
  const trackingLink = data.trackingUrl
    ? `<p><a href="${sanitizeUrl(data.trackingUrl)}" style="color:#0066cc">Śledź przesyłkę</a></p>`
    : `<p>Numer śledzenia: <strong>${escapeHtml(data.trackingNumber)}</strong></p>`;

  return {
    subject: `Twoje zamówienie #${data.orderNumber} zostało nadane`,
    html: `
<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><title>Zamówienie nadane</title></head>
<body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px">
  <h1 style="color:#1a1a1a;font-size:24px">Twoje zamówienie jest w drodze!</h1>
  <p>Cześć ${escapeHtml(data.firstName)},</p>
  <p>Zamówienie <strong>#${data.orderNumber}</strong> zostało nadane przez <strong>${escapeHtml(data.carrier)}</strong>.</p>
  ${trackingLink}
  <p style="color:#666;font-size:14px">Dziękujemy za zakupy!</p>
</body>
</html>`,
  };
}
