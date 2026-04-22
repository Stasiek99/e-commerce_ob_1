import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;

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
  console.log('  ✔ Test user: test@test.pl / Test1234!');

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
  console.log('  ✔ Admin user: admin@test.pl / Test1234!');

  // ── Categories ──────────────────────────────────────────────────────────────

  // Migrate old slugs to new English slugs if they exist in DB
  await prisma.category.updateMany({ where: { slug: 'perfumy' }, data: { slug: 'perfume' } });
  await prisma.category.updateMany({ where: { slug: 'dyfuzory' }, data: { slug: 'diffusers' } });
  await prisma.category.updateMany({ where: { slug: 'zele-pod-prysznic' }, data: { slug: 'gels' } });

  const perfumes = await prisma.category.upsert({
    where: { slug: 'perfume' },
    update: {},
    create: {
      name: 'Perfumy',
      slug: 'perfume',
      description: 'Luksusowe perfumy dla kobiet i mężczyzn',
    },
  });

  const diffusers = await prisma.category.upsert({
    where: { slug: 'diffusers' },
    update: {},
    create: {
      name: 'Dyfuzory',
      slug: 'diffusers',
      description: 'Eleganckie dyfuzory zapachowe do domu',
    },
  });

  const bodyWash = await prisma.category.upsert({
    where: { slug: 'gels' },
    update: {},
    create: {
      name: 'Żele pod prysznic',
      slug: 'gels',
      description: 'Perfumowane żele pod prysznic',
    },
  });

  // ── Products + Variants ─────────────────────────────────────────────────────

  // --- Perfume 1 ---
  await upsertProduct({
    name: 'Noir Absolu',
    slug: 'noir-absolu',
    description:
      'Głęboki, orientalny zapach z nutami ambrowego drewna, wetiweru i czarnej wanilii. Elegancja zamknięta w flakonie.',
    shortDescription: 'Orientalny aromat — ambra, wetiwer, wanilia',
    categoryId: perfumes.id,
    brand: 'Maison Aura',
    isFeatured: true,
    scentFamily: 'Orientalne',
    notes: ['ambra', 'wetywer', 'czarna wanilia', 'piżmo'],
    gender: 'unisex',
    variants: [
      { sku: 'NA-EDP-30', label: '30 ml EDP', volume: 30, priceInCents: 14900, stock: 25 },
      { sku: 'NA-EDP-50', label: '50 ml EDP', volume: 50, priceInCents: 22900, stock: 15 },
      { sku: 'NA-EDP-100', label: '100 ml EDP', volume: 100, priceInCents: 34900, stock: 10 },
    ],
  });

  // --- Perfume 2 ---
  await upsertProduct({
    name: 'Fleur de Soleil',
    slug: 'fleur-de-soleil',
    description:
      'Promienisty, kwiatowy zapach inspirowany południem Francji. Nuty neroli, jaśminu i białego piżma.',
    shortDescription: 'Kwiatowy — neroli, jaśmin, białe piżmo',
    categoryId: perfumes.id,
    brand: 'Maison Aura',
    isFeatured: true,
    scentFamily: 'Kwiatowe',
    notes: ['neroli', 'jaśmin', 'białe piżmo', 'bergamotka'],
    gender: 'damski',
    variants: [
      { sku: 'FS-EDP-30', label: '30 ml EDP', volume: 30, priceInCents: 12900, stock: 30 },
      { sku: 'FS-EDP-50', label: '50 ml EDP', volume: 50, priceInCents: 19900, stock: 20 },
    ],
  });

  // --- Perfume 3 ---
  await upsertProduct({
    name: 'Cedro Selvaggio',
    slug: 'cedro-selvaggio',
    description:
      'Intensywny, drzewny zapach z dominantą cedru, paczuli i skóry. Dla mężczyzn, którzy cenią charakter.',
    shortDescription: 'Drzewny — cedr, paczuli, skóra',
    categoryId: perfumes.id,
    brand: 'Maison Aura',
    isFeatured: false,
    scentFamily: 'Drzewne',
    notes: ['cedr', 'paczuli', 'skóra', 'szałwia'],
    gender: 'męski',
    variants: [
      { sku: 'CS-EDP-50', label: '50 ml EDP', volume: 50, priceInCents: 21900, stock: 18 },
      { sku: 'CS-EDP-100', label: '100 ml EDP', volume: 100, priceInCents: 32900, stock: 8 },
    ],
  });

  // --- Diffuser 1 ---
  await upsertProduct({
    name: 'Dyfuzor — Bois de Santal',
    slug: 'dyfuzor-bois-de-santal',
    description:
      'Naturalny dyfuzor trzcinowy o ciepłym, drzewnym zapachu drzewa sandałowego. Wypełnia wnętrze na 8-10 tygodni.',
    shortDescription: 'Drzewo sandałowe — dyfuzor trzcinowy',
    categoryId: diffusers.id,
    brand: 'Maison Aura',
    isFeatured: true,
    scentFamily: 'Drzewne',
    notes: ['drzewo sandałowe', 'cedr', 'wanilia'],
    gender: null,
    variants: [
      { sku: 'DBS-150', label: '150 ml', volume: 150, priceInCents: 8900, stock: 40 },
      { sku: 'DBS-300', label: '300 ml', volume: 300, priceInCents: 14900, stock: 20 },
    ],
  });

  // --- Diffuser 2 ---
  await upsertProduct({
    name: 'Dyfuzor — Lavande Provence',
    slug: 'dyfuzor-lavande-provence',
    description:
      'Relaksujący dyfuzor z olejkiem lawendowym z Prowansji. Idealny do sypialni i łazienki.',
    shortDescription: 'Lawenda prowansalska — dyfuzor trzcinowy',
    categoryId: diffusers.id,
    brand: 'Maison Aura',
    isFeatured: false,
    scentFamily: 'Ziołowe',
    notes: ['lawenda', 'eukaliptus', 'mięta'],
    gender: null,
    variants: [
      { sku: 'DLP-150', label: '150 ml', volume: 150, priceInCents: 7900, stock: 35 },
    ],
  });

  // --- Body Wash 1 ---
  await upsertProduct({
    name: 'Żel pod prysznic — Velvet Rose',
    slug: 'zel-velvet-rose',
    description:
      'Delikatny żel pod prysznic z olejkiem różanym i masłem shea. Nawilża skórę i otula zmysłowym zapachem.',
    shortDescription: 'Olejek różany + masło shea',
    categoryId: bodyWash.id,
    brand: 'Maison Aura',
    isFeatured: false,
    scentFamily: 'Kwiatowe',
    notes: ['róża', 'masło shea', 'białe piżmo'],
    gender: 'damski',
    variants: [
      { sku: 'VR-GEL-250', label: '250 ml', volume: 250, priceInCents: 3900, stock: 50 },
      { sku: 'VR-GEL-500', label: '500 ml', volume: 500, priceInCents: 5900, stock: 30 },
    ],
  });

  // --- Body Wash 2 ---
  await upsertProduct({
    name: 'Żel pod prysznic — Fresh Citrus',
    slug: 'zel-fresh-citrus',
    description:
      'Energetyzujący żel z nutami grejpfruta, limonki i zielonej herbaty. Pobudza zmysły każdego ranka.',
    shortDescription: 'Grejpfrut, limonka, zielona herbata',
    categoryId: bodyWash.id,
    brand: 'Maison Aura',
    isFeatured: false,
    scentFamily: 'Cytrusowe',
    notes: ['grejpfrut', 'limonka', 'zielona herbata', 'mięta'],
    gender: 'unisex',
    variants: [
      { sku: 'FC-GEL-250', label: '250 ml', volume: 250, priceInCents: 3900, stock: 45 },
      { sku: 'FC-GEL-500', label: '500 ml', volume: 500, priceInCents: 5900, stock: 25 },
    ],
  });

  console.log('Seed complete.');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

interface VariantInput {
  sku: string;
  label: string;
  volume: number;
  priceInCents: number;
  stock: number;
}

interface ProductInput {
  name: string;
  slug: string;
  description: string;
  shortDescription: string;
  categoryId: string;
  brand: string;
  isFeatured: boolean;
  scentFamily: string;
  notes: string[];
  gender: string | null;
  variants: VariantInput[];
}

async function upsertProduct(input: ProductInput) {
  const existing = await prisma.product.findUnique({
    where: { slug: input.slug },
  });

  if (existing) {
    console.log(`  ↩ Product "${input.name}" already exists, skipping`);
    return;
  }

  await prisma.product.create({
    data: {
      name: input.name,
      slug: input.slug,
      description: input.description,
      shortDescription: input.shortDescription,
      categoryId: input.categoryId,
      brand: input.brand,
      isFeatured: input.isFeatured,
      scentFamily: input.scentFamily,
      notes: input.notes,
      gender: input.gender,
      variants: {
        create: input.variants.map((v) => ({
          sku: v.sku,
          label: v.label,
          volume: v.volume,
          priceInCents: v.priceInCents,
          stock: v.stock,
        })),
      },
    },
  });

  console.log(`  ✔ Created "${input.name}" with ${input.variants.length} variant(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
