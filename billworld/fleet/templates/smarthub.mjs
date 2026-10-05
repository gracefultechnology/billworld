// NISC SmartHub: member self-service portal used by electric/telecom co-ops.
// Public screens (login splash, Pay Now, Account Registration, Account Access) mirror the AVEC capture
// (billworld/captures/avec-*); signed-in screens follow co-op SmartHub user guides (Billing & Payments,
// My Usage, Auto Pay Program, Settings > Paperless Billing) and are otherwise synthetic.
import { html, raw, doc, logo, alert, form, field, select, checkbox, button, hidden, amountChooser, methodChooser, newMethodFields, dateField, table, paymentRows, helpList, helpBody, helpSearchForm, money, fmtDate, methodText, statusLabel } from '../kit.mjs';
import { payNotice, payRows, payDate, fmtPayOn, scrollTable, scrollWrap, balanceTable, billingCss } from './_generic-billing.mjs';
import { profileTitle, profileHero, profileNavBar, profileLogin, socialRow, profileHelpExcerpts, profileArticleExcerpt, themedVm, profileCss, mfaSent, mfaResend } from './generic.mjs';

export const meta = {
  id: 'smarthub',
  name: 'NISC SmartHub',
  description: 'Co-op member portal: email sign-in splash, Pay Now guest lookup by account number + last name, Billing & Payments section with Pay My Bill wizard, Auto Pay Program, My Usage and Settings > Paperless Billing.',
  families: ['smarthub', 'nisc'],
  sources: [
    'https://avec.smarthub.coop/ui/#/login',
    'https://avec.smarthub.coop/ui/#/paynow',
    'https://avec.smarthub.coop/ui/#/registration',
    'https://avec.smarthub.coop/ui/#/accountAccess',
    'https://www.choptankelectric.coop/smarthub-knowledge-base',
    'https://www.hbci.com/help/smarthub-billing-and-payment/'
  ],
  evidence: {
    observed_public: [
      'Login splash: "Welcome to SmartHub!" headline over a full-bleed photo with a translucent white form box (Email, Password with show/hide eye, Sign In) and links "Can\'t access your account?" / "Don\'t have an account? Register now." (captures/avec-login)',
      'Footer strip: co-op name | street address | phone | Version: 26.19.0 (captures/avec-registration)',
      'Pay Now guest site: "Welcome to the Pay Now Site" with Account Number + Last Name or Business Name, Sign In button, reCAPTCHA notice (captures/avec-paynow)',
      'ACCOUNT REGISTRATION header band; fields Billing Account Number * ("Only numbers are allowed."), Last Name or Business Name *, Email *, Confirm Email *; Cancel / Continue buttons in orange (captures/avec-registration)',
      'ACCOUNT ACCESS page with tabs "Reset Password" and "Recover Registered Email" (captures/avec-account-access)'
    ],
    documented: [
      'Billing & Payments (a.k.a. Bill & Pay) menu with Auto Pay Program sub-menu; "Sign Up for Auto Pay" then accept terms (craigheadelectric.coop, choptankelectric.coop)',
      'Make Payment button on the Home screen, verify amount, then Pay Now (hbci.com)',
      'View Billing History from Quick Links on the left; View Bill opens the printed bill PDF (hbci.com)',
      'Settings > Paperless Billing; My Usage / Usage Explorer (choptankelectric.coop)',
      'Stored payment accounts managed from Pay My Bill (hbci.com)'
    ],
    synthetic: [
      'Signed-in layout details (header tabs, sidebar grouping, colours), the 3-step Pay My Bill wizard split (amount -> payment method/date -> review)',
      'My Usage bar chart derived from bill amounts (no meter data in the catalog); values also listed in a table',
      'Stop/Change Service, Payment Arrangement, Contact Us message form and MFA screens',
      'Registration completes in one form (password fields added to the observed first step); Confirm Email omitted because the engine has no field for it',
      'Account Access reset uses email only (observed form also asks for account number and last name)'
    ]
  }
};

export const routes = {
  home: '/', login: '/ui/login', loginPassword: '/ui/login/password', mfa: '/ui/login/verify', register: '/ui/registration', verify: '/ui/registration/verify', forgot: '/ui/accountAccess', reset: '/ui/accountAccess/reset',
  guest: '/ui/paynow', guestPay: '/ui/paynow/payment', guestReview: '/ui/paynow/review', guestReceipt: '/ui/paynow/receipt/:id',
  dashboard: '/ui/home', bill: '/ui/billing/bill-details', statements: '/ui/billing/history', statement: '/ui/billing/history/:id.pdf',
  pay: '/ui/billing/pay-my-bill', payMethod: '/ui/billing/pay-my-bill/payment-method', payReview: '/ui/billing/pay-my-bill/review', payReceipt: '/ui/billing/pay-my-bill/receipt/:id',
  history: '/ui/billing/payment-history', autopay: '/ui/billing/auto-pay-program', paperless: '/ui/settings/paperless-billing', wallet: '/ui/billing/payment-methods',
  cancel: '/ui/service/stop-service', plan: '/ui/service/change-service', arrangement: '/ui/billing/payment-arrangement', contact: '/ui/contact-us', profile: '/ui/settings/my-profile', logout: '/ui/logout',
  help: '/ui/help', helpArticle: '/ui/help/:slug', helpSearch: '/ui/help-search',
  usage: '/ui/usage'
};
export const flow = { paySteps: ['pay', 'payMethod', 'payReview'], loginSteps: 1, guestSteps: ['guest', 'guestPay', 'guestReview'] };

const VERSION = '26.19.0';
const offline = vm => vm.biller.capabilities.online_account.support === 'unsupported';
const isTelecom = vm => vm.biller.kind === 'telecom';
const stopLabel = vm => isTelecom(vm) ? 'Cancel Service' : vm.biller.kind === 'utility' ? 'Stop Service' : 'Close Account';
const memberWord = vm => isTelecom(vm) ? 'Customer' : 'Member';

const footer = vm => html`<footer class="sh-foot"><p>${vm.biller.name}${vm.biller.mailAddress ? html` <span class="bar">|</span>${vm.biller.mailAddress}` : ''}${vm.biller.phone ? html` <span class="bar">|</span>${vm.biller.phone}` : ''} <span class="bar">|</span>Version: ${VERSION}</p><p class="foot-links"><a href="${vm.url('help')}">Help &amp; FAQs</a> <a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact ${memberWord(vm)} Services</a></p></footer>`;

// Public splash: dark page, brand "photo" panel, translucent form box (as on the AVEC login / Pay Now screens).
function splash(vm, title, inner, { wide = false, fullTitle } = {}) {
  return doc(vm, { title: fullTitle || `${vm.biller.brand.shortName} SmartHub - ${title}`, bodyClass: 'sh-splash-body', body: html`<div class="splash">${profileNavBar(vm, { cls: 'pf-site sh-site' })}<div class="splash-top"><span class="sh-mark" aria-hidden="true">smart<b>hub</b></span><div class="splash-head"><p class="welcome">Welcome to SmartHub!</p><p>Our online Bill Pay and ${memberWord(vm)} Service portal.</p><p><em>Manage your account anytime from anywhere.</em></p></div><a class="coop" href="${vm.url('home')}">${logo(vm, 'logo coop-logo')}<span>${vm.biller.brand.shortName}</span></a></div><main class="splash-box${wide ? ' wide' : ''}">${alert(vm)}${inner}</main><p class="assist">If you need assistance, please contact ${vm.biller.brand.shortName} ${memberWord(vm)} Services${vm.biller.phone ? html` at ${vm.biller.phone}` : ''}.</p></div><p class="version">Version: ${VERSION}</p>` });
}
// Public "band" page: logo cell + uppercase title band (ACCOUNT REGISTRATION / ACCOUNT ACCESS).
function band(vm, title, inner) {
  return doc(vm, { title: `${vm.biller.brand.shortName} SmartHub - ${title}`, body: html`<header class="band"><a class="band-logo" href="${vm.url('home')}">${logo(vm)}<span>${vm.biller.brand.shortName}</span></a><h1 class="band-title">${title.toUpperCase()}</h1></header>${profileNavBar(vm, { cls: 'pf-site band-site' })}<main class="band-main"><div class="sheet">${alert(vm)}${inner}</div></main>${footer(vm)}` });
}

const SECTIONS = {
  home: ['dashboard'],
  billing: ['pay', 'payMethod', 'payReview', 'payReceipt', 'bill', 'statements', 'history', 'autopay', 'wallet', 'arrangement'],
  service: ['cancel', 'plan'],
  settings: ['profile', 'paperless'],
  contact: ['contact'],
  help: ['help', 'helpArticle', 'helpSearch'],
  usage: ['usage']
};
const sectionOf = page => Object.entries(SECTIONS).find(([, p]) => p.includes(page))?.[0] || 'home';

function sideLinks(vm, section) {
  const L = (page, label) => html`<li><a class="${vm.page === page ? 'on' : ''}" href="${vm.url(page)}"${vm.page === page ? raw(' aria-current="page"') : ''}>${label}</a></li>`;
  const billing = html`${L('pay', 'Pay My Bill')}${L('bill', 'View Bill')}${L('statements', 'Billing History')}${L('history', 'Payment History')}${vm.biller.capabilities.autopay.support === 'supported' ? L('autopay', 'Auto Pay Program') : ''}${L('wallet', 'Manage Payment Methods')}${L('arrangement', 'Payment Arrangement')}`;
  const service = html`${vm.plans?.length ? L('plan', 'Change Service') : ''}${vm.biller.capabilities.cancel_service.support === 'supported' ? L('cancel', stopLabel(vm)) : ''}`;
  const settings = html`${L('profile', 'My Profile')}${vm.biller.capabilities.paperless.support === 'supported' ? L('paperless', 'Paperless Billing') : ''}`;
  if (section === 'billing') return html`<h2>Billing &amp; Payments</h2><ul>${billing}</ul>`;
  if (section === 'service') return html`<h2>Service</h2><ul>${service}</ul>`;
  if (section === 'settings') return html`<h2>Settings</h2><ul>${settings}</ul>`;
  if (section === 'usage') return html`<h2>My Usage</h2><ul>${L('usage', 'Usage Explorer')}${L('statements', 'Billing History')}</ul>`;
  return html`<h2>Quick Links</h2><ul>${billing}${service}${settings}${L('contact', 'Contact Us')}${L('help', 'Help & FAQs')}</ul>`;
}

function shell(vm, title, body) {
  if (!vm.authenticated) return band(vm, title, body);
  const sec = sectionOf(vm.page);
  const T = (page, label, key) => html`<a class="${sec === key ? 'on' : ''}" href="${vm.url(page)}"${sec === key ? raw(' aria-current="page"') : ''}>${label}</a>`;
  return doc(vm, { title: `${vm.biller.brand.shortName} SmartHub - ${title}`, bodyClass: 'sh-app', body: html`<header class="app-top"><a class="band-logo" href="${vm.url('dashboard')}">${logo(vm)}<span>${vm.biller.brand.shortName}</span></a><nav class="tabs" aria-label="Main menu">${T('dashboard', 'Home', 'home')}${T('bill', 'Billing & Payments', 'billing')}${T('usage', 'My Usage', 'usage')}${vm.biller.capabilities.cancel_service.support === 'supported' || vm.plans?.length ? T(vm.plans?.length ? 'plan' : 'cancel', 'Service', 'service') : ''}${T('profile', 'Settings', 'settings')}${T('contact', 'Contact Us', 'contact')}</nav><div class="who"><span class="acct-chip">${vm.persona.name} · Acct ${vm.accountMasked}</span><a href="${vm.url('logout')}">Sign Out</a></div></header><div class="app-body"><main class="app-main"><h1 class="page-title">${title}</h1>${alert(vm)}${body}</main><aside class="side" aria-label="Section menu">${sideLinks(vm, sec)}</aside></div>${footer(vm)}` });
}

const card = (title, inner, cls = '') => html`<section class="mcard ${cls}">${title ? html`<h2>${title}</h2>` : ''}${inner}</section>`;
const actions = (...items) => html`<div class="actions">${items}</div>`;

function usage(vm, { full = false } = {}) {
  const inv = vm.invoices.slice(0, 12).reverse();
  const max = Math.max(...inv.map(i => i.amountCents), 1);
  const unit = isTelecom(vm) ? 'GB' : vm.biller.billType === 'water' ? 'kgal' : vm.biller.billType === 'gas' ? 'therms' : 'kWh';
  const qty = c => Math.round(c / (unit === 'kWh' ? 13 : unit === 'GB' ? 40 : unit === 'therms' ? 120 : 900));
  const mon = i => new Date(i.dueAt).toLocaleDateString('en-US', { month: 'short', timeZone: 'America/New_York' });
  const chart = html`<div class="usage" aria-hidden="true">${inv.map(i => html`<div class="u-col"><span class="u-val">${qty(i.amountCents)}</span><span class="u-bar u${Math.max(1, Math.round(i.amountCents / max * 10))}"></span><span class="u-lbl">${mon(i)}</span></div>`)}</div>`;
  const rows = inv.slice().reverse().map(i => [i.period, `${qty(i.amountCents)} ${unit}`, money(i.amountCents)]), heads = ['Billing Period', `Usage (${unit})`, 'Amount Billed'];
  const data = full ? scrollTable(`Usage by billing period (${unit})`, heads, rows, 'table mtable') : html`<div class="sr-only">${table(heads, rows, 'table mtable')}</div>`;
  return html`${chart}<p class="muted small">Usage Explorer · estimated ${unit} per billing period (based on billed amounts).</p>${data}${full ? '' : html`<p><a href="${vm.url('usage')}">View usage details</a></p>`}`;
}

const pages = {
  home(vm) {
    if (offline(vm)) return doc(vm, { title: `${vm.biller.brand.shortName} - Paying your bill`, body: html`<header class="band"><a class="band-logo" href="${vm.url('home')}">${logo(vm)}<span>${vm.biller.brand.shortName}</span></a><h1 class="band-title">PAYING YOUR BILL</h1></header><main class="band-main"><div class="sheet"><h2>Paying your ${vm.biller.name} bill</h2><p class="lead">Online account access and online bill payment are not available for this biller.</p>${helpBody(vm.help.find(a => a.slug === 'pay-your-bill'))}${vm.biller.phone ? html`<p>Questions? Call <strong>${vm.biller.phone}</strong>.</p>` : html`<p>Use the contact information printed on your paper bill.</p>`}<p><a href="${vm.url('help')}">Help &amp; FAQs</a></p></div></main>${footer(vm)}` });
    const hero = profileHero(vm);
    return splash(vm, 'Welcome', html`<h1 class="sr-only">${vm.biller.name} SmartHub</h1>${hero ? html`<p class="pf-hero">${hero}</p>` : ''}<p class="box-lead">${vm.biller.name}</p><div class="splash-actions"><a class="obtn" href="${vm.url('login')}">Sign In</a><a class="obtn ghost" href="${vm.url('guest')}">Pay Now</a></div><ul class="box-links"><li><a href="${vm.url('register')}">Don't have an account? Register now.</a></li><li><a href="${vm.url('help')}">Help &amp; FAQs</a></li></ul>`, { fullTitle: profileTitle(vm, 'website', null) });
  },
  login(vm) {
    const lp = profileLogin(vm, { idLabel: 'Email', submit: 'Sign In' });
    return splash(vm, 'LOGIN', html`<h1 class="sr-only">Sign In</h1>${form(vm, 'login', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'username', label: lp.idLabel, autocomplete: 'username', cls: 'ofield' })}<div class="ofield pw" id="pw-wrap">${raw(`<label for="f-password">Password</label>`)}<input id="f-password" name="password" type="password" autocomplete="current-password" required value=""></div><div class="right">${button(lp.submit, { cls: 'obtn' })}</div>`, { cls: 'login-form' })}${socialRow(vm)}<ul class="box-links"><li><a href="${vm.url('forgot')}">Can’t access your account?</a></li><li><a href="${vm.url('register')}">Don't have an account? Register now.</a></li><li><a href="${vm.url('guest')}">Pay Now without signing in</a></li></ul>`, { fullTitle: profileTitle(vm, 'login', null) });
  },
  loginPassword(vm) { return pages.login(vm); },
  mfa(vm) { return band(vm, 'Verify Your Identity', html`<p class="req"><span class="i">i</span> ${mfaSent(vm, 'We emailed a 6-digit security code to the address registered to this account.')}</p>${form(vm, 'mfa', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'code', label: 'Security Code *', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code', cls: 'ofield narrow' })}${actions(html`<a class="obtn ghost" href="${vm.url('login')}">Cancel</a>`, button('Continue', { cls: 'obtn' }))}`)}${mfaResend(vm, { cls: 'linkbtn' })}`); },
  register(vm) {
    return band(vm, 'Account Registration', html`<p class="req"><span class="i">i</span> Required fields marked with an asterisk</p>${form(vm, 'register', html`${field(vm, { name: 'accountNumber', label: 'Billing Account Number *', inputmode: 'numeric', help: 'Only numbers are allowed.', cls: 'ofield narrow' })}${field(vm, { name: 'lastName', label: 'Last Name or Business Name *', cls: 'ofield narrow' })}${field(vm, { name: 'email', label: 'Email *', type: 'email', autocomplete: 'email', cls: 'ofield narrow' })}<h2 class="sub">Create Password</h2>${field(vm, { name: 'password', label: 'Password *', type: 'password', autocomplete: 'new-password', help: '8–64 characters with upper and lower case letters, a number and a symbol.', cls: 'ofield narrow' })}${field(vm, { name: 'confirm', label: 'Confirm Password *', type: 'password', autocomplete: 'new-password', cls: 'ofield narrow' })}${actions(html`<a class="obtn ghost" href="${vm.url('login')}">Cancel</a>`, button('Continue', { cls: 'obtn' }))}`)}`);
  },
  verify(vm) { return band(vm, 'Account Registration', html`<h2 class="sub">Check your email</h2><p>Open the verification link we emailed you to activate SmartHub access, then <a href="${vm.url('login')}">sign in</a>.</p>`); },
  forgot(vm) {
    const recover = vm.query.tab === 'recover-email';
    const tabs = html`<nav class="tabset" aria-label="Account access options"><a class="tab${recover ? '' : ' on'}" href="${vm.url('forgot')}"${recover ? '' : raw(' aria-current="page"')}>Reset Password</a><a class="tab${recover ? ' on' : ''}" href="${vm.url('forgot', {}, { tab: 'recover-email' })}"${recover ? raw(' aria-current="page"') : ''}>Recover Registered Email</a></nav>`;
    if (recover) return band(vm, 'Account Access', html`${tabs}<h2 class="sub">Recover Registered Email</h2><p>For your security, the email address registered to SmartHub can only be recovered by ${memberWord(vm)} Services. ${vm.biller.phone ? html`Call <strong>${vm.biller.phone}</strong> and have your billing account number ready.` : 'Contact the office listed on your bill and have your billing account number ready.'}</p><p>If you know your email but not your password, use <a href="${vm.url('forgot')}">Reset Password</a>.</p>${actions(html`<a class="obtn ghost" href="${vm.url('login')}">Back to Sign In</a>`)}`);
    return band(vm, 'Account Access', html`${tabs}<p class="req"><span class="i">i</span> Required fields marked with an asterisk</p>${form(vm, 'forgot', html`${field(vm, { name: 'identifier', label: 'Email *', type: 'text', autocomplete: 'username', help: 'Enter the email registered to SmartHub (or your billing account number).', cls: 'ofield narrow' })}${actions(html`<a class="obtn ghost" href="${vm.url('login')}">Cancel</a>`, button('Continue', { cls: 'obtn' }))}`)}`);
  },
  reset(vm) { return band(vm, 'Account Access', html`<p class="req"><span class="i">i</span> Enter the code from the email we sent and choose a new password.</p>${form(vm, 'reset', html`${vm.query.token ? hidden('token', vm.query.token) : field(vm, { name: 'code', label: 'Verification Code *', inputmode: 'numeric', autocomplete: 'one-time-code', cls: 'ofield narrow' })}${field(vm, { name: 'password', label: 'New Password *', type: 'password', autocomplete: 'new-password', cls: 'ofield narrow' })}${field(vm, { name: 'confirm', label: 'Confirm New Password *', type: 'password', autocomplete: 'new-password', cls: 'ofield narrow' })}${actions(html`<a class="obtn ghost" href="${vm.url('login')}">Cancel</a>`, button('Reset Password', { cls: 'obtn' }))}`)}`); },
  guest(vm) {
    return splash(vm, 'Pay Now', html`<h1 class="box-lead">Welcome to the Pay Now Site</h1>${form(vm, 'guest', html`${field(vm, { name: 'accountNumber', label: 'Account Number', inputmode: 'numeric', cls: 'ofield small' })}${field(vm, { name: 'lastName', label: 'Last Name or Business Name', cls: 'ofield small' })}<div class="center">${button('Sign In', { cls: 'obtn' })}</div>`, { cls: 'paynow-form' })}<p class="fine">This site is protected and the Privacy Policy and Terms of Service apply. <a href="${vm.url('login')}">Registered user sign in</a></p>`);
  },
  guestPay(vm) {
    return band(vm, 'Pay Now', html`${payNotice(vm, { autopayName: 'Auto Pay' })}<div class="acct-strip"><div><span class="lbl">Account</span><strong>${vm.accountMasked}</strong></div><div><span class="lbl">Service Address</span>${vm.account.serviceAddress}</div><div><span class="lbl">Amount Due</span><strong>${money(vm.balanceCents)}</strong></div><div><span class="lbl">Due Date</span>${vm.dueText}</div></div>${form(vm, 'guestPay', html`${amountChooser(vm, { labels: { legend: 'Payment Amount', due: 'Total Amount Due' } })}<fieldset class="methods"><legend>Payment Method</legend><p class="muted small">Visa, Mastercard, American Express, Discover or E-Check (ACH).</p>${newMethodFields(vm)}</fieldset>${actions(html`<a class="obtn ghost" href="${vm.url('home')}">Cancel</a>`, button('Continue', { cls: 'obtn' }))}`)}`);
  },
  guestReview(vm) { return reviewPage(vm, 'guestReview'); },
  guestReceipt(vm) { return receiptPage(vm); },

  dashboard(vm) {
    const inv = vm.invoice;
    return shell(vm, 'Home', html`<div class="grid2">${card('My Bill', html`<p class="due-lbl">Amount Due</p><p class="big">${money(vm.balanceCents)}</p><p>Due ${vm.dueText}${vm.autopay.enrolled ? html` · <span class="pill ok">Auto Pay</span>` : ''}</p>${vm.pendingPayments.length ? html`<p class="muted">${vm.pendingPayments.length} payment(s) pending</p>` : ''}${vm.scheduled.length ? html`<p class="muted">${vm.scheduled.length} scheduled payment(s)</p>` : ''}${actions(html`<a class="obtn" href="${vm.url('pay')}">Make Payment</a>`, html`<a class="obtn ghost" href="${vm.url('bill')}">View Bill</a>`)}`)}${card('Account', html`<dl class="kv"><dt>Account Number</dt><dd>${vm.accountMasked}</dd><dt>Service Address</dt><dd>${vm.account.serviceAddress}</dd><dt>Last Bill</dt><dd>${money(inv.amountCents)} · ${fmtDate(inv.issuedAt)}</dd><dt>Auto Pay</dt><dd>${vm.autopay.enrolled ? 'Enrolled' : 'Not enrolled'}</dd><dt>Paperless Billing</dt><dd>${vm.account.paperless ? 'On' : 'Off'}</dd>${vm.service.plan ? html`<dt>Service Package</dt><dd>${vm.plans.find(p => p.current)?.name}</dd>` : ''}<dt>Status</dt><dd>${vm.service.status === 'active' ? 'Active' : vm.service.status === 'cancel_pending' ? `Ends ${fmtDate(vm.service.cancelAt)}` : 'Inactive'}</dd></dl>`)}</div>${card('My Usage', usage(vm), 'usage-card')}`);
  },
  usage(vm) { return shell(vm, 'My Usage', card('Usage Explorer', usage(vm, { full: true }), 'usage-card')); },
  bill(vm) {
    const inv = vm.invoice;
    return shell(vm, 'Bill Details', html`${card(`Bill for ${inv.period}`, html`<p class="muted">Bill #${inv.number} · Issued ${fmtDate(inv.issuedAt)}</p>${scrollTable('Bill charges', ['Description', 'Amount'], [...inv.lines.map(l => [l.desc, money(l.cents)]), [html`<strong>Total Current Charges</strong>`, html`<strong>${money(inv.amountCents)}</strong>`]], 'table mtable')}${balanceTable(vm, { statement: 'Current Bill Total', pastDue: 'Previous Balance (past due)', posted: 'Payments Received', pending: 'Pending Payments', balance: 'Current Balance' })}<p>Current balance: <strong>${money(vm.balanceCents)}</strong> · Due Date: <strong>${fmtDate(inv.dueAt)}</strong></p>${vm.scheduled.length ? html`<p class="muted">${vm.scheduled.length} scheduled payment(s) totalling ${money(vm.scheduled.reduce((a, p) => a + p.amountCents, 0))} · <a href="${vm.url('history')}">Payment History</a></p>` : ''}${actions(html`<a class="obtn" href="${vm.url('pay')}">Pay Now</a>`, html`<a class="obtn ghost" href="${vm.url('statement', { id: inv.id })}">View Bill (PDF)</a>`, html`<a class="obtn ghost" href="${vm.url('statements')}">Billing History</a>`)}`)}`);
  },
  statements(vm) { return shell(vm, 'Billing History', card('', scrollTable('Billing history', ['Bill Date', 'Billing Period', 'Amount', 'Due Date', 'Bill'], vm.invoices.map(i => [fmtDate(i.issuedAt), i.period, money(i.amountCents), fmtDate(i.dueAt), html`<a href="${vm.url('statement', { id: i.id })}">View Bill</a>`]), 'table mtable'))); },
  pay(vm) {
    return shell(vm, 'Pay My Bill', html`${steps(1)}${payNotice(vm, { autopayName: 'Auto Pay' })}${card('', html`${form(vm, 'pay', html`<div class="table-scroll" role="region" tabindex="0" aria-label="Account to pay"><table class="table mtable acct-select"><thead><tr><th scope="col">Account</th><th scope="col">Service Address</th><th scope="col">Amount Due</th><th scope="col">Due Date</th></tr></thead><tbody><tr><td>${vm.accountMasked}</td><td>${vm.account.serviceAddress}</td><td>${money(vm.balanceCents)}</td><td>${vm.dueText}</td></tr></tbody></table></div>${amountChooser(vm, { labels: { legend: 'Payment Amount', due: 'Pay Total Amount Due' } })}${actions(button('Continue', { cls: 'obtn' }))}`)}`)}`);
  },
  payMethod(vm) {
    const d = vm.draft;
    return shell(vm, 'Pay My Bill', html`${steps(2)}${card('', html`<p>Payment amount: <strong>${d?.amountCents ? money(d.amountCents) : '—'}</strong> <a href="${vm.url('pay')}">Change</a></p>${form(vm, 'payMethod', html`${methodChooser(vm, { title: 'Select Payment Method' })}${dateField(vm, { label: 'Payment Date' })}${actions(html`<a class="obtn ghost" href="${vm.url('pay')}">Back</a>`, button('Continue', { cls: 'obtn' }))}`)}`)}`);
  },
  payReview(vm) { return reviewPage(vm, 'payReview'); },
  payReceipt(vm) { return receiptPage(vm); },
  history(vm) { return shell(vm, 'Payment History', card('', scrollTable('Payment history', ['Date', 'Amount', 'Payment Method', 'Confirmation', 'Status', 'Action'], payRows(vm), 'table mtable'))); },
  autopay(vm) {
    const ap = vm.autopay;
    const terms = html`<details class="terms"><summary>Auto Pay Terms and Conditions</summary><p>I authorize ${vm.biller.name} to initiate a debit from the payment account below for the amount of each bill on its due date. This authorization remains in effect until I cancel it in SmartHub or by contacting ${memberWord(vm)} Services.</p></details>`;
    return shell(vm, 'Auto Pay Program', html`${ap.enrolled ? card('Current Enrollment', html`<p><span class="pill ok">Enrolled</span> Your ${ap.policy === 'fixed' ? `fixed amount of ${money(ap.fixedCents)}` : 'total amount due'} is drafted ${ap.day ? `on day ${ap.day} of each month` : 'on each due date'} from ${vm.autopayMethod ? methodText(vm.autopayMethod) : 'your payment account'}.</p>${form(vm, 'autopay', html`${hidden('action', 'cancel')}${checkbox(vm, { name: 'confirm', label: 'I understand future bills will not be paid automatically.' })}${button('Cancel Auto Pay', { cls: 'obtn danger' })}`)}`) : card('', html`<p>Auto Pay pays your bill automatically on the due date from a bank account or card you choose. Enrolling authorizes ${vm.biller.brand.shortName} to withdraw the amount due each month.</p>`)}${card(ap.enrolled ? 'Change Auto Pay' : 'Sign Up for Auto Pay', form(vm, 'autopay', html`${hidden('action', 'enroll')}${methodChooser(vm, { title: 'Payment Account' })}${select(vm, { name: 'policy', label: 'Draft Amount', options: [['full', 'Total amount due'], ['fixed', 'Fixed amount']], cls: 'ofield narrow' })}${field(vm, { name: 'fixedAmount', label: 'Fixed amount (if selected)', required: false, inputmode: 'decimal', cls: 'ofield narrow' })}${terms}${checkbox(vm, { name: 'acceptTerms', label: 'I have read and accept the Auto Pay Terms and Conditions.' })}${actions(button(ap.enrolled ? 'Save Changes' : 'Sign Up', { cls: 'obtn' }))}`))}`);
  },
  paperless(vm) {
    return shell(vm, 'Paperless Billing', card('', html`<p>Paperless billing is <strong>${vm.account.paperless ? 'ON' : 'OFF'}</strong> for account ${vm.accountMasked}.</p><p class="muted">Members on paperless billing receive an email when the bill is ready and do not receive a printed bill in the mail.</p>${form(vm, 'paperless', html`${hidden('paperless', vm.account.paperless ? 'off' : 'on')}${!vm.account.paperless ? field(vm, { name: 'email', label: 'Bill notification email', type: 'email', value: vm.persona.email, cls: 'ofield narrow' }) : ''}${actions(button(vm.account.paperless ? 'Resume Paper Bills' : 'Enroll in Paperless Billing', { cls: 'obtn' }))}`)}`));
  },
  wallet(vm) {
    return shell(vm, 'Manage Payment Methods', html`${card('Stored Payment Accounts', vm.methods.length ? scrollTable('Stored payment accounts', ['Payment Method', 'Nickname', 'Action'], vm.methods.map(m => [methodText(m), m.nickname || '', form(vm, 'wallet', html`${hidden('op', 'remove')}${hidden('methodId', m.id)}${button('Remove', { cls: 'btn-link' })}`)]), 'table mtable') : html`<p>No stored payment accounts.</p>`)}${card('Add a Payment Method', form(vm, 'wallet', html`${hidden('op', 'add')}${newMethodFields(vm)}${field(vm, { name: 'nickname', label: 'Nickname (optional)', required: false, cls: 'ofield narrow' })}${actions(button('Save', { cls: 'obtn' }))}`))}`);
  },
  cancel(vm) {
    const label = stopLabel(vm), noun = isTelecom(vm) ? 'service' : vm.biller.kind === 'utility' ? 'service' : 'account';
    if (vm.service.status !== 'active' && vm.step !== 'done') return shell(vm, label, card('', html`<p>Your ${noun} ${vm.service.status === 'cancel_pending' ? `is scheduled to end on ${fmtDate(vm.service.cancelAt)}` : 'is inactive'}.</p>${vm.service.status === 'cancel_pending' ? form(vm, 'cancel', html`${hidden('step', 'undo')}${button('Withdraw Request', { cls: 'obtn' })}`) : ''}`));
    const s = {
      reason: card('Service Request', form(vm, 'cancel', html`<p>Submit a request to ${label.toLowerCase()} at ${vm.account.serviceAddress}.</p>${hidden('step', 'reason')}${select(vm, { name: 'reason', label: 'Reason for Request *', options: [['', 'Select a reason'], ['moving', 'Moving out of the service area'], ['cost', 'Cost'], ['switching', 'Switching providers'], ['not_using', 'No longer needed'], ['other', 'Other']], cls: 'ofield narrow' })}${actions(button('Continue', { cls: 'obtn' }))}`)),
      offer: card('Before You Go', html`<p><strong>Stay and save 50% for 3 months.</strong> Keep your current package at half price on your next three bills.</p>${form(vm, 'cancel', html`${hidden('step', 'offer')}${actions(button('Accept Offer', { cls: 'obtn', name: 'accept', value: 'yes' }), button('No Thanks, Continue', { cls: 'obtn ghost', name: 'accept', value: 'no' }))}`)}`),
      confirm: card('Confirm Request', form(vm, 'cancel', html`<p>${isTelecom(vm) ? 'Choose the date your service should be disconnected. Return any rented equipment to avoid charges.' : 'Choose the date service should stop. A final bill will be mailed to you.'}</p>${hidden('step', 'confirm')}${dateField(vm, { name: 'effectiveDate', label: 'Requested Stop Date' })}${checkbox(vm, { name: 'confirm', label: `Yes, ${label.toLowerCase()} on the date above.` })}${actions(button(`Submit ${label} Request`, { cls: 'obtn danger' }))}`)),
      done: card('Request Received', html`<p>Your ${noun} will end on <strong>${vm.service.cancelAt ? fmtDate(vm.service.cancelAt) : ''}</strong>. Confirmation number <strong>${vm.service.confirmation || ''}</strong>.</p><p><a href="${vm.url('dashboard')}">Return Home</a></p>`),
      kept: card('Thank You', html`<p>Your discount has been applied.</p><p><a href="${vm.url('dashboard')}">Return Home</a></p>`)
    };
    return shell(vm, label, s[vm.step]);
  },
  plan(vm) { return shell(vm, 'Change Service', card('Service Package', vm.plans.length ? form(vm, 'plan', html`<fieldset><legend>Choose a package</legend>${vm.plans.map(p => html`<label class="radio"><input type="radio" name="planId" value="${p.id}"${p.current ? raw(' checked') : ''}> ${p.name}${p.cents ? ` – ${money(p.cents)}/mo` : ''}${p.current ? ' (current)' : ''}</label>`)}</fieldset>${actions(button('Submit Change', { cls: 'obtn' }))}`) : html`<p>Service changes are handled by ${memberWord(vm)} Services${vm.biller.phone ? ` at ${vm.biller.phone}` : ''}.</p>`)); },
  arrangement(vm) { return shell(vm, 'Payment Arrangement', card('', vm.account.arrangement ? html`<p>You're paying ${money(vm.account.arrangement.monthlyCents)} per month for ${vm.account.arrangement.months} months.</p>` : form(vm, 'arrangement', html`<p>Spread your balance of ${money(vm.balanceCents)} over monthly installments added to your bill.</p>${select(vm, { name: 'months', label: 'Number of Months', options: [['3', '3 months'], ['6', '6 months'], ['12', '12 months']], cls: 'ofield narrow' })}${actions(button('Request Arrangement', { cls: 'obtn' }))}`))); },
  contact(vm) { return shell(vm, 'Contact Us', html`${vm.account.messages.length ? card('Submitted Requests', html`<ul class="msgs">${vm.account.messages.map(m => html`<li>${fmtDate(m.at)} – ${m.subject} (${m.status})</li>`)}</ul>`) : ''}${card('Send Us a Message', form(vm, 'contact', html`${field(vm, { name: 'subject', label: 'Subject *', cls: 'ofield narrow' })}<div class="ofield"><label for="f-message">Message *</label><textarea id="f-message" name="message" required>${vm.values.message || ''}</textarea></div>${actions(button('Submit', { cls: 'obtn' }))}`))}${vm.biller.phone ? card(`${memberWord(vm)} Services`, html`<p>${vm.biller.phone}</p>`) : ''}`); },
  profile(vm) { return shell(vm, 'My Profile', html`${card('Personal Information', html`<dl class="kv"><dt>Name</dt><dd>${vm.persona.name}</dd><dt>Email</dt><dd>${vm.persona.email}</dd><dt>Phone</dt><dd>${vm.account.phone || 'Not provided'}</dd></dl>`)}${card('Update Phone Number', form(vm, 'profile', html`${field(vm, { name: 'phone', label: 'Primary Phone', type: 'tel', cls: 'ofield narrow' })}${actions(button('Save', { cls: 'obtn' }))}`))}`); },
  help(vm) {
    const body = html`${helpSearchForm(vm, { placeholder: 'Search help topics' })}${helpList(vm)}${profileHelpExcerpts(vm)}`;
    return vm.authenticated ? shell(vm, 'Help & FAQs', card('', body)) : band(vm, 'Help & FAQs', body);
  },
  helpArticle(vm) { const body = html`<p class="crumb"><a href="${vm.url('help')}">Help &amp; FAQs</a> ›</p><h2 class="sub">${vm.article.title}</h2>${helpBody(vm.article)}${profileArticleExcerpt(vm, vm.article)}`; return vm.authenticated ? shell(vm, vm.article.title, card('', body)) : band(vm, 'Help & FAQs', body); },
  helpSearch(vm) { const body = html`${helpSearchForm(vm, { placeholder: 'Search help topics' })}<h2 class="sub">Search Results</h2>${vm.results.length ? helpList(vm, vm.results) : html`<p>No topics match “${vm.query.q || ''}”.</p>`}`; return vm.authenticated ? shell(vm, 'Help & FAQs', card('', body)) : band(vm, 'Help & FAQs', body); }
};

const steps = n => html`<ol class="stepper">${['Payment Amount', 'Payment Method', 'Review'].map((s, i) => html`<li class="${i + 1 === n ? 'on' : i + 1 < n ? 'done' : ''}"><span>${i + 1}</span>${s}</li>`)}</ol>`;

function reviewPage(vm, page) {
  const d = vm.draft;
  const body = html`${page === 'payReview' ? steps(3) : ''}${card('Review Payment', html`<dl class="kv"><dt>Account</dt><dd>${vm.accountMasked}</dd><dt>Payment Amount</dt><dd>${money(d.amountCents)}</dd>${d.feeCents ? html`<dt>Convenience Fee</dt><dd>${money(d.feeCents)}</dd>` : ''}<dt>Total</dt><dd><strong>${money(d.totalCents)}</strong></dd><dt>Payment Method</dt><dd>${methodText(d.method)}</dd><dt>Payment Date</dt><dd>${d.payOn ? fmtPayOn(d.payOn) : 'Today'}</dd></dl>${form(vm, page, html`${hidden('token', d.token)}${hidden('op', 'submit')}${checkbox(vm, { name: 'acceptTerms', label: 'I authorize this payment and agree to the payment terms and conditions.' })}${actions(button('Pay Now', { cls: 'obtn' }))}`)}${page === 'payReview' ? form(vm, page, html`${hidden('op', 'edit')}${button('Edit Payment', { cls: 'btn-link' })}`) : ''}`)}`;
  return page === 'payReview' ? shell(vm, 'Pay My Bill', body) : band(vm, 'Pay Now', body);
}
function receiptPage(vm) {
  const p = vm.payment;
  const body = card(p.status === 'scheduled' ? 'Payment Scheduled' : 'Payment Successful', html`<p class="okmsg">${p.status === 'scheduled' ? 'Your payment has been scheduled.' : 'Thank you! Your payment was submitted.'}</p><dl class="kv"><dt>Confirmation Number</dt><dd><strong>${p.confirmation}</strong></dd><dt>Amount</dt><dd>${money(p.amountCents)}</dd>${p.feeCents ? html`<dt>Fee</dt><dd>${money(p.feeCents)}</dd>` : ''}<dt>Payment Method</dt><dd>${vm.paymentMethod ? methodText(vm.paymentMethod) : `****${p.methodLast4}`}</dd><dt>Payment Date</dt><dd>${payDate(p)}</dd><dt>Status</dt><dd>${statusLabel(p.status)}</dd></dl><p>${vm.authenticated ? html`<a href="${vm.url('dashboard')}">Return Home</a> · <a href="${vm.url('history')}">Payment History</a>` : html`<a href="${vm.url('home')}">Done</a>`}</p>`);
  return vm.authenticated ? shell(vm, 'Pay My Bill', body) : band(vm, 'Pay Now', body);
}

export function render(page, vm) { const fn = pages[page]; if (!fn) throw new Error(`smarthub template cannot render ${page}`); return fn(themedVm(vm)); }

// Show/hide password eye (progressive enhancement only).
export const js = `document.addEventListener('DOMContentLoaded',function(){var w=document.getElementById('pw-wrap');if(!w)return;var i=w.querySelector('input');var b=document.createElement('button');b.type='button';b.className='eye';b.setAttribute('aria-label','Show Password');b.textContent='Show';b.addEventListener('click',function(){var s=i.type==='password';i.type=s?'text':'password';b.textContent=s?'Hide':'Show';b.setAttribute('aria-label',s?'Hide Password':'Show Password');});w.appendChild(b);});`;

export const css = `*{box-sizing:border-box}html,body{margin:0}body{font:15px/1.45 Roboto,"Helvetica Neue",Arial,sans-serif;color:#212121;background:#f2f2f2}a{color:#0d5aa7}
:root{--orange:#f29a2e;--orange-d:#d97f12;--ink:#002b5c}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.sh-splash-body{background:#3c3c3c;min-height:100vh}
.splash{max-width:1200px;margin:60px auto 0;padding:28px 24px 36px;background:linear-gradient(180deg,#bcd3e6 0%,#d9e4ec 38%,#a7b3a0 70%,#6e6a5d 100%);position:relative}
.splash::before{content:"";position:absolute;inset:0;background:linear-gradient(0deg,rgba(0,0,0,.18),transparent 40%);pointer-events:none}
.splash-top{display:grid;grid-template-columns:200px 1fr 200px;align-items:center;gap:12px;position:relative}
.sh-mark{color:#fff;font:600 30px/1 Arial,sans-serif;letter-spacing:-1px;text-shadow:0 1px 3px rgba(0,0,0,.3)}.sh-mark b{font-weight:300;border:2px solid #fff;border-radius:50%;padding:6px 6px;margin-left:2px}
.splash-head{text-align:center;color:var(--ink)}.splash-head p{margin:2px 0;font-size:22px;font-weight:700}.splash-head .welcome{font-size:24px}.splash-head em{font-style:italic}
.coop{justify-self:end;display:flex;align-items:center;gap:8px;text-decoration:none;color:var(--ink);font-weight:700;background:rgba(255,255,255,.85);padding:8px 10px;border-radius:4px}.coop-logo{width:44px;height:44px}
.splash-box{position:relative;max-width:588px;margin:30px auto 0;background:rgba(255,255,255,.72);padding:28px 40px 26px}.splash-box.wide{max-width:760px}
.box-lead{text-align:center;font-size:15px;font-weight:400;margin:0 0 14px}
.splash-actions{display:flex;justify-content:center;gap:12px;margin:10px 0 18px}
.login-form,.paynow-form{max-width:340px;margin:0 auto}.paynow-form{max-width:204px}
.box-links{max-width:340px;margin:16px auto 0;padding-left:18px;font-size:14px}.box-links a{color:#111;text-decoration:none}.box-links a:hover{text-decoration:underline}
.assist{position:relative;text-align:center;color:#fff;font-size:22px;font-weight:700;margin:26px 0 0;text-shadow:0 1px 4px rgba(0,0,0,.5)}
.version{text-align:center;color:#ddd;font-size:12px;margin:40px 0 10px}.fine{font-size:11px;text-align:center;color:#444}
.center{text-align:center}.right{text-align:right}
.ofield{position:relative;margin:0 0 22px}.ofield label{display:block;font-size:13px;color:#555;margin-bottom:4px}.ofield input,.ofield select,.ofield textarea{width:100%;height:56px;padding:0 12px;border:1px solid #8a8a8a;border-radius:4px;background:#fff;font:inherit;font-size:16px}.ofield textarea{height:120px;padding:10px}.ofield input:focus,.ofield select:focus{outline:2px solid var(--brand);border-color:var(--brand)}
.ofield .help{display:block;font-size:11px;color:#555;margin:4px 0 0 10px}.ofield.narrow{max-width:340px}.ofield.small input{height:48px}
.pw .eye{position:absolute;right:8px;top:31px;border:0;background:none;color:#444;font:inherit;font-size:12px;cursor:pointer}
.obtn{display:inline-block;background:var(--orange);color:#fff;border:1px solid var(--orange);border-radius:4px;padding:9px 22px;font:500 15px Roboto,Arial,sans-serif;text-decoration:none;cursor:pointer;min-width:96px;text-align:center}.obtn:hover{background:var(--orange-d)}
.obtn.ghost{background:#fff;color:var(--orange-d)}.obtn.danger{background:#c62828;border-color:#c62828}.btn-link{border:0;background:none;color:#0d5aa7;text-decoration:underline;cursor:pointer;font:inherit;padding:0}
.actions{display:flex;justify-content:flex-end;gap:14px;flex-wrap:wrap;margin-top:18px}
.band{display:flex;align-items:stretch;min-height:70px;background:var(--brand)}.band-logo{display:flex;align-items:center;gap:10px;background:#fff;width:300px;padding:0 20px;text-decoration:none;color:#14243b;font-weight:700}.band-logo .logo{width:42px;height:42px}
.band-title{margin:0;color:#fff;font-size:22px;font-weight:400;align-self:center;padding:0 20px;letter-spacing:.3px}
.band-main{padding:30px 16px;min-height:62vh}.sheet{max-width:840px;margin:0 auto;background:#fff;padding:20px;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.req{display:flex;align-items:center;gap:8px;font-size:14px;margin:0 0 18px}.i{display:inline-flex;width:16px;height:16px;border-radius:50%;background:var(--ink);color:#fff;font:700 11px Georgia,serif;align-items:center;justify-content:center}
.sub{font-size:18px;font-weight:500;margin:22px 0 12px}
.tabset{display:flex;flex-wrap:wrap;border-bottom:1px solid #ddd;margin-bottom:16px}.tab{padding:10px 18px;color:#666;font-weight:500;text-transform:uppercase;font-size:13px;text-decoration:none}.tab:hover{color:var(--brand)}.tab.on{color:var(--brand);border-bottom:2px solid var(--brand)}
.sh-foot{border-top:1px solid #ccc;margin:30px 9px 0;padding:14px 0;font-size:13px;color:#444}.sh-foot p{margin:4px 0}.bar{margin:0 6px 0 4px;color:#666}.foot-links a{margin-right:16px;color:#444}
.app-top{display:flex;align-items:stretch;background:var(--brand);min-height:64px}.app-top .band-logo{width:260px}
.tabs{display:flex;flex:1;flex-wrap:wrap}.tabs a{color:#fff;text-decoration:none;padding:0 18px;display:flex;align-items:center;font-weight:500;border-bottom:3px solid transparent}.tabs a:hover{background:rgba(255,255,255,.1)}.tabs a.on{border-bottom-color:var(--orange);background:rgba(0,0,0,.12)}
.who{display:flex;align-items:center;gap:14px;padding:0 18px;color:#fff;font-size:13px}.who a{color:#fff}.acct-chip{background:rgba(255,255,255,.15);padding:4px 10px;border-radius:12px}
.app-body{display:flex;gap:24px;max-width:1240px;margin:0 auto;padding:24px 16px}
.side{order:-1;width:230px;flex:none;background:#fff;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.2);align-self:flex-start}.side h2{font-size:14px;text-transform:uppercase;color:#fff;background:var(--brand);margin:0;padding:12px 16px;border-radius:4px 4px 0 0;letter-spacing:.4px}.side ul{list-style:none;margin:0;padding:6px 0}.side a{display:block;padding:9px 16px;color:#333;text-decoration:none;border-left:3px solid transparent}.side a:hover{background:#f5f5f5}.side a.on{border-left-color:var(--orange);color:var(--brand);font-weight:600;background:#fafafa}
.app-main{flex:1;min-width:0}.page-title{font-size:24px;font-weight:400;color:#333;margin:0 0 16px}
.mcard{background:#fff;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.2);padding:20px 22px;margin-bottom:18px}.mcard h2{font-size:17px;font-weight:500;margin:0 0 12px;color:#333}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}.grid2 .mcard{margin:0}.grid2{margin-bottom:18px}
.due-lbl{margin:0;color:#666;text-transform:uppercase;font-size:12px;letter-spacing:.5px}.big{font-size:38px;margin:2px 0;color:var(--brand);font-weight:300}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:6px 18px;margin:0}.kv dt{color:#666}.kv dd{margin:0}
.pill{display:inline-block;padding:1px 9px;border-radius:10px;font-size:12px;background:#eee}.pill.ok{background:#e3f4e5;color:#1b5e20}
.muted{color:#757575}.small{font-size:12px}.lead{font-size:17px}
.table{width:100%;border-collapse:collapse}.mtable th{text-align:left;font-size:12px;text-transform:uppercase;color:#666;font-weight:500;border-bottom:2px solid #ddd;padding:10px 8px}.mtable td{padding:11px 8px;border-bottom:1px solid #eee}.empty{color:#888;text-align:center}.mtable form{display:inline}
.acct-select{margin-bottom:10px}
fieldset{border:1px solid #ddd;border-radius:4px;padding:12px 16px;margin:14px 0}legend{font-weight:500;padding:0 6px}.radio,.check{display:block;margin:9px 0}.other-amount{width:120px;padding:5px 8px;border:1px solid #8a8a8a;border-radius:4px}
.field{margin:12px 0}.field label{display:block;font-size:13px;color:#555;margin-bottom:4px}.field input,.field select{width:100%;max-width:340px;height:44px;padding:0 10px;border:1px solid #8a8a8a;border-radius:4px;font:inherit}.help{color:#666;font-size:12px}
details summary{cursor:pointer;color:#0d5aa7;margin:8px 0}.terms p{font-size:13px;color:#555;background:#fafafa;padding:10px;border:1px solid #eee}
.stepper{display:flex;list-style:none;padding:0;margin:0 0 16px;gap:8px}.stepper li{flex:1;display:flex;align-items:center;gap:8px;color:#888;font-size:14px;border-bottom:3px solid #ddd;padding-bottom:8px}.stepper span{display:inline-flex;width:24px;height:24px;border-radius:50%;background:#bbb;color:#fff;align-items:center;justify-content:center;font-size:13px}.stepper .on{color:#222;border-color:var(--orange)}.stepper .on span{background:var(--orange)}.stepper .done span{background:var(--brand)}
.acct-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;background:#f7f7f7;padding:12px;border-radius:4px;margin-bottom:10px}.acct-strip .lbl{display:block;font-size:11px;text-transform:uppercase;color:#777}
.okmsg{background:#e3f4e5;color:#1b5e20;padding:10px 12px;border-radius:4px}
.alert{padding:12px 14px;border-radius:4px;margin-bottom:16px}.alert-error{background:#fdecea;color:#b71c1c;border:1px solid #f5c2c0}.alert-ok{background:#e3f4e5;color:#1b5e20;border:1px solid #b7dfbb}
.help-search{display:flex;gap:8px;margin:0 0 14px}.help-search input{flex:1;height:44px;padding:0 10px;border:1px solid #8a8a8a;border-radius:4px;font:inherit}.help-search .btn{background:var(--orange);color:#fff;border:0;border-radius:4px;padding:0 18px;font:inherit;cursor:pointer}.help-list li{margin:7px 0}.crumb{margin:0}.msgs{padding-left:18px}
.usage{display:flex;align-items:flex-end;gap:10px;height:170px;padding:10px 4px 0;border-bottom:1px solid #ccc}.u-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}.u-bar{width:70%;background:var(--brand);border-radius:2px 2px 0 0;display:block}.u-lbl{font-size:11px;color:#666;margin-top:4px}.u-val{font-size:10px;color:#444;margin-bottom:2px}
.u1{height:13px}.u2{height:26px}.u3{height:39px}.u4{height:52px}.u5{height:65px}.u6{height:78px}.u7{height:91px}.u8{height:104px}.u9{height:117px}.u10{height:130px}
@media(max-width:860px){.splash-top{grid-template-columns:1fr}.coop{justify-self:center}.app-top{flex-wrap:wrap}.app-body{flex-direction:column}.side{width:100%}.grid2,.acct-strip{grid-template-columns:1fr}.band-logo{width:auto}}
${billingCss}
@media(max-width:600px){.splash{margin-top:0;padding:18px 14px 24px}.splash-box{padding:20px 16px;margin-top:18px}.splash-head p{font-size:17px}.splash-head .welcome{font-size:19px}.assist{font-size:16px}.band{flex-wrap:wrap}.band-title{font-size:18px;padding:10px 16px}.band-main{padding:16px 10px}.sheet{padding:16px}.tabs a{padding:10px 12px}.who{padding:6px 16px 10px;flex-wrap:wrap}.app-body{padding:16px 10px}.mcard{padding:16px}.stepper li{font-size:12px;flex-direction:column;align-items:flex-start;gap:4px}.usage{gap:4px}.u-val{font-size:9px}.big{font-size:30px}.kv{grid-template-columns:1fr;gap:2px}.kv dd{margin-bottom:8px}.actions{justify-content:flex-start}.tab{padding:10px 12px}}
${profileCss}
.sh-site{position:relative;background:rgba(255,255,255,.78);border-radius:4px;margin:0 0 14px}.sh-site a{color:#14243b;font-weight:600}.sh-site .pf-txt{color:#14243b}.band-site{background:#fff;border-bottom:1px solid #d9d9d9;padding:0 12px}.band-site a{color:var(--brand);font-weight:600}
.splash .pf-hero{text-align:center;color:#14243b;margin:0 0 6px}.pf-social{text-align:center}`;
