import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {start} from '../server.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
const dir=new URL('../artifacts/cusi-profile-recovery-browser/',import.meta.url);mkdirSync(dir,{recursive:true});
const report={kind:'cusi_registered_profile_email_recovery',released:false,scenarios:[],page_errors:[],outbound_requests:[]};
let server,browser,page;
const nav=(fn)=>Promise.all([page.waitForNavigation({waitUntil:'load'}),fn()]);
const go=path=>page.goto(server.baseUrl+path,{waitUntil:'load'});
try{
 server=await start({port:0,adminPort:0,dbPath:':memory:',construction:true});browser=await puppeteer.launch({headless:true,timeout:60000});
 const f=server.world.create({siteId:'lockwood',taskId:'lockwood-register-login-v1'});
 // Private fixture setup establishes distinct billing-contact and login emails.
 server.world.transact(f.episodeId,s=>{s.accounts[0].email='utility.contact@billworld.test';});
 page=await browser.newPage();page.setDefaultTimeout(30000);await page.setViewport({width:1365,height:900});
 page.on('pageerror',e=>report.page_errors.push(e.message));await page.setRequestInterception(true);
 page.on('request',r=>{if(r.url().startsWith(server.baseUrl+'/')||r.url().startsWith('data:'))r.continue();else{report.outbound_requests.push(r.url());r.abort();}});
 await go(`/enter/${f.episodeId}/${f.entryToken}`);await go('/Account/Registration');await page.waitForSelector('#cusi-registration-lookup');
 if(await page.$('.lockwood-cookie-reference'))await page.locator('.lockwood-cookie-buttons button:first-child').click();
 await page.locator('[name=accountNumber]').fill('1001048');await page.locator('[name=phone]').fill('4175550148');
 await nav(()=>page.locator('#submit').click());await page.waitForSelector('#cusi-registration-verify');
 await page.locator('label:has([name=confirmAccount]) span').click();await nav(()=>page.locator('#cusi-registration-verify button').click());await page.waitForSelector('#cusi-registration-user');
 for(const[name,value]of Object.entries({email:'alex@billworld.test',username:'alex.new',password:'Registered-2026!',confirmPassword:'Registered-2026!'}))await page.locator(`[name=${name}]`).fill(value);
 await page.locator('label:has([name=consent]) span').click();await nav(()=>page.locator('#cusi-registration-user button').click());await page.waitForSelector('#cusi-registration-complete');
 await go('/Account/ForgotPassword');await page.waitForFunction(()=>!document.querySelector('#Username').disabled);await page.locator('#Username').fill('alex.new');await page.locator('#btn-email').click();
 await page.waitForFunction(()=>document.querySelector('.cusi-error')?.textContent.includes('enrolled'));
 const sent=server.world.state(f.episodeId).mail.at(-1);assert.equal(sent.subject,'Your local Lockwood password reset link');assert.equal(sent.to,'alex@billworld.test');
 await go('/mail');await page.locator('[name=email]').fill('alex@billworld.test');await page.locator('[name=password]').fill('Mailbox-2026!');await page.locator('form[data-action="mail-login"] button').click();
 await page.locator(`[data-testid="email-item-${sent.id.split('-').at(-1)}"] .email-content`).click();await page.waitForSelector('a[href^="/Account/ResetPassword?token="]');
 await page.screenshot({path:new URL('profile-recovery-mail.png',dir).pathname,fullPage:true});
 await nav(()=>page.locator('a[href^="/Account/ResetPassword?token="]').click());await page.waitForSelector('#cusi-reset');assert.ok((await page.cookies()).find(c=>c.name==='bw_cusi_reset').httpOnly);
 for(const name of ['password','confirmPassword'])await page.locator(`[name=${name}]`).fill('Restored-2026!');
 await nav(()=>page.locator('#cusi-reset button').click());await page.waitForFunction(()=>!document.querySelector('#Username').disabled);
 await page.locator('#Username').fill('alex.new');await page.locator('#Password').fill('Registered-2026!');await page.locator('#btn-login').click();await page.waitForFunction(()=>document.querySelector('.cusi-error')?.textContent.includes('incorrect'));
 await page.locator('#Password').fill('Restored-2026!');await nav(()=>page.locator('#btn-login').click());await page.waitForSelector('#cusi-username');assert.equal(await page.$eval('#cusi-username',e=>e.textContent),'alex.new');
 const state=server.world.state(f.episodeId);assert.equal(state.accounts[0].email,'utility.contact@billworld.test');assert.equal(state.accounts[0].cusiProfile.email,'alex@billworld.test');assert.equal(state.mail.at(-1).to,'alex@billworld.test');assert.equal(state.events.filter(e=>e.type==='password_reset').length,1);assert.equal(state.payments.filter(p=>!p.initial).length,0);
 await page.screenshot({path:new URL('restored-account.png',dir).pathname,fullPage:true});
 report.scenarios.push('UI registration with distinct utility contact, Gmail recovery delivery, single reset and new-credential login');
 assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.outbound_requests,[]);report.all_passed=true;console.log('PASS '+report.scenarios[0]);
}catch(e){report.all_passed=false;report.error=e.message;if(page&&!page.isClosed())try{await page.screenshot({path:new URL('failure.png',dir).pathname,fullPage:true});}catch{}throw e;}
finally{writeFileSync(new URL('report.json',dir),JSON.stringify(report,null,2)+'\n');try{await browser?.close();}finally{await server?.close();}}
