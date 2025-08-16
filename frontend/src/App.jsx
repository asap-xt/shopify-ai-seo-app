// frontend/src/App.jsx
// Embedded UI with Generate + Preview/JSON + Apply to product.
// Comments in English.

import React, { useEffect, useMemo, useState } from "react";
import {
  AppProvider,
  Page,
  Card,
  TextField,
  Select,
  Button,
  Tabs,
  InlineStack,
  BlockStack,
  Text,
  Divider,
  Toast,
  Frame,
  Badge,
  Link,
} from "@shopify/polaris";
import { getIdToken } from "./session.js";

const PROVIDER_LABELS = [
  { label: "OpenAI", value: "openai" },
  { label: "Claude", value: "claude" }, // vendor 'anthropic'
  { label: "Gemini", value: "gemini" }, // vendor 'google'
];

function vendorFromProvider(p) {
  if (p === "claude") return "anthropic";
  if (p === "gemini") return "google";
  return p;
}

function gidFromMaybeNumeric(s) {
  const v = String(s || "").trim();
  if (!v) return "";
  if (/^gid:\/\//.test(v)) return v;
  if (/^\d+$/.test(v)) return `gid://shopify/Product/${v}`;
  return v;
}

function numericIdFromGid(gid) {
  const m = String(gid || "").match(/Product\/(\d+)$/);
  return m ? m[1] : "";
}

export default function App() {
  const [shop, setShop] = useState("");
  const [plans, setPlans] = useState(null);
  const [loadingPlans, setLoadingPlans] = useState(false);

  const [productIdInput, setProductIdInput] = useState("");
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");
  const [language, setLanguage] = useState("en");

  const [genLoading, setGenLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);

  const [result, setResult] = useState(null);
  const [tab, setTab] = useState(0);

  const [toast, setToast] = useState({ open: false, msg: "", link: "" });

  // Load plan info
  useEffect(() => {
    (async () => {
      try {
        setLoadingPlans(true);
        const token = await getIdToken();
        const rsp = await fetch("/plans/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await rsp.json();
        setPlans(json);
        setShop(json?.shop || "");
        const allowed = json?.providersAllowed || [];
        const initialProvider = allowed.includes("openai")
          ? "openai"
          : allowed.includes("claude")
          ? "claude"
          : allowed.includes("gemini")
          ? "gemini"
          : "openai";
        setProvider(initialProvider);
      } catch (e) {
        console.error("plans/me failed", e);
      } finally {
        setLoadingPlans(false);
      }
    })();
  }, []);

  // Auto-pick a model from plan suggestions
  useEffect(() => {
    const vendor = vendorFromProvider(provider);
    const models = plans?.modelsSuggested || [];
    const picked =
      models.find((m) => m.startsWith(`${vendor}/`)) || models[0] || "";
    setModel(picked);
  }, [provider, plans]);

  const canGenerate = useMemo(() => !!gidFromMaybeNumeric(productIdInput), [productIdInput]);
  const canApply = useMemo(() => !!(result?.seo && result?.productId), [result]);

  async function onGenerate() {
    try {
      setGenLoading(true);
      const token = await getIdToken();
      const body = {
        productId: gidFromMaybeNumeric(productIdInput),
        language,
      };
      if (model) body.model = model;
      const rsp = await fetch("/seo/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const json = await rsp.json();
      if (!rsp.ok) throw new Error(json?.error || "Generate failed");
      setResult(json);
      setTab(0);
    } catch (e) {
      console.error(e);
      setToast({ open: true, msg: `Generate error: ${e.message}`, link: "" });
    } finally {
      setGenLoading(false);
    }
  }

  async function onApply() {
    try {
      setApplyLoading(true);
      const token = await getIdToken();
      const body = {
        productId: result?.productId,
        seo: result?.seo,
        options: {
          updateTitle: true,
          updateBody: true,
          updateSeo: true,
          updateBullets: true,
          updateFaq: true,
          updateAlt: false,
          dryRun: false,
        },
      };
      const rsp = await fetch("/seo/apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const json = await rsp.json();
      if (!rsp.ok) throw new Error(json?.error || "Apply failed");
      const numericId = numericIdFromGid(result?.productId);
      const adminLink =
        shop && numericId
          ? `https://${shop}/admin/products/${numericId}`
          : "";
      setToast({ open: true, msg: "Applied ✓", link: adminLink });
    } catch (e) {
      console.error(e);
      setToast({ open: true, msg: `Apply error: ${e.message}`, link: "" });
    } finally {
      setApplyLoading(false);
    }
  }

  const tabs = [
    { id: "preview", content: "Preview", panelID: "preview-panel" },
    { id: "json", content: "JSON", panelID: "json-panel" },
  ];

  function Preview() {
    const seo = result?.seo;
    if (!seo) return <Text as="p" tone="subdued">No result yet.</Text>;
    return (
      <BlockStack gap="400">
        <div
          style={{ padding: "8px 0" }}
          dangerouslySetInnerHTML={{ __html: seo.bodyHtml || "" }}
        />
        <Divider />
        <Text as="h3" variant="headingMd">Bullets</Text>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {(seo.bullets || []).map((b, i) => <li key={i}>{b}</li>)}
        </ul>
        <Divider />
        <Text as="h3" variant="headingMd">FAQ</Text>
        <BlockStack gap="200">
          {(seo.faq || []).map((qa, i) => (
            <div key={i}>
              <Text as="p" variant="headingSm">{qa.q}</Text>
              <Text as="p">{qa.a}</Text>
            </div>
          ))}
        </BlockStack>
      </BlockStack>
    );
  }

  function JsonView() {
    return (
      <pre
        style={{
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          background: "#f6f6f7",
          padding: 12,
          borderRadius: 8,
          border: "1px solid #eee",
        }}
      >
        {JSON.stringify(result, null, 2)}
      </pre>
    );
  }

  return (
    <AppProvider i18n={{}}>
      <Frame>
        <Page title="AI SEO (v2)">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="400" align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingLg">Generate SEO</Text>
                  {plans?.plan ? <Badge tone="success">{plans.plan}</Badge> : null}
                </InlineStack>

                <InlineStack gap="400" wrap={false}>
                  <div style={{ minWidth: 260, flex: "1 1 260px" }}>
                    <TextField
                      label="Product ID"
                      value={productIdInput}
                      onChange={setProductIdInput}
                      placeholder="e.g. 14963354272076 or gid://shopify/Product/…"
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ minWidth: 220 }}>
                    <Select
                      label="AI Provider"
                      options={PROVIDER_LABELS.filter((opt) =>
                        (plans?.providersAllowed || []).includes(opt.value)
                      )}
                      onChange={setProvider}
                      value={provider}
                    />
                  </div>
                  <div style={{ minWidth: 280 }}>
                    <TextField
                      label="Model (auto-picked)"
                      value={model}
                      onChange={setModel}
                      autoComplete="off"
                      helpText="Picked from your plan's allowed models. You can override."
                    />
                  </div>
                </InlineStack>

                <InlineStack gap="300">
                  <TextField
                    label="Language"
                    value={language}
                    onChange={setLanguage}
                    autoComplete="off"
                    helpText="en, de, es, fr…"
                  />
                </InlineStack>

                <InlineStack gap="400">
                  <Button
                    variant="primary"
                    onClick={onGenerate}
                    loading={genLoading || loadingPlans}
                    disabled={!canGenerate || loadingPlans}
                  >
                    Generate
                  </Button>
                  <Button onClick={onApply} loading={applyLoading} disabled={!canApply}>
                    Apply to product
                  </Button>
                  {result?.productId ? (
                    <Text as="span">
                      Product:&nbsp;<code>{result.productId}</code>
                    </Text>
                  ) : null}
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <Tabs tabs={tabs} selected={tab} onSelect={setTab}>
                <Card.Section>
                  {tab === 0 ? <Preview /> : <JsonView />}
                </Card.Section>
              </Tabs>
            </Card>

            {toast.open ? (
              <Toast
                content={
                  toast.link ? (
                    <span>
                      {toast.msg} —{" "}
                      <Link url={toast.link} external>
                        View product in Admin
                      </Link>
                    </span>
                  ) : (
                    toast.msg
                  )
                }
                onDismiss={() => setToast({ open: false, msg: "", link: "" })}
              />
            ) : null}
          </BlockStack>
        </Page>
      </Frame>
    </AppProvider>
  );
}
