import React, { useMemo } from 'react';
import { Frame, Page, Layout, Card, BlockStack, Text, Divider } from '@shopify/polaris';
import { TitleBar } from '@shopify/app-bridge-react';
import SideNav from './components/SideNav.jsx';
import TopNav from './components/TopNav.jsx';
import useI18n from './hooks/useI18n.js';

function useRoute(t) {
  const path = (typeof window !== 'undefined' ? window.location.pathname : '/') || '/';

  return useMemo(() => {
    if (path === '/' || path.startsWith('/dashboard')) {
      return { key: 'dashboard', title: t('nav.dashboard', 'Dashboard') };
    }
    if (path.startsWith('/ai-seo')) {
      return { key: 'seo', title: t('nav.seo', 'AI SEO') };
    }
    if (path.startsWith('/billing')) {
      return { key: 'billing', title: t('nav.billing', 'Billing') };
    }
    if (path.startsWith('/settings')) {
      return { key: 'settings', title: t('nav.settings', 'Settings') };
    }
    return { key: 'dashboard', title: t('nav.dashboard', 'Dashboard') };
  }, [path, t]);
}

function Dashboard({ t }) {
  return (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">{t('dashboard.plan')}</Text>
            <Divider />
            <Text>{t('dashboard.shop')}: My Test Shop</Text>
            <Text>{t('dashboard.queries')}: 120</Text>
            <Text>{t('dashboard.products')}: 50</Text>
            <Text>{t('dashboard.providers')}: OpenAI, Claude</Text>
            <Text>{t('dashboard.trial')}: 2025-09-01</Text>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}

function Seo({ t }) {
  return (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">{t('seo.title')}</Text>
            <Divider />
            <Text>{t('seo.productId')}: 123456789</Text>
            <Text>{t('seo.provider')}: OpenAI</Text>
            <Text>{t('seo.generate')}</Text>
            <Text>{t('seo.result')}: —</Text>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}

function Billing({ t }) {
  return (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">{t('billing.title')}</Text>
            <Divider />
            <Text>{t('billing.choose')}</Text>
            <Text>{t('billing.activate')}</Text>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}

function Settings({ t }) {
  return (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">{t('settings.title')}</Text>
            <Divider />
            <Text>{t('settings.languageInfo')}</Text>
            <Text>{t('settings.notes')}</Text>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}

export default function App() {
  const { lang, setLang, t } = useI18n();
  const { key, title } = useRoute(t);

  return (
    <>
      <TitleBar title={title} />
      <Frame
        topBar={<TopNav lang={lang} setLang={setLang} t={t} />}
        navigation={<SideNav t={t} />}
      >
        <Page title={title} fullWidth>
          {key === 'dashboard' && <Dashboard t={t} />}
          {key === 'seo' && <Seo t={t} />}
          {key === 'billing' && <Billing t={t} />}
          {key === 'settings' && <Settings t={t} />}
        </Page>
      </Frame>
    </>
  );
}
