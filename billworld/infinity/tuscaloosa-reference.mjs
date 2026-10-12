// Scripted Puppeteer reference for the City of Tuscaloosa tasks. One tab, visible UI controls only.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

export const TUSCALOOSA_REFERENCE_TASKS = {task_tus1: 'pay', task_tus2: 'guest', task_tus3: 'register', task_tus4: 'recovery', task_tus5: 'schedule', task_tus6: 'autopay', task_tus7: 'ebill', task_tus8: 'statement'};

export async function tuscaloosaReference({page, browser, taskId, base, artifacts}) {
  let steps = 0;
  const flow = TUSCALOOSA_REFERENCE_TASKS[taskId]; if (!flow) throw Error('Unknown Tuscaloosa reference task');
  const heading = text => page.waitForFunction(t => document.querySelector('h1')?.textContent === t, {}, text);
  const fill = async (name, value, scope = '') => { steps++; await page.locator(`${scope} [name="${name}"]`.trim()).fill(value, {typingThreshold: 0}); };
  const check = async selector => { steps++; await page.locator(selector).click(); };
  const nav = async (selector, title) => { steps++; await Promise.all([page.waitForNavigation({waitUntil: 'load'}), page.locator(selector).click()]); if (title) await heading(title); };
  const submit = (action, title) => nav(`form[data-action="${action}"] button[type=submit]`, title);
  const open = async (path, title) => { steps++; await page.goto(base + path); await heading(title); };
  const login = async (password = 'Billworld-2026!') => {
    await nav('a[href="/pay-water-bill"].btn', 'Login');
    await fill('email', 'alex@billworld.test'); await fill('password', password); await submit('login', 'My Accounts');
  };
  await page.setViewport({width: 1280, height: 900});
  await heading('City of Tuscaloosa');
  let answer = {};
  if (flow === 'pay') {
    await login();
    await nav('a[aria-label="Pay Now for account 2048106"]', 'Make a Payment');
    await check('[name=methodChoice][value="saved:bank-1048"]');
    await submit('pay', 'Review Payment'); await check('[name=authorize]'); await submit('submit-payment', 'Payment Confirmation');
    answer = {confirmation: await page.$eval('#confirmation', e => e.textContent.trim())};
  } else if (flow === 'guest') {
    await nav('a[href="/pay-water-bill"].btn', 'Login'); await nav('a[href="/cp/tusl/guest"]', 'Make a One-Time Payment');
    await fill('accountNumber', '2048106'); await fill('customerNumber', '1001048'); await submit('guest', 'Make a One-Time Payment'); await page.waitForSelector('form[data-action="guest-pay"]');
    await check('[name=amountChoice][value=other]'); await fill('otherAmount', '50.00'); await check('[name=methodChoice][value=new-card]');
    for (const [k, v] of Object.entries({cardName: 'Alex Morgan', cardNumber: '4111111111111111', expiry: '11/28', cvv: '321', zipCode: '35401', email: 'alex@billworld.test'})) await fill(k, v);
    await submit('guest-pay', 'Review Payment'); await check('[name=authorize]'); await submit('submit-payment', 'Payment Confirmation');
    answer = {confirmation: await page.$eval('#confirmation', e => e.textContent.trim())};
  } else if (flow === 'register') {
    await nav('a[href="/ach"]', 'Auto Bill Payment'); await nav('a[href="/cp/tusl/register"]', 'New Account Information');
    for (const [k, v] of Object.entries({email: 'alex@billworld.test', confirmEmail: 'alex@billworld.test', password: 'Tusc-Water-2026', confirmPassword: 'Tusc-Water-2026', firstName: 'Alex', lastName: 'Morgan', phone: '205-555-0148', zipCode: '35401'})) await fill(k, v);
    await check('[name=acceptTerms]'); await submit('register', 'Add Account');
    await fill('accountNumber', '2048106'); await fill('customerNumber', '1001048'); await submit('link', 'Verify Account');
    await check('[name=acceptTerms]'); await submit('link-confirm', 'Account Added');
    await nav('a[href="/cp/tusl/autopay/setup?account=svc-home"]', 'Set Up AutoPay');
    await nav('a[href^="/cp/tusl/wallet/add?return="]', 'Add Payment Method');
    for (const [k, v] of Object.entries({bankName: 'Alex Morgan', routing: '021000021', accountNumber: '000001048', confirmAccountNumber: '000001048'})) await fill(k, v);
    await submit('wallet-add', 'Set Up AutoPay'); await page.waitForSelector('form[data-action="autopay"] [name=methodId]:checked');
    await submit('autopay', 'Review AutoPay'); await check('[name=authorize]'); await submit('autopay-confirm', 'AutoPay Confirmation');
  } else if (flow === 'recovery') {
    await nav('a[href="/pay-water-bill"].btn', 'Login'); await nav('a[href="/cp/tusl/forgot"]', 'Forgot Password');
    await fill('email', 'alex@billworld.test'); steps++; await page.locator('form[data-action="forgot"] button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#forgot-status')?.textContent.includes('Check your email'));
    await nav('a[href="/mail"]', 'Sign in to Gmail'); await fill('email', 'alex@billworld.test'); await fill('password', 'Mailbox-2026!');
    steps++; await page.locator('form[data-action="mail-login"] button').click(); await heading('Inbox');
    await page.waitForFunction(() => [...document.querySelectorAll('a.email-open, .email-subject-text')].some(e => e.textContent.includes('Reset your City of Tuscaloosa')));
    steps++; await page.evaluate(() => [...document.querySelectorAll('a.email-open, .email-subject-text')].find(e => e.textContent.includes('Reset your City of Tuscaloosa')).click());
    await page.waitForSelector('a[href^="/cp/tusl/reset?token="]');
    await nav('a[href^="/cp/tusl/reset?token="]', 'Choose a New Password');
    await fill('password', 'Restored-Tusc-2026'); await fill('confirmPassword', 'Restored-Tusc-2026'); await submit('reset', 'Login');
    await fill('email', 'alex@billworld.test'); await fill('password', 'Restored-Tusc-2026'); await submit('login', 'My Accounts');
  } else if (flow === 'schedule') {
    await login(); await nav('nav a[href="/cp/tusl/history"]', 'Payment History');
    await check('button[data-cancel="sch-2"]'); steps++;
    await Promise.all([page.waitForNavigation({waitUntil: 'load'}), page.locator('button[data-confirm-cancel="sch-2"]').click()]); await heading('Payment History');
    await nav('a[href="/cp/tusl/history/edit?id=sch-1"]', 'Edit Scheduled Payment');
    await fill('date', '2026-10-12'); steps++; await page.select('[name=methodId]', 'bank-1048'); await submit('edit', 'Payment History');
    answer = {scheduledDate: '2026-10-12'};
  } else if (flow === 'autopay') {
    await login(); await nav('nav a[href="/cp/tusl/autopay"]', 'AutoPay');
    await nav('a[aria-label="Change AutoPay payment method for account 2048106"]', 'Change AutoPay'); await check('[name=methodId][value="bank-1048"]');
    await submit('autopay', 'Review AutoPay'); await check('[name=authorize]'); await submit('autopay-confirm', 'AutoPay Confirmation');
    await nav('a[href="/cp/tusl/autopay"].pbtn', 'AutoPay');
    await nav('a[aria-label="Cancel AutoPay for account 2048107"]', 'Cancel AutoPay'); await submit('autopay-cancel', 'Review AutoPay');
    await check('[name=authorize]'); await submit('autopay-confirm', 'AutoPay Confirmation');
  } else if (flow === 'ebill') {
    await nav('a[href="/onlineservices"]', 'Account Service Center'); await nav('a[href="/ebill"].btn', 'Useful Forms');
    for (const [k, v] of Object.entries({accountNumber: '2048106', customerNumber: '1001048', name: 'Alex Morgan', email: 'alex@billworld.test', confirmEmail: 'alex@billworld.test'})) await fill(k, v);
    await check('[name=acceptTerms]'); steps++; await page.locator('form[data-action="ebill"] button[type=submit]').click();
    await page.waitForSelector('#ebill-reference');
  } else if (flow === 'statement') {
    await login(); await nav('a[aria-label="Bill History for account 2048106"]', 'Bill History');
    const downloadPath = resolve(artifacts, 'downloads'); mkdirSync(downloadPath, {recursive: true});
    const cdp = await browser.target().createCDPSession(); await cdp.send('Browser.setDownloadBehavior', {behavior: 'allowAndName', downloadPath, eventsEnabled: true});
    let begun, timer;
    const complete = new Promise((ok, fail) => { timer = setTimeout(() => fail(Error('Statement download timed out')), 60000); cdp.on('Browser.downloadWillBegin', e => { begun = e; }); cdp.on('Browser.downloadProgress', e => { if (e.guid === begun?.guid) { if (e.state === 'completed') ok(e); if (e.state === 'canceled') fail(Error('Statement download canceled')); } }); });
    try {
      steps++; const [, done] = await Promise.all([page.locator('a[aria-label="Download PDF for bill due 09/15/2026"]').click(), complete]);
      const bytes = readFileSync(resolve(downloadPath, begun.guid)); if (bytes.subarray(0, 5).toString() !== '%PDF-' || bytes.length !== done.receivedBytes) throw Error('Incomplete PDF download');
      answer = {statementFilename: begun.suggestedFilename}; writeFileSync(resolve(artifacts, 'download.json'), JSON.stringify({...answer, bytes: bytes.length}, null, 2));
    } finally { clearTimeout(timer); await cdp.detach(); }
  }
  return {answer, steps};
}
