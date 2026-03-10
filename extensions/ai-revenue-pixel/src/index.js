const AI_REFERRER_DOMAINS = [
  'chat.openai.com', 'chatgpt.com',
  'perplexity.ai',
  'claude.ai',
  'gemini.google.com', 'bard.google.com',
  'copilot.microsoft.com',
  'you.com',
  'poe.com',
  'phind.com',
  'meta.ai',
  'kagi.com',
];

const AI_SOURCE_MAP = {
  'chat.openai.com': 'ChatGPT',
  'chatgpt.com': 'ChatGPT',
  'perplexity.ai': 'Perplexity',
  'claude.ai': 'Claude',
  'gemini.google.com': 'Gemini',
  'bard.google.com': 'Gemini',
  'copilot.microsoft.com': 'Copilot',
  'you.com': 'You.com',
  'poe.com': 'Poe',
  'phind.com': 'Phind',
  'meta.ai': 'Meta AI',
  'kagi.com': 'Kagi',
};

function extractDomain(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function detectAISource(referrer) {
  const domain = extractDomain(referrer);
  if (!domain) return null;
  for (const aiDomain of AI_REFERRER_DOMAINS) {
    if (domain === aiDomain || domain === aiDomain.replace(/^www\./, '')) {
      return AI_SOURCE_MAP[aiDomain] || aiDomain;
    }
  }
  return null;
}

function sendEvent(appUrl, shopDomain, payload) {
  if (!appUrl) return;
  const url = `${appUrl}/api/pixel/events`;
  const body = JSON.stringify({ shop: shopDomain, ...payload });

  try {
    if (typeof fetch === 'function') {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Silently fail — analytics should never break the store
  }
}

register(({ analytics, browser, settings, init }) => {
  const appUrl = settings?.app_url || '';
  const shopDomain = settings?.shop_domain || init?.data?.shop?.myshopifyDomain || '';
  const AI_SOURCE_KEY = 'indexaize_ai_source';
  const AI_SESSION_KEY = 'indexaize_ai_session';

  // On page view, detect AI referrer and persist in sessionStorage
  analytics.subscribe('page_viewed', async (event) => {
    const referrer = event?.context?.document?.referrer || '';
    const aiSource = detectAISource(referrer);

    if (aiSource) {
      try {
        await browser.sessionStorage.setItem(AI_SOURCE_KEY, aiSource);
        const sid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await browser.sessionStorage.setItem(AI_SESSION_KEY, sid);
      } catch {}

      sendEvent(appUrl, shopDomain, {
        eventType: 'page_viewed',
        aiSource,
        referrerUrl: referrer,
        sessionId: '',
        timestamp: event?.timestamp || new Date().toISOString(),
      });
    }
  });

  // Track add-to-cart from AI-referred sessions
  analytics.subscribe('product_added_to_cart', async (event) => {
    let aiSource = null;
    let sessionId = '';
    try {
      aiSource = await browser.sessionStorage.getItem(AI_SOURCE_KEY);
      sessionId = await browser.sessionStorage.getItem(AI_SESSION_KEY) || '';
    } catch {}

    if (!aiSource) return;

    const cartLine = event?.data?.cartLine;
    const merchandise = cartLine?.merchandise;

    sendEvent(appUrl, shopDomain, {
      eventType: 'add_to_cart',
      aiSource,
      sessionId,
      productId: merchandise?.product?.id || '',
      productHandle: merchandise?.product?.url?.split('/products/')[1]?.split('?')[0] || '',
      productTitle: merchandise?.product?.title || '',
      variantId: merchandise?.id || '',
      quantity: cartLine?.quantity || 1,
      price: merchandise?.price?.amount || '0',
      currency: merchandise?.price?.currencyCode || 'USD',
      timestamp: event?.timestamp || new Date().toISOString(),
    });
  });

  // Track checkout completion from AI-referred sessions
  analytics.subscribe('checkout_completed', async (event) => {
    let aiSource = null;
    let sessionId = '';
    try {
      aiSource = await browser.sessionStorage.getItem(AI_SOURCE_KEY);
      sessionId = await browser.sessionStorage.getItem(AI_SESSION_KEY) || '';
    } catch {}

    if (!aiSource) return;

    const checkout = event?.data?.checkout;

    sendEvent(appUrl, shopDomain, {
      eventType: 'checkout_completed',
      aiSource,
      sessionId,
      orderId: checkout?.order?.id || '',
      totalPrice: checkout?.totalPrice?.amount || '0',
      currency: checkout?.totalPrice?.currencyCode || 'USD',
      lineItems: (checkout?.lineItems || []).slice(0, 20).map(li => ({
        productId: li.variant?.product?.id || '',
        title: li.title || '',
        quantity: li.quantity || 1,
        price: li.variant?.price?.amount || '0',
      })),
      timestamp: event?.timestamp || new Date().toISOString(),
    });

    // Clear session markers after successful checkout
    try {
      await browser.sessionStorage.removeItem(AI_SOURCE_KEY);
      await browser.sessionStorage.removeItem(AI_SESSION_KEY);
    } catch {}
  });
});
