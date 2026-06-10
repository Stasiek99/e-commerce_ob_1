import * as fs from 'fs';
import * as path from 'path';

describe('CheckoutPageComponent — WCAG 1.4.3 street-hint--warning contrast', () => {
  const COMPONENT_SRC = path.resolve(__dirname, '../checkout-page.component.ts');

  it('street-hint--warning color is #9a5e00 — raised from failing #c47a00 (≈2.87:1)', () => {
    const src = fs.readFileSync(COMPONENT_SRC, 'utf8');
    expect(src).toContain('#9a5e00');
    expect(src).not.toContain('#c47a00');
  });
});
