// Regression coverage for the hand-built blind-audit defects: one-tab email-code sign-in
// (Juneau, WVU), clickable/accessible Gmail rows, quiet first mailbox load, SmartHub
// method-specific payment fields, and AuthorityPay-branded recovery.
import puppeteer from 'puppeteer';
import { start } from '../server.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const dir = new URL('../artifacts/handbuilt-audit/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const server = await start({ port: 0, adminPort: 0, dbPath: ':memory:' });
const browser = await puppeteer.launch({ headless: true, timeout: 60000 }), results = [], errors = [], outbound = [];
async function open(siteId, taskId) {
  const context = await browser.createBrowserContext(), page = await context.newPage(), fixture = server.world.create({ siteId, ...(taskId ? { taskId } : {}) });
  page.setDefaultTimeout(20000); await page.setViewport({ width: 1365, height: 900 });
  page.on('pageerror', e => errors.push(e.message)); await page.setRequestInterception(true);
  page.on('request', r => { const u = new URL(r.url()); if (['data:', 'about:'].includes(u.protocol) || u.origin === server.baseUrl) r.continue(); else { outbound.push(r.url()); r.abort(); } });
  await page.goto(`${server.baseUrl}/enter/${fixture.episodeId}/${fixture.entryToken}`); return { context, page, fixture };
}
const h1 = (page, text) => page.waitForFunction(t => [...document.querySelectorAll('h1')].some(h => h.textContent.trim() === t), {}, text);
const navClick = (page, selector) => Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click(selector)]);
async function run(name, fn) { try { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); } catch (e) { results.push({ name, passed: false, error: e.message }); throw e; } }
// Sign in to the mock mailbox in the current tab and open the newest message whose accessible name matches, by clicking its link.
async function readMail(page, subjectPattern, viaKeyboard = false) {
  await page.waitForSelector('form[data-action="mail-login"]');
  assert.equal(await page.$eval('#error', e => e.textContent), '', 'no access-denied error before any sign-in attempt');
  await page.type('[name=email]', 'alex@billworld.test'); await page.type('[name=password]', 'Mailbox-2026!');
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('form[data-action="mail-login"] button:not([type="button"])')]);
  await page.waitForSelector('a.email-open');
  const target = await page.evaluateHandle(p => [...document.querySelectorAll('a.email-open')].find(a => new RegExp(p, 'i').test(a.getAttribute('aria-label'))), subjectPattern.source);
  const label = await target.evaluate(a => a?.getAttribute('aria-label')); assert.match(label || '', /^Open message: /);
  const href = await target.evaluate(a => a.getAttribute('href')); assert.match(href, /^#\/email\/\d+$/);
  if (viaKeyboard) { await target.focus(); await page.keyboard.press('Enter'); } else await target.click();
  await page.waitForSelector('[data-testid^="message-body-"]');
  return page.$eval('[data-testid^="message-body-"]', e => e.textContent);
}
try {
  await run('Juneau one-tab email-code sign-in: open email in the same tab, return, verify', async () => {
    const { context, page } = await open('juneau-utilities', 'juneau-pay-email-mfa-v1');
    await page.goto(server.baseUrl + '/portal/login'); await h1(page, 'Sign In');
    await page.type('#email', 'alex@billworld.test'); await page.type('#password', 'Billworld-2026!'); await page.click('form[data-action="login"] button:not([type="button"])');
    await h1(page, 'Verify your sign-in');
    await navClick(page, 'main a[href="/mail"]');
    const body = await readMail(page, /verification code/, true); const code = body.match(/code is (\d{6})/)[1];
    // Return to the billing site the way a one-tab agent would: banner link, then Sign In.
    await navClick(page, 'a[href="/"]'); await h1(page, 'Utilities Division');
    await page.click('a[href="/portal/login"]'); await h1(page, 'Sign In');
    await page.waitForSelector('a[href="/portal/verify"]'); await page.click('a[href="/portal/verify"]'); await h1(page, 'Verify your sign-in');
    await page.type('#code', code); await page.click('form[data-action="verify"] button:not([type="button"])');
    await h1(page, 'Your Account At A Glance');
    // The same code cannot be replayed after a reload of the verify page.
    await page.goto(server.baseUrl + '/portal/verify'); await h1(page, 'Verify your sign-in');
    assert.match(await page.$eval('main', e => e.textContent), /No sign-in verification is pending/);
    await context.close();
  });
  await run('WVU MyChart one-tab email-code sign-in resumes on the login page', async () => {
    const { context, page } = await open('wvu-medicine', 'wvu-mfa-visit-pay-v1');
    await page.goto(server.baseUrl + '/MyChart/Authentication/Login'); await page.waitForSelector('#username');
    await page.type('[name=username]', 'alex.morgan'); await page.click('#username button');
    await page.waitForSelector('[name=password]'); await page.type('[name=password]', 'Billworld-2026!'); await page.click('#password button');
    await page.waitForSelector('#otp'); await navClick(page, '#sidebar a[href="/mail"]');
    const code = (await readMail(page, /verification code/)).match(/code is (\d{6})/)[1];
    await page.goto(server.baseUrl + '/MyChart/Authentication/Login'); await page.waitForSelector('#otp');
    await page.type('[name=code]', code); await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#otp button')]);
    await page.waitForFunction(() => document.querySelector('.bw-mychart')?.innerText.includes('Account Summary'));
    const names = await page.$$eval('[data-visit]', bs => bs.map(b => b.getAttribute('aria-label')));
    assert.ok(names.length >= 1); assert.equal(new Set(names).size, names.length, 'visit pay buttons have distinct accessible names');
    for (const n of names) assert.match(n, /^Pay visit account \d+$/);
    await context.close();
  });
  await run('SmartHub payment form shows only the fields for the selected method and no decline fixture', async () => {
    for (const siteId of ['avec-electric', 'gvp-electric']) {
      const { context, page } = await open(siteId);
      await page.goto(server.baseUrl + '/smarthub/ui/#/login'); await page.waitForSelector('form[data-action="hub-login"]');
      await page.type('[name=email]', 'alex@billworld.test'); await page.type('[name=password]', 'Billworld-2026!'); await page.click('form[data-action="hub-login"] button:not([type="button"])'); await h1(page, 'HOME');
      await page.goto(server.baseUrl + '/smarthub/ui/#/makeAPayment'); await h1(page, 'MAKE A PAYMENT');
      const options = await page.$$eval('[name=methodId] option', os => os.map(o => o.textContent));
      assert.equal(options.some(o => /0002|Declined/i.test(o)), false, siteId + ' lists no decline fixture');
      const visible = () => page.evaluate(() => ['routing', 'accountNumber', 'cardNumber', 'expiry', 'cvv', 'name'].filter(n => document.querySelector(`[name=${n}]`)?.checkVisibility()));
      assert.deepEqual(await visible(), ['routing', 'accountNumber', 'name']);
      await page.select('[name=methodId]', 'new-card'); assert.deepEqual(await visible(), ['cardNumber', 'expiry', 'cvv', 'name']);
      await page.select('[name=methodId]', 'bank-1048'); assert.deepEqual(await visible(), []);
      await page.click('form[data-action="hub-quote"] button:not([type="button"])'); await h1(page, 'REVIEW PAYMENT');
      assert.match(await page.$eval('main', e => e.textContent), /1048/);
      await context.close();
    }
  });
  await run('Swepsonville recovery email links to the AuthorityPay reset page', async () => {
    const { context, page } = await open('swepsonville-water', 'swepsonville-recover-login-v1');
    await page.goto(server.baseUrl + '/site/request-password-reset'); await page.waitForSelector('form[data-action="authority-recover"]');
    await page.type('[name=email]', 'alex@billworld.test'); await page.click('form[data-action="authority-recover"] button:not([type="button"])');
    await page.waitForFunction(() => document.querySelector('#notice')?.textContent.includes('sent'));
    await page.goto(server.baseUrl + '/mail'); const body = await readMail(page, /Swepsonville/);
    assert.doesNotMatch(body, /Billworld portal|\/portal\/reset/);
    await navClick(page, 'a[href^="/site/reset-password?token="]'); await h1(page, 'Reset Your Password');
    await page.type('[name=password]', 'Restored-2026!'); await page.type('[name=confirmPassword]', 'Restored-2026!'); await page.click('form[data-action="authority-reset"] button:not([type="button"])');
    await h1(page, 'Pay your bill');
    await context.close();
  });
  await run('Juneau password recovery: mailbox elements stay stable across polls; branded subject; reset confirmation', async () => {
    const { context, page } = await open('juneau-utilities', 'juneau-recover-password-v1');
    await page.goto(server.baseUrl + '/portal/forgot'); await h1(page, 'Reset your password');
    await page.type('[name=email]', 'alex@billworld.test'); await page.click('form[data-action="forgot"] button:not([type="button"])');
    await page.waitForFunction(() => /sent/.test(document.querySelector('#reset-notice')?.textContent || ''));
    await page.goto(server.baseUrl + '/mail'); await page.waitForSelector('form[data-action="mail-login"]');
    await page.type('[name=email]', 'alex@billworld.test'); await page.type('[name=password]', 'Mailbox-2026!');
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('form[data-action="mail-login"] button:not([type="button"])')]);
    await page.waitForSelector('a.email-open');
    // An agent observes, thinks for several seconds, then clicks: the element it saw must still be attached
    // (the 2 s mailbox poll used to re-render everything and detach every observed element).
    const link = await page.evaluateHandle(() => [...document.querySelectorAll('a.email-open')].find(a => /Reset your/.test(a.getAttribute('aria-label'))));
    const label = await link.evaluate(a => a.getAttribute('aria-label'));
    assert.match(label, /Reset your City and Borough of Juneau Utilities password/); assert.doesNotMatch(label, /Billworld portal/);
    await new Promise(r => setTimeout(r, 5500));
    assert.equal(await link.evaluate(a => a.isConnected), true, 'inbox link survives polling');
    await link.click(); await page.waitForSelector('[data-testid^="message-body-"]');
    // Opening marks the message read; the server echo must not replace the message view either.
    const reset = await page.waitForSelector('a[href^="/portal/reset?token="]');
    await new Promise(r => setTimeout(r, 5500));
    assert.equal(await reset.evaluate(a => a.isConnected), true, 'message-view link survives the read echo and polling');
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), reset.click()]); await h1(page, 'Choose a new password');
    await page.type('[name=password]', 'Restored-2026!'); await page.type('[name=confirmPassword]', 'Restored-2026!'); await page.click('form[data-action="reset"] button:not([type="button"])');
    await h1(page, 'Sign In'); await page.waitForSelector('#reset-success');
    assert.match(await page.$eval('#reset-success', e => e.textContent), /password was updated/);
    await page.type('#email', 'alex@billworld.test'); await page.type('#password', 'Restored-2026!'); await page.click('form[data-action="login"] button:not([type="button"])');
    await page.waitForFunction(() => location.pathname !== '/portal/login');
    await context.close();
  });
  assert.deepEqual(errors, []); assert.deepEqual(outbound, []);
} finally {
  writeFileSync(dir + 'results.json', JSON.stringify({ all_passed: results.length >= 5 && results.every(r => r.passed), results, page_errors: errors, outbound_requests: outbound }, null, 2));
  await browser.close(); await server.close();
}
