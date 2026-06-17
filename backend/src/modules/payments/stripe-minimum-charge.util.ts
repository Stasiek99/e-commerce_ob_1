// Stripe enforces a minimum chargeable amount per currency — well above zero
// for most currencies. https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts
const STRIPE_MINIMUM_CHARGE_IN_CENTS: Record<string, number> = {
  pln: 200,
  usd: 50,
  eur: 50,
  gbp: 30,
  chf: 50,
};

// Currencies not in the table above fail closed with the highest known
// minimum rather than falling through to 0 — a too-low fallback would
// silently recreate this exact bug for an unlisted currency.
const FALLBACK_MINIMUM_CHARGE_IN_CENTS = 200;

export function getStripeMinimumChargeInCents(currency: string): number {
  return STRIPE_MINIMUM_CHARGE_IN_CENTS[currency.toLowerCase()] ?? FALLBACK_MINIMUM_CHARGE_IN_CENTS;
}
