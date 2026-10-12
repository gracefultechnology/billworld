// Scripted ONSWC UI journeys shared by the Infinity reference and the ONSWC
// Puppeteer test. Each journey starts from an entered episode in one tab and
// uses only visible, labeled controls. It is a reference, not an agent.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

export const ONSWC_TASKS=['onswc-username-login-v1','onswc-register-account-v1','onswc-recover-username-password-v1','onswc-saved-bank-payment-v1','onswc-saved-card-payment-v1','onswc-read-history-balances-v1','onswc-download-current-bill-v1','onswc-paperless-v1','onswc-manage-wallet-v1','onswc-autopay-enable-v1','onswc-autopay-change-v1','onswc-autopay-cancel-v1','onswc-ach-enroll-v1','onswc-ach-change-v1','onswc-ach-stop-v1','onswc-schedule-payment-v1','onswc-scheduled-edit-v1','onswc-scheduled-cancel-v1'];

export async function onswcJourney(page,base,taskId,{downloadPath,onStep=()=>{}}={}){
 const step=async()=>{await onStep(page);};
 const click=async selector=>{await step();await page.locator(selector).click();};
 const fill=async(name,value)=>{await step();await page.locator(`[name="${name}"]`).fill(value,{typingThreshold:0});};
 const nav=async selector=>{await step();await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.locator(selector).click()]);};
 const text=(selector,value)=>page.waitForFunction((s,v)=>document.querySelector(s)?.textContent.includes(v),{},selector,value);
 // In-page confirmation dialog (ONSWC opts out of native dialogs).
 const confirmInline=async()=>{await page.waitForSelector('#starnik-confirm [data-answer=yes]',{visible:true});await click('#starnik-confirm [data-answer=yes]');};
 const confirmInlineNav=async()=>{await page.waitForSelector('#starnik-confirm [data-answer=yes]',{visible:true});await nav('#starnik-confirm [data-answer=yes]');};
 const goto=async path=>{await step();await page.goto(base+path,{waitUntil:'load'});};
 const signIn=async(username='alex.onswc',password='ONSWC-2026!')=>{
  await goto('/');let opened=false;
  for(const link of await page.$$('a[href="/RP_Default.aspx"]'))if(await link.evaluate(e=>e.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}))){await step();await Promise.all([page.waitForNavigation({waitUntil:'load'}),link.click()]);opened=true;break;}
  if(!opened)throw Error('Visible ONSWC portal link unavailable');
  await page.waitForSelector('#starnik-login');await fill('username',username);await fill('password',password);await nav('#ctl04_ctl00_btnLogin');await page.waitForSelector('#starnik-logout');
 };
 const mail=async(item,linkSelector)=>{
  await goto('/mail');await page.waitForFunction(()=>['Sign in to Gmail','Inbox'].includes(document.querySelector('h1')?.textContent));
  if(await page.$('form[data-action="mail-login"]')){await fill('email','alex@billworld.test');await fill('password','Mailbox-2026!');await click('form[data-action="mail-login"] button:not([type="button"])');await page.waitForFunction(()=>document.querySelector('h1')?.textContent==='Inbox');}
  await click(`[data-testid="email-item-${item}"] .email-content`);if(linkSelector){await page.waitForSelector(linkSelector);await nav(linkSelector);}
 };
 const menu=async href=>{await nav(`a[href="${href}"]`);};
 let answer={};
 if(taskId==='onswc-username-login-v1'){await signIn();}
 else if(taskId==='onswc-register-account-v1'){
  await goto('/RP/signup');await page.waitForSelector('#starnik-signup');for(const[n,v]of Object.entries({securityCode:'ONS1048',email:'alex@billworld.test',confirmEmail:'alex@billworld.test'}))await fill(n,v);
  await nav('#starnik-signup button[type=submit]');await page.waitForSelector('#starnik-resend');
  await mail(2,'a[href^="/starnik/signup/verify?token="]');await page.waitForSelector('#starnik-setup');await page.reload({waitUntil:'load'});await page.waitForSelector('#starnik-setup');
  await fill('username','alex.new');await click('#starnik-check-username');await text('#starnik-username-availability','available');await fill('password','Registered-2026!');await fill('confirmPassword','Registered-2026!');
  await nav('#starnik-setup button[type=submit]');await page.waitForSelector('#starnik-signup-complete');await nav('a[href="/RP_Default.aspx"]');
  await page.waitForSelector('#starnik-login');await fill('username','alex.new');await fill('password','Registered-2026!');await nav('#ctl04_ctl00_btnLogin');await page.waitForSelector('#starnik-logout');
 }
 else if(taskId==='onswc-recover-username-password-v1'){
  await goto('/RP/forgot-username');await page.waitForSelector('#starnik-recovery');await fill('email','alex@billworld.test');await click('#starnik-recovery button[type=submit]');await text('#starnik-error','sent');
  await mail(2);await page.waitForFunction(()=>document.body.textContent.includes('Your username is alex.onswc'));
  await goto('/RP/forgot-password');await page.waitForSelector('#starnik-recovery');await fill('username','alex.onswc');await click('#starnik-recovery button[type=submit]');await text('#starnik-error','sent');
  await mail(3,'a[href^="/starnik/reset?token="]');await page.waitForSelector('#starnik-reset');await page.reload({waitUntil:'load'});await page.waitForSelector('#starnik-reset');
  await fill('password','Restored-2026!');await fill('confirmPassword','Restored-2026!');await click('#starnik-reset button');await page.waitForSelector('#starnik-reset-success');await nav('a[href="/RP_Default.aspx"]');
  await page.waitForSelector('#starnik-login');await fill('username','alex.onswc');await fill('password','Restored-2026!');await nav('#ctl04_ctl00_btnLogin');await page.waitForSelector('#starnik-logout');
 }
 else if(['onswc-saved-bank-payment-v1','onswc-saved-card-payment-v1'].includes(taskId)){
  const bank=taskId.includes('bank');await signIn();await menu('/starnik/payment');await page.waitForSelector('#starnik-signed-payment');await step();await page.select('[name=methodId]',bank?'onswc-bank-1048':'onswc-card-4242');
  await fill('amount',bank?'94.39':'40.00');await nav('#starnik-signed-payment button');await page.waitForSelector('#starnik-signed-confirm');await text('main',bank?'Processing fee $1.50':'Processing fee $2.00');
  await click('[name=authorize]');await nav('#starnik-signed-confirm button');await page.waitForSelector('#starnik-payment-confirmation');
  answer={confirmation:(await page.$eval('#starnik-payment-confirmation',e=>e.textContent)).replace('Confirmation: ','')};
  await goto('/starnik/payment');await text('#starnik-payment-balance',bank?'$0.00':'$54.39');
 }
 else if(taskId==='onswc-read-history-balances-v1'){
  await signIn();await menu('/transaction-history');await page.waitForSelector('#starnik-history table');
  answer=await page.$eval('#starnik-history',root=>{const t=root.textContent,cents=s=>Math.round(Number(s.replace(/[$,]/g,''))*100),posted=t.match(/Posted balance \$([0-9,]+\.[0-9]{2})/),remaining=t.match(/Remaining after pending payments \$([0-9,]+\.[0-9]{2})/);let pending=0;const h=[...root.querySelectorAll('h2')].find(e=>e.textContent==='Pending Payments');for(let p=h.nextElementSibling;p&&p.tagName!=='H2';p=p.nextElementSibling){const m=p.textContent.match(/\$([0-9,]+\.[0-9]{2})/);if(m)pending+=cents(m[1]);}return{postedBalanceCents:cents(posted[1]),pendingPaymentCents:pending,remainingBalanceCents:cents(remaining[1])};});
 }
 else if(taskId==='onswc-download-current-bill-v1'){
  await signIn();const cdp=await page.createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath,eventsEnabled:true});let begun;
  const done=new Promise((ok,bad)=>{const timer=setTimeout(()=>bad(Error('Statement download timed out')),60000);cdp.on('Browser.downloadWillBegin',e=>{begun=e;});cdp.on('Browser.downloadProgress',e=>{if(e.guid===begun?.guid){if(e.state==='completed'){clearTimeout(timer);ok(e);}if(e.state==='canceled'){clearTimeout(timer);bad(Error('Statement download canceled'));}}});});
  try{const [,finished]=await Promise.all([click('a[data-statement="inv-current"]'),done]);const bytes=readFileSync(resolve(downloadPath,begun.guid));
   const expected=JSON.parse(readFileSync(new URL('../research/onswc-statements.json',import.meta.url))).documents.find(d=>d.invoiceId==='inv-current');
   if(bytes.subarray(0,5).toString()!=='%PDF-'||bytes.length!==finished.receivedBytes||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw Error('Downloaded statement mismatch');
   answer={statementFilename:begun.suggestedFilename};}finally{await cdp.detach();}
 }
 else if(taskId==='onswc-paperless-v1'){
  await signIn();await menu('/my-account/ebill');await page.waitForSelector('#starnik-ebill-toggle');await click('#starnik-ebill-toggle');await page.waitForSelector('#starnik-ebill-form');
  await click('[name=eBillOption][value="1"]');await click('#starnik-ebill-form button');await page.waitForFunction(()=>document.querySelector('#starnik-ebill-status')?.textContent==='eBill only');
  await page.reload({waitUntil:'load'});await page.waitForFunction(()=>document.querySelector('#starnik-ebill-status')?.textContent==='eBill only');
 }
 else if(taskId==='onswc-manage-wallet-v1'){
  const billing={firstName:'Alex',lastName:'Morgan',address:'1048 Rocklyn Way',city:'Chapel Hill',state:'NC',zip:'27516',country:'United States',email:'alex@billworld.test'};
  await signIn();await menu('/my-account/payment-methods');await page.waitForSelector('[data-remove]');await nav('a[href="/my-account/payment-methods/edit/onswc-card-4242"]');await page.waitForSelector('#starnik-payment');
  for(const[k,v]of Object.entries({cardNumber:'4242424242424242',cvv:'123',expiry:'12/31',...billing}))await fill(k,v);await nav('#starnik-payment button');await page.waitForSelector('#starnik-wallet-confirm');await click('[name=authorize]');await nav('#starnik-wallet-confirm button');
  await page.waitForSelector('[data-remove]');await nav('a[href="/my-account/payment-methods/add"]');await page.waitForSelector('#starnik-payment');await step();await page.select('[name=kind]','bank');await step();await page.select('[name=accountType]','Savings');
  for(const[k,v]of Object.entries({name:'Alex Morgan',bankName:'Test Bank',routing:'021000021',confirmRouting:'021000021',accountNumber:'1234561048',confirmAccountNumber:'1234561048',...billing}))await fill(k,v);
  await nav('#starnik-payment button');await page.waitForSelector('#starnik-wallet-confirm');await click('[name=authorize]');await nav('#starnik-wallet-confirm button');await page.waitForSelector('[data-remove="onswc-bank-2099"]');
  await click('[data-remove="onswc-bank-2099"]');await confirmInline();await page.waitForFunction(()=>!document.querySelector('[data-remove="onswc-bank-2099"]'));
  await page.reload({waitUntil:'load'});await page.waitForFunction(()=>document.querySelectorAll('[data-remove]').length===2&&document.body.textContent.includes('Visa ending 4242 · 12/31'));
 }
 else if(['onswc-autopay-enable-v1','onswc-autopay-change-v1','onswc-autopay-cancel-v1'].includes(taskId)){
  await signIn();await menu('/my-account/autopay');await page.waitForSelector('#starnik-autopay-status');
  if(taskId==='onswc-autopay-cancel-v1'){await click('#starnik-autopay-disable');await confirmInline();await text('#starnik-autopay-status','disabled');}
  else{const method=taskId==='onswc-autopay-enable-v1'?'onswc-bank-1048':'onswc-card-4242';await step();await page.select('[name=methodId]',method);await nav('#starnik-autopay-select button');await page.waitForSelector('#starnik-autopay-confirm');
   await click('[name=agreedToTerms]');if(await page.$('[name=acknowledgeAch]'))await click('[name=acknowledgeAch]');await click('#starnik-autopay-confirm button');await confirmInlineNav();await page.waitForSelector('#starnik-autopay-disable');}
  await page.reload({waitUntil:'load'});await text('#starnik-autopay-status',taskId==='onswc-autopay-cancel-v1'?'disabled':taskId==='onswc-autopay-enable-v1'?'enabled using Checking ending 1048':'enabled using Visa ending 4242');
 }
 else if(['onswc-ach-enroll-v1','onswc-ach-change-v1'].includes(taskId)){
  const enroll=taskId==='onswc-ach-enroll-v1';await signIn();await menu('/my-account/ach');await page.waitForSelector('#starnik-ach-switch');
  if(enroll)await click('#starnik-ach-switch');else await click('#starnik-ach-edit');await page.waitForSelector('#ach-form');
  await fill('bankName','Carolina Community Bank');await step();await page.select('[name=achTransactionCodeId]',enroll?'1':'2');
  const account=enroll?'7700123456':'5500987654';for(const[n,v]of Object.entries({routingNumber:'053000196',confirmRoutingNumber:'053000196',accountNumber:account,confirmAccountNumber:account}))await fill(n,v);
  await nav('#ach-form button');await page.waitForSelector('#starnik-ach-agreement');await click('[name=agreedToTerms]');
  if(enroll){await click('#starnik-ach-agreement button');await confirmInlineNav();}else await nav('#starnik-ach-agreement button');await text('#ach-status',' ending in '+account.slice(-4));
  if(enroll){await menu('/my-account/autopay');await page.waitForSelector('#starnik-autopay-disable');await click('#starnik-autopay-disable');await confirmInline();await text('#starnik-autopay-status','disabled');await goto('/my-account/ach');await text('#ach-status','ending in 3456');}
  else{await page.reload({waitUntil:'load'});await text('#ach-status','ending in 7654');}
 }
 else if(taskId==='onswc-ach-stop-v1'){
  await signIn();await menu('/my-account/ach');await page.waitForSelector('#starnik-ach-switch');await click('#starnik-ach-switch');await confirmInline();await text('#ach-status','ACH is off.');
  await page.reload({waitUntil:'load'});await text('#ach-status','Test Bank ending in 1048 is on file');
 }
 else if(['onswc-schedule-payment-v1','onswc-scheduled-edit-v1','onswc-scheduled-cancel-v1'].includes(taskId)){
  await signIn();await menu('/starnik/scheduled');await page.waitForSelector('#starnik-schedule-form');
  if(taskId==='onswc-scheduled-cancel-v1'){await click('[data-cancel="onswc-sched-1015"]');await confirmInline();await text('[data-schedule="onswc-sched-1015"]','Cancelled');await page.reload({waitUntil:'load'});await text('[data-schedule="onswc-sched-1015"]','Cancelled');await text('[data-schedule="onswc-sched-1009"]','Scheduled');}
  else{const create=taskId==='onswc-schedule-payment-v1',date=create?'2026-10-14':'2026-10-15';
   if(!create){await click('[data-edit="onswc-sched-1012"]');await text('#starnik-schedule-form-title','Edit payment');await page.select('[name=methodId]','onswc-card-4242');}
   else{await page.select('[name=methodId]','onswc-bank-1048');}
   await fill('amount','94.39');await fill('date',date);await nav('#starnik-schedule-form button');await page.waitForSelector('#starnik-schedule-confirm');await text('#starnik-schedule-summary',create?'$1.50':'$2.83');
   await click('[name=authorize]');await nav('#starnik-schedule-confirm button');await page.waitForSelector('#starnik-schedule-table');await text('#starnik-schedule-table',date);answer={scheduledDate:date};}
 }
 else throw Error('Unknown ONSWC journey '+taskId);
 return answer;
}
