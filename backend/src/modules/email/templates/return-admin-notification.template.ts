import { escapeHtml } from './html-escape.util';

interface ReturnItem {
  productName: string;
  quantity: number;
}

const RESOLUTION_LABELS: Record<string, string> = {
  REPAIR: 'Naprawa produktu',
  REPLACEMENT: 'Wymiana na nowy',
  PRICE_REDUCTION: 'Obniżenie ceny',
  REFUND: 'Zwrot pieniędzy (odstąpienie)',
};

export function returnAdminNotificationTemplate(data: {
  requestId: string;
  orderNumber: string;
  customerName: string;
  email: string;
  phone?: string;
  type: 'WITHDRAWAL' | 'COMPLAINT';
  deliveryDate?: string;
  items: ReturnItem[];
  reason?: string;
  requestedResolution?: string;
}): { subject: string; html: string } {
  const typeLabelShort = data.type === 'WITHDRAWAL' ? 'Odstąpienie (art. 27)' : 'Reklamacja';
  const typeLabel =
    data.type === 'WITHDRAWAL'
      ? 'Odstąpienie od umowy (art. 27 UPK)'
      : 'Reklamacja (rękojmia)';
  const subject = `[${typeLabelShort}] Zamówienie #${data.orderNumber} – ${data.customerName}`;

  const itemRows = data.items
    .map(
      (item) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#1a1a1a;">
          ${escapeHtml(item.productName)}
        </td>
        <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px;
                   color:#6b6b6b;text-align:right;width:60px;">
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
          <td style="background:#1a1a1a;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:0.12em;
                      text-transform:uppercase;color:#c9a96e;">
              Aromaterie — Panel Administracyjny
            </p>
          </td>
        </tr>

        <!-- Alert bar -->
        <tr>
          <td style="background:${data.type === 'WITHDRAWAL' ? '#fff3cd' : '#f8d7da'};
                     padding:12px 40px;text-align:center;">
            <p style="margin:0;font-size:13px;font-weight:700;
                      color:${data.type === 'WITHDRAWAL' ? '#856404' : '#721c24'};">
              Nowe zgłoszenie: ${typeLabel}
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px 40px;">

            <!-- Meta -->
            <table style="width:100%;border-collapse:collapse;border:0;margin-bottom:24px;">
              <tr>
                <td style="font-size:12px;font-weight:600;color:#9b9b9b;
                           text-transform:uppercase;letter-spacing:0.06em;
                           padding:8px 0;border-bottom:1px solid #f0f0f0;width:140px;">
                  Nr zgłoszenia
                </td>
                <td style="font-size:14px;color:#1a1a1a;padding:8px 0;
                           border-bottom:1px solid #f0f0f0;font-weight:600;">
                  ${data.requestId}
                </td>
              </tr>
              <tr>
                <td style="font-size:12px;font-weight:600;color:#9b9b9b;
                           text-transform:uppercase;letter-spacing:0.06em;
                           padding:8px 0;border-bottom:1px solid #f0f0f0;">
                  Zamówienie
                </td>
                <td style="font-size:14px;color:#1a1a1a;padding:8px 0;
                           border-bottom:1px solid #f0f0f0;">
                  #${data.orderNumber}
                </td>
              </tr>
              <tr>
                <td style="font-size:12px;font-weight:600;color:#9b9b9b;
                           text-transform:uppercase;letter-spacing:0.06em;
                           padding:8px 0;border-bottom:1px solid #f0f0f0;">
                  Klient
                </td>
                <td style="font-size:14px;color:#1a1a1a;padding:8px 0;
                           border-bottom:1px solid #f0f0f0;">
                  ${escapeHtml(data.customerName)}
                </td>
              </tr>
              <tr>
                <td style="font-size:12px;font-weight:600;color:#9b9b9b;
                           text-transform:uppercase;letter-spacing:0.06em;
                           padding:8px 0;border-bottom:1px solid #f0f0f0;">
                  Email
                </td>
                <td style="font-size:14px;padding:8px 0;border-bottom:1px solid #f0f0f0;">
                  <a href="mailto:${escapeHtml(data.email)}" style="color:#c9a96e;text-decoration:none;">
                    ${escapeHtml(data.email)}
                  </a>
                </td>
              </tr>
              ${data.deliveryDate ? `
              <tr>
                <td style="font-size:12px;font-weight:600;color:#9b9b9b;
                           text-transform:uppercase;letter-spacing:0.06em;
                           padding:8px 0;border-bottom:1px solid #f0f0f0;">
                  Data odbioru
                </td>
                <td style="font-size:14px;color:#1a1a1a;padding:8px 0;
                           border-bottom:1px solid #f0f0f0;">
                  ${new Date(data.deliveryDate).toLocaleDateString('pl-PL')}
                  ${data.type === 'WITHDRAWAL' ? ` — termin zwrotu: <strong>${new Date(new Date(data.deliveryDate).getTime() + 14 * 86400000).toLocaleDateString('pl-PL')}</strong>` : ''}
                </td>
              </tr>` : ''}
              ${data.phone ? `
              <tr>
                <td style="font-size:12px;font-weight:600;color:#9b9b9b;
                           text-transform:uppercase;letter-spacing:0.06em;
                           padding:8px 0;border-bottom:1px solid #f0f0f0;">
                  Telefon
                </td>
                <td style="font-size:14px;color:#1a1a1a;padding:8px 0;
                           border-bottom:1px solid #f0f0f0;">
                  ${escapeHtml(data.phone)}
                </td>
              </tr>` : ''}
            </table>

            <!-- Items -->
            <p style="margin:0 0 12px;font-size:13px;font-weight:600;
                      text-transform:uppercase;letter-spacing:0.06em;color:#6b6b6b;">
              Produkty do zwrotu
            </p>
            <table style="width:100%;border-collapse:collapse;border:0;margin-bottom:24px;">
              ${itemRows}
            </table>

            ${data.requestedResolution ? `
            <!-- Requested resolution -->
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;
                      text-transform:uppercase;letter-spacing:0.06em;color:#6b6b6b;">
              Żądanie klienta (Art. 43d)
            </p>
            <div style="background:#fff3cd;border-radius:6px;padding:12px 16px;
                        font-size:14px;font-weight:600;color:#856404;margin-bottom:16px;">
              ${escapeHtml(RESOLUTION_LABELS[data.requestedResolution] ?? data.requestedResolution)}
            </div>` : ''}

            ${data.reason ? `
            <!-- Reason -->
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;
                      text-transform:uppercase;letter-spacing:0.06em;color:#6b6b6b;">
              Opis
            </p>
            <div style="background:#f9f9f9;border-radius:6px;padding:14px 16px;
                        font-size:14px;color:#1a1a1a;line-height:1.6;white-space:pre-line;">
              ${escapeHtml(data.reason)}
            </div>` : ''}

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9f9f9;padding:20px 40px;
                     border-top:1px solid #f0f0f0;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9b9b9b;">
              Aromaterie · Wiadomość automatyczna
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
