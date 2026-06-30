export const environment = {
  production: true,
  apiUrl: 'https://backend-production-c004.up.railway.app',
  gtmId: 'GTM-XXXXXXX',
  turnstileSiteKey: '',
  sentryDsn: '',  // injected at build time by scripts/inject-sentry-dsn.mjs via SENTRY_DSN env var
  sentryTracesSampleRate: 0.1,
  sentryTracePropagationTargets: [/^https:\/\/backend-production-c004\.up\.railway\.app/],
  dpdWidgetUrl: 'https://api.dpd.cz/widget/latest/index.html?lang=pl&countries=PL&hideCloseButton=true',
  // ─── PHASE 7 HARD GATE — fill in before first real transaction ───────────
  seller: {
    name: 'Aromaterie',
    legalName: '[UZUPEŁNIĆ — pełna nazwa prawna]',
    street: '[UZUPEŁNIĆ — ulica i numer]',
    postalCode: '[XX-XXX]',
    city: '[UZUPEŁNIĆ — miasto]',
    nip: '[UZUPEŁNIĆ — 10 cyfr]',
    regon: '[UZUPEŁNIĆ — 9 lub 14 cyfr]',
    krs: '[UZUPEŁNIĆ — KRS/CEIDG]',
    email: 'kontakt@aromaterie.pl',
    returnsEmail: 'zwroty@aromaterie.pl',
    rodoEmail: 'rodo@aromaterie.pl',
  },
};
