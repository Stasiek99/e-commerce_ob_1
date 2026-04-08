interface Item {
  name: string;
  quantity: number;
  price: number;
}

interface Data {
  orderNumber: string;
  firstName: string;
  items: Item[];
  totalInCents: number;
}

function formatPrice(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',') + ' zł';
}

export function orderConfirmationTemplate(data: Data): { subject: string; html: string } {
  const rows = data.items
    .map(
      (i) =>
        `<tr>
          <td style="padding:8px;border-bottom:1px solid #eee">${i.name}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatPrice(i.price * i.quantity)}</td>
        </tr>`,
    )
    .join('');

  return {
    subject: `Potwierdzenie zamówienia #${data.orderNumber}`,
    html: `
<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><title>Potwierdzenie zamówienia</title></head>
<body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px">
  <h1 style="color:#1a1a1a;font-size:24px">Dziękujemy za zamówienie, ${data.firstName}!</h1>
  <p>Twoje zamówienie nr <strong>#${data.orderNumber}</strong> zostało przyjęte i oczekuje na płatność.</p>
  <table style="width:100%;border-collapse:collapse;margin:24px 0">
    <thead>
      <tr style="background:#f5f5f5">
        <th style="padding:8px;text-align:left">Produkt</th>
        <th style="padding:8px;text-align:center">Ilość</th>
        <th style="padding:8px;text-align:right">Kwota</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="2" style="padding:12px 8px;font-weight:bold;text-align:right">Łącznie:</td>
        <td style="padding:12px 8px;font-weight:bold;text-align:right">${formatPrice(data.totalInCents)}</td>
      </tr>
    </tfoot>
  </table>
  <p style="color:#666;font-size:14px">W razie pytań skontaktuj się z nami odpowiadając na tę wiadomość.</p>
</body>
</html>`,
  };
}
