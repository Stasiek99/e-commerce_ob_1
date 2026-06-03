import { readFileSync } from 'fs';
import { join } from 'path';

// Regression guard for the @@index([productId]) added to ProductImage.
// Reads the schema source directly so it fails the moment the directive is
// removed — no live database connection needed.

describe('ProductImage schema — @@index([productId])', () => {
  const schema = readFileSync(
    join(__dirname, '../../../../prisma/schema.prisma'),
    'utf-8',
  );

  // Isolate only the ProductImage model block for assertions
  const modelBlock = schema.match(/model ProductImage \{[\s\S]*?\}/)?.[0] ?? '';

  it('ProductImage model block is found in schema.prisma', () => {
    expect(modelBlock).not.toBe('');
  });

  it('has @@index([productId]) directive', () => {
    expect(modelBlock).toMatch(/@@index\(\[productId\]\)/);
  });

  it('@@index appears before @@map to preserve declaration order', () => {
    const indexPos = modelBlock.indexOf('@@index([productId])');
    const mapPos = modelBlock.indexOf('@@map("product_images")');
    expect(indexPos).toBeGreaterThan(-1);
    expect(mapPos).toBeGreaterThan(-1);
    expect(indexPos).toBeLessThan(mapPos);
  });
});
