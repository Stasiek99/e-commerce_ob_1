function formatPrice(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',') + ' zł';
}

interface Data {
  orderNumber: string;
  firstName: string;
  totalInCents: number;
  isRefund: boolean;
}

export function orderCancellationTemplate(data: Data): { subject: string; html: string } {
  const subject = data.isRefund
    ? `Potwierdzenie zwrotu – zamówienie #${data.orderNumber}`
    : `Zamówienie #${data.orderNumber} zostało anulowane`;

  const body = data.isRefund
    ? `<p>Twoje zamówienie <strong>#${data.orderNumber}</strong> zostało anulowane, a kwota <strong>${formatPrice(data.totalInCents)}</strong> zostanie zwrócona na Twoją kartę lub rachunek w ciągu 5–10 dni roboczych.</p>
       <p>Zwrot jest realizowany zgodnie z <em>ustawą o prawach konsumenta</em> (prawo odstąpienia od umowy).</p>`
    : `<p>Twoje zamówienie <strong>#${data.orderNumber}</strong> zostało anulowane. Żadna płatność nie została pobrana.</p>`;

  return {
    subject,
    html: `
<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px">
  <h1 style="color:#1a1a1a;font-size:24px">${data.isRefund ? 'Zwrot zamówienia' : 'Anulowanie zamówienia'}</h1>
  <p>Cześć ${data.firstName},</p>
  ${body}
  <p style="color:#666;font-size:14px">Jeśli masz pytania, skontaktuj się z nami, odpowiadając na tę wiadomość.</p>
</body>
</html>`,
  };
}
