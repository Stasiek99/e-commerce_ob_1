import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// EC Regulation 1223/2009 Art. 13 — every cosmetic product must identify its
// Responsible Person. We act as RP for the whole catalog, so this is a single
// name shared across all products — same SELLER_NAME / fallback InvoiceService
// uses for the VAT invoice "SPRZEDAWCA" block (invoice.service.ts), so the two
// never drift apart.
const RESPONSIBLE_PERSON_NAME = process.env.SELLER_NAME || 'Aromaterie';

async function main() {
  const result = await prisma.product.updateMany({
    where: { responsiblePersonName: null },
    data: { responsiblePersonName: RESPONSIBLE_PERSON_NAME },
  });

  console.log(`Set responsiblePersonName="${RESPONSIBLE_PERSON_NAME}" on ${result.count} product(s).`);
}

if (require.main === module) {
  main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
