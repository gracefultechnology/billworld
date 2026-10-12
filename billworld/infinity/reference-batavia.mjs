// Scripted City of Batavia (Paymentus) UI references for the released Infinity app.
// These validate the adapter and task solvability; they are not autonomous agents.
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

export const BATAVIA_TASKS={
 task_bat1:'batavia-email-login-v1',task_bat2:'batavia-recover-login-v1',task_bat3:'batavia-register-link-v1',
 task_bat4:'batavia-pay-current-bank-v1',task_bat5:'batavia-pay-current-card-v1',task_bat6:'batavia-pay-verify-history-v1',
 task_bat7:'batavia-notifications-v1',task_bat8:'batavia-download-current-bill-v1',task_bat9:'batavia-manage-wallet-v1',
 task_bat10:'batavia-enable-autopay-v1',task_bat11:'batavia-cancel-autopay-v1',task_bat12:'batavia-change-autopay-v1',
 task_bat13:'batavia-update-profile-v1',task_bat14:'batavia-change-password-v1',task_bat15:'batavia-schedule-payment-v1',
 task_bat16:'batavia-edit-scheduled-payment-v1',task_bat17:'batavia-cancel-scheduled-payment-v1',task_bat18:'batavia-pay-multiple-accounts-v1'
};

export async function runBataviaJourney(task,{page,browser,base,artifacts,step=()=>{}}){
 const click=async selector=>{step();await page.locator(selector).click();};
 const fill=async(name,value)=>{step();await page.locator(`[name="${name}"]`).fill(value,{typingThreshold:0});};
 const heading=text=>page.waitForFunction(t=>document.querySelector('h1')?.textContent===t,{},text);
 const go=async(path,title)=>{step();await page.goto(base+path);await heading(title);};
 const nav=selector=>Promise.all([page.waitForNavigation({waitUntil:'load'}),click(selector)]);
 const status=(selector,value)=>page.waitForFunction((s,v)=>document.querySelector(s)?.textContent===v,{},selector,value);
 let answer={};
 if(task==='batavia-register-link-v1'){
  await go('/paymentus/login','Login');await nav('a[href="/paymentus/register"]');await heading('New Account Information');
  for(const[name,value]of Object.entries({email:'alex@billworld.test',password:'Billworld-New-2026!',firstName:'Alex',lastName:'Morgan',phone:'6305550148',zipCode:'60510'}))await fill(name,value);
  await nav('#paymentus-register button');await heading('Add Account');await fill('customerNumber','1001048');await fill('serviceAddressPrefix','36W123');step();await page.select('[name=paperless]','true');await nav('#paymentus-link-verify button');await heading('Verify Account Information');await click('[name=emailNotification]');await click('[name=authorize]');await nav('#paymentus-link-add button');await heading('Account Created');await nav('#paymentus-created a[href="/paymentus/accounts"]');await page.waitForSelector('#paymentus-account');await nav('#paymentus-logout');
 }else if(task==='batavia-recover-login-v1'){
  await go('/paymentus/recover','Please enter your e-mail address');await fill('email','alex@billworld.test');await click('#paymentus-recover button');await page.waitForFunction(()=>document.querySelector('#paymentus-message')?.textContent.includes('sent'));
  await go('/mail','Sign in to Gmail');await fill('email','alex@billworld.test');await fill('password','Mailbox-2026!');await click('form[data-action="mail-login"] button:not([type="button"])');await heading('Inbox');await click('[data-testid="email-item-2"] .email-content');await page.waitForSelector('a[href^="/paymentus/reset?token="]');await nav('a[href^="/paymentus/reset?token="]');await page.waitForSelector('#paymentus-reset');await page.reload();await page.waitForSelector('#paymentus-reset');await fill('password','Restored-2026!');await fill('confirmPassword','Restored-2026!');await nav('#paymentus-reset button');
 }else await go('/paymentus/login','Login');
 const password=task==='batavia-recover-login-v1'?'Restored-2026!':task==='batavia-register-link-v1'?'Billworld-New-2026!':'Billworld-2026!';
 await page.waitForSelector('#paymentus-login');await fill('email','alex@billworld.test');await fill('password',password);await nav('#paymentus-login button');await page.waitForSelector('#paymentus-account');
 if(task==='batavia-notifications-v1'){
  await nav('a[href="/paymentus/preferences?accountId=acct-primary"]');await page.waitForSelector('#paymentus-preferences');await click('[name=paperless]');await click('[name=emailNotification]');await click('#paymentus-preferences button');await status('#paymentus-preferences-status','Settings saved');await page.reload();await page.waitForSelector('#paymentus-preferences');
 }
 if(['batavia-enable-autopay-v1','batavia-cancel-autopay-v1','batavia-change-autopay-v1'].includes(task)){
  const enable=task!=='batavia-cancel-autopay-v1';
  await nav('a[href="/paymentus/autopay?accountId=acct-primary"]');await page.waitForSelector('#paymentus-autopay');step();await page.select('[name=enabled]',String(enable));if(enable){step();await page.select('[name=methodId]',task==='batavia-change-autopay-v1'?'card-4242':'bank-1048');}
  await nav('#paymentus-autopay button');await page.waitForSelector('#paymentus-autopay-confirm');await page.reload();await page.waitForSelector('#paymentus-autopay-confirm');if(enable)await click('[name=acknowledgeCityDraft]');await click('[name=authorize]');await nav('#paymentus-autopay-confirm button');await page.waitForSelector('#paymentus-autopay-confirmation');await nav('#paymentus-autopay-confirmation a[href="/paymentus/autopay?accountId=acct-primary"]');await page.waitForSelector('#paymentus-autopay-status');
 }
 if(task==='batavia-manage-wallet-v1'){
  await go('/paymentus/wallet','My Wallet');await go('/paymentus/wallet/edit?methodId=card-4242','Edit Payment Method');await fill('expiry','12/31');await nav('#paymentus-wallet-change button');
  await go('/paymentus/wallet/add','Add Payment Method');for(const[name,value]of Object.entries({name:'Alex Morgan',cardNumber:'5555555555554444',expiry:'12/29',cvv:'123'}))await fill(name,value);await nav('#paymentus-wallet-add button');
  await go('/paymentus/wallet/remove?methodId=bank-1048','Remove Payment Method');await nav('#paymentus-wallet-change button');await page.waitForSelector('#paymentus-wallet');await page.reload();await page.waitForSelector('#paymentus-wallet');
 }
 if(task==='batavia-download-current-bill-v1'){
  const downloadPath=resolve(artifacts,'downloads');mkdirSync(downloadPath,{recursive:true});
  const cdp=await browser.target().createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath,eventsEnabled:true});
  let begun,timer;
  const complete=new Promise((ok,fail)=>{timer=setTimeout(()=>fail(Error('Statement download timed out')),60000);cdp.on('Browser.downloadWillBegin',event=>{begun=event;});cdp.on('Browser.downloadProgress',event=>{if(event.guid===begun?.guid){if(event.state==='completed')ok(event);if(event.state==='canceled')fail(Error('Statement download canceled'));}});});
  try{
   const [,finished]=await Promise.all([click('#paymentus-account a[href="/api/paymentus/statement?invoiceId=inv-current"]'),complete]);
   if(!/^[a-f0-9-]+$/.test(begun.guid))throw Error('Unexpected browser download identifier');
   const bytes=readFileSync(resolve(downloadPath,begun.guid));if(bytes.subarray(0,5).toString()!=='%PDF-'||bytes.length!==finished.receivedBytes)throw Error('Incomplete PDF download');
   answer={statementFilename:begun.suggestedFilename};writeFileSync(resolve(artifacts,'download.json'),JSON.stringify({...answer,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,completed:true},null,2));
  }finally{clearTimeout(timer);await cdp.detach();}
 }
 if(['batavia-pay-current-bank-v1','batavia-pay-current-card-v1','batavia-pay-verify-history-v1','batavia-schedule-payment-v1'].includes(task)){
  await nav('nav a[href="/paymentus/bills"]');await page.waitForSelector('#paymentus-bills');await nav('a[href="/paymentus/pay?invoiceId=inv-current"]');await page.waitForSelector('#paymentus-payment');
  if(task==='batavia-schedule-payment-v1'){step();await page.select('[name=kind]','saved:bank-1048');}
  else{
   if(task==='batavia-pay-current-card-v1'){step();await page.select('[name=kind]','card');}
   for(const[name,value]of Object.entries(task==='batavia-pay-current-card-v1'?{name:'Alex Morgan',cardNumber:'4242424242424242',expiry:'12/29',cvv:'123'}:{name:'Alex Morgan',routing:'021000021',accountNumber:'000001048',confirmAccountNumber:'000001048'}))await fill(name,value);
  }
  await nav('#paymentus-payment button');await page.waitForSelector('#paymentus-pay');await page.reload();await page.waitForSelector('#paymentus-pay');
  if(task==='batavia-schedule-payment-v1'){await click('[name=when][value=later]');await fill('date','2026-10-15');await click('[name=authorize]');await nav('#paymentus-pay button');await page.waitForSelector('#paymentus-scheduled [data-schedule-id]');answer={confirmation:await page.$eval('#paymentus-scheduled [data-schedule-id] h2',e=>e.textContent)};}
  else{
   await click('[name=authorize]');await nav('#paymentus-pay button');await page.waitForSelector('#confirmation');await page.reload();await page.waitForSelector('#confirmation');answer={confirmation:await page.$eval('#confirmation',e=>e.textContent)};
   if(task==='batavia-pay-verify-history-v1'){await nav('nav a[href="/paymentus/history"]');await page.waitForSelector('#paymentus-history');await page.reload();await page.waitForSelector('#paymentus-history');}
  }
 }
 if(task==='batavia-update-profile-v1'){
  await nav('nav a[href="/paymentus/profile"]');await page.waitForSelector('#paymentus-profile');await fill('phone','(630) 555-0199');await click('#paymentus-profile button');await status('#paymentus-profile-status','Profile saved');await page.reload();await page.waitForSelector('#paymentus-profile');
 }
 if(task==='batavia-change-password-v1'){
  await nav('nav a[href="/paymentus/profile"]');await page.waitForSelector('#paymentus-password');await fill('currentPassword','Billworld-2026!');await fill('password','Batavia-Secure-2026!');await fill('confirmPassword','Batavia-Secure-2026!');await click('#paymentus-password button');await status('#paymentus-password-status','Password changed');
  await nav('#paymentus-logout');await page.waitForSelector('#paymentus-login');await fill('email','alex@billworld.test');await fill('password','Batavia-Secure-2026!');await nav('#paymentus-login button');await page.waitForSelector('#paymentus-account');
 }
 if(['batavia-edit-scheduled-payment-v1','batavia-cancel-scheduled-payment-v1'].includes(task)){
  const cancel=task==='batavia-cancel-scheduled-payment-v1';
  await nav('#paymentus-account a[href="/paymentus/scheduled"]');await page.waitForSelector('#paymentus-scheduled');await nav(`a[href="/paymentus/scheduled/${cancel?'cancel':'edit'}?scheduleId=pms-seed"]`);await page.waitForSelector('#paymentus-schedule-change');
  if(cancel)await click('[name=confirm]');else{await fill('date','2026-10-12');await fill('amount','60.00');}
  await nav('#paymentus-schedule-change button');await page.waitForSelector('#paymentus-scheduled');await page.reload();await page.waitForSelector('[data-schedule-status]');
 }
 if(task==='batavia-pay-multiple-accounts-v1'){
  await nav('#paymentus-account a[href="/paymentus/pay-multiple"]');await page.waitForSelector('#paymentus-multi');step();await page.select('[name=kind]','saved:bank-1048');await nav('#paymentus-multi button');await page.waitForSelector('#paymentus-multi-pay');await page.reload();await page.waitForSelector('#paymentus-multi-pay');
  await click('[name=authorize]');await nav('#paymentus-multi-pay button');await page.waitForSelector('#confirmation');await page.reload();await page.waitForSelector('#confirmation');answer={confirmation:await page.$eval('#confirmation',e=>e.textContent)};
 }
 return answer;
}
