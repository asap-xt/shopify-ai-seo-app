import{j as e}from"./app-bridge-Fo62qlme-1763505685347.js";import{r as d}from"./react-vendor-tAaa2TlE-1763505685347.js";import{m as L}from"./sessionFetch-DQ3nU5B_-1763505685347.js";import"./usePlanHierarchy-BjUEvxZF-1763505685347.js";import{C as p,B as o,a as i,n as z,T as n,d as x,s as N,I as m,f as _,b as v,t as c,k as P}from"./polaris-WbI7Imfh-1763505685347.js";import"./index-BzXXAqZu-1763505685347.js";const T=(u,t="")=>{try{return new URLSearchParams(window.location.search).get(u)||t}catch{return t}},l=(...u)=>{};function V({shop:u}){const t=u||T("shop","");l('[SCHEMA-DATA] qs("shop"):',T("shop",""));const[y,k]=d.useState(0),[A,g]=d.useState(!0),[r,C]=d.useState({organization:null,website:null,products:[]}),[b,h]=d.useState(""),j=d.useMemo(()=>L(),[]),[H,D]=d.useState(""),[R,E]=d.useState(null);d.useEffect(()=>{t&&(w(),I())},[t,j]);const I=async()=>{var s,a;try{const f=await j("/graphql",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:`
        query PlansMe($shop:String!) {
          plansMe(shop:$shop) {
            shop
            plan
            planKey
          }
        }
      `,variables:{shop:t}})});l("[SCHEMA-DATA] Plan data:",f),E((a=(s=f==null?void 0:f.data)==null?void 0:s.plansMe)==null?void 0:a.plan)}catch(S){console.error("[SCHEMA-DATA] Error loading plan:",S)}},w=async()=>{g(!0);try{l("[SCHEMA-DATA] loadSchemas - shop:",t);const s=`/api/schema/preview?shop=${encodeURIComponent(t)}`;l("[SCHEMA-DATA] loadSchemas - url:",s);const a=await j(s,{headers:{"X-Shop":t}});l("[SCHEMA-DATA] loadSchemas - response:",a),a.ok?(C(a.schemas),O(a.schemas)):h(`Error: ${a.error}`)}catch(s){console.error("[SCHEMA-DATA] loadSchemas - error:",s),h(`Failed to load schemas: ${s.message}`)}finally{g(!1)}},O=s=>{const a=[];s.organization&&a.push(s.organization),s.website&&a.push(s.website);const S=`<script type="application/ld+json">
${JSON.stringify(a,null,2)}
<\/script>`;D(S)},M=async()=>{g(!0);try{l("[SCHEMA-DATA] handleRegenerate - shop:",t);const s=`/api/schema/generate?shop=${encodeURIComponent(t)}`;l("[SCHEMA-DATA] handleRegenerate - url:",s);const a=await j(s,{method:"POST",headers:{"X-Shop":t},body:{shop:t}});l("[SCHEMA-DATA] handleRegenerate - response:",a),a.ok?(h("Schemas regenerated successfully!"),w()):h(`Error: ${a.error}`)}catch(s){console.error("[SCHEMA-DATA] handleRegenerate - error:",s),h(`Failed to regenerate: ${s.message}`)}finally{g(!1)}},q=[{id:"overview",content:"Overview",accessibilityLabel:"Overview"},{id:"installation",content:"Installation",accessibilityLabel:"Installation"}];return A?e.jsx(p,{children:e.jsx(o,{padding:"400",children:e.jsxs(i,{gap:"400",align:"center",children:[e.jsx(z,{}),e.jsx(n,{children:"Loading schema data..."})]})})}):e.jsxs(e.Fragment,{children:[e.jsx(p,{children:e.jsx(o,{padding:"400",children:e.jsxs(i,{gap:"400",children:[e.jsx(n,{as:"h3",variant:"headingMd",children:"Schema.org Structured Data"}),e.jsx(x,{tone:"info",children:e.jsx(n,{children:"Schema.org structured data helps AI models understand your store content better, improving your visibility and search results."})}),e.jsxs(N,{tabs:q,selected:y,onSelect:k,children:[y===0&&e.jsx(o,{paddingBlockStart:"400",children:e.jsxs(i,{gap:"400",children:[e.jsx(p,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsxs(m,{align:"space-between",children:[e.jsx(n,{as:"h4",variant:"headingSm",children:"Organization Schema"}),e.jsx(_,{tone:r.organization?"success":"warning",children:r.organization?"Active":"Not configured"})]}),!r.organization&&e.jsx(n,{as:"p",tone:"subdued",children:"Configure organization details in Store Metadata to enable this schema."})]})})}),e.jsx(p,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsxs(m,{align:"space-between",children:[e.jsx(n,{as:"h4",variant:"headingSm",children:"WebSite Schema"}),e.jsx(_,{tone:r.website?"success":"warning",children:r.website?"Active":"Not configured"})]}),!r.website&&e.jsx(n,{as:"p",tone:"subdued",children:"Website schema is automatically generated from your store information."})]})})}),e.jsx(p,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsxs(m,{align:"space-between",children:[e.jsx(n,{as:"h4",variant:"headingSm",children:"Product Schemas"}),e.jsx(_,{tone:"success",children:"Auto-generated"})]}),e.jsxs(n,{tone:"subdued",children:["Product schemas are automatically generated from your AI Optimisation data when pages load.",r.products.length>0&&` ${r.products.length} products have SEO data.`]})]})})}),e.jsxs(m,{gap:"300",children:[e.jsx(v,{onClick:M,loading:A,children:"Regenerate Schemas"}),e.jsx(v,{variant:"plain",url:"https://developers.google.com/search/docs/appearance/structured-data",children:"Learn about Schema.org"})]})]})}),y===1&&e.jsx(o,{paddingBlockStart:"400",children:e.jsxs(i,{gap:"400",children:[e.jsx(x,{tone:"info",children:e.jsxs(i,{gap:"300",children:[e.jsx(n,{as:"h4",variant:"headingSm",children:"Theme Installation"}),e.jsxs(c,{type:"number",children:[e.jsx(c.Item,{children:"Go to your Shopify Admin → Online Store → Themes"}),e.jsx(c.Item,{children:'Click "Actions" → "Edit code" on your current theme'}),e.jsxs(c.Item,{children:["Open the file: ",e.jsx("code",{children:"layout/theme.liquid"})]}),e.jsxs(c.Item,{children:["Add this code before the closing ",e.jsx("code",{children:"</head>"})," tag:"]})]})]})}),e.jsx(p,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsx(n,{as:"h4",variant:"headingSm",children:"Code to Install"}),e.jsx(o,{background:"bg-surface-secondary",padding:"200",borderRadius:"200",children:e.jsx("pre",{style:{fontSize:"12px",overflow:"auto",whiteSpace:"pre-wrap"},children:`{%- comment -%} Advanced Schema Data - Auto-generated by indexAIze - Unlock AI Search {%- endcomment -%}

{%- comment -%} Organization & WebSite Schema (site-wide) {%- endcomment -%}
{%- if shop.metafields.advanced_schema.shop_schemas -%}
  <script type="application/ld+json">
{{ shop.metafields.advanced_schema.shop_schemas.value }}
  <\/script>
{%- endif -%}

{%- comment -%} Product Schema (product pages only) {%- endcomment -%}
{%- if product -%}
  {%- comment -%} Try Advanced Schema first (requires tokens/Enterprise plan) {%- endcomment -%}
  {%- assign schema_key = 'schemas_' | append: request.locale.iso_code -%}
  {%- assign schemas_json = product.metafields.advanced_schema[schema_key].value -%}
  {%- if schemas_json -%}
    <script type="application/ld+json">
{{ schemas_json }}
    <\/script>
  {%- else -%}
    {%- comment -%} Fallback to basic SEO JSON-LD (available for all plans) {%- endcomment -%}
    {%- assign seo_key = 'seo__' | append: request.locale.iso_code -%}
    {%- assign seo_data_json = product.metafields.seo_ai[seo_key].value | default: product.metafields.seo_ai.seo__en.value -%}
    {%- if seo_data_json -%}
      <script type="application/ld+json" id="seo-basic-jsonld-{{ product.id }}">
      <\/script>
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
      <\/script>
    {%- endif -%}
  {%- endif -%}
{%- endif -%}

{%- comment -%} Site-wide FAQ Schema {%- endcomment -%}
{%- if shop.metafields.advanced_schema.site_faq -%}
  <script type="application/ld+json">
{{ shop.metafields.advanced_schema.site_faq.value }}
  <\/script>
{%- endif -%}`})}),e.jsx(x,{tone:"info",children:e.jsxs(n,{children:[e.jsx("strong",{children:"💡 Note:"})," This code uses Advanced Schema Data from metafields. Make sure you have generated Advanced Schema Data first in the Advanced Schema Data section above."]})}),e.jsx(m,{align:"end",children:e.jsx(v,{onClick:()=>{navigator.clipboard.writeText(`{%- comment -%} Advanced Schema Data - Auto-generated by indexAIze - Unlock AI Search {%- endcomment -%}

{%- comment -%} Organization & WebSite Schema (site-wide) {%- endcomment -%}
{%- if shop.metafields.advanced_schema.shop_schemas -%}
  <script type="application/ld+json">
{{ shop.metafields.advanced_schema.shop_schemas.value }}
  <\/script>
{%- endif -%}

{%- comment -%} Product Schema (product pages only) {%- endcomment -%}
{%- if product -%}
  {%- comment -%} Try Advanced Schema first (requires tokens/Enterprise plan) {%- endcomment -%}
  {%- assign schema_key = 'schemas_' | append: request.locale.iso_code -%}
  {%- assign schemas_json = product.metafields.advanced_schema[schema_key].value -%}
  {%- if schemas_json -%}
    <script type="application/ld+json">
{{ schemas_json }}
    <\/script>
  {%- else -%}
    {%- comment -%} Fallback to basic SEO JSON-LD (available for all plans) {%- endcomment -%}
    {%- assign seo_key = 'seo__' | append: request.locale.iso_code -%}
    {%- assign seo_data_json = product.metafields.seo_ai[seo_key].value | default: product.metafields.seo_ai.seo__en.value -%}
    {%- if seo_data_json -%}
      <script type="application/ld+json" id="seo-basic-jsonld-{{ product.id }}">
      <\/script>
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
      <\/script>
    {%- endif -%}
  {%- endif -%}
{%- endif -%}

{%- comment -%} Site-wide FAQ Schema {%- endcomment -%}
{%- if shop.metafields.advanced_schema.site_faq -%}
  <script type="application/ld+json">
{{ shop.metafields.advanced_schema.site_faq.value }}
  <\/script>
{%- endif -%}`),h("Code copied to clipboard!")},children:"Copy Code"})}),e.jsx(x,{tone:"warning",children:e.jsx(n,{children:"Always backup your theme before making changes!"})})]})})}),e.jsx(p,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsx(n,{as:"h4",variant:"headingSm",children:"Testing Your Installation"}),e.jsxs(c,{children:[e.jsx(c.Item,{children:"After installation, visit your store's homepage and product pages"}),e.jsx(c.Item,{children:"View the page source (right-click → View Source)"}),e.jsxs(c.Item,{children:["Search for ",e.jsx("code",{children:"application/ld+json"})," to find your schemas"]}),e.jsx(c.Item,{children:"Use the Validation tab to test with Google's tools"})]})]})})})]})})]})]})})}),b&&e.jsx(P,{content:b,onDismiss:()=>h("")})]})}export{V as default};
