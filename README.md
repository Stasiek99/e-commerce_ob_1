# Aromaterie — Fragrance E-Commerce

**Full-stack Polish e-commerce platform for a fragrance store — product catalogue, cart, Stripe checkout, order management, and admin panel.**

![Angular](https://img.shields.io/badge/Angular-20-dd0031?logo=angular&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-11-e0234e?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-4169e1?logo=postgresql&logoColor=white)
![Stripe](https://img.shields.io/badge/Payments-Stripe-635bff?logo=stripe&logoColor=white)
![Deployed on Vercel](https://img.shields.io/badge/Frontend-Vercel-000?logo=vercel&logoColor=white)
![Deployed on Railway](https://img.shields.io/badge/Backend-Railway-0b0d0e?logo=railway&logoColor=white)

**Live site:** [aromaterie.vercel.app](https://aromaterie.vercel.app)

🇬🇧 English | [🇵🇱 Polski](README.pl.md)

---

## What it is

A production e-commerce platform built as a **pnpm monorepo** with an Angular 20 frontend (SSR on Vercel) and a NestJS 11 backend (Railway). Covers the full purchase funnel — browsing, cart, guest or authenticated checkout, Stripe payment, order tracking, and returns — with a full-featured back-office for managing products, orders, and customers.

---

## Screenshots

### Home

![Home](images/home.png)

### Product Catalogue

![Products](images/products.png)

### Product Detail

![Product](images/product.png)

### Cart & Checkout

![Checkout](images/checkout.png)

---

## Pages

| Route | Page |
|---|---|
| `/` | Home |
| `/products` | Product catalogue |
| `/products/:slug` | Product detail |
| `/category/:slug` | Category view |
| `/cart` | Shopping cart |
| `/checkout` | Checkout (guarded — cart must be non-empty) |
| `/checkout/auth-choice` | Guest vs. account choice during checkout |
| `/checkout/success` / `/failure` | Order result |
| `/auth/login` · `/register` · `/callback` | Authentication |
| `/auth/verify-email` · `/forgot-password` · `/reset-password` | Email & password flows |
| `/account` | Dashboard (auth-guarded) |
| `/account/orders` · `/account/orders/:id` | Order history & detail |
| `/account/profile` · `/account/addresses` | Profile & address book |
| `/orders/track` | Guest order tracking |
| `/wishlist` | Wishlist |
| `/returns` | Return / withdrawal request |
| `/legal/terms` · `/legal/privacy` · `/legal/withdrawal` | Polish legal pages |
| `/partnership` | Partnership enquiry |

---

## Features

### Storefront
- **Product catalogue** — category filtering, slug-based URLs, variant selection (size, concentration)
- **Product detail** — image gallery, variant picker, reviews, add to wishlist, add to cart
- **Real-time stock** — SSE stream updates stock counts on the product page without a refresh
- **Cart** — persistent across sessions, quantity management, coupon code application
- **Wishlist** — saved products across sessions

### Checkout & Payments
- **Guest or authenticated checkout** — email-only or full account flow
- **Stripe** — hosted payment with webhook signature verification; live/test key enforcement at boot
- **Order lifecycle** — 8 statuses: `PENDING_PAYMENT → PAID → PROCESSING → SHIPPED → DELIVERED → CANCELLED → REFUNDED → PARTIALLY_REFUNDED`
- **PDF invoices** — generated with pdfkit, emailed automatically after payment
- **Shipping carriers** — InPost, DHL, GLS, DPD integrations with label generation

### Auth
- **JWT** — short-lived access token (15 min) + rotating refresh tokens (7 d)
- **Google OAuth** — one-click sign-in via Passport.js
- **Email verification** — token-based, required before checkout
- **Forgot / reset password** — time-limited signed tokens

### Customer Account
- Order history with per-item detail
- Address book (multiple saved addresses)
- Returns & 14-day withdrawal requests (EU right of withdrawal)
- Product reviews with purchase verification (moderated: PENDING → APPROVED / REJECTED)

### Back-Office
- **AdminJS panel** — auto-generated CRUD for all Prisma models (users, products, orders, coupons, reviews…)
- **Coupon engine** — PERCENTAGE / FIXED_AMOUNT / FREE_SHIPPING discounts; types: WELCOME, BIRTHDAY, CART_ABANDONMENT, LOYALTY, WIN_BACK, SUBSCRIPTION, CUSTOM
- **Email queue** — BullMQ + Redis; transactional emails via Resend (order confirmation, invoice, verification, reset)

### Infrastructure
- **SSR + PWA** — Angular Universal on Vercel, service worker for offline support
- **SEO** — dynamic meta tags, JSON-LD Product schema, sitemap.xml generated at build time, canonical URLs, prerendering
- **Sentry** — error monitoring on both frontend (`@sentry/angular`) and backend (`@sentry/nestjs`)
- **Rate limiting** — `@nestjs/throttler` on login (5/min), register (3/min), webhook (30/min)
- **Security headers** — Helmet middleware
- **Health check** — `GET /health` with DB connection probe
- **Polish legal compliance** — Regulamin, Polityka prywatności (RODO), Prawo odstąpienia, cookie consent, checkout consent checkbox with stored terms version
- **E2E tests** — Playwright
- **CI** — GitHub Actions: install → build → test

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | Angular 20 (standalone, lazy routes, SSR) |
| Frontend UI | Taiga UI 4 |
| Frontend language | TypeScript 5.9 |
| Frontend reactive | RxJS 7 |
| Frontend hosting | Vercel (SSR via `api/ssr.mjs`) |
| Backend framework | NestJS 11 |
| Backend language | TypeScript 5.6 |
| Database | PostgreSQL (Supabase) via Prisma 6 |
| Queue | BullMQ + Redis |
| Payments | Stripe |
| Email | Resend + BullMQ queue |
| Auth | JWT (Passport) + Google OAuth 2.0 |
| Admin panel | AdminJS 7 + `@adminjs/prisma` |
| Storage | Supabase Storage (product images) |
| PDF | pdfkit |
| Error monitoring | Sentry (frontend + backend) |
| Backend hosting | Railway |
| E2E tests | Playwright |
| Package manager | pnpm 9 (workspaces monorepo) |
| Build | Angular CLI / esbuild (frontend), NestJS CLI (backend) |

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL database (Supabase recommended)
- Redis instance (for BullMQ)
- Stripe account
- Resend account
- Google OAuth credentials

### Install

```bash
git clone https://github.com/Stasiek99/e-commerce_ob_1.git
cd e-commerce_ob_1
pnpm install
```

### Configure environment

Create `backend/.env`:

```env
# Database
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...

# JWT
JWT_ACCESS_SECRET=your_secret_min_16_chars
JWT_REFRESH_SECRET=your_other_secret

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

# Resend (email)
RESEND_API_KEY=re_...
EMAIL_FROM=onboarding@resend.dev

# Redis
REDIS_URL=redis://localhost:6379

# App
FRONTEND_URL=http://localhost:4200

# Admin panel
ADMIN_DEFAULT_EMAIL=admin@example.com
ADMIN_DEFAULT_PASSWORD=your_password_min_10_chars
ADMIN_SESSION_SECRET=your_session_secret
```

### Run

```bash
# Database
pnpm db:migrate
pnpm --filter backend run prisma:seed  # optional: seed sample data

# Start (two terminals)
pnpm dev:backend    # → http://localhost:3000
pnpm dev:frontend   # → http://localhost:4200
```

---

## Project Structure

```
fragrance-store/ (monorepo root)
├── backend/                   # NestJS API
│   ├── prisma/
│   │   ├── schema.prisma      # 24 models — users, products, orders, payments…
│   │   ├── migrations/
│   │   └── seed.ts
│   └── src/
│       ├── modules/
│       │   ├── auth/          # JWT, Google OAuth, email verification, password reset
│       │   ├── users/         # Profile, address book, customer notes
│       │   ├── products/      # Catalogue, variants, images, SSE stock stream
│       │   ├── categories/    # Category tree
│       │   ├── cart/          # Persistent cart
│       │   ├── orders/        # Order lifecycle, order events
│       │   ├── payments/      # Stripe client, webhook handler
│       │   ├── shipping/      # InPost, DHL, GLS, DPD clients
│       │   ├── coupons/       # Discount engine
│       │   ├── reviews/       # Product reviews + moderation
│       │   ├── returns/       # Return & withdrawal requests
│       │   ├── invoice/       # PDF invoice generation (pdfkit)
│       │   ├── email/         # BullMQ email queue + Resend
│       │   ├── wishlist/      # Wishlist
│       │   ├── admin/         # AdminJS panel
│       │   └── storage/       # Supabase image uploads
│       └── common/            # Global guards, interceptors, pipes
├── frontend/                  # Angular 20 SPA + SSR
│   └── src/app/
│       ├── core/              # Auth service, guards, interceptors, SEO service
│       ├── features/
│       │   ├── home/
│       │   ├── catalog/       # Product list, product detail, category
│       │   ├── cart/
│       │   ├── checkout/      # Checkout, auth-choice, success/failure
│       │   ├── auth/          # Login, register, Google callback, verify, reset
│       │   ├── account/       # Dashboard, orders, profile, addresses
│       │   ├── wishlist/
│       │   ├── returns/
│       │   └── legal/         # Terms, privacy, withdrawal
│       └── shared/            # Reusable components, pipes, validators
├── packages/
│   └── shared-types/          # Shared TypeScript types (workspace package)
└── e2e/                       # Playwright E2E tests
```

---

## Deployment

| Service | What |
|---|---|
| **Vercel** | Frontend — SSR via `api/ssr.mjs`, static assets cached for 1 year |
| **Railway** | Backend — Railpack builder, auto-runs `prisma migrate deploy` pre-deploy |
| **Supabase** | PostgreSQL database + image storage |
| **Redis** | BullMQ queue (any Redis-compatible provider) |
