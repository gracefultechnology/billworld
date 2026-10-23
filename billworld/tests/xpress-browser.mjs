import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start } from '../server.mjs';
const temp=mkdtempSync(join(tmpdir(),'billworld-xpress-'));
const server=await start({port:0,adminPort:0,dbPath:join(temp,'world.sqlite')});
const browser=await puppeteer.launch({headless:true});
const artifacts=new URL('../artifacts/xpress/',import.meta.url); mkdirSync(artifacts,{recursive:true});
const results=[],errors=[],outbound=[];let activePage;
const heading=(page,title)=>page.waitForFunction(t=>document.querySelector('h1')?.textContent===t,{},title);
const fill=async(page,data)=>{for(const [name,value]of Object.entries(data))await page.locator(`[name="${name}"]`).fill(value);};
const submit=async(page,action,title)=>{await page.locator(`form[data-action="${action}"] button:not([type="button"])`).click();if(title)await heading(page,title);};
const go=async(page,route,title)=>{await page.goto(`${server.baseUrl}/xpress/${route}`);if(title)await heading(page,title);};
async function episode(options={}){
 const fixture=server.world.create({siteId:'homer-utilities',...options}),context=await browser.createBrowserContext(),page=await context.newPage();activePage=page;
 await page.setViewport({width:1365,height:900});await page.setRequestInterception(true);page.on('request',r=>{if(r.url().startsWith(server.baseUrl+'/')||r.url().startsWith('data:'))r.continue();else{outbound.push(r.url());r.abort();}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${server.baseUrl}/enter/${fixture.episodeId}/${fixture.entryToken}`);await heading(page,'LOGIN TO PAY YOUR BILLS ONLINE');return{fixture,context,page};
}
async function login(page,password='Billworld-2026!'){await go(page,'login','LOGIN TO PAY YOUR BILLS ONLINE');await fill(page,{email:'alex@billworld.test',password});await submit(page,'xpress-login','My Accounts');}
async function cart(page){await page.locator('[data-invoice="inv-current"]').click();await heading(page,'Bill Cart');}
async function savedReview(page){await cart(page);await submit(page,'xpress-cart','Checkout');await submit(page,'xpress-quote','Review and Confirm');}
async function mailbox(page){await page.goto(server.baseUrl+'/mail');await heading(page,'Sign in to Gmail');await fill(page,{email:'alex@billworld.test',password:'Mailbox-2026!'});await submit(page,'mail-login','Inbox');}
async function run(name,fn){const begin=Date.now();try{await fn();}catch(e){console.log('FAILED UI',activePage.url(),await activePage.$eval('main',e=>e.textContent));await activePage.screenshot({path:new URL('failure.png',artifacts).pathname,fullPage:true});throw e;}results.push({name,passed:true,milliseconds:Date.now()-begin});console.log('PASS '+name);}
try{
 await run('Xpress existing profile, saved checking, confirmation and history',async()=>{
  const{page,context,fixture}=await episode();await page.screenshot({path:new URL('login.png',artifacts).pathname,fullPage:true});await login(page);await savedReview(page);await page.screenshot({path:new URL('review.png',artifacts).pathname,fullPage:true});await submit(page,'xpress-pay','SUCCESS!');const confirmation=await page.$eval('#confirmation',e=>e.textContent);assert.equal(server.world.evaluate(fixture.episodeId,{confirmation}).success,true);await go(page,'history','Payment History');assert.match(await page.$eval('main',e=>e.textContent),new RegExp(confirmation));await context.close();
 });
 await run('Xpress registration, Gmail verification, organization lookup, paperless linking and payment',async()=>{
  const{page,context,fixture}=await episode({taskId:'homer-register-link-pay-v1'});await go(page,'register','CREATE ACCOUNT');await page.screenshot({path:new URL('register.png',artifacts).pathname,fullPage:true});await fill(page,{email:'alex@billworld.test',password:'Billworld-2026!',confirmPassword:'Billworld-2026!',firstName:'Alex',lastName:'Morgan',phone:'9075550148',address:'1048 Harbor Way',city:'Homer',postalCode:'99603'});await page.select('[name="region"]','AK');await page.locator('[name="acceptTerms"]').click();await submit(page,'xpress-register','Just One More Step');
  await mailbox(page);await page.locator('[data-testid="email-item-3"] .email-content').click();await page.locator('a[href^="/xpress/verify-email?token="]').click();await heading(page,'Email Verified');await page.locator('a.button').click();await heading(page,'LOGIN TO PAY YOUR BILLS ONLINE');await fill(page,{email:'alex@billworld.test',password:'Billworld-2026!'});await submit(page,'xpress-login','Add New Account');
  await fill(page,{organization:'Homer'});await submit(page,'xpress-organization');await page.locator('.xpress-org').click();await heading(page,'Add New Account');await fill(page,{customerNumber:'2002099',lastName:'Lee'});await submit(page,'xpress-lookup');await page.waitForFunction(()=>document.querySelector('#error').textContent.includes('verified'));await fill(page,{customerNumber:'1001048',lastName:'Morgan'});await submit(page,'xpress-lookup','Confirm Account');await page.locator('[name="paperless"]').click();await page.screenshot({path:new URL('link-preview.png',artifacts).pathname,fullPage:true});await submit(page,'xpress-link','Account Added');await page.locator('a[href="/xpress/accounts"]').click();await heading(page,'My Accounts');await cart(page);await submit(page,'xpress-cart','Checkout');assert.deepEqual(await page.$$eval('[name="methodId"] option',o=>o.map(x=>x.value)),['new-bank','new-card'],'a new profile starts without saved methods');await fill(page,{routing:'021000021',accountNumber:'000001048',confirmAccountNumber:'000001048'});await submit(page,'xpress-quote','Review and Confirm');await submit(page,'xpress-pay','SUCCESS!');const confirmation=await page.$eval('#confirmation',e=>e.textContent);assert.equal(server.world.evaluate(fixture.episodeId,{confirmation}).success,true);await page.screenshot({path:new URL('registered-confirmation.png',artifacts).pathname,fullPage:true});
  // A live completion-model failure happened after payment. Re-observation must
  // recover the existing confirmation without replaying the payment journey.
  const unreported=server.world.evaluate(fixture.episodeId,{});
  assert.equal(unreported.success,false);
  assert.deepEqual(Object.entries(unreported.checks).filter(([,ok])=>!ok).map(([name])=>name),['confirmation_reported']);
  const committed=server.world.state(fixture.episodeId);
  assert.equal(committed.payments.filter(p=>!p.initial).length,1);
  await page.reload();await heading(page,'Payment History');
  const history=await page.$$eval('tbody tr',rows=>rows.map(row=>[...row.cells].map(cell=>cell.textContent)));
  const recovered=history.find(row=>row[0]===confirmation);
  assert.ok(recovered,'Committed receipt remains visible after losing the in-memory success screen');
  assert.match(recovered[2],/posted/);
  assert.equal(server.world.evaluate(fixture.episodeId,{confirmation:recovered[0]}).success,true);
  const afterRecovery=server.world.state(fixture.episodeId);
  for(const field of ['payments','accounts','invoices'])assert.deepEqual(afterRecovery[field],committed[field],`Recovery must not mutate ${field}`);
  await page.screenshot({path:new URL('registered-recovered-history.png',artifacts).pathname,fullPage:true});
  await context.close();
 });
 await run('Xpress guest lookup, refresh, bank confirmation and rejection for signed-in task',async()=>{
  const{page,context,fixture}=await episode();await go(page,'guest','ENTER ACCOUNT INFORMATION');await page.screenshot({path:new URL('guest.png',artifacts).pathname,fullPage:true});await fill(page,{customerNumber:'1001048',lastName:'Morgan'});await submit(page,'xpress-guest','My Accounts');await page.reload();await heading(page,'My Accounts');await cart(page);await submit(page,'xpress-cart','Checkout');await fill(page,{name:'Alex Morgan',routing:'021000021',accountNumber:'000001048',confirmAccountNumber:'000001048',billingAddress:'1048 Harbor Way',billingCity:'Homer',billingRegion:'AK',billingPostalCode:'99603',contactPhone:'9075550148',receiptEmail:'alex@billworld.test'});await submit(page,'xpress-quote','Review and Confirm');await submit(page,'xpress-pay','SUCCESS!');const confirmation=await page.$eval('#confirmation',e=>e.textContent);assert.equal(server.world.state(fixture.episodeId).payments.filter(p=>!p.initial).length,1);assert.equal(server.world.evaluate(fixture.episodeId,{confirmation}).checks.authenticated_payment,false);await context.close();
 });
 await run('Xpress recovery through Gmail applies source password rules',async()=>{
  const{page,context}=await episode();await go(page,'forgot','Forgot Password');await fill(page,{email:'alex@billworld.test'});await submit(page,'xpress-forgot');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('sent'));await mailbox(page);await page.locator('[data-testid="email-item-3"] .email-content').click();await page.locator('a[href^="/portal/reset?token="]').click();await heading(page,'Reset Password');await fill(page,{password:'Restored-2026!',confirmPassword:'Restored-2026!'});await submit(page,'xpress-reset','LOGIN TO PAY YOUR BILLS ONLINE');await login(page,'Restored-2026!');await context.close();
 });
 await run('Xpress scheduled payment edit/cancel and Auto Pay execution',async()=>{
  const{page,context,fixture}=await episode();await login(page);await cart(page);await page.locator('[name="timing"][value="later"]').click();await fill(page,{date:'2026-10-12'});await submit(page,'xpress-cart','Checkout');await submit(page,'xpress-quote','Review and Confirm');await submit(page,'xpress-pay','Scheduled Payments');await fill(page,{date:'2026-10-13'});await submit(page,'xpress-edit');await page.waitForFunction(()=>document.querySelector('[name="date"]').value==='2026-10-13');await page.locator('[data-cancel]').click();await page.waitForFunction(()=>document.querySelector('main').textContent.includes('cancelled'));await go(page,'autopay','Auto Pays');await page.select('[name="enabled"]','yes');await fill(page,{day:'15'});await submit(page,'xpress-autopay');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('saved'));await page.reload();await heading(page,'Auto Pays');assert.equal(await page.$eval('[name="day"]',e=>e.value),'15');server.world.advance(fixture.episodeId,Date.parse('2026-10-15T00:00:00Z')-server.world.state(fixture.episodeId).now);await login(page);await go(page,'history','Payment History');assert.match(await page.$eval('main',e=>e.textContent),/posted/);await context.close();
 });
 await run('Xpress new card decline, correction and exactly one posted card payment',async()=>{
  const{page,context,fixture}=await episode();await login(page);await cart(page);await submit(page,'xpress-cart','Checkout');await page.select('[name="methodId"]','new-card');await page.waitForSelector('[name="cardNumber"]');await fill(page,{cardNumber:'4000000000000002',expiry:'12/29',cvv:'123'});await submit(page,'xpress-quote','Review and Confirm');await submit(page,'xpress-pay');await page.waitForFunction(()=>document.querySelector('#error').textContent.includes('declined'));assert.equal(server.world.state(fixture.episodeId).payments.filter(p=>!p.initial).length,0);await page.locator('a[href="/xpress/checkout"]').click();await heading(page,'Checkout');await fill(page,{cardNumber:'4242424242424242',expiry:'12/29',cvv:'123'});await submit(page,'xpress-quote','Review and Confirm');await submit(page,'xpress-pay','SUCCESS!');const payments=server.world.state(fixture.episodeId).payments.filter(p=>!p.initial);assert.equal(payments.length,1);assert.equal(payments[0].method.last4,'4242');await context.close();
 });
 assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);writeFileSync(new URL('results.json',artifacts),JSON.stringify({kind:'reference_script',browser:await browser.version(),results,errors,outbound},null,2));console.log(`${results.length} Xpress browser scenarios passed; no page errors or external requests.`);
}finally{await browser.close();await server.close();rmSync(temp,{recursive:true,force:true});}
