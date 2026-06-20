import { escapeHtml, sanitizeUrl } from './html-escape.util';

interface Data {
  firstName: string;
  verifyUrl: string;
}

export function emailVerificationTemplate(data: Data): { subject: string; html: string } {
  return {
    subject: 'Potwierdź swój adres email',
    html: `
<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><title>Potwierdzenie email</title></head>
<body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px">
  <h1 style="color:#1a1a1a;font-size:24px">Potwierdź swój adres email</h1>
  <p>Cześć ${escapeHtml(data.firstName)},</p>
  <p>Dziękujemy za rejestrację. Kliknij przycisk poniżej, aby potwierdzić swój adres email i aktywować konto:</p>
  <p style="text-align:center;margin:32px 0">
    <a href="${sanitizeUrl(data.verifyUrl)}"
       style="background:#1a1a1a;color:#fff;text-decoration:none;padding:14px 28px;border-radius:6px;font-size:16px;display:inline-block">
      Potwierdź email
    </a>
  </p>
  <p style="color:#666;font-size:14px">Link jest ważny przez <strong>24 godziny</strong>. Jeśli nie zakładałeś(-aś) konta w naszym sklepie, zignoruj tę wiadomość.</p>
</body>
</html>`,
  };
}
