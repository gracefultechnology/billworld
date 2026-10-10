// Fleet server: serves every catalog biller at /b/<billerId>/..., a shared mock mailbox at /mail,
// a biller directory at /, and a private admin/grader API on a separate port.
import http from 'node:http';
import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { readdirSync, writeFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FleetWorld, Fault, isoDate, fmtDate, money, PASSWORD, FLEET_REVISION, methodTypesFor, autopayPoliciesFor, autopayTimingText, paymentLimits } from './engine.mjs';
import { helpArticles, searchHelp } from './help.mjs';
import { search as searchCatalog } from './catalog.mjs';
import { textPdf } from './pdf.mjs';
import { esc, field as kitField, capabilityNotes as kitCapabilityNotes, L as kitL, dossierNavInner as kitDossierNavInner, dossierNavBar as kitDossierNavBar } from './kit.mjs';
import { loadDossiers } from './billers/load.mjs';
import { renderMail, renderDirectory, renderNotice, mailCss } from './shell.mjs';
import { generateTasks } from './tasks.mjs';
import { createConnector, connectorToken, searchMessages } from './mail-connector.mjs';
import { renderSms, smsCss, normalizeScenario, installSmsMfa, smsMfaFor, maskPhone } from './sms.mjs';
import { MockGoogle, createGoogleRp, googleSupport } from './google.mjs';
import { socialButtons } from './kit.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));

export const DEFAULT_ROUTES = {
  home: '/', login: '/login', loginPassword: '/login/password', mfa: '/login/verify', register: '/register', verify: '/register/verify', forgot: '/forgot-password', reset: '/reset-password',
  guest: '/quick-pay', guestPay: '/quick-pay/payment', guestReview: '/quick-pay/review', guestReceipt: '/quick-pay/receipt/:id',
  dashboard: '/account', bill: '/account/bill', statements: '/account/statements', statement: '/account/statements/:id.pdf',
  pay: '/account/pay', payMethod: '/account/pay/method', payReview: '/account/pay/review', payReceipt: '/account/pay/receipt/:id',
  history: '/account/activity', autopay: '/account/autopay', paperless: '/account/paperless', wallet: '/account/wallet', cancel: '/account/cancel', plan: '/account/plan',
  arrangement: '/account/payment-plan', contact: '/account/messages', profile: '/account/profile', logout: '/logout',
  help: '/help', helpArticle: '/help/:slug', helpSearch: '/help/search'
};
export const PUBLIC_PAGES = new Set(['home', 'login', 'loginPassword', 'mfa', 'register', 'verify', 'forgot', 'reset', 'guest', 'guestPay', 'guestReview', 'guestReceipt', 'help', 'helpArticle', 'helpSearch', 'logout']);
export const DEFAULT_FLOW = { paySteps: ['pay', 'payReview'], loginSteps: 1, afterLogin: 'dashboard', guestSteps: ['guest', 'guestPay', 'guestReview'] };

// ---------- templates ----------
export const templates = new Map();
export async function loadTemplates() {
  for (const file of readdirSync(`${here}/templates`).filter(f => f.endsWith('.mjs') && !f.startsWith('_')).sort()) {
    const mod = await import(pathToFileURL(`${here}/templates/${file}`).href);
    const t = { ...mod, id: mod.meta.id, routes: { ...DEFAULT_ROUTES, ...(mod.routes || {}) }, flow: { ...DEFAULT_FLOW, ...(mod.flow || {}) } };
    t.matchers = Object.entries(t.routes).map(([page, pattern]) => { const keys = []; const re = new RegExp('^' + pattern.replace(/[.]/g, '\\.').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+?)'; }) + '/?$'); return { page, re, keys }; }).sort((a, b) => a.keys.length - b.keys.length); // literal routes (help/search) win over :param routes (help/:slug)
    templates.set(t.id, t);
  }
  return templates;
}
const familyTemplate = biller => templates.get(biller.template) || templates.get('generic');
// A dedicated biller whose dossier changes the sign-in step count or guest lookup fields gets a per-biller view of its
// family template (same routes and renderers, its own flow). Family billers get the shared template object.
const derived = new Map();
export const templateFor = biller => {
  const t = familyTemplate(biller); const a = biller.dossier?.auth;
  if (!a || (a.loginSteps == null && !a.guestLookupFields)) return t;
  const key = `${biller.id}|${t.id}`;
  if (!derived.has(key)) derived.set(key, { ...t, flow: { ...t.flow, ...(a.loginSteps != null ? { loginSteps: a.loginSteps } : {}), ...(a.guestLookupFields ? { guestFields: [...new Set([...(t.flow.guestFields || []), ...a.guestLookupFields])] } : {}) } });
  return derived.get(key);
};
// ---------- dedicated tier: view-model pieces from the dossier ----------
const CAP_TITLE = { cancel_service: 'Stopping or cancelling service', autopay: 'Automatic payments', autopay_cancel: 'Turning off automatic payments', paperless: 'Paperless billing', guest_pay: 'Paying without signing in', scheduled_payment: 'Future-dated payments', payment_arrangement: 'Payment arrangements', registration: 'Online registration', pay_online: 'Online payments', view_bill: 'Viewing your bill', statements: 'Statements', password_reset: 'Password reset', payment_assistance: 'Payment assistance', pay_by_phone: 'Paying by phone', pay_by_mail: 'Paying by mail', google_login: 'Sign in with Google', online_account: 'Online account' };
// Which pages show which capability notes (plus home, dashboard and help, which show all of them).
const NOTE_PAGES = { cancel: ['cancel_service'], autopay: ['autopay', 'autopay_cancel'], paperless: ['paperless'], guest: ['guest_pay'], pay: ['scheduled_payment', 'pay_online'], arrangement: ['payment_arrangement'], register: ['registration'], plan: ['change_plan'] };
export function capabilityNotesFor(biller) {
  const out = [];
  // Notes on supported capabilities (rules such as "no AutoPay while past due") show only on that feature's own page.
  for (const [k, c] of Object.entries(biller.capabilities || {})) if (c.dossier && c.note) out.push({ capability: k, title: CAP_TITLE[k] || k, note: c.note, channel: c.channel || null, supported: c.support === 'supported' });
  return out;
}
const REG_FIELD = { accountNumber: ['Account number', 'numeric'], lastName: ['Last name', null], zip: ['ZIP code', 'numeric'], email: ['Email address', null], phone: ['Phone number', 'tel'] };
const GUEST_FIELD = { accountNumber: ['Account number', 'numeric'], statementId: ['Statement number', null], parcelId: ['Parcel number', null], plate: ['License plate', null], phone: ['Phone number', 'tel'], lastName: ['Last name', null], zip: ['ZIP code', 'numeric'], amountDue: ['Amount due', 'decimal'], dob: ['Date of birth (YYYY-MM-DD)', null] };
// Insert fields a dossier requires (registration / guest lookup) that the family template's form does not render,
// just before that form's first submit button. Standard field names, so engine and driver need nothing special.
function withRequiredFields(out, vm) {
  if (typeof out !== 'string' || !vm.auth) return out;
  const want = vm.page === 'register' ? [vm.auth.registrationFields, REG_FIELD] : vm.page === 'guest' ? [vm.auth.guestLookupFields, GUEST_FIELD] : null;
  if (!want || !want[0]?.length) return out;
  const at = out.indexOf(`action="${esc(vm.url(vm.page))}`); if (at < 0) return out;
  const end = out.indexOf('</form>', at); const btn = out.indexOf('<button', at);
  const pos = btn > at && btn < end ? btn : end; if (pos < 0) return out;
  const form = out.slice(at, end);
  const extra = want[0].filter(f => !form.includes(`name="${f}"`)).map(f => String(kitField(vm, { name: f, label: kitL(vm, f, want[1][f][0]), inputmode: want[1][f][1] || undefined, type: f === 'email' ? 'email' : f === 'phone' ? 'tel' : 'text' }))).join('');
  out = extra ? out.slice(0, pos) + extra + out.slice(pos) : out;
  // guestLookupExact: the real lookup asks for exactly these fields, so the family's other lookup fields go.
  if (vm.page === 'guest' && vm.auth.guestLookupExact) {
    const keep = new Set(want[0]); const f0 = out.indexOf(`action="${esc(vm.url(vm.page))}`); const f1 = out.indexOf('</form>', f0);
    const formHtml = out.slice(f0, f1).replace(/<div\b[^>]*>\s*<label\b[^>]*>(?:(?!<\/label>)[\s\S])*<\/label>\s*<input\b[^>]*\bname="(\w+)"[^>]*>(?:\s*<(?:small|p)\b[^>]*>[^<]*<\/(?:small|p)>)?\s*<\/div>/g, (m, n) => GUEST_FIELD[n] && !keep.has(n) ? '' : m);
    out = out.slice(0, f0) + formHtml + out.slice(f1);
  }
  return out;
}
// Hide AutoPay amount options and days the dossier says the biller does not offer (radios, selects).
function withAutopayOptions(out, vm) {
  if (typeof out !== 'string' || vm.page !== 'autopay' || !vm.billing) return out;
  const { autopayPolicies: pol, autopayDays: days } = vm.billing;
  if (pol) for (const v of ['minimum', 'statement', 'fixed', 'full'].filter(v => !pol.includes(v))) {
    out = out.replace(new RegExp(`<label[^>]*>(?:(?!</label>)[\\s\\S])*?name="policy" value="${v}"(?:(?!</label>)[\\s\\S])*?</label>`, 'g'), '').replace(new RegExp(`<option value="${v}"[^>]*>[^<]*</option>`, 'g'), '');
  }
  // AutoPay drafted N days after the bill date: the family's "on each due date" wording follows the dossier.
  if (vm.billing.autopayDaysAfterBill != null) out = out.replace(/\bon (?:each|every|your)(?: invoice| bill| payment)? due date\b/gi, vm.billing.autopayTiming);
  if (days === 'due_date' || Array.isArray(days)) out = out.replace(/(<select[^>]*name="day"[^>]*>)([\s\S]*?)(<\/select>)/g, (m, a, body, c) => a + body.replace(/<option value="(\d+)"[^>]*>[^<]*<\/option>/g, (o, n) => days === 'due_date' || !days.includes(Number(n)) ? '' : o) + c);
  return out;
}
// Capability notes go after the first heading of home, dashboard, help and the page of the capability itself.
function withCapabilityNotes(out, vm) {
  if (typeof out !== 'string' || !vm.capabilityNotes?.length || out.includes('data-capnotes')) return out;
  const overview = ['home', 'dashboard', 'help'].includes(vm.page);
  const keys = overview ? null : NOTE_PAGES[vm.page];
  const notes = vm.capabilityNotes.filter(n => overview ? !n.supported : keys?.includes(n.capability));
  if (keys === undefined || !notes.length) return out;
  const block = String(kitCapabilityNotes({ ...vm, capabilityNotes: notes }, keys));
  const h = out.indexOf('</h1>');
  if (h >= 0) return out.slice(0, h + 5) + block + out.slice(h + 5);
  const m = out.match(/<main[^>]*>/); return m ? out.replace(m[0], m[0] + block) : out;
}
// A dossier that makes a two-step family sign in on one page: the family's first step has no password field, so add it.
function withLoginPassword(out, vm) {
  if (typeof out !== 'string' || vm.page !== 'login' || vm.flow?.loginSteps !== 1 || !vm.auth) return out;
  const at = out.indexOf(`action="${esc(vm.url('login'))}`); if (at < 0) return out;
  const end = out.indexOf('</form>', at); const form = out.slice(at, end);
  if (form.includes('name="password"')) return out;
  const btn = out.indexOf('<button', at); const pos = btn > at && btn < end ? btn : end;
  return out.slice(0, pos) + String(kitField(vm, { name: 'password', label: kitL(vm, 'password', 'Password'), type: 'password', autocomplete: 'current-password' })) + out.slice(pos);
}
// Dossier navigation (vm.nav): the template declares its primary nav per area in meta.navSlots (class:<token> or
// aria:<label>); the first matching <nav>/<aside> keeps its own container (and the template's styling) and gets the
// dossier's items. On public pages the observed real-site navs (research captures) yield to the dossier. Without a slot
// match the dossier bar goes right after the header.
const OBSERVED_NAV = /<nav\b[^>]*class="[^"]*\b(?:pf-nav|obs-nav|pf-site|pf-real)\b[^"]*"[^>]*>[\s\S]*?<\/nav>/g;
function withDossierNav(out, vm, t) {
  const area = vm.authenticated ? 'account' : 'public';
  if (typeof out !== 'string' || !vm.nav?.[area]?.length || !out.includes('<body')) return out;
  const inner = String(kitDossierNavInner(vm, area));
  const dropObserved = html => area === 'public' ? html.replace(OBSERVED_NAV, m => m.includes('data-dossier-nav') ? m : '') : html;
  for (const sel of t.meta?.navSlots?.[area] || []) {
    const [kind, value] = [sel.slice(0, sel.indexOf(':')), sel.slice(sel.indexOf(':') + 1)];
    const attr = kind === 'class' ? `class="(?:[^"]*\\s)?${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s[^"]*)?"` : `aria-label="${esc(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`;
    const re = new RegExp(`<(nav|aside)\\b([^>]*\\b${attr}[^>]*)>[\\s\\S]*?</\\1>`);
    const m = out.match(re);
    if (m) {
      // A family nav that carried the sign-out link keeps one: the dossier's items never include it.
      const logoutPath = esc(vm.url('logout').split('?')[0]);
      const keepLogout = area === 'account' && m[0].includes(`href="${logoutPath}`) && !out.replace(m[0], '').includes(`href="${logoutPath}`);
      const signOut = keepLogout ? `<a class="bwf-signout" href="${esc(vm.url('logout'))}">${esc(String(kitL(vm, 'signOut', 'Sign Out')))}</a>` : '';
      return dropObserved(out.replace(m[0], () => `<${m[1]}${m[2]} data-dossier-nav="${area}">${inner}${signOut}</${m[1]}>`));
    }
  }
  out = dropObserved(out);
  const bar = String(kitDossierNavBar(vm, area));
  const h = out.indexOf('</header>');
  if (h >= 0) return out.slice(0, h + 9) + bar + out.slice(h + 9);
  return out.replace(/<body[^>]*>/, m => m + bar);
}
export const decorate = (out, vm, t = null) => withDossierNav(decorateBase(out, vm), vm, t || {});
// When a dossier says a page's own action is not offered online, drop the forms that post to that page;
// the capability note (added next) tells the user how to do it instead.
// The wizard chrome around a removed form (progress steppers, "we hate to see you go" lines, emptied boxes) goes too.
// AutoPay: enrollment forms go when AutoPay is not offered online, the turn-off form and link when cancelling is not.
const PRIMARY_CAP = { arrangement: 'payment_arrangement', paperless: 'paperless', cancel: 'cancel_service', plan: 'change_plan', guest: 'guest_pay' };
const STEPPER = /<ol\b[^>]*class="(?:progress|kstep|stepper|steps-bar|wiz|wizard|dsteps|psteps|hp-steps|mc-steps|pp-track)"[^>]*>[\s\S]*?<\/ol>/g;
const FORM = /<form\b[^>]*>(?:(?!<\/form>)[\s\S])*<\/form>/g;
const offline = (vm, cap) => { const s = vm.biller?.capabilities?.[cap]; return !!s?.dossier && !!s.support && s.support !== 'supported'; };
function emptied(out) {
  for (let i = 0; i < 3; i++) out = out.replace(/<(section|div)\b[^>]*class="[^"]*\b(?:tile|card|kcard|pbox|panel|box|ssm)\b[^"]*"[^>]*>\s*(?:<h[23][^>]*>[^<]*<\/h[23]>\s*)?<\/\1>/g, '');
  return out;
}
function withoutUnsupportedForms(out, vm) {
  if (typeof out !== 'string' || !vm.biller?.capabilities) return out;
  if (vm.page === 'autopay') {
    const before = out;
    if (offline(vm, 'autopay') && !vm.autopay?.enrolled) out = out.replace(FORM, f => /name="action" value="enroll"/.test(f) ? '' : f);
    if (offline(vm, 'autopay_cancel')) out = out.replace(FORM, f => /name="action" value="cancel"/.test(f) ? '' : f).replace(/<a\b[^>]*href="[^"]*[?&]step=cancel[^"]*"[^>]*>[\s\S]*?<\/a>/g, '');
    return out === before ? out : emptied(out);
  }
  const cap = PRIMARY_CAP[vm.page];
  if (!cap || !offline(vm, cap) || !vm.capabilityNotes?.some(n => n.capability === cap)) return out;
  if (cap === 'cancel_service' && vm.service && vm.service.status !== 'active') return out;
  const action = esc(vm.url(vm.page));
  out = out.replace(FORM, f => f.includes(`action="${action}`) ? '' : f).replace(STEPPER, '').replace(/<p\b[^>]*>\s*We hate to see you go\.?[^<]*<\/p>/g, '');
  return emptied(out);
}
// Two-step sign-in on a template whose password page reuses its sign-in renderer: the step-2 form must post to the
// password step (posting to step 1 would only restart the sign-in).
function withLoginStep2Action(out, vm) {
  if (typeof out !== 'string' || vm.page !== 'loginPassword' || !vm.has('loginPassword')) return out;
  const step1 = esc(vm.url('login')), step2 = esc(vm.url('loginPassword'));
  if (out.includes(`action="${step2}`)) return out;
  return out.replace(new RegExp(`action="${step1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=["?])`, 'g'), `action="${step2}`);
}
const decorateBase = (out, vm) => withCapabilityNotes(withoutUnsupportedForms(withAutopayOptions(withRequiredFields(withLoginPassword(withLoginStep2Action(out, vm), vm), vm), vm), vm), vm);

// Malformed cookies (possibly set by another app on the same host) are skipped, never fatal.
const safeDecode = v => { try { return decodeURIComponent(v); } catch { return null; } };
const parseCookies = req => { const out = {}; for (const part of (req.headers.cookie || '').split(';')) { const v = part.trim(); const i = v.indexOf('='); if (i <= 0) continue; const val = safeDecode(v.slice(i + 1)); if (val !== null && !(v.slice(0, i) in out)) out[v.slice(0, i)] = val; } return out; };
// maxAge null = browser-session cookie. Episode lifetime is not tied to real time, so episode cookies are long-lived.
const EPISODE_COOKIE_AGE = 30 * 86400;
const setCookie = (name, value, { path = '/', maxAge = null } = {}) => `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=${path}${maxAge === null ? '' : `; Max-Age=${maxAge}`}`;
const SAFE_PATH = /^\/[\x21-\x7e]*$/; // printable ASCII, no spaces/CR/LF
const sameSite = (req) => { const o = req.headers.origin; if (!o || o === 'null') return true; try { return new URL(o).host === req.headers.host; } catch { return false; } };
// Post-entry destinations: a biller site or the mailbox on this server, printable ASCII only (no CR/LF header injection).
const safeStart = to => typeof to === 'string' && /^\/(b\/[\w-]+\/|mail(?:[/?]|$))/.test(to) && SAFE_PATH.test(to) && !to.includes('\\') ? to : '/';
const MAIL_LOCK_AFTER = 10, MAIL_LOCK_MS = 5 * 60e3;
const safeNext = (next, billerId) => typeof next === 'string' && next.startsWith(`/b/${billerId}/`) && SAFE_PATH.test(next) && !next.includes('\\') ? next : null;
const hmac = (key, data, n = 22) => createHmac('sha256', String(key)).update(data).digest('base64url').slice(0, n);
// Default headers for every non-template HTML page (directory, mailbox, errors): no framing, no inline script.
const PAGE_CSP = "default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'";
async function readBody(req) {
  let data = ''; for await (const chunk of req) { data += chunk; if (data.length > 65536) throw new Fault('Request too large', 413); }
  if ((req.headers['content-type'] || '').includes('application/json')) { try { return JSON.parse(data || '{}'); } catch { throw new Fault('Invalid JSON'); } }
  const out = {}; for (const [k, v] of new URLSearchParams(data)) out[k] = v; return out;
}
const isToken = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// openWorld: a cookieless visitor gets a demo episode automatically (README "opens without setup").
//   Set openWorld:false for benchmark runs: only /enter/<ep>/<token> links start an episode.
// A present-but-invalid episode cookie never silently starts a new episode; it shows an explicit notice.
export async function start({ port = 3200, adminPort = 3201, host = '127.0.0.1', dataDir = null, adminToken = randomBytes(24).toString('base64url'), quiet = false, openWorld = true, maxOpenEpisodes = 2000, openEpisodeTtlMs = 24 * 3600e3, google = true, googlePort = 0, googleHost = 'localhost', socialOverrides = null } = {}) {
  if (!templates.size) await loadTemplates();
  const world = new FleetWorld({ dataDir });
  const badDossiers = Object.keys(world.catalog.dossierErrors || loadDossiers().errors || {});
  if (badDossiers.length && !quiet) console.warn(`Fleet: ${badDossiers.length} dossier(s) failed validation and are not applied: ${badDossiers.join(', ')} (run node billworld/fleet/billers/validate.mjs)`);
  installSmsMfa(world); // mfa:'sms' scenarios: sign-in codes go to the persona's phone (see sms.mjs)
  // Mock Google IdP on its own origin (googleHost:port; default http://localhost:<port>, a different host than 127.0.0.1).
  const idp = google ? new MockGoogle({ world, host: '127.0.0.1', publicHost: googleHost, port: googlePort, quiet }) : null;
  const rp = idp ? createGoogleRp({ world, idp, baseUrl: () => publicServer.baseUrl, enabled: b => !!googleSupport(b, templateFor(b), socialOverrides) }) : null;
  const socialFor = (biller, t) => idp && googleSupport(biller, t, socialOverrides) ? ['google'] : [];
  // Cookie names are port-scoped: cookies are per-host, so two fleet servers on 127.0.0.1 must not clobber each other.
  let suffix = '';
  const ck = name => `${name}${suffix}`;
  const csrfFor = (ep, sid) => hmac(ep.entryToken, `csrf:${sid || 'public'}`);
  const mailCsrf = ep => hmac(ep.mailToken, 'mail-csrf');
  const helpCache = new Map();
  const helpFor = b => { if (!helpCache.has(b.id)) { helpCache.set(b.id, helpArticles(b, templateFor(b).meta?.helpLabels || {})); if (helpCache.size > 5000) helpCache.delete(helpCache.keys().next().value); } return helpCache.get(b.id); };

  function base(billerId) { return `/b/${billerId}`; }
  function urlFor(t, billerId, page, params = {}, query = null) {
    let p = t.routes[page]; if (!p) throw new Error(`Template ${t.id} has no route for ${page}`);
    p = p.replace(/:(\w+)/g, (_, k) => encodeURIComponent(params[k] ?? ''));
    const q = query ? '?' + new URLSearchParams(query).toString() : '';
    return base(billerId) + (p === '/' ? '/' : p) + q;
  }

  // biller.profile is a lazy, non-enumerable catalog getter (observed public profile); never let a bad record break a page.
  // Tasks this host can serve: google-login-pay only where Sign in with Google is actually rendered (IdP on, evidence or override).
  const tasksFor = b => generateTasks(b, { google: socialFor(b, templateFor(b)).includes('google') });
  const profileOf = b => { try { return b.profile ?? null; } catch { return null; } };
  function viewModel({ ep, biller, t, page, sid, params, query, values = {}, error = null, notice = null, extra = {} }) {
    const session = sid ? world.session(ep, biller.id, sid) : null;
    const authenticated = !!session?.authenticated;
    const guest = !!session?.guest;
    const acct = authenticated || guest ? world.account(ep, biller.id) : null;
    const help = helpFor(biller);
    const vm = {
      page, template: t.id, revision: FLEET_REVISION, nonce: randomBytes(9).toString('base64url'), csrf: csrfFor(ep, session ? sid : null), hasJs: !!t.js,
      biller: { id: biller.id, name: biller.brand.displayName || biller.entry.name, brand: biller.brand, kind: biller.kind, billType: biller.entry.bill_type, category: biller.category, family: biller.family, capabilities: biller.capabilities, fees: biller.fees,
        phone: biller.contact ? biller.contact.phone : biller.entry.phone_customer_service, payPhone: biller.contact ? biller.contact.payPhone : biller.entry.phone_pay_by_phone, mailAddress: biller.contact ? biller.contact.mailAddress : biller.entry.mail_payment_address, serviceArea: biller.contact ? biller.contact.serviceArea : biller.entry.service_area_detail || (biller.entry.service_area || []).join(', '), signal: biller.signal, entityType: biller.entry.entity_type, parent: biller.entry.parent_company, notes: biller.entry.notes, seniorPrograms: biller.entry.senior_programs, app: biller.entry.app, processor: biller.entry.payment_processor, profile: profileOf(biller) },
      // The sign-out link carries the CSRF token so a cross-site GET cannot sign the user out.
      url: (pg, p = {}, q = null) => urlFor(t, biller.id, pg, p, pg === 'logout' && session ? { ...(q || {}), _csrf: csrfFor(ep, sid) } : q), has: pg => !!t.routes[pg], asset: name => `${base(biller.id)}/_assets/${name}`, mailUrl: '/mail', directoryUrl: '/',
      params, query, values, error, notice, today: isoDate(ep.clock), now: ep.clock, nowText: fmtDate(ep.clock), help, flow: t.flow,
      authenticated, guest, persona: authenticated ? { name: ep.persona.name, first: ep.persona.first, email: ep.persona.email } : null,
      // Social sign-in: only providers this server implements for this biller (research evidence or template meta).
      socialProviders: [], socialUrls: {}, googleLoginUrl: null, observedSocialProviders: observedSocial(biller),
      // Where the sign-in code went (mfa page copy): 'email' or 'sms', with a masked destination.
      mfaChannel: null, mfaDestination: null, smsUrl: '/sms',
      // Dedicated tier (billers/<id>.json). Family billers: empty labels, no nav/auth overrides, no notes.
      tier: biller.tier || 'family', labels: biller.dossier?.labels || {}, nav: biller.dossier?.nav || null,
      auth: biller.dossier?.auth ? { identifier: biller.dossier.auth.identifier || null, loginSteps: t.flow.loginSteps, mfa: biller.dossier.auth.mfa || null, registrationFields: biller.dossier.auth.registrationFields || [], guestLookupFields: biller.dossier.auth.guestLookupFields || [], guestLookupExact: !!biller.dossier.auth.guestLookupExact } : null,
      capabilityNotes: biller.dossier ? capabilityNotesFor(biller) : [],
      billing: biller.dossier ? { methods: methodTypesFor(biller), guestMethods: methodTypesFor(biller, { guest: true }), autopayMethodTypes: methodTypesFor(biller, { autopay: true }), autopayPolicies: autopayPoliciesFor(biller), autopayDays: biller.dossier.billing?.autopay?.days || null, autopayLeadDays: biller.dossier.billing?.autopay?.leadDays ?? null, autopayDaysAfterBill: biller.dossier.billing?.autopay?.daysAfterBill ?? null, dossierPlans: !!biller.dossier.billing?.plans, autopayTiming: autopayTimingText(biller), limits: paymentLimits(biller), lateFeePercent: biller.dossier.billing?.lateFeePercent ?? null, lateFeeCents: biller.dossier.billing?.lateFeeCents ?? null } : null,
      // Payment method types this page may offer (kit.methodChooser / newMethodFields honor it).
      methodTypes: biller.dossier ? methodTypesFor(biller, { guest: ['guest', 'guestPay', 'guestReview'].includes(page), autopay: page === 'autopay' }) : null,
      dossier: biller.dossier ? { id: biller.dossier.id, reviewedAt: biller.dossier.reviewedAt || null, sources: (biller.dossier.sources || []).map(x => ({ title: x.title, kind: x.kind })) } : null,
      ...extra
    };
    const social = authenticated ? [] : socialFor(biller, t);
    if (social.includes('google')) { const next = typeof query?.next === 'string' && safeNext(query.next, biller.id); vm.socialProviders = ['google']; vm.googleLoginUrl = `${base(biller.id)}/auth/google${next ? `?next=${encodeURIComponent(next)}` : ''}`; vm.socialUrls = { google: vm.googleLoginUrl }; }
    if (page === 'mfa') { const sms = smsMfaFor(ep, biller.id); vm.mfaChannel = sms ? 'sms' : 'email'; vm.mfaDestination = sms ? maskPhone(ep.persona.phone) : ep.persona.email.replace(/^(.)[^@]*/, '$1•••'); }
    if (acct) {
      const inv = world.currentInvoice(acct);
      Object.assign(vm, {
        account: acct, accountMasked: `****${acct.accountNumber.slice(-4)}`, balanceCents: world.balance(acct), invoice: inv, invoices: acct.invoices.slice().reverse(), dueText: fmtDate(inv.dueAt), amountOptions: world.amountOptions(acct),
        methods: acct.methods.filter(m => !m.removed && (m.saved || m.id === acct.draft?.methodId)), draft: world.draftView(acct), plans: world.plans(acct), autopay: acct.autopay, autopayMethod: acct.methods.find(m => m.id === acct.autopay.methodId) || null,
        scheduled: acct.payments.filter(p => p.status === 'scheduled'), pendingPayments: acct.payments.filter(p => ['processing', 'pending'].includes(p.status)), service: acct.service
      });
    }
    return vm;
  }

  function send(res, status, body, type = 'text/html; charset=utf-8', headers = {}) {
    const secure = { 'X-Frame-Options': 'DENY', ...(String(type).startsWith('text/html') ? { 'Content-Security-Policy': PAGE_CSP } : {}) };
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...secure, ...headers }); res.end(body);
  }
  const redirect = (res, location, cookies = []) => { res.writeHead(303, { Location: location, 'Set-Cookie': cookies }); res.end(); };

  // ---------- episodes from cookies ----------
  // Open-world episodes are bounded: created only once the client proves it keeps cookies (or on a POST),
  // never persisted until the engine mutates them, and evicted LRU/TTL from memory.
  const openEps = new Map(); // id -> last real-time access
  const touch = ep => { if (ep.kind === 'open_world') { openEps.delete(ep.id); openEps.set(ep.id, Date.now()); } };
  function evictOpen() {
    const cutoff = Date.now() - openEpisodeTtlMs;
    for (const [id, seen] of openEps) { if (openEps.size <= maxOpenEpisodes && seen >= cutoff) break; openEps.delete(id); world.episodes.delete(id); }
  }
  function newEpisodeQuiet() { return world.createEpisode({ kind: 'open_world', persist: false }); }
  const episodeCookies = ep => [setCookie(ck('bwf_ep'), ep.id, { maxAge: EPISODE_COOKIE_AGE }), setCookie(ck('bwf_at'), ep.entryToken, { maxAge: EPISODE_COOKIE_AGE }), setCookie(ck('bwf_new'), '', { maxAge: 0 })];
  function createOpenEpisode() { const ep = newEpisodeQuiet(); touch(ep); evictOpen(); return ep; }
  function lookupEpisode(id, at) {
    if (!id || typeof at !== 'string') return null;
    try { const ep = world.episode(id); if (isToken(at, ep.entryToken)) { touch(ep); return ep; } } catch { /* not found */ }
    return null;
  }
  // Returns { ep, set, fresh, transient }. Throws Fault 401 no_episode / 410 episode_lost instead of silently starting over.
  function episodeFrom(req, cookies) {
    const scopedId = cookies[ck('bwf_ep')], scopedAt = cookies[ck('bwf_at')];
    if (scopedId || scopedAt) {
      const ep = lookupEpisode(scopedId, scopedAt); if (ep) return { ep, set: [] };
      throw new Fault('This Billworld session has ended or its link is no longer valid. Open the entry link you were given to continue.', 410, 'episode_lost');
    }
    if (cookies.bwf_ep) { const ep = lookupEpisode(cookies.bwf_ep, cookies.bwf_at); if (ep) return { ep, set: [] }; } // legacy unscoped cookie (sweep harness)
    if (!openWorld) throw new Fault('Open your Billworld episode link to start.', 401, 'no_episode');
    if (req.method === 'POST' || cookies[ck('bwf_new')]) { const ep = createOpenEpisode(); return { ep, set: episodeCookies(ep), fresh: true }; }
    // First cookieless request: render with a throwaway episode and ask the client to come back with a cookie.
    const ep = newEpisodeQuiet(); world.episodes.delete(ep.id);
    return { ep, set: [setCookie(ck('bwf_new'), '1', { maxAge: 86400 })], transient: true };
  }

  // POST action dispatch. Returns {to, cookies} or throws Fault (re-rendered on the same page).
  function act({ ep, biller, t, page, sid, input, params, cookiePath }) {
    const go = (pg, p = {}, q = null) => urlFor(t, biller.id, pg, p, q);
    const flow = t.flow; const id = biller.id;
    const sessionCookie = s => setCookie('bwf_sid', s, { path: cookiePath });
    const flash = text => setCookie('bwf_flash', text, { path: cookiePath, maxAge: 60 });
    const pendingUser = (u, maxAge = 600) => setCookie('bwf_lu', u, { path: cookiePath, maxAge });
    const nextPay = (steps, current, draft) => {
      if (draft.complete) return steps[steps.length - 1];
      const i = steps.indexOf(current); return steps[Math.min(i + 1, steps.length - 2)] || current;
    };
    switch (page) {
      case 'login': case 'loginPassword': {
        // Two-step login keeps the pending user ID in a short-lived HttpOnly cookie, not in the URL.
        if (flow.loginSteps === 2 && page === 'login') { if (!input.username) throw new Fault('Enter your user ID or email.', 400, 'missing'); return { to: go('loginPassword', {}, input.next ? { next: input.next } : null), cookies: [pendingUser(String(input.username).slice(0, 200))] }; }
        const r = world.login(ep, id, input);
        const next = safeNext(input.next, id) || go(flow.afterLogin);
        return { to: r.mfa ? go('mfa', {}, { next }) : next, cookies: [sessionCookie(r.sid), ...(flow.loginSteps === 2 ? [pendingUser('', 0)] : [])] };
      }
      case 'mfa': {
        if (input.op === 'resend') { world.resendMfa(ep, id, sid); return { to: go('mfa', {}, input.next ? { next: input.next } : null), cookies: [flash(smsMfaFor(ep, id) ? 'We sent a new code to your phone.' : 'We sent a new code to your email.')] }; }
        world.verifyMfa(ep, id, sid, input); const next = safeNext(input.next, id) || go(flow.afterLogin); return { to: next }; }
      case 'register': world.register(ep, id, input); return { to: go('login'), cookies: [flash('Check your email to verify your address and finish creating your account.')] };
      case 'verify': world.verifyEmail(ep, id, input.token); return { to: go('login'), cookies: [flash('Your email is verified. You can now sign in.')] };
      case 'forgot': world.requestReset(ep, id, input); return { to: go('reset'), cookies: [flash('If we found an account, we sent a verification code to the email on file.')] };
      case 'reset': world.resetPassword(ep, id, input); return { to: go('login'), cookies: [flash('Your password was reset. Sign in with your new password.')] };
      case 'guest': { const r = world.guestLookup(ep, id, input, { required: t.flow.guestFields || [] }); return { to: go(flow.guestSteps[1]), cookies: [sessionCookie(r.sid)] }; }
      case 'guestPay': case 'guestReview': {
        if (page === 'guestReview' || input.op === 'submit') { const p = world.submitPayment(ep, id, sid, { token: input.token, acceptTerms: !!input.acceptTerms }, { guest: true }); return { to: go('guestReceipt', { id: p.id }) }; }
        const d = world.draftPayment(ep, id, sid, input, { guest: true }); return { to: go(d.complete ? flow.guestSteps[flow.guestSteps.length - 1] : page) };
      }
      case 'pay': case 'payMethod': case 'payReview': {
        if (page === 'payReview' || input.op === 'submit') {
          if (input.op === 'edit') return { to: go(flow.paySteps[0]) };
          const p = world.submitPayment(ep, id, sid, { token: input.token, acceptTerms: !!input.acceptTerms }); return { to: go('payReceipt', { id: p.id }) };
        }
        const d = world.draftPayment(ep, id, sid, input); return { to: go(nextPay(flow.paySteps, page, d)) };
      }
      case 'history': if (input.op === 'cancel') { world.cancelScheduled(ep, id, sid, input); return { to: go('history'), cookies: [flash('Your scheduled payment was cancelled.')] }; } break;
      case 'autopay': { const r = world.autopay(ep, id, sid, input); return { to: go('autopay'), cookies: [flash(r.enrolled ? 'Your AutoPay settings have been saved.' : 'AutoPay has been cancelled.')] }; }
      case 'paperless': { const r = world.setPaperless(ep, id, sid, input); return { to: go('paperless'), cookies: [flash(r.paperless ? 'You are enrolled in paperless billing.' : 'You will receive paper bills.')] }; }
      case 'wallet': if (input.op === 'remove') { world.removeMethod(ep, id, sid, input); return { to: go('wallet'), cookies: [flash('Payment method removed.')] }; } world.addMethod(ep, id, sid, input); return { to: go('wallet'), cookies: [flash('Payment method saved.')] };
      case 'cancel': { const r = world.cancelService(ep, id, sid, input); return { to: go('cancel', {}, { step: r.next || 'done' }) }; }
      case 'plan': world.changePlan(ep, id, sid, input); return { to: go('plan'), cookies: [flash('Your plan has been updated.')] };
      case 'arrangement': world.setupArrangement(ep, id, sid, input); return { to: go('arrangement'), cookies: [flash('Your payment plan is set up.')] };
      case 'contact': world.contact(ep, id, sid, input); return { to: go('contact'), cookies: [flash('Your message was sent.')] };
      case 'profile': world.updateProfile(ep, id, sid, input); return { to: go('profile'), cookies: [flash('Your profile was updated.')] };
      case 'logout': world.logout(ep, sid); return { to: go('home'), cookies: [setCookie('bwf_sid', '', { path: cookiePath, maxAge: 0 })] };
    }
    throw new Fault('This form cannot be submitted here.', 405, 'bad_action');
  }

  async function billerRequest(req, res, url, billerId, rest, cookies) {
    const biller = world.biller(billerId); const t = templateFor(biller); const cookiePath = `/b/${billerId}/`;
    if (rest.startsWith('/_assets/')) {
      const name = rest.slice(9);
      if (name === 'template.css') return send(res, 200, t.css || '', 'text/css', { 'Cache-Control': 'public, max-age=300' });
      if (name === 'template.js' && t.js) return send(res, 200, t.js, 'text/javascript', { 'Cache-Control': 'public, max-age=300' });
      if (name === 'favicon.svg') return send(res, 200, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="${biller.brand.primary}"/><text x="20" y="26" text-anchor="middle" font-family="Arial" font-size="16" font-weight="700" fill="#fff">${esc(biller.brand.monogram)}</text></svg>`, 'image/svg+xml');
      throw new Fault('Asset not found', 404);
    }
    if (rest === '/auth/google' || rest === '/auth/google/callback') return googleRequest(req, res, url, biller, t, rest, cookies, cookiePath);
    const match = t.matchers.find(m => m.re.test(rest || '/'));
    if (!match) throw new Fault('Page not found', 404, 'not_found');
    const page = match.page; const params = {}; const mm = (rest || '/').match(match.re); match.keys.forEach((k, i) => { const v = safeDecode(mm[i + 1]); if (v === null) throw new Fault('Bad request', 400, 'bad_request'); params[k] = v; });
    const query = Object.fromEntries(url.searchParams);
    if (req.method === 'POST' && !sameSite(req)) throw new Fault('Cross-site form submission blocked', 403, 'cross_site');
    const { ep, set, fresh } = episodeFrom(req, cookies);
    const draftOk = s => draftOkFor(ep, billerId, s);
    let sid = cookies.bwf_sid; const session = sid ? world.session(ep, billerId, sid) : null; if (!session) sid = null;
    const flashText = cookies.bwf_flash || null; const clearFlash = flashText ? [setCookie('bwf_flash', '', { path: cookiePath, maxAge: 0 })] : [];
    const offline = world.isOffline(biller); // offline template (any signal) or documented unsupported online accounts
    if (offline && !['home', 'help', 'helpArticle', 'helpSearch'].includes(page)) return redirect(res, urlFor(t, billerId, 'home'), set);
    const guestPages = new Set(['guestPay', 'guestReview', 'guestReceipt']);
    const needsAuth = !PUBLIC_PAGES.has(page);
    if (needsAuth && !session?.authenticated) return redirect(res, urlFor(t, billerId, 'login', {}, { next: url.pathname + url.search }), [...set, setCookie('bwf_flash', 'Please sign in to continue.', { path: cookiePath, maxAge: 60 })]);
    if (guestPages.has(page) && !session?.guest) return redirect(res, urlFor(t, billerId, 'guest'), set);

    if (req.method === 'POST') {
      const input = await readBody(req);
      // CSRF: protected pages need this session's token. Public pages also accept the episode's public token and the
      // token of the (possibly expired) session cookie, so a sign-in form rendered before a session lapsed still works.
      // A brand-new open-world episode has no state to protect.
      const okTokens = [csrfFor(ep, sid), ...(PUBLIC_PAGES.has(page) ? [csrfFor(ep, null), cookies.bwf_sid && csrfFor(ep, cookies.bwf_sid)] : [])];
      if (!fresh && !okTokens.some(tok => tok && isToken(input._csrf, tok))) throw new Fault('Your session changed. Reload the page and try again.', 403, 'csrf');
      if (page === 'loginPassword' && !input.username && cookies.bwf_lu) input.username = cookies.bwf_lu;
      try {
        const r = act({ ep, biller, t, page, sid, input, params, cookiePath });
        return redirect(res, r.to, [...set, ...(r.cookies || [])]);
      } catch (e) {
        if (!(e instanceof Fault)) throw e;
        if (e.code === 'auth_required' || e.code === 'guest_required') return redirect(res, urlFor(t, billerId, e.code === 'guest_required' ? 'guest' : 'login'), set);
        const values = { ...input }; for (const k of ['password', 'confirm', 'cardNumber', 'cvv', 'bankAccount', 'bankAccountConfirm']) delete values[k];
        // A review page without a complete draft (e.g. after a decline) falls back to the first pay step.
        const draftDone = draftOk(sid);
        const shown = page === 'payReview' && !draftDone ? t.flow.paySteps[0] : page === 'guestReview' && !draftDone ? t.flow.guestSteps[1] : page;
        const q2 = input.next && typeof input.next === 'string' ? { ...query, next: input.next } : query; // keep the post-login target on error re-renders
        const vm = viewModel({ ep, biller, t, page: shown, sid, params, query: q2, values, error: e.message, extra: pageExtras(ep, biller, t, shown, params, q2, sid) });
        return send(res, e.status >= 500 ? 500 : 400, decorate(withSocial(t.render(shown, vm), vm), vm, t), 'text/html; charset=utf-8', { 'Set-Cookie': set, 'Content-Security-Policy': csp(vm) });
      }
    }
    if (page === 'logout') {
      // GET sign-out needs the token carried by the template's sign-out link (a cross-site link cannot know it).
      if (sid && !isToken(query._csrf, csrfFor(ep, sid))) return redirect(res, urlFor(t, billerId, t.flow.afterLogin), [...set, setCookie('bwf_flash', 'To sign out, use the Sign out link.', { path: cookiePath, maxAge: 60 })]);
      if (sid) world.logout(ep, sid); return redirect(res, urlFor(t, billerId, 'home'), [...set, setCookie('bwf_sid', '', { path: cookiePath, maxAge: 0 })]); }
    if (page === 'verify' && query.token) { try { world.verifyEmail(ep, billerId, query.token); return redirect(res, urlFor(t, billerId, 'login'), [...set, setCookie('bwf_flash', 'Your email is verified. You can now sign in.', { path: cookiePath, maxAge: 60 })]); } catch (e) { if (!(e instanceof Fault)) throw e; const vm = viewModel({ ep, biller, t, page: 'verify', sid, params, query, error: e.message }); return send(res, 400, t.render('verify', vm), 'text/html; charset=utf-8', { 'Set-Cookie': set, 'Content-Security-Policy': csp(vm) }); } }
    if (page === 'statement') {
      const acct = world.account(ep, billerId); const inv = acct.invoices.find(i => i.id === params.id || i.number === params.id);
      if (!inv) throw new Fault('Statement not found', 404);
      world.event(ep, billerId, 'statement_downloaded', { invoiceId: inv.id });
      const pdf = textPdf([`# ${biller.entry.name}`, `Account number: ${acct.accountNumber}`, `Customer: ${ep.persona.name}`, `Service address: ${acct.serviceAddress}`, `Statement number: ${acct.statementId && inv.id === acct.invoices.at(-1).id ? acct.statementId : inv.number}`, `Billing period: ${inv.period}`, `Statement date: ${fmtDate(inv.issuedAt)}`, `Payment due date: ${fmtDate(inv.dueAt)}`, '# Charges', ...inv.lines.map(l => `${l.desc}: ${money(l.cents)}`), inv.previousBalanceCents ? `Previous balance: ${money(inv.previousBalanceCents)}` : '', inv.creditAppliedCents ? `Credit applied: -${money(inv.creditAppliedCents)}` : '', `# Total amount due: ${money(inv.totalDueCents ?? inv.amountCents)}`, contactOf(biller).mailAddress ? `Mail payments to: ${contactOf(biller).mailAddress}` : '', contactOf(biller).phone ? `Questions? Call ${contactOf(biller).phone}` : ''].filter(Boolean), { title: `${biller.brand.shortName} statement ${fmtDate(inv.issuedAt)}` });
      return send(res, 200, pdf, 'application/pdf', { 'Content-Disposition': `inline; filename="statement-${inv.number}.pdf"`, 'Set-Cookie': set });
    }
    const pendingUser = cookies.bwf_lu || query.u || ''; // query.u: legacy links
    if (page === 'loginPassword' && flowNeeds(t) && !pendingUser) return redirect(res, urlFor(t, billerId, 'login', {}, query.next ? { next: query.next } : null), set);
    // A review page is only valid for a complete draft made in THIS session. After a session expires and the user signs
    // in again, the old draft can never be submitted, so send them back to the first step instead of a dead review page.
    if (page === 'payReview' || page === 'guestReview') {
      const first = page === 'payReview' ? t.flow.paySteps[0] : t.flow.guestSteps[1];
      if (!draftOk(sid)) { const stale = !!world.account(ep, billerId).draft?.token; return redirect(res, urlFor(t, billerId, first), [...set, ...(stale ? [setCookie('bwf_flash', 'Your previous payment session expired. Please review your payment details again.', { path: cookiePath, maxAge: 60 })] : [])]); }
    }
    const vm = viewModel({ ep, biller, t, page, sid, params, query, values: { ...(page === 'loginPassword' && pendingUser ? { username: pendingUser } : {}) }, notice: flashText, extra: pageExtras(ep, biller, t, page, params, query, sid) });
    if (vm.missing) throw new Fault('Page not found', 404, 'not_found');
    world.event(ep, billerId, 'page_view', { page });
    return send(res, 200, decorate(withSocial(t.render(page, vm), vm), vm, t), 'text/html; charset=utf-8', { 'Set-Cookie': [...set, ...clearFlash], 'Content-Security-Policy': csp(vm) });
  }
  const flowNeeds = t => t.flow.loginSteps === 2;
  function draftOkFor(ep, billerId, sid) { const d = world.account(ep, billerId).draft; return !!(sid && d?.token && d.sid === sid); }
  const csp = vm => `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${vm.nonce}'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'`;
  const contactOf = b => b.contact || { phone: b.entry.phone_customer_service, mailAddress: b.entry.mail_payment_address };
  function observedSocial(b) { try { const l = b.profile?.login?.socialProviders; return Array.isArray(l) ? l.map(x => String(x).toLowerCase()) : []; } catch { return []; } }
  // Templates render kit.socialButtons(vm) themselves; for one that does not (yet), the buttons are placed right after
  // its sign-in form so every Google-enabled biller has a working entry point.
  function withSocial(out, vm) {
    if (vm.page !== 'login' || !vm.socialProviders?.length || typeof out !== 'string' || out.includes('data-social-login')) return out;
    const block = String(socialButtons(vm));
    const at = out.indexOf(`action="${esc(vm.url('login'))}`);
    const end = at >= 0 ? out.indexOf('</form>', at) : -1;
    if (end >= 0) return out.slice(0, end + 7) + block + out.slice(end + 7);
    const main = out.lastIndexOf('</main>');
    return main >= 0 ? out.slice(0, main) + block + out.slice(main) : out.replace('</body>', () => block + '</body>');
  }

  // ---------- Sign in with Google (relying party) ----------
  async function googleRequest(req, res, url, biller, t, rest, cookies, cookiePath) {
    if (!rp || !socialFor(biller, t).length) throw new Fault('Page not found', 404, 'not_found');
    if (req.method !== 'GET') throw new Fault('Method not allowed', 405, 'bad_method');
    // A flow must survive the round trip, so a cookieless visitor gets a real (not transient) open-world episode.
    const { ep, set } = episodeFrom({ method: 'POST', headers: req.headers }, cookies);
    const go = (pg, q = null) => urlFor(t, biller.id, pg, {}, q);
    const query = Object.fromEntries(url.searchParams);
    if (rest === '/auth/google') {
      const r = rp.begin(ep, biller.id, { next: safeNext(query.next, biller.id) });
      return redirect(res, r.location, [...set, setCookie('bwf_oauth', r.state, { path: cookiePath, maxAge: 1200 })]);
    }
    const r = rp.callback(ep, biller.id, query, cookies.bwf_oauth);
    const clear = setCookie('bwf_oauth', '', { path: cookiePath, maxAge: 0 });
    if (r.sid) return redirect(res, safeNext(r.next, biller.id) || go(t.flow.afterLogin), [...set, clear, setCookie('bwf_sid', r.sid, { path: cookiePath })]);
    return redirect(res, go('login'), [...set, clear, setCookie('bwf_flash', r.error, { path: cookiePath, maxAge: 60 })]);
  }

  function pageExtras(ep, biller, t, page, params, query, sid) {
    const extra = {};
    if (page === 'helpArticle') { extra.article = helpFor(biller).find(a => a.slug === params.slug); if (!extra.article) extra.missing = true; }
    if (page === 'helpSearch') extra.results = searchHelp(helpFor(biller), query.q);
    if (page === 'payReceipt' || page === 'guestReceipt') { const acct = world.account(ep, biller.id); extra.payment = acct.payments.find(p => p.id === params.id); if (!extra.payment) extra.missing = true; else extra.paymentMethod = acct.methods.find(m => m.id === extra.payment.methodId); }
    if (page === 'cancel') extra.step = ['reason', 'offer', 'confirm', 'done', 'kept'].includes(query.step) ? query.step : 'reason';
    return extra;
  }

  // ---------- mailbox ----------
  const mailLink = (m, l) => { const b = world.biller(m.billerId); return urlFor(templateFor(b), b.id, l.page, {}, l.query); };
  const connector = createConnector({ world, linkUrl: (m, l) => publicServer.baseUrl + mailLink(m, l), readBody, json: (res, status, data) => send(res, status, JSON.stringify(data), 'application/json') });

  // ---------- SMS (the persona's phone) ----------
  // The phone belongs to the episode's persona: the episode cookie is the device. Same-site POST + CSRF for changes.
  async function smsRequest(req, res, url, cookies) {
    if (req.method === 'POST' && !sameSite(req)) throw new Fault('Cross-site form submission blocked', 403, 'cross_site');
    const { ep, set } = episodeFrom(req, cookies);
    const csrf = hmac(ep.entryToken, 'sms-csrf');
    if (req.method === 'POST') {
      const input = await readBody(req);
      if (url.pathname !== '/sms/read' || typeof input._csrf !== 'string' || !isToken(input._csrf, csrf)) throw new Fault('Reload the page and try again.', 403, 'csrf');
      for (const m of ep.sms?.messages || []) if (m.from === input.from && input.op === 'unread') m.unread = true;
      world.persist(ep); return redirect(res, '/sms', set);
    }
    const conv = url.pathname.match(/^\/sms\/c\/(\d{3,8})$/)?.[1];
    if (url.pathname !== '/sms' && !conv) throw new Fault('Page not found', 404, 'not_found');
    const body = renderSms({ ep, conversation: conv, csrf });
    if (conv) { let changed = false; for (const m of ep.sms?.messages || []) if (m.from === conv && m.unread) { m.unread = false; changed = true; } if (changed) { world.event(ep, null, 'sms_read', { from: conv }); world.persist(ep); } }
    return send(res, 200, body, undefined, { 'Set-Cookie': set });
  }
  async function mailRequest(req, res, url, cookies) {
    if (req.method === 'POST' && !sameSite(req)) throw new Fault('Cross-site form submission blocked', 403, 'cross_site');
    const { ep, set } = episodeFrom(req, cookies);
    const mailCookie = ck('bwf_mail');
    const authed = (cookies[mailCookie] && isToken(cookies[mailCookie], ep.mailToken)) || (cookies.bwf_mail && isToken(cookies.bwf_mail, ep.mailToken));
    const csrf = mailCsrf(ep);
    const linkFor = mailLink;
    const html = (status, body, extra = []) => send(res, status, body, undefined, { 'Set-Cookie': [...set, ...extra] });
    if (req.method === 'POST') {
      const input = await readBody(req);
      if (url.pathname === '/mail/login') {
        // Throttle: MAIL_LOCK_AFTER consecutive failures lock the mailbox for MAIL_LOCK_MS of real time.
        const lock = ep.mailLock || (ep.mailLock = { fails: 0, until: 0 });
        if (lock.until > Date.now()) return html(429, renderMail({ ep, view: 'login', error: 'Too many failed sign-in attempts. Wait a few minutes and try again.' }));
        if (String(input.email || '').toLowerCase().trim() !== ep.persona.email || typeof input.password !== 'string' || !isToken(input.password, ep.mailPassword)) {
          if (++lock.fails >= MAIL_LOCK_AFTER) { lock.fails = 0; lock.until = Date.now() + MAIL_LOCK_MS; }
          return html(401, renderMail({ ep, view: 'login', error: 'Wrong email or password. Try again.' }));
        }
        lock.fails = 0; lock.until = 0;
        return redirect(res, '/mail', [...set, setCookie(mailCookie, ep.mailToken)]);
      }
      if (!authed) return redirect(res, '/mail', set);
      if (typeof input._csrf !== 'string' || !isToken(input._csrf, csrf)) throw new Fault('Your mail session changed. Reload the page and try again.', 403, 'csrf');
      if (url.pathname === '/mail/logout') return redirect(res, '/mail', [...set, setCookie(mailCookie, '', { maxAge: 0 }), setCookie('bwf_mail', '', { maxAge: 0 })]);
      const msg = ep.mailbox.find(m => m.id === input.id);
      if (msg && input.op === 'star') msg.starred = !msg.starred;
      if (msg && input.op === 'unread') msg.unread = true;
      if (msg && input.op === 'trash') msg.labels = ['TRASH'];
      // Only same-site mailbox paths are valid return targets.
      const back = typeof input.back === 'string' && /^\/mail(?:[/?][\x21-\x7e]*)?$/.test(input.back) && !input.back.includes('\\') ? input.back : '/mail';
      world.persist(ep); return redirect(res, back, set);
    }
    if (!authed) return html(200, renderMail({ ep, view: 'login' }));
    const id = url.pathname.match(/^\/mail\/m\/([\w-]+)$/)?.[1];
    if (id) { const m = ep.mailbox.find(x => x.id === id); if (!m) throw new Fault('Message not found', 404); m.unread = false; world.persist(ep); return html(200, renderMail({ ep, view: 'message', message: m, linkFor, csrf })); }
    const q = url.searchParams.get('q') || ''; const folder = url.searchParams.get('folder') || 'inbox';
    const list = folder === 'starred' ? searchMessages(ep, `is:starred ${q}`) : searchMessages(ep, q); // same query language as the connector
    return html(200, renderMail({ ep, view: 'inbox', messages: list, q, folder, csrf }));
  }

  const publicServer = http.createServer(async (req, res) => {
    try {
      res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
      const url = new URL(req.url, 'http://fleet.invalid'); const cookies = parseCookies(req);
      if (url.pathname === '/health') return send(res, 200, JSON.stringify({ status: 'ok', revision: FLEET_REVISION, billers: world.catalog.billers.size, templates: templates.size }), 'application/json');
      const enter = url.pathname.match(/^\/enter\/([\w-]+)\/([\w-]+)$/);
      if (enter) { let ep; try { ep = world.episode(enter[1]); } catch { throw new Fault('Invalid entry link', 403); } if (!isToken(enter[2], ep.entryToken)) throw new Fault('Invalid entry link', 403); touch(ep); return redirect(res, safeStart(url.searchParams.get('to')), [...episodeCookies(ep), setCookie(ck('bwf_mail'), '', { maxAge: 0 }), setCookie('bwf_mail', '', { maxAge: 0 })]); }
      // Explicit "start a new demo session" (linked from the episode-expired notice). Open-world servers only.
      if (url.pathname === '/start-demo' && openWorld) { const ep = createOpenEpisode(); return redirect(res, safeStart(url.searchParams.get('to')), [...episodeCookies(ep), setCookie(ck('bwf_mail'), '', { maxAge: 0 })]); }
      if (url.pathname === '/mail.css') return send(res, 200, mailCss + smsCss, 'text/css');
      if (url.pathname.startsWith('/connector/')) return await connector(req, res, url);
      if (url.pathname === '/sms' || url.pathname.startsWith('/sms/')) return await smsRequest(req, res, url, cookies);
      if (url.pathname === '/mail' || url.pathname.startsWith('/mail/')) return await mailRequest(req, res, url, cookies);
      const b = url.pathname.match(/^\/b\/([\w-]+)(\/.*)?$/);
      if (b) { if (!b[2]) return redirect(res, `/b/${b[1]}/`); return await billerRequest(req, res, url, b[1], b[2], cookies); }
      if (url.pathname === '/' || url.pathname === '/search') { const q = url.searchParams.get('q') || ''; return send(res, 200, renderDirectory({ q, results: q ? searchCatalog(q, { limit: 50 }) : [], catalog: world.catalog })); }
      throw new Fault('Not found', 404);
    } catch (e) {
      const status = e instanceof Fault ? e.status : 500; if (!(e instanceof Fault) && !quiet) console.error(e);
      if (res.headersSent) return;
      if (e.code === 'episode_lost' || e.code === 'no_episode') {
        const here = req.method === 'GET' ? safeStart(req.url) : '/';
        return send(res, status, renderNotice({ title: e.code === 'episode_lost' ? 'Your session has ended' : 'Open your episode link', message: e.message, actions: [...(openWorld ? [{ href: `/start-demo?to=${encodeURIComponent(here)}`, label: 'Start a new demo session', nofollow: true }] : []), { href: '/', label: 'Billworld directory' }] }));
      }
      send(res, status, renderNotice({ title: status === 404 ? 'Page not found' : status === 400 ? 'Bad request' : status === 403 ? 'Request blocked' : 'Something went wrong', message: e instanceof Fault ? e.message : 'Unexpected error', actions: [{ href: '/', label: 'Billworld directory' }] }));
    }
  });

  // ---------- private admin / grader API ----------
  const adminServer = http.createServer(async (req, res) => {
    const json = (data, status = 200) => send(res, status, JSON.stringify(data), 'application/json');
    try {
      if (!isToken((req.headers.authorization || '').replace(/^Bearer /, ''), adminToken)) return json({ error: 'unauthorized' }, 401);
      const url = new URL(req.url, 'http://admin'); const input = req.method === 'POST' ? await readBody(req) : {};
      const ep = () => world.episode(input.episodeId || url.searchParams.get('episodeId'));
      if (url.pathname === '/episodes' && req.method === 'GET') return json([...world.episodes.values()].map(e => ({ episodeId: e.id, kind: e.kind, createdAt: e.createdAt, taskId: e.task?.id || null, finished: !!e.finished, clock: e.clock })));
      const epPath = url.pathname.match(/^\/episodes\/(ep-[\w-]+)(\/reset)?$/);
      if (epPath && req.method === 'DELETE' && !epPath[2]) { world.episode(epPath[1]); dropEpisode(epPath[1]); return json({ deleted: epPath[1] }); }
      if (epPath && req.method === 'POST' && epPath[2]) return json(describe(resetEpisode(world.episode(epPath[1]))));
      if (url.pathname === '/episodes' && req.method === 'POST') {
        // taskId binds the episode to a generated task: its scenario seeds the episode and /finish grades ITS predicates.
        let task = null;
        if (input.taskId != null) {
          const tid = String(input.taskId); const bid = tid.split(':')[0];
          task = tasksFor(world.biller(bid)).find(x => x.id === tid);
          if (!task) throw new Fault(`Unknown task ${tid}`, 404, 'no_task');
          if (input.billerId && input.billerId !== task.billerId) throw new Fault('billerId does not match the task', 400, 'bad_task');
          input.billerId = task.billerId;
        }
        if (input.billerId) world.biller(input.billerId);
        const norm = normalizeScenario(input.scenario ?? task?.scenario ?? {}, { nativeSms: true }); // the engine delivers mfa:'sms' codes itself
        const e = world.createEpisode({ seed: input.seed, scenario: norm.scenario, kind: input.kind || 'agent' });
        e.channels = { ...(norm.smsMfa.default || norm.smsMfa.billers.length ? { smsMfa: norm.smsMfa } : {}), google: { decoy: !!input.channels?.google?.decoy } };
        e.task = task ? { id: task.id, billerId: task.billerId, intent: task.intent, predicates: task.predicates, answer: task.answer ?? null, revision: FLEET_REVISION } : null;
        e.startBillerId = input.billerId || null;
        // Per-episode mailbox password (runners may pin one with input.mailPassword); returned below, never shown to agents by the server.
        e.mailPassword = typeof input.mailPassword === 'string' && input.mailPassword.length >= 8 ? input.mailPassword : `Mail-${randomBytes(9).toString('base64url')}!`;
        if (input.billerId) world.account(e, input.billerId);
        world.persist(e);
        return json(describe(e));
      }
      if (url.pathname === '/state') { const e = ep(); return json({ clock: e.clock, accounts: e.accounts, events: e.events, mailbox: e.mailbox.length, finished: e.finished }); }
      if (url.pathname === '/account') { const e = ep(); return json(world.account(e, input.billerId || url.searchParams.get('billerId'))); }
      if (url.pathname === '/evaluate') { const e = ep(); return json(world.evaluate(e, input.predicates?.length ? input.predicates : e.task?.predicates || [], { answer: input.answer })); }
      if (url.pathname === '/advance') return json(world.advance(ep(), Number(input.milliseconds || 0)));
      if (url.pathname === '/finish') {
        // Task-bound episodes are graded on the task's stored predicates only; caller predicates are ignored.
        const e = ep(); if (e.finished) return json(e.finished);
        const preds = e.task ? e.task.predicates : input.predicates;
        if (!Array.isArray(preds) || !preds.length) throw new Fault('No predicates to grade: create the episode with a taskId or pass predicates', 400, 'no_predicates');
        if (typeof input.answer === 'string' && input.answer.trim()) world.submitAnswer(e, input.answer.slice(0, 4000));
        const r = world.evaluate(e, preds);
        return json(world.finish(e, { ...r, metadata: input.metadata || {}, taskId: e.task?.id || null, predicateSource: e.task ? 'task' : 'caller', revision: FLEET_REVISION, taskRevision: e.task?.revision || null }));
      }
      if (url.pathname === '/mailbox') return json(ep().mailbox);
      if (url.pathname === '/biller') { const b = world.biller(url.searchParams.get('id')); return json({ ...b, profile: profileOf(b), dossier: b.dossier || null, tasks: tasksFor(b) }); }
      if (url.pathname === '/tasks') return json(tasksFor(world.biller(url.searchParams.get('billerId'))));
      if (url.pathname === '/templates') return json([...templates.values()].map(t => ({ id: t.id, meta: t.meta, routes: t.routes, flow: t.flow, billers: world.catalog.byTemplate.get(t.id)?.length || 0 })));
      return json({ error: 'not found' }, 404);
    } catch (e) { json({ error: e.message, code: e.code }, e instanceof Fault ? e.status : 500); }
  });

  // Runner descriptor. `connector` is the only part meant for an agent's mail tools; never hand an agent the whole JSON.
  function describe(e) {
    const startPath = e.startBillerId ? `/b/${e.startBillerId}/` : '/';
    const token = connectorToken(e);
    return {
      episodeId: e.id, entryUrl: `${publicServer.baseUrl}/enter/${e.id}/${e.entryToken}?to=${encodeURIComponent(startPath)}`, persona: e.persona,
      task: e.task ? { id: e.task.id, intent: e.task.intent } : null,
      credentials: { portalPassword: PASSWORD, mailbox: { url: `${publicServer.baseUrl}/mail`, email: e.persona.email, password: e.mailPassword }, google: idp ? { issuer: idp.issuer, email: e.persona.email, password: e.mailPassword } : null, phone: { number: e.persona.phone, url: `${publicServer.baseUrl}/sms` } },
      connector: { url: publicServer.baseUrl, episodeId: e.id, token, mcp: { command: process.execPath, args: [`${here}mail-mcp.mjs`], env: { BILLWORLD_FLEET_URL: publicServer.baseUrl, BILLWORLD_EPISODE: e.id, BILLWORLD_MAIL_TOKEN: token } } },
      channels: { smsMfa: e.channels?.smsMfa || null, googleDecoy: !!e.channels?.google?.decoy }
    };
  }
  function dropEpisode(id) { world.episodes.delete(id); openEps.delete(id); idp?.resetTenant(id); if (world.dataDir && /^ep-[\w-]+$/.test(id)) rmSync(`${world.dataDir}/${id}.json`, { force: true }); }
  // Deterministic reset: re-seed from the same seed + scenario; keeps the id and every credential (entry link,
  // mailbox password, connector token), the bound task and channels.
  function resetEpisode(e) {
    const fresh = world.createEpisode({ seed: e.seed, scenario: e.scenario, kind: e.kind, persist: false });
    world.episodes.delete(fresh.id);
    const keep = { id: e.id, entryToken: e.entryToken, mailToken: e.mailToken, mailPassword: e.mailPassword, task: e.task, channels: e.channels, startBillerId: e.startBillerId };
    for (const k of Object.keys(e)) delete e[k];
    Object.assign(e, fresh, keep);
    if (e.startBillerId) world.account(e, e.startBillerId);
    idp?.resetTenant(e.id); world.persist(e);
    return e;
  }

  await new Promise(r => publicServer.listen(port, host, r));
  if (idp) { await idp.listen(); idp.formTargets = [`http://${host}:${port || '*'}`, 'http://127.0.0.1:*', 'http://localhost:*']; }
  await new Promise(r => adminServer.listen(adminPort, '127.0.0.1', r));
  publicServer.baseUrl = `http://${host}:${publicServer.address().port}`;
  suffix = `_${publicServer.address().port}`;
  const adminUrl = `http://127.0.0.1:${adminServer.address().port}`;
  const admin = async (path, body) => { const r = await fetch(adminUrl + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) throw Object.assign(new Error(j.error), { status: r.status, code: j.code }); return j; };
  return { world, templateFor, baseUrl: publicServer.baseUrl, adminUrl, adminToken, admin, templates, urlFor, googleUrl: idp?.issuer || null, idp, rp, close: () => Promise.all([new Promise(r => publicServer.close(r)), new Promise(r => adminServer.close(r)), idp ? idp.close() : null]), publicServer, adminServer };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // BILLWORLD_FLEET_ADMIN pins the admin token across restarts. A generated token is written to a 0600 file, never to stdout,
  // so harnesses that pipe server output to agents cannot leak the grader credential.
  // BILLWORLD_FLEET_OPEN_WORLD=0 disables automatic demo episodes (benchmark mode: only /enter links start episodes).
  const dataDir = process.env.BILLWORLD_FLEET_DATA || `${here}/../data/fleet`;
  const envToken = process.env.BILLWORLD_FLEET_ADMIN || undefined;
  const s = await start({ port: Number(process.env.PORT || 3200), adminPort: Number(process.env.ADMIN_PORT || 3201), googlePort: Number(process.env.GOOGLE_PORT || 3202), dataDir, adminToken: envToken, openWorld: !['0', 'false', 'no'].includes(String(process.env.BILLWORLD_FLEET_OPEN_WORLD || '').toLowerCase()) });
  console.log(`Billworld Fleet ${FLEET_REVISION}: ${s.world.catalog.billers.size} billers, ${s.templates.size} templates`);
  console.log(`Directory: ${s.baseUrl}/   Mailbox: ${s.baseUrl}/mail   Phone: ${s.baseUrl}/sms   Admin: ${s.adminUrl}   Mock Google: ${s.googleUrl}`);
  if (envToken) console.log('Admin token: from BILLWORLD_FLEET_ADMIN');
  else { mkdirSync(dataDir, { recursive: true }); const file = `${dataDir}/admin-token`; writeFileSync(file, s.adminToken + '\n', { mode: 0o600 }); chmodSync(file, 0o600); console.log(`Admin token: generated, written to ${file} (set BILLWORLD_FLEET_ADMIN to pin it)`); }
}
