// Tenant-owned source pages; private continuations reuse its login shell.
const continuations=new Set(['/my-account/ebill','/starnik/payment','/starnik/payment/review','/starnik/payment/receipt','/my-account/autopay','/my-account/autopay/enroll','/my-account/payment-methods','/my-account/payment-methods/add','/my-account/payment-methods/review','/transaction-history','/starnik/guest/review','/starnik/guest/receipt','/starnik/guest/account','/starnik/account','/starnik/reset','/starnik/signup/pending','/starnik/signup/setup','/starnik/signup/complete']);
export function starnikRoutes(site){
 const config=site?.runtime?.snapshot_routes;
 if(!config||typeof config!=='object'||Array.isArray(config)||!Object.keys(config).length)throw Error('Tenant source routes unavailable');
 const routes={};
 for(const[path,value]of Object.entries(config)){
  if(!/^\/[A-Za-z0-9_./-]*$/.test(path)||path.startsWith('//')||path.split('/').some(x=>x==='.'||x==='..')||!value||!/^biller_[a-f0-9]{20}-[a-zA-Z0-9_-]+$/.test(value.page_id)||typeof value.interactive!=='boolean')throw Error('Invalid tenant source route');
  routes[path]={snapshotPath:'/reference-pages/'+value.page_id+'/index.html',interactive:value.interactive};
 }
 if(!routes['/RP_Default.aspx']?.interactive)throw Error('Tenant login source unavailable');
 return routes;
}
export function starnikSourceRoute(routes,path){
 return routes[path]||(continuations.has(path)||/^\/my-account\/payment-methods\/edit\/[^/]+$/.test(path)?routes['/RP_Default.aspx']:null);
}
export function starnikSourceLinks(markup,routes){
 for(const[path,route]of Object.entries(routes))markup=markup.replaceAll('href="'+route.snapshotPath+'"','href="'+path+'"');
 return markup.replaceAll('href="/starnikERP/"','href="/starnikERP/#/rp_guestpay/rp_guestpay"');
}
