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
  
  // Test data
  const testStore = {
    _id: null, // Skip logging for test
    shop: 'test-shop.myshopify.com',
    email: 'test@example.com', // ⚠️ CHANGE THIS to your real email for testing!
    shopOwner: 'Test Owner',
    subscription: {
      plan: 'professional',
      trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
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
  console.log('');
  
  // Test welcome email
  console.log('📨 Testing Welcome Email...');
  try {
    const result = await emailService.sendWelcomeEmail(testStore);
    if (result.success) {
      console.log('✅ Welcome email sent successfully!\n');
    } else {
      console.log('❌ Welcome email failed:', result.error, '\n');
    }
  } catch (error) {
    console.error('❌ Error sending welcome email:', error.message, '\n');
  }
  
  // Wait a bit between emails
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test onboarding email (day 1)
  console.log('📨 Testing Onboarding Email (Day 1)...');
  try {
    const result = await emailService.sendOnboardingEmail(testStore, 1);
    if (result.success) {
      console.log('✅ Onboarding email sent successfully!\n');
    } else {
      console.log('❌ Onboarding email failed:', result.error, '\n');
    }
  } catch (error) {
    console.error('❌ Error sending onboarding email:', error.message, '\n');
  }
  
  console.log('✅ Email testing completed!');
  console.log('💡 Check your email inbox (and spam folder) for the test emails.');
  console.log('💡 Make sure to verify your sender email in SendGrid first!');
}

testEmail().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

