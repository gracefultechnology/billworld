#!/usr/bin/env node
// Offline build: research-data captures -> per-biller real-site profiles for the fleet.
//
//   node billworld/fleet/profiles/build-profiles.mjs [--workers 4] [--limit N] [--cache DIR] [--no-cache]
//
// Inputs (read-only): billworld/research-data/catalog.sqlite (billers, routes, urls.evidence) and bodies/<sha256>.
// Join: research ids are sha256(json.dumps([category, name, bill_type, sorted(service_area)]))[:20] (audit_billworld.identity),
// recomputed from each fleet record and verified against billers.name; a (source_file, name, ordinal) join is the fallback.
// A route is used only when its original_url still equals the record's current field (stale captures are dropped).
// Outputs (this directory):
//   profiles.jsonl.gz  one JSON profile per line, {id, ...profile}, sorted by id (loaded lazily by catalog.mjs)
//   index.json         compact eager sidecar: family signal + observed capabilities per biller (template resolution)
//   stats.json         coverage numbers and the join report
// Page facts are cached by body sha256 under --cache (default ./.cache, gitignored), so rebuilds are fast.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, createReadStream, appendFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { extractPage, navLabels, footerLabels, heroHeading, loginFacts, excerptFor, pageHeadings, HELP_TOPICS, hostOf, cleanCaptureText } from './extract.mjs';

export const EXTRACT_VERSION = 8;
const here = new URL('./', import.meta.url);
const researchDir = new URL('../../research-data/', import.meta.url);

// ---------- vendor domains ----------
// Payment / portal vendors. family: the fleet template the vendor's portal implies (null = processor only).
export const VENDORS = [
  ['smarthub.coop', 'smarthub'], ['invoicecloud.com', 'invoicecloud'], ['invoicecloud.net', 'invoicecloud'],
  ['paymentus.com', 'paymentus'], ['xpressbillpay.com', 'xpress'],
  ['municipalonlinepayments.com', 'municipal-portal'], ['munisselfservice.com', 'municipal-portal'], ['bsaonline.com', 'municipal-portal'], ['edmundsassoc.com', 'municipal-portal'], ['edmundsgovtech.cloud', 'municipal-portal'], ['epayub.com', 'municipal-portal'], ['citizenserve.com', 'municipal-portal'], ['eonlinebill.com', 'municipal-portal'],
  ['personapay.com', 'patient-pay'], ['patientportal.me', 'patient-pay'], ['patientpay.com', 'patient-pay'], ['healow.com', 'patient-pay'], ['cedar.com', 'patient-pay'], ['patientco.com', 'patient-pay'], ['instamed.com', 'patient-pay'],
  ['speedpay.com', 'kubra'], ['kubra.io', 'kubra'], ['kubra.com', 'kubra'],
  ['doxo.com', 'doxo'],
  ['mysynchrony.com', 'card-servicer'], ['comenity.net', 'card-servicer'],
  ['rentcafe.com', 'rent-portal'], ['appfolio.com', 'rent-portal'], ['buildium.com', 'rent-portal'], ['managebuilding.com', 'rent-portal'], ['pha-web.com', 'rent-portal'], ['paylease.com', 'rent-portal'], ['rentmanager.com', 'rent-portal'],
  ['ritaohio.com', 'income-tax'],
  ['republicservices.com', 'waste-hauler'], ['wm.com', 'waste-hauler'], ['wasteconnections.com', 'waste-hauler'],
  // processors / gateways without a dedicated fleet family
  ['govpaynet.com', null], ['govpay.net', null], ['paygov.us', null], ['pay.gov', null], ['officialpayments.com', null], ['pointandpay.com', null], ['pointandpay.net', null], ['payitgov.com', null], ['papergov.com', null], ['nicusa.com', null], ['certipay.com', null], ['paystar.io', null], ['municipay.com', null], ['govolution.com', null], ['velocitypayment.com', null],
  ['forte.net', null], ['authorize.net', null], ['stripe.com', null], ['paypal.com', null], ['braintreegateway.com', null], ['squareup.com', null], ['convergepay.com', null], ['heartlandpaymentsystems.com', null], ['payway.com', null], ['billmatrix.com', null], ['checkfreepay.com', null], ['billflash.com', null], ['e-billexpress.com', null], ['payerexpress.com', null], ['icheckgateway.com', null], ['cashnet.com', null], ['touchnet.net', null], ['touchnet.com', null], ['flywire.com', null], ['repay.com', null], ['billtrust.com', null], ['cardconnect.com', null], ['bluepay.com', null], ['acceptiva.com', null], ['gotobilling.com', null], ['securepayments.cardpointe.com', null], ['payliance.com', null], ['clover.com', null], ['nelnet.com', null], ['nelnet.net', null], ['athenahealth.com', null], ['paymentcenter.us', null], ['epaypolicy.com', null], ['ebpp.com', null], ['payclix.com', null], ['vericheck.com', null], ['tylerhost.net', null], ['tylerportico.com', null], ['paysimple.com', null], ['payments.ebay.com', null], ['billeriq.com', null], ['billerpayments.com', null], ['ipayx.com', null], ['govpayment.com', null]
];
export function vendorOf(host) {
  if (!host) return null;
  if (/(?:^|\.|-)mychart(?:\.|-)|^mychart/.test(host)) return { domain: host, family: 'mychart' };
  for (const [d, family] of VENDORS) if (host === d || host.endsWith(`.${d}`)) return { domain: d, family };
  return null;
}
const PAYISH = /\bpay|bill|log ?in|sign ?in|account|portal|auto ?pay|e-?bill|invoice|statement|checkout|epay|payment/i;
// Multi-service (municipal) websites link to many portals: a link counts for this bill only when its label or path names
// this bill's service, or (generic label) when it sits on the bill's own pay page.
const MUNICIPAL = /\b(?:city|county|town|village|borough|township|municipal|parish|district|authority|government|commission|board)\b/i;
export const RELEVANT = {
  utility: /util|water|sewer|electric|\bgas\b|trash|refuse|garbage|solid waste|sanitation|\bpower\b|\blight|energy|storm ?water/i,
  tax: /\btax|assess|parcel|propert/i, government: /vehicle|registration|\bdmv\b|\btags?\b|licens/i,
  medical: /ambulance|\bems\b|medical|patient|hospital|health/i, telecom: /internet|fiber|phone|broadband|cable|telecom/i,
  toll: /\btoll/i, rent: /\brent\b|housing|resident|tenant/i, invoice: /court|fine|citation|permit|invoice|miscellaneous/i
};
const NOT_BILLING = /stormcenter|storm-?center|outage|careers?|jobs|news|press/i;
// Registrable-domain approximation for "is this the biller's own site".
const site = host => { if (!host) return ''; const p = host.split('.'); const n = /\.(?:co|com|org|net|gov|ac|edu|k12|state|ci|co|us)\.[a-z]{2}$/.test(host) || /\.(?:[a-z]{2})\.us$/.test(host) ? 3 : 2; return p.slice(-n).join('.'); };

let kindFor_ = null; const kindFor = (...a) => kindFor_(...a);
// ---------- research identity ----------
const pyDump = v => v === null || v === undefined ? 'null' : Array.isArray(v) ? `[${v.map(pyDump).join(', ')}]` : JSON.stringify(v);
export const researchId = (category, entry) => 'biller_' + createHash('sha256').update(pyDump([category, entry.name ?? null, entry.bill_type ?? null, [...(entry.service_area || [])].sort()])).digest('hex').slice(0, 20);
const ROUTE_FIELD = { website: e => e.website, login_url: e => e.login_url, help_center_url: e => e.help_center_url };
const routeValue = (entry, kind) => kind.startsWith('links.') ? entry.links?.[kind.slice(6)] : ROUTE_FIELD[kind]?.(entry);
const HELP_KIND = { 'links.pay_bill': 'pay_bill', 'links.view_bill': 'view_bill', 'links.statements_history': 'statements_history', 'links.autopay_setup': 'autopay_setup', 'links.autopay_cancel': 'autopay_cancel', 'links.paperless': 'paperless', 'links.payment_assistance': 'payment_assistance', help_center_url: 'help_center' };
const NEGATED_TOPIC = /\b(?:not|no longer|does not|doesn'?t|do not|don'?t|cannot|can'?t|unable|unavailable|isn'?t|aren'?t)\b[^.]{0,50}\b(?:auto ?-?pay|automatic|recurring|paperless|e-?bill|online)/i;

// ---------- page summaries (worker side) ----------
function summarize(html, url, scriptUrls) {
  const f = extractPage(html, url);
  const pageHost = hostOf(url);
  const ext = [];
  for (const a of f.anchors) {
    if (!a.href || a.z === 'footer' && !vendorOf(hostOf(a.href))) continue;
    const h = hostOf(a.href); if (!h || h === pageHost) continue;
    if (ext.length < 150) ext.push([h, a.text.slice(0, 60), (() => { try { const u = new URL(a.href); return (u.pathname + u.search).slice(0, 80); } catch { return ''; } })(), a.z]);
  }
  const excerpts = {};
  for (const topic of Object.keys(HELP_TOPICS)) { const x = excerptFor(f, topic); if (x) excerpts[topic] = x; }
  return {
    v: EXTRACT_VERSION, title: f.title, description: f.description || null, themeColor: f.themeColor, siteName: f.ogSiteName,
    nav: navLabels(f), footer: footerLabels(f), hero: heroHeading(f), headings: pageHeadings(f),
    login: loginFacts(f, scriptUrls), excerpts,
    forms: f.forms.map(x => x.action).filter(Boolean).slice(0, 10), iframes: f.iframes.slice(0, 10), ext
  };
}
if (!isMainThread) {
  for (const job of workerData.jobs) {
    let out;
    try {
      const buf = readFileSync(new URL(job.file, researchDir));
      out = summarize(buf.toString(job.latin1 ? 'latin1' : 'utf8'), job.url, job.scripts);
    } catch (err) { out = { v: EXTRACT_VERSION, error: String(err.message || err).slice(0, 120) }; }
    parentPort.postMessage({ sha: job.sha, out });
  }
  parentPort.postMessage({ done: true });
}

// Readers (catalog.mjs in running servers and tests) never see a half-written file.
const writeAtomic = (url, data) => { const tmp = new URL(`${url.pathname.split('/').pop()}.tmp`, url); writeFileSync(tmp, data); renameSync(tmp, url); };
// ---------- main ----------
async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const workers = Math.max(1, Number(opt('workers', 4)));
  const limit = Number(opt('limit', 0)) || 0;
  const cacheDir = new URL(`${opt('cache', '.cache').replace(/\/?$/, '/')}`, here);
  const useCache = !args.includes('--no-cache');
  const t0 = Date.now();
  const log = (...m) => console.error(`[profiles ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...m);

  process.env.FLEET_PROFILES = '0'; // build from the research-only resolution
  const { loadCatalog, resolveTemplate, kindFor, observedResolution } = await import('../catalog.mjs');
  kindFor_ = kindFor;
  const catalog = loadCatalog();
  const billers = [...catalog.billers.values()].slice(0, limit || undefined);
  const db = new DatabaseSync(fileURLToPath(new URL('catalog.sqlite', researchDir)), { readOnly: true });

  // 1. join
  const research = db.prepare('SELECT id, name, category, source_file FROM billers').all();
  const rById = new Map(research.map(r => [r.id, r]));
  const byOrdinal = new Map(); const ordCount = new Map();
  for (const r of research) { const k = `${r.source_file}|${r.name}`; const n = ordCount.get(k) || 0; ordCount.set(k, n + 1); byOrdinal.set(`${k}|${n}`, r.id); }
  const join = new Map(); const used = new Map(); let viaHash = 0, viaOrdinal = 0, unmatched = 0; const seenOrd = new Map();
  for (const b of billers) {
    const stem = b.source.file.replace(/^categories\//, '').replace(/\.json$/, '');
    const rid = researchId(stem, b.entry);
    const k = `${b.source.file}|${b.entry.name}`; const n = seenOrd.get(k) || 0; seenOrd.set(k, n + 1);
    let id = null;
    if (rById.get(rid)?.name === b.entry.name) { id = rid; viaHash++; }
    else if (byOrdinal.has(`${k}|${n}`)) { id = byOrdinal.get(`${k}|${n}`); viaOrdinal++; }
    else unmatched++;
    if (id) { if (used.has(id)) { unmatched++; continue; } used.set(id, b.id); join.set(b.id, id); }
  }
  log(`join: ${join.size}/${billers.length} matched (hash ${viaHash}, ordinal ${viaOrdinal}, unmatched ${unmatched})`);

  // 2. routes with captures
  const rows = db.prepare(`SELECT r.biller_id, r.kind, r.original_url, u.status, u.evidence FROM routes r JOIN urls u ON u.id = r.url_id`).all();
  const routesBy = new Map(); let stale = 0;
  const entryOf = new Map(billers.map(b => [join.get(b.id), b]));
  for (const r of rows) {
    const b = entryOf.get(r.biller_id); if (!b) continue;
    if (routeValue(b.entry, r.kind) !== r.original_url) { stale++; continue; }
    if (r.status !== 'http_captured') continue;
    const ev = JSON.parse(r.evidence || '{}');
    if (!ev.body_file || !/html/i.test(ev.content_type || 'text/html')) continue;
    if (!routesBy.has(b.id)) routesBy.set(b.id, []);
    routesBy.get(b.id).push({ kind: r.kind, sha: ev.body_sha256, file: ev.body_file, url: ev.final_url || ev.requested_url, requested: ev.requested_url, at: ev.attempted_at, scripts: ev.script_urls || [], latin1: /8859-1|latin-?1|windows-1252/i.test(ev.content_type || '') });
  }
  db.close();
  log(`routes: ${rows.length} total, ${stale} stale (record URL changed since capture), ${routesBy.size} billers with captured HTML`);

  // 3. page summaries (cached by body sha)
  const pages = new Map();
  const cacheFile = new URL(`pages-v${EXTRACT_VERSION}.jsonl`, cacheDir);
  if (useCache && existsSync(cacheFile)) {
    const rl = createInterface({ input: createReadStream(cacheFile), crlfDelay: Infinity });
    for await (const line of rl) { if (!line) continue; try { const { sha, out } = JSON.parse(line); pages.set(sha, out); } catch {} }
    log(`cache: ${pages.size} page summaries`);
  }
  if (useCache && existsSync(cacheDir)) for (const f of readdirSync(cacheDir)) if (/^pages-v\d+\.jsonl$/.test(f) && f !== `pages-v${EXTRACT_VERSION}.jsonl`) unlinkSync(new URL(f, cacheDir)); // stale extractor versions
  const jobs = new Map();
  for (const list of routesBy.values()) for (const r of list) if (!pages.has(r.sha) && !jobs.has(r.sha)) jobs.set(r.sha, { sha: r.sha, file: r.file, url: r.url, scripts: r.scripts, latin1: r.latin1 });
  if (jobs.size) {
    if (useCache) mkdirSync(cacheDir, { recursive: true });
    const all = [...jobs.values()]; let done = 0; let buffer = [];
    const flush = () => { if (useCache && buffer.length) appendFileSync(cacheFile, buffer.join('')); buffer = []; };
    log(`extracting ${all.length} pages with ${workers} workers`);
    await Promise.all(Array.from({ length: workers }, (_, w) => new Promise((resolve, reject) => {
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: all.filter((_, i) => i % workers === w) } });
      worker.on('message', m => {
        if (m.done) return resolve();
        pages.set(m.sha, m.out); buffer.push(JSON.stringify(m) + '\n'); done++;
        if (buffer.length >= 500) flush();
        if (done % 5000 === 0) log(`  ${done}/${all.length}`);
      });
      worker.on('error', reject);
      worker.on('exit', code => code ? reject(new Error(`worker exit ${code}`)) : resolve());
    })));
    flush();
    log(`extracted ${done} pages`);
  }

  // 4. assemble
  const profiles = []; const index = {};
  const stats = { billers: billers.length, joined: join.size, joinViaHash: viaHash, joinViaOrdinal: viaOrdinal, unmatched, staleRoutes: stale, withCapture: 0, website: 0, websiteNav: 0, login: 0, loginForm: 0, social: {}, socialAny: 0, help: 0, helpByKind: {}, observedDomains: 0, familySignals: {}, observed: {}, reclass: { templateChanged: 0, category_to_family: {}, family_change: {}, kept: {}, ambiguous: 0 } };
  for (const b of billers) {
    const routes = routesBy.get(b.id); if (!routes) continue;
    stats.withCapture++;
    const page = r => pages.get(r.sha);
    const get = kind => routes.find(r => r.kind === kind && page(r) && !page(r).error);
    const p = { source: 'research-data', capturedAt: routes.map(r => r.at).filter(Boolean).sort().at(-1) || null, website: null, login: null, help: [], observedDomains: [], familySignals: [], evidence: 'observed_public' };
    const web = get('website');
    if (web) {
      const s = page(web);
      p.website = { finalUrl: web.url, title: cleanCaptureText(s.title), description: s.description, themeColor: s.themeColor, siteName: s.siteName || null, navLabels: s.nav, footerLabels: s.footer, heroHeading: cleanCaptureText(s.hero) };
      stats.website++; if (s.nav.length >= 3) stats.websiteNav++;
    }
    // login: the documented login page with a form, else any captured page with a password form, else the login page as captured.
    const lr = get('login_url');
    const withPassword = routes.filter(r => page(r) && !page(r).error && page(r).login.fields.includes('password'));
    const pickLogin = lr && page(lr).login.formObserved ? lr : withPassword.find(r => r.kind !== 'website') || withPassword[0] || lr;
    if (pickLogin) {
      const s = page(pickLogin), L = s.login;
      // A sign-in form on the home page can belong to a different product (a retailer's shop account rather than its
      // store card), so social sign-in counts only on the documented login page or a pay/bill page.
      const socialProviders = pickLogin.kind === 'website' ? [] : L.socialProviders;
      p.login = { finalUrl: pickLogin.url, title: cleanCaptureText(s.title), sourceKind: pickLogin.kind, formObserved: L.formObserved, fields: L.fields, buttons: L.buttons, socialProviders, hasRegisterLink: L.hasRegisterLink, hasForgotLink: L.hasForgotLink, hasGuestPay: L.hasGuestPay };
      stats.login++; if (L.formObserved) stats.loginForm++;
      for (const sp of socialProviders) stats.social[sp] = (stats.social[sp] || 0) + 1;
      if (socialProviders.length) stats.socialAny++;
    }
    // help excerpts: one per documented help/link kind whose captured page has on-topic text (not the bare home page).
    const seenEx = new Set();
    for (const r of routes) {
      const kind = HELP_KIND[r.kind]; if (!kind) continue;
      const s = page(r); if (!s || s.error) continue;
      if (web && r.sha === web.sha && kind !== 'help_center') continue;
      const excerpt = s.excerpts[kind]; if (!excerpt || seenEx.has(excerpt)) continue;
      seenEx.add(excerpt);
      p.help.push({ kind, title: cleanCaptureText(s.title), headings: s.headings, excerpt, url: r.url });
      stats.helpByKind[kind] = (stats.helpByKind[kind] || 0) + 1;
    }
    if (p.help.length) stats.help++;
    // observed vendor domains and the families they imply. strength 3: a route lands on / a form posts to the vendor;
    // 2: a billing-labeled link to the vendor (or a portal-only vendor host); 1: any other link or script.
    const dom = new Map();
    const note = (host, strength, how) => { const v = vendorOf(host); if (!v) return; const cur = dom.get(v.domain) || { family: v.family, strength: 0, how: new Set() }; cur.strength = Math.max(cur.strength, strength); cur.how.add(how); dom.set(v.domain, cur); };
    const own = site(hostOf(b.entry.website));
    // Bank and credit-union sites link out to partner payment services (loans, cards); their home/help links are weak evidence.
    const bankish = ['bank', 'credit-union'].includes(b.entry.bill_type);
    const municipal = MUNICIPAL.test(`${b.entry.entity_type || ''} ${b.entry.name}`);
    const kind = kindFor(b.entry.bill_type, b.entry);
    const PAY_PAGE = new Set(['login_url', 'links.pay_bill', 'links.view_bill', 'links.autopay_setup']);
    for (const r of routes) {
      const onPayPage = PAY_PAGE.has(r.kind) && !(web && r.sha === web.sha);
      const s = page(r);
      const finalHost = hostOf(r.url);
      note(finalHost, 3, hostOf(r.requested) === finalHost ? `route:${r.kind}` : `redirect:${r.kind}`);
      if (!s || s.error) continue;
      for (const a of s.forms) note(hostOf(a), 3, `form:${r.kind}`);
      for (const a of s.iframes) if (!NOT_BILLING.test(a)) note(hostOf(a), 3, `iframe:${r.kind}`);
      for (const u of r.scripts) if (!NOT_BILLING.test(u)) note(hostOf(u), 1, `script:${r.kind}`);
      for (const [h, text, path] of s.ext) {
        if (site(h) === own) continue;
        const v = vendorOf(h); if (!v) continue;
        if (NOT_BILLING.test(`${text} ${path}`)) { note(h, 1, `link:${r.kind}`); continue; }
        const strong = PAYISH.test(text) || PAYISH.test(path) || ['mychart', 'smarthub', 'invoicecloud', 'paymentus', 'xpress'].includes(v.family);
        let strength = v.family === 'doxo' || !strong || (bankish && !onPayPage) ? 1 : 2;
        if (strength === 2 && municipal) {
          const label = `${text} ${path}`;
          const own = RELEVANT[kind]?.test(label), other = Object.entries(RELEVANT).some(([k, re]) => k !== kind && re.test(label));
          strength = own ? 2 : other ? 1 : onPayPage ? 2 : 1;
        }
        note(h, strength, `link:${r.kind}`);
      }
    }
    p.observedDomains = [...dom.keys()].sort();
    const fam = new Map();
    for (const [, d] of dom) if (d.family && d.strength >= 2) fam.set(d.family, Math.max(fam.get(d.family) || 0, d.strength));
    p.familySignals = [...fam.keys()].sort();
    p.familyEvidence = Object.fromEntries([...dom].filter(([, d]) => d.family && d.strength >= 2).map(([k, d]) => [k, { family: d.family, strength: d.strength, how: [...d.how].slice(0, 6) }]));
    if (p.observedDomains.length) stats.observedDomains++;
    for (const f of p.familySignals) stats.familySignals[f] = (stats.familySignals[f] || 0) + 1;
    // pick one family: strongest; a tie between different families at the top strength is ambiguous (no reclassification).
    const ranked = [...fam].sort((x, y) => y[1] - x[1]);
    const chosen = ranked.length && !(ranked[1] && ranked[1][1] === ranked[0][1]) ? ranked[0] : null;
    if (ranked.length > 1 && !chosen) stats.reclass.ambiguous++;

    // capabilities proven by captured public pages
    const obs = [];
    const L = p.login;
    if (L?.fields.includes('password')) obs.push('online_account');
    if (L?.formObserved && L.hasRegisterLink) obs.push('registration');
    if (L?.formObserved && L.hasForgotLink) obs.push('password_reset');
    if (routes.some(r => ['login_url', 'links.pay_bill', 'links.view_bill'].includes(r.kind) && !(web && r.sha === web.sha) && page(r) && !page(r).error && page(r).login.hasGuestPay)) obs.push('guest_pay');
    if (L?.socialProviders.includes('google')) obs.push('google_login'); // L is p.login: website-page social sign-in already dropped
    const helpOk = kind => p.help.some(h => h.kind === kind && !NEGATED_TOPIC.test(h.excerpt));
    if (helpOk('pay_bill') || [...dom.values()].some(d => d.strength === 3 && [...d.how].some(h => /pay_bill|login_url/.test(h)))) obs.push('pay_online');
    if (helpOk('view_bill')) obs.push('view_bill');
    if (helpOk('statements_history')) obs.push('statements');
    if (helpOk('autopay_setup')) obs.push('autopay');
    if (p.help.some(h => h.kind === 'autopay_cancel' && /cancel|stop|turn off|discontinue|terminate|end/i.test(h.excerpt) && !NEGATED_TOPIC.test(h.excerpt))) obs.push('autopay_cancel');
    if (helpOk('paperless')) obs.push('paperless');
    if (helpOk('payment_assistance')) obs.push('payment_assistance');
    for (const k of obs) stats.observed[k] = (stats.observed[k] || 0) + 1;

    const empty = !p.website && !p.login && !p.help.length && !p.observedDomains.length;
    if (empty) continue;
    profiles.push({ id: b.id, ...p });
    const entry = {};
    if (chosen) entry.f = [chosen[0], chosen[1]];
    if (obs.length) entry.o = obs;
    if (L?.socialProviders.length) entry.s = L.socialProviders;
    entry.p = 1; // has a lazily loaded profile
    index[b.id] = entry;
    // measure what catalog.mjs will do with the family signal
    if (chosen) {
      const base = resolveTemplate(b.entry);
      const after = observedResolution(b.entry, base, entry);
      const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
      if (base.template === 'offline') bump(stats.reclass, 'offline_with_signal');
      else if (base.family === chosen[0]) bump(stats.reclass, 'confirmed');
      else if (after === base) bump(stats.reclass.kept, `${base.family || base.template}<-${chosen[0]}@${chosen[1]}`);
      else if (after.template === base.template) bump(stats.reclass, 'family_named_same_template');
      else if (!base.family) { bump(stats.reclass.category_to_family, `${base.template}->${after.template}`); stats.reclass.templateChanged++; }
      else { bump(stats.reclass.family_change, `${base.family}->${after.template}`); stats.reclass.templateChanged++; }
    }
  }
  profiles.sort((x, y) => x.id < y.id ? -1 : 1);
  const body = profiles.map(x => JSON.stringify(x)).join('\n') + '\n';
  const gz = gzipSync(body, { level: 9 });
  // A --limit run is a trial: outputs go to the cache directory, never over the shipped files.
  const outDir = limit ? cacheDir : here;
  mkdirSync(outDir, { recursive: true });
  {
    writeFileSync(new URL('profiles.jsonl.gz.tmp', outDir), gz); renameSync(new URL('profiles.jsonl.gz.tmp', outDir), new URL('profiles.jsonl.gz', outDir));
    const capturedAt = profiles.map(x => x.capturedAt).filter(Boolean).sort().at(-1) || null;
    writeAtomic(new URL('index.json', outDir), JSON.stringify({ version: 1, extractVersion: EXTRACT_VERSION, source: 'research-data', capturedAt, count: Object.keys(index).length, billers: index }) + '\n');
  }
  stats.profiles = profiles.length; stats.rawBytes = Buffer.byteLength(body); stats.gzBytes = gz.length; stats.seconds = Math.round((Date.now() - t0) / 1000);
  writeAtomic(new URL('stats.json', outDir), JSON.stringify(stats, null, 2) + '\n');
  console.log(JSON.stringify(stats, null, 2));
}
if (isMainThread && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
