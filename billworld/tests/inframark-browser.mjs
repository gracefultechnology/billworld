// Inframark first-slice Puppeteer checks: public pages, every released task through the UI with
// private grading, accessible names on interactive controls, and the AutoPay/schedule safeguards.
import puppeteer from 'puppeteer';import assert from 'node:assert/strict';import {mkdirSync,writeFileSync} from 'node:fs';import {start} from '../server.mjs';
import {INFRAMARK_TASKS,runInframarkFlow} from '../infinity/reference-inframark.mjs';
const dir=new URL('../artifacts/inframark-browser/',import.meta.url);mkdirSync(dir,{recursive:true});
const r=await start({port:0,adminPort:0,googlePort:0,dbPath:':memory:'});let browser;const report={pages:[],tasks:{},unnamed_controls:[],page_errors:[],outbound_requests:[]};
const only=process.argv[2]?.split(',');
async function open(taskId){
 const context=await browser.createBrowserContext(),page=await context.newPage();page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(30000);await page.setViewport({width:1365,height:900});
 await page.setRequestInterception(true);page.on('request',q=>{const u=q.url();if(u.startsWith(r.baseUrl)||u.startsWith('data:')||u.startsWith('blob:'))return q.continue();report.outbound_requests.push(u);q.abort();});
 page.on('pageerror',e=>report.page_errors.push(taskId+': '+e.message));
 const f=r.world.create({siteId:'inframark',taskId});await page.goto(`${r.baseUrl}/enter/${f.episodeId}/${f.entryToken}`,{waitUntil:'load'});return{context,page,id:f.episodeId};
}
// Every visible form control and button in the local continuation must expose an accessible name.
const unnamed=page=>page.evaluate(()=>[...document.querySelectorAll('main.starnik-local input:not([type=hidden]),main.starnik-local select,main.starnik-local button,main.starnik-local a,#starnik-confirm button,form[id^=starnik] input:not([type=hidden]),form[id^=starnik] button')].filter(e=>e.checkVisibility()).filter(e=>!(e.getAttribute('aria-label')||e.labels?.[0]?.textContent.trim()||e.closest('label')?.textContent.trim()||e.textContent.trim()||e.title||e.getAttribute('aria-labelledby')||(['submit','button'].includes(e.type)&&e.tagName==='INPUT'&&e.value.trim()))).map(e=>e.outerHTML.slice(0,120)));
try{
 browser=await puppeteer.launch({headless:'shell',timeout:120000});
 if(!only){const{context,page}=await open('inframark-username-login-v1');
  for(const[name,path,selector]of [['home','/','a[href="/RP_Default.aspx"]'],['billing','/billing','a[href="/starnikERP/#/rp_guestpay/rp_guestpay"]'],['signup','/RP/signup','#starnik-signup'],['password','/RP/forgot-password','#starnik-recovery'],['username','/RP/forgot-username','#starnik-recovery'],['guest','/starnikERP/#/rp_guestpay','#starnik-guest-lookup'],['login','/RP_Default.aspx','#starnik-login']]){const res=await page.goto(r.baseUrl+path,{waitUntil:'load'});assert.equal(res.status(),200,path);await page.waitForSelector(selector);await page.screenshot({path:new URL(name+'.png',dir).pathname,fullPage:true});report.pages.push(name);}
  // Unauthenticated private routes show an actionable sign-in path rather than a dead end.
  await page.goto(r.baseUrl+'/starnik/scheduled',{waitUntil:'load'});await page.waitForSelector('#starnik-scheduled a[href="/RP_Default.aspx"]');
  await context.close();}
 for(const[infinityId,taskId]of Object.entries(INFRAMARK_TASKS)){
  if(only&&!only.includes(infinityId)&&!only.includes(taskId))continue;
  const{context,page,id}=await open(taskId),started=Date.now();let steps=0;const art=new URL('tasks/'+infinityId+'/',dir).pathname;mkdirSync(art,{recursive:true});
  const names=[];page.on('load',async()=>{try{await new Promise(x=>setTimeout(x,150));names.push(...await unnamed(page));}catch{}});
  try{const answer=await runInframarkFlow(taskId,{page,browser,base:r.baseUrl,artifacts:art,step:()=>steps++});names.push(...await unnamed(page));
   const result=r.world.evaluate(id,answer);await page.screenshot({path:art+'final.png',fullPage:true});
   report.tasks[infinityId]={taskId,success:result.success,steps,ms:Date.now()-started,answer,failed:Object.entries(result.checks).filter(([,v])=>!v).map(([k])=>k)};
   assert.equal(result.success,true,taskId+' '+JSON.stringify(result.checks));
   const budget=(await import('../registry.mjs')).tasks.get(taskId).budget;assert.ok(steps<=budget.actions,taskId+' exceeded action budget');
   if(names.length)report.unnamed_controls.push({taskId,names:[...new Set(names)]});
  }catch(e){await page.screenshot({path:art+'failure.png',fullPage:true}).catch(()=>{});report.tasks[infinityId]={taskId,success:false,error:e.message,steps,path:page.url()};throw e;}finally{await context.close();}
 }
 if(!only){
  // Duplicate-payment safeguard: scheduling while AutoPay is enabled requires an explicit acknowledgement; the payment executes on its date.
  const{context,page,id}=await open('inframark-autopay-cancel-v1');
  await page.goto(r.baseUrl+'/RP_Default.aspx',{waitUntil:'load'});await page.locator('[name=username]').fill('alex.inframark');await page.locator('[name=password]').fill('Inframark-2026!');await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.click('#ctl04_ctl00_btnLogin')]);
  await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.click('a[href="/starnik/scheduled"]')]);await page.waitForSelector('#starnik-schedule-autopay');
  await page.locator('[name=amount]').fill('30.00');await page.locator('[name=date]').fill('2026-10-12');await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.click('#starnik-schedule-form button:not([type=button])')]);
  await page.waitForSelector('#starnik-schedule-autopay-warning');await page.click('[name=authorize]');await page.click('#starnik-schedule-confirm button');await page.waitForFunction(()=>document.querySelector('#starnik-error')?.textContent.length>0||document.querySelector('[name=acknowledgeAutoPay]:invalid'));
  await page.click('[name=acknowledgeAutoPay]');await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.click('#starnik-schedule-confirm button')]);await page.waitForFunction(()=>document.querySelector('#starnik-schedule-table')?.textContent.includes('2026-10-12'));
  await page.screenshot({path:new URL('schedule-autopay-warning.png',dir).pathname,fullPage:true});
  r.world.advance(id,9*86400000);// The portal session expires across the clock advance; sign in again.
  await page.goto(r.baseUrl+'/RP_Default.aspx',{waitUntil:'load'});await page.locator('[name=username]').fill('alex.inframark');await page.locator('[name=password]').fill('Inframark-2026!');await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.click('#ctl04_ctl00_btnLogin')]);await page.goto(r.baseUrl+'/starnik/scheduled',{waitUntil:'load'});await page.waitForFunction(()=>[...document.querySelectorAll('#starnik-schedule-table tr')].some(t=>t.textContent.includes('2026-10-12')&&t.textContent.includes('Paid')));
  await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.click('a[href="/starnik/account"]')]);await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.click('a[href="/transaction-history"]')]);await page.waitForFunction(()=>document.querySelector('#starnik-history')?.textContent.includes('$30.00'));
  // Narrow viewport: local continuation pages do not scroll horizontally.
  await page.setViewport({width:375,height:812});for(const path of ['/starnik/account','/starnik/scheduled','/my-account/autopay']){await page.goto(r.baseUrl+path,{waitUntil:'load'});await page.waitForSelector('main.starnik-local section *');const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert.ok(overflow<=1,path+' overflows by '+overflow+'px');}
  await page.screenshot({path:new URL('mobile-autopay.png',dir).pathname,fullPage:true});report.safeguards={schedule_autopay_ack:true,schedule_executes:true,mobile_no_overflow:true};await context.close();
 }
 assert.deepEqual(report.unnamed_controls,[]);assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.outbound_requests,[]);report.all_passed=true;
 console.log('PASS inframark browser: '+Object.keys(report.tasks).length+' tasks');
}catch(e){report.all_passed=false;report.error=e.message;throw e;}finally{await browser?.close();await r.close();writeFileSync(new URL('report.json',dir),JSON.stringify(report,null,2)+'\n');}
