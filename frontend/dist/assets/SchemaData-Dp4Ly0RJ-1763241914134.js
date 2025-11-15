import{j as e}from"./app-bridge-BrCh82DC-1763241914134.js";import{r as d}from"./react-vendor-tAaa2TlE-1763241914134.js";import{m as q}from"./sessionFetch-CJepNHo3-1763241914134.js";import"./usePlanHierarchy-BjUEvxZF-1763241914134.js";import{C as h,B as o,a as i,n as z,T as t,d as S,s as O,I as p,f as A,b as y,t as c,k as R}from"./polaris-BCNx7Tyd-1763241914134.js";const C=(m,n="")=>{try{return new URLSearchParams(window.location.search).get(m)||n}catch{return n}};function V({shop:m}){const n=m||C("shop","");console.log("[SCHEMA-DATA] shopProp:",m),console.log('[SCHEMA-DATA] qs("shop"):',C("shop","")),console.log("[SCHEMA-DATA] final shop:",n),console.log("[SCHEMA-DATA] window.location.search:",window.location.search);const[f,T]=d.useState(0),[b,g]=d.useState(!0),[r,_]=d.useState({organization:null,website:null,products:[]}),[v,l]=d.useState(""),u=d.useMemo(()=>q(),[]),[P,k]=d.useState(""),[$,I]=d.useState(null);d.useEffect(()=>{n&&(w(),E())},[n,u]);const E=async()=>{var s,a;try{const x=await u("/graphql",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:`
        query PlansMe($shop:String!) {
          plansMe(shop:$shop) {
            shop
            plan
            planKey
          }
        }
      `,variables:{shop:n}})});console.log("[SCHEMA-DATA] Plan data:",x),I((a=(s=x==null?void 0:x.data)==null?void 0:s.plansMe)==null?void 0:a.plan)}catch(j){console.error("[SCHEMA-DATA] Error loading plan:",j)}},w=async()=>{g(!0);try{console.log("[SCHEMA-DATA] loadSchemas - shop:",n);const s=`/api/schema/preview?shop=${encodeURIComponent(n)}`;console.log("[SCHEMA-DATA] loadSchemas - url:",s);const a=await u(s,{headers:{"X-Shop":n}});console.log("[SCHEMA-DATA] loadSchemas - response:",a),a.ok?(_(a.schemas),M(a.schemas)):l(`Error: ${a.error}`)}catch(s){console.error("[SCHEMA-DATA] loadSchemas - error:",s),l(`Failed to load schemas: ${s.message}`)}finally{g(!1)}},M=s=>{const a=[];s.organization&&a.push(s.organization),s.website&&a.push(s.website);const j=`<script type="application/ld+json">
${JSON.stringify(a,null,2)}
<\/script>`;k(j)},D=async()=>{g(!0);try{console.log("[SCHEMA-DATA] handleRegenerate - shop:",n);const s=`/api/schema/generate?shop=${encodeURIComponent(n)}`;console.log("[SCHEMA-DATA] handleRegenerate - url:",s);const a=await u(s,{method:"POST",headers:{"X-Shop":n},body:{shop:n}});console.log("[SCHEMA-DATA] handleRegenerate - response:",a),a.ok?(l("Schemas regenerated successfully!"),w()):l(`Error: ${a.error}`)}catch(s){console.error("[SCHEMA-DATA] handleRegenerate - error:",s),l(`Failed to regenerate: ${s.message}`)}finally{g(!1)}},H=[{id:"overview",content:"Overview",accessibilityLabel:"Overview"},{id:"installation",content:"Installation",accessibilityLabel:"Installation"}];return b?e.jsx(h,{children:e.jsx(o,{padding:"400",children:e.jsxs(i,{gap:"400",align:"center",children:[e.jsx(z,{}),e.jsx(t,{children:"Loading schema data..."})]})})}):e.jsxs(e.Fragment,{children:[e.jsx(h,{children:e.jsx(o,{padding:"400",children:e.jsxs(i,{gap:"400",children:[e.jsx(t,{as:"h3",variant:"headingMd",children:"Schema.org Structured Data"}),e.jsx(S,{tone:"info",children:e.jsx(t,{children:"Schema.org structured data helps AI models understand your store content better, improving your visibility and search results."})}),e.jsxs(O,{tabs:H,selected:f,onSelect:T,children:[f===0&&e.jsx(o,{paddingBlockStart:"400",children:e.jsxs(i,{gap:"400",children:[e.jsx(h,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsxs(p,{align:"space-between",children:[e.jsx(t,{as:"h4",variant:"headingSm",children:"Organization Schema"}),e.jsx(A,{tone:r.organization?"success":"warning",children:r.organization?"Active":"Not configured"})]}),!r.organization&&e.jsx(t,{as:"p",tone:"subdued",children:"Configure organization details in Store Metadata to enable this schema."})]})})}),e.jsx(h,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsxs(p,{align:"space-between",children:[e.jsx(t,{as:"h4",variant:"headingSm",children:"WebSite Schema"}),e.jsx(A,{tone:r.website?"success":"warning",children:r.website?"Active":"Not configured"})]}),!r.website&&e.jsx(t,{as:"p",tone:"subdued",children:"Website schema is automatically generated from your store information."})]})})}),e.jsx(h,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsxs(p,{align:"space-between",children:[e.jsx(t,{as:"h4",variant:"headingSm",children:"Product Schemas"}),e.jsx(A,{tone:"success",children:"Auto-generated"})]}),e.jsxs(t,{tone:"subdued",children:["Product schemas are automatically generated from your AI Optimisation data when pages load.",r.products.length>0&&` ${r.products.length} products have SEO data.`]})]})})}),e.jsxs(p,{gap:"300",children:[e.jsx(y,{onClick:D,loading:b,children:"Regenerate Schemas"}),e.jsx(y,{variant:"plain",url:"https://developers.google.com/search/docs/appearance/structured-data",children:"Learn about Schema.org"})]})]})}),f===1&&e.jsx(o,{paddingBlockStart:"400",children:e.jsxs(i,{gap:"400",children:[e.jsx(S,{tone:"info",children:e.jsxs(i,{gap:"300",children:[e.jsx(t,{as:"h4",variant:"headingSm",children:"Theme Installation"}),e.jsxs(c,{type:"number",children:[e.jsx(c.Item,{children:"Go to your Shopify Admin → Online Store → Themes"}),e.jsx(c.Item,{children:'Click "Actions" → "Edit code" on your current theme'}),e.jsxs(c.Item,{children:["Open the file: ",e.jsx("code",{children:"layout/theme.liquid"})]}),e.jsxs(c.Item,{children:["Add this code before the closing ",e.jsx("code",{children:"</head>"})," tag:"]})]})]})}),e.jsx(h,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsx(t,{as:"h4",variant:"headingSm",children:"Code to Install"}),e.jsx(o,{background:"bg-surface-secondary",padding:"200",borderRadius:"200",children:e.jsx("pre",{style:{fontSize:"12px",overflow:"auto",whiteSpace:"pre-wrap"},children:`{%- comment -%} Advanced Schema Data - Auto-generated by indexAIze - Unlock AI Search {%- endcomment -%}
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
{%- endif -%}`})}),e.jsx(S,{tone:"info",children:e.jsxs(t,{children:[e.jsx("strong",{children:"💡 Note:"})," This code uses Advanced Schema Data from metafields. Make sure you have generated Advanced Schema Data first in the Advanced Schema Data section above."]})}),e.jsx(p,{align:"end",children:e.jsx(y,{onClick:()=>{navigator.clipboard.writeText(`{%- comment -%} Advanced Schema Data - Auto-generated by indexAIze - Unlock AI Search {%- endcomment -%}
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
{%- endif -%}`),l("Code copied to clipboard!")},children:"Copy Code"})}),e.jsx(S,{tone:"warning",children:e.jsx(t,{children:"Always backup your theme before making changes!"})})]})})}),e.jsx(h,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsx(t,{as:"h4",variant:"headingSm",children:"Testing Your Installation"}),e.jsxs(c,{children:[e.jsx(c.Item,{children:"After installation, visit your store's homepage and product pages"}),e.jsx(c.Item,{children:"View the page source (right-click → View Source)"}),e.jsxs(c.Item,{children:["Search for ",e.jsx("code",{children:"application/ld+json"})," to find your schemas"]}),e.jsx(c.Item,{children:"Use the Validation tab to test with Google's tools"})]})]})})})]})})]})]})})}),v&&e.jsx(R,{content:v,onDismiss:()=>l("")})]})}export{V as default};
