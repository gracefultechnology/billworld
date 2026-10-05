import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { start } from '../server.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const prefix = 'biller_c8edde62f56ee14f50e0';
const server = await start({ port: 0, adminPort: 0, dbPath: ':memory:' });
const browser = await puppeteer.launch({ headless: true });
const directory = new URL('../artifacts/batavia-public-browser/', import.meta.url);
mkdirSync(directory, { recursive: true });
const page = await browser.newPage();
await page.setViewport({ width: 1365, height: 900 });
page.setDefaultTimeout(12000);
const report = { kind: 'public_reconstruction_not_runtime', scenarios: [], page_errors: [], outbound_requests: [] };
page.on('pageerror', error => report.page_errors.push(error.message));
await page.setRequestInterception(true);
page.on('request', request => {
  if (request.url().startsWith(server.baseUrl + '/') || request.url().startsWith('data:')) request.continue();
  else { report.outbound_requests.push(request.url()); request.abort(); }
});
const path = kind => '/reference-pages/' + prefix + '-' + kind + '/index.html';
const go = kind => page.goto(server.baseUrl + path(kind), { waitUntil: 'networkidle0' });
const pass = description => { report.scenarios.push(description); console.log('PASS ' + description); };
try {
  await go('website');
  assert.match(await page.title(), /City of Batavia/);
  const billingLink = await page.$$eval('a', (links, target) => links.find(link => link.getAttribute('href') === target && link.getBoundingClientRect().width && link.getBoundingClientRect().height)?.outerHTML, path('billing'));
  assert.ok(billingLink, 'Homepage must expose a visible local billing link');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.evaluate(target => [...document.querySelectorAll('a')].find(link => link.getAttribute('href') === target && link.getBoundingClientRect().width && link.getBoundingClientRect().height).click(), path('billing')),
  ]);
  const text = await page.$eval('body', body => body.innerText);
  assert.match(text, /do not set it up again in Paymentus[\s\S]*duplicate payments/i);
  assert.match(text, /Do not email your enrollment information/i);
  assert.match(text, /not required to use Paymentus for payments/i);
  await page.screenshot({ path: new URL('billing.png', directory).pathname, fullPage: true });
  pass('Homepage reaches billing with distinct city draft and processor AutoPay policies');

  assert.equal(await page.$$eval('a[href]', links => links.some(link => link.href.includes('paymentus.com'))), false);
  assert.ok(await page.$$eval('a[aria-disabled=true]', links => links.some(link => /Customer Portal/.test(link.textContent))));
  assert.equal((await page.goto(server.baseUrl + path('portal'))).status(), 404);
  await go('billing');
  assert.equal(await page.$$eval('form', forms => forms.length), 0);
  assert.equal(await page.$$eval('input,textarea,select', fields => fields.every(field => field.disabled)), true);
  assert.equal(await page.$$eval('script', scripts => scripts.every(script => script.src.endsWith('/catalog-public.js'))), true);
  const documents = JSON.parse(readFileSync(new URL('../research/batavia-public.json', import.meta.url))).documents;
  for (const document of documents) {
    const href = '/reference-pages/' + prefix + '-billing/' + document.sha256;
    assert.ok(await page.$('a[href="' + href + '"]'), document.id + ' must be reachable from billing');
    const response = await fetch(server.baseUrl + href);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), document.sha256);
  }
  pass('Three official PDFs retain exact bytes; denied portal and production forms are unavailable');

  assert.ok(await page.$('a[href="' + path('assistance') + '"]'));
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.locator('a[href="' + path('assistance') + '"]').click(),
  ]);
  assert.match(await page.title(), /Budget Billing.*Payment Assistance/);
  await page.screenshot({ path: new URL('assistance.png', directory).pathname, fullPage: true });
  assert.deepEqual(report.page_errors, []);
  assert.deepEqual(report.outbound_requests, []);
  pass('Billing reaches assistance without page errors or external requests');
  report.all_passed = true;
} catch (error) {
  report.all_passed = false; report.error = error.message;
  await page.screenshot({ path: new URL('failure.png', directory).pathname });
  throw error;
} finally {
  writeFileSync(new URL('report.json', directory), JSON.stringify(report, null, 2) + '\n');
  await browser.close(); await server.close();
}
