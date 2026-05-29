import { toCatalogNumber } from '../update-catalog-numbers';

// toCatalogNumber is the pure function that determines what goes into the DB.
// The script now matches by slug (name-base_code) so each product gets its own
// unique number — including the many "Perfumy dla Niego" with different codes.

describe('toCatalogNumber', () => {
  describe('numeric codes with gender suffix', () => {
    it('strips trailing W from a numeric code', () => {
      expect(toCatalogNumber('080W')).toBe('080');
    });

    it('strips trailing M from a numeric code', () => {
      expect(toCatalogNumber('038M')).toBe('038');
    });

    it('strips trailing U from a numeric code', () => {
      expect(toCatalogNumber('127U')).toBe('127');
    });

    it('preserves leading zeros after stripping', () => {
      expect(toCatalogNumber('006W')).toBe('006');
    });
  });

  describe('numeric codes without gender suffix', () => {
    it('returns the code as-is for a plain integer', () => {
      expect(toCatalogNumber('75')).toBe('75');
    });

    it('returns the code as-is for a three-digit integer', () => {
      expect(toCatalogNumber('102')).toBe('102');
    });
  });

  describe('non-numeric codes — must return null', () => {
    it('returns null for an all-alpha code (IMPERATRIX)', () => {
      expect(toCatalogNumber('IMPERATRIX')).toBeNull();
    });

    it('returns null for an all-alpha code (MULTIVERSE)', () => {
      expect(toCatalogNumber('MULTIVERSE')).toBeNull();
    });

    it('returns null for an all-alpha code (NADIR)', () => {
      expect(toCatalogNumber('NADIR')).toBeNull();
    });

    it('returns null for an alphanumeric code ending with a digit (ASTRAL24)', () => {
      expect(toCatalogNumber('ASTRAL24')).toBeNull();
    });

    it('returns null for an alphanumeric+suffix code (EVENT23M)', () => {
      expect(toCatalogNumber('EVENT23M')).toBeNull();
    });

    it('returns null for an alphanumeric+suffix code (EVENT23W)', () => {
      expect(toCatalogNumber('EVENT23W')).toBeNull();
    });
  });
});
