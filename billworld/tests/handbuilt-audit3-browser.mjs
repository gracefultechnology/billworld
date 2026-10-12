// Regressions from blind-agent audit handbuilt-3 (batavia-utilities, greater-minnesota-gas, inframark).
// - task_bat2: mock Gmail must not replace its DOM on idle polls (element handles survive >2 s).
// - task_inf4/inf5/gmg2: Starnik mail links are named after the tenant, and the seeded mail never reveals the username.
// - task_gmg1: signed-in account page has its own title, no "Sign in" link, per-bill View Bill names; homepage links named.
// - task_gmg5: Starnik selects have short accessible names (not the option list).
// - task_gmg9: an AutoPay method change is worded as a change.
// - task_gmg12: Back from payment review keeps the chosen method and amount.
// Usage: node billworld/tests/handbuilt-audit3-browser.mjs
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {start} from '../server.mjs';

const dir=new URL('../artifacts/handbuilt-audit3-browser/',import.meta.url);mkdirSync(dir,{recursive:true});
const r=await start({port:0,adminPort:0,dbPath:':memory:',construction:true});let browser,page;
const report={kind:'handbuilt_audit3_regressions',scenarios:[],page_errors:[],outbound_requests:[]};
const pass=name=>{report.scenarios.push(name);console.log('PASS '+name);};
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
async function episode(siteId,taskId){
 const f=r.world.create({siteId,taskId}),context=await browser.createBrowserContext();page=await context.newPage();await page.setViewport({width:1365,height:900});page.setDefaultTimeout(30000);
 const cdp=await page.createCDPSession();await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urlPatterns:[{urlPattern:r.baseUrl+'/*',block:false},{urlPattern:'*://*:*/*',block:true}]});
 page.on('pageerror',e=>report.page_errors.push(taskId+': '+e.message));page.on('request',q=>{if(!q.url().startsWith(r.baseUrl)&&!q.url().startsWith('data:'))report.outbound_requests.push(q.url());});
 await page.goto(`${r.baseUrl}/enter/${f.episodeId}/${f.entryToken}`,{waitUntil:'domcontentloaded'});return{f,context};
}
const go=p=>page.goto(r.baseUrl+p,{waitUntil:'networkidle0'});
const fill=(n,v)=>page.locator('[name="'+n+'"]').fill(v,{typingThreshold:0});
const nav=s=>Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}),page.locator(s).click()]);
const axName=async selector=>{const h=await page.$(selector);const node=await page.accessibility.snapshot({root:h,interestingOnly:false});return node?.name;};
async function mailLogin(){await go('/mail');await fill('email','alex@billworld.test');await fill('password','Mailbox-2026!');await page.locator('form[data-action="mail-login"] button').click();await page.waitForSelector('[data-testid="email-item-1"]');}
async function starnikLogin(username,password){await go('/RP_Default.aspx');await page.waitForSelector('#starnik-login');await fill('username',username);await fill('password',password);await nav('#ctl04_ctl00_btnLogin');await page.waitForSelector('#starnik-logout');}
try{
 browser=await puppeteer.launch({headless:'shell',timeout:120000});

 // Inframark recovery: seeded mail, stable DOM across polls, tenant-named reset link.
 {const {f,context}=await episode('inframark','inframark-recover-username-password-v1');
  for(const m of r.world.state(f.episodeId).mail)assert.ok(!(m.subject+' '+m.text).includes('alex.inframark'),'seeded mail reveals username: '+m.subject);
  r.world.starnikRecoveryRequest(f.episodeId,{kind:'password',username:'alex.inframark'});
  await mailLogin();const row=await page.$('[data-testid="email-open-2"], [data-testid="email-item-2"] a.email-open');assert.ok(row,'inbox row link');await sleep(5000);
  assert.equal(await row.evaluate(e=>e.isConnected),true,'inbox row replaced by an idle poll');await row.click();
  const link=await page.waitForSelector('a[href^="/starnik/reset?token="]');assert.equal((await link.evaluate(e=>e.textContent)).trim(),'Reset your Inframark password');await sleep(5000);
  assert.equal(await link.evaluate(e=>e.isConnected),true,'message link replaced by an idle poll');
  await Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}),link.click()]);await page.waitForSelector('#starnik-reset');
  pass('Mock Gmail keeps elements across idle polls; Inframark reset link names Inframark; seeded mail hides the username');await context.close();}

 // Inframark registration: verification link label.
 {const {f,context}=await episode('inframark','inframark-register-account-v1');
  await go('/RP/signup');await page.waitForSelector('#starnik-signup');
  for(const [name,value] of [['securityCode','INF1048'],['email','alex@billworld.test'],['confirmEmail','alex@billworld.test']])if(await page.$('[name="'+name+'"]'))await fill(name,value);
  await Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}).catch(()=>{}),page.locator('#starnik-signup button[type=submit]').click()]);
  await mailLogin();const subject=r.world.state(f.episodeId).mail.at(-1).subject;assert.match(subject,/Inframark/);
  await page.locator('[data-testid="email-item-'+r.world.state(f.episodeId).mail.length+'"] .email-content').click();const link=await page.waitForSelector('a[href^="/starnik/signup/verify?token="]');
  assert.equal((await link.evaluate(e=>e.textContent)).trim(),'Verify your Inframark email');pass('Inframark verification link names Inframark, not GMG');await context.close();}

 // GMG homepage and signed-in account page.
 {const {context}=await episode('greater-minnesota-gas','gmg-username-login-v1');await go('/');
  const unnamed=await page.evaluate(()=>[...document.querySelectorAll('a[href]')].filter(a=>!(a.getAttribute('aria-label')||a.textContent.trim()||[...a.querySelectorAll('img')].map(i=>i.alt).join('').trim()||a.title)).map(a=>a.outerHTML.slice(0,120)));
  assert.deepEqual(unnamed,[],'GMG homepage links without a name');
  await starnikLogin('alex.morgan','Billworld-2026!');assert.equal(await page.title(),'Greater Minnesota Gas account');
  assert.equal(await page.$('a[href="/RP_Default.aspx"]'),null,'Sign in link shown while signed in');
  const names=await page.$$eval('a[data-statement]',as=>as.map(a=>a.getAttribute('aria-label')));assert.ok(names.length>=2);assert.equal(new Set(names).size,names.length,'View Bill links share a name');
  pass('GMG homepage image links named; account page titled, no Sign in when signed in, unique View Bill names');await context.close();}

 // GMG saved card payment: Back from review keeps method and amount; select names are short.
 {const {context}=await episode('greater-minnesota-gas','gmg-saved-card-payment-v1');await starnikLogin('alex.morgan','Billworld-2026!');await go('/starnik/payment');await page.waitForSelector('#starnik-signed-payment');
  assert.equal(await axName('#starnik-signed-payment select[name=methodId]'),'Payment Method');
  const options=await page.$$eval('#starnik-signed-payment select[name=methodId] option',os=>os.map(o=>o.value));const chosen=options.at(-1);assert.ok(options.length>1&&chosen!==options[0]);
  await page.select('#starnik-signed-payment select[name=methodId]',chosen);await fill('amount','10.00');await nav('#starnik-signed-payment button');await page.waitForSelector('#starnik-signed-confirm');
  await nav('#starnik-signed-confirm a[href="/starnik/payment"]');await page.waitForSelector('#starnik-signed-payment');
  assert.equal(await page.$eval('[name=methodId]',e=>e.value),chosen);assert.equal(await page.$eval('[name=amount]',e=>e.value),'10.00');
  await page.goBack({waitUntil:'networkidle0'});await page.waitForSelector('#starnik-signed-confirm');await page.goBack({waitUntil:'networkidle0'});await page.waitForSelector('#starnik-signed-payment');
  assert.equal(await page.$eval('[name=methodId]',e=>e.value),chosen);
  pass('Back from Starnik payment review keeps the chosen method and amount; method select has a short name');await context.close();}

 // GMG guest checkout select names.
 {const {context}=await episode('greater-minnesota-gas','gmg-guest-card-payment-v1');await go('/starnikERP/#/rp_guestpay/rp_guestpay');await page.waitForSelector('#starnik-guest-lookup');
  await fill('securityCode','GMG1048');await fill('serviceZip','56001');await nav('#starnik-guest-lookup button');await page.waitForSelector('#starnik-payment');
  for(const [n,label] of [['kind','Payment method'],['accountType','Account type']])assert.equal(await axName('#starnik-payment select[name='+n+']'),label);
  pass('Starnik guest checkout selects are named by their label only');await context.close();}

 // GMG AutoPay method change wording.
 {const {f,context}=await episode('greater-minnesota-gas','gmg-autopay-change-v1');assert.equal(r.world.state(f.episodeId).accounts[0].autopay.enabled,true,'change task seeds enabled AutoPay');
  await starnikLogin('alex.morgan','Billworld-2026!');await go('/my-account/autopay');await page.waitForSelector('#starnik-autopay-select');
  const current=r.world.state(f.episodeId).accounts[0].autopay.methodId,other=await page.$$eval('#starnik-autopay-select option:not([disabled])',(os,c)=>os.map(o=>o.value).find(v=>v!==c),current);
  await page.select('#starnik-autopay-select select',other);await nav('#starnik-autopay-select button');await page.waitForSelector('#starnik-autopay-confirm');
  assert.equal(await page.$eval('#starnik-autopay h2',e=>e.textContent),'Review AutoPay Payment Method Change');assert.equal(await page.$eval('#starnik-autopay-confirm button',e=>e.textContent),'Change AutoPay Method');
  pass('Starnik AutoPay method change is worded as a change');await context.close();}

 assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.outbound_requests,[]);report.all_passed=true;
}catch(e){report.all_passed=false;report.error=e.message;if(page&&!page.isClosed())await page.screenshot({path:new URL('failure.png',dir).pathname,fullPage:true}).catch(()=>{});throw e;}
finally{writeFileSync(new URL('report.json',dir),JSON.stringify(report,null,2)+'\n');await browser?.close();await r.close();}
