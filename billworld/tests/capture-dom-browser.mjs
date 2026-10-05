import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { captureDOM, captureApplicationReady, capturePublicUiControl } from '../capture-dom.mjs';

const browser = await puppeteer.launch({ headless: true, timeout: 60000 });
try {
  const page = await browser.newPage();
  await page.setContent(`<form><label for="username">Username</label><input id="username" name="login" required>
    <div hidden><label for="password">Password</label><input id="password" type="password"></div>
    <input id="token" type="hidden"><input id="transparent" style="opacity:0">
    <fieldset style="visibility:hidden"><input id="ssn"></fieldset>
    <button disabled>Continue</button></form><button id="help">Help</button>`);
  const before = await page.evaluate(captureDOM);
  const fields = new Map(before.forms[0].fields.map(f => [f.id, f]));
  assert.equal(before.schemaVersion, 2);
  assert.equal(fields.get('username').visible, true);
  assert.equal(fields.get('username').required, true);
  for (const id of ['password', 'token', 'transparent', 'ssn']) assert.equal(fields.get(id).visible, false, id);
  assert.equal(before.controls.find(c => c.text === 'Continue').disabled, true);
  assert.equal(before.controls.find(c => c.id === 'help').text, 'Help');
  await page.evaluate(() => document.querySelector('[hidden]').hidden = false);
  const after = await page.evaluate(captureDOM);
  assert.equal(after.forms[0].fields.find(f => f.id === 'password').visible, true);
  assert.equal(await page.evaluate(captureApplicationReady), true);
  await page.setContent('<main>Loading...</main><footer>Copyright</footer>');
  assert.equal(await page.evaluate(captureApplicationReady), false);
  await page.setContent('<header>Account recovery</header><main class="capturedWorkflowPage"><div id="appRoot"><div role="status"></div></div></main><footer>Copyright</footer>');
  assert.equal(await page.evaluate(captureApplicationReady), false);
  await page.evaluate(() => document.querySelector('#appRoot').innerHTML = '<h1>Recover your account</h1><input>');
  assert.equal(await page.evaluate(captureApplicationReady), true);
  await page.evaluate(() => document.querySelector('#appRoot').style.opacity = '0');
  assert.equal(await page.evaluate(captureApplicationReady), false);
  await page.setContent('<main><h1>Public FAQ</h1><p>Account help</p><div id="appRoot" hidden></div></main>');
  assert.equal(await page.evaluate(captureApplicationReady), true);
  await page.setContent('<app-root></app-root>');
  assert.equal(await page.evaluate(captureApplicationReady), false);
  await page.setContent('<header>WIPP</header><app-root></app-root>');
  assert.equal(await page.evaluate(captureApplicationReady), false);
  await page.evaluate(() => document.querySelector('app-root').innerHTML = '<h1>Utility Payment</h1><label>Account number<input></label>');
  assert.equal(await page.evaluate(captureApplicationReady), true);
  await page.setContent('<form><button id="implicit">Continue</button><button type="submit" id="explicit">Pay</button><button type="button" id="help">Account help</button><button type="button" disabled id="disabled">Unavailable</button><input type="submit" id="input"><a role="button" id="anchor">Continue</a></form>');
  for (const id of ['implicit', 'explicit', 'disabled', 'input', 'anchor']) {
    assert.equal(await (await page.$('#' + id)).evaluate(capturePublicUiControl), false, id);
  }
  assert.equal(await (await page.$('#help')).evaluate(capturePublicUiControl), true);
  console.log('PASS: capture distinguishes visible controls from hidden, transparent and deferred fields');
  console.log('PASS: loading-only and empty MyChart workflow shells fail application readiness');
  console.log('PASS: blank and empty Angular shells remain unfinished until the payment UI renders');
  console.log('PASS: public UI capture denies form-submit, implicit-submit, disabled and non-button controls');
} finally { await browser.close(); }
