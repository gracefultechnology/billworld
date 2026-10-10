import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {start} from '../server.mjs';

const manifest=JSON.parse(readFileSync(new URL('../research/onswc-public.json',import.meta.url)));
const output=new URL('../artifacts/onswc-documents/browser/',import.meta.url);mkdirSync(output,{recursive:true});
const server=await start({port:0,adminPort:0,dbPath:':memory:',construction:true});
let browser;
const report={links:[],clicks:[],page_errors:[],outbound_requests:[],all_passed:false};
try{
 browser=await puppeteer.launch({headless:true,timeout:120000});
 const page=await browser.newPage();page.setDefaultTimeout(60000);
 await page.setViewport({width:1365,height:900});
 await page.setRequestInterception(true);
 page.on('request',request=>{
  const url=new URL(request.url());
  if(url.origin===server.baseUrl||['data:','about:'].includes(url.protocol)||(url.protocol==='chrome-extension:'&&url.hostname==='mhjfbmdgcfjbbpaeojofohoefgiehjai'))request.continue();
  else{report.outbound_requests.push(request.url());request.abort();}
 });
 page.on('pageerror',error=>report.page_errors.push(error.message));
 const fixture=server.world.create({siteId:'onswc'});
 await page.goto(`${server.baseUrl}/enter/${fixture.episodeId}/${fixture.entryToken}`);
 for(const route of ['/','/billing','/faqs','/rates']){
  await page.goto(server.baseUrl+route,{waitUntil:'networkidle0'});
  for(const document of manifest.documents){
   const link=await page.$(`a[href$="/${document.sha256}"]`);assert.ok(link,`${route} must link ${document.label}`);
   assert.equal(await link.evaluate(a=>a.getAttribute('aria-disabled')),null);
   assert.ok(await link.evaluate(a=>a.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})));
   const href=await link.evaluate(a=>a.getAttribute('href'));
   const response=await page.evaluate(async href=>{const r=await fetch(href);return{status:r.status,type:r.headers.get('content-type'),bytes:Array.from(new Uint8Array(await r.arrayBuffer()))}},href);
   assert.equal(response.status,200);assert.equal(response.type,'application/pdf');
   const bytes=Buffer.from(response.bytes);assert.equal(bytes.length,document.bytes);
   assert.equal(createHash('sha256').update(bytes).digest('hex'),document.sha256);
   report.links.push({route,label:document.label,href,sha256:document.sha256,bytes:bytes.length});
  }
 }
 for(const document of manifest.documents){
  // PDF viewer background requests can outlive the source navigation. Wait for
  // the actual document link instead of requiring browser-wide network quiet.
  await page.goto(server.baseUrl+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector(`a[href$="/${document.sha256}"]`,{visible:true});
  const link=await page.$(`a[href$="/${document.sha256}"]`),href=await link.evaluate(a=>a.href);
  await link.scrollIntoView();
  if(report.clicks.length===0)await page.screenshot({path:new URL('footer.png',output).pathname});
  const received=page.waitForResponse(response=>response.url()===href);
  await link.click();const response=await received;
  assert.equal(response.status(),200);assert.equal(response.headers()['content-type'],'application/pdf');
  report.clicks.push({label:document.label,url:href,status:response.status()});
 }
 assert.equal(report.links.length,8);assert.equal(report.clicks.length,2);
 assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.outbound_requests,[]);report.all_passed=true;
 console.log('Verified 8 source-policy links and 2 PDF clicks; exact document hashes, no outbound requests.');
}catch(error){report.error=error.message;throw error;}
finally{await browser?.close();await server.close();writeFileSync(new URL('report.json',output),JSON.stringify(report,null,2)+'\n');}
