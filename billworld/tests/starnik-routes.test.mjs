import test from 'node:test';import assert from 'node:assert/strict';
import {starnikRoutes,starnikSourceRoute,starnikSourceLinks} from '../starnik-routes.mjs';
const prefix='biller_79d57f82caebe2d84035';
const site={runtime:{snapshot_routes:{'/RP_Default.aspx':{page_id:prefix+'-login_url',interactive:true},'/':{page_id:prefix+'-website',interactive:false},'/starnikERP/':{page_id:prefix+'-portal-guest-observed',interactive:true}}}};
test('Tenant routes and private continuations use only the configured source shell',()=>{
 const routes=starnikRoutes(site);
 assert.equal(starnikSourceRoute(routes,'/').snapshotPath,'/reference-pages/'+prefix+'-website/index.html');
 for(const path of ['/starnik/account','/starnik/payment/review','/my-account/payment-methods/edit/bank-1'])assert.equal(starnikSourceRoute(routes,path).snapshotPath,'/reference-pages/'+prefix+'-login_url/index.html');
 assert.equal(starnikSourceRoute(routes,'/unknown'),null);assert.equal(starnikSourceRoute(routes,'/my-account/payment-methods/edit/'),null);
 assert.equal(starnikSourceRoute(routes,'/').interactive,false);
});
test('Source anchor rewriting maps this tenant and preserves unrelated captures',()=>{
 const routes=starnikRoutes(site),foreign='/reference-pages/biller_97db8399eb95ee4cb710-website/index.html';
 const html='<a href="'+routes['/'].snapshotPath+'">Home</a><a href="'+routes['/starnikERP/'].snapshotPath+'">Pay</a><a href="'+foreign+'">Other</a>';
 const result=starnikSourceLinks(html,routes);assert.ok(result.includes('href="/"'));assert.ok(result.includes('href="/starnikERP/#/rp_guestpay/rp_guestpay"'));assert.ok(result.includes('href="'+foreign+'"'));
});
test('Missing shell, malformed paths and unsafe page IDs cannot fall back to GMG',()=>{
 for(const bad of [{},{runtime:{snapshot_routes:{}}},{runtime:{snapshot_routes:{'/':site.runtime.snapshot_routes['/']}}}])assert.throws(()=>starnikRoutes(bad));
 for(const[path,value]of [['//elsewhere',site.runtime.snapshot_routes['/']],['/../escape',site.runtime.snapshot_routes['/']],['/x?y',site.runtime.snapshot_routes['/']],['/x',{page_id:'../escape',interactive:true}],['/x',{page_id:prefix+'-home',interactive:'yes'}]])assert.throws(()=>starnikRoutes({runtime:{snapshot_routes:{...site.runtime.snapshot_routes,[path]:value}}}));
});
test('Image-only links in captured tenant pages get accessible names; named links are untouched',()=>{
 const html='<a href="#" class="mobile_nav closed"><span></span></a><a href="/"><img alt="" src="logo"></a><a href="/billing"><span class="w"><img alt="" title="" src="i"></span></a></div><div class="t"><h4>Make a Payment</h4></div><a href="/x"><img alt="Named" src="n"></a><a href="/y" aria-label="Kept"><img alt="" src="k"></a><a href="/z">Text <img alt="" src="t"></a>';
 const out=starnikSourceLinks(html,{});
 assert.match(out,/class="mobile_nav closed" aria-label="Menu"/);assert.match(out,/<a href="\/" aria-label="Home">/);assert.match(out,/<a href="\/billing" aria-label="Make a Payment">/);
 assert.ok(out.includes('<a href="/x"><img alt="Named"'));assert.ok(out.includes('<a href="/y" aria-label="Kept">'));assert.ok(out.includes('<a href="/z">Text'));
});
