import { PrismaClient } from '@prisma/client';
import { Resend } from 'resend';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

async function main() {
  console.log('🧪 Testing Resend email integration...\n');

  // 1. Create test user
  console.log('1️⃣  Creating test user...');
  const uniqueEmail = `test-${Date.now()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email: uniqueEmail,
      passwordHash: await bcrypt.hash('Test123456', 12),
      role: 'CUSTOMER',
    },
  });
  console.log(`   ✓ User created: ${user.email}\n`);

  // 2. Create test category
  console.log('2️⃣  Creating test category...');
  const category = await prisma.category.create({
    data: {
      name: 'Test Category',
      slug: `test-cat-${Date.now()}`,
      description: 'Test category for Resend verification',
    },
  });
  console.log(`   ✓ Category created: ${category.name}\n`);

  // 3. Create test address
  console.log('3️⃣  Creating test address...');
  const address = await prisma.address.create({
    data: {
      userId: user.id,
      firstName: 'Test',
      lastName: 'User',
      street: 'ul. Testowa 123',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'PL',
      phone: '+48123456789',
      isDefault: true,
    },
  });
  console.log(`   ✓ Address created: ${address.street}\n`);

  // 4. Create test product
  console.log('4️⃣  Creating test product...');
  const product = await prisma.product.create({
    data: {
      name: 'Test Fragrance',
      slug: `test-frag-${Date.now()}`,
      description: 'A test perfume for Resend email verification',
      shortDescription: 'Test scent',
      categoryId: category.id,
      brand: 'TestBrand',
      gender: 'UNISEX',
    },
  });
  console.log(`   ✓ Product created: ${product.name}\n`);

  // 5. Create product variant
  console.log('5️⃣  Creating product variant...');
  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      sku: 'TEST-100ML',
      volume: 100,
      label: '100 ml',
      priceInCents: 24999, // 249.99 PLN
      stock: 100,
    },
  });
  console.log(`   ✓ Variant created: ${variant.label} @ ${(variant.priceInCents / 100).toFixed(2)} zł\n`);

  // 6. Create order
  console.log('6️⃣  Creating test order...');
  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-${Date.now()}`,
      userId: user.id,
      status: 'PENDING_PAYMENT',
      addressId: address.id,
      snapshotFirstName: address.firstName,
      snapshotLastName: address.lastName,
      snapshotEmail: user.email,
      snapshotPhone: address.phone,
      snapshotStreet: address.street,
      snapshotCity: address.city,
      snapshotPostalCode: address.postalCode,
      snapshotCountry: address.country,
      carrierCode: 'INPOST',
      itemsTotalInCents: variant.priceInCents,
      shippingCostInCents: 0,
      discountInCents: 0,
      totalInCents: variant.priceInCents,
      items: {
        create: {
          productVariantId: variant.id,
          snapshotName: product.name,
          snapshotSku: variant.sku,
          snapshotPrice: variant.priceInCents,
          quantity: 1,
        },
      },
    },
  });
  console.log(`   ✓ Order created: ${order.orderNumber}\n`);

  // 7. Send test email via Resend
  console.log('7️⃣  Sending order confirmation email via Resend...');
  const emailData = {
    from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
    to: user.email,
    subject: `Potwierdzenie zamówienia #${order.orderNumber}`,
    html: `
      <h1>Dziękujemy za Twoje zamówienie!</h1>
      <p>Numer zamówienia: <strong>${order.orderNumber}</strong></p>
      <p>Email: ${user.email}</p>
      <h2>Produkty:</h2>
      <ul>
        <li>${product.name} (1x) - ${(variant.priceInCents / 100).toFixed(2)} zł</li>
      </ul>
      <p><strong>Razem: ${(order.totalInCents / 100).toFixed(2)} zł</strong></p>
    `,
  };

  try {
    const response = await resend.emails.send(emailData);
    console.log('   ✓ Email sent successfully!');
    console.log(`   📧 Response ID: ${response.data?.id}\n`);

    console.log('✅ SUCCESS! Email sent to Resend.\n');
    console.log('📝 Next steps:');
    console.log(`   1. Go to https://resend.com/emails`);
    console.log(`   2. Look for email sent to: ${user.email}`);
    console.log(`   3. Check your inbox at: ${user.email}`);
    console.log(`\n⏱️  Emails usually arrive within 10 seconds.\n`);
  } catch (error) {
    console.error('   ❌ Failed to send email:', error);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
