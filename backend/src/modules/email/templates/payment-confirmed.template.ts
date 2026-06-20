import { escapeHtml } from './html-escape.util';

function formatPrice(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',') + ' zł';
}

interface Data {
  orderNumber: string;
  firstName: string;
  totalInCents: number;
}

export function paymentConfirmedTemplate(data: Data): { subject: string; html: string } {
  return {
    subject: `Płatność potwierdzona – zamówienie #${data.orderNumber}`,
    html: `
<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><title>Płatność potwierdzona</title></head>
<body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px">
  <h1 style="color:#1a7c3e;font-size:24px">Płatność zakończona sukcesem!</h1>
  <p>Cześć ${escapeHtml(data.firstName)},</p>
  <p>Twoja płatność za zamówienie <strong>#${data.orderNumber}</strong> na kwotę <strong>${formatPrice(data.totalInCents)}</strong> została potwierdzona.</p>
  <p>Twoje zamówienie jest teraz w trakcie realizacji. Powiadomimy Cię, gdy zostanie nadane.</p>
  <p style="color:#666;font-size:14px">Dziękujemy za zakupy!</p>
</body>
</html>`,
  };
}
