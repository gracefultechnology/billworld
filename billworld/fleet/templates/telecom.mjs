// Telecom / ISP / cable / wireless account portal (Xfinity / Spectrum / AT&T style).
// Distinctives: two-step sign-in ("Let's go" then password), a "Billing & Pay" hub with a billing sub-nav,
// a services overview with service tiles, "Make a Payment" on one page then "Review" + "Submit Payment",
// "Auto Pay" set up / "Turn Off", plan "Upgrade", and a "Disconnect service" flow with a retention offer.
import { observe, finish, obsNav, obsFooter, heroText, heroLine, idLabel, submitLabel, social, helpExcerpts, articleExcerpt, mfaLead, mfaResend, OBS_CSS } from './_observed.mjs';
import { payDate, html, raw, doc, logo, alert, form, field, select, checkbox, button, hidden, methodChooser, newMethodFields, dateField, table, paymentRows, helpList, helpBody, helpSearchForm, money, fmtDate, methodText, statusLabel, L, labelNoun, setUpLabel } from '../kit.mjs';
import { withdrawn, withdrawnView } from './_withdrawn.mjs';
import { payOnText, lateNote } from './_hygiene.mjs';

export const meta = {
  id: 'telecom',
  // Where the dedicated tier's dossier nav (vm.nav) goes: the first element matching a selector (class:<token> or
  // aria:<label>) is re-filled with the dossier's items; observed real-site navs yield on public pages (server.mjs withDossierNav).
  navSlots: { public: ['class:global'], account: ['class:global'] },
  name: 'Telecom / ISP account (Xfinity-style)',
  description: 'Cable, internet, home phone and wireless self-service: services overview, Billing & Pay hub, Make a Payment, Auto Pay, Paperless, plan upgrade and disconnect with retention offer.',
  families: ['cable', 'internet', 'landline', 'wireless', 'satellite-tv'],
  sources: [
    'https://www.xfinity.com/support/articles/pay-comcast-bill-online',
    'https://www.xfinity.com/support/articles/setting-up-auto-payments'
  ],
  evidence: {
    observed_public: [
      'Xfinity help: "Billing & Pay" menu, then "Make a Payment"; choose "Current balance" or "Pay another amount", select a payment date and a saved or new method, "Continue", review, then "Submit Payment"',
      'Xfinity help: confirmation screen shows a confirmation/authorization number',
      'Xfinity help: Auto Pay via "Billing & Pay" > "Manage Auto Pay"; button "Set Up"; payments process on the bill due date; "Turn Off" button with a confirmation prompt'
    ],
    documented: [
      'Catalog notes for many ISPs/co-ops mention autopay, paperless/eBill, ePay portals and autopay discounts (e.g. Ziply Fiber, TDS ePay)'
    ],
    synthetic: [
      'Two-step sign-in (ID page, then password page) modelled on common cable/wireless sign-in, not captured',
      'Service tiles derived from the biller bill_type (internet, TV, home phone, mobile)',
      'Plan names per bill type and "Disconnect service" wording; retention offer of 50% off for 3 months comes from the shared engine',
      'Colours, layout and icons are original; brand colour comes from the catalog palette and a monogram stands in for the logo'
    ]
  }
};

export const routes = {
  home: '/', login: '/login', loginPassword: '/login/password', mfa: '/login/verify', register: '/create-id', verify: '/create-id/verify', forgot: '/login/forgot', reset: '/login/reset',
  guest: '/pay-bill', guestPay: '/pay-bill/payment', guestReview: '/pay-bill/review', guestReceipt: '/pay-bill/confirmation/:id',
  dashboard: '/overview', bill: '/billing', statements: '/billing/statements', statement: '/billing/statements/:id.pdf',
  pay: '/billing/make-payment', payMethod: '/billing/make-payment/method', payReview: '/billing/make-payment/review', payReceipt: '/billing/make-payment/confirmation/:id',
  history: '/billing/payment-history', autopay: '/billing/auto-pay', paperless: '/billing/paperless', wallet: '/billing/payment-methods', arrangement: '/billing/payment-arrangement',
  cancel: '/services/disconnect', plan: '/services/plan', contact: '/support/messages', profile: '/settings', logout: '/logout',
  help: '/support', helpArticle: '/support/articles/:slug', helpSearch: '/support/search'
};
export const flow = { paySteps: ['pay', 'payReview'], loginSteps: 2, guestSteps: ['guest', 'guestPay', 'guestReview'] };

const offline = vm => vm.biller.capabilities.online_account.support === 'unsupported';
const guestOk = vm => vm.biller.capabilities.guest_pay.support === 'supported';
const cancelOk = vm => vm.biller.capabilities.cancel_service.support === 'supported';
// Guest lookup copy names the fields the form actually asks for (dossier guestLookupFields).
const GUEST_WORD = { accountNumber: 'account number', zip: 'the ZIP code of your service address', phone: 'your phone number', lastName: 'your last name', dob: 'your date of birth', statementId: 'statement number', parcelId: 'parcel number', plate: 'license plate', amountDue: 'the amount due' };
const guestNeeds = vm => { const f = vm.auth?.guestLookupFields?.length ? vm.auth.guestLookupFields : ['accountNumber', 'zip']; const w = f.map(k => GUEST_WORD[k] || k).map((x, i) => i === 0 && /^(?:account|statement|parcel|license)/.test(x) ? `your ${x}` : x); return w.length > 1 ? `${w.slice(0, -1).join(', ')} and ${w.at(-1)}` : w[0]; };
const guestMethodsLine = vm => { const g = vm.billing?.guestMethods || ['bank', 'card']; return g.includes('bank') && g.includes('card') ? 'Pay with a bank account or a debit or credit card.' : g.includes('card') ? 'Pay with a debit or credit card.' : 'Pay from a bank account.'; };
const short = vm => vm.biller.brand.shortName;

// ---------- services ----------
const ICONS = {
  internet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 9a15 15 0 0 1 20 0l-1.6 1.6a12.7 12.7 0 0 0-16.8 0z" fill="currentColor"/><path d="M5.5 12.5a10 10 0 0 1 13 0l-1.6 1.6a7.7 7.7 0 0 0-9.8 0z" fill="currentColor"/><path d="M9 16a5 5 0 0 1 6 0l-3 3z" fill="currentColor"/></svg>',
  tv: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 21h8" stroke="currentColor" stroke-width="2"/></svg>',
  voice: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" fill="currentColor"/></svg>',
  mobile: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="18" r="1.2" fill="currentColor"/></svg>'
};
function services(vm) {
  const t = vm.biller.billType;
  if (t === 'wireless') return [['mobile', 'Mobile', '2 lines · Unlimited talk & text']];
  if (t === 'landline') return [['voice', 'Home Phone', 'Unlimited local & long distance']];
  if (t === 'cable-tv') return [['tv', 'TV', '2 TV boxes'], ['internet', 'Internet', 'Gateway rental included']];
  if (t === 'satellite-tv') return [['tv', 'TV', 'Satellite receiver · 2 rooms']];
  return [['internet', 'Internet', 'WiFi gateway']];
}
const PLAN_NAMES = {
  wireless: { essential: 'Mobile Basic', plus: 'Unlimited', gig: 'Unlimited Premium' },
  landline: { essential: 'Local Calling', plus: 'Unlimited Nationwide', gig: 'Voice + Internet Bundle' },
  'cable-tv': { essential: 'Choice TV', plus: 'Popular TV + Internet', gig: 'Ultimate TV + Gig Internet' },
  'satellite-tv': { essential: 'Entertainment', plus: 'Choice', gig: 'Ultimate' }
};
const PLAN_BLURB = { essential: 'Great for light use and a few devices', plus: 'Our most popular choice for busy households', gig: 'Our fastest, most complete package',
  /* satellite / fixed-wireless family plans (engine LOW_CAPACITY_PLANS) */ standard: 'Email, browsing and light streaming', max: 'Our fastest plan for your location' };
const planName = (vm, p) => PLAN_NAMES[vm.biller.billType]?.[p.id] || p.name;
const currentPlan = vm => vm.plans?.find(p => p.current);

// ---------- chrome ----------
function header(vm) {
  const authed = vm.authenticated;
  return html`<div class="utility"><div class="wrap"><span>${vm.biller.name}</span><span class="utility-links"><a href="${vm.url('help')}">${L(vm, 'help', 'Support')}</a>${!offline(vm) && guestOk(vm) && !authed ? html`<a href="${vm.url('guest')}">${L(vm, 'guest', 'Pay bill')}</a>` : ''}</span></div></div>
<header class="masthead"><div class="wrap"><a class="brand" href="${vm.url(authed ? 'dashboard' : 'home')}">${logo(vm)}<span>${short(vm)}</span></a>
${offline(vm) ? html`<nav class="global" aria-label="Main"><a href="${vm.url('home')}">${L(vm, 'home', 'Home')}</a><a href="${vm.url('help')}">${L(vm, 'help', 'Support')}</a></nav>`
  : authed ? html`<nav class="global" aria-label="My Account"><a href="${vm.url('dashboard')}"${cur(vm, ['dashboard'])}>${L(vm, 'dashboard', 'Overview')}</a><a href="${vm.url('bill')}"${cur(vm, BILLING)}>${L(vm, 'bill', 'Billing')}</a><a href="${vm.url('plan')}"${cur(vm, ['plan', 'cancel'])}>${L(vm, 'plan', 'Services')}</a><a href="${vm.url('help')}"${cur(vm, ['help', 'helpArticle', 'helpSearch', 'contact'])}>${L(vm, 'help', 'Support')}</a></nav><div class="acct"><a href="${vm.url('profile')}" class="avatar" aria-label="Settings">${vm.persona.first[0]}</a><span class="acct-name">${vm.persona.first}</span><a href="${vm.url('logout')}">${L(vm, 'logout', 'Sign out')}</a></div>`
  : html`<nav class="global" aria-label="Main"><a href="${vm.url('home')}">${L(vm, 'home', 'My Account')}</a><a href="${vm.url('help')}">${L(vm, 'help', 'Support')}</a></nav><a class="pill pill-dark" href="${vm.url('login')}">${L(vm, 'login', 'Sign in')}</a>`}</div></header>`;
}
// Dedicated billers: show AutoPay / paperless entry points only where the dossier says they exist (or AutoPay is still on).
const capOn = (vm, k) => vm.biller.capabilities[k]?.support === 'supported';
const capOff = (vm, k) => ['unsupported', 'not_applicable'].includes(vm.biller.capabilities[k]?.support) && !!vm.biller.capabilities[k]?.dossier;
const apShown = vm => vm.autopay?.enrolled || !(capOff(vm, 'autopay') && !capOn(vm, 'autopay_cancel'));
const paperShown = vm => !capOff(vm, 'paperless');
const andList = w => w.length > 1 ? `${w.slice(0, -1).join(', ')} and ${w.at(-1)}` : w[0];
function homeLead(vm) {
  if (vm.tier !== 'dedicated') return 'Pay your bill, set up Auto Pay, go paperless and upgrade your plan';
  const bits = ['Pay your bill'];
  if (capOn(vm, 'autopay') && capOn(vm, 'autopay_cancel')) bits.push(`set up ${L(vm, 'autopay', 'Auto Pay')}`);
  if (capOn(vm, 'paperless')) bits.push('go paperless');
  if (!capOff(vm, 'change_plan')) bits.push('change your plan');
  return andList(bits);
}
function waysToPay(vm) {
  const w = ['Online']; if (capOn(vm, 'pay_by_phone')) w.push(`by phone${vm.biller.payPhone ? ` (${vm.biller.payPhone})` : ''}`); if (capOn(vm, 'pay_by_mail')) w.push('by mail');
  return w.length > 1 ? `${w.slice(0, -1).join(', ')} or ${w.at(-1)}` : 'Online';
}
const BILLING = ['bill', 'statements', 'pay', 'payMethod', 'payReview', 'payReceipt', 'history', 'autopay', 'paperless', 'wallet', 'arrangement'];
const cur = (vm, pages) => pages.includes(vm.page) ? raw(' aria-current="page" class="on"') : '';
function billingNav(vm) {
  const off = k => ['unsupported', 'not_applicable'].includes(vm.biller.capabilities[k]?.support) && vm.biller.capabilities[k]?.dossier; // pages a dossier says the biller doesn't offer online
  const items = [['bill', 'Bill details'], ['pay', 'Make a payment'], ['history', 'Payment history'], ['statements', 'Statements'], ['autopay', 'Auto Pay'], ['paperless', 'Paperless billing'], ['wallet', 'Payment methods'], ['arrangement', 'Payment arrangement']].filter(([p]) => !(p === 'paperless' && vm.biller.capabilities.paperless?.support === 'not_applicable' && vm.biller.capabilities.paperless?.dossier) && !(p === 'arrangement' && off('payment_arrangement')) && !(p === 'autopay' && off('autopay') && off('autopay_cancel')));
  return html`<nav class="subnav" aria-label="Billing &amp; Pay"><span class="subnav-title">Billing &amp; Pay</span>${items.map(([p, t]) => html`<a href="${vm.url(p)}"${cur(vm, p === 'pay' ? ['pay', 'payMethod', 'payReview', 'payReceipt'] : [p])}>${L(vm, p, t)}</a>`)}</nav>`;
}
function footer(vm) {
  return html`<footer class="foot"><div class="wrap"><div><strong>${short(vm)}</strong><p>${vm.biller.phone ? html`Customer service <a href="${vm.url('helpArticle', { slug: 'contact-us' })}">${vm.biller.phone}</a>` : html`Need help? <a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact customer service</a>`}</p></div><div class="foot-links"><a href="${vm.url('help')}">${L(vm, 'help', 'Support')}</a><a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact us</a><a href="${vm.url('helpArticle', { slug: 'pay-your-bill' })}">Ways to pay</a></div></div>${!vm.authenticated ? html`<div class="wrap">${obsFooter(vm)}</div>` : ''}<p class="wrap fine">Demo portal for ${vm.biller.name}. Not affiliated with the real provider.</p></footer>`;
}
function shell(vm, title, body, { billing = BILLING.includes(vm.page) && vm.authenticated, narrow = false } = {}) {
  return doc(vm, { title: `${title} | ${short(vm)}`, bodyClass: 'tc', body: html`${header(vm)}${obsNav(vm)}${billing ? billingNav(vm) : ''}<main class="wrap${narrow ? ' narrow' : ''}">${alert(vm)}${body}</main>${footer(vm)}` });
}
const h1 = (t, sub) => html`<div class="page-head"><h1>${t}</h1>${sub ? html`<p class="sub">${sub}</p>` : ''}</div>`;
const icon = k => raw(`<span class="svc-icon">${ICONS[k]}</span>`);

// ---------- pages ----------
const pages = {
  home(vm) {
    if (offline(vm)) {
      const art = vm.help.find(a => a.slug === 'pay-your-bill');
      return shell(vm, 'Pay your bill', html`${h1(`Paying your ${vm.biller.name} bill`)}<div class="notice-card"><p class="lead">Online account access and online bill payment are not available for this provider.</p></div><section class="tile">${art ? html`<h2>Ways to pay</h2>${helpBody(art)}` : ''}${vm.biller.phone ? html`<p>Questions? Call <strong>${vm.biller.phone}</strong>.</p>` : html`<p>Use the contact information printed on your paper bill.</p>`}</section>`);
    }
    return shell(vm, 'My Account', html`<section class="hero"><div class="hero-text"><p class="eyebrow">My Account</p><h1>${vm.tier === 'dedicated' ? `Manage your ${vm.biller.brand.displayName || vm.biller.brand.shortName} services` : heroText(vm, `Manage your ${vm.biller.name} services`)}</h1><p class="lead">${homeLead(vm)} — all in one place.</p><p class="actions"><a class="pill" href="${vm.url('login')}">${L(vm, 'login', 'Sign in')}</a>${guestOk(vm) ? html`<a class="pill pill-ghost" href="${vm.url('guest')}">${L(vm, 'guest', 'Pay without signing in')}</a>` : ''}</p><p class="small">New here? <a href="${vm.url('register')}">${L(vm, 'register', `Create your ${short(vm)} ID`)}</a></p></div><div class="hero-art" aria-hidden="true">${services({ biller: vm.biller }).map(([k]) => icon(k))}</div></section>
<section class="quick"><h2>Popular tasks</h2><div class="quick-grid">
<a class="quick-item" href="${vm.url('helpArticle', { slug: 'pay-your-bill' })}"><strong>Ways to pay</strong><span>${vm.tier !== 'dedicated' ? html`Online, by phone${vm.biller.payPhone ? ` (${vm.biller.payPhone})` : ''} or by mail` : waysToPay(vm)}</span></a>
${vm.biller.capabilities.autopay.support === 'supported' ? html`<a class="quick-item" href="${vm.url('helpArticle', { slug: 'autopay' })}"><strong>Auto Pay</strong><span>Pay automatically on your due date</span></a>` : ''}
<a class="quick-item" href="${vm.url('helpArticle', { slug: 'view-your-bill' })}"><strong>Understand your bill</strong><span>Charges, taxes &amp; fees explained</span></a>
<a class="quick-item" href="${vm.url('help')}"><strong>${L(vm, 'help', 'Support')}</strong><span>Billing, account &amp; service help</span></a></div></section>
<section class="tile search-tile"><h2>How can we help?</h2>${helpSearchForm(vm, { placeholder: 'Search support' })}</section>`);
  },
  login(vm) {
    return shell(vm, 'Sign in', html`<div class="signin"><div class="signin-brand">${logo(vm)}</div><h1>${vm.auth ? L(vm, 'signIn', 'Sign in') : `Sign in with your ${short(vm)} ID`}</h1>${form(vm, 'login', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'username', label: idLabel(vm, 'Email, mobile, or username'), autocomplete: 'username' })}${button(vm.auth && vm.flow?.loginSteps === 1 ? L(vm, 'signIn', 'Sign in') : submitLabel(vm, "Let's go", 'next'), { cls: 'pill wide' })}`)}${social(vm)}<p class="small"><a href="${vm.url('forgot')}">${L(vm, 'forgot', 'Forgot username or password?')}</a></p><hr><p class="small">${vm.auth ? 'New here?' : `Don't have a ${short(vm)} ID?`} <a href="${vm.url('register')}">${L(vm, 'register', 'Create one')}</a></p>${guestOk(vm) ? html`<p class="small"><a href="${vm.url('guest')}">Pay your bill without signing in</a></p>` : ''}</div>`, { narrow: true });
  },
  loginPassword(vm) {
    const u = vm.values.username || vm.query.u || '';
    return shell(vm, 'Enter your password', html`<div class="signin"><div class="signin-brand">${logo(vm)}</div><h1>Enter your password</h1><p class="who-chip">${u} · <a href="${vm.url('login')}">${L(vm, 'login', 'Not you?')}</a></p>${form(vm, 'loginPassword', html`${hidden('next', vm.query.next || '')}${hidden('username', u)}${field(vm, { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' })}${checkbox(vm, { name: 'remember', label: 'Keep me signed in' })}${button(submitLabel(vm, 'Sign in', 'final'), { cls: 'pill wide' })}`)}<p class="small"><a href="${vm.url('forgot')}">${L(vm, 'forgot', 'Forgot password?')}</a></p></div>`, { narrow: true });
  },
  mfa(vm) { return shell(vm, "Verify it's you", html`<div class="signin"><h1>Let's verify it's you</h1><p>${mfaLead(vm, `We sent a 6-digit code to the email address on your account. Enter it below to continue.`)}</p>${form(vm, 'mfa', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'code', label: 'Verification code', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' })}${button('Continue', { cls: 'pill wide' })}`)}${mfaResend(vm)}</div>`, { narrow: true }); },
  register(vm) {
    return shell(vm, 'Create your ID', html`<div class="signin wide-signin"><h1>Create your ${short(vm)} ID</h1><p>Have your account number handy — it's at the top of your bill.</p>${form(vm, 'register', html`<div class="two">${field(vm, { name: 'accountNumber', label: 'Account number', inputmode: 'numeric' })}${field(vm, { name: 'zip', label: 'Service address ZIP code', inputmode: 'numeric', maxlength: 5 })}</div>${field(vm, { name: 'email', label: 'Email address', type: 'email', autocomplete: 'email', help: 'This will be your username.' })}<div class="two">${field(vm, { name: 'password', label: 'Create password', type: 'password', autocomplete: 'new-password' })}${field(vm, { name: 'confirm', label: 'Re-enter password', type: 'password', autocomplete: 'new-password' })}</div><p class="help">Use 8 or more characters with upper and lower case letters, a number and a symbol.</p>${button('Create ID', { cls: 'pill' })}`)}<p class="small">Already have an ID? <a href="${vm.url('login')}">${L(vm, 'login', 'Sign in')}</a></p></div>`, { narrow: true });
  },
  verify(vm) { return shell(vm, 'Check your email', html`<div class="signin"><h1>Check your email</h1><p>Select the link in the email we sent to finish creating your ${short(vm)} ID.</p><p><a href="${vm.url('login')}">Back to sign in</a></p></div>`, { narrow: true }); },
  forgot(vm) { return shell(vm, 'Reset password', html`<div class="signin"><h1>${L(vm, 'forgot', 'Forgot your password?')}</h1><p>Enter your ${short(vm)} ID or account number and we'll email you a verification code.</p>${form(vm, 'forgot', html`${field(vm, { name: 'identifier', label: 'Email, username, or account number', autocomplete: 'username' })}${button('Send code', { cls: 'pill wide' })}`)}<p class="small"><a href="${vm.url('login')}">Back to sign in</a></p></div>`, { narrow: true }); },
  reset(vm) { return shell(vm, 'Create a new password', html`<div class="signin"><h1>Create a new password</h1>${form(vm, 'reset', html`${vm.query.token ? hidden('token', vm.query.token) : field(vm, { name: 'code', label: 'Verification code from your email', inputmode: 'numeric', autocomplete: 'one-time-code' })}${field(vm, { name: 'password', label: 'New password', type: 'password', autocomplete: 'new-password' })}${field(vm, { name: 'confirm', label: 'Re-enter new password', type: 'password', autocomplete: 'new-password' })}${button('Save password', { cls: 'pill wide' })}`)}</div>`, { narrow: true }); },
  guest(vm) { return shell(vm, 'Pay your bill', html`<div class="signin wide-signin"><h1>Pay your bill without signing in</h1><p>Make a one-time payment with ${guestNeeds(vm)}.</p>${form(vm, 'guest', html`${field(vm, { name: 'accountNumber', label: 'Account number', inputmode: 'numeric' })}${field(vm, { name: 'zip', label: 'Service address ZIP code', inputmode: 'numeric', maxlength: 5 })}${button('Continue', { cls: 'pill' })}`)}<p class="small">Want to see your bill and payment history? <a href="${vm.url('login')}">${L(vm, 'login', 'Sign in')}</a></p></div>`, { narrow: true }); },
  guestPay(vm) {
    return shell(vm, 'Make a payment', html`${h1('Make a payment', html`Account ${vm.accountMasked}`)}<div class="pay-layout"><div class="pay-main">${form(vm, 'guestPay', html`${amountBlock(vm)}<fieldset class="block"><legend>Payment method</legend><p class="help">${guestMethodsLine(vm)}</p>${newMethodFields(vm)}</fieldset>${button('Continue', { cls: 'pill' })}`)}</div>${balanceAside(vm)}</div>`);
  },
  guestReview(vm) { return reviewPage(vm, 'guestReview'); },
  guestReceipt(vm) { return receiptPage(vm); },

  dashboard(vm) {
    const plan = currentPlan(vm); const ap = vm.autopay; const svc = vm.service;
    return shell(vm, 'Overview', html`<div class="greeting"><h1>Hi, ${vm.persona.first}</h1><p class="sub">${vm.account.serviceAddress} · Account ${vm.accountMasked}</p></div>
${svc.status === 'cancel_pending' ? html`<div class="banner warn">Your service is scheduled to disconnect on <strong>${fmtDate(svc.cancelAt)}</strong>. <a href="${vm.url('cancel')}">Manage</a></div>` : ''}
<div class="dash"><section class="tile bill-tile"><h2>Your bill</h2><p class="balance-label">Balance</p><p class="balance">${money(vm.balanceCents)}</p><p class="due">Due ${vm.dueText}${ap.enrolled ? ' · Auto Pay is on' : ''}</p>${vm.pendingPayments.length ? html`<p class="muted">${vm.pendingPayments.length} payment${vm.pendingPayments.length > 1 ? 's' : ''} processing</p>` : ''}${vm.scheduled.length ? html`<p class="muted">${vm.scheduled.length} scheduled payment${vm.scheduled.length > 1 ? 's' : ''}</p>` : ''}<p class="actions"><a class="pill" href="${vm.url('pay')}">${L(vm, 'pay', 'Pay bill')}</a><a class="pill pill-ghost" href="${vm.url('bill')}">${L(vm, 'bill', 'View bill details')}</a></p>
<ul class="status-list">${apShown(vm) ? html`<li><span>${L(vm, 'autopay', 'Auto Pay')}</span><a href="${vm.url('autopay')}">${ap.enrolled ? 'On' : setUpLabel(L(vm, 'autopay', 'Auto Pay'))}</a></li>` : ''}${paperShown(vm) ? html`<li><span>${L(vm, 'paperless', 'Paperless billing')}</span><a href="${vm.url('paperless')}">${vm.account.paperless ? 'On' : 'Go paperless'}</a></li>` : ''}<li><span>Payment methods</span><a href="${vm.url('wallet')}">${vm.methods.length} saved</a></li></ul></section>
<section class="tile"><h2>Your services</h2><ul class="svc-list">${services(vm).map(([k, name, detail]) => html`<li>${icon(k)}<div><strong>${name}</strong><span>${detail}</span></div><span class="tag ${svc.status === 'active' ? 'ok' : 'warn'}">${svc.status === 'active' ? 'Active' : svc.status === 'cancel_pending' ? 'Disconnect scheduled' : 'Disconnected'}</span></li>`)}</ul>${plan ? html`<div class="plan-line"><div><span class="muted">Your plan</span><strong>${planName(vm, plan)}</strong>${plan.cents && (vm.tier !== 'dedicated' || vm.billing?.dossierPlans) ? html`<span class="muted">${money(plan.cents)}/mo</span>` : ''}</div><a class="pill pill-ghost" href="${vm.url('plan')}">${!capOff(vm, 'change_plan') ? L(vm, 'plan', 'Upgrade') : 'Plan details'}</a></div>` : ''}</section></div>
<section class="tile"><h2>Manage your account</h2><div class="link-grid"><a href="${vm.url('history')}">${L(vm, 'history', 'Payment history')}</a><a href="${vm.url('statements')}">${L(vm, 'statements', 'Statements')}</a>${capOff(vm, 'payment_arrangement') ? '' : html`<a href="${vm.url('arrangement')}">${L(vm, 'arrangement', 'Payment arrangement')}</a>`}<a href="${vm.url('contact')}">${L(vm, 'contact', 'Messages')}</a><a href="${vm.url('profile')}">${L(vm, 'profile', 'Settings')}</a>${cancelOk(vm) ? html`<a href="${vm.url('cancel')}">${L(vm, 'cancel', 'Disconnect service')}</a>` : ''}</div></section>`);
  },
  bill(vm) {
    const inv = vm.invoice;
    return shell(vm, 'Billing', html`${h1('Bill details', html`Statement ${inv.number} · Service period ${inv.period}`)}<div class="pay-layout"><div class="pay-main"><section class="tile"><div class="bill-head"><div><p class="balance-label">Total due</p><p class="balance">${money(Math.max(0, vm.balanceCents))}</p><p class="due">Due ${fmtDate(inv.dueAt)}</p></div><div class="actions"><a class="pill" href="${vm.url('pay')}">${L(vm, 'pay', 'Make a payment')}</a><a class="pill pill-ghost" href="${vm.url('statement', { id: inv.id })}">Download PDF</a></div></div>
<h2 class="h3">Monthly charges</h2>${table(['Charge', 'Amount'], [...inv.lines.map(l => [l.desc, money(l.cents)]), [html`<strong>Total</strong>`, html`<strong>${money(inv.amountCents)}</strong>`]], 'table charges')}</section></div>${balanceAside(vm)}</div>`);
  },
  statements(vm) { return shell(vm, 'Statements', html`${h1('Statements', 'Up to 12 months of past bills')}<section class="tile">${table(['Bill date', 'Amount', 'Due date', ''], vm.invoices.map(i => [fmtDate(i.issuedAt), money(i.amountCents), fmtDate(i.dueAt), html`<a href="${vm.url('statement', { id: i.id })}">View PDF</a>`]))}</section>`); },
  pay(vm) {
    return shell(vm, 'Make a payment', html`${h1(L(vm, 'pay', 'Make a payment'))}<div class="pay-layout"><div class="pay-main">${form(vm, 'pay', html`${amountBlock(vm)}${vm.biller.capabilities.scheduled_payment?.support !== 'supported' || vm.billing?.limits?.maxDaysAhead === 0 ? '' : html`<fieldset class="block"><legend>Payment date</legend>${dateField(vm, { label: 'Pay on' })}${vm.tier === 'dedicated' ? '' : html`<p class="help">Payments made by 11:59 p.m. post the next business day.</p>`}</fieldset>`}<div class="block">${methodChooser(vm, { title: 'Payment method' })}</div>${button('Continue', { cls: 'pill' })}`)}</div>${balanceAside(vm)}</div>`);
  },
  payMethod(vm) { return pages.pay(vm); },
  payReview(vm) { return reviewPage(vm, 'payReview'); },
  payReceipt(vm) { return receiptPage(vm); },
  history(vm) { return shell(vm, 'Payment history', html`${h1(L(vm, 'history', 'Payment history'))}<section class="tile">${table(['Date', 'Amount', 'Method', 'Confirmation', 'Status', ''], paymentRows(vm))}</section>`); },
  autopay(vm) {
    const ap = vm.autopay;
    const setup = form(vm, 'autopay', html`${hidden('action', 'enroll')}${methodChooser(vm, { title: 'Pay with' })}<p class="help">Your full balance is charged on each bill due date.</p>${checkbox(vm, { name: 'acceptTerms', label: 'I agree to the Auto Pay Terms and Conditions and authorize recurring charges.' })}${button(ap.enrolled ? 'Update' : 'Set Up', { cls: 'pill' })}`);
    const A = labelNoun(L(vm, 'autopay', 'Auto Pay')); const lead = vm.billing?.autopayLeadDays;
    return shell(vm, 'Auto Pay', html`${h1(L(vm, 'autopay', 'Auto Pay'), lead ? `We charge your payment method ${lead} day${lead === 1 ? '' : 's'} before your due date` : 'Pay your bill automatically on your due date')}${ap.enrolled ? html`<section class="tile"><div class="status-head"><span class="tag ok">On</span><div><p><strong>${A} is on.</strong></p><p>We charge your ${ap.policy === 'fixed' ? `fixed amount of ${money(ap.fixedCents)}` : 'full balance'} on each due date from ${vm.autopayMethod ? methodText(vm.autopayMethod) : 'your saved method'}.</p><p class="muted">Upcoming: ${money(vm.balanceCents)} on ${vm.dueText}</p></div></div>${form(vm, 'autopay', html`${hidden('action', 'cancel')}${checkbox(vm, { name: 'confirm', label: html`Yes, turn off ${A}. I'll pay future bills myself.` })}${button('Turn Off', { cls: 'pill pill-danger' })}`, { cls: 'inline-form' })}</section><section class="tile"><details><summary>Change ${A} payment method</summary>${setup}</details></section>`
      : html`<section class="tile"><div class="status-head"><span class="tag">Off</span><p>Set up ${A} and never miss a payment. If you have a balance now, make a one-time payment — automatic payments start with your next bill.</p></div>${setup}</section>`}`);
  },
  paperless(vm) {
    const on = vm.account.paperless;
    return shell(vm, 'Paperless billing', html`${h1(L(vm, 'paperless', 'Paperless billing'))}<section class="tile"><div class="status-head"><span class="tag ${on ? 'ok' : ''}">${on ? 'On' : 'Off'}</span><p>${on ? `We'll email ${vm.persona.email} when your bill is ready. Paper bills are off.` : 'Get an email when your bill is ready instead of a paper bill in the mail.'}</p></div>${form(vm, 'paperless', html`${hidden('paperless', on ? 'off' : 'on')}${!on ? field(vm, { name: 'email', label: 'Email for bill notifications', type: 'email', value: vm.persona.email }) : ''}${button(on ? 'Turn off paperless billing' : 'Go paperless', { cls: on ? 'pill pill-ghost' : 'pill' })}`)}</section>`);
  },
  wallet(vm) {
    return shell(vm, 'Payment methods', html`${h1(L(vm, 'wallet', 'Payment methods'))}<section class="tile"><ul class="wallet">${vm.methods.length ? vm.methods.map(m => html`<li><div><strong>${methodText(m)}</strong>${m.nickname ? html`<span class="muted"> · ${m.nickname}</span>` : ''}${vm.autopay.enrolled && vm.autopay.methodId === m.id ? html` <span class="tag ok">Auto Pay</span>` : ''}</div>${form(vm, 'wallet', html`${hidden('op', 'remove')}${hidden('methodId', m.id)}<button type="submit" class="linkbtn" aria-label="Remove ${methodText(m)}">Remove</button>`)}</li>`) : html`<li>No saved payment methods.</li>`}</ul></section><section class="tile"><h2>Add a payment method</h2>${form(vm, 'wallet', html`${hidden('op', 'add')}${newMethodFields(vm)}${field(vm, { name: 'nickname', label: 'Nickname (optional)', required: false })}${button('Save', { cls: 'pill' })}`)}</section>`);
  },
  cancel(vm) {
    const svc = vm.service;
    if (svc.status !== 'active' && vm.step !== 'done') return shell(vm, 'Disconnect service', html`${h1(L(vm, 'cancel', 'Disconnect service'))}<section class="tile"><p>${svc.status === 'cancel_pending' ? html`Your service is scheduled to disconnect on <strong>${fmtDate(svc.cancelAt)}</strong>.` : 'Your service has been disconnected.'}</p>${svc.status === 'cancel_pending' ? form(vm, 'cancel', html`${hidden('step', 'undo')}${button('Keep my service', { cls: 'pill' })}`) : ''}</section>`);
    // Dossier billing.retentionOffer false: the engine goes reason -> confirm, so no "Offers" step is shown.
    const steps = vm.billing?.retentionOffer === false ? ['reason', 'confirm'] : ['reason', 'offer', 'confirm'];
    const STEP_NAMES = { reason: 'Reason', offer: 'Offers', confirm: 'Confirm' };
    const prog = html`<ol class="progress">${steps.map((s, i) => html`<li class="${s === vm.step ? 'on' : steps.indexOf(vm.step) > i ? 'done' : ''}">${STEP_NAMES[s]}</li>`)}</ol>`;
    // Equipment copy: dossier billing.equipmentReturn (text, or false when customers own their equipment); wireless has none.
    const equip = vm.billing?.equipmentReturn === false || /wireless|mobile|cell/i.test(`${vm.biller.billType || ''} ${vm.biller.category || ''}`) ? '' : vm.billing?.equipmentReturn || 'return any gateways, TV boxes and remotes within 30 days to avoid unreturned-equipment charges.';
    const reasons = [['moving', 'Moving to a new address'], ['cost', 'Price is too high'], ['switching', 'Switching to another provider'], ['not_using', "Don't use it enough"], ['service', 'Service or reliability issues'], ['other', 'Other']];
    const body = {
      reason: html`${h1(L(vm, 'cancel', 'Disconnect service'), 'We hate to see you go. Tell us why you want to disconnect.')}${prog}<section class="tile">${form(vm, 'cancel', html`${hidden('step', 'reason')}<fieldset class="block"><legend>Reason for disconnecting</legend>${reasons.map(([v, t], i) => html`<label class="radio"><input type="radio" name="reason" value="${v}"${(vm.values.reason || '') === v ? raw(' checked') : ''}${i === 0 ? raw(' required') : ''}> <span>${t}</span></label>`)}</fieldset><p class="help">Moving? You may be able to transfer service to your new address instead.</p>${button('Continue', { cls: 'pill' })}`)}</section>`,
      offer: html`${h1('Wait — we have an offer for you')}${prog}<section class="tile offer"><p class="offer-badge">Limited-time offer</p><h2>Stay and save 50% for 3 months</h2><p>Keep your ${currentPlan(vm) ? planName(vm, currentPlan(vm)) : ''} service at half price on your next three bills. No contract.</p>${form(vm, 'cancel', html`${hidden('step', 'offer')}<p class="actions">${button('Accept offer', { cls: 'pill', name: 'accept', value: 'yes' })}${button('No thanks, continue to disconnect', { cls: 'pill pill-ghost', name: 'accept', value: 'no' })}</p>`)}</section>`,
      confirm: html`${h1('Schedule your disconnect')}${prog}<section class="tile">${form(vm, 'cancel', html`${hidden('step', 'confirm')}${vm.billing?.cancelAtDueDate ? html`<dl class="kv"><dt>Disconnect date</dt><dd><strong>${fmtDate(nextDueAt(vm))}</strong> (your next payment due date)</dd></dl>` : dateField(vm, { name: 'effectiveDate', label: 'Disconnect date' })}${equip ? html`<div class="note"><strong>Equipment return:</strong> ${equip} Your final bill will be sent to you.</div>` : html`<div class="note">Your final bill will be sent to you.</div>`}${checkbox(vm, { name: 'confirm', label: 'I understand my services will be disconnected on this date.' })}${button('Schedule disconnect', { cls: 'pill pill-danger' })}`)}</section>`,
      done: withdrawn(vm) ? withdrawnView(vm) : html`${h1('Your disconnect is scheduled')}<section class="tile receipt"><dl><dt>Disconnect date</dt><dd><strong>${svc.cancelAt ? fmtDate(svc.cancelAt) : ''}</strong></dd><dt>Confirmation number</dt><dd><strong>${svc.confirmation || ''}</strong></dd></dl><p>We emailed you a confirmation. <a href="${vm.url('dashboard')}">Back to Overview</a></p></section>`,
      kept: html`${h1('Thanks for staying with us')}<section class="tile"><p>Your 50% discount will apply to your next three bills.</p><p><a href="${vm.url('dashboard')}">Back to Overview</a></p></section>`
    };
    return shell(vm, 'Disconnect service', body[vm.step]);
  },
  plan(vm) {
    return shell(vm, 'Your plan', html`${!capOff(vm, 'change_plan') ? h1('Upgrade or change your plan', 'Changes take effect on your next billing date.') : h1('Your plan')}${vm.plans.length ? form(vm, 'plan', html`<fieldset class="plans"><legend class="sr-only">Choose a plan</legend>${vm.plans.map(p => html`<label class="plan-card${p.current ? ' current' : ''}"><input type="radio" name="planId" value="${p.id}"${p.current ? raw(' checked') : ''}><span class="plan-name">${planName(vm, p)}</span><span class="plan-price">${p.cents ? money(p.cents) : ''}<small>/mo</small></span><span class="plan-blurb">${PLAN_BLURB[p.id] || ''}</span>${p.current ? html`<span class="tag ok">Current plan</span>` : ''}</label>`)}</fieldset>${button('Update plan', { cls: 'pill' })}`) : html`<p>Plan changes are not available online. Call us to change your services.</p>`}${cancelOk(vm) ? html`<p class="small">Need to stop service? <a href="${vm.url('cancel')}">${L(vm, 'cancel', 'Disconnect service')}</a></p>` : ''}`);
  },
  arrangement(vm) {
    return shell(vm, 'Payment arrangement', html`${h1('Payment arrangement', !capOff(vm, 'payment_arrangement') ? 'Need more time? Split your balance into monthly installments.' : 'Payment arrangements')}<section class="tile">${vm.account.arrangement ? html`<p>You're paying <strong>${money(vm.account.arrangement.monthlyCents)}</strong> per month for ${vm.account.arrangement.months} months, added to your monthly bill.</p>` : form(vm, 'arrangement', html`<p>Balance: <strong>${money(vm.balanceCents)}</strong></p>${select(vm, { name: 'months', label: 'Number of installments', options: [['3', '3 months'], ['6', '6 months'], ['12', '12 months']] })}${button('Set up arrangement', { cls: 'pill' })}`)}</section>`);
  },
  contact(vm) {
    return shell(vm, 'Messages', html`${h1('Messages', 'Send us a message about your account and we\'ll reply within 2 business days.')}${vm.account.messages.length ? html`<section class="tile"><h2>Your messages</h2>${table(['Date', 'Subject', 'Status'], vm.account.messages.map(m => [fmtDate(m.at), m.subject, m.status]))}</section>` : ''}<section class="tile">${form(vm, 'contact', html`${select(vm, { name: 'subject', label: 'Topic', options: [['Billing question', 'Billing question'], ['Service issue', 'Service or outage issue'], ['Equipment', 'Equipment'], ['Moving', 'Moving or transferring service'], ['Other', 'Other']] })}<div class="field"><label for="f-message">Message</label><textarea id="f-message" name="message" rows="5" required>${vm.values.message || ''}</textarea></div>${button('Send message', { cls: 'pill' })}`)}</section>`);
  },
  profile(vm) {
    return shell(vm, 'Settings', html`${h1(L(vm, 'profile', 'Settings'))}<section class="tile"><h2>Contact info</h2><dl class="kv"><dt>Name</dt><dd>${vm.persona.name}</dd><dt>Email (username)</dt><dd>${vm.persona.email}</dd><dt>Mobile number</dt><dd>${vm.account.phone || 'Not provided'}</dd><dt>Service address</dt><dd>${vm.account.serviceAddress}</dd></dl>${form(vm, 'profile', html`${field(vm, { name: 'phone', label: 'Update mobile number', type: 'tel', autocomplete: 'tel' })}${button('Save', { cls: 'pill' })}`)}</section>`);
  },
  help(vm) {
    const groups = [['payments', 'Billing & payments'], ['billing', 'Your bill'], ['autopay', 'Auto Pay'], ['account', 'Account & sign in'], ['assistance', 'Assistance programs'], ['contact', 'Contact'], ['faq', 'More questions']];
    return shell(vm, 'Support', html`<section class="support-hero"><h1>${short(vm)} Support</h1>${helpSearchForm(vm, { placeholder: 'Search support' })}</section><div class="support-grid">${groups.map(([topic, label]) => { const list = vm.help.filter(a => a.topic === topic); return list.length ? html`<section class="tile"><h2 class="h3">${label}</h2>${helpList(vm, list)}</section>` : ''; })}</div>${helpExcerpts(vm)}${!offline(vm) && vm.authenticated ? html`<p>Still need help? <a href="${vm.url('contact')}">${L(vm, 'contact', 'Send us a message')}</a></p>` : ''}`);
  },
  helpArticle(vm) { return shell(vm, vm.article.title, html`<p class="crumbs"><a href="${vm.url('help')}">${L(vm, 'help', 'Support')}</a> › Article</p><article class="tile article"><h1>${vm.article.title}</h1>${helpBody(vm.article)}</article>${articleExcerpt(vm)}<p><a href="${vm.url('help')}">Back to Support</a></p>`); },
  helpSearch(vm) { return shell(vm, 'Search support', html`<p class="crumbs"><a href="${vm.url('help')}">${L(vm, 'help', 'Support')}</a> › Search</p>${h1('Search results')}${helpSearchForm(vm, { placeholder: 'Search support' })}<section class="tile">${vm.results.length ? helpList(vm, vm.results) : html`<p>No results for “${vm.query.q || ''}”. Try different words.</p>`}</section>`); }
};

function amountBlock(vm) {
  const sel = vm.values.amountChoice || vm.draft?.amountKey || 'due';
  const due = vm.amountOptions.find(o => o.key === 'due');
  const otherVal = vm.values.amount ?? (vm.draft?.amountKey === 'other' ? (vm.draft.amountCents / 100).toFixed(2) : '');
  return html`<fieldset class="block amounts"><legend>Payment amount</legend><label class="radio amount-opt"><input type="radio" name="amountChoice" value="due"${sel === 'due' ? raw(' checked') : ''}> <span>Current balance</span> <strong class="amt">${money(due?.cents || 0)}</strong></label>${vm.amountOptions.filter(o => !['due', 'other'].includes(o.key)).map(o => html`<label class="radio amount-opt"><input type="radio" name="amountChoice" value="${o.key}"${sel === o.key ? raw(' checked') : ''}> <span>${o.label}</span> <strong class="amt">${money(o.cents)}</strong></label>`)}${vm.amountOptions.some(o => o.key === 'other') ? html`<label class="radio amount-opt"><input type="radio" name="amountChoice" value="other"${sel === 'other' ? raw(' checked') : ''}> <span>Pay another amount</span> <input class="other-amount" name="amount" inputmode="decimal" aria-label="Other amount" placeholder="$0.00" value="${otherVal}"></label>` : ''}</fieldset>`;
}
// Billers that disconnect on the next due date (dossier billing.cancelAt 'due_date'): the engine's date, shown read-only.
const nextDueAt = vm => { const inv = vm.account.invoices.at(-1); let t = inv?.dueAt ?? vm.now; while (t <= vm.now) t += 30 * 86400000; return t; };
const balanceAside = vm => html`<aside class="tile aside"><h2 class="h3">Account summary</h2><dl class="kv"><dt>Account</dt><dd>${vm.accountMasked}</dd><dt>Balance</dt><dd><strong>${money(vm.balanceCents)}</strong></dd><dt>${L(vm, 'dueDate', 'Due date')}</dt><dd>${vm.dueText}</dd></dl>${vm.authenticated && (vm.biller.capabilities.autopay?.support === 'supported' || vm.autopay.enrolled) ? html`<p class="small"><a href="${vm.url('autopay')}">${vm.autopay.enrolled ? `Manage ${L(vm, 'autopay', 'Auto Pay')}` : setUpLabel(L(vm, 'autopay', 'Auto Pay'))}</a></p>` : ''}</aside>`;

function reviewPage(vm, page) {
  const d = vm.draft;
  return shell(vm, 'Review payment', html`${h1('Review your payment')}<div class="pay-layout"><div class="pay-main"><section class="tile"><dl class="kv review"><dt>Payment amount</dt><dd>${money(d.amountCents)}</dd>${d.feeCents ? html`<dt>Processing fee</dt><dd>${money(d.feeCents)}</dd>` : ''}<dt>Total</dt><dd><strong>${money(d.totalCents)}</strong></dd><dt>Payment date</dt><dd>${payOnText(vm, d, `Today, ${vm.nowText}`)}${lateNote(vm, d)}</dd><dt>Payment method</dt><dd>${methodText(d.method)}</dd><dt>Account</dt><dd>${vm.accountMasked}</dd></dl>
${form(vm, page, html`${hidden('token', d.token)}${hidden('op', 'submit')}${checkbox(vm, { name: 'acceptTerms', label: 'I authorize this payment and agree to the Payment Terms and Conditions.' })}<p class="actions">${button('Submit Payment', { cls: 'pill' })}</p>`)}${page === 'payReview' ? form(vm, page, html`${hidden('op', 'edit')}${button('Edit payment', { cls: 'linkbtn' })}`) : ''}</section></div>${balanceAside(vm)}</div>`);
}
function receiptPage(vm) {
  const p = vm.payment;
  return shell(vm, 'Payment confirmation', html`<section class="tile receipt"><div class="check" aria-hidden="true">✓</div><h1>${p.status === 'scheduled' ? 'Your payment is scheduled' : 'Thanks for your payment!'}</h1><p class="sub">We've emailed you a confirmation.</p><dl class="kv"><dt>Confirmation number</dt><dd><strong>${p.confirmation}</strong></dd><dt>Amount</dt><dd>${money(p.amountCents)}</dd>${p.feeCents ? html`<dt>Processing fee</dt><dd>${money(p.feeCents)}</dd>` : ''}<dt>Payment method</dt><dd>${vm.paymentMethod ? methodText(vm.paymentMethod) : `****${p.methodLast4}`}</dd><dt>Payment date</dt><dd>${payDate(p)}</dd><dt>Status</dt><dd>${statusLabel(p.status)}</dd></dl><p class="actions">${vm.authenticated ? html`<a class="pill" href="${vm.url('dashboard')}">Back to Overview</a><a class="pill pill-ghost" href="${vm.url('history')}">${L(vm, 'history', 'Payment history')}</a>` : html`<a class="pill" href="${vm.url('home')}">Done</a>`}</p></section>`);
}

export function render(page, vm) { const fn = pages[page]; if (!fn) throw new Error(`telecom template cannot render ${page}`); vm = observe(vm); return finish(vm, fn(vm)); }

export const css = `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;font:16px/1.5 "Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;color:#141417;background:#f2f2f4}a{color:#1f69ff}a:hover{text-decoration:underline}
.wrap{max-width:1140px;margin:0 auto;padding:0 24px}main.wrap{padding-top:28px;padding-bottom:40px}main.narrow{max-width:560px}
.utility{background:#141417;color:#c9c9d1;font-size:12px}.utility .wrap{display:flex;justify-content:space-between;padding-top:6px;padding-bottom:6px}.utility a{color:#fff;text-decoration:none;margin-left:18px}
.masthead{background:#fff;border-bottom:1px solid #dcdce2}.masthead .wrap{display:flex;align-items:center;gap:28px;min-height:64px}.brand{display:flex;align-items:center;gap:10px;color:#141417;text-decoration:none;font-weight:800;font-size:20px;letter-spacing:-.02em}.logo{width:34px;height:34px}
.global{display:flex;gap:4px;flex:1}.global a{color:#141417;text-decoration:none;font-weight:600;padding:20px 14px;border-bottom:3px solid transparent}.global a.on,.global a:hover{border-bottom-color:var(--brand);text-decoration:none}
.acct{display:flex;align-items:center;gap:12px;font-size:14px}.avatar{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--brand);color:#fff;font-weight:700;text-decoration:none}
.subnav{background:#fff;border-bottom:1px solid #dcdce2;display:flex;flex-wrap:wrap;gap:2px;padding:0 max(24px,calc((100% - 1092px)/2));align-items:center}.subnav-title{font-weight:800;margin-right:14px;font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:#5e5e6a}.subnav a{font-size:14px;color:#3a3a44;padding:12px 12px;text-decoration:none;border-bottom:2px solid transparent}.subnav a.on{color:#141417;font-weight:700;border-bottom-color:#141417}
h1{font-size:32px;line-height:1.15;letter-spacing:-.02em;margin:0 0 8px;font-weight:800}h2{font-size:20px;margin:0 0 12px;letter-spacing:-.01em}.h3{font-size:17px}.page-head{margin-bottom:20px}.sub{color:#5e5e6a;margin:0}.eyebrow{text-transform:uppercase;letter-spacing:.1em;font-size:12px;font-weight:700;color:var(--brand);margin:0 0 6px}
.pill{display:inline-block;background:var(--brand);color:#fff;border:2px solid var(--brand);border-radius:999px;padding:10px 24px;font:inherit;font-weight:700;text-decoration:none;cursor:pointer;line-height:1.2}.pill:hover{filter:brightness(1.08);text-decoration:none}.pill-ghost{background:#fff;color:#141417;border-color:#141417}.pill-dark{background:#141417;border-color:#141417}.pill-danger{background:#c4122f;border-color:#c4122f}.pill.wide{width:100%}.linkbtn{background:none;border:0;color:#1f69ff;font:inherit;cursor:pointer;padding:0;text-decoration:underline}
.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.small{font-size:14px}.muted{color:#6b6b76}.fine{font-size:12px;color:#8b8b96}
.hero{display:grid;grid-template-columns:1.4fr 1fr;gap:24px;background:#141417;color:#fff;border-radius:16px;padding:44px;margin-bottom:24px}.hero h1{font-size:40px}.hero .lead{color:#d6d6de;font-size:18px}.hero a:not(.pill){color:#9cc0ff}.hero .pill-ghost{background:transparent;color:#fff;border-color:#fff}.hero-art{display:flex;gap:18px;align-items:center;justify-content:center}.hero-art .svc-icon{width:96px;height:96px;color:var(--brand);background:#fff;border-radius:24px;padding:20px}
.quick h2{margin-top:8px}.quick-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}.quick-item{background:#fff;border-radius:12px;padding:18px;text-decoration:none;color:#141417;border:1px solid #e2e2e8;display:flex;flex-direction:column;gap:4px}.quick-item span{color:#5e5e6a;font-size:14px}.quick-item:hover{border-color:var(--brand);text-decoration:none}
.tile{background:#fff;border-radius:12px;padding:24px;margin-bottom:20px;border:1px solid #e2e2e8}.notice-card{background:#fff4e5;border-radius:12px;padding:16px 24px;margin-bottom:20px}
.dash{display:grid;grid-template-columns:1fr 1fr;gap:20px}.greeting{margin-bottom:18px}.balance-label{margin:0;color:#5e5e6a;font-weight:600}.balance{font-size:44px;font-weight:800;letter-spacing:-.03em;margin:0;line-height:1.1}.due{margin:4px 0 14px;color:#3a3a44}
.status-list{list-style:none;padding:0;margin:18px 0 0;border-top:1px solid #ececf0}.status-list li{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #ececf0}
.svc-list{list-style:none;margin:0;padding:0}.svc-list li{display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid #ececf0}.svc-list li div{flex:1;display:flex;flex-direction:column}.svc-list span{font-size:14px;color:#5e5e6a}.svc-icon{display:inline-block;width:40px;height:40px;color:var(--brand);background:#f0f0f4;border-radius:10px;padding:8px}.svc-icon svg{width:100%;height:100%;display:block}
.plan-line{display:flex;justify-content:space-between;align-items:center;margin-top:14px}.plan-line div{display:flex;flex-direction:column}
.tag{display:inline-block;font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;background:#ececf0;color:#3a3a44}.tag.ok{background:#dff5e6;color:#0b6b2f}.tag.warn{background:#fff1d6;color:#8a5300}
.link-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.link-grid a{padding:12px 14px;border:1px solid #e2e2e8;border-radius:10px;text-decoration:none;color:#141417;font-weight:600}.link-grid a::after{content:" ›";color:var(--brand)}
.banner{padding:12px 16px;border-radius:10px;margin-bottom:16px}.banner.warn{background:#fff1d6}
.pay-layout{display:grid;grid-template-columns:1fr 300px;gap:20px;align-items:start}.pay-main form{background:#fff;border-radius:12px;padding:24px;border:1px solid #e2e2e8}.pay-main .tile form{padding:0;border:0}.aside{position:sticky;top:12px}
.block{border:0;border-bottom:1px solid #ececf0;padding:0 0 16px;margin:0 0 18px}legend{font-weight:800;font-size:18px;margin-bottom:8px;padding:0}fieldset{border:1px solid #e2e2e8;border-radius:10px;padding:12px 16px;margin:12px 0}fieldset.block,.block fieldset{border:0;padding:0;margin:0}
.radio,.check{display:flex;gap:10px;align-items:center;margin:8px 0}.amount-opt{padding:12px 14px;border:1px solid #d5d5dc;border-radius:10px}.amount-opt .amt{margin-left:auto}.other-amount{margin-left:auto;width:130px;padding:7px 10px;border:1px solid #9a9aa5;border-radius:8px;font:inherit}
.field{margin:14px 0}.field label{display:block;font-weight:700;font-size:14px;margin-bottom:6px}.field input,.field select,.field textarea{width:100%;padding:12px;border:1px solid #9a9aa5;border-radius:8px;font:inherit;background:#fff}.field input:focus,.field select:focus,textarea:focus{outline:3px solid #9cc0ff;border-color:#1f69ff}.help{color:#6b6b76;font-size:13px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}details summary{cursor:pointer;color:#1f69ff;font-weight:600;margin:10px 0}
.signin{background:#fff;border-radius:16px;padding:36px;border:1px solid #e2e2e8}.signin h1{font-size:26px}.signin-brand .logo{width:44px;height:44px;margin-bottom:10px}.who-chip{background:#f0f0f4;border-radius:999px;padding:6px 14px;display:inline-block;font-size:14px}hr{border:0;border-top:1px solid #ececf0;margin:18px 0}
.alert{padding:14px 16px;border-radius:10px;margin-bottom:18px;font-weight:600}.alert-error{background:#fde7ea;color:#9b0d22;border-left:5px solid #c4122f}.alert-ok{background:#dff5e6;color:#0b5c28;border-left:5px solid #12893c}
.table{width:100%;border-collapse:collapse}.table th,.table td{text-align:left;padding:12px 10px;border-bottom:1px solid #ececf0;vertical-align:middle}.table th{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#5e5e6a}.table form{display:inline}.charges td:last-child,.charges th:last-child{text-align:right}.empty{color:#6b6b76}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:8px 20px;margin:0 0 16px}.kv dt{color:#5e5e6a}.kv dd{margin:0}.bill-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px}
.status-head{display:flex;gap:14px;align-items:flex-start;margin-bottom:12px}.status-head p{margin:0 0 4px}.inline-form{margin-top:12px;padding-top:12px;border-top:1px solid #ececf0}
.wallet{list-style:none;margin:0;padding:0}.wallet li{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #ececf0}.wallet form{display:inline}
.progress{display:flex;list-style:none;padding:0;margin:0 0 18px;gap:8px;counter-reset:s}.progress li{flex:1;padding:8px 0;border-top:4px solid #dcdce2;font-size:13px;font-weight:700;color:#6b6b76;counter-increment:s}.progress li::before{content:counter(s) ". "}.progress li.on{border-color:var(--brand);color:#141417}.progress li.done{border-color:#141417}
.offer{border:2px solid var(--brand)}.offer-badge{display:inline-block;background:var(--brand);color:#fff;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;padding:4px 10px;border-radius:999px;margin:0 0 10px}.note{background:#f4f4f7;border-radius:10px;padding:12px 14px;margin:12px 0;font-size:14px}
.plans{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;border:0;padding:0}.plan-card{position:relative;display:flex;flex-direction:column;gap:6px;background:#fff;border:2px solid #dcdce2;border-radius:14px;padding:22px;cursor:pointer}.plan-card.current{border-color:var(--brand)}.plan-card input{align-self:flex-start;width:18px;height:18px}.plan-name{font-weight:800;font-size:19px}.plan-price{font-size:28px;font-weight:800}.plan-price small{font-size:14px;color:#5e5e6a}.plan-blurb{color:#5e5e6a;font-size:14px}.plan-card .tag{align-self:flex-start}.hero .eyebrow{color:#9cc0ff}body.tc{min-height:100vh;display:flex;flex-direction:column}body.tc main{flex:1;width:100%}
.receipt{text-align:left}.receipt .check{width:48px;height:48px;border-radius:50%;background:#12893c;color:#fff;display:grid;place-items:center;font-size:26px;margin-bottom:10px}
.support-hero{background:#141417;color:#fff;border-radius:16px;padding:36px;margin-bottom:22px}.support-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.support-grid .tile{margin:0}.help-search{display:flex;gap:8px;margin:12px 0}.help-search input{flex:1;padding:12px 14px;border-radius:999px;border:1px solid #9a9aa5;font:inherit}.help-search .btn{border-radius:999px;border:0;background:var(--brand);color:#fff;padding:0 22px;font:inherit;font-weight:700;cursor:pointer}
.help-list{margin:0;padding-left:18px}.help-list li{margin:6px 0}.crumbs{font-size:14px;color:#5e5e6a}.article p{max-width:70ch}.steps li{margin:6px 0}
.foot{background:#141417;color:#c9c9d1;padding:28px 0 18px;margin-top:20px}.foot .wrap{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}.foot a{color:#fff}.foot-links{display:flex;gap:18px}.foot .fine{display:block;margin-top:14px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media(max-width:860px){.help-search input{min-width:0}.help-search .btn{flex:none;padding:0 16px}.hero h1{font-size:30px;overflow-wrap:anywhere}.hero{padding:24px}.hero,.dash,.pay-layout,.plans,.support-grid,.quick-grid,.link-grid,.two{grid-template-columns:1fr}.aside{position:static}.masthead .wrap{flex-wrap:wrap;gap:4px 16px;min-height:0;padding-top:10px;padding-left:16px;padding-right:16px}.brand{font-size:18px;min-width:0}.acct,.masthead .pill{margin-left:auto}.global{order:3;flex:1 0 100%;overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch}.global a{padding:10px 12px 12px;white-space:nowrap}.global a:first-child{padding-left:0}.subnav{flex-wrap:nowrap;overflow-x:auto;padding:0 16px;-webkit-overflow-scrolling:touch}.subnav a,.subnav-title{white-space:nowrap}.table{display:block;overflow-x:auto;max-width:100%}.hero>*,.dash>*,.pay-layout>*,.two>*{min-width:0}dd{overflow-wrap:anywhere}}` + OBS_CSS;
