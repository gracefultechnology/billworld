import puppeteer from 'puppeteer';
import {start} from '../server.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir=new URL('../artifacts/wvu-public/',import.meta.url).pathname;mkdirSync(dir,{recursive:true});
const server=await start({port:0,adminPort:0,dbPath:':memory:'}),browser=await puppeteer.launch({headless:true}),context=await browser.createBrowserContext(),page=await context.newPage(),errors=[],outbound=[],browserInternal=[],results=[];
page.setDefaultTimeout(20000);await page.setViewport({width:1365,height:900});page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());if(u.protocol==='chrome-extension:'&&u.hostname==='mhjfbmdgcfjbbpaeojofohoefgiehjai'){browserInternal.push(r.url());r.continue();}else if(['data:','about:'].includes(u.protocol)||u.origin===server.baseUrl)r.continue();else{outbound.push(r.url());r.abort();}});
async function localLink(href){for(const a of await page.$$(`a[href="${href}"]`)){if(await a.evaluate(e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&e.getClientRects().length>0)){await Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}),a.click()]);return;}}throw Error('No visible link '+href);}
function pass(name){results.push({name,passed:true});console.log('PASS '+name);}
try{
 const fixture=server.world.create({siteId:'wvu-medicine'});await page.goto(`${server.baseUrl}/enter/${fixture.episodeId}/${fixture.entryToken}`,{waitUntil:'networkidle0'});
 const header=await page.evaluate(()=>{const logo=document.querySelector('#main-header #logo').getBoundingClientRect(),menu=document.querySelector('#top-menu').getBoundingClientRect(),img=document.querySelector('.wp-image-8770');return{logoBottom:logo.bottom,menuTop:menu.top,imageWidth:img.naturalWidth,bodyWidth:document.body.scrollWidth,viewport:innerWidth}});
 assert.ok(header.logoBottom<=header.menuTop,'Source logo must remain above desktop navigation');assert.ok(header.imageWidth>0,'Captured Peak Health image must load');assert.ok(header.bodyWidth<=header.viewport+1);await page.screenshot({path:dir+'home.png',fullPage:true});pass('source stylesheet order, desktop header and captured homepage images');
 await page.locator('#top-menu > .menu-item-48').hover();await localLink('/billing');assert.ok(await page.$eval('body',e=>e.innerText.includes('Pay a Bill')));pass('desktop Billing & Insurance dropdown reaches payment guide');
 await localLink('/billing/faq');const headers=await page.$$('.wvum-adv-accordion-header-title');assert.ok(headers.length>=2);assert.equal(await headers[0].evaluate(e=>e.getAttribute('aria-expanded')),'false');await headers[0].click();await page.waitForFunction(()=>document.querySelector('.wvum-adv-accordion-item').dataset.open==='true');await page.waitForFunction(()=>document.querySelector('.wvum-adv-accordion-content').getBoundingClientRect().height>0);assert.ok(await headers[0].evaluate(e=>e.nextElementSibling.innerText.includes('facility services')));await headers[1].focus();await page.keyboard.press('Enter');assert.equal(await headers[1].evaluate(e=>e.getAttribute('aria-expanded')),'true');assert.equal(await headers[0].evaluate(e=>e.getAttribute('aria-expanded')),'false');await page.keyboard.press(' ');assert.equal(await headers[1].evaluate(e=>e.getAttribute('aria-expanded')),'false');await page.screenshot({path:dir+'faq.png',fullPage:true});pass('billing FAQ expands by mouse and keyboard, permits one open answer and closes');
 await page.goto(server.baseUrl+'/billing',{waitUntil:'networkidle0'});await localLink('/billing/understanding');assert.ok(await page.$eval('body',e=>e.innerText.includes('Understanding')));await page.goto(server.baseUrl+'/billing',{waitUntil:'networkidle0'});await localLink('/billing/assistance');assert.ok(await page.$eval('body',e=>e.innerText.includes('Financial Assistance')));pass('billing guide reaches understanding-billing and financial-assistance source pages');
 for(const document of JSON.parse(readFileSync(new URL('../research/wvu-documents.json',import.meta.url))).documents){
  const route='/reference-assets/'+document.file;
  await page.goto(server.baseUrl+(document.file.includes('sample')?'/billing/understanding':'/billing'),{waitUntil:'networkidle0'});
  const link=await page.$(`a[href="${route}"]`);assert.ok(link,'Captured source link must reach '+route);
  assert.ok(await link.evaluate(e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})));
  // Read the linked bytes in the browser before Chromium substitutes its PDF viewer HTML.
  const fetched=await page.evaluate(async href=>{const r=await fetch(href);return{status:r.status,type:r.headers.get('content-type'),bytes:Array.from(new Uint8Array(await r.arrayBuffer()))}},route);
  assert.equal(fetched.status,200);assert.equal(fetched.type,'application/pdf');
  const bytes=Buffer.from(fetched.bytes);assert.equal(bytes.length,document.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),document.sha256);
  // Verify that clicking the visible link requests that same PDF.
  const responsePromise=page.waitForResponse(r=>r.url()===server.baseUrl+route);
  await link.click();const response=await responsePromise;
  assert.equal(response.status(),200);assert.equal(response.headers()['content-type'],'application/pdf');
 }
 pass('three visible billing document links deliver exact official PDF bytes');
 await page.setViewport({width:390,height:844});await page.goto(server.baseUrl+'/',{waitUntil:'networkidle0'});await page.locator('#main-header .mobile_menu_bar').click();await page.waitForFunction(()=>document.querySelector('#main-header .mobile_menu_bar').getAttribute('aria-expanded')==='true');await page.locator('#mobile_menu > .menu-item-48 > a:first-child').click();await page.waitForFunction(()=>document.querySelector('#mobile_menu > .menu-item-48').classList.contains('submenu-open'));await page.screenshot({path:dir+'mobile-menu.png',fullPage:true});await localLink('/billing');assert.ok(await page.$eval('body',e=>e.innerText.includes('Pay a Bill')));await localLink('/MyChart/billing/guestpay');await page.waitForSelector('#lookup');assert.ok(await page.$eval('body',e=>e.innerText.includes('Guarantor last name')));pass('mobile menu billing submenu reaches payment guide and guest lookup');
 assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);
}catch(e){await page.screenshot({path:dir+'failure.png',fullPage:true});writeFileSync(dir+'failure.txt',page.url()+'\n'+await page.$eval('body',e=>e.innerText));throw e;}finally{writeFileSync(dir+'results.json',JSON.stringify({scenarios:results.length,all_passed:results.length===6,results,page_errors:errors,outbound_requests:outbound,browser_internal_requests:browserInternal},null,2));await browser.close();await server.close();}
