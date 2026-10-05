// Invoice Cloud: hosted "Pay or View Bills" portal used by municipalities and water/sewer/tax billers.
// Public landing mirrors the City & Borough of Juneau capture (billworld/captures/juneau-portal); signed-in
// screens follow the InvoiceCloud Customer Portal Manual (Account At A Glance, Pay My Invoices -> Pay Selected ->
// Proceed to Payment -> Continue to Payment Information -> Process Payment, + New AutoPay Setup, Paperless).
import { html, raw, doc, logo, alert, form, field, select, checkbox, button, hidden, amountChooser, methodChooser, newMethodFields, dateField, table, paymentRows, helpList, helpBody, helpSearchForm, money, fmtDate, methodText, statusLabel } from '../kit.mjs';
import { payNotice, payRows, payDate, fmtPayOn, scrollTable, balanceTable, billingCss } from './_generic-billing.mjs';
import { profileTitle, profileHero, profileNavBar, profileLogin, socialRow, profileHelpExcerpts, profileArticleExcerpt, themedVm, profileCss, mfaSent, mfaResend } from './generic.mjs';

export const meta = {
  id: 'invoicecloud',
  name: 'Invoice Cloud',
  description: 'Municipal/utility invoice portal: invoice-type tiles, One Time Pay invoice search (account number + last name), Account At A Glance, Pay My Invoices wizard ending in Process Payment, AutoPay setups and Paperless enrollment under My Profile.',
  families: ['invoicecloud'],
  sources: [
    'https://www.invoicecloud.com/portal/(S(...))/2/Site.aspx?G=... (City & Borough of Juneau, captured in billworld/captures/juneau-portal)',
    'https://clvhts.authoritypay.com/reports/print/12 (InvoiceCloud Customer Portal Manual)',
    'https://pu.virginiabeach.gov/customer-service/payment-portal',
    'https://www.kkw.org/invoicecloud-faqs'
  ],
  evidence: {
    observed_public: [
      'Landing "Pay or View Bills" / "Please select an item to get started." with invoice-type pill buttons on a dark blue band (Water/Sewer, Business Property Taxes, Real Property Tax, Miscellaneous Billing ...) (captures/juneau-portal)',
      'Header with biller logo left and "Sign In" / "Contact Us" right; right rail "Need Help?" with phone/email and "How does it work?" (captures/juneau-portal)',
      'Fee notice paragraph, "Pay online" accepted-method badges, three columns "Fast and easy" (No registration is required for One Time Pay), "Safe and secure", "Eco-friendly" (captures/juneau-portal)',
      'Footer: Invoice Cloud wordmark, Privacy Policy, Accessibility (captures/juneau-portal)'
    ],
    documented: [
      'Sign In / Forgot your Password? -> Recover My Password (Customer Portal Manual)',
      'Registration: search by account number or last name -> Search Invoices -> Register Customer -> Email, Confirm Email, Password, Confirm Password -> Complete Registration (Manual)',
      'Your Account At A Glance: Pay Invoices, Recent Open Invoices, Recent Closed Invoices, Recent Payments, Upcoming Scheduled Payments, AutoPay / Paperless / Pay By Text status (Manual)',
      'Pay My Invoices -> select invoice -> Pay Selected -> Pay Today or Schedule a Payment -> Proceed to Payment -> payment method + amount -> Continue to Payment Information -> agree to terms -> Process Payment (Manual)',
      'AutoPay: + New AutoPay Setup, choose Payment Method, "Yes, put me on AutoPay", Save this AutoPay Setup (Manual)',
      'Paperless: select Yes for the account, agree to Payer Terms, Save my Changes (Manual); My Account / My Profile / Support top menus (Manual)',
      'Registration not required for One Time Payments; AutoPay and Paperless require registration (city FAQs)'
    ],
    synthetic: [
      'ASPX-style URL paths (real portal uses session-cookieless /portal/(S(id))/2/*.aspx URLs that cannot be reproduced statically)',
      'Colours and spacing approximated from the Juneau screenshot; accepted-method badges rendered as text chips',
      'Guest lookup requires both account number and last name (real search accepts either)',
      'Pay By Text shown as status only; Stop Service, Payment Plan and Contact Us message pages',
      'Confirm Email on registration omitted (engine has no field); paperless enrollment uses a single Save my Changes button instead of a Yes/No per account'
    ]
  }
};

const P = '/portal';
export const routes = {
  home: '/', login: `${P}/Site/Login.aspx`, loginPassword: `${P}/Site/LoginPassword.aspx`, mfa: `${P}/Site/VerifyIdentity.aspx`, register: `${P}/Site/RegisterCustomer.aspx`, verify: `${P}/Site/VerifyEmail.aspx`, forgot: `${P}/Site/RecoverPassword.aspx`, reset: `${P}/Site/ResetPassword.aspx`,
  guest: `${P}/Site/CustomerLocator.aspx`, guestPay: `${P}/Site/SearchResults.aspx`, guestReview: `${P}/Site/ReviewPayment.aspx`, guestReceipt: `${P}/Site/PaymentConfirmation/:id`,
  dashboard: `${P}/Customer/AccountAtAGlance.aspx`, bill: `${P}/Customer/InvoiceDetail.aspx`, statements: `${P}/Customer/ClosedInvoices.aspx`, statement: `${P}/Customer/Invoice/:id.pdf`,
  pay: `${P}/Customer/PayInvoices.aspx`, payMethod: `${P}/Customer/PaymentMethod.aspx`, payReview: `${P}/Customer/PaymentInformation.aspx`, payReceipt: `${P}/Customer/PaymentConfirmation/:id`,
  history: `${P}/Customer/PaymentHistory.aspx`, autopay: `${P}/Customer/AutoPay.aspx`, paperless: `${P}/Customer/Paperless.aspx`, wallet: `${P}/Customer/PaymentMethods.aspx`,
  cancel: `${P}/Customer/StopService.aspx`, plan: `${P}/Customer/ServicePlan.aspx`, arrangement: `${P}/Customer/PaymentPlan.aspx`, contact: `${P}/Customer/ContactUs.aspx`, profile: `${P}/Customer/MyProfile.aspx`, logout: `${P}/Site/SignOut.aspx`,
  help: `${P}/Support`, helpArticle: `${P}/Support/:slug`, helpSearch: `${P}/SupportSearch`
};
export const flow = { paySteps: ['pay', 'payMethod', 'payReview'], loginSteps: 1, guestSteps: ['guest', 'guestPay', 'guestReview'] };

const offline = vm => vm.biller.capabilities.online_account.support === 'unsupported';
const TYPE = { water: 'Water/Sewer', sewer: 'Water/Sewer', electric: 'Electric', gas: 'Gas', trash: 'Solid Waste', 'property-tax': 'Real Property Tax', 'income-tax': 'Income Tax', 'vehicle-registration': 'Motor Vehicle Excise' };
const invoiceType = vm => TYPE[vm.biller.billType] || (vm.biller.kind === 'tax' ? 'Real Property Tax' : vm.biller.kind === 'utility' ? 'Utility Billing' : vm.biller.kind === 'insurance' ? 'Premium Billing' : 'Billing');
const isTax = vm => vm.biller.kind === 'tax';
const acctLabel = vm => isTax(vm) ? 'Account or Bill Number' : 'Account Number';
const feeText = vm => { const f = vm.biller.fees; return f.cardPercent != null ? `A service fee of ${f.cardPercent}% applies to credit and debit card payments. Customers paying with eCheck (ACH) are not subject to a service fee.` : f.cardCents ? `A service fee of ${money(f.cardCents)} applies to card payments. eCheck (ACH) payments have no service fee.` : f.cardCents === 0 ? 'There is no service fee to pay online.' : 'A convenience fee may apply to card payments. eCheck (ACH) payments are free.'; };

const helpRail = vm => html`<aside class="rail"><h2>Need Help?</h2>${vm.biller.phone ? html`<p>You may reach us at ${vm.biller.phone}.</p>` : html`<p>Call the number printed on your bill.</p>`}${vm.biller.payPhone ? html`<p>Pay by phone 24/7: ${vm.biller.payPhone}.</p>` : ''}<p><a class="ext" href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact Us</a></p><p><a class="how" href="${vm.url('help')}"><span aria-hidden="true">?</span> How does it work?</a></p></aside>`;
const footer = vm => html`<footer class="ic-foot"><span class="ic-word">Invoice<b>Cloud</b></span><span>Payments are subject to the Invoice Cloud Payer Terms and Conditions and Privacy Policy.</span><a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact ${vm.biller.brand.shortName}</a></footer>`;

function header(vm) {
  if (!vm.authenticated) return html`<header class="ic-top"><div class="ic-wrap"><a class="ic-brand" href="${vm.url('home')}">${logo(vm)}<span>${vm.biller.brand.shortName}</span></a>${offline(vm) ? '' : html`<nav class="ic-links" aria-label="Site"><a href="${vm.url('login')}">Sign In</a><a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact Us</a></nav>`}</div>${profileNavBar(vm, { cls: 'pf-site ic-site' })}</header>`;
  const dd = (label, items) => html`<details class="dd"><summary>${label}</summary><div class="dd-menu">${items.map(([page, text]) => html`<a href="${vm.url(page)}">${text}</a>`)}</div></details>`;
  const c = vm.biller.capabilities;
  return html`<header class="ic-top"><div class="ic-wrap"><a class="ic-brand" href="${vm.url('dashboard')}">${logo(vm)}<span>${vm.biller.brand.shortName}</span></a><nav class="ic-links" aria-label="Account"><a class="home-ico" href="${vm.url('dashboard')}" aria-label="Your Account At A Glance">⌂</a>${dd('My Account', [['pay', 'View or Pay Open Invoices'], ['statements', 'View Paid or Closed Invoices'], ['history', 'View Scheduled Payments'], ['history', 'View Payment History']])}${dd('My Profile', [...(c.autopay.support === 'supported' ? [['autopay', 'AutoPay']] : []), ...(c.paperless.support === 'supported' ? [['paperless', 'Paperless']] : []), ['wallet', 'Payment Methods'], ['profile', 'Update User Information'], ['arrangement', 'Payment Plan']])}<a href="${vm.url('help')}">Support</a><a href="${vm.url('logout')}">Sign Out</a></nav></div></header>`;
}

function shell(vm, title, body, { rail = true, h1 = title, fullTitle } = {}) {
  return doc(vm, { title: fullTitle || `${title} - ${vm.biller.brand.shortName} - Invoice Cloud`, bodyClass: 'ic', body: html`${header(vm)}<div class="ic-wrap ic-cols"><main class="ic-main">${h1 ? html`<div class="ic-head"><h1>${h1}</h1></div>` : ''}${alert(vm)}<div class="ic-body">${body}</div></main>${rail ? helpRail(vm) : ''}</div><div class="ic-wrap">${footer(vm)}</div>` });
}
const btn = (label, cls = 'icbtn') => button(label, { cls });
const linkBtn = (href, label, cls = 'icbtn') => html`<a class="${cls}" href="${href}">${label}</a>`;
const panel = (title, inner, cls = '') => html`<section class="pnl ${cls}">${title ? html`<h2>${title}</h2>` : ''}${inner}</section>`;

const pages = {
  home(vm) {
    if (offline(vm)) return shell(vm, 'Paying your bill', html`<p class="lead">Online account access and online bill payment are not available for this biller.</p>${helpBody(vm.help.find(a => a.slug === 'pay-your-bill'))}${vm.biller.phone ? html`<p>Questions? Call <strong>${vm.biller.phone}</strong>.</p>` : html`<p>Use the contact information printed on your paper bill.</p>`}<p><a href="${vm.url('help')}">How does it work?</a></p>`, { h1: `Paying your ${vm.biller.name} bill` });
    const types = [invoiceType(vm), 'Miscellaneous Payments'];
    const hero = profileHero(vm);
    return shell(vm, 'Pay or View Bills', html`${hero ? html`<p class="pf-hero">${hero}</p>` : ''}<p class="sub">Please select an item to get started.</p><div class="tiles">${types.map(t => html`<a class="tile" href="${vm.url('guest')}">${t} <span aria-hidden="true">›</span></a>`)}</div><div class="intro"><p>${vm.biller.name} is excited to offer an easy and convenient way to view and pay your ${invoiceType(vm) === 'Billing' ? '' : `${invoiceType(vm).toLowerCase()} `}bills online.</p>${vm.biller.payPhone ? html`<p>You may also make a payment by phone 24/7 by dialing ${vm.biller.payPhone}.</p>` : ''}<p>${feeText(vm)}</p><p class="reg">Registered customers: <a href="${vm.url('login')}">Sign In</a> or <a href="${vm.url('register')}">Register Now</a> to view all invoices, go paperless, schedule payments and sign up for AutoPay.</p></div><div class="payonline"><h2>Pay online</h2><ul class="chips">${['VISA', 'Mastercard', 'DISCOVER', 'AMEX', 'eCheck'].map(c => html`<li>${c}</li>`)}</ul></div><div class="three"><div><h3>Fast and easy</h3><p>No registration is required for “One Time Pay.” The fastest way to pay online and confirm payment.</p></div><div><h3>Safe and secure</h3><p>Your information is kept confidential, secure, and backed by the highest security standards.</p></div><div><h3>Eco-friendly</h3><p>Paying online reduces paper use and is an easy way to help the environment.</p></div></div>`, { h1: 'Pay or View Bills', fullTitle: profileTitle(vm, 'website', null) });
  },
  login(vm) {
    const lp = profileLogin(vm, { idLabel: 'Email Address', submit: 'Sign In' });
    const signIn = html`${form(vm, 'login', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'username', label: lp.idLabel, autocomplete: 'username' })}${field(vm, { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' })}<div class="row-actions">${btn(lp.submit)}<a href="${vm.url('forgot')}">Forgot your Password?</a></div>`)}${socialRow(vm)}`;
    return shell(vm, 'Sign In', html`${panel('', signIn, 'narrow')}${panel('New here?', html`<p>Paying without an account? Choose <a href="${vm.url('guest')}">One Time Pay</a>.</p><p><a href="${vm.url('register')}">Register Now</a> to view all of your invoices, go paperless and sign up for AutoPay.</p>`, 'narrow muted-pnl')}`, { fullTitle: profileTitle(vm, 'login', null) });
  },
  loginPassword(vm) { return pages.login(vm); },
  mfa(vm) { return shell(vm, 'Verify Your Identity', panel('', html`<p>${mfaSent(vm, 'For your security we emailed a 6-digit verification code to the address on your profile.')}</p>${form(vm, 'mfa', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'code', label: 'Verification Code', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' })}${btn('Verify')}`)}${mfaResend(vm, { cls: 'linkbtn' })}`, 'narrow')); },
  register(vm) {
    return shell(vm, 'Register Customer', panel('', html`<p>Enter the ${acctLabel(vm).toLowerCase()} and last name exactly as they appear on your ${invoiceType(vm)} invoice, then create your login.</p>${form(vm, 'register', html`<fieldset><legend>Find your account</legend>${field(vm, { name: 'accountNumber', label: acctLabel(vm), inputmode: 'numeric' })}${field(vm, { name: 'lastName', label: 'Last Name' })}</fieldset><fieldset><legend>Create your login</legend>${field(vm, { name: 'email', label: 'Email Address', type: 'email', autocomplete: 'email' })}${field(vm, { name: 'password', label: 'Password', type: 'password', autocomplete: 'new-password', help: '8+ characters with upper and lower case letters, a number and a symbol.' })}${field(vm, { name: 'confirm', label: 'Confirm Password', type: 'password', autocomplete: 'new-password' })}</fieldset>${btn('Complete Registration')}`)}`, 'narrow'));
  },
  verify(vm) { return shell(vm, 'Verify Email', panel('', html`<p>We sent a verification link to your email address. Open it to activate your account, then <a href="${vm.url('login')}">Sign In</a>.</p>`, 'narrow')); },
  forgot(vm) { return shell(vm, 'Forgot your Password?', panel('', html`<p>Enter the email address you registered with. We'll email you a verification code to reset your password.</p>${form(vm, 'forgot', html`${field(vm, { name: 'identifier', label: 'Email Address', autocomplete: 'username' })}${btn('Recover My Password')}`)}<p><a href="${vm.url('login')}">Back to Sign In</a></p>`, 'narrow')); },
  reset(vm) { return shell(vm, 'Reset Password', panel('', form(vm, 'reset', html`${vm.query.token ? hidden('token', vm.query.token) : field(vm, { name: 'code', label: 'Verification Code', inputmode: 'numeric', autocomplete: 'one-time-code' })}${field(vm, { name: 'password', label: 'New Password', type: 'password', autocomplete: 'new-password' })}${field(vm, { name: 'confirm', label: 'Confirm New Password', type: 'password', autocomplete: 'new-password' })}${btn('Save Password')}`), 'narrow')); },
  guest(vm) {
    return shell(vm, invoiceType(vm), html`<p class="sub">Search for your invoice. No registration is required for One Time Pay.</p>${panel('', form(vm, 'guest', html`<div class="grid2">${field(vm, { name: 'accountNumber', label: acctLabel(vm), inputmode: 'numeric' })}${field(vm, { name: 'lastName', label: 'Last Name' })}</div>${btn('Search Invoices')}`))}<p class="muted">Your ${acctLabel(vm).toLowerCase()} is printed at the top of your invoice. Already registered? <a href="${vm.url('login')}">Sign In</a></p>`, { h1: `${invoiceType(vm)}` });
  },
  guestPay(vm) {
    return shell(vm, 'Search Results', html`${payNotice(vm)}${scrollTable('Invoice search results', ['Account', 'Invoice Type', 'Due Date', 'Balance'], [[vm.accountMasked, invoiceType(vm), vm.dueText, money(vm.balanceCents)]], 'table ictable')}${form(vm, 'guestPay', html`${amountChooser(vm, { labels: { legend: 'Payment Amount', due: 'Pay invoice balance' } })}<fieldset class="methods"><legend>Payment Information</legend>${newMethodFields(vm)}</fieldset>${btn('Continue to Payment Information')}`)}`, { h1: 'Search Results' });
  },
  guestReview(vm) { return reviewPage(vm, 'guestReview'); },
  guestReceipt(vm) { return receiptPage(vm); },

  dashboard(vm) {
    const c = vm.biller.capabilities, inv = vm.invoice;
    const open = vm.invoices.filter(i => i.balanceCents > 0), closed = vm.invoices.filter(i => i.balanceCents <= 0).slice(0, 3);
    const recent = vm.account.payments.filter(p => p.status !== 'scheduled').slice(-3).reverse();
    const status = (label, on, page) => html`<a class="status ${on ? 'on' : ''}" href="${vm.url(page)}"><span class="st-lbl">${label}</span><span class="st-val">${on ? 'Enrolled' : 'Not Enrolled'}</span></a>`;
    return shell(vm, 'Your Account At A Glance', html`<div class="glance-top"><div><p class="who">${vm.persona.name}</p><p class="muted">${invoiceType(vm)} · Account ${vm.accountMasked} · ${vm.account.serviceAddress}</p></div>${linkBtn(vm.url('pay'), 'Pay Invoices')}</div><div class="status-row">${c.autopay.support === 'supported' ? status('AutoPay', vm.autopay.enrolled, 'autopay') : ''}${c.paperless.support === 'supported' ? status('Paperless', vm.account.paperless, 'paperless') : ''}<span class="status"><span class="st-lbl">Pay By Text</span><span class="st-val">Not Enrolled</span></span></div>${panel('Recent Open Invoices', scrollTable('Recent open invoices', ['Invoice', 'Due Date', 'Amount', 'Balance', 'Action'], open.map(i => [i.number, fmtDate(i.dueAt), money(i.amountCents), money(i.balanceCents), html`<a href="${vm.url('bill')}">View</a> · <a href="${vm.url('pay')}">Pay</a>`]), 'table ictable'))}${panel('Upcoming Scheduled Payments', vm.scheduled.length ? html`${scrollTable('Upcoming scheduled payments', ['Date', 'Amount', 'Method'], vm.scheduled.map(p => [fmtPayOn(p.payOn), money(p.amountCents), `****${p.methodLast4}`]), 'table ictable')}<p><a href="${vm.url('history')}">Manage scheduled payments</a></p>` : html`<p class="muted">No scheduled payments.</p>`)}<div class="grid2">${panel('Recent Closed Invoices', html`${scrollTable('Recent closed invoices', ['Invoice', 'Date', 'Amount'], closed.map(i => [i.number, fmtDate(i.issuedAt), money(i.amountCents)]), 'table ictable')}<p><a href="${vm.url('statements')}">View Paid or Closed Invoices</a></p>`)}${panel('Recent Payments', html`${scrollTable('Recent payments', ['Date', 'Amount', 'Status'], recent.map(p => [fmtDate(p.createdAt), money(p.amountCents), statusLabel(p.status)]), 'table ictable')}<p><a href="${vm.url('history')}">View Payment History</a></p>`)}</div>${panel('Manage', html`<ul class="manage"><li><a href="${vm.url('wallet')}">Payment Methods</a></li><li><a href="${vm.url('profile')}">Update User Information</a></li><li><a href="${vm.url('arrangement')}">Payment Plan</a></li>${vm.plans?.length ? html`<li><a href="${vm.url('plan')}">Service Plan</a></li>` : ''}${c.cancel_service.support === 'supported' ? html`<li><a href="${vm.url('cancel')}">${vm.biller.kind === 'utility' ? 'Stop Service' : 'Close Account'}</a></li>` : ''}<li><a href="${vm.url('contact')}">Contact ${vm.biller.brand.shortName}</a></li></ul>`)}<p class="muted">Total balance due: <strong>${money(vm.balanceCents)}</strong> (current invoice ${inv.number}, ${money(inv.amountCents)}, due ${vm.dueText})</p>`, { rail: false });
  },
  bill(vm) { const inv = vm.invoice; return shell(vm, 'Invoice Detail', html`<dl class="kv"><dt>Invoice Number</dt><dd>${inv.number}</dd><dt>Invoice Type</dt><dd>${invoiceType(vm)}</dd><dt>Billing Period</dt><dd>${inv.period}</dd><dt>Due Date</dt><dd>${fmtDate(inv.dueAt)}</dd></dl>${scrollTable('Invoice charges', ['Description', 'Amount'], [...inv.lines.map(l => [l.desc, money(l.cents)]), [html`<strong>Invoice Total</strong>`, html`<strong>${money(inv.amountCents)}</strong>`]], 'table ictable')}${balanceTable(vm, { statement: 'Invoice total', pastDue: 'Prior invoices past due', posted: 'Payments applied', pending: 'Payments processing', balance: 'Balance due' })}<p>Balance due: <strong>${money(vm.balanceCents)}</strong></p>${vm.scheduled.length ? html`<p class="muted">${vm.scheduled.length} scheduled payment(s) totalling ${money(vm.scheduled.reduce((a, p) => a + p.amountCents, 0))} · <a href="${vm.url('history')}">View Scheduled Payments</a></p>` : ''}<p>${linkBtn(vm.url('pay'), 'Pay Invoices')} ${linkBtn(vm.url('statement', { id: inv.id }), 'View Invoice (PDF)', 'icbtn ghost')}</p>`, { rail: false }); },
  statements(vm) { return shell(vm, 'Paid or Closed Invoices', scrollTable('Invoices', ['Invoice', 'Invoice Date', 'Due Date', 'Amount', 'Status', 'Invoice PDF'], vm.invoices.map(i => [i.number, fmtDate(i.issuedAt), fmtDate(i.dueAt), money(i.amountCents), i.balanceCents > 0 ? 'Open' : 'Closed', html`<a href="${vm.url('statement', { id: i.id })}">View Invoice</a>`]), 'table ictable'), { rail: false }); },
  pay(vm) {
    return shell(vm, 'Pay My Invoices', html`${wizard(1)}${payNotice(vm)}${form(vm, 'pay', html`<p>Select the invoice you need to pay.</p>${scrollTable('Open invoice', ['Account', 'Invoice Type', 'Due Date', 'Balance'], [[vm.accountMasked, invoiceType(vm), vm.dueText, money(vm.balanceCents)]], 'table ictable')}${amountChooser(vm, { labels: { legend: 'Pay Selected', due: `Invoice ${vm.invoice.number} balance` } })}<fieldset><legend>Pay Today or Schedule a Payment</legend>${dateField(vm, { label: 'Payment Date (leave as today to Pay Today)' })}</fieldset>${btn('Proceed to Payment')}`)}`, { rail: false });
  },
  payMethod(vm) {
    const d = vm.draft;
    return shell(vm, 'Payment Method', html`${wizard(2)}<p>Paying <strong>${d?.amountCents ? money(d.amountCents) : '—'}</strong>${d?.payOn ? ` on ${fmtPayOn(d.payOn)}` : ' today'} · <a href="${vm.url('pay')}">Change</a></p>${form(vm, 'payMethod', html`${methodChooser(vm, { title: 'Confirm your payment method' })}${btn('Continue to Payment Information')}`)}`, { rail: false });
  },
  payReview(vm) { return reviewPage(vm, 'payReview'); },
  payReceipt(vm) { return receiptPage(vm); },
  history(vm) { return shell(vm, 'Payment History', html`<p class="muted">Scheduled payments can be cancelled until they begin processing.</p>${scrollTable('Payment history', ['Date', 'Amount', 'Method', 'Confirmation', 'Status', 'Action'], payRows(vm), 'table ictable')}`, { rail: false }); },
  autopay(vm) {
    const ap = vm.autopay;
    const rows = ap.enrolled ? [[vm.accountMasked, invoiceType(vm), vm.autopayMethod ? methodText(vm.autopayMethod) : 'Saved method', ap.policy === 'fixed' ? money(ap.fixedCents) : 'Invoice balance', form(vm, 'autopay', html`${hidden('action', 'cancel')}${checkbox(vm, { name: 'confirm', label: 'Stop AutoPay for this account' })}${button('Remove', { cls: 'icbtn small danger' })}`)]] : [];
    return shell(vm, 'AutoPay', html`<p>AutoPay pays each new invoice automatically on its due date.</p>${scrollTable('AutoPay setups', ['Account', 'Invoice Type', 'Payment Method', 'Amount', 'Action'], rows, 'table ictable')}<details class="setup"${ap.enrolled ? '' : raw(' open')}><summary>+ New AutoPay Setup</summary>${form(vm, 'autopay', html`${hidden('action', 'enroll')}${hidden('policy', 'full')}<p>Account <strong>${vm.accountMasked}</strong> · Invoice Type <strong>${invoiceType(vm)}</strong></p>${methodChooser(vm, { title: 'Payment Method' })}${checkbox(vm, { name: 'acceptTerms', label: 'Yes, put me on AutoPay. By enabling AutoPay, I agree to the Invoice Cloud Payer Terms and Conditions.' })}${btn('Save this AutoPay Setup')}`)}</details>`, { rail: false });
  },
  paperless(vm) {
    return shell(vm, 'Paperless', html`${scrollTable('Paperless status', ['Account', 'Invoice Type', 'Paperless'], [[vm.accountMasked, invoiceType(vm), vm.account.paperless ? 'Yes' : 'No']], 'table ictable')}${form(vm, 'paperless', html`${hidden('paperless', vm.account.paperless ? 'off' : 'on')}${!vm.account.paperless ? html`<p>Select <strong>Save my Changes</strong> to receive Paperless statements by email instead of paper invoices. By saving, you agree to the Invoice Cloud Payer Terms and Conditions.</p>${field(vm, { name: 'email', label: 'Email Address for invoice notices', type: 'email', value: vm.persona.email })}` : html`<p>You receive Paperless statements at ${vm.persona.email}. Save to switch back to paper invoices.</p>`}${btn(vm.account.paperless ? 'Save my Changes (return to paper)' : 'Save my Changes')}`)}`, { rail: false });
  },
  wallet(vm) {
    return shell(vm, 'Payment Methods', html`${scrollTable('Saved payment methods', ['Payment Method', 'Nickname', 'Action'], vm.methods.map(m => [methodText(m), m.nickname || '', form(vm, 'wallet', html`${hidden('op', 'remove')}${hidden('methodId', m.id)}${button('Delete', { cls: 'linkish' })}`)]), 'table ictable')}<details class="setup"><summary>+ Add New Credit/Debit Card or Bank</summary>${form(vm, 'wallet', html`${hidden('op', 'add')}${newMethodFields(vm)}${field(vm, { name: 'nickname', label: 'Nickname (optional)', required: false })}${btn('Save')}`)}</details>`, { rail: false });
  },
  cancel(vm) {
    const label = vm.biller.kind === 'utility' ? 'Stop Service' : 'Close Account', noun = vm.biller.kind === 'utility' ? 'service' : 'account';
    if (vm.service.status !== 'active' && vm.step !== 'done') return shell(vm, label, html`<p>Your ${noun} ${vm.service.status === 'cancel_pending' ? `is scheduled to end on ${fmtDate(vm.service.cancelAt)}` : 'is closed'}.</p>${vm.service.status === 'cancel_pending' ? form(vm, 'cancel', html`${hidden('step', 'undo')}${btn('Withdraw Request')}`) : ''}`, { rail: false });
    const s = {
      reason: form(vm, 'cancel', html`${hidden('step', 'reason')}${select(vm, { name: 'reason', label: 'Reason', options: [['', 'Select…'], ['moving', 'Moving / selling property'], ['cost', 'Cost'], ['switching', 'Switching providers'], ['other', 'Other']] })}${btn('Continue')}`),
      offer: html`<p>Before you go: keep your ${noun} at 50% off for 3 months.</p>${form(vm, 'cancel', html`${hidden('step', 'offer')}${button('Accept Offer', { cls: 'icbtn', name: 'accept', value: 'yes' })} ${button('No Thanks', { cls: 'icbtn ghost', name: 'accept', value: 'no' })}`)}`,
      confirm: form(vm, 'cancel', html`<p>A final invoice will be sent to your mailing address.</p>${hidden('step', 'confirm')}${dateField(vm, { name: 'effectiveDate', label: 'Stop Date' })}${checkbox(vm, { name: 'confirm', label: `I want to ${label.toLowerCase()} on this date.` })}${btn(`Submit ${label} Request`, 'icbtn danger')}`),
      done: html`<p>Your ${noun} will end on <strong>${vm.service.cancelAt ? fmtDate(vm.service.cancelAt) : ''}</strong>. Confirmation number <strong>${vm.service.confirmation || ''}</strong>.</p>`,
      kept: html`<p>Thanks for staying. Your discount has been applied.</p>`
    };
    return shell(vm, label, s[vm.step], { rail: false });
  },
  plan(vm) { return shell(vm, 'Service Plan', vm.plans.length ? form(vm, 'plan', html`<fieldset><legend>Choose a plan</legend>${vm.plans.map(p => html`<label class="radio"><input type="radio" name="planId" value="${p.id}"${p.current ? raw(' checked') : ''}> ${p.name}${p.cents ? ` – ${money(p.cents)}/mo` : ''}${p.current ? ' (current)' : ''}</label>`)}</fieldset>${btn('Save my Changes')}`) : html`<p>Plan changes are not available online.</p>`, { rail: false }); },
  arrangement(vm) { return shell(vm, 'Payment Plan', vm.account.arrangement ? html`<p>You're paying ${money(vm.account.arrangement.monthlyCents)} per month for ${vm.account.arrangement.months} months.</p>` : form(vm, 'arrangement', html`<p>Spread your balance of ${money(vm.balanceCents)} over monthly payments.</p>${select(vm, { name: 'months', label: 'Number of months', options: [['3', '3 months'], ['6', '6 months'], ['12', '12 months']] })}${btn('Request Payment Plan')}`), { rail: false }); },
  contact(vm) { return shell(vm, 'Contact Us', html`${vm.account.messages.length ? html`<ul>${vm.account.messages.map(m => html`<li>${fmtDate(m.at)} – ${m.subject} (${m.status})</li>`)}</ul>` : ''}${form(vm, 'contact', html`${field(vm, { name: 'subject', label: 'Subject' })}<div class="field"><label for="f-message">Message</label><textarea id="f-message" name="message" required>${vm.values.message || ''}</textarea></div>${btn('Send')}`)}`); },
  profile(vm) { return shell(vm, 'My Profile', html`<dl class="kv"><dt>Name</dt><dd>${vm.persona.name}</dd><dt>Email Address</dt><dd>${vm.persona.email}</dd><dt>Phone</dt><dd>${vm.account.phone || 'Not provided'}</dd></dl>${form(vm, 'profile', html`${field(vm, { name: 'phone', label: 'Phone Number', type: 'tel' })}${btn('Save my Changes')}`)}<ul class="manage"><li><a href="${vm.url('wallet')}">Payment Methods</a></li><li><a href="${vm.url('autopay')}">AutoPay</a></li><li><a href="${vm.url('paperless')}">Paperless</a></li></ul>`, { rail: false }); },
  help(vm) { return shell(vm, 'Support', html`${helpSearchForm(vm, { placeholder: 'Search support topics' })}${helpList(vm)}${profileHelpExcerpts(vm)}`, { h1: 'How does it work?' }); },
  helpArticle(vm) { return shell(vm, vm.article.title, html`<p class="crumb"><a href="${vm.url('help')}">Support</a> ›</p>${helpBody(vm.article)}${profileArticleExcerpt(vm, vm.article)}`); },
  helpSearch(vm) { return shell(vm, 'Support', html`${helpSearchForm(vm, { placeholder: 'Search support topics' })}${vm.results.length ? helpList(vm, vm.results) : html`<p>No topics match “${vm.query.q || ''}”.</p>`}`, { h1: 'Search Results' }); }
};

const wizard = n => html`<ol class="wiz">${['Select Invoices', 'Payment Method', 'Payment Information'].map((s, i) => html`<li class="${i + 1 === n ? 'on' : ''}">${s}</li>`)}</ol>`;

function reviewPage(vm, page) {
  const d = vm.draft;
  return shell(vm, 'Payment Information', html`${page === 'payReview' ? wizard(3) : ''}<p>Review your payment information.</p><dl class="kv"><dt>Invoice Type</dt><dd>${invoiceType(vm)}</dd><dt>Account</dt><dd>${vm.accountMasked}</dd><dt>Payment Amount</dt><dd>${money(d.amountCents)}</dd>${d.feeCents ? html`<dt>Service Fee</dt><dd>${money(d.feeCents)}</dd>` : ''}<dt>Total</dt><dd><strong>${money(d.totalCents)}</strong></dd><dt>Payment Method</dt><dd>${methodText(d.method)}</dd><dt>Payment Date</dt><dd>${d.payOn ? fmtPayOn(d.payOn) : 'Today'}</dd></dl>${form(vm, page, html`${hidden('token', d.token)}${hidden('op', 'submit')}${checkbox(vm, { name: 'acceptTerms', label: 'I agree to the Invoice Cloud Payer Terms and Conditions and authorize this payment.' })}${btn('Process Payment')}`)}${page === 'payReview' ? form(vm, page, html`${hidden('op', 'edit')}${button('Back', { cls: 'linkish' })}`) : ''}`, { rail: false });
}
function receiptPage(vm) {
  const p = vm.payment;
  return shell(vm, 'Payment Confirmation', html`<div class="success">${p.status === 'scheduled' ? 'Your payment has been scheduled.' : 'Thank you! Your payment has been processed.'}</div><dl class="kv"><dt>Confirmation Number</dt><dd><strong>${p.confirmation}</strong></dd><dt>Amount</dt><dd>${money(p.amountCents)}</dd>${p.feeCents ? html`<dt>Service Fee</dt><dd>${money(p.feeCents)}</dd>` : ''}<dt>Payment Method</dt><dd>${vm.paymentMethod ? methodText(vm.paymentMethod) : `****${p.methodLast4}`}</dd><dt>Payment Date</dt><dd>${payDate(p)}</dd><dt>Status</dt><dd>${statusLabel(p.status)}</dd></dl><p>A receipt was emailed to you.</p>${vm.authenticated ? html`<p><a href="${vm.url('dashboard')}">Return to Your Account At A Glance</a> · <a href="${vm.url('history')}">Payment History</a></p>` : html`<p><a href="${vm.url('home')}">Done</a> · <a href="${vm.url('register')}">Register to enroll in AutoPay and Paperless</a></p>`}`, { rail: false });
}

export function render(page, vm) { const fn = pages[page]; if (!fn) throw new Error(`invoicecloud template cannot render ${page}`); return fn(themedVm(vm)); }

export const css = `*{box-sizing:border-box}body{margin:0;font:15px/1.6 "Helvetica Neue",Helvetica,Arial,sans-serif;color:#333;background:#ebebeb}a{color:#1a4d8f}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.ic-wrap{max-width:1140px;margin:0 auto;padding:0 16px}
.ic-top{background:#fff;border-bottom:1px solid #d6d6d6}.ic-top .ic-wrap{display:flex;justify-content:space-between;align-items:flex-end;min-height:98px;padding-bottom:16px}
.ic-brand{display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--brand);font-size:24px;font-weight:300;letter-spacing:.3px}.ic-brand .logo{width:58px;height:58px}
.ic-links{display:flex;gap:28px;align-items:center}.ic-links>a,.dd summary{color:#444;font-weight:700;text-decoration:none;font-size:16px;cursor:pointer}.ic-links>a:hover,.dd summary:hover{color:var(--brand)}.home-ico{font-size:22px!important;line-height:1}
.dd{position:relative}.dd summary{list-style:none}.dd summary::-webkit-details-marker{display:none}.dd summary::after{content:" ▾";font-size:12px}
.dd-menu{position:absolute;right:0;top:30px;background:#fff;border:1px solid #ccc;box-shadow:0 4px 12px rgba(0,0,0,.15);min-width:240px;z-index:5;padding:6px 0}.dd-menu a{display:block;padding:8px 16px;color:#333;text-decoration:none;font-size:14px}.dd-menu a:hover{background:#f0f4f9}
.ic-cols{display:flex;gap:16px;align-items:flex-start;padding-top:32px}
.ic-main{flex:1;min-width:0;background:#fff}.ic-head{padding:22px 24px 0}.ic-head h1{font-size:30px;font-weight:400;margin:0;color:#333}
.ic-body{padding:12px 24px 28px}.sub{font-size:17px;margin:4px 0 16px}
.rail{width:260px;flex:none;padding:8px 0}.rail h2{font-size:16px;margin:12px 0}.rail p{margin:0 0 14px}.how span{display:inline-flex;width:18px;height:18px;border-radius:50%;background:#f0a020;color:#fff;font-size:12px;font-weight:700;align-items:center;justify-content:center;margin-right:4px}.how{font-weight:700;color:#333;text-decoration:none}.ext{font-weight:700;text-decoration:none}
.tiles{background:var(--brand);margin:0 -24px;padding:28px 20px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.tile{display:flex;justify-content:center;align-items:center;gap:10px;border:2px solid #fff;border-radius:24px;color:#fff;text-decoration:none;font-size:18px;padding:9px 16px;text-align:center;min-height:46px}.tile:hover{background:rgba(255,255,255,.12)}.tile span{font-weight:700;font-size:22px}
.intro{font-size:14px;padding:18px 0;border-bottom:1px solid #ddd}.reg{background:#f4f7fb;padding:10px 12px;border-left:3px solid var(--brand)}
.payonline{text-align:center;padding:18px 0;border-bottom:1px solid #ddd}.payonline h2{font-size:20px;margin:0 0 12px}.chips{display:flex;justify-content:center;gap:8px;list-style:none;padding:0;margin:0;flex-wrap:wrap}.chips li{border:1px solid #ccc;border-radius:3px;padding:6px 10px;font-weight:700;font-size:13px;color:#1a3d7c;background:#fff;min-width:64px}
.three{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding-top:20px}.three h3{font-size:20px;margin:0 0 6px}.three p{margin:0;font-size:16px}
.ic-foot{display:flex;flex-wrap:wrap;align-items:center;gap:12px 24px;padding:22px 0 40px;color:#555}.ic-foot a{color:#444}.ic-word{font-size:20px;color:#666;padding-right:24px;border-right:1px solid #bbb}.ic-word b{font-weight:400;color:#555}
.pnl{border:1px solid #ddd;border-radius:3px;padding:16px 18px;margin:0 0 16px;background:#fff}.pnl h2{font-size:17px;margin:0 0 10px;color:#1a3d6b}.pnl.narrow{max-width:460px}.muted-pnl{background:#f7f7f7}
.field{margin:12px 0}.field label{display:block;font-weight:700;font-size:13px;margin-bottom:4px}.field input,.field select,.field textarea{width:100%;padding:9px 10px;border:1px solid #aaa;border-radius:2px;font:inherit}.field textarea{min-height:110px}.help{color:#666;font-size:12px}
fieldset{border:1px solid #ddd;padding:10px 16px;margin:14px 0}legend{font-weight:700;color:#1a3d6b}.radio,.check{display:block;margin:8px 0}.other-amount{width:120px;padding:4px 6px}
.icbtn{display:inline-block;background:var(--brand);color:#fff;border:2px solid var(--brand);border-radius:22px;padding:8px 22px;font:700 15px "Helvetica Neue",Arial,sans-serif;text-decoration:none;cursor:pointer}.icbtn:hover{filter:brightness(1.1)}.icbtn.ghost{background:#fff;color:var(--brand)}.icbtn.danger{background:#b3261e;border-color:#b3261e}.icbtn.small{padding:4px 12px;font-size:13px}
.linkish{border:0;background:none;color:#1a4d8f;text-decoration:underline;cursor:pointer;font:inherit;padding:0}
.row-actions{display:flex;align-items:center;gap:18px;margin-top:8px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.table{width:100%;border-collapse:collapse;margin:8px 0 12px}.ictable th{background:#e9eef5;color:#1a3d6b;text-align:left;padding:8px 10px;font-size:13px;border-bottom:1px solid #cbd5e3}.ictable td{padding:8px 10px;border-bottom:1px solid #e3e3e3;font-size:14px}.ictable form{display:flex;gap:8px;align-items:center;margin:0}.ictable .check{margin:0;font-size:12px}.empty{color:#888}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:6px 18px}.kv dt{color:#666}.kv dd{margin:0}
.glance-top{display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center;background:#f4f7fb;border:1px solid #d6e0ec;padding:14px 16px;margin-bottom:14px}.glance-top p{margin:0}.who{font-size:18px;font-weight:700}
.status-row{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}.status{flex:1;min-width:150px;display:flex;flex-direction:column;border:1px solid #ddd;border-top:4px solid #bbb;padding:10px 14px;text-decoration:none;color:#333}.status.on{border-top-color:#2e8540}.st-lbl{font-weight:700}.st-val{font-size:13px;color:#666}
.manage{columns:2;padding-left:18px}.muted{color:#777}.lead{font-size:17px}.crumb{margin:0 0 8px}
.wiz{display:flex;list-style:none;padding:0;margin:0 0 16px;counter-reset:w}.wiz li{flex:1;padding:8px 12px;background:#eef1f5;color:#777;font-size:14px;counter-increment:w;margin-right:4px}.wiz li::before{content:counter(w) ". "}.wiz li.on{background:var(--brand);color:#fff;font-weight:700}
.setup summary{display:inline-block;font-weight:700;color:var(--brand);cursor:pointer;margin:10px 0;border:1px solid var(--brand);padding:6px 14px;border-radius:18px}details summary{cursor:pointer}
.success{background:#e7f4ea;border:1px solid #9fd3ab;color:#1e6b31;padding:12px 14px;font-weight:700;margin-bottom:14px}
.alert{padding:12px 16px;margin:12px 24px 0}.alert-error{background:#fdecea;color:#9b1c1c;border:1px solid #f3b7b3}.alert-ok{background:#e7f4ea;color:#1e6b31;border:1px solid #9fd3ab}
.help-search{display:flex;gap:8px;margin:8px 0 14px}.help-search input{flex:1;padding:8px;border:1px solid #aaa}.help-search .btn{background:var(--brand);color:#fff;border:0;padding:0 16px;border-radius:18px;font-weight:700;cursor:pointer}.help-list li{margin:6px 0}
@media(max-width:860px){.ic-cols{flex-direction:column}.rail{width:100%}.tiles,.three,.grid2{grid-template-columns:1fr}.ic-top .ic-wrap{flex-wrap:wrap;gap:12px}.manage{columns:1}}
${billingCss}
.glance-top>div{min-width:0;overflow-wrap:anywhere}
@media(max-width:600px){.ic-top .ic-wrap{min-height:0;padding-top:12px;padding-bottom:12px;align-items:center}.ic-brand{font-size:19px}.ic-brand .logo{width:44px;height:44px}.ic-links{gap:14px;flex-wrap:wrap}.ic-links>a,.dd summary{font-size:14px}.ic-cols{align-items:stretch}.ic-top{position:relative}.dd{position:static}.dd-menu{left:14px;right:14px;top:auto;min-width:0}.ic-cols{padding-top:14px}.ic-head{padding:16px 14px 0}.ic-head h1{font-size:24px}.ic-body{padding:10px 14px 20px}.tiles{margin:0 -14px;padding:18px 14px}.tile{font-size:16px}.alert{margin:12px 14px 0}.wiz li{font-size:12px;padding:6px 6px}.kv{grid-template-columns:1fr;gap:2px}.kv dd{margin-bottom:8px}.row-actions{flex-wrap:wrap}}
${profileCss}
.ic-site{max-width:1140px;margin:0 auto;padding:0 6px 6px}.ic-site a{color:#1a4d8f;font-weight:600}.ic-site .pf-txt{color:#555}.ic-main .pf-hero{padding:0 30px;color:#333}@media(max-width:600px){.ic-main .pf-hero{padding:0 14px}}`;
