import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface RawProduct {
  base_code: string;
  name: string;
  category: string;
  gender: string;
}

// Strip a single trailing gender letter (W/M/U) only when it follows a digit,
// then return null for anything that isn't purely numeric (IMPERATRIX, ASTRAL24, etc.).
export function toCatalogNumber(base_code: string): string | null {
  const stripped = base_code.replace(/(\d)[WMU]$/, '$1');
  return /^\d+$/.test(stripped) ? stripped : null;
}

// Mirrors the slugify() used in seed.ts.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ą/g, 'a').replace(/ę/g, 'e').replace(/ó/g, 'o').replace(/ś/g, 's')
    .replace(/ł/g, 'l').replace(/ź/g, 'z').replace(/ż/g, 'z').replace(/ć/g, 'c')
    .replace(/ń/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main() {
  const raw: RawProduct[] = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../products/products.json'), 'utf-8'),
  );

  const targets = raw.filter((p) => p.category === 'perfume' || p.category === 'perfume_luxury');
  console.log(`Processing ${targets.length} perfumes…`);

  let updated = 0;
  let notFound = 0;

  for (const p of targets) {
    const catalogNumber = toCatalogNumber(p.base_code);
    // Slug is the unique key — same formula as seed.ts: slugify(name) + '-' + base_code.toLowerCase()
    const slug = `${slugify(p.name)}-${p.base_code.toLowerCase()}`;

    const result = await prisma.product.updateMany({
      where: { slug },
      data: { catalogNumber },
    });

    if (result.count > 0) {
      console.log(`  ✓ ${slug} → ${catalogNumber}`);
      updated += result.count;
    } else {
      console.log(`  ✗ NOT FOUND: ${slug}`);
      notFound++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, not found: ${notFound}`);
}

if (require.main === module) {
  main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
