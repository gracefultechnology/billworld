// Catalog-wide verification sweep for Billworld Fleet. For every biller (or a filtered subset):
//  (a) HTTP: home, help, every help article, help search and login render (offline login redirects home);
//  (b) engine lifecycle through FleetWorld (login, pay, schedule+cancel, autopay, paperless, cancel service,
//      password reset, guest lookup) with predicates evaluated by world.evaluate;
//      Every public page is linted for leaked research metadata, and each task's expected answer string (help
//      phone, offline contact) must appear on some public page of that biller;
//  (b) authed: sign in through the template's own login form, GET every signed-in page, then POST one valid
//      submission per account form (field names parsed from the rendered form, CSRF, act(), redirects) with ledger
//      assertions, a pay wizard plus a replayed review POST, and sign-out (see httpflows.mjs);
//  (c) engine lifecycle through FleetWorld (login, pay, schedule+cancel, autopay, paperless, cancel service,
//      password reset, guest lookup) with predicates evaluated by world.evaluate;
//  (d) generated tasks are well formed, capability-consistent, fail on a no-op and pass after a reference solution.
//  (e) links: crawl every <a href> on each biller's profile-driven public pages (home and help center) over HTTP and
//      follow redirects: every same-origin link must end in a 200 page (or PDF), every #fragment must name an
//      element on its page, and no link may leave the fleet origin (mailto:/tel: and redirects to the fleet's own mock
//      Google IdP are allowed).
// Usage: node billworld/fleet/tests/sweep.mjs [--limit N] [--template id[,id]] [--concurrency 64]
//        [--skip http,authed,engine,tasks,links] [--per-episode 50] [--shards N] [--stride K] [--out path]
// The catalog is split across --shards worker threads (default: half the cores, max 8); each shard runs its own
// in-process fleet server and all three phases, and the main thread merges the results.
import http from 'node:http';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { start, templateFor } from '../server.mjs';
import { helpArticles } from '../help.mjs';
import { generateTasks } from '../tasks.mjs';
import { esc } from '../kit.mjs';
import { lifecycle, SOLVERS, slugOf, taskShapeErrors, NOOP_PASS_OK } from './solve.mjs';
import { authedChecks, Client, leakCheck } from './httpflows.mjs';

const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
const limit = Number(arg('limit', 0)) || Infinity;
const stride = Math.max(1, Number(arg('stride', 1))); // --stride K: every K-th biller (a catalog-wide sample)
const onlyTemplates = (arg('template', '') || '').split(',').filter(Boolean);
const concurrency = Number(arg('concurrency', 64));
const skip = new Set((arg('skip', '') || '').split(',').filter(Boolean));
const perEpisode = Number(arg('per-episode', 50));
const here = fileURLToPath(new URL('.', import.meta.url));
const out = arg('out', `${here}../.sweep/results.json`); // stays inside fleet/ (gitignored)
const MAX_FAILURES = 250000;
const shards = Math.max(1, Number(arg('shards', Math.min(8, Math.max(1, Math.floor(availableParallelism() / 2))))));
const shard = isMainThread ? null : workerData.shard;

const t0 = Date.now();
const log = (...a) => { if (isMainThread || shard === 0) console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]${isMainThread ? '' : ` shard ${shard}/${shards}`}`, ...a); };

if (isMainThread && shards > 1) {
  // ---------- coordinator ----------
  const results = await Promise.all(Array.from({ length: shards }, (_, i) => new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { argv, workerData: { shard: i }, resourceLimits: { maxYoungGenerationSizeMb: 192 } });
    w.on('message', resolve); w.on('error', reject); w.on('exit', code => { if (code) reject(new Error(`shard ${i} exited ${code}`)); });
  })));
  const per = {};
  const add = (a, b) => { for (const [k, v] of Object.entries(b)) { if (typeof v === 'number') a[k] = (a[k] || 0) + v; else if (v && typeof v === 'object') add(a[k] ||= {}, v); else a[k] = v; } };
  for (const r of results) for (const [tpl, s] of Object.entries(r.per)) add(per[tpl] ||= {}, s);
  const timings = {}; for (const r of results) for (const [k, v] of Object.entries(r.timings)) timings[k] = Math.max(timings[k] || 0, v);
  report({ per, failures: results.flatMap(r => r.failures), failureCount: results.reduce((a, r) => a + r.failureCount, 0), timings, catalog: results[0].catalog, swept: results.reduce((a, r) => a + r.swept, 0) });
} else {
  const r = await runShard(isMainThread ? 0 : shard, isMainThread ? 1 : shards);
  if (isMainThread) report(r); else parentPort.postMessage(r);
}

function report({ per, failures, failureCount, timings, catalog, swept }) {
  const perTemplate = Object.fromEntries(Object.entries(per).sort());
  const sum = key => Object.values(perTemplate).reduce((a, s) => ({ checked: a.checked + (key === 'http' ? s.http.requests : key === 'tasks' ? s.tasks.count : key === 'links' ? s.links.links : s[key].billers), ok: a.ok + s[key].ok, fail: a.fail + s[key].fail }), { checked: 0, ok: 0, fail: 0 });
  const byCheck = {}; for (const f of failures) { const k = `${f.phase}:${f.check}`; byCheck[k] = (byCheck[k] || 0) + 1; }
  const result = {
    generatedAt: new Date().toISOString(), durationMs: Date.now() - t0, timings, args: { limit: Number.isFinite(limit) ? limit : null, stride, templates: onlyTemplates, concurrency, skip: [...skip], perEpisode, shards },
    catalog: { ...catalog, swept },
    totals: { http: sum('http'), authed: sum('authed'), engine: sum('engine'), tasks: sum('tasks'), links: sum('links'), failures: failureCount, failuresRecorded: failures.length },
    failuresByCheck: Object.fromEntries(Object.entries(byCheck).sort((a, b) => b[1] - a[1])),
    perTemplate, failures
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 1));
  log(`wrote ${out}`);
  console.log(JSON.stringify({ durationMs: result.durationMs, timings, totals: result.totals, failuresByCheck: Object.fromEntries(Object.entries(result.failuresByCheck).slice(0, 30)) }, null, 1));
  process.exitCode = failureCount ? 1 : 0;
}

async function runShard(shardIndex, shardCount) {
const server = await start({ port: 0, adminPort: 0, quiet: true });
const world = server.world;
server.publicServer.keepAliveTimeout = 120000; server.publicServer.headersTimeout = 125000; // event-loop stalls under load must not reset pooled sockets
const all = [...world.catalog.billers.values()];
const billers = all.filter(b => !onlyTemplates.length || onlyTemplates.includes(b.template)).filter((_, i) => i % stride === 0).slice(0, limit).filter((_, i) => i % shardCount === shardIndex);
const templateFiles = new Set(server.templates.keys());
// Same rule as the server: the offline template (any signal) or documented unsupported online accounts.
const isOffline = b => typeof world.isOffline === 'function' ? world.isOffline(b) : (b.template === 'offline' || b.capabilities.online_account.support === 'unsupported');
log(`catalog ${all.length} billers, ${templateFiles.size} template files loaded (${[...templateFiles].join(', ')}); sweeping ${billers.length}${shardCount > 1 ? ` per shard x ${shardCount}` : ''}`);

const per = new Map();
const stats = tpl => { if (!per.has(tpl)) per.set(tpl, { billers: 0, renderedBy: templateFiles.has(tpl) ? tpl : 'generic', http: { requests: 0, ok: 0, fail: 0, shortNameOnly: 0 }, links: { billers: 0, links: 0, ok: 0, fail: 0 }, authed: { billers: 0, ok: 0, fail: 0 }, engine: { billers: 0, ok: 0, fail: 0 }, tasks: { count: 0, ok: 0, fail: 0, bySlug: {} } }); return per.get(tpl); };
for (const b of billers) stats(b.template).billers++;
const failures = []; let failureCount = 0;
const fail = (phase, b, check, detail) => { failureCount++; if (failures.length < MAX_FAILURES / shardCount) failures.push({ phase, billerId: b.id, template: b.template, renderedBy: stats(b.template).renderedBy, name: b.entry.name, check, detail: String(detail).slice(0, 400) }); };

// ---------- (a) HTTP ----------
const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
const { hostname, port } = new URL(server.baseUrl);
// GETs are idempotent: retry once when a pooled keep-alive socket was reset under load.
const get = (path, cookie) => get1(path, cookie).catch(e => { if (e.code === 'ECONNRESET' || e.code === 'EPIPE') return get1(path, cookie); throw e; });
function get1(path, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path, method: 'GET', agent, headers: { cookie } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject); req.end();
  });
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const item = items[i++]; await fn(item); } })); }

function checksFor(b) {
  const t = templateFor(b); const url = (pg, p, q) => server.urlFor(t, b.id, pg, p, q);
  const offline = isOffline(b);
  const list = [{ page: 'home', path: url('home') }, { page: 'help', path: url('help') }, { page: 'helpSearch', path: url('helpSearch', {}, { q: 'pay' }) }];
  for (const a of helpArticles(b)) list.push({ page: `helpArticle:${a.slug}`, path: url('helpArticle', { slug: a.slug }), mustContain: esc(a.title) });
  list.push(offline ? { page: 'login', path: url('login'), redirectTo: url('home') } : { page: 'login', path: url('login') });
  return list;
}
// Expected answer strings of a biller's information tasks (must be findable on its public pages).
function answersFor(b) {
  let tasks; try { tasks = generateTasks(b); } catch { return []; }
  return [...new Set(tasks.map(t => t.answer?.expected).filter(x => typeof x === 'string' && x && x !== 'unavailable'))];
}
async function httpPhase() {
  const pendingAnswers = new Map();
  for (let i = 0; i < billers.length; i += perEpisode * 10) {
    const chunk = billers.slice(i, i + perEpisode * 10);
    const ep = world.createEpisode({ seed: `sweep-http-${i}`, kind: 'sweep' });
    const cookie = `bwf_ep=${ep.id}; bwf_at=${ep.entryToken}`;
    const reqs = chunk.flatMap(b => checksFor(b).map(c => ({ b, ...c })));
    for (const b of chunk) pendingAnswers.set(b.id, answersFor(b));
    await pool(reqs, concurrency, async r => {
      const s = stats(r.b.template).http; s.requests++;
      let res; try { res = await get(r.path, cookie); } catch (e) { s.fail++; return fail('http', r.b, r.page, `request error ${e.message}`); }
      const errs = [];
      if (r.redirectTo) { if (res.status !== 303 || res.headers.location !== r.redirectTo) errs.push(`expected 303 to ${r.redirectTo}, got ${res.status} ${res.headers.location || ''}`); }
      else {
        if (res.status !== 200) errs.push(`status ${res.status}${res.headers.location ? ` -> ${res.headers.location}` : ''}: ${res.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}`);
        else {
          if (!/^<!doctype html>/i.test(res.body)) errs.push('not a full HTML document');
          if (res.body.includes('Something went wrong')) errs.push('contains "Something went wrong"');
          if (!res.body.includes(esc(r.b.entry.name))) { if (res.body.includes(esc(r.b.brand.shortName))) s.shortNameOnly++; else errs.push('biller name missing'); }
          if (r.mustContain && !res.body.includes(r.mustContain)) errs.push(`article title missing: ${r.mustContain}`);
          if (!res.headers['content-security-policy']) errs.push('missing CSP header');
          const leak = leakCheck(res.body); if (leak) errs.push(leak);
          const want = pendingAnswers.get(r.b.id); if (want?.length) pendingAnswers.set(r.b.id, want.filter(a => !res.body.includes(esc(a)) && !res.body.includes(a)));
        }
      }
      if (errs.length) { s.fail++; fail('http', r.b, r.page, `${r.path}: ${errs.join('; ')}`); } else s.ok++;
    });
    for (const b of chunk) { const left = pendingAnswers.get(b.id) || []; for (const a of left) { stats(b.template).http.fail++; fail('http', b, 'answer_not_visible', `expected task answer "${a}" appears on no public page`); } pendingAnswers.delete(b.id); }
    world.episodes.delete(ep.id);
    if ((i / (perEpisode * 10)) % 10 === 0) log(`http ${Math.min(i + chunk.length, billers.length)}/${billers.length}`);
  }
}

// ---------- (b) authenticated pages and forms over HTTP ----------
async function authedPhase() {
  const online = billers.filter(b => !isOffline(b));
  for (let i = 0; i < online.length; i += perEpisode) {
    const chunk = online.slice(i, i + perEpisode);
    const ep = world.createEpisode({ seed: `sweep-authed-${i}`, kind: 'sweep' });
    await pool(chunk, concurrency, async b => {
      const s = stats(b.template).authed; s.billers++;
      const client = new Client(server.baseUrl, agent); client.cookies.set('bwf_ep', ep.id); client.cookies.set('bwf_at', ep.entryToken);
      let fails; try { fails = await authedChecks({ server, world, ep, biller: b, client }); } catch (e) { fails = [`crash: ${e.stack?.split('\n').slice(0, 3).join(' | ')}`]; }
      if (fails.length) { s.fail++; for (const f of fails) fail('authed', b, f.split(':')[0], f); } else s.ok++;
    });
    world.episodes.delete(ep.id);
    if ((i / perEpisode) % 100 === 0) log(`authed ${Math.min(i + chunk.length, online.length)}/${online.length}`);
  }
}

// ---------- (c) engine lifecycle ----------
function enginePhase() {
  let ep = null;
  billers.forEach((b, i) => {
    if (i % perEpisode === 0) { if (ep) world.episodes.delete(ep.id); ep = world.createEpisode({ seed: `sweep-engine-${i}`, kind: 'sweep' }); }
    const s = stats(b.template).engine; s.billers++;
    let fails;
    try { fails = lifecycle(world, ep, b); } catch (e) { fails = [`crash: ${e.stack?.split('\n').slice(0, 3).join(' | ')}`]; }
    if (fails.length) { s.fail++; for (const f of fails) fail('engine', b, f.split(':')[0], f); } else s.ok++;
    if (i % 10000 === 0) log(`engine ${i}/${billers.length}`);
  });
  if (ep) world.episodes.delete(ep.id);
}

// ---------- (d) generated tasks ----------
function tasksPhase() {
  const seen = new Set();
  billers.forEach((b, i) => {
    const s = stats(b.template).tasks;
    let tasks; try { tasks = generateTasks(b); } catch (e) { s.fail++; return fail('tasks', b, 'generate', e.message); }
    if (!tasks.length) fail('tasks', b, 'no_tasks', 'generateTasks returned nothing');
    for (const task of tasks) {
      const slug = slugOf(task); s.count++; const bs = (s.bySlug[slug] ||= { count: 0, fail: 0 }); bs.count++;
      const errs = [];
      if (seen.has(task.id)) errs.push('duplicate_task_id'); seen.add(task.id);
      errs.push(...taskShapeErrors(task, b));
      if (SOLVERS[slug]) {
        // A no-op must not satisfy action tasks.
        const idle = world.createEpisode({ seed: `idle:${task.id}`, scenario: task.scenario, kind: 'sweep' });
        try { world.account(idle, b.id); if (!NOOP_PASS_OK.has(slug) && world.evaluate(idle, task.predicates).success) errs.push('passes_without_action'); } catch (e) { errs.push(`seed_crash: ${e.message}`); }
        world.episodes.delete(idle.id);
        // The reference solution must satisfy every predicate.
        const ep = world.createEpisode({ seed: `solve:${task.id}`, scenario: task.scenario, kind: 'sweep' });
        try { SOLVERS[slug](world, ep, b.id, { server }); const r = world.evaluate(ep, task.predicates); if (!r.success) errs.push(`unsatisfied: ${JSON.stringify(r.results.filter(x => !x.pass).map(x => ({ type: x.type, detail: x.detail })))}`); } catch (e) { errs.push(`solver_error: ${e.code || ''} ${e.message}`); }
        world.episodes.delete(ep.id);
      }
      if (errs.length) { s.fail++; bs.fail++; for (const e of errs) fail('tasks', b, `${slug}:${e.split(':')[0]}`, `${task.id} ${e}`); } else s.ok++;
    }
    if (i % 10000 === 0) log(`tasks ${i}/${billers.length}`);
  });
}

// ---------- (e) links on profile-driven public pages ----------
const linkTargets = html => [...html.matchAll(/<a\b[^>]*?\bhref\s*=\s*"([^"]*)"/gi)].map(m => m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
const hasAnchor = (html, frag) => { const f = decodeURIComponent(frag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp(`\\b(id|name)\\s*=\\s*"${f}"`).test(html); };
async function follow(path, cookie) {
  let at = path;
  for (let hop = 0; hop < 5; hop++) {
    const res = await get(at, cookie);
    if (res.status >= 300 && res.status < 400 && res.headers.location) { const u = new URL(res.headers.location, `http://${hostname}:${port}${at}`); if (u.host !== `${hostname}:${port}`) return { status: res.status, final: u.href, external: true }; at = u.pathname + u.search; continue; }
    return { status: res.status, final: at, type: res.headers['content-type'] || '' };
  }
  return { status: 0, final: at, loop: true };
}
async function linksPhase() {
  for (let i = 0; i < billers.length; i += perEpisode * 10) {
    const chunk = billers.slice(i, i + perEpisode * 10);
    const ep = world.createEpisode({ seed: `sweep-links-${i}`, kind: 'sweep' });
    const cookie = `bwf_ep=${ep.id}; bwf_at=${ep.entryToken}`;
    await pool(chunk, Math.max(1, Math.floor(concurrency / 4)), async b => {
      const s = stats(b.template).links; s.billers++;
      const t = templateFor(b); const sources = [server.urlFor(t, b.id, 'home'), server.urlFor(t, b.id, 'help')];
      const checked = new Map(); let bad = 0;
      const bump = (ok, check, detail) => { s.links++; if (ok) s.ok++; else { s.fail++; bad++; fail('links', b, check, detail); } };
      for (const src of sources) {
        let page; try { page = await get(src, cookie); } catch (e) { bump(false, 'source', `${src}: ${e.message}`); continue; }
        if (page.status !== 200) { bump(false, 'source', `${src} -> ${page.status}`); continue; }
        for (const href of new Set(linkTargets(page.body))) {
          if (!href) { bump(false, 'empty_href', `${src}: <a href="">`); continue; }
          if (/^(mailto|tel|sms):/i.test(href)) continue;
          if (/^javascript:/i.test(href)) { bump(false, 'javascript_href', `${src}: ${href.slice(0, 80)}`); continue; }
          if (href.startsWith('#')) { if (href.length > 1 && !hasAnchor(page.body, href.slice(1))) bump(false, 'dead_fragment', `${src}: ${href}`); else bump(true); continue; }
          const u = new URL(href, `http://${hostname}:${port}${src}`);
          if (u.host !== `${hostname}:${port}`) { bump(false, 'external_link', `${src}: ${href.slice(0, 120)}`); continue; }
          const key = u.pathname + u.search; if (checked.has(key)) continue;
          let r; try { r = await follow(key, cookie); } catch (e) { r = { status: 0, error: e.message }; }
          checked.set(key, r);
          // The only allowed off-origin hop is the fleet's own mock Google IdP ("Sign in with Google").
          const idpOk = r.external && server.googleUrl && new URL(r.final).origin === new URL(server.googleUrl).origin;
          const ok = (r.status === 200 && !r.external) || idpOk;
          bump(ok, r.external ? 'redirects_offsite' : r.loop ? 'redirect_loop' : 'dead_link', `${src}: ${key} -> ${r.status || r.error || ''} ${r.final !== key ? `(final ${r.final})` : ''}`);
          if (ok && u.hash.length > 1 && r.type.includes('html')) { const tgt = await get(r.final, cookie); if (!hasAnchor(tgt.body, u.hash.slice(1))) bump(false, 'dead_fragment', `${src}: ${href}`); }
        }
      }
      if (bad) s.badBillers = (s.badBillers || 0) + 1;
    });
    world.episodes.delete(ep.id);
    if ((i / (perEpisode * 10)) % 10 === 0) log(`links ${Math.min(i + chunk.length, billers.length)}/${billers.length}`);
  }
}

const timings = {};
const timed = async (name, fn) => { if (skip.has(name)) return; const t = Date.now(); await fn(); timings[name] = Date.now() - t; log(`${name} done in ${(timings[name] / 1000).toFixed(1)}s`); };
await timed('http', httpPhase);
await timed('authed', authedPhase);
await timed('engine', enginePhase);
await timed('tasks', tasksPhase);
await timed('links', linksPhase);
agent.destroy(); await server.close();
return { per: Object.fromEntries(per), failures, failureCount, timings, catalog: { billers: all.length, templateFiles: [...templateFiles] }, swept: billers.length };
}
