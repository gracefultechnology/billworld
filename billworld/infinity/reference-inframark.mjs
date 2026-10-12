// Scripted Inframark UI references shared by the Infinity reference runner and the
// Puppeteer browser test. These are validation scripts, not autonomous agents.
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

export const INFRAMARK_TASKS={
 task_inf1:'inframark-username-login-v1',task_inf2:'inframark-guest-bank-payment-v1',task_inf3:'inframark-guest-card-payment-v1',
 task_inf4:'inframark-register-account-v1',task_inf5:'inframark-recover-username-password-v1',task_inf6:'inframark-saved-bank-payment-v1',
 task_inf7:'inframark-saved-card-payment-v1',task_inf8:'inframark-read-history-balances-v1',task_inf9:'inframark-download-current-bill-v1',
 task_inf10:'inframark-paperless-v1',task_inf11:'inframark-manage-wallet-v1',task_inf12:'inframark-autopay-enable-v1',
 task_inf13:'inframark-autopay-change-v1',task_inf14:'inframark-autopay-cancel-v1',task_inf15:'inframark-schedule-payment-v1',
 task_inf16:'inframark-scheduled-edit-v1',task_inf17:'inframark-scheduled-cancel-v1'
};
const BILLING={firstName:'Alex',lastName:'Morgan',address:'1 Test Street',city:'Mankato',state:'MN',zip:'56001',email:'alex@billworld.test'};

export async function runInframarkFlow(taskId,{page,browser,base,artifacts,step=()=>{}}){
 page.on('dialog',d=>d.accept());
 const click=async selector=>{step();await page.locator(selector).click();};
 const fill=async(name,value)=>{step();await page.locator(`[name="${name}"]`).fill(value,{typingThreshold:0});};
 // Click, accept the expected number of in-page confirmations, then optionally await navigation.
 const press=async(selector,{navigate=true,confirms=0}={})=>{const nav=navigate?page.waitForNavigation({waitUntil:'load'}):null;await click(selector);for(let i=0;i<confirms;i++){await page.waitForSelector('#starnik-confirm [data-answer=yes]');await click('#starnik-confirm [data-answer=yes]');}if(nav)await nav;};
 const go=async path=>{step();await page.goto(base+path,{waitUntil:'load'});};
 const heading=text=>page.waitForFunction(t=>document.querySelector('h1')?.textContent===t,{},text);
 const text=(selector,value)=>page.waitForFunction((s,v)=>document.querySelector(s)?.textContent.includes(v),{},selector,value);
 const visible=async selector=>{for(const link of await page.$$(selector))if(await link.evaluate(e=>e.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}))){const nav=page.waitForNavigation({waitUntil:'load'});step();await link.click();await nav;return;}throw Error('No visible '+selector);};
 const signIn=async(username='alex.inframark',password='Inframark-2026!')=>{await page.waitForSelector('#starnik-login');await fill('username',username);await fill('password',password);await press('#ctl04_ctl00_btnLogin');await page.waitForSelector('#starnik-logout');};
 const portal=async()=>{await go('/RP_Default.aspx');await signIn();};
 const mail=async item=>{await go('/mail');await page.waitForFunction(()=>['Sign in to Gmail','Inbox'].includes(document.querySelector('h1')?.textContent));if(await page.$eval('h1',e=>e.textContent==='Sign in to Gmail')){await fill('email','alex@billworld.test');await fill('password','Mailbox-2026!');await click('form[data-action="mail-login"] button:not([type="button"])');}await heading('Inbox');await click(`[data-testid="email-item-${item}"] .email-content`);};
 let answer={};
 switch(taskId){
 case 'inframark-username-login-v1':await page.goto(base+'/',{waitUntil:'load'});await visible('a[href="/RP_Default.aspx"]');await signIn();break;
 case 'inframark-guest-bank-payment-v1':case 'inframark-guest-card-payment-v1':{
  // Reach billing help from the homepage through the reconstructed Customer Portal menu.
  const kind=taskId.includes('bank')?'bank':'card';await page.goto(base+'/',{waitUntil:'load'});await click('li.menu-item-187>a');await click('li.menu-item-1098>a');await visible('li.menu-item-1098 a[href="/billing"]');await visible('a[href="/starnikERP/#/rp_guestpay/rp_guestpay"]');await page.waitForSelector('#starnik-guest-lookup');
  await fill('securityCode','INF1048');await fill('serviceZip','77001');await press('#starnik-guest-lookup button');await page.waitForSelector('#starnik-payment');
  step();await page.select('[name=kind]',kind);for(const[k,v]of Object.entries({name:'Alex Morgan',...BILLING,...(kind==='bank'?{bankName:'Test Bank',routing:'021000021',confirmRouting:'021000021',accountNumber:'1234561048',confirmAccountNumber:'1234561048'}:{cardNumber:'4242424242424242',expiry:'12/30',cvv:'123'})}))await fill(k,v);
  await press('#starnik-payment button',{confirms:1});await page.waitForSelector('#starnik-payment-confirm');await text('#starnik-total',kind==='bank'?'$85.32':'$86.85');await click('[name=authorize]');await press('#starnik-payment-confirm button',{confirms:1});await page.waitForSelector('#starnik-confirmation');
  await press('a[href="/starnik/guest/account"]');await page.waitForFunction(()=>document.body.textContent.includes('$0.00'));break;}
 case 'inframark-register-account-v1':
  await go('/RP/signup');await page.waitForSelector('#starnik-signup');for(const[k,v]of Object.entries({securityCode:'INF1048',email:'alex@billworld.test',confirmEmail:'alex@billworld.test'}))await fill(k,v);await press('#starnik-signup button[type=submit]');await page.waitForSelector('#starnik-resend');
  await mail(2);await page.waitForSelector('a[href^="/starnik/signup/verify?token="]');await press('a[href^="/starnik/signup/verify?token="]');await page.waitForSelector('#starnik-setup');
  await fill('username','alex.new');await click('#starnik-check-username');await text('#starnik-username-availability','Username is available.');await fill('password','Registered-2026!');await fill('confirmPassword','Registered-2026!');await press('#starnik-setup button[type=submit]');await page.waitForSelector('#starnik-signup-complete');
  await press('a[href="/RP_Default.aspx"]');await signIn('alex.new','Registered-2026!');break;
 case 'inframark-recover-username-password-v1':
  await go('/RP/forgot-username');await page.waitForSelector('#starnik-recovery');await fill('email','alex@billworld.test');await click('#starnik-recovery button[type=submit]');await text('#starnik-error','sent');
  await mail(2);await page.waitForFunction(()=>document.body.textContent.includes('Your username is alex.inframark'));
  await go('/RP/forgot-password');await page.waitForSelector('#starnik-recovery');await fill('username','alex.inframark');await click('#starnik-recovery button[type=submit]');await text('#starnik-error','sent');
  await mail(3);await page.waitForSelector('a[href^="/starnik/reset?token="]');await press('a[href^="/starnik/reset?token="]');await page.waitForSelector('#starnik-reset');
  await fill('password','Restored-2026!');await fill('confirmPassword','Restored-2026!');await click('#starnik-reset button');await page.waitForSelector('#starnik-reset-success');await press('a[href="/RP_Default.aspx"]');await signIn('alex.inframark','Restored-2026!');break;
 case 'inframark-saved-bank-payment-v1':case 'inframark-saved-card-payment-v1':{
  const bank=taskId.includes('bank');await portal();await press('a[href="/starnik/payment"]');await page.waitForSelector('#starnik-signed-payment');step();await page.select('[name=methodId]',bank?'inframark-bank-1048':'inframark-card-4242');await fill('amount',bank?'84.32':'20.00');
  await press('#starnik-signed-payment button');await page.waitForSelector('#starnik-signed-confirm');await page.waitForFunction(fee=>document.body.textContent.includes('Processing fee '+fee),{},bank?'$1.00':'$0.60');await click('[name=authorize]');await press('#starnik-signed-confirm button');await page.waitForSelector('#starnik-payment-confirmation');
  answer={confirmation:(await page.$eval('#starnik-payment-confirmation',e=>e.textContent)).replace('Confirmation: ','')};await press('a[href="/starnik/account"]');await page.waitForSelector('#starnik-logout');await press('a[href="/starnik/payment"]');await text('#starnik-payment-balance',bank?'$0.00':'$64.32');break;}
 case 'inframark-read-history-balances-v1':
  await portal();await press('a[href="/transaction-history"]');await page.waitForSelector('#starnik-history table');
  answer=await page.$eval('#starnik-history',root=>{const t=root.textContent,posted=t.match(/Posted balance \$([0-9]+\.[0-9]{2})/),remaining=t.match(/Remaining after pending payments \$([0-9]+\.[0-9]{2})/);let pending=0;const h=[...root.querySelectorAll('h2')].find(e=>e.textContent==='Pending Payments');for(let p=h.nextElementSibling;p&&p.tagName!=='H2';p=p.nextElementSibling){const m=p.textContent.match(/\$([0-9]+\.[0-9]{2})/);if(m)pending+=Math.round(Number(m[1])*100);}return{postedBalanceCents:Math.round(Number(posted[1])*100),pendingPaymentCents:pending,remainingBalanceCents:Math.round(Number(remaining[1])*100)};});break;
 case 'inframark-download-current-bill-v1':{
  await portal();const downloadPath=resolve(artifacts,'downloads');mkdirSync(downloadPath,{recursive:true});const cdp=await browser.target().createCDPSession();const contextId=page.browserContext().id;await cdp.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath,eventsEnabled:true,...(contextId?{browserContextId:contextId}:{})});let begun,timer;
  const complete=new Promise((ok,fail)=>{timer=setTimeout(()=>fail(Error('Statement download timed out')),60000);cdp.on('Browser.downloadWillBegin',e=>{begun=e;});cdp.on('Browser.downloadProgress',e=>{if(e.guid===begun?.guid){if(e.state==='completed')ok(e);if(e.state==='canceled')fail(Error('Statement download canceled'));}});});
  try{const[,finished]=await Promise.all([click('a[data-statement="inv-current"]'),complete]);const bytes=readFileSync(resolve(downloadPath,begun.guid));if(bytes.subarray(0,5).toString()!=='%PDF-'||bytes.length!==finished.receivedBytes)throw Error('Incomplete PDF download');
   const expected=JSON.parse(readFileSync(new URL('../research/inframark-statements.json',import.meta.url))).documents.find(d=>d.invoiceId==='inv-current'&&d.siteId==='inframark'),sha=createHash('sha256').update(bytes).digest('hex');if(sha!==expected.sha256)throw Error('Downloaded statement hash mismatch');
   answer={statementFilename:begun.suggestedFilename};writeFileSync(resolve(artifacts,'download.json'),JSON.stringify({...answer,sha256:sha,bytes:bytes.length,completed:true},null,2));}finally{clearTimeout(timer);await cdp.detach();}
  break;}
 case 'inframark-paperless-v1':
  await portal();await press('a[href="/my-account/ebill"]');await page.waitForSelector('#starnik-ebill-toggle');await click('#starnik-ebill-toggle');await page.waitForSelector('#starnik-ebill-form');await click('[name=eBillOption][value="1"]');await click('#starnik-ebill-form button');
  await page.waitForFunction(()=>document.querySelector('#starnik-ebill-status')?.textContent==='eBill only');step();await page.reload({waitUntil:'load'});await page.waitForFunction(()=>document.querySelector('#starnik-ebill-status')?.textContent==='eBill only');break;
 case 'inframark-manage-wallet-v1':
  await portal();await press('a[href="/my-account/payment-methods"]');await page.waitForSelector('[data-remove]');await press('a[href="/my-account/payment-methods/edit/inframark-card-4242"]');await page.waitForSelector('#starnik-payment');
  for(const[k,v]of Object.entries({cardNumber:'4242424242424242',cvv:'123',expiry:'12/31'}))await fill(k,v);await press('#starnik-payment button');await page.waitForSelector('#starnik-wallet-confirm');await click('[name=authorize]');await press('#starnik-wallet-confirm button');await page.waitForSelector('[data-remove]');
  await press('a[href="/my-account/payment-methods/add"]');await page.waitForSelector('#starnik-payment');step();await page.select('[name=accountType]','Savings');for(const[k,v]of Object.entries({name:'Alex Morgan',bankName:'Test Bank',routing:'021000021',confirmRouting:'021000021',accountNumber:'1234561048',confirmAccountNumber:'1234561048',...BILLING}))await fill(k,v);
  await press('#starnik-payment button');await page.waitForSelector('#starnik-wallet-confirm');await click('[name=authorize]');await press('#starnik-wallet-confirm button');await page.waitForSelector('[data-remove="inframark-bank-2099"]');
  await press('[data-remove="inframark-bank-2099"]',{navigate:false,confirms:1});await page.waitForFunction(()=>!document.querySelector('[data-remove="inframark-bank-2099"]'));step();await page.reload({waitUntil:'load'});await page.waitForSelector('[data-remove]');break;
 case 'inframark-autopay-enable-v1':case 'inframark-autopay-change-v1':{
  const card=taskId.includes('change');await portal();await press('a[href="/my-account/autopay"]');await page.waitForSelector('#starnik-autopay-select');step();await page.select('[name=methodId]',card?'inframark-card-4242':'inframark-bank-1048');
  await press('#starnik-autopay-select button');await page.waitForSelector('#starnik-autopay-confirm');await text('#starnik-autopay-confirm','on the due date');await click('[name=agreedToTerms]');await press('#starnik-autopay-confirm button',{confirms:1});await page.waitForSelector('#starnik-autopay-disable');
  step();await page.reload({waitUntil:'load'});await text('#starnik-autopay-status',card?'enabled using Visa ending 4242':'enabled using Checking ending 1048');break;}
 case 'inframark-autopay-cancel-v1':
  await portal();await press('a[href="/my-account/autopay"]');await page.waitForSelector('#starnik-autopay-disable');await press('#starnik-autopay-disable',{navigate:false,confirms:1});await text('#starnik-autopay-status','disabled');step();await page.reload({waitUntil:'load'});await text('#starnik-autopay-status','disabled');break;
 case 'inframark-schedule-payment-v1':case 'inframark-scheduled-edit-v1':{
  const edit=taskId.includes('edit');await portal();await press('a[href="/starnik/scheduled"]');await page.waitForSelector('#starnik-schedule-form');
  if(edit){await click('[data-edit="inframark-sched-1018"]');await text('#starnik-schedule-form-title','Edit payment scheduled for 2026-10-18');}
  step();await page.select('[name=methodId]',edit?'inframark-card-4242':'inframark-bank-1048');await fill('amount','84.32');await fill('date',edit?'2026-10-16':'2026-10-15');await press('#starnik-schedule-form button:not([type=button])');
  await page.waitForSelector('#starnik-schedule-confirm');await text('#starnik-schedule-summary',edit?'$2.53':'$1.00');await click('[name=authorize]');await press('#starnik-schedule-confirm button');
  await text('#starnik-schedule-message','saved');const date=edit?'2026-10-16':'2026-10-15';await page.waitForFunction(d=>[...document.querySelectorAll('#starnik-schedule-table tr')].some(r=>r.textContent.includes(d)&&r.textContent.includes('Scheduled')),{},date);answer={scheduledDate:date};break;}
 case 'inframark-scheduled-cancel-v1':
  await portal();await press('a[href="/starnik/scheduled"]');await page.waitForSelector('[data-cancel="inframark-sched-1018"]');await press('[data-cancel="inframark-sched-1018"]',{navigate:false,confirms:1});await text('#starnik-schedule-message','cancelled');
  await page.waitForFunction(()=>document.querySelector('tr[data-schedule="inframark-sched-1018"]')?.textContent.includes('Cancelled'));break;
 default:throw Error('Unknown Inframark task '+taskId);
 }
 return answer;
}
