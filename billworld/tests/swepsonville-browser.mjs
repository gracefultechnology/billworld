import puppeteer from 'puppeteer';
import {start} from '../server.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const dir=new URL('../artifacts/swepsonville/',import.meta.url).pathname;mkdirSync(dir,{recursive:true});
const server=await start({port:0,adminPort:0,dbPath:':memory:'}),results=[];
try{
 for(const [upstream,taskId] of [['task_m8','swepsonville-guest-pay-v1'],['task_h10','swepsonville-register-login-v1'],['task_h11','swepsonville-recover-login-v1']]){
  const f=server.world.create({siteId:'swepsonville-water',taskId}),target=dir+upstream;mkdirSync(target,{recursive:true});
  const {stdout}=await promisify(execFile)('node',['billworld/infinity/reference.mjs',`${server.baseUrl}/enter/${f.episodeId}/${f.entryToken}`,upstream,target],{timeout:300000});
  const r=JSON.parse(stdout);assert.deepEqual(r.errors,[]);const outcome=server.world.evaluate(f.episodeId,r.answer);assert.equal(outcome.success,true,JSON.stringify(outcome.checks));results.push({name:taskId,passed:true});console.log('PASS '+taskId);
 }
 const browser=await puppeteer.launch({headless:true,timeout:60000}),page=await browser.newPage(),errors=[],outbound=[];page.setDefaultTimeout(60000);
 page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());if(['data:','about:'].includes(u.protocol)||u.origin===server.baseUrl)r.continue();else{outbound.push(r.url());r.abort();}});
 await page.setViewport({width:1365,height:900});
 const heading=t=>page.waitForFunction(t=>document.querySelector('h1')?.textContent===t,{},t),go=async(path,title)=>{await page.goto(server.baseUrl+path);await heading(title);},fill=async(data)=>{for(const[k,v]of Object.entries(data))await page.locator(`[name="${k}"]`).fill(v);},submit=async(action,title)=>{await page.locator(`form[data-action="authority-${action}"] button`).click();if(title)await heading(title);};
 try{
  const f=server.world.create({siteId:'swepsonville-water',taskId:'swepsonville-register-login-v1'});await page.goto(`${server.baseUrl}/enter/${f.episodeId}/${f.entryToken}`);await heading('Town of Swepsonville');await go('/site','Pay your bill');await page.locator('[data-accept-cookies]').click();await page.waitForFunction(()=>!document.querySelector('[data-accept-cookies]'));await go('/site/register','Create an Account');
  await fill({firstName:'Alex',lastName:'Morgan',customerNumber:'1001048',cid:'Wrong',email:'alex@billworld.test',confirmEmail:'alex@billworld.test',password:'Registered-2026!',confirmPassword:'Registered-2026!'});await submit('register');await page.waitForFunction(()=>document.querySelector('#error')?.textContent.includes('CID'));assert.equal(server.world.state(f.episodeId).accounts[0].registered,false);
  await page.screenshot({path:dir+'registration.png',fullPage:true});results.push({name:'incorrect CID stays on registration without creating an account',passed:true});
  const g=server.world.create({siteId:'swepsonville-water'});await page.goto(`${server.baseUrl}/enter/${g.episodeId}/${g.entryToken}`);await heading('Town of Swepsonville');await go('/site/login','Pay your bill');await fill({email:'alex@billworld.test',password:'Billworld-2026!'});await submit('login','My Account');await go('/invoicecloud/payment?invoice=inv-current','Please Locate Your Account');
  await fill({customerNumber:'1001048',lastName:'Wrong'});await submit('lookup');await page.waitForFunction(()=>document.querySelector('#error')?.textContent.includes('verified'));await fill({lastName:'Morgan'});await submit('lookup','Search Results');await page.reload();await heading('Search Results');await go('/invoicecloud/payment?invoice=inv-current','Payment Information');await page.select('[name="kind"]','card');await page.waitForSelector('[name="cardNumber"]');await fill({name:'Alex Morgan',cardNumber:'378282246310005',expiry:'12/29',cvv:'1234'});await submit('quote','Review Payment');await submit('pay','Payment Confirmation');assert.equal(server.world.state(g.episodeId).payments.find(p=>!p.initial).authenticated,false);results.push({name:'signed-in portal requires guest lookup; card checkout survives lookup reload',passed:true});
  await go('/bank-draft','BANK DRAFT FORM');assert.match(await page.$eval('main',e=>e.textContent),/SIGNATURE AUTHORIZES A CREDIT REPORT/);for(const file of ['swepsonville-fees-2026-2027.pdf','swepsonville-water-policy.pdf']){const response=await fetch(server.baseUrl+'/reference-assets/'+file);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/pdf/);}results.push({name:'help exposes local policy PDFs and the documented bank-draft form',passed:true});
  assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);writeFileSync(dir+'network-validation.json',JSON.stringify({page_errors:errors,outbound_requests:outbound},null,2));
 }finally{await browser.close();}
}finally{writeFileSync(dir+'results.json',JSON.stringify({scenarios:results.length,all_passed:results.length===6&&results.every(r=>r.passed),results},null,2));await server.close();}
