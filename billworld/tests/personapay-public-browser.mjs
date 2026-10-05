// Construction preview: verifies captured public pages, not payment or private UI fidelity.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer';

const prefix='biller_3af3809e3e5a5bc0b943-';
const routes={'/':'website','/insurance-financing':'help_center_url','/financing-options':'financing-options','/terms':'terms','/privacy':'privacy','/contact':'contact','/personapay/login':'portal','/personapay/account-help':'account-help'};
const files=new Map();
for(const kind of Object.values(routes)){
  const capture=prefix+kind,base=new URL('../public/reference-pages/'+capture+'/',import.meta.url);
  const m=JSON.parse(readFileSync(new URL('manifest.json',base)));
  assert.equal(m.construction_stage,'inert_public_reconstruction_not_activated_runtime');
  for(const [name,meta]of Object.entries(m.files)){
    const body=readFileSync(new URL(name,base));assert.equal(createHash('sha256').update(body).digest('hex'),meta.sha256);
    files.set('/reference-pages/'+capture+'/'+name,{body,type:meta.contentType});
  }
}
const server=http.createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  const file=files.get(routes[path]?'/reference-pages/'+prefix+routes[path]+'/index.html':path);
  if(!file){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':file.type,'Cache-Control':'no-store'});res.end(file.body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const artifact=new URL('../artifacts/personapay-public-preview/',import.meta.url);mkdirSync(artifact,{recursive:true});
const report={kind:'inert_source_reconstruction_preview',runtime_activated:false,scenarios:[],outbound_requests:[],page_errors:[]};
let browser;
try{
  browser=await puppeteer.launch({headless:true});const page=await browser.newPage();await page.setViewport({width:1365,height:900});
  await page.setRequestInterception(true);
  page.on('request',req=>{if(req.url().startsWith(origin+'/')||req.url().startsWith('data:'))req.continue();else{report.outbound_requests.push(req.url());req.abort();}});
  page.on('pageerror',e=>report.page_errors.push(e.message));
  await page.goto(origin+'/personapay/login',{waitUntil:'networkidle0'});
  const portal=await page.evaluate(()=>({
    fields:[...document.querySelectorAll('input')].filter(i=>i.checkVisibility()).map(i=>({id:i.id,label:i.labels?.[0]?.textContent.trim(),disabled:i.disabled})),
    logo:[...document.images].filter(i=>i.checkVisibility()).map(i=>({width:i.naturalWidth,box:i.getBoundingClientRect().width})),
    scripts:document.scripts.length,continue:document.querySelector('#rs-loading-button')?.disabled,
    text:document.body.innerText,
  }));
  assert.deepEqual(portal.fields.map(f=>f.label),['Account Number','Zip Code','Date of Birth (MM/DD/YYYY)']);
  assert.ok(portal.fields.every(f=>f.disabled));assert.equal(portal.continue,true);assert.equal(portal.scripts,0);
  assert.ok(portal.logo.some(i=>i.width>0&&i.box>250));assert.match(portal.text,/123-012345/);assert.match(portal.text,/866\) 620-8390/);
  await page.screenshot({path:new URL('portal.png',artifact).pathname,fullPage:true});report.scenarios.push('Three source identifiers, original logo and account instructions render; production forms/scripts inert');
  await page.goto(origin+'/personapay/account-help',{waitUntil:'networkidle0'});
  const help=await page.evaluate(()=>{const dialog=document.querySelector('[role="dialog"]');const img=dialog?.querySelector('img');return {visible:dialog?.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}),imageVisible:img?.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}),loaded:img?.naturalWidth>0,width:img?.getBoundingClientRect().width,top:img?.getBoundingClientRect().top};});
  assert.equal(help.visible,true);assert.equal(help.loaded,true);assert.ok(help.width>900);
  assert.equal(help.imageVisible,true);assert.ok(help.top>=0&&help.top<900);
  await page.screenshot({path:new URL('account-help.png',artifact).pathname,fullPage:true});report.scenarios.push('Original account-number and ZIP statement help image renders in captured dialog');
  await page.goto(origin+'/',{waitUntil:'networkidle0'});
  const pay=await page.$('a[href="/personapay/login"]');assert.ok(pay);
  await Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}),pay.click()]);assert.equal(new URL(page.url()).pathname,'/personapay/login');
  report.scenarios.push('Source homepage payment link navigates to local PersonaPay login');
  for(const route of ['/insurance-financing','/financing-options','/terms','/privacy','/contact']){
    await page.goto(origin+route,{waitUntil:'networkidle0'});
    assert.ok((await page.evaluate(()=>document.body.innerText)).length>100);assert.equal(await page.evaluate(()=>document.scripts.length),0);
  }
  report.scenarios.push('Financing, terms, privacy and contact documents load locally without original scripts');
  assert.deepEqual(report.outbound_requests,[]);assert.deepEqual(report.page_errors,[]);report.all_passed=true;
}catch(error){report.all_passed=false;report.error=error.message;throw error;}
finally{
  writeFileSync(new URL('report.json',artifact),JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify(report,null,2));
