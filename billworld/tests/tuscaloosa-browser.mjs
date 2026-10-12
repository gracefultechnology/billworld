// City of Tuscaloosa browser regression: every released reference journey plus UI robustness checks.
import puppeteer from 'puppeteer';
import {start} from '../server.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdirSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const dir = new URL('../artifacts/tuscaloosa/', import.meta.url).pathname; mkdirSync(dir, {recursive: true});
const TASKS = [['task_tus1', 'tuscaloosa-pay-current-bank-v1'], ['task_tus2', 'tuscaloosa-guest-card-pay-v1'], ['task_tus3', 'tuscaloosa-register-autopay-v1'], ['task_tus4', 'tuscaloosa-recover-login-v1'],
  ['task_tus5', 'tuscaloosa-edit-scheduled-v1'], ['task_tus6', 'tuscaloosa-change-cancel-autopay-v1'], ['task_tus7', 'tuscaloosa-ebill-enroll-v1'], ['task_tus8', 'tuscaloosa-download-bill-v1']];
const only = process.argv[2] ? process.argv[2].split(',') : null;
const server = await start({port: 0, adminPort: 0, dbPath: ':memory:'}), results = [];
const record = (name, extra = {}) => { results.push({name, passed: true, ...extra}); console.log('PASS ' + name); };
try {
  // 1. Reference journeys through the same script Infinity uses (sequential; one browser at a time).
  for (const [upstream, taskId] of TASKS.filter(([u]) => !only || only.includes(u))) {
    const f = server.world.create({siteId: 'tuscaloosa-water', taskId}), target = dir + upstream; mkdirSync(target, {recursive: true});
    const before = server.world.evaluate(f.episodeId, {}); assert.equal(before.success, false, `${taskId} must fail before any action`);
    const {stdout} = await promisify(execFile)('node', ['billworld/infinity/reference.mjs', `${server.baseUrl}/enter/${f.episodeId}/${f.entryToken}`, upstream, target], {timeout: 240000, cwd: new URL('../../', import.meta.url).pathname});
    const r = JSON.parse(stdout); assert.deepEqual(r.errors, []);
    const outcome = server.world.evaluate(f.episodeId, r.answer); assert.equal(outcome.success, true, `${taskId}: ${JSON.stringify(outcome.checks)}`);
    record(taskId, {steps: r.steps, answer: r.answer});
  }
  if (!only) {
    const browser = await puppeteer.launch({headless: true, timeout: 60000});
    try {
      const page = await browser.newPage(), errors = [], outbound = []; page.setDefaultTimeout(30000);
      page.on('pageerror', e => errors.push(e.message)); await page.setRequestInterception(true);
      page.on('request', r => { const u = new URL(r.url()); if (['data:', 'about:'].includes(u.protocol) || u.origin === server.baseUrl) r.continue(); else { outbound.push(r.url()); r.abort(); } });
      const heading = t => page.waitForFunction(t => document.querySelector('h1')?.textContent === t, {}, t);
      const go = async (p, t) => { await page.goto(server.baseUrl + p); await heading(t); };
      const nav = async (sel, t) => { await Promise.all([page.waitForNavigation({waitUntil: 'load'}), page.locator(sel).click()]); if (t) await heading(t); };
      const fill = async data => { for (const [k, v] of Object.entries(data)) await page.locator(`[name="${k}"]`).fill(v, {typingThreshold: 0}); };
      const errorText = () => page.waitForFunction(() => document.querySelector('[role=alert]')?.textContent.trim().length > 0).then(() => page.$eval('[role=alert]', e => e.textContent));
      const unnamed = () => page.evaluate(() => [...document.querySelectorAll('a,button,input:not([type=hidden]),select,textarea')].filter(e => !e.closest('[hidden]')).filter(e => {
        const name = (e.getAttribute('aria-label') || (e.id && document.querySelector(`label[for="${e.id}"]`)?.textContent) || e.closest('label')?.textContent || e.textContent || e.getAttribute('title') || '').trim();
        return !name; }).map(e => e.outerHTML.slice(0, 120)));
      const enter = async taskId => { const f = server.world.create({siteId: 'tuscaloosa-water', ...(taskId ? {taskId} : {})}); await page.goto(`${server.baseUrl}/enter/${f.episodeId}/${f.entryToken}`); await heading('City of Tuscaloosa'); return f; };

      // 2. Public pages: rendered headings, accessible names, mobile layout, no external requests.
      let f = await enter();
      for (const [p, t] of [['/', 'City of Tuscaloosa'], ['/billinfo', 'Bill and Payment Information'], ['/ach', 'Auto Bill Payment'], ['/onlineservices', 'Account Service Center'], ['/onlineservices/useful-forms', 'Useful Forms'], ['/ebill', 'Useful Forms'], ['/faqs', 'Frequently Asked Questions'], ['/cp/tusl', 'Login'], ['/cp/tusl/register', 'New Account Information'], ['/cp/tusl/forgot', 'Forgot Password'], ['/cp/tusl/guest', 'Make a One-Time Payment']]) {
        await go(p, t); assert.deepEqual(await unnamed(), [], `unnamed controls on ${p}`);
      }
      await page.setViewport({width: 375, height: 812}); for (const p of ['/ach', '/cp/tusl']) { await page.goto(server.baseUrl + p); await page.waitForSelector('h1'); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `horizontal scroll on ${p}`); }
      await page.screenshot({path: dir + 'mobile-login.png', fullPage: true}); await page.setViewport({width: 1280, height: 900});
      await go('/ach', 'Auto Bill Payment'); await page.screenshot({path: dir + 'ach.png', fullPage: true});
      await go('/pay-water-bill', 'Login');
      record('public pages render with accessible controls, mobile width and the Pay My Water Bill redirect');

      // 3. Guest lookup rejects mismatched identifiers and keeps the visitor on the form.
      await go('/cp/tusl/guest', 'Make a One-Time Payment'); await fill({accountNumber: '2048106', customerNumber: '2002099'});
      await page.locator('form[data-action="guest"] button[type=submit]').click(); assert.match(await errorText(), /do not match/);
      assert.equal(server.world.state(f.episodeId).events.filter(e => e.type === 'tus_guest_lookup').length, 0);
      record('guest lookup requires the matching account number and customer number');

      // 4. Protected pages redirect to login and return; pending reviews survive reloads (server-side state).
      await page.goto(server.baseUrl + '/cp/tusl/bill-history?account=svc-home'); await heading('Login');
      assert.match(page.url(), /next=%2Fcp%2Ftusl%2Fbill-history/);
      await fill({email: 'alex@billworld.test', password: 'Billworld-2026!'}); await nav('form[data-action="login"] button[type=submit]', 'Bill History');
      assert.equal(await page.$$eval('tbody tr', r => r.length), 12);
      await nav('nav a[href="/cp/tusl/pay"]', 'Pay My Bill'); await nav('a[href="/cp/tusl/pay?account=svc-home"]', 'Make a Payment');
      await page.locator('[name=amountChoice][value=other]').click(); await fill({otherAmount: '10.00', paymentDate: '2026-10-20'}); await page.locator('[name=methodChoice][value="saved:card-4242"]').click();
      await nav('form[data-action="pay"] button[type=submit]', 'Review Payment'); await page.reload(); await heading('Review Payment');
      assert.match(await page.$eval('main', e => e.textContent), /10\/20\/2026 \(scheduled\)/);
      await nav('form[data-action="submit-payment"] button[type=submit]').catch(() => {});
      assert.match(await errorText(), /authorize/i);
      await page.locator('[name=authorize]').click(); await nav('form[data-action="submit-payment"] button[type=submit]', 'Payment Scheduled');
      await page.reload(); await heading('Payment Scheduled');
      await nav('a[href="/cp/tusl/history"].pbtn', 'Payment History'); assert.match(await page.$eval('main', e => e.textContent), /10\/20\/2026\$10\.00Visa ending 4242/);
      const executed = server.world.advance(f.episodeId, 17 * 86400000).executed; assert.ok(executed.some(x => x.status === 'posted' && x.scheduleId));
      record('login redirect returns to the requested page; scheduled payment review survives reload and executes on its date');

      // 5. Wallet removal is blocked while AutoPay uses the method; message is visible.
      f = await enter('tuscaloosa-change-cancel-autopay-v1'); await go('/cp/tusl', 'Login'); await fill({email: 'alex@billworld.test', password: 'Billworld-2026!'}); await nav('form[data-action="login"] button[type=submit]', 'My Accounts');
      await nav('nav a[href="/cp/tusl/wallet"]', 'My Wallet'); await page.locator('button[aria-label="Remove Visa ending 4242"]').click(); assert.match(await errorText(), /AutoPay/);
      assert.equal(server.world.state(f.episodeId).accounts[0].methods.length, 2);
      record('wallet removal of an AutoPay method is refused with a visible explanation');

      // 6. eBill form rejects a wrong account holder name without changing delivery.
      f = await enter('tuscaloosa-ebill-enroll-v1'); await go('/ebill', 'Useful Forms'); await fill({accountNumber: '2048106', customerNumber: '1001048', name: 'Jordan Lee', email: 'alex@billworld.test', confirmEmail: 'alex@billworld.test'});
      await page.locator('[name=acceptTerms]').click(); await page.locator('form[data-action="ebill"] button[type=submit]').click(); assert.match(await errorText(), /name does not match/);
      assert.equal(server.world.state(f.episodeId).tusServiceAccounts[0].ebill.status, 'paper');
      record('eBill form validates the account holder name');

      assert.deepEqual(errors, []); assert.deepEqual(outbound, []);
      writeFileSync(dir + 'network-validation.json', JSON.stringify({page_errors: errors, outbound_requests: outbound}, null, 2));
    } finally { await browser.close(); }
  }
} finally {
  writeFileSync(dir + 'results.json', JSON.stringify({scenarios: results.length, all_passed: results.every(r => r.passed), results}, null, 2));
  await server.close();
}
