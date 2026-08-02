import { BRAND_ABBREVIATIONS, BRAND_SPELLING_VARIANTS } from './brand-aliases';

/**
 * Query-side text pipeline for product search.
 *
 * IMPORTANT — `normalizeSearchText` here MUST stay behaviourally identical to the
 * Postgres `normalize_search_text(text)` function created in
 * `prisma/migrations/20260801120000_product_search_text/migration.sql`. The column
 * `products."searchText"` is written by a DB trigger using the SQL version; if the
 * two normalizers drift, queries stop matching the haystack they are compared to.
 *
 * The contract both sides implement:
 *   1. lowercase
 *   2. fold diacritics to ASCII  ("Lancôme" -> "lancome", "Chloé" -> "chloe")
 *   3. drop `& . , ' ’ \` ´` WITHOUT inserting a space, so "D&G" collapses to the
 *      single token "dg" while "Dolce & Gabbana" collapses to "dolce gabbana"
 *   4. replace every remaining non `[a-z0-9]` run with a single space
 *   5. collapse/trim whitespace
 *
 * Step 3 is what makes abbreviation matching work at all: both the query and the
 * seeded alias reduce to the same token regardless of how the ampersand was typed.
 * Step 4 also guarantees the output contains no SQL `LIKE` metacharacters (`%`,
 * `_`), so interpolating it into a pattern is safe.
 */

/** Non-decomposable characters NFD cannot fold — handled explicitly on both sides. */
const NON_DECOMPOSABLE: ReadonlyArray<readonly [RegExp, string]> = [
  [/ł/g, 'l'],
  [/ø/g, 'o'],
  [/đ/g, 'd'],
  [/þ/g, 't'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
  [/ß/g, 'ss'],
];

const COMBINING_MARKS = /[̀-ͯ]/g;
const DROPPED_PUNCTUATION = /[&.,'’`´]/g;
const NON_ALNUM = /[^a-z0-9]+/g;

export function normalizeSearchText(value: string | null | undefined): string {
  if (!value) return '';

  let out = value.toLowerCase();
  for (const [pattern, replacement] of NON_DECOMPOSABLE) {
    out = out.replace(pattern, replacement);
  }

  return out
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(DROPPED_PUNCTUATION, '')
    .replace(NON_ALNUM, ' ')
    .trim();
}

/**
 * Normalized abbreviation/misspelling -> normalized canonical brand.
 *
 * Two keys are registered per abbreviation: the normalized form ("d g" would be
 * wrong, so punctuation is dropped without spacing -> "dg") and its
 * whitespace-free collapse, so "v r", "v&r" and "vr" all resolve identically.
 */
const ALIAS_EXPANSIONS: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();

  const register = (from: string, to: string) => {
    const key = normalizeSearchText(from);
    const value = normalizeSearchText(to);
    if (!key || !value || key === value) return;
    // First registration wins — earlier entries in BRAND_ABBREVIATIONS are the
    // more specific ones, and silently overwriting would make the mapping depend
    // on list order in a way that is easy to break during edits.
    if (!map.has(key)) map.set(key, value);
    const collapsed = key.replace(/\s+/g, '');
    if (collapsed !== key && !map.has(collapsed)) map.set(collapsed, value);
  };

  for (const [brand, abbreviations] of BRAND_ABBREVIATIONS) {
    for (const abbreviation of abbreviations) register(abbreviation, brand);
  }
  for (const [variant, canonical] of BRAND_SPELLING_VARIANTS) {
    register(variant, canonical);
  }

  return map;
})();

/** Tokens shorter than this are matched by substring only — trigram similarity on
 *  2–3 character tokens matches almost everything and destroys precision. */
export const FUZZY_MIN_TOKEN_LENGTH = 4;

/** Guard against a pathological query fanning out into a huge SQL predicate. */
const MAX_TOKENS = 8;

export interface ParsedSearchQuery {
  /** Normalized query with abbreviations expanded — used for phrase-level ranking. */
  phrase: string;
  /** Normalized query as typed, no expansion — lets an exact alias hit still rank. */
  rawPhrase: string;
  /** Deduped tokens (abbreviations already expanded) that must all match. */
  tokens: string[];
  /** False when the query carries no usable signal and search should be skipped. */
  isUsable: boolean;
}

/**
 * Expands known abbreviations by REPLACING the token rather than appending to it.
 * "dg the one" becomes ["dolce", "gabbana", "the", "one"], so the fuzzy matcher
 * searches for the full brand name instead of a two-letter token that would
 * trigram-match unrelated products.
 *
 * A whole-query alias is checked first so "d & g" (three tokens) still resolves.
 */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const rawPhrase = normalizeSearchText(raw);
  if (!rawPhrase) {
    return { phrase: '', rawPhrase: '', tokens: [], isUsable: false };
  }

  const wholeQueryAlias = ALIAS_EXPANSIONS.get(rawPhrase.replace(/\s+/g, '')) ?? ALIAS_EXPANSIONS.get(rawPhrase);

  const expanded = wholeQueryAlias
    ? wholeQueryAlias.split(' ')
    : rawPhrase
        .split(' ')
        .flatMap((token) => {
          const alias = ALIAS_EXPANSIONS.get(token);
          return alias ? alias.split(' ') : [token];
        });

  const tokens: string[] = [];
  for (const token of expanded) {
    // Single characters carry no signal and would match every row.
    if (token.length < 2) continue;
    if (tokens.includes(token)) continue;
    tokens.push(token);
    if (tokens.length === MAX_TOKENS) break;
  }

  const phrase = expanded.join(' ').trim();

  return {
    phrase: phrase || rawPhrase,
    rawPhrase,
    tokens,
    // A one-character query ("a") yields no tokens — treat it as no search at all
    // rather than running a predicate that matches the entire catalog.
    isUsable: tokens.length > 0,
  };
}
