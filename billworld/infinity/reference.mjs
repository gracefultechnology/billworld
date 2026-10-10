// Scripted UI reference for adapter validation; this is not an autonomous agent.
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const [url, taskId, artifacts] = process.argv.slice(2);
mkdirSync(artifacts, { recursive: true });
const browserMode=process.env.BILLWORLD_REFERENCE_BROWSER_MODE||'chrome';
if(!['chrome','headless_shell'].includes(browserMode))throw Error('Unsupported reference browser mode');
const browser = await puppeteer.launch({ headless: browserMode==='headless_shell'?'shell':true, timeout: 120000 });
const browserVersion=await browser.version();
const page = await browser.newPage();
page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(60000);
const errors = []; page.on('pageerror', e => errors.push(e.message));
let steps = 0;
const heading = async text => {
  writeFileSync(resolve(artifacts,'progress.json'),JSON.stringify({stage:'await_heading',heading:text,steps,observedAt:new Date().toISOString()}));
  return page.waitForFunction(t => document.querySelector('h1')?.textContent === t, {}, text);
};
const click = async selector => { steps++; await page.locator(selector).click(); };
const fill = async (name, value) => { steps++; await page.locator(`[name="${name}"]`).fill(value,{typingThreshold:0}); };
const submit = async (action, title) => { await click(`form[data-action="${action}"] button:not([type="button"])`); if (title) await heading(title); };
const base = new URL(url).origin;
const municipalLink = async destination => {
 if(await page.$('script[src="/municipal.js"]')){await click('#nav .li-23>a:first-child');await click(`#nav a[href="${destination}"]`);}
 else await click(`a[href="${destination}"]`);
};
const go = async (path, title) => { steps++; await page.goto(base + path); await heading(title); };
try {
  if(['task_m8','task_h10','task_h11','task_m9','task_m10','task_m11','task_h12','task_h13'].includes(taskId))await page.setViewport({width:1365,height:900});
  await page.goto(url); let answer = {};
  if(taskId==='task_c29'){
    steps++;await page.goto(base+'/RP_Default.aspx');await page.waitForSelector('#starnik-login');await fill('username','alex.morgan');await fill('password','Billworld-2026!');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#ctl04_ctl00_btnLogin')]);await page.waitForSelector('#starnik-logout');
      const downloadPath=resolve(artifacts,'downloads');mkdirSync(downloadPath,{recursive:true});
      const cdp=await browser.target().createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath,eventsEnabled:true});
      let begun,timer;
      const complete=new Promise((resolve,reject)=>{
        timer=setTimeout(()=>reject(Error('Statement download timed out')),60000);
        cdp.on('Browser.downloadWillBegin',event=>{begun=event;});
        cdp.on('Browser.downloadProgress',event=>{if(event.guid===begun?.guid){if(event.state==='completed')resolve(event);if(event.state==='canceled')reject(Error('Statement download canceled'));}});
      });
      try{
        const [,finished]=await Promise.all([click('a[data-statement="inv-current"]'),complete]);
        if(!/^[a-f0-9-]+$/.test(begun.guid))throw Error('Unexpected browser download identifier');
        const bytes=readFileSync(resolve(downloadPath,begun.guid));if(bytes.subarray(0,5).toString()!=='%PDF-'||bytes.length!==finished.receivedBytes)throw Error('Incomplete PDF download');
        const expected=JSON.parse(readFileSync(new URL('../research/starnik-statements.json',import.meta.url))).documents.find(d=>d.invoiceId==='inv-current');if(createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw Error('Downloaded statement hash mismatch');answer={statementFilename:begun.suggestedFilename};writeFileSync(resolve(artifacts,'download.json'),JSON.stringify({...answer,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,completed:true},null,2));
      }finally{clearTimeout(timer);await cdp.detach();}

  }
  else if(['task_c27','task_c28'].includes(taskId)){
    const option=taskId==='task_c27'?1:2,label=option===1?'eBill only':'eBill and paper';steps++;await page.goto(base+'/RP_Default.aspx');await page.waitForSelector('#starnik-login');await fill('username','alex.morgan');await fill('password','Billworld-2026!');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#ctl04_ctl00_btnLogin')]);await page.waitForSelector('#starnik-logout');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/my-account/ebill"]')]);await page.waitForSelector('#starnik-ebill-toggle');await click('#starnik-ebill-toggle');await page.waitForSelector('#starnik-ebill-form');await click('[name=eBillOption][value="'+option+'"]');await click('#starnik-ebill-form button');await page.waitForFunction(text=>document.querySelector('#starnik-ebill-status')?.textContent===text,{},label);steps++;await page.reload();await page.waitForFunction(text=>document.querySelector('#starnik-ebill-status')?.textContent===text,{},label);
  }
  else if(['task_c25','task_c26'].includes(taskId)){
    const bank=taskId==='task_c25';steps++;await page.goto(base+'/RP_Default.aspx');await page.waitForSelector('#starnik-login');await fill('username','alex.morgan');await fill('password','Billworld-2026!');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#ctl04_ctl00_btnLogin')]);await page.waitForSelector('#starnik-logout');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/starnik/payment"]')]);await page.waitForSelector('#starnik-signed-payment');steps++;await page.select('[name=methodId]',bank?'gmg-bank-1048':'gmg-card-4242');await fill('amount',bank?'84.32':'20.00');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#starnik-signed-payment button')]);await page.waitForSelector('#starnik-signed-confirm');await click('[name=authorize]');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#starnik-signed-confirm button')]);await page.waitForSelector('#starnik-payment-confirmation');steps++;await page.reload();await page.waitForSelector('#starnik-payment-confirmation');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/starnik/account"]')]);await page.waitForSelector('#starnik-logout');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/starnik/payment"]')]);await page.waitForFunction(value=>document.querySelector('#starnik-payment-balance')?.textContent.includes(value),{},bank?'$0.00':'$64.32');
  }
  else if(['task_c23','task_c24'].includes(taskId)){
    page.on('dialog',d=>d.accept());steps++;await page.goto(base+'/RP_Default.aspx');await page.waitForSelector('#starnik-login');await fill('username','alex.morgan');await fill('password','Billworld-2026!');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#ctl04_ctl00_btnLogin')]);await page.waitForSelector('#starnik-logout');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/my-account/autopay"]')]);await page.waitForSelector('#starnik-autopay-select');
    if(taskId==='task_c23'){steps++;await page.select('[name=methodId]','gmg-bank-1048');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#starnik-autopay-select button')]);await page.waitForSelector('#starnik-autopay-confirm');for(const name of ['agreedToTerms','acknowledgeTextPay','acknowledgeAch'])await click('[name='+name+']');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#starnik-autopay-confirm button')]);await page.waitForSelector('#starnik-autopay-disable');}
    else{await click('#starnik-autopay-disable');await page.waitForFunction(()=>document.querySelector('#starnik-autopay-status')?.textContent.includes('disabled'));}
    steps++;await page.reload();await page.waitForFunction(enabled=>document.querySelector('#starnik-autopay-status')?.textContent.includes(enabled?'enabled using Checking ending 1048':'disabled'),{},taskId==='task_c23');
  }
  else if(taskId==='task_c22'){
    page.on('dialog',d=>d.accept());steps++;await page.goto(base+'/RP_Default.aspx');await page.waitForSelector('#starnik-login');await fill('username','alex.morgan');await fill('password','Billworld-2026!');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#ctl04_ctl00_btnLogin')]);await page.waitForSelector('#starnik-logout');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/my-account/payment-methods"]')]);await page.waitForSelector('[data-remove]');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/my-account/payment-methods/edit/gmg-card-4242"]')]);await page.waitForSelector('#starnik-payment');for(const[k,v]of Object.entries({cardNumber:'4242424242424242',cvv:'123',expiry:'12/31'}))await fill(k,v);await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#starnik-payment button')]);await page.waitForSelector('#starnik-wallet-confirm');await click('[name=authorize]');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#starnik-wallet-confirm button')]);await page.waitForSelector('[data-remove]');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/my-account/payment-methods/add"]')]);await page.waitForSelector('#starnik-payment');steps++;await page.select('[name=accountType]','Savings');for(const[k,v]of Object.entries({name:'Alex Morgan',bankName:'Test Bank',routing:'021000021',confirmRouting:'021000021',accountNumber:'1234561048',confirmAccountNumber:'1234561048',firstName:'Alex',lastName:'Morgan',address:'1 Test Street',city:'Mankato',state:'MN',zip:'56001',email:'alex@billworld.test'}))await fill(k,v);await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#starnik-payment button')]);await page.waitForSelector('#starnik-wallet-confirm');await click('[name=authorize]');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#starnik-wallet-confirm button')]);await page.waitForSelector('[data-remove="gmg-bank-2099"]');await click('[data-remove="gmg-bank-2099"]');await page.waitForFunction(()=>!document.querySelector('[data-remove="gmg-bank-2099"]'));steps++;await page.reload();await page.waitForSelector('[data-remove]');
  }
  else if(taskId==='task_c21'){
    steps++;await page.goto(base+'/RP_Default.aspx');await page.waitForSelector('#starnik-login');await fill('username','alex.morgan');await fill('password','Billworld-2026!');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#ctl04_ctl00_btnLogin')]);await page.waitForSelector('#starnik-logout');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/transaction-history"]')]);await page.waitForSelector('#starnik-history table');answer=await page.$eval('#starnik-history',root=>{const text=root.textContent,posted=text.match(/Posted balance \$([0-9]+\.[0-9]{2})/),remaining=text.match(/Remaining after pending payments \$([0-9]+\.[0-9]{2})/);let pending=0;const heading=[...root.querySelectorAll('h2')].find(e=>e.textContent==='Pending Payments');for(let p=heading.nextElementSibling;p&&p.tagName!=='H2';p=p.nextElementSibling){const match=p.textContent.match(/\$([0-9]+\.[0-9]{2})/);if(match)pending+=Math.round(Number(match[1])*100);}return{postedBalanceCents:Math.round(Number(posted[1])*100),pendingPaymentCents:pending,remainingBalanceCents:Math.round(Number(remaining[1])*100)};});
  }
  else if(['task_c19','task_c20','task_c31','task_c32'].includes(taskId)){
    await page.setViewport({width:1365,height:900});page.on('dialog',d=>d.accept());const infra=['task_c31','task_c32'].includes(taskId),kind=['task_c19','task_c31'].includes(taskId)?'bank':'card';steps++;await page.goto(base+'/billing');let guestOpened=false;for(const link of await page.$$('a[href="/starnikERP/#/rp_guestpay/rp_guestpay"]'))if(await link.evaluate(e=>e.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}))){await Promise.all([page.waitForNavigation({waitUntil:'load'}),link.click()]);guestOpened=true;break;}if(!guestOpened)throw Error('Visible guest payment link unavailable');await page.waitForSelector('#starnik-guest-lookup');await fill('securityCode',infra?'INF1048':'GMG1048');await fill('serviceZip',infra?'77001':'56001');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#starnik-guest-lookup button')]);await page.waitForSelector('#starnik-payment');steps++;await page.select('[name=kind]',kind);const values={name:'Alex Morgan',firstName:'Alex',lastName:'Morgan',address:'1 Test Street',city:'Mankato',state:'MN',zip:'56001',email:'alex@billworld.test',...(kind==='bank'?{bankName:'Test Bank',routing:'021000021',confirmRouting:'021000021',accountNumber:'1234561048',confirmAccountNumber:'1234561048'}:{cardNumber:'4242424242424242',expiry:'12/30',cvv:'123'})};for(const[k,v]of Object.entries(values))await fill(k,v);await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#starnik-payment button')]);await page.waitForSelector('#starnik-payment-confirm');await click('[name=authorize]');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#starnik-payment-confirm button')]);await page.waitForSelector('#starnik-confirmation');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/starnik/guest/account"]')]);await page.waitForSelector('#starnik-payment');
  }
  else if(['task_c18','task_c33','task_c36'].includes(taskId)){
    const securityCode=taskId==='task_c36'?'ONS1048':taskId==='task_c33'?'INF1048':'GMG1048';
    await page.setViewport({width:1365,height:900});steps++;await page.goto(base+'/RP/signup');await page.waitForSelector('#starnik-signup');for(const[name,value]of Object.entries({securityCode,email:'alex@billworld.test',confirmEmail:'alex@billworld.test'}))await fill(name,value);await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#starnik-signup button[type=submit]')]);await page.waitForSelector('#starnik-resend');await go('/mail','Sign in to Gmail');await fill('email','alex@billworld.test');await fill('password','Mailbox-2026!');await submit('mail-login','Inbox');await click('[data-testid="email-item-2"] .email-content');await page.waitForSelector('a[href^="/starnik/signup/verify?token="]');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href^="/starnik/signup/verify?token="]')]);await page.waitForSelector('#starnik-setup');await page.reload();await page.waitForSelector('#starnik-setup');await fill('username','alex.new');await click('#starnik-check-username');await page.waitForFunction(()=>document.querySelector('#starnik-username-availability').textContent==='Username is available.');await fill('password','Registered-2026!');await fill('confirmPassword','Registered-2026!');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#starnik-setup button[type=submit]')]);await page.waitForSelector('#starnik-signup-complete');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/RP_Default.aspx"]')]);await page.waitForSelector('#starnik-login');await fill('username','alex.new');await fill('password','Registered-2026!');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#ctl04_ctl00_btnLogin')]);await page.waitForSelector('#starnik-logout');
  }
  else if(['task_c17','task_c34','task_c37'].includes(taskId)){
    const username=taskId==='task_c37'?'alex.onswc':taskId==='task_c34'?'alex.inframark':'alex.morgan';
    await page.setViewport({width:1365,height:900});await go('/RP/forgot-username','Forgot username');await fill('email','alex@billworld.test');await click('#starnik-recovery button[type=submit]');await page.waitForFunction(()=>document.querySelector('#starnik-error')?.textContent.includes('sent'));
    await go('/mail','Sign in to Gmail');await fill('email','alex@billworld.test');await fill('password','Mailbox-2026!');await submit('mail-login','Inbox');await click('[data-testid="email-item-2"] .email-content');await page.waitForFunction(name=>document.body.textContent.includes('Your username is '+name),{},username);
    await go('/RP/forgot-password','Forgot password');await fill('username',username);await click('#starnik-recovery button[type=submit]');await page.waitForFunction(()=>document.querySelector('#starnik-error')?.textContent.includes('sent'));await go('/mail','Inbox');await click('[data-testid="email-item-3"] .email-content');await page.waitForSelector('a[href^="/starnik/reset?token="]');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href^="/starnik/reset?token="]')]);await page.waitForSelector('#starnik-reset');await page.reload();await page.waitForSelector('#starnik-reset');await fill('password','Restored-2026!');await fill('confirmPassword','Restored-2026!');await click('#starnik-reset button');await page.waitForSelector('#starnik-reset-success');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/RP_Default.aspx"]')]);await page.waitForSelector('#starnik-login');await fill('username',username);await fill('password','Restored-2026!');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#ctl04_ctl00_btnLogin')]);await page.waitForSelector('#starnik-logout');
  }
  else if(['task_c30','task_c35'].includes(taskId)){
    await page.setViewport({width:1365,height:900});steps++;let opened=false;for(const link of await page.$$('a[href="/RP_Default.aspx"]'))if(await link.evaluate(e=>e.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}))){await Promise.all([page.waitForNavigation({waitUntil:'load'}),link.click()]);opened=true;break;}if(!opened)throw Error('Visible Inframark portal link unavailable');await page.waitForSelector('#starnik-login');await fill('username',taskId==='task_c35'?'alex.onswc':'alex.inframark');await fill('password',taskId==='task_c35'?'ONSWC-2026!':'Inframark-2026!');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#ctl04_ctl00_btnLogin')]);await page.waitForSelector('#starnik-logout');
  }
  else if(taskId==='task_c16'){
    await page.setViewport({width:1365,height:900});const links=await page.$$('a[href="/billing"]');let opened=false;for(const link of links)if(await link.evaluate(e=>e.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}))){steps++;await Promise.all([page.waitForNavigation({waitUntil:'load'}),link.click()]);opened=true;break;}if(!opened)throw Error('Visible billing link unavailable');await page.waitForSelector('a[href="/RP_Default.aspx"]');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/RP_Default.aspx"]')]);await page.waitForSelector('#starnik-login');await fill('username','alex.morgan');await fill('password','Billworld-2026!');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#ctl04_ctl00_btnLogin')]);await page.waitForSelector('#starnik-logout');
  }

  else if(['task_c4','task_c5','task_c6','task_c8','task_c9','task_c10','task_c11','task_c12','task_c13','task_c14','task_c15'].includes(taskId)){
    await page.setViewport({width:1365,height:900});
    if(taskId==='task_c6'){
      await go('/paymentus/login','Login');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/paymentus/register"]')]);await heading('New Account Information');
      for(const[name,value]of Object.entries({email:'alex@billworld.test',password:'Billworld-New-2026!',firstName:'Alex',lastName:'Morgan',phone:'6305550148',zipCode:'60510'}))await fill(name,value);
      await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#paymentus-register button')]);await heading('Add Account');await fill('customerNumber','1001048');await fill('serviceAddressPrefix','36W123');steps++;await page.select('[name=paperless]','true');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#paymentus-link-verify button')]);await heading('Verify Account Information');await click('[name=emailNotification]');await click('[name=authorize]');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#paymentus-link-add button')]);await heading('Account Created');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/paymentus/accounts"]')]);await page.waitForSelector('#paymentus-account');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#paymentus-logout')]);
    }else if(taskId==='task_c5'){

      await go('/paymentus/recover','Please enter your e-mail address');await fill('email','alex@billworld.test');await click('#paymentus-recover button');await page.waitForFunction(()=>document.querySelector('#paymentus-message')?.textContent.includes('sent'));
      await go('/mail','Sign in to Gmail');await fill('email','alex@billworld.test');await fill('password','Mailbox-2026!');await submit('mail-login','Inbox');await click('[data-testid="email-item-2"] .email-content');await page.waitForSelector('a[href^="/paymentus/reset?token="]');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href^="/paymentus/reset?token="]')]);await page.waitForSelector('#paymentus-reset');await page.reload();await page.waitForSelector('#paymentus-reset');await fill('password','Restored-2026!');await fill('confirmPassword','Restored-2026!');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#paymentus-reset button')]);
    }else await go('/paymentus/login','Login');
    await page.waitForSelector('#paymentus-login');await fill('email','alex@billworld.test');await fill('password',taskId==='task_c5'?'Restored-2026!':taskId==='task_c6'?'Billworld-New-2026!':'Billworld-2026!');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#paymentus-login button')]);await page.waitForSelector('#paymentus-account');
    if(taskId==='task_c11'){
      await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/paymentus/preferences?accountId=acct-primary"]')]);await page.waitForSelector('#paymentus-preferences');await click('[name=paperless]');await click('[name=emailNotification]');await click('#paymentus-preferences button');await page.waitForFunction(()=>document.querySelector('#paymentus-preferences-status')?.textContent==='Settings saved');await page.reload();await page.waitForSelector('#paymentus-preferences');
    }
    if(['task_c14','task_c15'].includes(taskId)){
      await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/paymentus/autopay?accountId=acct-primary"]')]);await page.waitForSelector('#paymentus-autopay');steps++;await page.select('[name=enabled]',taskId==='task_c14'?'true':'false');if(taskId==='task_c14'){steps++;await page.select('[name=methodId]','bank-1048');}
      await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#paymentus-autopay button')]);await page.waitForSelector('#paymentus-autopay-confirm');await page.reload();await page.waitForSelector('#paymentus-autopay-confirm');if(taskId==='task_c14')await click('[name=acknowledgeCityDraft]');await click('[name=authorize]');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#paymentus-autopay-confirm button')]);await page.waitForSelector('#paymentus-autopay-confirmation');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/paymentus/autopay?accountId=acct-primary"]')]);await page.waitForSelector('#paymentus-autopay-status');
    }
    if(taskId==='task_c13'){
      await go('/paymentus/wallet','My Wallet');await go('/paymentus/wallet/edit?methodId=card-4242','Edit Payment Method');await fill('expiry','12/31');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#paymentus-wallet-change button')]);
      await go('/paymentus/wallet/add','Add Payment Method');for(const[name,value]of Object.entries({name:'Alex Morgan',cardNumber:'5555555555554444',expiry:'12/29',cvv:'123'}))await fill(name,value);await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#paymentus-wallet-add button')]);
      await go('/paymentus/wallet/remove?methodId=bank-1048','Remove Payment Method');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#paymentus-wallet-change button')]);await page.waitForSelector('#paymentus-wallet');await page.reload();await page.waitForSelector('#paymentus-wallet');
    }
    if(taskId==='task_c12'){
      const downloadPath=resolve(artifacts,'downloads');mkdirSync(downloadPath,{recursive:true});
      const cdp=await browser.target().createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath,eventsEnabled:true});
      let begun,timer;
      const complete=new Promise((resolve,reject)=>{
        timer=setTimeout(()=>reject(Error('Statement download timed out')),60000);
        cdp.on('Browser.downloadWillBegin',event=>{begun=event;});
        cdp.on('Browser.downloadProgress',event=>{if(event.guid===begun?.guid){if(event.state==='completed')resolve(event);if(event.state==='canceled')reject(Error('Statement download canceled'));}});
      });
      try{
        const [,finished]=await Promise.all([click('a[href="/api/paymentus/statement?invoiceId=inv-current"]'),complete]);
        if(!/^[a-f0-9-]+$/.test(begun.guid))throw Error('Unexpected browser download identifier');
        const bytes=readFileSync(resolve(downloadPath,begun.guid));if(bytes.subarray(0,5).toString()!=='%PDF-'||bytes.length!==finished.receivedBytes)throw Error('Incomplete PDF download');
        answer={statementFilename:begun.suggestedFilename};writeFileSync(resolve(artifacts,'download.json'),JSON.stringify({...answer,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,completed:true},null,2));
      }finally{clearTimeout(timer);await cdp.detach();}
    }
    if(['task_c8','task_c9','task_c10'].includes(taskId)){
      await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/paymentus/bills"]')]);await page.waitForSelector('#paymentus-bills');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/paymentus/pay?invoiceId=inv-current"]')]);await page.waitForSelector('#paymentus-payment');
      if(taskId==='task_c9'){steps++;await page.select('[name=kind]','card');}
      for(const[name,value]of Object.entries(taskId==='task_c9'?{name:'Alex Morgan',cardNumber:'4242424242424242',expiry:'12/29',cvv:'123'}:{name:'Alex Morgan',routing:'021000021',accountNumber:'000001048',confirmAccountNumber:'000001048'}))await fill(name,value);
      await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#paymentus-payment button')]);await page.waitForSelector('#paymentus-pay');await page.reload();await page.waitForSelector('#paymentus-pay');await click('[name=authorize]');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#paymentus-pay button')]);await page.waitForSelector('#confirmation');await page.reload();await page.waitForSelector('#confirmation');answer={confirmation:await page.$eval('#confirmation',e=>e.textContent)};
      if(taskId==='task_c10'){await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/paymentus/history"]')]);await page.waitForSelector('#paymentus-history');await page.reload();await page.waitForSelector('#paymentus-history');}
    }
  }else if(['task_c1','task_c2','task_c3','task_c7'].includes(taskId)){

    await page.setViewport({width:1365,height:900});
    if(taskId==='task_c7'){
      await page.goto(base+'/Account/Registration');await page.waitForSelector('#cusi-registration-lookup');if(await page.$('.lockwood-cookie-reference'))await click('.lockwood-cookie-buttons button:first-child');await fill('accountNumber','1001048');await fill('phone','4175550148');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#submit')]);await page.waitForSelector('#cusi-registration-verify');await click('label:has([name=confirmAccount]) span');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#cusi-registration-verify button')]);await page.waitForSelector('#cusi-registration-user');for(const[name,value]of Object.entries({email:'alex@billworld.test',username:'alex.new',password:'Registered-2026!',confirmPassword:'Registered-2026!'}))await fill(name,value);await click('label:has([name=consent]) span');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#cusi-registration-user button')]);await page.waitForSelector('#cusi-registration-complete');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a.btn[href="/Account/Login"]')]);
    }else if(taskId==='task_c2'){
      steps++;await page.goto(base+'/Account/ForgotPassword');await page.waitForFunction(()=>!document.querySelector('#Username')?.disabled);await fill('username','alex.morgan');await click('#btn-email');await page.waitForFunction(()=>!document.querySelector('#btn-email').disabled&&document.querySelector('.cusi-error')?.textContent.includes('enrolled'));
      await go('/mail','Sign in to Gmail');await fill('email','alex@billworld.test');await fill('password','Mailbox-2026!');await submit('mail-login','Inbox');await click('[data-testid="email-item-2"] .email-content');await page.waitForSelector('a[href^="/Account/ResetPassword?token="]');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href^="/Account/ResetPassword?token="]')]);await page.waitForSelector('#cusi-reset');await page.reload();await page.waitForSelector('#cusi-reset');await fill('password','Restored-2026!');await fill('confirmPassword','Restored-2026!');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#cusi-reset button')]);
    }else{await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/Account/Login"]')]);}
    await page.waitForFunction(()=>!document.querySelector('#Username')?.disabled);await fill('username',taskId==='task_c7'?'alex.new':'alex.morgan');await fill('password',taskId==='task_c2'?'Restored-2026!':taskId==='task_c7'?'Registered-2026!':'Billworld-2026!');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#btn-login')]);await page.waitForSelector('#cusi-username');
    if(taskId==='task_c3'){
      await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('.cusi-current-bill[href$="inv-current"]')]);await page.waitForSelector('#cusi-balance');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href^="/Account/Payment?"]')]);await page.waitForSelector('#cusi-payment');for(const[name,value]of Object.entries({name:'Alex Morgan',cardNumber:'4242424242424242',expiry:'12/29',cvv:'123'}))await fill(name,value);await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#cusi-payment button')]);await page.waitForSelector('#cusi-confirm');await page.reload();await page.waitForSelector('#cusi-confirm');await click('[name=authorize]');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#cusi-confirm button')]);await page.waitForSelector('#cusi-confirmation');answer={confirmation:await page.$eval('#cusi-confirmation',e=>e.textContent)};
    }
  }else if(['task_h18','task_h19'].includes(taskId)){
    await page.setViewport({width:1365,height:900});await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/personapay/login"]')]);await page.waitForFunction(()=>!document.querySelector('#Validation1-4')?.disabled);
    await fill('accountNumber','123001048');await fill('zipCode','56007');await fill('dateOfBirth','04/12/1985');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#rs-loading-button')]);await page.waitForSelector('#dental-payment');
    await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/personapay/plan"]')]);await page.waitForSelector('#dental-plan');
    const future=taskId==='task_h19';steps++;await page.select('[name=type]',future?'future':'recurring');await fill('amount',future?'100.00':'209.32');steps++;await page.$eval('[name=firstDate]',(e,v)=>{e.value=v;},future?'2026-10-07':'2026-10-10');
    await fill('routing','021000021');await fill('accountNumber','000001048');await fill('confirmAccountNumber','000001048');
    await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#dental-plan button')]);await page.waitForSelector('#plan-authorization');await page.reload();await page.waitForSelector('#plan-authorization');await click('[name=authorize]');
    await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#plan-authorization button')]);await page.waitForSelector('.plan-confirmation');answer={confirmation:await page.$eval('.plan-confirmation',e=>e.textContent)};
  }else if(['task_m12','task_h16','task_h17'].includes(taskId)){
    await page.setViewport({width:1365,height:900});await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('a[href="/personapay/login"]')]);await page.waitForFunction(()=>!document.querySelector('#Validation1-4')?.disabled);
    await fill('accountNumber','123001048');await fill('zipCode','56007');await fill('dateOfBirth','04/12/1985');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#rs-loading-button')]);await page.waitForSelector('#dental-payment');
    if(taskId==='task_h16'){await fill('amount','100.00');steps+=2;await page.locator('[data-allocation=inv-current]').fill('80.00');await page.locator('[data-allocation=inv-second]').fill('20.00');}
    if(taskId==='task_h17'){await fill('amount','300.00');steps++;await page.select('[name=kind]','card');await fill('cardNumber','4242424242424242');await fill('expiry','12/29');await fill('cvv','123');}
    else{await fill('routing','021000021');await fill('accountNumber','000001048');await fill('confirmAccountNumber','000001048');}
    await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#dental-payment button')]);await page.waitForSelector('#dental-pay');await Promise.all([page.waitForNavigation({waitUntil:'load'}),click('#dental-pay')]);await page.waitForSelector('#confirmation');await page.reload();await page.waitForSelector('#confirmation');answer={confirmation:await page.$eval('#confirmation',e=>e.textContent)};
  }else if(taskId==='task_h15'){
    const link=async href=>{for(const a of await page.$$(`a[href="${href}"]`)){if(await a.evaluate(e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))){steps++;await Promise.all([page.waitForNavigation({waitUntil:'load'}),a.click()]);return;}}throw Error('Missing visible link '+href);};
    await link('/MyChart/Authentication/Login');await link('/MyChart/app/account-recovery/recovery-choice');await link('/MyChart/app/account-recovery');await fill('contact','alex@billworld.test');await click('.submitButton');await page.waitForSelector('#recovery-code');await page.reload();await page.waitForSelector('#recovery-code');
    const mail=await browser.newPage();await mail.goto(base+'/mail');await mail.locator('[name=email]').fill('alex@billworld.test');await mail.locator('[name=password]').fill('Mailbox-2026!');await mail.locator('form[data-action="mail-login"] button').click();await mail.locator('[data-testid="email-item-2"] .email-content').click();await mail.waitForSelector('[data-testid="message-body-2"]');const code=(await mail.$eval('[data-testid="message-body-2"]',e=>e.textContent)).match(/code is (\d{6})/)[1];await page.bringToFront();await fill('code',code);await click('#recovery-code button');await page.waitForSelector('#recovery-password');await page.reload();await page.waitForSelector('#recovery-password');await fill('password','Restored-2026!');await fill('confirmPassword','Restored-2026!');await click('#recovery-password button');await page.waitForSelector('#username');await fill('username','alex.morgan');await click('#username button');await fill('password','Restored-2026!');await click('#password button');await page.waitForSelector('[data-visit="inv-current"]');answer={};await mail.close();
  }else
  if(['task_m11','task_h12','task_h13','task_h14'].includes(taskId)){
    const visibleLink=async href=>{for(const a of await page.$$(`a[href="${href}"]`)){if(await a.evaluate(e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))){steps++;await Promise.all([page.waitForNavigation({waitUntil:'load'}),a.click()]);return;}}throw Error('No visible link '+href);};
    if(taskId==='task_m11'){await visibleLink('/billing');await visibleLink('/MyChart/billing/guestpay');await fill('accountNumber','100104801');await fill('lastName','Morgan');await click('[name=captcha]');await click('#lookup button');}
    else{await visibleLink('/MyChart/Authentication/Login');
      if(taskId==='task_h14'){
        await visibleLink('/MyChart/app/activation');await page.waitForSelector('#activation-code');const mail=await browser.newPage();await mail.goto(base+'/mail');await mail.locator('[name=email]').fill('alex@billworld.test');await mail.locator('[name=password]').fill('Mailbox-2026!');await mail.locator('form[data-action="mail-login"] button').click();await mail.locator('[data-testid="email-item-2"] .email-content').click();await mail.waitForSelector('[data-testid="message-body-2"]');const code=(await mail.$eval('[data-testid="message-body-2"]',e=>e.textContent)).match(/code is ([A-Z0-9]{5})-([A-Z0-9]{5})/).slice(1);await page.bringToFront();await fill('part1',code[0]);await fill('part2',code[1]);await click('#activation-code button');await page.waitForSelector('#activation-setup');await page.reload();await page.waitForSelector('#activation-setup');await fill('username','alex.morgan');await fill('password','Billworld-New-2026!');await fill('confirmPassword','Billworld-New-2026!');await click('#activation-setup button');await page.waitForSelector('#username');await mail.close();
      }
      await fill('username','alex.morgan');await click('#username button');await fill('password',taskId==='task_h14'?'Billworld-New-2026!':'Billworld-2026!');await click('#password button');if(taskId==='task_h13'){await page.waitForSelector('[name=code]');const mail=await browser.newPage();await mail.goto(base+'/mail');await mail.locator('[name=email]').fill('alex@billworld.test');await mail.locator('[name=password]').fill('Mailbox-2026!');await mail.locator('form[data-action="mail-login"] button').click();await mail.locator('[data-testid="email-item-2"] .email-content').click();await mail.waitForSelector('[data-testid="message-body-2"]');const code=(await mail.$eval('[data-testid="message-body-2"]',e=>e.textContent)).match(/code is (\d{6})/)[1];await page.bringToFront();await fill('code',code);await click('#otp button');await mail.close();}}
    await click('[data-visit="inv-current"]');await fill('name','Alex Morgan');await fill('routing','021000021');await fill('accountNumber','000001048');await click('#payment button');await click('#pay button');await page.waitForSelector('#confirmation');await page.reload();await page.waitForSelector('#confirmation');answer={confirmation:await page.$eval('#confirmation',e=>e.textContent)};
  }else if(taskId==='task_m10'){
    await heading('Town of Swepsonville');if(await page.$('[data-accept-cookies]'))await click('[data-accept-cookies]');await municipalLink('/site');await heading('Pay your bill');if(await page.$('[data-accept-cookies]')){await click('[data-accept-cookies]');await page.waitForFunction(()=>!document.querySelector('[data-accept-cookies]'));}await click('a[href="/invoicecloud"]');await heading('Pay or View Bills');await click('a[href="/invoicecloud/deposits"]');await heading('Deposits');
    for(const [name,value]of Object.entries({depositAccountNumber:'1048-1',customerName:'Alex Morgan',serviceAddress:'1048 River Road, Graham, NC 27253',depositAmount:'150.00'}))await fill(name,value);
    await submit('authority-deposit-confirm','Confirm Your Information');await page.reload();await heading('Confirm Your Information');await click('a[href="/invoicecloud/deposits/payment"]');await heading('Deposit Payment Information');for(const[name,value]of Object.entries({name:'Alex Morgan',routing:'021000021',accountNumber:'000001048'}))await fill(name,value);await submit('authority-deposit-quote','Review Deposit Payment');await page.reload();await heading('Review Deposit Payment');await submit('authority-deposit-pay','Deposit Payment Confirmation');await page.reload();await heading('Deposit Payment Confirmation');answer={confirmation:await page.$eval('#confirmation',e=>e.textContent)};
  }else if(taskId==='task_m9'){
    await heading('Town of Swepsonville');await municipalLink('/bank-draft');await heading('BANK DRAFT FORM');
    for(const [name,value] of Object.entries({customerNumber:'1001048',customerName:'Alex Morgan',serviceAddress:'1048 River Road, Graham, NC 27253',bankName:'Billworld Test Bank',routing:'021000021',accountNumber:'000001048',phone:'3365550148',email:'alex@billworld.test',signature:'Alex Morgan',date:'10/03/2026'}))await fill(name,value);
    await click('[name="accountType"][value="checking"]');await click('[name="creditReportConsent"]');await submit('authority-bank-draft','Bank Draft Request Submitted');await page.reload();await heading('Bank Draft Request Submitted');answer={confirmation:await page.$eval('#confirmation',e=>e.textContent)};
  }else if(['task_m8','task_h10','task_h11'].includes(taskId)){
    await heading('Town of Swepsonville');
    if(await page.$('[data-accept-cookies]')){await click('[data-accept-cookies]');await page.waitForFunction(()=>!document.querySelector('[data-accept-cookies]'));}
    await municipalLink('/site');await heading('Pay your bill');if(await page.$('[data-accept-cookies]')){await click('[data-accept-cookies]');await page.waitForFunction(()=>!document.querySelector('[data-accept-cookies]'));}
    if(taskId==='task_h10'){
      await click('a[href="/site/register"]');await heading('Create an Account');
      for(const [name,value] of Object.entries({firstName:'Alex',lastName:'Morgan',customerNumber:'1001048',cid:'C1048',email:'alex@billworld.test',confirmEmail:'alex@billworld.test',password:'Registered-2026!',confirmPassword:'Registered-2026!'}))await fill(name,value);
      await submit('authority-register','Account Created');await click('a[href="/site/login"]');await heading('Pay your bill');await fill('email','alex@billworld.test');await fill('password','Registered-2026!');await submit('authority-login','My Account');
    }else if(taskId==='task_h11'){
      await go('/site/request-password-reset','Forgot Your Password?');await fill('email','alex@billworld.test');await submit('authority-recover');await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('sent'));
      await go('/mail','Sign in to Gmail');await fill('email','alex@billworld.test');await fill('password','Mailbox-2026!');await submit('mail-login','Inbox');await click('[data-testid="email-item-2"] .email-content');await click('a[href^="/portal/reset?token="]');await heading('Reset Your Password');await fill('password','Restored-2026!');await fill('confirmPassword','Restored-2026!');await submit('authority-reset','Pay your bill');await fill('email','alex@billworld.test');await fill('password','Restored-2026!');await submit('authority-login','My Account');
    }else{
      await click('a[href="/invoicecloud"]');await heading('Pay or View Bills');await click('a[href="/invoicecloud/customerlocator"]');await heading('Please Locate Your Account');await fill('customerNumber','1001048');await fill('lastName','Morgan');await submit('authority-lookup','Search Results');await page.reload();await heading('Search Results');await click('a[href="/invoicecloud/payment?invoice=inv-current"]');await heading('Payment Information');for(const [name,value]of Object.entries({name:'Alex Morgan',routing:'021000021',accountNumber:'000001048'}))await fill(name,value);await submit('authority-quote','Review Payment');await submit('authority-pay','Payment Confirmation');answer={confirmation:await page.$eval('#confirmation',e=>e.textContent)};
    }
  }else if(['task_m6','task_h9','task_m7'].includes(taskId)){
    if(taskId==='task_h9'){
      await go('/smarthub/ui/#/registration','ACCOUNT REGISTRATION');for(const [name,value] of Object.entries({customerNumber:'1001048',lastName:'Morgan',email:'alex@billworld.test',confirmEmail:'alex@billworld.test'}))await fill(name,value);await submit('hub-registration-start','VERIFY ACCOUNT DETAILS');await fill('verificationAmount','84.32');await submit('hub-registration-finish','REGISTRATION COMPLETE');
      await go('/mail','Sign in to Gmail');await fill('email','alex@billworld.test');await fill('password','Mailbox-2026!');await submit('mail-login','Inbox');await click('[data-testid="email-item-2"] .email-content');await page.waitForSelector('[data-testid="message-body-2"]');const temporary=(await page.$eval('[data-testid="message-body-2"]',e=>e.textContent)).match(/password is (\S+)\./)[1];await go('/smarthub/ui/#/login','Grand Valley Power SmartHub');await fill('email','alex@billworld.test');await fill('password',temporary);await submit('hub-login','CHANGE PASSWORD');await fill('password','Registered-2026!');await fill('confirmPassword','Registered-2026!');await submit('hub-first-password','HOME');
    }else{await go('/smarthub/ui/#/login','Grand Valley Power SmartHub');await fill('email','alex@billworld.test');await fill('password','Billworld-2026!');await submit('hub-login','HOME');}
    if(taskId==='task_m7'){await go('/smarthub/ui/#/autoPay','AUTO PAY');await page.select('[name="enabled"]','yes');await page.select('[name="methodId"]','bank-1048');await submit('hub-autopay');await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('saved'));}
    else {await go('/smarthub/ui/#/makeAPayment','MAKE A PAYMENT');await page.waitForSelector('[name="methodId"] option[value="bank-1048"]');await page.select('[name="methodId"]','bank-1048');await page.waitForFunction(()=>document.querySelector('[name="methodId"]')?.value==='bank-1048');await submit('hub-quote','REVIEW PAYMENT');await submit('hub-pay','PAYMENT CONFIRMATION');answer={confirmation:await page.$eval('#confirmation',e=>e.textContent)};}
  }else if (taskId==='task_h8') {
    await go('/identity/login','Sign in to community access services for City of Duluth.'); await fill('email','alex@billworld.test'); await submit('duluth-email','Verify with your password'); await fill('password','Billworld-2026!'); await submit('duluth-login','Utility Account');
    await go('/utility/method/edit?id=card-4242','Edit Payment Method'); await fill('expiry','12/31'); await submit('duluth-wallet-edit','Payment Information');
    await click('a[href="/utility/method/add"]'); await heading('Add Payment Method');
    for(const [name,value] of Object.entries({name:'Alex Morgan',cardNumber:'5555555555554444',expiry:'12/29',cvv:'123'})) await fill(name,value);
    await submit('duluth-wallet-save','Payment Information'); await click('.wallet-list article:last-child form button'); await heading('Payment Information');
    await page.waitForFunction(()=>document.querySelector('.wallet-list article:last-child')?.textContent.includes('Default payment method'));
    await go('/utility/method/remove?id=bank-1048','Remove Payment Method'); await submit('duluth-wallet-remove','Payment Information');
  } else if (['task_m5','task_h6','task_h7'].includes(taskId)) {
    if (taskId==='task_h6') {
      await go('/identity/register','Create an account');
      for (const [name,value] of Object.entries({email:'alex@billworld.test',firstName:'Alex',lastName:'Morgan',password:'Billworld-2026!'})) await fill(name,value);
      await submit('duluth-register','Set up security methods'); await click('a[href="/identity/verify-email"]'); await heading('Verify your email');
      await go('/mail','Sign in to Gmail'); await fill('email','alex@billworld.test'); await fill('password','Mailbox-2026!'); await submit('mail-login','Inbox');
      await click('[data-testid="email-item-2"] .email-content'); await page.waitForSelector('[data-testid="message-body-2"]');
      const code=(await page.$eval('[data-testid="message-body-2"]',e=>e.textContent)).match(/code is (\d{6})/)[1];
      await go('/identity/verify-email','Verify your email'); await fill('code',code); await submit('duluth-verify-email',"Let's find your account");
      await fill('customerNumber','100001048-001'); await fill('fullName','Alex Morgan'); await submit('duluth-link-lookup','Add Account'); await click('[name="paperless"]'); await submit('duluth-link','Utility Account');
    } else {
      await go('/identity/login','Sign in to community access services for City of Duluth.');
      if (taskId==='task_h7') {
        await click('[data-google]'); await heading('Choose an account'); await click('[data-sub="google-alex"]'); await heading('Welcome'); await fill('password','Google-2026!'); await click('#login button'); await heading('ComfortSystems wants access to your Google Account'); await click('[data-consent="yes"]'); await heading('Utility Account');
      } else { await fill('email','alex@billworld.test'); await submit('duluth-email','Verify with your password'); await fill('password','Billworld-2026!'); await submit('duluth-login','Utility Account'); }
    }
    await go('/utility/pay','Utility Account'); await page.select('[name="invoiceId"]','inv-current'); await fill('amount','84.32'); await submit('duluth-select','Enter your payment information'); await submit('duluth-quote','Review your payment'); await submit('duluth-pay','Payment confirmation'); answer={confirmation:await page.$eval('#confirmation',e=>e.textContent)};
  } else if (['task_m4', 'task_h5'].includes(taskId)) {
    if (taskId === 'task_h5') {
      await go('/xpress/register', 'CREATE ACCOUNT');
      for (const [name, value] of Object.entries({email:'alex@billworld.test',password:'Billworld-2026!',confirmPassword:'Billworld-2026!',firstName:'Alex',lastName:'Morgan',phone:'9075550148',address:'1048 Harbor Way',city:'Homer',postalCode:'99603'})) await fill(name,value);
      await page.select('[name="region"]','AK'); await click('[name="acceptTerms"]'); await submit('xpress-register','Just One More Step');
      await go('/mail','Sign in to Gmail'); await fill('email','alex@billworld.test'); await fill('password','Mailbox-2026!'); await submit('mail-login','Inbox'); await click('[data-testid="email-item-3"] .email-content'); await click('a[href^="/xpress/verify-email?token="]'); await heading('Email Verified');
      await go('/xpress/login','LOGIN TO PAY YOUR BILLS ONLINE'); await fill('email','alex@billworld.test'); await fill('password','Billworld-2026!'); await submit('xpress-login','Add New Account');
      await fill('organization','Homer'); await submit('xpress-organization'); await click('.xpress-org'); await heading('Add New Account'); await fill('customerNumber','1001048'); await fill('lastName','Morgan'); await submit('xpress-lookup','Confirm Account'); await click('[name="paperless"]'); await submit('xpress-link','Account Added'); await go('/xpress/accounts','My Accounts');
    } else {
      await go('/xpress/login','LOGIN TO PAY YOUR BILLS ONLINE'); await fill('email','alex@billworld.test'); await fill('password','Billworld-2026!'); await submit('xpress-login','My Accounts');
    }
    await click('[data-invoice="inv-current"]'); await heading('Bill Cart'); await submit('xpress-cart','Checkout'); await submit('xpress-quote','Review and Confirm'); await submit('xpress-pay','SUCCESS!'); answer={confirmation:await page.$eval('#confirmation',el=>el.textContent)};
  } else if (taskId === 'task_m3') {
    await go('/smarthub/ui/#/login', 'Alaska Village SmartHub'); await fill('email', 'alex@billworld.test'); await fill('password', 'Billworld-2026!');
    await submit('hub-login', 'HOME'); await go('/smarthub/ui/#/makeAPayment', 'MAKE A PAYMENT');
    await page.waitForSelector('[name="methodId"] option[value="bank-1048"]');await page.select('[name="methodId"]', 'bank-1048');await page.waitForFunction(()=>document.querySelector('[name="methodId"]').value==='bank-1048'); await submit('hub-quote', 'REVIEW PAYMENT');
    await submit('hub-pay', 'PAYMENT CONFIRMATION'); answer = { confirmation: await page.$eval('#confirmation', el => el.textContent) };
  } else if (taskId === 'task_h2') {
    await go('/spotify/login', 'Welcome back'); await click('[data-google]'); await heading('Choose an account');
    await click('[data-sub="google-alex"]'); await heading('Welcome'); await fill('password', 'Google-2026!');
    await click('#login button'); await heading('Spotify wants access to your Google Account');
    await click('[data-consent="yes"]'); await heading('Account overview');
    await click('a[href="/spotify/payment-methods"]'); await heading('Payment methods');
    await click('a[href="/spotify/payment"]'); await heading('Change payment method');
    for (const [key, value] of Object.entries({ name: 'Alex Morgan', number: '5555555555554444', expiry: '12/29', cvv: '123' })) await fill(key, value);
    await submit('spotify-card', 'Payment methods');
    await go('/spotify/account', 'Account overview');
    const text = await page.$eval('main', el => el.textContent);
    answer = { billingDate: text.match(/\d{4}-\d{2}-\d{2}/)[0] };
  } else if (taskId === 'task_h4') {
    await go('/portal/forgot', 'Reset your password'); await fill('email', 'alex@billworld.test'); await submit('forgot');
    await page.waitForFunction(() => document.querySelector('#reset-notice')?.textContent.includes('sent'));
    await go('/mail', 'Sign in to Gmail'); await fill('email', 'alex@billworld.test'); await fill('password', 'Mailbox-2026!');
    await submit('mail-login', 'Inbox'); await click('[data-testid="email-item-3"] .email-content');
    await click('a[href^="/portal/reset?token="]'); await heading('Choose a new password');
    await fill('password', 'Restored-2026!'); await fill('confirmPassword', 'Restored-2026!'); await submit('reset', 'Sign In');
    await fill('email', 'alex@billworld.test'); await fill('password', 'Restored-2026!'); await submit('login', 'Your Account At A Glance');
  } else {
    await go('/portal/login', 'Sign In'); await fill('email', 'alex@billworld.test'); await fill('password', 'Billworld-2026!');
    if (taskId === 'task_h3') {
      await submit('login', 'Verify your sign-in');
      const mailbox = await browser.newPage(); await mailbox.goto(base + '/mail');
      await mailbox.locator('[name="email"]').fill('alex@billworld.test'); await mailbox.locator('[name="password"]').fill('Mailbox-2026!');
      await mailbox.locator('form[data-action="mail-login"] button').click();
      await mailbox.locator('[data-testid="email-item-3"] .email-content').click();
      await mailbox.waitForSelector('[data-testid="message-body-3"]');
      const code = (await mailbox.$eval('[data-testid="message-body-3"]', el => el.textContent)).match(/code is (\d{6})/)[1];
      await mailbox.close(); await page.bringToFront(); await fill('code', code); await submit('verify', 'Your Account At A Glance');
    } else await submit('login', 'Your Account At A Glance');
    if (taskId === 'task_m2') {
      await go('/portal/autopay', 'AutoPay'); await click('[name="enabled"][value="yes"]');
      await page.select('select[name="methodId"]', 'bank-1048'); await submit('autopay');
      await page.waitForFunction(() => document.querySelector('#autopay-notice')?.textContent.includes('saved'));
    } else {
      await click('[name="invoice"][value="inv-current"]'); await submit('select', 'Review your selection');
      await click('a[href="/portal/method"]'); await heading('Choose payment method'); await submit('method', 'Payment Information');
      await page.select('select[name="methodId"]', 'bank-1048'); await submit('quote', 'Review Payment');
      if (taskId === 'task_h1') {
        await fill('date', '2026-10-15'); await submit('schedule', 'Scheduled payments');
        answer = { scheduledDate: (await page.$eval('main', el => el.textContent)).match(/2026-10-15/)[0] };
      } else {
        await submit('pay', 'Payment confirmation'); answer = { confirmation: await page.$eval('#confirmation', el => el.textContent) };
      }
    }
  }
  if (errors.length) throw new Error(errors.join('; '));
  await page.screenshot({ path: resolve(artifacts, 'final.png'), fullPage: true });
  writeFileSync(resolve(artifacts, 'reference.json'), JSON.stringify({ kind: 'reference_script', browserMode, browserVersion, steps, answer, errors }, null, 2));
  process.stdout.write(JSON.stringify({ steps, answer, errors }));
} catch(error) {
  await page.screenshot({path:resolve(artifacts,'failure.png'),fullPage:true}).catch(()=>{});
  writeFileSync(resolve(artifacts,'failure.json'),JSON.stringify({error:error.message,steps,path:new URL(page.url()).pathname,errors},null,2));
  throw error;
} finally { await browser.close(); }
