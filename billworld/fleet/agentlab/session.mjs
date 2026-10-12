// Blind agent harness daemon: one per run. Owns a Fleet server (benchmark mode: only /enter links start episodes),
// a headless Chrome, and the run's private grader access. Agents never talk to it directly: act.mjs starts it on
// demand and relays one command at a time over a token-protected loopback HTTP port.
//   node billworld/fleet/agentlab/session.mjs <runId>        (normally spawned by act.mjs)
// Run directory: fleet/.agentlab/<runId>/
//   daemon.json (0600: pid, control port + token), state.json (0600: active task), admin-token (0600), data/ (episode
//   snapshots, so a restarted daemon resumes the episode), trajectory.jsonl, results.jsonl, screenshots/, daemon.log.
// Env: AGENTLAB_IDLE_MS (default 1800000: exit after 30 min without commands), AGENTLAB_CMD_TIMEOUT_MS (default 45000),
//      AGENTLAB_TEXT_CHARS (default 6000), AGENTLAB_HEADFUL=1 (show the browser).
import puppeteer from 'puppeteer';
import http from 'node:http';
import net from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync, appendFileSync, existsSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { start as startFleet } from '../server.mjs';
import { instructionFor } from '../infinity/export.mjs';
import { ensureRunDir, readJson, sleep, slugOf, typeOf } from './lib.mjs';

const runId = process.argv[2];
const dir = ensureRunDir(runId);
const F = { daemon: join(dir, 'daemon.json'), state: join(dir, 'state.json'), token: join(dir, 'admin-token'), traj: join(dir, 'trajectory.jsonl'), results: join(dir, 'results.jsonl'), shots: join(dir, 'screenshots'), data: join(dir, 'data') };
const IDLE_MS = Number(process.env.AGENTLAB_IDLE_MS || 30 * 60e3);
const CMD_TIMEOUT = Number(process.env.AGENTLAB_CMD_TIMEOUT_MS || 45e3);
const TEXT_CHARS = Number(process.env.AGENTLAB_TEXT_CHARS || 6000);
const MAX_ELEMENTS = 250;
const write0600 = (file, data) => { writeFileSync(file, data, { mode: 0o600 }); chmodSync(file, 0o600); };
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- Fleet server (ports reused across daemon restarts so URLs the agent saw stay valid) ----------
const portFree = port => new Promise(res => { if (!port) return res(false); const s = net.createServer(); s.once('error', () => res(false)); s.listen(port, '127.0.0.1', () => s.close(() => res(true))); });
const prev = readJson(F.daemon) || readJson(join(dir, 'ports.json')) || {};
let adminToken = existsSync(F.token) ? readFileSync(F.token, 'utf8').trim() : '';
if (!adminToken) { adminToken = randomBytes(24).toString('base64url'); write0600(F.token, adminToken); }
const fleetPort = await portFree(prev.fleetPort) ? prev.fleetPort : 0;
const googlePort = await portFree(prev.googlePort) ? prev.googlePort : 0;
const server = await startFleet({ port: fleetPort, adminPort: 0, googlePort, dataDir: F.data, adminToken, quiet: true, openWorld: false });
const fleetOrigin = new URL(server.baseUrl).origin;
const googleOrigin = server.googleUrl ? new URL(server.googleUrl).origin : null;
writeFileSync(join(dir, 'ports.json'), JSON.stringify({ fleetPort: Number(new URL(server.baseUrl).port), googlePort: googleOrigin ? Number(new URL(googleOrigin).port) : 0 }));
log(`fleet ${server.baseUrl} google ${googleOrigin}`);

// ---------- browser ----------
// Chrome runs with a profile inside the run dir, so a Chrome left behind by a killed daemon of THIS run can be found by
// its command line and stopped; other runs' and other agents' browsers are never touched.
const PROFILE = join(dir, 'chrome-profile');
function killOrphanChrome() {
  try {
    const ps = execFileSync('ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf8' });
    for (const line of ps.split('\n')) { const m = line.trim().match(/^(\d+)\s+(.*)$/); if (m && m[2].includes(`--user-data-dir=${PROFILE}`) && Number(m[1]) !== process.pid) { try { process.kill(Number(m[1]), 'SIGKILL'); log(`killed orphan chrome ${m[1]}`); } catch {} } }
  } catch {}
}
let browser = null, launching = null;
async function getBrowser() {
  if (browser?.connected) return browser;
  launching ||= (async () => {
    for (let i = 0; ; i++) {
      try { killOrphanChrome(); rmSync(PROFILE, { recursive: true, force: true }); const b = await puppeteer.launch({ headless: process.env.AGENTLAB_HEADFUL ? false : true, userDataDir: PROFILE, args: ['--no-sandbox'], protocolTimeout: 60000, timeout: 60000 }); b.on('disconnected', () => log('browser disconnected')); return b; }
      catch (e) { if (i >= 3) throw e; log(`chrome launch failed: ${e.message}`); await sleep(2000 * (i + 1)); }
    }
  })().then(b => { browser = b; return b; }).finally(() => { launching = null; });
  return launching;
}

// ---------- state ----------
// S.active: {taskId, billerId, episodeId, entryPath, instruction, startUrl, startedAt, steps, attempt, meta}
const S = { active: null, attempts: {}, ...(readJson(F.state) || {}) };
const saveState = () => write0600(F.state, JSON.stringify(S, null, 1));
let ctx = null, pages = [], cur = 0, lastObs = null, textOffset = 0, notes = [], blocked = [], dialogs = [], downloadCdp = null;
const pageInfo = new WeakMap(); // page -> {pdf: {url, text}}
const allowedUrl = u => { try { const x = new URL(u); if (/^(data|about|blob|chrome|chrome-extension|devtools):$/.test(x.protocol)) return true; return x.origin === fleetOrigin || (googleOrigin && x.origin === googleOrigin); } catch { return false; } };

async function setupPage(page) {
  pageInfo.set(page, {});
  await page.setViewport({ width: 1280, height: 900 });
  page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
  await page.setRequestInterception(true);
  page.on('request', r => { if (allowedUrl(r.url())) r.continue().catch(() => {}); else { blocked.push(r.url()); r.abort().catch(() => {}); } });
  page.on('dialog', d => { dialogs.push(`${d.type()}: ${d.message()}`); d.accept().catch(() => {}); });
  page.on('response', async resp => {
    try {
      if (resp.request().frame() !== page.mainFrame() || !resp.request().isNavigationRequest()) return;
      if (!/application\/pdf/i.test(resp.headers()['content-type'] || '')) return;
      const buf = await resp.buffer(); pageInfo.get(page).pdf = { url: resp.url(), text: pdfText(buf) };
    } catch { /* body unavailable */ }
  });
  page.on('framenavigated', f => { if (f === page.mainFrame()) { const i = pageInfo.get(page); if (i?.pdf && i.pdf.url !== f.url()) i.pdf = null; } });
}
// The PDF viewer's document has no readable text: fetch the file with this tab's cookies and extract its text.
async function fetchPdfText(p, url) {
  if (!allowedUrl(url)) throw new Error('not on this site');
  const cookies = await p.cookies(url);
  const r = await fetch(url, { headers: { cookie: cookies.map(c => `${c.name}=${c.value}`).join('; ') }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return pdfText(Buffer.from(await r.arrayBuffer()));
}
function pdfText(buf) {
  const s = buf.toString('latin1'); const lines = [];
  for (const m of s.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) lines.push(m[1].replace(/\\([\\()])/g, '$1'));
  return lines.join('\n');
}
async function newContext() {
  try { await ctx?.close(); } catch {}
  const b = await getBrowser();
  ctx = await b.createBrowserContext(); pages = []; cur = 0; lastObs = null; textOffset = 0;
  // Report downloads (the suggested filename) to the agent, as a browser's download bar would; without this a
  // "download the bill and report its filename" task is unanswerable through the blind interface.
  try {
    const dl = join(dir, 'downloads'); if (!existsSync(dl)) (await import('node:fs')).mkdirSync(dl, { recursive: true });
    try { await downloadCdp?.detach(); } catch {}
    downloadCdp = await b.target().createCDPSession();
    await downloadCdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', browserContextId: ctx.id, downloadPath: dl, eventsEnabled: true });
    downloadCdp.on('Browser.downloadWillBegin', e => notes.push(`Download started: "${e.suggestedFilename}" (from ${String(e.url).replace(/^https?:\/\/[^/]+/, '')})`));
    downloadCdp.on('Browser.downloadProgress', e => { if (e.state === 'completed') notes.push('Download completed.'); });
  } catch (e) { log(`download events unavailable: ${e.message}`); }
  ctx.on('targetcreated', async t => { if (t.type() !== 'page' || !t.opener()) return; try { const p = await t.page(); if (p && !pages.includes(p)) { await setupPage(p); pages.push(p); notes.push(`A new tab opened (tab ${pages.length}); it is now the current tab.`); cur = pages.length - 1; } } catch {} });
  const p = await ctx.newPage(); if (!pages.includes(p)) { await setupPage(p); pages.push(p); } cur = pages.indexOf(p); notes = [];
  return p;
}
const page = () => pages[cur];

// Wait for whatever the action triggered: a main-frame navigation, a new tab, or nothing.
async function settle(action) {
  const p = page(); let nav = false;
  const onReq = r => { if (r.isNavigationRequest() && r.frame() === p.mainFrame()) nav = true; };
  p.on('request', onReq);
  const navP = p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(e => e);
  const tabsBefore = pages.length;
  try { await action(); } finally { await sleep(120); }
  if (nav) { const r = await navP; if (r instanceof Error && !/timeout/i.test(r.message)) { /* aborted (e.g. download) */ }
    // POST → 303 → GET: wait until the redirected page has loaded, so feedback and the URL describe the new page.
    try { await p.waitForNetworkIdle({ idleTime: 150, timeout: 4000 }); } catch {}
    try { await p.waitForFunction(() => document.readyState !== 'loading', { timeout: 5000 }); } catch {} }
  else await Promise.race([navP, sleep(350)]);
  p.off('request', onReq);
  if (pages.length > tabsBefore) { await sleep(300); try { await page().waitForFunction(() => document.readyState !== 'loading', { timeout: 10000 }); } catch {} }
}

// ---------- observation (runs in the page) ----------
function snapshotInPage(maxEls) {
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
  for (const el of document.querySelectorAll('[data-agentlab]')) el.removeAttribute('data-agentlab');
  const visible = el => { if (!el.isConnected) return false; if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: false })) return false; if (el.closest('details:not([open]) > :not(summary)')) return false; const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const labelOf = el => {
    const lb = el.getAttribute('aria-labelledby'); if (lb) { const t = lb.split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' '); if (norm(t)) return norm(t); }
    const al = el.getAttribute('aria-label'); if (norm(al)) return norm(al);
    if (el.labels?.length) { const t = [...el.labels].map(l => l.innerText).join(' '); if (norm(t)) return norm(t); }
    return '';
  };
  const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=radio], [role=switch], [contenteditable=""], [contenteditable=true]';
  const els = []; let n = 0, more = 0;
  for (const el of document.querySelectorAll(SEL)) {
    const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase();
    let vis = visible(el);
    if (!vis && tag === 'input' && (type === 'radio' || type === 'checkbox')) vis = [...(el.labels || [])].some(visible);
    if (!vis) continue;
    if (n >= maxEls) { more++; continue; }
    const e = { role: '', name: labelOf(el), state: [] };
    if (tag === 'a') { e.role = 'link'; e.name ||= norm(el.innerText) || norm(el.querySelector('img')?.alt) || norm(el.title); try { const u = new URL(el.href); e.href = u.origin === location.origin ? u.pathname + u.search + u.hash : u.href; } catch {} if (el.target === '_blank') e.state.push('opens new tab'); }
    else if (tag === 'button' || tag === 'summary' || (tag === 'input' && ['submit', 'button', 'reset', 'image'].includes(type))) { e.role = 'button'; e.name ||= norm(el.innerText) || norm(el.value) || norm(el.alt) || norm(el.title); if (tag === 'summary') e.state.push(el.parentElement?.open ? 'expanded' : 'collapsed'); }
    else if (tag === 'select') { e.role = el.multiple ? 'listbox' : 'combobox'; e.value = norm(el.selectedOptions[0]?.text); e.options = [...el.options].map(o => norm(o.text)).slice(0, 30); }
    else if (tag === 'textarea') { e.role = 'textbox (multi-line)'; e.value = el.value; e.placeholder = norm(el.placeholder); }
    else if (tag === 'input') {
      if (type === 'checkbox' || type === 'radio') { e.role = type; e.state.push(el.checked ? 'checked' : 'unchecked'); const lg = el.closest('fieldset')?.querySelector('legend'); if (lg) e.group = norm(lg.innerText); }
      else if (type === 'file') e.role = 'file upload';
      else { e.role = 'textbox' + (type && type !== 'text' ? ` (${type})` : ''); e.value = type === 'password' ? '•'.repeat(el.value.length) : el.value; e.placeholder = norm(el.placeholder); }
      e.name ||= norm(el.placeholder) || norm(el.title) || norm(el.getAttribute('aria-placeholder'));
    } else { e.role = el.getAttribute('role') || tag; e.name ||= norm(el.innerText); if (el.getAttribute('aria-checked')) e.state.push(el.getAttribute('aria-checked') === 'true' ? 'checked' : 'unchecked'); }
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') e.state.push('disabled');
    if (el.required || el.getAttribute('aria-required') === 'true') e.state.push('required');
    if (el.readOnly && tag !== 'select') e.state.push('read-only');
    if (el.getAttribute('aria-invalid') === 'true') e.state.push('invalid');
    if (e.placeholder === e.name) delete e.placeholder;
    e.name = e.name.slice(0, 140);
    el.setAttribute('data-agentlab', String(++n)); e.n = n;
    els.push(e);
  }
  return { url: location.href, title: document.title, contentType: document.contentType, text: document.body ? document.body.innerText : '', elements: els, more };
}
const q = s => JSON.stringify(s);
function renderElement(e) {
  let s = `[${e.n}] ${e.role}${e.name ? ` ${q(e.name)}` : ''}`;
  if (e.group) s += ` (group: ${q(e.group)})`;
  if (e.href) s += ` -> ${e.href}`;
  if (e.value != null && e.role.startsWith('textbox')) s += ` value=${q(e.value)}`;
  if (e.placeholder) s += ` placeholder=${q(e.placeholder)}`;
  if (e.role === 'combobox' || e.role === 'listbox') s += ` selected=${q(e.value || '')} options: ${e.options.map(o => q(o)).join(' | ')}`;
  if (e.state.length) s += ` [${e.state.join(', ')}]`;
  return s;
}
async function snapshot() {
  const p = page();
  const info = pageInfo.get(p) || {};
  if (info.pdf && info.pdf.url === p.url() && info.pdf.text) return { url: p.url(), title: '(PDF document)', text: `[PDF document]\n${info.pdf.text}`, elements: [], more: 0, pdf: true };
  let snap;
  for (let i = 0; i < 3; i++) { try { snap = await p.evaluate(snapshotInPage, MAX_ELEMENTS); break; } catch (e) { if (!/context was destroyed|navigation|detached/i.test(e.message) || i === 2) throw e; await sleep(400); } }
  if (/pdf/i.test(snap.contentType || '')) {
    let text = ''; try { text = await fetchPdfText(p, snap.url); } catch (e) { text = `(could not read the PDF: ${e.message})`; }
    Object.assign(snap, { text: `[PDF document]\n${text}`, title: '(PDF document)', elements: [], more: 0 });
  }
  return snap;
}
function renderObservation(snap, offset = 0) {
  const text = snap.text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const chunk = text.slice(offset, offset + TEXT_CHARS);
  const lines = [`URL: ${snap.url}`, `Title: ${snap.title}`, tabsLine(), '', `--- Page text${offset ? ` (from character ${offset})` : ''} ---`, chunk];
  if (offset + TEXT_CHARS < text.length) lines.push(`... (${text.length - offset - TEXT_CHARS} more characters; run "more" to read on)`);
  lines.push('', `--- Interactive elements (${snap.elements.length}${snap.more ? `, ${snap.more} more not listed` : ''}) ---`);
  for (const e of snap.elements) lines.push(renderElement(e));
  if (!snap.elements.length) lines.push('(none)');
  return { out: lines.join('\n'), textLength: text.length };
}
const tabsLine = () => pages.length > 1 ? `Tabs: ${pages.map((p, i) => `${i + 1}${i === cur ? '*' : ''}`).join(' ')} (current marked *)` : 'Tabs: 1';
const pageSummary = async () => { const p = page(); let title = ''; try { title = await p.title(); } catch {} return `Now at: ${p.url()}\nTitle: ${title}`; };
// Short feedback after an action: alerts, error messages, flash notices shown by the page.
async function feedback() {
  try {
    return await page().evaluate(() => {
      const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
      const sel = '[role=alert], [role=status], [aria-live], .error, .errors, .alert, .flash, .notice, .field-error, [aria-invalid=true]';
      const seen = new Set(); const out = [];
      for (const el of document.querySelectorAll(sel)) { const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue; const t = norm(String(el.innerText || '').replace(/[\u200b-\u200d\u2060\ufeff]/g, '')).slice(0, 300); if (t && /[\p{L}\p{N}]/u.test(t) && !seen.has(t)) { seen.add(t); out.push(t); } }
      // Native form validation blocks a submit silently: report the invalid field the browser focused (and the
      // other invalid fields of that form) with its element number and the browser's message.
      const a = document.activeElement;
      if (a && a.matches && a.matches(':invalid')) {
        const name = el => norm(el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || el.placeholder || el.name || el.type);
        const form = a.form || a.closest('form');
        const bad = [a, ...(form ? [...form.querySelectorAll(':invalid')].filter(el => el !== a && el.matches('input,select,textarea')) : [])].slice(0, 4);
        for (const el of bad) { const n = el.getAttribute('data-agentlab'); out.push(`${n ? `[${n}] ` : ''}"${name(el).slice(0, 80)}": ${el.validationMessage || 'this field is not filled in correctly'}`); }
      }
      return out.slice(0, 8);
    });
  } catch { return []; }
}

// ---------- commands ----------
const needTask = () => { if (!S.active) throw new UserError('No active task. Run: start <taskId>'); if (S.active.finished) throw new UserError('This task is finished. Run: start <taskId> for another task.'); };
class UserError extends Error {}
async function element(n) {
  if (!/^\d+$/.test(String(n ?? ''))) throw new UserError('Give the element number from the last observe, e.g. click 12');
  if (!lastObs || lastObs.url !== page().url() || lastObs.page !== page()) throw new UserError(`The page changed since the last observe. Run observe and use the new numbers.`);
  const h = await page().$(`[data-agentlab="${Number(n)}"]`);
  if (!h) throw new UserError(`Element [${n}] is not on the page any more. Run observe again.`);
  return h;
}
async function clickHandle(h) {
  await h.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest' })).catch(() => {});
  try { await h.click(); } catch { await h.evaluate(el => { const tag = el.tagName.toLowerCase(); if (tag === 'input' && el.labels?.length && !el.getClientRects().length) el.labels[0].click(); else el.click(); }); }
}
const ISO_DATE = s => { const t = String(s).trim(); let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; return null; };

const COMMANDS = {
  async start([taskId]) {
    if (!taskId) throw new UserError('Usage: start <taskId>');
    let replaced = ''; if (S.active && !S.active.finished) { replaced = `NOTE: the unfinished attempt ${S.active.attempt} of ${S.active.taskId} in run ${runId} was abandoned by this start.\n`; await abandon('replaced by a new start'); }
    const bid = taskId.split(':')[0];
    let b; try { b = server.world.biller(bid); } catch { throw new UserError(`Unknown biller in task id ${taskId}`); }
    const tasks = await server.admin(`/tasks?billerId=${encodeURIComponent(bid)}`);
    const task = tasks.find(t => t.id === taskId); if (!task) throw new UserError(`Unknown task ${taskId}`);
    const attempt = (S.attempts[taskId] || 0) + 1; S.attempts[taskId] = attempt;
    const mailPassword = `Mailbox-${randomBytes(4).toString('hex')}!`;
    const ep = await server.admin('/episodes', { taskId, seed: `agentlab:${runId}:${taskId}:${attempt}`, mailPassword, kind: 'agent' });
    let instruction = instructionFor(task, { persona: ep.persona, mailPassword });
    if (/mobile phone number/i.test(task.intent) && !instruction.includes(ep.persona.phone)) instruction += ` Your mobile phone number is ${ep.persona.phone}.`;
    const extra = new Set((b.dossier?.tasks?.extra || []).map(x => x.slug));
    const entry = new URL(ep.entryUrl);
    S.active = { taskId, billerId: bid, episodeId: ep.episodeId, entryPath: entry.pathname + entry.search, instruction, startedAt: Date.now(), steps: 0, attempt,
      meta: { slug: slugOf(task), type: typeOf(task, extra), template: b.template, category: b.category, cohort: task.cohort, evidence: task.evidence, tier: b.dossier ? 'dedicated' : 'family', name: b.entry.name } };
    saveState();
    const p = await newContext();
    await p.goto(server.baseUrl + S.active.entryPath, { waitUntil: 'domcontentloaded' });
    S.active.startUrl = p.url(); saveState();
    return `${replaced}RUN ${runId} | TASK ${taskId} (attempt ${attempt})\n\nINSTRUCTION:\n${instruction}\n\nSTART URL: ${S.active.startUrl}\nThe browser is open on the start URL. Run "observe" to see the page. Finish with: answer "<your final message>"`;
  },
  async instruction() { needTask(); return `INSTRUCTION:\n${S.active.instruction}\n\nSTART URL: ${S.active.startUrl}`; },
  async observe() {
    needTask(); const snap = await snapshot(); lastObs = { url: snap.url, page: page(), snap }; textOffset = 0;
    const r = renderObservation(snap, 0); lastObs.textLength = r.textLength; return r.out;
  },
  async more() {
    needTask(); if (!lastObs) throw new UserError('Run observe first.');
    textOffset += TEXT_CHARS; if (textOffset >= lastObs.textLength) { textOffset = Math.max(0, lastObs.textLength - TEXT_CHARS); return '(end of page text)'; }
    const text = lastObs.snap.text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return `--- Page text (from character ${textOffset}) ---\n${text.slice(textOffset, textOffset + TEXT_CHARS)}${textOffset + TEXT_CHARS < text.length ? `\n... (${text.length - textOffset - TEXT_CHARS} more characters; run "more")` : '\n(end of page text)'}`;
  },
  async click([n]) { needTask(); const h = await element(n); const desc = lastObs.snap.elements.find(e => e.n === Number(n)); await settle(() => clickHandle(h)); return `Clicked [${n}] ${desc ? `${desc.role} ${q(desc.name)}` : ''}`; },
  async type([n, ...rest]) {
    needTask(); const text = rest.join(' '); const h = await element(n);
    const kind = await h.evaluate(el => ({ tag: el.tagName.toLowerCase(), type: (el.getAttribute('type') || '').toLowerCase(), editable: el.isContentEditable }));
    if (!['input', 'textarea'].includes(kind.tag) && !kind.editable) throw new UserError(`[${n}] is not a text field.`);
    if (['checkbox', 'radio', 'submit', 'button', 'file'].includes(kind.type)) throw new UserError(`[${n}] is not a text field.`);
    if (['date', 'month', 'time', 'datetime-local'].includes(kind.type)) {
      const v = kind.type === 'date' ? ISO_DATE(text) : text.trim(); if (!v) throw new UserError('Dates: type YYYY-MM-DD or MM/DD/YYYY.');
      await h.evaluate((el, v) => { el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
      return `Set [${n}] to ${q(v)}`;
    }
    await h.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {});
    await h.evaluate(el => { el.focus(); if (el.isContentEditable) el.textContent = ''; else { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } });
    await h.type(text, { delay: 0 });
    const got = await h.evaluate(el => el.isContentEditable ? el.textContent : el.value);
    const masked = kind.type === 'password';
    return `Typed into [${n}]${masked ? '' : `; field now ${q(got)}`}${!masked && got !== text ? ' (the field changed or limited what was typed)' : ''}`;
  },
  async select([n, ...rest]) {
    needTask(); const want = rest.join(' ').trim(); const h = await element(n);
    const r = await h.evaluate((el, want) => {
      if (el.tagName !== 'SELECT') return { error: 'not a dropdown' };
      const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); const w = norm(want); const opts = [...el.options];
      let o = opts.find(x => norm(x.text) === w) || null; if (!o) { const m = opts.filter(x => norm(x.text).startsWith(w)); if (m.length === 1) o = m[0]; }
      if (!o) { const m = opts.filter(x => norm(x.text).includes(w)); if (m.length === 1) o = m[0]; }
      if (!o) return { error: 'no single option matches', options: opts.map(x => x.text.trim()) };
      if (o.disabled) return { error: 'that option is disabled' };
      el.value = o.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return { chose: o.text.trim() };
    }, want);
    if (r.error) throw new UserError(`select [${n}]: ${r.error}${r.options ? `. Options: ${r.options.map(o => q(o)).join(' | ')}` : ''}`);
    await settle(async () => {}); return `Selected ${q(r.chose)} in [${n}]`;
  },
  async check([n]) { return toggle(n, true); },
  async uncheck([n]) { return toggle(n, false); },
  async press([key]) {
    needTask(); if (!key) throw new UserError('Usage: press <key> (e.g. Enter, Tab, Escape, ArrowDown)');
    const k = { enter: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape', space: 'Space', backspace: 'Backspace' }[key.toLowerCase()] || key;
    try { await settle(() => page().keyboard.press(k)); } catch (e) { if (/Unknown key/.test(e.message)) throw new UserError(`Unknown key ${key}`); throw e; }
    return `Pressed ${k}`;
  },
  async goto([raw]) {
    needTask(); if (!raw) throw new UserError('Usage: goto <url or /path>');
    let u; try { u = new URL(raw, page().url().startsWith('http') ? page().url() : server.baseUrl); } catch { throw new UserError('Not a URL'); }
    if (!allowedUrl(u.href) || !/^https?:$/.test(u.protocol)) throw new UserError(`Blocked: only this site (${fleetOrigin}) and its sign-in provider can be opened.`);
    if (u.origin === fleetOrigin && /^\/enter\//.test(u.pathname)) throw new UserError('Blocked: entry links are not available to the agent.');
    await settle(() => page().goto(u.href, { waitUntil: 'domcontentloaded' }).catch(e => { if (!/ERR_ABORTED/.test(e.message)) throw e; }));
    return `Opened ${u.href}`;
  },
  async back() { needTask(); await settle(() => page().goBack({ waitUntil: 'domcontentloaded' })); return 'Went back'; },
  async forward() { needTask(); await settle(() => page().goForward({ waitUntil: 'domcontentloaded' })); return 'Went forward'; },
  async reload() { needTask(); await settle(() => page().reload({ waitUntil: 'domcontentloaded' })); return 'Reloaded'; },
  async newtab([raw]) {
    needTask(); const p = await ctx.newPage(); if (!pages.includes(p)) { await setupPage(p); pages.push(p); } cur = pages.indexOf(p); await p.bringToFront().catch(() => {});
    const opened = raw ? `\n${await COMMANDS.goto([raw])}` : '';
    return `Opened a new tab (tab ${cur + 1}); it is now the current tab. Use switch <n> to go back to another tab.${opened}`;
  },
  async tabs() { needTask(); const rows = []; for (const [i, p] of pages.entries()) { let t = ''; try { t = await p.title(); } catch {} rows.push(`${i + 1}${i === cur ? '*' : ' '} ${p.url()}  ${q(t)}`); } return rows.join('\n'); },
  async switch([n]) { needTask(); const i = Number(n) - 1; if (!pages[i]) throw new UserError(`No tab ${n}. Run tabs.`); cur = i; await page().bringToFront().catch(() => {}); return `Switched to tab ${n}`; },
  async close() { needTask(); if (pages.length < 2) throw new UserError('Cannot close the last tab.'); const p = pages.splice(cur, 1)[0]; await p.close().catch(() => {}); cur = Math.max(0, cur - 1); return `Closed the tab; now on tab ${cur + 1}`; },
  async screenshot([mode]) {
    needTask(); const file = join(F.shots, `${S.active.taskId.replace(/[^\w.-]+/g, '_')}-a${S.active.attempt}-s${S.active.steps}.png`);
    await page().screenshot({ path: file, fullPage: mode !== 'viewport' }); return `Saved screenshot: ${file}`;
  },
  async status() {
    if (!S.active) return `Run ${runId}: no task started. Fleet: ${server.baseUrl}`;
    const a = S.active; return `Run ${runId}\nTask: ${a.taskId} (attempt ${a.attempt})\nState: ${a.finished ? `finished, ${a.finished.success ? 'PASS' : 'FAIL'}` : 'in progress'}\nSteps: ${a.steps}\nElapsed: ${Math.round((Date.now() - a.startedAt) / 1000)} s${a.finished ? '' : `\nCurrent URL: ${page()?.url()}`}`;
  },
  async answer(rest) {
    needTask(); const text = rest.join(' ').trim();
    let last = null; try { last = (await snapshot()); } catch {}
    const r = await server.admin('/finish', { episodeId: S.active.episodeId, answer: text, metadata: { runId, harness: 'agentlab' } });
    return record(r, text, last, 'completed');
  },
  async help() { return HELP; }
};
async function toggle(n, want) {
  needTask(); const h = await element(n);
  const st = await h.evaluate(el => ({ type: (el.getAttribute('type') || el.getAttribute('role') || '').toLowerCase(), checked: el.checked ?? el.getAttribute('aria-checked') === 'true' }));
  if (!['checkbox', 'radio', 'switch'].includes(st.type)) throw new UserError(`[${n}] is not a checkbox or radio button.`);
  if (st.checked === want) return `[${n}] is already ${want ? 'checked' : 'unchecked'}`;
  if (!want && st.type === 'radio') throw new UserError('A radio button cannot be unchecked; choose another option.');
  await settle(() => clickHandle(h)); const now = await h.evaluate(el => el.checked ?? el.getAttribute('aria-checked') === 'true').catch(() => null);
  return `[${n}] is now ${now === null ? '(page changed)' : now ? 'checked' : 'unchecked'}`;
}
function record(r, answerText, lastSnap, termination) {
  const a = S.active;
  const preds = (r.results || []).map(x => ({ type: x.type, pass: x.pass, detail: x.detail, ...(x.kind ? { kind: x.kind } : {}), ...(x.event ? { event: x.event } : {}), ...(x.plan ? { plan: x.plan } : {}), ...(x.status && x.type === 'service' ? { status: [].concat(x.status).join('|') } : {}) }));
  const res = { runId, taskId: a.taskId, billerId: a.billerId, attempt: a.attempt, ...a.meta, success: !!r.success, termination, answer: answerText, steps: a.steps, ms: Date.now() - a.startedAt, predicates: preds, replay: !!r.replay,
    lastUrl: lastSnap?.url || null, lastObservation: lastSnap ? `${lastSnap.title}\n${String(lastSnap.text).replace(/\s+\n/g, '\n').slice(0, 1500)}` : null, finishedAt: new Date().toISOString() };
  appendFileSync(F.results, JSON.stringify(res) + '\n');
  a.finished = { success: res.success, at: Date.now(), termination }; saveState();
  const lines = [`RESULT: ${res.success ? 'PASS' : 'FAIL'}  run ${runId}  task ${a.taskId}  (${res.steps} steps, ${Math.round(res.ms / 1000)} s)`, 'Predicates:'];
  for (const p of preds) lines.push(`  ${p.pass ? 'PASS' : 'FAIL'} ${p.type}${typeof p.value === 'boolean' ? `=${p.value}` : ''}${p.kind ? `(${p.kind})` : ''}${p.event ? `(${p.event})` : ''}${p.status ? ` status=${p.status}` : ''}${p.plan ? ` plan=${p.plan}` : ''}${p.detail ? ` - ${p.detail}` : ''}`);
  return lines.join('\n');
}
async function abandon(reason) {
  try { const r = await server.admin('/finish', { episodeId: S.active.episodeId, answer: '', metadata: { runId, harness: 'agentlab', abandoned: reason } }); record(r, '', null, 'abandoned'); } catch (e) { log(`abandon failed: ${e.message}`); S.active.finished = { success: false, termination: 'abandoned' }; saveState(); }
}

const HELP = `Commands (act.mjs <runId> <command>):
  start <taskId>          begin a task; prints the instruction and start URL
  instruction             print the current instruction again
  observe                 URL, title, page text (first ${TEXT_CHARS} chars) and numbered interactive elements
  more                    next ${TEXT_CHARS} chars of page text from the last observe
  click <n>               click element n
  type <n> "text"         clear field n and type text (dates: YYYY-MM-DD or MM/DD/YYYY)
  select <n> "option"     choose a dropdown option by its visible text
  check <n> / uncheck <n> set a checkbox or radio button
  press <key>             press a key in the focused element (Enter, Tab, Escape, ...)
  goto <url|/path>        open a URL on this site (e.g. /mail, /sms) or the sign-in provider
  back / forward / reload
  newtab [url|/path]      open a new tab (optionally at a URL), e.g. newtab /mail to read a code without leaving a form
  tabs / switch <n> / close
  screenshot [viewport]   save a PNG (full page by default) and print its path
  status                  task, step count, elapsed time
  answer "final message"  finish the task with your final message; prints PASS/FAIL (grading happens only now)
  stop                    shut down this run's browser and server
Add --observe after any action to print the new observation as well.`;

// ---------- control server ----------
const ctlToken = randomBytes(24).toString('base64url');
let chain = Promise.resolve(), idleTimer = null;
const touchIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => shutdown('idle'), IDLE_MS); };
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000} s`)), ms))]);
const ACTIONS = new Set(['click', 'type', 'select', 'check', 'uncheck', 'press', 'goto', 'newtab', 'back', 'forward', 'reload', 'switch', 'close']);
async function run(cmd, args, opts = {}) {
  const fn = COMMANDS[cmd]; if (!fn) throw new UserError(`Unknown command "${cmd}". Run help.`);
  if (S.active && !S.active.finished && cmd !== 'start' && !ctx) await restore();
  if (ctx && !browser?.connected && S.active && !S.active.finished) await restore('The browser crashed and was restarted');
  const began = Date.now(); notes = notes.filter(Boolean); blocked = []; dialogs = [];
  if (S.active && !S.active.finished && !['status', 'help', 'instruction', 'start', 'answer'].includes(cmd)) { S.active.steps++; saveState(); }
  let out, ok = true;
  try {
    out = await withTimeout(fn(args), CMD_TIMEOUT, cmd);
    if (ACTIONS.has(cmd)) {
      const fb = (await feedback()).filter(t => String(t || '').trim()); out += `\n${await pageSummary()}`; // never an empty "Messages" header
      if (fb.length) out += `\nMessages on the page:\n${fb.map(t => `  - ${t}`).join('\n')}`;
      if (opts.observe) { const o = await COMMANDS.observe(); out += `\n\n${o}`; }
    }
  } catch (e) {
    ok = false; out = e instanceof UserError ? `ERROR: ${e.message}` : `ERROR: ${e.message.split('\n')[0]}`;
    if (!(e instanceof UserError)) { log(`${cmd} failed: ${e.stack}`); try { await page()?.evaluate(() => window.stop()); } catch {} }
  }
  if (dialogs.length) out += `\nDialogs (accepted): ${dialogs.join(' | ')}`;
  if (blocked.length) out += `\nBlocked requests to other sites: ${[...new Set(blocked)].slice(0, 5).join(', ')}`;
  if (notes.length) { out = `NOTE: ${notes.join('\nNOTE: ')}\n${out}`; notes = []; }
  try { appendFileSync(F.traj, JSON.stringify({ ts: new Date().toISOString(), taskId: S.active?.taskId || null, attempt: S.active?.attempt || null, step: S.active?.steps ?? null, cmd, args, ok, ms: Date.now() - began, url: page()?.url?.() || null, output: out.slice(0, 12000) }) + '\n'); } catch {}
  return out;
}
// After a daemon or browser restart: reopen the episode via its entry link (the episode itself is restored from data/).
async function restore(note = 'The harness was restarted') {
  const a = S.active;
  try { server.world.episode(a.episodeId); } catch { a.finished = { success: false, termination: 'environment_error' }; saveState(); throw new UserError('The episode could not be restored after a restart. Run start <taskId> again.'); }
  const p = await newContext(); await p.goto(server.baseUrl + a.entryPath, { waitUntil: 'domcontentloaded' });
  notes.push(`${note}; you are back on the start page (${p.url()}). Changes already made on the site are kept, but you may need to sign in again.`);
}
const ctl = http.createServer((req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const tok = Buffer.from(String(req.headers['x-agentlab-token'] || '')); const want = Buffer.from(ctlToken);
  if (tok.length !== want.length || !timingSafeEqual(tok, want)) return send(401, { error: 'unauthorized' });
  let body = ''; req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => {
    let msg; try { msg = JSON.parse(body || '{}'); } catch { return send(400, { error: 'bad json' }); }
    if (msg.cmd === 'ping') return send(200, { ok: true, runId, pid: process.pid });
    touchIdle();
    if (msg.cmd === 'stop') { send(200, { output: `Run ${runId} stopped.` }); return setTimeout(() => shutdown('stop'), 50); }
    chain = chain.then(() => run(String(msg.cmd || ''), Array.isArray(msg.args) ? msg.args.map(String) : [], { observe: !!msg.observe })).then(out => send(200, { output: out }), e => send(500, { output: `ERROR: ${e.message}` }));
  });
});
await new Promise(r => ctl.listen(0, '127.0.0.1', r));
write0600(F.daemon, JSON.stringify({ pid: process.pid, port: ctl.address().port, token: ctlToken, fleetPort: Number(new URL(server.baseUrl).port), googlePort: googleOrigin ? Number(new URL(googleOrigin).port) : 0, startedAt: new Date().toISOString() }));
touchIdle();
getBrowser().catch(e => log(`browser prelaunch failed: ${e.message}`));
log(`daemon ready pid ${process.pid} control port ${ctl.address().port}`);

let shuttingDown = false;
async function shutdown(why) {
  if (shuttingDown) return; shuttingDown = true; log(`shutdown: ${why}`);
  try { const d = readJson(F.daemon); if (d?.pid === process.pid) rmSync(F.daemon, { force: true }); } catch {}
  try { ctl.close(); } catch {}
  try { await withTimeout(browser?.close() || Promise.resolve(), 5000, 'browser close'); } catch { try { browser?.process()?.kill('SIGKILL'); } catch {} }
  try { await withTimeout(server.close(), 3000, 'server close'); } catch {}
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', e => log(`unhandledRejection: ${e?.stack || e}`));
