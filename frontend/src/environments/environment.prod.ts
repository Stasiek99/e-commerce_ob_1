export const environment = {
  production: true,
  apiUrl: 'https://backend-production-c004.up.railway.app',
  gtmId: 'GTM-XXXXXXX',
  sentryDsn: 'https://e859ba7aa95521faa94e9b42ade0c8ea@o4511250966839296.ingest.de.sentry.io/4511250985910352',
  sentryTracesSampleRate: 0.1,
  sentryTracePropagationTargets: [/^https:\/\/backend-production-c004\.up\.railway\.app/],
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
