import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {start} from '../server.mjs';
import {PROCESS_BUILD} from '../build-fingerprint.mjs';

const dir=new URL('../artifacts/starnik-statements-browser/',import.meta.url),downloads=new URL('downloads/',dir);mkdirSync(downloads,{recursive:true});
const manifest=JSON.parse(readFileSync(new URL('../research/starnik-statements.json',import.meta.url)));
const r=await start({port:0,adminPort:0,dbPath:':memory:',construction:true});let browser,page,browserCDP;
const report={kind:'scripted_reference',synthetic:true,environmentBuildId:PROCESS_BUILD.environmentBuildId,evaluatorBuildId:PROCESS_BUILD.evaluatorBuildId,scenarios:[],downloads:[],page_errors:[],outbound_requests:[]};
const go=path=>page.goto(r.baseUrl+path,{waitUntil:'domcontentloaded'});
const nav=click=>Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),click()]);
const fill=(name,value)=>page.locator(`[name="${name}"]`).fill(value,{typingThreshold:0});
async function download(selector,invoiceId){
 const expected=manifest.documents.find(d=>d.invoiceId===invoiceId);
 let begin,resolve,reject;
 const completed=new Promise((yes,no)=>{resolve=yes;reject=no;});
 const timer=setTimeout(()=>reject(Error('PDF download did not complete')),60000);
 const onBegin=event=>{begin=event;};
 const onProgress=event=>{if(begin?.guid===event.guid){if(event.state==='completed')resolve(event);if(event.state==='canceled')reject(Error('PDF download canceled'));}};
 browserCDP.on('Browser.downloadWillBegin',onBegin);browserCDP.on('Browser.downloadProgress',onProgress);
 try{
  await page.locator(selector).click();await completed;
  assert.equal(begin.suggestedFilename,expected.file);assert.match(begin.guid,/^[a-f0-9-]+$/);
  const bytes=readFileSync(new URL(begin.guid,downloads)),sha256=createHash('sha256').update(bytes).digest('hex');assert.equal(sha256,expected.sha256);
  report.downloads.push({invoiceId,filename:begin.suggestedFilename,sha256,bytes:bytes.length});
 }finally{clearTimeout(timer);browserCDP.off('Browser.downloadWillBegin',onBegin);browserCDP.off('Browser.downloadProgress',onProgress);}
}
try{
 browser=await puppeteer.launch({headless:'shell',timeout:120000});report.browser_version=await browser.version();report.browser_mode='headless_shell';page=await browser.newPage();await page.setViewport({width:1280,height:900});page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(60000);
 const cdp=await page.createCDPSession();await cdp.send('Network.enable');await cdp.send('Network.setBlockedURLs',{urlPatterns:[{urlPattern:r.baseUrl+'/*',block:false},{urlPattern:'*://*:*/*',block:true}]});
 browserCDP=await browser.target().createCDPSession();await browserCDP.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:downloads.pathname,eventsEnabled:true});
 page.on('request',q=>{if(!q.url().startsWith(r.baseUrl+'/')&&!q.url().startsWith('data:'))report.outbound_requests.push(q.url());});page.on('pageerror',e=>report.page_errors.push(e.message));
 const f=r.world.create({siteId:'greater-minnesota-gas',taskId:'gmg-download-current-bill-v1'});
 await go(`/enter/${f.episodeId}/${f.entryToken}`);await go('/RP_Default.aspx');await page.waitForSelector('#starnik-login');await fill('username','alex.morgan');await fill('password','Billworld-2026!');await nav(()=>page.locator('#ctl04_ctl00_btnLogin').click());await page.waitForSelector('#starnik-logout');await download('[data-statement="inv-current"]','inv-current');assert.equal(r.world.evaluate(f.episodeId,{statementFilename:'gmg-inv-current.pdf'}).success,true);report.scenarios.push('Current PDF downloaded with verified filename, saved bytes and private grading');
 await download('[data-statement="inv-old"]','inv-old');await page.reload();await page.waitForSelector('#starnik-logout');await download('[data-statement="inv-current"]','inv-current');assert.equal(report.downloads[0].sha256,report.downloads[2].sha256);report.scenarios.push('Paid historical statement available and current document unchanged after reload');
 assert.equal(await page.evaluate(async()=> (await fetch('/invoice/download/inv-other')).status),404);assert.equal(await page.evaluate(async()=> (await fetch('/output/pdf/gmg-inv-current.pdf')).status),404);await page.screenshot({path:new URL('account-statements.png',dir).pathname,fullPage:true});await nav(()=>page.locator('#starnik-logout').click());assert.equal(await page.evaluate(async()=> (await fetch('/invoice/download/inv-current')).status),401);await page.waitForSelector('#starnik-login');await fill('username','jordan.lee');await fill('password','Other-2026!');await nav(()=>page.locator('#ctl04_ctl00_btnLogin').click());await page.waitForSelector('#starnik-logout');await download('[data-statement="inv-other"]','inv-other');assert.equal(await page.evaluate(async()=> (await fetch('/invoice/download/inv-current')).status),404);report.scenarios.push('Logout and profile boundaries enforced; secondary profile downloads only its own PDF');
 assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.outbound_requests,[]);report.all_passed=true;console.log(JSON.stringify(report,null,2));
}catch(error){report.all_passed=false;report.error=error.message;if(page&&!page.isClosed())await page.screenshot({path:new URL('failure.png',dir).pathname,fullPage:true}).catch(e=>{report.screenshot_error=e.message;});throw error;}
finally{writeFileSync(new URL('report.json',dir),JSON.stringify(report,null,2)+'\n');await browser?.close();await r.close();}
