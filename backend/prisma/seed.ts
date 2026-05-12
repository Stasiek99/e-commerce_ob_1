import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12;

// ─── Products source ─────────────────────────────────────────────────────────

interface RawVariant {
  code: string;
  size: string;
  price_pln: number;
  cdn_image?: string;
}

interface RawProduct {
  base_code: string;
  name: string;
  category: 'perfume' | 'perfume_luxury' | 'shower_gel' | 'diffuser' | 'air_freshener';
  gender: 'women' | 'men' | 'unisex';
  is_best_seller: boolean;
  description_full: string;
  olfactory_pyramid?: { top?: string; heart?: string; base?: string };
  inspiration?: string;
  variants: RawVariant[];
}

const productsData: RawProduct[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../products/products.json'), 'utf-8'),
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ą/g, 'a').replace(/ę/g, 'e').replace(/ó/g, 'o').replace(/ś/g, 's')
    .replace(/ł/g, 'l').replace(/ź/g, 'z').replace(/ż/g, 'z').replace(/ć/g, 'c')
    .replace(/ń/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function randomStock(): number {
  return Math.floor(Math.random() * 10) + 1;
}

function parseVolume(size: string): number | null {
  const m = size.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function extractNotes(pyramid?: RawProduct['olfactory_pyramid']): string[] {
  if (!pyramid) return [];
  return [pyramid.top, pyramid.heart, pyramid.base]
    .filter(Boolean)
    .flatMap((s) => s!.split(',').map((n) => n.trim()))
    .filter(Boolean);
}

function shortDescription(p: RawProduct): string {
  if (p.olfactory_pyramid) {
    const parts = [p.olfactory_pyramid.top, p.olfactory_pyramid.heart, p.olfactory_pyramid.base].filter(Boolean);
    if (parts.length) return parts.join(' · ').substring(0, 200);
  }
  return p.description_full.split('.')[0].substring(0, 200);
}

const GENDER_MAP: Record<string, string> = { women: 'damski', men: 'męski', unisex: 'unisex' };

const BRAND_MAP: Record<RawProduct['category'], string> = {
  perfume: 'Chogan',
  perfume_luxury: 'Chogan',
  shower_gel: 'Chogan',
  diffuser: 'Cooperativa Perfumieri',
  air_freshener: 'Cooperativa Perfumieri',
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding database…');

  // ── Test Users ──────────────────────────────────────────────────────────────

  const testPassword = await bcrypt.hash('Test1234!', BCRYPT_ROUNDS);

  await prisma.user.upsert({
    where: { email: 'test@test.pl' },
    update: {},
    create: {
      email: 'test@test.pl',
      passwordHash: testPassword,
      firstName: 'Test',
      lastName: 'User',
      role: 'CUSTOMER',
      isEmailVerified: true,
    },
  });
  console.log('  ✔ test@test.pl / Test1234!');

  await prisma.user.upsert({
    where: { email: 'admin@test.pl' },
    update: {},
    create: {
      email: 'admin@test.pl',
      passwordHash: testPassword,
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      isEmailVerified: true,
    },
  });
  console.log('  ✔ admin@test.pl / Test1234!');

  // ── Categories ──────────────────────────────────────────────────────────────

  await prisma.category.updateMany({ where: { slug: 'perfumy' },   data: { slug: 'perfume' } });
  await prisma.category.updateMany({ where: { slug: 'dyfuzory' },  data: { slug: 'diffusers' } });
  await prisma.category.updateMany({ where: { slug: 'zele-pod-prysznic' }, data: { slug: 'gels' } });

  const [perfumes, perfumeLuxury, diffusers, bodyWash] = await Promise.all([
    prisma.category.upsert({
      where: { slug: 'perfume' },
      update: { name: 'Perfumy', description: 'Luksusowe perfumy dla kobiet i mężczyzn' },
      create: { name: 'Perfumy', slug: 'perfume', description: 'Luksusowe perfumy dla kobiet i mężczyzn' },
    }),
    prisma.category.upsert({
      where: { slug: 'perfume-luxury' },
      update: { name: 'Perfumy Luksusowe', description: 'Ekskluzywne esencje perfumowe o 30% stężeniu' },
      create: { name: 'Perfumy Luksusowe', slug: 'perfume-luxury', description: 'Ekskluzywne esencje perfumowe o 30% stężeniu' },
    }),
    prisma.category.upsert({
      where: { slug: 'diffusers' },
      update: { name: 'Dyfuzory i odświeżacze', description: 'Eleganckie odświeżacze powietrza do domu' },
      create: { name: 'Dyfuzory i odświeżacze', slug: 'diffusers', description: 'Eleganckie odświeżacze powietrza do domu' },
    }),
    prisma.category.upsert({
      where: { slug: 'gels' },
      update: { name: 'Żele i balsamy', description: 'Perfumowane żele pod prysznic i balsamy do ciała' },
      create: { name: 'Żele i balsamy', slug: 'gels', description: 'Perfumowane żele pod prysznic i balsamy do ciała' },
    }),
  ]);

  const categoryIdMap: Record<RawProduct['category'], string> = {
    perfume: perfumes.id,
    perfume_luxury: perfumeLuxury.id,
    shower_gel: bodyWash.id,
    diffuser: diffusers.id,
    air_freshener: diffusers.id,
  };

  console.log('  ✔ Categories ready');

  // ── Remove legacy mock products ───────────────────────────────────────────

  const legacySlugs = [
    // old dev mocks
    'noir-absolu', 'fleur-de-soleil', 'cedro-selvaggio',
    'dyfuzor-bois-de-santal', 'dyfuzor-lavande-provence',
    'zel-velvet-rose', 'zel-fresh-citrus',
    // Olfazeta placeholder products
    'olfazeta-unfold-men', 'olfazeta-velora-women', 'olfazeta-equilibre-unisex',
    'olfazeta-luxury-noble-men', 'olfazeta-luxury-rose-women', 'olfazeta-luxury-noir-unisex',
    'olfazeta-luxury-balm-unisex', 'olfazeta-gel-unisex', 'olfazeta-gel-men', 'olfazeta-gel-women',
    'cooperativa-scarlet-temptation', 'cooperativa-white-jasmine',
  ];
  const removed = await prisma.product.deleteMany({ where: { slug: { in: legacySlugs } } });
  if (removed.count > 0) console.log(`  ✔ Removed ${removed.count} legacy product(s)`);

  // ── Chogan / Cooperativa Perfumieri catalog ───────────────────────────────

  let created = 0;
  let skipped = 0;

  for (const p of productsData) {
    const slug = `${slugify(p.name)}-${p.base_code.toLowerCase()}`;

    const existing = await prisma.product.findUnique({ where: { slug } });
    if (existing) {
      skipped++;
      continue;
    }

    const images = p.variants
      .filter((v) => v.cdn_image)
      .map((v, i) => ({
        url: v.cdn_image!,
        storagePath: v.cdn_image!,
        altText: `${p.name} — ${v.size}`,
        sortOrder: i,
        isPrimary: i === 0,
      }));

    await prisma.product.create({
      data: {
        name: p.name,
        slug,
        description: p.description_full,
        shortDescription: shortDescription(p),
        categoryId: categoryIdMap[p.category],
        brand: BRAND_MAP[p.category],
        isFeatured: p.is_best_seller,
        notes: extractNotes(p.olfactory_pyramid),
        gender: GENDER_MAP[p.gender] ?? p.gender,
        variants: {
          create: p.variants.map((v) => ({
            sku: v.code,
            label: v.size,
            volume: parseVolume(v.size),
            priceInCents: v.price_pln * 100,
            stock: randomStock(),
          })),
        },
        ...(images.length > 0 && {
          images: { create: images },
        }),
      },
    });

    created++;
  }

  console.log(`  ✔ Products: ${created} created, ${skipped} already existed`);
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
