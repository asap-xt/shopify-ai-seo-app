// frontend/src/pages/SchemaData.jsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Card,
  Box,
  Text,
  Button,
  InlineStack,
  Banner,
  Link,
  Toast,
  BlockStack,
  Tabs,
  TextField,
  Spinner,
  Badge,
  List,
  Divider,
  Modal,
  InlineGrid,
  Checkbox,
  ProgressBar
} from '@shopify/polaris';
import { makeSessionFetch } from '../lib/sessionFetch.js';
import { PLAN_HIERARCHY, getPlanIndex } from '../hooks/usePlanHierarchy.js';
import TrialActivationModal from '../components/TrialActivationModal.jsx';
import InsufficientTokensModal from '../components/InsufficientTokensModal.jsx';
import TokenPurchaseModal from '../components/TokenPurchaseModal.jsx';
import UpgradeModal from '../components/UpgradeModal.jsx';
import { estimateTokens } from '../utils/tokenEstimates.js';

const qs = (k, d = '') => { try { return new URLSearchParams(window.location.search).get(k) || d; } catch { return d; } };

// Dev-only debug logger (hidden in production builds)
const isDev = import.meta.env.DEV;
const debugLog = (...args) => {
  if (isDev) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
};

// Normalize plan name (same as Settings.jsx)
const normalizePlan = (plan) => {
  return (plan || 'starter').toLowerCase().replace(/\s+/g, '_');
};

export default function SchemaData({ shop: shopProp }) {
  const shop = shopProp || qs('shop', '');
  
  debugLog('[SCHEMA-DATA] shopProp:', shopProp);
  debugLog('[SCHEMA-DATA] qs("shop"):', qs('shop', ''));
  debugLog('[SCHEMA-DATA] final shop:', shop);
  debugLog('[SCHEMA-DATA] window.location.search:', window.location.search);
  
  const [selectedTab, setSelectedTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [schemas, setSchemas] = useState({
    organization: null,
    website: null,
    products: []
  });
  const [toastContent, setToastContent] = useState('');
  const api = useMemo(() => makeSessionFetch(), []);
  const [schemaScript, setSchemaScript] = useState('');
  const [currentPlan, setCurrentPlan] = useState(null);
  const [planKey, setPlanKey] = useState(null);
  const [subscriptionInfo, setSubscriptionInfo] = useState(null);
  const [productCount, setProductCount] = useState(0);
  
  // Advanced Schema states
  const [advancedSchemaStatus, setAdvancedSchemaStatus] = useState({
    inProgress: false,
    status: 'idle',
    message: null,
    position: null,
    estimatedTime: null,
    generatedAt: null,
    schemaCount: 0
  });
  const [advancedSchemaPollingRef, setAdvancedSchemaPollingRef] = useState(null);
  const [advancedSchemaBusy, setAdvancedSchemaBusy] = useState(false);
  
  // Modal states
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeModalData, setUpgradeModalData] = useState({});
  const [showTrialActivationModal, setShowTrialActivationModal] = useState(false);
  const [showInsufficientTokensModal, setShowInsufficientTokensModal] = useState(false);
  const [showTokenPurchaseModal, setShowTokenPurchaseModal] = useState(false);
  const [tokenError, setTokenError] = useState(null);
  const [showSchemaErrorModal, setShowSchemaErrorModal] = useState(false);
  const [schemaErrorType, setSchemaErrorType] = useState(null);
  
  // Rich Attributes state (same as Settings.jsx)
  const [richAttributes, setRichAttributes] = useState({
    material: false,
    color: false,
    size: false,
    weight: false,
    dimensions: false,
    category: false,
    audience: false,
    reviews: false,
    ratings: true, // Default enabled
    enhancedDescription: false,
    organization: false
  });
  const [savingAttributes, setSavingAttributes] = useState(false);

  useEffect(() => {
    if (shop) {
      loadSchemas();
      loadPlan();
      fetchAdvancedSchemaStatus();
    }
  }, [shop, api]);
  
  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (advancedSchemaPollingRef) {
        clearInterval(advancedSchemaPollingRef);
      }
    };
  }, [advancedSchemaPollingRef]);

  const loadPlan = async () => {
    try {
      // Load settings from the same endpoint as Settings.jsx
      const settingsData = await api(`/api/ai-discovery/settings?shop=${shop}`);
      
      debugLog('[SCHEMA-DATA] Settings data:', settingsData);
      setCurrentPlan(settingsData?.plan);
      setPlanKey(normalizePlan(settingsData?.plan));
      setProductCount(settingsData?.productCount || 0);
      
      // Load rich attributes if available
      if (settingsData?.richAttributes) {
        setRichAttributes(prev => ({
          ...prev,
          ...settingsData.richAttributes
        }));
      }
      
      // Get subscription info from billing endpoint for trial checks
      try {
        const billingData = await api(`/api/billing/info?shop=${shop}`);
        if (billingData?.subscription) {
          setSubscriptionInfo(billingData.subscription);
        }
      } catch (e) {
        debugLog('[SCHEMA-DATA] Could not load subscription info:', e);
      }
    } catch (err) {
      console.error('[SCHEMA-DATA] Error loading plan:', err);
          }
  };
      
  // Save rich attributes to backend (PATCH-style - only update richAttributes)
  const saveRichAttributes = async () => {
    setSavingAttributes(true);
    try {
      // First get current settings to preserve other fields
      const currentSettings = await api(`/api/ai-discovery/settings?shop=${shop}`);
      
      // Save with all fields preserved, only update richAttributes
      await api(`/api/ai-discovery/settings?shop=${shop}`, {
        method: 'POST',
        body: {
          shop,
          bots: currentSettings.bots,
          features: currentSettings.features,
          richAttributes: richAttributes
        }
      });
      setToastContent('Rich attributes saved!');
    } catch (err) {
      console.error('[SCHEMA-DATA] Error saving rich attributes:', err);
      setToastContent('Failed to save attributes: ' + (err.message || 'Unknown error'));
    } finally {
      setSavingAttributes(false);
    }
  };
  
  // Fetch Advanced Schema status
  const fetchAdvancedSchemaStatus = useCallback(async () => {
    try {
      const status = await api(`/api/schema/status?shop=${shop}`);
      
      setAdvancedSchemaStatus({
        inProgress: status.inProgress || false,
        status: status.status || 'idle',
        message: status.message || null,
        position: status.queue?.position || null,
        estimatedTime: status.queue?.estimatedTime || null,
        generatedAt: status.schema?.generatedAt || null,
        schemaCount: status.schema?.schemaCount || 0,
        progress: status.shopStatus?.progress || null,
        totalProducts: status.shopStatus?.totalProducts || 0,
        processedProducts: status.shopStatus?.processedProducts || 0,
        successfulProducts: status.shopStatus?.successfulProducts || 0,
        failedProducts: status.shopStatus?.failedProducts || 0
      });
      
      // If completed, stop polling
      if (status.status === 'completed' && !status.inProgress) {
        if (advancedSchemaPollingRef) {
          clearInterval(advancedSchemaPollingRef);
          setAdvancedSchemaPollingRef(null);
        }
        
        if (advancedSchemaStatus.inProgress) {
          setToastContent(`Advanced Schema Data generated! (${status.schema?.schemaCount || 0} schemas)`);
        }
      }
      
      // Handle errors
      if (status.status === 'failed') {
        if (advancedSchemaPollingRef) {
          clearInterval(advancedSchemaPollingRef);
          setAdvancedSchemaPollingRef(null);
        }
        
        if (status.message === 'NO_OPTIMIZED_PRODUCTS') {
          setSchemaErrorType('NO_OPTIMIZED_PRODUCTS');
          setShowSchemaErrorModal(true);
        } else if (status.message === 'ONLY_BASIC_SEO') {
          setSchemaErrorType('ONLY_BASIC_SEO');
          setShowSchemaErrorModal(true);
        }
      }
      
      return status;
    } catch (error) {
      console.error('[SCHEMA-DATA] Failed to fetch schema status:', error);
    }
  }, [shop, api, advancedSchemaPollingRef, advancedSchemaStatus.inProgress]);
  
  // Start polling for schema status
  const startAdvancedSchemaPolling = useCallback(() => {
    if (advancedSchemaPollingRef) {
      clearInterval(advancedSchemaPollingRef);
    }
    
    fetchAdvancedSchemaStatus();
    
    const interval = setInterval(() => {
      fetchAdvancedSchemaStatus();
    }, 10000);
    
    setAdvancedSchemaPollingRef(interval);
  }, [fetchAdvancedSchemaStatus, advancedSchemaPollingRef]);
  
  // Generate Advanced Schema with all plan/token checks (same as Settings.jsx)
  const generateAdvancedSchema = async (forceBasicSeo = false) => {
    setAdvancedSchemaBusy(true);
    
    try {
      // Normalize plan exactly like Settings.jsx
      const plan = normalizePlan(currentPlan);
      
      debugLog('[SCHEMA-DATA] generateAdvancedSchema - plan:', plan, 'currentPlan:', currentPlan);
      
      // Plans with included tokens (full access) - same as Settings.jsx
      const plansWithIncludedTokens = ['growth_extra', 'enterprise'];
      // Plus plans (require purchased tokens) - same as Settings.jsx
      const plusPlans = ['professional_plus', 'growth_plus', 'starter_plus'];
      
      const hasIncludedAccess = plansWithIncludedTokens.includes(plan);
      const isPlusPlan = plusPlans.includes(plan);
      
      debugLog('[SCHEMA-DATA] hasIncludedAccess:', hasIncludedAccess, 'isPlusPlan:', isPlusPlan);
      
      // Token estimation
      const tokenEstimate = estimateTokens('ai-schema-advanced', { productCount: productCount || 0 });
      const tokensRequired = tokenEstimate.withMargin;
      
      // Plan check - show upgrade modal if not eligible
      // Enterprise and Growth Extra have full access, Plus plans need tokens
      if (!hasIncludedAccess && !isPlusPlan) {
        setUpgradeModalData({
          feature: 'Advanced Schema Data',
          currentPlan: currentPlan,
          requiredPlan: 'Professional Plus, Growth Plus, Growth Extra, or Enterprise',
          tokensRequired
        });
        setShowUpgradeModal(true);
        setAdvancedSchemaBusy(false);
        return;
      }
      
      // For Plus plans, check token balance first
      if (isPlusPlan) {
        try {
          const balanceData = await api(`/api/billing/tokens/balance?shop=${shop}`);
          const currentBalance = balanceData?.balance || 0;
          
          if (currentBalance < tokensRequired) {
            setTokenError({
              feature: 'ai-schema-advanced',
              tokensRequired,
              tokensAvailable: currentBalance,
              tokensNeeded: tokensRequired - currentBalance
            });
            setShowInsufficientTokensModal(true);
            setAdvancedSchemaBusy(false);
            return;
          }
        } catch (e) {
          console.error('[SCHEMA-DATA] Token balance check failed:', e);
        }
      }
      
      // For included tokens plans (Growth Extra, Enterprise), let the backend handle trial checks
      // Call the backend to generate - it will return 402 if trial restriction applies
      const result = await api(`/api/schema/generate-all?shop=${shop}`, {
        method: 'POST',
        body: { shop, forceBasicSeo }
      });
      
      if (result.queued) {
        setToastContent('Advanced Schema generation started...');
        startAdvancedSchemaPolling();
      } else if (result.error) {
        // Handle specific errors
        if (result.error === 'NO_OPTIMIZED_PRODUCTS') {
          setSchemaErrorType('NO_OPTIMIZED_PRODUCTS');
          setShowSchemaErrorModal(true);
        } else if (result.error === 'ONLY_BASIC_SEO') {
          setSchemaErrorType('ONLY_BASIC_SEO');
          setShowSchemaErrorModal(true);
        } else {
          setToastContent(`Error: ${result.error}`);
        }
      }
      
    } catch (error) {
      console.error('[SCHEMA-DATA] Generate advanced schema error:', error);
      
      // Handle 402 errors (trial/tokens)
      if (error.status === 402) {
        if (error.trialRestriction && error.requiresActivation) {
          setTokenError(error);
          setShowTrialActivationModal(true);
        } else if (error.requiresPurchase) {
          setTokenError(error);
          setShowInsufficientTokensModal(true);
        } else {
          setToastContent(error.message || 'Payment required');
        }
      } else if (error.status === 403) {
        setUpgradeModalData({
          feature: 'Advanced Schema Data',
          currentPlan: currentPlan,
          requiredPlan: 'Professional Plus, Growth Plus, Growth Extra, or Enterprise'
        });
        setShowUpgradeModal(true);
      } else if (error.status === 400) {
        // NO_OPTIMIZED_PRODUCTS or ONLY_BASIC_SEO
        if (error.error === 'NO_OPTIMIZED_PRODUCTS') {
          setSchemaErrorType('NO_OPTIMIZED_PRODUCTS');
          setShowSchemaErrorModal(true);
        } else if (error.error === 'ONLY_BASIC_SEO') {
          setSchemaErrorType('ONLY_BASIC_SEO');
          setShowSchemaErrorModal(true);
        } else {
          setToastContent(error.message || 'Error generating schema');
        }
      } else {
        setToastContent(`Error: ${error.message}`);
      }
    } finally {
      setAdvancedSchemaBusy(false);
    }
  };
  
  // Handle plan activation from trial
  const handleActivatePlan = async () => {
    try {
      const result = await api(`/api/billing/activate?shop=${shop}`, {
        method: 'POST',
        body: { 
          shop, 
          endTrial: true,
          returnTo: window.location.pathname
        }
      });
      
      if (result.confirmationUrl) {
        window.top.location.href = result.confirmationUrl;
      } else if (result.success) {
        setShowTrialActivationModal(false);
        setToastContent('Plan activated! You can now generate Advanced Schema Data.');
        // Retry generation
        setTimeout(() => generateAdvancedSchema(), 1000);
      }
    } catch (error) {
      console.error('[SCHEMA-DATA] Activate plan error:', error);
      setToastContent('Failed to activate plan');
    }
  };
  
  // Time ago helper
  const timeAgo = (date) => {
    if (!date) return '';
    const now = new Date();
    const generated = new Date(date);
    const diff = Math.floor((now - generated) / 1000 / 60);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff} min ago`;
    const hours = Math.floor(diff / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // Plan-based feature availability
  const isFeatureAvailable = (feature) => {
    debugLog('[SCHEMA-DATA] isFeatureAvailable - currentPlan:', currentPlan);
    debugLog('[SCHEMA-DATA] isFeatureAvailable - feature:', feature);
    
    if (!currentPlan) {
      debugLog('[SCHEMA-DATA] No current plan, returning false');
      return false;
    }
    
    const currentPlanIndex = getPlanIndex(currentPlan);
    
    debugLog('[SCHEMA-DATA] Plan hierarchy:', PLAN_HIERARCHY);
    debugLog('[SCHEMA-DATA] Current plan index:', currentPlanIndex);
    
    switch (feature) {
      case 'productsJson':
        return currentPlanIndex >= 0; // All plans
      case 'welcomePage':
        return currentPlanIndex >= 2; // Growth+
      case 'collectionsJson':
        return currentPlanIndex >= 2; // Growth+
      case 'aiSitemap':
        return currentPlanIndex >= 3; // Growth Extra+
      case 'schemaData':
        return currentPlanIndex >= 4; // Enterprise
      default:
        return false;
    }
  };

  const getRequiredPlan = (feature) => {
    switch (feature) {
      case 'productsJson': return 'Starter';
      case 'welcomePage': return 'Growth';
      case 'collectionsJson': return 'Growth';
      case 'aiSitemap': return 'Growth Extra';
      case 'schemaData': return 'Enterprise';
      default: return 'Starter';
    }
  };



  const runBasicSimulation = async (questionType) => {
    let response = '';
    
    switch (questionType) {
      case 'products':
        // Fetch real products data
        const productsData = await api(`/api/products/list?shop=${shop}&limit=5&optimized=true`, { headers: { 'X-Shop': shop } });
        if (productsData?.products && productsData.products.length > 0) {
          const productTitles = productsData.products.slice(0, 3).map(p => p.title).join(', ');
          response = `Based on the structured data, ${shop} sells ${productsData.products.length} optimized products including: ${productTitles}${productsData.products.length > 3 ? ' and more.' : '.'}`;
        } else {
          response = `I can see that ${shop} is a store, but I don't have detailed product information available in the structured data. The store may need to generate AI optimization data for their products.`;
        }
        break;
        
      case 'business':
        // Try to fetch Store Metadata first
        try {
          const storeMetadataData = await api(`/api/store/metadata?shop=${shop}`, { headers: { 'X-Shop': shop } });
          if (storeMetadataData?.seoMetadata) {
            const seoData = JSON.parse(storeMetadataData.seoMetadata);
            const storeName = seoData.storeName || storeMetadataData.shopName || shop;
            const description = seoData.fullDescription || storeMetadataData.description || 'an online store';
            
            response = `${storeName} is ${description.toLowerCase()}.`;
            
            if (seoData.keywords && seoData.keywords.length > 0) {
              response += ` They specialize in: ${seoData.keywords.slice(0, 3).join(', ')}.`;
            }
            
            if (storeMetadataData.aiMetadata) {
              const aiData = JSON.parse(storeMetadataData.aiMetadata);
              if (aiData.businessType) {
                response += ` This is a ${aiData.businessType}.`;
              }
              if (aiData.shippingInfo) {
                response += ` Shipping: ${aiData.shippingInfo}.`;
              }
            }
          } else if (schemas.organization) {
            response = `${schemas.organization.name || shop} is a business that ${schemas.organization.description ? `offers ${schemas.organization.description.toLowerCase()}` : 'operates an online store'}.`;
            if (schemas.organization.url) {
              response += ` You can visit them at ${schemas.organization.url}.`;
            }
          } else {
            response = `${shop} appears to be an online store, but I don't have detailed business information available in the structured data. The store may need to configure their store metadata or organization schema.`;
          }
        } catch (error) {
          console.error('[SCHEMA-DATA] Error fetching store metadata:', error);
          if (schemas.organization) {
            response = `${schemas.organization.name || shop} is a business that ${schemas.organization.description ? `offers ${schemas.organization.description.toLowerCase()}` : 'operates an online store'}.`;
            if (schemas.organization.url) {
              response += ` You can visit them at ${schemas.organization.url}.`;
            }
          } else {
            response = `${shop} appears to be an online store, but I don't have detailed business information available in the structured data. The store may need to configure their organization schema.`;
          }
        }
        break;
        
      case 'categories':
        // Fetch real collections data
        const collectionsData = await api(`/collections/list-graphql?shop=${shop}&limit=5`, { headers: { 'X-Shop': shop } });
        if (collectionsData?.collections && collectionsData.collections.length > 0) {
          const collectionNames = collectionsData.collections.slice(0, 3).map(c => c.title).join(', ');
          response = `${shop} has ${collectionsData.collections.length} product categories including: ${collectionNames}${collectionsData.collections.length > 3 ? ' and more.' : '.'}`;
        } else {
          response = `I can see that ${shop} is a store, but I don't have detailed category information available in the structured data. The store may need to generate collections data.`;
        }
        break;
        
      case 'contact':
        if (schemas.organization && schemas.organization.contactPoint) {
          const contact = schemas.organization.contactPoint;
          response = `For ${schemas.organization.name || shop}, you can contact them`;
          if (contact.telephone) {
            response += ` by phone at ${contact.telephone}`;
          }
          if (contact.email) {
            response += ` or by email at ${contact.email}`;
          }
          response += '.';
        } else {
          response = `I can see that ${shop} is a store, but I don't have contact information available in the structured data. The store may need to configure their organization schema with contact details.`;
        }
        break;
        
      default:
        response = 'I don\'t have enough information to provide a detailed response about this store.';
    }
    
    setAiSimulationResponse(response);
  };

  const loadSchemas = async () => {
    setLoading(true);
    try {
      debugLog('[SCHEMA-DATA] loadSchemas - shop:', shop);
      const url = `/api/schema/preview?shop=${encodeURIComponent(shop)}`;
      debugLog('[SCHEMA-DATA] loadSchemas - url:', url);
      const data = await api(url, { headers: { 'X-Shop': shop } });
      debugLog('[SCHEMA-DATA] loadSchemas - response:', data);
      if (data.ok) {
        setSchemas(data.schemas);
        generateSchemaScript(data.schemas);
      } else {
        setToastContent(`Error: ${data.error}`);
      }
    } catch (err) {
      console.error('[SCHEMA-DATA] loadSchemas - error:', err);
      setToastContent(`Failed to load schemas: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const generateSchemaScript = (schemaData) => {
    const allSchemas = [];
    
    if (schemaData.organization) {
      allSchemas.push(schemaData.organization);
    }
    
    if (schemaData.website) {
      allSchemas.push(schemaData.website);
    }
    
    // For products, we'll show instructions to use dynamic generation
    const script = `<script type="application/ld+json">
${JSON.stringify(allSchemas, null, 2)}
</script>`;
    
    setSchemaScript(script);
  };

  const handleRegenerate = async () => {
    setLoading(true);
    try {
      debugLog('[SCHEMA-DATA] handleRegenerate - shop:', shop);
      const url = `/api/schema/generate?shop=${encodeURIComponent(shop)}`;
      debugLog('[SCHEMA-DATA] handleRegenerate - url:', url);
      const data = await api(url, {
        method: 'POST',
        headers: { 'X-Shop': shop },
        body: { shop }
      });
      debugLog('[SCHEMA-DATA] handleRegenerate - response:', data);
      if (data.ok) {
        setToastContent('Schemas regenerated successfully!');
        loadSchemas();
      } else {
        setToastContent(`Error: ${data.error}`);
      }
    } catch (err) {
      console.error('[SCHEMA-DATA] handleRegenerate - error:', err);
      setToastContent(`Failed to regenerate: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: 'overview', content: 'Overview', accessibilityLabel: 'Overview' },
    { id: 'installation', content: 'Installation', accessibilityLabel: 'Installation' }
  ];

  if (loading) {
    return (
      <Card>
        <Box padding="400">
          <BlockStack gap="400" align="center">
            <Spinner />
            <Text>Loading schema data...</Text>
          </BlockStack>
        </Box>
      </Card>
    );
  }

  return (
    <>
      {/* Card 1: Structured Schema Data */}
      <Card>
        <Box padding="400">
          <BlockStack gap="400">
            <Text as="h3" variant="headingMd">Structured Schema Data</Text>
            
            <Banner tone="info">
              <Text>Structured data helps AI models understand your store content better, improving your visibility and search results.</Text>
            </Banner>

            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
              {selectedTab === 0 && (
                <Box paddingBlockStart="400">
                  <BlockStack gap="400">
                    {/* Organization Schema */}
                    <Card>
                      <Box padding="300">
                        <BlockStack gap="300">
                          <InlineStack align="space-between">
                            <Text as="h4" variant="headingSm">Organization Schema</Text>
                            <Badge tone={schemas.organization ? 'success' : 'warning'}>
                              {schemas.organization ? 'Active' : 'Not configured'}
                            </Badge>
                          </InlineStack>
                          
                          {!schemas.organization && (
                            <Text as="p" tone="subdued">
                              Configure organization details in Store Metadata to enable this schema.
                            </Text>
                          )}
                        </BlockStack>
                      </Box>
                    </Card>

                    {/* Website Schema */}
                    <Card>
                      <Box padding="300">
                        <BlockStack gap="300">
                          <InlineStack align="space-between">
                            <Text as="h4" variant="headingSm">WebSite Schema</Text>
                            <Badge tone={schemas.website ? 'success' : 'warning'}>
                              {schemas.website ? 'Active' : 'Not configured'}
                            </Badge>
                          </InlineStack>
                          
                          {!schemas.website && (
                            <Text as="p" tone="subdued">
                              Website schema is automatically generated from your store information.
                            </Text>
                          )}
                        </BlockStack>
                      </Box>
                    </Card>

                    {/* Product Schema Info */}
                    <Card>
                      <Box padding="300">
                        <BlockStack gap="300">
                          <InlineStack align="space-between">
                            <Text as="h4" variant="headingSm">Product Schemas</Text>
                            <Badge tone="success">Auto-generated</Badge>
                          </InlineStack>
                          
                          <Text tone="subdued">
                            Product schemas are automatically generated from your AI Optimisation data when pages load.
                            {schemas.products.length > 0 && ` ${schemas.products.length} products have SEO data.`}
                          </Text>

                          <Box paddingBlockStart="200">
                      <Button onClick={handleRegenerate} loading={loading}>
                              Regenerate Basic Schemas
                      </Button>
                          </Box>
                        </BlockStack>
                      </Box>
                    </Card>
                  </BlockStack>
                </Box>
              )}

              {selectedTab === 1 && (
                <Box paddingBlockStart="400">
                  <BlockStack gap="400">
                    <Banner tone="info">
                      <BlockStack gap="300">
                        <Text as="h4" variant="headingSm">Theme Installation</Text>
                        
                        <List type="number">
                          <List.Item>
                            Go to your Shopify Admin → Online Store → Themes
                          </List.Item>
                          <List.Item>
                            Click "Actions" → "Edit code" on your current theme
                          </List.Item>
                          <List.Item>
                            Open the file: <code>layout/theme.liquid</code>
                          </List.Item>
                          <List.Item>
                            Add this code before the closing <code>&lt;/head&gt;</code> tag:
                          </List.Item>
                        </List>
                      </BlockStack>
                    </Banner>

                    <Card>
                      <Box padding="300">
                        <BlockStack gap="300">
                          <Text as="h4" variant="headingSm">Code to Install</Text>

                          <Box background="bg-surface-secondary" padding="200" borderRadius="200">
                            <pre style={{ fontSize: '12px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
{`{%- comment -%} Advanced Schema Data - Auto-generated by indexAIze - Unlock AI Search {%- endcomment -%}

{%- comment -%} Organization & WebSite Schema (site-wide) {%- endcomment -%}
{%- if shop.metafields.advanced_schema.shop_schemas -%}
  <script type="application/ld+json">
{{ shop.metafields.advanced_schema.shop_schemas.value }}
  </script>
{%- endif -%}

{%- comment -%} Product Schema (product pages only) {%- endcomment -%}
{%- if product -%}
  {%- comment -%} Try Advanced Schema first (requires tokens/Enterprise plan) {%- endcomment -%}
  {%- assign schema_key = 'schemas_' | append: request.locale.iso_code -%}
  {%- assign schemas_json = product.metafields.advanced_schema[schema_key].value -%}
  {%- if schemas_json -%}
    <script type="application/ld+json">
{{ schemas_json }}
    </script>
  {%- else -%}
    {%- comment -%} Fallback to basic SEO JSON-LD (available for all plans) {%- endcomment -%}
    {%- assign seo_key = 'seo__' | append: request.locale.iso_code -%}
    {%- assign seo_data_json = product.metafields.seo_ai[seo_key].value | default: product.metafields.seo_ai.seo__en.value -%}
    {%- if seo_data_json -%}
      <script type="application/ld+json" id="seo-basic-jsonld-{{ product.id }}">
      </script>
      <script>
        (function() {
          try {
            var seoData = JSON.parse({{ seo_data_json | json }});
            if (seoData && seoData.jsonLd) {
              var scriptTag = document.getElementById('seo-basic-jsonld-{{ product.id }}');
              if (scriptTag) {
                scriptTag.textContent = JSON.stringify(seoData.jsonLd);
              }
            }
          } catch(e) {
            console.error('Failed to parse SEO JSON-LD:', e);
          }
        })();
      </script>
    {%- endif -%}
  {%- endif -%}
{%- endif -%}

{%- comment -%} Site-wide FAQ Schema {%- endcomment -%}
{%- if shop.metafields.advanced_schema.site_faq -%}
  <script type="application/ld+json">
{{ shop.metafields.advanced_schema.site_faq.value }}
  </script>
{%- endif -%}`}
                            </pre>
                          </Box>

                          <InlineStack align="end">
                            <Button 
                              onClick={() => {
                                const code = `{%- comment -%} Advanced Schema Data - Auto-generated by indexAIze - Unlock AI Search {%- endcomment -%}

{%- comment -%} Organization & WebSite Schema (site-wide) {%- endcomment -%}
{%- if shop.metafields.advanced_schema.shop_schemas -%}
  <script type="application/ld+json">
{{ shop.metafields.advanced_schema.shop_schemas.value }}
  </script>
{%- endif -%}

{%- comment -%} Product Schema (product pages only) {%- endcomment -%}
{%- if product -%}
  {%- comment -%} Try Advanced Schema first (requires tokens/Enterprise plan) {%- endcomment -%}
  {%- assign schema_key = 'schemas_' | append: request.locale.iso_code -%}
  {%- assign schemas_json = product.metafields.advanced_schema[schema_key].value -%}
  {%- if schemas_json -%}
    <script type="application/ld+json">
{{ schemas_json }}
    </script>
  {%- else -%}
    {%- comment -%} Fallback to basic SEO JSON-LD (available for all plans) {%- endcomment -%}
    {%- assign seo_key = 'seo__' | append: request.locale.iso_code -%}
    {%- assign seo_data_json = product.metafields.seo_ai[seo_key].value | default: product.metafields.seo_ai.seo__en.value -%}
    {%- if seo_data_json -%}
      <script type="application/ld+json" id="seo-basic-jsonld-{{ product.id }}">
      </script>
      <script>
        (function() {
          try {
            var seoData = JSON.parse({{ seo_data_json | json }});
            if (seoData && seoData.jsonLd) {
              var scriptTag = document.getElementById('seo-basic-jsonld-{{ product.id }}');
              if (scriptTag) {
                scriptTag.textContent = JSON.stringify(seoData.jsonLd);
              }
            }
          } catch(e) {
            console.error('Failed to parse SEO JSON-LD:', e);
          }
        })();
      </script>
    {%- endif -%}
  {%- endif -%}
{%- endif -%}

{%- comment -%} Site-wide FAQ Schema {%- endcomment -%}
{%- if shop.metafields.advanced_schema.site_faq -%}
  <script type="application/ld+json">
{{ shop.metafields.advanced_schema.site_faq.value }}
  </script>
{%- endif -%}`;
                                navigator.clipboard.writeText(code);
                                setToastContent('Code copied to clipboard!');
                              }}
                            >
                              Copy Code
                            </Button>
                          </InlineStack>

                          <Banner tone="warning">
                            <Text>Always backup your theme before making changes!</Text>
                          </Banner>
                        </BlockStack>
                      </Box>
                    </Card>

                    <Card>
                      <Box padding="300">
                        <BlockStack gap="300">
                          <Text as="h4" variant="headingSm">Testing Your Installation</Text>
                          
                          <List>
                            <List.Item>
                              After installation, visit your store's homepage and product pages
                            </List.Item>
                            <List.Item>
                              View the page source (right-click → View Source)
                            </List.Item>
                            <List.Item>
                              Search for <code>application/ld+json</code> to find your schemas
                            </List.Item>
                            <List.Item>
                              Use the Validation tab to test with Google's tools
                            </List.Item>
                          </List>
                        </BlockStack>
                      </Box>
                    </Card>
                  </BlockStack>
                </Box>
              )}

            </Tabs>
          </BlockStack>
        </Box>
      </Card>

      {/* Card 2: Advanced Schema Data */}
      <Box paddingBlockStart="400">
        <Card>
          <Box padding="400">
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Advanced Schema Data</Text>
              <Text variant="bodyMd" tone="subdued">
                Advanced schemas use artificial intelligence to generate rich, contextual data for each product. 
                This AI-enhanced structured data helps AI bots to understand your products deeply, resulting in 
                better visibility and more accurate recommendations.
              </Text>
              
              <Banner tone="info">
                <p>Generation creates BreadcrumbList, FAQPage, WebPage, Product and more schema types for each product. 
                These include AI-generated FAQs based on product features, navigation breadcrumbs for better context, 
                detailed product attributes (material, size, color), aggregate ratings, and semantic descriptions 
                that standard Shopify schemas don't provide.</p>
              </Banner>
              
              <InlineStack gap="300">
                <Button
                  loading={advancedSchemaStatus.inProgress}
                  disabled={advancedSchemaStatus.inProgress}
                  onClick={async () => {
                    try {
                      // First check if there's existing data
                      const existingData = await api(`/ai/schema-data.json?shop=${shop}`);
                      
                      if (existingData.schemas && existingData.schemas.length > 0) {
                        // Has data - ask if to regenerate
                        if (!confirm('This will replace existing schema data. Continue?')) {
                          return;
                        }
                      }
                      
                      // Call API to start background generation (WITHOUT forceBasicSeo first)
                      const data = await api(`/api/schema/generate-all?shop=${shop}`, {
                        method: 'POST',
                        body: { shop } // Do NOT send forceBasicSeo on first attempt
                      });
                      
                      // Show success toast
                      setToastContent('Generating Advanced Schema Data in background. You can navigate away safely & explore other features.');
                      
                      // Start polling for status updates
                      startAdvancedSchemaPolling();
                      
                    } catch (apiError) {
                      // Check for 402 error (payment/activation required)
                      if (apiError.status === 402) {
                        // Set error data for modals
                        setTokenError(apiError);
                        
                        // Show appropriate modal based on error type
                        if (apiError.trialRestriction && apiError.requiresActivation) {
                          setShowTrialActivationModal(true);
                        } else if (apiError.requiresPurchase) {
                          setShowInsufficientTokensModal(true);
                        } else {
                          setToastContent('Advanced Schema Data requires activation or token purchase.');
                        }
                        return;
                      }
                      
                      // Check for schema-specific errors (NO_OPTIMIZED_PRODUCTS, ONLY_BASIC_SEO)
                      if (apiError.message?.includes('NO_OPTIMIZED_PRODUCTS') || apiError.error?.includes('NO_OPTIMIZED_PRODUCTS')) {
                        setSchemaErrorType('NO_OPTIMIZED_PRODUCTS');
                        setShowSchemaErrorModal(true);
                        return;
                      }
                      
                      if (apiError.message?.includes('ONLY_BASIC_SEO') || apiError.error?.includes('ONLY_BASIC_SEO')) {
                        setSchemaErrorType('ONLY_BASIC_SEO');
                        setShowSchemaErrorModal(true);
                        return;
                      }
                      
                      // Other errors
                      console.error('[SCHEMA-GEN] Error:', apiError);
                      setToastContent('Failed to generate schema: ' + (apiError.message || 'Unknown error'));
                    }
                  }}
                >
                  Generate/Update Schema Data
                </Button>
                
                <Button
                  onClick={() => {
                    window.open(`/ai/schema-data.json?shop=${shop}`, '_blank');
                  }}
                  disabled={advancedSchemaStatus.inProgress}
                >
                  View Generated Schema
                </Button>
                
                <Button
                  tone="critical"
                  disabled={advancedSchemaStatus.inProgress}
                  onClick={async () => {
                    if (confirm('This will delete all advanced schema data. Are you sure?')) {
                      try {
                        await api(`/api/schema/delete?shop=${shop}`, {
                          method: 'DELETE',
                          body: { shop }
                        });
                        
                        setToastContent('Schema data deleted successfully');
                        // Reset status
                        setAdvancedSchemaStatus({
                          inProgress: false,
                          status: 'idle',
                          message: null,
                          position: null,
                          estimatedTime: null,
                          generatedAt: null,
                          schemaCount: 0
                        });
                      } catch (err) {
                        setToastContent('Failed to delete schema data');
                      }
                    }
                  }}
                >
                  Delete Schema Data
                </Button>
              </InlineStack>
              
              {/* Progress indicator while generating */}
              {advancedSchemaStatus.inProgress && (
                <Box paddingBlockStart="400">
                  <BlockStack gap="300">
                    {/* Progress bar - using Polaris ProgressBar for consistency */}
                    {advancedSchemaStatus.progress?.total > 0 && (
                      <ProgressBar 
                        progress={advancedSchemaStatus.progress?.percent || 0} 
                        size="small" 
                      />
                    )}
                    
                    <InlineStack gap="200" blockAlign="center" align="space-between">
                      <InlineStack gap="200" blockAlign="center">
                        <Spinner size="small" />
                        <Text variant="bodyMd" tone="subdued">
                          {advancedSchemaStatus.message || 'Generating Advanced Schema Data...'}
                        </Text>
                      </InlineStack>
                      
                      {/* Time remaining */}
                      {advancedSchemaStatus.progress?.remainingSeconds > 0 && (
                        <Text variant="bodySm" tone="subdued">
                          {advancedSchemaStatus.progress.remainingSeconds >= 60 
                            ? `~${Math.ceil(advancedSchemaStatus.progress.remainingSeconds / 60)} min remaining`
                            : `~${advancedSchemaStatus.progress.remainingSeconds} sec remaining`
                          }
                        </Text>
                      )}
                    </InlineStack>
                    
                    {/* Progress details */}
                    {advancedSchemaStatus.progress?.total > 0 && (
                      <Text variant="bodySm" tone="subdued">
                        {advancedSchemaStatus.progress.current || 0} / {advancedSchemaStatus.progress.total} products ({advancedSchemaStatus.progress.percent || 0}%)
                      </Text>
                    )}
                    
                    {advancedSchemaStatus.position > 0 && (
                      <Text variant="bodySm" tone="subdued">
                        Queue position: {advancedSchemaStatus.position}
                      </Text>
                    )}
                  </BlockStack>
                </Box>
              )}
              
              {/* Completion status */}
              {!advancedSchemaStatus.inProgress && advancedSchemaStatus.status === 'completed' && advancedSchemaStatus.generatedAt && (
                <Box paddingBlockStart="200">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="success">Generated</Badge>
                    <Text variant="bodySm" tone="subdued">
                      {advancedSchemaStatus.schemaCount} schemas · {(() => {
                        const now = new Date();
                        const generated = new Date(advancedSchemaStatus.generatedAt);
                        const diff = Math.floor((now - generated) / 1000 / 60);
                        if (diff < 1) return 'Just now';
                        if (diff < 60) return `${diff} min ago`;
                        const hours = Math.floor(diff / 60);
                        if (hours < 24) return `${hours}h ago`;
                        const days = Math.floor(hours / 24);
                        return `${days}d ago`;
                      })()}
                    </Text>
                  </InlineStack>
                </Box>
              )}
              
              {/* Rich Attributes Options */}
              <Card>
                <Box padding="300">
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingSm">Rich Product Attributes</Text>
                        <Text variant="bodyMd" tone="subdued">
                          Select which AI-generated attributes to include in product schemas
                        </Text>
                      </BlockStack>
                      <Button
                        size="slim"
                        onClick={saveRichAttributes}
                        loading={savingAttributes}
                      >
                        Save Attributes
                      </Button>
                    </InlineStack>
                    
                    <InlineGrid columns={2} gap="400">
                      {[
                        { key: 'material', label: 'Material', description: 'Product material (cotton, leather, metal, etc.)' },
                        { key: 'color', label: 'Color', description: 'Product color information' },
                        { key: 'size', label: 'Size', description: 'Product size or dimensions' },
                        { key: 'weight', label: 'Weight', description: 'Product weight information' },
                        { key: 'dimensions', label: 'Dimensions', description: 'Product measurements' },
                        { key: 'category', label: 'Category', description: 'Product category classification' },
                        { key: 'audience', label: 'Target Audience', description: 'Intended user group (men, women, kids, etc.)' },
                        { key: 'reviews', label: 'Review Schemas', description: 'AI-generated product reviews for schema.org' },
                        { key: 'ratings', label: 'Rating Schemas', description: 'AI-generated ratings and aggregate ratings' },
                        { key: 'enhancedDescription', label: 'Enhanced Descriptions', description: 'AI-enhanced product descriptions' },
                        { key: 'organization', label: 'Organization Schema', description: 'Brand organization information' }
                      ].map(attr => (
                        <Checkbox
                          key={attr.key}
                          label={attr.label}
                          helpText={attr.description}
                          checked={richAttributes[attr.key] || false}
                          onChange={(checked) => {
                            setRichAttributes(prev => ({
                              ...prev,
                              [attr.key]: checked
                            }));
                          }}
                        />
                      ))}
                    </InlineGrid>
                  </BlockStack>
                </Box>
              </Card>
            </BlockStack>
          </Box>
        </Card>
      </Box>

      {toastContent && (
        <Toast content={toastContent} onDismiss={() => setToastContent('')} />
      )}
      
      {/* Upgrade Modal */}
      <UpgradeModal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        feature={upgradeModalData.feature}
        currentPlan={upgradeModalData.currentPlan}
        requiredPlan={upgradeModalData.requiredPlan}
        returnTo="/ai-seo/schema-data"
      />
      
      {/* Trial Activation Modal */}
      <TrialActivationModal
        open={showTrialActivationModal}
        onClose={() => setShowTrialActivationModal(false)}
        onActivatePlan={handleActivatePlan}
        onPurchaseTokens={() => {
          setShowTrialActivationModal(false);
          setShowTokenPurchaseModal(true);
        }}
        feature="ai-schema-advanced"
        trialEndsAt={subscriptionInfo?.trialEndsAt || tokenError?.trialEndsAt}
        currentPlan={currentPlan || tokenError?.currentPlan || 'Enterprise'}
        tokensRequired={tokenError?.tokensRequired || estimateTokens('ai-schema-advanced', { productCount }).withMargin}
      />
      
      {/* Insufficient Tokens Modal */}
      <InsufficientTokensModal
        open={showInsufficientTokensModal}
        onClose={() => setShowInsufficientTokensModal(false)}
        onBuyTokens={() => {
          setShowInsufficientTokensModal(false);
          setShowTokenPurchaseModal(true);
        }}
        feature="ai-schema-advanced"
        tokensRequired={tokenError?.tokensRequired || 0}
        tokensAvailable={tokenError?.tokensAvailable || 0}
        tokensNeeded={tokenError?.tokensNeeded || tokenError?.tokensRequired || 0}
      />
      
      {/* Token Purchase Modal */}
      <TokenPurchaseModal
        open={showTokenPurchaseModal}
        onClose={() => setShowTokenPurchaseModal(false)}
        shop={shop}
        tokensNeeded={tokenError?.tokensNeeded || 0}
        returnTo="/ai-seo/schema-data"
      />
      
      {/* Schema Error Modal - No Optimized Products (1:1 from Settings.jsx) */}
      {showSchemaErrorModal && schemaErrorType === 'NO_OPTIMIZED_PRODUCTS' && (
        <Modal
          open={true}
          title="No Optimized Products Found"
          onClose={async () => {
            setShowSchemaErrorModal(false);
            setSchemaErrorType(null);
            // Dismiss the error in backend so it doesn't show again on page reload
            try {
              await api(`/api/schema/dismiss-error?shop=${shop}`, { method: 'POST' });
            } catch (e) { /* ignore */ }
          }}
          primaryAction={{
            content: 'Go to Search Optimization',
            onAction: async () => {
              setShowSchemaErrorModal(false);
              setSchemaErrorType(null);
              // Dismiss the error in backend
              try {
                await api(`/api/schema/dismiss-error?shop=${shop}`, { method: 'POST' });
              } catch (e) { /* ignore */ }
              // Navigate to AISEO generation page with current params (embedded=1, shop, host, etc.)
              const currentParams = new URLSearchParams(window.location.search);
              const paramString = currentParams.toString() ? `?${currentParams.toString()}` : '';
              window.location.href = `/ai-seo${paramString}`;
            }
          }}
          secondaryActions={[{
            content: 'Cancel',
            onAction: async () => {
              setShowSchemaErrorModal(false);
              setSchemaErrorType(null);
              // Dismiss the error in backend
              try {
                await api(`/api/schema/dismiss-error?shop=${shop}`, { method: 'POST' });
              } catch (e) { /* ignore */ }
            }
          }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Banner tone="warning">
                <p>No optimized products were found in your store.</p>
              </Banner>
              
              <Text>
                Advanced Schema Data requires at least basic AISEO optimization on your products. 
                Please run AISEO optimization first, then try generating schemas again.
              </Text>
              
              <Text variant="bodyMd" fontWeight="semibold">
                You can choose:
              </Text>
              <BlockStack gap="200">
                <Text>• <strong>Basic AISEO</strong> - Free AISEO optimization</Text>
                <Text>• <strong>AI-Enhanced AISEO</strong> - Advanced optimization (requires tokens)</Text>
              </BlockStack>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {/* Schema Error Modal - Only Basic SEO (1:1 from Settings.jsx) */}
      {showSchemaErrorModal && schemaErrorType === 'ONLY_BASIC_SEO' && (
        <Modal
          open={true}
          title="AI-Enhanced Optimization Recommended"
          onClose={async () => {
            setShowSchemaErrorModal(false);
            setSchemaErrorType(null);
            // Dismiss the error in backend so it doesn't show again on page reload
            try {
              await api(`/api/schema/dismiss-error?shop=${shop}`, { method: 'POST' });
            } catch (e) { /* ignore */ }
          }}
          primaryAction={{
            content: 'Generate AI-Enhanced Add-ons',
            onAction: async () => {
              setShowSchemaErrorModal(false);
              setSchemaErrorType(null);
              // Dismiss the error in backend
              try {
                await api(`/api/schema/dismiss-error?shop=${shop}`, { method: 'POST' });
              } catch (e) { /* ignore */ }
              // Navigate to AISEO generation page with current params (embedded=1, shop, host, etc.)
              const currentParams = new URLSearchParams(window.location.search);
              const paramString = currentParams.toString() ? `?${currentParams.toString()}` : '';
              window.location.href = `/ai-seo${paramString}`;
            }
          }}
          secondaryActions={[{
            content: 'Proceed with Basic AISEO',
            onAction: async () => {
              // Close modal first
              setShowSchemaErrorModal(false);
              setSchemaErrorType(null);
              
              // Trigger schema generation with forceBasicSeo flag
              try {
                setToastContent('Starting schema generation with basic AISEO...');
                
                await api(`/api/schema/generate-all?shop=${shop}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ forceBasicSeo: true })
                });
                
                // Start polling for status updates (new background queue approach)
                startAdvancedSchemaPolling();
              } catch (err) {
                console.error('[SCHEMA-GEN] Error:', err);
                setToastContent('Failed to generate schema: ' + (err.message || 'Unknown error'));
              }
            }
          }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Banner tone="info">
                <p>Only basic AISEO optimization was found on your products.</p>
              </Banner>
              
              <Text>
                For best results with Advanced Schema Data, we recommend running AI-Enhanced 
                AISEO optimization first. This will provide richer product data for schema generation.
              </Text>
              
              <Text variant="bodyMd" fontWeight="semibold">
                What would you like to do?
              </Text>
              <BlockStack gap="200">
                <Text>• <strong>Generate AI-Enhanced Add-ons</strong> - Get the best results (requires tokens)</Text>
                <Text>• <strong>Proceed with Basic AISEO</strong> - Continue with current basic AISEO</Text>
              </BlockStack>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
      
    </>
  );
}