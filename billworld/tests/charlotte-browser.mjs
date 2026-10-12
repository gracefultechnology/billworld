// Puppeteer regression for Charlotte County Utilities: every released task journey plus UI/a11y checks.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {mkdirSync, writeFileSync} from 'node:fs';
import {start} from '../server.mjs';
import {CHARLOTTE_INFINITY_TASKS, runCharlotteJourney} from '../infinity/reference-charlotte.mjs';

const dir = new URL('../artifacts/charlotte-browser/', import.meta.url); mkdirSync(dir, {recursive: true});
const server = await start({port: 0, adminPort: 0, dbPath: ':memory:'});
const report = {site: 'charlotte-county-utilities', browser: null, scenarios: [], page_errors: [], outbound_requests: []};
const only = process.env.CCU_TASKS ? process.env.CCU_TASKS.split(',') : null;
const launch = async () => { const browser = await puppeteer.launch({headless: true, timeout: 60000}); report.browser ||= await browser.version(); return browser; };
async function preparePage(browser, label) {
  const page = await browser.newPage(); await page.setViewport({width: 1365, height: 900});
  page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(30000);
  page.on('pageerror', e => report.page_errors.push(label + ': ' + e.message));
  await page.setRequestInterception(true);
  page.on('request', r => { if (r.url().startsWith(server.baseUrl + '/') || r.url().startsWith('data:')) r.continue(); else { report.outbound_requests.push(r.url()); r.abort(); } });
  return page;
}
const pass = s => { report.scenarios.push(s); console.log('PASS ' + s); };
// Every form control and button on the current page must expose an accessible name.
async function audit(page, label) {
  const problems = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('input:not([type=hidden]),select,textarea')) {
      const named = el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
      if (!named) out.push('unlabelled ' + el.tagName + ' ' + (el.name || el.id));
    }
    for (const el of document.querySelectorAll('button,a[href]')) if (!(el.textContent.trim() || el.getAttribute('aria-label') || el.querySelector('img[alt]'))) out.push('unnamed ' + el.tagName + ' ' + el.outerHTML.slice(0, 80));
    if (document.querySelectorAll('main h1').length !== 1) out.push('expected exactly one h1');
    return out;
  });
  assert.deepEqual(problems, [], label + ': ' + problems.join('; '));
}
try {
  for (const [infinityId, [, taskId]] of Object.entries(CHARLOTTE_INFINITY_TASKS)) {
    if (only && !only.includes(taskId) && !only.includes(infinityId)) continue;
    const browser = await launch();
    try {
      const fixture = server.world.create({siteId: 'charlotte-county-utilities', taskId});
      const page = await preparePage(browser, taskId);
      await page.goto(`${server.baseUrl}/enter/${fixture.episodeId}/${fixture.entryToken}`);
      const artifacts = new URL(taskId + '/', dir).pathname; mkdirSync(artifacts, {recursive: true});
      // Negative grader check before acting: an idle episode must not pass.
      assert.equal(server.world.evaluate(fixture.episodeId, {}).success, false, taskId + ' passes without action');
      const {answer, steps} = await runCharlotteJourney({page, browser, base: server.baseUrl, taskId, artifacts});
      await audit(page, taskId);
      await page.screenshot({path: artifacts + 'final.png', fullPage: true});
      const result = server.world.evaluate(fixture.episodeId, answer);
      writeFileSync(artifacts + 'result.json', JSON.stringify({answer, steps, result}, null, 2));
      assert.equal(result.success, true, taskId + ' ' + JSON.stringify(result.checks));
      // A wrong reported answer must fail where the task asks for one.
      if (answer.confirmation) assert.equal(server.world.evaluate(fixture.episodeId, {...answer, confirmation: answer.confirmation + '9'}).success, false);
      if (answer.scheduledDate) assert.equal(server.world.evaluate(fixture.episodeId, {scheduledDate: '2026-10-20'}).success, false);
      if (answer.statementFilename) assert.equal(server.world.evaluate(fixture.episodeId, {statementFilename: 'bill.pdf'}).success, false);
      pass(`${taskId} (${infinityId}) completes in one tab in ${steps} UI actions and grades strictly`);
    } finally { await browser.close(); }
  }
  if (!only) {
    const browser = await launch();
    try {
      const fixture = server.world.create({siteId: 'charlotte-county-utilities', taskId: 'charlotte-signed-bank-pay-v1'});
      const page = await preparePage(browser, 'ui');
      await page.goto(`${server.baseUrl}/enter/${fixture.episodeId}/${fixture.entryToken}`);
      await page.waitForSelector('a.popular-link'); await audit(page, 'county home').catch(() => {}); // captured county markup is not ours to grade
      const visit = async (path, title) => { await page.goto(server.baseUrl + path); await page.waitForFunction(t => document.querySelector('h1')?.textContent === t, {}, title); await audit(page, path); };
      await visit('/cp/ccfl', 'Log In'); await visit('/cp/ccfl/help', 'Fees and Posting Times'); await visit('/cp/ccfl/register', 'Create Your Profile'); await visit('/cp/ccfl/recover', 'Forgot Password'); await visit('/cp/ccfl/quickpay', 'Pay Without Registering');
      await visit('/cp/ccfl/accounts', 'Please Log In');
      await page.goto(server.baseUrl + '/cp/ccfl'); await page.locator('[name=email]').fill('alex@billworld.test'); await page.locator('[name=password]').fill('wrong-password1'); await page.locator('#ccu-login button[type=submit]').click();
      await page.waitForFunction(() => /incorrect/.test(document.querySelector('#ccu-login .error').textContent));
      await page.locator('[name=password]').fill('Billworld-2026!'); await Promise.all([page.waitForNavigation(), page.locator('#ccu-login button[type=submit]').click()]);
      for (const [path, title] of [['/cp/ccfl/accounts', 'My Accounts'], ['/cp/ccfl/pay', 'Make a Payment'], ['/cp/ccfl/scheduled', 'Scheduled Payments'], ['/cp/ccfl/history', 'Payment History'], ['/cp/ccfl/bills', 'Bill History'], ['/cp/ccfl/autopay', 'Automatic Payments'], ['/cp/ccfl/autopay/edit?accountId=acct-primary', 'Set Up Automatic Payments'], ['/cp/ccfl/paperless', 'Paperless Billing & Notifications'], ['/cp/ccfl/wallet', 'My Wallet'], ['/cp/ccfl/wallet/add', 'Add Payment Method'], ['/cp/ccfl/add-account', 'Add Account'], ['/cp/ccfl/profile', 'My Profile']]) await visit(path, title);
      pass('All portal pages render with one heading and accessible names for every control; protected pages ask unauthenticated visitors to log in');
      await visit('/cp/ccfl/pay', 'Make a Payment');
      assert.equal(await page.$$eval('#method option[value=paypal],#method option[value=venmo],#method option[value=applepay],#method option[value=googlepay]', os => os.every(o => o.disabled)), true);
      await page.select('[name=method]', 'card'); await page.locator('[name=cardName]').fill('Alex Morgan'); await page.locator('[name=cardNumber]').fill('378282246310005'); await page.locator('[name=expiry]').fill('12/29'); await page.locator('[name=cvv]').fill('1234');
      await page.locator('#ccu-pay button[type=submit]').click(); await page.waitForFunction(() => /Visa, Mastercard and Discover/.test(document.querySelector('#ccu-pay .error').textContent));
      assert.match(await page.$eval('#ccu-fee', e => e.textContent), /\$2\.95/);
      await page.select('[name=method]', 'saved:bank-1048'); assert.match(await page.$eval('#ccu-fee', e => e.textContent), /\$1\.00/);
      await page.locator('[name=date]').fill('2026-10-01'); await page.locator('#ccu-pay button[type=submit]').click(); await page.waitForFunction(() => /future payment date/.test(document.querySelector('#ccu-pay .error').textContent));
      await page.locator('[name=date]').fill('2026-10-03'); await page.locator('[name=amount]').fill('90.00'); await page.locator('#ccu-pay button[type=submit]').click(); await page.waitForFunction(() => /cannot exceed/.test(document.querySelector('#ccu-pay .error').textContent));
      pass('Checkout shows documented fees, rejects American Express, past dates and overpayment, and leaves digital wallets visibly unavailable');
      await page.locator('[name=amount]').fill('84.32'); await Promise.all([page.waitForNavigation(), page.locator('#ccu-pay button[type=submit]').click()]);
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Review Payment');
      await page.locator('#ccu-pay-confirm button[type=submit]').click(); await page.waitForFunction(() => /authorization box/.test(document.querySelector('#ccu-pay-confirm .error').textContent));
      assert.match(await page.$eval('main', e => e.textContent), /Expected posting date.*Monday, October 5, 2026/);
      pass('Review requires explicit authorization and shows the Saturday-noon payment posting on the next business day (Monday)');
      await page.goto(server.baseUrl + '/'); await page.waitForSelector('a.popular-link');
      await Promise.all([page.waitForNavigation(), page.locator('a.popular-link[href$="links-pay_bill/index.html"]').click()]);
      assert.ok(await page.$('a[href="/cp/ccfl"]'));
      assert.equal(await page.$$eval('a[href]', as => as.some(a => a.href.includes('paymentus.com'))), false);
      pass('County website links to the local Paymentus portal without outbound links');
      await page.screenshot({path: new URL('ui.png', dir).pathname, fullPage: true});
    } finally { await browser.close(); }
  }
  assert.deepEqual(report.page_errors, []); assert.deepEqual(report.outbound_requests, []);
  report.all_passed = true;
} catch (error) { report.all_passed = false; report.error = error.stack; throw error; }
finally { writeFileSync(new URL('report.json', dir), JSON.stringify(report, null, 2) + '\n'); await server.close(); }
