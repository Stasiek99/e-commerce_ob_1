// Stripe's "zero-decimal" currencies take unit_amount/amount_off/amount as the
// whole currency unit, not 1/100th of it — https://docs.stripe.com/currencies#zero-decimal
// Every money computation in this codebase (snapshotPrice, unitAmount, amount_off,
// totalInCents, invoice VAT math) assumes a 2-decimal minor unit (gr/100 = zł) and
// is not written to convert for these currencies. Boot-time validation
// (config.validation.ts STRIPE_CURRENCY) rejects them outright until that
// conversion work is done, rather than letting one through to silently overcharge
// customers 100x.
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

export function isZeroDecimalCurrency(currency: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase());
}
