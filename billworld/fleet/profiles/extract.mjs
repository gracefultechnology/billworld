// Page-fact extraction for captured public HTML (research-data/bodies). Dependency-free and tolerant of broken markup:
// a single tag-stack pass records where text and links sit (nav / header / footer / main / form) and what forms contain.
// Output is compact page facts; build-profiles.mjs turns facts into per-biller profiles.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'keygen']);
const BLOCK = new Set(['p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'tr', 'td', 'th', 'dd', 'dt', 'section', 'article', 'table', 'form', 'header', 'footer', 'nav', 'main', 'aside', 'blockquote', 'hr', 'option', 'button', 'select', 'textarea', 'fieldset', 'legend', 'figcaption', 'caption', 'address']);
const HEADING = /^h[1-6]$/;
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', copy: '©', reg: '®', trade: '™', bull: '•', middot: '·', raquo: '»', laquo: '«', eacute: 'é', ntilde: 'ñ', rarr: '→', deg: '°', cent: '¢', pound: '£', euro: '€', sect: '§', para: '¶', times: '×', frac12: '½', aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú', egrave: 'è', agrave: 'à', ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä', shy: '', zwnj: '', zwj: '', lrm: '', rlm: '', ensp: ' ', emsp: ' ', thinsp: ' ', sbquo: '‚', bdquo: '„', dagger: '†', larr: '←', uarr: '↑', darr: '↓', check: '✓' };
export const decode = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : ' '; }
  return NAMED[e.toLowerCase()] ?? NAMED[e] ?? (m.endsWith(';') ? '' : m);
});
const squash = s => s.replace(/[\s ​‌‍﻿]+/g, ' ').trim();
const ATTR_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
function attrsOf(s) {
  const out = {};
  if (!s) return out;
  for (const m of s.matchAll(ATTR_RE)) { const k = m[1].toLowerCase(); if (!(k in out)) out[k] = decode(m[2] ?? m[3] ?? m[4] ?? ''); }
  return out;
}
const cls = a => `${a.class || ''} ${a.id || ''}`.toLowerCase();
const hidden = a => a['aria-hidden'] === 'true' || 'hidden' in a || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.style || '') || /\b(?:sr-only|visually-hidden|screen-reader-text|offscreen|skip-?link)\b/.test(cls(a));
const isNav = (tag, a) => tag === 'nav' || a.role === 'navigation' || (['ul', 'div'].includes(tag) && /(?:^|[\s_-])(?:main-?nav|primary-?nav|navbar|nav-?menu|main-?menu|primary-?menu|top-?menu|menu-?main|site-?nav|global-?nav|mega-?menu)(?:$|[\s_-])/.test(cls(a)));
const isHeader = (tag, a) => tag === 'header' || a.role === 'banner' || (tag === 'div' && /(?:^|[\s_-])(?:site-?header|page-?header|masthead|header)(?:$|\s)/.test(cls(a)));
const isFooter = (tag, a) => tag === 'footer' || a.role === 'contentinfo' || (tag === 'div' && /(?:^|[\s_-])(?:site-?footer|page-?footer|footer)(?:$|\s)/.test(cls(a)));
const isMain = (tag, a) => tag === 'main' || a.role === 'main' || tag === 'article' || (tag === 'div' && /(?:^|[\s_-])(?:main-?content|page-?content|content-?main|entry-?content|maincontent)(?:$|\s)/.test(cls(a)));
const hostOf = u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
const absolute = (href, base) => { try { const u = new URL(href, base); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; } };

// Strip content that never renders as text before tokenizing.
function preclean(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg|template|noscript|object|canvas|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(script|style)\b[^>]*\/>/gi, ' ');
}

export function extractPage(rawHtml, baseUrl, { maxBytes = 1_500_000 } = {}) {
  const html = preclean(String(rawHtml).slice(0, maxBytes));
  const facts = { title: null, description: null, themeColor: null, ogSiteName: null, blocks: [], anchors: [], forms: [], iframes: [], navGroups: [], headings: [] };
  const stack = []; // {tag, nav, header, footer, main, hidden, form, list}
  let navCounter = 0, text = '', titleText = null, inTitle = false;
  let anchor = null, button = null, label = null, form = null;
  const ctx = () => stack[stack.length - 1] || { nav: 0, header: false, footer: false, main: false, hidden: false, list: 0, navId: -1 };
  const flush = (tag) => {
    const t = squash(text); text = '';
    if (!t) return;
    const c = ctx();
    if (c.hidden) return;
    const block = { t, h: HEADING.test(tag) ? Number(tag[1]) : 0, z: c.nav ? 'nav' : c.footer ? 'footer' : c.header ? 'header' : c.form ? 'form' : c.main ? 'main' : 'body' };
    if (facts.blocks.length < 600) facts.blocks.push(block);
    if (block.h && facts.headings.length < 40 && block.z !== 'nav' && block.z !== 'footer') facts.headings.push({ level: block.h, text: t.slice(0, 160) });
  };
  const re = /<\/?([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</g;
  for (let m; (m = re.exec(html));) {
    if (m[3] !== undefined || (!m[1] && m[0] === '<')) {
      const s = m[3] ?? '<';
      const d = decode(s);
      if (inTitle) { titleText = (titleText || '') + d; continue; }
      if (ctx().hidden) continue;
      text += d;
      if (anchor) anchor.text += d;
      if (button) button.text += d;
      if (label) label.text += d;
      continue;
    }
    const closing = m[0][1] === '/';
    const tag = m[1].toLowerCase();
    if (tag === 'title') { inTitle = !closing; continue; }
    if (!closing) {
      const a = attrsOf(m[2]);
      if (tag === 'meta') {
        const key = (a.name || a.property || '').toLowerCase();
        if ((key === 'description' || key === 'og:description') && !facts.description) facts.description = squash(a.content || '').slice(0, 400) || null;
        if (key === 'theme-color' && !facts.themeColor && /^#[0-9a-f]{3,8}$|^rgb/i.test(a.content || '')) facts.themeColor = a.content.trim().slice(0, 32);
        if (key === 'og:site_name' && !facts.ogSiteName) facts.ogSiteName = squash(a.content || '').slice(0, 120) || null;
        if (key === 'og:title' && !titleText) titleText = a.content || null;
        continue;
      }
      if (BLOCK.has(tag) || HEADING.test(tag)) flush(''); // text before an opening block belongs to the enclosing block
      if (tag === 'br' || tag === 'hr') continue;
      if (tag === 'input') {
        const target = form || (facts.looseInputs ||= []);
        const type = (a.type || 'text').toLowerCase();
        const rec = { type, name: (a.name || '').slice(0, 60), id: (a.id || '').slice(0, 60), placeholder: (a.placeholder || '').slice(0, 80), autocomplete: (a.autocomplete || '').slice(0, 40), aria: (a['aria-label'] || '').slice(0, 80), value: ['submit', 'button', 'image'].includes(type) ? squash(a.value || a.alt || '').slice(0, 60) : '' };
        if (type !== 'hidden') (form ? form.inputs : target).push(rec);
        continue;
      }
      if (tag === 'img') { const alt = squash(a.alt || ''); if (alt && anchor) anchor.text += ` ${alt}`; if (alt && button) button.text += ` ${alt}`; continue; }
      if (tag === 'iframe' && a.src) { const u = absolute(a.src, baseUrl); if (u && facts.iframes.length < 30) facts.iframes.push(u); }
      if (VOID.has(tag) || m[0].endsWith('/>') && tag !== 'a' && tag !== 'div') { continue; }
      const parent = ctx();
      const frame = { tag, nav: parent.nav, navId: parent.navId, header: parent.header, footer: parent.footer, main: parent.main, hidden: parent.hidden || hidden(a), form: parent.form, list: parent.list };
      if (isNav(tag, a) && !parent.nav) { frame.nav = 1; frame.navId = navCounter++; frame.list = 0; facts.navGroups.push({ id: frame.navId, header: parent.header, footer: parent.footer, cls: cls(a).slice(0, 80) }); }
      else if (isNav(tag, a)) frame.nav = parent.nav + 1;
      if (isHeader(tag, a)) frame.header = true;
      if (isFooter(tag, a)) frame.footer = true;
      if (isMain(tag, a)) frame.main = true;
      if (tag === 'ul' || tag === 'ol') frame.list = parent.list + 1;
      if (tag === 'form') { form = { action: a.action ? absolute(a.action, baseUrl) : null, method: (a.method || 'get').toLowerCase(), id: cls(a).slice(0, 80), inputs: [], buttons: [], labels: [], selects: [] }; if (facts.forms.length < 25) facts.forms.push(form); frame.form = true; }
      if (tag === 'select' && form) form.selects.push((a.name || a.id || '').slice(0, 60));
      if (tag === 'a') {
        if (anchor) closeAnchor();
        anchor = { href: a.href ? absolute(a.href, baseUrl) : null, raw: (a.href || '').slice(0, 20), text: '', aria: squash(a['aria-label'] || a.title || ''), z: frame.nav ? 'nav' : frame.footer ? 'footer' : frame.header ? 'header' : frame.main ? 'main' : 'body', navId: frame.navId, list: frame.list, hidden: frame.hidden, inForm: !!form, cls: cls(a).slice(0, 60) };
      }
      if (tag === 'button') { button = { text: '', aria: squash(a['aria-label'] || ''), type: (a.type || 'submit').toLowerCase(), z: frame.nav ? 'nav' : 'body', navId: frame.navId, list: frame.list, cls: cls(a).slice(0, 60), hidden: frame.hidden }; }
      if (tag === 'label') label = { for: a.for || '', text: '' };
      stack.push(frame);
      if (stack.length > 400) stack.splice(0, stack.length - 400);
    } else {
      if (BLOCK.has(tag) || HEADING.test(tag)) flush(tag);
      if (tag === 'a' && anchor) closeAnchor();
      if (tag === 'button' && button) { const t = squash(button.text) || button.aria; if (t && !button.hidden) { (form ? form.buttons : (facts.looseButtons ||= [])).push(t.slice(0, 60)); if (button.z === 'nav') facts.anchors.push({ href: null, text: t.slice(0, 80), z: 'nav', navId: button.navId, list: button.list, button: true }); } button = null; }
      if (tag === 'label' && label) { const t = squash(label.text); if (form && t) form.labels.push({ for: label.for, text: t.slice(0, 80) }); label = null; }
      // Pop to the matching open tag; ignore stray closers.
      let i = stack.length - 1;
      while (i >= 0 && stack[i].tag !== tag) i--;
      if (i >= 0) { if (stack.slice(i).some(f => f.tag === 'form')) form = null; stack.length = i; }
    }
  }
  flush('p');
  if (anchor) closeAnchor();
  facts.title = titleText ? squash(decode(titleText)).slice(0, 200) || null : null;
  return facts;

  function closeAnchor() {
    const t = squash(anchor.text) || anchor.aria;
    if (!anchor.hidden && facts.anchors.length < 1500 && (t || anchor.href)) facts.anchors.push({ href: anchor.href, text: (t || '').slice(0, 100), z: anchor.z, navId: anchor.navId, list: anchor.list, inForm: anchor.inForm, cls: anchor.cls });
    anchor = null;
  }
}

// ---------- interpretation helpers (shared with build-profiles.mjs and tests) ----------
const JUNK_LABEL = /^(?:skip to.*|skip navigation|menu|toggle(?: navigation| menu)?|close|search(?: button| icon| submit)?|submit|open search|close search|translate|select language|language|open menu|main menu|navigation|×|x|\W+|\d+|more|back|home page|go)$/i;
export const goodLabel = t => t && t.length >= 2 && t.length <= 40 && !JUNK_LABEL.test(t) && /[a-z]/i.test(t) && !/https?:|www\.|@|\{\{|\}\}|javascript/i.test(t);
const dedupe = list => { const seen = new Set(); return list.filter(x => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };

// Top-level navigation labels: the nav group with a sensible number of shallowest items, header navs first.
export function navLabels(facts, max = 12) {
  const groups = new Map();
  for (const a of facts.anchors) if (a.z === 'nav' && a.navId >= 0) { if (!groups.has(a.navId)) groups.set(a.navId, []); groups.get(a.navId).push(a); }
  const ranked = [];
  for (const [id, items] of groups) {
    const good = items.filter(a => goodLabel(a.text)); if (!good.length) continue;
    const minList = Math.min(...good.map(a => a.list));
    const top = dedupe(good.filter(a => a.list === minList).map(a => a.text));
    const meta = facts.navGroups.find(g => g.id === id) || {};
    if (meta.footer) continue;
    const score = (top.length >= 3 && top.length <= 14 ? 10 : top.length >= 2 ? 3 : 0) + (meta.header ? 2 : 0) - (/(?:utility|top-?bar|secondary|social|breadcrumb|footer|sub)/.test(meta.cls || '') ? 4 : 0) - id * 0.01;
    if (top.length) ranked.push({ score, top });
  }
  ranked.sort((x, y) => y.score - x.score);
  let labels = ranked[0]?.top || [];
  if (labels.length < 3) {
    const header = dedupe(facts.anchors.filter(a => a.z === 'header' && !a.inForm).map(a => a.text).filter(goodLabel));
    if (header.length > labels.length) labels = header;
  }
  return labels.slice(0, max);
}
export const footerLabels = (facts, max = 16) => dedupe(facts.anchors.filter(a => a.z === 'footer').map(a => a.text).filter(goodLabel)).slice(0, max);
// Capture artifacts in titles and headings: the whole text repeated back to back ("A | BA | B"), a doubled word
// ("HomeHome | X"), icon-font ligature words ("offline_bolt MEA News") and template placeholders ("%APY1").
const halfRepeat = s => { for (const sep of ['', ' ']) { const n = (s.length - sep.length) / 2; if (Number.isInteger(n) && n >= 3 && s.slice(0, n) === s.slice(n + sep.length) && s.slice(n, n + sep.length) === sep) return s.slice(0, n); } return s; };
export function cleanCaptureText(text) {
  if (typeof text !== 'string') return null;
  let s = text.replace(/\s+/g, ' ').trim();
  if (/%[A-Za-z_]+\d*/.test(s)) return null; // unrendered template placeholder: the capture is not real copy
  s = s.replace(/\{\{[^}]*\}\}|\[\[[^\]]*\]\]/g, ' ');
  s = s.replace(/(^|\s)[a-z]+(?:_[a-z]+)+(?=\s|$)/g, ' ');
  s = s.replace(/\b([A-Z][a-z]{2,})\1\b/g, '$1');
  s = s.replace(/\s+/g, ' ').replace(/^[\s|:–—-]+|[\s|:–—-]+$/g, '').trim();
  s = halfRepeat(s);
  return s.length >= 3 ? s : null;
}
export function heroHeading(facts) {
  const h = facts.headings.find(x => x.level === 1 && x.text.length >= 3 && x.text.length <= 120) || facts.headings.find(x => x.level === 2 && x.text.length >= 3 && x.text.length <= 120);
  return h ? h.text : null;
}

// ---------- login form ----------
const FIELD_RULES = [
  ['password', i => i.type === 'password'],
  ['email', i => i.type === 'email' || /e-?mail/i.test(`${i.name} ${i.id} ${i.placeholder} ${i.autocomplete} ${i.aria} ${i.label || ''}`)],
  ['account', i => /account|acct|customer ?(?:no|num|id|#)|member ?(?:no|num|#)|policy|invoice|loan ?(?:no|num)|parcel|bill ?(?:no|num)|reference|statement ?(?:no|id)|guarantor/i.test(`${i.name} ${i.id} ${i.placeholder} ${i.aria} ${i.label || ''}`)],
  ['username', i => /user|login|logon|signin|sign-in|online ?id|\buid\b|userid|access ?id/i.test(`${i.name} ${i.id} ${i.placeholder} ${i.autocomplete} ${i.aria} ${i.label || ''}`)],
  ['phone', i => i.type === 'tel' || /phone|mobile/i.test(`${i.name} ${i.id} ${i.placeholder} ${i.aria} ${i.label || ''}`)],
  ['zip', i => /zip|postal/i.test(`${i.name} ${i.id} ${i.placeholder} ${i.aria} ${i.label || ''}`)],
  ['last_name', i => /last ?name|surname/i.test(`${i.name} ${i.id} ${i.placeholder} ${i.aria} ${i.label || ''}`)],
  ['date_of_birth', i => /birth|dob/i.test(`${i.name} ${i.id} ${i.placeholder} ${i.aria} ${i.label || ''}`)],
  ['remember', i => i.type === 'checkbox' && /remember|keep me/i.test(`${i.name} ${i.id} ${i.label || ''}`)]
];
const SKIP_INPUT = i => ['hidden', 'submit', 'button', 'image', 'reset', 'search', 'radio', 'file'].includes(i.type) || /^(?:q|s|search|query|keyword|keywords|searchtext|search_api_fulltext)$/i.test(i.name) || /search|captcha|newsletter|subscribe|honeypot/i.test(`${i.name} ${i.id} ${i.placeholder}`);
export const LOGIN_WORDS = /\b(?:log ?in|sign ?in|log ?on|sign ?on|login|logon|signin)\b/i;
export const REGISTER_WORDS = /\b(?:register|registration|sign ?up|create (?:an |your |new )?(?:online )?(?:account|profile|login)|enroll(?:ment)?|new (?:user|customer|member)s?|first[- ]time (?:user|login|visitor)|activate (?:your )?account|get started)\b/i;
export const FORGOT_WORDS = /\b(?:forgot|forgotten|reset (?:your |my )?password|recover (?:your )?(?:password|user)|trouble (?:signing|logging)|can'?t (?:sign|log) ?in|need help (?:signing|logging)|unlock)/i;
export const GUEST_WORDS = /\b(?:guest (?:pay|payment|checkout)|(?:pay|continue|proceed|check ?out) as (?:a )?guest|quick ?pay|pay (?:now |a bill |your bill )?without (?:an account|logging|signing|registering|creating|an online account)|one[- ]time payment without|no (?:login|account|registration) (?:required|needed))\b/i;
export const SOCIAL = [
  ['google', /\b(?:with|via|using) google\b|google (?:sign[- ]?in|login|log ?in)|accounts\.google\.com|gsi\/client|\bg_id_signin\b/i],
  ['apple', /\b(?:with|via|using) apple\b|appleid\.apple\.com|appleid\.cdn-apple\.com|apple (?:sign[- ]?in|login)/i],
  ['facebook', /\b(?:with|via|using) facebook\b|facebook\.com\/(?:v[\d.]+\/)?dialog\/oauth|facebook (?:login|log ?in)/i],
  ['microsoft', /\b(?:with|via|using) microsoft\b|login\.microsoftonline\.com|login\.live\.com/i],
  ['amazon', /\b(?:with|via|using) amazon\b|login with amazon/i],
  ['paypal', /\b(?:log ?in|sign ?in|continue|pay) with paypal\b/i],
  ['twitter', /\b(?:with|via|using) (?:twitter|x\.com)\b/i]
];

export function loginFacts(facts, scriptUrls = []) {
  const labelFor = (form, i) => form.labels.find(l => l.for && (l.for === i.id || l.for === i.name))?.text || '';
  const forms = facts.forms.map(f => ({ f, inputs: f.inputs.filter(i => !SKIP_INPUT(i)).map(i => ({ ...i, label: labelFor(f, i) })) }));
  const pick = forms.find(x => x.inputs.some(i => i.type === 'password'))
    || forms.find(x => x.inputs.length && x.inputs.length <= 4 && [...x.f.buttons, ...x.f.inputs.map(i => i.value)].some(b => LOGIN_WORDS.test(b)) && !x.inputs.some(i => /search/i.test(i.name)));
  const loose = !pick && (facts.looseInputs || []).filter(i => !SKIP_INPUT(i));
  const inputs = pick ? pick.inputs : loose && loose.some(i => i.type === 'password') ? loose : [];
  const fields = [];
  for (const i of inputs) { const r = FIELD_RULES.find(([, test]) => test(i)); const k = r ? r[0] : i.type === 'text' || i.type === 'tel' || i.type === 'number' ? 'text' : null; if (k && k !== 'remember' && !fields.includes(k)) fields.push(k); }
  const buttons = dedupe([...(pick ? [...pick.f.buttons, ...pick.f.inputs.filter(i => i.value).map(i => i.value)] : []), ...(facts.looseButtons || []).filter(b => LOGIN_WORDS.test(b))].map(squash).filter(b => b && b.length <= 40)).slice(0, 6);
  const linkText = facts.anchors.filter(a => a.z !== 'footer').map(a => `${a.text} ${a.href || ''}`);
  const allText = [...linkText, ...(facts.looseButtons || []), ...facts.forms.flatMap(f => f.buttons)];
  const socialHay = [...allText, ...facts.anchors.map(a => a.cls || ''), ...scriptUrls].join('\n');
  const socialProviders = SOCIAL.filter(([, re]) => re.test(socialHay)).map(([k]) => k);
  return {
    formObserved: inputs.length > 0,
    fields,
    buttons,
    socialProviders,
    hasRegisterLink: allText.some(t => REGISTER_WORDS.test(t)),
    hasForgotLink: allText.some(t => FORGOT_WORDS.test(t)),
    hasGuestPay: allText.some(t => GUEST_WORDS.test(t)),
    formAction: pick?.f.action || null
  };
}

// ---------- help excerpts ----------
const BOILER = /cookie|javascript|browser (?:is|version)|all rights reserved|©|copyright|privacy policy|terms of (?:use|service)|skip to|sign up for (?:our|email) news|subscribe to|follow us|\bclick here\b|lorem ipsum|enable js|404|page not found|access denied|captcha|cloudflare|\{\{|\}\}|<[a-z/]/i;
const sentencesOf = t => t.split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/).map(s => s.trim());
export const cleanSentence = s => /[.!?]["”’)]?$/.test(s) && !/\(\s*\)|\[\s*\]/.test(s) && s.length >= 30 && s.length <= 320 && /[a-z]{3}/.test(s) && (s.match(/\s/g) || []).length >= 5 && !BOILER.test(s) && !/https?:\/\/|www\.|\S+@\S+\.\w/.test(s) && (s.replace(/[^A-Z]/g, '').length / s.length) < 0.35;
export const HELP_TOPICS = {
  pay_bill: /\bpay(?:ing|ment|ments)?\b|bill/i,
  view_bill: /\bbill\b|statement|balance|due date|amount due|invoice/i,
  statements_history: /statement|history|past (?:bills?|payments?)|previous|archive/i,
  autopay_setup: /auto ?-?pay|automatic|recurring|auto[- ]?draft|bank draft|direct debit|\bEFT\b|ez ?pay/i,
  autopay_cancel: /auto ?-?pay|automatic|recurring|draft|\bEFT\b/i,
  paperless: /paperless|e-?bills?\b|e-?statements?|electronic (?:bill|statement)|go green|email (?:bill|statement|notification)/i,
  payment_assistance: /assistance|help (?:paying|with)|program|LIHEAP|arrangement|extension|hardship|budget billing|payment plan|financial aid|charity|senior|low[- ]income|discount/i,
  help_center: /pay|bill|account|service|contact|question|help/i
};
// The most relevant clean sentences (document order) up to `limit` characters.
export function excerptFor(facts, topic, limit = 600) {
  const re = HELP_TOPICS[topic] || HELP_TOPICS.help_center;
  const seen = new Set(); const picked = [];
  let len = 0;
  for (const b of facts.blocks) {
    if (b.h || b.z === 'nav' || b.z === 'footer' || b.z === 'header' || b.z === 'form') continue;
    for (const s of sentencesOf(b.t)) {
      if (!cleanSentence(s) || !re.test(s) || seen.has(s)) continue;
      seen.add(s);
      if (len + s.length + 1 > limit) return picked.join(' ');
      picked.push(s); len += s.length + 1;
    }
  }
  return picked.join(' ');
}
export const pageHeadings = (facts, max = 8) => dedupe(facts.headings.map(h => h.text).filter(t => t.length >= 3 && t.length <= 100 && !BOILER.test(t) && /[a-z]/i.test(t))).slice(0, max);
export { hostOf };
