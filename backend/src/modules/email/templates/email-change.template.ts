interface Data {
  firstName: string;
  newEmail: string;
  verifyUrl: string;
}

export function emailChangeTemplate(data: Data): { subject: string; html: string } {
  return {
    subject: 'Potwierdź zmianę adresu email',
    html: `
<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><title>Zmiana adresu email</title></head>
<body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px">
  <h1 style="color:#1a1a1a;font-size:24px">Potwierdź nowy adres email</h1>
  <p>Cześć ${data.firstName},</p>
  <p>Otrzymaliśmy prośbę o zmianę adresu email na Twoim koncie na <strong>${data.newEmail}</strong>.</p>
  <p>Kliknij poniższy przycisk, aby potwierdzić nowy adres:</p>
  <p style="text-align:center;margin:32px 0">
    <a href="${data.verifyUrl}"
       style="background:#1a1a1a;color:#fff;text-decoration:none;padding:14px 28px;border-radius:6px;font-size:16px;display:inline-block">
      Potwierdź nowy email
    </a>
  </p>
  <p style="color:#666;font-size:14px">Link jest ważny przez <strong>24 godziny</strong>. Jeśli nie prosiłeś(-aś) o zmianę adresu email, zignoruj tę wiadomość — Twój obecny adres pozostanie bez zmian.</p>
</body>
</html>`,
  };
}