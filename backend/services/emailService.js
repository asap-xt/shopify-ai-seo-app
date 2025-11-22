// backend/services/emailService.js
// Email service using SendGrid for transactional and marketing emails

import sgMail from '@sendgrid/mail';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  console.warn('⚠️ SENDGRID_API_KEY not set - email service will not work');
}

class EmailService {
  constructor() {
    this.fromEmail = process.env.FROM_EMAIL || 'noreply@aiseo2.app';
    this.fromName = process.env.FROM_NAME || 'indexAIze Team';
    
    // Load logo as base64 for email templates
    this.logoBase64 = this.loadLogoBase64();
  }
  
  loadLogoBase64() {
    try {
      const logoPath = path.join(__dirname, '..', 'assets', 'logo', 'Logo_60x60.png');
      if (fs.existsSync(logoPath)) {
        const logoBuffer = fs.readFileSync(logoPath);
        return logoBuffer.toString('base64');
      }
    } catch (error) {
      console.warn('⚠️ Could not load logo for emails:', error.message);
    }
    return null;
  }

  /**
   * Send welcome email on app installation
   */
  async sendWelcomeEmail(store) {
    if (!process.env.SENDGRID_API_KEY) {
      console.warn('⚠️ SendGrid not configured - skipping welcome email');
      return { success: false, error: 'SendGrid not configured' };
    }

    try {
      // Check if welcome email was already sent (avoid duplicates)
      if (store._id || store.id) {
        const EmailLog = (await import('../db/EmailLog.js')).default;
        const existingLog = await EmailLog.findOne({
          storeId: store._id || store.id,
          type: 'welcome',
          status: 'sent'
        });
        
        if (existingLog) {
          console.log(`ℹ️ Welcome email already sent to ${store.shop}, skipping duplicate`);
          return { success: true, skipped: true, reason: 'already_sent' };
        }
      }

      // Import plans module to get real plan features
      const { getPlanConfig } = await import('../plans.js');
      
      const shopName = store.shop?.replace('.myshopify.com', '') || store.shop || 'there';
      const subscription = store.subscription || {};
      const planKey = subscription.plan || 'starter';
      
      // Get real plan configuration
      const planConfig = getPlanConfig(planKey);
      const planName = planConfig?.name || planKey;
      
      // Calculate trial days
      const trialDays = this.calculateTrialDays(subscription.trialEndsAt || subscription.expiresAt);
      
      // Format providers nicely
      const providers = planConfig?.providersAllowed || [];
      const providersDisplay = providers.length > 0 
        ? providers.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')
        : 'Not specified';
      
      // Use SendGrid attachment with Content-ID for inline image (works in all email clients including Gmail)
      const logoPath = path.join(__dirname, '..', 'assets', 'logo', 'Logo_120x120.png');
      const attachments = [];
      
      if (fs.existsSync(logoPath)) {
        const logoContent = fs.readFileSync(logoPath);
        attachments.push({
          content: logoContent.toString('base64'),
          filename: 'logo.png',
          type: 'image/png',
          disposition: 'inline',
          content_id: 'logo' // SendGrid uses content_id (not contentId)
        });
      }
      
      // Check if plan has included tokens (Growth Extra, Enterprise)
      const { getIncludedTokens } = await import('../billing/tokenConfig.js');
      const includedTokens = getIncludedTokens(planKey);
      const hasIncludedTokens = includedTokens.tokens > 0;
      
      const msg = {
        to: store.email || store.shopOwner || `${shopName}@example.com`,
        from: { email: this.fromEmail, name: this.fromName },
        subject: `Welcome to indexAIze - Unlock AI Search`,
        html: this.getWelcomeEmailTemplate({
          shopName,
          shopUrl: `https://${store.shop}`,
          dashboardUrl: this.getDashboardUrl(store.shop),
          planName,
          planKey,
          trialDays,
          logoUrl: 'cid:logo', // Use Content-ID reference for inline attachment
          planFeatures: await this.getPlanFeatures(planKey), // Get real plan features instead of technical limits
          hasIncludedTokens // Flag to show/hide token purchase recommendation
        }),
        attachments: attachments
      };

      await sgMail.send(msg);
      console.log(`✅ Welcome email sent to: ${store.shop}`);
      
      // Log email activity
      await this.logEmail(store._id || store.id, store.shop, 'welcome', 'sent');
      
      return { success: true };
    } catch (error) {
      console.error('❌ Welcome email error:', error);
      await this.logEmail(store._id || store.id, store.shop, 'welcome', 'failed', error.message);
      return { success: false, error: error.message };
    }
  }
  
  formatAutosyncFrequency(cron) {
    if (!cron) return 'Not available';
    // Parse cron: "0 */48 * * *" = every 48 hours
    const parts = cron.split(' ');
    if (parts[1]?.startsWith('*/')) {
      const hours = parts[1].replace('*/', '');
      return `Every ${hours} hours`;
    }
    if (parts[0]?.startsWith('*/')) {
      const days = parts[0].replace('*/', '');
      return `Every ${days} days`;
    }
    return 'Custom schedule';
  }
  
  async getPlanFeatures(planKey) {
    // Import getPlanFeatures from billingRoutes
    try {
      const { getPlanFeatures } = await import('../billing/billingRoutes.js');
      return getPlanFeatures(planKey) || [];
    } catch (error) {
      console.warn('⚠️ Could not load plan features:', error.message);
      return [];
    }
  }

  /**
   * Send onboarding sequence (Day 1, 3, 7)
   */
  async sendOnboardingEmail(store, day) {
    if (!process.env.SENDGRID_API_KEY) {
      console.warn('⚠️ SendGrid not configured - skipping onboarding email');
      return { success: false, error: 'SendGrid not configured' };
    }

    const content = {
      1: {
        subject: '🚀 Let\'s optimize your first products!',
        tips: [
          'Sync your products from Shopify',
          'Choose your preferred AI provider',
          'Run your first SEO optimization'
        ]
      },
      3: {
        subject: '📊 Check your SEO improvements',
        tips: [
          'View your analytics dashboard',
          'See which products are optimized',
          'Compare AI provider results'
        ]
      },
      7: {
        subject: '🎯 Maximize your AI SEO results',
        tips: [
          'Enable auto-sync for continuous optimization',
          'Try bulk operations for faster results',
          'Upgrade for unlimited AI queries'
        ]
      }
    };

    const dayContent = content[day];
    if (!dayContent) {
      return { success: false, error: 'Invalid day' };
    }

    try {
      const shopName = store.shop?.replace('.myshopify.com', '') || store.shop || 'there';
      const subscription = store.subscription || {};
      
      const msg = {
        to: store.email || `${shopName}@example.com`,
        from: { email: this.fromEmail, name: this.fromName },
        subject: dayContent.subject,
        html: this.getOnboardingEmailTemplate({
          shopName,
          day,
          tips: dayContent.tips,
          dashboardUrl: this.getDashboardUrl(store.shop),
          productsOptimized: subscription.usage?.productsOptimized || 0,
          aiQueriesUsed: subscription.usage?.aiQueries || 0
        })
      };

      await sgMail.send(msg);
      console.log(`✅ Day ${day} onboarding email sent: ${store.shop}`);
      await this.logEmail(store._id || store.id, store.shop, `onboarding-day${day}`, 'sent');
      return { success: true };
    } catch (error) {
      console.error(`❌ Day ${day} onboarding error:`, error);
      await this.logEmail(store._id || store.id, store.shop, `onboarding-day${day}`, 'failed', error.message);
      return { success: false };
    }
  }

  /**
   * Trial expiring reminder
   */
  async sendTrialExpiringEmail(store, daysLeft) {
    if (!process.env.SENDGRID_API_KEY) {
      console.warn('⚠️ SendGrid not configured - skipping trial expiring email');
      return { success: false, error: 'SendGrid not configured' };
    }

    try {
      const shopName = store.shop?.replace('.myshopify.com', '') || store.shop || 'there';
      const subscription = store.subscription || {};
      
      const msg = {
        to: store.email || `${shopName}@example.com`,
        from: { email: this.fromEmail, name: this.fromName },
        subject: `⏰ Your trial expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''}!`,
        html: this.getTrialExpiringEmailTemplate({
          shopName,
          daysLeft,
          productsOptimized: subscription.usage?.productsOptimized || 0,
          upgradeUrl: `${process.env.APP_URL || process.env.BASE_URL || process.env.SHOPIFY_APP_URL || ''}/billing?shop=${store.shop}`,
          stats: {
            totalOptimizations: store.analytics?.totalAIQueries || 0,
            topProvider: this.getTopProvider(store.analytics?.aiQueryHistory || [])
          }
        })
      };

      await sgMail.send(msg);
      console.log(`✅ Trial expiring email sent (${daysLeft} days): ${store.shop}`);
      await this.logEmail(store._id || store.id, store.shop, 'trial-expiring', 'sent');
      return { success: true };
    } catch (error) {
      console.error('❌ Trial expiring email error:', error);
      return { success: false };
    }
  }

  /**
   * Uninstall follow-up email
   */
  async sendUninstallFollowupEmail(store, reason = null) {
    if (!process.env.SENDGRID_API_KEY) {
      console.warn('⚠️ SendGrid not configured - skipping uninstall follow-up email');
      return { success: false, error: 'SendGrid not configured' };
    }

    try {
      const shopName = store.shop?.replace('.myshopify.com', '') || store.shop || 'there';
      
      const msg = {
        to: store.email || `${shopName}@example.com`,
        from: { email: this.fromEmail, name: this.fromName },
        subject: 'We\'d love your feedback!',
        html: this.getUninstallFollowupEmailTemplate({
          shopName,
          uninstallReason: reason,
          feedbackUrl: `${process.env.APP_URL || process.env.BASE_URL || process.env.SHOPIFY_APP_URL || ''}/feedback?shop=${store.shop}`,
          reinstallUrl: `${process.env.APP_URL || process.env.BASE_URL || process.env.SHOPIFY_APP_URL || ''}/?shop=${store.shop}`,
          supportEmail: process.env.SUPPORT_EMAIL || 'support@aiseo2.app'
        })
      };

      await sgMail.send(msg);
      console.log(`✅ Uninstall follow-up sent: ${store.shop}`);
      await this.logEmail(store._id || store.id, store.shop, 'uninstall-followup', 'sent');
      return { success: true };
    } catch (error) {
      console.error('❌ Uninstall follow-up error:', error);
      return { success: false };
    }
  }

  /**
   * Weekly digest email
   */
  async sendWeeklyDigest(store, stats) {
    if (!process.env.SENDGRID_API_KEY) {
      console.warn('⚠️ SendGrid not configured - skipping weekly digest');
      return { success: false, error: 'SendGrid not configured' };
    }

    try {
      const shopName = store.shop?.replace('.myshopify.com', '') || store.shop || 'there';
      
      const msg = {
        to: store.email || `${shopName}@example.com`,
        from: { email: this.fromEmail, name: this.fromName },
        subject: '📊 Your weekly SEO report',
        html: this.getWeeklyDigestEmailTemplate({
          shopName,
          weeklyStats: {
            productsOptimized: stats.productsOptimized || 0,
            aiQueriesUsed: stats.aiQueries || 0,
            topProducts: stats.topProducts || [],
            improvement: stats.seoImprovement || '0%'
          },
          dashboardUrl: this.getDashboardUrl(store.shop),
          tips: this.getWeeklyTips(stats)
        })
      };

      await sgMail.send(msg);
      console.log(`✅ Weekly digest sent: ${store.shop}`);
      await this.logEmail(store._id || store.id, store.shop, 'weekly-digest', 'sent');
      return { success: true };
    } catch (error) {
      console.error('❌ Weekly digest error:', error);
      return { success: false };
    }
  }

  /**
   * Upgrade success email
   */
  async sendUpgradeSuccessEmail(store, newPlan) {
    if (!process.env.SENDGRID_API_KEY) {
      console.warn('⚠️ SendGrid not configured - skipping upgrade success email');
      return { success: false, error: 'SendGrid not configured' };
    }

    try {
      const shopName = store.shop?.replace('.myshopify.com', '') || store.shop || 'there';
      const subscription = store.subscription || {};
      
      const msg = {
        to: store.email || `${shopName}@example.com`,
        from: { email: this.fromEmail, name: this.fromName },
        subject: '🎉 Upgrade successful!',
        html: this.getUpgradeSuccessEmailTemplate({
          shopName,
          oldPlan: subscription.previousPlan || 'starter',
          newPlan: newPlan,
          newFeatures: await this.getPlanFeatures(newPlan),
          dashboardUrl: this.getDashboardUrl(store.shop)
        })
      };

      await sgMail.send(msg);
      console.log(`✅ Upgrade success email sent: ${store.shop}`);
      await this.logEmail(store._id || store.id, store.shop, 'upgrade-success', 'sent');
      return { success: true };
    } catch (error) {
      console.error('❌ Upgrade success error:', error);
      return { success: false };
    }
  }

  /**
   * Re-engagement email (inactive users)
   */
  async sendReengagementEmail(store, daysSinceLastActive) {
    if (!process.env.SENDGRID_API_KEY) {
      console.warn('⚠️ SendGrid not configured - skipping re-engagement email');
      return { success: false, error: 'SendGrid not configured' };
    }

    try {
      const shopName = store.shop?.replace('.myshopify.com', '') || store.shop || 'there';
      
      const msg = {
        to: store.email || `${shopName}@example.com`,
        from: { email: this.fromEmail, name: this.fromName },
        subject: 'We miss you! 🎁',
        html: this.getReengagementEmailTemplate({
          shopName,
          daysSinceActive: daysSinceLastActive,
          incentive: '50% off next month if you upgrade this week!',
          dashboardUrl: this.getDashboardUrl(store.shop),
          supportUrl: `${this.getDashboardUrl(store.shop).replace('/dashboard?shop=' + store.shop, '')}/support`
        })
      };

      await sgMail.send(msg);
      console.log(`✅ Re-engagement email sent: ${store.shop}`);
      await this.logEmail(store._id || store.id, store.shop, 'reengagement', 'sent');
      return { success: true };
    } catch (error) {
      console.error('❌ Re-engagement error:', error);
      return { success: false };
    }
  }

  /**
   * Helper methods
   */
  calculateTrialDays(expiresAt) {
    if (!expiresAt) return 0;
    const now = new Date();
    const diff = new Date(expiresAt) - now;
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  getDashboardUrl(shop) {
    // Get APP_URL from environment - required, no fallback
    const appUrl = process.env.APP_URL || process.env.BASE_URL || process.env.SHOPIFY_APP_URL;
    if (!appUrl) {
      console.warn('⚠️ APP_URL not set in environment variables');
      return `https://app.indexaize.com/dashboard?shop=${shop}`; // Fallback to production domain
    }
    // Remove trailing slash if present
    const baseUrl = appUrl.replace(/\/$/, '');
    return `${baseUrl}/dashboard?shop=${shop}`;
  }

  getTopProvider(aiQueryHistory) {
    if (!aiQueryHistory || aiQueryHistory.length === 0) return 'claude';
    const counts = {};
    aiQueryHistory.forEach(q => {
      counts[q.provider] = (counts[q.provider] || 0) + 1;
    });
    return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
  }


  getWeeklyTips(stats) {
    const tips = [
      'Try different AI providers to compare results',
      'Enable auto-sync for continuous optimization',
      'Check your analytics for performance insights'
    ];
    
    if (stats.aiQueries < 10) {
      tips.push('You have unused AI queries - optimize more products!');
    }
    
    return tips;
  }

  async logEmail(storeId, shop, type, status, error = null) {
    try {
      // Skip logging if storeId is null (for testing)
      if (!storeId) {
        return;
      }
      
      const EmailLog = (await import('../db/EmailLog.js')).default;
      await EmailLog.create({
        storeId,
        shop,
        type,
        status,
        error,
        recipient: null, // Can be added if needed
        sentAt: new Date()
      });
    } catch (err) {
      console.error('Failed to log email:', err);
    }
  }

  // Email templates
  getWelcomeEmailTemplate(data) {
    const planConfig = data.planConfig || {};
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to indexAIze - Unlock AI Search</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
        <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
          <tr>
            <td align="center" style="padding: 40px 20px;">
              <table role="presentation" style="max-width: 600px; width: 100%; background-color: #ffffff; border-collapse: collapse; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <!-- Header -->
                <tr>
                  <td style="padding: 40px 40px; background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%);">
                    <table role="presentation" style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <!-- Logo (Left) -->
                        <td style="width: auto; vertical-align: middle; padding-right: 25px;">
                          ${data.logoUrl ? `<img src="${data.logoUrl}" alt="indexAIze Logo" style="width: 120px; height: 120px; display: block; border: none; outline: none; background: transparent; border-radius: 12px;" />` : `<div style="width: 120px; height: 120px; background-color: rgba(255,255,255,0.2); border-radius: 12px;"></div>`}
                        </td>
                        <!-- Text (Center) -->
                        <td style="text-align: left; vertical-align: middle; padding-left: 0;">
                          <p style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 600; letter-spacing: 0.5px; line-height: 1.3;">Unlock AI Search</p>
                        </td>
                        <!-- Spacer (Right) -->
                        <td style="width: auto;"></td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <!-- Main Content -->
                <tr>
                  <td style="padding: 40px 40px 30px;">
                    <p style="margin: 0 0 20px; color: #1a1a1a; font-size: 16px; line-height: 1.6;">Hello ${data.shopName},</p>
                    
                    <p style="margin: 0 0 30px; color: #4a4a4a; font-size: 15px; line-height: 1.6;">
                      Thank you for installing indexAIze. Your store is now configured to optimize product discovery through AI search engines including ChatGPT, Gemini, Perplexity, and others.
                    </p>
                    
                    <!-- Plan Details -->
                    <div style="background-color: #f0f7ff; border-left: 4px solid #2563eb; padding: 20px; margin: 30px 0;">
                      <h3 style="margin: 0 0 15px; color: #1e40af; font-size: 16px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Your Plan: ${data.planName}</h3>
                      
                      ${data.planFeatures && data.planFeatures.length > 0 ? `
                      <ul style="margin: 0; padding-left: 20px; color: #4a4a4a; font-size: 14px; line-height: 1.8;">
                        ${data.planFeatures.map(feature => `<li style="margin-bottom: 8px;">${feature.replace(/^[✓🔓]/g, '').trim()}</li>`).join('')}
                      </ul>
                      ` : `
                      <p style="margin: 0; color: #4a4a4a; font-size: 14px;">Plan features are being configured.</p>
                      `}
                      
                      ${data.trialDays > 0 ? `
                      <p style="margin: 15px 0 0; color: #1e40af; font-size: 13px; padding-top: 10px; border-top: 1px solid #dbeafe;">
                        Trial period: <strong style="color: #1e40af;">${data.trialDays} day${data.trialDays !== 1 ? 's' : ''} remaining</strong>
                      </p>
                      ` : ''}
                    </div>
                    
                    ${!data.hasIncludedTokens ? `
                    <!-- Token Purchase Recommendation -->
                    <div style="background-color: #fff7ed; border-left: 4px solid #f59e0b; padding: 20px; margin: 30px 0;">
                      <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.6;">
                        <strong style="color: #b45309;">Unlock AI-Enhanced Features:</strong> Purchase tokens to access AI-enhanced product optimization, advanced schema data, and other premium features. Visit your dashboard to buy tokens and enhance your store's AI capabilities.
                      </p>
                    </div>
                    ` : ''}
                    
                    <!-- Quick Tips -->
                    <div style="margin: 30px 0;">
                      <h3 style="margin: 0 0 15px; color: #1e40af; font-size: 16px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Quick Start Tips</h3>
                      <ul style="margin: 0; padding-left: 20px; color: #4a4a4a; font-size: 14px; line-height: 1.8;">
                        <li>Enable products.json endpoint for AI bot discovery</li>
                        <li>Configure your preferred AI provider in Settings</li>
                        <li>Run your first optimization to generate structured data</li>
                        <li>Monitor analytics to track AI query performance</li>
                      </ul>
                    </div>
                    
                    <!-- CTA Button -->
                    <div style="text-align: center; margin: 35px 0;">
                      <a href="${data.dashboardUrl}" style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; font-size: 15px; font-weight: 600; border-radius: 4px; letter-spacing: 0.3px; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.3);">
                        Open Dashboard
                      </a>
                    </div>
                    
                    <p style="margin: 30px 0 0; color: #8a8a8a; font-size: 13px; line-height: 1.6;">
                      Need assistance? Reply to this email.
                    </p>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="padding: 30px 40px; background-color: #f0f7ff; border-top: 1px solid #dbeafe; text-align: center;">
                    <p style="margin: 0; color: #64748b; font-size: 12px; line-height: 1.6;">
                      <strong style="color: #1e40af;">indexAIze Team</strong>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
  }

  getOnboardingEmailTemplate(data) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>${data.subject}</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #667eea; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
          <h2 style="color: white; margin: 0;">${data.subject}</h2>
        </div>
        
        <div style="padding: 30px; background: #f8f9fa; border-radius: 0 0 8px 8px;">
          <p>Hi ${data.shopName}! 👋</p>
          
          <p>Here are some tips to help you get the most out of AI SEO 2.0:</p>
          
          <ul>
            ${data.tips.map(tip => `<li>${tip}</li>`).join('')}
          </ul>
          
          <div style="background: #e8f4f8; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <strong>Your Progress:</strong><br>
            Products Optimized: ${data.productsOptimized}<br>
            AI Queries Used: ${data.aiQueriesUsed}
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.dashboardUrl}" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block;">
              Continue Optimizing
            </a>
          </div>
          
          <p>Happy optimizing! 🎉<br>The AI SEO 2.0 Team</p>
        </div>
      </body>
      </html>
    `;
  }

  getTrialExpiringEmailTemplate(data) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Trial Expiring Soon</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #ff6b6b; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
          <h2 style="color: white; margin: 0;">⏰ Your trial expires in ${data.daysLeft} day${data.daysLeft > 1 ? 's' : ''}!</h2>
        </div>
        
        <div style="padding: 30px; background: #f8f9fa; border-radius: 0 0 8px 8px;">
          <p>Hi ${data.shopName}! 👋</p>
          
          <p>Your trial period is ending soon. Don't lose access to your optimized products!</p>
          
          <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <strong>Your Stats:</strong><br>
            Products Optimized: ${data.productsOptimized}<br>
            Total Optimizations: ${data.stats.totalOptimizations}<br>
            Top Provider: ${data.stats.topProvider}
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.upgradeUrl}" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-size: 18px;">
              Upgrade Now
            </a>
          </div>
          
          <p>Questions? Reply to this email!</p>
        </div>
      </body>
      </html>
    `;
  }

  getUninstallFollowupEmailTemplate(data) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>We'd love your feedback</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="padding: 30px; background: #f8f9fa; border-radius: 8px;">
          <p>Hi ${data.shopName}! 👋</p>
          
          <p>We noticed you uninstalled AI SEO 2.0. We'd love to hear why so we can improve!</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.feedbackUrl}" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block;">
              Share Feedback
            </a>
          </div>
          
          <p>Or if you'd like to give us another try:</p>
          
          <div style="text-align: center; margin: 20px 0;">
            <a href="${data.reinstallUrl}" style="background: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block;">
              Reinstall App
            </a>
          </div>
          
          <p>Questions? Email us at <a href="mailto:${data.supportEmail}">${data.supportEmail}</a></p>
        </div>
      </body>
      </html>
    `;
  }

  getWeeklyDigestEmailTemplate(data) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Weekly SEO Report</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #667eea; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
          <h2 style="color: white; margin: 0;">📊 Your Weekly SEO Report</h2>
        </div>
        
        <div style="padding: 30px; background: #f8f9fa; border-radius: 0 0 8px 8px;">
          <p>Hi ${data.shopName}! 👋</p>
          
          <h3>This Week's Stats:</h3>
          <ul>
            <li>Products Optimized: <strong>${data.weeklyStats.productsOptimized}</strong></li>
            <li>AI Queries Used: <strong>${data.weeklyStats.aiQueriesUsed}</strong></li>
            <li>SEO Improvement: <strong>${data.weeklyStats.improvement}</strong></li>
          </ul>
          
          <h3>Tips for This Week:</h3>
          <ul>
            ${data.tips.map(tip => `<li>${tip}</li>`).join('')}
          </ul>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.dashboardUrl}" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block;">
              View Dashboard
            </a>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  getUpgradeSuccessEmailTemplate(data) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Upgrade Successful</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #28a745; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
          <h2 style="color: white; margin: 0;">🎉 Upgrade Successful!</h2>
        </div>
        
        <div style="padding: 30px; background: #f8f9fa; border-radius: 0 0 8px 8px;">
          <p>Hi ${data.shopName}! 👋</p>
          
          <p>Congratulations! You've successfully upgraded from <strong>${data.oldPlan}</strong> to <strong>${data.newPlan}</strong>.</p>
          
          <h3>Your New Features:</h3>
          <ul>
            ${data.newFeatures.map(feature => `<li>${feature}</li>`).join('')}
          </ul>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.dashboardUrl}" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block;">
              Start Using New Features
            </a>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  getReengagementEmailTemplate(data) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>We miss you!</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="padding: 30px; background: #f8f9fa; border-radius: 8px;">
          <p>Hi ${data.shopName}! 👋</p>
          
          <p>We haven't seen you in ${data.daysSinceActive} days. We miss you!</p>
          
          <p><strong>Special Offer:</strong> ${data.incentive}</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.dashboardUrl}" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block;">
              Return to Dashboard
            </a>
          </div>
          
          <p>Need help? <a href="${data.supportUrl}">Contact Support</a></p>
        </div>
      </body>
      </html>
    `;
  }
}

export default new EmailService();

