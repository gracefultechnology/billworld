import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {start} from '../server.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';

const dir=new URL('../artifacts/personapay-plans-browser/',import.meta.url);
mkdirSync(dir,{recursive:true});
const server=await start({port:0,adminPort:0,dbPath:':memory:'});
const browser=await puppeteer.launch({headless:true}),results=[],errors=[],outbound=[];
const go=async(page,path)=>page.goto(server.baseUrl+path,{waitUntil:'networkidle0'});
const nav=async(page,fn)=>Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}),fn()]);
async function login(page,f){
 await go(page,'/personapay/login');await page.waitForFunction(()=>!document.querySelector('#Validation1-4').disabled);
 for(const [name,value]of Object.entries(f.dentalCredentials))await page.locator('[name='+name+']').fill(value);
 await nav(page,()=>page.locator('#rs-loading-button').click());await page.waitForSelector('#dental-payment');
}
async function make(type='recurring'){
 const f=server.world.create({siteId:'western-dental',taskId:`western-dental-${type}-plan-v1`}),context=await browser.createBrowserContext(),page=await context.newPage();
 page.setDefaultTimeout(12000);await page.setViewport({width:1365,height:900});page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);page.on('request',r=>{if(r.url().startsWith(server.baseUrl+'/')||r.url().startsWith('data:'))r.continue();else{outbound.push(r.url());r.abort();}});
 await page.goto(`${server.baseUrl}/enter/${f.episodeId}/${f.entryToken}`,{waitUntil:'networkidle0'});await login(page,f);
 await nav(page,()=>page.locator('a[href="/personapay/plan"]').click());await page.waitForSelector('#dental-plan');
 await page.select('[name=type]',type);await page.locator('[name=amount]').fill(type==='future'?'100.00':'209.32');
 await page.$eval('[name=firstDate]',(e,value)=>{e.value=value;},type==='future'?'2026-10-07':'2026-10-10');
 for(const [name,value]of Object.entries({routing:'021000021',accountNumber:'000001048',confirmAccountNumber:'000001048'}))await page.locator('[name='+name+']').fill(value);
 return{f,context,page};
}
async function review(page){await nav(page,()=>page.locator('#dental-plan button').click());await page.waitForSelector('#plan-authorization');}
async function enroll(page,f){
 await page.locator('[name=authorize]').click();await nav(page,()=>page.locator('#plan-authorization button').click());await page.waitForSelector('.plan-confirmation');
 const confirmation=await page.$eval('.plan-confirmation',e=>e.textContent);assert.equal(server.world.evaluate(f.episodeId,{confirmation}).success,true);
 return confirmation;
}
function pass(name){results.push({name,passed:true});console.log('PASS '+name);}
let success=false;
try{
 for(const type of ['recurring','future']){
  const {f,context,page}=await make(type);assert.equal(await page.$eval('#recurring-fields',e=>e.hidden),type==='future');
  await review(page);await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('#plan-authorization');
  await page.locator('#plan-authorization button').click();assert.equal((server.world.state(f.episodeId).dentalPlans||[]).length,0);
  assert.equal(await page.$eval('[name=authorize]',e=>e.validity.valueMissing),true);
  const confirmation=await enroll(page,f);await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('.plan-confirmation');assert.equal(await page.$eval('.plan-confirmation',e=>e.textContent),confirmation);
  assert.equal(server.world.state(f.episodeId).payments.filter(p=>!p.initial).length,0);
  await page.screenshot({path:new URL(type+'.png',dir).pathname,fullPage:true});pass(type+' browser enrollment, consent, review reload and authoritative task grade');await context.close();
 }
 let {f,context,page}=await make();await review(page);await enroll(page,f);
 const s=server.world.state(f.episodeId);server.world.advance(f.episodeId,Date.parse('2026-10-10T12:00:00Z')-s.now);await login(page,f);await go(page,'/personapay/plans');await page.waitForSelector('[data-cancel]');
 assert.equal(server.world.state(f.episodeId).payments.filter(p=>!p.initial).length,1);await page.locator('[data-cancel]').click();await page.locator('article form button').click();assert.equal(server.world.state(f.episodeId).dentalPlans[0].status,'active');
 await page.locator('[name=consent]').click();await nav(page,()=>page.locator('article form button').click());await page.waitForFunction(()=>document.querySelector('article strong')?.textContent==='cancelled');
 server.world.advance(f.episodeId,40*86400000);assert.equal(server.world.state(f.episodeId).payments.filter(p=>!p.initial).length,1);assert.equal(server.world.state(f.episodeId).invoices.length,4);pass('cancel confirmation stops future installments and preserves the first posted payment');await context.close();
 ({f,context,page}=await make());await page.locator('[name=cycles]').fill('3');await page.locator('#dental-plan button').click();await page.waitForFunction(()=>document.querySelector('.bw-dental-error')?.textContent.includes('at least'));assert.equal((server.world.state(f.episodeId).dentalPlans||[]).length,0);
 await page.locator('[name=cycles]').fill('2');await page.$eval('[name=firstDate]',e=>{e.value='2026-10-20';});await page.locator('#dental-plan button').click();await page.waitForFunction(()=>document.querySelector('.bw-dental-error')?.textContent.includes('within 7 days'));assert.equal(Object.keys(server.world.state(f.episodeId).quotes).length,0);pass('invalid installment amount and first-date limits produce recoverable browser errors');await context.close();
 ({f,context,page}=await make());await review(page);server.world.advance(f.episodeId,11*60000);await page.locator('[name=authorize]').click();await page.locator('#plan-authorization button').click();await page.waitForFunction(()=>document.querySelector('.bw-dental-error')?.textContent.includes('expired'));assert.equal((server.world.state(f.episodeId).dentalPlans||[]).length,0);pass('expired enrollment cannot create a plan');await context.close();
 assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);success=true;
}finally{
 writeFileSync(new URL('report.json',dir),JSON.stringify({kind:'synthetic_plan_browser_construction',runtime_activated:true,all_passed:success&&results.length===5,scenarios:results,page_errors:errors,outbound_requests:outbound},null,2)+'\n');await browser.close();await server.close();
}
