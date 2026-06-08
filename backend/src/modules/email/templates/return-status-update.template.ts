import { escapeHtml } from './html-escape.util';

export function returnStatusUpdateTemplate(data: {
  firstName: string;
  orderNumber: string;
  requestId: string;
  type: 'WITHDRAWAL' | 'COMPLAINT';
  newStatus: 'APPROVED' | 'REJECTED' | 'COMPLETED';
  adminNote?: string;
}): { subject: string; html: string } {
  const typeLabel = data.type === 'WITHDRAWAL' ? 'odstąpienia od umowy' : 'reklamacji';

  const statusConfig: Record<
    'APPROVED' | 'REJECTED' | 'COMPLETED',
    { subject: string; heading: string; body: string; badgeBg: string; badgeColor: string; badgeText: string }
  > = {
    APPROVED: {
      subject: `Zgłoszenie ${typeLabel} zatwierdzone – zamówienie #${data.orderNumber}`,
      heading: 'Zgłoszenie zatwierdzone',
      body:
        data.type === 'WITHDRAWAL'
          ? 'Twoje zgłoszenie odstąpienia od umowy zostało zatwierdzone. Zwrot środków zostanie przetworzony w ciągu 14 dni roboczych na rachunek bankowy podany w zgłoszeniu.'
          : 'Twoja reklamacja została zatwierdzona. Poinformujemy Cię o sposobie jej realizacji w osobnej wiadomości.',
      badgeBg: '#dcfce7',
      badgeColor: '#166534',
      badgeText: 'Zatwierdzono',
    },
    REJECTED: {
      subject: `Zgłoszenie ${typeLabel} odrzucone – zamówienie #${data.orderNumber}`,
      heading: 'Zgłoszenie odrzucone',
      body:
        data.type === 'WITHDRAWAL'
          ? 'Niestety Twoje zgłoszenie odstąpienia od umowy zostało odrzucone. Jeśli masz pytania, skontaktuj się z nami.'
          : 'Niestety Twoja reklamacja została odrzucona. Jeśli masz pytania, skontaktuj się z nami.',
      badgeBg: '#fee2e2',
      badgeColor: '#991b1b',
      badgeText: 'Odrzucono',
    },
    COMPLETED: {
      subject: `Zgłoszenie ${typeLabel} zakończone – zamówienie #${data.orderNumber}`,
      heading:
        data.type === 'WITHDRAWAL' ? 'Zwrot środków zrealizowany' : 'Reklamacja rozpatrzona',
      body:
        data.type === 'WITHDRAWAL'
          ? 'Zwrot środków za Twoje zamówienie został zrealizowany. Środki powinny pojawić się na Twoim koncie w ciągu 2–5 dni roboczych.'
          : 'Twoja reklamacja została w pełni rozpatrzona i zamknięta. Dziękujemy za kontakt.',
      badgeBg: '#dbeafe',
      badgeColor: '#1e40af',
      badgeText: 'Zakończono',
    },
  };

  const cfg = statusConfig[data.newStatus];

  const adminNoteBlock = data.adminNote
    ? `<div style="background:#fffbeb;border-left:3px solid #f59e0b;border-radius:4px;
                   padding:14px 18px;margin-top:20px;">
         <p style="margin:0 0 4px;font-size:11px;font-weight:600;
                   text-transform:uppercase;letter-spacing:0.08em;color:#92400e;">
           Wiadomość od obsługi klienta
         </p>
         <p style="margin:0;font-size:14px;color:#1a1a1a;line-height:1.6;">
           ${escapeHtml(data.adminNote)}
         </p>
       </div>`
    : '';

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
            <div style="display:inline-block;background:${cfg.badgeBg};border-radius:4px;
                        padding:5px 12px;font-size:12px;font-weight:700;
                        color:${cfg.badgeColor};margin-bottom:16px;letter-spacing:0.03em;">
              ${cfg.badgeText}
            </div>
            <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#1a1a1a;line-height:1.3;">
              ${cfg.heading}
            </h1>
            <p style="margin:0 0 20px;font-size:15px;color:#6b6b6b;line-height:1.6;">
              Drogi/a <strong style="color:#1a1a1a;">${escapeHtml(data.firstName)}</strong>,
              ${cfg.body}
            </p>

            <!-- Reference number -->
            <div style="background:#f9f9f9;border-radius:6px;padding:16px 20px;margin-bottom:8px;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:600;
                        text-transform:uppercase;letter-spacing:0.08em;color:#9b9b9b;">
                Numer zgłoszenia
              </p>
              <p style="margin:0;font-size:18px;font-weight:700;color:#1a1a1a;
                        letter-spacing:0.04em;">
                ${data.requestId}
              </p>
            </div>

            ${adminNoteBlock}

            <p style="margin:24px 0 0;font-size:13px;color:#9b9b9b;line-height:1.6;">
              W razie pytań napisz na
              <a href="mailto:zwroty@aromaterie.pl"
                 style="color:#c9a96e;text-decoration:none;">zwroty@aromaterie.pl</a>,
              podając numer zgłoszenia.
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

  return { subject: cfg.subject, html };
}
