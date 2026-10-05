// Generic Puppeteer driver for fleet templates. It navigates by visible links where possible, fills the
// standardized field names, and adapts to each template's step order (single page vs. multi-step wizards).
// Templates may export `driver` overrides: { [flowName]: async (ctx) => {...} } for genuinely unusual flows.
//
// Navigation contract: ctx.nav(page) clicks a visible link (opening collapsed menus if needed). When no link exists
// it falls back to typing the URL and records the page in ctx.directNav; browser.mjs fails a flow with unexpected
// direct navigation unless the flow whitelisted that page in ctx.allowDirect. ctx.goto() is reserved for deliberate
// entry points and probes (episode entry, protected-page redirects), which are not navigation by the user.
import assert from 'node:assert/strict';

export const PASSWORD = 'Billworld-2026!';
// Thrown by a flow whose feature is not implemented in this build (e.g. Google sign-in, SMS MFA). browser.mjs reports
// it as SKIP with the message (always starting "not available"), never as a pass or a failure.
export class FlowSkip extends Error { constructor(why) { super(`not available: ${why}`); this.skip = true; } }
export const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIN = 60000;

export function makeCtx({ page, server, biller, template, episode, options = {} }) {
  const base = `${server.baseUrl}/b/${biller.id}`;
  const route = (pg, params = {}) => server.urlFor(template, biller.id, pg, params);
  const ctx = {
    page, server, biller, template, episode, base, route, options, directNav: [], allowDirect: new Set(), log: [], focusIssues: [],
    async goto(path, pg = page) { await pg.goto(path.startsWith('http') ? path : server.baseUrl + path, { waitUntil: 'domcontentloaded' }); },
    text: (pg = page) => pg.evaluate(() => document.body.innerText),
    h1: () => page.evaluate(() => document.querySelector('h1')?.innerText || ''),
    path: (pg = page) => new URL(pg.url()).pathname,
    query: (name, pg = page) => new URL(pg.url()).searchParams.get(name),
    async errorText(pg = page) { return pg.evaluate(() => document.querySelector('[role=alert]')?.innerText || ''); },
    async noticeText(pg = page) { return pg.evaluate(() => [...document.querySelectorAll('[role=alert],[role=status]')].map(e => e.innerText).join(' ')); },
    // Prefer clicking a visible link to the page; fall back to direct navigation and record it.
    async nav(pg, params = {}) {
      const target = route(pg, params);
      if (ctx.path() === target.split('?')[0]) return;
      const clicked = await clickLinkTo(page, target);
      if (!clicked && pg !== 'home') {
        const home = route(ctx.episodeAuthed ? template.flow.afterLogin : 'home');
        if (ctx.path() !== home) { await ctx.goto(home); if (await clickLinkTo(page, target)) return; }
        // One more hop, as a user browsing sections would: open each page linked visibly from home (e.g. a
        // "Payments" section whose sub-navigation holds the target) and look for the link there.
        const hubs = await page.evaluate((pre, skip) => [...new Set([...document.querySelectorAll('a[href]')].filter(a => a.checkVisibility()).map(a => new URL(a.href)).filter(u => u.origin === location.origin && u.pathname.startsWith(pre) && !skip.includes(u.pathname) && !/\.pdf$/.test(u.pathname)).map(u => u.pathname))].slice(0, 15), `/b/${biller.id}/`, [home, route('logout'), route('home')]);
        for (const hub of hubs) { await ctx.goto(hub); if (await clickLinkTo(page, target)) return; }
        ctx.directNav.push(pg); await ctx.goto(target);
      } else if (!clicked) await ctx.goto(target);
    },
    async admin(path, body) { return server.admin(path, body); },
    async evaluate(predicates) { return server.admin('/evaluate', { episodeId: episode.episodeId, predicates: predicates.map(p => ({ billerId: biller.id, ...p })) }); },
    async account() { return server.admin(`/account?episodeId=${episode.episodeId}&billerId=${biller.id}`); },
    async events(type) { const s = await server.admin(`/state?episodeId=${episode.episodeId}`); return s.events.filter(e => e.billerId === biller.id && (!type || e.type === type)); },
    async advance(milliseconds) { return server.admin('/advance', { episodeId: episode.episodeId, milliseconds }); },
    // Payments the user created in this episode (seeded fixtures and declined attempts excluded).
    async payments() { return (await ctx.account()).payments.filter(p => !p.seeded && p.status !== 'failed'); },
    // A second tab in the same browser context (shares cookies), e.g. for reading mail without leaving a page.
    async newTab() { const p = await page.browserContext().newPage(); const vp = page.viewport(); if (vp) await p.setViewport(vp); p.setDefaultTimeout(Number(process.env.FLEET_TIMEOUT || 45000)); return p; },
    tabCtx(pg) { const c = makeCtx({ page: pg, server, biller, template, episode, options }); c.episodeAuthed = ctx.episodeAuthed; c.directNav = ctx.directNav; c.allowDirect = ctx.allowDirect; c.focusIssues = ctx.focusIssues; return c; }
  };
  return ctx;
}

// Find a visible link to `target`. If the only link is inside a collapsed menu (closed <details>, an aria-controls
// toggle, or a hover menu), open the menu the way a user would and retry.
async function clickLinkTo(page, target) {
  const path = target.split('?')[0];
  const find = () => page.evaluateHandle(p => [...document.querySelectorAll('a[href]')].find(a => { const u = new URL(a.href); return u.pathname === p && a.checkVisibility(); }) || null, path);
  let el = (await find()).asElement();
  if (!el) {
    const opened = await page.evaluate(p => {
      const hiddenLink = [...document.querySelectorAll('a[href]')].find(a => new URL(a.href).pathname === p);
      if (!hiddenLink) return null;
      for (let n = hiddenLink.parentElement; n && n !== document.body; n = n.parentElement) {
        if (n.tagName === 'DETAILS' && !n.open) { n.querySelector(':scope > summary')?.setAttribute('data-bw-open', '1'); return 'click'; }
        if (n.id) { const t = document.querySelector(`[aria-controls="${CSS.escape(n.id)}"]`); if (t && t.checkVisibility()) { t.setAttribute('data-bw-open', '1'); return 'click'; } }
        if (n.checkVisibility() && n !== hiddenLink.parentElement) { n.setAttribute('data-bw-open', '1'); return 'hover'; }
      }
      return null;
    }, path);
    if (opened) {
      if (opened === 'click') await page.click('[data-bw-open="1"]'); else await page.hover('[data-bw-open="1"]');
      await page.evaluate(() => document.querySelector('[data-bw-open]')?.removeAttribute('data-bw-open'));
      await sleep(80); el = (await find()).asElement();
    }
  }
  if (!el) return false;
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), el.click()]);
  return true;
}

// Fill named fields inside the form that contains the first named field; returns that form handle.
export async function fill(page, values) {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    const kind = await page.evaluate(n => { const els = [...document.getElementsByName(n)]; if (!els.length) return null; const e = els.find(x => x.type !== 'hidden') || els[0]; return e.tagName === 'SELECT' ? 'select' : e.tagName === 'TEXTAREA' ? 'textarea' : e.type; }, name);
    if (!kind) throw new Error(`Field ${name} not found on ${page.url()}`);
    await reveal(page, name);
    if (kind === 'radio') {
      const sel = `input[name="${name}"][value="${value}"]`;
      await page.click(sel);
      // On touch viewports a tap at the input's centre can land on a neighbouring control; confirm and retry via the DOM.
      if (!await page.$eval(sel, e => e.checked)) await page.$eval(sel, e => e.click());
      continue;
    }
    if (kind === 'checkbox') { const checked = await page.$eval(`input[name="${name}"]`, e => e.checked); if (checked !== !!value) await page.click(`input[name="${name}"]`); continue; }
    if (kind === 'select') { await page.select(`select[name="${name}"]`, String(value)); continue; }
    if (kind === 'hidden') continue;
    const sel = `[name="${name}"]:not([type=hidden])`;
    await page.$eval(sel, e => { e.value = ''; });
    if (kind === 'date') await page.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, String(value));
    else await page.type(sel, String(value));
  }
}
// Open collapsed <details> or template "show" toggles that hide a field, using the visible summary/toggle.
async function reveal(page, name) {
  const hidden = await page.evaluate(n => { const e = [...document.getElementsByName(n)].find(x => x.type !== 'hidden'); return e && !(e.checkVisibility() || e.closest('label')?.checkVisibility()); }, name);
  if (!hidden) return;
  const opened = await page.evaluate(n => { const e = [...document.getElementsByName(n)].find(x => x.type !== 'hidden'); const d = e.closest('details'); if (d && !d.open) { d.querySelector('summary').click(); return true; } const t = e.closest('[data-reveal]'); if (t) { document.querySelector(`[aria-controls="${t.id}"]`)?.click(); return true; } return false; }, name);
  if (opened) await sleep(50);
}
// Mark the submit button of the form that contains `field` (or the first POST form) with data-bw-click.
async function markSubmit(page, { field, button: label, value } = {}) {
  return page.evaluate((f, lbl, val) => {
    document.querySelectorAll('[data-bw-click]').forEach(e => e.removeAttribute('data-bw-click'));
    const form = f ? document.getElementsByName(f)[0]?.form : [...document.querySelectorAll('main form, form')].find(x => x.method === 'post' && x.querySelector('button'));
    if (!form) return false;
    const buttons = [...form.querySelectorAll('button[type=submit], button:not([type]), input[type=submit]')].filter(b => b.checkVisibility());
    const b = (val && buttons.find(x => x.value === val)) || (lbl && buttons.find(x => x.innerText.trim().toLowerCase().includes(lbl.toLowerCase()))) || buttons.find(x => !x.name || x.name === 'op' && x.value === 'submit') || buttons[0];
    if (!b) return false; b.setAttribute('data-bw-click', '1'); return true;
  }, field || null, label || null, value || null);
}
// Submit the form that contains `fieldName` (or the only/first form on the page with a submit button).
export async function submit(page, opts = {}) {
  if (!await markSubmit(page, opts)) throw new Error(`No submit button for ${opts.field || 'form'} on ${page.url()}`);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('[data-bw-click="1"]')]);
}
const has = (page, name) => page.evaluate(n => document.getElementsByName(n).length > 0, name);
const isReview = async page => await has(page, 'token') && await has(page, 'acceptTerms');
// Serialize the form containing `field` as the browser would submit it (with acceptTerms ticked) for replay.
async function captureForm(page, field) {
  return page.evaluate(f => {
    const form = document.getElementsByName(f)[0].form; const fd = new FormData(form, form.querySelector('[data-bw-click]') || undefined);
    if (form.querySelector('[name=acceptTerms]')) fd.set('acceptTerms', form.querySelector('[name=acceptTerms]').value || 'on');
    return { action: form.action, body: new URLSearchParams(fd).toString() };
  }, field);
}
// Replay a captured POST from inside the page (same cookies/origin); fetch follows the 303.
export async function replayPost(page, { action, body }) {
  return page.evaluate(async (a, b) => { const r = await fetch(a, { method: 'POST', body: b, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); const t = await r.text(); return { status: r.status, url: r.url, redirected: r.redirected, alert: (t.match(/role="alert"[^>]*>([^<]*)/) || [])[1] || '' }; }, action, body);
}

// ---------------- flows ----------------
export async function login(ctx, { username = ctx.episode.persona.email, password = PASSWORD, expectMfa = false } = {}) {
  const { page } = ctx;
  if (![ctx.route('login'), ctx.route('loginPassword')].includes(ctx.path())) await ctx.nav('login');
  const shownUser = await page.evaluate(() => { const e = [...document.getElementsByName('username')].find(x => x.type !== 'hidden'); return e ? e.value : null; });
  if (shownUser !== null && shownUser !== username) await fill(page, { username });
  if (await has(page, 'password')) { await fill(page, { password }); await submit(page, { field: 'password' }); }
  else { await submit(page, { field: 'username' }); const e = await ctx.errorText(); if (e) throw new Error(`Login failed: ${e}`); await fill(page, { password }); await submit(page, { field: 'password' }); }
  if (expectMfa) return;
  const err = await ctx.errorText(); if (err) throw new Error(`Login failed: ${err}`);
  ctx.episodeAuthed = true;
}
export async function mailbox(ctx, page = ctx.page) {
  await ctx.goto('/mail', page);
  if (await has(page, 'password')) { await fill(page, { email: ctx.episode.persona.email, password: ctx.episode.credentials.mailbox.password }); await submit(page, { field: 'password' }); }
}
// Open the index-th newest email whose list entry contains subjectPart; returns the message text.
export async function openMail(ctx, subjectPart, { index = 0, page = ctx.page } = {}) {
  await mailbox(ctx, page);
  const href = await page.evaluate((s, i) => [...document.querySelectorAll('.list a')].filter(a => a.innerText.toLowerCase().includes(s.toLowerCase()))[i]?.getAttribute('href'), subjectPart, index);
  if (!href) throw new Error(`No email matching "${subjectPart}" (#${index})`);
  await ctx.goto(href, page); return ctx.text(page);
}
// Read an email in a separate tab so the current page (e.g. an MFA or reset form) stays as it is.
export async function readMailInTab(ctx, subjectPart, opts = {}) {
  const tab = await ctx.newTab();
  try { return await openMail(ctx, subjectPart, { ...opts, page: tab }); } finally { await tab.close(); await ctx.page.bringToFront(); }
}
// Open the email and click its first link (a real click, the way a user follows a verify/reset link).
export async function followMailLink(ctx, subjectPart, opts = {}) {
  await openMail(ctx, subjectPart, opts);
  const link = await ctx.page.$('.text a[href]'); if (!link) throw new Error(`Email "${subjectPart}" has no link`);
  await Promise.all([ctx.page.waitForNavigation({ waitUntil: 'domcontentloaded' }), link.click()]);
}

// Drives any pay wizard: fills whatever step fields are present until the review form appears, then submits.
// stopAtReview leaves the browser on the review page and returns null. The review form is captured in ctx.lastReview.
export async function pay(ctx, { amountChoice = 'due', amount, methodId = 'pm-chk', newMethod, payOn, guest = false, stopAtReview = false, fromHere = false } = {}) {
  const { page } = ctx;
  if (!guest && !fromHere) await ctx.nav(ctx.template.flow.paySteps[0]);
  for (let i = 0; i < 6; i++) {
    if (await isReview(page)) {
      if (stopAtReview) return null;
      await fill(page, { acceptTerms: true }); await markSubmit(page, { field: 'acceptTerms' }); ctx.lastReview = await captureForm(page, 'acceptTerms');
      await submit(page, { field: 'acceptTerms' });
      const err = await ctx.errorText(); if (err) throw new Error(`Payment failed: ${err}`);
      return ctx.text();
    }
    const vals = {}; let key = null;
    if (await has(page, 'amountChoice')) { vals.amountChoice = amountChoice; if (amountChoice === 'other') vals.amount = amount; key = 'amountChoice'; }
    else if (await has(page, 'amount') && amount) { vals.amount = amount; key = 'amount'; }
    if (newMethod && await has(page, 'methodType')) { Object.assign(vals, newMethod); key = key || 'methodType'; }
    else if (await has(page, 'methodId') && !newMethod) { vals.methodId = methodId; key = key || 'methodId'; }
    if (payOn && await has(page, 'payOn')) { vals.payOn = payOn; key = key || 'payOn'; }
    if (!key) throw new Error(`Pay step has no known fields at ${page.url()}: ${(await ctx.h1())}`);
    await fill(page, vals); await submit(page, { field: key });
    const err = await ctx.errorText(); if (err) throw new Error(`Pay step error: ${err}`);
  }
  throw new Error('Pay wizard did not reach review');
}
// Tick the terms box on the current review page and submit it.
async function submitReview(ctx) { await fill(ctx.page, { acceptTerms: true }); await submit(ctx.page, { field: 'acceptTerms' }); }
const moneyOf = text => [...String(text).matchAll(/\$\s?([\d,]+\.\d{2})/g)].map(m => Math.round(Number(m[1].replace(/,/g, '')) * 100));
const reset = { password: 'Renewed-Pass-2026!' };
async function completeResetForm(ctx, { code, password = reset.password } = {}) {
  const vals = { password, confirm: password }; if (code) vals.code = code;
  await fill(ctx.page, vals); await submit(ctx.page, { field: 'password' });
}
// Submit a wallet "remove" form for one method (the control next to that method).
async function removeMethod(ctx, methodId) {
  const ok = await ctx.page.evaluate((id, action) => {
    document.querySelectorAll('[data-bw-click]').forEach(e => e.removeAttribute('data-bw-click'));
    const form = [...document.querySelectorAll('form')].find(f => new URL(f.action).pathname === action && f.querySelector(`[name=methodId][value="${id}"]`) && (f.querySelector('[name=op][value=remove]')));
    const b = form && [...form.querySelectorAll('button, input[type=submit]')].find(x => x.checkVisibility());
    if (!b) return false; b.setAttribute('data-bw-click', '1'); return true;
  }, methodId, ctx.route('wallet'));
  if (!ok) throw new Error(`No visible remove control for ${methodId}`);
  await Promise.all([ctx.page.waitForNavigation({ waitUntil: 'domcontentloaded' }), ctx.page.click('[data-bw-click="1"]')]);
}

// Sign out with the visible control (link to the logout route, or a "Sign out"-style link/button).
async function signOut(ctx) {
  const { page } = ctx;
  if (!await clickLinkTo(page, ctx.route('logout'))) {
    const b = await page.evaluateHandle(() => [...document.querySelectorAll('a,button')].find(x => x.checkVisibility() && /sign out|log ?out|sign off/i.test(x.innerText)) || null);
    const el = b.asElement(); if (!el) throw new Error('No visible sign-out control'); await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), el.click()]);
  }
  ctx.episodeAuthed = false;
}
// Horizontal overflow against the device width (on a mobile viewport Chrome widens innerWidth to fit overflowing
// content, so innerWidth alone hides the overflow).
async function assertNoOverflow(ctx, where) {
  const width = ctx.page.viewport()?.width || 375;
  const o = await ctx.page.evaluate(w => { const over = Math.max(document.documentElement.scrollWidth, window.innerWidth) - w; const wide = over > 1 ? [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > w + 1 && e.checkVisibility()).slice(-3).map(e => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`) : []; return { over, wide }; }, width);
  assert.ok(o.over <= 1, `${where}: ${o.over}px horizontal overflow at ${width}px (${o.wide.join(', ')})`);
}
// Go back in history until the page has one of `fields` (a pay step), at most `max` times.
async function backToStep(ctx, fields, max = 4) {
  for (let i = 0; i < max; i++) {
    await ctx.page.goBack({ waitUntil: 'domcontentloaded' });
    for (const f of fields) if (await has(ctx.page, f) && !await isReview(ctx.page)) return true;
  }
  return false;
}

// ---------------- keyboard-only helpers ----------------
// Press Tab until the focused element matches `test` (evaluated in the page). Records focused controls without a
// visible focus indicator in ctx.focusIssues.
async function tabTo(ctx, test, arg, { max = 250, what = 'target' } = {}) {
  for (let i = 0; i < max; i++) {
    await ctx.page.keyboard.press('Tab');
    const hit = await ctx.page.evaluate(test, arg);
    const r = await ctx.page.evaluate(() => {
      const el = document.activeElement; if (!el || el === document.body) return {};
      if (/^(date|time|datetime-local|month|week)$/.test(el.type)) return {}; // the UA highlights the focused date segment
      const cs = getComputedStyle(el); const indicator = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
      return { noIndicator: indicator ? null : `${el.tagName.toLowerCase()}${el.name ? `[name=${el.name}]` : ''} "${(el.innerText || el.value || '').trim().slice(0, 30)}"` };
    });
    if (r.noIndicator && !ctx.focusIssues.includes(r.noIndicator)) ctx.focusIssues.push(r.noIndicator);
    if (hit) return;
  }
  throw new Error(`Keyboard: Tab never reached ${what} on ${ctx.page.url()}`);
}
const kbLinkTo = (ctx, pg) => tabTo(ctx, p => { const el = document.activeElement; return el?.tagName === 'A' && new URL(el.href).pathname === p; }, ctx.route(pg), { what: `link to ${pg}` });
async function kbEnterNav(ctx) { await Promise.all([ctx.page.waitForNavigation({ waitUntil: 'domcontentloaded' }), ctx.page.keyboard.press('Enter')]); }
async function kbType(ctx, name, value) { await tabTo(ctx, n => document.activeElement?.name === n && document.activeElement.type !== 'hidden', name, { what: `field ${name}` }); await ctx.page.keyboard.type(String(value)); }
// Choose a radio value with arrow keys (Tab lands on the checked radio of the group, arrows move and check).
// Selects are changed with arrow keys too (focus, then ArrowDown/ArrowUp until the value matches).
async function kbRadio(ctx, name, value) {
  const cur = await ctx.page.evaluate(n => { const e = [...document.getElementsByName(n)].find(x => x.type !== 'hidden'); return e?.tagName === 'SELECT' ? { select: true, value: e.value, options: [...e.options].map(o => o.value) } : { value: document.querySelector(`input[name="${n}"]:checked`)?.value || null }; }, name);
  if (cur.value === value) return;
  if (cur.select) {
    await tabTo(ctx, n => document.activeElement?.name === n && document.activeElement.tagName === 'SELECT', name, { what: `select ${name}` });
    const key = cur.options.indexOf(value) > cur.options.indexOf(cur.value) ? 'ArrowDown' : 'ArrowUp';
    for (let i = 0; i < 20; i++) { await ctx.page.keyboard.press(key); if (await ctx.page.evaluate(() => document.activeElement.value) === value) return; }
    throw new Error(`Keyboard: could not select ${name}=${value}`);
  }
  await tabTo(ctx, n => document.activeElement?.name === n && document.activeElement.type === 'radio', name, { what: `radio ${name}` });
  for (let i = 0; i < 12; i++) { if (await ctx.page.evaluate(n => document.activeElement.value, name) === value) { await ctx.page.keyboard.press('Space'); return; } await ctx.page.keyboard.press('ArrowDown'); }
  throw new Error(`Keyboard: could not select ${name}=${value}`);
}
async function kbCheck(ctx, name) { if (await ctx.page.evaluate(n => document.querySelector(`input[name="${n}"]`)?.checked, name)) return; await tabTo(ctx, n => document.activeElement?.name === n, name, { what: `checkbox ${name}` }); await ctx.page.keyboard.press('Space'); }
async function kbSubmit(ctx, field) {
  if (!await markSubmit(ctx.page, { field })) throw new Error(`No submit button for ${field}`);
  await tabTo(ctx, () => !!document.activeElement?.hasAttribute?.('data-bw-click'), null, { what: `submit for ${field}` }); await kbEnterNav(ctx);
}
const resetFocus = page => page.evaluate(() => { document.activeElement?.blur?.(); window.getSelection()?.removeAllRanges(); document.body.focus(); });

// ---------------- flow catalog ----------------
export const FLOWS = {
  async home_and_help(ctx) {
    const { page } = ctx; await ctx.goto(ctx.route('home'));
    const text = await ctx.text(); assert.ok(text.includes(ctx.biller.brand.shortName) || text.includes(ctx.biller.entry.name), 'home shows biller name');
    await ctx.nav('help'); assert.ok((await ctx.text()).length > 100, 'help center renders');
    await ctx.nav('helpArticle', { slug: 'contact-us' });
    // Compare digits: the help center shows the cleaned phone (biller.contact), formatted per template.
    const phone = ctx.biller.contact?.phones?.[0] || String(ctx.biller.contact?.phone || ctx.biller.entry.phone_customer_service || '').replace(/\D/g, '').slice(0, 10);
    if (phone) assert.ok((await ctx.text()).replace(/\D/g, '').includes(phone), `contact article shows phone ${phone}`);
    if (await has(page, 'q')) { await fill(page, { q: 'pay' }); await Promise.all([page.waitForNavigation(), page.$eval('[name=q]', e => e.form.requestSubmit ? e.form.requestSubmit() : e.form.submit())]); assert.ok((await ctx.text()).toLowerCase().includes('pay'), 'help search returns results'); }
  },
  async offline(ctx) {
    await ctx.goto(ctx.route('home')); const text = await ctx.text();
    assert.ok(/not available/i.test(text), 'offline biller states online payment is unavailable');
    await ctx.goto(ctx.route('login'));
    assert.ok(ctx.path() === ctx.route('home') || /not available/i.test(await ctx.text()), 'login URL explains that online access is unavailable');
    assert.equal(await has(ctx.page, 'password'), false, 'no sign-in form for offline billers');
  },
  async login_view_bill(ctx) {
    await ctx.goto(ctx.route('home')); await login(ctx);
    const acct = await ctx.account(); const due = (acct.invoices.at(-1).balanceCents / 100).toFixed(2);
    await ctx.nav('bill'); const text = await ctx.text();
    assert.ok(text.replace(/,/g, '').includes(due), `bill page shows amount due ${due}`);
    const pdf = await ctx.page.evaluate(async u => { const r = await fetch(u); return { type: r.headers.get('content-type'), head: (await r.text()).slice(0, 5) }; }, ctx.server.baseUrl + ctx.route('statement', { id: acct.invoices.at(-1).id }));
    assert.equal(pdf.type, 'application/pdf'); assert.equal(pdf.head, '%PDF-');
    await ctx.nav('statements'); await ctx.nav('history');
  },
  // Statements must be reachable by clicking a visible link (not only by URL), and the click must yield a PDF.
  async statement_download_by_click(ctx) {
    const { page } = ctx; await ctx.goto(ctx.route('home')); await login(ctx); await ctx.nav('statements');
    const pattern = ctx.template.matchers.find(m => m.page === 'statement').re.source; const prefix = `/b/${ctx.biller.id}`;
    const ok = await page.evaluate((src, pre) => { const re = new RegExp(src); const a = [...document.querySelectorAll('a[href]')].find(x => { const u = new URL(x.href); return u.pathname.startsWith(pre) && re.test(u.pathname.slice(pre.length)) && x.checkVisibility(); }); if (!a) return false; a.removeAttribute('target'); a.removeAttribute('download'); a.setAttribute('data-bw-pdf', '1'); return true; }, pattern, prefix);
    assert.ok(ok, 'statements page has a visible statement PDF link');
    const before = (await ctx.events('statement_downloaded')).length;
    ctx.ignoreConsole = [/net::ERR_(FAILED|ABORTED)/]; // headless Chrome reports an inline PDF navigation as a failed load
    const [resp] = await Promise.all([page.waitForResponse(r => r.request().method() === 'GET' && (r.headers()['content-type'] === 'application/pdf' || /\.pdf$/.test(new URL(r.url()).pathname))), page.click('[data-bw-pdf]')]);
    assert.equal(resp.status(), 200, 'statement link responds 200'); assert.equal(resp.headers()['content-type'], 'application/pdf', 'statement link serves a PDF');
    await sleep(200);
    assert.ok((await ctx.events('statement_downloaded')).length > before, 'download recorded in the ledger');
  },
  async pay_bank(ctx) {
    await ctx.goto(ctx.route('home')); await login(ctx);
    const acct = await ctx.account(); const receipt = await pay(ctx, {});
    const r = await ctx.evaluate([{ type: 'payment', methodType: 'bank', amountCents: acct.invoices.at(-1).balanceCents, count: 1 }, { type: 'autopay_unchanged' }]);
    assert.ok(r.success, `payment graded: ${JSON.stringify(r.results)}`);
    const after = await ctx.account(); const paid = after.payments.at(-1); assert.ok(receipt.includes(paid.confirmation), 'receipt shows confirmation number');
    // Replaying the exact review POST (same token, same session) must not create a second payment and must show the original receipt.
    const replay = await replayPost(ctx.page, ctx.lastReview);
    assert.equal(new URL(replay.url).pathname, ctx.route('payReceipt', { id: paid.id }), `replayed submit shows the original receipt (got ${replay.status} ${replay.url} ${replay.alert})`);
    assert.equal((await ctx.payments()).length, 1, 'no duplicate payment on replayed submit');
  },
  // Two clicks on the submit button before the first response, then a third replay: exactly one payment.
  async double_click_submit(ctx) {
    const { page } = ctx; await ctx.goto(ctx.route('home')); await login(ctx);
    await pay(ctx, { stopAtReview: true });
    await fill(page, { acceptTerms: true }); await markSubmit(page, { field: 'acceptTerms' }); const captured = await captureForm(page, 'acceptTerms');
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.evaluate(() => { const b = document.querySelector('[data-bw-click="1"]'); b.click(); b.click(); })]);
    await sleep(300);
    const pays = await ctx.payments(); assert.equal(pays.length, 1, `double click created ${pays.length} payments`);
    if (await ctx.path() !== ctx.route('payReceipt', { id: pays[0].id })) await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => null);
    assert.ok((await ctx.text()).includes(pays[0].confirmation), 'page shows the receipt after a double click');
    const replay = await replayPost(page, captured);
    assert.equal(new URL(replay.url).pathname, ctx.route('payReceipt', { id: pays[0].id }), 'replay shows the original receipt');
    assert.equal((await ctx.payments()).length, 1, 'replay did not create a payment');
  },
  async pay_card_other(ctx) {
    await ctx.goto(ctx.route('home')); await login(ctx);
    await pay(ctx, { amountChoice: 'other', amount: '25.00', methodId: 'pm-card' });
    const r = await ctx.evaluate([{ type: 'payment', methodType: 'card', amountCents: 2500, count: 1 }]); assert.ok(r.success, JSON.stringify(r.results));
  },
  async pay_new_bank(ctx) {
    await ctx.goto(ctx.route('home')); await login(ctx);
    await pay(ctx, { newMethod: { methodType: 'bank', routing: '021000021', bankAccount: '000123456789', bankAccountConfirm: '000123456789' } });
    const acct = await ctx.account(); assert.equal(acct.payments.at(-1).methodLast4, '6789');
  },
  async schedule_and_cancel(ctx) {
    await ctx.goto(ctx.route('home')); await login(ctx);
    await pay(ctx, { payOn: '2026-10-20' });
    let r = await ctx.evaluate([{ type: 'payment', scheduled: true, payOn: '2026-10-20', count: 1 }]); assert.ok(r.success, JSON.stringify(r.results));
    await ctx.nav('history');
    await submit(ctx.page, { field: 'paymentId' });
    r = await ctx.evaluate([{ type: 'scheduled_cancelled' }]); assert.ok(r.success, 'scheduled payment cancelled');
  },
  async autopay_enroll_cancel(ctx) {
    await ctx.goto(ctx.route('home')); await login(ctx); await ctx.nav('autopay');
    const enrollForm = await ctx.page.evaluate(() => [...document.querySelectorAll('input[name=action]')].map(e => e.value));
    await fillAutopay(ctx);
    let r = await ctx.evaluate([{ type: 'autopay', enrolled: true, methodType: 'bank' }, { type: 'no_payment' }]); assert.ok(r.success, `enroll: ${JSON.stringify(r.results)} forms=${enrollForm}`);
    await ctx.nav('autopay');
    await cancelAutopay(ctx);
    r = await ctx.evaluate([{ type: 'autopay', enrolled: false }]); assert.ok(r.success, 'autopay cancelled');
    const mail = await openMail(ctx, 'AutoPay'); assert.ok(/autopay/i.test(mail));
  },
  async paperless(ctx) {
    await ctx.goto(ctx.route('home')); await login(ctx); await ctx.nav('paperless');
    await submit(ctx.page, { field: 'paperless' });
    const r = await ctx.evaluate([{ type: 'paperless', value: true }]); assert.ok(r.success, 'paperless on');
  },
  async cancel_service(ctx) {
    await ctx.goto(ctx.route('home')); await login(ctx); await ctx.nav('cancel');
    for (let i = 0; i < 5; i++) {
      const step = await ctx.page.evaluate(() => document.querySelector('input[name=step]')?.value);
      if (!step) break;
      if (step === 'reason') { await fill(ctx.page, { reason: 'moving' }); await submit(ctx.page, { field: 'reason' }); }
      else if (step === 'offer') await submit(ctx.page, { field: 'step', value: 'no' });
      else if (step === 'confirm') { const vals = { confirm: true }; if (await has(ctx.page, 'effectiveDate')) vals.effectiveDate = '2026-10-25'; await fill(ctx.page, vals); await submit(ctx.page, { field: 'confirm' }); }
      else break;
      const err = await ctx.errorText(); if (err) throw new Error(`Cancel error: ${err}`);
    }
    const r = await ctx.evaluate([{ type: 'service', status: 'cancel_pending' }, { type: 'retention_accepted', value: false }]); assert.ok(r.success, JSON.stringify(r.results));
  },
  // Reset by typing the emailed code on the page the forgot form redirects to.
  async reset_password(ctx) {
    await ctx.goto(ctx.route('home')); await ctx.nav('login'); await ctx.nav('forgot');
    await fill(ctx.page, { identifier: ctx.episode.persona.email }); await submit(ctx.page, { field: 'identifier' });
    assert.equal(ctx.path(), ctx.route('reset'), 'forgot-password form leads to the reset page');
    const mail = await readMailInTab(ctx, 'password'); const code = mail.match(/\b(\d{6})\b/)?.[1]; assert.ok(code, 'reset email has code');
    await completeResetForm(ctx, { code });
    assert.equal(await ctx.errorText(), ''); await login(ctx, { password: reset.password });
    const r = await ctx.evaluate([{ type: 'password_changed', password: reset.password }, { type: 'logged_in' }]); assert.ok(r.success);
  },
  // Reset by clicking the {{link:reset}} link in the email (token in the URL, no code typed).
  async reset_via_email_link(ctx) {
    await ctx.goto(ctx.route('home')); await ctx.nav('login'); await ctx.nav('forgot');
    await fill(ctx.page, { identifier: ctx.episode.persona.email }); await submit(ctx.page, { field: 'identifier' });
    await followMailLink(ctx, 'Reset your');
    assert.equal(ctx.path(), ctx.route('reset'), 'email link opens the reset page'); assert.ok(ctx.query('token'), 'reset link carries a token');
    assert.equal(await has(ctx.page, 'token'), true, 'reset page keeps the link token in the form');
    await completeResetForm(ctx);
    assert.equal(await ctx.errorText(), '', 'reset via link succeeds'); assert.equal(ctx.path(), ctx.route('login'));
    await login(ctx, { password: reset.password });
    const r = await ctx.evaluate([{ type: 'password_changed', password: reset.password }, { type: 'logged_in' }]); assert.ok(r.success, JSON.stringify(r.results));
  },
  // Request a reset twice; the first code is superseded and must be rejected, the second accepted.
  async superseded_reset_code(ctx) {
    const { page } = ctx; await ctx.goto(ctx.route('home')); await ctx.nav('login'); await ctx.nav('forgot');
    await fill(page, { identifier: ctx.episode.persona.email }); await submit(page, { field: 'identifier' });
    await page.goBack({ waitUntil: 'domcontentloaded' }); assert.equal(ctx.path(), ctx.route('forgot'));
    await fill(page, { identifier: ctx.episode.persona.email }); await submit(page, { field: 'identifier' });
    const newest = (await readMailInTab(ctx, 'Reset your', { index: 0 })).match(/\b(\d{6})\b/)?.[1];
    const oldest = (await readMailInTab(ctx, 'Reset your', { index: 1 })).match(/\b(\d{6})\b/)?.[1];
    assert.ok(newest && oldest && newest !== oldest, 'two distinct reset codes were emailed');
    await completeResetForm(ctx, { code: oldest });
    assert.match(await ctx.errorText(), /invalid|expired/i, 'superseded code is rejected');
    assert.equal((await ctx.events('password_reset')).length, 0, 'no reset with the superseded code');
    await completeResetForm(ctx, { code: newest });
    assert.equal(await ctx.errorText(), '', 'current code works');
    await login(ctx, { password: reset.password });
  },
  // Five wrong passwords lock the account; the correct password is then refused until a reset.
  async lockout_then_reset(ctx) {
    await ctx.goto(ctx.route('home'));
    for (let i = 0; i < 5; i++) {
      const e = await login(ctx, { password: `Wrong-Pass-${i}!` }).then(() => null, x => x.message);
      assert.match(e || '', /^Login failed: .*(incorrect|invalid|locked)/i, `attempt ${i + 1} rejected with a message`);
    }
    assert.ok((await ctx.events('login_failed')).length >= 5, 'failures recorded');
    const locked = await login(ctx).then(() => null, x => x.message);
    assert.match(locked || '', /locked/i, 'correct password refused while locked');
    assert.equal((await ctx.events('login')).length, 0, 'no login while locked');
    await ctx.nav('forgot');
    await fill(ctx.page, { identifier: ctx.episode.persona.email }); await submit(ctx.page, { field: 'identifier' });
    await followMailLink(ctx, 'Reset your'); await completeResetForm(ctx);
    assert.equal(await ctx.errorText(), '', 'reset succeeds while locked');
    await login(ctx, { password: reset.password });
    const r = await ctx.evaluate([{ type: 'logged_in' }, { type: 'password_changed', password: reset.password }]); assert.ok(r.success, JSON.stringify(r.results));
  },
  // The login redirect lands on the MFA step (never typed), the code is read from mail in another tab.
  async mfa_login(ctx) {
    await ctx.goto(ctx.route('home')); await login(ctx, { expectMfa: true });
    assert.equal(ctx.path(), ctx.route('mfa'), 'sign-in redirects to the verification step');
    const code = (await readMailInTab(ctx, 'verification code')).match(/\b(\d{6})\b/)[1];
    await fill(ctx.page, { code }); await submit(ctx.page, { field: 'code' }); ctx.episodeAuthed = true;
    assert.equal(await ctx.errorText(), ''); assert.equal(ctx.path(), ctx.route(ctx.template.flow.afterLogin), 'MFA lands on the account home');
    await ctx.nav('bill'); const r = await ctx.evaluate([{ type: 'logged_in' }]); assert.ok(r.success);
  },
  // A deep link to a protected page survives login and MFA (?next= is carried through both steps).
  async mfa_next_preserved(ctx) {
    await ctx.goto(ctx.route('home')); await ctx.goto(ctx.route('bill'));
    assert.equal(ctx.path(), ctx.route('login'), 'protected page redirects to sign-in'); assert.equal(ctx.query('next'), ctx.route('bill'), 'redirect keeps next');
    await login(ctx, { expectMfa: true });
    assert.equal(ctx.path(), ctx.route('mfa')); assert.equal(ctx.query('next'), ctx.route('bill'), 'MFA step keeps next');
    const code = (await readMailInTab(ctx, 'verification code')).match(/\b(\d{6})\b/)[1];
    await fill(ctx.page, { code }); await submit(ctx.page, { field: 'code' });
    assert.equal(ctx.path(), ctx.route('bill'), 'after MFA the user lands on the page they asked for');
  },
  // An expired MFA code is refused with a message, and signing in again issues a working code.
  async expired_mfa(ctx) {
    await ctx.goto(ctx.route('home')); await login(ctx, { expectMfa: true });
    const code = (await readMailInTab(ctx, 'verification code')).match(/\b(\d{6})\b/)[1];
    await ctx.advance(11 * MIN);
    await fill(ctx.page, { code }); await submit(ctx.page, { field: 'code' });
    assert.match(await ctx.errorText(), /expired/i, 'expired code refused');
    assert.equal((await ctx.events('login')).length, 0, 'no login with an expired code');
    // Recovery: a visible way back to sign in (link) or a resend control on the MFA page.
    const recovery = await ctx.page.evaluate(loginPath => [...document.querySelectorAll('a[href],button')].some(e => e.checkVisibility() && ((e.href && new URL(e.href).pathname === loginPath) || /resend|send (a )?new code|new code|sign in again/i.test(e.innerText))), ctx.route('login'));
    assert.ok(recovery, 'MFA error page offers a recovery path');
    await login(ctx, { expectMfa: true });
    const fresh = (await readMailInTab(ctx, 'verification code')).match(/\b(\d{6})\b/)[1];
    await fill(ctx.page, { code: fresh }); await submit(ctx.page, { field: 'code' });
    assert.equal(await ctx.errorText(), '', 'fresh code accepted');
    const r = await ctx.evaluate([{ type: 'logged_in' }]); assert.ok(r.success);
  },
  async register_verify(ctx) {
    const acct = await ctx.account();
    await ctx.goto(ctx.route('home')); await ctx.nav('register');
    const vals = { accountNumber: acct.accountNumber, email: ctx.episode.persona.email, password: 'Fresh-Start-2026!', confirm: 'Fresh-Start-2026!' };
    if (await has(ctx.page, 'lastName')) vals.lastName = ctx.episode.persona.last;
    if (await has(ctx.page, 'zip')) vals.zip = ctx.episode.persona.zip;
    await fill(ctx.page, vals); await submit(ctx.page, { field: 'accountNumber' });
    assert.equal(await ctx.errorText(), '');
    await followMailLink(ctx, 'verify');
    assert.equal(ctx.path(), ctx.route('login'), 'verification link lands on sign-in');
    await login(ctx, { password: 'Fresh-Start-2026!' });
    const r = await ctx.evaluate([{ type: 'registered' }]); assert.ok(r.success);
  },
  async guest_pay(ctx) {
    const acct = await ctx.account();
    await ctx.goto(ctx.route('home')); await ctx.nav('guest');
    const vals = await guestValues(ctx, acct);
    await fill(ctx.page, vals); await submit(ctx.page, { field: Object.keys(vals)[0] });
    const err = await ctx.errorText(); if (err) throw new Error(`Guest lookup: ${err}`);
    await pay(ctx, { guest: true, newMethod: { methodType: 'card', cardNumber: '4111111111111111', exp: '12/28', cvv: '123', holder: ctx.episode.persona.name } });
    const r = await ctx.evaluate([{ type: 'payment', methodType: 'card', source: 'guest', count: 1 }]); assert.ok(r.success, JSON.stringify(r.results));
  },
  // A guest lookup with a wrong secondary identifier is refused and opens no guest session.
  async guest_mismatch(ctx) {
    const acct = await ctx.account();
    await ctx.goto(ctx.route('home')); await ctx.nav('guest');
    const vals = await guestValues(ctx, acct);
    const wrong = 'lastName' in vals ? 'lastName' : 'zip' in vals ? 'zip' : 'amountDue' in vals ? 'amountDue' : Object.keys(vals)[0];
    vals[wrong] = { lastName: 'Notthename', zip: '99999', amountDue: '1.23' }[wrong] || '000000001';
    await fill(ctx.page, vals); await submit(ctx.page, { field: Object.keys(vals)[0] });
    assert.match(await ctx.errorText(), /could not|not find|match|incorrect|invalid/i, `mismatched ${wrong} refused with a message`);
    assert.ok((await ctx.events('guest_lookup_failed')).length >= 1, 'failed lookup recorded');
    await ctx.goto(ctx.route(ctx.template.flow.guestSteps[1]));
    assert.equal(ctx.path(), ctx.route(ctx.template.flow.guestSteps[0]), 'no guest session after a failed lookup');
    const r = await ctx.evaluate([{ type: 'no_payment' }]); assert.ok(r.success);
  },
  async declined_then_bank(ctx) {
    await ctx.goto(ctx.route('home')); await login(ctx);
    let declined = false; try { await pay(ctx, { methodId: 'pm-card' }); } catch (e) { declined = /declined/i.test(e.message); }
    assert.ok(declined, 'saved card declined');
    await pay(ctx, {});
    const r = await ctx.evaluate([{ type: 'payment', methodType: 'bank', count: 1 }]); assert.ok(r.success, JSON.stringify(r.results));
  },
  // Review opened in tab A, a different amount drafted in tab B; submitting tab A must not pay tab B's amount.
  async stale_review_two_tabs(ctx) {
    await ctx.goto(ctx.route('home')); await login(ctx);
    await pay(ctx, { stopAtReview: true });
    const shownA = moneyOf(await ctx.text());
    const tabB = await ctx.newTab(); const b = ctx.tabCtx(tabB);
    try {
      await b.goto(ctx.route(ctx.template.flow.paySteps[0])); await pay(b, { amountChoice: 'other', amount: '5.00', stopAtReview: true });
      await ctx.page.bringToFront(); await submitReview(ctx);
      const pays = await ctx.payments(); const err = await ctx.errorText();
      if (pays.length) assert.ok(shownA.includes(pays[0].amountCents), `tab A showed ${shownA.map(c => c / 100)} but paid ${pays[0].amountCents / 100} (stale review submitted another tab's draft)`);
      else assert.match(err, /expired|changed|start|again|stale/i, 'stale review is refused with a message');
      assert.ok(pays.length <= 1, 'at most one payment');
    } finally { await tabB.close(); }
  },
  // The session expires on the review page; submitting must not pay, must send the user to sign in with a
  // message, and after signing in again the user can complete exactly one payment.
  async session_expiry_checkout(ctx) {
    await ctx.goto(ctx.route('home')); await login(ctx);
    await pay(ctx, { stopAtReview: true });
    await ctx.advance(31 * MIN);
    await submitReview(ctx);
    assert.equal(ctx.path(), ctx.route('login'), 'expired session goes to sign-in');
    assert.match(await ctx.noticeText(), /sign in|session|expired/i, 'sign-in page explains why');
    assert.equal((await ctx.payments()).length, 0, 'no payment from an expired session');
    ctx.episodeAuthed = false; await login(ctx);
    if (await isReview(ctx.page)) { await submitReview(ctx); const e = await ctx.errorText(); assert.equal(e, '', `review shown after re-login cannot be submitted: ${e}`); }
    else await pay(ctx, {});
    assert.equal((await ctx.payments()).length, 1, 'exactly one payment after re-login');
  },
  async plan_change(ctx) {
    await ctx.goto(ctx.route('home')); await login(ctx); await ctx.nav('plan');
    const first = await ctx.page.evaluate(() => document.querySelector('input[name=planId]')?.value); await fill(ctx.page, { planId: first }); await submit(ctx.page, { field: 'planId' });
    const acct = await ctx.account(); assert.equal(acct.service.plan, first);
  },
  async wrong_password_rejected(ctx) {
    await ctx.goto(ctx.route('home'));
    const e = await login(ctx, { password: 'Wrong-Pass-1!' }).then(() => null, x => x.message);
    assert.match(e || '', /^Login failed: .*(incorrect|invalid)/i, `wrong password rejected with the credential message (got: ${e})`);
    assert.equal((await ctx.events('login_failed')).length, 1, 'login_failed recorded');
    assert.equal((await ctx.events('login')).length, 0, 'no session started');
  },
  // Add a bank account in the wallet, remove it, then try to remove the AutoPay method (must be refused).
  async wallet_add_remove(ctx) {
    const { page } = ctx; await ctx.goto(ctx.route('home')); await login(ctx); await ctx.nav('wallet');
    const vals = { methodType: 'bank', routing: '021000021', bankAccount: '000987654321', bankAccountConfirm: '000987654321' };
    if (await has(page, 'accountType')) vals.accountType = 'checking';
    if (await has(page, 'nickname')) vals.nickname = 'Test savings';
    const known = new Set((await ctx.account()).methods.map(m => m.id)); // a seeded method may also end in 4321
    await fill(page, vals); await submit(page, { field: 'methodType' });
    assert.equal(await ctx.errorText(), '', 'method saved');
    let acct = await ctx.account(); const added = acct.methods.find(m => !known.has(m.id) && m.last4 === '4321' && m.saved && !m.removed);
    assert.ok(added, 'new method is saved'); assert.ok((await ctx.text()).includes('4321'), 'wallet lists the new method');
    await removeMethod(ctx, added.id);
    assert.ok((await ctx.account()).methods.find(m => m.id === added.id).removed, 'method removed in the ledger');
    const r = await ctx.evaluate([{ type: 'method_removed', last4: '4321' }]); assert.ok(r.success, 'method removed');
    assert.equal(await page.$(`[name=methodId][value="${added.id}"]`), null, 'removed method no longer listed');
    acct = await ctx.account(); assert.ok(acct.autopay.enrolled, 'scenario enrolls AutoPay');
    await removeMethod(ctx, acct.autopay.methodId);
    assert.match(await ctx.errorText(), /autopay/i, 'AutoPay method removal refused');
    acct = await ctx.account(); assert.ok(!acct.methods.find(m => m.id === acct.autopay.methodId).removed, 'AutoPay method kept');
  },
  async arrangement(ctx) {
    await ctx.goto(ctx.route('home')); await login(ctx); await ctx.nav('arrangement');
    if (!await has(ctx.page, 'months')) {
      // Templates whose biller type has no payment plans render an explanation instead (and need not link to it).
      assert.match(await ctx.text(), /not (offered|available)/i, 'payment-plan page has neither a form nor a "not offered" explanation');
      ctx.allowDirect.add('arrangement'); return;
    }
    await fill(ctx.page, { months: '6' }); await submit(ctx.page, { field: 'months' });
    assert.equal(await ctx.errorText(), '', 'plan set up');
    const r = await ctx.evaluate([{ type: 'payment_plan', months: 6 }, { type: 'no_payment' }]); assert.ok(r.success, JSON.stringify(r.results));
    assert.ok(/\b6 (monthly )?(payments|months|installments)\b|\b6-month/i.test(await ctx.text()), 'page confirms the 6-month plan');
    assert.ok(/payment plan/i.test(await openMail(ctx, 'payment plan')), 'confirmation email');
  },
  async contact_message(ctx) {
    await ctx.goto(ctx.route('home')); await login(ctx); await ctx.nav('contact');
    const subject = await ctx.page.evaluate(() => { const e = document.querySelector('select[name=subject]'); return e ? [...e.options].map(o => o.value).find(Boolean) : null; }) || 'Question about my bill';
    await fill(ctx.page, { subject, message: 'Why did my bill go up this month?' }); await submit(ctx.page, { field: 'message' });
    assert.equal(await ctx.errorText(), '', 'message sent');
    const r = await ctx.evaluate([{ type: 'message_sent', contains: 'bill go up' }]); assert.ok(r.success, 'message recorded');
    assert.ok(/received your message/i.test(await openMail(ctx, 'We received your message')), 'acknowledgement email');
  },
  async profile_phone(ctx) {
    await ctx.goto(ctx.route('home')); await login(ctx); await ctx.nav('profile');
    await fill(ctx.page, { phone: '12345' }); await submit(ctx.page, { field: 'phone' });
    assert.match(await ctx.errorText(), /phone/i, 'invalid phone refused');
    assert.equal((await ctx.account()).phone ?? null, null, 'invalid phone not stored');
    await fill(ctx.page, { phone: '(614) 555-0142' }); await submit(ctx.page, { field: 'phone' });
    assert.equal(await ctx.errorText(), '', 'valid phone accepted');
    assert.equal((await ctx.account()).phone, '(614) 555-0142');
    assert.equal((await ctx.events('profile_updated')).length, 1);
  },
  // Sign out by the visible control, then a protected URL must redirect to sign-in and return after login.
  async logout_then_protected_redirect(ctx) {
    await ctx.goto(ctx.route('home')); await login(ctx);
    await signOut(ctx);
    await ctx.goto(ctx.route('history'));
    assert.equal(ctx.path(), ctx.route('login'), 'signed-out user is sent to sign-in'); assert.equal(ctx.query('next'), ctx.route('history'));
    await login(ctx);
    assert.equal(ctx.path(), ctx.route('history'), 'sign-in returns to the requested page');
  },
  // Reload keeps a session; reloading a receipt never pays twice; after sign-out, Back and Reload do not show
  // account pages; signing in again shows the payment (state persists across sessions).
  async logout_reload_persistence(ctx) {
    const { page } = ctx; const after = ctx.route(ctx.template.flow.afterLogin);
    await ctx.goto(ctx.route('home')); await login(ctx);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(ctx.path(), after, 'reload keeps the user signed in');
    await pay(ctx, {}); const [p] = await ctx.payments(); assert.ok(p, 'payment made');
    const receiptPath = ctx.path();
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.ok((await ctx.text()).includes(p.confirmation), 'receipt survives a reload');
    assert.equal((await ctx.payments()).length, 1, 'reloading the receipt does not pay again');
    await signOut(ctx);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    assert.ok(!(await ctx.text()).includes(p.confirmation) && ctx.path() !== receiptPath, `Back after sign-out shows the signed-in receipt (${ctx.path()})`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(ctx.path(), ctx.route('login'), `reload after sign-out lands on sign-in (got ${ctx.path()})`);
    await login(ctx); await ctx.nav('history');
    assert.ok((await ctx.text()).includes(p.confirmation), 'payment is listed after signing in again');
    assert.equal((await ctx.payments()).length, 1, 'still exactly one payment');
    const r = await ctx.evaluate([{ type: 'payment', methodType: 'bank', count: 1 }]); assert.ok(r.success, JSON.stringify(r.results));
  },
  // Pay, press Back to the review page and submit again: never a second payment.
  async back_resubmit_review(ctx) {
    const { page } = ctx; await ctx.goto(ctx.route('home')); await login(ctx);
    await pay(ctx, {}); const [p] = await ctx.payments(); assert.ok(p, 'payment made');
    await page.goBack({ waitUntil: 'domcontentloaded' });
    if (await isReview(page)) {
      await submitReview(ctx);
      const err = await ctx.errorText(); const text = await ctx.text();
      assert.ok(text.includes(p.confirmation) || /expired|already|submitted|again|start/i.test(err + ' ' + await ctx.noticeText()), `resubmitting from Back neither showed the receipt nor explained (${ctx.path()}: ${err})`);
    }
    assert.equal((await ctx.payments()).length, 1, 'Back + resubmit created a second payment');
    const r = await ctx.evaluate([{ type: 'payment', count: 1 }]); assert.ok(r.success, JSON.stringify(r.results));
  },
  // Reach review (full amount), go Back and change the amount to $7.00, then replay the first review's form (stale
  // token): it must not pay. The current review still pays exactly $7.00 once.
  async back_edit_stale_token(ctx) {
    const { page } = ctx; await ctx.goto(ctx.route('home')); await login(ctx);
    await pay(ctx, { stopAtReview: true });
    await fill(page, { acceptTerms: true }); await markSubmit(page, { field: 'acceptTerms' }); const old = await captureForm(page, 'acceptTerms');
    assert.ok(await backToStep(ctx, ['amountChoice', 'amount']), 'Back reaches the amount step');
    await pay(ctx, { amountChoice: 'other', amount: '7.00', stopAtReview: true, fromHere: true });
    const replay = await replayPost(page, old);
    assert.equal((await ctx.payments()).length, 0, `stale review token was accepted (${replay.status} ${replay.url})`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    if (await isReview(page)) await submitReview(ctx); else await pay(ctx, { amountChoice: 'other', amount: '7.00', fromHere: !!(await has(page, 'amountChoice') || await has(page, 'amount')) });
    const pays = await ctx.payments();
    assert.equal(pays.length, 1, `expected one payment after the stale replay, got ${pays.length}`); assert.equal(pays[0].amountCents, 700, 'the current review amount is paid');
  },
  // Sign in with Google (separate-origin mock IdP: chooser/identifier, password, consent, callback). Billers without
  // Google sign-in evidence must not show the control. SKIPs only when the build has no mock IdP.
  async google_signin(ctx) {
    const { page } = ctx; const t = ctx.template;
    const routed = ['googleLogin', 'google', 'oauthGoogle', 'googleCallback'].some(r => t.routes?.[r]);
    // browser.mjs passes options.googleSupport (google.mjs googleSupport(): research evidence or template meta).
    const cap = !!ctx.options.googleSupport || ctx.biller.capabilities.google_login?.support === 'supported';
    await ctx.goto(ctx.route('home')); await ctx.nav('login');
    const marked = await page.evaluate(() => { const vis = [...document.querySelectorAll('a[href],button')].filter(x => x.checkVisibility()); const el = vis.find(x => x.href && /\/auth\/google(\?|$)/.test(new URL(x.href).pathname + (new URL(x.href).search ? '?' : ''))) || vis.find(x => /(sign|log) ?in with google|continue with google/i.test(x.innerText + ' ' + (x.getAttribute('aria-label') || ''))); if (el) el.setAttribute('data-bw-google', '1'); return !!el; });
    if (!routed && !cap) {
      if (!ctx.server.googleUrl && !marked) throw new FlowSkip('Google sign-in (no mock IdP in this build)');
      // The IdP exists but this biller has no evidence of Google sign-in: the page must not offer it.
      assert.ok(!marked, 'sign-in page offers Google sign-in although this biller has no Google sign-in evidence');
      return;
    }
    assert.ok(marked, 'Google sign-in is advertised (route/capability) but the sign-in page has no visible control');
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('[data-bw-google]')]);
    for (let i = 0; i < 5 && new URL(page.url()).origin !== ctx.server.baseUrl; i++) {
      const email = ctx.episode.persona.email;
      if (await page.$('input[type=password]')) { await page.$eval('input[type=password]', e => { e.value = ''; }); await page.type('input[type=password]', ctx.episode.credentials?.google?.password || PASSWORD); }
      if (await page.$('input[type=email]')) { const v = await page.$eval('input[type=email]', e => e.value); if (!v) await page.type('input[type=email]', email); }
      const clicked = await page.evaluate(em => { const els = [...document.querySelectorAll('a[href],button,[role=button],input[type=submit]')].filter(x => x.checkVisibility()); const el = els.find(x => (x.innerText || x.value || '').includes(em)) || els.find(x => /^(continue|allow|next|confirm|sign in|accept)/i.test((x.innerText || x.value || '').trim())); if (el) { el.setAttribute('data-bw-idp', '1'); return true; } return false; }, email);
      if (!clicked) throw new Error(`Google mock: no account chooser/consent control at ${page.url()}`);
      await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('[data-bw-idp]')]);
    }
    assert.equal(new URL(page.url()).origin, ctx.server.baseUrl, 'IdP returns to the biller');
    ctx.episodeAuthed = true; assert.equal(await ctx.errorText(), '', 'Google sign-in completes without error');
    const r = await ctx.evaluate([{ type: 'logged_in' }]); assert.ok(r.success, JSON.stringify(r.results));
  },
  // SMS one-time code (mfa:"sms"): the code is read from the persona's phone inbox (/sms) in another tab, never
  // from mail. SKIPs when the build has no SMS channel.
  async sms_mfa(ctx) {
    const phone = ctx.episode.credentials?.phone;
    if (!phone?.url) throw new FlowSkip('SMS MFA (episode has no phone inbox credentials)');
    await ctx.goto(ctx.route('home')); await login(ctx, { expectMfa: true });
    assert.equal(ctx.path(), ctx.route('mfa'), 'sign-in redirects to the verification step');
    const last4 = String(phone.number || '').replace(/\D/g, '').slice(-4);
    const mfaText = await ctx.text();
    assert.ok(!last4 || mfaText.includes(last4) || /phone|text message|sms/i.test(mfaText), 'MFA page tells the user the code went to their phone');
    const tab = await ctx.newTab(); let code;
    try {
      await ctx.goto(phone.url, tab);
      const sender = ctx.biller.brand.shortName;
      const href = await tab.evaluate(s => { const links = [...document.querySelectorAll('a[href^="/sms/c/"]')]; return (links.find(a => a.innerText.includes(s)) || links[0])?.getAttribute('href'); }, sender);
      assert.ok(href, 'phone inbox lists a conversation');
      await Promise.all([tab.waitForNavigation({ waitUntil: 'domcontentloaded' }), tab.click(`a[href="${href}"]`)]);
      code = await tab.evaluate(() => { const b = [...document.querySelectorAll('.bubbles li p, li p')]; return (b.at(-1)?.innerText.match(/\b(\d{6})\b/) || [])[1]; });
    } finally { await tab.close(); await ctx.page.bringToFront(); }
    assert.ok(code, 'SMS carries a 6-digit code');
    const s = await ctx.server.admin(`/state?episodeId=${ctx.episode.episodeId}`);
    const mails = Array.isArray(s.mailbox) ? s.mailbox : Array.isArray(s.mailbox?.messages) ? s.mailbox.messages : [];
    assert.ok(!mails.some(m => JSON.stringify(m).includes(code)), 'SMS code was not also emailed');
    await fill(ctx.page, { code }); await submit(ctx.page, { field: 'code' }); ctx.episodeAuthed = true;
    assert.equal(await ctx.errorText(), ''); assert.equal(ctx.path(), ctx.route(ctx.template.flow.afterLogin), 'SMS MFA lands on the account home');
    const r = await ctx.evaluate([{ type: 'logged_in' }]); assert.ok(r.success, JSON.stringify(r.results));
  },
  // 390x844 smoke: home, sign-in and a full payment by clicks, no horizontal overflow on any of those pages.
  async mobile_smoke(ctx) {
    await ctx.goto(ctx.route('home')); await assertNoOverflow(ctx, 'home');
    if (ctx.biller.template === 'offline' || ctx.biller.capabilities.online_account?.support === 'unsupported') return;
    await ctx.nav('login'); await assertNoOverflow(ctx, 'login');
    await login(ctx); await assertNoOverflow(ctx, 'account home');
    await ctx.nav(ctx.template.flow.paySteps[0]); await assertNoOverflow(ctx, 'pay step 1');
    await pay(ctx, { stopAtReview: true, fromHere: true }); await assertNoOverflow(ctx, 'review');
    await submitReview(ctx); assert.equal(await ctx.errorText(), '', 'payment submitted'); await assertNoOverflow(ctx, 'receipt');
    const r = await ctx.evaluate([{ type: 'payment', methodType: 'bank', count: 1 }]); assert.ok(r.success, JSON.stringify(r.results));
  },
  // Keyboard only: Tab/Enter/Space/arrows from the home page to a submitted payment. No mouse, no typed URLs.
  async keyboard_login_pay(ctx) {
    const { page } = ctx; await ctx.goto(ctx.route('home')); await resetFocus(page);
    await kbLinkTo(ctx, 'login'); await kbEnterNav(ctx);
    if (ctx.template.flow.loginSteps === 2 && !await has(page, 'password')) { await kbType(ctx, 'username', ctx.episode.persona.email); await kbEnterNav(ctx); await resetFocus(page); await kbType(ctx, 'password', PASSWORD); }
    else { await kbType(ctx, 'username', ctx.episode.persona.email); await kbType(ctx, 'password', PASSWORD); }
    await kbEnterNav(ctx); assert.equal(await ctx.errorText(), '', 'keyboard login'); ctx.episodeAuthed = true;
    await resetFocus(page); await kbLinkTo(ctx, ctx.template.flow.paySteps[0]); await kbEnterNav(ctx);
    for (let i = 0; i < 6 && !await isReview(page); i++) {
      await resetFocus(page); let key = null;
      if (await has(page, 'amountChoice')) { await kbRadio(ctx, 'amountChoice', 'due'); key = 'amountChoice'; }
      if (await has(page, 'methodId')) { await kbRadio(ctx, 'methodId', 'pm-chk'); key = key || 'methodId'; }
      if (!key) throw new Error(`Keyboard pay step has no known fields at ${page.url()}`);
      await kbSubmit(ctx, key); const e = await ctx.errorText(); if (e) throw new Error(`Keyboard pay step: ${e}`);
    }
    await resetFocus(page); await kbCheck(ctx, 'acceptTerms'); await kbSubmit(ctx, 'acceptTerms');
    const r = await ctx.evaluate([{ type: 'payment', methodType: 'bank', count: 1 }]); assert.ok(r.success, JSON.stringify(r.results));
    assert.deepEqual(ctx.focusIssues, [], `focusable controls without a visible focus indicator: ${ctx.focusIssues.join(', ')}`);
  },
  // Small screens: no horizontal overflow on key pages, and the navigation reaches pay, AutoPay and help by
  // clicking (opening the mobile menu if there is one), never by typed URLs.
  async mobile_layout(ctx) {
    const overflow = where => assertNoOverflow(ctx, where);
    await ctx.goto(ctx.route('home')); await overflow('home');
    await ctx.nav('login'); await overflow('login');
    await login(ctx); await overflow('account home');
    for (const pg of [ctx.template.flow.paySteps[0], ...(ctx.biller.capabilities.autopay?.support === 'supported' ? ['autopay'] : []), 'help']) {
      await ctx.goto(ctx.route(ctx.template.flow.afterLogin));
      const before = ctx.directNav.length; await ctx.nav(pg); await overflow(pg);
      assert.equal(ctx.directNav.length, before, `navigation does not reach ${pg} on a small screen`);
    }
  }
};

async function guestValues(ctx, acct) {
  const vals = {};
  for (const n of ['accountNumber', 'statementId', 'parcelId', 'plate', 'lastName', 'zip', 'amountDue']) if (await has(ctx.page, n)) vals[n] = { accountNumber: acct.accountNumber, statementId: acct.statementId || acct.accountNumber, parcelId: acct.parcelId || acct.accountNumber, plate: acct.plate || acct.accountNumber, lastName: ctx.episode.persona.last, zip: ctx.episode.persona.zip, amountDue: (acct.invoices.at(-1).amountCents / 100).toFixed(2) }[n];
  return vals;
}

export async function fillAutopay(ctx) {
  const vals = { methodId: 'pm-chk', acceptTerms: true };
  if (await has(ctx.page, 'policy')) vals.policy = 'full';
  await fill(ctx.page, vals); await submit(ctx.page, { field: 'acceptTerms' });
  const err = await ctx.errorText(); if (err) throw new Error(`AutoPay error: ${err}`);
}
export async function cancelAutopay(ctx) {
  const { page } = ctx;
  for (let i = 0; i < 3; i++) {
    const state = await page.evaluate(() => { const a = [...document.querySelectorAll('input[name=action][value=cancel]')][0]; return a ? { form: true, confirm: !!a.form.querySelector('[name=confirm]') } : { link: [...document.querySelectorAll('a,button')].find(x => /cancel autopay|turn off|stop autopay|unenroll|cancel auto/i.test(x.innerText))?.innerText || null }; });
    if (state.form) { await page.evaluate(() => { const a = document.querySelector('input[name=action][value=cancel]'); a.form.querySelector('button').setAttribute('data-bw-cancel', '1'); const c = a.form.querySelector('[name=confirm]'); if (c && c.type === 'checkbox') c.setAttribute('data-bw-confirm', '1'); });
      if (state.confirm && await page.$('[data-bw-confirm]')) await page.click('[data-bw-confirm]');
      await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('[data-bw-cancel]')]); const err = await ctx.errorText(); if (err) throw new Error(`AutoPay cancel: ${err}`); return; }
    if (state.link) { await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => null), page.evaluate(t => [...document.querySelectorAll('a,button')].find(x => x.innerText === t).click(), state.link)]); continue; }
    throw new Error('No AutoPay cancel control');
  }
}

// Flow tiers. CORE runs in --large sampling. EXTENDED flows (adversarial, stateful and accessibility checks) run
// only with options.extended (browser.mjs --flows-extended). OPTIONAL flows feature-detect and SKIP when absent.
export const CORE_FLOWS = ['home_and_help', 'login_view_bill', 'pay_bank'];
export const EXTENDED_FLOWS = new Set(['double_click_submit', 'lockout_then_reset', 'superseded_reset_code', 'expired_mfa', 'stale_review_two_tabs',
  'session_expiry_checkout', 'logout_then_protected_redirect', 'logout_reload_persistence', 'back_resubmit_review', 'back_edit_stale_token',
  'keyboard_login_pay', 'wallet_add_remove', 'arrangement', 'contact_message', 'profile_phone', 'guest_mismatch', 'google_signin', 'sms_mfa']);
export const OPTIONAL_FLOWS = new Set(['google_signin', 'sms_mfa']);

// Which flows apply to a biller, plus the scenario each flow needs. `template` (optional) gates flows on the
// template's routes. Options: extended (include EXTENDED_FLOWS), core (only CORE_FLOWS), mobile (add the 375px
// layout flow), smoke (only mobile_smoke, the 390x844 home/login/pay smoke), withSmoke (keep mobile_smoke in the list).
export function plannedFlows(biller, template = null, options = {}) {
  const all = allFlows(biller, template, options);
  if (options.smoke) return [['mobile_smoke', {}]];
  if (options.core) return all.filter(([f]) => CORE_FLOWS.includes(f) || f === 'offline');
  return all.filter(([f]) => (options.extended || !EXTENDED_FLOWS.has(f)) && (f !== 'mobile_smoke' || options.withSmoke));
}
function allFlows(biller, template, options) {
  const c = biller.capabilities, s = x => c[x]?.support === 'supported';
  const hasRoute = pg => !template || !!template.routes?.[pg];
  if (biller.template === 'offline' || c.online_account?.support === 'unsupported') return [['offline', {}], ['home_and_help', {}], ['mobile_smoke', {}]];
  const flows = [['mobile_smoke', {}], ['home_and_help', {}], ['login_view_bill', {}], ['pay_bank', {}], ['double_click_submit', {}], ['pay_card_other', {}], ['pay_new_bank', {}],
    ['wrong_password_rejected', {}], ['lockout_then_reset', {}], ['reset_password', {}], ['reset_via_email_link', {}], ['superseded_reset_code', {}],
    ['mfa_login', { mfa: 'email' }], ['mfa_next_preserved', { mfa: 'email' }], ['expired_mfa', { mfa: 'email' }], ['register_verify', { registered: false }],
    ['declined_then_bank', { declineSavedCard: true }], ['stale_review_two_tabs', {}], ['session_expiry_checkout', {}], ['logout_then_protected_redirect', {}],
    ['logout_reload_persistence', {}], ['back_resubmit_review', {}], ['back_edit_stale_token', {}], ['keyboard_login_pay', {}],
    ['google_signin', {}], ['sms_mfa', { mfa: 'sms' }]];
  if (hasRoute('statements') && hasRoute('statement')) flows.push(['statement_download_by_click', {}]);
  if (hasRoute('wallet')) flows.push(['wallet_add_remove', { autopay: true }]);
  if (hasRoute('arrangement')) flows.push(['arrangement', { amountCents: 24000 }]);
  if (hasRoute('contact')) flows.push(['contact_message', {}]);
  if (hasRoute('profile')) flows.push(['profile_phone', {}]);
  if (s('scheduled_payment')) flows.push(['schedule_and_cancel', {}]);
  if (s('autopay') && s('autopay_cancel')) flows.push(['autopay_enroll_cancel', {}]);
  if (s('paperless')) flows.push(['paperless', {}]);
  if (s('cancel_service')) flows.push(['cancel_service', {}]);
  if (s('guest_pay')) flows.push(['guest_pay', { registered: false }], ['guest_mismatch', { registered: false }]);
  if (['subscription', 'telecom'].includes(biller.kind)) flows.push(['plan_change', {}]);
  if (options.mobile) flows.push(['mobile_layout', {}]);
  return flows;
}
