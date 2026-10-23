import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {X509Certificate,createHash} from 'node:crypto';
import puppeteer from 'puppeteer';
import {startHttpsEpisode} from '../integration/https-episode-host.mjs';
import {finalizeInstalledEpisode} from '../integration/finalize-installed-episode.mjs';

test('metered HTTPS guest payment uses supplied instrument and final close acceptance',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'billworld-finalize-guest-'));let host,browser;
 try{
  host=await startHttpsEpisode({outputRoot:directory,trial:{kind:'reference_script',agent:'guest-finalizer-regression'}});
  await host.startActionBudget({unit:'browser_tool_invocation'});
  // Trust only this disposable leaf in this browser process, never global trust.
  const https=await import('node:https');
  const ca=await readFile(host.deviceTrust.caPath);
  const certificate=await new Promise((resolve,reject)=>https.get(host.deviceTrust.billingOrigin+'/health',{ca},res=>{const cert=res.socket.getPeerX509Certificate();res.resume();res.on('end',()=>resolve(cert));}).on('error',reject));
  const spki=createHash('sha256').update(new X509Certificate(certificate.raw).publicKey.export({type:'spki',format:'der'})).digest('base64');
  browser=await puppeteer.launch({headless:true,pipe:true,timeout:60000,args:[`--ignore-certificate-errors-spki-list=${spki}`]});
  const page=await browser.newPage(),errors=[],outbound=[];
  await page.setRequestInterception(true);page.on('request',r=>{if(new URL(r.url()).origin===host.deviceTrust.billingOrigin)r.continue();else{outbound.push(r.url());r.abort();}});page.on('pageerror',e=>errors.push(e.message));
  const action=async(name,fn)=>{assert.equal((await host.reserveAction({name})).allowed,true);return fn();};
  const heading=text=>action('observe',()=>page.waitForFunction(t=>document.querySelector('h1')?.textContent===t,{},text));
  const click=selector=>action('click',()=>page.locator(selector).click());
  const fill=(name,value)=>action('fill',()=>page.locator(`[name="${name}"]`).fill(value));
  const submit=async(name,title)=>{await click(`form[data-action="${name}"] button`);await heading(title);};
  await action('navigate',()=>page.goto(host.agentInputs.startUrl));await heading('Utilities Division');
  await click('nav a[href="/portal"]');await heading('Pay or View Bills');await click('a[href="/portal/search"]');await heading('Search Invoices');
  const persona=host.agentInputs.persona.credentials;
  await fill('customerNumber',persona.customerNumber);await submit('search','Search Results');
  await click('[name="invoice"][value="inv-current"]');await submit('select','Review your selection');
  await click('a[href="/portal/method"]');await heading('Choose payment method');await submit('method','Payment Information');
  for(const [field,value] of Object.entries({name:persona.checking.name,routing:persona.checking.routing,accountNumber:persona.checking.account}))await fill(field,value);
  await submit('quote','Review Payment');await submit('pay','Payment confirmation');
  const confirmation=await action('observe',()=>page.$eval('#confirmation',e=>e.textContent));
  await browser.close();browser=null;
  const result=await finalizeInstalledEpisode({episode:host,outcome:{confirmation},termination:'completed'});
  assert.equal(result.accepted,true);assert.equal(result.observed.paymentCount,1);assert.equal(result.observed.confirmationMatchesPayment,true);
  assert.equal(result.report.finished.kind,'reference_script');assert.ok(result.report.finished.actionsUsed>20);assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);
 }finally{await browser?.close();await host?.close();await rm(directory,{recursive:true,force:true});}
});
