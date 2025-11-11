import{r as d}from"./react-vendor-tAaa2TlE-1762877803610.js";var f={exports:{}},n={};/**
 * @license React
 * react-jsx-runtime.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var y=d,a=Symbol.for("react.element"),l=Symbol.for("react.fragment"),_=Object.prototype.hasOwnProperty,c=y.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,m={key:!0,ref:!0,__self:!0,__source:!0};function u(t,e,s){var r,o={},i=null,p=null;s!==void 0&&(i=""+s),e.key!==void 0&&(i=""+e.key),e.ref!==void 0&&(p=e.ref);for(r in e)_.call(e,r)&&!m.hasOwnProperty(r)&&(o[r]=e[r]);if(t&&t.defaultProps)for(r in e=t.defaultProps,e)o[r]===void 0&&(o[r]=e[r]);return{$$typeof:a,type:t,key:i,ref:p,props:o,_owner:c.current}}n.Fragment=l;n.jsx=u;n.jsxs=u;f.exports=n;var v=f.exports;const h=new Proxy({},{get(t,e){throw Error(`shopify.${String(e)} can't be used in a server environment. You likely need to move this code into an Effect.`)}});function x(){if(typeof window>"u")return h;if(!window.shopify)throw Error("The shopify global is not defined. This likely means the App Bridge script tag was not added correctly to this page");return window.shopify}export{v as j,x as u};
