// Scripted HTTP reference for the Fleet Infinity adapter. This is NOT an autonomous agent.
//
// It solves an exported task the way a user would, through the public site only: it opens the start URL (the episode
// entry link), signs in with the credentials stated in the instruction, reads the episode mailbox at /mail for codes,
// links and bill notices, and submits the forms each template renders (field names parsed from the HTML, so CSRF,
// act() dispatch and redirects are exercised). It has no admin, grader or ledger access. Its privileged knowledge is
// limited to the task type and the template's route table (where pages live), analogous to the selectors a scripted
// browser reference uses. Answers are read from rendered pages and emails and returned as the final message.
//
// CLI: node reference.mjs <startUrl> <task-json-file> [--mode reference|noop|wrong]
//   prints {"steps": n, "answer": "...", "errors": []}
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Client, parseForms, encodeForm } from '../tests/httpflows.mjs';
import { loadTemplates, templates } from '../server.mjs';

const unesc = s => String(s ?? '').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }[e]));
export const pageText = html => unesc(String(html).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d|dt|dd|section|article)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t ]+/g, ' ').replace(/\n\s*/g, '\n').trim();
// Choices a control offers: select options or the values of a radio group.
const optionsOf = (f, name) => { const c = f.controls.find(x => x.name === name); return !c ? [] : c.type === 'select' ? c.options : f.valuesOf(name); };
const alertOf = body => pageText((String(body).match(/role="alert"[^>]*>([\s\S]*?)<\/(?:div|p|span)>/) || [])[1] || '');
const PHONE = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g;

// Credentials the instruction gives the agent (the only credential channel).
export function credentialsFrom(instruction) {
  const email = instruction.match(/\(email ([^\s)]+@[^\s)]+)\)/)?.[1];
  const mailPassword = instruction.match(/mailbox password (\S+?)\)/)?.[1];
  const portalPassword = instruction.match(/your password is (\S+?)\.(?:\s|$)/)?.[1] || instruction.match(/choose a portal password, use (\S+?)\.(?:\s|$)/)?.[1] || null;
  const name = instruction.match(/You are ([^(]+?) \(email/)?.[1];
  return { email, mailPassword, portalPassword, name, last: name?.split(' ').slice(-1)[0] };
}

export class ReferenceAgent {
  constructor({ startUrl, task }) {
    const u = new URL(startUrl);
    this.origin = u.origin; this.startPath = u.pathname + u.search; this.task = task; this.steps = 0;
    this.client = new Client(this.origin); this.creds = credentialsFrom(task.instruction);
    this.billerId = task.biller_id; this.t = templates.get(task.template) || templates.get('generic');
  }
  R(page, params = {}, query = null) {
    let p = this.t.routes[page]; if (!p) throw new Error(`template ${this.t.id} has no ${page} page`);
    p = p.replace(/:(\w+)/g, (_, k) => encodeURIComponent(params[k] ?? ''));
    return `/b/${this.billerId}${p === '/' ? '/' : p}${query ? '?' + new URLSearchParams(query) : ''}`;
  }
  has(page) { return !!this.t.routes[page]; }
  // GET and follow redirects.
  async get(path) {
    let r, at = path;
    for (let i = 0; i < 8; i++) { this.steps++; r = await this.client.get(at); r.url = at; if (r.status >= 300 && r.status < 400 && r.headers.location) { at = new URL(r.headers.location, this.origin + at).pathname + new URL(r.headers.location, this.origin + at).search; continue; } return r; }
    throw new Error(`redirect loop at ${path}`);
  }
  async post(action, body) { this.steps++; const r = await this.client.post(action, body); r.location = r.headers.location; return r; }
  form(body, pred) { return parseForms(body).find(f => f.method === 'post' && pred(f)); }
  // Submit a form; a 303 is success (followed), anything else throws with the page's alert text.
  async submit(form, overrides = {}, opts = {}) {
    const r = await this.post(form.action, encodeForm(form, overrides, opts));
    if (r.status !== 303) { const e = new Error(alertOf(r.body) || `POST ${form.action} -> ${r.status}`); e.status = r.status; e.body = r.body; throw e; }
    return this.get(r.location);
  }
  async open(page, params) { const r = await this.get(this.R(page, params)); if (r.status !== 200) throw new Error(`GET ${page} -> ${r.status}`); return r; }

  // ---------- mailbox ----------
  async mailLogin() {
    const r = await this.get('/mail');
    if (/name="password"/.test(r.body)) {
      const res = await this.post('/mail/login', new URLSearchParams({ email: this.creds.email, password: this.creds.mailPassword }).toString());
      if (res.status !== 303) throw new Error(`mailbox sign-in failed: ${alertOf(res.body)}`);
    }
  }
  // Newest sign-in code on the persona's phone (/sms opens with the episode cookie; a conversation per short code).
  async smsCode() {
    const list = await this.get('/sms'); const conv = list.body.match(/href="(\/sms\/c\/\d+)"/)?.[1]; if (!conv) throw new Error('no text messages');
    const codes = [...pageText((await this.get(conv)).body).matchAll(/\b(\d{6})\b/g)].map(m => m[1]); if (!codes.length) throw new Error('no code in text messages');
    return codes.at(-1);
  }
  async mailFind(re, { index = 0 } = {}) {
    await this.mailLogin();
    const list = await this.get('/mail');
    const items = [...list.body.matchAll(/<a href="(\/mail\/m\/[\w-]+)"><span class="from">[\s\S]*?<span class="subj">([\s\S]*?)<\/span>/g)].map(m => ({ href: m[1], subject: unesc(m[2]) })).filter(m => re.test(m.subject));
    const hit = items[index]; if (!hit) throw new Error(`no email matching ${re}`);
    const msg = await this.get(hit.href);
    const textHtml = (msg.body.match(/<div class="text">([\s\S]*?)<\/div>/) || [])[1] || '';
    return { subject: hit.subject, text: pageText(textHtml), links: [...textHtml.matchAll(/href="([^"]+)"/g)].map(m => unesc(m[1])) };
  }

  // ---------- portal ----------
  async login(password = this.creds.portalPassword) {
    let r = await this.open('login');
    let f = this.form(r.body, x => x.has('username') || x.has('password'));
    if (!f) throw new Error('no sign-in form');
    if (!f.has('password')) { r = await this.submit(f, { username: this.creds.email }); f = this.form(r.body, x => x.has('password')); if (!f) throw new Error('no password step'); }
    const creds = { password }; if (f.controls.some(c => c.name === 'username' && c.type !== 'hidden')) creds.username = this.creds.email;
    r = await this.submit(f, creds);
    const mfa = this.form(r.body, x => x.has('code'));
    if (mfa && r.url.startsWith(this.R('mfa'))) {
      let code;
      if (/We texted/i.test(pageText(r.body))) code = await this.smsCode(); // mfa:'sms': the code is on the phone page (/sms)
      else { const m = await this.mailFind(/verification code/i); code = m.subject.match(/\b(\d{6})\b/)?.[1] || m.text.match(/\b(\d{6})\b/)?.[1]; }
      r = await this.submit(mfa, { code });
    }
    if (r.url.startsWith(this.R('login'))) throw new Error(`sign-in failed: ${alertOf(r.body)}`);
    return r;
  }
  // Drive the template's pay wizard to the receipt. Returns {receipt, confirmation}.
  async pay({ amountChoice = 'due', amount, methodId = 'pm-chk', newMethod = null, payOn = null, startAt = null } = {}) {
    let r = await this.get(startAt || this.R(this.t.flow.paySteps[0]));
    for (let i = 0; i < 8; i++) {
      if (r.status !== 200) throw new Error(`pay step ${r.url} -> ${r.status}`);
      const review = this.form(r.body, x => x.has('token') && x.has('acceptTerms'));
      if (review) { const receipt = await this.submit(review, { acceptTerms: true }); return { receipt, confirmation: this.confirmationIn(receipt.body) }; }
      const f = this.form(r.body, x => ['amountChoice', 'amount', 'methodId', 'methodType', 'payOn'].some(n => x.has(n)));
      if (!f) throw new Error(`no pay form at ${r.url}`);
      const ov = {};
      if (f.has('amountChoice')) { const opts = optionsOf(f, 'amountChoice'); ov.amountChoice = opts.includes(amountChoice) ? amountChoice : amountChoice === 'due' && opts.includes('balance') ? 'balance' : opts[0]; if (ov.amountChoice === 'other' && f.has('amount')) ov.amount = amount; }
      else if (f.has('amount') && amount) ov.amount = amount;
      if (newMethod && f.has('methodType')) for (const [k, v] of Object.entries(newMethod)) { if (f.has(k)) ov[k] = v; }
      else if (methodId && f.has('methodId')) { if (!optionsOf(f, 'methodId').includes(methodId)) throw new Error(`payment method ${methodId} is not offered here`); ov.methodId = methodId; }
      if (payOn && f.has('payOn')) ov.payOn = payOn;
      r = await this.submit(f, ov);
    }
    throw new Error('pay wizard did not reach review');
  }
  confirmationIn(body) {
    const text = pageText(body);
    const m = text.match(/(?:confirmation|reference|transaction|receipt|payment)\s*(?:number|no\.?|#|id|code)?\s*:?\s*\n?\s*([A-Z]{0,4}\d[A-Z0-9-]{5,})/i);
    return m?.[1] || null;
  }
  // Forms on an account page.
  async formOn(page, pred) { const r = await this.open(page); const f = this.form(r.body, pred); if (!f) throw new Error(`no matching form on ${page}`); return { r, f }; }
  async autopay({ methodId, cancel = false }) {
    let r = await this.open('autopay');
    for (let i = 0; i < 3; i++) {
      if (cancel) {
        const f = this.form(r.body, x => x.valuesOf('action').includes('cancel'));
        if (f) return this.submit(f, f.has('confirm') ? { confirm: true } : {});
      } else {
        const f = this.form(r.body, x => x.has('acceptTerms') && x.has('methodId'));
        if (f) { if (!optionsOf(f, 'methodId').includes(methodId)) throw new Error(`AutoPay does not offer method ${methodId}`); const ov = { methodId, acceptTerms: true }; if (f.has('policy') && optionsOf(f, 'policy').includes('full')) ov.policy = 'full'; return this.submit(f, ov); }
      }
      // A link-first layout ("Change AutoPay", "Turn off"): follow the first autopay-scoped link that reveals the form.
      const href = [...r.body.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => ({ href: unesc(m[1]), text: pageText(m[2]) })).find(l => l.href.startsWith(this.R('autopay')) && (cancel ? /cancel|turn off|stop|unenroll/i : /change|edit|update|enroll|set up|sign up|turn on/i).test(l.text));
      if (!href) break; r = await this.get(href.href);
    }
    throw new Error(`no AutoPay ${cancel ? 'cancel' : 'enrollment'} form`);
  }
  async cancelService({ acceptOffer = false }) {
    let r = await this.open('cancel');
    for (let i = 0; i < 5; i++) {
      const f = this.form(r.body, x => x.has('step')); if (!f) return r;
      const step = f.valuesOf('step')[0];
      if (step === 'reason') { const ov = {}; if (f.has('reason')) { const c = f.controls.find(x => x.name === 'reason'); const opts = ['select', 'radio'].includes(c.type) ? optionsOf(f, 'reason') : null; ov.reason = opts ? (opts.includes('moving') ? 'moving' : opts.find(Boolean)) : 'Moving away'; } r = await this.submit(f, ov); }
      else if (step === 'offer') { const fs = parseForms(r.body).filter(x => x.method === 'post' && x.has('step')); const target = fs.find(x => x.valuesOf('accept').includes(acceptOffer ? 'yes' : 'no')) || f; r = await this.submit(target, target.has('accept') && target.controls.find(c => c.name === 'accept').type !== 'hidden' ? { accept: acceptOffer ? 'yes' : 'no' } : {}, { button: acceptOffer ? 'yes' : 'no' }); if (acceptOffer) return r; }
      else if (step === 'confirm') { const ov = { confirm: true }; if (f.has('effectiveDate')) ov.effectiveDate = '2026-10-25'; return this.submit(f, ov); }
      else return r;
    }
    return r;
  }
  async findPhoneInHelp() {
    const seen = new Set(); const queue = [this.R('help')]; const found = [];
    const mine = h => { const p = new URL(h, this.origin).pathname; return p.startsWith(`/b/${this.billerId}/`) && (p.startsWith(this.R('help')) || p === this.R('home')) ? p : null; };
    while (queue.length && seen.size < 12) {
      const at = queue.shift(); if (seen.has(at)) continue; seen.add(at);
      const r = await this.get(at); if (r.status !== 200) continue;
      // Prefer a number labelled as customer service; quoted third-party numbers in FAQ prose rank last.
      for (const line of pageText(r.body).split('\n')) {
        const rank = /customer (?:service|care|support)/i.test(line) ? 0 : /call us|contact us|phone/i.test(line) ? 1 : /contact|call/i.test(line) ? 2 : 3;
        for (const m of line.matchAll(PHONE)) found.push({ rank, phone: `(${m[1]}) ${m[2]}-${m[3]}` });
      }
      if (found.some(f => f.rank === 0)) break;
      for (const m of r.body.matchAll(/href="([^"]+)"/g)) { const p = mine(unesc(m[1])); if (p && !seen.has(p)) (/contact|phone|call|customer|help-center|support/i.test(p) ? queue.unshift(p) : queue.push(p)); }
    }
    return found.sort((x, y) => x.rank - y.rank)[0]?.phone || null;
  }

  // ---------- task solvers (by task type) ----------
  async solve() {
    await this.get(this.startPath); // the entry link sets the episode cookies
    const slug = this.task.task_type;
    const fn = SOLVE[slug]; if (!fn) throw new Error(`no reference for ${slug}`);
    return (await fn(this)) ?? 'Done.';
  }
}

const SOLVE = {
  async 'view-bill'(a) {
    await a.login(); const r = await a.open(a.has('bill') ? 'bill' : a.t.flow.afterLogin); const text = pageText(r.body);
    const amt = text.match(/(?:amount due|total (?:amount )?due|balance due|current balance|amount owed|new balance|total balance|minimum (?:payment )?due|payment due)[^$\n]{0,60}\$\s?([\d,]+\.\d{2})/i)?.[1] || text.match(/\$\s?([\d,]+\.\d{2})/)?.[1];
    const DATE = '((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.? \\d{1,2},? \\d{4}|\\d{1,2}/\\d{1,2}/\\d{4}|\\d{4}-\\d\\d-\\d\\d)';
    const due = text.match(new RegExp(`(?:due date|due on|due by|payment due|pay by|renew by)[^A-Za-z0-9]{0,12}${DATE}`, 'i'))?.[1] || text.match(new RegExp(`(?:due|pay by|renew by)\\b[\\s\\S]{0,80}?${DATE}`, 'i'))?.[1];
    return `Amount due: $${amt}. Due date: ${due}.`;
  },
  async 'pay-bank'(a) { await a.login(); const { confirmation } = await a.pay({ methodId: 'pm-chk' }); return `Paid in full from checking. Confirmation number: ${confirmation}.`; },
  async 'pay-minimum'(a) { await a.login(); await a.pay({ amountChoice: 'minimum', methodId: 'pm-chk' }); },
  async 'pay-partial-card'(a) { await a.login(); await a.pay({ amountChoice: 'other', amount: '25.00', methodId: 'pm-card' }); },
  async 'schedule-payment'(a) { await a.login(); await a.pay({ methodId: 'pm-chk', payOn: '2026-10-15' }); },
  async 'cancel-scheduled'(a) { await a.login(); const { f } = await a.formOn('history', x => x.has('paymentId') && x.valuesOf('op').concat(x.buttons.map(b => b.value)).includes('cancel')); await a.submit(f, {}, { button: 'cancel' }); },
  async 'autopay-enroll'(a) { await a.login(); await a.autopay({ methodId: 'pm-chk' }); },
  async 'autopay-switch-to-card'(a) { await a.login(); await a.autopay({ methodId: 'pm-card' }); },
  async 'autopay-cancel'(a) { await a.login(); await a.autopay({ cancel: true }); },
  async 'paperless-on'(a) { await a.login(); const { f } = await a.formOn('paperless', x => x.has('paperless')); const c = f.controls.find(x => x.name === 'paperless'); await a.submit(f, c.type === 'hidden' ? {} : { paperless: f.valuesOf('paperless').includes('on') ? 'on' : true }); },
  async 'cancel-service'(a) { await a.login(); await a.cancelService({ acceptOffer: false }); },
  async 'accept-retention'(a) { await a.login(); await a.cancelService({ acceptOffer: true }); },
  async 'undo-cancellation'(a) { await a.login(); const { f } = await a.formOn('cancel', x => x.valuesOf('step').includes('undo')); await a.submit(f); },
  async 'downgrade-plan'(a) {
    await a.login(); const { r, f } = await a.formOn('plan', x => x.has('planId'));
    // Cheapest plan: the radio whose label shows the lowest monthly price.
    const priced = f.valuesOf('planId').map(v => { const i = r.body.indexOf(`value="${v}"`); const near = pageText(r.body.slice(i, i + 400)); const p = near.match(/\$\s?([\d,]+\.\d{2})/); return { v, cents: p ? Math.round(Number(p[1].replace(/,/g, '')) * 100) : Infinity }; }).sort((x, y) => x.cents - y.cents);
    await a.submit(f, { planId: priced[0].v });
  },
  async 'remove-old-card'(a) {
    await a.login(); const r = await a.open('wallet');
    const forms = parseForms(r.body).filter(f => f.method === 'post' && f.has('methodId') && (f.valuesOf('op').includes('remove') || f.buttons.some(b => b.value === 'remove' || /remove|delete/i.test(b.text))));
    const target = forms.find(f => { const id = f.valuesOf('methodId')[0]; const i = r.body.indexOf(`value="${id}"`); return /4444/.test(pageText(r.body.slice(Math.max(0, i - 600), i))); });
    if (!target) throw new Error('no remove control for the card ending 4444');
    await a.submit(target, {}, { button: 'remove' });
  },
  async 'setup-payment-plan'(a) { await a.login(); const { f } = await a.formOn('arrangement', x => x.has('months')); await a.submit(f, { months: '6' }); },
  async 'send-message'(a) {
    await a.login(); const { f } = await a.formOn('contact', x => x.has('message'));
    const ov = { message: 'Please stop mailing paper statements to me.' }; const s = f.controls.find(c => c.name === 'subject');
    if (s) ov.subject = s.type === 'select' ? (s.options.find(o => /bill|statement|general|other/i.test(o)) || s.options.find(Boolean)) : 'Paper statements';
    await a.submit(f, ov);
  },
  async 'reset-then-pay'(a) {
    const NEW = 'Renewed-Pass-2026!';
    const { f } = await a.formOn('forgot', x => x.has('identifier'));
    let r = await a.submit(f, { identifier: a.creds.email });
    const mail = await a.mailFind(/^Reset your/i); const code = mail.text.match(/Verification code: (\d{6})/)?.[1];
    let rf = a.form(r.body, x => x.has('password') && x.has('confirm'));
    if (!rf) { r = await a.open('reset'); rf = a.form(r.body, x => x.has('password') && x.has('confirm')); }
    const ov = { password: NEW, confirm: NEW }; if (rf.has('code')) ov.code = code;
    await a.submit(rf, ov);
    await a.login(NEW); const { confirmation } = await a.pay({ methodId: 'pm-chk' }); return `Password reset and bill paid. Confirmation ${confirmation}.`;
  },
  async 'mfa-pay'(a) { await a.login(); await a.pay({ methodId: 'pm-chk' }); },
  async 'sms-mfa-pay'(a) { await a.login(); await a.pay({ methodId: 'pm-chk' }); },
  async 'register-and-pay'(a) {
    const notice = await a.mailFind(/bill is ready/i);
    const field = label => notice.text.match(new RegExp(`${label}: (.+)`))?.[1]?.trim();
    const { f } = await a.formOn('register', x => x.has('password') && x.has('confirm'));
    const values = { accountNumber: field('Account number'), lastName: a.creds.last, zip: field('Service ZIP code'), email: a.creds.email, password: a.creds.portalPassword, confirm: a.creds.portalPassword };
    const ov = {}; for (const [k, v] of Object.entries(values)) if (f.has(k) && f.controls.find(c => c.name === k).type !== 'hidden') ov[k] = v;
    for (const c of f.controls) if (c.type === 'checkbox' && /terms|agree|accept/i.test(c.name)) ov[c.name] = true;
    await a.submit(f, ov);
    const verify = await a.mailFind(/verify/i); const link = verify.links.find(l => l.includes(`/b/${a.billerId}/`)); if (!link) throw new Error('no verification link');
    await a.get(new URL(link, a.origin).pathname + new URL(link, a.origin).search);
    await a.login();
    await a.pay({ newMethod: { methodType: 'bank', accountType: 'checking', routing: '021000021', bankAccount: '000123456789', bankAccountConfirm: '000123456789', holder: a.creds.name } });
  },
  async 'guest-pay'(a) {
    const notice = await a.mailFind(/bill is ready/i);
    const field = label => notice.text.match(new RegExp(`${label}: (.+)`))?.[1]?.trim();
    const { f } = await a.formOn(a.t.flow.guestSteps[0], x => ['accountNumber', 'statementId', 'parcelId', 'plate'].some(n => x.has(n)));
    const values = { accountNumber: field('Account number'), statementId: field('Statement ID') || field('Account number'), parcelId: field('Parcel number') || field('Account number'), plate: field('License plate') || field('Account number'), lastName: a.creds.last, zip: field('Service ZIP code'), amountDue: field('Amount due')?.replace(/[$,]/g, '') };
    const ov = {}; for (const [k, v] of Object.entries(values)) if (f.has(k) && f.controls.find(c => c.name === k).type !== 'hidden' && v != null) ov[k] = v;
    const r = await a.submit(f, ov);
    await a.pay({ startAt: r.url, newMethod: { methodType: 'card', cardNumber: '4111111111111111', exp: '12/28', cvv: '123', holder: a.creds.name } });
  },
  async 'declined-retry'(a) {
    await a.login();
    let declined = false;
    try { await a.pay({ methodId: 'pm-card' }); } catch (e) { if (!/declin/i.test(e.message)) throw e; declined = true; }
    if (!declined) throw new Error('the saved card was not declined');
    await a.pay({ methodId: 'pm-chk' });
  },
  async 'help-phone'(a) { const phone = await a.findPhoneInHelp(); if (!phone) throw new Error('no phone number found in help'); return `The customer service phone number is ${phone}.`; },
  async 'offline-limitation'(a) {
    const home = await a.get(a.R('home')); const help = a.has('help') ? await a.get(a.R('help')) : { body: '' };
    const text = pageText(home.body + '\n' + help.body);
    const phone = [...text.matchAll(PHONE)][0]; if (phone) return `Online payment is not available. Call (${phone[1]}) ${phone[2]}-${phone[3]} to pay.`;
    const addr = text.match(/(?:mail|send)[^\n]{0,80}?((?:P\.?\s?O\.?\s?Box|\d{1,6} )[^\n]{5,120}?\b\d{5}\b)/i)?.[1]; if (addr) return `Online payment is not available. Mail payment to ${addr}.`;
    return 'Online payment is not available and no phone number or mailing address is listed.';
  },
  async 'not-a-biller'(a) { const r = await a.get(a.R('home')); const n = pageText(r.body).match(/does not (?:bill|send bills|take payments)[^.\n]*/i)?.[0]; return n ? `This organization ${n}. No payment was made.` : 'This organization does not bill customers directly, so there is nothing to pay. No payment was made.'; }
};
export const REFERENCE_TASK_TYPES = Object.keys(SOLVE);

// mode: reference (solve), noop (open the start page only, empty answer), wrong (open the start page, answer "unknown").
export async function runReference({ startUrl, task, mode = 'reference' }) {
  if (!templates.size) await loadTemplates();
  const a = new ReferenceAgent({ startUrl, task }); const errors = []; let answer = '';
  try {
    if (mode === 'reference') answer = await a.solve();
    else { await a.get(a.startPath); answer = mode === 'wrong' ? 'Paid $1.00 online. Confirmation number ZZ0000000. Phone (555) 010-0000. Due 2026-01-01.' : ''; }
  } catch (e) { errors.push(`${e.message}`.slice(0, 300)); }
  return { steps: a.steps, answer, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [startUrl, taskFile] = process.argv.slice(2);
  const i = process.argv.indexOf('--mode'); const mode = i > 0 ? process.argv[i + 1] : 'reference';
  const task = JSON.parse(readFileSync(taskFile, 'utf8'));
  const out = await runReference({ startUrl, task, mode });
  process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(0);
}
