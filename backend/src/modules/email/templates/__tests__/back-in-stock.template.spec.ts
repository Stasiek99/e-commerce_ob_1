import { backInStockTemplate } from '../back-in-stock.template';

const BASE = {
  firstName: 'Marek',
  productName: 'Czarna Perła',
  variantLabel: '50ml',
  productUrl: 'https://aromaterie.pl/products/czarna-perla',
};

describe('backInStockTemplate()', () => {
  // ── Subject line ──────────────────────────────────────────────────

  describe('subject', () => {
    it('contains the product name', () => {
      const { subject } = backInStockTemplate(BASE);
      expect(subject).toContain('Czarna Perła');
    });
  });

  // ── Copy does not over-claim the specific variant is what the user wants ──
  // WishlistItem is linked to Product, not ProductVariant — any variant
  // restock notifies every watcher of the product, regardless of which
  // variant they actually want. The copy must not imply the named variant
  // is necessarily the one the recipient is waiting for.

  describe('variant-claim copy', () => {
    it('does not assert the product itself (vs. one of its variants) is back', () => {
      const { html } = backInStockTemplate(BASE);
      expect(html).not.toContain('Twój produkt wrócił do sklepu');
    });

    it('frames the restock as product-level, not a guaranteed match to the watched variant', () => {
      const { html } = backInStockTemplate(BASE);
      expect(html).toContain('Jeden z obserwowanych produktów wrócił do sklepu');
      expect(html).toContain('Co najmniej jeden wariant produktu, który obserwujesz, jest znowu dostępny');
    });

    it('tells the recipient to verify the variant on the product page', () => {
      const { html } = backInStockTemplate(BASE);
      expect(html).toContain('Sprawdź na stronie produktu, czy to wariant, którego szukasz');
    });

    it('still surfaces which variant triggered the notification, labelled explicitly', () => {
      const { html } = backInStockTemplate(BASE);
      expect(html).toContain('Dostępny wariant: 50ml');
    });
  });

  // ── HTML — content ────────────────────────────────────────────────

  describe('HTML — content', () => {
    it('contains the customer first name', () => {
      const { html } = backInStockTemplate(BASE);
      expect(html).toContain('Marek');
    });

    it('contains the product name', () => {
      const { html } = backInStockTemplate(BASE);
      expect(html).toContain('Czarna Perła');
    });

    it('links to the product URL', () => {
      const { html } = backInStockTemplate(BASE);
      expect(html).toContain('href="https://aromaterie.pl/products/czarna-perla"');
    });

    it('omits the greeting name when firstName is empty', () => {
      const { html } = backInStockTemplate({ ...BASE, firstName: '' });
      expect(html).toContain('Cześć!');
    });
  });

  // ── HTML — structure ──────────────────────────────────────────────

  describe('HTML — structure', () => {
    it('returns a valid HTML document', () => {
      const { html } = backInStockTemplate(BASE);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });
  });
});
