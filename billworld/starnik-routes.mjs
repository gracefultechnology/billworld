// Tenant-owned source pages; private continuations reuse its login shell.
const continuations=new Set(['/my-account/ebill','/starnik/payment','/starnik/payment/review','/starnik/payment/receipt','/my-account/autopay','/my-account/autopay/enroll','/my-account/payment-methods','/my-account/payment-methods/add','/my-account/payment-methods/review','/transaction-history','/starnik/guest/review','/starnik/guest/receipt','/starnik/guest/account','/starnik/account','/starnik/scheduled','/starnik/scheduled/review','/starnik/reset','/starnik/signup/pending','/starnik/signup/setup','/starnik/signup/complete','/my-account/accounts','/my-account/mailing-address','/my-account/ach','/my-account/ach/agreement']);
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
 return nameImageLinks(markup.replaceAll('href="/starnikERP/"','href="/starnikERP/#/rp_guestpay/rp_guestpay"'));
}
// Captured tenant pages link some icons and logos with alt="" images, which leaves the link with no accessible
// name. Name such links after the caption that follows them (Divi blurbs: icon link, then its title), the home
// page for "/", and the collapsed mobile menu toggle.
const plain=x=>x.replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const attr=x=>x.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
export function nameImageLinks(markup){
 return markup.replace(/<a ([^>]*\bhref="[^"]*"[^>]*)>((?:(?!<\/a>)[\s\S])*?)<\/a>/g,(whole,attrs,inner,offset)=>{
  if(/\baria-label=/.test(attrs))return whole;
  if(/\bclass="[^"]*\bmobile_nav\b/.test(attrs))return '<a '+attrs+' aria-label="Menu">'+inner+'</a>';
  if(!/<img\b/i.test(inner)||plain(inner.replace(/<[^>]*>/g,''))||[...inner.matchAll(/<img\b[^>]*\balt="([^"]*)"/gi)].some(m=>plain(m[1])))return whole;
  const href=(attrs.match(/\bhref="([^"]*)"/)||[])[1];
  let label=href==='/'?'Home':'';
  if(!label){const after=markup.slice(offset+whole.length,offset+whole.length+1500),text=[...after.matchAll(/>([^<>]+)</g)].map(m=>plain(m[1])).find(t=>t&&!/^[{}();]/.test(t));label=text&&text.length<=80?text:'';}
  return label?'<a '+attrs+' aria-label="'+attr(label)+'">'+inner+'</a>':whole;
 });
}
