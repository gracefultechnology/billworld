// Lockwood ePayUB first slice: every signed-in flow through the real UI, graded by the private evaluator.
import assert from 'node:assert/strict';import puppeteer from 'puppeteer';import{start}from '../server.mjs';import{mkdirSync,writeFileSync}from'node:fs';import{LOCKWOOD_TASKS,runLockwoodJourney}from'../infinity/reference-lockwood.mjs';
const server=await start({port:0,adminPort:0,dbPath:':memory:'}),browser=await puppeteer.launch({headless:true,protocolTimeout:60000}),dir=new URL('../artifacts/lockwood-portal-browser/',import.meta.url);mkdirSync(dir,{recursive:true});
const report={kind:'lockwood_first_slice',released:true,scenarios:[],outbound_requests:[],page_errors:[],unlabeled_controls:[]};
const go=(p,path)=>p.goto(server.baseUrl+path,{waitUntil:'networkidle0'}),nav=(p,fn)=>Promise.all([p.waitForNavigation({waitUntil:'networkidle0'}),fn()]);
const state=f=>server.world.state(f.episodeId),grade=(f,o={})=>server.world.evaluate(f.episodeId,o);
function pass(name){report.scenarios.push(name);console.log('PASS '+name);}
async function audit(page,label){const bad=await page.evaluate(()=>[...document.querySelectorAll('#cusi-content input:not([type=hidden]),#cusi-content select,#cusi-content button,#cusi-content a,.cusi-menu a,.cusi-menu button')].filter(e=>e.checkVisibility()).filter(e=>{const name=(e.getAttribute('aria-label')||[...(e.labels||[])].map(l=>l.textContent).join(' ')||e.textContent||'').trim();return!name;}).map(e=>e.outerHTML.slice(0,120)));for(const b of bad)report.unlabeled_controls.push(label+': '+b);}
async function make(taskId,{login=true}={}){const f=server.world.create({siteId:'lockwood',taskId}),context=await browser.createBrowserContext(),page=await context.newPage();page.setDefaultTimeout(15000);await page.setViewport({width:1365,height:900});page.on('pageerror',e=>report.page_errors.push(taskId+': '+e.message));await page.setRequestInterception(true);page.on('request',r=>{if(r.url().startsWith(server.baseUrl+'/')||r.url().startsWith('data:'))r.continue();else{report.outbound_requests.push(r.url());r.abort();}});
 await go(page,`/enter/${f.episodeId}/${f.entryToken}`);
 if(login){await go(page,'/Account/Login');await page.waitForFunction(()=>!document.querySelector('#Username').disabled);await page.locator('#Username').fill('alex.morgan');await page.locator('#Password').fill('Billworld-2026!');await nav(page,()=>page.locator('#btn-login').click());await page.waitForSelector('#cusi-username');await audit(page,'overview');if(await page.$('.lockwood-cookie-reference'))await page.locator('.lockwood-cookie-buttons button').click();assert.equal(await page.$('.lockwood-cookie-reference'),null);}
 return{f,context,page};}
const fill=async(page,values,scope='')=>{for(const[name,value]of Object.entries(values))await page.locator(scope+' [name='+name+']').fill(value);};
const pick=(page,selector,value)=>page.select(selector,value);
const errorText=async(page,text)=>{try{await page.waitForFunction(t=>[...document.querySelectorAll('.cusi-error')].some(e=>e.textContent.includes(t)),{},text);}catch(e){throw Error('Expected error "'+text+'"; saw '+JSON.stringify(await page.$$eval('.cusi-error',x=>x.map(y=>y.textContent))));}};
try{
 // 1. Card payment from the bill (existing released task).
 let{f,context,page}=await make('lockwood-pay-current-card-v1');
 await nav(page,()=>page.locator('.cusi-paybill .cusi-current-bill').click());await page.waitForSelector('#cusi-balance');assert.equal(await page.$eval('#cusi-balance',e=>e.textContent),'$84.32');
 const lines=await page.$$eval('.cusi-statement tbody tr',r=>r.map(x=>x.textContent));assert.ok(lines.some(l=>l.includes('Trash')&&l.includes('$13.00')));assert.ok((await page.$eval('.cusi-policy',e=>e.textContent)).includes('10% penalty'));await audit(page,'bill');
 await nav(page,()=>page.locator('a.cusi-button[href^="/Account/Payment?"]').click());await page.waitForSelector('#cusi-payment');await audit(page,'payment');
 await fill(page,{name:'Alex Morgan',cardNumber:'4242424242424242',expiry:'12/29',cvv:'123'});await nav(page,()=>page.locator('#cusi-payment button[type=submit]').click());await page.waitForSelector('#cusi-confirm');
 assert.equal(await page.$eval('#cusi-total',e=>e.textContent),'$86.82');await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('#cusi-confirm');
 await page.locator('#cusi-confirm button').click();assert.equal(state(f).payments.filter(p=>!p.initial).length,0);
 await page.locator('[name=authorize]').click();await nav(page,()=>page.locator('#cusi-confirm button').click());await page.waitForSelector('#cusi-confirmation');let confirmation=await page.$eval('#cusi-confirmation',e=>e.textContent);
 let score=grade(f,{confirmation});assert.equal(score.success,true,JSON.stringify(score.checks));assert.equal(grade(f,{confirmation:'BW-WRONG'}).success,false);await page.screenshot({path:new URL('card-receipt.png',dir).pathname,fullPage:true});
 pass('Overview, statement with documented trash/penalty policy, card review reload, authorization and graded receipt');await context.close();

 // 2. Link a bank account from Make a Payment, pay by E-Check, verify history.
 ({f,context,page}=await make('lockwood-echeck-link-pay-v1'));
 await nav(page,()=>page.locator('.cusi-paybill .cusi-current-bill').click());await nav(page,()=>page.locator('a.cusi-button[href^="/Account/Payment?"]').click());
 await page.locator('input[name=option][value=echeck]').click();await page.waitForSelector('#cusi-no-bank');await nav(page,()=>page.locator('#cusi-link-bank').click());await page.waitForSelector('#cusi-link-bank-form');await audit(page,'wallet');
 await fill(page,{name:'Alex Morgan',routing:'021000021',accountNumber:'000001048',confirmAccountNumber:'000001049',email:'alex@billworld.test'},'#cusi-link-bank-form');await page.locator('#cusi-link-bank-form [name=consent]').click();await page.locator('#cusi-link-bank-form button').click();await errorText(page,'must match');
 await page.locator('#cusi-link-bank-form [name=confirmAccountNumber]').fill('000001048');await nav(page,()=>page.locator('#cusi-link-bank-form button').click());await page.waitForSelector('#cusi-methods');assert.ok((await page.$eval('#cusi-methods',e=>e.textContent)).includes('Verified'));
 await nav(page,()=>page.locator('#cusi-return').click());await page.locator('input[name=option][value=echeck]').click();await nav(page,()=>page.locator('#cusi-payment button[type=submit]').click());await page.waitForSelector('#cusi-confirm');assert.equal(await page.$eval('#cusi-fee',e=>e.textContent),'$0.00');assert.equal(await page.$eval('#cusi-option',e=>e.textContent),'E-Check');
 await page.locator('[name=authorize]').click();await nav(page,()=>page.locator('#cusi-confirm button').click());confirmation=await page.$eval('#cusi-confirmation',e=>e.textContent);
 assert.equal(grade(f,{confirmation}).checks.history_after_payment,false);await nav(page,()=>page.locator('#cusi-content a[href="/Account/History"]').click());await page.waitForSelector('#cusi-payments');assert.ok((await page.$eval('#cusi-payments',e=>e.textContent)).includes(confirmation));await audit(page,'history');
 score=grade(f,{confirmation});assert.equal(score.success,true,JSON.stringify(score.checks));pass('Payment-page LINK ACCOUNT round trip, mismatch validation, verified bank, E-Check with $0 fee and history confirmation');await context.close();

 // 3. Scheduled bank draft, including the documented due-date/penalty rule.
 ({f,context,page}=await make('lockwood-schedule-draft-v1'));
 await nav(page,()=>page.locator('#menu-make-payment').click());await page.locator('input[name=option][value=draft]').click();
 await page.$eval('[name=date]',e=>e.value='2026-10-20');await page.locator('#cusi-payment button[type=submit]').click();await errorText(page,'late penalty');
 await page.$eval('[name=date]',e=>e.value='2026-10-27');await page.locator('[name=acknowledgeLate]').click();await page.locator('#cusi-payment button[type=submit]').click();await errorText(page,'discontinued');
 await page.locator('[name=acknowledgeLate]').click();await page.$eval('[name=date]',e=>e.value='2026-10-14');await nav(page,()=>page.locator('#cusi-payment button[type=submit]').click());await page.waitForSelector('#cusi-review-date');
 await page.locator('[name=authorize]').click();await nav(page,()=>page.locator('#cusi-confirm button').click());const scheduledDate=await page.$eval('#cusi-scheduled-date',e=>e.textContent);assert.equal(scheduledDate,'2026-10-14');
 assert.equal(state(f).payments.filter(p=>!p.initial).length,0);score=grade(f,{scheduledDate});assert.equal(score.success,true,JSON.stringify(score.checks));
 const mail=state(f).mail.at(-1);assert.match(mail.subject,/scheduled bank draft/);server.world.advance(f.episodeId,11*86400000);assert.equal(state(f).payments.at(-1).source,'scheduled_bank_draft');assert.equal(state(f).scheduledPayments[0].status,'processed');
 pass('Scheduled Bank Draft enforces late-penalty acknowledgement and disconnect date, issues receipt, grades, then executes on the Schedule For date');await context.close();

 // 4. Reschedule one draft, cancel another with inline confirmation.
 ({f,context,page}=await make('lockwood-manage-drafts-v1'));
 await nav(page,()=>page.locator('.cusi-menu a[href="/Account/History"]').click());await page.waitForSelector('#cusi-scheduled');
 await nav(page,()=>page.locator('tr[data-schedule="draft-1"] a').click());await page.waitForSelector('#cusi-draft-edit');await audit(page,'scheduled');await page.$eval('#cusi-draft-edit [name=date]',e=>e.value='2026-10-09');await nav(page,()=>page.locator('#cusi-draft-edit button').click());
 await nav(page,()=>page.locator('tr[data-schedule="draft-2"] a').click());await page.locator('#cusi-cancel-start').click();await page.waitForSelector('#cusi-cancel-yes',{visible:true});await page.locator('#cusi-cancel-no').click();assert.equal(state(f).scheduledPayments[1].status,'scheduled');
 await page.locator('#cusi-cancel-start').click();await nav(page,()=>page.locator('#cusi-cancel-yes').click());await page.waitForSelector('#cusi-scheduled');
 assert.ok((await page.$eval('tr[data-schedule="draft-2"] .cusi-status',e=>e.textContent)).includes('cancelled'));score=grade(f);assert.equal(score.success,true,JSON.stringify(score.checks));
 server.world.advance(f.episodeId,7*86400000);assert.equal(state(f).scheduledPayments[0].status,'processed');assert.equal(state(f).payments.filter(p=>!p.initial).length,1);
 pass('History edit/cancel of scheduled drafts with inline confirmation, grader success and cancelled draft never executes');await context.close();

 // 5. AutoPay enrollment with a new card from Help > Payment & Billing.
 ({f,context,page}=await make('lockwood-autopay-enroll-v1'));
 await nav(page,()=>page.locator('.cusi-menu a[href="/Help/PaymentBilling"]').click());await nav(page,()=>page.locator('.cusi-help a[href="/Account/AutoPay"]').click());await page.waitForSelector('#cusi-set-autopay');
 await page.locator('#cusi-set-autopay').click();await page.waitForSelector('#cusi-autopay-form',{visible:true});await audit(page,'autopay');
 await page.locator('#cusi-autopay-form [name=amount]').fill('150');await pick(page,'#cusi-autopay-form [name=methodId]','');await fill(page,{name:'Alex Morgan',cardNumber:'4242424242424242',expiry:'12/29',cvv:'123'},'#cusi-autopay-form');
 await nav(page,()=>page.locator('#cusi-autopay-form button[type=submit]').click());await page.waitForSelector('#cusi-autopay-confirm');assert.equal(await page.$eval('#cusi-autopay-review-amount',e=>e.textContent),'$150.00');
 await page.locator('#cusi-autopay-confirm [name=authorize]').click();await nav(page,()=>page.locator('#cusi-autopay-confirm button').click());await page.waitForFunction(()=>document.querySelector('#cusi-autopay-status')?.textContent.includes('Maximum Amount $150.00'));
 score=grade(f);assert.equal(score.success,true,JSON.stringify(score.checks));
 server.world.advance(f.episodeId,12*86400000);const ap=state(f).payments.at(-1);assert.equal(ap.source,'autopay');assert.equal(ap.amountCents,8432);assert.equal(ap.feeCents,250);
 pass('Help link to AutoPay, ADD NEW CREDIT/DEBIT CARD AUTO PAY, review/save, graded enrollment and due-date draft');await context.close();

 // 6. Change AutoPay to the saved verified bank and Maximum Amount; wallet removal is blocked while enrolled.
 ({f,context,page}=await make('lockwood-autopay-change-v1'));
 await go(page,'/Account/PaymentMethods');await page.waitForSelector('#cusi-methods');await page.locator('button[aria-label="Remove Visa ending 4242"]').click();await errorText(page,'Cancel or change AutoPay');
 await go(page,'/Account/AutoPay');await page.locator('#cusi-set-autopay').click();await page.locator('#cusi-autopay-form input[value=maximum]').click();await page.locator('#cusi-autopay-form [name=amount]').fill('200.00');await pick(page,'#cusi-autopay-form [name=methodId]','cusi-bank-1048');
 await nav(page,()=>page.locator('#cusi-autopay-form button[type=submit]').click());await page.locator('#cusi-autopay-confirm [name=authorize]').click();await nav(page,()=>page.locator('#cusi-autopay-confirm button').click());
 await page.waitForFunction(()=>document.querySelector('#cusi-autopay-status')?.textContent.includes('Checking ending 1048'));score=grade(f);assert.equal(score.success,true,JSON.stringify(score.checks));
 pass('AutoPay change to Maximum Amount on verified checking; method removal blocked while AutoPay uses it');await context.close();

 // 7. Cancel AutoPay.
 ({f,context,page}=await make('lockwood-autopay-cancel-v1'));
 await go(page,'/Account/AutoPay');await page.locator('#cusi-autopay-cancel-start').click();await nav(page,()=>page.locator('#cusi-autopay-cancel-yes').click());await page.waitForFunction(()=>document.querySelector('#cusi-autopay-status')?.textContent.includes('AutoPay is off'));
 score=grade(f);assert.equal(score.success,true,JSON.stringify(score.checks));server.world.advance(f.episodeId,12*86400000);assert.equal(state(f).payments.filter(p=>!p.initial).length,0);
 pass('AutoPay cancellation with inline confirmation; no draft on the next due date');await context.close();

 // 8. Paperless and communication preferences.
 ({f,context,page}=await make('lockwood-paperless-v1'));
 await nav(page,()=>page.locator('#header-preferences').click());await page.waitForSelector('#cusi-preferences');await audit(page,'preferences');
 await page.locator('[name=paperless]').click();await page.locator('#cusi-preferences button').click();await errorText(page,'turn off Printed');
 await page.locator('[name=printed]').click();await page.locator('[name=phoneCall]').click();await nav(page,()=>page.locator('#cusi-preferences button').click());await page.reload({waitUntil:'networkidle0'});
 await page.waitForFunction(()=>document.querySelector('#cusi-preferences-status')?.textContent.includes('paperless on'));score=grade(f);assert.equal(score.success,true,JSON.stringify(score.checks));
 pass('Communication preferences: paperless rule validation, save and reload');await context.close();

 // 9. Late penalty and access control.
 ({f,context,page}=await make('lockwood-username-login-v1'));
 assert.equal(grade(f).success,true);server.world.advance(f.episodeId,13*86400000+60000);
 await go(page,'/Account/History');await page.waitForFunction(()=>document.querySelector('.cusi-error')?.textContent.includes('sign in'));assert.ok(await page.$('#cusi-content a[href="/Account/Login"]'));
 await go(page,'/Account/Login');await page.waitForFunction(()=>!document.querySelector('#Username').disabled);await page.locator('#Username').fill('alex.morgan');await page.locator('#Password').fill('Billworld-2026!');await nav(page,()=>page.locator('#btn-login').click());
 await go(page,'/Account/History');await page.waitForSelector('#cusi-statements');const statements=await page.$eval('#cusi-statements',e=>e.textContent);assert.ok(statements.includes('late penalty')&&statements.includes('$8.43'));
 await go(page,'/Account/Bill?invoiceId=inv-other');await errorText(page,'not found');await page.setViewport({width:375,height:812});await go(page,'/Account/Overview');await page.waitForSelector('#cusi-username');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
 await nav(page,()=>page.locator('#cusi-logout').click());await go(page,'/Account/Overview');await errorText(page,'sign in');
 pass('Documented 10% penalty after the 15th, signed-out recovery link, other-account denial, phone layout and logout');await context.close();

 // 10. Infinity reference journeys: one tab from the municipal homepage start URL, graded by the private evaluator.
 for(const[upstream,taskId]of Object.entries(LOCKWOOD_TASKS)){const f=server.world.create({siteId:'lockwood',taskId}),context=await browser.createBrowserContext(),page=await context.newPage();page.setDefaultTimeout(20000);await page.setViewport({width:1365,height:900});page.on('pageerror',e=>report.page_errors.push(upstream+': '+e.message));
  await page.goto(`${server.baseUrl}/enter/${f.episodeId}/${f.entryToken}`,{waitUntil:'load'});let steps=0;const answer=await runLockwoodJourney(taskId,{page,base:server.baseUrl,step:()=>steps++});const r=grade(f,answer);assert.equal(r.success,true,upstream+' '+JSON.stringify(r.checks));assert.ok(steps>0&&steps<=f.task.budget.actions,upstream+' steps '+steps);await context.close();}
 pass('All eleven Lockwood Infinity reference journeys start on the homepage and satisfy their private graders');

 assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.outbound_requests,[]);assert.deepEqual(report.unlabeled_controls,[]);report.all_passed=true;
}catch(e){report.all_passed=false;report.error=e.stack;throw e;}finally{writeFileSync(new URL('report.json',dir),JSON.stringify(report,null,2)+'\n');await browser.close();await server.close();}
