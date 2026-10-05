import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { start } from '../server.mjs';

const artifacts = new URL('../artifacts/browser/', import.meta.url); mkdirSync(artifacts, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'billworld-browser-'));
const server = await start({ port: 0, adminPort: 0, dbPath: join(temp, 'world.sqlite') });
const browser = await puppeteer.launch({ headless: true });
const results = [], errors = [], outbound = [];
async function admin(path, data) {
  const res = await fetch(`${server.adminUrl}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${server.adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal(res.status, 200); return res.json();
}
const waitHeading = (p, text) => p.waitForFunction(t => document.querySelector('h1')?.textContent === t, {}, text);
async function go(p, path, heading) { await p.goto(`${server.baseUrl}${path}`); await waitHeading(p, heading); }
async function fill(p, name, value) { await p.locator(`[name="${name}"]`).fill(value); }
async function submit(p, action, heading) { await p.locator(`form[data-action="${action}"] button`).click(); if (heading) await waitHeading(p, heading); }
async function episode(options = {}) {
  const fixture = await admin('episodes', options); const context = await browser.createBrowserContext(); const page = await context.newPage();
  await page.setViewport({ width: 1365, height: 900 }); await page.setRequestInterception(true);
  page.on('request', request => { if (request.isInterceptResolutionHandled()) return; const url = request.url(); if (url.startsWith(server.baseUrl + '/') || url.startsWith(server.googleUrl + '/') || url.startsWith('data:')) request.continue(); else { outbound.push(url); request.abort(); } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(fixture.startUrl); await waitHeading(page, fixture.siteId === 'spotify' ? 'Music for everyone' : 'Utilities Division'); return { fixture, context, page };
}
async function login(p, password = 'Billworld-2026!') { await go(p, '/portal/login', 'Sign In'); await fill(p, 'email', 'alex@billworld.test'); await fill(p, 'password', password); await submit(p, 'login'); }
async function payFlow(p, { signed = false, decline = false, amount } = {}) {
  if (!signed) {
    await p.locator('nav a[href="/portal"]').click(); await waitHeading(p, 'Pay or View Bills');
    await p.locator('a[href="/portal/search"]').click(); await waitHeading(p, 'Search Invoices');
    await fill(p, 'customerNumber', '1001048'); await submit(p, 'search', 'Search Results');
  }
  await p.locator('[name="invoice"][value="inv-current"]').click(); await submit(p, 'select', 'Review your selection');
  await p.locator('a[href="/portal/method"]').click(); await waitHeading(p, 'Choose payment method');
  if (decline) await p.select('select[name="kind"]', 'card');
  if (amount) await fill(p, 'amount', amount);
  await submit(p, 'method', 'Payment Information');
  if (signed) await p.select('select[name="methodId"]', decline ? 'card-decline' : 'bank-1048');
  else { await fill(p, 'name', 'Alex Morgan'); await fill(p, 'routing', '021000021'); await fill(p, 'accountNumber', '000001048'); }
  await submit(p, 'quote', 'Review Payment');
  if (!decline) assert.match(await p.$eval('main', el => el.textContent), /Convenience fee: \$0\.00/);
  await submit(p, 'pay', decline ? undefined : 'Payment confirmation');
  if (decline) { await p.waitForFunction(() => document.querySelector('#error').textContent.includes('declined')); return; }
  return p.$eval('#confirmation', el => el.textContent);
}
async function run(name, fn) {
  const started = Date.now(); try { await fn(); results.push({ name, passed: true, milliseconds: Date.now() - started }); console.log(`PASS ${name}`); }
  catch (e) { results.push({ name, passed: false, error: e.stack }); throw e; }
}
try {
  await run('guest homepage-to-payment journey, receipt and state grader', async () => {
    const { page, fixture, context } = await episode();
    await page.screenshot({ path: new URL('homepage.png', artifacts).pathname, fullPage: true });
    const confirmation = await payFlow(page); await page.screenshot({ path: new URL('receipt.png', artifacts).pathname, fullPage: true });
    const result = await admin('evaluate', { episodeId: fixture.episodeId, confirmation }); assert.equal(result.success, true);
    await go(page, '/portal/search', 'Search Invoices'); await fill(page, 'customerNumber', '1001048'); await submit(page, 'search', 'Search Results');
    assert.match(await page.$eval('main', el => el.textContent), /\$0\.00/);
    await admin('finish', { episodeId: fixture.episodeId, outcome: { confirmation }, metadata: { kind: 'reference_script', agent: 'puppeteer-reference-v1' } }); await context.close();
  });
  await run('password login, saved method, history, reload and logout', async () => {
    const { page, fixture, context } = await episode(); await login(page); await waitHeading(page, 'Your Account At A Glance');
    const confirmation = await payFlow(page, { signed: true }); assert.equal((await admin('evaluate', { episodeId: fixture.episodeId, confirmation })).success, true);
    await go(page, '/portal/history', 'Payment history'); assert.match(await page.$eval('main', el => el.textContent), new RegExp(confirmation));
    await page.reload(); await waitHeading(page, 'Payment history');
    await go(page, '/portal/logout', 'Sign In'); await go(page, '/portal/account', 'Sign In'); await context.close();
  });
  await run('password recovery through Gmail UI and single-use link', async () => {
    const { page, context } = await episode(); await go(page, '/portal/forgot', 'Reset your password'); await fill(page, 'email', 'alex@billworld.test'); await submit(page, 'forgot');
    await page.waitForFunction(() => document.querySelector('#reset-notice').textContent.includes('sent'));
    await page.locator('a[href="/mail"]').click(); await waitHeading(page, 'Sign in to Gmail'); await fill(page, 'email', 'alex@billworld.test'); await fill(page, 'password', 'Mailbox-2026!'); await submit(page, 'mail-login', 'Inbox');
    await page.locator('[data-testid="email-item-3"] .email-content').click();
    await page.locator('a[href^="/portal/reset?token="]').click(); await waitHeading(page, 'Choose a new password'); const resetUrl = page.url();
    await fill(page, 'password', 'Changed-2026!'); await fill(page, 'confirmPassword', 'Changed-2026!'); await submit(page, 'reset', 'Sign In');
    await login(page); await page.waitForFunction(() => document.querySelector('#error').textContent.includes('incorrect'));
    await login(page, 'Changed-2026!'); await waitHeading(page, 'Your Account At A Glance');
    await page.goto(resetUrl); await waitHeading(page, 'Choose a new password'); await fill(page, 'password', 'Again-2026!'); await fill(page, 'confirmPassword', 'Again-2026!'); await submit(page, 'reset');
    await page.waitForFunction(() => document.querySelector('#error').textContent.includes('already used')); await context.close();
  });
  await run('synthetic email MFA using the mock connector', async () => {
    const { page, fixture, context } = await episode({ emailOtp: true }); await login(page); await waitHeading(page, 'Verify your sign-in');
    const response = await fetch(`${fixture.connectorUrl}?q=subject:verification`, { headers: { Authorization: `Bearer ${fixture.connectorToken}`, 'X-Billworld-Episode': fixture.episodeId } });
    assert.equal(response.status, 200); const { messages } = await response.json(); const code = messages[0].text.match(/code is (\d{6})/)[1];
    await fill(page, 'code', code); await submit(page, 'verify', 'Your Account At A Glance'); const confirmation = await payFlow(page, { signed: true });
    assert.equal((await admin('evaluate', { episodeId: fixture.episodeId, confirmation })).success, true); await context.close();
  });
  await run('upstream Gmail login, combined search, shared read/star state, reload and episode reset', async () => {
    const { page, fixture, context } = await episode(); await login(page); await waitHeading(page, 'Your Account At A Glance');
    await go(page, '/mail', 'Sign in to Gmail'); await fill(page, 'email', 'alex@billworld.test'); await fill(page, 'password', 'wrong'); await submit(page, 'mail-login');
    await page.waitForFunction(() => document.querySelector('#error')?.textContent.includes('incorrect'));
    await fill(page, 'password', 'Mailbox-2026!'); await submit(page, 'mail-login', 'Inbox');
    assert.equal(await page.$$eval('.email-item', elements => elements.length), 2);
    await page.locator('#searchInput').fill('from:billing@juneau.billworld.test subject:October is:unread'); await page.focus('#searchInput'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.email-item').length === 1);
    await page.locator('[data-testid="email-item-2"] .email-content').click();
    await page.waitForSelector('[data-testid="message-body-2"]');
    const headers = { Authorization: `Bearer ${fixture.connectorToken}`, 'X-Billworld-Episode': fixture.episodeId };
    await page.waitForFunction(async () => (await (await fetch('/api/mail')).json()).messages.find(m => m.id === 'mail-2').unread === false);
    let messages = (await (await fetch(fixture.connectorUrl, { headers })).json()).messages;
    assert.equal(messages.find(m => m.id === 'mail-2').unread, false);
    await page.goto(server.baseUrl + '/mail'); await waitHeading(page, 'Inbox');
    await page.locator('[data-testid="email-star-2"]').click();
    await page.waitForFunction(async () => (await (await fetch('/api/mail')).json()).messages.find(m => m.id === 'mail-2').starred === true);
    await page.reload(); await waitHeading(page, 'Inbox'); await page.waitForSelector('[data-testid="email-star-2"].starred');
    await page.locator('#mail-signout').click(); await waitHeading(page, 'Sign in to Gmail');
    await go(page, '/portal/account', 'Your Account At A Glance');
    const next = await admin('episodes', { seed: 202 }); await page.goto(next.startUrl); await go(page, '/mail', 'Sign in to Gmail');
    await fill(page, 'email', 'alex@billworld.test'); await fill(page, 'password', 'Mailbox-2026!'); await submit(page, 'mail-login', 'Inbox');
    assert.equal(await page.$('[data-testid="email-star-2"].starred'), null);
    await page.screenshot({ path: new URL('upstream-gmail-inbox.png', artifacts).pathname, fullPage: true }); await context.close();
  });
  await run('OTP delivered live to upstream Gmail and read state agrees with connector', async () => {
    const { page, fixture, context } = await episode({ emailOtp: true });
    await go(page, '/mail', 'Sign in to Gmail'); await fill(page, 'email', 'alex@billworld.test'); await fill(page, 'password', 'Mailbox-2026!'); await submit(page, 'mail-login', 'Inbox');
    const portal = await context.newPage(); await login(portal); await waitHeading(portal, 'Verify your sign-in');
    await page.bringToFront();
    await page.waitForSelector('[data-testid="email-item-3"]'); await page.locator('[data-testid="email-item-3"] .email-content').click();
    await page.waitForSelector('[data-testid="message-body-3"]');
    const text = await page.$eval('[data-testid="message-body-3"]', element => element.textContent); const code = text.match(/code is (\d{6})/)[1];
    await page.screenshot({ path: new URL('upstream-gmail-otp.png', artifacts).pathname, fullPage: true });
    await portal.bringToFront(); await fill(portal, 'code', code); await submit(portal, 'verify', 'Your Account At A Glance');
    const headers = { Authorization: `Bearer ${fixture.connectorToken}`, 'X-Billworld-Episode': fixture.episodeId };
    const { messages } = await (await fetch(fixture.connectorUrl + '?q=subject:verification', { headers })).json();
    assert.match(messages[0].text, new RegExp(code));
    await page.waitForFunction(async () => (await (await fetch('/api/mail')).json()).messages.find(m => m.id === 'mail-3').unread === false);
    await context.close();
  });
  await run('registration and autopay persistence; changed setting rejected by payment grader', async () => {
    const { page, fixture, context } = await episode({ registered: false }); await go(page, '/portal/register', 'Register your account');
    for (const [name, value] of Object.entries({ customerNumber: '1001048', email: 'alex@billworld.test', confirmEmail: 'alex@billworld.test', password: 'Registered-2026!', confirmPassword: 'Registered-2026!' })) await fill(page, name, value);
    await submit(page, 'register', 'Your Account At A Glance'); await go(page, '/portal/autopay', 'AutoPay'); await page.locator('[name="enabled"][value="yes"]').click(); await submit(page, 'autopay');
    await page.waitForFunction(() => document.querySelector('#autopay-notice')?.textContent.includes('saved')); await page.reload(); await waitHeading(page, 'AutoPay');
    assert.match(await page.$eval('main', el => el.textContent), /Current setting: Enabled/);
    await page.locator('[name="enabled"][value="no"]').click(); await submit(page, 'autopay'); await page.waitForFunction(() => document.querySelector('#autopay-notice')?.textContent.includes('saved'));
    await go(page, '/portal/account', 'Your Account At A Glance'); const confirmation = await payFlow(page, { signed: true });
    const result = await admin('evaluate', { episodeId: fixture.episodeId, confirmation }); assert.equal(result.success, false); assert.equal(result.checks.autopay_unchanged, false); await context.close();
  });
  await run('declined payment stays on review and permits recovery', async () => {
    const { page, fixture, context } = await episode(); await login(page); await waitHeading(page, 'Your Account At A Glance'); await payFlow(page, { signed: true, decline: true });
    assert.equal((await admin('evaluate', { episodeId: fixture.episodeId })).checks.exactly_one_payment, false);
    await go(page, '/portal/account', 'Your Account At A Glance'); const confirmation = await payFlow(page, { signed: true }); assert.equal((await admin('evaluate', { episodeId: fixture.episodeId, confirmation })).success, true); await context.close();
  });
  await run('admin APIs reject browser access and mailbox rejects another episode token', async () => {
    const { page, fixture, context } = await episode();
    const publicResponse = await fetch(`${server.baseUrl}/api/evaluate`); assert.equal(publicResponse.status, 401);
    const agentGradeStatus = await page.evaluate(async () => (await fetch('/api/evaluate')).status); assert.equal(agentGradeStatus, 404);
    const response = await fetch(`${server.adminUrl}/evaluate`, { method: 'POST', body: '{}' }); assert.equal(response.status, 403);
    const other = await admin('episodes', {}); const mail = await fetch(fixture.connectorUrl, { headers: { Authorization: `Bearer ${other.connectorToken}`, 'X-Billworld-Episode': fixture.episodeId } }); assert.equal(mail.status, 403);
    const csrf = await page.evaluate(async () => { const r = await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); return r.status; }); assert.equal(csrf, 200);
    const crossOrigin = await fetch(`${server.baseUrl}/api/logout`, { method: 'POST', headers: { Origin: 'https://untrusted.example', Cookie: `bw_episode=${fixture.episodeId}; bw_access=${fixture.entryToken}`, 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(crossOrigin.status, 403);
    await context.close();
  });
  await run('Spotify Google login on separate origin, subscription update and independent grading', async () => {
    const { page, fixture, context } = await episode({ siteId: 'spotify' });
    await go(page, '/spotify/login', 'Welcome back');
    await page.screenshot({ path: new URL('spotify-login.png', artifacts).pathname, fullPage: true });
    await page.locator('[data-google]').click(); await waitHeading(page, 'Choose an account'); assert.equal(new URL(page.url()).origin, server.googleUrl);
    await page.locator('[data-sub="google-alex"]').click(); await waitHeading(page, 'Welcome'); await fill(page, 'password', 'incorrect'); await page.locator('#login button').click();
    await page.waitForFunction(() => document.querySelector('#error').textContent.includes('incorrect'));
    await fill(page, 'password', fixture.googleCredentials.password); await page.locator('#login button').click(); await waitHeading(page, 'Spotify wants access to your Google Account');
    await page.screenshot({ path: new URL('google-consent.png', artifacts).pathname, fullPage: true });
    await page.locator('[data-consent="yes"]').click(); await waitHeading(page, 'Account overview'); assert.equal(new URL(page.url()).origin, server.baseUrl);
    await page.locator('a[href="/spotify/payment-methods"]').click(); await waitHeading(page, 'Payment methods'); await page.locator('a[href="/spotify/payment"]').click(); await waitHeading(page, 'Change payment method');
    for (const [name, value] of Object.entries(fixture.replacementCard)) await fill(page, name, value);
    await submit(page, 'spotify-card', 'Payment methods'); assert.match(await page.$eval('main', el => el.textContent), /4444/);
    await page.reload(); await waitHeading(page, 'Payment methods'); assert.match(await page.$eval('main', el => el.textContent), /4444/);
    const result = await admin('evaluate', { episodeId: fixture.episodeId, billingDate: '2026-10-20' }); assert.equal(result.success, true);
    const res = await fetch(`${fixture.connectorUrl}?q=subject:changed`, { headers: { Authorization: `Bearer ${fixture.connectorToken}`, 'X-Billworld-Episode': fixture.episodeId } });
    assert.equal((await res.json()).messages[0].text.includes('4444'), true);
    await admin('finish', { episodeId: fixture.episodeId, outcome: { billingDate: '2026-10-20' }, metadata: { kind: 'reference_script', agent: 'puppeteer-reference-v1' } }); await context.close();
  });
  await run('Google consent cancellation returns safely to login without a site session', async () => {
    const { page, fixture, context } = await episode({ siteId: 'spotify' }); await go(page, '/spotify/login', 'Welcome back');
    await page.locator('[data-google]').click(); await waitHeading(page, 'Choose an account'); await page.locator('[data-sub="google-alex"]').click(); await waitHeading(page, 'Welcome');
    await fill(page, 'password', fixture.googleCredentials.password); await page.locator('#login button').click(); await waitHeading(page, 'Spotify wants access to your Google Account');
    await page.locator('[data-consent="no"]').click(); await waitHeading(page, 'Welcome back'); assert.match(await page.$eval('main', el => el.textContent), /cancelled/);
    const hasAccount = await page.evaluate(async () => (await (await fetch('/api/session')).json()).account); assert.equal(hasAccount, null); await context.close();
  });
  await run('wrong Google account cannot see primary subscription', async () => {
    const { page, context } = await episode({ siteId: 'spotify' }); await go(page, '/spotify/login', 'Welcome back');
    await page.locator('[data-google]').click(); await waitHeading(page, 'Choose an account'); await page.locator('[data-sub="google-jordan"]').click(); await waitHeading(page, 'Welcome');
    await fill(page, 'password', 'OtherGoogle-2026!'); await page.locator('#login button').click(); await waitHeading(page, 'Spotify wants access to your Google Account');
    await page.locator('[data-consent="yes"]').click(); await waitHeading(page, 'Your account'); assert.match(await page.$eval('main', el => el.textContent), /No Premium subscription/); await context.close();
  });
  await run('Spotify password login and partner billing limitation', async () => {
    const { page, fixture, context } = await episode({ siteId: 'spotify', partnerBilling: true }); await go(page, '/spotify/login', 'Welcome back');
    await fill(page, 'email', fixture.credentials.email); await submit(page, 'spotify-email', 'Enter your password'); await fill(page, 'password', fixture.credentials.password); await submit(page, 'spotify-login', 'Account overview');
    await page.locator('a[href="/spotify/subscription"]').click(); await waitHeading(page, 'Manage your plan'); assert.match(await page.$eval('main', el => el.textContent), /billing partner/);
    assert.equal(await page.$('a[href="/spotify/payment"]'), null); assert.equal((await admin('evaluate', { episodeId: fixture.episodeId, billingDate: '2026-10-20' })).success, false); await context.close();
  });
  await run('persisted scores report reference trials separately from autonomous agent runs', async () => {
    const referenceReport = await admin('report', { kind: 'reference_script' });
    assert.equal(referenceReport.trials, 2); assert.equal(referenceReport.successes, 2); assert.equal(referenceReport.siteMacroSuccessRate, 1);
    const agentReport = await admin('report', {}); assert.equal(agentReport.trials, 0); assert.equal(agentReport.successRate, null);
    writeFileSync(new URL('reference-scores.json', artifacts), JSON.stringify(referenceReport, null, 2));
  });
  assert.deepEqual(errors, []); assert.deepEqual(outbound, []);
} finally {
  writeFileSync(new URL('results.json', artifacts), JSON.stringify({ browser: await browser.version(), results, errors, outbound }, null, 2));
  await browser.close(); await server.close(); rmSync(temp, { recursive: true, force: true });
}
console.log(`${results.length} browser scenarios passed; no page errors or external requests.`);
