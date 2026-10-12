// Scripted Lockwood (ePayUB/CUSI) reference journeys for the Infinity adapter; not an autonomous agent.
// Each journey starts on the municipal homepage, uses only visible UI, and returns the task's answer object.
export const LOCKWOOD_TASKS={
 task_lw1:'lockwood-username-login-v1',task_lw2:'lockwood-recover-login-v1',task_lw3:'lockwood-pay-current-card-v1',task_lw4:'lockwood-register-login-v1',
 task_lw5:'lockwood-echeck-link-pay-v1',task_lw6:'lockwood-schedule-draft-v1',task_lw7:'lockwood-manage-drafts-v1',task_lw8:'lockwood-autopay-enroll-v1',
 task_lw9:'lockwood-autopay-change-v1',task_lw10:'lockwood-autopay-cancel-v1',task_lw11:'lockwood-paperless-v1'};
export async function runLockwoodJourney(task,{page,base,step=()=>{}}){
 const click=async s=>{step();await page.locator(s).click();},fill=async(n,v,scope='')=>{step();await page.locator(scope+' [name="'+n+'"]').fill(v,{typingThreshold:0});},
  nav=async s=>{await Promise.all([page.waitForNavigation({waitUntil:'load'}),click(s)]);},cookies=async()=>{if(await page.$('.lockwood-cookie-reference'))await click('.lockwood-cookie-buttons button');},
  setValue=async(s,v)=>{step();await page.$eval(s,(e,x)=>{e.value=x;e.dispatchEvent(new Event('change',{bubbles:true}));},v);};
 let answer={};await page.waitForSelector('a[href="/Account/Login"]');
 if(task==='lockwood-register-login-v1'){
  await page.goto(base+'/Account/Registration');step();await page.waitForSelector('#cusi-registration-lookup');await cookies();await fill('accountNumber','1001048');await fill('phone','4175550148');await nav('#submit');await page.waitForSelector('#cusi-registration-verify');await click('label:has([name=confirmAccount]) span');await nav('#cusi-registration-verify button');await page.waitForSelector('#cusi-registration-user');
  for(const[n,v]of Object.entries({email:'alex@billworld.test',username:'alex.new',password:'Registered-2026!',confirmPassword:'Registered-2026!'}))await fill(n,v);await click('label:has([name=consent]) span');await nav('#cusi-registration-user button');await page.waitForSelector('#cusi-registration-complete');await nav('a.btn[href="/Account/Login"]');
 }else if(task==='lockwood-recover-login-v1'){
  await page.goto(base+'/Account/ForgotPassword');step();await page.waitForFunction(()=>!document.querySelector('#Username')?.disabled);await cookies();await fill('username','alex.morgan');await click('#btn-email');await page.waitForFunction(()=>!document.querySelector('#btn-email').disabled&&document.querySelector('.cusi-error')?.textContent.includes('enrolled'));
  await page.goto(base+'/mail');step();await page.waitForFunction(()=>document.querySelector('h1')?.textContent==='Sign in to Gmail');await fill('email','alex@billworld.test');await fill('password','Mailbox-2026!');await click('form[data-action="mail-login"] button:not([type="button"])');await page.waitForFunction(()=>document.querySelector('h1')?.textContent==='Inbox');
  await click('[data-testid="email-item-2"] .email-content');await page.waitForSelector('a[href^="/Account/ResetPassword?token="]');await nav('a[href^="/Account/ResetPassword?token="]');await page.waitForSelector('#cusi-reset');await fill('password','Restored-2026!');await fill('confirmPassword','Restored-2026!');await nav('#cusi-reset button');
 }else await nav('a[href="/Account/Login"]');
 await page.waitForFunction(()=>!document.querySelector('#Username')?.disabled);await cookies();
 await fill('username',task==='lockwood-register-login-v1'?'alex.new':'alex.morgan');await fill('password',task==='lockwood-recover-login-v1'?'Restored-2026!':task==='lockwood-register-login-v1'?'Registered-2026!':'Billworld-2026!');await nav('#btn-login');await page.waitForSelector('#cusi-username');await cookies();
 const review=async()=>{await page.waitForSelector('#cusi-confirm');await click('#cusi-confirm [name=authorize]');await nav('#cusi-confirm button[type=submit]');await page.waitForSelector('#cusi-confirmation');};
 if(task==='lockwood-pay-current-card-v1'){
  await nav('.cusi-paybill .cusi-current-bill');await page.waitForSelector('#cusi-balance');await nav('a.cusi-button[href^="/Account/Payment?"]');await page.waitForSelector('#cusi-payment');
  for(const[n,v]of Object.entries({name:'Alex Morgan',cardNumber:'4242424242424242',expiry:'12/29',cvv:'123'}))await fill(n,v,'#cusi-payment');await nav('#cusi-payment button[type=submit]');await review();answer={confirmation:await page.$eval('#cusi-confirmation',e=>e.textContent)};
 }else if(task==='lockwood-echeck-link-pay-v1'){
  await nav('.cusi-paybill .cusi-current-bill');await page.waitForSelector('#cusi-balance');await nav('.cusi-menu a[href="/Account/PaymentMethods"]');await page.waitForSelector('#cusi-link-bank-form');
  for(const[n,v]of Object.entries({name:'Alex Morgan',routing:'021000021',accountNumber:'000001048',confirmAccountNumber:'000001048',email:'alex@billworld.test'}))await fill(n,v,'#cusi-link-bank-form');step();await page.select('#cusi-link-bank-form [name=accountType]','Checking');await click('#cusi-link-bank-form [name=consent]');await nav('#cusi-link-bank-form button[type=submit]');await page.waitForSelector('#cusi-methods');
  await nav('#menu-make-payment');await click('#cusi-payment input[value=echeck]');await nav('#cusi-payment button[type=submit]');await review();answer={confirmation:await page.$eval('#cusi-confirmation',e=>e.textContent)};
  await nav('#cusi-content a[href="/Account/History"]');await page.waitForSelector('#cusi-payments');
 }else if(task==='lockwood-schedule-draft-v1'){
  await nav('#menu-make-payment');await click('#cusi-payment input[value=draft]');await setValue('#cusi-payment [name=date]','2026-10-14');await nav('#cusi-payment button[type=submit]');await review();answer={scheduledDate:await page.$eval('#cusi-scheduled-date',e=>e.textContent)};
 }else if(task==='lockwood-manage-drafts-v1'){
  await nav('.cusi-menu a[href="/Account/History"]');await page.waitForSelector('#cusi-scheduled');await nav('tr[data-schedule="draft-1"] a');await page.waitForSelector('#cusi-draft-edit');await setValue('#cusi-draft-edit [name=date]','2026-10-09');await nav('#cusi-draft-edit button[type=submit]');
  await page.waitForSelector('#cusi-scheduled');await nav('tr[data-schedule="draft-2"] a');await click('#cusi-cancel-start');await page.waitForSelector('#cusi-cancel-yes',{visible:true});await nav('#cusi-cancel-yes');await page.waitForSelector('#cusi-scheduled');
 }else if(['lockwood-autopay-enroll-v1','lockwood-autopay-change-v1'].includes(task)){
  const enroll=task==='lockwood-autopay-enroll-v1';await nav('.cusi-menu a[href="/Help/PaymentBilling"]');await nav('.cusi-help a[href="/Account/AutoPay"]');await click('#cusi-set-autopay');await page.waitForSelector('#cusi-autopay-form',{visible:true});
  await click('#cusi-autopay-form input[value=maximum]');await fill('amount',enroll?'150.00':'200.00','#cusi-autopay-form');step();await page.select('#cusi-autopay-form [name=methodId]',enroll?'':'cusi-bank-1048');
  if(enroll)for(const[n,v]of Object.entries({name:'Alex Morgan',cardNumber:'4242424242424242',expiry:'12/29',cvv:'123'}))await fill(n,v,'#cusi-autopay-form');
  await nav('#cusi-autopay-form button[type=submit]');await page.waitForSelector('#cusi-autopay-confirm');await click('#cusi-autopay-confirm [name=authorize]');await nav('#cusi-autopay-confirm button[type=submit]');await page.waitForFunction(()=>document.querySelector('#cusi-autopay-status')?.textContent.includes('AutoPay is on'));
 }else if(task==='lockwood-autopay-cancel-v1'){
  await nav('.cusi-menu a[href="/Account/AutoPay"]');await click('#cusi-autopay-cancel-start');await page.waitForSelector('#cusi-autopay-cancel-yes',{visible:true});await nav('#cusi-autopay-cancel-yes');await page.waitForFunction(()=>document.querySelector('#cusi-autopay-status')?.textContent.includes('AutoPay is off'));
 }else if(task==='lockwood-paperless-v1'){
  await nav('.cusi-menu a[href="/Account/Preferences"]');await page.waitForSelector('#cusi-preferences');await click('#cusi-preferences [name=paperless]');await click('#cusi-preferences [name=phoneCall]');await click('#cusi-preferences [name=printed]');await nav('#cusi-preferences button[type=submit]');
  step();await page.reload({waitUntil:'load'});await page.waitForFunction(()=>document.querySelector('#cusi-preferences-status')?.textContent.includes('paperless on'));
 }
 return answer;
}
