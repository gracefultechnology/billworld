// Residential waste-hauler account (WM "My WM" / Republic Services "My Account" / Waste Connections style).
// Public site with Pay My Bill, Pickup Schedule and Support up top; the signed-in dashboard leads with the
// next pickup days per container, service alerts, balance + Pay Now, AutoPay & Paperless, and
// "Manage Services" (pause / change / cancel). Payment is a single "Make a Payment" page then Review.
import { observe, finish, obsNav, obsFooter, heroText, heroLine, idLabel, submitLabel, social, helpExcerpts, articleExcerpt, mfaLead, mfaResend, OBS_CSS } from './_observed.mjs';
import { payDate, html, raw, doc, guestNeeds, logo, alert, form, field, select, checkbox, button, hidden, amountChooser, methodChooser, newMethodFields, dateField, table, paymentRows, helpList, helpBody, helpSearchForm, money, fmtDate, methodText, statusLabel, L } from '../kit.mjs';
import { withdrawn, withdrawnView } from './_withdrawn.mjs';

export const meta = {
  id: 'waste-hauler',
  // Where the dedicated tier's dossier nav (vm.nav) goes: the first element matching a selector (class:<token> or
  // aria:<label>) is re-filled with the dossier's items; observed real-site navs yield on public pages (server.mjs withDossierNav).
  navSlots: { public: ['class:top'], account: ['aria:My Account'] },
  name: 'Waste & recycling hauler account',
  description: 'Trash/recycling hauler self-service account modeled on WM (My WM), Republic Services and Waste Connections: pickup schedule panel, holiday schedule, service alerts, Pay My Bill, AutoPay & Paperless, Manage Services (pause, change, cancel).',
  families: ['waste-hauler'],
  sources: [
    'https://www.republicservices.com/customer-support/billing',
    'https://www.republicservices.com/customer-support/faq',
    'https://www.wm.com/us/en/support',
    'https://www.wm.com/us/en/terms/autopay-paperless-billing (search result summary)',
    'https://www.wasteconnections.com/'
  ],
  evidence: {
    observed_public: [
      'Republic Services header: Residential, Business, ... with utility links Pay Bill, Schedule, Support, Service Alerts; landing actions Pay My Bill, See Schedule, Manage My Account',
      'Republic FAQ topics: Invoice, Online Account, Payment, Recycling, Reporting a Problem, Service, Bulk Waste',
      'WM Support categories: Billing & Invoices, Service Questions, Mobile Devices & My WM App, Account, FAQs; My WM features: Pay My Bill, Pickup Schedule/ETA, Holiday Schedule, Report missed pickup, AutoPay & Paperless Billing, Cancel/Pause/Change Services, Add Services',
      'WM AutoPay & Paperless terms: AutoPay by ACH or card; paperless replaces mailed invoices with email notification',
      'Waste Connections navigation: Pay My Bill, Schedule, Customer Service, Contact, My Account, Pickup Schedule, Holiday Calendar, "I Am Moving"'
    ],
    documented: ['Per-biller phones, mailing address, fees and notes come from the research record via help.mjs'],
    synthetic: [
      'Pickup weekdays, container sizes and holiday-delay rules are generated deterministically per account and are illustrative only',
      'Visual design, colours and URL structure (/user/..., /account/...) are reconstructions, not copies',
      'Report-a-missed-pickup is modelled as a secure message (contact page)'
    ]
  }
};

export const routes = {
  home: '/', login: '/user/login', loginPassword: '/user/login/password', mfa: '/user/login/verify', register: '/user/register', verify: '/user/register/verify',
  forgot: '/user/forgot-password', reset: '/user/reset-password',
  guest: '/pay-bill', guestPay: '/pay-bill/payment', guestReview: '/pay-bill/review', guestReceipt: '/pay-bill/confirmation/:id',
  dashboard: '/account/dashboard', bill: '/account/billing/invoice', statements: '/account/billing/invoices', statement: '/account/billing/invoices/:id.pdf',
  pay: '/account/billing/make-a-payment', payMethod: '/account/billing/make-a-payment/method', payReview: '/account/billing/make-a-payment/review', payReceipt: '/account/billing/make-a-payment/confirmation/:id',
  history: '/account/billing/payment-history', autopay: '/account/billing/autopay', paperless: '/account/billing/paperless', wallet: '/account/billing/payment-methods',
  cancel: '/account/services/manage', plan: '/account/services/change', arrangement: '/account/billing/payment-extension', contact: '/account/support/request', profile: '/account/profile',
  logout: '/user/logout', help: '/support', helpArticle: '/support/faq/:slug', helpSearch: '/support/search'
};
export const flow = { paySteps: ['pay', 'payReview'], loginSteps: 1, guestSteps: ['guest', 'guestPay', 'guestReview'] };

const offline = vm => vm.biller.capabilities.online_account.support === 'unsupported';
const sup = (vm, k) => vm.biller.capabilities[k]?.support === 'supported';
// AutoPay timing: dedicated billers say "due date" only when the dossier says so (daysAfterBill is rewritten by the server).
const apWhen = (vm, dueText) => vm.tier !== 'dedicated' || vm.billing?.autopayDays === 'due_date' || vm.billing?.autopayDaysAfterBill != null ? dueText : 'on the scheduled draft date shown on your invoice';
const art = (vm, slug) => vm.help.some(a => a.slug === slug) ? vm.url('helpArticle', { slug }) : vm.url('help');
const isTrash = vm => vm.biller.billType === 'trash';
const DAY = 86400000;
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const short = ms => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

// Deterministic, illustrative pickup schedule from the account number.
function schedule(vm) {
  const n = Number(String(vm.account.accountNumber).slice(-3)) || 0;
  const dow = 1 + (n % 5); // Mon–Fri
  const today = Date.parse(`${vm.today}T12:00:00Z`);
  const offset = (dow - new Date(today).getUTCDay() + 7) % 7;
  const next = today + offset * DAY;
  const recycleWeek = n % 2;
  const weekNo = Math.floor(next / (7 * DAY));
  const nextRecycle = (weekNo % 2 === recycleWeek) ? next : next + 7 * DAY;
  return {
    day: DOW[dow], next, nextRecycle, nextYard: nextRecycle + 7 * DAY,
    containers: [
      ['Trash', `${[64, 96, 96, 35][n % 4]}-gallon cart`, 'Weekly', next, 'trash'],
      ['Recycling', '96-gallon cart', 'Every other week', nextRecycle, 'recycle'],
      ['Yard Waste', '96-gallon cart', 'Seasonal (Apr–Nov), every other week', nextRecycle + 7 * DAY, 'yard']
    ]
  };
}

function header(vm) {
  const right = offline(vm) ? '' : vm.authenticated
    ? html`<div class="hdr-right"><a class="pill" href="${vm.url('pay')}">${L(vm, 'pay', 'Pay My Bill')}</a><a href="${vm.url('dashboard')}">${L(vm, 'dashboard', 'My Account')}</a><a href="${vm.url('profile')}">${vm.persona.first}</a><a href="${vm.url('logout')}">${L(vm, 'logout', 'Log Out')}</a></div>`
    : html`<div class="hdr-right"><a class="pill" href="${vm.url(sup(vm, 'guest_pay') ? 'guest' : 'login')}">Pay My Bill</a><a class="login" href="${vm.url('login')}">${L(vm, 'login', 'Log In')}</a></div>`;
  return html`<header class="hdr"><div class="wrap hdr-row"><a class="brand" href="${vm.url('home')}">${logo(vm)}<span>${vm.biller.brand.shortName}</span></a><nav class="top" aria-label="Main"><a href="${vm.url('home')}">${L(vm, 'home', 'Residential')}</a>${offline(vm) || !isTrash(vm) ? '' : html`<a href="${vm.authenticated ? `${vm.url('dashboard')}#pickup-schedule` : vm.url('login')}">Pickup Schedule</a>`}<a href="${art(vm, 'pay-your-bill')}">Billing</a><a href="${vm.url('help')}">${L(vm, 'help', 'Support')}</a></nav>${right}</div></header>`;
}
function acctTabs(vm) {
  const tabs = [['dashboard', 'Overview'], ['bill', 'Invoices'], ['pay', 'Make a Payment'], ['history', 'Payment History'], ['autopay', 'AutoPay'], ['paperless', 'Paperless'], ['wallet', 'Payment Methods'], ['cancel', 'Manage Services'], ['contact', 'Service Requests']];
  const cur = { payReview: 'pay', payReceipt: 'pay', payMethod: 'pay', statements: 'bill', plan: 'cancel', arrangement: 'history', profile: 'dashboard' }[vm.page] || vm.page;
  return html`<div class="acctbar"><div class="wrap"><div class="loc"><span class="pin" aria-hidden="true">●</span><div><small>Service location · Account ${vm.accountMasked}</small><strong>${vm.account.serviceAddress}</strong></div></div><nav class="tabs" aria-label="My Account">${tabs.filter(([pg]) => pg !== 'cancel' || sup(vm, 'cancel_service')).map(([pg, label]) => html`<a href="${vm.url(pg)}"${cur === pg ? raw(' class="on" aria-current="page"') : ''}>${L(vm, pg, label)}</a>`)}</nav></div></div>`;
}
function footer(vm) {
  return html`<footer class="foot"><div class="wrap fcols"><div><strong>${vm.biller.brand.shortName}</strong><p>${vm.biller.serviceArea || ''}</p>${vm.biller.parent ? html`<p class="muted">${vm.biller.parent}</p>` : ''}</div><div><strong>Customer Service</strong><p>${vm.biller.phone || 'Number on your invoice'}</p></div><div><strong>Quick Links</strong><p><a href="${art(vm, 'pay-your-bill')}">Ways to Pay</a><br><a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact Us</a><br><a href="${vm.url('help')}">${L(vm, 'help', 'Support & FAQs')}</a></p></div></div>${!vm.authenticated ? html`<div class="wrap">${obsFooter(vm)}</div>` : ''}</footer>`;
}
function shell(vm, title, body, { account = false } = {}) {
  return doc(vm, { title: `${title} | ${vm.biller.brand.shortName}`, bodyClass: 'hauler', body: html`${header(vm)}${obsNav(vm)}${account && vm.authenticated ? acctTabs(vm) : ''}<main class="wrap main">${alert(vm)}${body}</main>${footer(vm)}` });
}
const acct = (vm, title, body) => shell(vm, title, body, { account: true });
const h1 = t => html`<h1>${t}</h1>`;

function pickupPanel(vm) {
  const s = schedule(vm);
  if (!isTrash(vm)) return html`<section class="card"><h2>Service</h2><p>Your service is active at ${vm.account.serviceAddress}.</p></section>`;
  return html`<section class="card pickup" id="pickup-schedule"><div class="card-head"><h2>Your Pickup Schedule</h2><span class="tag">${s.day} pickup</span></div><p class="muted">Place carts at the curb by 6:00 a.m. on your pickup day, lids closed and handles facing your home.</p><ul class="containers">${s.containers.map(([name, size, freq, next, cls]) => html`<li class="ct ${cls}"><span class="bin" aria-hidden="true"></span><div><strong>${name}</strong><small>${size} · ${freq}</small></div><div class="next"><small>Next pickup</small><strong>${short(next)}</strong></div></li>`)}</ul><details id="holiday-schedule"${vm.query.holiday ? raw(' open') : ''}><summary>Holiday Schedule</summary><p class="small">No collection on New Year's Day, Memorial Day, Independence Day, Labor Day, Thanksgiving Day and Christmas Day. Service the rest of that week runs one day late.</p></details></section>`;
}

const pages = {
  home(vm) {
    if (offline(vm)) return shell(vm, 'Paying your bill', html`${h1(`Paying your ${vm.biller.name} bill`)}<p class="lead">Online account access and online bill payment are not available for this service.</p><section class="card">${helpBody(vm.help.find(a => a.slug === 'pay-your-bill'))}</section>`);
    const g = sup(vm, 'guest_pay');
    return shell(vm, 'Residential', html`<section class="hero"><div>${h1(heroText(vm, `${isTrash(vm) ? 'Trash & recycling service' : 'Service'} from ${vm.biller.brand.shortName}`))}<p class="lead">Log in to ${isTrash(vm) ? 'see your pickup schedule, ' : ''}pay your bill, and manage AutoPay, paperless billing and services.</p><div class="hero-actions"><a class="pill big" href="${vm.url(g ? 'guest' : 'login')}">Pay My Bill</a><a class="btn-out" href="${vm.url('login')}">${L(vm, 'login', 'Log In to My Account')}</a></div><p class="small">New to online account? <a href="${vm.url('register')}">${L(vm, 'register', 'Create an account')}</a></p></div></section>
      <section class="tiles3">${isTrash(vm) ? html`<a class="tile" href="${vm.url('login')}"><strong>Pickup Schedule</strong><span>See your next collection day and holiday delays</span></a>` : html`<a class="tile" href="${vm.url('help')}"><strong>${L(vm, 'help', 'Support')}</strong><span>Billing and service questions</span></a>`}<a class="tile" href="${vm.url(g ? 'guest' : 'login')}"><strong>Pay My Bill</strong><span>${g ? 'Pay with your account number, no login needed' : 'Log in to pay online'}</span></a><a class="tile" href="${art(vm, 'autopay')}"><strong>AutoPay &amp; Paperless</strong><span>Set it once and let us do the rest</span></a></section>
      ${vm.biller.serviceArea ? html`<section class="alertbar"><strong>Service Alerts</strong> · Collection is running on schedule in ${String(vm.biller.serviceArea).replace(/[.\s]+$/, "")}.</section>` : ''}
      <section class="card"><h2>How can we help?</h2>${helpSearchForm(vm, { placeholder: 'Search billing, pickup and service questions' })}</section>`);
  },
  login(vm) {
    return shell(vm, 'Log In', html`<div class="authbox">${h1(L(vm, 'login', 'Log In'))}<p class="muted">Manage your account, pay bills and view your pickup schedule.</p>${form(vm, 'login', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'username', label: idLabel(vm, 'Email address or account number'), autocomplete: 'username' })}${field(vm, { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' })}${button(submitLabel(vm, 'Log In'), { cls: 'pill full' })}`)}${social(vm)}<p class="center"><a href="${vm.url('forgot')}">${L(vm, 'forgot', 'Forgot password?')}</a></p><div class="divider"><span>Don't have an account?</span></div><a class="btn-out full" href="${vm.url('register')}">${L(vm, 'register', 'Sign Up')}</a>${sup(vm, 'guest_pay') ? html`<p class="center small"><a href="${vm.url('guest')}">${L(vm, 'guest', 'Pay without logging in')}</a></p>` : ''}</div>`);
  },
  loginPassword(vm) { return pages.login(vm); },
  mfa(vm) { return shell(vm, 'Verification', html`<div class="authbox">${h1('Enter Verification Code')}<p>${mfaLead(vm, `We emailed a 6-digit code to the address on your account.`)}</p>${form(vm, 'mfa', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'code', label: 'Verification code', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' })}${button('Verify', { cls: 'pill full' })}`)}${mfaResend(vm)}</div>`); },
  register(vm) {
    return shell(vm, 'Sign Up', html`<div class="authbox wide">${h1('Sign Up for an Online Account')}<p>You'll need your customer account number from your invoice.</p>${form(vm, 'register', html`<div class="two">${field(vm, { name: 'accountNumber', label: 'Account number', inputmode: 'numeric' })}${field(vm, { name: 'zip', label: 'Service ZIP code', inputmode: 'numeric', maxlength: 5 })}</div>${field(vm, { name: 'email', label: 'Email address', type: 'email', autocomplete: 'email' })}<div class="two">${field(vm, { name: 'password', label: 'Password', type: 'password', autocomplete: 'new-password', help: '8+ characters, upper & lower case, number and symbol' })}${field(vm, { name: 'confirm', label: 'Confirm password', type: 'password', autocomplete: 'new-password' })}</div>${button('Create Account', { cls: 'pill' })}`)}<p class="small">Already have an account? <a href="${vm.url('login')}">${L(vm, 'login', 'Log in')}</a></p></div>`);
  },
  verify(vm) { return shell(vm, 'Verify email', html`<div class="authbox">${h1('Check your inbox')}<p>Select the link in the email we sent to activate your account.</p><p><a href="${vm.url('login')}">Back to Log In</a></p></div>`); },
  forgot(vm) { return shell(vm, 'Forgot password', html`<div class="authbox">${h1(L(vm, 'forgot', 'Forgot Password'))}<p>Enter your email address and we'll send you a code to reset your password.</p>${form(vm, 'forgot', html`${field(vm, { name: 'identifier', label: 'Email address or account number', autocomplete: 'username' })}${button('Send Code', { cls: 'pill full' })}`)}<p class="center"><a href="${vm.url('login')}">Back to Log In</a></p></div>`); },
  reset(vm) { return shell(vm, 'Reset password', html`<div class="authbox">${h1('Reset Password')}${form(vm, 'reset', html`${vm.query.token ? hidden('token', vm.query.token) : field(vm, { name: 'code', label: 'Code from email', inputmode: 'numeric', autocomplete: 'one-time-code' })}${field(vm, { name: 'password', label: 'New password', type: 'password', autocomplete: 'new-password' })}${field(vm, { name: 'confirm', label: 'Confirm new password', type: 'password', autocomplete: 'new-password' })}${button('Update Password', { cls: 'pill full' })}`)}</div>`); },
  guest(vm) { return shell(vm, 'Pay My Bill', html`<div class="authbox wide">${h1(L(vm, 'guest', 'Pay My Bill'))}<p>Pay without logging in using ${guestNeeds(vm, 'the account number and ZIP code on your invoice')}.</p>${form(vm, 'guest', html`<div class="two">${field(vm, { name: 'accountNumber', label: 'Account number', inputmode: 'numeric' })}${field(vm, { name: 'zip', label: 'Service ZIP code', inputmode: 'numeric', maxlength: 5 })}</div>${button('Find Account', { cls: 'pill' })}`)}<p class="small">Want AutoPay or your pickup schedule? <a href="${vm.url('login')}">${L(vm, 'login', 'Log in')}</a> or <a href="${vm.url('register')}">${L(vm, 'register', 'sign up')}</a>.</p></div>`); },
  guestPay(vm) { return shell(vm, 'Pay My Bill', html`<div class="authbox wide">${h1('Payment Details')}<div class="balrow"><span>Account ${vm.accountMasked}</span><span>Balance due <strong>${money(vm.balanceCents)}</strong></span></div>${form(vm, 'guestPay', html`${amountChooser(vm, { labels: { legend: 'Payment amount', due: 'Balance due' } })}<fieldset><legend>Payment method</legend>${newMethodFields(vm)}</fieldset>${button('Review Payment', { cls: 'pill' })}`)}</div>`); },
  guestReview(vm) { return reviewPage(vm, 'guestReview'); },
  guestReceipt(vm) { return receiptPage(vm); },
  dashboard(vm) {
    const ap = vm.autopay;
    return acct(vm, 'My Account', html`<div class="greet">${h1(`Hi, ${vm.persona.first}`)}<a class="small" href="${vm.url('profile')}">${L(vm, 'profile', 'Profile & contact preferences')}</a></div>
      ${isTrash(vm) ? html`<section class="alertbar"><strong>Service Alert</strong> · Holiday weeks run one day late. <a href="${vm.url('dashboard')}?holiday=1#holiday-schedule">See the holiday schedule</a></section>` : ''}
      <div class="dash">${pickupPanel(vm)}
      <section class="card bal"><h2>Balance Due</h2><p class="amount">${money(vm.balanceCents)}</p><p>Due ${vm.dueText}</p>${vm.pendingPayments.length ? html`<p class="warn">${vm.pendingPayments.length} payment(s) processing</p>` : ''}${vm.scheduled.length ? html`<p class="warn">${vm.scheduled.length} scheduled payment(s)</p>` : ''}<a class="pill full" href="${vm.url('pay')}">${L(vm, 'pay', 'Pay Now')}</a><p class="center small"><a href="${vm.url('bill')}">${L(vm, 'bill', 'View latest invoice')}</a> · <a href="${vm.url('statements')}">${L(vm, 'statements', 'All invoices')}</a></p></section></div>
      <div class="dash3"><section class="card"><h3>AutoPay</h3><p class="${ap.enrolled ? 'on' : 'off'}">${ap.enrolled ? 'On' : 'Off'}</p><a href="${vm.url('autopay')}">${ap.enrolled ? 'Manage AutoPay' : 'Set up AutoPay'}</a></section><section class="card"><h3>Paperless Billing</h3><p class="${vm.account.paperless ? 'on' : 'off'}">${vm.account.paperless ? 'On' : 'Off'}</p><a href="${vm.url('paperless')}">${vm.account.paperless ? 'Manage' : 'Go paperless'}</a></section><section class="card"><h3>My Services</h3><p class="${vm.service.status === 'active' ? 'on' : 'off'}">${vm.service.status === 'active' ? 'Active' : vm.service.status === 'cancel_pending' ? `Ends ${fmtDate(vm.service.cancelAt)}` : 'Cancelled'}</p>${sup(vm, 'cancel_service') ? html`<a href="${vm.url('cancel')}">Manage Services</a>` : html`<a href="${vm.url('contact')}">${L(vm, 'contact', 'Service request')}</a>`}</section></div>
      <section class="card"><h2>Account tools</h2><ul class="toolgrid"><li><a href="${vm.url('history')}">${L(vm, 'history', 'Payment History')}</a></li><li><a href="${vm.url('wallet')}">${L(vm, 'wallet', 'Saved Payment Methods')}</a></li><li><a href="${vm.url('arrangement')}">${L(vm, 'arrangement', 'Payment Extension')}</a></li><li><a href="${vm.url('contact')}">${L(vm, 'contact', 'Report a Missed Pickup')}</a></li><li><a href="${vm.url('plan')}">Change Container Size</a></li><li><a href="${vm.url('statements')}">${L(vm, 'statements', 'Invoice History')}</a></li></ul></section>`);
  },
  bill(vm) {
    const inv = vm.invoice;
    return acct(vm, 'Invoice', html`<div class="greet">${h1(L(vm, 'bill', 'Current Invoice'))}<a href="${vm.url('statements')}">${L(vm, 'statements', 'Invoice history')} ›</a></div><section class="card invoice"><div class="inv-top"><div><small>Invoice #</small><strong>${inv.number}</strong></div><div><small>Invoice date</small><strong>${fmtDate(inv.issuedAt)}</strong></div><div><small>Service period</small><strong>${inv.period}</strong></div><div><small>${L(vm, 'dueDate', 'Due date')}</small><strong>${fmtDate(inv.dueAt)}</strong></div></div>${table(['Description', 'Amount'], [...inv.lines.map(l => [l.desc, money(l.cents)]), [html`<strong>Invoice total</strong>`, html`<strong>${money(inv.amountCents)}</strong>`]])}<div class="inv-foot"><span>Balance due <strong>${money(vm.balanceCents)}</strong></span><a class="pill" href="${vm.url('pay')}">${L(vm, 'pay', 'Pay Now')}</a><a class="btn-out" href="${vm.url('statement', { id: inv.id })}">Download PDF</a></div></section>`);
  },
  statements(vm) { return acct(vm, 'Invoices', html`${h1(L(vm, 'statements', 'Invoice History'))}<section class="card">${table(['Invoice date', 'Invoice #', 'Amount', 'Due date', ''], vm.invoices.map(i => [fmtDate(i.issuedAt), i.number, money(i.amountCents), fmtDate(i.dueAt), html`<a href="${vm.url('statement', { id: i.id })}">PDF</a>`]))}</section>`); },
  pay(vm) {
    return acct(vm, 'Make a Payment', html`${h1(L(vm, 'pay', 'Make a Payment'))}<div class="balrow"><span>Balance due <strong>${money(vm.balanceCents)}</strong></span><span>Due ${vm.dueText}</span></div>${form(vm, 'pay', html`<div class="paygrid"><section class="card">${amountChooser(vm, { labels: { legend: '1. Choose amount', due: 'Balance due' } })}${dateField(vm, { label: 'Payment date' })}</section><section class="card">${methodChooser(vm, { title: '2. Choose payment method' })}</section></div>${button('Review Payment', { cls: 'pill' })}`)}`);
  },
  payMethod(vm) { return pages.pay(vm); },
  payReview(vm) { return reviewPage(vm, 'payReview'); },
  payReceipt(vm) { return receiptPage(vm); },
  history(vm) { return acct(vm, 'Payment History', html`${h1(L(vm, 'history', 'Payment History'))}<section class="card">${table(['Date', 'Amount', 'Method', 'Confirmation', 'Status', ''], paymentRows(vm))}</section><p class="small">Need more time to pay? <a href="${vm.url('arrangement')}">${L(vm, 'arrangement', 'Request a payment extension')}</a>.</p>`); },
  autopay(vm) {
    const ap = vm.autopay;
    return acct(vm, 'AutoPay', html`${h1(L(vm, 'autopay', 'AutoPay'))}<p class="lead">Set it once and let us do the rest — your balance is paid automatically ${apWhen(vm, 'on each invoice due date')}.</p>${ap.enrolled ? html`<section class="card ok"><h2>AutoPay is on</h2><p>We charge ${vm.autopayMethod ? methodText(vm.autopayMethod) : 'your saved method'} for the full balance ${apWhen(vm, 'on each due date')}.</p>${form(vm, 'autopay', html`${hidden('action', 'cancel')}${checkbox(vm, { name: 'confirm', label: 'I want to turn off AutoPay. I will pay future invoices myself.' })}${button('Turn Off AutoPay', { cls: 'btn-danger' })}`)}</section><h2>Update AutoPay</h2>` : ''}<section class="card">${form(vm, 'autopay', html`${hidden('action', 'enroll')}${hidden('policy', 'full')}${methodChooser(vm, { title: 'AutoPay payment method' })}<p class="small">AutoPay may be made by automatic withdrawal from a checking account (ACH) or by credit or debit card. You can cancel at any time.</p>${checkbox(vm, { name: 'acceptTerms', label: 'I agree to the AutoPay & Paperless Billing Terms & Conditions.' })}${button(ap.enrolled ? 'Save' : 'Turn On AutoPay', { cls: 'pill' })}`)}</section>`);
  },
  paperless(vm) {
    const on = vm.account.paperless;
    return acct(vm, 'Paperless Billing', html`${h1(L(vm, 'paperless', 'Paperless Billing'))}<section class="card"><p>Paperless billing is <strong class="${on ? 'on' : 'off'}">${on ? 'on' : 'off'}</strong>.</p><p>When you enroll you'll receive all invoices electronically, no longer receive a mailed invoice, and be notified by email when a new invoice is available.</p>${form(vm, 'paperless', html`${hidden('paperless', on ? 'off' : 'on')}${!on ? field(vm, { name: 'email', label: 'Invoice notification email', type: 'email', value: vm.persona.email }) : ''}${button(on ? 'Switch to Paper Invoices' : 'Go Paperless', { cls: on ? 'btn-out' : 'pill' })}`)}</section>`);
  },
  wallet(vm) { return acct(vm, 'Payment Methods', html`${h1(L(vm, 'wallet', 'Saved Payment Methods'))}<section class="card"><ul class="wallet">${vm.methods.map(m => html`<li><span class="chip">${m.type === 'bank' ? 'ACH' : 'CARD'}</span><span>${methodText(m)}${m.nickname ? html` <span class="muted">· ${m.nickname}</span>` : ''}</span>${form(vm, 'wallet', html`${hidden('op', 'remove')}${hidden('methodId', m.id)}<button type="submit" class="linkbtn" aria-label="Delete ${methodText(m)}">Delete</button>`)}</li>`)}</ul></section><section class="card"><h2>Add Payment Method</h2>${form(vm, 'wallet', html`${hidden('op', 'add')}${newMethodFields(vm)}${field(vm, { name: 'nickname', label: 'Nickname (optional)', required: false })}${button('Save', { cls: 'pill' })}`)}</section>`); },
  cancel(vm) {
    if (vm.service.status !== 'active' && vm.step !== 'done') return acct(vm, 'Manage Services', html`${h1('Manage Services')}<section class="card"><p>Your service ${vm.service.status === 'cancel_pending' ? html`is scheduled to end on <strong>${fmtDate(vm.service.cancelAt)}</strong>. Leave carts at the curb on your last pickup day for removal` : 'has been cancelled'}.</p>${vm.service.status === 'cancel_pending' ? form(vm, 'cancel', html`${hidden('step', 'undo')}${button('Keep My Service', { cls: 'btn-out' })}`) : ''}</section>`);
    const opts = html`<div class="svcopts"><a class="svc" href="${vm.url('contact')}"><strong>${L(vm, 'contact', 'Pause Service')}</strong><span>Vacation hold — send a request</span></a><a class="svc" href="${vm.url('plan')}"><strong>Change Service</strong><span>Container size or extra cart</span></a><div class="svc cur"><strong>Cancel Service</strong><span>Moving or no longer need service</span></div></div>`;
    const steps = {
      reason: html`${h1('Manage Services')}${opts}<section class="card"><h2>Cancel Service</h2>${form(vm, 'cancel', html`${hidden('step', 'reason')}${select(vm, { name: 'reason', label: 'Reason for cancelling', options: [['', 'Select a reason'], ['moving', "I'm moving"], ['cost', 'Price'], ['switching', 'Switching to another hauler / city service'], ['not_using', "Don't need service"], ['other', 'Other']] })}${button('Next', { cls: 'pill' })}`)}</section>`,
      offer: html`${h1(L(vm, 'cancel', 'Before you cancel'))}<section class="card"><h2>Moving within our area?</h2><p>We can transfer service to your new address so you don't miss a pickup.</p>${form(vm, 'cancel', html`${hidden('step', 'offer')}${button('Keep my service', { name: 'accept', value: 'yes', cls: 'pill' })} ${button('Continue to cancel', { cls: 'btn-out', name: 'accept', value: 'no' })}`)}</section>`,
      confirm: html`${h1('Cancel Service')}<section class="card"><p>Choose your last service date. Leave all carts at the curb on that day so we can collect them. A final invoice will be sent for any remaining balance.</p>${form(vm, 'cancel', html`${hidden('step', 'confirm')}${dateField(vm, { name: 'effectiveDate', label: 'Last day of service' })}${checkbox(vm, { name: 'confirm', label: 'Yes, cancel service at this location.' })}${button('Cancel Service', { cls: 'btn-danger' })}`)}</section>`,
      done: withdrawn(vm) ? withdrawnView(vm) : html`${h1('Your cancellation request is confirmed')}<section class="card ok"><p>Service ends <strong>${vm.service.cancelAt ? fmtDate(vm.service.cancelAt) : ''}</strong>. Confirmation <strong>${vm.service.confirmation || ''}</strong>.</p><p><a href="${vm.url('dashboard')}">Back to My Account</a></p></section>`,
      kept: html`${h1('Thanks for staying with us')}<p>Your service is unchanged.</p>`
    };
    return acct(vm, 'Manage Services', steps[vm.step]);
  },
  plan(vm) { return acct(vm, 'Change Service', html`${h1('Change Service')}<section class="card">${vm.plans.length ? form(vm, 'plan', html`<fieldset><legend>Choose a service level</legend>${vm.plans.map(p => html`<label class="radio"><input type="radio" name="planId" value="${p.id}"${p.current ? raw(' checked') : ''}> ${p.name}${p.cents ? ` – ${money(p.cents)}/mo` : ''}${p.current ? ' (current)' : ''}</label>`)}</fieldset>${button('Update Service', { cls: 'pill' })}`) : html`<p>Container size changes and extra carts are handled by request. <a href="${vm.url('contact')}">${L(vm, 'contact', 'Submit a service request')}</a> and we'll confirm pricing before any change.</p>`}</section>`); },
  arrangement(vm) { return acct(vm, 'Payment Extension', html`${h1(L(vm, 'arrangement', 'Payment Extension'))}<section class="card">${vm.account.arrangement ? html`<p>Your balance is being paid in ${vm.account.arrangement.months} monthly installments of ${money(vm.account.arrangement.monthlyCents)}.</p>` : form(vm, 'arrangement', html`<p>Split your balance of <strong>${money(vm.balanceCents)}</strong> into monthly installments.</p>${select(vm, { name: 'months', label: 'Installments', options: [['3', '3 months'], ['6', '6 months'], ['12', '12 months']] })}${button('Request Extension', { cls: 'pill' })}`)}</section>`); },
  contact(vm) { return acct(vm, 'Service Requests', html`${h1(L(vm, 'contact', 'Service Requests'))}<p>Report a missed pickup, request a vacation hold or bulk item pickup, or ask a billing question.</p>${vm.account.messages.length ? html`<section class="card"><h2>Open requests</h2><ul>${vm.account.messages.map(m => html`<li>${fmtDate(m.at)} – ${m.subject} (${m.status})</li>`)}</ul></section>` : ''}<section class="card">${form(vm, 'contact', html`${field(vm, { name: 'subject', label: 'Request type / subject', placeholder: 'e.g. Missed recycling pickup' })}<div class="field"><label for="f-message">Details</label><textarea id="f-message" name="message" rows="4" required>${vm.values.message || ''}</textarea></div>${button('Submit Request', { cls: 'pill' })}`)}</section>`); },
  profile(vm) { return acct(vm, 'Profile', html`${h1(L(vm, 'profile', 'Profile'))}<section class="card"><dl><dt>Name</dt><dd>${vm.persona.name}</dd><dt>Email</dt><dd>${vm.persona.email}</dd><dt>Phone</dt><dd>${vm.account.phone || 'Not provided'}</dd><dt>Service address</dt><dd>${vm.account.serviceAddress}</dd></dl></section><section class="card"><h2>Pickup reminders by text</h2>${form(vm, 'profile', html`${field(vm, { name: 'phone', label: 'Mobile number', type: 'tel' })}${button('Save', { cls: 'pill' })}`)}</section>`); },
  help(vm) {
    const groups = [['Billing & Invoices', ['payments', 'billing']], ['AutoPay & Paperless', ['autopay']], ['Online Account', ['account']], ['Assistance', ['assistance']], ['Contact & FAQs', ['contact', 'faq']]];
    return shell(vm, 'Support', html`${h1(L(vm, 'help', 'Customer Support'))}${offline(vm) ? html`<p class="lead">Online accounts are not available for this service.</p>` : ''}${helpSearchForm(vm, { placeholder: 'Search billing, pickup and service questions' })}<div class="helpgrid">${groups.map(([title, topics]) => { const list = vm.help.filter(a => topics.includes(a.topic)); return list.length ? html`<section class="card"><h2>${title}</h2>${helpList(vm, list)}</section>` : ''; })}</div>${helpExcerpts(vm)}`);
  },
  helpArticle(vm) { return shell(vm, vm.article.title, html`<p class="crumbs"><a href="${vm.url('help')}">${L(vm, 'help', 'Support')}</a> / ${vm.article.title}</p>${h1(vm.article.title)}<section class="card article">${helpBody(vm.article)}</section>${articleExcerpt(vm)}`); },
  helpSearch(vm) { return shell(vm, 'Search', html`${h1('Search Support')}${helpSearchForm(vm, { placeholder: 'Search billing, pickup and service questions' })}${vm.results.length ? html`<section class="card">${helpList(vm, vm.results)}</section>` : html`<p>No results for “${vm.query.q || ''}”.</p>`}`); }
};

function reviewPage(vm, page) {
  const d = vm.draft, guest = page === 'guestReview';
  const body = html`${h1('Review Payment')}<section class="card"><dl class="review"><dt>Account</dt><dd>${vm.accountMasked}</dd><dt>Payment amount</dt><dd>${money(d.amountCents)}</dd>${d.feeCents ? html`<dt>Processing fee</dt><dd>${money(d.feeCents)}</dd>` : ''}<dt>Total payment</dt><dd><strong>${money(d.totalCents)}</strong></dd><dt>Payment method</dt><dd>${methodText(d.method)}</dd><dt>Payment date</dt><dd>${d.payOn || 'Today'}</dd></dl>${form(vm, page, html`${hidden('token', d.token)}${hidden('op', 'submit')}${checkbox(vm, { name: 'acceptTerms', label: 'I authorize this payment and agree to the payment terms.' })}${button('Submit Payment', { cls: 'pill' })}`)}${!guest ? form(vm, page, html`${hidden('op', 'edit')}${button('Edit', { cls: 'linkbtn' })}`) : ''}</section>`;
  return guest ? shell(vm, 'Review payment', html`<div class="authbox wide">${body}</div>`) : acct(vm, 'Review payment', body);
}
function receiptPage(vm) {
  const p = vm.payment;
  const body = html`<section class="card ok receipt"><p class="check" aria-hidden="true">✓</p>${h1(p.status === 'scheduled' ? 'Payment Scheduled' : 'Payment Received')}<p>Thank you! A confirmation email is on its way.</p><dl><dt>Confirmation #</dt><dd><strong>${p.confirmation}</strong></dd><dt>Amount</dt><dd>${money(p.amountCents)}</dd>${p.feeCents ? html`<dt>Processing fee</dt><dd>${money(p.feeCents)}</dd>` : ''}<dt>Method</dt><dd>${vm.paymentMethod ? methodText(vm.paymentMethod) : `****${p.methodLast4}`}</dd><dt>Date</dt><dd>${payDate(p)}</dd><dt>Status</dt><dd>${statusLabel(p.status)}</dd></dl></section>${vm.authenticated ? html`<p><a class="btn-out" href="${vm.url('dashboard')}">Back to My Account</a></p>` : html`<p><a class="btn-out" href="${vm.url('home')}">Done</a></p>`}`;
  return vm.authenticated ? acct(vm, 'Payment confirmation', body) : shell(vm, 'Payment confirmation', html`<div class="authbox wide">${body}</div>`);
}

export function render(page, vm) { const fn = pages[page]; if (!fn) throw new Error(`waste-hauler cannot render ${page}`); vm = observe(vm); return finish(vm, fn(vm)); }

export const css = `*{box-sizing:border-box}body{margin:0;font:16px/1.55 "Helvetica Neue",Helvetica,Arial,sans-serif;color:#1c2b22;background:#f5f7f4}a{color:var(--brand);font-weight:600}
.wrap{max-width:1140px;margin:0 auto;padding:0 20px}.main{padding-top:26px;padding-bottom:48px}
.hdr{background:#fff;border-bottom:1px solid #dfe5de}.hdr-row{display:flex;align-items:center;gap:28px;min-height:72px}.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:#1c2b22;font-weight:800;font-size:20px}.logo{width:42px;height:42px}
.top{display:flex;gap:22px;flex:1}.top a{color:#1c2b22;text-decoration:none;font-weight:700;font-size:15px;padding:24px 0;border-bottom:3px solid transparent}.top a:hover{border-bottom-color:var(--brand)}
.hdr-right{display:flex;align-items:center;gap:16px}.hdr-right a{text-decoration:none}.login{color:#1c2b22}
.pill{display:inline-block;background:var(--brand);color:#fff!important;border:0;border-radius:999px;padding:11px 26px;font:inherit;font-weight:800;text-decoration:none;cursor:pointer;text-align:center}.pill:hover{filter:brightness(1.1)}.pill.big{font-size:18px;padding:14px 34px}.full{display:block;width:100%;margin:10px 0}
.btn-out{display:inline-block;border:2px solid var(--brand);color:var(--brand);background:#fff;border-radius:999px;padding:9px 24px;font:inherit;font-weight:800;text-decoration:none;cursor:pointer;text-align:center}.btn-danger{background:#c62828;color:#fff;border:0;border-radius:999px;padding:11px 26px;font:inherit;font-weight:800;cursor:pointer}.linkbtn{background:none;border:0;color:var(--brand);text-decoration:underline;font:inherit;cursor:pointer;padding:0}
.acctbar{background:var(--brand);color:#fff}.acctbar .wrap{padding-top:14px}.loc{display:flex;gap:12px;align-items:center}.loc small{display:block;opacity:.85}.pin{font-size:22px;color:#c8f7c5}.tabs{display:flex;gap:4px;flex-wrap:wrap;margin-top:12px}.tabs a{color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px 10px 0 0;font-size:15px}.tabs a:hover{background:rgba(255,255,255,.15)}.tabs a.on{background:#f5f7f4;color:#1c2b22}
h1{font-size:32px;font-weight:800;margin:0 0 14px;letter-spacing:-.4px}h2{font-size:20px;margin:0 0 10px}h3{margin:0 0 6px;font-size:16px}.lead{font-size:18px;color:#3d4f43}.muted{color:#66766b}.small{font-size:14px}.center{text-align:center}
.card{background:#fff;border-radius:16px;padding:22px 24px;margin-bottom:18px;box-shadow:0 2px 10px rgba(28,43,34,.07)}.card-head{display:flex;justify-content:space-between;align-items:center;gap:10px}.tag{background:#e6f2e7;color:#1d5c2a;border-radius:999px;padding:4px 12px;font-weight:700;font-size:14px}
.hero{background:linear-gradient(120deg,var(--brand),color-mix(in srgb,var(--brand) 40%,#0d1a12));color:#fff;border-radius:20px;padding:44px;margin-bottom:22px}.hero h1{font-size:40px;color:#fff;max-width:720px}.hero .lead{color:#e3efe5;max-width:640px}.hero a{color:#fff}.hero-actions{display:flex;gap:14px;flex-wrap:wrap;margin:18px 0}.hero .pill{background:#fff;color:#16301f!important}.hero .btn-out{background:transparent;border-color:#fff;color:#fff}
.tiles3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:18px}.tile{background:#fff;border-radius:16px;padding:22px;text-decoration:none;color:#1c2b22;box-shadow:0 2px 10px rgba(28,43,34,.07);display:flex;flex-direction:column;gap:6px;border-top:5px solid var(--brand)}.tile span{color:#66766b;font-weight:400}
.alertbar{background:#fff7d6;border:1px solid #f0d77a;border-radius:12px;padding:12px 16px;margin-bottom:18px}
.authbox{max-width:460px;margin:10px auto;background:#fff;border-radius:18px;padding:32px;box-shadow:0 2px 14px rgba(28,43,34,.1)}.authbox.wide{max-width:760px}.divider{text-align:center;border-top:1px solid #dfe5de;margin:22px 0 10px}.divider span{position:relative;top:-12px;background:#fff;padding:0 10px;color:#66766b;font-size:14px}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.greet{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}.dash{display:grid;grid-template-columns:2fr 1fr;gap:18px}.dash .card{margin-bottom:18px}.dash3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.bal .amount{font-size:42px;font-weight:800;margin:0}.warn{color:#9a6200;font-weight:700}.on{color:#1d7a35;font-weight:800}.off{color:#66766b;font-weight:800}
.containers{list-style:none;padding:0;margin:14px 0}.ct{display:grid;grid-template-columns:44px 1fr auto;gap:14px;align-items:center;padding:12px 0;border-top:1px solid #edf1ec}.ct small{display:block;color:#66766b}.bin{width:34px;height:42px;border-radius:6px 6px 4px 4px;background:#4a5a50;display:block;position:relative}.bin::before{content:"";position:absolute;left:-3px;right:-3px;top:-6px;height:8px;border-radius:4px;background:inherit;filter:brightness(.8)}.recycle .bin{background:#1f6fb2}.yard .bin{background:#5e8c2f}.next{text-align:right}.next strong{font-size:17px}
.toolgrid{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.toolgrid a{display:block;padding:12px 14px;background:#f2f6f1;border-radius:10px;text-decoration:none}
.balrow{display:flex;gap:24px;flex-wrap:wrap;background:#e9f2ea;border-radius:12px;padding:12px 18px;margin-bottom:16px}.paygrid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.field{margin:14px 0}.field label{display:block;font-weight:700;font-size:14px;margin-bottom:6px}.field input,.field select,.field textarea{width:100%;padding:12px 14px;border:1.5px solid #b5c2b8;border-radius:10px;font:inherit;background:#fff}.field input:focus,.field select:focus,.field textarea:focus{border-color:var(--brand);outline:none;box-shadow:0 0 0 3px rgba(0,0,0,.06)}.help{color:#66766b;font-size:13px}
fieldset{border:0;padding:0;margin:0 0 12px}legend{font-weight:800;font-size:17px;margin-bottom:6px}.radio,.check{display:flex;gap:8px;align-items:center;margin:10px 0;flex-wrap:wrap}.other-amount{width:120px;padding:7px 10px;border:1.5px solid #b5c2b8;border-radius:8px}
.alert{padding:14px 18px;border-radius:12px;margin-bottom:16px;font-weight:700}.alert-error{background:#fdecec;color:#9b1c1c}.alert-ok{background:#e4f4e6;color:#1d5c2a}
.table{width:100%;border-collapse:collapse}.table th,.table td{text-align:left;padding:12px 10px;border-bottom:1px solid #edf1ec}.table th{font-size:13px;color:#66766b;text-transform:uppercase;letter-spacing:.5px}.empty{color:#66766b}
dl{display:grid;grid-template-columns:max-content 1fr;gap:8px 22px;margin:0}dt{color:#66766b}dd{margin:0}.review{margin-bottom:16px}
.invoice .inv-top{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}.inv-top small{display:block;color:#66766b}.inv-foot{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:16px}.inv-foot span{margin-right:auto;font-size:18px}
.ok{border-left:6px solid #1d7a35}.receipt .check{font-size:40px;color:#1d7a35;margin:0}.wallet{list-style:none;padding:0;margin:0}.wallet li{display:flex;gap:14px;align-items:center;padding:12px 0;border-bottom:1px solid #edf1ec}.wallet form{margin-left:auto}.chip{background:#e6f2e7;color:#1d5c2a;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:800}
.svcopts{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px}.svc{background:#fff;border-radius:14px;padding:18px;text-decoration:none;color:#1c2b22;border:2px solid #dfe5de;display:flex;flex-direction:column;gap:4px}.svc span{color:#66766b;font-weight:400}.svc.cur{border-color:var(--brand)}
.helpgrid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.help-search{display:flex;gap:10px;margin:14px 0 20px}.help-search input{flex:1;padding:12px 16px;border:1.5px solid #b5c2b8;border-radius:999px;font:inherit}.help-search .btn{background:var(--brand);color:#fff;border:0;border-radius:999px;padding:0 22px;font:inherit;font-weight:800;cursor:pointer}.help-list{padding-left:18px}.help-list li{margin:7px 0}.crumbs{font-size:14px}
details summary{cursor:pointer;color:var(--brand);font-weight:700;margin:8px 0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.foot{background:#16301f;background:color-mix(in srgb,var(--brand) 30%,#0d1a12);color:#cfdcd2;padding:32px 0;font-size:14px}.foot a{color:#fff;font-weight:400}.foot strong{color:#fff}.fcols{display:grid;grid-template-columns:2fr 1fr 1fr;gap:24px}.foot .muted{color:#9fb3a5}
@media(max-width:860px){dl{grid-template-columns:minmax(0,max-content) minmax(0,1fr)}dd{overflow-wrap:anywhere}.help-search input{min-width:0}.hdr-row{flex-wrap:wrap;gap:6px 16px;min-height:0;padding-top:10px}.brand{font-size:18px;min-width:0}.brand span{overflow-wrap:anywhere}.hdr-right{margin-left:auto;flex-wrap:wrap;gap:6px 14px;justify-content:flex-end}.top{order:3;flex:1 0 100%;gap:18px;overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch}.top a{padding:8px 0 10px;white-space:nowrap}.table{display:block;overflow-x:auto;max-width:100%}.tabs{flex-wrap:nowrap;overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch}.tabs a{white-space:nowrap;padding:9px 12px}.dash,.dash3,.tiles3,.paygrid,.helpgrid,.svcopts,.fcols,.two,.toolgrid,.invoice .inv-top{grid-template-columns:1fr}.hero{padding:28px}.hero h1{font-size:30px}}
@media(max-width:520px){.hdr-right{flex:1 0 100%;margin-left:0;justify-content:flex-start}.hdr-right .pill{padding:6px 14px;font-size:14px}}` + OBS_CSS;
