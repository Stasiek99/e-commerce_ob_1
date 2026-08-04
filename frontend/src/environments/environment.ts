export const environment = {
  production: false,
  apiUrl: "/api",
  gtmId: "",
  sentryDsn: "",
  turnstileSiteKey: "1x00000000000000000000AA",
  sentryTracesSampleRate: 1.0,
  sentryTracePropagationTargets: ["localhost", "/api"],
  dpdWidgetUrl:
    "https://api.dpd.cz/widget/latest/index.html?lang=pl&countries=PL&hideCloseButton=true",
  seller: {
    name: "Aromaterie",
    legalName: "[UZUPEŁNIĆ — pełna nazwa prawna]",
    street: "[UZUPEŁNIĆ — ulica i numer]",
    postalCode: "[XX-XXX]",
    city: "[UZUPEŁNIĆ — miasto]",
    nip: "[UZUPEŁNIĆ — 10 cyfr]",
    regon: "[UZUPEŁNIĆ — 9 lub 14 cyfr]",
    krs: "[UZUPEŁNIĆ — KRS/CEIDG]",
    email: "kontakt@aromaterie.pl",
    returnsEmail: "zwroty@aromaterie.pl",
    rodoEmail: "rodo@aromaterie.pl",
  },
};
