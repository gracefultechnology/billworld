// Dedicated-tier browser suite: every applicable flow (standard + extended) for dedicated billers, plus the dossier's
// own checks. Usage:
//   node billworld/fleet/tests/dedicated.mjs --billers id1,id2 --tag me-coned
//   node billworld/fleet/tests/dedicated.mjs --category electric --tag me-electric
//   node billworld/fleet/tests/dedicated.mjs --dossiers all --tag me-all
// Options: --quick (standard flows only, no extended), --flows a,b, --concurrency N (default 2, max 2 on shared
// machines), --viewport desktop|mobile, --no-validate (skip the dossier validation gate).
// Each biller's latest result is written to fleet/.artifacts/dedicated/<billerId>.json (read by billers/status.mjs);
// the whole run goes to fleet/.artifacts/<tag>/results.json with failure screenshots. Exit 1 on any failure.
// Flows added here:
//   dossier_expectations  every testExpectations entry ({page, contains|notContains|label, signedIn, slug})
//   dossier_contract      what the dossier says, checked generically: public/account nav items visible and linked,
//                         sign-in identifier wording and step count, capability notes shown, payment methods offered
//                         (pay, guest, AutoPay), card fee charged as stated. Labels not visible on any visited page are
//                         reported as warnings (some templates do not show every concept).
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, RESEARCH_NOTE } from '../server.mjs';
import { makeCtx, FLOWS, plannedFlows, OPTIONAL_FLOWS, sleep, login, pay } from './driver.mjs';
import { validateAll } from '../billers/validate.mjs';
import { L as kitL } from '../kit.mjs';
import { brandList } from '../engine.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const flag = name => process.argv.includes(`--${name}`);
const billerArg = (arg('billers', '') || '').split(',').filter(Boolean);
const category = arg('category', '');
const dossiersAll = arg('dossiers', '') === 'all';
const tag = arg('tag', '');
if (!tag) { console.error('--tag <unique-name> is required (shared machine: never reuse another agent\'s tag)'); process.exit(2); }
if (!billerArg.length && !category && !dossiersAll) { console.error('Choose billers: --billers id1,id2 | --category <bill_type or category> | --dossiers all'); process.exit(2); }
const concurrency = Math.max(1, Math.min(Number(arg('concurrency', 2)), Number(process.env.FLEET_MAX_CONCURRENCY || 2)));
const quick = flag('quick');
const onlyFlows = (arg('flows', '') || '').split(',').filter(Boolean);
const viewportName = arg('viewport', 'desktop');
const VIEWPORTS = { desktop: { width: 1365, height: 900 }, mobile: { width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };

const dataDir = mkdtempSync(join(tmpdir(), 'fleet-ded-'));
const server = await start({ port: 0, adminPort: 0, dataDir, quiet: true });
const { world } = server;
const ids = dossiersAll ? [...world.catalog.dedicated]
  : category ? world.catalog.dedicated.filter(id => { const b = world.biller(id); return b.category === category || b.entry.bill_type === category; })
    : billerArg;
const notDedicated = ids.filter(id => !world.catalog.billers.get(id)?.dossier);
const artifacts = new URL(`../.artifacts/${tag}/`, import.meta.url); mkdirSync(artifacts, { recursive: true });
const latestDir = new URL('../.artifacts/dedicated/', import.meta.url); mkdirSync(latestDir, { recursive: true });

// Gate: a dossier must validate before its browser run means anything.
const validation = flag('no-validate') ? {} : await validateAll({ ids });
const invalid = Object.entries(validation).filter(([, r]) => !r.ok);
for (const id of notDedicated) console.log(`FAIL ${id}: not a dedicated biller (no valid dossier applied${world.catalog.dossierErrors?.[id] ? `: ${world.catalog.dossierErrors[id].join('; ')}` : ''})`);
for (const [id, r] of invalid) { console.log(`FAIL ${id}: dossier invalid`); for (const e of r.errors) console.log(`   - ${e}`); }

const visible = (page, text) => page.evaluate(t => { const norm = s => s.replace(/\s+/g, ' ').toLowerCase(); return norm(document.body.innerText).includes(norm(t)); }, text);
const DOSSIER_FLOWS = {
  async dossier_expectations(ctx) {
    const d = ctx.biller.dossier; const exps = d.testExpectations || [];
    const vmLabels = d.labels || {};
    let signedIn = false;
    for (const x of exps.slice().sort((a, b) => !!a.signedIn - !!b.signedIn)) {
      if (x.signedIn && !signedIn) { await ctx.goto(ctx.route('home')); await login(ctx); signedIn = true; }
      const pg = x.page; const target = ctx.route(pg, pg === 'helpArticle' ? { slug: x.slug } : {});
      await ctx.goto(target);
      if (ctx.path() !== target) throw new Error(`expectation page ${pg} redirected to ${ctx.path()}${x.signedIn ? '' : ' (set signedIn: true for account pages)'}`);
      const where = `${pg}${x.slug ? `/${x.slug}` : ''}${x.signedIn ? ' (signed in)' : ''}`;
      for (const t of [].concat(x.contains || [])) assert.ok(await visible(ctx.page, t), `${where}: expected to show "${t}"`);
      for (const t of [].concat(x.notContains || [])) assert.ok(!await visible(ctx.page, t), `${where}: must not show "${t}"`);
      if (x.label) assert.ok(await visible(ctx.page, vmLabels[x.label]), `${where}: expected label ${x.label} = "${vmLabels[x.label]}"`);
    }
  },
  async dossier_contract(ctx) {
    const { page, biller: b } = ctx; const d = b.dossier; const warnings = ctx.warnings = [];
    const seenText = [];
    const snap = async () => seenText.push(await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').toLowerCase()));
    const navCheck = async area => {
      for (const it of d.nav?.[area] || []) {
        const href = it.page ? ctx.route(it.page) : null;
        const ok = await page.evaluate((label, path, help) => [...document.querySelectorAll('[data-dossier-nav] a[href]')].some(a => a.innerText.trim() === label && (path ? new URL(a.href).pathname === path : help ? new URL(a.href).pathname.includes(help) || /\/help|customer-service|faq|support/i.test(new URL(a.href).pathname) : true)), it.label, href, it.helpSlug || null);
        assert.ok(ok, `${area} nav: link "${it.label}" → ${it.page || `help:${it.helpSlug}`} not shown in the dossier nav`);
      }
    };
    await ctx.goto(ctx.route('home')); await snap();
    for (const n of (await page.evaluate(() => [...document.querySelectorAll('[data-capability]')].map(e => e.dataset.capability)))) void n;
    for (const [k, c] of Object.entries(d.capabilities || {})) if (c.support !== 'supported' && c.note && !RESEARCH_NOTE.test(c.note)) assert.ok(await visible(page, c.note), `home: capability note for ${k} not shown`);
    if (Object.values(d.capabilities || {}).some(c => c.support !== 'supported' && c.note && !RESEARCH_NOTE.test(c.note))) assert.ok(await page.$('aside.bwf-compact a[href*="/"]'), 'home: "Ways to manage your account" notice with help links missing');
    if (d.nav?.public) await navCheck('public');
    await ctx.nav('login'); await snap();
    if (d.auth?.identifier || d.labels?.username) { const want = d.labels?.username || { email: 'Email address', username: 'Username', account: 'Account number', phone: 'Mobile phone number', email_or_username: 'Email or username' }[d.auth.identifier]; assert.ok(await page.evaluate(w => [...document.querySelectorAll('label')].some(l => l.innerText.trim().toLowerCase() === w.toLowerCase()), want), `login: identifier field label "${want}" not shown`); }
    if (d.auth?.loginSteps === 2) assert.equal(await page.$('input[name=password]'), null, 'login: two-step sign-in shows the password on the first step');
    if (d.auth?.loginSteps === 1) assert.ok(await page.$('input[name=password]'), 'login: one-step sign-in has no password field');
    if (b.capabilities.guest_pay?.support === 'supported') {
      ctx.allowDirect.add('guest'); await ctx.goto(ctx.route('guest')); await snap();
      for (const f of d.auth?.guestLookupFields || []) assert.ok(await page.$(`[name="${f}"]`), `guest: lookup field ${f} missing`);
      const gm = d.billing?.guestMethods || d.billing?.methods;
      if (gm) { /* method fields appear after lookup; covered by guest_pay */ }
    }
    if (d.auth?.registrationFields) { ctx.allowDirect.add('register'); await ctx.goto(ctx.route('register')); await snap(); for (const f of d.auth.registrationFields) assert.ok(await page.$(`[name="${f}"]`), `register: field ${f} missing`); }
    await ctx.goto(ctx.route('home')); await login(ctx); await snap();
    if (d.nav?.account) await navCheck('account');
    // Pay page: offered method types.
    const methods = d.billing?.methods;
    await ctx.nav(ctx.template.flow.paySteps[0]); await snap();
    if (methods && !methods.includes('card')) assert.equal(await page.$('input[name=cardNumber]'), null, 'pay: card fields shown although cards are not accepted');
    if (methods && !methods.includes('bank')) assert.equal(await page.$('input[name=routing]'), null, 'pay: bank fields shown although bank payments are not accepted');
    for (const pg of ['bill', 'statements', 'history', 'wallet', 'profile']) { ctx.allowDirect.add(pg); await ctx.goto(ctx.route(pg)); await snap(); if (pg === 'wallet' && d.billing?.cardBrands && await page.$('input[name=cardNumber]')) assert.ok(await visible(page, `We accept ${brandList(d.billing.cardBrands)}.`), 'wallet: accepted card networks not stated next to the card number'); }
    if (b.capabilities.autopay?.support === 'supported') {
      await ctx.nav('autopay'); await snap();
      const apt = d.billing?.autopay?.methodTypes;
      if (apt && !apt.includes('card')) { assert.equal(await page.$('input[name=cardNumber]'), null, 'autopay: card fields shown although AutoPay is bank-only'); assert.equal(await page.$('input[name=methodId][value=pm-card]'), null, 'autopay: saved card offered although AutoPay is bank-only'); }
      for (const p of ['minimum', 'statement', 'fixed', 'full'].filter(p => d.billing?.autopay?.policies && !d.billing.autopay.policies.includes(p))) assert.equal(await page.$(`[name=policy][value=${p}], select[name=policy] option[value=${p}]`), null, `autopay: policy ${p} offered although the dossier does not list it`);
    }
    for (const [cap, pg] of [['paperless', 'paperless'], ['payment_arrangement', 'arrangement'], ['cancel_service', 'cancel']]) {
      const c = b.capabilities[cap]; if (!c) continue;
      ctx.allowDirect.add(pg); await ctx.goto(ctx.route(pg)); await snap();
      if (c.dossier && c.support !== 'supported' && c.note) assert.ok(await visible(page, c.note), `${pg}: capability note for ${cap} not shown`);
    }
    if (d.billing?.plans) { ctx.allowDirect.add('plan'); await ctx.goto(ctx.route('plan')); await snap(); for (const p of d.billing.plans) assert.ok(await visible(page, p.name), `plan: plan "${p.name}" not listed`); }
    // Labels: visible somewhere among the visited pages (warning only; asserted ones belong in testExpectations).
    for (const [k, v] of Object.entries(d.labels || {})) if (!seenText.some(t => t.includes(v.toLowerCase()))) warnings.push(`label ${k}="${v}" not visible on home, login, guest, register, account home, pay, bill, statements, history, wallet, profile, autopay, paperless, arrangement or cancel`);
    // Fees: a $25.00 card payment carries the dossier's card fee.
    const f = d.billing?.fees;
    if (f && (!methods || methods.includes('card')) && b.capabilities.pay_online?.support === 'supported') {
      await pay(ctx, { amountChoice: 'other', amount: '25.00', methodId: 'pm-card' });
      const p = (await ctx.payments()).at(-1);
      const want = f.cardPercent != null ? Math.max(f.cardMinCents || 0, Math.round(2500 * f.cardPercent / 100)) : f.cardCents;
      if (want != null) assert.equal(p.feeCents, want, `card fee: charged ${p.feeCents} cents, dossier says ${want}`);
    }
    void kitL;
  }
};

const jobs = [];
for (const id of ids) {
  const b = world.catalog.billers.get(id); if (!b?.dossier || validation[id]?.ok === false) continue;
  const t = server.templateFor(b);
  const flows = [...plannedFlows(b, t, { extended: !quick, mobile: viewportName === 'mobile' }), ['dossier_contract', {}], ...(b.dossier.testExpectations?.length ? [['dossier_expectations', {}]] : [])];
  for (const [flow, scenario] of flows) if (!onlyFlows.length || onlyFlows.includes(flow)) jobs.push({ b, t, flow, scenario });
}
console.log(`${jobs.length} jobs for ${new Set(jobs.map(j => j.b.id)).size} dedicated billers (tag ${tag}, concurrency ${concurrency}, ${quick ? 'standard' : 'standard + extended'} flows, ${viewportName})`);

// The shared Chrome can die mid-run (memory pressure, another agent's load). A flow that fails because the browser or
// its target went away ('Connection closed', 'Target closed', 'detached', ...) is retried once on a relaunched browser
// before it counts as a failure, so a crash costs a relaunch instead of every remaining flow.
const launchBrowser = async () => { for (let i = 0; ; i++) { try { return await puppeteer.launch({ headless: true, args: ['--no-sandbox'], protocolTimeout: 240000, timeout: 180000 }); } catch (e) { if (i >= 3) throw e; await sleep(3000 * (i + 1)); } } };
const BROWSER_GONE = /Connection closed|Target closed|detached|Session closed|browser has disconnected|Browser closed|WebSocket is not open|Protocol error.*(?:closed|Target)/i;
let browser = await launchBrowser(), browserGen = 0, relaunching = null, relaunches = 0;
async function relaunchBrowser(gen) {
  if (gen !== browserGen) return; // another worker already relaunched since this flow started
  relaunching ||= (async () => { const old = browser; try { await old.close(); } catch {} try { old.process()?.kill('SIGKILL'); } catch {} browser = await launchBrowser(); browserGen++; relaunches++; console.log(`browser relaunched (#${relaunches})`); })().finally(() => { relaunching = null; });
  await relaunching;
}
const extraOrigins = [server.googleUrl].filter(Boolean).map(u => new URL(u).origin);
const results = [];
async function runJob(job) {
  const began = Date.now(); let attempt = await runOnce(job), retried = false;
  // Retry once when the failure is the browser's, not the site's: a browser-loss message, or the browser died or was
  // relaunched (by the other worker) while this flow ran (a flow can then fail with an unrelated-looking assertion).
  if (attempt.error && (BROWSER_GONE.test(attempt.error) || !browser.connected || attempt.gen !== browserGen || relaunching)) { retried = true; await relaunchBrowser(attempt.gen); attempt = await runOnce(job); }
  const { b, flow } = job; const { error, skipped, ctx } = attempt;
  const r = { billerId: b.id, name: b.entry.name, category: b.category, template: job.t.id, flow, status: skipped ? 'skip' : error ? 'fail' : 'pass', error, skipped, warnings: ctx.warnings || [], directNav: ctx.directNav, retried, ms: Date.now() - began };
  results.push(r); console.log(`${r.status.toUpperCase()} ${b.id} ${flow}${retried ? ' (retried after browser loss)' : ''}${error ? ` — ${error}` : ''}${skipped ? ` — ${skipped}` : ''}${r.warnings.length ? ` (warnings: ${r.warnings.join('; ')})` : ''}`);
}
async function runOnce({ b, t, flow, scenario }) {
  const gen = browserGen; if (relaunching) await relaunching;
  let context, page, error = null, skipped = null, ctx = { directNav: [] }; const errors = [], outbound = [];
  try {
    if (!browser.connected) { await relaunchBrowser(gen); }
    context = await browser.createBrowserContext(); page = await context.newPage();
    await page.setViewport(VIEWPORTS[viewportName]); await page.setRequestInterception(true);
    page.on('request', r => { const u = r.url(); if (u.startsWith(server.baseUrl) || extraOrigins.some(o => u.startsWith(o)) || /^(data|about|blob|chrome|chrome-extension|devtools):/.test(u)) r.continue(); else { outbound.push(u); r.abort(); } });
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) errors.push(m.text()); });
    page.setDefaultTimeout(Number(process.env.FLEET_TIMEOUT || 60000));
    let episode;
    try { episode = await server.admin('/episodes', { seed: `${b.id}:${flow}`, billerId: b.id, scenario: { [b.id]: scenario } }); }
    catch (e) { if (OPTIONAL_FLOWS.has(flow)) { const err = new Error(`not available: ${e.message}`); err.skip = true; throw err; } throw e; }
    ctx = makeCtx({ page, server, biller: b, template: t, episode, options: { viewport: viewportName } });
    await page.goto(episode.entryUrl, { waitUntil: 'domcontentloaded' });
    const fn = DOSSIER_FLOWS[flow] || t.driver?.[flow] || FLOWS[flow];
    await (t.driver?.[flow] ? fn(ctx, FLOWS) : fn(ctx));
    const pageErrors = errors.filter(e => !(ctx.ignoreConsole || []).some(re => re.test(e))); // flows may whitelist expected console noise (e.g. PDF downloads)
    if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(' | ')}`);
    if (outbound.length) throw new Error(`External requests: ${outbound.join(', ')}`);
    const typed = ctx.directNav.filter(p => !ctx.allowDirect.has(p));
    if (typed.length) throw new Error(`No visible link; had to type the URL for: ${[...new Set(typed)].join(', ')}`);
  } catch (e) {
    if (e.skip) skipped = e.message.split('\n')[0];
    else { error = e.message.split('\n')[0]; try { await page.screenshot({ path: new URL(`fail-${b.id}-${flow}.png`, artifacts).pathname, fullPage: true }); } catch {} }
  }
  try { await context?.close(); } catch {}
  return { error, skipped, ctx, gen };
}
const queue = [...jobs];
await Promise.all(Array.from({ length: concurrency }, async () => { while (queue.length) await runJob(queue.shift()); }));
try { await browser.close(); } catch {} await server.close();
try { rmSync(dataDir, { recursive: true, force: true }); } catch {}

const at = new Date().toISOString();
const perBiller = {};
for (const id of new Set([...ids])) {
  const rs = results.filter(r => r.billerId === id); const b = world.catalog.billers.get(id);
  const v = validation[id];
  const status = !b?.dossier || v?.ok === false ? 'invalid' : rs.length && rs.every(r => r.status !== 'fail') ? 'pass' : rs.length ? 'fail' : 'not_run';
  perBiller[id] = { billerId: id, name: b?.entry.name || null, category: b?.category || null, template: b?.template || null, at, tag, status, quick, flows: rs.length, passed: rs.filter(r => r.status === 'pass').length, failed: rs.filter(r => r.status === 'fail').map(r => ({ flow: r.flow, error: r.error })), skipped: rs.filter(r => r.status === 'skip').map(r => r.flow), warnings: [...new Set(rs.flatMap(r => r.warnings))], validationErrors: v?.errors || world.catalog.dossierErrors?.[id] || [] };
  // Only full (non --flows) runs count toward the tier's test status.
  if (!onlyFlows.length) writeFileSync(new URL(`${id}.json`, latestDir), JSON.stringify(perBiller[id], null, 1));
}
writeFileSync(new URL('results.json', artifacts), JSON.stringify({ at, tag, quick, viewport: viewportName, browserRelaunches: relaunches, retriedFlows: results.filter(r => r.retried).length, billers: perBiller, results }, null, 1));
const failed = results.filter(r => r.status === 'fail').length + invalid.length + notDedicated.length;
console.table(Object.values(perBiller).map(p => ({ biller: p.billerId, status: p.status, passed: `${p.passed}/${p.flows}`, failed: p.failed.length, warnings: p.warnings.length })));
console.log(`${results.filter(r => r.status === 'pass').length}/${results.length - results.filter(r => r.status === 'skip').length} flows passed (${relaunches} browser relaunch(es), ${results.filter(r => r.retried).length} flow(s) retried); ${failed ? `${failed} failure(s)` : 'all green'}. Results: ${artifacts.pathname}results.json`);
process.exit(failed ? 1 : 0);
