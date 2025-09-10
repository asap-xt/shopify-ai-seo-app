import React, { useEffect, useState, useMemo } from 'react';
import { useAppBridge } from '@shopify/app-bridge-react';
import { Card, Page, RadioButton, Button, BlockStack, Text } from '@shopify/polaris';
import { makeApiFetch } from '../lib/apiFetch.js';

const plans = [
  { key: 'starter',   label: 'Starter ($10/mo)' },
  { key: 'professional', label: 'Professional ($39/mo)' },
  { key: 'growth',    label: 'Growth ($59/mo)' },
  { key: 'growth_extra', label: 'Growth Extra ($119/mo)' },
  { key: 'enterprise', label: 'Enterprise ($299/mo)' },
];

export default function Billing({ i18n, shop }) {
  const app = useAppBridge();
  const api = useMemo(() => makeApiFetch(app), [app]);
  const [current, setCurrent] = useState('starter');
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState(null);

  useEffect(() => {
    api('/billing/plan', { shop }).then(p => setCurrent(p.plan || 'starter')).catch(()=>{});
  }, [api, shop]);

  async function changePlan() {
    setLoading(true);
    setResp(null);
    try {
      const res = await api('/billing/subscribe', { method: 'POST', body: { plan: current }, shop });
      setResp(res);
    } catch (e) {
      setResp({ error: e.message || String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Page title={i18n.billing.title}>
      <Card>
        <BlockStack gap="300">
          <Text>{i18n.billing.choose}</Text>
          {plans.map(p => (
            <RadioButton
              key={p.key}
              label={p.label}
              checked={current === p.key}
              id={p.key}
              name="plan"
              onChange={() => setCurrent(p.key)}
            />
          ))}
          <Button variant="primary" loading={loading} onClick={changePlan}>
            {i18n.billing.activate}
          </Button>
          {resp && (
            <pre style={{whiteSpace:'pre-wrap', background:'#f6f6f7', padding:12, borderRadius:6}}>
              {JSON.stringify(resp, null, 2)}
            </pre>
          )}
        </BlockStack>
      </Card>
    </Page>
  );
}
