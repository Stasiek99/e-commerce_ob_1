interface Data {
  firstName: string;
  resetUrl: string;
}

export function passwordResetTemplate(data: Data): { subject: string; html: string } {
  return {
    subject: 'Resetowanie hasła',
    html: `
<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><title>Resetowanie hasła</title></head>
<body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px">
  <h1 style="color:#1a1a1a;font-size:24px">Resetowanie hasła</h1>
  <p>Cześć ${data.firstName},</p>
  <p>Otrzymaliśmy prośbę o zresetowanie hasła do Twojego konta. Kliknij przycisk poniżej, aby ustawić nowe hasło:</p>
  <p style="text-align:center;margin:32px 0">
    <a href="${data.resetUrl}"
       style="background:#1a1a1a;color:#fff;text-decoration:none;padding:14px 28px;border-radius:6px;font-size:16px;display:inline-block">
      Zresetuj hasło
    </a>
  </p>
  <p style="color:#666;font-size:14px">Link jest ważny przez <strong>1 godzinę</strong>. Jeśli nie prosiłeś(-aś) o reset hasła, zignoruj tę wiadomość — Twoje konto pozostaje bezpieczne.</p>
</body>
</html>`,
  };
}
