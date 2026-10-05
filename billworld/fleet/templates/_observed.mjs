// Per-biller fidelity from research captures (biller.profile, see catalog.mjs PROFILE CONTRACT).
// Shared by the builder-3 templates (offline, waste-hauler, telecom, streaming, newspaper, card-servicer,
// bank-billpay, loan-servicer, insurance, rent-portal, invoice-portal, dmv, toll-account).
// Every profile field is optional; everything rendered goes through kit's escaping html``.
// Nothing here creates a route: observed nav labels either map onto the template's canonical pages or render
// as plain text, so the simulation never shows a dead link.
import * as kit from '../kit.mjs';
import { loadCatalog } from '../catalog.mjs';
const { html, raw, esc } = kit;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', reg: '®', trade: '™', copy: '©', hellip: '…' };
const decode = s => String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? (() => { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 31 && n < 0x10ffff ? String.fromCodePoint(n) : ' '; })() : ENT[e.toLowerCase()] ?? m);
// Plain, single-line text: entities decoded once (kit re-escapes on output), control chars and tags dropped.
export const clean = (s, max = 120) => {
  const t = decode(String(s ?? '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : t;
};
// Titles/headings that describe the capture rather than the biller (bot walls, errors, consent banners).
const JUNK_EXACT = /^(?:(?:home)+|home ?page|welcome|menu|search|main navigation|navigation|showcase|slideshow|carousel|latest news|news|news (?:&|and) (?:events|updates)|announcements?|quick ?links|useful links|resources|our services|services|our mission|mission|about|about us|contact|contact us|events|calendar|alerts?|featured|highlights|terms (?:&|and) conditions(?: page)?|privacy(?: policy)?|sitemap|welcome to|index|default|loading|untitled|new tab|log ?in|sign ?in|log ?on|redirect(?:ing)?|object moved|document)\W*$/i;
const JUNK_ANY = /^(?:404|403|500|502|503)\b|\b(?:page not found|not found|access denied|forbidden|just a moment|attention required|are you a robot|request rejected|site (?:is )?(?:under )?maintenance|scheduled maintenance|service unavailable|temporarily unavailable|bad gateway|internal server error|oops|something went wrong|an error (?:has )?occurred|error occurred|try again later|we.re sorry|technical difficulties|no longer available|session (?:has )?(?:expired|timed out)|unsupported browser|update your browser|page (?:you (?:are|were|.re) looking for|you requested|cannot be (?:found|displayed)|can.t be found|could not be found|does not exist|doesn.t exist|is unavailable|has (?:been )?moved))\b|cloudflare|incapsula|captcha|enable javascript|javascript (?:is )?(?:required|disabled)|we use cookies|cookies? (?:policy|settings|consent)|browser (?:is )?not supported|can.t be reached|pardon our interruption|time for an update|update (?:your )?browser|action required|data tokens|access to this page has been denied|verify you are (?:a )?human|checking your browser/i;
const usable = (s, max, { words = 1 } = {}) => { const t = clean(s, max).replace(/^(?:home|welcome)\s*[|\-–—:»]\s*/i, '').replace(/\s+(?:home ?page|homepage)$/i, ''); return t && t.length >= 3 && t.split(/\s+/).length >= words && !/^[\W\d]/.test(t) && !/^[^,]{0,25},\s*[A-Z]{2}$/.test(t) && !JUNK_EXACT.test(t) && !JUNK_ANY.test(t) ? t : ''; };
// Contact details inside captured text must not compete with the simulation's own (help-phone and offline tasks
// grade the catalog phone/address): phone numbers other than the biller's, e-mail addresses, URLs and P.O. boxes
// are replaced with a pointer to the simulated Contact page.
const digits = s => String(s || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
function redact(text, vm) {
  const own = new Set(String([vm?.biller?.phone, vm?.biller?.payPhone].filter(Boolean).join(';')).match(PHONE_RE)?.map(digits) || []);
  return String(text || '')
    .replace(/\bhttps?:\/\/\S+|\bwww\.[a-z0-9.-]+\.[a-z]{2,}\S*/gi, '(see this site)')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '(see Contact us)')
    .replace(PHONE_RE, m => own.has(digits(m)) ? m : '(see Contact us)')
    .replace(/\bP\.?\s?O\.?\s*Box\s+[\w-]+(?:[^.;\n]{0,60}\b\d{5}(?:-\d{4})?)?/gi, '(mailing address: see Contact us)');
}

function rawProfile(vm) {
  if (vm.profile !== undefined) return vm.profile;
  if (vm.biller?.profile !== undefined) return vm.biller.profile;
  try { return loadCatalog().billers.get(vm.biller?.id)?.profile ?? null; } catch { return null; }
}

// ---------- theme color ----------
function parseColor(c) {
  const s = String(c || '').trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,4})$/); if (m) return [...m[1].slice(0, 3)].map(h => parseInt(h + h, 16));
  m = s.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/); if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = s.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/); if (m) return m.slice(1, 4).map(Number).map(n => Math.min(255, n));
  return null;
}
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = rgb => '#' + rgb.map(n => Math.round(n).toString(16).padStart(2, '0')).join('');
// Templates put white text on --brand, so the brand must reach 4.5:1 against white. Light theme colors are
// darkened (same hue) until they do; near-white "theme" colors carry no brand information and are ignored.
export function brandColor(theme) {
  const rgb = parseColor(theme); if (!rgb) return null;
  if (lum(rgb) > 0.8) return null;
  const white = [255, 255, 255];
  let c = rgb;
  for (let i = 0; i < 40 && contrast(c, white) < 4.5; i++) c = c.map(v => v * 0.92);
  return contrast(c, white) >= 4.5 ? hex(c) : null;
}

// ---------- normalized view of the profile ----------
const NAV_SKIP = /^(?:skip\b.*|menu\b.*|close\b.*|search\b.*|toggle\b.*|open (?:menu|search|navigation)\b.*|opens? a dialog.*|open|main menu|navigation|more|back|top|back to top|english|español|espanol|translate|select language|language|x|×|\W+|\d+)$/i;
const list = (a, max, len = 40) => { const seen = new Set(); const out = []; for (const v of Array.isArray(a) ? a : []) { const t = clean(v, len + 1); if (!t || t.length > len || NAV_SKIP.test(t) || seen.has(t.toLowerCase())) continue; seen.add(t.toLowerCase()); out.push(t); if (out.length >= max) break; } return out; };
export function normalize(p, vm = null) {
  if (!p || typeof p !== 'object') return null;
  const w = p.website || {}, l = p.login || {};
  const help = (Array.isArray(p.help) ? p.help : []).map(h => ({ kind: String(h?.kind || ''), title: usable(h?.title, 100), headings: list(h?.headings, 6, 80).filter(x => !JUNK_ANY.test(x)).map(x => redact(x, vm)), excerpt: redact(clean(h?.excerpt, 600), vm) })).filter(h => !JUNK_ANY.test(`${h.excerpt} ${h.title}`) && (h.excerpt.length >= 40 || h.headings.length));
  const o = {
    title: redact(usable(w.title, 110), vm), description: JUNK_ANY.test(w.description || '') ? '' : redact(clean(w.description, 200), vm), theme: brandColor(w.themeColor), hero: redact(usable(w.heroHeading, 110, { words: 2 }), vm),
    nav: list(w.navLabels, 8), footer: list(w.footerLabels, 8),
    loginTitle: redact(usable(l.title, 110), vm), fields: (Array.isArray(l.fields) ? l.fields : []).map(f => String(f).toLowerCase()),
    buttons: list(l.buttons, 6, 30), social: (Array.isArray(l.socialProviders) ? l.socialProviders : []).map(s => String(s).toLowerCase()), help
  };
  return o.title || o.hero || o.nav.length || o.theme || o.fields.length || o.buttons.length || help.length || o.footer.length ? o : null;
}

// Returns a view model carrying vm.obs (normalized profile or null). Brand objects are copied, never mutated:
// vm.biller.brand is the shared catalog object.
export function observe(vm) {
  if (vm.obs !== undefined) return vm;
  const obs = normalize(rawProfile(vm), vm);
  if (!obs) return Object.assign(vm, { obs: null });
  const out = { ...vm, obs };
  if (obs.theme) out.biller = { ...vm.biller, brand: { ...vm.biller.brand, primary: obs.theme } };
  return out;
}

// ---------- mapping observed labels onto canonical pages ----------
const sup = (vm, k) => vm.biller.capabilities?.[k]?.support === 'supported';
const offline = vm => vm.template === 'offline' || vm.biller.capabilities?.online_account?.support === 'unsupported';
const helpSlug = (vm, slug) => vm.help?.some(a => a.slug === slug) ? vm.url('helpArticle', { slug }) : vm.url('help');
export function mapLabel(vm, label) {
  const l = label.toLowerCase();
  const has = p => typeof vm.has === 'function' ? vm.has(p) : false;
  const acct = (p, slug) => offline(vm) ? helpSlug(vm, slug) : has(p) ? vm.url(p) : null;
  if (/\bhome\b/.test(l) && l.length <= 12) return vm.url('home');
  if (/auto ?pay|automatic (?:bill )?pay|recurring pay|auto-?draft/.test(l)) return acct('autopay', 'autopay');
  if (/paperless|e-?bill|e-?statement|go green|electronic (?:bill|statement)/.test(l)) return acct('paperless', 'paperless');
  if (/contact|customer (?:service|care|support)|call us|get in touch|locations?\b|office/.test(l)) return helpSlug(vm, 'contact-us');
  if (/\bhelp\b|faq|support|questions|how (?:do|to)/.test(l)) return vm.url('help');
  if (/register|sign ?up|create (?:an )?account|enroll|new user|first.time/.test(l)) return offline(vm) ? helpSlug(vm, 'register') : has('register') && !vm.authenticated ? vm.url('register') : null;
  if (/\bpay\b|payments?\b|pay ?(?:my|your|a|online)|quick ?pay|one.time/.test(l)) {
    if (offline(vm)) return helpSlug(vm, 'pay-your-bill');
    if (!vm.authenticated && has('guest') && sup(vm, 'guest_pay') && /quick|guest|one.time|express/.test(l)) return vm.url('guest');
    return has('pay') ? vm.url('pay') : null;
  }
  if (/\bbills?\b|billing|statements?|invoices?|account summary|balance/.test(l)) return acct('bill', 'view-your-bill');
  if (/log ?in|sign ?in|log ?on|sign ?on|my account|account (?:log ?in|access)|online (?:account|services|portal)|customer portal/.test(l)) return offline(vm) ? vm.url('help') : vm.authenticated ? (has('dashboard') ? vm.url('dashboard') : null) : has('login') ? vm.url('login') : null;
  return null;
}
const navItem = (vm, label) => { const href = mapLabel(vm, label); return href ? html`<a href="${href}">${label}</a>` : html`<span class="obs-plain" title="Not part of this simulation">${label}</span>`; };

// The real site's top-level navigation, shown on public (signed-out) pages under the template header.
export const obsNav = vm => vm.obs?.nav?.length && !vm.authenticated ? html`<nav class="obs-nav" aria-label="${vm.biller.brand.shortName} site"><div class="obs-in">${vm.obs.nav.map(l => navItem(vm, l))}</div></nav>` : '';
// Footer labels as one line of mapped links / plain text.
export const obsFooter = vm => vm.obs?.footer?.length ? html`<p class="obs-foot">${vm.obs.footer.map((l, i) => html`${i ? ' · ' : ''}${navItem(vm, l)}`)}</p>` : '';
// Hero heading from the biller's public homepage (or the given fallback).
export const heroText = (vm, fallback) => vm.obs?.hero || fallback;
export const heroLine = (vm, cls = 'obs-hero') => vm.obs?.hero ? html`<p class="${cls}">${vm.obs.hero}</p>` : '';

// ---------- login ----------
const ID_LABEL = { email: 'Email address', username: 'Username or email', userid: 'User ID or email', user: 'Username or email', account: 'Account number or email', accountnumber: 'Account number or email' };
// Label for the standard `username` field, following the identifier the real login page asked for.
export function idLabel(vm, fallback) {
  const f = vm.obs?.fields?.find(x => x !== 'password' && ID_LABEL[x.replace(/[^a-z]/g, '')]);
  return f ? ID_LABEL[f.replace(/[^a-z]/g, '')] : fallback;
}
// Submit label observed on the real login page, if it is a plain sign-in verb. step: 'single' (one-page login),
// 'next' (first page of a two-step login) or 'final' (password page of a two-step login).
const SUBMIT = { single: /^(?:secure )?(?:log ?in|log ?on|sign ?in|sign on|login|logon|continue|submit|go)(?: now| securely)?$/i, next: /^(?:continue|next)$/i, final: /^(?:secure )?(?:log ?in|log ?on|sign ?in|sign on|login|logon)(?: now| securely)?$/i };
export function submitLabel(vm, fallback, step = 'single') {
  const re = SUBMIT[step] || SUBMIT.single;
  const b = vm.obs?.buttons?.find(x => re.test(x) && !/google|apple|facebook|microsoft|guest|register|create|sign ?up/i.test(x));
  return b || fallback;
}
// Social sign-in buttons: only when the server says the provider exists (vm.socialProviders) and kit renders it.
export const social = vm => typeof kit.socialButtons === 'function' && Array.isArray(vm.socialProviders) && vm.socialProviders.includes('google') ? raw(String(kit.socialButtons(vm) ?? '')) : '';

// ---------- help ----------
const KIND_SLUG = { pay_bill: 'pay-your-bill', pay: 'pay-your-bill', ways_to_pay: 'pay-your-bill', view_bill: 'view-your-bill', bill: 'view-your-bill', billing_history: 'billing-history', statements_history: 'billing-history', statements: 'billing-history', autopay_setup: 'autopay', autopay: 'autopay', autopay_cancel: 'cancel-autopay', paperless: 'paperless', ebill: 'paperless', scheduled: 'scheduled-payments', password_reset: 'reset-password', forgot_password: 'reset-password', reset_password: 'reset-password', register: 'register', registration: 'register', cancel_service: 'cancel-service', cancel: 'cancel-service', stop_service: 'cancel-service', assistance: 'payment-assistance', payment_assistance: 'payment-assistance', contact: 'contact-us', contact_us: 'contact-us', faq: 'faq' };
const slugFor = kind => KIND_SLUG[String(kind).toLowerCase()] || null;
const excerptBlock = (vm, h, tag = 'h3') => html`<div class="obs-ex">${h.title ? raw(`<${tag}>${esc(h.title)}</${tag}>`) : ''}${h.excerpt ? html`<blockquote><p>${h.excerpt}</p></blockquote>` : ''}${!h.excerpt && h.headings.length ? html`<ul>${h.headings.map(x => html`<li>${x}</li>`)}</ul>` : ''}</div>`;
const NOTE = vm => html`<p class="obs-note">Text captured from ${vm.biller.brand.shortName}'s public website. Phone numbers, links and steps there may differ from this simulation.</p>`;
// Help center home: every observed help excerpt, with a link to the matching simulated article when there is one.
export const helpExcerpts = vm => {
  const items = vm.obs?.help || []; if (!items.length) return '';
  return html`<section class="obs-help" aria-labelledby="obs-help-h"><h2 id="obs-help-h">From the ${vm.biller.brand.shortName} website</h2>${items.slice(0, 6).map(h => { const s = slugFor(h.kind); const ok = s && vm.help?.some(a => a.slug === s); return html`${excerptBlock(vm, h)}${ok ? html`<p class="obs-more"><a href="${vm.url('helpArticle', { slug: s })}">Read the help article</a></p>` : ''}`; })}${NOTE(vm)}</section>`;
};
// One help article: observed excerpts for the same topic.
export const articleExcerpt = vm => {
  const slug = vm.article?.slug; const items = (vm.obs?.help || []).filter(h => slug && slugFor(h.kind) === slug);
  return items.length ? html`<aside class="obs-help" aria-label="From the ${vm.biller.brand.shortName} website"><h2>On the ${vm.biller.brand.shortName} website</h2>${items.slice(0, 2).map(h => excerptBlock(vm, h))}${NOTE(vm)}</aside>` : '';
};

// ---------- document head ----------
// Applied to the rendered page: the real site title on the home page, the real login title on the login page,
// plus theme-color/description metas. Leaves every other page untouched.
export function finish(vm, out) {
  const o = vm.obs; if (!o || typeof out !== 'string') return out;
  let s = out;
  const title = vm.page === 'home' && !vm.authenticated ? o.title : vm.page === 'login' && !vm.authenticated ? o.loginTitle : '';
  if (title) s = s.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`);
  const metas = (o.theme ? `<meta name="theme-color" content="${esc(o.theme)}">` : '') + (vm.page === 'home' && o.description ? `<meta name="description" content="${esc(o.description)}">` : '');
  return metas ? s.replace('</head>', () => metas + '</head>') : s;
}

// Styles for the pieces above, appended to each template's own css. Uses the template's --brand.
export const OBS_CSS = `.obs-nav{background:#f4f5f7;border-bottom:1px solid #d9dce1;font-size:14px}.obs-nav .obs-in{max-width:1180px;margin:0 auto;padding:6px 16px;display:flex;flex-wrap:wrap;gap:4px 18px;align-items:center;min-width:0}.obs-nav a{color:var(--brand);text-decoration:none;font-weight:600;padding:4px 0;overflow-wrap:anywhere}.obs-nav a:hover{text-decoration:underline}.obs-nav a:focus-visible,.obs-foot a:focus-visible,.obs-more a:focus-visible{outline:2px solid var(--brand);outline-offset:2px}.obs-plain{color:#4a5260;padding:4px 0;overflow-wrap:anywhere}.obs-hero{font-size:1.1em;font-weight:600;margin:.25em 0 .75em;overflow-wrap:anywhere}.obs-foot{font-size:13px;margin:.5em 0;overflow-wrap:anywhere}.obs-foot .obs-plain{color:inherit;padding:0}.obs-help{border:1px solid #d9dce1;border-radius:6px;padding:12px 16px;margin:18px 0;background:#fafbfc;color:#1f2933;max-width:100%;overflow-wrap:anywhere}.obs-help h2{font-size:1.1em;margin:0 0 .5em}.obs-help h3{font-size:1em;margin:.75em 0 .25em}.obs-help blockquote{margin:.25em 0;padding:0 0 0 12px;border-left:3px solid var(--brand)}.obs-help blockquote p{margin:.25em 0}.obs-note{font-size:12px;color:#4a5260;margin:.75em 0 0}.obs-more{margin:.25em 0 .5em;font-size:14px}.obs-more a{color:var(--brand)}.obs-resend{margin:14px 0 0;font-size:14px;display:flex;flex-wrap:wrap;align-items:center;gap:6px}form.obs-resend button.obs-resend-btn{background:none;border:0;padding:4px 0;color:var(--brand);font:inherit;font-weight:600;text-decoration:underline;cursor:pointer}form.obs-resend button.obs-resend-btn:focus-visible{outline:2px solid var(--brand);outline-offset:2px}`;

// ---------- MFA page helpers ----------
// Lead sentence that follows the channel the code actually went to (vm.mfaChannel: 'email' | 'sms').
export const mfaLead = (vm, emailText) => vm.mfaChannel === 'sms' ? `We texted a 6-digit code to ${vm.mfaDestination || 'the mobile number on your account'}. Enter it below to continue.` : emailText;
// "Send a new code" control (server act(): mfa op=resend). A separate form so the code form stays unchanged.
export const mfaResend = vm => kit.form(vm, 'mfa', html`${kit.hidden('op', 'resend')}${kit.hidden('next', vm.query?.next || '')}<span class="obs-resend-q">Didn't get a code?</span> ${kit.button('Send a new code', { cls: 'obs-resend-btn' })}`, { cls: 'obs-resend' });
