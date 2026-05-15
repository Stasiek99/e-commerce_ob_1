interface Data {
  firstName: string;
  magicUrl: string;
}

export function magicLinkTemplate(data: Data): { subject: string; html: string } {
  return {
    subject: 'Twój link do logowania',
    html: `
<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><title>Link do logowania</title></head>
<body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px">
  <h1 style="color:#1a1a1a;font-size:24px">Zaloguj się jednym kliknięciem</h1>
  <p>Cześć ${data.firstName},</p>
  <p>Otrzymaliśmy prośbę o zalogowanie się do Twojego konta bez hasła. Kliknij poniższy przycisk, aby się zalogować:</p>
  <p style="text-align:center;margin:32px 0">
    <a href="${data.magicUrl}"
       style="background:#1a1a1a;color:#fff;text-decoration:none;padding:14px 28px;border-radius:6px;font-size:16px;display:inline-block">
      Zaloguj się
    </a>
  </p>
  <p style="color:#666;font-size:14px">Link jest ważny przez <strong>15 minut</strong> i można go użyć tylko raz. Jeśli nie prosiłeś(-aś) o link do logowania, zignoruj tę wiadomość — Twoje konto jest bezpieczne.</p>
</body>
</html>`,
  };
}
