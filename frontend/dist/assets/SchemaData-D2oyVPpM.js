import{r as d,j as e}from"./react-vendor-6uwpMgJP.js";import{m as L}from"./sessionFetch-CJopfSv0.js";import"./usePlanHierarchy-BjUEvxZF.js";import{C as p,B as o,a as i,n as z,T as t,d as y,s as N,I as m,f as _,b,t as c,k as P}from"./polaris-B96_d87K.js";import"./app-bridge-ugs9K9zh.js";import"./vendor-BC2YhXnC.js";import"./index-CAhGQgKQ.js";const T=(u,n="")=>{try{return new URLSearchParams(window.location.search).get(u)||n}catch{return n}},l=(...u)=>{};function G({shop:u}){const n=u||T("shop","");l('[SCHEMA-DATA] qs("shop"):',T("shop",""));const[x,k]=d.useState(0),[v,g]=d.useState(!0),[r,C]=d.useState({organization:null,website:null,products:[]}),[A,h]=d.useState(""),j=d.useMemo(()=>L(),[]),[H,E]=d.useState(""),[R,D]=d.useState(null);d.useEffect(()=>{n&&(w(),I())},[n,j]);const I=async()=>{var s,a;try{const f=await j("/graphql",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:`
        query PlansMe($shop:String!) {
          plansMe(shop:$shop) {
            shop
            plan
            planKey
          }
        }
      `,variables:{shop:n}})});l("[SCHEMA-DATA] Plan data:",f),D((a=(s=f==null?void 0:f.data)==null?void 0:s.plansMe)==null?void 0:a.plan)}catch(S){console.error("[SCHEMA-DATA] Error loading plan:",S)}},w=async()=>{g(!0);try{l("[SCHEMA-DATA] loadSchemas - shop:",n);const s=`/api/schema/preview?shop=${encodeURIComponent(n)}`;l("[SCHEMA-DATA] loadSchemas - url:",s);const a=await j(s,{headers:{"X-Shop":n}});l("[SCHEMA-DATA] loadSchemas - response:",a),a.ok?(C(a.schemas),O(a.schemas)):h(`Error: ${a.error}`)}catch(s){console.error("[SCHEMA-DATA] loadSchemas - error:",s),h(`Failed to load schemas: ${s.message}`)}finally{g(!1)}},O=s=>{const a=[];s.organization&&a.push(s.organization),s.website&&a.push(s.website);const S=`<script type="application/ld+json">
${JSON.stringify(a,null,2)}
<\/script>`;E(S)},q=async()=>{g(!0);try{l("[SCHEMA-DATA] handleRegenerate - shop:",n);const s=`/api/schema/generate?shop=${encodeURIComponent(n)}`;l("[SCHEMA-DATA] handleRegenerate - url:",s);const a=await j(s,{method:"POST",headers:{"X-Shop":n},body:{shop:n}});l("[SCHEMA-DATA] handleRegenerate - response:",a),a.ok?(h("Schemas regenerated successfully!"),w()):h(`Error: ${a.error}`)}catch(s){console.error("[SCHEMA-DATA] handleRegenerate - error:",s),h(`Failed to regenerate: ${s.message}`)}finally{g(!1)}},M=[{id:"overview",content:"Overview",accessibilityLabel:"Overview"},{id:"installation",content:"Installation",accessibilityLabel:"Installation"}];return v?e.jsx(p,{children:e.jsx(o,{padding:"400",children:e.jsxs(i,{gap:"400",align:"center",children:[e.jsx(z,{}),e.jsx(t,{children:"Loading schema data..."})]})})}):e.jsxs(e.Fragment,{children:[e.jsx(p,{children:e.jsx(o,{padding:"400",children:e.jsxs(i,{gap:"400",children:[e.jsx(t,{as:"h3",variant:"headingMd",children:"Schema.org Structured Data"}),e.jsx(y,{tone:"info",children:e.jsx(t,{children:"Schema.org structured data helps AI models understand your store content better, improving your visibility and search results."})}),e.jsxs(N,{tabs:M,selected:x,onSelect:k,children:[x===0&&e.jsx(o,{paddingBlockStart:"400",children:e.jsxs(i,{gap:"400",children:[e.jsx(p,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsxs(m,{align:"space-between",children:[e.jsx(t,{as:"h4",variant:"headingSm",children:"Organization Schema"}),e.jsx(_,{tone:r.organization?"success":"warning",children:r.organization?"Active":"Not configured"})]}),!r.organization&&e.jsx(t,{as:"p",tone:"subdued",children:"Configure organization details in Store Metadata to enable this schema."})]})})}),e.jsx(p,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsxs(m,{align:"space-between",children:[e.jsx(t,{as:"h4",variant:"headingSm",children:"WebSite Schema"}),e.jsx(_,{tone:r.website?"success":"warning",children:r.website?"Active":"Not configured"})]}),!r.website&&e.jsx(t,{as:"p",tone:"subdued",children:"Website schema is automatically generated from your store information."})]})})}),e.jsx(p,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsxs(m,{align:"space-between",children:[e.jsx(t,{as:"h4",variant:"headingSm",children:"Product Schemas"}),e.jsx(_,{tone:"success",children:"Auto-generated"})]}),e.jsxs(t,{tone:"subdued",children:["Product schemas are automatically generated from your AI Optimisation data when pages load.",r.products.length>0&&` ${r.products.length} products have SEO data.`]})]})})}),e.jsxs(m,{gap:"300",children:[e.jsx(b,{onClick:q,loading:v,children:"Regenerate Schemas"}),e.jsx(b,{variant:"plain",url:"https://developers.google.com/search/docs/appearance/structured-data",children:"Learn about Schema.org"})]})]})}),x===1&&e.jsx(o,{paddingBlockStart:"400",children:e.jsxs(i,{gap:"400",children:[e.jsx(y,{tone:"info",children:e.jsxs(i,{gap:"300",children:[e.jsx(t,{as:"h4",variant:"headingSm",children:"Theme Installation"}),e.jsxs(c,{type:"number",children:[e.jsx(c.Item,{children:"Go to your Shopify Admin → Online Store → Themes"}),e.jsx(c.Item,{children:'Click "Actions" → "Edit code" on your current theme'}),e.jsxs(c.Item,{children:["Open the file: ",e.jsx("code",{children:"layout/theme.liquid"})]}),e.jsxs(c.Item,{children:["Add this code before the closing ",e.jsx("code",{children:"</head>"})," tag:"]})]})]})}),e.jsx(p,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsx(t,{as:"h4",variant:"headingSm",children:"Code to Install"}),e.jsx(o,{background:"bg-surface-secondary",padding:"200",borderRadius:"200",children:e.jsx("pre",{style:{fontSize:"12px",overflow:"auto",whiteSpace:"pre-wrap"},children:`{%- comment -%} Advanced Schema Data - Auto-generated by indexAIze - Unlock AI Search {%- endcomment -%}

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
{%- endif -%}`})}),e.jsx(m,{align:"end",children:e.jsx(b,{onClick:()=>{navigator.clipboard.writeText(`{%- comment -%} Advanced Schema Data - Auto-generated by indexAIze - Unlock AI Search {%- endcomment -%}

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
{%- endif -%}`),h("Code copied to clipboard!")},children:"Copy Code"})}),e.jsx(y,{tone:"warning",children:e.jsx(t,{children:"Always backup your theme before making changes!"})})]})})}),e.jsx(p,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsx(t,{as:"h4",variant:"headingSm",children:"Testing Your Installation"}),e.jsxs(c,{children:[e.jsx(c.Item,{children:"After installation, visit your store's homepage and product pages"}),e.jsx(c.Item,{children:"View the page source (right-click → View Source)"}),e.jsxs(c.Item,{children:["Search for ",e.jsx("code",{children:"application/ld+json"})," to find your schemas"]}),e.jsx(c.Item,{children:"Use the Validation tab to test with Google's tools"})]})]})})})]})})]})]})})}),A&&e.jsx(P,{content:A,onDismiss:()=>h("")})]})}export{G as default};
