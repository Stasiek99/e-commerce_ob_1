import { escapeHtml, sanitizeUrl } from './html-escape.util';

export function backInStockTemplate(data: {
  firstName: string;
  productName: string;
  variantLabel: string;
  productUrl: string;
}): { subject: string; html: string } {
  const subject = `${data.productName} wrócił do sklepu 🎉`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /></head>
<body style="font-family:sans-serif;background:#f9fafb;padding:32px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">

    <div style="background:#1f1f2e;padding:24px;">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;letter-spacing:0.04em;">AROMATERIE</h1>
    </div>

    <div style="padding:32px 24px;">
      <p style="font-size:15px;color:#374151;margin:0 0 8px;">
        Cześć${data.firstName ? `, ${escapeHtml(data.firstName)}` : ''}!
      </p>
      <h2 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 16px;">
        Jeden z obserwowanych produktów wrócił do sklepu
      </h2>
      <p style="font-size:15px;color:#4b5563;margin:0 0 24px;line-height:1.6;">
        Co najmniej jeden wariant produktu, który obserwujesz, jest znowu dostępny. Sprawdź na stronie produktu, czy to wariant, którego szukasz:
      </p>

      <div style="background:#f3f4f6;border-radius:8px;padding:20px 24px;margin-bottom:28px;">
        <p style="margin:0;font-size:17px;font-weight:700;color:#111827;">
          ${escapeHtml(data.productName)}
        </p>
        <p style="margin:4px 0 0;font-size:14px;color:#6b7280;">Dostępny wariant: ${escapeHtml(data.variantLabel)}</p>
      </div>

      <a href="${sanitizeUrl(data.productUrl)}"
         style="display:inline-block;background:#1f1f2e;color:#fff;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:15px;font-weight:600;letter-spacing:0.02em;">
        Przejdź do produktu
      </a>

      <p style="font-size:12px;color:#9ca3af;margin-top:32px;line-height:1.5;">
        Wysłaliśmy tę wiadomość, ponieważ włączyłeś(-aś) powiadomienie o dostępności tego produktu.
        Nie musisz nic robić — powiadomienie zostało automatycznie wyłączone po tej wiadomości.
      </p>
    </div>

  </div>
</body>
</html>`;

  return { subject, html };
}
