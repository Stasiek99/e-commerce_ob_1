export function reviewRequestTemplate(data: {
  firstName: string;
  orderNumber: string;
  products: Array<{ name: string; imageUrl?: string; reviewUrl: string }>;
}): { subject: string; html: string } {
  const subject = `Jak oceniasz swój zakup? Podziel się opinią`;

  const productRows = data.products
    .map(
      (p) => `
    <tr>
      <td style="padding: 16px 0; border-bottom: 1px solid #f0f0f0;">
        <table style="width: 100%; border-collapse: collapse; border: 0;">
          <tr>
            ${
              p.imageUrl
                ? `<td style="width: 64px; vertical-align: middle; padding-right: 16px;">
                     <img src="${p.imageUrl}" width="64" height="64"
                          style="border-radius: 6px; object-fit: cover; display: block;" alt="${p.name}" />
                   </td>`
                : ''
            }
            <td style="vertical-align: middle;">
              <p style="margin: 0 0 8px; font-size: 15px; font-weight: 600; color: #1a1a1a;">${p.name}</p>
              <a href="${p.reviewUrl}"
                 style="display: inline-block; background: #c9a96e; color: #fff;
                        text-decoration: none; font-size: 13px; font-weight: 600;
                        padding: 8px 20px; border-radius: 4px;">
                ★ Oceń produkt
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table style="width: 100%; border-collapse: collapse; border: 0; background: #f9f9f9;">
    <tr><td style="padding: 40px 16px; text-align: center;">
      <table style="width: 560px; border-collapse: collapse; border: 0;
                    background: #ffffff; border-radius: 8px; overflow: hidden;
                    box-shadow: 0 2px 12px rgba(0,0,0,0.06);">

        <!-- Header -->
        <tr>
          <td style="background:#1a1a1a;padding:28px 40px;text-align:center;">
            <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:0.12em;
                      text-transform:uppercase;color:#c9a96e;">Aromaterie</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding: 36px 40px;">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a1a;line-height:1.3;">
              Dziękujemy za zakup, ${data.firstName || 'drogi kliencie'}!
            </h1>
            <p style="margin:0 0 24px;font-size:15px;color:#6b6b6b;line-height:1.6;">
              Mamy nadzieję, że Twoje zamówienie <strong style="color:#1a1a1a;">#${data.orderNumber}</strong>
              dotarło i spełniło Twoje oczekiwania. Twoja opinia pomaga innym klientom
              w wyborze idealnego zapachu.
            </p>

            <p style="margin:0 0 16px;font-size:13px;font-weight:600;
                      text-transform:uppercase;letter-spacing:0.06em;color:#6b6b6b;">
              Oceń swoje produkty
            </p>

            <table style="width: 100%; border-collapse: collapse; border: 0;">
              ${productRows}
            </table>

            <p style="margin:28px 0 0;font-size:13px;color:#9b9b9b;line-height:1.6;">
              Ocena zajmuje mniej niż minutę. Odpowiadamy na każdą recenzję —
              negatywne opinie traktujemy jako szansę na poprawę.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9f9f9;padding:24px 40px;border-top:1px solid #f0f0f0;text-align:center;">
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
