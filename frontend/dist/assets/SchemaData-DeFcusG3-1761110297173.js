import{j as e}from"./app-bridge-I2MtRnje-1761110297173.js";import{r as l}from"./react-vendor-tAaa2TlE-1761110297173.js";import{m as H}from"./sessionFetch-CJepNHo3-1761110297173.js";import{C as h,a as o,e as i,s as z,T as t,d as b,u as P,I as p,g as y,B as x,v as r,l as $}from"./polaris-B1CGe-wS-1761110297173.js";const T=(m,n="")=>{try{return new URLSearchParams(window.location.search).get(m)||n}catch{return n}};function N({shop:m}){const n=m||T("shop","");console.log("[SCHEMA-DATA] shopProp:",m),console.log('[SCHEMA-DATA] qs("shop"):',T("shop","")),console.log("[SCHEMA-DATA] final shop:",n),console.log("[SCHEMA-DATA] window.location.search:",window.location.search);const[f,v]=l.useState(0),[_,g]=l.useState(!0),[c,E]=l.useState({organization:null,website:null,products:[]}),[w,d]=l.useState(""),u=l.useMemo(()=>H(),[]),[A,I]=l.useState(""),[R,M]=l.useState(null);l.useEffect(()=>{n&&(C(),k())},[n,u]);const k=async()=>{var s,a;try{const S=await u("/graphql",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:`
        query PlansMe($shop:String!) {
          plansMe(shop:$shop) {
            shop
            plan
            planKey
          }
        }
      `,variables:{shop:n}})});console.log("[SCHEMA-DATA] Plan data:",S),M((a=(s=S==null?void 0:S.data)==null?void 0:s.plansMe)==null?void 0:a.plan)}catch(j){console.error("[SCHEMA-DATA] Error loading plan:",j)}},C=async()=>{g(!0);try{console.log("[SCHEMA-DATA] loadSchemas - shop:",n);const s=`/api/schema/preview?shop=${encodeURIComponent(n)}`;console.log("[SCHEMA-DATA] loadSchemas - url:",s);const a=await u(s,{headers:{"X-Shop":n}});console.log("[SCHEMA-DATA] loadSchemas - response:",a),a.ok?(E(a.schemas),D(a.schemas)):d(`Error: ${a.error}`)}catch(s){console.error("[SCHEMA-DATA] loadSchemas - error:",s),d(`Failed to load schemas: ${s.message}`)}finally{g(!1)}},D=s=>{const a=[];s.organization&&a.push(s.organization),s.website&&a.push(s.website);const j=`<script type="application/ld+json">
${JSON.stringify(a,null,2)}
<\/script>`;I(j)},O=async()=>{g(!0);try{console.log("[SCHEMA-DATA] handleRegenerate - shop:",n);const s=`/api/schema/generate?shop=${encodeURIComponent(n)}`;console.log("[SCHEMA-DATA] handleRegenerate - url:",s);const a=await u(s,{method:"POST",headers:{"X-Shop":n},body:{shop:n}});console.log("[SCHEMA-DATA] handleRegenerate - response:",a),a.ok?(d("Schemas regenerated successfully!"),C()):d(`Error: ${a.error}`)}catch(s){console.error("[SCHEMA-DATA] handleRegenerate - error:",s),d(`Failed to regenerate: ${s.message}`)}finally{g(!1)}},q=[{id:"overview",content:"Overview",accessibilityLabel:"Overview"},{id:"installation",content:"Installation",accessibilityLabel:"Installation"}];return _?e.jsx(h,{children:e.jsx(o,{padding:"400",children:e.jsxs(i,{gap:"400",align:"center",children:[e.jsx(z,{}),e.jsx(t,{children:"Loading schema data..."})]})})}):e.jsxs(e.Fragment,{children:[e.jsx(h,{children:e.jsx(o,{padding:"400",children:e.jsxs(i,{gap:"400",children:[e.jsx(t,{as:"h3",variant:"headingMd",children:"Schema.org Structured Data"}),e.jsx(b,{tone:"info",children:e.jsx(t,{children:"Schema.org structured data helps AI models understand your store content better, improving your visibility and search results."})}),e.jsxs(P,{tabs:q,selected:f,onSelect:v,children:[f===0&&e.jsx(o,{paddingBlockStart:"400",children:e.jsxs(i,{gap:"400",children:[e.jsx(h,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsxs(p,{align:"space-between",children:[e.jsx(t,{as:"h4",variant:"headingSm",children:"Organization Schema"}),e.jsx(y,{tone:c.organization?"success":"warning",children:c.organization?"Active":"Not configured"})]}),!c.organization&&e.jsx(t,{as:"p",tone:"subdued",children:"Configure organization details in Store Metadata to enable this schema."})]})})}),e.jsx(h,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsxs(p,{align:"space-between",children:[e.jsx(t,{as:"h4",variant:"headingSm",children:"WebSite Schema"}),e.jsx(y,{tone:c.website?"success":"warning",children:c.website?"Active":"Not configured"})]}),!c.website&&e.jsx(t,{as:"p",tone:"subdued",children:"Website schema is automatically generated from your store information."})]})})}),e.jsx(h,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsxs(p,{align:"space-between",children:[e.jsx(t,{as:"h4",variant:"headingSm",children:"Product Schemas"}),e.jsx(y,{tone:"success",children:"Auto-generated"})]}),e.jsxs(t,{tone:"subdued",children:["Product schemas are automatically generated from your AI Optimisation data when pages load.",c.products.length>0&&` ${c.products.length} products have SEO data.`]})]})})}),e.jsxs(p,{gap:"300",children:[e.jsx(x,{onClick:O,loading:_,children:"Regenerate Schemas"}),e.jsx(x,{variant:"plain",url:"https://developers.google.com/search/docs/appearance/structured-data",children:"Learn about Schema.org"})]})]})}),f===1&&e.jsx(o,{paddingBlockStart:"400",children:e.jsxs(i,{gap:"400",children:[e.jsx(b,{tone:"info",children:e.jsxs(i,{gap:"300",children:[e.jsx(t,{as:"h4",variant:"headingSm",children:"Theme Installation"}),e.jsxs(r,{type:"number",children:[e.jsx(r.Item,{children:"Go to your Shopify Admin → Online Store → Themes"}),e.jsx(r.Item,{children:'Click "Actions" → "Edit code" on your current theme'}),e.jsxs(r.Item,{children:["Open the file: ",e.jsx("code",{children:"layout/theme.liquid"})]}),e.jsxs(r.Item,{children:["Add this code before the closing ",e.jsx("code",{children:"</head>"})," tag:"]})]})]})}),e.jsx(h,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsxs(p,{align:"space-between",blockAlign:"center",children:[e.jsx(t,{as:"h4",variant:"headingSm",children:"Code to Install"}),e.jsx(x,{size:"slim",onClick:()=>{const s=`{% comment %} Organization & WebSite Schema - AI SEO App {% endcomment %}
${A}

{% comment %} Product Schema - Dynamic {% endcomment %}
{% if template contains 'product' %}
  {% assign seo_bullets = product.metafields.seo_ai.bullets %}
  {% assign seo_faq = product.metafields.seo_ai.faq %}
  {% assign seo_data = product.metafields.seo_ai['seo__' | append: request.locale.iso_code] | default: product.metafields.seo_ai.seo__en %}
  
  {% if seo_data %}
    <script type="application/ld+json">
    {{ seo_data.jsonLd | json }}
    <\/script>
  {% endif %}
{% endif %}`;navigator.clipboard.writeText(s),d("Code copied to clipboard!")},children:"📋 Copy"})]}),e.jsx(o,{background:"bg-surface-secondary",padding:"200",borderRadius:"200",children:e.jsx("pre",{style:{fontSize:"12px",overflow:"auto",whiteSpace:"pre-wrap"},children:`{% comment %} Organization & WebSite Schema - AI SEO App {% endcomment %}
${A}

{% comment %} Product Schema - Dynamic {% endcomment %}
{% if template contains 'product' %}
  {% assign seo_bullets = product.metafields.seo_ai.bullets %}
  {% assign seo_faq = product.metafields.seo_ai.faq %}
  {% assign seo_data = product.metafields.seo_ai['seo__' | append: request.locale.iso_code] | default: product.metafields.seo_ai.seo__en %}
  
  {% if seo_data %}
    <script type="application/ld+json">
    {{ seo_data.jsonLd | json }}
    <\/script>
  {% endif %}
{% endif %}`})}),e.jsx(p,{align:"end",children:e.jsx(x,{onClick:()=>{const s=`{% comment %} Organization & WebSite Schema - AI SEO App {% endcomment %}
${A}

{% comment %} Product Schema - Dynamic {% endcomment %}
{% if template contains 'product' %}
  {% assign seo_bullets = product.metafields.seo_ai.bullets %}
  {% assign seo_faq = product.metafields.seo_ai.faq %}
  {% assign seo_data = product.metafields.seo_ai['seo__' | append: request.locale.iso_code] | default: product.metafields.seo_ai.seo__en %}
  
  {% if seo_data %}
    <script type="application/ld+json">
    {{ seo_data.jsonLd | json }}
    <\/script>
  {% endif %}
{% endif %}`;navigator.clipboard.writeText(s),d("Code copied to clipboard!")},children:"Copy Code"})}),e.jsx(b,{tone:"warning",children:e.jsx(t,{children:"Always backup your theme before making changes!"})})]})})}),e.jsx(h,{children:e.jsx(o,{padding:"300",children:e.jsxs(i,{gap:"300",children:[e.jsx(t,{as:"h4",variant:"headingSm",children:"Testing Your Installation"}),e.jsxs(r,{children:[e.jsx(r.Item,{children:"After installation, visit your store's homepage and product pages"}),e.jsx(r.Item,{children:"View the page source (right-click → View Source)"}),e.jsxs(r.Item,{children:["Search for ",e.jsx("code",{children:"application/ld+json"})," to find your schemas"]}),e.jsx(r.Item,{children:"Use the Validation tab to test with Google's tools"})]})]})})})]})})]})]})})}),w&&e.jsx($,{content:w,onDismiss:()=>d("")})]})}export{N as default};
