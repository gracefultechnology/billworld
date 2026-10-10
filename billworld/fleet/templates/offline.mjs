// Offline biller experience: the 16,862 billers with no public website or whose charges are consolidated onto
// another company's bill. Reconstructs what a small local office / co-op / tribal utility / clinic web page or a
// bill insert offers: how to pay by mail, phone and in person, typical office hours, a remittance-stub guide,
// and (for consolidated billing) which bill the charges appear on. Online accounts are clearly unavailable;
// the server redirects every account page to home, so only home and the help pages are reachable.
import { observe, finish, obsNav, obsFooter, heroText, heroLine, idLabel, submitLabel, social, helpExcerpts, articleExcerpt, OBS_CSS } from './_observed.mjs';
import { html, doc, logo, alert, helpList, helpBody, helpSearchForm, L } from '../kit.mjs';
import { loadCatalog } from '../catalog.mjs';

export const meta = {
  id: 'offline',
  // Where the dedicated tier's dossier nav (vm.nav) goes: the first element matching a selector (class:<token> or
  // aria:<label>) is re-filled with the dossier's items; observed real-site navs yield on public pages (server.mjs withDossierNav).
  navSlots: { public: [], account: [] },
  name: 'Offline biller information page',
  description: 'Informational page for billers with no online account or with consolidated billing: ways to pay by mail, phone and in person, office hours, bill-stub guide and which bill consolidated charges appear on.',
  families: ['no public website', 'consolidated billing (utility-consolidated supplier, tax-bill or utility-bill line item)'],
  sources: [
    'billworld/captures/ (Homer, Juneau, Duluth, Tuscaloosa local-government payment pages: office hours, drop box, pay by mail/phone patterns)',
    'categories/*.json research notes for consolidated-billing suppliers (e.g. "supply charges appear on your utility bill - pay the utility")',
    'https://www.dominionenergy.com/virginia/billing (pay in person / mail / phone options wording)'
  ],
  evidence: {
    observed_public: [
      'Local utility and municipal payment pages list: mail-in with the bill stub, night drop box, pay in person at the office during business hours, pay by phone',
      'Retail energy supplier FAQs state supply charges appear as a line on the local utility bill and are paid to the utility'
    ],
    documented: ['Phone numbers, payment mailing address, office address, service area and consolidated-billing explanation come from the research record (notes, payment_processor, phone fields)'],
    synthetic: [
      'Office hours are a typical-hours placeholder and are labelled "call to confirm"',
      'Remittance stub illustration is generic, not copied from any biller',
      'Payment-channel wording for kinds without documented channels (front desk, branch, drop box) is inferred from the biller category and labelled as typical'
    ]
  }
};

export const routes = {
  home: '/', help: '/info', helpArticle: '/info/topic/:slug', helpSearch: '/info/search'
};
export const flow = { paySteps: ['pay', 'payReview'], loginSteps: 1 };

const CONSOLIDATED = /consolidated billing|billed (?:on|with|through) (?:your|the) (?:\w+ )?(?:water|electric|utility|tax|property)|pay the lo/i;
const sentences = t => String(t || '').split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map(s => s.trim()).filter(Boolean);
function consolidation(vm) {
  const text = `${vm.biller.processor || ''} ${vm.biller.notes || ''}`;
  if (!CONSOLIDATED.test(text)) return null;
  // The catalog signal also matches phrases like "pay the local office"; require real consolidated-billing language.
  if (!/consolidated billing|appear(?:s)? (?:as a line )?on (?:your|the)|line (?:item )?on (?:your|the)|billed (?:on|with|through) (?:your|the)|pay the (?:local )?utility/i.test(text)) return null;
  const s = sentences(vm.biller.notes).filter(x => /appear|consolidat|billed (?:on|with|through)|pay the (?:local )?utility|line (?:item )?on/i.test(x)).slice(0, 2);
  const where = /property|tax bill/i.test(text) ? 'your property tax bill' : /water|sewer/i.test(text) ? 'your water/sewer bill' : /utility|electric|gas|supply/i.test(text) ? 'your local utility bill' : 'another company’s bill';
  return { where, detail: s, processor: vm.biller.processor };
}

// Category-specific channels and nouns.
function profile(vm) {
  const k = vm.biller.kind, bt = vm.biller.billType || '';
  const P = {
    utility: { office: 'business office', who: 'members and customers', inPerson: 'Pay at the business office by cash, check or money order. Many small utilities also have a night drop box for checks after hours.', extra: 'Ask the office for an automatic bank draft authorization form if you want payments taken from your bank account each month.' },
    medical: { office: 'billing office', who: 'patients', inPerson: 'Pay at the front desk at your next visit, or stop by the billing office.', extra: 'If you have insurance questions, have your statement and insurance card ready when you call. Ask about payment plans or financial assistance if you cannot pay the full balance.' },
    loan: { office: 'branch', who: 'customers', inPerson: 'Make your payment at any branch location with a teller.', extra: 'If you have a deposit account with the same institution, ask about automatic transfers to pay your loan each month.' },
    card: { office: 'branch', who: 'cardholders', inPerson: 'Make a card payment at any branch location with a teller.', extra: 'Ask a branch representative about automatic payments from your deposit account.' },
    rent: { office: 'management office', who: 'residents', inPerson: 'Bring a check or money order to the leasing or management office during office hours. Many offices have a secure rent drop slot.', extra: 'Write your unit number on every check or money order.' },
    telecom: { office: 'business office', who: 'subscribers', inPerson: 'Pay at the local business office during business hours.', extra: 'Ask the office about automatic bank draft if you want monthly payments made for you.' },
    tax: { office: 'treasurer’s office', who: 'taxpayers', inPerson: 'Pay at the county or municipal treasurer’s office. Bring your tax notice.', extra: 'Payments must be received or postmarked by the due date to avoid penalties.' },
    government: { office: 'clerk’s office', who: 'residents', inPerson: 'Pay in person at the clerk’s office. Bring your notice.', extra: '' },
    insurance: { office: 'agent’s office', who: 'policyholders', inPerson: 'Pay through your local agent’s office.', extra: 'Ask your agent about automatic monthly bank drafts.' },
    subscription: { office: 'office', who: 'members', inPerson: 'Pay in person at the office or location where you signed up.', extra: '' }
  };
  const p = P[k] || { office: 'office', who: 'customers', inPerson: 'Pay in person at the office during business hours.', extra: '' };
  if (['dental', 'vision', 'hearing', 'pharmacy'].includes(bt)) p.office = bt === 'pharmacy' ? 'pharmacy counter' : 'front desk';
  return p;
}

// Why this biller has no online account (catalog signal): 'unresearched_roster' means online options were simply
// not confirmed, 'informational' means the record does not bill customers at all.
const signal = vm => { if (vm.biller.signal !== undefined) return vm.biller.signal; try { return loadCatalog().billers.get(vm.biller.id)?.signal ?? null; } catch { return null; } };
function status(vm) {
  const b = vm.biller, c = consolidation(vm), s = signal(vm);
  if (s === 'informational') return { h: 'No bill to pay online', p: html`${b.name} does not bill customers directly, so online payment is not available here. If you received a bill that mentions ${b.brand.shortName}, pay the organization named on that bill.`, foot: 'does not bill customers directly' };
  if (s === 'unresearched_roster') return { h: 'Online payment is not available on this site', p: html`Online account options for ${b.name} were not confirmed. Online payment is not available through this site; use the payment options printed on your statement or listed below.${c ? html` Charges from ${b.brand.shortName} may be billed on <strong>${c.where}</strong>.` : ''}`, foot: 'were not confirmed; see your statement' };
  return { h: 'Online account access is not available', p: html`${b.name} does not offer an online account, online bill payment, AutoPay sign-up or paperless billing on the web. ${c ? html`Charges from ${b.brand.shortName} are billed on <strong>${c.where}</strong> instead.` : 'Pay using one of the options below.'}`, foot: null };
}
const art = (vm, slug) => vm.help.some(a => a.slug === slug) ? vm.url('helpArticle', { slug }) : vm.url('help');

function shell(vm, title, body) {
  const b = vm.biller;
  return doc(vm, { title: `${title} | ${b.brand.shortName}`, bodyClass: 'offline', body: html`<header class="mast"><div class="col mast-row"><a class="brand" href="${vm.url('home')}">${logo(vm)}<span><strong>${b.name}</strong><small>${b.serviceArea ? b.serviceArea : 'Customer information'}</small></span></a>${b.phone ? html`<p class="callout">Questions? <strong>${b.phone}</strong></p>` : ''}</div>
    <nav class="col nav" aria-label="Site"><a href="${vm.url('home')}">${L(vm, 'home', 'Home')}</a><a href="${art(vm, 'pay-your-bill')}">Ways to Pay</a><a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact</a><a href="${vm.url('help')}">${L(vm, 'help', 'Customer Information')}</a></nav>${obsNav(vm)}</header>
    <main class="col">${alert(vm)}${body}</main>
    <footer class="foot"><div class="col"><p>${b.name}${b.parent ? ` · ${b.parent}` : ''}</p><p>${b.phone ? `Customer service ${b.phone}` : 'Contact information is printed on your statement.'}${b.mailAddress ? html` · Payments: ${b.mailAddress}` : ''}</p>${obsFooter(vm)}<p class="fine">This page lists offline payment options. ${status(vm).foot === 'does not bill customers directly' ? `${b.brand.shortName} does not bill customers directly.` : status(vm).foot ? `Online options for ${b.brand.shortName} were not confirmed; see your statement.` : `There is no online account login for this ${b.entityType && /coop/i.test(b.entityType) ? 'cooperative' : 'biller'}.`}</p></div></footer>` });
}

function stub(vm) {
  const b = vm.biller;
  return html`<figure class="stub" aria-label="Example payment stub"><div class="stub-cut">✂ Please detach and return this portion with your payment</div><div class="stub-grid"><div><span>Make checks payable to</span><strong>${b.brand.shortName}</strong></div><div><span>Account number</span><strong class="blank">from your statement</strong></div><div><span>${L(vm, 'dueDate', 'Due date')}</span><strong class="blank">see statement</strong></div><div><span>Amount enclosed</span><strong class="blank">$</strong></div></div><div class="stub-addr"><span>Remit to</span><strong>${b.mailAddress || 'Address printed on your statement'}</strong></div><figcaption>Example only. Always use the stub and envelope that came with your bill.</figcaption></figure>`;
}

function home(vm) {
  const b = vm.biller, p = profile(vm), c = consolidation(vm);
  const payArt = vm.help.find(a => a.slug === 'pay-your-bill');
  const st = status(vm);
  return shell(vm, 'Paying your bill', html`<h1>Paying your ${b.name} bill</h1>${heroLine(vm)}
    <section class="notice" role="note"><h2>${st.h}</h2><p>${st.p}</p></section>
    ${c ? html`<section class="box consolidated"><h2>Where do these charges appear?</h2><p>${b.brand.shortName} uses <strong>consolidated billing</strong>: its charges are printed as a line item on ${c.where}, and you pay that company — not ${b.brand.shortName} — the full amount due.</p>${c.detail.length ? html`<ul>${c.detail.map(s => html`<li>${s}</li>`)}</ul>` : ''}<ol class="steps"><li>Find the ${b.brand.shortName} section (often labelled “supplier” or “other charges”) on ${c.where}.</li><li>Pay the total on that bill by the method that company offers — online, by phone, by mail or in person.</li><li>Questions about the rate or cancelling service go to ${b.brand.shortName}${b.phone ? ` at ${b.phone}` : ''}; questions about paying go to the company that sends the bill.</li></ol></section>` : ''}
    <section class="ways"><h2>${c ? `If you receive a bill directly from ${b.brand.shortName}` : 'Ways to pay'}</h2>${c ? html`<p class="small">Most customers pay these charges through ${c.where}. Use these options only if ${b.brand.shortName} sends you its own statement.</p>` : ''}<div class="waygrid">
      <article class="way"><h3>By mail</h3><p>${b.mailAddress ? html`Send a check or money order payable to <strong>${b.brand.shortName}</strong> to:<br><span class="addr">${b.mailAddress}</span>` : 'Mail a check or money order with the payment stub to the remittance address printed on your statement.'}</p><p class="small">Write your account number on the check. Allow 5–7 days for delivery.</p>${!b.mailAddress ? html`<p class="tag">Typical option</p>` : ''}</article>
      <article class="way"><h3>By phone</h3><p>${b.payPhone ? html`Call <strong>${b.payPhone}</strong> to pay by phone.` : b.phone ? html`Call <strong>${b.phone}</strong> to ask about paying by phone.` : 'Call the customer service number printed on your statement.'}</p><p class="small">Have your account number and statement ready.</p>${!b.payPhone ? html`<p class="tag">Ask the office</p>` : ''}</article>
      <article class="way"><h3>In person</h3><p>${p.inPerson}</p><p class="tag">Typical option</p></article>
      <article class="way"><h3>Through your bank</h3><p>Your own bank’s online bill pay service can mail a check to ${b.brand.shortName} for you. Add the remittance address and your account number as the payee details.</p><p class="tag">Works with any biller that accepts checks</p></article>
    </div></section>
    <div class="two"><section class="box"><h2>Office hours</h2><table class="hours"><tbody><tr><th scope="row">Monday – Friday</th><td>8:00 a.m. – 4:30 p.m.</td></tr><tr><th scope="row">Saturday – Sunday</th><td>Closed</td></tr><tr><th scope="row">Holidays</th><td>Closed</td></tr></tbody></table><p class="small">Typical ${p.office} hours shown — hours vary by location. ${b.phone ? html`Call ${b.phone} to confirm.` : 'Check your statement or call before visiting.'}</p></section>
    <section class="box"><h2>Need help paying?</h2><p>${p.extra || 'Contact the office before your due date if you cannot pay the full amount.'}</p>${b.seniorPrograms ? html`<p><strong>Programs:</strong> ${b.seniorPrograms}</p>` : ''}${vm.help.some(x => x.slug === 'payment-assistance') ? html`<p><a href="${vm.url('helpArticle', { slug: 'payment-assistance' })}">Payment assistance information</a></p>` : html`<p><a href="${vm.url('help')}">${L(vm, 'help', 'All customer information')}</a></p>`}</section></div>
    <section class="box"><h2>Reading your bill</h2><p>Your paper statement is the official record of what you owe. The bottom portion is a payment stub — return it with your check so your payment is credited to the right account.</p>${stub(vm)}</section>
    ${payArt ? html`<section class="box"><h2>Payment details</h2>${helpBody(payArt)}</section>` : ''}
    <section class="box"><h2>Search customer information</h2>${helpSearchForm(vm, { placeholder: 'Search payment and contact information' })}</section>`);
}

function help(vm) {
  return shell(vm, 'Customer information', html`<h1>Customer information</h1><p class="lead">Online payments are not available for ${vm.biller.name} on this site. These pages explain how to pay and how to reach the ${profile(vm).office}.</p>${helpSearchForm(vm, { placeholder: 'Search payment and contact information' })}<section class="box">${helpList(vm)}</section>${helpExcerpts(vm)}`);
}

const pages = {
  home,
  help,
  helpArticle: vm => shell(vm, vm.article.title, html`<p class="crumbs"><a href="${vm.url('help')}">${L(vm, 'help', 'Customer information')}</a> › ${vm.article.title}</p><h1>${vm.article.title}</h1><section class="box">${helpBody(vm.article)}</section>${articleExcerpt(vm)}<p class="small">Online account access is not available. <a href="${vm.url('home')}">Back to ways to pay</a></p>`),
  helpSearch: vm => shell(vm, 'Search', html`<h1>Search results</h1>${helpSearchForm(vm, { placeholder: 'Search payment and contact information' })}${vm.results.length ? html`<section class="box">${helpList(vm, vm.results)}</section>` : html`<p>No information matches “${vm.query.q || ''}”. <a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact us</a>.</p>`}`)
};

// Account pages never reach this template for offline billers (the server redirects them home), but every
// canonical page renders the same informational home so a misrouted request still explains the situation.
export function render(page, vm) { vm = observe(vm); return finish(vm, (pages[page] || home)(vm)); }

export const css = `*{box-sizing:border-box}body{margin:0;font:17px/1.6 Georgia,"Times New Roman",serif;color:#2b2620;background:#faf7f0}a{color:#6b3410}a:hover{color:#2b2620}
.col{max-width:880px;margin:0 auto;padding:0 20px}
.mast{background:#fff;border-bottom:4px double var(--brand)}.mast-row{display:flex;justify-content:space-between;align-items:center;gap:18px;padding-top:18px;padding-bottom:14px;flex-wrap:wrap}.brand{display:flex;gap:14px;align-items:center;text-decoration:none;color:#2b2620}.brand strong{display:block;font-size:22px;line-height:1.2}.brand small{display:block;color:#6d655a;font-size:14px;font-family:Verdana,Arial,sans-serif}.logo{width:48px;height:48px}.callout{margin:0;font-family:Verdana,Arial,sans-serif;font-size:14px}
.nav{display:flex;gap:0;flex-wrap:wrap;font-family:Verdana,Arial,sans-serif;font-size:14px;padding-bottom:0}.nav a{padding:8px 14px;text-decoration:none;color:#2b2620;border:1px solid #d9d0bf;border-bottom:0;margin-right:4px;background:#f3eee2;border-radius:4px 4px 0 0}.nav a:hover{background:#fff}
main{padding-top:24px;padding-bottom:40px}h1{font-size:30px;font-weight:normal;margin:0 0 16px;border-bottom:1px solid #d9d0bf;padding-bottom:8px}h2{font-size:21px;font-weight:normal;margin:0 0 10px;color:var(--brand)}h3{font-family:Verdana,Arial,sans-serif;font-size:15px;margin:0 0 6px;text-transform:uppercase;letter-spacing:.5px}
.notice{background:#fff4d6;border:2px solid #d4a72c;padding:16px 20px;margin-bottom:20px}.notice h2{color:#7a4f00;margin-bottom:4px}
.box{background:#fff;border:1px solid #d9d0bf;padding:18px 22px;margin-bottom:20px}.consolidated{border-left:6px solid var(--brand)}
.waygrid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:22px}.way{background:#fff;border:1px solid #d9d0bf;padding:16px 18px}.addr{display:block;margin-top:6px;padding:8px 10px;background:#f3eee2;font-family:"Courier New",monospace;font-size:15px}.tag{display:inline-block;margin:4px 0 0;font:12px Verdana,Arial,sans-serif;color:#6d655a;border:1px solid #d9d0bf;padding:1px 6px;border-radius:3px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:20px}.two .box{margin-bottom:20px}.hours{width:100%;border-collapse:collapse;font-family:Verdana,Arial,sans-serif;font-size:14px}.hours th,.hours td{text-align:left;padding:6px 4px;border-bottom:1px dotted #cfc6b4;font-weight:normal}
.stub{margin:14px 0 0;border:2px dashed #8a8170;padding:14px 16px;background:#fdfcf8;font-family:Verdana,Arial,sans-serif;font-size:13px}.stub-cut{color:#6d655a;margin-bottom:10px}.stub-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.stub span{display:block;color:#6d655a;font-size:11px;text-transform:uppercase}.stub .blank{display:block;border-bottom:1px solid #8a8170;min-height:22px;color:#a39a88;font-weight:normal}.stub-addr{margin-top:12px}.stub figcaption{margin-top:10px;color:#6d655a;font-style:italic}
.lead{font-size:19px;color:#4d463c}.small{font-size:14px;color:#5c554a}.fine{font-size:12px;color:#8a8170}.crumbs{font:13px Verdana,Arial,sans-serif}.steps li,.help-list li{margin:5px 0}
.help-search{display:flex;gap:8px;margin:12px 0 18px}.help-search input{flex:1;padding:9px 10px;border:1px solid #8a8170;font:inherit;background:#fff}.btn{border:1px solid #6b3410;background:#6b3410;color:#fff;padding:8px 16px;font:14px Verdana,Arial,sans-serif;cursor:pointer}
.alert{padding:10px 14px;margin-bottom:14px;border:1px solid #d9d0bf;background:#fff}.alert-error{border-color:#b3261e;color:#8c1d18}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.foot{border-top:4px double var(--brand);background:#f3eee2;padding:18px 0;font-size:14px;font-family:Verdana,Arial,sans-serif}
@media(max-width:720px){.waygrid,.two,.stub-grid{grid-template-columns:1fr}}
@media(max-width:720px){.two>*,.waygrid>*{min-width:0}.table{display:block;overflow-x:auto;max-width:100%}dd{overflow-wrap:anywhere}}` + OBS_CSS;
