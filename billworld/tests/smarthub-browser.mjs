import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start } from '../server.mjs';
const temp = mkdtempSync(join(tmpdir(), 'billworld-smarthub-'));
const server = await start({ port: 0, adminPort: 0, dbPath: join(temp, 'world.sqlite') });
const browser = await puppeteer.launch({ headless: true });
const artifacts = new URL('../artifacts/smarthub/', import.meta.url); mkdirSync(artifacts, { recursive: true });
const results = [], errors = [], outbound = []; let activePage;
const heading = (page, text) => page.waitForFunction(t => document.querySelector('h1')?.textContent === t, {}, text);
const fill = async (page, data) => { for (const [name, value] of Object.entries(data)) await page.locator(`[name="${name}"]`).fill(value); };
const submit = async (page, action, title) => { await page.locator(`form[data-action="${action}"] button:not([type="button"])`).click(); if (title) await heading(page, title); };
const go = async (page, route, title) => { await page.goto(`${server.baseUrl}/smarthub/ui/#/${route}`); if (title) await heading(page, title); };
async function episode(options = {}) {
  const fixture = server.world.create({ siteId: 'avec-electric', ...options }); const context = await browser.createBrowserContext(); const page = await context.newPage();
  await page.setViewport({ width: 1365, height: 900 }); await page.setRequestInterception(true);
  page.on('request', r => { if (r.url().startsWith(server.baseUrl + '/') || r.url().startsWith('data:')) r.continue(); else { outbound.push(r.url()); r.abort(); } });
  activePage = page;
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.baseUrl}/enter/${fixture.episodeId}/${fixture.entryToken}`); await heading(page, 'Alaska Village SmartHub'); return { fixture, context, page };
}
async function login(page, password = 'Billworld-2026!') { await go(page, 'login', 'Alaska Village SmartHub'); await fill(page, { email: 'alex@billworld.test', password });  await submit(page, 'hub-login', 'HOME'); }
async function bankReview(page, guest = false) {
  await go(page, 'makeAPayment', 'MAKE A PAYMENT');
  if (guest) await fill(page, { name: 'Alex Morgan', routing: '021000021', accountNumber: '000001048' });
  else await page.select('[name="methodId"]', 'bank-1048');
  await submit(page, 'hub-quote', 'REVIEW PAYMENT');
}
async function run(name, fn) { const begin = Date.now(); try { await fn(); } catch (error) { console.log('FAILED UI', activePage.url(), await activePage.$eval('main', el => el.textContent)); await activePage.screenshot({ path: new URL('failure.png', artifacts).pathname, fullPage: true }); throw error; } results.push({ name, passed: true, milliseconds: Date.now() - begin }); console.log('PASS ' + name); }
try {
  await run('SmartHub guest surname lookup, refresh, payment and scored confirmation', async () => {
    const { page, context, fixture } = await episode(); await go(page, 'paynow', 'Welcome to the Pay Now Site');
    await fill(page, { customerNumber: '1001048', lastName: 'Lee' }); await submit(page, 'hub-lookup'); await page.waitForFunction(() => document.querySelector('#error').textContent.includes('verified'));
    await fill(page, { lastName: 'Morgan' }); await submit(page, 'hub-lookup', 'MAKE A PAYMENT'); await page.reload(); await heading(page, 'MAKE A PAYMENT');
    await bankReview(page, true); await submit(page, 'hub-pay', 'PAYMENT CONFIRMATION'); const confirmation = await page.$eval('#confirmation', el => el.textContent);
    assert.equal(server.world.evaluate(fixture.episodeId, { confirmation }).success, true); assert.equal(server.world.state(fixture.episodeId).payments.filter(p => !p.initial).length, 1);
    await page.screenshot({ path: new URL('guest-confirmation.png', artifacts).pathname, fullPage: true }); await context.close();
  });
  await run('SmartHub registration verifies identity then signs in with the new password', async () => {
    const { page, context } = await episode({ registered: false }); await go(page, 'registration', 'ACCOUNT REGISTRATION');
    await page.screenshot({ path: new URL('registration.png', artifacts).pathname, fullPage: true });
    await fill(page, { customerNumber: '1001048', lastName: 'Morgan', email: 'alex@billworld.test', confirmEmail: 'alex@billworld.test' }); await submit(page, 'hub-registration-start', 'VERIFY ACCOUNT DETAILS');
    await fill(page, { ssnLast4: '9999', phone: '9075550148', password: 'Registered-2026!', confirmPassword: 'Registered-2026!' }); await submit(page, 'hub-registration-finish'); await page.waitForFunction(() => document.querySelector('#error').textContent.includes('do not match'));
    await fill(page, { ssnLast4: '1048' }); await submit(page, 'hub-registration-finish', 'HOME'); await go(page, 'logout', 'Alaska Village SmartHub'); await login(page, 'Registered-2026!'); await context.close();
  });
  await run('SmartHub recovery reads the reset link in upstream Gmail and signs in', async () => {
    const { page, context } = await episode(); await go(page, 'accountAccess', 'ACCOUNT ACCESS');
    await fill(page, { customerNumber: '1001048', lastName: 'Morgan', email: 'alex@billworld.test' }); await submit(page, 'hub-recover'); await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('sent'));
    await page.goto(server.baseUrl + '/mail'); await heading(page, 'Sign in to Gmail'); await fill(page, { email: 'alex@billworld.test', password: 'Mailbox-2026!' }); await submit(page, 'mail-login', 'Inbox');
    await page.locator('[data-testid="email-item-3"] .email-content').click(); await page.locator('a[href^="/portal/reset?token="]').click(); await heading(page, 'RESET PASSWORD');
    await fill(page, { password: 'Restored-2026!', confirmPassword: 'Restored-2026!' }); await submit(page, 'hub-reset', 'Alaska Village SmartHub'); await login(page, 'Restored-2026!'); await context.close();
  });
  await run('SmartHub sign-in, saved bank payment, history and logout', async () => {
    const { page, context } = await episode(); await page.screenshot({ path: new URL('login.png', artifacts).pathname, fullPage: true }); await login(page);
    await bankReview(page); await submit(page, 'hub-pay', 'PAYMENT CONFIRMATION'); const confirmation = await page.$eval('#confirmation', el => el.textContent);
    await go(page, 'paymentHistory', 'PAYMENT HISTORY'); assert.match(await page.$eval('main', el => el.textContent), new RegExp(confirmation));
    await go(page, 'logout', 'Alaska Village SmartHub'); await go(page, 'paymentHistory', 'Alaska Village SmartHub'); await context.close();
  });
  await run('SmartHub schedule edit/cancel and chosen Auto Pay day execution', async () => {
    const { page, context, fixture } = await episode(); await login(page); await bankReview(page); await fill(page, { date: '2026-10-12' }); await submit(page, 'hub-schedule', 'SCHEDULED PAYMENTS');
    await fill(page, { date: '2026-10-13' }); await submit(page, 'hub-edit-schedule'); await page.waitForFunction(() => document.querySelector('[name="date"]').value === '2026-10-13');
    await page.locator('[data-cancel]').click(); await page.waitForFunction(() => document.querySelector('main').textContent.includes('cancelled'));
    await go(page, 'autoPay', 'AUTO PAY'); await page.select('[name="enabled"]', 'yes'); await page.select('[name="methodId"]', 'bank-1048'); await fill(page, { day: '15' }); await submit(page, 'hub-autopay'); await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('saved'));
    await page.reload(); await heading(page, 'AUTO PAY'); assert.equal(await page.$eval('[name="day"]', el => el.value), '15');
    server.world.advance(fixture.episodeId, Date.parse('2026-10-15T00:00:00Z') - server.world.state(fixture.episodeId).now);
    await login(page); await go(page, 'paymentHistory', 'PAYMENT HISTORY'); assert.match(await page.$eval('main', el => el.textContent), /posted/); await context.close();
  });
  assert.deepEqual(errors, []); assert.deepEqual(outbound, []); writeFileSync(new URL('results.json', artifacts), JSON.stringify({ kind: 'reference_script', results, errors, outbound }, null, 2));
  console.log(`${results.length} SmartHub browser scenarios passed; no page errors or external requests.`);
} finally { await browser.close(); await server.close(); rmSync(temp, { recursive: true, force: true }); }
