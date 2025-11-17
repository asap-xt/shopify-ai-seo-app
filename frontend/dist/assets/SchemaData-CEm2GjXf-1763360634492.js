import{j as e}from"./app-bridge-CvS2ZAEC-1763360634492.js";import{r as d}from"./react-vendor-tAaa2TlE-1763360634492.js";import{m as H}from"./sessionFetch-CYfxe-f8-1763360634492.js";import"./usePlanHierarchy-BjUEvxZF-1763360634492.js";import{C as p,B as i,a as r,n as O,T as n,d as f,s as R,I as m,f as y,b,t as c,k as P}from"./polaris-B_kNi13J-1763360634492.js";import"./index-B_YNWfQt-1763360634492.js";const T=(g,t="")=>{try{return new URLSearchParams(window.location.search).get(g)||t}catch{return t}},l=(...g)=>{};function J({shop:g}){const t=g||T("shop","");l('[SCHEMA-DATA] qs("shop"):',T("shop",""));const[A,_]=d.useState(0),[v,u]=d.useState(!0),[o,k]=d.useState({organization:null,website:null,products:[]}),[w,h]=d.useState(""),j=d.useMemo(()=>H(),[]),[$,I]=d.useState(""),[B,E]=d.useState(null);d.useEffect(()=>{t&&(C(),M())},[t,j]);const M=async()=>{var s,a;try{const S=await j("/graphql",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:`
        query PlansMe($shop:String!) {
          plansMe(shop:$shop) {
            shop
            plan
            planKey
          }
        }
      `,variables:{shop:t}})});l("[SCHEMA-DATA] Plan data:",S),E((a=(s=S==null?void 0:S.data)==null?void 0:s.plansMe)==null?void 0:a.plan)}catch(x){console.error("[SCHEMA-DATA] Error loading plan:",x)}},C=async()=>{u(!0);try{l("[SCHEMA-DATA] loadSchemas - shop:",t);const s=`/api/schema/preview?shop=${encodeURIComponent(t)}`;l("[SCHEMA-DATA] loadSchemas - url:",s);const a=await j(s,{headers:{"X-Shop":t}});l("[SCHEMA-DATA] loadSchemas - response:",a),a.ok?(k(a.schemas),D(a.schemas)):h(`Error: ${a.error}`)}catch(s){console.error("[SCHEMA-DATA] loadSchemas - error:",s),h(`Failed to load schemas: ${s.message}`)}finally{u(!1)}},D=s=>{const a=[];s.organization&&a.push(s.organization),s.website&&a.push(s.website);const x=`<script type="application/ld+json">
${JSON.stringify(a,null,2)}
<\/script>`;I(x)},q=async()=>{u(!0);try{l("[SCHEMA-DATA] handleRegenerate - shop:",t);const s=`/api/schema/generate?shop=${encodeURIComponent(t)}`;l("[SCHEMA-DATA] handleRegenerate - url:",s);const a=await j(s,{method:"POST",headers:{"X-Shop":t},body:{shop:t}});l("[SCHEMA-DATA] handleRegenerate - response:",a),a.ok?(h("Schemas regenerated successfully!"),C()):h(`Error: ${a.error}`)}catch(s){console.error("[SCHEMA-DATA] handleRegenerate - error:",s),h(`Failed to regenerate: ${s.message}`)}finally{u(!1)}},z=[{id:"overview",content:"Overview",accessibilityLabel:"Overview"},{id:"installation",content:"Installation",accessibilityLabel:"Installation"}];return v?e.jsx(p,{children:e.jsx(i,{padding:"400",children:e.jsxs(r,{gap:"400",align:"center",children:[e.jsx(O,{}),e.jsx(n,{children:"Loading schema data..."})]})})}):e.jsxs(e.Fragment,{children:[e.jsx(p,{children:e.jsx(i,{padding:"400",children:e.jsxs(r,{gap:"400",children:[e.jsx(n,{as:"h3",variant:"headingMd",children:"Schema.org Structured Data"}),e.jsx(f,{tone:"info",children:e.jsx(n,{children:"Schema.org structured data helps AI models understand your store content better, improving your visibility and search results."})}),e.jsxs(R,{tabs:z,selected:A,onSelect:_,children:[A===0&&e.jsx(i,{paddingBlockStart:"400",children:e.jsxs(r,{gap:"400",children:[e.jsx(p,{children:e.jsx(i,{padding:"300",children:e.jsxs(r,{gap:"300",children:[e.jsxs(m,{align:"space-between",children:[e.jsx(n,{as:"h4",variant:"headingSm",children:"Organization Schema"}),e.jsx(y,{tone:o.organization?"success":"warning",children:o.organization?"Active":"Not configured"})]}),!o.organization&&e.jsx(n,{as:"p",tone:"subdued",children:"Configure organization details in Store Metadata to enable this schema."})]})})}),e.jsx(p,{children:e.jsx(i,{padding:"300",children:e.jsxs(r,{gap:"300",children:[e.jsxs(m,{align:"space-between",children:[e.jsx(n,{as:"h4",variant:"headingSm",children:"WebSite Schema"}),e.jsx(y,{tone:o.website?"success":"warning",children:o.website?"Active":"Not configured"})]}),!o.website&&e.jsx(n,{as:"p",tone:"subdued",children:"Website schema is automatically generated from your store information."})]})})}),e.jsx(p,{children:e.jsx(i,{padding:"300",children:e.jsxs(r,{gap:"300",children:[e.jsxs(m,{align:"space-between",children:[e.jsx(n,{as:"h4",variant:"headingSm",children:"Product Schemas"}),e.jsx(y,{tone:"success",children:"Auto-generated"})]}),e.jsxs(n,{tone:"subdued",children:["Product schemas are automatically generated from your AI Optimisation data when pages load.",o.products.length>0&&` ${o.products.length} products have SEO data.`]})]})})}),e.jsxs(m,{gap:"300",children:[e.jsx(b,{onClick:q,loading:v,children:"Regenerate Schemas"}),e.jsx(b,{variant:"plain",url:"https://developers.google.com/search/docs/appearance/structured-data",children:"Learn about Schema.org"})]})]})}),A===1&&e.jsx(i,{paddingBlockStart:"400",children:e.jsxs(r,{gap:"400",children:[e.jsx(f,{tone:"info",children:e.jsxs(r,{gap:"300",children:[e.jsx(n,{as:"h4",variant:"headingSm",children:"Theme Installation"}),e.jsxs(c,{type:"number",children:[e.jsx(c.Item,{children:"Go to your Shopify Admin → Online Store → Themes"}),e.jsx(c.Item,{children:'Click "Actions" → "Edit code" on your current theme'}),e.jsxs(c.Item,{children:["Open the file: ",e.jsx("code",{children:"layout/theme.liquid"})]}),e.jsxs(c.Item,{children:["Add this code before the closing ",e.jsx("code",{children:"</head>"})," tag:"]})]})]})}),e.jsx(p,{children:e.jsx(i,{padding:"300",children:e.jsxs(r,{gap:"300",children:[e.jsx(n,{as:"h4",variant:"headingSm",children:"Code to Install"}),e.jsx(i,{background:"bg-surface-secondary",padding:"200",borderRadius:"200",children:e.jsx("pre",{style:{fontSize:"12px",overflow:"auto",whiteSpace:"pre-wrap"},children:`{%- comment -%} Advanced Schema Data - Auto-generated by indexAIze - Unlock AI Search {%- endcomment -%}
{%- if product -%}
  {%- assign schema_key = 'schemas_' | append: request.locale.iso_code -%}
  {%- assign schemas_json = product.metafields.advanced_schema[schema_key].value -%}
  {%- if schemas_json -%}
    <script type="application/ld+json">
{{ schemas_json }}
    <\/script>
  {%- endif -%}
{%- endif -%}

{%- comment -%} Site-wide FAQ Schema {%- endcomment -%}
{%- if shop.metafields.advanced_schema.site_faq -%}
  <script type="application/ld+json">
{{ shop.metafields.advanced_schema.site_faq.value }}
  <\/script>
{%- endif -%}`})}),e.jsx(f,{tone:"info",children:e.jsxs(n,{children:[e.jsx("strong",{children:"💡 Note:"})," This code uses Advanced Schema Data from metafields. Make sure you have generated Advanced Schema Data first in the Advanced Schema Data section above."]})}),e.jsx(m,{align:"end",children:e.jsx(b,{onClick:()=>{navigator.clipboard.writeText(`{%- comment -%} Advanced Schema Data - Auto-generated by indexAIze - Unlock AI Search {%- endcomment -%}
{%- if product -%}
  {%- assign schema_key = 'schemas_' | append: request.locale.iso_code -%}
  {%- assign schemas_json = product.metafields.advanced_schema[schema_key].value -%}
  {%- if schemas_json -%}
    <script type="application/ld+json">
{{ schemas_json }}
    <\/script>
  {%- endif -%}
{%- endif -%}

{%- comment -%} Site-wide FAQ Schema {%- endcomment -%}
{%- if shop.metafields.advanced_schema.site_faq -%}
  <script type="application/ld+json">
{{ shop.metafields.advanced_schema.site_faq.value }}
  <\/script>
{%- endif -%}`),h("Code copied to clipboard!")},children:"Copy Code"})}),e.jsx(f,{tone:"warning",children:e.jsx(n,{children:"Always backup your theme before making changes!"})})]})})}),e.jsx(p,{children:e.jsx(i,{padding:"300",children:e.jsxs(r,{gap:"300",children:[e.jsx(n,{as:"h4",variant:"headingSm",children:"Testing Your Installation"}),e.jsxs(c,{children:[e.jsx(c.Item,{children:"After installation, visit your store's homepage and product pages"}),e.jsx(c.Item,{children:"View the page source (right-click → View Source)"}),e.jsxs(c.Item,{children:["Search for ",e.jsx("code",{children:"application/ld+json"})," to find your schemas"]}),e.jsx(c.Item,{children:"Use the Validation tab to test with Google's tools"})]})]})})})]})})]})]})})}),w&&e.jsx(P,{content:w,onDismiss:()=>h("")})]})}export{J as default};
