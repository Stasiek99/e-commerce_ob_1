# Payment Processor Fees — Polish Market (2025/2026)

*Researched 2026-05-29 — 6 processors, 30+ sources*

## TL;DR
Stripe albo P24

---

## TL;DR

| Processor | BLIK | Card (domestic) | Transfer | Monthly fee | Chargeback fee |
|---|---|---|---|---|---|
| **Stripe** | 1.6% + 1 zł | 1.5% + 1 zł | 1.9% + 1 zł (P24) | 0 zł | 90–180 zł |
| **Przelewy24** | 1.9% | 1.29% + 0.30 zł | 1.9% | 0 zł | 25 zł |
| **Tpay Starter** | 1.59% + 0.41 zł | 1.59% + 0.39 zł | 1.59% + 0.39 zł | 0 zł | 120 zł |
| **Tpay Business** | 0.99% + 0.02 zł | 0.99% | 0.99% | 99 zł | 120 zł |
| **PayU** | ~1.8% | 1.9% + 0.25 zł | 2.2–2.5% + 0.30 zł | 0 zł | 20–50 zł* |
| **Autopay** | 1.19% + 0.25 zł | 1.19% + 0.25 zł | 1.19% + 0.25 zł | 0 zł | 0 zł |
| **imoje (ING)** | 1.59% | 1.4% | 1.4% | 0 zł | 0 zł |

*PayU chargeback fee unconfirmed — range from merchant contract reports.*

---

## 1. Stripe

**Model:** Flat per-transaction, no monthly fee, no setup fee.

### Transaction fees (Poland, PLN)

| Payment method | Fee |
|---|---|
| EEA standard card (Visa/MC domestic) | 1.5% + 1.00 zł |
| EEA premium card (corporate/rewards) | 1.9% + 1.00 zł |
| UK card | 2.5% + 1.00 zł |
| International (non-EEA) card | 3.25% + 1.00 zł |
| BLIK | 1.6% + 1.00 zł |
| Przelewy24 (via Stripe) | 1.9% + 1.00 zł |
| SEPA Bank Transfer | 0.5%, max 25 zł |
| Currency conversion surcharge | +2% on top of any above |

### Other fees

- **Setup/monthly:** 0 zł
- **Chargeback fee (2-tier model, June 2025):**
  - Dispute received (non-refundable): **90 zł**
  - Counter-evidence submitted: **90 zł** (refunded if you win)
  - Worst case (received + contested + lost): **180 zł** + transaction reversal
  - Alternative — Smart Disputes (AI): 0 zł if lost, 30% of recovered amount if won
- **Currency conversion to PLN:** +1% on payout volume when holding a foreign balance
- **Payouts:** Free, T+3 business days. New accounts: 7-day initial hold.
- **Instant Payouts:** 1% fee (min 2 zł) — Poland eligibility varies

### Volume discounts

Custom pricing discussions begin around **$80K/month** (~320K zł). No self-serve tier. Enterprise (>$5M/year) can reduce effective rates by 20–40%.

### Practical cost example (200 zł order)

| Method | Fee | Effective rate |
|---|---|---|
| Domestic Visa | 4.00 zł | 2.0% |
| BLIK | 4.20 zł | 2.1% |
| P24 | 4.80 zł | 2.4% |
| International card | 7.50 zł | 3.75% |

### Notes

- BLIK is PLN-only → no currency conversion surcharge
- Routing P24 directly (own P24 merchant account) saves ~0.3–0.6 pp at volume but adds a separate contract
- 180 zł worst-case chargeback cost wipes out ~10–15 low-AOV orders' profit — evaluate Smart Disputes if AOV < 300 zł

**Confidence: HIGH** — all fees from live stripe.com/en-pl/pricing page.

---

## 2. Przelewy24

**Model:** Commission-only, no monthly fee. One-time 59 zł activation (refunded after 10 transactions in 2 months — effectively free for active stores).

### Transaction fees

| Payment method | Fee |
|---|---|
| Bank transfers (pay-by-link) | 1.9% |
| BLIK | 1.9% |
| Visa / Mastercard / JCB | 1.29% + 0.30 zł |
| Apple Pay / Google Pay | 1.29% + 0.30 zł (routed as card) |
| Diners Club / Amex | 3.2% + 0.30 zł |
| P24NOW (BNPL) | 2.5–3% |
| Installments | 0% + 0.30 zł |

### Other fees

- **Setup:** 59 zł (refunded → effectively 0 zł)
- **Monthly:** 0 zł
- **Minimum monthly:** None
- **Chargeback fee:** 25 zł per case
- **Withdrawals (PLN):** First 4/month free, then 0.99 zł each
- **Foreign bank withdrawal:** 1.50 EUR or 40 zł

### Volume discounts

Negotiations open at ~50,000–100,000 zł/month. Achievable reductions: **0.2–0.5 pp off standard rates** (e.g., 1.9% → 1.4–1.7% on transfers/BLIK). Specific plugin integrations (e.g., WP Desk) reportedly unlock ~1.29% transfers / ~1.2% cards.

### Polska Bezgotówkowa program (government subsidy)

New merchants with no prior online payment history:
- **0% commission on Visa/Mastercard for 12 months** OR until 50,000 zł cumulative card turnover
- Activation fee waived
- Program runs until **31 December 2028**

**Confidence: MEDIUM-HIGH** — official fee table URL returned 403; rates cross-referenced across multiple 2026 third-party analyses consistent with each other.

---

## 3. Tpay

**Model:** Three-tier package structure since 1 January 2026. Previous flat-rate model discontinued.

### Starter (no monthly fee)

| Payment method | Fee |
|---|---|
| Online bank transfers | 1.59% + 0.39 zł |
| BLIK | 1.59% + 0.41 zł |
| Cards / Apple Pay / Google Pay | 1.59% + 0.39 zł |
| PayPo (BNPL) | 1.19% + 0.39 zł |

- Activation: **99 zł** (one-time, non-refundable)
- Refunds: **1 zł each**
- Withdrawals (PLN): First 4/month free, then **2 zł each**

### Business (99 zł/month — most popular tier)

| Payment method | Fee |
|---|---|
| All methods (transfers, BLIK, cards, wallets) | 0.99% flat |
| BLIK (minor fixed component) | 0.99% + 0.02 zł |
| PayPo | 0.99% |
| Twisto | 1.19% |
| BLIK Pay Later | 2.5% |

- Activation: **1 zł**
- Refunds: **0 zł**
- Withdrawals: **0 zł**
- Monthly fee charged only in months with **at least 1 transaction**

### Enterprise

Fully custom, negotiated individually.

### Other fees (all tiers)

- **Chargeback fee: 120 zł per claim** — the highest of all processors compared here
- **No minimum monthly fee** beyond the subscription itself

### Break-even: Starter → Business

At approximately **16,500 zł/month** in BLIK + transfer volume, the 99 zł/month subscription is recovered by the 0.60 pp rate saving. At 50,000 zł/month Business saves ~280 zł vs Starter.

### Notes

- Shopify, Shoper, IdoSell merchants get individual terms instead of the standard Business rate — negotiate separately
- 120 zł chargeback fee is a significant liability if you have dispute risk

**Confidence: HIGH** — official 2026 pricing PDF (tpay.com/user/assets/files_for_download/pakiety-serwisowe-2026.pdf) confirmed by tpay.com/oferta.

---

## 4. PayU

**Model:** Commission-only, negotiation-based. No single public rate table — official PDF is not machine-readable; rates below are from 2026 third-party analyses of the merchant contract.

### Transaction fees (standard, pre-negotiation)

| Payment method | Fee |
|---|---|
| BLIK | ~1.8% |
| Cards (Visa/Mastercard) | 1.9% + 0.25 zł |
| Google Pay / Apple Pay | 1.9% + 0.25 zł (same as card) |
| Bank transfers (pay-by-link) | 2.2–2.5% + 0.30 zł |
| BNPL (PayU Later / PayPo / Twisto) | ~3.5% |

### Promotional intro rate

- **1.25% flat** for all methods for the first 3 months (standard offer)
- As low as **1.15% + 0.15 zł** via partner/agency referral programs

### Other fees

- **Setup/activation:** 199 zł standard; drops to 5–29 zł through partner programs (e.g., Centrum Sprzedawcy program)
- **Monthly:** 0 zł
- **Minimum monthly:** Not applicable
- **Chargeback fee:** Unconfirmed from official sources — third-party reports suggest 20–50 zł per dispute; verify in your specific contract
- **Settlement:** D+1 (funds next business day ~4 AM)

### Volume discounts

Negotiations open at **50,000 zł/month**; meaningful reductions at **100,000 zł/month** (20–40% off standard). Achievable rates: 1.2–1.7% depending on industry and volume.

### Notes

- Bank transfer rate (2.2–2.5%) is notably the most expensive transfer pricing in this comparison
- No ING account requirement
- No contract lock-in period published

**Confidence: MEDIUM** — PayU does not publish a simple public fee table; rates sourced from 2026 third-party analyses. Verify in your merchant contract before committing.

---

## 5. Autopay (formerly BlueMedia)

**Model:** Flat rate across all payment methods — no method-specific differentiation.

### Transaction fees

| Plan | All payment methods |
|---|---|
| **Standard (pay-per-transaction)** | 1.19% + 0.25 zł |
| **Starter subscription** (29.99 zł/month) | 0% up to 5,500 zł/month, then 1.1% above |

### Other fees

- **Setup/activation:** 49 zł (registered business / JDG), 199 zł (unregistered)
- **Monthly:** 0 zł (standard plan); 29.99 zł (Starter subscription)
- **Minimum monthly:** Not applicable
- **Chargeback fee: 0 zł** — explicitly confirmed
- **Refund processing:** 0 zł
- **Withdrawal/payout:** 0 zł

### Polska Bezgotówkowa program

0% commission on card (Visa/Mastercard) + BLIK for 12 months or up to 50,000 zł turnover (government cashless program, available while running).

### Break-even: Standard → Starter subscription

At 29.99 zł/month subscription, break-even vs pay-per-transaction occurs at ~2,520 zł/month volume. Above 5,500 zł/month the Starter plan is always cheaper until the volume becomes large enough to negotiate custom Enterprise terms.

### Notes

- Flat rate across all methods simplifies accounting
- 0 zł chargeback fee is a meaningful advantage for stores with dispute risk
- Commission on original transaction is non-refundable even on full customer refund

**Confidence: MEDIUM-HIGH** — official Autopay pricing page confirms plan structure; flat-rate claim supported by Autopay developer FAQ and independent sources.

---

## 6. imoje (ING Bank Śląski)

**Model:** Percentage-only (no fixed per-transaction fee), no subscription, no setup.

### Transaction fees

| Payment method | Fee |
|---|---|
| BLIK | 1.59% |
| Cards (Visa/Mastercard) | 1.4% |
| Bank transfers (pay-by-link) | 1.4% |
| Google Pay / Apple Pay | 1.4% |
| imoje Pay Later (BNPL) | 1.4% |
| imoje Installments + ING Lease Now | **0%** |

### Other fees

- **Setup/activation:** 0 zł
- **Monthly:** 0 zł
- **Minimum monthly:** Not applicable
- **Chargeback fee: 0 zł** — confirmed. Merchant must repay disputed amount within 7 days; original commission not returned.
- **Withdrawal/payout:** 0 zł. Settlement D+1.

### Promotional periods

- **Standard intro:** 0% on all methods for first 3 months
- **Polska Bezgotówkowa:** 0% for 12 months or up to 50,000 zł cumulative turnover

### Hard requirement

Merchant **must hold an ING Bank Śląski business account**. Payouts go exclusively to that account. Switching away from imoje means keeping (or closing) an ING business account.

### Notes

- No fixed per-transaction fee makes imoje most cost-efficient for small/low-AOV transactions
- 1.4% card rate is the lowest published card rate in this comparison (non-promo)
- BLIK premium (1.59%) reflects the 0.19% BLIK network system fee passed through directly
- Volume discounts: none published — rates appear fixed regardless of volume

**Confidence: HIGH** — official ING landing page (ing.pl/lp/imoje) directly states all rates; confirmed by 3+ independent sources. The 0.79% figure appearing on one comparison site (niepoddawajsie.pl) contradicts ING's own page and is treated as an error.

---

## Comparison: Cost on a 200 zł order

| Processor | BLIK cost | Card cost (domestic) | Transfer cost |
|---|---|---|---|
| Stripe | 4.20 zł (2.1%) | 4.00 zł (2.0%) | 4.80 zł via P24 (2.4%) |
| Przelewy24 | 3.80 zł (1.9%) | 2.88 zł (1.44%) | 3.80 zł (1.9%) |
| Tpay Starter | 3.59 zł (1.8%) | 3.57 zł (1.79%) | 3.57 zł (1.79%) |
| Tpay Business | 2.00 zł (1.0%) | 1.98 zł (0.99%) | 1.98 zł (0.99%) |
| PayU | 3.60 zł (1.8%) | 4.05 zł (2.03%) | 4.70–5.30 zł (2.35–2.65%) |
| Autopay | 2.63 zł (1.32%) | 2.63 zł (1.32%) | 2.63 zł (1.32%) |
| imoje | 3.18 zł (1.59%) | 2.80 zł (1.4%) | 2.80 zł (1.4%) |

*Tpay Business 99 zł/month cost not included in per-order calculation above.*

---

## Decision Framework

**Choose Stripe if:**
- You want a single dashboard for cards + BLIK + P24 + international payments
- You're selling internationally (non-PLN customers)
- You need Stripe's billing/subscription/invoicing product suite
- You don't expect high dispute rates (180 zł worst-case chargeback is painful)

**Choose Przelewy24 if:**
- Most of your customers pay by BLIK or bank transfer (1.9% BLIK vs. Stripe's 2.1%)
- You want the Polska Bezgotówkowa 0% card promo for 12 months
- You want low chargeback exposure (25 zł vs. Stripe's 90–180 zł)

**Choose Tpay Business if:**
- Monthly volume exceeds ~16,500 zł (subscription becomes ROI-positive)
- You want the lowest transaction rate across all methods (0.99%)
- Note: 120 zł chargeback fee is the highest here — a risk if you have dispute exposure

**Choose imoje if:**
- You already have (or are willing to open) an ING Bank Śląski business account
- You want 0% for 3–12 months + lowest long-term card rate (1.4%)
- Your order values are small (no fixed fee advantage)

**Choose Autopay if:**
- You want simplicity: one flat rate (1.19% + 0.25 zł) for every method
- You want 0 zł chargeback fees
- Low-to-mid volume (the Starter subscription is efficient at >2,500 zł/month)

**Avoid PayU standard rates** until you can negotiate — bank transfer rate (2.2–2.5%) and unclear chargeback terms make it less attractive at face value. The 1.25% intro rate is good but lasts only 3 months.

---

## Sources

1. [Stripe Poland Pricing](https://stripe.com/en-pl/pricing)
2. [Stripe Local Payment Methods (PL)](https://stripe.com/en-pl/pricing/local-payment-methods)
3. [Stripe Payouts Docs](https://docs.stripe.com/payouts)
4. [ChargebackStop — Stripe 2025 Two-Tier Dispute Model](https://www.chargebackstop.com/blog/stripe-chargeback-fees-in-2025-how-to-survive-the-new-two-tier-dispute-model)
5. [Przelewy24 — Cennik 2026 (kcmobile.pl)](https://kcmobile.pl/baza-wiedzy/ecommerce/ile-kosztuje-przelewy24-dla-sklepu-online/)
6. [Przelewy24 — Bramkomat comparison](https://bramkomat.app/operatorzy/przelewy24/)
7. [Przelewy24 — Polska Bezgotówkowa](https://www.przelewy24.pl/oferta/polska-bezgotowkowa)
8. [Tpay — Pakiety 2026 (official PDF)](https://tpay.com/user/assets/files_for_download/pakiety-serwisowe-2026.pdf)
9. [Tpay — oferta (official)](https://tpay.com/oferta)
10. [Tpay — zmiana modelu (cashless.pl)](https://www.cashless.pl/18305-tpay-zmiana-cennika)
11. [PayU — Cennik 2026 (kcmobile.pl)](https://kcmobile.pl/baza-wiedzy/ecommerce/ile-kosztuje-payu-dla-sklepu-online/)
12. [PayU — dokumenty (official)](https://poland.payu.com/dokumenty/)
13. [Autopay — oferta (official)](https://autopay.pl/oferta/platnosci-online)
14. [Autopay — developer FAQ on commissions](https://developers.autopay.pl/online/faq/prowizja/jak-pobierana-jest-prowizja-za-usluge-platnosci)
15. [imoje — ING official landing page](https://www.ing.pl/lp/imoje)
16. [imoje — cashfix.pl overview](https://cashfix.pl/wiedza/imoje-opinie-i-informacje/)
17. [BLIK system fee background (cashless.pl)](https://www.cashless.pl/11378-blik-nowa-oplata-systemowa)
