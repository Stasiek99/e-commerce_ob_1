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

  await prisma.category.updateMany({ where: { slug: 'perfumy' }, data: { slug: 'perfume' } });
  await prisma.category.updateMany({ where: { slug: 'dyfuzory' }, data: { slug: 'diffusers' } });
  await prisma.category.updateMany({ where: { slug: 'zele-pod-prysznic' }, data: { slug: 'gels' } });

  const perfumes = await prisma.category.upsert({
    where: { slug: 'perfume' },
    update: { name: 'Perfumy', description: 'Luksusowe perfumy dla kobiet i mężczyzn' },
    create: {
      name: 'Perfumy',
      slug: 'perfume',
      description: 'Luksusowe perfumy dla kobiet i mężczyzn',
    },
  });

  const diffusers = await prisma.category.upsert({
    where: { slug: 'diffusers' },
    update: { name: 'Dyfuzory', description: 'Eleganckie odświeżacze powietrza do domu' },
    create: {
      name: 'Dyfuzory',
      slug: 'diffusers',
      description: 'Eleganckie odświeżacze powietrza do domu',
    },
  });

  const bodyWash = await prisma.category.upsert({
    where: { slug: 'gels' },
    update: { name: 'Żele i balsamy', description: 'Perfumowane żele pod prysznic i balsamy do ciała' },
    create: {
      name: 'Żele i balsamy',
      slug: 'gels',
      description: 'Perfumowane żele pod prysznic i balsamy do ciała',
    },
  });

  console.log('  ✔ Categories ready');

  // ── Cleanup old mock products ────────────────────────────────────────────────

  const legacySlugs = [
    'noir-absolu', 'fleur-de-soleil', 'cedro-selvaggio',
    'dyfuzor-bois-de-santal', 'dyfuzor-lavande-provence',
    'zel-velvet-rose', 'zel-fresh-citrus',
  ];
  const removed = await prisma.product.deleteMany({ where: { slug: { in: legacySlugs } } });
  if (removed.count > 0) console.log(`  ✔ Removed ${removed.count} legacy mock product(s)`);

  // ── Regular Line Perfumes (Olfazeta) ─────────────────────────────────────────

  await upsertProduct({
    name: 'Olfazeta Unfold — Perfumy dla mężczyzn',
    slug: 'olfazeta-unfold-men',
    description:
      'Wyrazisty, korzenny zapach otulony ciepłem cedru i ambry. Stworzony dla mężczyzn, którzy wiedzą, że najlepsza wizytówka to ten, który zostaje za nimi w pokoju. Wysoka koncentracja zapachowa gwarantuje trwałość przez cały dzień.',
    shortDescription: 'Intensywny zapach korzenny — cedr, ambra, piżmo',
    categoryId: perfumes.id,
    brand: 'Olfazeta',
    isFeatured: true,
    scentFamily: 'Korzenne',
    notes: ['cedr', 'bergamotka', 'piżmo', 'ambra', 'wanilia'],
    gender: 'męski',
    variants: [
      { sku: 'OLF-UNF-M-30', label: '30 ml', volume: 30, priceInCents: 8900, stock: 30 },
      { sku: 'OLF-UNF-M-70', label: '70 ml', volume: 70, priceInCents: 14900, stock: 20 },
    ],
  });

  await upsertProduct({
    name: 'Olfazeta Velora — Perfumy dla kobiet',
    slug: 'olfazeta-velora-women',
    description:
      'Delikatny, kwiatowy aromat inspirowany wiosennym ogrodem w pełnym rozkwicie. Połączenie świeżej róży, jaśminu i ciepłego białego piżma tworzy zmysłową harmonię, która pasuje na każdą okazję — od codziennej elegancji po wieczorny wyjazd.',
    shortDescription: 'Kwiatowy i zmysłowy zapach — róża, jaśmin, piżmo',
    categoryId: perfumes.id,
    brand: 'Olfazeta',
    isFeatured: true,
    scentFamily: 'Kwiatowe',
    notes: ['róża', 'jaśmin', 'fiołek', 'białe piżmo', 'paczuli'],
    gender: 'damski',
    variants: [
      { sku: 'OLF-VEL-W-30', label: '30 ml', volume: 30, priceInCents: 8900, stock: 25 },
      { sku: 'OLF-VEL-W-70', label: '70 ml', volume: 70, priceInCents: 14900, stock: 15 },
    ],
  });

  await upsertProduct({
    name: 'Olfazeta Équilibre — Perfumy Unisex',
    slug: 'olfazeta-equilibre-unisex',
    description:
      'Świeży, zrównoważony zapach dla osób ceniących elegancję ponad podziałami. Nuty cytrusowe w głowie ustępują akwatycznemu sercu, by zakończyć na ciepłej bazie drzewa sandałowego i ambry. Harmonijny i bezpłciowy w najpiękniejszym sensie.',
    shortDescription: 'Świeży i elegancki — bergamotka, nuty morskie, sandał',
    categoryId: perfumes.id,
    brand: 'Olfazeta',
    isFeatured: false,
    scentFamily: 'Świeże',
    notes: ['bergamotka', 'limonka', 'nuty morskie', 'drzewo sandałowe', 'ambra'],
    gender: 'unisex',
    variants: [
      { sku: 'OLF-EQL-U-30', label: '30 ml', volume: 30, priceInCents: 8900, stock: 25 },
      { sku: 'OLF-EQL-U-70', label: '70 ml', volume: 70, priceInCents: 14900, stock: 15 },
    ],
  });

  // ── Luxury Line (Olfazeta Luxury Esencja 30%) ─────────────────────────────────

  await upsertProduct({
    name: 'Olfazeta Luxury Noble — Esencja 30% Męska',
    slug: 'olfazeta-luxury-noble-men',
    description:
      'Esencja perfumowa o najwyższej, 30% koncentracji zapachowej. Ciemny, orientalny charakter zbudowany na oudzie, ambra i tytoniu. Dla mężczyzny, który stawia na głębię i niepowtarzalność — każda kropla wystarczy na cały dzień. Trwałość 12–16 godzin.',
    shortDescription: 'Luksusowa esencja 30% — oud, ambra, tytoń',
    categoryId: perfumes.id,
    brand: 'Olfazeta',
    isFeatured: true,
    scentFamily: 'Orientalne',
    notes: ['oud', 'ambra', 'cedr', 'tytoń', 'piżmo'],
    gender: 'męski',
    variants: [
      { sku: 'OLF-LUX-NM-50', label: '50 ml Esencja 30%', volume: 50, priceInCents: 19900, stock: 20 },
    ],
  });

  await upsertProduct({
    name: 'Olfazeta Luxury Rose — Esencja 30% Damska',
    slug: 'olfazeta-luxury-rose-women',
    description:
      'Ekstrawagancka esencja perfumowa o 30% stężeniu zapachowym. Bułgarska róża i jaśmin splecione z drzewem oud i ciepłą wanilią tworzą aromat, który zostaje w pamięci na długo. Kilka kropelek wystarczy — mniej znaczy więcej. Trwałość 12–16 godzin.',
    shortDescription: 'Luksusowa esencja 30% — róża bułgarska, oud, wanilia',
    categoryId: perfumes.id,
    brand: 'Olfazeta',
    isFeatured: true,
    scentFamily: 'Orientalne kwiatowe',
    notes: ['róża bułgarska', 'jaśmin', 'oud', 'wanilia', 'ambra'],
    gender: 'damski',
    variants: [
      { sku: 'OLF-LUX-RW-50', label: '50 ml Esencja 30%', volume: 50, priceInCents: 19900, stock: 18 },
    ],
  });

  await upsertProduct({
    name: 'Olfazeta Luxury Noir — Esencja 30% Unisex',
    slug: 'olfazeta-luxury-noir-unisex',
    description:
      'Ultraskoncentrowana esencja perfumowa 30% o mrocznym, głębokim charakterze. Oud w połączeniu z drzewem sandałowym i białym piżmem tworzy aromatyczne dzieło, które wykracza poza płeć i konwenanse. Trwałość 12–16 godzin.',
    shortDescription: 'Luksusowa esencja 30% — oud, sandał, piżmo',
    categoryId: perfumes.id,
    brand: 'Olfazeta',
    isFeatured: true,
    scentFamily: 'Orientalne',
    notes: ['oud', 'drzewo sandałowe', 'piżmo', 'ambra', 'bergamotka'],
    gender: 'unisex',
    variants: [
      { sku: 'OLF-LUX-NU-50', label: '50 ml Esencja 30%', volume: 50, priceInCents: 19900, stock: 15 },
    ],
  });

  // ── Shower Gels & Bath Balms (Olfazeta) ──────────────────────────────────────

  await upsertProduct({
    name: 'Olfazeta Luxury Balsam do kąpieli Unisex',
    slug: 'olfazeta-luxury-balm-unisex',
    description:
      'Luksusowy balsam do kąpieli z perfumowaną formułą unisex. Wzbogacony masłem shea i olejem arganowym — nawilża, wygładza i otula skórę delikatnym, trwałym zapachem. Idealne uzupełnienie codziennej pielęgnacji.',
    shortDescription: 'Perfumowany balsam do kąpieli z masłem shea i olejem arganowym',
    categoryId: bodyWash.id,
    brand: 'Olfazeta',
    isFeatured: false,
    scentFamily: 'Świeże',
    notes: ['bergamotka', 'cedr', 'piżmo', 'masło shea', 'olej arganowy'],
    gender: 'unisex',
    variants: [
      { sku: 'OLF-BAL-U-250', label: '250 ml', volume: 250, priceInCents: 4900, stock: 50 },
    ],
  });

  await upsertProduct({
    name: 'Olfazeta Żel pod prysznic Unisex',
    slug: 'olfazeta-gel-unisex',
    description:
      'Perfumowany żel pod prysznic w neutralnej, unisex wersji zapachowej. Formuła wzbogacona ekstraktem z aloesu nawilża skórę podczas każdej kąpieli. Świeży aromat morskich nut i cytrusów utrzymuje się przez wiele godzin po prysznicu.',
    shortDescription: 'Perfumowany żel pod prysznic — świeże nuty dla niej i dla niego',
    categoryId: bodyWash.id,
    brand: 'Olfazeta',
    isFeatured: false,
    scentFamily: 'Świeże',
    notes: ['cytrusy', 'nuty morskie', 'aloes', 'piżmo'],
    gender: 'unisex',
    variants: [
      { sku: 'OLF-GEL-U-250', label: '250 ml', volume: 250, priceInCents: 3900, stock: 60 },
    ],
  });

  await upsertProduct({
    name: 'Olfazeta Żel pod prysznic dla mężczyzn',
    slug: 'olfazeta-gel-men',
    description:
      'Energetyzujący żel pod prysznic z korzenno-drzewnymi nutami. Intensywnie oczyszcza skórę, pozostawiając świeżość i wyrazisty, maskulinowy zapach. Formuła z ekstraktem z drzewa herbacianego działa łagodząco na skórę po goleniu.',
    shortDescription: 'Korzenny żel pod prysznic — cedr, tytoń, drzewo herbaciane',
    categoryId: bodyWash.id,
    brand: 'Olfazeta',
    isFeatured: false,
    scentFamily: 'Korzenne',
    notes: ['cedr', 'tytoń', 'drzewo herbaciane', 'piżmo'],
    gender: 'męski',
    variants: [
      { sku: 'OLF-GEL-M-250', label: '250 ml', volume: 250, priceInCents: 3900, stock: 55 },
    ],
  });

  await upsertProduct({
    name: 'Olfazeta Żel pod prysznic dla kobiet',
    slug: 'olfazeta-gel-women',
    description:
      'Delikatny, kwiatowy żel pod prysznic stworzony z myślą o kobietach. Kremowa formuła z ekstraktem z orchidei i różanym olejkiem eterycznym zapewnia uczucie miękkości skóry i subtelny, kobiecy aromat przez długie godziny.',
    shortDescription: 'Kwiatowy żel pod prysznic — róża, orchidea, białe piżmo',
    categoryId: bodyWash.id,
    brand: 'Olfazeta',
    isFeatured: false,
    scentFamily: 'Kwiatowe',
    notes: ['róża', 'orchidea', 'jaśmin', 'białe piżmo'],
    gender: 'damski',
    variants: [
      { sku: 'OLF-GEL-W-250', label: '250 ml', volume: 250, priceInCents: 3900, stock: 50 },
    ],
  });

  // ── Diffusers (Cooperativa Perfumieri) ────────────────────────────────────────

  await upsertProduct({
    name: 'Cooperativa Perfumieri Scarlet Temptation — Odświeżacz powietrza',
    slug: 'cooperativa-scarlet-temptation',
    description:
      'Intensywny, zmysłowy odświeżacz powietrza o orientalnym charakterze. Nuty czerwonej wiśni i czarnej porzeczki w połączeniu z ciepłym drzewem sandałowym i piżmem wypełniają każde wnętrze tajemniczą, uwodzicielską aurą. Trwałość 10–12 tygodni.',
    shortDescription: 'Orientalny dyfuzor trzcinowy — czerwona wiśnia, sandał, piżmo',
    categoryId: diffusers.id,
    brand: 'Cooperativa Perfumieri',
    isFeatured: true,
    scentFamily: 'Orientalne',
    notes: ['czerwona wiśnia', 'czarna porzeczka', 'drzewo sandałowe', 'piżmo', 'ambra'],
    gender: null,
    variants: [
      { sku: 'CP-ST-100', label: '100 ml', volume: 100, priceInCents: 7900, stock: 30 },
      { sku: 'CP-ST-200', label: '200 ml', volume: 200, priceInCents: 12900, stock: 20 },
    ],
  });

  await upsertProduct({
    name: 'Cooperativa Perfumieri White Jasmine — Odświeżacz powietrza',
    slug: 'cooperativa-white-jasmine',
    description:
      'Elegancki odświeżacz powietrza o czystym, kwiatowym zapachu. Biały jaśmin z Toskanii, skomponowany z bergamotką i cedrowym drewnem, tworzy eteryczną, uspokajającą atmosferę. Idealny do salonu i sypialni. Trwałość 10–12 tygodni.',
    shortDescription: 'Kwiatowy dyfuzor trzcinowy — biały jaśmin, bergamotka, cedr',
    categoryId: diffusers.id,
    brand: 'Cooperativa Perfumieri',
    isFeatured: false,
    scentFamily: 'Kwiatowe',
    notes: ['biały jaśmin', 'bergamotka', 'cedr', 'piżmo'],
    gender: null,
    variants: [
      { sku: 'CP-WJ-100', label: '100 ml', volume: 100, priceInCents: 7900, stock: 25 },
      { sku: 'CP-WJ-200', label: '200 ml', volume: 200, priceInCents: 12900, stock: 15 },
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
  const existing = await prisma.product.findUnique({ where: { slug: input.slug } });

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
