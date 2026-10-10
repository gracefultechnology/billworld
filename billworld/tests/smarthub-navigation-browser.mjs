import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../server.mjs';
const temp=mkdtempSync(join(tmpdir(),'billworld-navigation-'));
const server=await start({port:0,adminPort:0,dbPath:join(temp,'world.sqlite')});
const browser=await puppeteer.launch({headless:'shell',timeout:120000});
const results=[],errors=[];
const heading=(p,t)=>p.waitForFunction(t=>document.querySelector('h1')?.textContent===t,{},t);
try {
 for(const siteId of ['avec-electric','gvp-electric']) {
  const fixture=server.world.create({siteId}),context=await browser.createBrowserContext(),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${server.baseUrl}/enter/${fixture.episodeId}/${fixture.entryToken}`);
  await page.goto(server.baseUrl+'/smarthub/ui/#/login');
  await page.locator('[name=email]').fill('alex@billworld.test',{typingThreshold:0});await page.locator('[name=password]').fill('Billworld-2026!',{typingThreshold:0});
  await page.locator('form[data-action=hub-login] button:not([type=button])').click();await heading(page,'HOME');
  let dashboards=0,holdNext=false,held,notifyHeld;
  await page.setRequestInterception(true);
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/dashboard'){dashboards++;if(holdNext){holdNext=false;held=request;notifyHeld();return;}}request.continue();});
  // Native fragment navigation emits popstate and hashchange. No idle wait before editing.
  await page.goto(server.baseUrl+'/smarthub/ui/#/makeAPayment');await heading(page,'MAKE A PAYMENT');
  await page.select('[name=methodId]','bank-1048');await page.locator('[name=amount]').fill('20.00',{typingThreshold:0});
  await page.waitForNetworkIdle({idleTime:100});
  assert.equal(dashboards,1,'one dashboard request per fragment navigation');
  assert.equal(await page.$eval('[name=methodId]',e=>e.value),'bank-1048');assert.equal(await page.$eval('[name=amount]',e=>e.value),'20.00');
  // A delayed old route must never overwrite the newer route when its response arrives.
  await page.goto(server.baseUrl+'/smarthub/ui/#/home');await heading(page,'HOME');
  const waiting=new Promise(resolve=>notifyHeld=resolve);holdNext=true;
  await page.goto(server.baseUrl+'/smarthub/ui/#/makeAPayment');await waiting;
  await page.goto(server.baseUrl+'/smarthub/ui/#/paymentHistory');await heading(page,'PAYMENT HISTORY');
  await held.continue();await page.waitForNetworkIdle({idleTime:100});
  assert.equal(await page.$eval('h1',e=>e.textContent),'PAYMENT HISTORY');
  await page.goBack();await heading(page,'MAKE A PAYMENT');
  await page.select('[name=methodId]','bank-1048');await page.waitForNetworkIdle({idleTime:100});assert.equal(await page.$eval('[name=methodId]',e=>e.value),'bank-1048');
  await page.goForward();await heading(page,'PAYMENT HISTORY');
  results.push({siteId,duplicateEvents:true,inputsPreserved:true,staleResponseIgnored:true,backForward:true});await context.close();
 }
 assert.deepEqual(errors,[]);mkdirSync('billworld/artifacts/smarthub-navigation',{recursive:true});writeFileSync('billworld/artifacts/smarthub-navigation/results.json',JSON.stringify({results,errors},null,2));console.log(JSON.stringify(results));
}finally{await browser.close();await server.close();rmSync(temp,{recursive:true,force:true});}
