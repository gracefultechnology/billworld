// Scripted Puppeteer journeys for Charlotte County Utilities tasks. Used by the Infinity reference
// (infinity/reference.mjs) and by tests/charlotte-browser.mjs. These are reference scripts, not agents.
// Every journey uses one tab and only visible, labelled controls (no API shortcuts).
import {mkdirSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';

export const CHARLOTTE_INFINITY_TASKS = {
  task_ccu1: ['charlotte-quickpay-card.json', 'charlotte-quickpay-card-v1', 'medium'],
  task_ccu2: ['charlotte-register-pay.json', 'charlotte-register-link-pay-v1', 'hard'],
  task_ccu3: ['charlotte-recovery.json', 'charlotte-recover-login-v1', 'hard'],
  task_ccu4: ['charlotte-signed-pay.json', 'charlotte-signed-bank-pay-v1', 'medium'],
  task_ccu5: ['charlotte-schedule.json', 'charlotte-schedule-payment-v1', 'medium'],
  task_ccu6: ['charlotte-scheduled-update.json', 'charlotte-update-scheduled-payment-v1', 'hard'],
  task_ccu7: ['charlotte-scheduled-cancel.json', 'charlotte-cancel-scheduled-payment-v1', 'medium'],
  task_ccu8: ['charlotte-autopay-enroll.json', 'charlotte-enroll-autopay-v1', 'medium'],
  task_ccu9: ['charlotte-autopay-change.json', 'charlotte-change-autopay-method-v1', 'medium'],
  task_ccu10: ['charlotte-autopay-cancel.json', 'charlotte-cancel-autopay-v1', 'medium'],
  task_ccu11: ['charlotte-paperless.json', 'charlotte-paperless-email-v1', 'medium'],
  task_ccu12: ['charlotte-statement.json', 'charlotte-download-bill-v1', 'medium'],
  task_ccu13: ['charlotte-history.json', 'charlotte-read-payment-history-v1', 'medium']
};

export async function runCharlotteJourney({page, browser, base, taskId, artifacts}) {
  let steps = 0;
  const heading = text => page.waitForFunction(t => document.querySelector('h1')?.textContent === t, {timeout: 30000}, text);
  const fill = async (name, value) => { steps++; await page.locator(`[name="${name}"]:not([disabled])`).fill(value); };
  const click = async selector => { steps++; await page.locator(selector).click(); };
  const navigate = async selector => { steps++; await Promise.all([page.waitForNavigation({waitUntil: 'load'}), page.locator(selector).click()]); };
  const select = async (name, value) => { steps++; await page.select(`[name="${name}"]`, value); };
  const submit = async (form, title) => { await navigate(`${form} button[type=submit]`); if (title) await heading(title); };
  const text = selector => page.$eval(selector, e => e.textContent.trim());
  const openPortal = async () => {
    await page.waitForSelector('a.popular-link');
    await navigate('a.popular-link[href$="links-pay_bill/index.html"]');
    await navigate('a[href="/cp/ccfl"]::-p-text(www.charlottecountyfl.gov/Paymentus)');
    await heading('Log In');
  };
  const login = async (password = 'Billworld-2026!') => {
    await fill('email', 'alex@billworld.test'); await fill('password', password);
    await submit('#ccu-login', 'My Accounts');
  };
  const confirm = async (form, title) => { await click(`${form} [name=authorize]`); await submit(form, title); };
  let answer = {};
  await openPortal();
  if (taskId === 'charlotte-quickpay-card-v1') {
    await navigate('a[href="/cp/ccfl/quickpay"]'); await heading('Pay Without Registering');
    await fill('accountNumber', '01048-021048'); await fill('zip', '33952'); await submit('#ccu-guest-lookup', 'Payment Details');
    await select('method', 'card'); await fill('cardName', 'Alex Morgan'); await fill('cardNumber', '4242424242424242'); await fill('expiry', '12/29'); await fill('cvv', '123');
    await submit('#ccu-guest-pay', 'Review Payment');
    if (await text('#ccu-total') !== '$87.27') throw Error('Unexpected quick pay total');
    await confirm('#ccu-guest-confirm', 'Payment Confirmation');
    steps++; await page.reload(); await heading('Payment Confirmation');
    answer = {confirmation: await text('#ccu-confirmation')};
  } else if (taskId === 'charlotte-register-link-pay-v1') {
    await fill('email', 'alex@billworld.test'); await fill('password', 'Billworld-2026!'); await click('#ccu-login button[type=submit]');
    await page.waitForFunction(() => /Register Now/.test(document.querySelector('#ccu-login .error')?.textContent || ''));
    await navigate('a[href="/cp/ccfl/register"]'); await heading('Create Your Profile');
    for (const [k, v] of [['email', 'alex@billworld.test'], ['confirmEmail', 'alex@billworld.test'], ['password', 'Charlotte-2026!'], ['confirmPassword', 'Charlotte-2026!'], ['firstName', 'Alex'], ['lastName', 'Morgan'], ['phone', '941-555-0148'], ['zip', '33952']]) await fill(k, v);
    await click('[name=acceptTerms]'); await submit('#ccu-register', 'Add Account');
    await fill('accountNumber', '01048-021048'); await fill('streetNumber', '1048'); await select('paperless', 'true'); await submit('#ccu-link', 'Verify Account Information');
    await confirm('#ccu-link-add', 'My Accounts');
    await navigate('a[href="/cp/ccfl/pay?accountId=acct-primary"]'); await heading('Make a Payment');
    await select('method', 'bank'); await fill('name', 'Alex Morgan'); await fill('routing', '021000021'); await fill('accountNumber', '000001048'); await fill('confirmAccountNumber', '000001048');
    await submit('#ccu-pay', 'Review Payment'); await confirm('#ccu-pay-confirm', 'Payment Confirmation');
    answer = {confirmation: await text('#ccu-confirmation')};
  } else if (taskId === 'charlotte-recover-login-v1') {
    await navigate('a[href="/cp/ccfl/recover"]'); await heading('Forgot Password');
    await fill('email', 'alex@billworld.test'); await click('#ccu-recover button[type=submit]');
    await page.waitForFunction(() => document.querySelector('#ccu-recover-status')?.textContent.includes('sent'));
    await navigate('a[href="/mail"]');
    await page.waitForSelector('[name=email]'); await fill('email', 'alex@billworld.test'); await fill('password', 'Mailbox-2026!');
    await click('form[data-action="mail-login"] button'); await page.waitForSelector('[data-testid="email-item-3"]');
    await click('[data-testid="email-item-3"] .email-content'); await page.waitForSelector('a[href^="/cp/ccfl/reset?token="]');
    await navigate('a[href^="/cp/ccfl/reset?token="]'); await heading('Reset Password');
    await fill('password', 'Restored-2026!'); await fill('confirmPassword', 'Restored-2026!'); await click('#ccu-reset button[type=submit]'); await heading('Password Changed');
    await navigate('a[href="/cp/ccfl"]'); await heading('Log In'); await login('Restored-2026!');
  } else {
    await login();
    if (taskId === 'charlotte-signed-bank-pay-v1' || taskId === 'charlotte-schedule-payment-v1') {
      await navigate('nav a[href="/cp/ccfl/pay"]'); await heading('Make a Payment');
      await select('method', 'saved:bank-1048');
      if (taskId === 'charlotte-schedule-payment-v1') await fill('date', '2026-10-16');
      await submit('#ccu-pay', taskId === 'charlotte-schedule-payment-v1' ? 'Review Scheduled Payment' : 'Review Payment');
      if (await text('#ccu-total') !== '$85.32') throw Error('Unexpected signed total');
      if (taskId === 'charlotte-schedule-payment-v1') { await confirm('#ccu-pay-confirm', 'Payment Scheduled'); answer = {scheduledDate: await text('#ccu-scheduled-date')}; }
      else { await confirm('#ccu-pay-confirm', 'Payment Confirmation'); answer = {confirmation: await text('#ccu-confirmation')}; }
    } else if (taskId === 'charlotte-update-scheduled-payment-v1' || taskId === 'charlotte-cancel-scheduled-payment-v1') {
      await navigate('nav a[href="/cp/ccfl/scheduled"]'); await heading('Scheduled Payments');
      if (taskId === 'charlotte-update-scheduled-payment-v1') {
        await navigate('a[href="/cp/ccfl/scheduled/edit?id=sched-1"]'); await heading('Edit Scheduled Payment');
        await fill('date', '2026-10-15'); await select('methodId', 'bank-2210'); await click('#ccu-scheduled-edit button[type=submit]');
        await page.waitForFunction(() => document.querySelector('#ccu-scheduled-status')?.textContent.includes('2026-10-15'));
        // Regression (audit handbuilt-4, task_ccu6): the "Currently ..." header must show the saved values, not the stale ones.
        const current = await text('#ccu-scheduled-current');
        if (!/October 15, 2026/.test(current) || !/2210/.test(current) || /October 19|4242/.test(current)) throw Error('Scheduled-payment header not refreshed after save: ' + current);
        await navigate('a[href="/cp/ccfl/scheduled"]'); await heading('Scheduled Payments');
        answer = {scheduledDate: await page.$eval('tr[data-schedule-id="sched-1"] td', e => e.textContent)};
      } else {
        await navigate('a[href="/cp/ccfl/scheduled/cancel?id=sched-1"]'); await heading('Cancel Scheduled Payment');
        await click('[name=confirm]'); await submit('#ccu-scheduled-cancel', 'Scheduled Payments');
      }
    } else if (['charlotte-enroll-autopay-v1', 'charlotte-change-autopay-method-v1', 'charlotte-cancel-autopay-v1'].includes(taskId)) {
      await navigate('nav a[href="/cp/ccfl/autopay"]'); await heading('Automatic Payments');
      await navigate('a[href="/cp/ccfl/autopay/edit?accountId=acct-primary"]'); await page.waitForSelector('#ccu-autopay');
      if (taskId === 'charlotte-cancel-autopay-v1') await select('action', 'cancel'); else await select('methodId', 'bank-1048');
      await submit('#ccu-autopay', 'Review Automatic Payments');
      if (taskId !== 'charlotte-cancel-autopay-v1') await click('[name=acknowledgeFee]');
      await confirm('#ccu-autopay-confirm', 'Automatic Payments Updated');
      await navigate('a[href="/cp/ccfl/autopay"]'); await heading('Automatic Payments');
      const status = await text('article[data-account-id="acct-primary"] [data-autopay-status]');
      if (!(taskId === 'charlotte-cancel-autopay-v1' ? /OFF/ : /ON using Checking ending 1048/).test(status)) throw Error('AutoPay status not updated: ' + status);
    } else if (taskId === 'charlotte-paperless-email-v1') {
      await navigate('nav a[href="/cp/ccfl/paperless"]'); await heading('Paperless Billing & Notifications');
      await click('#ccu-paperless-acct-primary [name=paperless]'); await click('#ccu-paperless-acct-primary [name=emailNotify]');
      await click('#ccu-paperless-acct-primary button[type=submit]');
      await page.waitForFunction(() => document.querySelector('#ccu-paperless-acct-primary .status')?.textContent === 'Preferences saved.');
      steps++; await page.reload(); await heading('Paperless Billing & Notifications');
      if (!await page.$eval('#ccu-paperless-acct-primary [name=paperless]', e => e.checked)) throw Error('Paperless not saved');
    } else if (taskId === 'charlotte-download-bill-v1') {
      await navigate('nav a[href="/cp/ccfl/bills"]'); await heading('Bill History');
      const downloadPath = resolve(artifacts, 'downloads'); mkdirSync(downloadPath, {recursive: true});
      const cdp = await browser.target().createCDPSession(); await cdp.send('Browser.setDownloadBehavior', {behavior: 'allowAndName', downloadPath, eventsEnabled: true});
      let begun, timer;
      const done = new Promise((ok, fail) => { timer = setTimeout(() => fail(Error('Statement download timed out')), 30000); cdp.on('Browser.downloadWillBegin', e => { begun = e; }); cdp.on('Browser.downloadProgress', e => { if (e.guid === begun?.guid && e.state === 'completed') ok(e); if (e.state === 'canceled') fail(Error('Download canceled')); }); });
      try { await Promise.all([click('a[data-statement="inv-current"]'), done]); } finally { clearTimeout(timer); await cdp.detach(); }
      const bytes = readFileSync(resolve(downloadPath, begun.guid)); if (bytes.subarray(0, 5).toString() !== '%PDF-') throw Error('Downloaded file is not a PDF');
      answer = {statementFilename: begun.suggestedFilename};
    } else if (taskId === 'charlotte-read-payment-history-v1') {
      await navigate('nav a[href="/cp/ccfl/history"]'); await heading('Payment History');
      answer = {confirmation: await page.$eval('tr[data-payment-id="pay-historical"] td:nth-child(2)', e => e.textContent)};
    } else throw Error('Unknown Charlotte County task ' + taskId);
  }
  return {answer, steps};
}
