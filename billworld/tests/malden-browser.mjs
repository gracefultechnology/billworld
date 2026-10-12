// Puppeteer reference journeys for the City of Malden / Edmunds WIPP first slice (one tab, local only).
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { start } from '../server.mjs';

const dir = new URL('../artifacts/malden-browser/', import.meta.url); mkdirSync(dir, { recursive: true });
const r = await start({ port: 0, adminPort: 0, dbPath: ':memory:' });
const report = { kind: 'malden_wipp_reference_journeys', released: true, scenarios: [], page_errors: [], outbound_requests: [], unnamed_controls: [] };
let browser, page;
const only = process.argv[2] ? process.argv[2].split(',') : null;
try {
  browser = await puppeteer.launch({ headless: 'shell', timeout: 120000 }); report.browser_version = await browser.version();
  page = await browser.newPage(); await page.setViewport({ width: 1280, height: 1000 }); page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(30000);
  const cdp = await page.createCDPSession(); await cdp.send('Network.enable'); await cdp.send('Network.setBlockedURLs', { urlPatterns: [{ urlPattern: r.baseUrl + '/*', block: false }, { urlPattern: '*://*:*/*', block: true }] });
  page.on('pageerror', e => report.page_errors.push(e.message));
  page.on('request', q => { if (!q.url().startsWith(r.baseUrl) && !q.url().startsWith('data:')) report.outbound_requests.push(q.url()); });
  page.on('dialog', d => d.dismiss());
  const h1 = text => page.waitForFunction(t => document.querySelector('h1')?.textContent.trim() === t, {}, text);
  const go = async (path, title) => { await page.goto(r.baseUrl + path, { waitUntil: 'domcontentloaded' }); if (title) await h1(title); };
  const fill = (name, value, scope = '') => page.locator(`${scope} [name="${name}"]`.trim()).fill(value, { typingThreshold: 0 });
  const nav = async (selector, title) => { await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.locator(selector).click()]); if (title) await h1(title); };
  const submitNav = (form, title) => nav(`form[data-form="${form}"] button[type=submit]`, title);
  const click = selector => page.locator(selector).click();
  const errorText = () => page.waitForSelector('[role=alert]').then(e => e.evaluate(n => n.textContent));
  async function audit(label) {
    const missing = await page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]),select,textarea,button,a[href]')].filter(el => {
      const name = el.getAttribute('aria-label') || (el.labels && [...el.labels].map(l => l.textContent).join(' ')) || el.textContent || el.getAttribute('title') || el.getAttribute('placeholder');
      return !name || !name.trim();
    }).map(el => el.outerHTML.slice(0, 120)));
    if (missing.length) report.unnamed_controls.push({ label, missing });
  }
  const enter = async (taskId) => { const f = r.world.create({ siteId: 'malden', taskId }); await page.goto(`${r.baseUrl}/enter/${f.episodeId}/${f.entryToken}`, { waitUntil: 'domcontentloaded' }); return f; };
  const login = async (password = 'Billworld-2026!') => { await go('/wipp/home', 'Account Log In'); await fill('email', 'alex@billworld.test'); await fill('password', password); await submitNav('login', 'Summary'); };
  async function mail(subject) {
    await go('/mail');
    if (await page.$('form[data-action="mail-login"]')) { await fill('email', 'alex@billworld.test'); await fill('password', 'Mailbox-2026!'); await page.locator('form[data-action="mail-login"] button').click(); }
    await page.waitForFunction(s => [...document.querySelectorAll('[data-testid^="email-item-"]')].some(e => e.textContent.includes(s)), {}, subject);
    const items = await page.$$('[data-testid^="email-item-"]');
    for (const item of items) if ((await item.evaluate(e => e.textContent)).includes(subject)) { await (await item.$('.email-content') || item).click(); break; }
    await page.waitForSelector('[data-testid="email-detail"]');
    return page.$eval('[data-testid="email-detail"]', e => e.textContent);
  }
  const finish = (f, outcome = {}) => r.world.finish(f.episodeId, outcome, { kind: 'reference_script', agent: 'malden-browser-reference' });
  async function scenario(name, fn) {
    if (only && !only.includes(name)) return;
    const t0 = Date.now();
    try { await fn(); report.scenarios.push({ name, passed: true, ms: Date.now() - t0 }); console.log('ok', name); }
    catch (e) { report.scenarios.push({ name, passed: false, error: e.message }); console.log('FAIL', name, e.stack); await page.screenshot({ path: new URL(`fail-${name}.png`, dir).pathname, fullPage: true }).catch(() => {}); }
  }
  const shot = name => page.screenshot({ path: new URL(`${name}.png`, dir).pathname, fullPage: true });

  await scenario('public-pages', async () => {
    await enter('malden-guest-pay-v1');
    await h1('City of Malden Missouri'); await audit('home'); await shot('home');
    await go('/departments/public_works_office/index.php', 'Board of Public Works');
    await click('button[aria-controls="acc-billing"]');
    assert.match(await page.$eval('#acc-billing', e => e.textContent), /5% late fee/);
    await click('button[aria-controls="acc-pay"]'); await audit('public-works'); await shot('public-works');
    await nav('#acc-pay a[href^="/wipp/home"]', 'Account Log In');
    await go('/how_do_i/faq.php', 'FAQ'); await go('/how_do_i/pay_bill_online.php', 'Pay Bill Online');
  });

  await scenario('guest-echeck-payment', async () => {
    const f = await enter('malden-guest-pay-v1');
    await nav('.m-qlinks a[href^="/wipp/home"]', 'Account Log In'); await audit('login');
    await nav('a[href="/wipp/lookup"]', 'Lookup your account');
    await click('input[name=by][value=name]'); await fill('value', 'zz-none'); await click('form[data-form=lookup] button[type=submit]');
    assert.match(await errorText(), /No results found/);
    await click('input[name=by][value=accountId]'); await fill('value', '1001048'); await click('form[data-form=lookup] button[type=submit]');
    await page.waitForSelector('[data-select="1001048"]'); await click('[data-select="1001048"]'); await page.waitForSelector('[data-confirm-account]'); await audit('lookup');
    await nav('[data-confirm-account]', 'Utility Account 1001048'); await audit('guest-view');
    assert.equal(await page.$('a[href="/wipp/bill/1001048"]'), null);
    await nav('a[href="/wipp/pay/1001048"]', 'Make Payment'); await audit('pay');
    assert.equal(await page.$('[name=date]'), null, 'guests cannot schedule');
    await click('input[name=methodType][value=echeck]'); await click('input[name=terms]'); await click('form[data-form=pay] button[type=submit]');
    await nav('[data-transfer] a', 'Payment Details'); await audit('link2gov');
    await fill('name', 'Alex Morgan'); await fill('routing', '021000022'); await fill('accountNumber', '000001048'); await fill('confirmAccountNumber', '000001048'); await fill('zip', '63863'); await fill('email', 'alex@billworld.test');
    await click('form[data-form=details] button[type=submit]'); assert.match(await errorText(), /Invalid Routing Number/);
    await fill('routing', '021000021'); await submitNav('details', 'Review Payment'); await shot('guest-review');
    await page.reload({ waitUntil: 'domcontentloaded' }); await h1('Review Payment');
    await click('input[name=authorize]'); await submitNav('submit', 'Confirmation'); await audit('confirmation'); await shot('guest-confirmation');
    const confirmation = await page.$eval('[data-confirmation]', e => e.textContent.trim());
    assert.match(confirmation, /^MCPW-/);
    await page.reload({ waitUntil: 'domcontentloaded' }); await h1('Confirmation');
    const receipt = await mail('payment receipt'); assert.ok(receipt.includes(confirmation));
    const score = finish(f, { confirmation }); assert.equal(score.success, true, JSON.stringify(score.checks));
  });

  await scenario('guest-task-rejects-signed-shortcut', async () => {
    const f = await enter('malden-guest-pay-v1'); await login();
    await go('/wipp/pay/1001048', 'Make Payment'); await click('input[name=methodType][value=echeck]'); await click('input[name=terms]'); await click('form[data-form=pay] button[type=submit]');
    await nav('[data-transfer] a', 'Payment Details'); await click('input[name=source][value="saved:alex-bank-1048"]'); await submitNav('details', 'Review Payment'); await click('input[name=authorize]'); await submitNav('submit', 'Confirmation');
    const confirmation = await page.$eval('[data-confirmation]', e => e.textContent.trim());
    const score = finish(f, { confirmation }); assert.equal(score.success, false); assert.equal(score.checks.exact_payment, false);
  });

  await scenario('disconnected-account-blocked', async () => {
    await enter('malden-guest-pay-v1'); await go('/wipp/lookup', 'Lookup your account');
    await click('input[name=by][value=location]'); await fill('value', 'burke'); await click('form[data-form=lookup] button[type=submit]');
    await page.waitForSelector('[data-select="3003075"]'); await click('[data-select="3003075"]'); await nav('[data-confirm-account]', 'Utility Account 3003075');
    assert.match(await page.$eval('main', e => e.textContent), /Utility service has been disconnected for non-payment/);
    assert.equal(await page.$('a[href="/wipp/pay/3003075"]'), null);
    const status = await page.evaluate(async () => (await fetch('/api/wipp/checkout/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: '3003075', methodType: 'card', amountChoice: 'bill', terms: true }) })).status);
    assert.equal(status, 409);
  });

  await scenario('signed-card-partial-payment', async () => {
    const f = await enter('malden-signed-card-pay-v1'); await login(); await audit('summary'); await shot('summary');
    await nav('a[aria-label="View/Pay Account 1001048"]', 'Utility Account 1001048'); await audit('signed-view');
    await nav('a[href="/wipp/pay/1001048"]', 'Make Payment');
    await click('input[name=methodType][value=card]'); await click('input[name=amountChoice][value=other]'); await fill('amount', '90.00'); await click('input[name=terms]');
    await click('form[data-form=pay] button[type=submit]'); assert.match(await errorText(), /between \$1.00 and \$84.32/);
    await fill('amount', '50.00'); await click('form[data-form=pay] button[type=submit]');
    await nav('[data-transfer] a', 'Payment Details');
    // A declined new card creates no payment and returns to details.
    await click('input[name=source][value=new]'); await fill('name', 'Alex Morgan'); await fill('cardNumber', '4000000000000002'); await fill('expiry', '12/29'); await fill('cvv', '123'); await fill('zip', '63863');
    await submitNav('details', 'Review Payment'); await click('input[name=authorize]'); await click('form[data-form=submit] button[type=submit]');
    assert.match(await errorText(), /problem processing your payment/);
    await go('/wipp/link2gov', 'Payment Details'); await click('input[name=source][value="saved:alex-card-4242"]'); await submitNav('details', 'Review Payment');
    await click('input[name=authorize]'); await submitNav('submit', 'Confirmation');
    const confirmation = await page.$eval('[data-confirmation]', e => e.textContent.trim());
    await nav('a[href="/wipp/view/utility/1001048"]', 'Utility Account 1001048');
    assert.ok((await page.$eval('main', e => e.textContent)).includes(confirmation), 'history lists payment');
    const strict = r.world.evaluate(f.episodeId, { confirmation }); assert.equal(strict.checks.no_failed_attempts, false, 'declines are rejected by the strict grader');
    const clean = await enter('malden-signed-card-pay-v1'); await login(); await go('/wipp/pay/1001048', 'Make Payment');
    await click('input[name=methodType][value=card]'); await click('input[name=amountChoice][value=other]'); await fill('amount', '50.00'); await click('input[name=terms]'); await click('form[data-form=pay] button[type=submit]');
    await nav('[data-transfer] a', 'Payment Details'); await click('input[name=source][value="saved:alex-card-4242"]'); await submitNav('details', 'Review Payment'); await click('input[name=authorize]'); await submitNav('submit', 'Confirmation');
    const c2 = await page.$eval('[data-confirmation]', e => e.textContent.trim());
    assert.equal(finish(clean, { confirmation: 'MCPW-000000' }).success, false);
    const f3 = await enter('malden-signed-card-pay-v1'); await login(); await go('/wipp/pay/1001048', 'Make Payment');
    await click('input[name=methodType][value=card]'); await click('input[name=amountChoice][value=other]'); await fill('amount', '50.00'); await click('input[name=terms]'); await click('form[data-form=pay] button[type=submit]');
    await nav('[data-transfer] a', 'Payment Details'); await click('input[name=source][value="saved:alex-card-4242"]'); await submitNav('details', 'Review Payment'); await click('input[name=authorize]'); await submitNav('submit', 'Confirmation');
    const c3 = await page.$eval('[data-confirmation]', e => e.textContent.trim());
    const score = finish(f3, { confirmation: c3 }); assert.equal(score.success, true, JSON.stringify(score.checks)); assert.ok(c2);
  });

  await scenario('register-verify-link-ebill', async () => {
    const f = await enter('malden-register-ebill-v1');
    await go('/wipp/home', 'Account Log In'); await nav('a[href="/wipp/create-account"]', 'Create Account'); await audit('create-account');
    for (const [k, v] of Object.entries({ firstName: 'Alex', lastName: 'Morgan', email: 'alex@billworld.test', confirmEmail: 'alex@billworld.test', mobile: '(573) 555-0148', password: 'weakpass', confirmPassword: 'weakpass' })) await fill(k, v);
    await click('form[data-form=register] button[type=submit]'); assert.match(await errorText(), /1 Uppercase|1 Number|Special/);
    await fill('password', 'Registered-2026!'); await fill('confirmPassword', 'Registered-2026!');
    await submitNav('register', 'Verify E-Mail'); await audit('verify');
    await click('[data-resend]'); await page.waitForFunction(() => document.querySelector('[data-error]').textContent.includes('new verification code'));
    const body = await mail('Your new WIPP verification code');
    const codes = [...body.matchAll(/code is (\d{6})/g)].map(m => m[1]);
    await go('/wipp/create-account', 'Verify E-Mail');
    await fill('code', '000000'); await click('form[data-form=verify] button[type=submit]'); assert.match(await errorText(), /valid verification code/);
    await fill('code', codes.at(-1)); await submitNav('verify', 'Success!');
    await nav('a[href="/wipp/summary"]', 'Summary'); assert.match(await page.$eval('main', e => e.textContent), /Complete Account Setup/);
    await nav('a.button[href="/wipp/billing-accounts"]', 'My Billing Accounts');
    await fill('accountId', '1001048'); await fill('balance', '10.00'); await click('form[data-form=add] button[type=submit]'); assert.match(await errorText(), /No Results Found/);
    await fill('balance', '84.32'); await click('form[data-form=add] button[type=submit]'); await page.waitForSelector('[data-link="1001048"]');
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-link="1001048"]'); // pending confirmation persists server-side
    await nav('[data-link="1001048"]', 'My Billing Accounts');
    await nav('.w-nav a[href="/wipp/e-billing"]', 'eBilling'); await audit('ebilling');
    await nav('button[aria-label="Enroll 1001048 in eBilling"]', 'eBilling');
    assert.match(await page.$eval('main', e => e.textContent), /You're enrolled in eBilling/);
    const score = finish(f); assert.equal(score.success, true, JSON.stringify(score.checks));
  });

  await scenario('registration-existing-email', async () => {
    await enter('malden-guest-pay-v1'); await go('/wipp/create-account', 'Create Account');
    for (const [k, v] of Object.entries({ firstName: 'Alex', lastName: 'Morgan', email: 'alex@billworld.test', confirmEmail: 'alex@billworld.test', password: 'Registered-2026!', confirmPassword: 'Registered-2026!' })) await fill(k, v);
    await click('form[data-form=register] button[type=submit]'); await page.waitForSelector('#exists-h');
    assert.match(await page.$eval('[data-exists]', e => e.textContent), /already exists/);
  });

  await scenario('password-recovery', async () => {
    const f = await enter('malden-recover-login-v1');
    await go('/wipp/home', 'Account Log In'); await nav('a[href="/wipp/password"]', 'Forgot Password'); await audit('forgot');
    await fill('email', 'alex@billworld.test'); await submitNav('forgot', 'Reset Password');
    const body = await mail('WIPP temporary password'); const temp = body.match(/temporary password is: (\S+) \(copy/)[1];
    // Logging in with the temporary password requires the reset form.
    await go('/wipp/home', 'Account Log In'); await fill('email', 'alex@billworld.test'); await fill('password', temp); await submitNav('login', 'Reset Password'); await audit('reset');
    await fill('tempPassword', temp); await fill('password', 'Billworld-2026!'); await fill('confirmPassword', 'Billworld-2026!');
    await click('form[data-form=reset] button[type=submit]'); assert.match(await errorText(), /Previous passwords cannot be reused/);
    await fill('password', 'Restored-2026!'); await fill('confirmPassword', 'Restored-2026!'); await submitNav('reset', 'Account Log In');
    await fill('email', 'alex@billworld.test'); await fill('password', 'Billworld-2026!'); await click('form[data-form=login] button[type=submit]'); assert.match(await errorText(), /Invalid user credentials/);
    await fill('password', 'Restored-2026!'); await submitNav('login', 'Summary');
    const score = finish(f); assert.equal(score.success, true, JSON.stringify(score.checks));
  });

  await scenario('schedule-delete-and-create', async () => {
    const f = await enter('malden-schedule-payment-v1'); await login();
    await nav('a[aria-label="View/Pay Account 1001048"]', 'Utility Account 1001048');
    await click('button[aria-label^="Delete Scheduled Payment of $25.00"]'); await page.waitForSelector('[data-yes]'); await audit('delete-sched');
    await nav('[data-yes]', 'Utility Account 1001048');
    assert.match(await page.$eval('main', e => e.textContent), /No upcoming scheduled payments/);
    await nav('a[href="/wipp/pay/1001048"]', 'Make Payment');
    await click('input[name=methodType][value=echeck]'); await click('input[name=when][value=later]');
    await page.$eval('[name=date]', e => { e.value = '2026-10-09'; }); await click('input[name=terms]'); await click('form[data-form=pay] button[type=submit]');
    await nav('[data-transfer] a', 'Payment Details');
    assert.equal(await page.$('input[name=source][value=new]'), null, 'scheduled payments use saved methods');
    await submitNav('details', 'Review Payment'); await click('input[name=authorize]'); await submitNav('submit', 'Confirmation');
    assert.match(await page.$eval('main', e => e.textContent), /will be paid on 10\/09\/2026/);
    const score = finish(f, { scheduledDate: '2026-10-09' }); assert.equal(score.success, true, JSON.stringify(score.checks));
  });

  await scenario('schedule-edit-and-execute', async () => {
    const f = await enter('malden-schedule-payment-v1'); await login();
    await go('/wipp/view/utility/1001048', 'Utility Account 1001048');
    await click('button[aria-label^="Edit Scheduled Payment of $25.00"]'); await page.waitForSelector('form[data-form=edit-sched]');
    await fill('amount', '30.00', 'form[data-form=edit-sched]'); await page.$eval('form[data-form=edit-sched] [name=date]', e => { e.value = '2026-10-07'; });
    await nav('form[data-form=edit-sched] button[type=submit]', 'Utility Account 1001048');
    assert.match(await page.$eval('main', e => e.textContent), /A payment of \$30\.00 will be paid on 10\/07\/2026/);
    r.world.advance(f.episodeId, 5 * 86400000);
    await go('/wipp/summary', 'Account Log In'); // virtual time expired the session
    await login(); await go('/wipp/view/utility/1001048', 'Utility Account 1001048');
    const text = await page.$eval('main', e => e.textContent);
    assert.match(text, /\$30\.00Checking ending 1048Scheduled/); assert.match(text, /Account Total\$54\.32/);
  });

  await scenario('autopay-enroll-direct-withdrawal-conflict', async () => {
    const f = await enter('malden-autopay-enroll-v1'); await login();
    await nav('.w-nav a[href="/wipp/auto-pay"]', 'AutoPay'); await audit('autopay'); await shot('autopay');
    const text = await page.$eval('main', e => e.textContent);
    assert.match(text, /This Account cannot be enrolled in AutoPay because it is already enrolled in Direct Withdrawal/);
    const status = await page.evaluate(async () => (await fetch('/api/wipp/autopay/enroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: '1001050', methodId: 'alex-bank-1048' }) })).status);
    assert.equal(status, 409);
    await page.select('form[data-account="1001048"] [name=methodId]', 'alex-bank-1048');
    await nav('button[aria-label="Enroll 1001048 in AutoPay"]', 'AutoPay');
    assert.match(await page.$eval('#ap-1001048', e => e.parentElement.textContent), /You're enrolled in AutoPay using Checking ending 1048/);
    await nav('a[href="/wipp/direct-withdrawal"]', 'ACH Direct Withdrawal');
    await go('/wipp/pay/1001048', 'Make Payment');
    assert.match(await page.$eval('main', e => e.textContent), /A scheduled AutoPay payment may still process/);
    await go('/wipp/auto-pay', 'AutoPay');
    const score = finish(f); assert.equal(score.success, true, JSON.stringify(score.checks));
  });

  await scenario('autopay-change', async () => {
    const f = await enter('malden-autopay-change-v1'); await login(); await go('/wipp/auto-pay', 'AutoPay');
    await page.select('form[data-account="1001048"] [name=methodId]', 'alex-card-4242');
    await nav('button[aria-label="Save AutoPay payment method for 1001048"]', 'AutoPay');
    assert.match(await page.$eval('main', e => e.textContent), /You're enrolled in AutoPay using Visa ending 4242/);
    const score = finish(f); assert.equal(score.success, true, JSON.stringify(score.checks));
  });

  await scenario('autopay-cancel', async () => {
    const f = await enter('malden-autopay-cancel-v1'); await login(); await go('/wipp/auto-pay', 'AutoPay');
    await click('button[aria-label="Unenroll 1001048 from Autopay"]'); await page.waitForSelector('#un-h'); await audit('unenroll');
    await nav('[data-yes]', 'AutoPay');
    assert.match(await page.$eval('#ap-1001048', e => e.parentElement.textContent), /Not enrolled in AutoPay/);
    const score = finish(f); assert.equal(score.success, true, JSON.stringify(score.checks));
  });

  await scenario('autopay-executes-and-late-fee', async () => {
    const f = await enter('malden-autopay-change-v1'); // seeded enrollment with checking
    r.world.advance(f.episodeId, 8 * 86400000); // past the Oct 10 due date
    await login(); await go('/wipp/view/utility/1001048', 'Utility Account 1001048');
    const text = await page.$eval('main', e => e.textContent); assert.match(text, /AutoPay/); assert.match(text, /Account Total\$0\.00/);
    const g = await enter('malden-signed-card-pay-v1');
    r.world.advance(g.episodeId, 8 * 86400000); await login(); await go('/wipp/view/utility/1001048', 'Utility Account 1001048');
    const late = await page.$eval('main', e => e.textContent); assert.match(late, /Late Charge \(5%\)\$4\.22/); assert.match(late, /Payment is overdue/);
    r.world.advance(g.episodeId, 16 * 86400000); await login(); await go('/wipp/view/utility/1001048', 'Utility Account 1001048');
    assert.match(await page.$eval('main', e => e.textContent), /Service Disconnected/);
  });

  await scenario('statement', async () => {
    const f = await enter('malden-view-bill-v1'); await login();
    await go('/wipp/view/utility/1001048', 'Utility Account 1001048');
    await nav('a[href="/wipp/bill/1001048"]', 'City of Malden Board of Public Works — Utility Bill'); await audit('bill'); await shot('bill');
    assert.equal(await page.$eval('[data-due]', e => e.textContent), '10/10/2026');
    assert.match(await page.$eval('[data-balance]', e => e.textContent), /\$84\.32/);
    const score = finish(f, { billingDate: '2026-10-10', remainingBalanceCents: 8432 }); assert.equal(score.success, true, JSON.stringify(score.checks));
  });

  await scenario('wallet-ebilling-profile', async () => {
    await enter('malden-guest-pay-v1'); await login();
    await nav('.w-nav a[href="/wipp/e-wallet"]', 'My Payment Methods'); await nav('a[href="/wipp/e-wallet?add=card"]', 'My Payment Methods'); await audit('wallet-add');
    for (const [k, v] of Object.entries({ name: 'Alex Morgan', cardNumber: '5555555555554444', expiry: '11/30', cvv: '321', address: '1048 N Douglass St', city: 'Malden', state: 'MO', zip: '63863' })) await fill(k, v);
    await nav('form[data-form=add] button[type=submit]', 'My Payment Methods');
    assert.match(await page.$eval('main', e => e.textContent), /Mastercard ending 4444/);
    await click('button[aria-label="Edit Mastercard ending 4444"]'); await fill('nickname', 'Backup card', 'form[data-form=edit]'); await nav('form[data-form=edit] button[type=submit]', 'My Payment Methods');
    assert.match(await page.$eval('main', e => e.textContent), /Backup card/);
    await click('button[aria-label="Remove Mastercard ending 4444"]'); await nav('[data-yes]', 'My Payment Methods');
    assert.doesNotMatch(await page.$eval('main', e => e.textContent), /ending 4444/);
    await nav('a[href="/wipp/e-wallet?add=bank"]', 'My Payment Methods');
    for (const [k, v] of Object.entries({ name: 'Alex Morgan', routing: '021000021', accountNumber: '55551048', confirmAccountNumber: '55551049', address: '1048 N Douglass St', city: 'Malden', state: 'MO', zip: '63863' })) await fill(k, v);
    await click('form[data-form=add] button[type=submit]'); assert.match(await errorText(), /Account numbers do not match/);
    await go('/wipp/e-billing', 'eBilling'); await click('form[data-account="1001050"] [name=printed]'); await nav('button[aria-label="Enroll 1001050 in eBilling"]', 'eBilling');
    assert.match(await page.$eval('main', e => e.textContent), /also receiving a printed bill/);
    await nav('button[aria-label="Unenroll 1001050 from eBilling"]', 'eBilling');
    await nav('.w-nav a[href="/wipp/profile"]', 'Profile'); await audit('profile');
    await fill('mobile', '(573) 555-0199', 'form[data-form=profile]'); await click('form[data-form=profile] button[type=submit]');
    await page.waitForFunction(() => document.querySelector('[data-error]').textContent.includes('Profile saved'));
    await nav('[data-logout]', 'Account Log In');
  });

  await scenario('portal-routes-require-login', async () => {
    await enter('malden-guest-pay-v1');
    for (const p of ['/wipp/summary', '/wipp/auto-pay', '/wipp/e-wallet', '/wipp/bill/1001048']) { await go(p, 'Account Log In'); }
    const status = await page.evaluate(async () => (await fetch('/api/pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status);
    assert.equal(status, 404, 'generic engine shortcuts are unavailable');
    await go('/wipp/view/utility/2002099'); await page.waitForSelector('[role=alert]');
  });
} finally {
  report.passed = report.scenarios.length > 0 && report.scenarios.every(s => s.passed) && report.page_errors.length === 0 && report.outbound_requests.length === 0 && report.unnamed_controls.length === 0;
  writeFileSync(new URL('results.json', dir), JSON.stringify(report, null, 2));
  await browser?.close(); await r.close();
  console.log(JSON.stringify({ passed: report.passed, scenarios: report.scenarios.length, failed: report.scenarios.filter(s => !s.passed).map(s => s.name), page_errors: report.page_errors, outbound: report.outbound_requests, unnamed: report.unnamed_controls }, null, 1));
  if (!report.passed) process.exitCode = 1;
}
