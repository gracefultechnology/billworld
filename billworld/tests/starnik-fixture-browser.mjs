import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {start} from '../server.mjs';
import {sites} from '../registry.mjs';
const dir=new URL('../artifacts/starnik-fixture-browser/',import.meta.url);mkdirSync(dir,{recursive:true});
const site=sites.get('greater-minnesota-gas'),original=site.construction_account_credentials;
const r=await start({port:0,adminPort:0,dbPath:':memory:',construction:true});
let browser;const report={scenarios:[],page_errors:[],outbound_requests:[],scope:'Synthetic credential variation on GMG fixture; no additional tenant coverage'};
try{
 browser=await puppeteer.launch({headless:'shell',timeout:120000});const page=await browser.newPage();page.setDefaultTimeout(60000);await page.setViewport({width:1365,height:900});
 const cdp=await page.createCDPSession();await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urlPatterns:[{urlPattern:r.baseUrl+'/*',block:false},{urlPattern:'*://*:*/*',block:true}]});
 page.on('pageerror',e=>report.page_errors.push(e.message));page.on('request',q=>{if(!q.url().startsWith(r.baseUrl)&&!q.url().startsWith('data:'))report.outbound_requests.push(q.url());});
 const go=p=>page.goto(r.baseUrl+p,{waitUntil:'domcontentloaded'});
 {
  site.construction_account_credentials={'acct-primary':{username:'water.alex',password:'Water-2026!',security_code:'WATER1048',service_zip:'10001'},'acct-secondary':{username:'water.jordan',password:'Second-2026!',security_code:'WATER2099',service_zip:'10002'},'acct-cabin':{username:'water.cabin',password:'Cabin-2026!',security_code:'WATER3077',service_zip:'10003'}};
  const f=r.world.create({siteId:site.id,taskId:'gmg-saved-bank-payment-v1'});
  await go(`/enter/${f.episodeId}/${f.entryToken}`);await go('/RP_Default.aspx');await page.waitForSelector('#starnik-login');
  for(const[n,v]of [['username','water.alex'],['password','Water-2026!']])await page.locator('[name="'+n+'"]').fill(v,{typingThreshold:0});
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('#ctl04_ctl00_btnLogin')]);await page.waitForSelector('#starnik-logout');
  assert.equal(await page.$eval('#starnik-username',e=>e.textContent),'water.alex');
  report.scenarios.push('Configured username and password sign in through captured form');
  await go('/starnikERP/#/rp_guestpay/rp_guestpay');await page.waitForSelector('#starnik-guest-lookup');
  for(const[n,v]of [['securityCode','WATER1048'],['serviceZip','10001']])await page.locator('[name="'+n+'"]').fill(v,{typingThreshold:0});
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.click('#starnik-guest-lookup button')]);
  await page.waitForFunction(()=>location.pathname==='/starnik/guest/account'&&document.body.textContent.includes('84.32'));
  await page.screenshot({path:new URL('alternate-guest.png',dir).pathname});
  report.scenarios.push('Configured security code and ZIP open guest account');
 }
 assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.outbound_requests,[]);report.all_passed=true;
}catch(e){report.all_passed=false;report.error=e.message;throw e;}finally{site.construction_account_credentials=original;await browser?.close();await r.close();writeFileSync(new URL('report.json',dir),JSON.stringify(report,null,2)+'\n');}
