import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {start} from '../server.mjs';
import {sites} from '../registry.mjs';
const dir=new URL('../artifacts/starnik-brand-browser/',import.meta.url);mkdirSync(dir,{recursive:true});
const site=sites.get('greater-minnesota-gas'),original={name:site.name,runtime:site.runtime};
const r=await start({port:0,adminPort:0,dbPath:':memory:',construction:true});
let browser;const report={scenarios:[],page_errors:[],outbound_requests:[],scope:'Synthetic branding variation on GMG fixture; no additional tenant coverage'};
try{
 browser=await puppeteer.launch({headless:'shell',timeout:120000});const page=await browser.newPage();page.setDefaultTimeout(60000);await page.setViewport({width:1365,height:900});
 const cdp=await page.createCDPSession();await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urlPatterns:[{urlPattern:r.baseUrl+'/*',block:false},{urlPattern:'*://*:*/*',block:true}]});
 page.on('pageerror',e=>report.page_errors.push(e.message));page.on('request',q=>{if(!q.url().startsWith(r.baseUrl)&&!q.url().startsWith('data:'))report.outbound_requests.push(q.url());});
 const go=p=>page.goto(r.baseUrl+p,{waitUntil:'domcontentloaded'});
 for(const variant of [{name:'alternate',title:'Example Water & Sewer'},{name:'escaped',title:'Example <img src=x onerror=alert(1)>'}]){
  site.name=variant.title;site.runtime={...original.runtime,mail_display_name:'Example Water',payment_confirmation_prefix:'BW-EXAMPLE',autopay_confirmation_prefix:'BWEXAMPLEAP'};
  const f=r.world.create({siteId:site.id,taskId:'gmg-saved-bank-payment-v1'});
  await go(`/enter/${f.episodeId}/${f.entryToken}`);await go('/RP_Default.aspx');await page.waitForSelector('#starnik-login');
  for(const[n,v]of [['username','alex.morgan'],['password','Billworld-2026!']])await page.locator('[name="'+n+'"]').fill(v,{typingThreshold:0});
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('#ctl04_ctl00_btnLogin')]);await page.waitForSelector('#starnik-logout');
  assert.equal(await page.$eval('#starnik-account-title',e=>e.textContent),variant.title+' account');
  assert.equal(await page.$('#starnik-account-title img'),null);
  await page.screenshot({path:new URL(variant.name+'-account.png',dir).pathname});
  report.scenarios.push(variant.name+' account title renders tenant branding as text');
 }
 assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.outbound_requests,[]);report.all_passed=true;
}catch(e){report.all_passed=false;report.error=e.message;throw e;}finally{Object.assign(site,original);await browser?.close();await r.close();writeFileSync(new URL('report.json',dir),JSON.stringify(report,null,2)+'\n');}
