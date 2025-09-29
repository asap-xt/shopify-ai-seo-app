import{j as t}from"./app-bridge-DGdCHjFO-1759162778023.js";import{r as h}from"./react-vendor-tAaa2TlE-1759162778023.js";import{m as F}from"./index-BO_FTbj9-1759162778023.js";import{C as p,a as u,T as D,h as G,L as f,s as M,i as r,f as X,I as H,B as j,k as K}from"./polaris-Bp4cQfWL-1759162778023.js";const W=(x,l="")=>{try{return new URLSearchParams(window.location.search).get(x)||l}catch{return l}};function ea({shop:x}){var v;const l=x||W("shop",""),[R,w]=h.useState(!1),[L,z]=h.useState(!1),[C,g]=h.useState(""),[m,$]=h.useState(null),y=h.useMemo(()=>F({}),[]),[q,T]=h.useState(!1),[U,k]=h.useState(!1),[n,i]=h.useState({seo:{title:"",metaDescription:"",keywords:""},aiMetadata:{businessType:"",targetAudience:"",uniqueSellingPoints:"",brandVoice:"",primaryCategories:"",shippingInfo:"",returnPolicy:""},organizationSchema:{enabled:!1,name:"",email:"",phone:"",logo:"",sameAs:""},localBusinessSchema:{enabled:!1,priceRange:"",openingHours:""}});h.useEffect(()=>{l&&_()},[l,y]);async function _(){w(!0);try{const e=`/api/store/generate?shop=${encodeURIComponent(l)}`;console.log("[StoreMeta] GET",e);const a=await y(e,{headers:{"X-Shop":l}});if(console.log("[StoreMeta] GET ok",{url:e,keys:Object.keys(a||{})}),$(a),a.existingMetadata){const s=a.existingMetadata;i(o=>{var S,c,d,A,E,P,B,O,N,I;return{...o,seo:{...o.seo,...((S=s.seo_metadata)==null?void 0:S.value)||{},keywords:Array.isArray((d=(c=s.seo_metadata)==null?void 0:c.value)==null?void 0:d.keywords)?s.seo_metadata.value.keywords.join(", "):((E=(A=s.seo_metadata)==null?void 0:A.value)==null?void 0:E.keywords)||o.seo.keywords||""},aiMetadata:((P=s.ai_metadata)==null?void 0:P.value)||o.aiMetadata,organizationSchema:{...o.organizationSchema,...((B=s.organization_schema)==null?void 0:B.value)||{},enabled:((N=(O=s.organization_schema)==null?void 0:O.value)==null?void 0:N.enabled)===!0},localBusinessSchema:((I=s.local_business_schema)==null?void 0:I.value)||o.localBusinessSchema}})}a.shopInfo&&i(s=>({...s,seo:{...s.seo,title:s.seo.title||a.shopInfo.name},organizationSchema:{...s.organizationSchema,name:s.organizationSchema.name||a.shopInfo.name,email:s.organizationSchema.email||a.shopInfo.email}}))}catch(e){console.error("[StoreMeta] GET error",(e==null?void 0:e.debug)||e,e),g(`Load failed: ${(e==null?void 0:e.message)||"Unknown error"}`)}finally{w(!1)}}async function b(){z(!0);try{const e=`/api/store/apply?shop=${encodeURIComponent(l)}`;console.log("[StoreMeta] SAVE",e);const a=await y(e,{method:"POST",headers:{"X-Shop":l},body:{metadata:n,options:{updateSeo:!0,updateAiMetadata:!0,updateOrganization:n.organizationSchema.enabled,updateLocalBusiness:n.localBusinessSchema.enabled}}});console.log("[StoreMeta] SAVE ok",{url:e,ok:a==null?void 0:a.ok}),g("Metadata saved successfully!")}catch(e){console.error("[StoreMeta] SAVE error",(e==null?void 0:e.debug)||e,e),g(`Save failed: ${(e==null?void 0:e.message)||"Unknown error"}`)}finally{z(!1)}}async function J(){var e;T(!0);try{await b();const s=await y("/graphql",{method:"POST",headers:{"X-Shop":l},body:{query:`
        query GetStoreMetadata($shop: String!) {
          storeMetadata(shop: $shop) {
            shopName
            description
            seoMetadata
            aiMetadata
            organizationSchema
            localBusinessSchema
          }
        }
      `,variables:{shop:l}}});if(s.error)throw new Error(s.error);const o=(e=s.data)==null?void 0:e.storeMetadata;if(o){const S=window.open("","_blank");console.log("[STORE-METADATA] Raw preview data:",o),console.log("[STORE-METADATA] seoMetadata raw:",o.seoMetadata),console.log("[STORE-METADATA] aiMetadata raw:",o.aiMetadata),console.log("[STORE-METADATA] organizationSchema raw:",o.organizationSchema);const c={shopName:o.shopName,description:o.description,seoMetadata:o.seoMetadata?(()=>{try{return JSON.parse(o.seoMetadata)}catch(d){return console.error("Error parsing seoMetadata:",d),o.seoMetadata}})():null,aiMetadata:o.aiMetadata?(()=>{try{return JSON.parse(o.aiMetadata)}catch(d){return console.error("Error parsing aiMetadata:",d),o.aiMetadata}})():null,organizationSchema:o.organizationSchema?(()=>{try{return JSON.parse(o.organizationSchema)}catch(d){return console.error("Error parsing organizationSchema:",d),o.organizationSchema}})():null,localBusinessSchema:o.localBusinessSchema?(()=>{try{return JSON.parse(o.localBusinessSchema)}catch(d){return console.error("Error parsing localBusinessSchema:",d),o.localBusinessSchema}})():null};S.document.write(`
          <html>
            <head>
              <title>Store Metadata Preview</title>
              <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                pre { background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }
                h1 { color: #333; }
                .section { margin: 20px 0; }
                .section h2 { color: #666; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
              </style>
            </head>
            <body>
              <h1>Store Metadata Preview</h1>
              <div class="section">
                <h2>Basic Info</h2>
                <p><strong>Shop Name:</strong> ${c.shopName||"Not set"}</p>
                <p><strong>Description:</strong> ${c.description||"Not set"}</p>
              </div>
              
              <div class="section">
                <h2>SEO Metadata</h2>
                <pre>${JSON.stringify(c.seoMetadata,null,2)}</pre>
              </div>
              
              <div class="section">
                <h2>AI Metadata</h2>
                <pre>${JSON.stringify(c.aiMetadata,null,2)}</pre>
              </div>
              
              <div class="section">
                <h2>Organization Schema</h2>
                <pre>${JSON.stringify(c.organizationSchema,null,2)}</pre>
              </div>
              
              <div class="section">
                <h2>Local Business Schema</h2>
                <pre>${JSON.stringify(c.localBusinessSchema,null,2)}</pre>
              </div>
              
              <div class="section">
                <h2>Raw Data</h2>
                <pre>${JSON.stringify(c,null,2)}</pre>
              </div>
            </body>
          </html>
        `),S.document.close()}else throw new Error("No preview data available")}catch(a){g(`Preview failed: ${(a==null?void 0:a.message)||"Unknown error"}`)}finally{T(!1)}}async function V(){k(!0);try{i({seo:{title:"",metaDescription:"",keywords:""},aiMetadata:{businessType:"",targetAudience:"",uniqueSellingPoints:"",brandVoice:"",primaryCategories:"",shippingInfo:"",returnPolicy:""},organizationSchema:{enabled:!1,name:"",email:"",phone:"",logo:"",sameAs:""},localBusinessSchema:{enabled:!1,priceRange:"",openingHours:""}}),await b(),g("Metadata cleared successfully!")}catch(e){g(`Clear failed: ${(e==null?void 0:e.message)||"Unknown error"}`)}finally{k(!1)}}return R&&!m?t.jsx(p,{children:t.jsx(u,{padding:"400",children:t.jsx(D,{children:"Loading store data..."})})}):(m==null?void 0:m.plan)==="Starter"?t.jsx(G,{status:"warning",children:t.jsx(D,{children:"Store metadata features are available starting from the Professional plan."})}):t.jsxs(f,{children:[t.jsx(f.Section,{children:t.jsx(p,{title:"Basic Store Information",children:t.jsx(u,{padding:"400",children:t.jsxs(M,{children:[t.jsx(r,{label:"SEO Title",value:n.seo.title,onChange:e=>i(a=>({...a,seo:{...a.seo,title:e}})),helpText:"Title for search engines (max 70 chars)",maxLength:70}),t.jsx(r,{label:"Meta Description",value:n.seo.metaDescription,onChange:e=>i(a=>({...a,seo:{...a.seo,metaDescription:e}})),helpText:"Description for search results (150-160 chars)",maxLength:160,multiline:3}),t.jsx(r,{label:"Keywords",value:n.seo.keywords,onChange:e=>i(a=>({...a,seo:{...a.seo,keywords:e}})),helpText:"Comma-separated keywords"})]})})})}),t.jsx(f.Section,{children:t.jsx(p,{title:"AI Metadata",children:t.jsx(u,{padding:"400",children:t.jsxs(M,{children:[t.jsxs(M.Group,{children:[t.jsx(r,{label:"Business Type",value:n.aiMetadata.businessType,onChange:e=>i(a=>({...a,aiMetadata:{...a.aiMetadata,businessType:e}})),placeholder:"e.g., Fashion Retailer, Electronics Store"}),t.jsx(r,{label:"Target Audience",value:n.aiMetadata.targetAudience,onChange:e=>i(a=>({...a,aiMetadata:{...a.aiMetadata,targetAudience:e}})),placeholder:"e.g., Young professionals, Parents"})]}),t.jsx(r,{label:"Unique Selling Points",value:n.aiMetadata.uniqueSellingPoints,onChange:e=>i(a=>({...a,aiMetadata:{...a.aiMetadata,uniqueSellingPoints:e}})),helpText:"Comma-separated list",multiline:2}),t.jsx(r,{label:"Brand Voice",value:n.aiMetadata.brandVoice,onChange:e=>i(a=>({...a,aiMetadata:{...a.aiMetadata,brandVoice:e}})),placeholder:"e.g., Professional, Friendly, Casual"}),t.jsx(r,{label:"Primary Categories",value:n.aiMetadata.primaryCategories,onChange:e=>i(a=>({...a,aiMetadata:{...a.aiMetadata,primaryCategories:e}})),helpText:"Main product categories, comma-separated"}),t.jsx(r,{label:"Shipping Information",value:n.aiMetadata.shippingInfo,onChange:e=>i(a=>({...a,aiMetadata:{...a.aiMetadata,shippingInfo:e}})),multiline:2}),t.jsx(r,{label:"Return Policy",value:n.aiMetadata.returnPolicy,onChange:e=>i(a=>({...a,aiMetadata:{...a.aiMetadata,returnPolicy:e}})),multiline:2})]})})})}),((v=m==null?void 0:m.features)==null?void 0:v.organizationSchema)&&t.jsx(f.Section,{children:t.jsx(p,{title:"Organization Schema",children:t.jsxs(u,{padding:"400",children:[t.jsx(X,{label:"Enable Organization Schema",checked:n.organizationSchema.enabled,onChange:e=>i(a=>({...a,organizationSchema:{...a.organizationSchema,enabled:e}}))}),n.organizationSchema.enabled&&t.jsx(u,{paddingBlockStart:"400",children:t.jsxs(M,{children:[t.jsxs(M.Group,{children:[t.jsx(r,{label:"Organization Name",value:n.organizationSchema.name,onChange:e=>i(a=>({...a,organizationSchema:{...a.organizationSchema,name:e}}))}),t.jsx(r,{label:"Contact Email",value:n.organizationSchema.email,onChange:e=>i(a=>({...a,organizationSchema:{...a.organizationSchema,email:e}})),type:"email"})]}),t.jsx(r,{label:"Phone",value:n.organizationSchema.phone,onChange:e=>i(a=>({...a,organizationSchema:{...a.organizationSchema,phone:e}})),type:"tel"}),t.jsx(r,{label:"Logo URL",value:n.organizationSchema.logo,onChange:e=>i(a=>({...a,organizationSchema:{...a.organizationSchema,logo:e}})),type:"url"}),t.jsx(r,{label:"Social Media Links",value:n.organizationSchema.sameAs,onChange:e=>i(a=>({...a,organizationSchema:{...a.organizationSchema,sameAs:e}})),helpText:"Comma-separated URLs",multiline:2})]})})]})})}),t.jsx(f.Section,{children:t.jsx(p,{children:t.jsx(u,{padding:"400",children:t.jsxs(H,{gap:"300",children:[t.jsx(j,{onClick:b,loading:L,primary:!0,children:"Save Metadata"}),t.jsx(j,{onClick:J,loading:q,children:"Preview Metadata"}),t.jsx(j,{onClick:V,loading:U,destructive:!0,children:"Clear Metadata"})]})})})}),C&&t.jsx(K,{content:C,onDismiss:()=>g("")})]})}export{ea as default};
