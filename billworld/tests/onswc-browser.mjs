// ONSWC end-to-end Puppeteer suite: public pages, then every ONSWC task's UI
// journey in its own episode and a single tab, graded by the private grader.
import puppeteer from 'puppeteer';import assert from 'node:assert/strict';import {mkdirSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {start} from '../server.mjs';import {onswcJourney,ONSWC_TASKS} from '../infinity/onswc-reference.mjs';
const dir=new URL('../artifacts/onswc-browser/',import.meta.url);mkdirSync(dir,{recursive:true});
const only=process.argv[2]?.split(',');const r=await start({port:0,adminPort:0,dbPath:':memory:',construction:true});let browser;
const report={pages:[],tasks:[],page_errors:[],outbound_requests:[],unnamed_controls:[],dialogs:[]};
// Every visible control on local continuation screens must expose an accessible name.
const audit=async page=>{try{const bad=await page.evaluate(()=>{const roots=[...document.querySelectorAll('main.starnik-local,#starnik-login,#starnik-confirm,#starnik-signup,#starnik-recovery')];const out=[];for(const root of roots)for(const e of root.querySelectorAll('input:not([type=hidden]),select,textarea,button,a[href],[role=switch]')){if(!e.checkVisibility())continue;const name=(e.getAttribute('aria-label')||[...(e.labels||[])].map(l=>l.textContent).join(' ')||(e.getAttribute('aria-labelledby')||'').split(' ').map(id=>document.getElementById(id)?.textContent||'').join(' ')||e.textContent||(['submit','button','reset'].includes(e.type)&&e.tagName==='INPUT'?e.value:'')||e.title||e.placeholder||'').trim();if(!name)out.push(e.outerHTML.slice(0,120));}return out;});for(const b of bad)report.unnamed_controls.push({url:page.url(),control:b});}catch{}};
try{
 browser=await puppeteer.launch({headless:'shell',timeout:120000});
 const fresh=async()=>{const page=await browser.newPage();page.setDefaultTimeout(30000);await page.setViewport({width:1365,height:900});const cdp=await page.createCDPSession();await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urlPatterns:[{urlPattern:r.baseUrl+'/*',block:false},{urlPattern:'*://*:*/*',block:true}]});page.on('pageerror',e=>report.page_errors.push(page.url()+': '+e.message));page.on('request',q=>{if(!q.url().startsWith(r.baseUrl)&&!q.url().startsWith('data:'))report.outbound_requests.push(q.url());});page.on('dialog',d=>{report.dialogs.push(d.message());d.dismiss();});return page;};
 if(!only){const page=await fresh(),f=r.world.create({siteId:'onswc'}),go=p=>page.goto(r.baseUrl+p,{waitUntil:'networkidle0'});await go(`/enter/${f.episodeId}/${f.entryToken}`);
  for(const[name,path,selector]of [['home','/','a[href="/RP_Default.aspx"]'],['billing','/billing','a[href="/RP_Default.aspx"]'],['faq','/faqs','.dsm-faq-title'],['rates','/rates','[role=tab]'],['signup','/RP/signup','#starnik-signup'],['password','/RP/forgot-password','form'],['username','/RP/forgot-username','form'],['login','/RP_Default.aspx','#starnik-login']]){assert.equal((await go(path)).status(),200);await page.waitForSelector(selector);await page.screenshot({path:new URL(name+'.png',dir).pathname,fullPage:true});report.pages.push(name);}
  // Signed-out continuations fail closed with a visible message instead of a blank screen.
  for(const path of ['/my-account/ach','/my-account/ach/agreement','/starnik/payment']){await go(path);await page.waitForFunction(()=>/sign in again|unavailable/i.test(document.body.textContent));}
  // Guest pay is not documented for ONSWC and stays unexposed.
  assert.equal((await page.goto(r.baseUrl+'/starnikERP/')).status(),404);await page.close();}
 for(const taskId of ONSWC_TASKS.filter(t=>!only||only.includes(t))){
  const page=await fresh(),f=r.world.create({siteId:'onswc',taskId}),downloadPath=mkdtempSync(join(tmpdir(),'onswc-download-'));let steps=0;
  try{await page.goto(`${r.baseUrl}/enter/${f.episodeId}/${f.entryToken}`,{waitUntil:'load'});
   const answer=await onswcJourney(page,r.baseUrl,taskId,{downloadPath,onStep:async p=>{steps++;await audit(p);}});await audit(page);
   await page.screenshot({path:new URL(taskId+'.png',dir).pathname,fullPage:true});
   const score=r.world.evaluate(f.episodeId,answer);report.tasks.push({taskId,success:score.success,checks:score.checks,steps,answer});assert.equal(score.success,true,taskId+' '+JSON.stringify(score.checks));
   console.log('PASS',taskId,steps,'actions');
  }finally{await page.close();rmSync(downloadPath,{recursive:true,force:true});}
 }
 // No-action episodes never pass.
 for(const taskId of ONSWC_TASKS){const f=r.world.create({siteId:'onswc',taskId});assert.equal(r.world.evaluate(f.episodeId,{}).success,false,taskId+' passes without action');}
 assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.outbound_requests,[]);assert.deepEqual(report.unnamed_controls,[]);assert.deepEqual(report.dialogs,[],'ONSWC must not use native dialogs');report.all_passed=true;
}catch(e){report.all_passed=false;report.error=e.message;throw e;}finally{await browser?.close();await r.close();writeFileSync(new URL('report.json',dir),JSON.stringify(report,null,2)+'\n');}
console.log('ONSWC browser suite passed:',report.tasks.length,'task journeys,',report.pages.length,'public pages');
