// County treasurer / tax collector property-tax payment site. Modeled on county "Pay your property
// taxes" portals (BS&A Online tax search, Iowa Tax & Tags, Tyler/Point & Pay treasurer sites): search by
// parcel number + owner name, a parcel tax summary with first-half / second-half installments, payment type
// choice (e-check no fee vs. card percentage fee), a cart-style checkout and a printable receipt.
import { payDate, html, raw, doc, logo, alert, form, field, select, button, hidden, dateField, table, paymentRows, helpList, helpBody, helpSearchForm, money, fmtDate, methodText, L } from '../kit.mjs';
import { applyProfile, siteNav, profileDocTitle, heroBanner, heroText, loginProfile, socialBlock, helpExcerpts, naNotice, PROFILE_CSS, mfaSent, mfaResend } from './_profile-parts.mjs';
import { offline, sup, isTax, cardFeeText, bankFeeText, methodFields, savedMethods, amountRadios, reviewRows, reviewForm, receiptRows, autopayBody, stepper } from './_municipal-portal-gov.mjs';

export const meta = {
  id: 'property-tax',
  // Where the dedicated tier's dossier nav (vm.nav) goes: the first element matching a selector (class:<token> or
  // aria:<label>) is re-filled with the dossier's items; observed real-site navs yield on public pages (server.mjs withDossierNav).
  navSlots: { public: ['class:tabs'], account: ['class:tabs'] },
  name: 'County property tax payments',
  description: 'County treasurer / tax collector property-tax portal: parcel search guest pay, tax bill with first- and second-half installments, e-check (no fee) vs. card (percentage service fee), cart-style checkout, My Properties account.',
  families: ['county-treasurer', 'bsa-online-tax', 'iowa-tax-and-tags', 'point-and-pay', 'grant-street', 'tyler-tax'],
  sources: [
    'https://www.clarkcountynv.gov/government/elected_officials/county_treasurer/real-property-tax-payment-options',
    'https://www.bsasoftware.com/solutions/bsaonline/bsa-online-services-public-records-search/',
    'https://www.bsaonline.com/Documents/bsao_makingpayment.pdf',
    'https://www.iowataxandtags.gov/ (via search result summaries of county payment pages)',
    'https://cuyahogacounty.gov/treasury/pay-your-taxes (search summary; direct fetch failed)'
  ],
  evidence: {
    observed_public: [
      'Treasurer pages state e-check payments are accepted without a fee while card payments carry a third-party service fee (Clark County NV)',
      'Parcel number formats such as "123-45-678-900" and search by parcel number or owner name',
      'County card fees are percentage-based with a minimum (e.g. 2.3% min $1.50, 2.22% min $1.49, 2.50% min $2.00)'
    ],
    documented: [
      'BS&A Online record search (All Records / Tax / Utility Billing), parcel summary with an amount box and "Make Payment"',
      'Iowa Tax & Tags flow: Pay Online → choose County and Tax Type → search by parcel number or owner name → choose payment option',
      'Property taxes billed in two installments (first half / second half) with separate due dates'
    ],
    synthetic: [
      'Exact labels for the signed-in "My Properties" account area, wallet, history and e-statements (most county sites have no login)',
      'Owner last name as the secondary lookup key (engine contract)',
      'Monogram seal instead of county seal; colours are the biller brand on a navy government header',
      'Automatic installment payments and e-statements pages shown only as informational when not documented for the county'
    ]
  }
};

export const routes = {
  home: '/', login: '/account/login', loginPassword: '/account/login/password', mfa: '/account/login/verify', register: '/account/register', verify: '/account/register/verify', forgot: '/account/forgot', reset: '/account/reset',
  guest: '/tax-search', guestPay: '/tax-search/parcel', guestReview: '/tax-search/checkout', guestReceipt: '/tax-search/receipt/:id',
  dashboard: '/my-properties', bill: '/my-properties/tax-bill', statements: '/my-properties/tax-bills', statement: '/my-properties/tax-bills/:id.pdf',
  pay: '/my-properties/pay', payMethod: '/my-properties/pay/payment-info', payReview: '/my-properties/pay/review', payReceipt: '/my-properties/pay/receipt/:id',
  history: '/my-properties/payment-history', autopay: '/my-properties/installment-autopay', paperless: '/my-properties/e-statements', wallet: '/my-properties/payment-methods', cancel: '/my-properties/remove-property', plan: '/my-properties/prepayment-plan',
  arrangement: '/my-properties/delinquent-payment-plan', contact: '/contact-treasurer', profile: '/account/settings', logout: '/account/logout',
  help: '/faq', helpArticle: '/faq/:slug', helpSearch: '/faq-search'
};
export const flow = { paySteps: ['pay', 'payMethod', 'payReview'], loginSteps: 1, guestSteps: ['guest', 'guestPay', 'guestReview'] };

const office = vm => /county/i.test(vm.biller.name) ? 'Treasurer & Tax Collector' : isTax(vm) ? 'Tax Office' : 'Online Payments';
const taxYear = vm => vm.account?.taxYear || 2026;
// "Payable" year follows the first installment's due date so the label never contradicts the due dates.
const payableYear = vm => { const i = (vm.account?.installments || [])[0]; return i ? new Date(i.dueAt).getUTCFullYear() : taxYear(vm); };
const yearText = vm => payableYear(vm) > taxYear(vm) ? `${taxYear(vm)} (payable ${payableYear(vm)})` : String(taxYear(vm));
const inst = vm => vm.account?.installments || [];
const parcelOf = vm => vm.account?.parcelId || vm.account?.accountNumber;
const amountLabels = vm => { const i = inst(vm).find(x => !x.paid); return { due: `Pay total balance due`, installment: i ? `${i.n === 1 ? 'First' : 'Second'} half installment` : 'Next installment', other: 'Pay a different amount' }; };

function header(vm) {
  const tabs = offline(vm) ? html`<a href="${vm.url('home')}">${L(vm, 'home', 'Home')}</a><a href="${vm.url('help')}">${L(vm, 'help', 'Payment information')}</a>` : vm.authenticated
    ? html`<a href="${vm.url('dashboard')}"${on(vm, ['dashboard', 'bill', 'statements'])}>${L(vm, 'dashboard', 'My Properties')}</a><a href="${vm.url('pay')}"${on(vm, ['pay', 'payMethod', 'payReview', 'payReceipt'])}>${L(vm, 'pay', 'Pay Taxes')}</a><a href="${vm.url('history')}"${on(vm, ['history'])}>${L(vm, 'history', 'Payment History')}</a><a href="${vm.url('wallet')}"${on(vm, ['wallet'])}>${L(vm, 'wallet', 'Payment Methods')}</a><a href="${vm.url('help')}"${on(vm, ['help', 'helpArticle', 'helpSearch'])}>${L(vm, 'help', 'FAQ')}</a>`
    : html`<a href="${vm.url('home')}"${on(vm, ['home'])}>${L(vm, 'home', 'Home')}</a><a href="${vm.url('guest')}"${on(vm, ['guest', 'guestPay', 'guestReview', 'guestReceipt'])}>${L(vm, 'guest', 'Search & Pay')}</a><a href="${vm.url('helpArticle', { slug: 'pay-your-bill' })}">Payment Options</a><a href="${vm.url('help')}"${on(vm, ['help', 'helpArticle', 'helpSearch'])}>${L(vm, 'help', 'FAQ')}</a>`;
  const acct = offline(vm) ? '' : vm.authenticated ? html`<span>Signed in as ${vm.persona.email}</span> <a href="${vm.url('profile')}">${L(vm, 'profile', 'Account Settings')}</a> <a href="${vm.url('logout')}">${L(vm, 'logout', 'Log Out')}</a>` : html`<a href="${vm.url('login')}">${L(vm, 'login', 'Log In')}</a> <a href="${vm.url('register')}">${L(vm, 'register', 'Create Account')}</a>`;
  return html`<div class="gov-strip"><span>Secure online property tax payments</span><span class="acct">${acct}</span></div><header class="mast"><a class="seal" href="${vm.url('home')}">${logo(vm, 'logo seal-logo')}<span><span class="t1">${vm.biller.brand.shortName}</span><span class="t2">${office(vm)} · Property Tax Payments</span></span></a></header><nav class="tabs" aria-label="Main">${tabs}</nav>${siteNav(vm, { cls: 'pf-nav-light' })}`;
}
const on = (vm, list) => list.includes(vm.page) ? raw(' class="on" aria-current="page"') : '';
function shell(vm, title, body, { side = true } = {}) {
  return doc(vm, { title: profileDocTitle(vm) || `${title} | ${vm.biller.brand.shortName} ${office(vm)}`, body: html`${header(vm)}<div class="wrap${side ? ' with-side' : ''}"><main id="main">${alert(vm)}${body}</main>${side ? sidebar(vm) : ''}</div><footer class="foot"><div class="wrap"><div><strong>${vm.biller.name}</strong>${vm.biller.mailAddress ? html`<br>Mail payments to: ${vm.biller.mailAddress}` : ''}${vm.biller.phone ? html`<br>Phone: ${vm.biller.phone}` : ''}</div><div><a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact the office</a> · <a href="${vm.url('help')}">${L(vm, 'help', 'Frequently asked questions')}</a> · <a href="${vm.url('helpArticle', { slug: 'pay-your-bill' })}">Ways to pay</a></div><p class="fine">Payments by card are processed by a third-party payment processor, which charges the service fee. The fee is non-refundable.</p></div></footer>` });
}
function sidebar(vm) {
  return html`<aside class="side"><section class="box"><h2>Fees</h2><table class="fees"><tr><th>E-Check</th><td>${bankFeeText(vm) === 'no fee' ? 'No fee' : bankFeeText(vm)}</td></tr><tr><th>Credit/Debit card</th><td>${cardFeeText(vm)}</td></tr></table></section><section class="box"><h2>Need help?</h2>${vm.biller.phone ? html`<p>Call ${vm.biller.phone}</p>` : html`<p>${vm.authenticated ? html`<a href="${vm.url('contact')}">Send a message to the office</a>` : 'Use the contact options below to reach the office.'}</p>`}<p><a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Office hours &amp; contact</a></p></section></aside>`;
}
const h1 = t => html`<h1>${t}</h1>`;
function instStatus(vm) {
  // Apply pending, then scheduled, payments to unpaid installments in order so the table shows what is already covered.
  let pending = (vm.pendingPayments || []).reduce((a, p) => a + p.amountCents, 0), sched = (vm.scheduled || []).reduce((a, p) => a + p.amountCents, 0);
  return inst(vm).map(i => {
    if (i.paid) return 'Paid';
    if (pending >= i.cents) { pending -= i.cents; return 'Payment pending'; }
    if (pending + sched >= i.cents) { sched -= i.cents - pending; pending = 0; return 'Unpaid – payment scheduled'; }
    return 'Unpaid';
  });
}
const installTable = vm => { const st = instStatus(vm); return table(['Installment', 'Due date', 'Amount', 'Status'], inst(vm).map((i, k) => [i.n === 1 ? 'First half' : 'Second half', fmtDate(i.dueAt), money(i.cents), st[k]]), 'table inst'); };
const upcoming = vm => { const list = [...(vm.scheduled || []), ...(vm.pendingPayments || [])]; return list.length ? html`<section class="box"><h2>Scheduled &amp; pending payments</h2>${table(['Payment date', 'Amount', 'Confirmation', 'Status'], list.map(p => [payDate(p), money(p.amountCents), p.confirmation, p.status === 'scheduled' ? 'Scheduled' : 'Pending']))}<p><a href="${vm.url('history')}">${L(vm, 'history', 'View or cancel scheduled payments')}</a></p></section>` : ''; };
const autopayShown = vm => sup(vm, 'autopay') || vm.autopay?.enrolled;
const parcelBox = vm => html`<table class="parcel"><tr><th>Parcel number</th><td>${parcelOf(vm)}</td></tr><tr><th>Owner</th><td>${vm.persona?.name || 'On file'}</td></tr><tr><th>Property address</th><td>${vm.account.serviceAddress}</td></tr><tr><th>Tax year</th><td>${yearText(vm)}</td></tr><tr><th>Total balance due</th><td><strong>${money(vm.balanceCents)}</strong></td></tr></table>`;

const pages = {
  home(vm) {
    if (offline(vm)) return shell(vm, 'Paying your tax bill', html`${h1(`Paying your ${vm.biller.name} bill`)}<p class="lead">Online payment is not available for this office. Pay using one of the methods below.</p><section class="box">${helpBody(vm.help.find(a => a.slug === 'pay-your-bill'))}</section>`);
    return shell(vm, 'Pay Property Taxes', html`${h1('Pay Property Taxes Online')}${heroBanner(vm)}<p class="lead">Search for your parcel to view your ${taxYear(vm)} tax bill and pay the first half, second half or the full year.</p><section class="search-hero"><h2>Search &amp; Pay</h2><p>You will need your <strong>parcel number</strong> (from your tax bill) and the owner's last name.</p><p><a class="btn btn-primary" href="${vm.url('guest')}">${L(vm, 'guest', 'Search by parcel number')}</a></p></section><div class="cols"><section class="box"><h2>Have an account?</h2><p>Save your properties, pay installments and see your payment history.</p><p><a class="btn" href="${vm.url('login')}">${L(vm, 'login', 'Log In')}</a> <a href="${vm.url('register')}">${L(vm, 'register', 'Create an account')}</a></p></section><section class="box"><h2>Important dates</h2><ul><li>First half taxes are due on the first installment date printed on your bill.</li><li>Second half taxes are due on the second installment date.</li><li>Payments made after the due date are subject to penalty and interest.</li></ul><p><a href="${vm.url('helpArticle', { slug: 'pay-your-bill' })}">All payment options</a></p></section></div><section class="box"><h2>Questions?</h2>${helpSearchForm(vm, { placeholder: 'Search FAQ' })}<p><a href="${vm.url('help')}">${L(vm, 'help', 'Browse all FAQ')}</a></p></section>`);
  },
  login(vm) { const lp = loginProfile(vm); return shell(vm, 'Log In', html`<section class="box narrow">${h1(L(vm, 'login', 'Log In'))}${form(vm, 'login', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'username', label: lp.userLabel === 'Account number' ? 'Account number or email address' : 'Email address or account number', autocomplete: 'username' })}${field(vm, { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' })}${button(lp.submit || 'Log In', { cls: 'btn btn-primary' })}`)}${socialBlock(vm)}<p><a href="${vm.url('forgot')}">${L(vm, 'forgot', 'Forgot your password?')}</a></p><p>New user? <a href="${vm.url('register')}">${L(vm, 'register', 'Create an account')}</a> · Or <a href="${vm.url('guest')}">${L(vm, 'guest', 'pay without logging in')}</a></p></section>`); },
  loginPassword(vm) { return pages.login(vm); },
  mfa(vm) { return shell(vm, 'Verification', html`<section class="box narrow">${h1('Enter verification code')}<p>${mfaSent(vm, 'For your security we emailed a 6-digit code to the address on your account.')}</p>${form(vm, 'mfa', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'code', label: 'Verification code', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' })}${button('Verify', { cls: 'btn btn-primary' })}`)}${mfaResend(vm)}</section>`); },
  register(vm) { return shell(vm, 'Create Account', html`<section class="box narrow">${h1(L(vm, 'register', 'Create an Account'))}<p>Link your property using the account number printed on your tax statement.</p>${form(vm, 'register', html`${field(vm, { name: 'accountNumber', label: 'Tax account number', inputmode: 'numeric' })}${field(vm, { name: 'lastName', label: 'Owner last name' })}${field(vm, { name: 'email', label: 'Email address', type: 'email', autocomplete: 'email' })}${field(vm, { name: 'password', label: 'Password', type: 'password', autocomplete: 'new-password', help: '8–64 characters with upper and lower case, a number and a symbol' })}${field(vm, { name: 'confirm', label: 'Confirm password', type: 'password', autocomplete: 'new-password' })}${button('Create Account', { cls: 'btn btn-primary' })}`)}</section>`); },
  verify(vm) { return shell(vm, 'Verify email', html`<section class="box narrow">${h1('Verify your email')}<p>Open the verification link we emailed to finish creating your account.</p></section>`); },
  forgot(vm) { return shell(vm, 'Forgot password', html`<section class="box narrow">${h1(L(vm, 'forgot', 'Forgot Password'))}${form(vm, 'forgot', html`${field(vm, { name: 'identifier', label: 'Email address', autocomplete: 'username' })}${button('Email me a reset code', { cls: 'btn btn-primary' })}`)}<p><a href="${vm.url('login')}">Return to Log In</a></p></section>`); },
  reset(vm) { return shell(vm, 'Reset password', html`<section class="box narrow">${h1('Reset Password')}${form(vm, 'reset', html`${vm.query.token ? hidden('token', vm.query.token) : field(vm, { name: 'code', label: 'Reset code from email', inputmode: 'numeric', autocomplete: 'one-time-code' })}${field(vm, { name: 'password', label: 'New password', type: 'password', autocomplete: 'new-password' })}${field(vm, { name: 'confirm', label: 'Confirm new password', type: 'password', autocomplete: 'new-password' })}${button('Reset Password', { cls: 'btn btn-primary' })}`)}</section>`); },

  guest(vm) {
    return shell(vm, 'Property Tax Search', html`${stepper(['Search', 'Select amount & pay', 'Review', 'Receipt'], 0)}${h1(L(vm, 'guest', 'Property Tax Search'))}<section class="box">${form(vm, 'guest', html`<div class="search-grid">${field(vm, { name: 'parcelId', label: isTax(vm) ? 'Parcel number' : 'Account number', placeholder: isTax(vm) ? '12-345-67-890.000' : '', help: isTax(vm) ? 'Enter the parcel number exactly as shown on your tax bill, including dashes.' : 'Enter the account number shown on your bill.' })}${field(vm, { name: 'lastName', label: 'Owner last name' })}</div>${button('Search', { cls: 'btn btn-primary' })}`)}</section><p class="muted">Don't know your parcel number? It is printed on your tax statement and assessment notice. Owners can also <a href="${vm.url('login')}">${L(vm, 'login', 'log in')}</a> to see saved properties.</p>`);
  },
  guestPay(vm) {
    return shell(vm, 'Parcel tax summary', html`${stepper(['Search', 'Select amount & pay', 'Review', 'Receipt'], 1)}${h1(`Parcel ${parcelOf(vm)}`)}<section class="box">${parcelBox(vm)}${inst(vm).length ? html`<h2>Installments</h2>${installTable(vm)}` : ''}</section><section class="box">${form(vm, 'guestPay', html`${amountRadios(vm, amountLabels(vm), 'Select amount to pay')}<fieldset><legend>Payment type</legend>${methodFields(vm, { typeLabel: 'Pay by', bankLabel: `E-Check (${bankFeeText(vm)})`, cardLabel: `Credit/Debit card (${cardFeeText(vm)})`, save: false, cardNameLabel: 'Cardholder name' })}</fieldset>${button('Continue to checkout', { cls: 'btn btn-primary' })} <a class="btn" href="${vm.url('guest')}">${L(vm, 'guest', 'New search')}</a>`)}</section>`);
  },
  guestReview(vm) { return reviewPage(vm, 'guestReview'); },
  guestReceipt(vm) { return receiptPage(vm); },

  dashboard(vm) {
    return shell(vm, 'My Properties', html`${h1('My Properties')}${vm.pendingPayments.length ? html`<p class="note">${vm.pendingPayments.length} payment(s) pending. E-check payments post in 2–3 business days.</p>` : ''}<section class="box prop"><div class="prop-head"><div><h2>Parcel ${parcelOf(vm)}</h2><p>${vm.account.serviceAddress}</p></div><div class="bal"><span>Total due</span><strong>${money(vm.balanceCents)}</strong></div></div>${inst(vm).length ? installTable(vm) : html`<p>Due ${vm.dueText}</p>`}<p class="btns"><a class="btn btn-primary" href="${vm.url('pay')}">${L(vm, 'pay', 'Pay taxes')}</a> <a class="btn" href="${vm.url('bill')}">${L(vm, 'bill', 'View tax bill')}</a> <a class="btn" href="${vm.url('statements')}">${L(vm, 'statements', 'Prior years & statements')}</a></p></section>${upcoming(vm)}<section class="box"><h2>Account options</h2><ul class="opts"><li><a href="${vm.url('history')}">${L(vm, 'history', 'Payment history')}</a></li><li><a href="${vm.url('wallet')}">${L(vm, 'wallet', 'Saved payment methods')}</a></li>${autopayShown(vm) ? html`<li><a href="${vm.url('autopay')}">${L(vm, 'autopay', 'Automatic installment payments')}</a> – ${vm.autopay.enrolled ? 'on' : 'off'}</li>` : ''}<li><a href="${vm.url('paperless')}">${L(vm, 'paperless', 'E-statements')}</a> – ${vm.account.paperless ? 'on' : 'off'}</li><li><a href="${vm.url('plan')}">${L(vm, 'plan', 'Prepayment plan')}</a></li><li><a href="${vm.url('arrangement')}">${L(vm, 'arrangement', 'Delinquent tax payment plan')}</a></li><li><a href="${vm.url('contact')}">${L(vm, 'contact', 'Contact the treasurer')}</a></li>${sup(vm, 'cancel_service') ? html`<li><a href="${vm.url('cancel')}">${L(vm, 'cancel', 'Close account')}</a></li>` : ''}</ul></section>`);
  },
  bill(vm) {
    const inv = vm.invoice;
    return shell(vm, 'Tax bill', html`<p class="crumbs"><a href="${vm.url('dashboard')}">${L(vm, 'dashboard', 'My Properties')}</a> › Tax bill</p>${h1(`${taxYear(vm)} Tax Bill`)}<section class="box">${parcelBox(vm)}<h2>Tax detail</h2>${table(['Description', 'Amount'], [...inv.lines.map(l => [l.desc, money(l.cents)]), [html`<strong>Total tax</strong>`, html`<strong>${money(inv.amountCents)}</strong>`]])}${inst(vm).length ? html`<h2>Installments</h2>${installTable(vm)}` : html`<p>Due ${fmtDate(inv.dueAt)}</p>`}<p class="btns"><a class="btn btn-primary" href="${vm.url('pay')}">${L(vm, 'pay', 'Pay now')}</a> <a class="btn" href="${vm.url('statement', { id: inv.id })}">Print tax bill (PDF)</a></p></section>`);
  },
  statements(vm) { return shell(vm, 'Tax statements', html`${h1(L(vm, 'statements', 'Tax Statements'))}<section class="box">${table(['Statement date', 'Statement #', 'Amount', 'Due', ''], vm.invoices.map(i => [fmtDate(i.issuedAt), i.number, money(i.amountCents), fmtDate(i.dueAt), html`<a href="${vm.url('statement', { id: i.id })}">View PDF</a>`]))}</section>`); },
  pay(vm) {
    return shell(vm, 'Pay taxes', html`${stepper(['Select amount', 'Payment information', 'Review & submit', 'Receipt'], 0)}${h1(L(vm, 'pay', 'Pay Taxes'))}${vm.scheduled?.length ? html`<p class="note">You already have ${vm.scheduled.length} scheduled payment(s) totaling ${money(vm.scheduled.reduce((a, p) => a + p.amountCents, 0))}. <a href="${vm.url('history')}">${L(vm, 'history', 'Review scheduled payments')}</a> before paying again.</p>` : ''}<section class="box">${parcelBox(vm)}${form(vm, 'pay', html`${amountRadios(vm, amountLabels(vm), 'Select amount to pay')}${dateField(vm, { label: 'Payment date (you may post-date up to the due date)' })}${button('Add to cart & continue', { cls: 'btn btn-primary' })}`)}</section>`);
  },
  payMethod(vm) {
    return shell(vm, 'Payment information', html`${stepper(['Select amount', 'Payment information', 'Review & submit', 'Receipt'], 1)}${h1('Payment Information')}<section class="box"><table class="cart"><tr><th>Cart</th><td>Parcel ${parcelOf(vm)} · ${taxYear(vm)} taxes</td><td class="num">${vm.draft?.amountCents ? money(vm.draft.amountCents) : ''}</td></tr></table><p><a href="${vm.url('pay')}">Change amount</a></p>${form(vm, 'payMethod', html`${savedMethods(vm, { legend: 'Pay with', newLabel: 'Use a different e-check or card', fields: { typeLabel: 'Pay by', bankLabel: `E-Check (${bankFeeText(vm)})`, cardLabel: `Credit/Debit card (${cardFeeText(vm)})` } })}<p class="note">Card payments: ${/^no /.test(cardFeeText(vm)) ? cardFeeText(vm) : `${cardFeeText(vm)}, charged by the payment processor`}. E-check: ${bankFeeText(vm)}.</p>${button('Continue to review', { cls: 'btn btn-primary' })}`)}</section>`);
  },
  payReview(vm) { return reviewPage(vm, 'payReview'); },
  payReceipt(vm) { return receiptPage(vm); },
  history(vm) { return shell(vm, 'Payment history', html`${h1(L(vm, 'history', 'Payment History'))}<section class="box">${table(['Date', 'Amount', 'Paid with', 'Confirmation', 'Status', ''], paymentRows(vm))}</section>`, { side: false }); },
  autopay(vm) {
    return shell(vm, 'Automatic installment payments', html`<section class="box">${autopayBody(vm, { title: 'Automatic Installment Payments', intro: 'Have each installment withdrawn automatically from your bank account on its due date.', offLabel: 'This office does not offer automatic installment payments online.', methodsBlock: savedMethods(vm, { legend: 'Withdraw from', fields: { save: false } }), policyOptions: [['full', 'Each installment amount'], ['fixed', 'Fixed monthly prepayment']] })}</section>`);
  },
  paperless(vm) {
    if (!sup(vm, 'paperless')) return shell(vm, 'E-statements', html`<section class="box">${h1(L(vm, 'paperless', 'E-Statements'))}<p>Tax statements are mailed to the owner of record each year. Electronic statements are not offered online for this office.</p><p><a href="${vm.url('statements')}">${L(vm, 'statements', 'View past statements')}</a></p></section>`);
    return shell(vm, 'E-statements', html`<section class="box">${h1('E-Statements')}<p>E-statements are <strong>${vm.account.paperless ? 'on' : 'off'}</strong>.</p>${form(vm, 'paperless', html`${hidden('paperless', vm.account.paperless ? 'off' : 'on')}${!vm.account.paperless ? field(vm, { name: 'email', label: 'Email for tax statements', type: 'email', value: vm.persona.email }) : ''}${button(vm.account.paperless ? 'Resume mailed statements' : 'Sign up for e-statements', { cls: 'btn btn-primary' })}`)}</section>`);
  },
  wallet(vm) { return shell(vm, 'Payment methods', html`${h1(L(vm, 'wallet', 'Saved Payment Methods'))}<section class="box"><ul class="wallet">${vm.methods.map(m => html`<li><span>${methodText(m)}</span>${form(vm, 'wallet', html`${hidden('op', 'remove')}${hidden('methodId', m.id)}<button type="submit" class="btn btn-link" aria-label="Remove ${methodText(m)}">Remove</button>`)}</li>`)}</ul></section><section class="box"><h2>Add a payment method</h2>${form(vm, 'wallet', html`${hidden('op', 'add')}${methodFields(vm, { typeLabel: 'Type', bankLabel: 'E-Check (bank account)', cardLabel: 'Credit/Debit card', save: false })}${field(vm, { name: 'nickname', label: 'Nickname (optional)', required: false })}${button('Save', { cls: 'btn btn-primary' })}`)}</section>`); },
  cancel(vm) { return shell(vm, 'Remove property', html`<section class="box">${h1(L(vm, 'cancel', 'Remove a Property'))}<p>Property tax accounts cannot be closed. Taxes follow the parcel; if you sold the property, the new owner of record receives future bills. To remove this parcel from your online profile or report a sale, contact the office${vm.biller.phone ? ` at ${vm.biller.phone}` : ''}.</p><p><a href="${vm.url('contact')}">${L(vm, 'contact', 'Contact the treasurer')}</a></p></section>`); },
  plan(vm) { return shell(vm, 'Prepayment plan', html`<section class="box">${h1(L(vm, 'plan', 'Prepayment Plan'))}<p>Some counties accept monthly prepayments toward next year's taxes. Make a payment for any amount using <strong>Pay a different amount</strong>; it is applied to your next unpaid installment.</p><p><a class="btn btn-primary" href="${vm.url('pay')}">${L(vm, 'pay', 'Make a prepayment')}</a></p></section>`); },
  arrangement(vm) { return shell(vm, 'Delinquent tax payment plan', html`<section class="box">${h1(L(vm, 'arrangement', 'Delinquent Tax Payment Plan'))}${vm.account.arrangement ? html`<p>Your plan: ${money(vm.account.arrangement.monthlyCents)} per month for ${vm.account.arrangement.months} months. Interest continues to accrue on unpaid delinquent taxes.</p>` : form(vm, 'arrangement', html`<p>Enter into a payment agreement for your balance of ${money(vm.balanceCents)}. Interest continues to accrue until paid in full.</p>${select(vm, { name: 'months', label: 'Number of monthly payments', options: [['3', '3'], ['6', '6'], ['12', '12']] })}${button('Request payment plan', { cls: 'btn btn-primary' })}`)}</section>`); },
  contact(vm) { return shell(vm, 'Contact the treasurer', html`<section class="box">${h1(L(vm, 'contact', 'Contact the Treasurer'))}${vm.account.messages.length ? html`<ul>${vm.account.messages.map(m => html`<li>${fmtDate(m.at)} – ${m.subject} (${m.status})</li>`)}</ul>` : ''}${form(vm, 'contact', html`${field(vm, { name: 'subject', label: 'Subject', value: vm.values.subject ?? `Parcel ${parcelOf(vm)}` })}<div class="field"><label for="f-message">Message</label><textarea id="f-message" name="message" required>${vm.values.message || ''}</textarea></div>${button('Send message', { cls: 'btn btn-primary' })}`)}</section>`); },
  profile(vm) { return shell(vm, 'Account settings', html`<section class="box">${h1(L(vm, 'profile', 'Account Settings'))}<table class="parcel"><tr><th>Name</th><td>${vm.persona.name}</td></tr><tr><th>Email</th><td>${vm.persona.email}</td></tr><tr><th>Phone</th><td>${vm.account.phone || 'Not provided'}</td></tr></table>${form(vm, 'profile', html`${field(vm, { name: 'phone', label: 'Phone number', type: 'tel' })}${button('Save', { cls: 'btn btn-primary' })}`)}</section>`); },
  help(vm) { return shell(vm, 'FAQ', html`${h1(L(vm, 'help', 'Frequently Asked Questions'))}${helpSearchForm(vm, { placeholder: 'Search FAQ' })}<section class="box">${helpList(vm)}</section>${helpExcerpts(vm)}`); },
  helpArticle(vm) { return shell(vm, vm.article.title, html`<p class="crumbs"><a href="${vm.url('help')}">${L(vm, 'help', 'FAQ')}</a> › ${vm.article.title}</p>${h1(vm.article.title)}<section class="box">${helpBody(vm.article)}</section>${helpExcerpts(vm, vm.article.slug)}${helpSearchForm(vm, { placeholder: 'Search FAQ' })}`); },
  helpSearch(vm) { return shell(vm, 'Search FAQ', html`${h1('Search FAQ')}${naNotice(vm)}${helpSearchForm(vm, { placeholder: 'Search FAQ' })}<section class="box">${vm.results.length ? helpList(vm, vm.results) : html`<p>No results for “${vm.query.q || ''}”.</p>`}</section>`); }
};

function reviewPage(vm, page) {
  const guest = page === 'guestReview';
  return shell(vm, 'Review & submit', html`${stepper(guest ? ['Search', 'Select amount & pay', 'Review', 'Receipt'] : ['Select amount', 'Payment information', 'Review & submit', 'Receipt'], 2)}${h1('Review & Submit')}<section class="box">${reviewRows(vm, { amountLabel: 'Tax payment', feeLabel: 'Service fee (payment processor)', totalLabel: 'Total to be charged', methodLabel: 'Pay by', extra: [['Parcel', parcelOf(vm)], ['Tax year', String(taxYear(vm))]] })}${reviewForm(vm, page, { terms: `I authorize this payment and understand the service fee is non-refundable. ${vm.draft?.payOn ? `This payment is scheduled for ${fmtDate(Date.parse(`${vm.draft.payOn}T17:00:00Z`))} and is credited on that date.` : 'Payments are credited on the date submitted.'}`, submit: 'Submit payment', edit: 'Change payment' })}</section>`);
}
function receiptPage(vm) {
  const p = vm.payment;
  return shell(vm, 'Receipt', html`${h1(p.status === 'scheduled' ? 'Payment Scheduled' : 'Payment Receipt')}<section class="box receipt"><p>Thank you. Keep this receipt for your records.</p>${receiptRows(vm, { extra: [['Parcel', parcelOf(vm)], ['Tax year', String(taxYear(vm))]] })}<p class="btns">${vm.authenticated ? html`<a class="btn btn-primary" href="${vm.url('dashboard')}">Return to My Properties</a>` : html`<a class="btn btn-primary" href="${vm.url('home')}">Done</a> <a class="btn" href="${vm.url('guest')}">Pay another parcel</a>`}</p></section>`);
}

export function render(page, vm) { const fn = pages[page]; if (!fn) throw new Error(`property-tax cannot render ${page}`); return fn(applyProfile(vm)); }

export const css = `*{box-sizing:border-box}body{margin:0;font:15px/1.55 Georgia,"Times New Roman",serif;color:#1b1b1b;background:#f1f1ec}a{color:#1d4f91}
.gov-strip{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;background:#1b1b1b;color:#ddd;font:12px/1.4 Arial,Helvetica,sans-serif;padding:6px 24px}.gov-strip a{color:#fff;margin-left:12px}
.mast{background:#13294b;border-bottom:4px solid var(--brand);padding:16px 24px}.seal{display:flex;align-items:center;gap:14px;text-decoration:none;color:#fff}.seal-logo{width:58px;height:58px;border-radius:50%;border:3px solid #c9a227;background:#fff}.t1{display:block;font-size:24px;font-weight:700}.t2{display:block;font:14px Arial,Helvetica,sans-serif;color:#c9d3e3;letter-spacing:.04em;text-transform:uppercase}
.tabs{display:flex;flex-wrap:wrap;background:#e4e2d8;border-bottom:1px solid #c8c5b8;padding:0 16px;font-family:Arial,Helvetica,sans-serif}.tabs a{padding:11px 16px;color:#13294b;text-decoration:none;font-weight:700;font-size:14px;border-bottom:3px solid transparent}.tabs a:hover{background:#d9d6ca}.tabs a.on{border-bottom-color:#c9a227;background:#fff}
.wrap{max-width:1100px;margin:0 auto;padding:24px 16px}.with-side{display:grid;grid-template-columns:1fr 280px;gap:24px;align-items:start}
h1{font-size:28px;color:#13294b;margin:0 0 14px;font-weight:700}h2{font-size:19px;color:#13294b;margin:0 0 10px}.lead{font-size:17px}
.box{background:#fff;border:1px solid #cfcbbd;padding:20px 22px;margin-bottom:18px}.narrow{max-width:460px}.side .box{font-family:Arial,Helvetica,sans-serif;font-size:14px}
.search-hero{background:#fff;border:1px solid #cfcbbd;border-top:5px solid #c9a227;padding:24px;margin-bottom:18px}.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.btn{display:inline-block;font:700 14px Arial,Helvetica,sans-serif;padding:10px 20px;border:2px solid #13294b;background:#fff;color:#13294b;text-decoration:none;cursor:pointer;border-radius:2px}.btn-primary{background:#13294b;color:#fff}.btn-primary:hover{background:#0b1a33}.btn-link{border:0;background:none;padding:0;color:#1d4f91;text-decoration:underline}.btn-danger{background:#a61b1b;border-color:#a61b1b;color:#fff}
.field{margin:12px 0;font-family:Arial,Helvetica,sans-serif}.field label{display:block;font-weight:700;font-size:14px;margin-bottom:4px}.field input,.field select,.field textarea{width:100%;max-width:440px;padding:9px;border:1px solid #6b6b6b;font:15px Arial,Helvetica,sans-serif;background:#fff}.field textarea{min-height:110px}.help{display:block;color:#555;font-size:12px}
.search-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
fieldset{border:1px solid #cfcbbd;padding:12px 16px;margin:14px 0;font-family:Arial,Helvetica,sans-serif}legend{font-weight:700;color:#13294b}.radio,.check{display:block;margin:9px 0;font-family:Arial,Helvetica,sans-serif}.other-amount{width:120px;padding:5px;border:1px solid #6b6b6b}.amt{margin-left:6px}.fee-tag{font-size:12px;color:#555;margin-left:6px}
.pm-new .bank-fields,.pm-new .card-fields{display:none}.pm-new:has(select[name=methodType] option[value=bank]:checked) .bank-fields{display:block}.pm-new:has(select[name=methodType] option[value=card]:checked) .card-fields{display:block}.row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
details summary{cursor:pointer;color:#1d4f91;font-weight:700;margin:8px 0;font-family:Arial,Helvetica,sans-serif}.actions{margin-top:14px;display:flex;gap:10px}.edit-form{margin-top:10px}
.alert{padding:12px 16px;margin-bottom:16px;font-family:Arial,Helvetica,sans-serif}.alert-error{background:#fbe9e9;border:2px solid #a61b1b;color:#7a1212}.alert-ok{background:#eaf4e6;border:2px solid #3d7a2a;color:#24521a}
.table,.parcel,.cart,.fees{width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:14px;margin:8px 0 14px}.table th{background:#13294b;color:#fff;text-align:left;padding:8px}.table td{padding:8px;border-bottom:1px solid #ddd}.table tr:nth-child(even) td{background:#f7f6f1}.table form{display:inline}
.parcel th,.cart th,.fees th{text-align:left;width:40%;padding:7px 8px;background:#f1efe6;border:1px solid #ddd;font-weight:700}.parcel td,.cart td,.fees td{padding:7px 8px;border:1px solid #ddd}.num{text-align:right}
.review{display:grid;grid-template-columns:max-content 1fr;gap:8px 24px;font-family:Arial,Helvetica,sans-serif}.review dt{font-weight:700}.review dd{margin:0}.conf{font-size:18px}
.stepper{display:flex;list-style:none;padding:0;margin:0 0 18px;font:13px Arial,Helvetica,sans-serif;border:1px solid #cfcbbd;background:#fff}.stepper li{flex:1;padding:9px 12px;color:#777;border-right:1px solid #cfcbbd}.stepper li:last-child{border-right:0}.stepper .current{background:#13294b;color:#fff;font-weight:700}.stepper .done{color:#13294b}.stepper .n{font-weight:700;margin-right:4px}
.prop-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.bal{text-align:right;font-family:Arial,Helvetica,sans-serif}.bal span{display:block;font-size:13px;color:#555}.bal strong{font-size:28px;color:#13294b}.btns{margin-top:12px}.opts li{margin:6px 0}
.note{background:#fff8dc;border:1px solid #e3cf7a;padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px}.muted{color:#555}.crumbs{font:13px Arial,Helvetica,sans-serif}
.wallet{list-style:none;padding:0}.wallet li{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #ddd;font-family:Arial,Helvetica,sans-serif}.wallet form{display:inline}
.help-search{display:flex;gap:8px;margin:12px 0;max-width:560px}.help-search input{flex:1;padding:9px;border:1px solid #6b6b6b;font:15px Arial,Helvetica,sans-serif}.help-list li{margin:7px 0}.steps li{margin:4px 0}
.foot{background:#13294b;color:#dfe5ef;font:13px/1.6 Arial,Helvetica,sans-serif}.foot .wrap{display:block}.foot a{color:#fff}.fine{color:#aab6cc;font-size:12px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.with-side>*{min-width:0}.parcel td,.parcel th{overflow-wrap:anywhere}
@media(max-width:600px){.table{display:block;overflow-x:auto;max-width:100%}.gov-strip{padding:6px 12px}}
@media(max-width:820px){.with-side,.cols,.search-grid{grid-template-columns:minmax(0,1fr)}.stepper{flex-direction:column}.stepper li{border-right:0;border-bottom:1px solid #cfcbbd}}
${PROFILE_CSS}
`;
