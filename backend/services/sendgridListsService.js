// SendGrid Lists Service - управление на листове и suppression lists
import fetch from 'node-fetch';

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_API_URL = 'https://api.sendgrid.com/v3';

// List ID за всички инсталирали приложението (трябва да се създаде в SendGrid dashboard)
const APP_USERS_LIST_ID = process.env.SENDGRID_APP_USERS_LIST_ID || null;

class SendGridListsService {
  constructor() {
    if (!SENDGRID_API_KEY) {
      console.warn('⚠️ SENDGRID_API_KEY not set - SendGrid Lists service will not work');
    }
  }

  /**
   * Добавя email в SendGrid лист (всички инсталирали)
   */
  async addToAppUsersList(email, shop, shopName = null) {
    if (!SENDGRID_API_KEY) {
      console.warn('[SENDGRID-LISTS] ⚠️ SENDGRID_API_KEY not set - skipping');
      return { success: false, error: 'SendGrid not configured' };
    }

    if (!APP_USERS_LIST_ID) {
      console.warn('[SENDGRID-LISTS] ⚠️ SENDGRID_APP_USERS_LIST_ID not set - skipping');
      return { success: false, error: 'App Users List ID not configured' };
    }

    try {
      const url = `${SENDGRID_API_URL}/marketing/contacts`;
      
      const contactData = {
        list_ids: [APP_USERS_LIST_ID],
        contacts: [
          {
            email: email,
            custom_fields: {
              e1_T: shop, // Shop domain
              e2_T: shopName || shop // Shop name
            }
          }
        ]
      };

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${SENDGRID_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(contactData)
      });

      if (response.ok || response.status === 202) {
        console.log(`[SENDGRID-LISTS] ✅ Added ${email} (${shop}) to App Users list`);
        return { success: true };
      } else {
        const errorText = await response.text();
        console.error(`[SENDGRID-LISTS] ❌ Failed to add ${email} to list:`, response.status, errorText);
        return { success: false, error: `SendGrid API error: ${response.status}` };
      }
    } catch (error) {
      console.error('[SENDGRID-LISTS] ❌ Error adding to list:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Добавя email в SendGrid suppression list (unsubscribed)
   */
  async addToSuppressionList(email, shop = null) {
    if (!SENDGRID_API_KEY) {
      console.warn('[SENDGRID-LISTS] ⚠️ SENDGRID_API_KEY not set - skipping');
      return { success: false, error: 'SendGrid not configured' };
    }

    try {
      const url = `${SENDGRID_API_URL}/suppression/unsubscribes`;
      
      const suppressionData = {
        emails: [email]
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SENDGRID_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(suppressionData)
      });

      if (response.ok || response.status === 201) {
        console.log(`[SENDGRID-LISTS] ✅ Added ${email} (${shop || 'N/A'}) to suppression list`);
        return { success: true };
      } else if (response.status === 409) {
        // Email вече е в suppression list
        console.log(`[SENDGRID-LISTS] ℹ️ ${email} already in suppression list`);
        return { success: true, alreadyExists: true };
      } else {
        const errorText = await response.text();
        console.error(`[SENDGRID-LISTS] ❌ Failed to add ${email} to suppression list:`, response.status, errorText);
        return { success: false, error: `SendGrid API error: ${response.status}` };
      }
    } catch (error) {
      console.error('[SENDGRID-LISTS] ❌ Error adding to suppression list:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Премахва email от suppression list (resubscribe)
   */
  async removeFromSuppressionList(email) {
    if (!SENDGRID_API_KEY) {
      console.warn('[SENDGRID-LISTS] ⚠️ SENDGRID_API_KEY not set - skipping');
      return { success: false, error: 'SendGrid not configured' };
    }

    try {
      const url = `${SENDGRID_API_URL}/suppression/unsubscribes/${encodeURIComponent(email)}`;

      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${SENDGRID_API_KEY}`
        }
      });

      if (response.ok || response.status === 204) {
        console.log(`[SENDGRID-LISTS] ✅ Removed ${email} from suppression list`);
        return { success: true };
      } else if (response.status === 404) {
        // Email не е в suppression list
        console.log(`[SENDGRID-LISTS] ℹ️ ${email} not in suppression list`);
        return { success: true, notFound: true };
      } else {
        const errorText = await response.text();
        console.error(`[SENDGRID-LISTS] ❌ Failed to remove ${email} from suppression list:`, response.status, errorText);
        return { success: false, error: `SendGrid API error: ${response.status}` };
      }
    } catch (error) {
      console.error('[SENDGRID-LISTS] ❌ Error removing from suppression list:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Проверява дали email е в suppression list
   */
  async isInSuppressionList(email) {
    if (!SENDGRID_API_KEY) {
      return false;
    }

    try {
      const url = `${SENDGRID_API_URL}/suppression/unsubscribes/${encodeURIComponent(email)}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${SENDGRID_API_KEY}`
        }
      });

      return response.ok;
    } catch (error) {
      console.error('[SENDGRID-LISTS] ❌ Error checking suppression list:', error.message);
      return false;
    }
  }
}

export default new SendGridListsService();

