// Batavia first-slice journeys added for release: My Profile, password change,
// future-dated scheduling with edit/cancel, multi-account payment, the city bank-draft
// duplicate warning and an accessible-name audit of every signed-in page visited.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {start} from '../server.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
const directory=new URL('../artifacts/batavia-portal-browser/',import.meta.url);mkdirSync(directory,{recursive:true});
const report={kind:'batavia_first_slice_portal_journeys',scenarios:[],accessibility_pages:[],page_errors:[],outbound_requests:[]};
const server=await start({port:0,adminPort:0,dbPath:':memory:'});let browser,page;
const go=path=>page.goto(server.baseUrl+path,{waitUntil:'networkidle0'});
const nav=fn=>Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}),fn()]);
const fill=(selector,value)=>page.locator(selector).fill(value,{typingThreshold:0});
const click=selector=>page.locator(selector).click();
const text=selector=>page.$eval(selector,e=>e.textContent);
const shot=name=>page.screenshot({path:new URL(name+'.png',directory).pathname,fullPage:true});
async function audit(label){
 // Every control a one-tab agent can use must expose an accessible name; no new tabs.
 const problems=await page.evaluate(()=>{const name=e=>(e.getAttribute('aria-label')||[...(e.labels||[])].map(l=>l.textContent).join(' ')||e.textContent||e.value||'').trim();return[...document.querySelectorAll('a,button,input,select,textarea')].filter(e=>!(e.type==='hidden')&&e.checkVisibility()).flatMap(e=>[...(name(e)?[]:['unnamed '+e.outerHTML.slice(0,80)]),...(e.target==='_blank'?['new tab '+e.outerHTML.slice(0,80)]:[])]);});
 assert.deepEqual(problems,[],label);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);assert.equal(overflow,false,label+' horizontal overflow');report.accessibility_pages.push(label);
}
async function enter(taskId,password='Billworld-2026!'){const f=server.world.create({siteId:'batavia-utilities',taskId});await go(`/enter/${f.episodeId}/${f.entryToken}`);await login(password);return f;}
async function login(password){await go('/paymentus/login');await page.waitForSelector('#paymentus-login');await fill('[name=email]','alex@billworld.test');await fill('[name=password]',password);await nav(()=>click('#paymentus-login button'));await page.waitForSelector('#paymentus-account');}
const state=f=>server.world.state(f.episodeId);
try{
 browser=await puppeteer.launch({headless:'shell',timeout:120000});report.browser_version=await browser.version();page=await browser.newPage();page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(60000);await page.setViewport({width:1365,height:900});
 page.on('pageerror',e=>report.page_errors.push(e.message));page.on('popup',p=>report.page_errors.push('unexpected popup '+p.url()));await page.setRequestInterception(true);page.on('request',r=>{if(r.url().startsWith(server.baseUrl+'/')||r.url().startsWith('data:'))r.continue();else{report.outbound_requests.push(r.url());r.abort();}});

 // My Profile
 let f=await enter('batavia-update-profile-v1');await audit('accounts');
 assert.deepEqual(await page.$$eval('nav[aria-label="Customer Portal"] a',a=>a.map(x=>x.textContent)),['Accounts','Pay My Bill','AutoPay','Bill History','Payment History','My Wallet','My Profile']);
 await nav(()=>click('nav a[href="/paymentus/profile"]'));await page.waitForSelector('#paymentus-profile');await audit('profile');
 await fill('#phone','555');await click('#paymentus-profile button');await page.waitForFunction(()=>document.querySelector('#paymentus-profile .error').textContent.includes('ten-digit'));
 await fill('#phone','(630) 555-0199');await click('#paymentus-profile button');await page.waitForFunction(()=>document.querySelector('#paymentus-profile-status').textContent==='Profile saved');
 await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('#paymentus-profile');assert.equal(await page.$eval('#phone',e=>e.value),'6305550199');assert.equal(await page.$eval('#zipCode',e=>e.value),'60510');
 assert.equal(server.world.evaluate(f.episodeId).success,true);await shot('profile');report.scenarios.push('My Profile from the left menu: invalid phone rejected inline, phone saved, reload shows persisted value; profile grader passes');

 // Password change, logout and relogin
 f=await enter('batavia-change-password-v1');await nav(()=>click('nav a[href="/paymentus/profile"]'));await page.waitForSelector('#paymentus-password');
 await fill('#currentPassword','wrong-password-1');await fill('#newPassword','Batavia-Secure-2026!');await fill('#confirmPassword','Batavia-Secure-2026!');await click('#paymentus-password button');await page.waitForFunction(()=>document.querySelector('#paymentus-password .error').textContent.includes('Current password'));
 await fill('#currentPassword','Billworld-2026!');await fill('#newPassword','Batavia-Secure-2026!');await fill('#confirmPassword','Batavia-Secure-2026!');await click('#paymentus-password button');await page.waitForFunction(()=>document.querySelector('#paymentus-password-status').textContent==='Password changed');
 await nav(()=>click('#paymentus-logout'));await page.waitForSelector('#paymentus-login');await fill('[name=email]','alex@billworld.test');await fill('[name=password]','Billworld-2026!');await click('#paymentus-login button');await page.waitForFunction(()=>document.querySelector('#paymentus-login .error').textContent.length>0);
 await login('Batavia-Secure-2026!');assert.equal(server.world.evaluate(f.episodeId).success,true);report.scenarios.push('Password change rejects wrong current password, then old password fails and new password signs in; password grader passes');

 // Schedule a future-dated payment from saved checking
 f=await enter('batavia-schedule-payment-v1');await nav(()=>click('nav a[href="/paymentus/bills"]'));await page.waitForSelector('#paymentus-bills');await audit('bills');
 await nav(()=>click('a[href="/paymentus/pay?invoiceId=inv-current"]'));await page.waitForSelector('#paymentus-payment');await audit('pay');await page.select('[name=kind]','saved:bank-1048');assert.equal(await page.$eval('[name=name]',e=>e.disabled),true);
 await nav(()=>click('#paymentus-payment button'));await page.waitForSelector('#paymentus-pay');await audit('review');assert.equal(await text('#paymentus-total'),'$87.82');
 await click('[name=when][value=later]');assert.equal(await text('#paymentus-pay button'),'Schedule Payment');await fill('#date','2026-10-25');await click('[name=authorize]');await click('#paymentus-pay button');await page.waitForFunction(()=>document.querySelector('#paymentus-pay .error').textContent.includes('due date'));
 await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('#paymentus-pay');await click('[name=when][value=later]');await fill('#date','2026-10-15');await click('[name=authorize]');await nav(()=>click('#paymentus-pay button'));await page.waitForSelector('#paymentus-scheduled');await audit('scheduled');
 const confirmation=await page.$eval('[data-schedule-id] h2',e=>e.textContent);assert.match(confirmation,/^BWS-/);assert.equal(await text('[data-schedule-date]'),'2026-10-15');assert.equal(state(f).payments.filter(p=>!p.initial).length,0);
 assert.equal(server.world.evaluate(f.episodeId,{confirmation}).success,true);await shot('scheduled');report.scenarios.push('Review page Payment Date: due-date bound enforced inline, review survives reload, saved-checking payment scheduled without immediate charge; schedule grader passes with reported confirmation');
 server.world.advance(f.episodeId,Date.parse('2026-10-15T00:00:00Z')-state(f).now);await login('Billworld-2026!');await nav(()=>click('nav a[href="/paymentus/history"]'));await page.waitForSelector('#paymentus-history');assert.ok((await text('#paymentus-history')).includes(confirmation));
 await nav(()=>click('#paymentus-history a[href="/paymentus/scheduled"]'));assert.equal(await text('[data-schedule-status]'),'Processed');report.scenarios.push('Scheduled payment executes at 00:00 UTC on its date, appears in Payment History and shows Processed');

 // Edit the seeded scheduled payment
 f=await enter('batavia-edit-scheduled-payment-v1');await nav(()=>click('a[href="/paymentus/scheduled"]'));await page.waitForSelector('#paymentus-scheduled');
 await nav(()=>click('a[href="/paymentus/scheduled/edit?scheduleId=pms-seed"]'));await page.waitForSelector('#paymentus-schedule-change');await audit('schedule edit');
 await fill('#amount','90.00');await click('#paymentus-schedule-change button');await page.waitForFunction(()=>document.querySelector('#paymentus-schedule-change .error').textContent.length>0);
 await fill('#date','2026-10-12');await fill('#amount','60.00');await nav(()=>click('#paymentus-schedule-change button'));await page.waitForSelector('#paymentus-scheduled');await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('#paymentus-scheduled');
 assert.equal(await text('[data-schedule-date]'),'2026-10-12');assert.equal(await text('[data-schedule-amount]'),'$60.00');assert.equal(server.world.evaluate(f.episodeId).success,true);report.scenarios.push('Seeded scheduled payment: over-balance amount rejected, date/amount edited, reload confirms; edit grader passes');

 // Cancel the seeded scheduled payment
 f=await enter('batavia-cancel-scheduled-payment-v1');await nav(()=>click('nav a[href="/paymentus/history"]'));await nav(()=>click('#paymentus-history a[href="/paymentus/scheduled"]'));await page.waitForSelector('#paymentus-scheduled');
 await nav(()=>click('a[href="/paymentus/scheduled/cancel?scheduleId=pms-seed"]'));await page.waitForSelector('#paymentus-schedule-change');await audit('schedule cancel');await click('#paymentus-schedule-change button');await page.waitForFunction(()=>document.querySelector('#paymentus-schedule-change .error').textContent.includes('Confirm'));
 await click('[name=confirm]');await nav(()=>click('#paymentus-schedule-change button'));await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('#paymentus-scheduled');assert.equal(await text('[data-schedule-status]'),'Cancelled');assert.equal(await page.$('a[href^="/paymentus/scheduled/edit"]'),null);
 assert.equal(server.world.evaluate(f.episodeId).success,true);server.world.advance(f.episodeId,30*86400000);assert.equal(state(f).payments.filter(p=>!p.initial).length,0);report.scenarios.push('Cancellation requires confirmation, shows Cancelled after reload, removes edit controls and never charges; cancel grader passes');

 // Pay two linked accounts in one payment
 f=await enter('batavia-pay-multiple-accounts-v1');assert.equal(await page.$$eval('[data-account-id]',a=>a.length),2);await nav(()=>click('#paymentus-account a[href="/paymentus/pay-multiple"]'));await page.waitForSelector('#paymentus-multi');await audit('pay multiple');
 await page.select('[name=kind]','saved:bank-1048');await nav(()=>click('#paymentus-multi button'));await page.waitForSelector('#paymentus-multi-pay');await audit('multi review');assert.equal(await text('#paymentus-total'),'$128.97');
 await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('#paymentus-multi-pay');await click('[name=authorize]');await nav(()=>click('#paymentus-multi-pay button'));await page.waitForSelector('#paymentus-multi-receipt');await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('#confirmation');
 const multi=await text('#confirmation');assert.match(multi,/^BWM-/);assert.equal(server.world.evaluate(f.episodeId,{confirmation:multi}).success,true);
 await nav(()=>click('nav a[href="/paymentus/accounts"]'));assert.deepEqual(await page.$$eval('[data-account-payment-status]',a=>a.map(x=>x.textContent)),['No payment due','No payment due']);await shot('multi-accounts');report.scenarios.push('Two linked accounts paid in one reviewed payment with one $3.50 fee; receipt reload, both accounts show no payment due; multi grader passes');

 // Accessible-name sweep of the remaining signed-in and public portal pages
 for(const path of ['/paymentus/bills','/paymentus/history','/paymentus/bill-history','/paymentus/wallet','/paymentus/wallet/add','/paymentus/wallet/edit?methodId=card-4242','/paymentus/autopay','/paymentus/preferences?accountId=acct-primary','/paymentus/add-account','/paymentus/profile']){await go(path);await page.waitForSelector('nav[aria-label="Customer Portal"]');await page.waitForFunction(()=>document.querySelector('.panel h1')&&!document.querySelector('#paymentus > p'));await audit('signed-in '+path);}
 await nav(()=>click('#paymentus-logout'));for(const path of ['/paymentus/login','/paymentus/register','/paymentus/recover','/paymentus/terms']){await go(path);await page.waitForSelector('.panel h1');await audit('public '+path);}
 report.scenarios.push('Every visited portal page exposes accessible names for all visible controls and opens no new tabs');

 // City bank-draft duplicate warning on AutoPay
 f=await enter('batavia-enable-autopay-v1');await nav(()=>click('a[href="/paymentus/autopay?accountId=acct-primary"]'));await page.waitForSelector('#paymentus-autopay');await audit('autopay');assert.match(await text('#paymentus-autopay .warning'),/duplicate payments/);
 await page.select('[name=methodId]','bank-1048');await nav(()=>click('#paymentus-autopay button'));await page.waitForSelector('#paymentus-autopay-confirm');await audit('autopay review');await click('[name=authorize]');await click('#paymentus-autopay-confirm button');await page.waitForFunction(()=>document.querySelector('#paymentus-autopay-confirm .error').textContent.includes('city bank draft'));
 assert.equal(state(f).accounts[0].autopay.enabled,false);report.scenarios.push('AutoPay shows the City free bank-draft duplicate-payment warning and refuses enrollment without the not-enrolled acknowledgement');

 // Mobile layout of signed-in pages
 await page.setViewport({width:390,height:844});for(const path of ['/paymentus/accounts','/paymentus/profile','/paymentus/bills','/paymentus/scheduled']){await go(path);await page.waitForSelector('nav[aria-label="Customer Portal"]');await audit('mobile '+path);}report.scenarios.push('Signed-in pages fit a 390px viewport without horizontal scrolling');

 assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.outbound_requests,[]);report.all_passed=true;console.log(JSON.stringify(report,null,2));
}catch(e){report.all_passed=false;report.error=e.message;if(page&&!page.isClosed())await shot('failure');throw e;}
finally{writeFileSync(new URL('report.json',directory),JSON.stringify(report,null,2)+'\n');await browser?.close();await server.close();}
