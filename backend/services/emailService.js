// backend/services/emailService.js
// Email service using SendGrid for transactional and marketing emails

import sgMail from '@sendgrid/mail';

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  console.warn('⚠️ SENDGRID_API_KEY not set - email service will not work');
}

class EmailService {
  constructor() {
    this.fromEmail = process.env.FROM_EMAIL || 'noreply@aiseo2.app';
    this.fromName = process.env.FROM_NAME || 'AI SEO 2.0 Team';
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
      const shopName = store.shop?.replace('.myshopify.com', '') || store.shop || 'there';
      const subscription = store.subscription || {};
      const plan = subscription.plan || 'starter';
      
      const msg = {
        to: store.email || store.shopOwner || `${shopName}@example.com`,
        from: { email: this.fromEmail, name: this.fromName },
        subject: '🚀 Welcome to AI SEO 2.0!',
        html: this.getWelcomeEmailTemplate({
          shopName,
          shopUrl: `https://${store.shop}`,
          dashboardUrl: `${process.env.APP_URL || process.env.BASE_URL || 'https://app.aiseo2.app'}/dashboard?shop=${store.shop}`,
          plan,
          trialDays: this.calculateTrialDays(subscription.trialEndsAt || subscription.expiresAt),
          aiProviders: subscription.aiProviders?.join(', ') || 'OpenAI',
          productLimit: subscription.productLimit || 150
        })
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
          dashboardUrl: `${process.env.APP_URL || process.env.BASE_URL || 'https://app.aiseo2.app'}/dashboard?shop=${store.shop}`,
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
          upgradeUrl: `${process.env.APP_URL || process.env.BASE_URL || 'https://app.aiseo2.app'}/billing?shop=${store.shop}`,
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
          feedbackUrl: `${process.env.APP_URL || process.env.BASE_URL || 'https://app.aiseo2.app'}/feedback?shop=${store.shop}`,
          reinstallUrl: `${process.env.APP_URL || process.env.BASE_URL || 'https://app.aiseo2.app'}/?shop=${store.shop}`,
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
          dashboardUrl: `${process.env.APP_URL || process.env.BASE_URL || 'https://app.aiseo2.app'}/dashboard?shop=${store.shop}`,
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
          newFeatures: this.getPlanFeatures(newPlan),
          dashboardUrl: `${process.env.APP_URL || process.env.BASE_URL || 'https://app.aiseo2.app'}/dashboard?shop=${store.shop}`
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
          dashboardUrl: `${process.env.APP_URL || process.env.BASE_URL || 'https://app.aiseo2.app'}/dashboard?shop=${store.shop}`,
          supportUrl: `${process.env.APP_URL || process.env.BASE_URL || 'https://app.aiseo2.app'}/support`
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

  getTopProvider(aiQueryHistory) {
    if (!aiQueryHistory || aiQueryHistory.length === 0) return 'claude';
    const counts = {};
    aiQueryHistory.forEach(q => {
      counts[q.provider] = (counts[q.provider] || 0) + 1;
    });
    return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
  }

  getPlanFeatures(plan) {
    const features = {
      professional: [
        '500 AI queries per month',
        '3 AI providers',
        'Auto-sync every 12h',
        'Bulk operations'
      ],
      business: [
        '2,000 AI queries per month',
        '4 AI providers',
        'Auto-sync every 6h',
        'Advanced analytics'
      ],
      enterprise: [
        '10,000 AI queries per month',
        'All 5 AI providers',
        'Auto-sync every 2h',
        'Priority support'
      ]
    };
    return features[plan] || [];
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
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Welcome to AI SEO 2.0!</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0;">🚀 Welcome to AI SEO 2.0!</h1>
        </div>
        
        <div style="padding: 30px; background: #f8f9fa; border-radius: 0 0 8px 8px;">
          <p>Hi ${data.shopName}! 👋</p>
          
          <p>Congrats on installing AI SEO 2.0! You're now ready to optimize your Shopify store with the power of AI.</p>
          
          <h3>Your Trial Details:</h3>
          <ul>
            <li>🎯 Plan: <strong>${data.plan}</strong></li>
            <li>🤖 AI Providers: ${data.aiProviders}</li>
            <li>📦 Product Limit: ${data.productLimit}</li>
            <li>⏰ Trial Days Left: <strong>${data.trialDays} days</strong></li>
          </ul>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.dashboardUrl}" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block;">
              Go to Dashboard
            </a>
          </div>
          
          <h3>Next Steps:</h3>
          <ol>
            <li>Sync your products from Shopify</li>
            <li>Choose your preferred AI provider</li>
            <li>Run your first SEO optimization</li>
          </ol>
          
          <p>Need help? Reply to this email or visit our <a href="${data.dashboardUrl}">support center</a>.</p>
          
          <p>Happy optimizing! 🎉<br>The AI SEO 2.0 Team</p>
        </div>
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

