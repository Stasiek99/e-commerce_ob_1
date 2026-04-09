import { Resend } from 'resend';

// Your actual API key from .env
const apiKey = 're_V6DBRUqR_nba5vzeSgbxQHgJshieg92aM';
const resend = new Resend(apiKey);

async function main() {
  console.log('\n🧪 Testing Resend email integration...\n');
  console.log('📧 Email Configuration:');
  console.log(`   FROM: ${process.env.EMAIL_FROM || 'onboarding@resend.dev'}`);
  console.log(`   API Key: ${process.env.RESEND_API_KEY ? '✓ Set' : '✗ Missing'}\n`);

  // Simulate an order confirmation email
  const testOrder = {
    orderNumber: `TEST-${Date.now()}`,
    customerEmail: 'stasiekpilich@gmail.com',  // Use YOUR email in sandbox mode
    customerName: 'Test User',
    items: [
      {
        name: 'Test Fragrance - 100ml',
        quantity: 1,
        price: 249.99,
      },
    ],
    total: 249.99,
  };

  const emailData = {
    from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
    to: testOrder.customerEmail,
    subject: `Potwierdzenie zamówienia #${testOrder.orderNumber}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #1a1a1a; color: white; padding: 20px; border-radius: 8px; }
          .content { padding: 20px 0; }
          .order-number { font-size: 24px; font-weight: bold; color: #c9a96e; }
          .item { border-bottom: 1px solid #eee; padding: 10px 0; }
          .total { font-size: 18px; font-weight: bold; color: #1a1a1a; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Dziękujemy za Twoje zamówienie!</h1>
            <p class="order-number">Numer zamówienia: ${testOrder.orderNumber}</p>
          </div>

          <div class="content">
            <p>Cześć ${testOrder.customerName},</p>
            <p>Twoje zamówienie zostało przyjęte. Poniżej znajduje się podsumowanie.</p>

            <h2>Produkty:</h2>
            ${testOrder.items.map(item => `
              <div class="item">
                <p><strong>${item.name}</strong></p>
                <p>Ilość: ${item.quantity} × ${item.price.toFixed(2)} zł</p>
              </div>
            `).join('')}

            <div class="total">
              Razem do zapłaty: ${testOrder.total.toFixed(2)} zł
            </div>

            <p style="margin-top: 30px; color: #666; font-size: 12px;">
              Email: ${testOrder.customerEmail}<br>
              Wysłane: ${new Date().toLocaleString('pl-PL')}
            </p>
          </div>
        </div>
      </body>
      </html>
    `,
  };

  console.log('📨 Sending test email...');
  console.log(`   To: ${testOrder.customerEmail}`);
  console.log(`   Order: ${testOrder.orderNumber}\n`);

  try {
    const response = await resend.emails.send(emailData);

    if (response.error) {
      console.error('❌ ERROR:', response.error.message);
      console.log('\n⚠️  Possible issues:');
      console.log('   1. Invalid API key in RESEND_API_KEY');
      console.log('   2. Invalid sender email (must be onboarding@resend.dev or your verified domain)');
      console.log('   3. Network issues connecting to Resend API');
      process.exit(1);
    }

    console.log('✅ SUCCESS! Email sent to Resend\n');
    console.log('📊 Response:');
    console.log(`   ID: ${response.data?.id}`);
    console.log(`   Status: Queued for delivery\n`);

    console.log('📝 Next steps:');
    console.log('   1. Check your inbox at: test@example.com');
    console.log('   2. Go to Resend dashboard: https://resend.com/emails');
    console.log('   3. Look for the email in the "Emails" tab');
    console.log('   4. Emails usually arrive within 10 seconds\n');

    console.log('💡 What you should see:');
    console.log(`   - Sender: ${process.env.EMAIL_FROM || 'onboarding@resend.dev'}`);
    console.log(`   - Subject: Potwierdzenie zamówienia #${testOrder.orderNumber}`);
    console.log(`   - Contains order details for ${testOrder.total.toFixed(2)} zł\n`);

  } catch (error) {
    console.error('❌ Failed to send email:', error);
    process.exit(1);
  }
}

main();
