import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {start} from '../server.mjs';
import {sites} from '../registry.mjs';
const dir=new URL('../artifacts/starnik-fee-policy-browser/',import.meta.url);mkdirSync(dir,{recursive:true});
const site=sites.get('greater-minnesota-gas'),original=site.documented_policy;
const r=await start({port:0,adminPort:0,dbPath:':memory:',construction:true});
let browser;const report={scenarios:[],page_errors:[],outbound_requests:[],scope:'Synthetic policy variation on GMG fixture; no additional tenant coverage'};
try{
 browser=await puppeteer.launch({headless:'shell',timeout:120000});const page=await browser.newPage();page.setDefaultTimeout(60000);await page.setViewport({width:1365,height:900});
 const cdp=await page.createCDPSession();await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urlPatterns:[{urlPattern:r.baseUrl+'/*',block:false},{urlPattern:'*://*:*/*',block:true}]});
 page.on('pageerror',e=>report.page_errors.push(e.message));page.on('request',q=>{if(!q.url().startsWith(r.baseUrl)&&!q.url().startsWith('data:'))report.outbound_requests.push(q.url());});
 const go=p=>page.goto(r.baseUrl+p,{waitUntil:'domcontentloaded'});
 for(const variant of [{name:'gmg',policy:original,text:'Bank payments have no fee. Card payments have a 2.75% fee, minimum $1.50.'},{name:'operator-example',policy:{...original,bank_fee_cents:100,card_fee_basis_points:300,card_fee_minimum_cents:0},text:'Bank payments have a $1.00 fee. Card payments have a 3% fee.'}]){
  site.documented_policy=variant.policy;
  const f=r.world.create({siteId:site.id,taskId:'gmg-saved-bank-payment-v1'});
  await go(`/enter/${f.episodeId}/${f.entryToken}`);await go('/RP_Default.aspx');await page.waitForSelector('#starnik-login');
  for(const[n,v]of [['username','alex.morgan'],['password','Billworld-2026!']])await page.locator('[name="'+n+'"]').fill(v,{typingThreshold:0});
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('#ctl04_ctl00_btnLogin')]);await page.waitForSelector('#starnik-logout');
  await go('/starnik/payment');await page.waitForSelector('#starnik-signed-payment');assert.ok((await page.$eval('main',e=>e.textContent)).includes(variant.text));
  await page.screenshot({path:new URL(variant.name+'-checkout.png',dir).pathname});
  await go('/my-account/autopay');await page.waitForSelector('#starnik-autopay-select');
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('form button')]);await page.waitForSelector('#starnik-autopay-confirm');
  assert.ok((await page.$eval('main',e=>e.textContent)).includes(variant.text));
  await page.screenshot({path:new URL(variant.name+'-autopay.png',dir).pathname});
  report.scenarios.push(variant.name+' checkout and AutoPay display configured fees');
 }
 assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.outbound_requests,[]);report.all_passed=true;
}catch(e){report.all_passed=false;report.error=e.message;throw e;}finally{site.documented_policy=original;await browser?.close();await r.close();writeFileSync(new URL('report.json',dir),JSON.stringify(report,null,2)+'\n');}
