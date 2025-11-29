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
          shop: store.shop,
          email: store.email,
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
   * Send token purchase email (Day 3 after installation)
   * Only sent if: no purchased tokens AND plan is not Growth Extra/Enterprise
   */
  async sendTokenPurchaseEmail(store) {
    if (!process.env.SENDGRID_API_KEY) {
      console.warn('⚠️ SendGrid not configured - skipping token purchase email');
      return { success: false, error: 'SendGrid not configured' };
    }

    try {
      // Check if email was already sent (avoid duplicates)
      if (store._id || store.id) {
        const EmailLog = (await import('../db/EmailLog.js')).default;
        const existingLog = await EmailLog.findOne({
          storeId: store._id || store.id,
          type: 'token-purchase',
          status: 'sent'
        });
        
        if (existingLog) {
          console.log(`ℹ️ Token purchase email already sent to ${store.shop}, skipping duplicate`);
          return { success: true, skipped: true, reason: 'already_sent' };
        }
      }

      const subscription = store.subscription || {};
      const planKey = subscription.plan || 'starter';
      
      // Fetch shop name and email from Shopify API
      let shopName = store.shop?.replace('.myshopify.com', '') || store.shop || 'there';
      let shopEmail = store.email || store.shopOwner;
      
      if (store.shop && store.accessToken) {
        try {
          const shopQuery = `
            query {
              shop {
                name
                email
              }
            }
          `;
          const shopResponse = await fetch(`https://${store.shop}/admin/api/2025-07/graphql.json`, {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': store.accessToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: shopQuery }),
          });
          
          if (shopResponse.ok) {
            const shopData = await shopResponse.json();
            if (shopData.data?.shop?.name) {
              shopName = shopData.data.shop.name;
            }
            if (shopData.data?.shop?.email) {
              shopEmail = shopData.data.shop.email;
            }
          }
        } catch (shopFetchError) {
          console.warn('[EMAIL] Could not fetch shop name:', shopFetchError.message);
        }
      }
      
      // Get plan features
      const planFeatures = await this.getPlanFeatures(planKey);
      const planName = subscription.plan || 'Starter';
      
      // Use SendGrid attachment with Content-ID for inline image
      const logoPath = path.join(__dirname, '..', 'assets', 'logo', 'Logo_120x120.png');
      const attachments = [];
      
      if (fs.existsSync(logoPath)) {
        const logoContent = fs.readFileSync(logoPath);
        attachments.push({
          content: logoContent.toString('base64'),
          filename: 'logo.png',
          type: 'image/png',
          disposition: 'inline',
          content_id: 'logo'
        });
      }
      
      const msg = {
        to: shopEmail || `${shopName}@example.com`,
        from: { email: this.fromEmail, name: this.fromName },
        subject: 'Unlock AI-Enhanced Features with Tokens',
        html: this.getTokenPurchaseEmailTemplate({
          shopName,
          shop: store.shop,
          email: store.email,
          planName,
          planKey,
          planFeatures,
          billingUrl: this.getBillingUrl(store.shop),
          logoUrl: 'cid:logo'
        }),
        attachments: attachments
      };

      await sgMail.send(msg);
      console.log(`✅ Token purchase email sent: ${store.shop}`);
      await this.logEmail(store._id || store.id, store.shop, 'token-purchase', 'sent');
      return { success: true };
    } catch (error) {
      console.error('❌ Token purchase email error:', error);
      await this.logEmail(store._id || store.id, store.shop, 'token-purchase', 'failed', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send App Store rating email (Day 6 after installation)
   * Only sent if: subscription is active (after trial)
   */
  async sendAppStoreRatingEmail(store) {
    if (!process.env.SENDGRID_API_KEY) {
      console.warn('⚠️ SendGrid not configured - skipping app store rating email');
      return { success: false, error: 'SendGrid not configured' };
    }

    try {
      // Check if email was already sent (avoid duplicates)
      if (store._id || store.id) {
        const EmailLog = (await import('../db/EmailLog.js')).default;
        const existingLog = await EmailLog.findOne({
          storeId: store._id || store.id,
          type: 'appstore-rating',
          status: 'sent'
        });
        
        if (existingLog) {
          console.log(`ℹ️ App Store rating email already sent to ${store.shop}, skipping duplicate`);
          return { success: true, skipped: true, reason: 'already_sent' };
        }
      }

      // Fetch shop name and email from Shopify API
      let shopName = store.shop?.replace('.myshopify.com', '') || store.shop || 'there';
      let shopEmail = store.email || store.shopOwner;
      
      if (store.shop && store.accessToken) {
        try {
          const shopQuery = `
            query {
              shop {
                name
                email
              }
            }
          `;
          const shopResponse = await fetch(`https://${store.shop}/admin/api/2025-07/graphql.json`, {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': store.accessToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: shopQuery }),
          });
          
          if (shopResponse.ok) {
            const shopData = await shopResponse.json();
            if (shopData.data?.shop?.name) {
              shopName = shopData.data.shop.name;
            }
            if (shopData.data?.shop?.email) {
              shopEmail = shopData.data.shop.email;
            }
          }
        } catch (shopFetchError) {
          console.warn('[EMAIL] Could not fetch shop name:', shopFetchError.message);
        }
      }
      
      // App Store URL - placeholder until app is approved
      const appStoreUrl = process.env.SHOPIFY_APP_STORE_URL || 'https://apps.shopify.com/indexaize';
      
      // Use SendGrid attachment with Content-ID for inline image
      const logoPath = path.join(__dirname, '..', 'assets', 'logo', 'Logo_120x120.png');
      const attachments = [];
      
      if (fs.existsSync(logoPath)) {
        const logoContent = fs.readFileSync(logoPath);
        attachments.push({
          content: logoContent.toString('base64'),
          filename: 'logo.png',
          type: 'image/png',
          disposition: 'inline',
          content_id: 'logo'
        });
      }
      
      const msg = {
        to: shopEmail || `${shopName}@example.com`,
        from: { email: this.fromEmail, name: this.fromName },
        subject: 'Finding indexAIze useful? Rate us in App Store',
        html: this.getAppStoreRatingEmailTemplate({
          shopName,
          shop: store.shop,
          email: shopEmail,
          appStoreUrl,
          logoUrl: 'cid:logo'
        }),
        attachments: attachments
      };

      await sgMail.send(msg);
      console.log(`✅ App Store rating email sent: ${store.shop}`);
      await this.logEmail(store._id || store.id, store.shop, 'appstore-rating', 'sent');
      return { success: true };
    } catch (error) {
      console.error('❌ App Store rating email error:', error);
      await this.logEmail(store._id || store.id, store.shop, 'appstore-rating', 'failed', error.message);
      return { success: false, error: error.message };
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
          shop: store.shop,
          email: store.email,
          daysLeft,
          productsOptimized: subscription.usage?.productsOptimized || 0,
          upgradeUrl: this.getBillingUrl(store.shop),
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
          shop: store.shop,
          email: store.email,
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
          shop: store.shop,
          email: store.email,
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
          shop: store.shop,
          email: store.email,
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
          shop: store.shop,
          email: store.email,
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
    let baseUrl = appUrl.replace(/\/$/, '');
    // Force HTTPS if not present
    if (!baseUrl.startsWith('https://') && !baseUrl.startsWith('http://')) {
      baseUrl = `https://${baseUrl}`;
    } else if (baseUrl.startsWith('http://')) {
      baseUrl = baseUrl.replace('http://', 'https://');
    }
    return `${baseUrl}/dashboard?shop=${shop}`;
  }

  getBillingUrl(shop) {
    // Use same logic as getDashboardUrl() - app URL with shop query parameter
    // Get APP_URL from environment - required, no fallback
    const appUrl = process.env.APP_URL || process.env.BASE_URL || process.env.SHOPIFY_APP_URL;
    if (!appUrl) {
      console.warn('⚠️ APP_URL not set in environment variables');
      return `https://app.indexaize.com/billing?shop=${shop}`; // Fallback to production domain
    }
    // Remove trailing slash if present
    let baseUrl = appUrl.replace(/\/$/, '');
    // Force HTTPS if not present
    if (!baseUrl.startsWith('https://') && !baseUrl.startsWith('http://')) {
      baseUrl = `https://${baseUrl}`;
    } else if (baseUrl.startsWith('http://')) {
      baseUrl = baseUrl.replace('http://', 'https://');
    }
    return `${baseUrl}/billing?shop=${shop}`;
  }

  getUnsubscribeUrl(shop, email) {
    // Generate unsubscribe URL with shop and email parameters
    const appUrl = process.env.APP_URL || process.env.BASE_URL || process.env.SHOPIFY_APP_URL;
    let baseUrl = appUrl ? appUrl.replace(/\/$/, '') : 'https://app.indexaize.com';
    
    // Force HTTPS if not present
    if (!baseUrl.startsWith('https://') && !baseUrl.startsWith('http://')) {
      baseUrl = `https://${baseUrl}`;
    } else if (baseUrl.startsWith('http://')) {
      baseUrl = baseUrl.replace('http://', 'https://');
    }
    
    // Encode email for URL safety
    const encodedEmail = encodeURIComponent(email || '');
    return `${baseUrl}/api/email/unsubscribe?shop=${shop}&email=${encodedEmail}`;
  }

  getUnsubscribeFooter(shop, email) {
    const unsubscribeUrl = this.getUnsubscribeUrl(shop, email);
    return `
      <p style="margin: 15px 0 0; color: #94a3b8; font-size: 11px; line-height: 1.5; text-align: center;">
        Don't want to get marketing news & tips from us? <a href="${unsubscribeUrl}" style="color: #94a3b8; text-decoration: underline;">Unsubscribe</a>
      </p>
    `;
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
                        <li style="margin-bottom: 12px;">Sync Your Store Data from the Dashboard</li>
                        <li style="margin-bottom: 12px;">Structure Your Product Data - Go to "Search Optimization for AI" → Products tab. Also optimize your Collections to help AI bots understand your product categories and relationships.</li>
                        <li style="margin-bottom: 12px;">Use AI-enhanced add-ons to supplement and strengthen your data discovery by AI bots, increasing your store's chances of being well-represented.</li>
                        <li style="margin-bottom: 12px;">Monitor & Improve, use AI testing tools and more.</li>
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
                    <p style="margin: 0 0 15px; color: #64748b; font-size: 12px; line-height: 1.6;">
                      <strong style="color: #1e40af;">indexAIze Team</strong>
                    </p>
                    ${data.shop && data.email ? this.getUnsubscribeFooter(data.shop, data.email) : ''}
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

  getTokenPurchaseEmailTemplate(data) {
    const planFeaturesHtml = data.planFeatures && data.planFeatures.length > 0
      ? `<ul style="margin: 0; padding-left: 20px; color: #4a4a4a; font-size: 14px; line-height: 1.8;">
          ${data.planFeatures.map(feature => `<li style="margin-bottom: 8px;">${feature.replace(/^[✓🔓]/g, '').trim()}</li>`).join('')}
        </ul>`
      : `<p style="margin: 0; color: #4a4a4a; font-size: 14px;">Plan features are being configured.</p>`;

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Unlock AI-Enhanced Features - indexAIze</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
        <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
          <tr>
            <td align="center" style="padding: 40px 20px;">
              <table role="presentation" style="max-width: 600px; width: 100%; background-color: #ffffff; border-collapse: collapse; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <!-- Header -->
                <tr>
                  <td style="padding: 40px; background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%);">
                    <table role="presentation" style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <!-- Logo (Left) -->
                        <td style="width: auto; vertical-align: middle; padding-right: 25px;">
                          <img src="cid:logo" alt="indexAIze Logo" style="width: 120px; height: 120px; display: block; border: none; outline: none; background: transparent; border-radius: 12px;" />
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
                      You've been using indexAIze for a few days now. To unlock the full potential of AI-powered search optimization, consider purchasing tokens to access AI-enhanced features.
                    </p>
                    
                    <!-- Current Plan -->
                    <div style="background-color: #f0f7ff; border-left: 4px solid #2563eb; padding: 20px; margin: 30px 0;">
                      <h3 style="margin: 0 0 15px; color: #1e40af; font-size: 16px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Your Current Plan: ${data.planName}</h3>
                      ${planFeaturesHtml}
                    </div>
                    
                    <!-- AI-Enhanced Features Benefits -->
                    <div style="margin: 30px 0;">
                      <h3 style="margin: 0 0 15px; color: #1e40af; font-size: 16px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">AI-Enhanced Features with Tokens</h3>
                      <ul style="margin: 0; padding-left: 20px; color: #4a4a4a; font-size: 14px; line-height: 1.8;">
                        <li style="margin-bottom: 12px;"><strong>Enhanced Product Optimization:</strong> AI-generated bullet points and FAQ sections that help AI bots better understand your products</li>
                        <li style="margin-bottom: 12px;"><strong>Collection Optimization:</strong> Optimize entire collections for better category discovery by AI search engines</li>
                        <li style="margin-bottom: 12px;"><strong>Advanced Schema Data:</strong> Rich structured data that improves how AI bots interpret your store's content</li>
                        <li style="margin-bottom: 12px;"><strong>AI-Optimized Sitemap:</strong> Intelligent sitemap generation with priority scoring for better crawling</li>
                        <li style="margin-bottom: 12px;"><strong>AI Testing Tools:</strong> Simulate how AI bots see your store and validate your optimization</li>
                      </ul>
                    </div>
                    
                    <!-- Benefits Section -->
                    <div style="background-color: #fff7ed; border-left: 4px solid #f59e0b; padding: 20px; margin: 30px 0;">
                      <h3 style="margin: 0 0 15px; color: #b45309; font-size: 16px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">How This Improves Your AI SEO</h3>
                      <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.6;">
                        AI-enhanced features provide richer, more structured data that helps AI search engines like ChatGPT, Gemini, and Perplexity better understand and recommend your products. This leads to improved visibility in AI-powered search results and higher chances of your products being discovered by potential customers.
                      </p>
                    </div>
                    
                    <!-- CTA Button -->
                    <div style="text-align: center; margin: 35px 0;">
                      <a href="${data.billingUrl}" style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; font-size: 15px; font-weight: 600; border-radius: 4px; letter-spacing: 0.3px; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.3);">
                        View Plans & Billing
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
                    <p style="margin: 0 0 15px; color: #64748b; font-size: 12px; line-height: 1.6;">
                      <strong style="color: #1e40af;">indexAIze Team</strong>
                    </p>
                    ${this.getUnsubscribeFooter(data.shop, data.email)}
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

  getAppStoreRatingEmailTemplate(data) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Rate indexAIze - indexAIze</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
        <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
          <tr>
            <td align="center" style="padding: 40px 20px;">
              <table role="presentation" style="max-width: 600px; width: 100%; background-color: #ffffff; border-collapse: collapse; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <!-- Header -->
                <tr>
                  <td style="padding: 40px; background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%);">
                    <table role="presentation" style="width: 100%; border-collapse: collapse;">
                      <tr>
                        <!-- Logo (Left) -->
                        <td style="width: auto; vertical-align: middle; padding-right: 25px;">
                          <img src="cid:logo" alt="indexAIze Logo" style="width: 120px; height: 120px; display: block; border: none; outline: none; background: transparent; border-radius: 12px;" />
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
                      You've been using indexAIze for a week now. If the app has been helpful for your store's AI search optimization, we'd appreciate your feedback in the Shopify App Store.
                    </p>
                    
                    <p style="margin: 0 0 30px; color: #4a4a4a; font-size: 15px; line-height: 1.6;">
                      Your review helps other merchants evaluate indexAIze and helps us prioritize improvements based on real usage.
                    </p>
                    
                    <!-- CTA Button -->
                    <div style="text-align: center; margin: 40px 0;">
                      <a href="${data.appStoreUrl}" style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-size: 16px; font-weight: 600; letter-spacing: 0.5px; box-shadow: 0 4px 6px rgba(59, 130, 246, 0.3);">
                        Rate in App Store
                      </a>
                    </div>
                    
                    <p style="margin: 30px 0 0; color: #64748b; font-size: 14px; line-height: 1.6;">
                      Thank you for using indexAIze.
                    </p>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="padding: 30px 40px; background-color: #f0f7ff; border-top: 1px solid #dbeafe; text-align: center;">
                    <p style="margin: 0 0 15px; color: #64748b; font-size: 12px; line-height: 1.6;">
                      <strong style="color: #1e40af;">indexAIze Team</strong>
                    </p>
                    <p style="margin: 0 0 15px; color: #64748b; font-size: 12px; line-height: 1.6;">
                      Need assistance? Reply to this email.
                    </p>
                    ${this.getUnsubscribeFooter(data.shop, data.email)}
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
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; text-align: center;">
            <p style="margin: 0 0 10px; color: #64748b; font-size: 12px;">
              <strong style="color: #1e40af;">indexAIze Team</strong>
            </p>
            ${this.getUnsubscribeFooter(data.shop, data.email)}
          </div>
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
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; text-align: center;">
            <p style="margin: 0 0 10px; color: #64748b; font-size: 12px;">
              <strong style="color: #1e40af;">indexAIze Team</strong>
            </p>
            ${this.getUnsubscribeFooter(data.shop, data.email)}
          </div>
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
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; text-align: center;">
            <p style="margin: 0 0 10px; color: #64748b; font-size: 12px;">
              <strong style="color: #1e40af;">indexAIze Team</strong>
            </p>
            ${this.getUnsubscribeFooter(data.shop, data.email)}
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
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; text-align: center;">
            <p style="margin: 0 0 10px; color: #64748b; font-size: 12px;">
              <strong style="color: #1e40af;">indexAIze Team</strong>
            </p>
            ${this.getUnsubscribeFooter(data.shop, data.email)}
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
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; text-align: center;">
            <p style="margin: 0 0 10px; color: #64748b; font-size: 12px;">
              <strong style="color: #1e40af;">indexAIze Team</strong>
            </p>
            ${this.getUnsubscribeFooter(data.shop, data.email)}
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Send weekly product digest email
   */
  async sendWeeklyProductDigest(store, productChanges) {
    if (!process.env.SENDGRID_API_KEY) {
      console.warn('⚠️ SendGrid not configured - skipping product digest');
      return { success: false, error: 'SendGrid not configured' };
    }

    try {
      const shopName = store.shop?.replace('.myshopify.com', '') || store.shop || 'there';
      
      // Count products by type
      const newProducts = productChanges.filter(p => p.changeType === 'created');
      const updatedProducts = productChanges.filter(p => p.changeType === 'updated');
      const needsOptimization = productChanges.filter(p => p.needsAttention);
      
      const totalCount = productChanges.length;
      
      // Skip if no changes
      if (totalCount === 0) {
        return { success: true, skipped: true, reason: 'no_changes' };
      }
      
      const msg = {
        to: store.email || store.shopOwnerEmail || `${shopName}@example.com`,
        from: { email: this.fromEmail, name: this.fromName },
        subject: `📊 ${totalCount} product${totalCount > 1 ? 's' : ''} ready for AIEO optimization`,
        html: this.getProductDigestTemplate({
          shopName,
          shop: store.shop,
          dashboardUrl: this.getDashboardUrl(store.shop),
          billingUrl: this.getBillingUrl(store.shop),
          totalCount,
          newProducts,
          updatedProducts,
          needsOptimization,
          productChanges: productChanges.slice(0, 10) // Show top 10
        })
      };

      await sgMail.send(msg);
      console.log(`✅ Weekly product digest sent to: ${store.shop}`);
      
      // Log email activity
      await this.logEmail(store._id || store.id, store.shop, 'product_digest', 'sent');
      
      return { success: true };
    } catch (error) {
      console.error('❌ Product digest email error:', error);
      await this.logEmail(store._id || store.id, store.shop, 'product_digest', 'failed', error.message);
      return { success: false, error: error.message };
    }
  }

  getProductDigestTemplate(data) {
    const { shopName, dashboardUrl, totalCount, newProducts, updatedProducts, needsOptimization, productChanges } = data;
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Weekly Product Digest</title>
      </head>
      <body style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f8fafc;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700;">📊 Weekly Product Update</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0; font-size: 16px;">Your products are waiting for AIEO optimization</p>
          </div>

          <!-- Content -->
          <div style="padding: 40px 30px;">
            <p style="font-size: 16px; color: #334155; margin: 0 0 25px;">Hi ${shopName}! 👋</p>
            
            <p style="font-size: 16px; color: #334155; line-height: 1.6; margin: 0 0 30px;">
              This week, you've made <strong>${totalCount} product ${totalCount > 1 ? 'changes' : 'change'}</strong> that ${totalCount > 1 ? 'need' : 'needs'} AIEO attention.
            </p>

            <!-- Stats Cards -->
            <div style="display: flex; gap: 15px; margin-bottom: 30px;">
              ${newProducts.length > 0 ? `
              <div style="flex: 1; background: #f0fdf4; border-left: 4px solid #22c55e; padding: 15px; border-radius: 8px;">
                <div style="font-size: 24px; font-weight: 700; color: #16a34a;">${newProducts.length}</div>
                <div style="font-size: 13px; color: #15803d;">New Products</div>
              </div>
              ` : ''}
              ${updatedProducts.length > 0 ? `
              <div style="flex: 1; background: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; border-radius: 8px;">
                <div style="font-size: 24px; font-weight: 700; color: #2563eb;">${updatedProducts.length}</div>
                <div style="font-size: 13px; color: #1d4ed8;">Updated</div>
              </div>
              ` : ''}
              ${needsOptimization.length > 0 ? `
              <div style="flex: 1; background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; border-radius: 8px;">
                <div style="font-size: 24px; font-weight: 700; color: #d97706;">${needsOptimization.length}</div>
                <div style="font-size: 13px; color: #b45309;">Need AIEO</div>
              </div>
              ` : ''}
            </div>

            <!-- Product List -->
            ${productChanges.length > 0 ? `
            <div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
              <h3 style="margin: 0 0 15px; font-size: 16px; color: #1e293b;">Recent Changes:</h3>
              ${productChanges.map(product => `
                <div style="padding: 12px; background: white; border-radius: 6px; margin-bottom: 10px;">
                  <div style="font-weight: 600; color: #1e293b; margin-bottom: 4px;">${product.productTitle}</div>
                  <div style="font-size: 13px; color: #64748b;">
                    ${product.changeType === 'created' ? '🆕 New product' : '📝 Updated'}
                    ${product.needsAttention ? ' • <span style="color: #f59e0b;">Needs optimization</span>' : ''}
                  </div>
                </div>
              `).join('')}
              ${totalCount > 10 ? `
              <div style="text-align: center; padding: 10px; color: #64748b; font-size: 13px;">
                +${totalCount - 10} more products...
              </div>
              ` : ''}
            </div>
            ` : ''}

            <!-- CTA -->
            <div style="text-align: center; margin: 35px 0;">
              <a href="${dashboardUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 14px rgba(102, 126, 234, 0.4);">
                Optimize Products Now
              </a>
            </div>

            <!-- Tip Box -->
            <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 8px; padding: 20px; margin: 30px 0;">
              <div style="font-size: 14px; color: #78350f;">
                <strong>💡 Pro Tip:</strong> Products optimized for AI search engines get discovered faster by ChatGPT, Perplexity, and other AI assistants. Stay ahead of the curve!
              </div>
            </div>

            <p style="font-size: 14px; color: #64748b; line-height: 1.6; margin: 20px 0 0;">
              Questions? <a href="mailto:${this.supportEmail}" style="color: #667eea; text-decoration: none;">Contact Support</a>
            </p>
          </div>

          <!-- Footer -->
          <div style="padding: 30px; background: #f8fafc; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="margin: 0 0 10px; color: #64748b; font-size: 13px;">
              <strong style="color: #1e40af;">indexAIze Team</strong><br>
              Helping you rank higher in AI search
            </p>
            ${this.getUnsubscribeFooter(data.shop, data.email || 'customer@example.com')}
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

export default new EmailService();

