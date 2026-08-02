import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import { BRAND_ABBREVIATIONS } from '../src/modules/products/search/brand-aliases';

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
  category: 'perfume' | 'perfume_luxury' | 'shower_gel' | 'diffuser';
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
  return p.description_full.split('.')[0].substring(0, 200);
}

const GENDER_MAP: Record<string, string> = { women: 'Kobieta', men: 'Mężczyzna', unisex: 'Unisex' };

const LINE_MAP: Partial<Record<RawProduct['category'], string>> = {
  perfume: 'Millesime',
  perfume_luxury: 'Luxury',
};

// ─── Luxury reference helpers ────────────────────────────────────────────────

// Shared with the query-side expander in src/modules/products/search — the seeder
// writes these into luxury_references.aliases (and therefore into the products
// search haystack), while search-query.util.ts expands them back at query time.
// One list so the two halves can never disagree about what "D&G" means.
const BRAND_ABBREVS = BRAND_ABBREVIATIONS;

function parseInspiration(str: string): { brand: string; name: string; aliases: string[] } {
  let brand = '';
  let name = str;

  const emDash = str.match(/^(.+?)\s+–\s+(.+)$/);
  if (emDash) {
    brand = emDash[1].trim();
    name = emDash[2].trim();
  } else {
    const hyphen = str.match(/^(.+?)\s+-\s+(.+)$/);
    if (hyphen) {
      brand = hyphen[1].trim();
      name = hyphen[2].trim();
    } else {
      const colon = str.match(/^(.+?):\s+(.+)$/);
      if (colon) {
        brand = colon[1].trim();
        name = colon[2].trim();
      } else {
        const by = str.match(/^(.+?)\s+by\s+(.+)$/i);
        if (by) {
          name = by[1].trim();
          brand = by[2].trim();
        }
      }
    }
  }

  // Strip trailing parenthetical garbage ("Burberry for Women (Burberry London" etc.)
  name = name.replace(/\s*\(.*$/, '').trim();

  const aliases = new Set<string>([str]);
  aliases.add(name);
  if (brand) {
    aliases.add(brand);                  // standalone brand → "Xerjoff" matches all Xerjoff products
    aliases.add(`${brand} ${name}`);
    for (const [fullBrand, abbrevs] of BRAND_ABBREVS) {
      if (brand.toLowerCase().includes(fullBrand.toLowerCase())) {
        for (const abbrev of abbrevs) {
          aliases.add(abbrev);           // standalone abbreviation → "YSL" matches all YSL products
          aliases.add(`${abbrev} ${name}`);
          aliases.add(`${abbrev} – ${name}`);
        }
      }
    }
  }

  return { brand, name, aliases: [...aliases].filter((a) => a.length <= 200) };
}

// ─── Manual olfactory classification by base_code ────────────────────────────
// Derived from known inspiration fragrances; takes priority over keyword analysis.
const SCENT_BY_CODE: Record<string, string> = {
  // AMBRA
  '006W': 'Ambra',   // YSL – Opium
  '010W': 'Ambra',   // Thierry Mugler – Alien
  '014W': 'Ambra',   // YSL – Manifesto
  '023W': 'Ambra',   // Dior – Hypnotic Poison
  '028W': 'Ambra',   // Thierry Mugler – Angel
  '033M': 'Ambra',   // Giorgio Armani – Code
  '040W': 'Ambra',   // Lancôme – Hypnôse
  '042W': 'Ambra',   // Lancôme – La Vie Est Belle
  '047W': 'Ambra',   // Versace – Crystal Noir
  '048M': 'Ambra',   // Chanel – Allure Homme
  '054U': 'Ambra',   // Tom Ford – Black Orchid
  '055W': 'Ambra',   // YSL – Black Opium
  '056W': 'Ambra',   // Givenchy – Ange ou Démon
  '062M': 'Ambra',   // D&G – Intenso
  '066M': 'Ambra',   // Hugo Boss – Baldessarini Ambré
  '067W': 'Ambra',   // Paco Rabanne – Olympéa
  '070W': 'Ambra',   // D&G – The One
  '071W': 'Ambra',   // Chanel – Allure
  '074M': 'Ambra',   // Nasomatto – Black Afgano
  '087M': 'Ambra',   // Azzaro – Wanted
  '088M': 'Ambra',   // Bvlgari – Man in Black
  '090W': 'Ambra',   // Dior – Poison Girl
  '100U': 'Ambra',   // Lancôme – Oud Bouquet
  '101U': 'Ambra',   // D&G – Velvet Amber Sun
  '102':  'Ambra',   // Giorgio Armani Privé – Ambre Eccentrico
  '001M': 'Ambra',   // Paco Rabanne – 1 Million
  '004M': 'Ambra',   // D&G – The One for Men
  '105U': 'Ambra',   // Montale – Intense Cafe
  '110U': 'Ambra',   // Tiziana Terenzi – Kirke
  '111U': 'Ambra',   // Tom Ford – Lost Cherry
  '114U': 'Ambra',   // Louis Vuitton – Ombre Nomade
  '117U': 'Ambra',   // Tom Ford – Tobacco Vanille
  '118U': 'Ambra',   // MFK – Baccarat Rouge 540
  '120W': 'Ambra',   // Guerlain – La Petite Robe Noire
  '122W': 'Ambra',   // YSL – Libre
  '124U': 'Ambra',   // Mora di Cartago (cocoa, amber, almond)
  '126':  'Ambra',   // Tom Ford – Soleil Blanc
  '127U': 'Ambra',   // Tom Ford – Oud Wood
  '128U': 'Ambra',   // Tom Ford – Vanille Fatale
  '129U': 'Ambra',   // Xerjoff – Erba Pura
  '134U': 'Ambra',   // Tom Ford – Bitter Peach
  '136M': 'Ambra',   // Dior – Homme Intense
  '137U': 'Ambra',   // Xerjoff – XJ 1861 Naxos
  '138':  'Ambra',   // Byredo – Bibliothèque
  '139':  'Ambra',   // Louis Vuitton – Ombre Nomade
  '141U': 'Ambra',   // The Spirit of Dubai – Shumuk
  '143U': 'Ambra',   // Kayali – Utopia Vanilla Coco
  '144U': 'Ambra',   // Bianco Latte (Giardini Di Toscana)
  '145W': 'Ambra',   // D&G – Devotion
  '146U': 'Ambra',   // Parfums de Marly – Valaya
  '148W': 'Ambra',   // Burberry – Goddess
  '157M': 'Ambra',   // Hugo Boss – The Scent
  '161W': 'Ambra',   // Valentino – Donna Born In Roma Intense
  '162M': 'Ambra',   // Valentino – Uomo Born In Roma Intense
  'ASTRAL24':  'Ambra',   // Estée Lauder – Dream Dusk
  'IMPERATRIX': 'Ambra',  // Tiziana Terenzi
  'MULTIVERSE': 'Ambra',  // Azzaro – The Most Wanted
  'EVENT23W':  'Ambra',   // Tiziana Terenzi – Cassiopea

  // AROMATYCZNY
  '002M': 'Aromatyczny', // Giorgio Armani – Acqua di Giò
  '012M': 'Aromatyczny', // Dior – Eau Sauvage
  '018M': 'Aromatyczny', // Cartier – Déclaration
  '031M': 'Aromatyczny', // Bvlgari – BLV Pour Homme
  '038M': 'Aromatyczny', // Bleu de Chanel
  '044U': 'Aromatyczny', // Creed – Silver Mountain Water
  '069M': 'Aromatyczny', // Profumum Roma – Acqua di Sale
  '073U': 'Aromatyczny', // Dior – Sauvage (EDP)
  '079M': 'Aromatyczny', // Prada – Luna Rossa Ocean
  '084M': 'Aromatyczny', // Versace – Dylan Blue Pour Homme
  '085W': 'Aromatyczny', // Sospiro – Accento (serendipity - floral-fruity, but aromatic base)
  '091M': 'Aromatyczny', // Azzaro – Chrome
  '094M': 'Aromatyczny', // Dior – Sauvage (EDT)
  '113M': 'Aromatyczny', // Dior – Sauvage
  '130U': 'Aromatyczny', // Orto Parisi – Megamare
  '140M': 'Aromatyczny', // Versace – Eros
  '150M': 'Aromatyczny', // Hugo Boss – Hugo Man
  '152M': 'Aromatyczny', // Gucci – Guilty Pour Homme
  '155U': 'Aromatyczny', // Calvin Klein – CK One
  '160M': 'Aromatyczny', // Burberry for Men
  '164M': 'Aromatyczny', // Prada L'Homme
  '015M': 'Aromatyczny', // Laura Biagiotti – Roma Per Uomo
  '020M': 'Aromatyczny', // YSL – La Nuit de l'Homme
  'NADIR':     'Aromatyczny', // Amouage – Reflection Man
  'EVENT23M':  'Aromatyczny', // Azzaro Wanted / Invictus / YSL Y

  // CHYPRE
  '019W': 'Chypre', // Paco Rabanne – Lady Million
  '039W': 'Chypre', // Miss Dior Cherie
  '051W': 'Chypre', // Chanel – Coco Mademoiselle
  '068M': 'Chypre', // Creed – Aventus
  '080W': 'Chypre', // Si by Giorgio Armani
  '163W': 'Chypre', // Dior – Miss Dior
  '147M': 'Chypre', // Gucci Guilty Absolute (leather chypre)

  // CYTRUSOWY
  '011W': 'Cytrusowy', // D&G – Light Blue
  '021M': 'Cytrusowy', // D&G – Light Blue Pour Homme
  '029W': 'Cytrusowy', // Issey Miyake – L'Eau d'Issey
  '060M': 'Cytrusowy', // Creed – Millésime Impérial
  '076W': 'Cytrusowy', // Giorgio Armani – Acqua di Gioia
  '099U': 'Cytrusowy', // Tom Ford – Mandarino di Amalfi
  '112':  'Cytrusowy', // Tom Ford – Neroli Portofino
  '125':  'Cytrusowy', // Tom Ford – Mandarino di Amalfi

  // KWIATOWY
  '007W': 'Kwiatowy', // Dior – J'adore
  '024W': 'Kwiatowy', // Chanel – No. 5
  '026W': 'Kwiatowy', // Kenzo – Flower by Kenzo
  '027W': 'Kwiatowy', // Lancôme – Trésor
  '030M': 'Kwiatowy', // Paco Rabanne – Black XS
  '049W': 'Kwiatowy', // D&G – Dolce
  '057W': 'Kwiatowy', // Bvlgari – Omnia Amethyste
  '064W': 'Kwiatowy', // Bvlgari – Omnia Indian Garnet
  '093W': 'Kwiatowy', // Creed – Aventus for Her
  '096W': 'Kwiatowy', // Chanel – Gabrielle
  '098W': 'Kwiatowy', // Dior – Joy by Dior
  '109W': 'Kwiatowy', // Dior – J'adore L'Or
  '115W': 'Kwiatowy', // Lancôme – Idôle
  '121W': 'Kwiatowy', // Givenchy – L'Interdit
  '123W': 'Kwiatowy', // Kilian Paris – Good Girl Gone Bad
  '131W': 'Kwiatowy', // Carolina Herrera – Good Girl
  '132W': 'Kwiatowy', // Giorgio Armani – My Way
  '133W': 'Kwiatowy', // Prada – Paradoxe
  '135U': 'Kwiatowy', // Dior – Bois d'Argent (iris)
  '151W': 'Kwiatowy', // Gucci – Guilty
  '153W': 'Kwiatowy', // Chloé – Chloé EDP
  '154W': 'Kwiatowy', // Chloé – Love
  '158W': 'Kwiatowy', // Flora by Gucci
  '159W': 'Kwiatowy', // Burberry for Women

  // FOUGÈRE
  '016M': 'Fougère', // Jean Paul Gaultier – Le Male
  '052M': 'Fougère', // Azzaro pour Homme
  '086M': 'Fougère', // Montblanc – Legend
  '108M': 'Fougère', // Creed – Green Irish Tweed

  // OWOCOWY
  '082W': 'Owocowy', // Salvatore Ferragamo – Signorina
  '089W': 'Owocowy', // YSL – Mon Paris
  '097W': 'Owocowy', // Salvatore Ferragamo – Amo Ferragamo
  '116W': 'Owocowy', // Cacharel – Yes I Am
  '119W': 'Owocowy', // Jean Paul Gaultier – Scandal
  '156W': 'Owocowy', // D&G – Anthologie L'Impératrice 3

  // SKÓRZANY
  '003M': 'Skórzany', // Dior – Fahrenheit
  '106':  'Skórzany', // Tom Ford – Fucking Fabulous
  '142U': 'Skórzany', // Tom Ford – Ombré Leather

  // PIŻMOWY
  '025W': 'Piżmowy', // Narciso Rodriguez – For Her
  '053W': 'Piżmowy', // Narciso Rodriguez – Narciso EDP
  '081W': 'Piżmowy', // Zadig & Voltaire – This Is Her!

  // KORZENNY
  '032M': 'Korzenny', // Viktor & Rolf – Spicebomb
  '078M': 'Korzenny', // Paco Rabanne – Ultraviolet Man
  '75':   'Korzenny', // Amouage – Interlude Man

  // DRZEWNY
  '022M': 'Drzewny', // Hermès – Terre d'Hermès
  '037M': 'Drzewny', // Bvlgari – Man Wood Essence
  '072U': 'Drzewny', // Byredo – Super Cedar (Earth Memory)

  // BSF (Luxury line duplicates — same inspiration as above)
  'BSF094': 'Aromatyczny', // Dior – Sauvage EDT
  'BSF068': 'Chypre',      // Creed – Aventus
  'BSF061': 'Aromatyczny', // Paco Rabanne – Invictus
  'BSF005': 'Aromatyczny', // Hugo Boss – Hugo Man
  'BSF002': 'Aromatyczny', // Giorgio Armani – Acqua di Giò
  'BSF001': 'Ambra',       // Paco Rabanne – 1 Million
  'BSF003': 'Skórzany',    // Dior – Fahrenheit
  'BSF033': 'Ambra',       // Giorgio Armani – Code
  'BSF080': 'Chypre',      // Si by Giorgio Armani
  'BSF121': 'Kwiatowy',    // Givenchy – L'Interdit
  'BSF119': 'Owocowy',     // Jean Paul Gaultier – Scandal
  'BSF042': 'Ambra',       // Lancôme – La Vie Est Belle
  'BSF023': 'Ambra',       // Dior – Hypnotic Poison
  'BSF019': 'Chypre',      // Paco Rabanne – Lady Million
  'BSF007': 'Kwiatowy',    // Dior – J'adore
  'BSF051': 'Chypre',      // Chanel – Coco Mademoiselle
  'BSF111': 'Ambra',       // Tom Ford – Lost Cherry
  'BSF118': 'Ambra',       // MFK – Baccarat Rouge 540
  'BSF010': 'Ambra',       // Thierry Mugler – Alien
  'BSF016': 'Fougère',     // Jean Paul Gaultier – Le Male
  'BSF105': 'Ambra',       // Montale – Intense Cafe
  'BSF020': 'Aromatyczny', // YSL – La Nuit de l'Homme
  'BSF055': 'Ambra',       // YSL – Black Opium
  'BSF129': 'Ambra',       // Xerjoff – Erba Pura
  'BSF130': 'Aromatyczny', // Orto Parisi – Megamare
  'BSF134': 'Ambra',       // Tom Ford – Bitter Peach
};

// Keyword-based fallback for products not in the manual map
const SCENT_RULES: Array<[string, RegExp]>[] = [
  // top-note rules (weight 1)
  [
    ['Cytrusowy',   /grejpfrut|cytryn[ay]|bergamotk[ai]|mandarynk[ai]|limonk[ai]/i],
    ['Owocowy',     /porzeczk|malin[ay]|brzoskwin|gruszk[ai]|jabłk|jagod[ay]|mango|morela|śliwk|figow|wiśni/i],
    ['Aromatyczny', /mięta|lawend[ay]|szałwi[ae]|rozmaryn|bazylia|estragon/i],
    ['Korzenny',    /pieprz|imbir|kardamon|cynamon|goździk|szafran/i],
  ],
  // heart-note rules (weight 2)
  [
    ['Kwiatowy',    /róż[ae]|jaśmin|frezj|konwali|kwiat|piwon|lili[ai]|irys|fiołk|ylang|gerani|neroli/i],
    ['Aromatyczny', /lawend[ay]|szałwi[ae]|rozmaryn/i],
    ['Korzenny',    /pieprz|imbir|gałk[ai] muszkato|kardamon/i],
    ['Owocowy',     /porzeczk|malin[ay]|brzoskwin|mango|morela|śliwk|figow|wiśni/i],
    ['Skórzany',    /skóra|skórzany|tytoń|dym/i],
  ],
  // base-note rules (weight 3)
  [
    ['Drzewny',     /cedr|sandalow|drzewo sandałowe|wetiwer|paczul|dąb|heban/i],
    ['Ambra',       /bursztyn|ambr[ay]|opoponaks|labdanum|benzoesan|żywic|wanilia.{0,20}drewn|ciepł/i],
    ['Piżmowy',     /piżm|musk/i],
    ['Skórzany',    /skóra|tytoń|dym/i],
    ['Korzenny',    /cynamon|goździk|gałk[ai] muszkato/i],
    ['Kwiatowy',    /róż[ae]|jaśmin|irys/i],
  ],
];

function inferScentFamily(pyramid?: RawProduct['olfactory_pyramid']): string | null {
  if (!pyramid) return null;
  const layers = [pyramid.top ?? '', pyramid.heart ?? '', pyramid.base ?? ''];
  const scores: Record<string, number> = {};
  const weights = [1, 2, 3];

  layers.forEach((layer, i) => {
    for (const [family, re] of SCENT_RULES[i]) {
      if (re.test(layer)) scores[family] = (scores[family] ?? 0) + weights[i];
    }
  });

  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);
  return sorted.length > 0 ? sorted[0][0] : null;
}

const BRAND_MAP: Record<RawProduct['category'], string> = {
  perfume: 'Chogan',
  perfume_luxury: 'Chogan',
  shower_gel: 'Chogan',
  diffuser: 'Cooperativa Perfumieri',
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

  const perfumes = await prisma.category.upsert({
    where: { slug: 'perfume' },
    update: { name: 'Perfumy', description: 'Luksusowe perfumy dla kobiet i mężczyzn' },
    create: { name: 'Perfumy', slug: 'perfume', description: 'Luksusowe perfumy dla kobiet i mężczyzn' },
  });

  const [perfumeLuxury, diffusers, bodyWash] = await Promise.all([
    prisma.category.upsert({
      where: { slug: 'perfume-luxury' },
      update: { name: 'Perfumy Luksusowe', description: 'Ekskluzywne esencje perfumowe o 30% stężeniu', parentId: perfumes.id },
      create: { name: 'Perfumy Luksusowe', slug: 'perfume-luxury', description: 'Ekskluzywne esencje perfumowe o 30% stężeniu', parentId: perfumes.id },
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

  // ── Luxury references ─────────────────────────────────────────────────────

  const luxRefMap = new Map<string, number>(); // inspiration string → LuxuryReference.id
  const uniqueInspirations = [
    ...new Set(productsData.map((p) => p.inspiration).filter(Boolean) as string[]),
  ];

  for (const insp of uniqueInspirations) {
    const { brand, name, aliases } = parseInspiration(insp);
    const ref = await prisma.luxuryReference.upsert({
      where: { brand_name: { brand, name } },
      update: { aliases },
      create: { brand, name, aliases },
    });
    luxRefMap.set(insp, ref.id);
  }

  console.log(`  ✔ LuxuryReferences: ${luxRefMap.size} upserted`);

  // ── Chogan / Cooperativa Perfumieri catalog ───────────────────────────────

  let created = 0;
  let skipped = 0;

  for (const p of productsData) {
    const slug = `${slugify(p.name)}-${p.base_code.toLowerCase()}`;

    const existing = await prisma.product.findUnique({ where: { slug } });
    if (existing) {
      await prisma.product.update({
        where: { slug },
        data: {
          gender: GENDER_MAP[p.gender] ?? p.gender,
          line: LINE_MAP[p.category] ?? null,
          inspiredBy: p.inspiration ?? null,
          luxuryReferenceId: p.inspiration ? (luxRefMap.get(p.inspiration) ?? null) : null,
          scentFamily: SCENT_BY_CODE[p.base_code] ?? inferScentFamily(p.olfactory_pyramid),
          sortOrder: p.is_best_seller ? 1 : 10,
          shortDescription: shortDescription(p),
          pyramidTop: p.olfactory_pyramid?.top ?? null,
          pyramidHeart: p.olfactory_pyramid?.heart ?? null,
          pyramidBase: p.olfactory_pyramid?.base ?? null,
        },
      });

      // Re-sync images
      const updatedImages = p.variants
        .filter((v) => v.cdn_image)
        .map((v, i) => ({
          productId: existing.id,
          url: v.cdn_image!,
          storagePath: v.cdn_image!,
          altText: `${p.name} — ${v.size}`,
          sortOrder: i,
          isPrimary: i === 0,
        }));
      await prisma.productImage.deleteMany({ where: { productId: existing.id } });
      if (updatedImages.length > 0) {
        await prisma.productImage.createMany({ data: updatedImages });
      }

      // Re-sync variant prices
      for (const v of p.variants) {
        await prisma.productVariant.updateMany({
          where: { sku: v.code, productId: existing.id },
          data: { priceInCents: v.price_pln * 100 },
        });
      }

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

    try {
      await prisma.product.create({
        data: {
          name: p.name,
          slug,
          description: p.description_full,
          shortDescription: shortDescription(p),
          categoryId: categoryIdMap[p.category],
          brand: BRAND_MAP[p.category],
          isFeatured: p.is_best_seller,
          sortOrder: p.is_best_seller ? 1 : 10,
          notes: extractNotes(p.olfactory_pyramid),
          allergens: [],
          pyramidTop: p.olfactory_pyramid?.top ?? null,
          pyramidHeart: p.olfactory_pyramid?.heart ?? null,
          pyramidBase: p.olfactory_pyramid?.base ?? null,
          gender: GENDER_MAP[p.gender] ?? p.gender,
          line: LINE_MAP[p.category] ?? null,
          inspiredBy: p.inspiration ?? null,
          luxuryReferenceId: p.inspiration ? (luxRefMap.get(p.inspiration) ?? null) : null,
          scentFamily: SCENT_BY_CODE[p.base_code] ?? inferScentFamily(p.olfactory_pyramid),
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
    } catch (err: any) {
      // SKU conflict: a product was renamed in products.json — its variants already exist
      // under the old slug. Find the owning product and update it to the new slug/data.
      if (err?.code === 'P2002' && err?.meta?.target?.includes('sku')) {
        const primarySku = p.variants[0]?.code;
        if (primarySku) {
          const orphan = await prisma.productVariant.findUnique({
            where: { sku: primarySku },
            select: { productId: true },
          });
          if (orphan) {
            await prisma.product.update({
              where: { id: orphan.productId },
              data: {
                name: p.name,
                slug,
                description: p.description_full,
                shortDescription: shortDescription(p),
                isFeatured: p.is_best_seller,
                sortOrder: p.is_best_seller ? 1 : 10,
                notes: extractNotes(p.olfactory_pyramid),
                pyramidTop: p.olfactory_pyramid?.top ?? null,
                pyramidHeart: p.olfactory_pyramid?.heart ?? null,
                pyramidBase: p.olfactory_pyramid?.base ?? null,
                gender: GENDER_MAP[p.gender] ?? p.gender,
                line: LINE_MAP[p.category] ?? null,
                inspiredBy: p.inspiration ?? null,
                scentFamily: SCENT_BY_CODE[p.base_code] ?? inferScentFamily(p.olfactory_pyramid),
              },
            });
            for (const v of p.variants) {
              await prisma.productVariant.updateMany({
                where: { sku: v.code, productId: orphan.productId },
                data: { priceInCents: v.price_pln * 100 },
              });
            }
            skipped++;
          }
        }
      } else {
        throw err;
      }
    }
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
