import puppeteer from 'puppeteer';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {start} from '../server.mjs';
const dir=new URL('../artifacts/paymentus-preferences-browser/',import.meta.url);mkdirSync(dir,{recursive:true});
let probeRequests=0;const probe=createServer((req,res)=>{probeRequests++;res.end('Network guard probe');});await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const probeUrl='http://127.0.0.1:'+probe.address().port+'/probe';
const r=await start({port:0,adminPort:0,dbPath:':memory:',construction:true});let browser,page;
const progress=stage=>{writeFileSync(new URL('progress.json',dir),JSON.stringify({stage,at:new Date().toISOString()})+'\n');};
const report={kind:'documented_paymentus_preferences_synthetic_private_form',scenarios:[],page_errors:[],outbound_requests:[]};
try{
 const f=r.world.create({siteId:'batavia-utilities',taskId:'batavia-notifications-v1'});
 progress('launch');browser=await puppeteer.launch({headless:'shell',timeout:120000});report.browser_version=await browser.version();report.browser_mode='headless_shell';page=await browser.newPage();await page.setViewport({width:1280,height:900});page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(60000);const cdp=await page.createCDPSession();await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urlPatterns:[{urlPattern:r.baseUrl+'/*',block:false},{urlPattern:'*://*:*/*',block:true}]});report.network_guard='Native CDP origin allowlist';
 page.on('request',q=>{if(q.url()!==probeUrl&&!q.url().startsWith(r.baseUrl)&&!q.url().startsWith('data:'))report.outbound_requests.push(q.url());});page.on('pageerror',e=>report.page_errors.push(e.message));
 progress('enter');await page.goto(r.baseUrl+`/enter/${f.episodeId}/${f.entryToken}`,{waitUntil:'domcontentloaded'});progress('login_page');await page.goto(r.baseUrl+'/paymentus/login',{waitUntil:'domcontentloaded'});await page.locator('[name=email]').fill('alex@billworld.test',{typingThreshold:0});await page.locator('[name=password]').fill('Billworld-2026!',{typingThreshold:0});
 progress('login_submit');await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('#paymentus-login button').click()]);await page.waitForSelector('#paymentus-account');
 const probeResult=await page.evaluate(async url=>{try{await fetch(url);return 'unexpected success';}catch{return 'blocked';}},probeUrl);assert.equal(probeResult,'blocked');assert.equal(probeRequests,0);report.network_guard_probe_passed=true;

 progress('open_preferences');await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('a[href="/paymentus/preferences?accountId=acct-primary"]').click()]);await page.waitForSelector('#paymentus-preferences');
 await page.locator('[name=paperless]').click();await page.locator('[name=emailNotification]').click();await page.locator('#paymentus-preferences button').click();await page.waitForFunction(()=>document.querySelector('#paymentus-preferences-status')?.textContent==='Settings saved');
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('#paymentus-preferences');assert.equal(await page.$eval('[name=paperless]',e=>e.checked),true);assert.equal(await page.$eval('[name=emailNotification]',e=>e.checked),true);assert.equal(await page.$eval('[name=smsNotification]',e=>e.checked),false);assert.equal(r.world.evaluate(f.episodeId,{}).success,true);
 report.scenarios.push('Accounts edit link, paperless/email save, reload, unchanged SMS and private grader success');
 await page.screenshot({path:new URL('preferences.png',dir).pathname,fullPage:true});
 assert.equal(await page.evaluate(async()=> (await fetch('/api/paymentus/preferences?accountId=acct-secondary')).status),404);
 assert.equal(await page.evaluate(async()=> (await fetch('/api/paymentus/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId:'acct-primary',paperless:false,emailNotification:false,smsNotification:false,password:'forged'})})).status),400);
 report.scenarios.push('Unlinked account and attempted profile mutation rejected by API');
 await page.locator('[name=paperless]').click();await page.locator('[name=emailNotification]').click();await page.locator('[name=smsNotification]').click();await page.locator('#paymentus-preferences button').click();await page.waitForFunction(()=>document.querySelector('#paymentus-preferences-status')?.textContent==='Settings saved');await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('#paymentus-preferences');assert.equal(await page.$eval('[name=paperless]',e=>e.checked),false);assert.equal(await page.$eval('[name=emailNotification]',e=>e.checked),false);assert.equal(await page.$eval('[name=smsNotification]',e=>e.checked),true);
 report.scenarios.push('Paper mail restoration and independent email/SMS choices persist');
 await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('a[href="/paymentus/accounts"]').click()]);await page.waitForSelector('#paymentus-account');await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('#paymentus-logout').click()]);
 assert.equal(await page.evaluate(async()=> (await fetch('/api/paymentus/preferences?accountId=acct-primary')).status),401);
 report.scenarios.push('Logout blocks preference access');assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.outbound_requests,[]);report.all_passed=true;console.log(JSON.stringify(report,null,2));
}catch(error){report.all_passed=false;report.error=error.message;if(page&&!page.isClosed())await page.screenshot({path:new URL('failure.png',dir).pathname,fullPage:true}).catch(e=>{report.screenshot_error=e.message;});throw error;}
finally{writeFileSync(new URL('report.json',dir),JSON.stringify(report,null,2)+'\n');await browser?.close();await r.close();await new Promise(resolve=>probe.close(resolve));}
