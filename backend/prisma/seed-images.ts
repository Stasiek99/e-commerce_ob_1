import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

// Load .env from backend/ without requiring dotenv as a direct dependency
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

const BUCKET = 'product-images';
const PRODUCTS_DIR = path.join(__dirname, '../../products');

// Maps product slug → local image filename + alt text.
// Multiple entries per slug = multiple images (sortOrder follows array index).
const IMAGE_MAP: Record<string, Array<{ file: string; altText: string }>> = {
  // Regular perfumes — share the 70ml bottle photo
  'olfazeta-unfold-men':         [{ file: 'perfum_m_70.jpg', altText: 'Olfazeta Unfold — Perfumy dla mężczyzn' }],
  'olfazeta-velora-women':       [{ file: 'perfum_m_70.jpg', altText: 'Olfazeta Velora — Perfumy dla kobiet' }],
  'olfazeta-equilibre-unisex':   [{ file: 'perfum_m_70.jpg', altText: 'Olfazeta Équilibre — Perfumy Unisex' }],

  // Luxury line — share the luxury bottle photo
  'olfazeta-luxury-noble-men':   [{ file: 'perfum_luxury_blue.jpg', altText: 'Olfazeta Luxury Noble — Esencja Męska 30%' }],
  'olfazeta-luxury-rose-women':  [{ file: 'perfum_luxury_blue.jpg', altText: 'Olfazeta Luxury Rose — Esencja Damska 30%' }],
  'olfazeta-luxury-noir-unisex': [{ file: 'perfum_luxury_blue.jpg', altText: 'Olfazeta Luxury Noir — Esencja Unisex 30%' }],

  // Gels & balms
  'olfazeta-luxury-balm-unisex': [{ file: 'gel_unisex.webp', altText: 'Olfazeta Luxury Balsam do kąpieli Unisex' }],
  'olfazeta-gel-unisex':         [{ file: 'gel_unisex.webp', altText: 'Olfazeta Żel pod prysznic Unisex' }],
  'olfazeta-gel-men':            [{ file: 'gel.webp',  altText: 'Olfazeta Żel pod prysznic dla mężczyzn' }],
  'olfazeta-gel-women':          [{ file: 'gel_unisex.webp', altText: 'Olfazeta Żel pod prysznic dla kobiet' }],

  // Diffusers
  'cooperativa-scarlet-temptation': [{ file: 'dyfuzor.webp', altText: 'Cooperativa Perfumieri Scarlet Temptation' }],
  'cooperativa-white-jasmine':      [{ file: 'dyfuzor.webp', altText: 'Cooperativa Perfumieri White Jasmine' }],
};

function getMimeType(filename: string): string {
  if (/\.jpe?g$/i.test(filename)) return 'image/jpeg';
  if (/\.webp$/i.test(filename)) return 'image/webp';
  if (/\.png$/i.test(filename)) return 'image/png';
  return 'application/octet-stream';
}

const prisma = new PrismaClient();

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  console.log('Seeding product images…');

  for (const [slug, images] of Object.entries(IMAGE_MAP)) {
    const product = await prisma.product.findUnique({ where: { slug } });

    if (!product) {
      console.warn(`  ⚠  Product "${slug}" not found — run pnpm prisma:seed first`);
      continue;
    }

    const hasImages = await prisma.productImage.findFirst({ where: { productId: product.id } });
    if (hasImages) {
      console.log(`  ↩  "${slug}" already has images, skipping`);
      continue;
    }

    for (let i = 0; i < images.length; i++) {
      const { file, altText } = images[i];
      const filePath = path.join(PRODUCTS_DIR, file);

      if (!fs.existsSync(filePath)) {
        console.warn(`  ⚠  File not found: ${filePath}`);
        continue;
      }

      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(file).slice(1);
      const storagePath = `${product.id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, buffer, { contentType: getMimeType(file), upsert: false });

      if (uploadError) {
        console.error(`  ✗  Upload failed for "${slug}" (${file}): ${uploadError.message}`);
        continue;
      }

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

      await prisma.productImage.create({
        data: {
          productId: product.id,
          url: data.publicUrl,
          storagePath,
          altText,
          sortOrder: i,
          isPrimary: i === 0,
        },
      });

      console.log(`  ✔  "${slug}" — image uploaded`);
    }
  }

  console.log('Image seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
