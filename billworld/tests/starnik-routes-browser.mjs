import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {start} from '../server.mjs';
import {constructionSites} from '../registry.mjs';
const dir=new URL('../artifacts/starnik-routes-browser/',import.meta.url);mkdirSync(dir,{recursive:true});
const site=constructionSites.get('greater-minnesota-gas'),original=site.runtime.snapshot_routes;
const r=await start({port:0,adminPort:0,dbPath:':memory:',construction:true});
let browser;const report={scenarios:[],page_errors:[],outbound_requests:[],scope:'Configured source routing and observed guest alias; no additional tenant coverage'};
try{
 browser=await puppeteer.launch({headless:'shell',timeout:120000});const page=await browser.newPage();page.setDefaultTimeout(60000);await page.setViewport({width:1365,height:900});
 const cdp=await page.createCDPSession();await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urlPatterns:[{urlPattern:r.baseUrl+'/*',block:false},{urlPattern:'*://*:*/*',block:true}]});
 page.on('pageerror',e=>report.page_errors.push(e.message));page.on('request',q=>{if(!q.url().startsWith(r.baseUrl)&&!q.url().startsWith('data:'))report.outbound_requests.push(q.url());});
 const go=p=>page.goto(r.baseUrl+p,{waitUntil:'domcontentloaded'});
 {
  site.runtime.snapshot_routes={...original,'/tenant-billing-help':original['/faq']};
  const f=r.world.create({siteId:site.id,taskId:'gmg-saved-bank-payment-v1'});
  await go(`/enter/${f.episodeId}/${f.entryToken}`);await go('/RP_Default.aspx');await page.waitForSelector('#starnik-login');
  for(const[n,v]of [['username','alex.morgan'],['password','Billworld-2026!']])await page.locator('[name="'+n+'"]').fill(v,{typingThreshold:0});
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('#ctl04_ctl00_btnLogin')]);await page.waitForSelector('#starnik-logout');
  assert.equal(await page.$eval('#starnik-username',e=>e.textContent),'alex.morgan');
  const source=await go('/faq');assert.equal(source.status(),200);const expected=await page.$eval('body',e=>e.textContent);
  const alias=await go('/tenant-billing-help');assert.equal(alias.status(),200);assert.equal(await page.$eval('body',e=>e.textContent),expected);
  report.scenarios.push('Configured additional help route serves its selected source snapshot');
  const missing=await go('/unconfigured-starnik-route');assert.equal(missing.status(),404);
  await go('/starnikERP/#/rp_guestpay');await page.waitForSelector('#starnik-guest-lookup');assert.equal(new URL(page.url()).hash,'#/rp_guestpay/rp_guestpay');
  await page.screenshot({path:new URL('guest-alias.png',dir).pathname});
  report.scenarios.push('Published short guest alias normalizes and activates captured lookup');
 }
 assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.outbound_requests,[]);report.all_passed=true;
}catch(e){report.all_passed=false;report.error=e.message;throw e;}finally{site.runtime.snapshot_routes=original;await browser?.close();await r.close();writeFileSync(new URL('report.json',dir),JSON.stringify(report,null,2)+'\n');}
