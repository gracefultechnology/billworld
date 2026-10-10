// Investor-owned utility "My Account" experience (Duke Energy / PG&E / Con Edison / Dominion style).
// Public marketing shell with a utility bar (Outages, Start/Stop/Move), a signed-in account banner with the
// service address, a left "Billing & Payments" menu, an energy-usage panel on the dashboard and a three-step
// "Pay My Bill" wizard (amount & date -> payment method -> review & submit).
import { html, raw, doc, logo, alert, form, field, select, checkbox, button, hidden, amountChooser, methodChooser, newMethodFields, dateField, table, paymentRows, helpList, helpBody, helpSearchForm, money, fmtDate, methodText, statusLabel, L } from '../kit.mjs';
import { formatPhone } from '../catalog.mjs';
import { applyProfile, siteNav, profileDocTitle, heroBanner, heroText, navItems, loginProfile, socialBlock, helpExcerpts, naNotice, PROFILE_CSS, mfaSent, mfaResend } from './_profile-parts.mjs';

export const meta = {
  id: 'utility-account',
  // Where the dedicated tier's dossier nav (vm.nav) goes: the first element matching a selector (class:<token> or
  // aria:<label>) is re-filled with the dossier's items; observed real-site navs yield on public pages (server.mjs withDossierNav).
  navSlots: { public: ['aria:Main'], account: ['aria:My Account menu'] },
  name: 'Investor-owned utility My Account',
  description: 'Electric, gas and water utility self-service account modeled on large investor-owned utility portals: Pay My Bill wizard, AutoPay, Paperless Billing, Budget Billing / payment arrangements, Start, Stop or Move, and an energy-usage panel.',
  families: ['investor-owned utility', 'cooperative utility (category default)', 'retail energy provider'],
  sources: [
    'https://www.pge.com/en/account/billing-and-assistance.html',
    'https://www.coned.com/en/accounts-billing/payment-plans-assistance',
    'https://www.dominionenergy.com/virginia/billing',
    'https://www.duke-energy.com/home/billing (HTTP 403 when fetched; labels taken from PG&E/Dominion/Con Edison pages instead)'
  ],
  evidence: {
    observed_public: [
      'PG&E billing hub labels: Pay My Bill, AutoPay, Paperless Billing, Budget Billing, Start, Stop or Transfer Service, Payment Plan and Due Date Extension, View Past Bills, Guest Bill Pay',
      'Con Edison navigation: Account & Billing, Services & Outages, Save Energy & Money; My Account, Pay Bill, Bill History & Assistance, Energy Use, Payment Agreement, Budget Billing',
      'Dominion Energy: Pay My Bill (One-Time Payment, Guest Payment, pay in person/mail/phone), Paperless Billing (eBill), Budget Billing, Extend Your Due Date / Payment Plan, Start/Stop or Move, top menu Pay My Bill | Start/Stop or Move | Outage or Emergency | Save Energy & Money'
    ],
    documented: ['Per-biller phones, payment mailing address, assistance programs and fees come from the research record via help.mjs'],
    synthetic: [
      'Exact page layout, colours and wizard step order (amount & date, then method, then review) are a reconstruction of the common IOU pattern, not a copy of any single portal',
      'Energy usage figures are derived from synthetic bill amounts at an assumed average rate',
      'URL structure (/my-account/billing/...) approximates IOU portals'
    ]
  }
};

export const routes = {
  home: '/', login: '/sign-in', loginPassword: '/sign-in/password', mfa: '/sign-in/verify', register: '/my-account/register', verify: '/my-account/register/verify',
  forgot: '/sign-in/forgot-password', reset: '/sign-in/reset-password',
  guest: '/billing/guest-pay', guestPay: '/billing/guest-pay/payment', guestReview: '/billing/guest-pay/review', guestReceipt: '/billing/guest-pay/confirmation/:id',
  dashboard: '/my-account/dashboard', bill: '/my-account/billing/current-bill', statements: '/my-account/billing/bill-history', statement: '/my-account/billing/bill-history/:id.pdf',
  pay: '/my-account/billing/pay-bill', payMethod: '/my-account/billing/pay-bill/payment-method', payReview: '/my-account/billing/pay-bill/review', payReceipt: '/my-account/billing/pay-bill/confirmation/:id',
  history: '/my-account/billing/payment-activity', autopay: '/my-account/billing/autopay', paperless: '/my-account/billing/paperless-billing', wallet: '/my-account/billing/payment-methods',
  cancel: '/my-account/start-stop-move', plan: '/my-account/billing/budget-billing', arrangement: '/my-account/billing/payment-arrangement', contact: '/my-account/contact-us', profile: '/my-account/profile',
  logout: '/sign-out', help: '/customer-service', helpArticle: '/customer-service/article/:slug', helpSearch: '/customer-service/search'
};
export const flow = { paySteps: ['pay', 'payMethod', 'payReview'], loginSteps: 1, guestSteps: ['guest', 'guestPay', 'guestReview'] };

const offline = vm => vm.biller.capabilities.online_account.support === 'unsupported';
const sup = (vm, k) => vm.biller.capabilities[k]?.support === 'supported';
// Dedicated billers list only the payment channels their dossier/catalog says exist.
const waysToPay = vm => { const w = ['Online', sup(vm, 'pay_by_phone') && 'phone', sup(vm, 'pay_by_mail') && 'mail', sup(vm, 'pay_in_person') && 'in person'].filter(Boolean); return w.length > 1 ? `${w.slice(0, -1).join(', ')} or ${w.at(-1)}` : w[0]; };
const guestOn = vm => sup(vm, 'guest_pay');
const art = (vm, slug) => vm.help.some(a => a.slug === slug) ? vm.url('helpArticle', { slug }) : vm.url('help');
const unit = vm => ({ electric: ['kWh', 0.16], gas: ['therms', 1.45], water: ['gallons', 0.012], sewer: ['gallons', 0.012], propane: ['gallons', 2.9], 'heating-oil': ['gallons', 3.8] }[vm.biller.billType] || ['kWh', 0.16]);
const METERED = ['electric', 'gas', 'water', 'sewer', 'propane', 'heating-oil', 'electric-gas', 'water-sewer'];
const metered = vm => !vm.biller.billType || METERED.some(t => String(vm.biller.billType).includes(t));
// Home lead: only what this biller offers online (a dossier may mark AutoPay, paperless or stopping service offline).
function homeLead(vm) {
  const ap = vm.biller.capabilities.autopay?.support !== 'supported' ? null : vm.labels.autopay || 'AutoPay';
  const parts = ['Pay your bill', ...(metered(vm) ? [`see your ${energyWord(vm).toLowerCase()} use`] : []), ...(ap && sup(vm, 'paperless') ? [`enroll in ${ap} and ${vm.labels.paperless || 'Paperless Billing'}`] : ap ? [`enroll in ${ap}`] : sup(vm, 'paperless') ? [`go paperless`] : []), ...(sup(vm, 'cancel_service') ? ['start, stop or move service'] : [])];
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')}${parts.length > 2 ? ',' : ''} and ${parts.at(-1)}` : parts[0];
}
const energyWord = vm => ['water', 'sewer'].includes(vm.biller.billType) ? 'Water' : vm.biller.billType === 'gas' ? 'Gas' : 'Energy';

function utilityBar(vm) {
  return html`<div class="ubar"><div class="wrap"><span>${vm.biller.serviceArea ? `Serving ${vm.biller.serviceArea}` : 'Residential customers'}</span><span class="ubar-links"><a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact Us</a><a href="${vm.url('help')}">${L(vm, 'help', 'Customer Service')}</a>${vm.biller.phone ? html`<span>Call ${vm.biller.phone}</span>` : ''}</span></div></div>`;
}
function header(vm) {
  const right = offline(vm) ? '' : vm.authenticated
    ? html`<div class="acct-menu"><span class="hello">Welcome, ${vm.persona.first}</span><a href="${vm.url('profile')}">${L(vm, 'profile', 'My Profile')}</a><a class="signout" href="${vm.url('logout')}">${L(vm, 'logout', 'Sign Out')}</a></div>`
    : html`<div class="acct-menu"><a class="btn btn-pay" href="${vm.url(guestOn(vm) ? 'guest' : 'login')}">${L(vm, 'pay', 'Pay My Bill')}</a><a class="btn btn-ghost" href="${vm.url('login')}">${L(vm, 'login', 'Sign In')}</a></div>`;
  return html`<header class="mast"><div class="wrap"><a class="brand" href="${vm.url('home')}">${logo(vm)}<span>${vm.biller.brand.shortName}</span></a>${right}</div>
  ${realMega(vm) || html`<nav class="mega" aria-label="Main"><div class="wrap"><a href="${vm.url(vm.authenticated ? 'dashboard' : 'home')}">${vm.authenticated ? 'My Account' : 'Home'}</a>${offline(vm) ? '' : html`<a href="${vm.url(vm.authenticated ? 'pay' : 'login')}">Billing &amp; Payments</a><a href="${vm.authenticated && sup(vm, 'cancel_service') ? vm.url('cancel') : art(vm, 'cancel-service')}">${L(vm, 'cancel', 'Start, Stop or Move')}</a>`}<a href="${art(vm, 'payment-assistance')}">Assistance Programs</a><a href="${vm.url('help')}">${L(vm, 'help', 'Help & Support')}</a></div></nav>`}</header>`;
}
// Public pages show the utility's real top-level navigation (from the research profile) in place of the generic
// menu. Billing labels map to this portal's routes; other sections open a help search that explains they are not
// part of the simulation.
function realMega(vm) {
  if (vm.authenticated) return '';
  const items = navItems(vm, { max: 10 });
  if (items.length < 3) return '';
  const kinds = new Set(items.map(i => i.kind));
  return html`<nav class="mega pf-real" aria-label="Main"><div class="wrap">${kinds.has('home') ? '' : html`<a href="${vm.url('home')}">${L(vm, 'home', 'Home')}</a>`}${items.map(i => html`<a href="${i.href}"${i.mapped ? '' : raw(' data-sim="not-available"')}>${i.label}</a>`)}${kinds.has('help') ? '' : html`<a href="${vm.url('help')}">${L(vm, 'help', 'Help & Support')}</a>`}</div></nav>`;
}
function acctBanner(vm) {
  return html`<section class="acct-banner"><div class="wrap"><div><span class="lbl">Account</span><strong>${vm.accountMasked}</strong></div><div><span class="lbl">Service address</span><strong>${vm.account.serviceAddress}</strong></div><div><span class="lbl">${L(vm, 'amountDue', 'Amount due')}</span><strong>${money(vm.balanceCents)}</strong></div><div><span class="lbl">${L(vm, 'dueDate', 'Due date')}</span><strong>${vm.dueText}</strong></div></div></section>`;
}
const SIDE = [
  ['Account', [['dashboard', 'Account Summary'], ['profile', 'Profile & Contact Info'], ['contact', 'Message Us']]],
  ['Billing & Payments', [['bill', 'View Current Bill'], ['statements', 'Bill History'], ['pay', 'Pay My Bill'], ['history', 'Payment Activity'], ['wallet', 'Payment Methods'], ['autopay', 'AutoPay'], ['paperless', 'Paperless Billing']]],
  ['Assistance', [['plan', 'Budget Billing'], ['arrangement', 'Payment Arrangement']]],
  ['Service', [['cancel', 'Start, Stop or Move']]]
];
function sideMenu(vm) {
  return html`<aside class="side" aria-label="My Account menu">${SIDE.map(([title, items]) => html`<p class="side-h">${title}</p><ul>${items.filter(([pg]) => pg !== 'cancel' || sup(vm, 'cancel_service')).map(([pg, label]) => html`<li><a href="${vm.url(pg)}"${vm.page === pg || (pg === 'pay' && ['payMethod', 'payReview', 'payReceipt'].includes(vm.page)) ? raw(' class="on" aria-current="page"') : ''}>${L(vm, pg, label)}</a></li>`)}</ul>`)}</aside>`;
}
function footer(vm) {
  return html`<footer class="foot"><div class="wrap cols"><div><h2 class="foot-h">${vm.biller.brand.shortName}</h2><p>${vm.biller.name}${vm.biller.parent ? ` · ${vm.biller.parent}` : ''}</p></div><div><h2 class="foot-h">Customer Service</h2><p>${vm.biller.phone || 'See your bill for phone numbers'}${vm.biller.payPhone ? html`<br>Pay by phone: ${vm.biller.payPhone}` : ''}</p></div><div><h2 class="foot-h">Quick Links</h2><p><a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact Us</a> · <a href="${vm.url('helpArticle', { slug: 'pay-your-bill' })}">Ways to Pay</a> · <a href="${vm.url('help')}">${L(vm, 'help', 'Help & Support')}</a></p></div></div></footer>`;
}
function shell(vm, title, body, { account = false } = {}) {
  const content = account && vm.authenticated ? html`${acctBanner(vm)}<div class="wrap layout">${sideMenu(vm)}<main class="main">${alert(vm)}${body}</main></div>` : html`<div class="wrap"><main class="main solo">${alert(vm)}${body}</main></div>`;
  return doc(vm, { title: profileDocTitle(vm) || `${title} | ${vm.biller.brand.shortName}`, bodyClass: 'iou', body: html`<a class="skip" href="#content">Skip to main content</a>${utilityBar(vm)}${header(vm)}<div id="content">${content}</div>${footer(vm)}` });
}
const acct = (vm, title, body) => shell(vm, title, body, { account: true });
const h1 = t => html`<h1>${t}</h1>`;
const stepper = (vm, n, labels = ['Amount & date', 'Payment method', 'Review & submit']) => html`<ol class="stepper">${labels.map((l, i) => html`<li class="${i + 1 < n ? 'done' : i + 1 === n ? 'cur' : ''}"><span>${i + 1}</span>${l}</li>`)}</ol>`;

function usage(vm) {
  if (!metered(vm)) return '';
  const [u, rate] = unit(vm);
  const inv = vm.invoices.slice(0, 12).reverse();
  const vals = inv.map(i => Math.round(i.amountCents / 100 / rate));
  const max = Math.max(...vals, 1);
  const cur = vals.at(-1), prev = vals.at(-2) || cur;
  const diff = Math.round((cur - prev) / Math.max(prev, 1) * 100);
  return html`<section class="tile usage"><div class="tile-head"><h2>${energyWord(vm)} Usage</h2><span class="muted">Last 12 billing periods (estimated)</span></div><p><strong>${cur.toLocaleString('en-US')} ${u}</strong> this period · ${diff >= 0 ? `${diff}% more` : `${-diff}% less`} than last period</p><div class="bars" role="img" aria-label="Monthly usage bar chart">${inv.map((i, k) => html`<div class="bar"><span class="fill h${Math.max(1, Math.round(vals[k] / max * 10))}"></span><small>${new Date(i.dueAt).toLocaleDateString('en-US', { month: 'short', timeZone: 'America/New_York' })}</small></div>`)}</div></section>`;
}

const pages = {
  home(vm) {
    if (offline(vm)) return shell(vm, 'Paying your bill', html`${h1(`Paying your ${vm.biller.name} bill`)}<p class="lead">Online account access and online bill payment are not available for this utility.</p><section class="tile">${helpBody(vm.help.find(a => a.slug === 'pay-your-bill'))}</section>`);
    const g = guestOn(vm);
    return shell(vm, 'Home', html`<section class="hero"><div class="hero-copy">${h1(`Manage your ${vm.biller.brand.shortName} account online`)}${heroBanner(vm, { cls: 'pf-hero-inv' })}<p class="lead">${homeLead(vm)}.</p></div>
      <div class="signin-box"><h2>My Account</h2><p>Sign in to view and pay your bill.</p><a class="btn btn-primary block" href="${vm.url('login')}">${L(vm, 'login', 'Sign In')}</a><a class="btn btn-ghost block" href="${vm.url('register')}">${L(vm, 'register', 'Register for My Account')}</a>${g ? html`<p class="small"><a href="${vm.url('guest')}">${L(vm, 'guest', 'Pay as a guest')}</a> — no sign-in required</p>` : ''}</div></section>
      <section class="quick"><h2 class="sr-only">Popular tasks</h2>
        <a class="qcard" href="${vm.url(g ? 'guest' : 'login')}"><span class="ico">$</span><strong>${L(vm, 'pay', 'Pay My Bill')}</strong><small>${g ? 'One-time or Guest Payment' : 'Sign in to pay online'}</small></a>
        <a class="qcard" href="${vm.url('helpArticle', { slug: 'pay-your-bill' })}"><span class="ico">✉</span><strong>Ways to Pay</strong><small>${vm.tier === 'dedicated' ? waysToPay(vm) : 'Online, phone, mail or in person'}</small></a>
        <a class="qcard" href="${art(vm, 'autopay')}"><span class="ico">↻</span><strong>${L(vm, 'autopay', 'AutoPay')}</strong><small>Pay automatically each month</small></a>
        <a class="qcard" href="${art(vm, 'cancel-service')}"><span class="ico">⌂</span><strong>${L(vm, 'cancel', 'Start, Stop or Move')}</strong><small>Moving? Manage service</small></a>
      </section>
      <section class="tile"><h2>Need help?</h2>${helpSearchForm(vm, { placeholder: 'Search billing, payments and service' })}</section>`);
  },
  login(vm) {
    const lp = loginProfile(vm);
    return shell(vm, 'Sign In', html`<div class="auth">${h1(L(vm, 'login', 'Sign In to My Account'))}${form(vm, 'login', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'username', label: lp.userLabel === 'Account number' ? 'Account number or email' : lp.userLabel === 'Email address' ? 'Email address' : 'Email or account number', autocomplete: 'username', help: lp.userHelp })}${field(vm, { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' })}${button(lp.submit || 'Sign In', { cls: 'btn btn-primary block' })}`)}${socialBlock(vm)}<p class="links"><a href="${vm.url('forgot')}">${L(vm, 'forgot', 'Forgot user ID or password?')}</a></p><hr><p>New to online account management?</p><a class="btn btn-ghost block" href="${vm.url('register')}">${L(vm, 'register', 'Register Now')}</a>${guestOn(vm) ? html`<p class="small center"><a href="${vm.url('guest')}">${L(vm, 'guest', 'Make a guest payment')}</a></p>` : ''}</div>`);
  },
  loginPassword(vm) { return pages.login(vm); },
  mfa(vm) { return shell(vm, 'Verify your identity', html`<div class="auth">${h1('Verify Your Identity')}<p>${mfaSent(vm, 'For your security we sent a 6-digit verification code to the email address on your account.')}</p>${form(vm, 'mfa', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'code', label: 'Verification code', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' })}${button('Verify', { cls: 'btn btn-primary block' })}`)}${mfaResend(vm)}</div>`); },
  register(vm) {
    return shell(vm, 'Register', html`<div class="auth wide">${h1(L(vm, 'register', 'Register for My Account'))}<p>Have your bill handy — you'll need your account number.</p>${stepper(vm, 1, ['Account information', 'Verify email', 'Sign in'])}${form(vm, 'register', html`${field(vm, { name: 'accountNumber', label: 'Account number (from your bill)', inputmode: 'numeric' })}${field(vm, { name: 'lastName', label: 'Last name or business name on account' })}${field(vm, { name: 'email', label: 'Email address', type: 'email', autocomplete: 'email' })}${field(vm, { name: 'password', label: 'Create password', type: 'password', autocomplete: 'new-password', help: 'At least 8 characters with upper and lower case letters, a number and a symbol.' })}${field(vm, { name: 'confirm', label: 'Confirm password', type: 'password', autocomplete: 'new-password' })}${button('Continue', { cls: 'btn btn-primary' })}`)}<p class="small">Already registered? <a href="${vm.url('login')}">${L(vm, 'login', 'Sign in')}</a></p></div>`);
  },
  verify(vm) { return shell(vm, 'Verify email', html`<div class="auth">${h1('Check Your Email')}<p>Select the verification link we emailed you to activate My Account.</p><p><a href="${vm.url('login')}">Return to Sign In</a></p></div>`); },
  forgot(vm) { return shell(vm, 'Forgot user ID or password', html`<div class="auth">${h1(L(vm, 'forgot', 'Forgot User ID or Password'))}<p>Enter the email or account number associated with My Account. We'll send a verification code.</p>${form(vm, 'forgot', html`${field(vm, { name: 'identifier', label: 'Email or account number', autocomplete: 'username' })}${button('Send Code', { cls: 'btn btn-primary block' })}`)}<p class="links"><a href="${vm.url('login')}">Back to Sign In</a></p></div>`); },
  reset(vm) { return shell(vm, 'Reset password', html`<div class="auth">${h1('Reset Your Password')}<p>Enter the verification code from your email and choose a new password.</p>${form(vm, 'reset', html`${vm.query.token ? hidden('token', vm.query.token) : field(vm, { name: 'code', label: 'Verification code', inputmode: 'numeric', autocomplete: 'one-time-code' })}${field(vm, { name: 'password', label: 'New password', type: 'password', autocomplete: 'new-password' })}${field(vm, { name: 'confirm', label: 'Confirm new password', type: 'password', autocomplete: 'new-password' })}${button('Save Password', { cls: 'btn btn-primary block' })}`)}</div>`); },
  guest(vm) {
    return shell(vm, 'Guest Payment', html`<div class="auth wide">${h1(L(vm, 'guest', 'Guest Payment'))}<p>Make a one-time payment without signing in. Card payments may include a convenience fee charged by our payment vendor.</p>${stepper(vm, 1, ['Find account', 'Payment details', 'Review & submit'])}${form(vm, 'guest', html`${field(vm, { name: 'accountNumber', label: 'Account number', inputmode: 'numeric', help: 'Found at the top of your bill.' })}${field(vm, { name: 'zip', label: 'Service address ZIP code', inputmode: 'numeric', maxlength: 5 })}${button('Continue', { cls: 'btn btn-primary' })}`)}<p class="small">Have an online account? <a href="${vm.url('login')}">${L(vm, 'login', 'Sign in')}</a> to pay with saved methods.</p></div>`);
  },
  guestPay(vm) {
    return shell(vm, 'Guest Payment', html`<div class="auth wide">${h1('Guest Payment')}${stepper(vm, 2, ['Find account', 'Payment details', 'Review & submit'])}<div class="summary-row"><span>Account ${vm.accountMasked}</span><span>Amount due <strong>${money(vm.balanceCents)}</strong></span><span>Due ${vm.dueText}</span></div>${form(vm, 'guestPay', html`${amountChooser(vm, { labels: { due: 'Total amount due', other: 'Other amount' } })}<fieldset><legend>Payment method</legend>${newMethodFields(vm)}</fieldset>${button('Continue to Review', { cls: 'btn btn-primary' })}`)}</div>`);
  },
  guestReview(vm) { return reviewPage(vm, 'guestReview'); },
  guestReceipt(vm) { return receiptPage(vm); },
  dashboard(vm) {
    const ap = vm.autopay;
    return acct(vm, 'Account Summary', html`${h1('Account Summary')}
      <div class="grid2"><section class="tile due"><h2>${L(vm, 'amountDue', 'Amount Due')}</h2><p class="big">${money(vm.balanceCents)}</p><p>Due by <strong>${vm.dueText}</strong>${ap.enrolled ? ' · AutoPay is scheduled' : ''}</p>${vm.pendingPayments.length ? html`<p class="pending">${vm.pendingPayments.length} payment(s) processing</p>` : ''}${vm.scheduled.length ? html`<p class="pending">${vm.scheduled.length} scheduled payment(s) · <a href="${vm.url('history')}">${L(vm, 'history', 'View')}</a></p>` : ''}<p class="actions"><a class="btn btn-pay" href="${vm.url('pay')}">${L(vm, 'pay', 'Pay My Bill')}</a> <a class="btn btn-ghost" href="${vm.url('bill')}">${L(vm, 'bill', 'View Bill')}</a></p></section>
      <section class="tile"><h2>Billing Preferences</h2><ul class="prefs"><li><span>${L(vm, 'autopay', 'AutoPay')}</span><strong class="${ap.enrolled ? 'on' : 'off'}">${ap.enrolled ? 'Enrolled' : 'Not enrolled'}</strong><a href="${vm.url('autopay')}">${ap.enrolled ? 'Manage' : 'Enroll'}</a></li><li><span>${L(vm, 'paperless', 'Paperless Billing')}</span><strong class="${vm.account.paperless ? 'on' : 'off'}">${vm.account.paperless ? 'Enrolled' : 'Paper bill'}</strong><a href="${vm.url('paperless')}">${vm.account.paperless ? 'Manage' : 'Go Paperless'}</a></li><li><span>${L(vm, 'plan', 'Budget Billing')}</span><strong class="off">Not enrolled</strong><a href="${vm.url('plan')}">Learn more</a></li><li><span>Service status</span><strong class="${vm.service.status === 'active' ? 'on' : 'off'}">${vm.service.status === 'active' ? 'Active' : vm.service.status === 'cancel_pending' ? `Stop scheduled ${fmtDate(vm.service.cancelAt)}` : 'Stopped'}</strong>${sup(vm, 'cancel_service') ? html`<a href="${vm.url('cancel')}">${L(vm, 'cancel', 'Start, Stop or Move')}</a>` : ''}</li></ul></section></div>
      ${usage(vm)}
      <section class="tile"><div class="tile-head"><h2>Recent Bills</h2><a href="${vm.url('statements')}">See all bill history</a></div>${table(['Bill date', 'Amount', 'Due date', ''], vm.invoices.slice(0, 3).map(i => [fmtDate(i.issuedAt), money(i.amountCents), fmtDate(i.dueAt), html`<a href="${vm.url('statement', { id: i.id })}">View PDF</a>`]))}</section>
      <section class="tile"><h2>Shortcuts</h2><ul class="links"><li><a href="${vm.url('history')}">${L(vm, 'history', 'Payment Activity')}</a></li><li><a href="${vm.url('wallet')}">${L(vm, 'wallet', 'Payment Methods')}</a></li><li><a href="${vm.url('arrangement')}">${L(vm, 'arrangement', 'Payment Arrangement')}</a></li><li><a href="${vm.url('contact')}">${L(vm, 'contact', 'Message Us')}</a></li></ul></section>`);
  },
  bill(vm) {
    const inv = vm.invoice;
    return acct(vm, 'Current Bill', html`${h1(L(vm, 'bill', 'View Current Bill'))}<section class="tile billdoc"><div class="bill-head"><div><span class="lbl">Bill date</span><strong>${fmtDate(inv.issuedAt)}</strong></div><div><span class="lbl">Billing period</span><strong>${inv.period}</strong></div><div><span class="lbl">Statement</span><strong>${inv.number}</strong></div></div>
      <h2>Summary of Charges</h2>${table(['Description', 'Amount'], [['Previous balance', money(vm.invoices[1]?.amountCents || 0)], ['Payment received – thank you', `-${money((vm.invoices[1]?.amountCents || 0) - Math.max(0, vm.invoices[1]?.balanceCents || 0))}`], ...(vm.invoices[1]?.balanceCents > 0 ? [['Balance forward (past due)', money(vm.invoices[1].balanceCents)]] : []), ...inv.lines.map(l => [l.desc, money(l.cents)]), [html`<strong>Current charges</strong>`, html`<strong>${money(inv.amountCents)}</strong>`]])}
      <p class="duebox">Amount due <strong>${money(vm.balanceCents)}</strong> by <strong>${fmtDate(inv.dueAt)}</strong></p><p class="actions"><a class="btn btn-pay" href="${vm.url('pay')}">${L(vm, 'pay', 'Pay My Bill')}</a> <a class="btn btn-ghost" href="${vm.url('statement', { id: inv.id })}">Download Bill (PDF)</a></p></section>`);
  },
  statements(vm) { return acct(vm, 'Bill History', html`${h1(L(vm, 'statements', 'Bill History'))}<p>View and download up to 12 months of past bills.</p>${table(['Bill date', 'Billing period', 'Amount', 'Due date', 'Bill'], vm.invoices.map(i => [fmtDate(i.issuedAt), i.period, money(i.amountCents), fmtDate(i.dueAt), html`<a href="${vm.url('statement', { id: i.id })}">View PDF</a>`]))}`); },
  pay(vm) {
    return acct(vm, 'Pay My Bill', html`${h1(L(vm, 'pay', 'Pay My Bill'))}${stepper(vm, 1)}<p>Current amount due: <strong>${money(vm.balanceCents)}</strong> · Due ${vm.dueText}</p>${form(vm, 'pay', html`${amountChooser(vm, { labels: { legend: 'How much would you like to pay?', due: 'Total amount due', other: 'Other amount' } })}${dateField(vm, { label: 'Payment date' })}<p class="small">Payments scheduled after the due date may result in a late payment charge.</p>${button('Next: Payment Method', { cls: 'btn btn-primary' })}`)}`);
  },
  payMethod(vm) {
    const d = vm.draft;
    return acct(vm, 'Pay My Bill', html`${h1('Pay My Bill')}${stepper(vm, 2)}${d?.amountCents ? html`<div class="summary-row"><span>Payment amount <strong>${money(d.amountCents)}</strong></span><span>Payment date <strong>${d.payOn || 'Today'}</strong></span></div>` : ''}${form(vm, 'payMethod', html`${methodChooser(vm, { title: 'Select a payment method' })}${button('Next: Review', { cls: 'btn btn-primary' })}`)}<p><a href="${vm.url('pay')}">${L(vm, 'pay', '‹ Back to amount')}</a></p>`);
  },
  payReview(vm) { return reviewPage(vm, 'payReview'); },
  payReceipt(vm) { return receiptPage(vm); },
  history(vm) { return acct(vm, 'Payment Activity', html`${h1(L(vm, 'history', 'Payment Activity'))}<p>Scheduled payments can be cancelled until they begin processing.</p>${table(['Payment date', 'Amount', 'Method', 'Confirmation #', 'Status', ''], paymentRows(vm))}`); },
  autopay(vm) {
    const ap = vm.autopay; const A = L(vm, 'autopay', 'AutoPay');
    const days = Array.isArray(vm.billing?.autopayDays) ? vm.billing.autopayDays : null;
    const when = days ? 'on the draft date you choose' : 'on each due date';
    return acct(vm, 'AutoPay', html`${h1(A)}<p>With ${A}, your full amount due is drafted automatically from your ${vm.methodTypes && !vm.methodTypes.includes('card') ? 'bank account' : 'bank account or card'} ${when}. You'll still receive a bill showing the amount and draft date.</p>
      ${ap.enrolled ? html`<section class="tile on-card"><h2>You're enrolled in ${A}</h2><p>Paying the ${ap.policy === 'fixed' ? `fixed amount of ${money(ap.fixedCents)}` : 'full amount due'} ${ap.day ? `on day ${ap.day} of each month` : 'on each due date'} from ${vm.autopayMethod ? methodText(vm.autopayMethod) : 'your saved method'}.</p><div class="danger-zone"><h3>Cancel ${A}</h3>${form(vm, 'autopay', html`${hidden('action', 'cancel')}<p class="small">If you cancel, you'll need to pay future bills yourself. Payments already scheduled are not affected.</p>${checkbox(vm, { name: 'confirm', label: 'I want to stop automatic payments for this account.' })}${button(html`Cancel ${A}`, { cls: 'btn btn-danger' })}`)}</div></section><h2>Change Payment Method</h2>` : html`<section class="tile"><h2>Enroll in ${A}</h2><p class="small">If you have a current balance, pay it separately — automatic payments begin with your next bill.</p></section>`}
      ${form(vm, 'autopay', html`${hidden('action', 'enroll')}${hidden('policy', 'full')}${methodChooser(vm, { title: 'Draft payments from' })}${days ? select(vm, { name: 'day', label: 'Draft date', options: days.map(d => [String(d), `Day ${d} of each month`]) }) : ''}<div class="terms"><h3>${A} Terms &amp; Conditions</h3><p>I authorize ${vm.biller.brand.shortName} to initiate recurring electronic debits for the total amount due on each bill ${days ? 'on the draft date I choose' : 'on its due date'} until I cancel. Changes made shortly before a draft date may not apply until the following bill.</p></div>${checkbox(vm, { name: 'acceptTerms', label: html`I have read and agree to the ${A} Terms &amp; Conditions.` })}${button(ap.enrolled ? 'Save Changes' : html`Enroll in ${A}`, { cls: 'btn btn-primary' })}`)}`);
  },
  paperless(vm) {
    const on = vm.account.paperless;
    return acct(vm, 'Paperless Billing', html`${h1(L(vm, 'paperless', 'Paperless Billing'))}<section class="tile"><p>Status: <strong class="${on ? 'on' : 'off'}">${on ? 'Enrolled — you receive an email when your bill is ready' : 'Not enrolled — paper bill mailed to your service address'}</strong></p><p>Paperless Billing replaces your mailed bill with an email notice. You can view, print and pay every bill online anytime.</p>${form(vm, 'paperless', html`${hidden('paperless', on ? 'off' : 'on')}${!on ? field(vm, { name: 'email', label: 'Send bill-ready notices to', type: 'email', value: vm.persona.email }) : ''}${button(on ? 'Stop Paperless Billing' : 'Enroll in Paperless Billing', { cls: on ? 'btn btn-ghost' : 'btn btn-primary' })}`)}</section>`);
  },
  wallet(vm) {
    return acct(vm, 'Payment Methods', html`${h1(L(vm, 'wallet', 'Payment Methods'))}<p>Save bank accounts and cards for faster payments and AutoPay.</p><ul class="wallet">${vm.methods.map(m => html`<li><span class="pm ${m.type}">${m.type === 'bank' ? 'BANK' : 'CARD'}</span><span>${methodText(m)}${m.nickname ? html` <span class="muted">(${m.nickname})</span>` : ''}</span>${form(vm, 'wallet', html`${hidden('op', 'remove')}${hidden('methodId', m.id)}${button('Remove', { cls: 'btn btn-link' })}`)}</li>`)}</ul><section class="tile"><h2>Add a Payment Method</h2>${form(vm, 'wallet', html`${hidden('op', 'add')}${newMethodFields(vm)}${field(vm, { name: 'nickname', label: 'Nickname (optional)', required: false })}${button('Save Payment Method', { cls: 'btn btn-primary' })}`)}</section>`);
  },
  cancel(vm) {
    if (!sup(vm, 'cancel_service') && vm.service.status === 'active') { const c = vm.biller.capabilities.cancel_service || {}; return acct(vm, 'Start, Stop or Move', html`${h1(L(vm, 'cancel', 'Start, Stop or Move'))}<section class="tile"><p>To stop or move service at ${vm.account.serviceAddress}, contact ${vm.biller.brand.shortName}${c.channel === 'mail' ? ' in writing' : ''}${c.phone ? ` at ${/^\d{10}$/.test(c.phone) ? formatPhone(c.phone) : c.phone}` : vm.biller.phone ? ` at ${vm.biller.phone}` : ''}.</p></section>`); }
    if (vm.service.status !== 'active' && vm.step !== 'done') return acct(vm, 'Start, Stop or Move', html`${h1(L(vm, 'cancel', 'Start, Stop or Move'))}<section class="tile"><p>Service at ${vm.account.serviceAddress} ${vm.service.status === 'cancel_pending' ? html`is scheduled to stop on <strong>${fmtDate(vm.service.cancelAt)}</strong>` : 'has been stopped'}.</p>${vm.service.status === 'cancel_pending' ? form(vm, 'cancel', html`${hidden('step', 'undo')}${button('Keep My Service On', { cls: 'btn btn-ghost' })}`) : ''}</section>`);
    const sel = html`<div class="ssm"><div class="ssm-opt"><h2>Start Service</h2><p>New to the area? Call ${vm.biller.phone || 'customer service'} to start service at a new address.</p></div><div class="ssm-opt"><h2>Move Service</h2><p>Moving within our service area? Stop service here, then start service at your new address.</p></div><div class="ssm-opt cur"><h2>Stop Service</h2><p>Stop service at ${vm.account.serviceAddress}. Requests need at least 3 business days.</p></div></div>`;
    const steps = {
      reason: html`${h1('Start, Stop or Move')}${sel}${stepper(vm, 1, ['Reason', 'Stop date', 'Confirmation'])}${form(vm, 'cancel', html`${hidden('step', 'reason')}${select(vm, { name: 'reason', label: 'Why are you stopping service?', options: [['', 'Select a reason'], ['moving', 'Moving out of the service area'], ['switching', 'Selling the property / new owner'], ['cost', 'Landlord or tenant change'], ['other', 'Other']] })}${button('Continue', { cls: 'btn btn-primary' })}`)}`,
      offer: html`${h1('Before You Go')}<section class="tile"><p>Moving within our service area? You can transfer service instead of stopping it.</p>${form(vm, 'cancel', html`${hidden('step', 'offer')}${button('Keep service', { name: 'accept', value: 'yes', cls: 'btn btn-primary' })} ${button('Continue stopping service', { cls: 'btn btn-ghost', name: 'accept', value: 'no' })}`)}</section>`,
      confirm: html`${h1('Stop Service')}${stepper(vm, 2, ['Reason', 'Stop date', 'Confirmation'])}<section class="tile"><p>Choose the date you want service stopped. We'll read the meter on that date and mail a final bill to your forwarding address.</p>${form(vm, 'cancel', html`${hidden('step', 'confirm')}${dateField(vm, { name: 'effectiveDate', label: 'Stop service date' })}${checkbox(vm, { name: 'confirm', label: `I understand service at ${vm.account.serviceAddress} will be stopped and I am responsible for charges until that date.` })}${button('Submit Stop Request', { cls: 'btn btn-danger' })}`)}</section>`,
      done: html`${h1('Stop Request Received')}${stepper(vm, 3, ['Reason', 'Stop date', 'Confirmation'])}<section class="tile"><p>Service will stop on <strong>${vm.service.cancelAt ? fmtDate(vm.service.cancelAt) : ''}</strong>. Confirmation number <strong>${vm.service.confirmation || ''}</strong>.</p><p>Your final bill will be mailed to you. <a href="${vm.url('dashboard')}">Return to Account Summary</a></p></section>`,
      kept: html`${h1('Your Service Stays On')}<p>No changes were made to your service.</p>`
    };
    return acct(vm, 'Start, Stop or Move', steps[vm.step]);
  },
  plan(vm) {
    return acct(vm, 'Budget Billing', html`${h1(L(vm, 'plan', 'Budget Billing'))}<section class="tile"><p>Budget Billing averages your ${energyWord(vm).toLowerCase()} costs over the last 12 months so you pay about the same amount each month, avoiding seasonal highs.</p><p>Your estimated budget amount: <strong>${money(Math.round(vm.invoices.reduce((a, i) => a + i.amountCents, 0) / Math.max(vm.invoices.length, 1)))}</strong> per month.</p>${vm.plans.length ? form(vm, 'plan', html`<fieldset><legend>Choose a plan</legend>${vm.plans.map(p => html`<label class="radio"><input type="radio" name="planId" value="${p.id}"${p.current ? raw(' checked') : ''}> ${p.name}${p.cents ? ` – ${money(p.cents)}/mo` : ''}${p.current ? ' (current)' : ''}</label>`)}</fieldset>${button('Update Plan', { cls: 'btn btn-primary' })}`) : html`<p class="small">To enroll in Budget Billing, call ${vm.biller.phone || 'customer service'}. Your account must have no past-due balance.</p>`}</section>`);
  },
  arrangement(vm) {
    return acct(vm, 'Payment Arrangement', html`${h1(L(vm, 'arrangement', 'Payment Arrangement'))}${vm.account.arrangement ? html`<section class="tile on-card"><p>You have an active payment arrangement: ${money(vm.account.arrangement.monthlyCents)} per month for ${vm.account.arrangement.months} months, added to your regular bill.</p></section>` : html`<section class="tile"><p>Need more time? A payment arrangement spreads your balance of <strong>${money(vm.balanceCents)}</strong> over several months, in addition to your monthly bill.</p>${form(vm, 'arrangement', html`${select(vm, { name: 'months', label: 'Number of monthly installments', options: [['3', '3 months'], ['6', '6 months'], ['12', '12 months']] })}${button('Set Up Arrangement', { cls: 'btn btn-primary' })}`)}</section>`}<p class="small">Also see <a href="${art(vm, 'payment-assistance')}">assistance programs</a>.</p>`);
  },
  contact(vm) { return acct(vm, 'Message Us', html`${h1(L(vm, 'contact', 'Message Us'))}${vm.account.messages.length ? html`<section class="tile"><h2>Your messages</h2><ul>${vm.account.messages.map(m => html`<li>${fmtDate(m.at)} – ${m.subject} (${m.status})</li>`)}</ul></section>` : ''}<section class="tile">${form(vm, 'contact', html`${field(vm, { name: 'subject', label: 'Subject' })}<div class="field"><label for="f-message">Message</label><textarea id="f-message" name="message" rows="5" required>${vm.values.message || ''}</textarea></div>${button('Send Message', { cls: 'btn btn-primary' })}`)}</section>`); },
  profile(vm) { return acct(vm, 'Profile', html`${h1(L(vm, 'profile', 'Profile & Contact Info'))}<section class="tile"><dl><dt>Account holder</dt><dd>${vm.persona.name}</dd><dt>Email</dt><dd>${vm.persona.email}</dd><dt>Phone</dt><dd>${vm.account.phone || 'Not provided'}</dd><dt>Mailing address</dt><dd>${vm.account.serviceAddress}</dd></dl></section><section class="tile"><h2>Update phone number</h2>${form(vm, 'profile', html`${field(vm, { name: 'phone', label: 'Primary phone', type: 'tel' })}${button('Save', { cls: 'btn btn-primary' })}`)}</section>`); },
  help(vm) {
    return shell(vm, 'Help & Support', html`${h1(L(vm, 'help', 'Help & Support'))}${offline(vm) ? html`<p class="lead">Online account access is not available for this utility.</p>` : ''}${helpSearchForm(vm, { placeholder: 'Search billing, payments and service' })}<div class="grid2">${['payments', 'billing', 'autopay', 'account', 'assistance', 'contact', 'faq'].map(topic => { const list = vm.help.filter(a => a.topic === topic); return list.length ? html`<section class="tile"><h2>${{ payments: 'Payments', billing: 'Billing', autopay: 'AutoPay', account: 'My Account & Service', assistance: 'Assistance Programs', contact: 'Contact Us', faq: 'FAQs' }[topic]}</h2>${helpList(vm, list)}</section>` : ''; })}</div>${helpExcerpts(vm)}`);
  },
  helpArticle(vm) { return shell(vm, vm.article.title, html`<p class="crumbs"><a href="${vm.url('help')}">${L(vm, 'help', 'Help & Support')}</a> › ${vm.article.title}</p>${h1(vm.article.title)}<section class="tile article">${helpBody(vm.article)}</section>${helpExcerpts(vm, vm.article.slug)}<p><a href="${vm.url('help')}">${L(vm, 'help', '‹ All help topics')}</a></p>`); },
  helpSearch(vm) { return shell(vm, 'Search results', html`${h1('Search Results')}${naNotice(vm)}${helpSearchForm(vm, { placeholder: 'Search billing, payments and service' })}${vm.results.length ? helpList(vm, vm.results) : html`<p>No results for “${vm.query.q || ''}”. Try another word, or <a href="${vm.url('helpArticle', { slug: 'contact-us' })}">contact us</a>.</p>`}`); }
};

function reviewPage(vm, page) {
  const d = vm.draft, guest = page === 'guestReview';
  const body = html`${h1(guest ? 'Guest Payment' : 'Pay My Bill')}${stepper(vm, 3, guest ? ['Find account', 'Payment details', 'Review & submit'] : undefined)}<section class="tile"><h2>Review Your Payment</h2><dl class="review"><dt>Account</dt><dd>${vm.accountMasked}</dd><dt>Payment amount</dt><dd>${money(d.amountCents)}</dd>${d.feeCents ? html`<dt>Convenience fee</dt><dd>${money(d.feeCents)}</dd>` : ''}<dt>Total</dt><dd><strong>${money(d.totalCents)}</strong></dd><dt>Payment method</dt><dd>${methodText(d.method)}</dd><dt>Payment date</dt><dd>${d.payOn || 'Today'}</dd></dl>${form(vm, page, html`${hidden('token', d.token)}${hidden('op', 'submit')}${checkbox(vm, { name: 'acceptTerms', label: `I authorize ${vm.biller.brand.shortName} to charge the payment method above for the total shown.` })}${button('Submit Payment', { cls: 'btn btn-pay' })}`)}${!guest ? form(vm, page, html`${hidden('op', 'edit')}${button('Edit payment', { cls: 'btn btn-link' })}`) : ''}</section>`;
  return guest ? shell(vm, 'Review payment', html`<div class="auth wide">${body}</div>`) : acct(vm, 'Review payment', body);
}
function receiptPage(vm) {
  const p = vm.payment;
  const body = html`${h1(p.status === 'scheduled' ? 'Your Payment Is Scheduled' : 'Thank You for Your Payment')}<section class="tile receipt"><p class="ok">✓ ${p.status === 'scheduled' ? 'Payment scheduled' : 'Payment submitted'}</p><dl><dt>Confirmation number</dt><dd><strong>${p.confirmation}</strong></dd><dt>Account</dt><dd>${vm.accountMasked}</dd><dt>Amount</dt><dd>${money(p.amountCents)}</dd>${p.feeCents ? html`<dt>Convenience fee</dt><dd>${money(p.feeCents)}</dd>` : ''}<dt>Payment method</dt><dd>${vm.paymentMethod ? methodText(vm.paymentMethod) : `****${p.methodLast4}`}</dd><dt>Payment date</dt><dd>${p.payOn || fmtDate(p.createdAt)}</dd><dt>Status</dt><dd>${statusLabel(p.status)}</dd></dl><p class="small">Please keep your confirmation number for your records. Payments may take 1–2 business days to post.</p></section>${vm.authenticated ? html`<p><a class="btn btn-ghost" href="${vm.url('dashboard')}">Return to Account Summary</a> <a href="${vm.url('history')}">${L(vm, 'history', 'View Payment Activity')}</a></p>` : html`<p><a class="btn btn-ghost" href="${vm.url('home')}">Done</a></p>`}`;
  return vm.authenticated ? acct(vm, 'Payment confirmation', body) : shell(vm, 'Payment confirmation', html`<div class="auth wide">${body}</div>`);
}

export function render(page, vm) { const fn = pages[page]; if (!fn) throw new Error(`utility-account cannot render ${page}`); return fn(applyProfile(vm)); }

export const css = `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;font:16px/1.5 "Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#222;background:#f2f4f5}a{color:var(--brand)}a:hover{text-decoration:none}
.wrap{max-width:1200px;margin:0 auto;padding:0 20px}.skip{position:absolute;left:-999px}.skip:focus{left:8px;top:8px;background:#fff;padding:8px;z-index:9}
.ubar{background:#1d2228;color:#d6dbe0;font-size:13px}.ubar .wrap{display:flex;justify-content:space-between;gap:16px;padding-top:6px;padding-bottom:6px;flex-wrap:wrap}.ubar a{color:#fff;text-decoration:none;margin-left:18px}.ubar-links span{margin-left:18px}
.mast{background:#fff;box-shadow:0 2px 4px rgba(0,0,0,.08)}.mast>.wrap{display:flex;justify-content:space-between;align-items:center;padding-top:14px;padding-bottom:14px}.brand{display:flex;align-items:center;gap:12px;color:#1d2228;text-decoration:none;font-weight:700;font-size:21px;letter-spacing:-.2px}.logo{width:44px;height:44px}
.acct-menu{display:flex;gap:14px;align-items:center}.acct-menu a{font-weight:600}.hello{color:#555}.signout{color:#555}
.mega{border-top:1px solid #e3e6e8}.mega .wrap{display:flex;gap:2px;flex-wrap:wrap}.mega a{padding:13px 16px;color:#1d2228;text-decoration:none;font-weight:600;border-bottom:4px solid transparent}.mega a:hover{border-bottom-color:var(--brand);color:var(--brand)}
.btn{display:inline-block;border:2px solid var(--brand);background:#fff;color:var(--brand);padding:9px 20px;border-radius:24px;font:inherit;font-weight:700;text-decoration:none;cursor:pointer;text-align:center}.btn-primary{background:var(--brand);color:#fff}.btn-pay{background:#f2b705;border-color:#f2b705;color:#1d2228}.btn-ghost{background:#fff}.btn-danger{background:#b3261e;border-color:#b3261e;color:#fff}.btn-link{border:0;background:none;padding:0;color:var(--brand);text-decoration:underline;border-radius:0}.block{display:block;width:100%;margin:8px 0}
.acct-banner{background:var(--brand);color:#fff}.acct-banner .wrap{display:flex;gap:40px;flex-wrap:wrap;padding-top:14px;padding-bottom:14px}.acct-banner .lbl{display:block;color:#fff;font-size:12px;text-transform:uppercase;letter-spacing:.6px;opacity:.85}
.layout{display:grid;grid-template-columns:240px 1fr;gap:28px;margin-top:24px;margin-bottom:32px}.side{background:#fff;border-radius:4px;padding:12px 0;align-self:start;box-shadow:0 1px 2px rgba(0,0,0,.08)}.side .side-h{font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.8px;color:#6b7378;margin:14px 18px 4px}.side ul{list-style:none;margin:0;padding:0}.side a{display:block;padding:8px 18px;color:#1d2228;text-decoration:none;border-left:4px solid transparent}.side a:hover{background:#f2f4f5}.side a.on{border-left-color:var(--brand);font-weight:700;background:#eef3f6}
.main{min-width:0}.main.solo{margin:28px 0 40px}h1{font-size:30px;font-weight:600;margin:0 0 16px;color:#1d2228}h2{font-size:19px;margin:0 0 10px}.lead{font-size:18px;color:#4a5257}
.tile{background:#fff;border-radius:4px;padding:20px 22px;margin-bottom:18px;box-shadow:0 1px 2px rgba(0,0,0,.08)}.tile-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}.grid2 .tile{margin-bottom:0}.grid2{margin-bottom:18px}
.due{border-top:5px solid #f2b705}.big{font-size:40px;font-weight:700;margin:2px 0;color:#1d2228}.pending{color:#8a5a00;font-weight:600}.actions{margin-top:14px}
.prefs{list-style:none;margin:0;padding:0}.prefs li{display:grid;grid-template-columns:1fr auto auto;gap:12px;padding:9px 0;border-bottom:1px solid #eceff1}.on{color:#1b7a3a}.off{color:#6b7378}
.bars{display:flex;align-items:flex-end;gap:6px;height:150px;padding-top:8px;border-bottom:1px solid #ccd}.bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}.bar small{font-size:11px;color:#6b7378;margin-top:2px}.fill{display:block;width:70%;background:var(--brand);border-radius:2px 2px 0 0;opacity:.85}.bar:last-child .fill{background:#f2b705;opacity:1}
${Array.from({ length: 10 }, (_, i) => `.h${i + 1}{height:${(i + 1) * 12}px}`).join('')}
.hero{display:grid;grid-template-columns:1.4fr 1fr;gap:28px;align-items:center;background:linear-gradient(110deg,var(--brand) 0%,var(--brand) 55%,#1d2228 100%);color:#fff;padding:40px;border-radius:4px;margin-bottom:22px}.hero h1{color:#fff;font-size:36px}.hero .lead{color:#eef}.signin-box{background:#fff;color:#222;padding:24px;border-radius:4px}.signin-box h2{margin-top:0}
.quick{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:22px}.qcard{background:#fff;padding:20px;border-radius:4px;text-decoration:none;color:#1d2228;box-shadow:0 1px 2px rgba(0,0,0,.08);display:flex;flex-direction:column;gap:4px;border-bottom:4px solid var(--brand)}.qcard:hover{border-bottom-color:#f2b705}.qcard small{color:#6b7378}.ico{width:38px;height:38px;border-radius:50%;background:#eef3f6;color:var(--brand);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700}
.auth{max-width:440px;margin:0 auto;background:#fff;padding:30px;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.12)}.auth.wide{max-width:720px}.auth hr{border:0;border-top:1px solid #e3e6e8;margin:20px 0}.links{margin:12px 0}.small{font-size:14px;color:#4a5257}.center{text-align:center}
.stepper{display:flex;list-style:none;padding:0;margin:0 0 20px;counter-reset:s;gap:0}.stepper li{flex:1;display:flex;align-items:center;gap:8px;font-size:14px;color:#6b7378;padding:10px 6px;border-bottom:3px solid #d5dadd}.stepper li span{width:26px;height:26px;border-radius:50%;background:#d5dadd;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:13px}.stepper li.cur{color:#1d2228;font-weight:700;border-bottom-color:var(--brand)}.stepper li.cur span,.stepper li.done span{background:var(--brand)}.stepper li.done{border-bottom-color:var(--brand)}
.summary-row{display:flex;gap:24px;flex-wrap:wrap;background:#eef3f6;padding:12px 16px;border-radius:4px;margin-bottom:12px}
.field{margin:14px 0}.field label{display:block;font-weight:600;margin-bottom:5px}.field input[type=date]{max-width:260px}.field input,.field select,.field textarea{width:100%;padding:10px 12px;border:1px solid #8c959b;border-radius:3px;font:inherit;background:#fff}.field input:focus,.field select:focus{outline:2px solid var(--brand);outline-offset:1px}.help{color:#6b7378;font-size:13px}
fieldset{border:1px solid #d5dadd;border-radius:4px;margin:16px 0;padding:12px 18px}legend{font-weight:700;padding:0 6px}.radio,.check{display:block;margin:10px 0}.other-amount{width:130px;padding:6px 8px;margin-left:6px;border:1px solid #8c959b;border-radius:3px}.amt{margin-left:4px}
.terms{background:#f7f8f9;border:1px solid #e3e6e8;padding:12px 16px;border-radius:4px;font-size:14px;margin:14px 0}.terms h3{margin:0 0 6px;font-size:15px}.on-card{border-left:5px solid #1b7a3a}.danger-zone{border-top:1px solid #e3e6e8;margin-top:14px;padding-top:6px}.danger-zone h3{color:#b3261e;margin:8px 0 0;font-size:16px}
.alert{padding:12px 16px;border-radius:4px;margin-bottom:16px;font-weight:600}.alert-error{background:#fdecea;color:#8c1d18;border-left:5px solid #b3261e}.alert-ok{background:#e8f5ec;color:#145c2c;border-left:5px solid #1b7a3a}
.table{width:100%;border-collapse:collapse}.table th,.table td{text-align:left;padding:10px 8px;border-bottom:1px solid #e3e6e8}.table th{font-size:13px;text-transform:uppercase;letter-spacing:.4px;color:#4a5257;background:#f7f8f9}.empty{color:#6b7378}
dl{display:grid;grid-template-columns:max-content 1fr;gap:8px 20px;margin:0}dt{color:#4a5257}dd{margin:0}.review{margin:10px 0 16px}
.bill-head{display:flex;gap:32px;flex-wrap:wrap;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid var(--brand)}.lbl{display:block;font-size:12px;color:#6b7378;text-transform:uppercase;letter-spacing:.5px}.duebox{background:#fff8e1;border:1px solid #f2d27a;padding:12px 16px;border-radius:4px;font-size:18px}
.receipt .ok{color:#1b7a3a;font-weight:700;font-size:18px}.wallet{list-style:none;padding:0}.wallet li{display:flex;gap:14px;align-items:center;background:#fff;padding:12px 16px;margin-bottom:8px;border-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.08)}.wallet form{margin-left:auto}.pm{font-size:11px;font-weight:700;padding:3px 7px;border-radius:3px;background:#eef3f6;color:var(--brand)}
.ssm{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px}.ssm-opt{background:#fff;padding:16px;border-radius:4px;border:2px solid #e3e6e8}.ssm-opt.cur{border-color:var(--brand)}.ssm-opt h2{margin:0 0 6px;font-size:17px}
.help-search{display:flex;gap:8px;margin:12px 0 18px}.help-search input{flex:1;padding:10px 12px;border:1px solid #8c959b;border-radius:3px;font:inherit}.help-list{padding-left:18px}.help-list li{margin:6px 0}.steps li{margin:4px 0}.crumbs{font-size:14px}.links{padding-left:18px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.muted{color:#6b7378}details summary{cursor:pointer;color:var(--brand);margin:8px 0;font-weight:600}
.foot{background:#1d2228;color:#c9cfd4;margin-top:40px;padding:28px 0;font-size:14px}.foot a{color:#fff}.foot h2.foot-h{color:#fff;margin:0 0 6px;font-size:16px}.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
@media(max-width:600px){.table{display:block;overflow-x:auto;max-width:100%}}
@media(max-width:860px){.layout,.grid2,.hero,.cols,.ssm{grid-template-columns:minmax(0,1fr)}.quick{grid-template-columns:1fr 1fr}.acct-banner .wrap{gap:16px}}
${PROFILE_CSS}
`;
