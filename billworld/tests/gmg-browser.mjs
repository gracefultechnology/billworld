// Greater Minnesota Gas first-slice browser suite: every released task through the visible UI in
// one tab (homepage entry, mock Gmail in the same tab, native confirmations accepted), using the
// same scripted journeys as the Infinity reference. After each journey the private grader must pass,
// every local page is audited for unnamed controls, and no request may leave the local server.
// Usage: node billworld/tests/gmg-browser.mjs [comma-separated billworld task ids]
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {start} from '../server.mjs';
import {GMG_TASKS,runGmgFlow} from '../infinity/reference-gmg.mjs';

const site='greater-minnesota-gas',dir=new URL('../artifacts/gmg-browser/',import.meta.url);mkdirSync(dir,{recursive:true});
const only=process.argv[2]?.split(',');
const released=JSON.parse(readFileSync(new URL('../sites/greater-minnesota-gas.json',import.meta.url))).released_tasks;
const r=await start({port:0,adminPort:0,dbPath:':memory:'});let browser,page;
const report={kind:'gmg_first_slice_one_tab_journeys',scenarios:[],a11y_pages:[],page_errors:[],outbound_requests:[],confirmations:{}};
try{
 assert.deepEqual(Object.values(GMG_TASKS).sort(),[...released].sort(),'Every released task needs a reference journey');
 browser=await puppeteer.launch({headless:'shell',timeout:120000});report.browser_version=await browser.version();
 const audit=async label=>{const problems=await page.evaluate(()=>{const visible=e=>e.checkVisibility({checkVisibilityCSS:true,checkOpacity:true});const name=e=>(e.getAttribute('aria-label')||[...(e.labels||[])].map(l=>l.textContent).join(' ')||(e.matches('a,button')?e.textContent:'')||(e.matches('input[type=submit],input[type=button]')?e.value:'')||e.title||e.placeholder||'').trim();return [...document.querySelectorAll('main.starnik-local,form[id^="starnik-"]')].flatMap(root=>[...root.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea')]).filter(visible).filter(e=>!name(e)).map(e=>e.outerHTML.slice(0,120));});report.a11y_pages.push({label,path:new URL(page.url()).pathname,unnamed:problems.length});assert.deepEqual(problems,[],'Unnamed controls on '+label);};
 for(const taskId of released){
  if(only&&!only.includes(taskId))continue;
  const context=await browser.createBrowserContext();page=await context.newPage();await page.setViewport({width:1365,height:900});page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(30000);
  const cdp=await page.createCDPSession();await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urlPatterns:[{urlPattern:r.baseUrl+'/*',block:false},{urlPattern:'*://*:*/*',block:true}]});
  page.on('pageerror',e=>report.page_errors.push(taskId+': '+e.message));page.on('request',q=>{if(!q.url().startsWith(r.baseUrl)&&!q.url().startsWith('data:'))report.outbound_requests.push(q.url());});
  try{
   const f=r.world.create({siteId:site,taskId});assert.equal(r.world.state(f.episodeId).constructionSlice,false);assert.equal(r.world.evaluate(f.episodeId).success,false,'Fresh episode must not pass '+taskId);
   await page.goto(`${r.baseUrl}/enter/${f.episodeId}/${f.entryToken}`,{waitUntil:'domcontentloaded'});assert.equal(new URL(page.url()).pathname,'/');
   let steps=0;const {answer,confirmations}=await runGmgFlow(taskId,{page,browser,base:r.baseUrl,artifacts:fileURLToPath(new URL(taskId+'/',dir)),step:()=>steps++,audit});
   const score=r.world.evaluate(f.episodeId,answer);assert.equal(score.success,true,taskId+': '+JSON.stringify(score.checks));
   assert.equal(browser.targets().filter(t=>t.type()==='page'&&t.browserContext()===context).length,1,'Journey must stay in one tab');
   report.confirmations[taskId]=confirmations;report.scenarios.push({taskId,steps,answer});
  }catch(e){await page.screenshot({path:new URL('failure-'+taskId+'.png',dir).pathname,fullPage:true}).catch(()=>{});throw Error(taskId+': '+e.message);}
  finally{await context.close();}
 }
 assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.outbound_requests,[]);report.all_passed=true;
 console.log(JSON.stringify({all_passed:true,journeys:report.scenarios.length,a11y_pages:report.a11y_pages.length},null,2));
}catch(e){report.all_passed=false;report.error=e.message;throw e;}
finally{writeFileSync(new URL('report.json',dir),JSON.stringify(report,null,2)+'\n');await browser?.close();await r.close();}
