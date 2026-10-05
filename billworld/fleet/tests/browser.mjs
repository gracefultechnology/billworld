// Fleet Puppeteer suite. Runs every applicable flow for sampled billers of each template.
// Usage: node billworld/fleet/tests/browser.mjs [--templates a,b] [--per-template 3] [--flows x,y] [--concurrency 2] [--all]
//        [--flows-extended] [--viewport desktop|mobile|mobile390] [--mobile] [--large N] [--tag name]
//  default           standard flows (sign-in, pay variants, reset, MFA, register, guest, AutoPay, paperless, ...)
//  --flows-extended  also the extended flows: wallet add/remove + in-use refusal, payment plan, secure message, profile
//                    phone, logout/reload persistence, session expiry mid-checkout, stale review token, Back+resubmit,
//                    double submit, lockout, superseded reset code, expired MFA, guest mismatch, keyboard-only pay,
//                    Google sign-in and SMS MFA (these two SKIP with "not available: ..." when the build lacks them)
//  --mobile          390x844 touch viewport running only the mobile_smoke flow (home, sign-in, pay; no overflow)
//  --viewport mobile 375x812 touch viewport; adds the mobile_layout flow to the planned flows
//  --large N         core flows (home_and_help, login_view_bill, pay_bank) for N billers per template plus N billers
//                    per catalog category (deduplicated)
//  --flows x,y       only these flows (any tier)
// A flow fails when it hit a page error, an external request, or had to type a URL because no visible link existed
// (ctx.directNav), unless the flow whitelisted that page in ctx.allowDirect. Results: fleet/.artifacts/<tag>/results.json.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start } from '../server.mjs';
import { makeCtx, FLOWS, plannedFlows, OPTIONAL_FLOWS, sleep } from './driver.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const flag = name => process.argv.includes(`--${name}`);
const onlyTemplates = arg('templates', '')?.split(',').filter(Boolean);
const large = Number(arg('large', 0)) || 0;
const perTemplate = large || Number(arg('per-template', 2));
const onlyFlows = arg('flows', '')?.split(',').filter(Boolean);
const concurrency = Math.min(Number(arg('concurrency', 2)), Number(process.env.FLEET_MAX_CONCURRENCY || 4));
const all = flag('all');
const extended = flag('flows-extended');
const smoke = flag('mobile');
const viewportName = smoke ? 'mobile390' : arg('viewport', 'desktop');
const VIEWPORTS = {
  desktop: { width: 1365, height: 900 },
  mobile: { width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  mobile390: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }
};
if (!VIEWPORTS[viewportName]) throw new Error(`--viewport must be one of ${Object.keys(VIEWPORTS).join(', ')}`);
const mobile = viewportName === 'mobile';
const tag = arg('tag', (onlyTemplates.length === 1 ? onlyTemplates[0] : 'fleet') + (smoke ? '-mobile390' : mobile ? '-mobile' : '') + (large ? `-large${large}` : '') + (extended ? '-ext' : ''));
const planOpts = { mobile, extended: extended || onlyFlows.length > 0, core: large > 0 && !onlyFlows.length, smoke: smoke && !onlyFlows.length, withSmoke: onlyFlows.includes('mobile_smoke') };

const dataDir = mkdtempSync(join(tmpdir(), 'fleet-'));
const server = await start({ port: 0, adminPort: 0, dataDir, quiet: true });
const artifacts = new URL(`../.artifacts/${tag}/`, import.meta.url); mkdirSync(artifacts, { recursive: true }); // inside fleet/ (gitignored)
// Chrome sometimes fails to launch on a loaded machine: retry a few times before giving up.
let browser;
for (let i = 0; ; i++) { try { browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], protocolTimeout: 180000 }); break; } catch (e) { if (i >= 3) throw e; console.error(`Chrome launch failed (${e.message.split('\n')[0]}); retrying`); await sleep(3000 * (i + 1)); } }
// Origins a flow may load besides the fleet itself (e.g. a separate-origin mock Google IdP, when the build has one).
const extraOrigins = [server.googleUrl, server.idpUrl, ...(server.extraOrigins || [])].filter(Boolean).map(u => new URL(u).origin);

// Deterministic stratified sample: spread across categories within each template.
function sample(templateId) {
  const ids = server.world.catalog.byTemplate.get(templateId) || [];
  if (all) return ids;
  const byCat = new Map(); for (const id of ids) { const c = server.world.biller(id).category; if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(id); }
  return spread([...byCat.values()], perTemplate);
}
// Pick n ids round-robin across groups (deterministic).
function spread(groups, n) {
  const total = groups.reduce((a, g) => a + g.length, 0); const out = []; let i = 0;
  while (out.length < Math.min(n, total)) { const list = groups[i % groups.length]; const pick = list[Math.floor(i / groups.length) * 7919 % list.length]; if (!out.includes(pick)) out.push(pick); i++; if (i > n * 50) break; }
  return out;
}
// --large: N billers per category, spread across that category's templates.
function sampleCategory(category) {
  const byTpl = new Map();
  for (const b of server.world.catalog.billers.values()) if (b.category === category && (!onlyTemplates.length || onlyTemplates.includes(b.template))) { if (!byTpl.has(b.template)) byTpl.set(b.template, []); byTpl.get(b.template).push(b.id); }
  return byTpl.size ? spread([...byTpl.values()], large) : [];
}

// Feature detection: Google sign-in (google.mjs, when present) decides which billers offer it.
const googleSupport = await import('../google.mjs').then(m => m.googleSupport, () => null);
const gSupport = (b, t) => { try { return googleSupport ? googleSupport(b, t) : null; } catch { return null; } };
const jobs = []; const seen = new Set();
const addJobs = (template, biller, extra = {}) => {
  for (const [flow, scenario] of plannedFlows(biller, template, planOpts)) {
    if (onlyFlows.length && !onlyFlows.includes(flow)) continue;
    const key = `${biller.id}:${flow}`; if (seen.has(key)) continue; seen.add(key);
    jobs.push({ template, biller, flow, scenario, ...extra });
  }
};
for (const t of server.templates.values()) {
  if (onlyTemplates.length && !onlyTemplates.includes(t.id)) continue;
  for (const billerId of sample(t.id)) addJobs(t, server.world.biller(billerId), { stratum: `template:${t.id}` });
  // Extended runs also exercise Google sign-in on one biller of this template that offers it (if any does).
  if (planOpts.extended && (!onlyFlows.length || onlyFlows.includes('google_signin')) && googleSupport && !all) {
    const id = (server.world.catalog.byTemplate.get(t.id) || []).find(x => gSupport(server.world.biller(x), t));
    if (id) { const b = server.world.biller(id); const key = `${b.id}:google_signin`; if (!seen.has(key)) { seen.add(key); jobs.push({ template: t, biller: b, flow: 'google_signin', scenario: {}, stratum: `google:${t.id}` }); } }
  }
}
if (large) {
  const categories = [...new Set([...server.world.catalog.billers.values()].map(b => b.category))].sort();
  for (const c of categories) for (const id of sampleCategory(c)) { const b = server.world.biller(id); const t = server.templates.get(b.template) || server.templates.get('generic'); addJobs(t, b, { stratum: `category:${c}` }); }
}
// Templates no catalog biller resolves to (generic) are exercised with borrowed billers: real online catalog billers
// reassigned to that template in this run's in-process catalog, so the server, engine and driver all see the template.
for (const t of server.templates.values()) {
  if (onlyTemplates.length && !onlyTemplates.includes(t.id)) continue;
  if (server.world.catalog.byTemplate.get(t.id)?.length) continue;
  const used = new Set(jobs.map(j => j.biller.id)); const donors = server.world.catalog.byTemplate.get('utility-account');
  const picks = donors.filter(x => !used.has(x) && !server.world.isOffline(server.world.biller(x))).slice(0, Math.max(1, Math.min(perTemplate, 3)));
  for (const bid of picks) {
    const b = server.world.biller(bid); donors.splice(donors.indexOf(bid), 1); b.template = t.id;
    (server.world.catalog.byTemplate.get(t.id) || server.world.catalog.byTemplate.set(t.id, []).get(t.id)).push(bid);
    addJobs(t, b, { borrowed: true, stratum: `borrowed:${t.id}` });
  }
}
console.log(`${jobs.length} jobs (${new Set(jobs.map(j => j.biller.id)).size} billers) viewport=${viewportName} extended=${planOpts.extended} large=${large || 0} concurrency=${concurrency} tag=${tag}`);

const results = [];
async function runJob(job) {
  const { template, biller, flow, scenario } = job; const began = Date.now();
  let context, page; const errors = [], outbound = [];
  let error = null, skipped = null, ctx = { directNav: [] };
  try {
    context = await browser.createBrowserContext(); page = await context.newPage();
    await page.setViewport(VIEWPORTS[viewportName]); await page.setRequestInterception(true);
    page.on('request', r => { const u = r.url(); if (u.startsWith(server.baseUrl) || extraOrigins.some(o => u.startsWith(o)) || /^(data|about|blob|chrome|chrome-extension|devtools):/.test(u)) r.continue(); else { outbound.push(u); r.abort(); } });
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) errors.push(m.text()); });
    page.setDefaultTimeout(Number(process.env.FLEET_TIMEOUT || 45000));
    let episode;
    try { episode = await server.admin('/episodes', { seed: `${biller.id}:${flow}`, billerId: biller.id, scenario: { [biller.id]: scenario } }); }
    catch (e) { if (OPTIONAL_FLOWS.has(flow) && /unsupported|bad_scenario|scenario/i.test(e.message)) { const err = new Error(`not available: ${e.message.split('\n')[0]}`); err.skip = true; throw err; } throw e; }
    ctx = makeCtx({ page, server, biller, template, episode, options: { mobile, viewport: viewportName, googleSupport: gSupport(biller, template) } });
    await page.goto(episode.entryUrl, { waitUntil: 'domcontentloaded' });
    const override = template.driver?.[flow];
    await (override ? override(ctx, FLOWS) : FLOWS[flow](ctx));
    const pageErrors = errors.filter(e => !(ctx.ignoreConsole || []).some(re => re.test(e)));
    if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(' | ')}`);
    if (outbound.length) throw new Error(`External requests: ${outbound.join(', ')}`);
    const typed = ctx.directNav.filter(p => !ctx.allowDirect.has(p));
    if (typed.length) throw new Error(`No visible link; had to type the URL for: ${[...new Set(typed)].join(', ')}`);
  } catch (e) {
    if (e.skip) skipped = e.message.split('\n')[0];
    else {
      error = e.message.split('\n')[0];
      try { await page.screenshot({ path: new URL(`fail-${template.id}-${biller.id}-${flow}.png`, artifacts).pathname, fullPage: true }); } catch {}
    }
  }
  try { await context?.close(); } catch {}
  const r = { template: template.id, billerId: biller.id, category: biller.category, stratum: job.stratum || null, flow, viewport: viewportName, status: skipped ? 'skip' : error ? 'fail' : 'pass', passed: !error && !skipped, skipped, error, directNav: ctx.directNav, ms: Date.now() - began, borrowed: !!job.borrowed };
  results.push(r); console.log(`${r.status.toUpperCase()} ${template.id} ${biller.id} ${flow}${error ? ` — ${error}` : ''}${skipped ? ` — ${skipped}` : ''}${ctx.directNav.length ? ` (direct nav: ${ctx.directNav.join(',')})` : ''}`);
}
const queue = [...jobs];
await Promise.all(Array.from({ length: concurrency }, async () => { while (queue.length) await runJob(queue.shift()); }));
await browser.close(); await server.close();
try { rmSync(dataDir, { recursive: true, force: true }); } catch {}

const summarize = key => { const out = {}; for (const r of results) { const k = r[key] ?? '-'; const t = out[k] ||= { passed: 0, failed: 0, skipped: 0, billers: new Set(), directNav: 0 }; r.status === 'pass' ? t.passed++ : r.status === 'skip' ? t.skipped++ : t.failed++; t.billers.add(r.billerId); if (r.directNav.length) t.directNav++; } return Object.fromEntries(Object.entries(out).sort().map(([k, v]) => [k, { ...v, billers: v.billers.size }])); };
const summary = summarize('template'); const byFlow = summarize('flow'); const byCategory = large ? summarize('category') : undefined;
const skippedFlows = {}; for (const r of results.filter(x => x.skipped)) skippedFlows[r.flow] ||= r.skipped;
writeFileSync(new URL('results.json', artifacts), JSON.stringify({ at: new Date().toISOString(), viewport: viewportName, options: planOpts, large, browser: await puppeteer.executablePath(), summary, byFlow, byCategory, skippedFlows, results }, null, 1));
console.table(summary); console.table(byFlow); if (byCategory) console.table(byCategory);
for (const [f, why] of Object.entries(skippedFlows)) console.log(`SKIPPED ${f}: ${why}`);
const failed = results.filter(r => r.status === 'fail').length, skippedN = results.filter(r => r.status === 'skip').length;
console.log(`${results.length - failed - skippedN}/${results.length - skippedN} flows passed, ${skippedN} skipped (not available)`);
process.exit(failed ? 1 : 0);
