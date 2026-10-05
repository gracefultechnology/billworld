// Per-biller real-site profile pieces shared by the mychart, patient-pay, health-plan, municipal-portal,
// property-tax, income-tax and utility-account templates.
// biller.profile (catalog.mjs, from research captures) may be null and every field in it is optional. Everything
// that reaches a page is cleaned, length-capped and HTML-escaped by the kit's html tag. Real URLs are never rendered.
import * as kit from '../kit.mjs';
import { loadCatalog } from '../catalog.mjs';
const { html, raw } = kit;

// ---------- profile access ----------
export function profileOf(vm) {
  const b = vm?.biller; if (!b) return null;
  if (b.profile !== undefined) return b.profile || null;
  if (vm.profile !== undefined) return vm.profile || null;
  try { return loadCatalog().billers.get(b.id)?.profile || null; } catch { return null; }
}
const arr = v => Array.isArray(v) ? v : [];

// ---------- text hygiene ----------
// Research vocabulary and markup must never surface; captured text with URLs, code or entities is dropped.
const LEAK = /\b(documented_link|documented_notes|inferred_family|inferred_category|synthetic_flow|no_public_website|consolidated_billing|not_observed|route_candidates?|discovered_route|research-data|catalog\.sqlite|catalog-index|body_file|final_url|script_urls|source_urls?|sourceUrl|meta\.evidence|observed_public)\b/i;
const CODE = /https?:\/\/|www\.|[<>{}\\]|\b(undefined|null|NaN|function|javascript|var |const |return )\b|&[a-z#0-9]+;|\$\{/i;
const ENT = { amp: '&', nbsp: ' ', quot: '"', apos: "'", '#39': "'", lt: '<', gt: '>', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
// Long captured prose (help excerpts): tags and URLs are removed rather than rejecting the whole excerpt.
export function cleanProse(value, max = 600) {
  const t = String(value ?? '').replace(/<[^>]{0,200}>/g, ' ').replace(/&(#39|[a-z]+);/gi, (m, e) => ENT[e.toLowerCase()] ?? ' ')
    .replace(/[<>]/g, ' ').split(/(?<=[.!?])\s+/).filter(x => !/https?:\/\/|www\.|\S+@\S+\.\w/i.test(x)).join(' ');
  let out = cleanText(t, max);
  // End on a full sentence when the capture cut one off (e.g. a removed email address).
  if (out && !/[.!?)"”]$/.test(out)) { const i = Math.max(out.lastIndexOf('. '), out.lastIndexOf('! '), out.lastIndexOf('? ')); if (i >= 39) out = out.slice(0, i + 1); }
  return out;
}
export function cleanText(value, max = 80) {
  let t = String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || CODE.test(t) || LEAK.test(t)) return '';
  if (t.length > max) { const cut = t.slice(0, max - 1); t = (cut.lastIndexOf(' ') > max * 0.6 ? cut.slice(0, cut.lastIndexOf(' ')) : cut).replace(/[\s,;:.-]+$/, '') + '…'; }
  return t;
}
// Titles of block pages, bot walls and errors are not the real site's title.
const JUNK = /^(home|index|untitled|login|log ?in|sign ?in|welcome|loading\.*|redirecting\.*|document|page)$|just a moment|attention required|access denied|forbidden|not found|\b40[0-9]\b|\b50[0-9]\b|error|cloudflare|captcha|are you a robot|request rejected|site maintenance|under construction|incapsula|unsupported browser|\blogo\b|parked domain|domain (?:is )?for sale|custom domain|\bbitly\b|godaddy|this domain|google drive|instagram|facebook|linkedin|youtube/i;
const okTitle = (t, max) => { const c = cleanText(t, max); return c && !JUNK.test(c) && /[a-z]/i.test(c) ? c : ''; };

export const siteTitle = vm => okTitle(profileOf(vm)?.website?.title, 90);
// A login capture's title is used only when it reads as this biller's sign-in page (not the home page, and not a
// third-party sign-in such as a Google or Microsoft account page).
const THIRD_PARTY = /\b(google|gmail|drive|facebook|microsoft|outlook|office 365|azure|apple id|okta|auth0|onelogin|ping ?identity|salesforce|wix|squarespace|wordpress)\b/i;
export function loginTitle(vm) {
  const t = okTitle(profileOf(vm)?.login?.title, 90);
  if (!t || THIRD_PARTY.test(t) || t === siteTitle(vm)) return '';
  return /log ?in|log ?on|sign ?in|sign ?on|account|portal|pay|member|patient|customer|authentication/i.test(t) ? t : '';
}
export function heroText(vm) {
  const h = okTitle(profileOf(vm)?.website?.heroHeading, 110);
  if (!h || h.length < 12 || h.split(' ').length < 2 || /cookie|javascript|browser/i.test(h)) return '';
  const lower = h.toLowerCase();
  return [vm.biller.name, vm.biller.brand?.shortName, siteTitle(vm)].some(n => String(n || '').toLowerCase() === lower) ? '' : h;
}
// The real page title for the public home and login pages; templates keep their own titles elsewhere.
export function profileDocTitle(vm) {
  if (vm.authenticated) return '';
  if (vm.page === 'home') return siteTitle(vm);
  if (vm.page === 'login' || vm.page === 'loginPassword') return loginTitle(vm);
  return '';
}

// ---------- theme color ----------
function parseColor(v) {
  const s = String(v ?? '').trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) { const h = m[1].length <= 4 ? m[1].replace(/./g, c => c + c) : m[1]; if (h.length === 8 && parseInt(h.slice(6), 16) < 0xe6) return null; return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
  m = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+)\s*)?\)$/);
  if (m && (m[4] == null || Number(m[4]) >= 0.9)) { const c = [m[1], m[2], m[3]].map(Number); if (c.every(x => x <= 255)) return c; }
  return null;
}
const lum = c => { const [r, g, b] = c.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = c => '#' + c.map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
// The brand color is used as a background under white text and as link/heading color on white, so it must reach
// 4.5:1 against white. Darker variants of the real color are used when needed; pale or neutral grey colors
// (usually a page background, not the brand) are ignored.
export function themeColor(vm) {
  const c = parseColor(profileOf(vm)?.website?.themeColor);
  if (!c) return null;
  if (lum(c) > 0.45) return null;
  const sat = Math.max(...c) - Math.min(...c);
  if (sat < 24) return null;
  let out = c;
  for (let i = 0; i < 40 && contrast(out, [255, 255, 255]) < 4.6; i++) out = out.map(x => x * 0.94);
  return contrast(out, [255, 255, 255]) >= 4.5 ? hex(out) : null;
}

// ---------- view model ----------
// Public pages take the real site's theme color; signed-in pages keep the portal palette. The original brand
// colors stay available as vm.portalBrand.
export function applyProfile(vm) {
  if (!vm?.biller || vm.authenticated) return vm;
  const theme = themeColor(vm);
  if (!theme) return vm;
  return { ...vm, portalBrand: vm.biller.brand, biller: { ...vm.biller, brand: { ...vm.biller.brand, primary: theme } } };
}

// ---------- real-site navigation ----------
// Labels that mean a billing task map to this template's canonical routes; anything else links to the help
// search with a notice that the section is not part of the simulation (never a dead link).
const NAV_RULES = [
  [/^(home|home ?page|main|back to home ?page)$/i, 'home'],
  [/auto ?pay|automatic (bill )?pay|recurring pay|auto-?draft|bank draft/i, 'autopay'],
  [/paperless|e-?bill|e-?statement|go green|electronic (bill|statement)/i, 'paperless'],
  [/guest ?pay|pay as (a )?guest|quick ?pay|one[- ]time pay|express pay/i, 'guest'],
  [/\bpay\b|\bpayments?\b|bill ?pay|pay(ing)? (my|your|a) bill|make a payment|pay online|pay now|pay taxes?/i, 'pay'],
  [/\b(my )?bill(s|ing)?\b|\bstatements?\b|\binvoices?\b|\btax bills?\b/i, 'bill'],
  [/\bcontact\b|\bcall us\b/i, 'contact'],
  [/\bfaqs?\b|\bhelp\b|\bsupport\b|questions|customer (service|care)/i, 'help'],
  [/sign ?up|register|enroll|create (an |your )?account|new user|activate/i, 'register'],
  [/log ?in|log ?on|sign ?in|sign ?on|my ?account|account login|\bportal\b|mychart|online services/i, 'login']
];
export const navKind = label => NAV_RULES.find(([re]) => re.test(label))?.[1] || null;
const cap = (vm, c) => vm.biller.capabilities?.[c]?.support === 'supported';
const isOffline = vm => vm.biller.capabilities?.online_account?.support !== 'supported' && vm.biller.capabilities?.online_account?.support !== 'unknown';
const article = (vm, slug) => (vm.help || []).some(a => a.slug === slug) ? vm.url('helpArticle', { slug }) : null;
export const naUrl = (vm, label) => vm.url('helpSearch', {}, { q: label, na: '1' });
function navTarget(vm, kind, label) {
  const off = isOffline(vm) || !vm.has('login');
  switch (kind) {
    case 'home': return vm.url(vm.authenticated && vm.has('dashboard') ? 'dashboard' : 'home');
    case 'help': return vm.url('help');
    case 'contact': return vm.authenticated && vm.has('contact') ? vm.url('contact') : article(vm, 'contact-us') || vm.url('help');
    case 'guest': return !off && cap(vm, 'guest_pay') && vm.has('guest') ? vm.url('guest') : off ? article(vm, 'pay-your-bill') || vm.url('help') : vm.url('pay');
    case 'pay': return off ? article(vm, 'pay-your-bill') || vm.url('help') : vm.url('pay');
    case 'bill': return off ? article(vm, 'pay-your-bill') || vm.url('help') : vm.url(vm.has('bill') ? 'bill' : 'pay');
    case 'autopay': return !off && cap(vm, 'autopay') && vm.has('autopay') ? vm.url('autopay') : article(vm, 'autopay') || naUrl(vm, label);
    case 'paperless': return !off && cap(vm, 'paperless') && vm.has('paperless') ? vm.url('paperless') : article(vm, 'paperless') || naUrl(vm, label);
    case 'register': return off ? article(vm, 'pay-your-bill') || vm.url('help') : vm.url(vm.authenticated ? 'profile' : 'register');
    case 'login': return off ? article(vm, 'pay-your-bill') || vm.url('help') : vm.url(vm.authenticated && vm.has('dashboard') ? 'dashboard' : 'login');
    default: return naUrl(vm, label);
  }
}
// Icon alt text, menu toggles and logo links are not navigation labels.
const NAV_JUNK = /^(menu|main menu|search|close|skip|toggle|open|more|x|×|☰|english|español|translate|select language|back|next|previous|cancel|submit|go|facebook|instagram|youtube|twitter|x|linkedin|tiktok|pinterest|nextdoor|flickr|vimeo|rss|print|share|email|google translate)$|\b(icon|hamburger|close search|open search|toggle|skip to|logo|navigation)\b/i;
export function navItems(vm, { max = 12 } = {}) {
  const seen = new Set(), out = [];
  const orgNames = [vm.biller.name, vm.biller.brand?.shortName].map(n => String(n || '').toLowerCase().trim()).filter(n => n.length > 3);
  for (const raw0 of arr(profileOf(vm)?.website?.navLabels)) {
    const label = cleanText(raw0, 32);
    if (!label || label.length < 2 || !/[a-z]/i.test(label) || NAV_JUNK.test(label) || /\b[a-z]{14,}\b/.test(label) || /^[a-z]+ \d+$/i.test(label)) continue;
    if (orgNames.some(n => n && (label.toLowerCase() === n || (label.split(' ').length > 2 && label.toLowerCase().includes(n))))) continue;
    const k = label.toLowerCase(); if (seen.has(k)) continue; seen.add(k);
    const kind = navKind(label);
    out.push({ label, kind, href: navTarget(vm, kind, label), mapped: !!kind });
    if (out.length >= max) break;
  }
  return out;
}
// A row of the real site's top-level navigation. Shown on public pages only.
export function siteNav(vm, { cls = '' } = {}) {
  if (vm.authenticated) return '';
  const items = navItems(vm);
  if (!items.length) return '';
  return html`<nav class="pf-nav ${cls}" aria-label="${vm.biller.brand.shortName} website"><ul>${items.map(i => html`<li><a href="${i.href}"${i.mapped ? '' : raw(' data-sim="not-available"')}>${i.label}</a></li>`)}</ul></nav>`;
}
// Help-search pages reached from an unmapped real-site section explain why the section is missing.
export function naNotice(vm) {
  if (!vm.query?.na) return '';
  const label = cleanText(vm.query.q, 40);
  return html`<div class="pf-na" role="note"><p><strong>${label ? `“${label}”` : 'This section'}</strong> is part of the ${vm.biller.brand.shortName} website but is not available in this billing simulation. The billing help topics below may still answer your question.</p></div>`;
}

// ---------- hero ----------
export function heroBanner(vm, { cls = '' } = {}) {
  const h = heroText(vm); if (!h || vm.authenticated) return '';
  return html`<p class="pf-hero ${cls}">${h}</p>`;
}

// ---------- login ----------
const SUBMIT = /^(log ?in|log ?on|sign ?in|sign ?on|continue|next|submit|go|login to [a-z ]+|sign in to [a-z ]+|log in to [a-z ]+)$/i;
export function loginProfile(vm) {
  const l = profileOf(vm)?.login || {};
  const fields = arr(l.fields).map(f => String(f).toLowerCase());
  const userLabel = fields.includes('username') ? null : fields.includes('email') ? 'Email address' : fields.includes('account') ? 'Account number' : null;
  const userHelp = userLabel === 'Account number' ? 'Or the email address on your account' : userLabel === 'Email address' ? 'The email address on your account' : null;
  const submit = arr(l.buttons).map(b => cleanText(b, 24)).find(b => b && SUBMIT.test(b)) || null;
  return { userLabel, userHelp, submit, hasGuestPay: l.hasGuestPay === true };
}
export const socialProviders = vm => arr(vm.socialProviders ?? profileOf(vm)?.login?.socialProviders).map(p => String(p).toLowerCase());
// Rendered only when the real login page offered Google and the kit provides the shared social control.
export function socialBlock(vm) {
  const providers = socialProviders(vm);
  if (!providers.includes('google') || typeof kit.socialButtons !== 'function') return '';
  const out = kit.socialButtons({ ...vm, socialProviders: providers });
  return out ? html`<div class="pf-social">${out instanceof kit.Raw ? out : raw(String(out))}</div>` : '';
}

// ---------- help excerpts ----------
const SLUG_KINDS = {
  'pay-your-bill': /^pay_bill$|ways_to_pay/, 'view-your-bill': /^view_bill$/, 'billing-history': /statements_history|history/,
  autopay: /autopay_setup|^autopay$/, 'cancel-autopay': /autopay_cancel/, paperless: /paperless|ebill/, 'scheduled-payments': /schedul/,
  'reset-password': /reset|password|login_help|forgot/, register: /regist|enrol|signup|account_setup/,
  'payment-assistance': /payment_assistance|assist/, 'contact-us': /contact/, faq: /help_center|faq/
};
export function helpEntries(vm, slug = null) {
  const re = slug ? SLUG_KINDS[slug] : null;
  if (slug && !re) return [];
  const out = [];
  for (const h of arr(profileOf(vm)?.help)) {
    if (re && !re.test(String(h?.kind || ''))) continue;
    const excerpt = cleanProse(h?.excerpt, 600); if (!excerpt || excerpt.length < 40 || out.some(o => o.excerpt.includes(excerpt) || excerpt.includes(o.excerpt))) continue;
    out.push({ title: cleanText(h.title, 90) || null, excerpt, headings: arr(h.headings).map(x => cleanText(x, 70)).filter(Boolean).slice(0, 5) });
    if (out.length >= (slug ? 2 : 4)) break;
  }
  return out;
}
// Real excerpts from the organization's public help pages, quoted as text (no links to the real site).
export function helpExcerpts(vm, slug = null, { cls = '' } = {}) {
  const items = helpEntries(vm, slug);
  if (!items.length) return '';
  return html`<section class="pf-src ${cls}" aria-labelledby="pf-src-h"><h2 id="pf-src-h">From the ${vm.biller.brand.shortName} website</h2>${items.map(i => html`<figure class="pf-quote">${i.title ? html`<figcaption>${i.title}</figcaption>` : ''}<blockquote><p>${i.excerpt}</p></blockquote>${i.headings.length ? html`<p class="pf-topics">Topics on that page: ${i.headings.join(' · ')}</p>` : ''}</figure>`)}<p class="pf-note">Quoted from the organization's public help pages for reference.</p></section>`;
}

// Neutral styles; each template's own palette comes through var(--brand) and inherited fonts.
// ---------- MFA page: where the code went (vm.mfaChannel 'sms' | 'email') and a "Resend code" form ----------
// The resend form posts op=resend to the mfa page (server act(): engine.resendMfa supersedes the old code).
export const mfaSent = (vm, emailText) => vm?.mfaChannel === 'sms' ? `We texted a 6-digit code to ${vm.mfaDestination || 'your phone'}. Enter it below. It expires in 10 minutes.` : emailText;
export const mfaResend = (vm, label = 'Resend code') => kit.form(vm, 'mfa', html`${kit.hidden('op', 'resend')}${kit.hidden('next', vm.query?.next || '')}<p class="pf-resend-row">Didn't get it? ${kit.button(label, { cls: 'pf-linkbtn' })}</p>`, { cls: 'pf-resend' });

export const PROFILE_CSS = `.pf-resend{margin:10px 0 0}.pf-resend-row{margin:0;font-size:14px}.pf-linkbtn{border:0;background:none;padding:2px 0;font:inherit;color:inherit;text-decoration:underline;cursor:pointer;font-weight:600}.pf-linkbtn:focus-visible{outline:2px solid currentColor;outline-offset:2px}.pf-nav{min-width:0}.pf-nav ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:2px 4px}.pf-nav li{min-width:0}.pf-nav a{display:inline-block;padding:6px 10px;border-radius:4px;text-decoration:none;font-size:14px;line-height:1.3;overflow-wrap:anywhere}.pf-nav a:hover{text-decoration:underline}.pf-nav a:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.pf-nav-light{background:#fff;border-bottom:1px solid #d9dee4}.pf-nav-light ul{max-width:1180px;margin:0 auto;padding:4px 12px}.pf-nav-light a{color:#1f2a36}.pf-nav-dark a{color:#fff}
.pf-hero{font-size:17px;font-weight:600;color:#33414f;margin:4px 0 12px;overflow-wrap:anywhere}.pf-hero.pf-hero-inv{color:inherit}
.pf-na{border:1px solid #c9d3dd;border-left:4px solid var(--brand);background:#f6f8fa;border-radius:6px;padding:10px 14px;margin:0 0 16px}.pf-na p{margin:0}
.pf-src{margin:18px 0;padding:16px 18px;background:#fff;border:1px solid #d9dee4;border-radius:8px;min-width:0}.pf-src h2{font-size:17px;margin:0 0 10px}.pf-quote{margin:0 0 12px}.pf-quote figcaption{font-weight:600;margin-bottom:4px}.pf-quote blockquote{margin:0;padding:6px 0 6px 14px;border-left:3px solid var(--brand);color:#3b4651;overflow-wrap:anywhere}.pf-quote blockquote p{margin:0}.pf-topics{font-size:13px;color:#5f6b77;margin:6px 0 0}.pf-note{font-size:12px;color:#5f6b77;margin:4px 0 0}
.pf-social{margin:14px 0}
@media(max-width:600px){.pf-nav ul{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:thin;padding-bottom:2px}.pf-nav li{flex:none}.pf-nav a{white-space:nowrap;padding:8px 10px}.mega.pf-real .wrap{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:thin}.mega.pf-real a{flex:none;white-space:nowrap;padding:12px 12px}}`;
