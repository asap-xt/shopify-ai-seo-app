// frontend/src/components/StoreMetadataBanner.jsx
// Banner to prompt users to configure Store Metadata for better AI results
// Force rebuild trigger
// TEMPORARILY COMMENTED OUT - Banner seems unnecessary

/*
import { Banner, Button, InlineStack } from '@shopify/polaris';
import { useState, useEffect } from 'react';
import useI18n from '../hooks/useI18n';
import { useShopApi } from '../hooks/useShopApi';

export function StoreMetadataBanner({ globalPlan }) {
  const { t } = useI18n();
  const { api } = useShopApi();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(() => {
    // Check if banner was dismissed in this session
    return sessionStorage.getItem('storeMetadataBannerDismissed') === 'true';
  });
  
  useEffect(() => {
    fetchMetadataStatus();
  }, []);
  
  const fetchMetadataStatus = async () => {
    try {
      console.log('[StoreMetadataBanner] Fetching metadata status...');
      const data = await api('/api/store/metadata-status');
      console.log('[StoreMetadataBanner] Status data:', data);
      setStatus(data);
    } catch (error) {
      console.error('[StoreMetadataBanner] Error fetching metadata status:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('storeMetadataBannerDismissed', 'true');
  };
  
  const handleSetup = () => {
    // Navigate using window.location like other pages in the app
    const currentParams = new URLSearchParams(window.location.search);
    const paramString = currentParams.toString() ? `?${currentParams.toString()}` : '';
    window.location.href = `/ai-seo/store-metadata${paramString}`;
  };
  
  // Check if plan is Professional or higher
  const planKey = globalPlan?.planKey?.toLowerCase() || '';
  const isProfessionalOrHigher = ['professional', 'professional_plus', 'growth', 'growth_plus', 'growth_extra', 'enterprise'].includes(planKey);
  
  // Don't show if:
  // - Loading
  // - Dismissed in this session
  // - No status data
  // - Metadata is already complete
  // - Plan is not Professional or higher (Basic/Starter don't have access to Store Metadata)
  console.log('[StoreMetadataBanner] Render check:', { 
    loading, 
    dismissed, 
    status, 
    hasMetadata: status?.hasMetadata,
    planKey,
    isProfessionalOrHigher
  });
  
  if (loading || dismissed || !status || status.hasMetadata || !isProfessionalOrHigher) {
    console.log('[StoreMetadataBanner] Not showing banner. Reason:', {
      loading,
      dismissed,
      noStatus: !status,
      hasMetadata: status?.hasMetadata,
      notProfessionalOrHigher: !isProfessionalOrHigher
    });
    return null;
  }
  
  console.log('[StoreMetadataBanner] SHOWING BANNER!');
  
  // Determine banner message based on what's missing
  let title = t('storeMetadata.banner.title', '⚡ Boost AI Quality');
  let message = '';
  let criticalMissing = false;
  
  if (!status.hasPolicies) {
    criticalMissing = true;
    if (!status.hasShipping && !status.hasReturns) {
      message = t(
        'storeMetadata.banner.policiesMissing',
        'Add shipping and return policies to help AI generate accurate, policy-compliant content. This prevents AI from inventing incorrect delivery times or warranty claims.'
      );
    } else if (!status.hasShipping) {
      message = t(
        'storeMetadata.banner.shippingMissing',
        'Add shipping information to help AI generate accurate content about delivery options.'
      );
    } else if (!status.hasReturns) {
      message = t(
        'storeMetadata.banner.returnsMissing',
        'Add return policy to help AI generate accurate content about returns and refunds.'
      );
    }
  } else if (!status.hasTargetAudience && !status.hasBrandVoice) {
    message = t(
      'storeMetadata.banner.brandingMissing',
      'Add target audience and brand voice to help AI generate more on-brand, engaging content that resonates with your customers.'
    );
  }
  
  return (
    <div style={{ marginBottom: '1rem' }}>
      <Banner
        title={title}
        tone={criticalMissing ? 'warning' : 'info'}
        onDismiss={handleDismiss}
      >
        <p>{message}</p>
        <div style={{ marginTop: '0.75rem' }}>
          <InlineStack gap="200">
            <Button
              onClick={handleSetup}
              variant="primary"
            >
              {t('storeMetadata.banner.action', 'Quick Setup (2 min)')}
            </Button>
            {!criticalMissing && (
              <Button onClick={handleDismiss}>
                {t('common.remindLater', 'Remind me later')}
              </Button>
            )}
          </InlineStack>
        </div>
      </Banner>
    </div>
  );
}
*/

// Return null to disable the banner completely
export function StoreMetadataBanner({ globalPlan }) {
  return null;
}

