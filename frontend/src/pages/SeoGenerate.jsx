import React, { useEffect, useMemo, useState } from 'react';
import { Card, Page, TextField, Button, Select, BlockStack, Text } from '@shopify/polaris';
import { useShopApi } from '../hooks/useShopApi.js';

export default function SeoGenerate({ i18n, shop }) {
  const { api } = useShopApi();

  const [plan, setPlan] = useState(null);
  const [productId, setProductId] = useState('123456');
  const [provider, setProvider] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get('/billing/plan').then((p) => {
      setPlan(p);
      setProvider(p.aiProviders?.[0] || '');
    }).catch(() => {});
  }, []);

  const providerOptions = useMemo(() =>
    (plan?.aiProviders || []).map(p => ({label: p, value: p})),
  [plan]);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const res = await api.post(`/seo/product/${productId}`, { provider });
      setResult(res);
    } catch (e) {
      setResult({ error: e.message || String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Page title={i18n.seo.title}>
      <Card>
        <BlockStack gap="300">
          <TextField
            label={i18n.seo.productId}
            value={productId}
            onChange={setProductId}
            autoComplete="off"
          />
          <Select
            label={i18n.seo.provider}
            options={providerOptions}
            value={provider}
            onChange={setProvider}
          />
          <Button variant="primary" loading={loading} onClick={run}>
            {i18n.seo.generate}
          </Button>
          {result && (
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">{i18n.seo.result}</Text>
              <pre style={{whiteSpace:'pre-wrap', background:'#f6f6f7', padding:12, borderRadius:6}}>
                {JSON.stringify(result, null, 2)}
              </pre>
            </BlockStack>
          )}
        </BlockStack>
      </Card>
    </Page>
  );
}
