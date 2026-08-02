/**
 * Single source of truth for luxury-brand abbreviations and common misspellings.
 *
 * Used on both sides of the search pipeline:
 *  - `prisma/seed.ts` writes every abbreviation into `luxury_references.aliases`,
 *    so the denormalized `products."searchText"` haystack contains them verbatim.
 *  - `search-query.util.ts` expands abbreviations typed by the user back into the
 *    full brand name before matching, so a query works even when the abbreviation
 *    was never seeded for that particular reference row.
 *
 * Keeping one list avoids the failure mode where the seeder knows "D&G" but the
 * query parser does not — the two must never drift apart.
 *
 * Left side must be the brand exactly as it appears in `products/products.json`
 * inspirations; adding an entry for a brand that isn't in the catalog is harmless
 * but useless.
 */
export const BRAND_ABBREVIATIONS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['Yves Saint Laurent', ['YSL', 'Y.S.L.']],
  ['Jean Paul Gaultier', ['JPG', 'Gaultier']],
  ['Maison Francis Kurkdjian', ['MFK', 'Kurkdjian']],
  ['Thierry Mugler', ['Mugler']],
  ['Giorgio Armani', ['Armani', 'GA']],
  ['Dolce & Gabbana', ['D&G', 'DG', 'Dolce Gabbana', 'Dolce']],
  ['Hugo Boss', ['Boss']],
  ['Calvin Klein', ['CK']],
  ['Carolina Herrera', ['CH']],
  ['Tiziana Terenzi', ['TT']],
  ['Tom Ford', ['TF']],
  ['Paco Rabanne', ['PR', 'Rabanne']],
  ['Viktor & Rolf', ['V&R', 'VR', 'Viktor Rolf']],
  ['Louis Vuitton', ['LV']],
  ['Narciso Rodriguez', ['NR', 'Narciso']],
  ['Issey Miyake', ['IM', 'Issey']],
  ['Salvatore Ferragamo', ['Ferragamo']],
  ['Zadig & Voltaire', ['Z&V', 'Zadig Voltaire', 'Zadig']],
  ['Parfums de Marly', ['PDM', 'de Marly', 'Marly']],
  ['Estée Lauder', ['Estee Lauder', 'Lauder']],
  ['Laura Biagiotti', ['Biagiotti']],
  ['Profumum Roma', ['Profumum']],
  ['Kilian Paris', ['Kilian', 'By Kilian']],
  ['Giorgio Armani Privé', ['Armani Prive', 'Prive']],
  ['The Spirit of Dubai', ['Spirit of Dubai']],
];

/**
 * Spelling variants that trigram fuzziness alone handles unreliably — either the
 * variant shares too few trigrams with the catalog spelling ("bulgari"/"bvlgari"
 * differ at position 2 of a short word) or it is a legitimately different word
 * that users still expect to resolve ("dior" → the catalog also stores "Dior").
 *
 * Left side is the normalized form the user types; right side is the normalized
 * catalog spelling it expands to. Both sides go through `normalizeSearchText`.
 */
export const BRAND_SPELLING_VARIANTS: ReadonlyArray<readonly [string, string]> = [
  ['bulgari', 'bvlgari'],
  ['bulgary', 'bvlgari'],
  ['bvlgary', 'bvlgari'],
  ['channel', 'chanel'],
  ['chanell', 'chanel'],
  ['shanel', 'chanel'],
  ['versacce', 'versace'],
  ['wersace', 'versace'],
  ['givanchy', 'givenchy'],
  ['guerlaine', 'guerlain'],
  ['hermez', 'hermes'],
  ['ermes', 'hermes'],
  ['zerjoff', 'xerjoff'],
  ['kserjoff', 'xerjoff'],
  ['bajredo', 'byredo'],
  ['kreed', 'creed'],
  ['gucchi', 'gucci'],
  ['guczi', 'gucci'],
];
