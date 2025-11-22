// Test script for email service
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

// Load .env first
config();

// Load sendgrid.env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sendgridEnvPath = path.join(__dirname, '..', 'sendgrid.env');

if (fs.existsSync(sendgridEnvPath)) {
  console.log('📄 Loading sendgrid.env from:', sendgridEnvPath);
  config({ path: sendgridEnvPath, override: true });
} else {
  console.warn('⚠️ sendgrid.env not found at:', sendgridEnvPath);
}

// Now import emailService after env is loaded
const emailServiceModule = await import('./services/emailService.js');
const emailService = emailServiceModule.default;

async function testEmail() {
  console.log('🧪 Testing Email Service...\n');
  
  // Check if SendGrid API key is set
  if (!process.env.SENDGRID_API_KEY) {
    console.error('❌ SENDGRID_API_KEY not found in environment variables');
    console.log('💡 Make sure sendgrid.env file exists with SENDGRID_API_KEY');
    process.exit(1);
  }
  
  console.log('✅ SENDGRID_API_KEY found:', process.env.SENDGRID_API_KEY.substring(0, 10) + '...');
  console.log('📧 FROM_EMAIL:', process.env.FROM_EMAIL || emailService.fromEmail);
  console.log('👤 FROM_NAME:', process.env.FROM_NAME || emailService.fromName);
  console.log('');
  
  // Test data - ПРОМЕНИ EMAIL АДРЕСА ТУК!
  const testEmail = process.env.TEST_EMAIL || 'indexAIze@gmail.com';
  
  const testStore = {
    _id: null, // Skip logging for test
    shop: 'test-shop.myshopify.com',
    email: testEmail,
    shopOwner: 'Test Owner',
    subscription: {
      plan: 'professional',
      trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days from now (TRIAL_DAYS)
      aiProviders: ['openai', 'claude'],
      productLimit: 500,
      usage: {
        productsOptimized: 10,
        aiQueries: 25
      }
    },
    analytics: {
      totalAIQueries: 50,
      aiQueryHistory: [
        { provider: 'openai' },
        { provider: 'claude' },
        { provider: 'openai' }
      ]
    }
  };
  
  console.log('📝 Test Store:', testStore.shop);
  console.log('📧 Test Email:', testStore.email);
  console.log('⚠️  Ако е "test@example.com", промени го в test-email.js или задай TEST_EMAIL env variable!\n');
  
  // Get email type from command line argument or default to welcome
  const emailType = process.argv[2] || 'welcome';
  
  console.log(`📨 Testing ${emailType} Email...`);
  try {
    let result;
    switch(emailType) {
      case 'welcome':
        result = await emailService.sendWelcomeEmail(testStore);
        break;
      case 'token-purchase':
        result = await emailService.sendTokenPurchaseEmail(testStore);
        break;
      default:
        console.log(`❌ Unknown email type: ${emailType}`);
        console.log('💡 Available types: welcome, token-purchase');
        process.exit(1);
    }
    
    if (result.success) {
      console.log(`✅ ${emailType} Email sent successfully!\n`);
    } else {
      console.log(`❌ ${emailType} Email failed:`, result.error, '\n');
    }
  } catch (error) {
    console.error(`❌ Error sending ${emailType} Email:`, error.message, '\n');
  }
  
  console.log('='.repeat(50));
  console.log('✅ Email testing completed!');
  console.log('='.repeat(50));
  console.log('\n💡 Next steps:');
  console.log('   1. Check your email inbox (and spam folder)');
  console.log('   2. Check SendGrid Activity: https://app.sendgrid.com/activity');
  console.log('   3. Verify the email was delivered successfully');
  console.log('\n⚠️  If email is not received:');
  console.log('   - Check spam folder');
  console.log('   - Verify sender email is authenticated in SendGrid');
  console.log('   - Check SendGrid Activity for delivery status');
}

testEmail().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

