# Aromaterie — Sklep Internetowy z Perfumami

**Kompletna platforma e-commerce dla sklepu z perfumami — katalog produktów, koszyk, płatności Stripe, zarządzanie zamówieniami i panel administracyjny.**

![Angular](https://img.shields.io/badge/Angular-20-dd0031?logo=angular&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-11-e0234e?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-4169e1?logo=postgresql&logoColor=white)
![Stripe](https://img.shields.io/badge/Płatności-Stripe-635bff?logo=stripe&logoColor=white)
![Deployed on Vercel](https://img.shields.io/badge/Frontend-Vercel-000?logo=vercel&logoColor=white)
![Deployed on Railway](https://img.shields.io/badge/Backend-Railway-0b0d0e?logo=railway&logoColor=white)

**Strona na żywo:** [aromaterie.vercel.app](https://aromaterie.vercel.app)

[🇬🇧 English](README.md) | 🇵🇱 Polski

---

## Czym jest ten projekt

Produkcyjna platforma e-commerce zbudowana jako **monorepo pnpm** z frontendem Angular 20 (SSR na Vercel) i backendem NestJS 11 (Railway). Obsługuje pełny lejek zakupowy — przeglądanie, koszyk, zakup jako gość lub zalogowany użytkownik, płatność Stripe, śledzenie zamówień i zwroty — wraz z zapleczem administracyjnym do zarządzania produktami, zamówieniami i klientami.

---

## Zrzuty ekranu

### Strona główna

![Strona główna](images/home.png)

### Katalog produktów

![Produkty](images/products.png)

### Szczegóły produktu

![Produkt](images/product.png)

### Koszyk i zamówienie

![Zamówienie](images/checkout.png)

---

## Podstrony

| Ścieżka | Strona |
|---|---|
| `/` | Strona główna |
| `/products` | Katalog produktów |
| `/products/:slug` | Szczegóły produktu |
| `/category/:slug` | Widok kategorii |
| `/cart` | Koszyk |
| `/checkout` | Zamówienie (wymagany niepusty koszyk) |
| `/checkout/auth-choice` | Wybór: gość lub konto |
| `/checkout/success` / `/failure` | Wynik płatności |
| `/auth/login` · `/register` · `/callback` | Uwierzytelnianie |
| `/auth/verify-email` · `/forgot-password` · `/reset-password` | E-mail i hasło |
| `/account` | Panel klienta (wymaga logowania) |
| `/account/orders` · `/account/orders/:id` | Historia zamówień |
| `/account/profile` · `/account/addresses` | Profil i adresy |
| `/orders/track` | Śledzenie zamówienia bez konta |
| `/wishlist` | Lista życzeń |
| `/returns` | Zwrot / odstąpienie od umowy |
| `/legal/terms` · `/legal/privacy` · `/legal/withdrawal` | Strony prawne |
| `/partnership` | Zapytanie o współpracę |

---

## Funkcjonalności

### Sklep
- **Katalog produktów** — filtrowanie po kategorii, adresy URL oparte na slug, wybór wariantów
- **Szczegóły produktu** — galeria zdjęć, wybór wariantu, opinie, dodanie do listy życzeń i do koszyka
- **Aktualizacje stanu magazynowego w czasie rzeczywistym** — strumień SSE odświeża stany bez przeładowania strony
- **Koszyk** — zapisywany między sesjami, zarządzanie ilością, kody rabatowe
- **Lista życzeń** — produkty zapisane między sesjami

### Zamówienia i płatności
- **Zakup jako gość lub zalogowany** — tylko e-mail lub pełne konto
- **Stripe** — płatność hostowana z weryfikacją podpisu webhooka; wymuszenie kluczy live/test przy starcie
- **Cykl życia zamówienia** — 8 statusów: `PENDING_PAYMENT → PAID → PROCESSING → SHIPPED → DELIVERED → CANCELLED → REFUNDED → PARTIALLY_REFUNDED`
- **Faktury PDF** — generowane przez pdfkit, wysyłane automatycznie po płatności
- **Przewoźnicy** — integracje z InPost, DHL, GLS, DPD

### Uwierzytelnianie
- **JWT** — krótkotrwały access token (15 min) + rotujące refresh tokeny (7 d)
- **Google OAuth** — logowanie jednym kliknięciem przez Passport.js
- **Weryfikacja e-maila** — wymagana przed złożeniem zamówienia
- **Zapomniałem hasła / reset** — tokeny z limitem czasowym

### Konto klienta
- Historia zamówień ze szczegółami
- Książka adresowa (wiele adresów)
- Zwroty i 14-dniowe prawo odstąpienia od umowy
- Opinie o produktach z weryfikacją zakupu (moderowane: PENDING → APPROVED / REJECTED)

### Zaplecze administracyjne
- **Panel AdminJS** — automatycznie generowany CRUD dla wszystkich modeli Prisma
- **Silnik kuponów** — rabaty PERCENTAGE / FIXED_AMOUNT / FREE_SHIPPING; typy: WELCOME, BIRTHDAY, CART_ABANDONMENT, LOYALTY, WIN_BACK, SUBSCRIPTION, CUSTOM
- **Kolejka e-maili** — BullMQ + Redis; e-maile transakcyjne przez Resend

### Infrastruktura
- **SSR + PWA** — Angular Universal na Vercel, service worker dla trybu offline
- **SEO** — dynamiczne meta tagi, JSON-LD schema produktu, sitemap.xml generowany przy buildzie, kanoniczne URL, prerenderowanie
- **Sentry** — monitoring błędów na frontendzie i backendzie
- **Rate limiting** — `@nestjs/throttler` dla logowania (5/min), rejestracji (3/min), webhook (30/min)
- **Nagłówki bezpieczeństwa** — middleware Helmet
- **Health check** — `GET /health` z sondą połączenia z DB
- **Zgodność z prawem polskim** — Regulamin, Polityka prywatności (RODO), Prawo odstąpienia, baner cookie, checkbox zgody przy zamówieniu z zapisem wersji regulaminu
- **Testy E2E** — Playwright
- **CI** — GitHub Actions: install → build → test

---

## Stack technologiczny

| Warstwa | Technologia |
|---|---|
| Framework frontendowy | Angular 20 (standalone, lazy routes, SSR) |
| UI frontendowy | Taiga UI 4 |
| Język frontendowy | TypeScript 5.9 |
| Reaktywność | RxJS 7 |
| Hosting frontendowy | Vercel (SSR przez `api/ssr.mjs`) |
| Framework backendowy | NestJS 11 |
| Język backendowy | TypeScript 5.6 |
| Baza danych | PostgreSQL (Supabase) przez Prisma 6 |
| Kolejka | BullMQ + Redis |
| Płatności | Stripe |
| E-mail | Resend + kolejka BullMQ |
| Uwierzytelnianie | JWT (Passport) + Google OAuth 2.0 |
| Panel admina | AdminJS 7 + `@adminjs/prisma` |
| Storage | Supabase Storage (zdjęcia produktów) |
| PDF | pdfkit |
| Monitoring błędów | Sentry (frontend + backend) |
| Hosting backendowy | Railway |
| Testy E2E | Playwright |
| Menedżer pakietów | pnpm 9 (monorepo workspaces) |
| Build | Angular CLI / esbuild (frontend), NestJS CLI (backend) |

---

## Uruchomienie lokalne

### Wymagania

- Node.js 20+
- pnpm 9+
- Baza danych PostgreSQL (zalecany Supabase)
- Redis (dla BullMQ)
- Konto Stripe
- Konto Resend
- Google OAuth credentials

### Instalacja

```bash
git clone https://github.com/Stasiek99/e-commerce_ob_1.git
cd e-commerce_ob_1
pnpm install
```

### Konfiguracja środowiska

Utwórz plik `backend/.env`:

```env
# Baza danych
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...

# JWT
JWT_ACCESS_SECRET=twoj_sekret_min_16_znakow
JWT_REFRESH_SECRET=inny_sekret

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_SUCCESS_URL=http://localhost:4200/checkout/success
STRIPE_CANCEL_URL=http://localhost:4200/checkout/failure

# Supabase Storage
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Resend (e-mail)
RESEND_API_KEY=re_...
EMAIL_FROM=onboarding@resend.dev

# Redis
REDIS_URL=redis://localhost:6379

# Aplikacja
FRONTEND_URL=http://localhost:4200

# Panel admina
ADMIN_DEFAULT_EMAIL=admin@example.com
ADMIN_DEFAULT_PASSWORD=twoje_haslo_min_10_znakow
ADMIN_SESSION_SECRET=twoj_sekret_sesji
```

### Uruchomienie

```bash
# Baza danych
pnpm db:migrate
pnpm --filter backend run prisma:seed  # opcjonalnie: dane testowe

# Start (dwa terminale)
pnpm dev:backend    # → http://localhost:3000
pnpm dev:frontend   # → http://localhost:4200
```

---

## Struktura projektu

```
fragrance-store/ (root monorepo)
├── backend/                   # API NestJS
│   ├── prisma/
│   │   ├── schema.prisma      # 24 modele — użytkownicy, produkty, zamówienia…
│   │   ├── migrations/
│   │   └── seed.ts
│   └── src/
│       ├── modules/
│       │   ├── auth/          # JWT, Google OAuth, weryfikacja e-mail, reset hasła
│       │   ├── users/         # Profil, książka adresowa, notatki klienta
│       │   ├── products/      # Katalog, warianty, zdjęcia, strumień SSE stanu
│       │   ├── categories/    # Drzewo kategorii
│       │   ├── cart/          # Koszyk
│       │   ├── orders/        # Cykl życia zamówienia, zdarzenia
│       │   ├── payments/      # Klient Stripe, obsługa webhooka
│       │   ├── shipping/      # Klienci InPost, DHL, GLS, DPD
│       │   ├── coupons/       # Silnik rabatów
│       │   ├── reviews/       # Opinie o produktach + moderacja
│       │   ├── returns/       # Zwroty i odstąpienia od umowy
│       │   ├── invoice/       # Generowanie faktur PDF (pdfkit)
│       │   ├── email/         # Kolejka BullMQ + Resend
│       │   ├── wishlist/      # Lista życzeń
│       │   ├── admin/         # Panel AdminJS
│       │   └── storage/       # Upload zdjęć (Supabase)
│       └── common/            # Globalne guardy, interceptory, pipe'y
├── frontend/                  # Angular 20 SPA + SSR
│   └── src/app/
│       ├── core/              # Serwis auth, guardy, interceptory, SEO
│       ├── features/
│       │   ├── home/
│       │   ├── catalog/       # Lista produktów, szczegóły, kategoria
│       │   ├── cart/
│       │   ├── checkout/      # Zamówienie, wybór konta, wynik płatności
│       │   ├── auth/          # Login, rejestracja, Google, weryfikacja, reset
│       │   ├── account/       # Panel, zamówienia, profil, adresy
│       │   ├── wishlist/
│       │   ├── returns/
│       │   └── legal/         # Regulamin, polityka, prawo odstąpienia
│       └── shared/            # Wielokrotnego użytku komponenty, pipe'y, walidatory
├── packages/
│   └── shared-types/          # Współdzielone typy TypeScript
└── e2e/                       # Testy E2E Playwright
```

---

## Wdrożenie

| Usługa | Rola |
|---|---|
| **Vercel** | Frontend — SSR przez `api/ssr.mjs`, zasoby statyczne cache 1 rok |
| **Railway** | Backend — builder Railpack, automatyczny `prisma migrate deploy` przed wdrożeniem |
| **Supabase** | Baza PostgreSQL + storage zdjęć |
| **Redis** | Kolejka BullMQ |
