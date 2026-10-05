import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import puppeteer from 'puppeteer';

const prefix='biller_182c5bcdeb2841397831-',kinds=['website','links-pay_bill','services','contact','registration','recovery','terms','privacy'];
const files=new Map(),report={kind:'inert_source_reconstruction_preview',runtime_activated:false,scenarios:[],outbound_requests:[],page_errors:[]};
for(const kind of kinds){
 const capture=prefix+kind,dir=new URL('../public/reference-pages/'+capture+'/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('manifest.json',dir)));
 for(const [name,meta]of Object.entries(manifest.files)){
  const body=readFileSync(new URL(name,dir));assert.equal(createHash('sha256').update(body).digest('hex'),meta.sha256);files.set('/reference-pages/'+capture+'/'+name,{body,type:meta.contentType});
 }
}
const server=http.createServer((req,res)=>{const file=files.get(new URL(req.url,'http://localhost').pathname);if(!file){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':file.type});res.end(file.body);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,artifact=new URL('../artifacts/lockwood-public-preview/',import.meta.url);mkdirSync(artifact,{recursive:true});
let browser;
const path=kind=>'/reference-pages/'+prefix+kind+'/index.html';
try{
 browser=await puppeteer.launch({headless:true});const page=await browser.newPage();await page.setViewport({width:1365,height:900});
 await page.setRequestInterception(true);page.on('request',r=>{if(r.url().startsWith(origin+'/')||r.url().startsWith('data:'))r.continue();else{report.outbound_requests.push(r.url());r.abort();}});page.on('pageerror',e=>report.page_errors.push(e.message));
 await page.goto(origin+path('website'),{waitUntil:'networkidle0'});
 const pay=await page.$('a[href="'+path('links-pay_bill')+'"]');assert.ok(pay);await Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}),pay.click()]);
 assert.equal(new URL(page.url()).pathname,path('links-pay_bill'));await page.waitForSelector('#Username');
 assert.equal(await page.$eval('#Username',e=>e.disabled),true);assert.equal(await page.$eval('#Password',e=>e.disabled),true);assert.equal(await page.$eval('#btn-login',e=>e.disabled),true);
 assert.ok(await page.$eval('img[alt="City of Lockwood"]',e=>e.naturalWidth>0&&e.getBoundingClientRect().width>50));
 await page.screenshot({path:new URL('login.png',artifact).pathname,fullPage:true});report.scenarios.push('Official Missouri homepage payment link reaches captured local username/password login; source forms inert');
 const register=await page.$('a[href="'+path('registration')+'"]');await Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}),register.click()]);
 assert.equal(await page.$eval('#accountNo',e=>e.disabled),true);assert.equal(await page.$eval('#phone-number-text',e=>e.disabled),true);assert.match(await page.$eval('body',e=>e.innerText),/Verify Account/);assert.match(await page.$eval('body',e=>e.innerText),/Register User Info/);await page.screenshot({path:new URL('registration.png',artifact).pathname,fullPage:true});report.scenarios.push('Registration first-stage account and phone lookup fields and four-stage labels render locally');
 await page.goto(origin+path('recovery'),{waitUntil:'networkidle0'});assert.match(await page.$eval('body',e=>e.innerText),/Forgot Password/);assert.equal(await page.$eval('#Username',e=>e.disabled),true);report.scenarios.push('Username recovery entry renders with disabled production submission');
 for(const kind of kinds){await page.goto(origin+path(kind),{waitUntil:'networkidle0'});assert.ok((await page.$eval('body',e=>e.innerText)).length>100);assert.equal(await page.evaluate(()=>document.scripts.length),0);assert.equal(await page.evaluate(()=>document.forms.length),0);}
 await page.goto(origin+path('services'),{waitUntil:'networkidle0'});assert.match(await page.$eval('body',e=>e.innerText),/10% penalty/);assert.match(await page.$eval('body',e=>e.innerText),/15th/);await page.screenshot({path:new URL('services.png',artifact).pathname,fullPage:true});report.scenarios.push('All eight pages render locally; services preserve billing deadlines and legal/help pages contain no original scripts');
 assert.deepEqual(report.outbound_requests,[]);assert.deepEqual(report.page_errors,[]);report.all_passed=true;
}catch(e){report.all_passed=false;report.error=e.message;throw e;}
finally{writeFileSync(new URL('report.json',artifact),JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();await new Promise(r=>server.close(r));}
console.log(JSON.stringify(report,null,2));
