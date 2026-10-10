// Authenticated HTTP checks through the real server: sign in with the template's own login form, GET every
// signed-in page, then submit one valid instance of each account form using the field names parsed from the
// rendered HTML (so template field names, CSRF, act() dispatch and redirects are all exercised), with ledger
// assertions after each submission. Used by sweep.mjs (phase "authed") and authed.test.mjs.
import http from 'node:http';
import { PUBLIC_PAGES, templateFor } from '../server.mjs';
import { loginId } from './solve.mjs';
import { PASSWORD, primaryMethodId } from '../engine.mjs';
import { esc } from '../kit.mjs';

// Research metadata must never reach a rendered page (evidence labels, capture fields, internal file names).
export const RESEARCH_LEAK = /\b(documented_link|documented_notes|documented_field|inferred_family|inferred_category|inferred_from_login|synthetic_flow|no_public_website|consolidated_billing|not_observed|route_candidates?|discovered_route|research-data|catalog\.sqlite|catalog-index|body_file|final_url|script_urls|source_urls?|sourceUrl|meta\.evidence)\b/;
export function leakCheck(body) { const m = body.match(RESEARCH_LEAK); return m ? `research metadata in page: "${m[0]}"` : null; }

const unesc = s => String(s ?? '').replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]));
const attrs = tag => { const out = {}; for (const m of tag.matchAll(/([\w:-]+)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)')?/g)) out[m[1].toLowerCase()] = m[2] !== undefined ? unesc(m[2]) : m[3] !== undefined ? unesc(m[3]) : true; return out; };

// Minimal parser for the server-rendered forms (no scripts needed: every template renders plain HTML forms).
export function parseForms(html) {
  const forms = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const a = attrs(m[1]); const inner = m[2]; const controls = []; const buttons = [];
    const tagRe = /<(input|select|textarea|button)\b([^>]*)>/gi; let c;
    while ((c = tagRe.exec(inner))) {
      if (c[1].toLowerCase() !== 'input') { const end = inner.toLowerCase().indexOf(`</${c[1].toLowerCase()}>`, tagRe.lastIndex); c[3] = end >= 0 ? inner.slice(tagRe.lastIndex, end) : ''; if (end >= 0) tagRe.lastIndex = end; }
      const tag = c[1].toLowerCase(); const at = attrs(c[2]);
      if (tag === 'button' || (tag === 'input' && /^(submit|image)$/i.test(at.type || ''))) { if ((at.type || 'submit').toLowerCase() === 'submit') buttons.push({ name: at.name || null, value: at.value ?? '', text: (c[3] || '').replace(/<[^>]+>/g, '').trim() }); continue; }
      if (!at.name) continue;
      if (tag === 'select') { const opts = [...(c[3] || '').matchAll(/<option\b([^>]*)>([^<]*)/gi)].map(o => ({ ...attrs(o[1]), text: o[2] })); const sel = opts.find(o => o.selected) || opts[0]; controls.push({ name: at.name, type: 'select', value: sel ? (sel.value ?? sel.text) : '', options: opts.map(o => o.value ?? o.text) }); continue; }
      if (tag === 'textarea') { controls.push({ name: at.name, type: 'textarea', value: unesc(c[3] || '') }); continue; }
      controls.push({ name: at.name, type: (at.type || 'text').toLowerCase(), value: at.value ?? (/(checkbox|radio)/i.test(at.type || '') ? 'on' : ''), checked: !!at.checked });
    }
    forms.push({ action: a.action || '', method: (a.method || 'get').toLowerCase(), controls, buttons, has: n => controls.some(x => x.name === n), valuesOf: n => controls.filter(x => x.name === n).map(x => x.value) });
  }
  return forms;
}

// Encode a form the way a browser would after the user set `overrides` (field names must exist in the form).
export function encodeForm(form, overrides = {}, { button } = {}) {
  const missing = Object.keys(overrides).filter(k => !form.has(k)); if (missing.length) throw new Error(`form ${form.action} has no field ${missing.join(', ')}`);
  const pairs = []; const done = new Set();
  for (const c of form.controls) {
    if (c.name in overrides) {
      if (done.has(c.name)) continue; done.add(c.name);
      const v = overrides[c.name]; if (v === false || v == null) continue;
      if (c.type === 'checkbox') { pairs.push([c.name, v === true ? c.value : String(v)]); continue; }
      if (c.type === 'radio' && !form.valuesOf(c.name).includes(String(v))) throw new Error(`radio ${c.name} has no option ${v} (options ${form.valuesOf(c.name).join(',')})`);
      if (c.type === 'select' && !c.options.includes(String(v))) throw new Error(`select ${c.name} has no option ${v}`);
      pairs.push([c.name, String(v)]); continue;
    }
    if ((c.type === 'checkbox' || c.type === 'radio') && !c.checked) continue;
    pairs.push([c.name, c.value]);
  }
  const named = form.buttons.filter(b => b.name);
  const b = (button && form.buttons.find(x => x.value === button || x.text.toLowerCase().includes(String(button).toLowerCase()))) || form.buttons.find(x => !x.name || (x.name === 'op' && x.value === 'submit')) || form.buttons[0];
  if (b?.name && named.length) pairs.push([b.name, b.value]);
  return new URLSearchParams(pairs).toString();
}

// Cookie-jar HTTP client bound to one origin.
export class Client {
  constructor(baseUrl, agent) { const u = new URL(baseUrl); this.hostname = u.hostname; this.port = u.port; this.host = u.host; this.agent = agent; this.cookies = new Map(); }
  cookieHeader() { return [...this.cookies].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; '); }
  request(method, path, body) {
    const once = () => new Promise((resolve, reject) => {
      const headers = { cookie: this.cookieHeader() };
      if (body != null) Object.assign(headers, { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body), origin: `http://${this.host}` });
      const req = http.request({ hostname: this.hostname, port: this.port, path, method, agent: this.agent, headers }, res => {
        for (const sc of [].concat(res.headers['set-cookie'] || [])) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i).trim(); const v = decodeURIComponent(kv.slice(i + 1)); if (/max-age=0/i.test(sc)) this.cookies.delete(k); else this.cookies.set(k, v); }
        const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { const buf = Buffer.concat(chunks); resolve({ status: res.statusCode, headers: res.headers, body: buf.toString('utf8'), bytes: buf }); });
      });
      req.on('error', reject); if (body != null) req.write(body); req.end();
    });
    // Only GETs are retried on a reset pooled socket; a POST is never replayed implicitly.
    return once().catch(e => { if (method === 'GET' && (e.code === 'ECONNRESET' || e.code === 'EPIPE')) return once(); throw e; });
  }
  get(path) { return this.request('GET', path); }
  post(path, body) { return this.request('POST', path, body); }
}

const pathOf = u => new URL(u, 'http://x').pathname;
const alertOf = body => (body.match(/role="alert"[^>]*>([\s\S]*?)</) || [])[1]?.trim() || '';

// Run the authenticated checks for one biller inside episode `ep`. Returns a list of failure strings "check: detail".
export async function authedChecks({ server, world, ep, biller: b, client }) {
  const t = templateFor(b); const url = (pg, p, q) => server.urlFor(t, b.id, pg, p, q);
  const fails = []; const fail = (check, detail) => fails.push(`${check}: ${detail}`);
  const acct = () => world.account(ep, b.id);
  const page = async (pg, p) => { const r = await client.get(url(pg, p)); return r; };
  const formOn = (r, pred) => parseForms(r.body).find(f => f.method === 'post' && pred(f));
  const lint = (where, r) => { const leak = leakCheck(r.body); if (leak) fail('leak', `${where}: ${leak}`); if (r.body.includes('Something went wrong')) fail('render', `${where}: "Something went wrong"`); };
  // Submit a form found on `pg` and return the response (303 expected on success).
  async function submitOn(check, pg, pred, overrides, opts = {}) {
    const r = await page(pg); if (r.status !== 200) { fail(check, `GET ${pg} -> ${r.status}`); return null; }
    const f = formOn(r, pred); if (!f) { fail(check, `no matching form on ${pg}`); return null; }
    let body; try { body = encodeForm(f, overrides, opts); } catch (e) { fail(check, e.message); return null; }
    const res = await client.post(f.action || url(pg), body); res.form = f; res.sent = body;
    if (!opts.expectError && res.status !== 303) fail(check, `POST ${pg} -> ${res.status} ${alertOf(res.body)}`);
    return res;
  }

  // ---- sign in through the template's login form(s) ----
  client.cookies.delete('bwf_sid');
  let r = await page('login'); if (r.status !== 200) { fail('login', `GET login -> ${r.status}`); return fails; }
  let f = formOn(r, x => x.has('username') || x.has('password'));
  if (!f) { fail('login', 'no login form'); return fails; }
  if (!f.has('password')) {
    const step = await client.post(f.action, encodeForm(f, { username: loginId(world, ep, b.id) }));
    if (step.status !== 303) { fail('login', `username step -> ${step.status}`); return fails; }
    r = await client.get(step.headers.location); f = formOn(r, x => x.has('password'));
    if (!f) { fail('login', 'no password form on second step'); return fails; }
  }
  const creds = { password: PASSWORD }; if (f.controls.some(c => c.name === 'username' && c.type !== 'hidden')) creds.username = loginId(world, ep, b.id);
  r = await client.post(f.action, encodeForm(f, creds));
  if (r.status !== 303 || pathOf(r.headers.location) !== url(t.flow.afterLogin)) { fail('login', `expected 303 to ${url(t.flow.afterLogin)}, got ${r.status} ${r.headers.location || alertOf(r.body)}`); return fails; }
  if (!client.cookies.get('bwf_sid')) { fail('login', 'no session cookie'); return fails; }

  // ---- every signed-in page renders ----
  const signedIn = Object.entries(t.routes).filter(([pg, pat]) => !PUBLIC_PAGES.has(pg) && !pat.includes(':') && pg !== 'logout').map(([pg]) => pg);
  for (const pg of signedIn) {
    const res = await page(pg);
    if (pg === 'payReview' && res.status === 303) continue; // no draft yet: review redirects to the first pay step
    if (res.status !== 200) { fail(`get:${pg}`, `${url(pg)} -> ${res.status} ${res.headers.location || alertOf(res.body) || res.body.replace(/<[^>]+>/g, ' ').slice(0, 120)}`); continue; }
    if (!/^<!doctype html>/i.test(res.body)) fail(`get:${pg}`, 'not a full HTML document');
    if (!res.body.includes(esc(b.entry.name)) && !res.body.includes(esc(b.brand.shortName))) fail(`get:${pg}`, 'biller name missing');
    lint(pg, res);
  }
  // ---- every link on the signed-in home resolves (no dead links in profile-driven navigation) ----
  {
    const homePath = url(t.flow.afterLogin); const home = await client.get(homePath); const seenLinks = new Set();
    for (const m of home.body.matchAll(/<a\b[^>]*?\bhref\s*=\s*"([^"]*)"/gi)) {
      const href = unesc(m[1]); if (!href || /^(mailto|tel|sms):/i.test(href)) continue;
      if (href.startsWith('#')) { if (href.length > 1 && !new RegExp(`\\b(id|name)\\s*=\\s*"${href.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(home.body)) fail('deadlink', `${homePath}: ${href}`); continue; }
      const u = new URL(href, `http://${client.host}${homePath}`);
      if (u.host !== client.host) { fail('deadlink', `${homePath}: external link ${href.slice(0, 120)}`); continue; }
      if (u.pathname === url('logout') || seenLinks.has(u.pathname + u.search)) continue; seenLinks.add(u.pathname + u.search);
      let at = u.pathname + u.search, res;
      for (let hop = 0; hop < 4; hop++) { res = await client.get(at); if (res.status >= 300 && res.status < 400 && res.headers.location) at = new URL(res.headers.location, `http://${client.host}${at}`).pathname + new URL(res.headers.location, `http://${client.host}${at}`).search; else break; }
      if (res.status !== 200) fail('deadlink', `${homePath}: ${u.pathname}${u.search} -> ${res.status} (final ${at})`);
      else if (pathOf(at) === url('login')) fail('deadlink', `${homePath}: ${u.pathname} signs the user out (lands on sign-in)`);
    }
  }
  const inv = acct().invoices.at(-1);
  const pdf = await client.get(url('statement', { id: inv.id }));
  if (pdf.status !== 200 || pdf.headers['content-type'] !== 'application/pdf' || pdf.bytes.subarray(0, 5).toString() !== '%PDF-') fail('statement', `statement PDF -> ${pdf.status} ${pdf.headers['content-type']}`);

  // ---- account forms, each followed by a ledger assertion ----
  if (t.routes.arrangement && world.balance(acct()) >= 5000) {
    const pg = await page('arrangement'); const offered = !!formOn(pg, x => x.has('months'));
    if (!offered && !/not (offered|available)/i.test(pg.body) && !pg.body.includes('data-capability="payment_arrangement"')) fail('arrangement', 'no payment-plan form and no "not offered" explanation');
    const res = offered ? await submitOn('arrangement', 'arrangement', x => x.has('months'), { months: '6' }) : null;
    if (res?.status === 303 && acct().arrangement?.months !== 6) fail('arrangement', 'ledger has no 6-month plan');
  }
  if (t.routes.contact) {
    const cf = formOn(await page('contact'), x => x.has('message')); const subj = cf?.controls.find(c => c.name === 'subject');
    const subject = subj?.type === 'select' ? subj.options.find(Boolean) : 'Sweep question';
    const res = await submitOn('contact', 'contact', x => x.has('message'), { subject, message: 'Checking the secure message form.' });
    if (res?.status === 303 && !acct().messages.some(m => m.subject === subject && /secure message form/.test(m.message))) fail('contact', 'message not recorded');
  }
  if (t.routes.profile) {
    const bad = await submitOn('profile', 'profile', x => x.has('phone'), { phone: '12345' }, { expectError: true });
    if (bad && (bad.status !== 400 || !/phone/i.test(alertOf(bad.body)))) fail('profile', `invalid phone -> ${bad.status} ${alertOf(bad.body)}`);
    const res = await submitOn('profile', 'profile', x => x.has('phone'), { phone: '(614) 555-0142' });
    if (res?.status === 303 && acct().phone !== '(614) 555-0142') fail('profile', 'phone not stored');
  }
  if (t.routes.wallet) {
    const known = new Set(acct().methods.map(m => m.id)); // a seeded method may also end in 4321: identify the new one by id
    const viaCard = primaryMethodId(b) !== 'pm-chk'; // card-only billers save a card ending 4321 instead
    const res = await submitOn('wallet', 'wallet', x => x.has('methodType'), viaCard ? { methodType: 'card', cardNumber: '4000056655064321', exp: '12/29', cvv: '123' } : { methodType: 'bank', routing: '021000021', bankAccount: '000987654321', bankAccountConfirm: '000987654321' });
    const added = acct().methods.find(m => !known.has(m.id) && m.last4 === '4321' && m.saved && !m.removed);
    if (res?.status === 303 && !added) fail('wallet', 'added method not saved');
    if (added) {
      const rm = await submitOn('wallet', 'wallet', x => x.valuesOf('methodId').includes(added.id) && x.valuesOf('op').includes('remove'), {});
      if (rm?.status === 303 && !acct().methods.find(m => m.id === added.id).removed) fail('wallet', 'remove did not remove');
    }
  }
  const sup = cap => b.capabilities[cap]?.support === 'supported';
  if (sup('autopay') && t.routes.autopay) {
    const ov = { acceptTerms: true }; const res0 = await page('autopay'); const af = formOn(res0, x => x.has('acceptTerms'));
    if (af?.has('methodId')) ov.methodId = primaryMethodId(b, { autopay: true }); if (af?.has('policy')) { const pv = af.controls.filter(x => x.name === 'policy').flatMap(x => x.options || [x.value]); ov.policy = pv.includes('full') || !pv.length ? 'full' : pv.includes('statement') ? 'statement' : pv[0]; }
    const res = await submitOn('autopay', 'autopay', x => x.has('acceptTerms'), ov);
    if (res?.status === 303 && !acct().autopay.enrolled) fail('autopay', 'not enrolled after submit');
    if (acct().autopay.enrolled && t.routes.wallet) {
      const mid = acct().autopay.methodId;
      const rm = await submitOn('wallet', 'wallet', x => x.valuesOf('methodId').includes(mid) && x.valuesOf('op').includes('remove'), {}, { expectError: true });
      if (rm && (![400, 409].includes(rm.status) || !/autopay/i.test(alertOf(rm.body)))) fail('wallet', `removing the AutoPay method -> ${rm.status} ${alertOf(rm.body)}`);
      if (acct().methods.find(m => m.id === mid).removed) fail('wallet', 'AutoPay method was removed');
    }
  }
  if (sup('paperless') && t.routes.paperless) {
    const res = await submitOn('paperless', 'paperless', x => x.has('paperless'), {});
    if (res?.status === 303 && acct().paperless !== true) fail('paperless', 'not enrolled after submit');
  }
  const planOffline = ['unsupported', 'not_applicable'].includes(b.capabilities.change_plan?.support); // dossier: plans change offline only (the page shows the note, no form)
  if (t.routes.plan && world.plans(acct()).length && !planOffline) {
    const target = world.plans(acct()).find(p => !p.current);
    if (target) { const res = await submitOn('plan', 'plan', x => x.has('planId'), { planId: target.id }); if (res?.status === 303 && acct().service.plan !== target.id) fail('plan', 'plan not changed'); }
  }

  // ---- pay wizard over HTTP, then replay the review POST ----
  const before = acct().payments.filter(p => !p.seeded).length;
  let at = url(t.flow.paySteps[0]); let review = null;
  for (let i = 0; i < 6 && !review; i++) {
    const res = await client.get(at); if (res.status !== 200) { fail('pay', `GET ${at} -> ${res.status}`); break; }
    lint(`pay step ${i}`, res);
    const rf = formOn(res, x => x.has('token') && x.has('acceptTerms'));
    if (rf) { review = rf; break; }
    const sf = formOn(res, x => x.has('amountChoice') || x.has('amount') || x.has('methodId') || x.has('methodType'));
    if (!sf) { fail('pay', `no pay form at ${at}`); break; }
    const ov = {}; if (sf.has('amountChoice')) ov.amountChoice = sf.valuesOf('amountChoice').includes('due') ? 'due' : sf.valuesOf('amountChoice')[0]; if (sf.has('methodId') && sf.valuesOf('methodId').includes(primaryMethodId(b))) ov.methodId = primaryMethodId(b);
    let body; try { body = encodeForm(sf, ov); } catch (e) { fail('pay', e.message); break; }
    const step = await client.post(sf.action, body);
    if (step.status !== 303) { fail('pay', `step ${i} POST -> ${step.status} ${alertOf(step.body)}`); break; }
    at = step.headers.location;
  }
  if (review) {
    const body = encodeForm(review, { acceptTerms: true });
    const res = await client.post(review.action, body);
    const made = acct().payments.filter(p => !p.seeded);
    if (res.status !== 303 || !/receipt|confirm/i.test(res.headers.location || '') && made.length === before) fail('pay', `review POST -> ${res.status} ${res.headers.location || alertOf(res.body)}`);
    else if (made.length !== before + 1) fail('pay', `expected 1 new payment, ledger has ${made.length - before}`);
    else {
      const p = made.at(-1);
      const receipt = await client.get(res.headers.location);
      if (receipt.status !== 200 || !receipt.body.includes(p.confirmation)) fail('pay', `receipt ${receipt.status} lacks confirmation ${p.confirmation}`);
      const again = await client.post(review.action, body);
      if (again.status !== 303 || again.headers.location !== res.headers.location) fail('pay', `replayed review POST -> ${again.status} ${again.headers.location || alertOf(again.body)} (expected the original receipt)`);
      if (acct().payments.filter(x => !x.seeded).length !== before + 1) fail('pay', 'replayed review POST created a second payment');
      // Stale-state check: signed-in pages reflect the payment immediately.
      const hist = await page('history'); if (hist.status !== 200 || !hist.body.includes(p.confirmation)) fail('pay', 'payment history does not list the new payment');
    }
  }

  // ---- sign out ends the session ----
  if (t.routes.logout) {
    // Sign out through the link the page renders (it may carry a CSRF token), never a bare URL.
    const home = await page(t.flow.afterLogin);
    const href = [...home.body.matchAll(/<a\b[^>]*href="([^"]+)"/gi)].map(m => unesc(m[1])).find(h => pathOf(h) === url('logout'));
    if (!href) fail('logout', `no sign-out link on ${t.flow.afterLogin}`);
    const out = href ? await client.get(href) : { status: 0, headers: {} };
    if (href && (out.status !== 303 || pathOf(out.headers.location || '') !== url('home'))) fail('logout', `sign-out link -> ${out.status} ${out.headers.location || ''}`);
    const after = await page(t.flow.afterLogin);
    if (after.status !== 303 || pathOf(after.headers.location || '') !== url('login')) fail('logout', `signed-out ${t.flow.afterLogin} -> ${after.status} ${after.headers.location || ''}`);
  }
  return fails;
}
