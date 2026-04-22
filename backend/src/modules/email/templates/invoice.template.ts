interface Item {
  name: string;
  quantity: number;
  price: number;
}

interface Data {
  orderNumber: string;
  firstName: string;
  items: Item[];
  shippingCostInCents: number;
  totalInCents: number;
  invoiceUrl: string;
}

function formatPrice(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',') + ' zł';
}

export function invoiceTemplate(data: Data): { subject: string; html: string } {
  const itemRows = data.items
    .map(
      (i) => `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #eee;color:#1a1a1a">${i.name}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:center;color:#555">${i.quantity}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;color:#1a1a1a">${formatPrice(i.price)}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:600;color:#1a1a1a">${formatPrice(i.price * i.quantity)}</td>
        </tr>`,
    )
    .join('');

  const shippingRow =
    data.shippingCostInCents > 0
      ? `<tr>
          <td style="padding:10px 8px;border-bottom:1px solid #eee;color:#555" colspan="3">Dostawa</td>
          <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;color:#1a1a1a">${formatPrice(data.shippingCostInCents)}</td>
        </tr>`
      : '';

  return {
    subject: `Faktura VAT do zamówienia #${data.orderNumber} – Aromaterie`,
    html: `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Faktura VAT – zamówienie #${data.orderNumber}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#333">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">

          <!-- Header -->
          <tr>
            <td style="background:#1a1a1a;padding:28px 40px;text-align:center">
              <p style="margin:0;font-size:22px;font-weight:700;letter-spacing:3px;color:#fff;text-transform:uppercase">Aromaterie</p>
              <p style="margin:6px 0 0;font-size:12px;color:#aaa;letter-spacing:1px;text-transform:uppercase">Faktura VAT</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 0">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a1a">Dziękujemy, ${data.firstName}!</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6">
                Płatność za zamówienie <strong style="color:#1a1a1a">#${data.orderNumber}</strong> została potwierdzona.
                W załączniku znajdziesz fakturę VAT w formacie PDF.
              </p>

              <!-- Download button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 32px">
                <tr>
                  <td style="background:#1a1a1a;border-radius:4px">
                    <a href="${data.invoiceUrl}" target="_blank"
                       style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:600;color:#fff;text-decoration:none;letter-spacing:0.5px">
                      Pobierz fakturę PDF ↓
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #eee;margin:0 0 28px">

              <!-- Order summary -->
              <p style="margin:0 0 12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#888">
                Podsumowanie zamówienia
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
                <thead>
                  <tr style="background:#f8f8f8">
                    <th style="padding:10px 8px;text-align:left;font-weight:600;color:#555;border-bottom:2px solid #eee">Produkt</th>
                    <th style="padding:10px 8px;text-align:center;font-weight:600;color:#555;border-bottom:2px solid #eee">Szt.</th>
                    <th style="padding:10px 8px;text-align:right;font-weight:600;color:#555;border-bottom:2px solid #eee">Cena jedn.</th>
                    <th style="padding:10px 8px;text-align:right;font-weight:600;color:#555;border-bottom:2px solid #eee">Wartość</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemRows}
                  ${shippingRow}
                </tbody>
                <tfoot>
                  <tr style="background:#1a1a1a">
                    <td colspan="3" style="padding:14px 8px;font-weight:700;font-size:15px;color:#fff">Łącznie (brutto)</td>
                    <td style="padding:14px 8px;text-align:right;font-weight:700;font-size:15px;color:#fff">${formatPrice(data.totalInCents)}</td>
                  </tr>
                </tfoot>
              </table>
            </td>
          </tr>

          <!-- Note -->
          <tr>
            <td style="padding:24px 40px">
              <p style="margin:0;font-size:13px;color:#888;line-height:1.6">
                Faktura VAT jest dołączona do tej wiadomości jako załącznik PDF oraz dostępna pod powyższym linkiem.
                Płatność została zrealizowana elektronicznie (Stripe). Faktura wystawiona elektronicznie —
                ważna bez podpisu i pieczątki.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8f8f8;padding:20px 40px;border-top:1px solid #eee;text-align:center">
              <p style="margin:0;font-size:12px;color:#aaa">
                © ${new Date().getFullYear()} Aromaterie. W razie pytań odpowiedz na tę wiadomość.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}
