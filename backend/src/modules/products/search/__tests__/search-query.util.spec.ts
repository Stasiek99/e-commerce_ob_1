import { FUZZY_MIN_TOKEN_LENGTH, normalizeSearchText, parseSearchQuery } from '../search-query.util';

// These tests pin the query-side half of the search contract. The other half —
// `normalize_search_text()` in the 20260801120000_product_search_text migration —
// must produce identical output for the same input; the "haystack parity" block
// below encodes the specific catalog strings that parity is load-bearing for.
describe('normalizeSearchText', () => {
  it('lowercases and trims', () => {
    expect(normalizeSearchText('  Chanel  ')).toBe('chanel');
  });

  it('folds Polish diacritics', () => {
    expect(normalizeSearchText('Żółć ćma ĘŁĄ')).toBe('zolc cma ela');
  });

  it('folds Western European diacritics found in catalog brand names', () => {
    expect(normalizeSearchText('Lancôme')).toBe('lancome');
    expect(normalizeSearchText('Chloé')).toBe('chloe');
    expect(normalizeSearchText('Estée Lauder')).toBe('estee lauder');
    expect(normalizeSearchText('Giorgio Armani Privé')).toBe('giorgio armani prive');
  });

  it('drops ampersands and dots WITHOUT inserting a space, so abbreviations stay one token', () => {
    expect(normalizeSearchText('D&G')).toBe('dg');
    expect(normalizeSearchText('Y.S.L.')).toBe('ysl');
    expect(normalizeSearchText("L'Homme")).toBe('lhomme');
  });

  it('still splits a spaced-out brand on the surrounding whitespace', () => {
    expect(normalizeSearchText('Dolce & Gabbana')).toBe('dolce gabbana');
  });

  it('replaces dashes and typographic quotes with a single space', () => {
    expect(normalizeSearchText('Dior – Sauvage')).toBe('dior sauvage');
    expect(normalizeSearchText('„Bleu”  de   Chanel')).toBe('bleu de chanel');
  });

  it('strips LIKE metacharacters, so the output is safe to interpolate into a pattern', () => {
    expect(normalizeSearchText('100%_off')).toBe('100 off');
  });

  it('returns an empty string for nullish input', () => {
    expect(normalizeSearchText(null)).toBe('');
    expect(normalizeSearchText(undefined)).toBe('');
    expect(normalizeSearchText('')).toBe('');
  });
});

describe('parseSearchQuery — abbreviation expansion', () => {
  it('expands a whole-query abbreviation to the full brand name', () => {
    expect(parseSearchQuery('DG').tokens).toEqual(['dolce', 'gabbana']);
    expect(parseSearchQuery('ysl').tokens).toEqual(['yves', 'saint', 'laurent']);
  });

  it('resolves the same abbreviation regardless of punctuation or spacing', () => {
    const expected = ['dolce', 'gabbana'];
    expect(parseSearchQuery('D&G').tokens).toEqual(expected);
    expect(parseSearchQuery('d & g').tokens).toEqual(expected);
    expect(parseSearchQuery('  dg  ').tokens).toEqual(expected);
  });

  it('expands an abbreviation used as one token of a longer query', () => {
    // The point of REPLACING rather than appending: the matcher searches for the
    // full brand, not a 2-character token that would trigram-match everything.
    expect(parseSearchQuery('dg the one').tokens).toEqual(['dolce', 'gabbana', 'the', 'one']);
  });

  it('maps known misspellings onto the catalog spelling', () => {
    expect(parseSearchQuery('bulgari').tokens).toEqual(['bvlgari']);
    expect(parseSearchQuery('channel no 5').tokens).toEqual(['chanel', 'no']);
  });

  it('keeps the dropped single-character token in the phrase used for ranking', () => {
    // "5" is not a match token — a one-character LIKE pattern matches almost every
    // row and would only add noise to the relaxed OR pass. Recall is unaffected
    // (the product still matches on "chanel"/"no"), and precision is recovered at
    // ranking time: the full phrase scores against lr.name and "searchText", so
    // "Chanel No 5" outranks "Chanel No 19" for this query.
    expect(parseSearchQuery('channel no 5').phrase).toBe('chanel no 5');
  });

  it('leaves unknown tokens untouched for the trigram fallback to handle', () => {
    expect(parseSearchQuery('sauvag').tokens).toEqual(['sauvag']);
  });

  it('exposes both the expanded phrase and the phrase as typed', () => {
    const parsed = parseSearchQuery('D&G The One');
    expect(parsed.phrase).toBe('dolce gabbana the one');
    // rawPhrase keeps the un-expanded form so a literal seeded alias still ranks.
    expect(parsed.rawPhrase).toBe('dg the one');
  });
});

describe('parseSearchQuery — token hygiene', () => {
  it('drops single-character tokens that would match the whole catalog', () => {
    expect(parseSearchQuery('a b tom ford').tokens).toEqual(['tom', 'ford']);
  });

  it('marks a query with no usable token as unusable rather than matching everything', () => {
    expect(parseSearchQuery('a').isUsable).toBe(false);
    expect(parseSearchQuery('   ').isUsable).toBe(false);
    expect(parseSearchQuery('%%%').isUsable).toBe(false);
  });

  it('dedupes repeated tokens', () => {
    expect(parseSearchQuery('dior dior sauvage').tokens).toEqual(['dior', 'sauvage']);
  });

  it('caps token count so a pathological query cannot fan out the SQL predicate', () => {
    const parsed = parseSearchQuery('aa bb cc dd ee ff gg hh ii jj kk ll');
    expect(parsed.tokens).toHaveLength(8);
  });

  it('keeps the catalog-number token intact', () => {
    expect(parseSearchQuery('040W').tokens).toEqual(['040w']);
  });
});

describe('parseSearchQuery — fuzzy eligibility', () => {
  // Tokens below FUZZY_MIN_TOKEN_LENGTH get a substring predicate only; the
  // service relies on this split to keep 2–3 character tokens from trigram-
  // matching the entire catalog.
  it('produces short tokens for abbreviations that survived expansion', () => {
    expect(parseSearchQuery('no 5').tokens.every((t) => t.length < FUZZY_MIN_TOKEN_LENGTH)).toBe(true);
  });

  it('produces fuzzy-eligible tokens for real brand words', () => {
    expect(parseSearchQuery('dolcce gabana').tokens).toEqual(['dolcce', 'gabana']);
    expect(parseSearchQuery('dolcce gabana').tokens.every((t) => t.length >= FUZZY_MIN_TOKEN_LENGTH)).toBe(true);
  });
});
