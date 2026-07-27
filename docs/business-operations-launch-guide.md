# Przewodnik operacyjny przed launchem — jak realnie prowadzić ten sklep

Dokument syntetyzuje `business-process-model.md`, `clickable-elements-mapping-plan.md`
i `pre-launch-audit-checklist.md` pod kątem **prowadzenia biznesu**, nie kodu: czego
używa aplikacja, co przećwiczyć przed pierwszym realnym zamówieniem, co obserwować
w Sentry, ile to będzie kosztować i jak wygląda typowy dzień pracy w AdminJS +
z przewoźnikami.

---

## 1. Z czego faktycznie składa się ten biznes (stack pod kątem operacyjnym)

| Narzędzie | Rola biznesowa | Status w repo |
|---|---|---|
| **AdminJS** (`/admin`) | Backoffice: katalog, zamówienia, etykiety, zwroty, faktury | Działa, osobny login (patrz §7) |
| **Stripe** | Płatności (karta, BLIK, P24), zwroty, chargebacki, wypłaty | Test mode — do przełączenia na `sk_live_`/`pk_live_` |
| **Sentry** | Monitoring błędów backendu i frontendu, alerty `fatal` | Opcjonalny w dev, **wymagany** w produkcji (`config.validation.ts` blokuje boot bez `SENTRY_DSN`) |
| **Google Tag Manager / GA4** | Analityka e-commerce (`view_item`, `add_to_cart`, `begin_checkout`, `purchase`) | **Zaimplementowane, ale nieaktywne** — `environment.prod.ts` ma placeholder `gtmId: 'GTM-XXXXXXX'`, `AnalyticsService.init()` świadomie odrzuca ten wzorzec (`startsWith('GTM-XXX')`). Trzeba wstawić realny kontener GTM przed launchem, inaczej **żadne dane sprzedażowe nie polecą do GA4** mimo że kod jest gotowy i zgodny z RODO (ładuje się dopiero po zgodzie w `CookieConsent`). |
| **Supabase** | Baza Postgres (pooled + direct URL) + storage na obrazki produktów i faktury PDF | Działa |
| **Resend** | E-maile transakcyjne (potwierdzenia, faktury, powiadomienia o wysyłce, magic link) | Wymaga weryfikacji domeny (SPF/DKIM/DMARC) przed launchem — bez tego wysyłka tylko na adres właściciela konta |
| **Redis / BullMQ** | Kolejka e-maili + locki (checkout, fraud-review, reconcile) | **Hard gate** w produkcji — bez realnego Redis e-maile cicho nigdy się nie wyślą |
| **Railway** | Hosting backendu, cron reconciliation, healthcheck | Hobby tier usypia kontener bez ruchu — patrz §5 |
| **Vercel** | Hosting frontendu (SSR + prerender hybrydowy) | Działa |
| **InPost / DHL / GLS / DPD** | Przewoźnicy — etykiety + tracking | **Wszystkie 4 w trybie MOCK** (`*_MOCK_ENABLED=true`) — patrz §8 |
| **Cloudflare Turnstile** | Antybot na `POST /cart/items` i `POST /orders` | Opcjonalny (pusty klucz = wyłączony) |

---

## 2. Co koniecznie przećwiczyć przed launchem (poza checklistą techniczną)

`pre-launch-audit-checklist.md` już ma pełną listę 31 punktów klikalnych — tu tylko
**warstwa biznesowa**, której nie widać z samej checklisty:

- [ ] **Przełącz GTM z placeholdera na realny kontener** i sprawdź w GTM Preview Mode,
      że `purchase` faktycznie strzela po `checkout.session.completed` — inaczej pierwsze
      tygodnie sprzedaży będą "ślepe" w Google Analytics.
- [ ] **Zweryfikuj domenę w Resend** (SPF + DKIM + DMARC, patrz CLAUDE.md) — bez tego
      `EMAIL_FROM` musi zostać na `onboarding@resend.dev`, co dla realnych klientów jest
      nie do przyjęcia (rate-limited, tylko do właściciela konta).
- [ ] **Skonfiguruj w Stripe Dashboard wszystkich 7 eventów webhooka**, nie tylko 4
      (`checkout.session.completed/expired/async_payment_failed`, `charge.refund.updated`)
      — musisz dodać też `charge.dispute.created`, `charge.dispute.closed`,
      `payout.failed`. Bez tego cały mechanizm obsługi chargebacków (§6 poniżej) jest
      martwy — kod działa, ale Stripe nigdy nie wyśle tych zdarzeń, jeśli nie są
      zaznaczone w panelu.
- [ ] **Przetestuj realny (nie mock) przepływ z co najmniej jednym przewoźnikiem**
      (najłatwiej InPost — ma sandbox) zanim przełączysz `*_MOCK_ENABLED=false` na
      produkcji. Etykieta w mocku ma format `mock-label-{id}.pdf` i nigdy nie trafi do
      realnego kuriera.
- [ ] **Skonfiguruj `ADMIN_ALERT_EMAIL` i (opcjonalnie) `MERCHANT_SLACK_WEBHOOK_URL`**
      — to jedyny kanał, którym dowiesz się o nowym zamówieniu, wyjątku przewozowym
      (paczka `FAILED`/`RETURNED`) czy sporze (dispute) bez ręcznego odświeżania
      AdminJS.
- [ ] **Załóż konto backupowe bazy danych** (pg_dump do S3/R2 lub Supabase Pro PITR) —
      to twardy warunek przed włączeniem Stripe live mode wg CLAUDE.md (utrata danych
      zamówień = potencjalne naruszenie RODO art. 33).
- [ ] **Sprawdź, czy masz sposób na zatwierdzanie `FRAUD_REVIEW`** — patrz §6, ten
      proces nie ma UI w AdminJS.

---

## 3. Sentry — co obserwować i czego się nauczyć

### Co monitorować od pierwszego dnia
- **Poziom `fatal`** — celowo zarezerwowany w kodzie dla sytuacji "pieniądze mogą się
  nie zgadzać": rasy statusów zamówień (`Order status race on markSessionPaid` itp.),
  niezgodność kwoty ze Stripe (`amountMismatch` → `FRAUD_REVIEW`). Jeśli coś ląduje na
  `fatal`, **to nie jest bug do ogarnięcia w wolnej chwili — sprawdź to samego dnia**.
- **Poziom `error`** — np. nieudany zwrot Stripe (`Stripe refund failed`). Oznacza, że
  klient czeka na pieniądze, a system tego automatycznie nie naprawi.
- **Dispute alert** (`sendDisputeAlert`) i **payout failed alert** — widoczne w Sentry
  jako captured exception/message *tylko jeśli* webhooki są poprawnie zasubskrybowane
  (patrz punkt wyżej w §2). To pierwszy sygnał o chargebacku — masz ograniczony czas na
  odpowiedź (`evidence_details.due_by` w Stripe), więc alert musi realnie do Ciebie
  dotrzeć (mail/Slack), nie tylko wisieć w Sentry.
- **Warstwa frontendowa** — Sentry łapie też błędy JS z Angulara (np. rozjazd SSR/CSR).
  Warto założyć osobny alert (np. próg >N błędów/godz.) żeby nie zasypać się szumem
  z pojedynczych przeglądarek klientów.

### Czego się nauczyć przed launchem
1. **Release tracking** — `SENTRY_RELEASE` domyślnie bierze `RAILWAY_GIT_COMMIT_SHA`,
   więc każdy deploy jest osobnym release'em. Naucz się filtrować "Issues" po release,
   żeby wiedzieć czy błąd pojawił się po Twoim ostatnim wdrożeniu.
2. **Breadcrumbs / request context** — przy błędzie płatności/zamówienia sprawdzaj
   request ID (korelacja z logami backendu przez `correlation/` middleware) zamiast
   zgadywać, które zamówienie ucierpiało.
3. **Alerty progowe, nie tylko per-event** — jeden `fatal` = działanie natychmiast,
   ale warto też ustawić alert na "spike" (np. nagły wzrost `error` w ciągu 10 min) —
   to zwykle oznacza padły Stripe/Supabase/Redis, a nie pojedynczy bug.
4. **Sample rate** — `SENTRY_TRACES_SAMPLE_RATE=0.1` / `SENTRY_PROFILES_SAMPLE_RATE=0.1`
   to defaulty do dostrojenia zależnie od ruchu, żeby nie przepłacać (patrz §5) i nie
   tracić zdarzeń jednocześnie.

---

## 4. Szacunkowe koszty infrastruktury (stan na połowę 2026)

Ceny bazowe, orientacyjne — realny koszt zależy od ruchu. Rozdzielone na "start"
(pierwsze miesiące, niski ruch) i "wzrost" (setki zamówień/mies.).

| Usługa | Plan startowy | Koszt/mies. | Kiedy rośnie |
|---|---|---|---|
| **Railway** (backend) | Hobby | $5 bazowo (kredyt $5, potem pay-as-you-go) | Pro $20/mies./seat przy większym ruchu lub potrzebie braku usypiania kontenera |
| **Railway Cron** (reconcile keep-alive) | w ramach powyższego | ~$0–2 | rośnie z liczbą replik |
| **Vercel** (frontend) | Hobby (darmowy) → Pro | $20/mies./seat na Pro | SSR functions billed osobno: $0.60/mln wywołań + CPU/GB-h — dla małego sklepu to grosze, przy dużym ruchu może dodać 30-60% do bazy |
| **Supabase** | Free → Pro $25/mies. | $25 + nadwyżki (storage, compute) | Realny koszt małego/średniego sklepu to zwykle $35–75/mies. po doliczeniu compute credits i storage; przy 200k+ MAU $100–200 |
| **Sentry** | Team | $26/mies. (rocznie) za 50k błędów | Nadwyżka zdarzeń dopłacana — przy 100k błędów/mies. realnie ~$40/mies. |
| **Resend** | Free (3k e-maili/mies.) → Pro $20 | $0–20 | Pro = 50k e-maili/mies.; Scale od $90 (100k) |
| **Redis (Railway add-on)** | osobny serwis | ~$5–10/mies. | rośnie z pamięcią/przepustowością |
| **Stripe** | brak opłaty stałej | % od transakcji: **karty EEA 1,5% + 1 PLN, BLIK 1,6% + 1 PLN, P24 1,9% + 1 PLN** (+2% przy przewalutowaniu) | rośnie liniowo z obrotem — to Twój największy koszt zmienny |
| **Domena + DNS** | np. Cloudflare | ~$10–15/rok | — |
| **Cloudflare Turnstile** | darmowy | $0 | — |
| **InPost/DHL/GLS/DPD API** | brak opłaty za samo API | Koszt to same przesyłki (per paczka, wg cennika przewoźnika/umowy) | — |

**Orientacyjny miesięczny koszt "stały" (bez prowizji Stripe i przesyłek) na starcie:**
ok. **$60–90/mies.** (Railway + Vercel Hobby/niski Pro + Supabase Pro + Sentry Team +
Resend Free/niski Pro + Redis). Przy realnym wzroście (setki zamówień/mies., pełen
Vercel Pro, wyższe tiery Supabase/Resend) realistycznie **$150–300/mies.** stałych
kosztów infrastruktury — do tego prowizje Stripe (1,5–1,9% + opłata stała od
transakcji) i koszty przesyłek jako główny koszt zmienny skalujący się z wolumenem.

*Źródła cenników: [Railway](https://railway.com/pricing), [Vercel](https://vercel.com/pricing), [Supabase](https://supabase.com/pricing), [Sentry](https://sentry.io/pricing/), [Resend](https://resend.com/pricing), [Stripe PL](https://stripe.com/en-pl/pricing).*

---

## 5. Nieoczywiste rzeczy, które będziesz rozwiązywać codziennie

To nie są bugi — to normalna praca operacyjna wynikająca wprost z modelu procesów:

1. **`FRAUD_REVIEW` nie ma przycisku w AdminJS.** Stripe Radar oznacza zamówienie jako
   podejrzane → trafia do `FRAUD_REVIEW`, ale zatwierdzenie/odrzucenie to wyłącznie
   REST endpoint (`POST /orders/admin/:id/fraud-review/approve|reject`), zabezpieczony
   **innym systemem logowania niż AdminJS** (JWT + `Role.ADMIN` na koncie użytkownika,
   nie sesja `ADMIN_DEFAULT_EMAIL`/`ADMIN_DEFAULT_PASSWORD`). W praktyce: musisz mieć
   konto klienta z rolą ADMIN i wołać ten endpoint ręcznie (Postman/curl) albo
   zbudować sobie prosty panelik — inaczej zamówienia "podejrzane" utkną na zawsze.
2. **Chargeback (`DISPUTE_HOLD` → `DISPUTE_LOST_REVIEW`) wymaga ręcznej decyzji.**
   Gdy spór jest przegrany, system **celowo nie przywraca stanu magazynowego** i czeka
   na Twoją decyzję: `CANCELLED` (towar nigdy nie dotarł) czy `REFUNDED` (chargeback
   się utrzymuje). To realna, cotygodniowa decyzja biznesowa, nie techniczna.
3. **Niski stan magazynowy i braki danych regulacyjnych** — AdminJS pokazuje to jako
   banery ostrzegawcze na liście produktów/wariantów (`reorderThreshold`, brak
   `cpnpNotificationNumber`/`ufiCode`/`responsiblePersonName`). Te ostatnie to wymóg
   prawny UE (rozp. 1223/2009 / CLP) — **aktywny produkt bez CPNP/UFI to realne ryzyko
   compliance**, nie kosmetyczny brak danych.
4. **Wyjątki przewozowe (`FAILED`/`RETURNED`)** — co 15 minut system odpytuje
   przewoźników o status i przy zagubionej/zwróconej paczce wysyła alert mailowy, ale
   **nie zmienia automatycznie statusu zamówienia** — to Ty decydujesz, czy to zwrot
   kosztów, reklamacja do przewoźnika, czy wysyłka zamiennika.
5. **Zamówienia-widma (`PENDING_PAYMENT` bez płatności)** — sweep co 2h je anuluje
   automatycznie, ale warto raz na jakiś czas spojrzeć, czy nie ma anomalii (np. ktoś
   systematycznie zaczyna checkout i porzuca — sygnał UX albo scalpingu).
6. **Zwroty w trybie `WITHDRAWAL` (odstąpienie od umowy, 14 dni)** — nie możesz
   zatwierdzić zwrotu pieniędzy, dopóki nie masz numeru śledzenia potwierdzającego, że
   towar fizycznie wraca (art. 32 UoK) — to blokuje `markRefunded`, nie jest to
   przeoczenie.
7. **Reconciliation na Railway hobby tier.** Kontener usypia bez ruchu — jeśli nie
   masz zewnętrznego crona/pingu (`POST /payments/reconcile` co 10 min lub
   `GET /health` co 5 min), zawieszone płatności `PENDING` mogą nie zostać
   rozliczone przez wiele godzin. To trzeba świadomie ustawić, nie jest "z automatu".
8. **Strona `/partnership`** — obecnie wszystkie CTA i baner "Zostań partnerem Chogan"
   linkują donikąd (`/`, placeholder). To wisząca decyzja biznesowa (realny link
   partnerski czy usunięcie strony) — nie techniczny dług.

---

## 6. Dzienny flow pracy: AdminJS ↔ przewoźnicy (orientacyjny)

```
1. Logowanie do AdminJS (/admin, ADMIN_DEFAULT_EMAIL/PASSWORD)
   → sprawdź banery na liście Produktów/Wariantów: niski stan magazynowy,
     brakujące CPNP/UFI, brakująca Osoba Odpowiedzialna

2. Zamówienia → filtr status = PAID (świeże, nieprzetworzone)
   → dla każdego: "Generuj etykietę" (per rekord) albo zaznacz wiele
     i "Oznacz jako wysłane" (bulk — wymaga, by etykieta już istniała
     w praktyce, więc kolejność: najpierw generowanie etykiet)

3. Etykieta generowana per przewoźnik wybrany przez klienta w checkout
   (InPost paczkomat / DHL / GLS / DPD punkt) — AdminJS wywołuje
   generateLabel(orderId), zwraca link do PDF etykiety (albo tryb mock
   z samym numerem trackingowym, jeśli *_MOCK_ENABLED=true)
   → pobierz/wydrukuj etykiety, przekaż paczki kurierowi/do paczkomatu

4. Co 15 min w tle: pollShipmentTracking odpytuje przewoźników
   → status LABEL_GENERATED → IN_TRANSIT → DELIVERED aktualizuje się
     sam, nie musisz nic klikać
   → jeśli przewoźnik zwróci FAILED/RETURNED — dostajesz mail
     (ADMIN_ALERT_EMAIL) i musisz ręcznie zdecydować co dalej (pkt 5.4)

5. W ciągu dnia, reaktywnie:
   - Zamówienia FRAUD_REVIEW → decyzja poza AdminJS (REST + JWT, zob. §6.1)
   - Zamówienia DISPUTE_HOLD/DISPUTE_LOST_REVIEW → decyzja CANCELLED/REFUNDED
   - Nowe zgłoszenia zwrotów (Returns) w statusie PENDING → approve/reject,
     przy WITHDRAWAL poczekaj na tracking number zanim zatwierdzisz refundę
   - Alert Slack/mail o nowym zamówieniu (jeśli skonfigurowany
     MERCHANT_SLACK_WEBHOOK_URL) — szybki podgląd bez wchodzenia do AdminJS

6. Pod koniec dnia: rzut oka na Sentry (poziom fatal/error) i na
   AdminJS → Zamówienia z filtrem "ostatnie 24h" — czy nic nie utknęło
   w PENDING_PAYMENT/FRAUD_REVIEW dłużej niż powinno
```

**Uwaga:** dopóki wszystkie 4 integracje przewoźników są w trybie `*_MOCK_ENABLED=true`,
powyższy flow da się przećwiczyć end-to-end bez realnych kosztów przesyłek — etykiety
i statusy generują się deterministycznie (`SHIPMENT_MOCK_IN_TRANSIT_AFTER_MINUTES`/
`SHIPMENT_MOCK_DELIVERED_AFTER_MINUTES`). To najlepszy sposób, by przećwiczyć cały
proces zanim padnie pierwsze realne zamówienie.
