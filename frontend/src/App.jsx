import React, { useMemo } from 'react';
import {
  Frame,
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Divider,
  InlineStack,
  Button,
} from '@shopify/polaris';
import { TitleBar, NavMenu } from '@shopify/app-bridge-react';
import useI18n from './hooks/useI18n.js';

// Определяме коя страница е активна според пътя
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

// --- Секции (примерно съдържание) ---
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
            <InlineStack gap="300">
              <Button variant="primary">{t('seo.generate')}</Button>
            </InlineStack>
            <Text tone="subdued">{t('seo.productId')}: 123456789 • {t('seo.provider')}: OpenAI</Text>
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
            <InlineStack gap="300">
              <Button variant="primary">{t('billing.activate')}</Button>
            </InlineStack>
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
      {/* 1) Това заглавие влиза в горния Admin бар */}
      <TitleBar title={title} />

      {/* 2) ТОВА е ключът: NavMenu -> прави „лявото меню“ под името на аппа в Shopify */}
      <NavMenu>
        {/* Първият елемент е задължителен: rel="home" към root, НЕ се показва като линк */}
        <a rel="home" href="/">Home</a>

        {/* Реални линкове, ПРЯКО РОДНИ НА app root (без абсолютни домейни) */}
        <a href="/dashboard">{t('nav.dashboard', 'Dashboard')}</a>
        <a href="/ai-seo">{t('nav.seo', 'AI SEO')}</a>
        <a href="/billing">{t('nav.billing', 'Billing')}</a>
        <a href="/settings">{t('nav.settings', 'Settings')}</a>
      </NavMenu>

      {/* Вече НЕ подаваме Polaris navigation=<...>; Shopify показва менюто в глобалната лява навигация */}
      <Frame>
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
