interface ReturnItem {
  productName: string;
  quantity: number;
}

export function returnConfirmationTemplate(data: {
  firstName: string;
  orderNumber: string;
  requestId: string;
  type: 'WITHDRAWAL' | 'COMPLAINT';
  items: ReturnItem[];
}): { subject: string; html: string } {
  const typeLabel = data.type === 'WITHDRAWAL' ? 'odstąpienia od umowy' : 'reklamacji';
  const subject = `Potwierdzenie zgłoszenia ${typeLabel} – zamówienie #${data.orderNumber}`;

  const itemRows = data.items
    .map(
      (item) => `
      <tr>
        <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; color: #1a1a1a;">
          ${item.productName}
        </td>
        <td style="padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px;
                   color: #6b6b6b; text-align: right; width: 60px;">
          × ${item.quantity}
        </td>
      </tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table style="width:100%;border-collapse:collapse;border:0;background:#f9f9f9;">
    <tr><td style="padding:40px 16px;text-align:center;">
      <table style="width:560px;border-collapse:collapse;border:0;
                    background:#ffffff;border-radius:8px;overflow:hidden;
                    box-shadow:0 2px 12px rgba(0,0,0,0.06);">

        <!-- Header -->
        <tr>
          <td style="background:#1a1a1a;padding:28px 40px;text-align:center;">
            <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:0.12em;
                      text-transform:uppercase;color:#c9a96e;">Aromaterie</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a1a;line-height:1.3;">
              Otrzymaliśmy Twoje zgłoszenie
            </h1>
            <p style="margin:0 0 24px;font-size:15px;color:#6b6b6b;line-height:1.6;">
              Drogi/a <strong style="color:#1a1a1a;">${data.firstName}</strong>, zgłoszenie
              ${typeLabel} dotyczące zamówienia
              <strong style="color:#1a1a1a;">#${data.orderNumber}</strong>
              zostało przyjęte. Skontaktujemy się z Tobą w ciągu 2 dni roboczych.
            </p>

            <!-- Reference number -->
            <div style="background:#f9f9f9;border-radius:6px;padding:16px 20px;margin-bottom:24px;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:600;
                        text-transform:uppercase;letter-spacing:0.08em;color:#9b9b9b;">
                Numer zgłoszenia
              </p>
              <p style="margin:0;font-size:18px;font-weight:700;color:#1a1a1a;
                        letter-spacing:0.04em;">
                ${data.requestId}
              </p>
            </div>

            <!-- Items table -->
            <p style="margin:0 0 12px;font-size:13px;font-weight:600;
                      text-transform:uppercase;letter-spacing:0.06em;color:#6b6b6b;">
              Zgłoszone produkty
            </p>
            <table style="width:100%;border-collapse:collapse;border:0;margin-bottom:24px;">
              ${itemRows}
            </table>

            <p style="margin:0;font-size:13px;color:#9b9b9b;line-height:1.6;">
              Zachowaj ten numer zgłoszenia do korespondencji z nami.
              W razie pytań napisz na
              <a href="mailto:zwroty@aromaterie.pl"
                 style="color:#c9a96e;text-decoration:none;">zwroty@aromaterie.pl</a>.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9f9f9;padding:24px 40px;
                     border-top:1px solid #f0f0f0;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9b9b9b;">
              Aromaterie · Polska
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}
