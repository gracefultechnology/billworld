// Newspaper subscriber services (Gannett / USA TODAY Network, Lee Enterprises, Tribune style).
// Distinctives: masthead + "Subscriber Services" home of task tiles, "Manage Account" left sidebar,
// "Pay bill" as a 3-step wizard (amount → payment information → review), "EZ Pay" automatic payments,
// "Pause delivery" / "Report a delivery issue" service requests, subscription (print/digital) changes,
// and "Cancel subscription" with a save offer.
import { observe, finish, obsNav, obsFooter, heroText, heroLine, idLabel, submitLabel, social, helpExcerpts, articleExcerpt, mfaLead, mfaResend, OBS_CSS } from './_observed.mjs';
import { html, raw, doc, logo, alert, form, field, select, checkbox, button, hidden, methodChooser, newMethodFields, dateField, table, paymentRows, helpList, helpBody, helpSearchForm, money, fmtDate, methodText, statusLabel } from '../kit.mjs';

export const meta = {
  id: 'newspaper',
  name: 'Newspaper subscriber services (Gannett/Lee-style)',
  description: 'Subscriber Services for print + digital newspaper subscriptions: Pay bill wizard, EZ Pay, payment information, account history, pause delivery / delivery issues, subscription changes and cancel with a save offer.',
  families: ['gannett', 'usa-today-network', 'lee-enterprises', 'tribune', 'newspaper'],
  sources: [
    'https://www.rocketmoney.com/learn/personal-finance/gannett-newspaper-cancel-subscription',
    'Web search summary of Gannett account management help ("Pause delivery" and "Sign up for auto pay (EZ Pay)" in the left-hand sidebar)',
    'categories/*.json research notes for newspaper billers (help.<paper>.com/subscription-services lists, account.<paper>.com/payment-information/, myaccount.<paper>.com EZ Pay / temporarystop pages)'
  ],
  evidence: {
    observed_public: [
      'Gannett account management (search summary): left-hand sidebar with "Pause delivery" (select dates, "Schedule") and "Sign up for auto pay (EZ Pay)"; manage subscription, report delivery issues, pay subscription bill, update account information',
      'Gannett: while delivery is paused the subscription fee continues and the account is credited; digital access and e-Edition continue',
      'USA TODAY customer service handles cancellation by phone or chat in many states; some states require online cancellation via Account Management'
    ],
    documented: [
      'Catalog notes (USA TODAY Network papers): help center lists "Pay bill", "Manage payment information", "Sign up for auto pay (EZ Pay)", "View account history (billing and delivery history)", pause/vacation stop, report delivery issue; payment information at account.<paper>.com/payment-information/',
      'Catalog notes (Lee Enterprises papers): manage your account, renew your subscription, pay your bill, suspend delivery (vacation hold), report missing paper, view account status; prepaid terms with renewal notices / EZ-pay; premium-day editions can shorten the term',
      'Catalog notes (Tribune/MediaNews papers): Subscriber Services menu "Manage Subscription", "EZ Pay", "Vacation Stop", "Delivery Issue"; EZ Pay signup/manage pages on myaccount.<paper>.com'
    ],
    synthetic: [
      'Exact page layouts, colours and the serif masthead are original approximations; the monogram replaces the paper nameplate',
      'Pause delivery and delivery issues are submitted as service requests through the shared secure-message engine (no dated hold state in the engine)',
      'Plan names (Digital Only / Sunday + Digital / 7-Day Print + Digital) map onto the engine\'s three subscription tiers',
      'Retention offer (50% off 3 months) comes from the shared engine'
    ]
  }
};

export const routes = {
  home: '/', login: '/login', loginPassword: '/login/password', mfa: '/login/verify', register: '/activate', verify: '/activate/verify', forgot: '/forgot-password', reset: '/reset-password',
  guest: '/pay-my-bill', guestPay: '/pay-my-bill/payment', guestReview: '/pay-my-bill/review', guestReceipt: '/pay-my-bill/confirmation/:id',
  dashboard: '/manage-account', bill: '/manage-account/billing', statements: '/manage-account/billing/statements', statement: '/manage-account/billing/statements/:id.pdf',
  pay: '/manage-account/pay-bill', payMethod: '/manage-account/pay-bill/payment', payReview: '/manage-account/pay-bill/review', payReceipt: '/manage-account/pay-bill/confirmation/:id',
  history: '/manage-account/account-history', autopay: '/manage-account/ez-pay', paperless: '/manage-account/billing-preferences', wallet: '/manage-account/payment-information',
  cancel: '/manage-account/cancel-subscription', plan: '/manage-account/subscription', arrangement: '/manage-account/billing/payment-plan', contact: '/manage-account/delivery', profile: '/manage-account/account-information', logout: '/logout',
  help: '/subscription-services', helpArticle: '/subscription-services/article/:slug', helpSearch: '/subscription-services/search'
};
export const flow = { paySteps: ['pay', 'payMethod', 'payReview'], loginSteps: 1, guestSteps: ['guest', 'guestPay', 'guestReview'] };

const offline = vm => vm.biller.capabilities.online_account.support === 'unsupported';
const guestOk = vm => vm.biller.capabilities.guest_pay.support === 'supported';
const cancelOk = vm => vm.biller.capabilities.cancel_service.support === 'supported';
// "The Ames Tribune (Ames, IA) - newspaper subscription" → "The Ames Tribune"
const paper = vm => vm.biller.name.replace(/\s*-\s*newspaper subscription.*$/i, '').replace(/\s*\([^)]*\)\s*$/, '').trim() || vm.biller.brand.shortName;
const PLAN_NAMES = { basic: 'Digital Only', standard: 'Sunday + Digital', premium: '7-Day Print + Digital' };
const PLAN_DESC = { basic: 'Unlimited access to our website, app and the e-Edition.', standard: 'Sunday print delivery plus full digital access.', premium: 'Print delivered every day plus full digital access and the e-Edition.' };
const planName = p => PLAN_NAMES[p.id] || p.name;
const currentPlan = vm => vm.plans?.find(p => p.current);

// ---------- chrome ----------
function masthead(vm) {
  return html`<div class="ribbon"><div class="wrap"><span>Subscriber Services</span><span class="ribbon-links"><a href="${vm.url('help')}">Help center</a>${offline(vm) ? '' : vm.authenticated ? html`<a href="${vm.url('dashboard')}">Manage Account</a><a href="${vm.url('logout')}">Log out</a>` : html`<a href="${vm.url('login')}">Log in</a>`}</span></div></div>
<header class="mast"><div class="wrap"><a class="nameplate" href="${vm.url('home')}">${logo(vm)}<span>${paper(vm)}</span></a><p class="dateline">${vm.nowText}${vm.biller.serviceArea ? ` · ${vm.biller.serviceArea}` : ''}</p></div></header>`;
}
const SIDE = [
  ['dashboard', 'Account overview'], ['pay', 'Pay bill'], ['bill', 'Current bill'], ['statements', 'Billing statements'], ['history', 'View account history'],
  ['autopay', 'Sign up for auto pay (EZ Pay)'], ['wallet', 'Manage payment information'], ['paperless', 'Billing preferences'],
  ['plan', 'Manage subscription'], ['contact', 'Pause delivery / Delivery issues'], ['arrangement', 'Payment plan'], ['profile', 'Account information']
];
const GROUP = { payMethod: 'pay', payReview: 'pay', payReceipt: 'pay', cancel: 'plan' };
function sidebar(vm) {
  const active = GROUP[vm.page] || vm.page;
  return html`<nav class="side" aria-label="Manage Account"><p class="side-h">Manage Account</p><ul>${SIDE.map(([p, t]) => html`<li><a href="${vm.url(p)}"${p === active ? raw(' class="on" aria-current="page"') : ''}>${p === 'autopay' && vm.autopay?.enrolled ? 'Manage EZ Pay' : t}</a></li>`)}${cancelOk(vm) ? html`<li><a href="${vm.url('cancel')}"${vm.page === 'cancel' ? raw(' class="on" aria-current="page"') : ''}>Cancel subscription</a></li>` : ''}</ul><p class="side-help"><a href="${vm.url('help')}">Subscriber help center</a></p></nav>`;
}
function footer(vm) {
  return html`<footer class="foot"><div class="wrap"><div><p class="foot-name">${paper(vm)}</p><p>${vm.biller.phone ? html`Customer service: <a href="${vm.url('helpArticle', { slug: 'contact-us' })}">${vm.biller.phone}</a>` : 'Customer service: see the phone number on your renewal notice.'}</p></div><ul><li><a href="${vm.url('help')}">Subscription services</a></li><li><a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact us</a></li><li><a href="${vm.url('helpArticle', { slug: 'pay-your-bill' })}">Ways to pay</a></li></ul></div>${!vm.authenticated ? html`<div class="wrap">${obsFooter(vm)}</div>` : ''}<p class="wrap fine">Demonstration subscriber portal for ${vm.biller.name}. Not affiliated with ${paper(vm)} or its publisher.</p></footer>`;
}
function shell(vm, title, body, { side = vm.authenticated && !['help', 'helpArticle', 'helpSearch'].includes(vm.page), narrow = false } = {}) {
  return doc(vm, { title: `${title} | ${paper(vm)} Subscriber Services`, bodyClass: 'np', body: html`${masthead(vm)}${obsNav(vm)}<div class="wrap body${side ? ' with-side' : ''}">${side ? sidebar(vm) : ''}<main class="${narrow ? 'narrow' : ''}">${alert(vm)}${body}</main></div>${footer(vm)}` });
}
const h1 = (t, kicker) => html`${kicker ? html`<p class="kicker">${kicker}</p>` : ''}<h1>${t}</h1>`;
const steps = (n) => html`<ol class="wizard">${['Amount', 'Payment information', 'Review'].map((s, i) => html`<li class="${i + 1 === n ? 'on' : i + 1 < n ? 'done' : ''}"><span>${i + 1}</span>${s}</li>`)}</ol>`;

// ---------- pages ----------
const pages = {
  home(vm) {
    if (offline(vm)) {
      const art = vm.help.find(a => a.slug === 'pay-your-bill');
      return shell(vm, 'Subscriber Services', html`${h1('Paying for your subscription', 'Subscriber Services')}<p class="lead">Online account access and online bill payment are not available for this subscription.</p><section class="box">${art ? html`<h2>How to pay</h2>${helpBody(art)}` : ''}${vm.biller.phone ? html`<p>Questions? Call <strong>${vm.biller.phone}</strong>.</p>` : html`<p>Use the contact information on your renewal notice.</p>`}</section>`);
    }
    const tile = (href, title, text) => html`<a class="tile" href="${href}"><strong>${title}</strong><span>${text}</span></a>`;
    return shell(vm, 'Subscriber Services', html`<section class="welcome">${h1('Subscriber Services', 'Manage your subscription')}${heroLine(vm)}<p class="lead">Pay your bill, set up EZ Pay, pause delivery while you're away and manage your print and digital subscription.</p><p class="actions"><a class="btn btn-primary" href="${vm.url('login')}">Log in to Manage Account</a>${guestOk(vm) ? html`<a class="btn" href="${vm.url('guest')}">Pay bill without logging in</a>` : ''}</p><p class="small">Print subscriber without an online account? <a href="${vm.url('register')}">Activate your account</a></p></section>
<section><h2 class="section-rule">What would you like to do?</h2><div class="tiles">${tile(vm.url('pay'), 'Pay bill', 'Make a one-time payment on your subscription')}${tile(vm.url('autopay'), 'Sign up for EZ Pay', 'Automatic payments so your delivery never stops')}${tile(vm.url('contact'), 'Pause delivery', 'Vacation hold for print delivery')}${tile(vm.url('contact'), 'Report a delivery issue', 'Missed, late or damaged paper')}${tile(vm.url('wallet'), 'Manage payment information', 'Update your card or bank account')}${tile(vm.url('history'), 'View account history', 'Billing and delivery history')}</div></section>
<section class="box"><h2>Subscriber help</h2>${helpSearchForm(vm, { placeholder: 'Search subscriber help' })}${helpList(vm, vm.help.slice(0, 6))}<p><a href="${vm.url('help')}">All subscription services topics</a></p></section>`);
  },
  login(vm) {
    return shell(vm, 'Log in', html`<section class="box auth">${h1('Log in', paper(vm))}<p>Use the email address and password for your ${paper(vm)} account.</p>${form(vm, 'login', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'username', label: idLabel(vm, 'Email address'), autocomplete: 'username' })}${field(vm, { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' })}${button(submitLabel(vm, 'Log in'), { cls: 'btn btn-primary btn-block' })}`)}${social(vm)}<p class="small"><a href="${vm.url('forgot')}">Forgot password?</a></p><hr><p class="small">Have a print subscription but no online account? <a href="${vm.url('register')}">Activate your account</a></p></section>`, { narrow: true });
  },
  loginPassword(vm) { return pages.login(vm); },
  mfa(vm) { return shell(vm, 'Verify', html`<section class="box auth">${h1('Confirm it\'s you')}<p>${mfaLead(vm, `Enter the 6-digit code we emailed to you.`)}</p>${form(vm, 'mfa', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'code', label: 'Verification code', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' })}${button('Verify', { cls: 'btn btn-primary btn-block' })}`)}${mfaResend(vm)}</section>`, { narrow: true }); },
  register(vm) {
    return shell(vm, 'Activate your account', html`<section class="box auth">${h1('Activate your account', 'Print subscribers')}<p>Your account number is printed on your bill or renewal notice. Activating gives you online account management and full digital access.</p>${form(vm, 'register', html`${field(vm, { name: 'accountNumber', label: 'Subscriber account number', inputmode: 'numeric' })}${field(vm, { name: 'zip', label: 'Delivery ZIP code', inputmode: 'numeric', maxlength: 5 })}${field(vm, { name: 'email', label: 'Email address', type: 'email', autocomplete: 'email' })}${field(vm, { name: 'password', label: 'Create password', type: 'password', autocomplete: 'new-password', help: 'At least 8 characters with upper and lower case letters, a number and a symbol.' })}${field(vm, { name: 'confirm', label: 'Confirm password', type: 'password', autocomplete: 'new-password' })}${button('Activate', { cls: 'btn btn-primary btn-block' })}`)}<p class="small">Already activated? <a href="${vm.url('login')}">Log in</a></p></section>`, { narrow: true });
  },
  verify(vm) { return shell(vm, 'Verify email', html`<section class="box auth">${h1('Check your email')}<p>Open the link we sent to finish activating your account.</p><p><a href="${vm.url('login')}">Log in</a></p></section>`, { narrow: true }); },
  forgot(vm) { return shell(vm, 'Forgot password', html`<section class="box auth">${h1('Forgot password?')}<p>Enter your email address or subscriber account number. We'll email you a code to reset your password.</p>${form(vm, 'forgot', html`${field(vm, { name: 'identifier', label: 'Email address or account number', autocomplete: 'username' })}${button('Email me a code', { cls: 'btn btn-primary btn-block' })}`)}<p class="small"><a href="${vm.url('login')}">Return to log in</a></p></section>`, { narrow: true }); },
  reset(vm) { return shell(vm, 'Reset password', html`<section class="box auth">${h1('Reset password')}${form(vm, 'reset', html`${vm.query.token ? hidden('token', vm.query.token) : field(vm, { name: 'code', label: 'Code from your email', inputmode: 'numeric', autocomplete: 'one-time-code' })}${field(vm, { name: 'password', label: 'New password', type: 'password', autocomplete: 'new-password' })}${field(vm, { name: 'confirm', label: 'Confirm new password', type: 'password', autocomplete: 'new-password' })}${button('Reset password', { cls: 'btn btn-primary btn-block' })}`)}</section>`, { narrow: true }); },
  guest(vm) { return shell(vm, 'Pay my bill', html`<section class="box auth">${h1('Pay my bill', 'No login required')}${form(vm, 'guest', html`${field(vm, { name: 'accountNumber', label: 'Subscriber account number', inputmode: 'numeric' })}${field(vm, { name: 'zip', label: 'Delivery ZIP code', inputmode: 'numeric', maxlength: 5 })}${button('Find my account', { cls: 'btn btn-primary btn-block' })}`)}</section>`, { narrow: true }); },
  guestPay(vm) { return shell(vm, 'Pay my bill', html`${h1('Pay my bill')}<p>Account ${vm.accountMasked} · Balance due <strong>${money(vm.balanceCents)}</strong></p><section class="box">${form(vm, 'guestPay', html`${amountBlock(vm)}<fieldset><legend>Payment information</legend>${newMethodFields(vm)}</fieldset>${button('Review payment', { cls: 'btn btn-primary' })}`)}</section>`); },
  guestReview(vm) { return reviewPage(vm, 'guestReview'); },
  guestReceipt(vm) { return receiptPage(vm); },

  dashboard(vm) {
    const plan = currentPlan(vm); const svc = vm.service; const ap = vm.autopay;
    return shell(vm, 'Account overview', html`${h1(`Welcome, ${vm.persona.first}`, 'Account overview')}
${svc.status === 'cancel_pending' ? html`<div class="note warn">Your subscription is scheduled to end on <strong>${fmtDate(svc.cancelAt)}</strong>. <a href="${vm.url('cancel')}">Keep my subscription</a></div>` : ''}
<div class="cols"><section class="box"><h2>My subscription</h2><dl class="kv"><dt>Subscription</dt><dd><strong>${plan ? planName(plan) : 'Subscription'}</strong></dd><dt>Account number</dt><dd>${vm.accountMasked}</dd><dt>Delivery address</dt><dd>${vm.account.serviceAddress}</dd><dt>Status</dt><dd>${svc.status === 'active' ? 'Active' : svc.status === 'cancel_pending' ? `Ends ${fmtDate(svc.cancelAt)}` : 'Stopped'}</dd></dl><p><a href="${vm.url('plan')}">Manage subscription</a></p></section>
<section class="box billing-box"><h2>Billing</h2><p class="label">Balance due</p><p class="amount">${money(vm.balanceCents)}</p><p>Due by ${vm.dueText}</p>${vm.pendingPayments.length ? html`<p class="small muted">${vm.pendingPayments.length} payment(s) processing</p>` : ''}<p class="actions"><a class="btn btn-primary" href="${vm.url('pay')}">Pay bill</a><a class="btn" href="${vm.url('bill')}">View current bill</a></p></section></div>
<div class="cols"><section class="box"><h2>EZ Pay</h2>${ap.enrolled ? html`<p>You're enrolled in EZ Pay. Your subscription renews automatically using ${vm.autopayMethod ? methodText(vm.autopayMethod) : 'your saved payment method'}.</p><p><a href="${vm.url('autopay')}">Manage EZ Pay</a></p>` : html`<p>Never miss a renewal. EZ Pay charges your card or bank account automatically when your subscription renews.</p><p><a class="btn" href="${vm.url('autopay')}">Sign up for auto pay (EZ Pay)</a></p>`}</section>
<section class="box"><h2>Delivery</h2><p>Going away? Pause print delivery and keep your digital access.</p><ul class="plain"><li><a href="${vm.url('contact')}">Pause delivery (vacation hold)</a></li><li><a href="${vm.url('contact')}">Report a delivery issue</a></li><li><a href="${vm.url('history')}">Billing and delivery history</a></li></ul></section></div>
<section class="box"><h2>More account options</h2><ul class="plain cols3"><li><a href="${vm.url('statements')}">Billing statements</a></li><li><a href="${vm.url('wallet')}">Manage payment information</a></li><li><a href="${vm.url('paperless')}">Billing preferences (${vm.account.paperless ? 'paperless' : 'mailed notices'})</a></li><li><a href="${vm.url('arrangement')}">Payment plan</a></li><li><a href="${vm.url('profile')}">Account information</a></li>${cancelOk(vm) ? html`<li><a href="${vm.url('cancel')}">Cancel subscription</a></li>` : ''}</ul></section>`);
  },
  bill(vm) {
    const inv = vm.invoice; const plan = currentPlan(vm);
    return shell(vm, 'Current bill', html`${h1('Current bill', 'Billing')}<section class="box"><div class="bill-top"><div><p class="label">Amount due</p><p class="amount">${money(Math.max(0, vm.balanceCents))}</p><p>Due by ${fmtDate(inv.dueAt)} · Statement ${inv.number}</p><p class="small muted">Subscription term ${inv.period}</p></div><div class="actions col"><a class="btn btn-primary" href="${vm.url('pay')}">Pay bill</a><a class="btn" href="${vm.url('statement', { id: inv.id })}">Download statement (PDF)</a></div></div>
${table(['Description', 'Amount'], [...inv.lines.map(l => [plan && l.desc === 'Membership' ? `${planName(plan)} subscription` : l.desc, money(l.cents)]), [html`<strong>Statement total</strong>`, html`<strong>${money(inv.amountCents)}</strong>`]])}<p class="small muted">Premium-day editions published during your term may shorten your subscription term. See your terms of service.</p></section><p><a href="${vm.url('statements')}">See past billing statements</a> · <a href="${vm.url('history')}">View account history</a></p>`);
  },
  statements(vm) { return shell(vm, 'Billing statements', html`${h1('Billing statements', 'Billing')}<section class="box">${table(['Statement date', 'Amount', 'Due by', ''], vm.invoices.map(i => [fmtDate(i.issuedAt), money(i.amountCents), fmtDate(i.dueAt), html`<a href="${vm.url('statement', { id: i.id })}">View statement (PDF)</a>`]))}</section>`); },
  pay(vm) {
    return shell(vm, 'Pay bill', html`${h1('Pay bill', 'Billing')}${steps(1)}<section class="box"><p>Balance due <strong>${money(vm.balanceCents)}</strong> by ${vm.dueText}.</p>${form(vm, 'pay', html`${amountBlock(vm)}${dateField(vm, { label: 'Payment date' })}<p class="actions">${button('Next: Payment information', { cls: 'btn btn-primary' })}<a class="btn btn-quiet" href="${vm.url('dashboard')}">Cancel</a></p>`)}</section>`);
  },
  payMethod(vm) {
    const d = vm.draft;
    return shell(vm, 'Pay bill', html`${h1('Pay bill', 'Billing')}${steps(2)}<section class="box">${d?.amountCents ? html`<p>Amount: <strong>${money(d.amountCents)}</strong>${d.payOn ? ` on ${d.payOn}` : ''} · <a href="${vm.url('pay')}">Change amount</a></p>` : ''}${form(vm, 'payMethod', html`${methodChooser(vm, { title: 'Payment information' })}<p class="actions">${button('Next: Review', { cls: 'btn btn-primary' })}<a class="btn btn-quiet" href="${vm.url('pay')}">Back</a></p>`)}</section>`);
  },
  payReview(vm) { return reviewPage(vm, 'payReview'); },
  payReceipt(vm) { return receiptPage(vm); },
  history(vm) {
    return shell(vm, 'Account history', html`${h1('Account history', 'Billing and delivery history')}<section class="box"><h2>Payments</h2>${table(['Date', 'Amount', 'Payment method', 'Confirmation', 'Status', ''], paymentRows(vm))}</section><section class="box"><h2>Billing</h2>${table(['Statement date', 'Charges', 'Due by', 'Status'], vm.invoices.slice(0, 6).map(i => [fmtDate(i.issuedAt), money(i.amountCents), fmtDate(i.dueAt), i.balanceCents > 0 ? 'Open' : 'Paid']))}</section>${vm.account.messages.length ? html`<section class="box"><h2>Delivery & service requests</h2>${table(['Date', 'Request', 'Status'], vm.account.messages.map(m => [fmtDate(m.at), m.subject, m.status]))}</section>` : ''}`);
  },
  autopay(vm) {
    const ap = vm.autopay;
    const enroll = form(vm, 'autopay', html`${hidden('action', 'enroll')}${methodChooser(vm, { title: 'Charge my renewals to' })}<div class="terms"><p>By enrolling in EZ Pay, you authorize ${paper(vm)} to charge your payment method at each renewal at the then-current rate until you cancel. We'll notify you of rate changes.</p></div>${checkbox(vm, { name: 'acceptTerms', label: 'I agree to the EZ Pay terms and authorize automatic renewal payments.' })}${button(ap.enrolled ? 'Update EZ Pay' : 'Sign up for EZ Pay', { cls: 'btn btn-primary' })}`);
    return shell(vm, 'EZ Pay', html`${h1(ap.enrolled ? 'Manage EZ Pay' : 'Sign up for auto pay (EZ Pay)', 'Billing')}${ap.enrolled ? html`<section class="box"><p class="status on">EZ Pay: Enrolled</p><p>Your subscription renews automatically with ${vm.autopayMethod ? methodText(vm.autopayMethod) : 'your saved payment method'}.</p><h2>Stop EZ Pay</h2><p>If you stop EZ Pay we'll mail or email renewal notices instead.</p>${form(vm, 'autopay', html`${hidden('action', 'cancel')}${checkbox(vm, { name: 'confirm', label: 'Stop EZ Pay. I will pay renewal notices myself.' })}${button('Stop EZ Pay', { cls: 'btn btn-danger' })}`)}</section><section class="box"><h2>Change EZ Pay payment information</h2>${enroll}</section>`
      : html`<section class="box"><p class="status">EZ Pay: Not enrolled</p><p>EZ Pay subscribers get uninterrupted delivery and never have to mail a check.</p>${enroll}</section>`}`);
  },
  paperless(vm) {
    const on = vm.account.paperless;
    return shell(vm, 'Billing preferences', html`${h1('Billing preferences', 'Billing')}<section class="box"><p class="status ${on ? 'on' : ''}">Paperless billing: ${on ? 'On' : 'Off'}</p><p>${on ? `Bills and renewal notices are emailed to ${vm.persona.email}.` : 'Renewal notices and bills are mailed to your delivery address. Switch to email to get them sooner.'}</p>${form(vm, 'paperless', html`${hidden('paperless', on ? 'off' : 'on')}${!on ? field(vm, { name: 'email', label: 'Email my bills to', type: 'email', value: vm.persona.email }) : ''}${button(on ? 'Mail my bills instead' : 'Email my bills (go paperless)', { cls: 'btn btn-primary' })}`)}</section>`);
  },
  wallet(vm) {
    return shell(vm, 'Payment information', html`${h1('Manage payment information', 'Billing')}<section class="box"><h2>Payment methods on file</h2><ul class="wallet">${vm.methods.length ? vm.methods.map(m => html`<li><span>${methodText(m)}${m.nickname ? html` <em class="muted">(${m.nickname})</em>` : ''}${vm.autopay.enrolled && vm.autopay.methodId === m.id ? html` <span class="badge">EZ Pay</span>` : ''}</span>${form(vm, 'wallet', html`${hidden('op', 'remove')}${hidden('methodId', m.id)}${button('Remove', { cls: 'btn-link' })}`)}</li>`) : html`<li>No payment methods on file.</li>`}</ul></section><section class="box"><h2>Add a payment method</h2>${form(vm, 'wallet', html`${hidden('op', 'add')}${newMethodFields(vm)}${field(vm, { name: 'nickname', label: 'Nickname (optional)', required: false })}${button('Save payment information', { cls: 'btn btn-primary' })}`)}</section>`);
  },
  cancel(vm) {
    const svc = vm.service;
    if (svc.status !== 'active' && vm.step !== 'done') return shell(vm, 'Cancel subscription', html`${h1('Cancel subscription')}<section class="box"><p>${svc.status === 'cancel_pending' ? html`Your subscription is scheduled to end on <strong>${fmtDate(svc.cancelAt)}</strong>.` : 'Your subscription has been stopped.'}</p>${svc.status === 'cancel_pending' ? form(vm, 'cancel', html`${hidden('step', 'undo')}${button('Keep my subscription', { cls: 'btn btn-primary' })}`) : ''}</section>`);
    const reasons = [['cost', 'Subscription price'], ['delivery', 'Delivery problems'], ['not_using', "I don't have time to read it"], ['digital', 'I prefer digital only'], ['moving', 'Moving out of the delivery area'], ['content', 'Content / coverage'], ['other', 'Other']];
    const body = {
      reason: html`${h1('Cancel subscription')}<section class="box"><p>We're sorry to see you go. Please tell us why you'd like to cancel.</p>${form(vm, 'cancel', html`${hidden('step', 'reason')}${select(vm, { name: 'reason', label: 'Reason for cancelling', options: [['', 'Select a reason'], ...reasons] })}<div class="note">Going on vacation? You can <a href="${vm.url('contact')}">pause delivery</a> instead and keep your digital access.</div>${button('Continue', { cls: 'btn btn-primary' })}`)}</section>`,
      offer: html`${h1('Before you go…')}<section class="box offer"><p class="kicker">A special offer for you</p><h2>Keep reading for 50% off your next 3 months</h2><p>Stay with ${paper(vm)} and keep ${currentPlan(vm) ? planName(currentPlan(vm)) : 'your subscription'} at half price.</p>${form(vm, 'cancel', html`${hidden('step', 'offer')}<p class="actions">${button('Yes, keep my subscription at 50% off', { cls: 'btn btn-primary', name: 'accept', value: 'yes' })}${button('No thanks, continue to cancel', { cls: 'btn', name: 'accept', value: 'no' })}</p>`)}<p class="small">Or <a href="${vm.url('plan')}">switch to Digital Only</a>.</p></section>`,
      confirm: html`${h1('Confirm cancellation')}<section class="box"><p>Your subscription will end on <strong>${vm.dueText}</strong>, the end of your current term. Print delivery and digital access stop after that date.</p><p class="small muted">Any remaining prepaid balance is handled under your subscription terms.</p>${form(vm, 'cancel', html`${hidden('step', 'confirm')}${checkbox(vm, { name: 'confirm', label: 'Yes, cancel my subscription.' })}${button('Cancel subscription', { cls: 'btn btn-danger' })}`)}</section>`,
      done: html`${h1('Your cancellation is confirmed')}<section class="box"><dl class="kv"><dt>Last day</dt><dd><strong>${svc.cancelAt ? fmtDate(svc.cancelAt) : ''}</strong></dd><dt>Confirmation number</dt><dd><strong>${svc.confirmation || ''}</strong></dd></dl><p>We sent a confirmation to your email. Changed your mind? You can restart anytime.</p><p><a href="${vm.url('dashboard')}">Return to account overview</a></p></section>`,
      kept: html`${h1('Thank you for staying with us')}<section class="box"><p>Your 50% discount will apply to your next 3 months.</p><p><a href="${vm.url('dashboard')}">Return to account overview</a></p></section>`
    };
    return shell(vm, 'Cancel subscription', body[vm.step]);
  },
  plan(vm) {
    return shell(vm, 'Manage subscription', html`${h1('Manage subscription', 'Subscription')}${vm.plans.length ? form(vm, 'plan', html`<fieldset class="plan-list"><legend>Choose your subscription</legend>${vm.plans.map(p => html`<label class="plan-row${p.current ? ' current' : ''}"><input type="radio" name="planId" value="${p.id}"${p.current ? raw(' checked') : ''}><span class="plan-info"><strong>${planName(p)}</strong><span>${PLAN_DESC[p.id] || ''}</span></span><span class="plan-rate">${money(p.cents)}<small> per month</small>${p.current ? html`<em>Current</em>` : ''}</span></label>`)}</fieldset><p class="small muted">Rate changes take effect at your next renewal.</p>${button('Update subscription', { cls: 'btn btn-primary' })}`) : html`<p>Call customer service to change your subscription.</p>`}${cancelOk(vm) ? html`<p class="small"><a href="${vm.url('cancel')}">Cancel subscription</a></p>` : ''}`);
  },
  arrangement(vm) {
    return shell(vm, 'Payment plan', html`${h1('Payment plan', 'Billing')}<section class="box">${vm.account.arrangement ? html`<p>You're paying <strong>${money(vm.account.arrangement.monthlyCents)}</strong> per month for ${vm.account.arrangement.months} months.</p>` : form(vm, 'arrangement', html`<p>Spread your balance of <strong>${money(vm.balanceCents)}</strong> over monthly payments.</p>${select(vm, { name: 'months', label: 'Number of payments', options: [['3', '3 monthly payments'], ['6', '6 monthly payments'], ['12', '12 monthly payments']] })}${button('Set up payment plan', { cls: 'btn btn-primary' })}`)}</section>`);
  },
  contact(vm) {
    return shell(vm, 'Delivery & service', html`${h1('Pause delivery / Delivery issues', 'Delivery')}<div class="note">While print delivery is paused, your subscription continues and your account is credited for the paused days. Your digital access and e-Edition continue.</div>${vm.account.messages.length ? html`<section class="box"><h2>Your requests</h2>${table(['Date', 'Request', 'Status'], vm.account.messages.map(m => [fmtDate(m.at), m.subject, m.status]))}</section>` : ''}<section class="box">${form(vm, 'contact', html`${select(vm, { name: 'subject', label: 'Request type', options: [['Pause delivery (vacation hold)', 'Pause delivery (vacation hold)'], ['Report a delivery issue', 'Report a delivery issue (missed, late, wet or damaged paper)'], ['Billing question', 'Billing question'], ['Other', 'Other']] })}<div class="field"><label for="f-message">Details (for a vacation hold include your stop and restart dates)</label><textarea id="f-message" name="message" rows="5" required>${vm.values.message || ''}</textarea></div>${button('Submit request', { cls: 'btn btn-primary' })}`)}</section>`);
  },
  profile(vm) {
    return shell(vm, 'Account information', html`${h1('Account information')}<section class="box"><dl class="kv"><dt>Name</dt><dd>${vm.persona.name}</dd><dt>Email</dt><dd>${vm.persona.email}</dd><dt>Phone</dt><dd>${vm.account.phone || 'Not on file'}</dd><dt>Delivery address</dt><dd>${vm.account.serviceAddress}</dd></dl>${form(vm, 'profile', html`${field(vm, { name: 'phone', label: 'Phone number', type: 'tel', autocomplete: 'tel' })}${button('Save', { cls: 'btn btn-primary' })}`)}</section>`);
  },
  help(vm) {
    return shell(vm, 'Subscription services', html`${h1('Subscription services', 'Help center')}${helpSearchForm(vm, { placeholder: 'Search subscriber help' })}<div class="cols"><section class="box"><h2>Billing &amp; payments</h2>${helpList(vm, vm.help.filter(a => ['payments', 'billing', 'autopay', 'assistance'].includes(a.topic)))}</section><section class="box"><h2>Your account</h2>${helpList(vm, vm.help.filter(a => !['payments', 'billing', 'autopay', 'assistance'].includes(a.topic)))}</section></div>${helpExcerpts(vm)}${!offline(vm) ? html`<p>${vm.authenticated ? html`<a href="${vm.url('dashboard')}">Go to Manage Account</a>` : html`<a href="${vm.url('login')}">Log in to Manage Account</a>`}</p>` : ''}`);
  },
  helpArticle(vm) { return shell(vm, vm.article.title, html`<p class="crumbs"><a href="${vm.url('help')}">Subscription services</a> › ${vm.article.title}</p><article class="box article">${h1(vm.article.title)}${helpBody(vm.article)}</article>${articleExcerpt(vm)}`); },
  helpSearch(vm) { return shell(vm, 'Search', html`<p class="crumbs"><a href="${vm.url('help')}">Subscription services</a> › Search</p>${h1('Search results')}${helpSearchForm(vm, { placeholder: 'Search subscriber help' })}<section class="box">${vm.results.length ? helpList(vm, vm.results) : html`<p>No results for “${vm.query.q || ''}”.</p>`}</section>`); }
};

function amountBlock(vm) {
  const sel = vm.values.amountChoice || vm.draft?.amountKey || 'due';
  const otherVal = vm.values.amount ?? (vm.draft?.amountKey === 'other' ? (vm.draft.amountCents / 100).toFixed(2) : '');
  return html`<fieldset class="amounts"><legend>Payment amount</legend>${vm.amountOptions.map(o => html`<label class="radio"><input type="radio" name="amountChoice" value="${o.key}"${sel === o.key ? raw(' checked') : ''}> <span>${o.key === 'due' ? 'Balance due' : o.key === 'other' ? 'Other amount' : o.label}</span>${o.cents != null ? html` <strong>${money(o.cents)}</strong>` : html` <input class="other-amount" name="amount" inputmode="decimal" aria-label="Other amount" placeholder="0.00" value="${otherVal}">`}</label>`)}</fieldset>`;
}
function reviewPage(vm, page) {
  const d = vm.draft;
  return shell(vm, 'Review payment', html`${h1(page === 'payReview' ? 'Pay bill' : 'Pay my bill', 'Billing')}${page === 'payReview' ? steps(3) : ''}<section class="box"><h2>Review your payment</h2><dl class="kv"><dt>Account</dt><dd>${vm.accountMasked}</dd><dt>Payment amount</dt><dd>${money(d.amountCents)}</dd>${d.feeCents ? html`<dt>Service fee</dt><dd>${money(d.feeCents)}</dd>` : ''}<dt>Total</dt><dd><strong>${money(d.totalCents)}</strong></dd><dt>Payment information</dt><dd>${methodText(d.method)}</dd><dt>Payment date</dt><dd>${d.payOn || 'Today'}</dd></dl>${form(vm, page, html`${hidden('token', d.token)}${hidden('op', 'submit')}${checkbox(vm, { name: 'acceptTerms', label: 'I authorize this payment and agree to the subscriber terms of service.' })}${button('Submit payment', { cls: 'btn btn-primary' })}`)}${page === 'payReview' ? form(vm, page, html`${hidden('op', 'edit')}${button('Edit payment', { cls: 'btn-link' })}`) : ''}</section>`);
}
function receiptPage(vm) {
  const p = vm.payment;
  return shell(vm, 'Payment confirmation', html`${h1(p.status === 'scheduled' ? 'Your payment is scheduled' : 'Thank you for your payment', 'Payment confirmation')}<section class="box receipt"><dl class="kv"><dt>Confirmation number</dt><dd><strong>${p.confirmation}</strong></dd><dt>Amount</dt><dd>${money(p.amountCents)}</dd>${p.feeCents ? html`<dt>Service fee</dt><dd>${money(p.feeCents)}</dd>` : ''}<dt>Payment information</dt><dd>${vm.paymentMethod ? methodText(vm.paymentMethod) : `****${p.methodLast4}`}</dd><dt>Date</dt><dd>${p.payOn || fmtDate(p.createdAt)}</dd><dt>Status</dt><dd>${statusLabel(p.status)}</dd></dl><p>A confirmation has been emailed to you.</p>${vm.authenticated ? html`<p class="actions"><a class="btn btn-primary" href="${vm.url('dashboard')}">Return to account overview</a>${!vm.autopay.enrolled ? html`<a class="btn" href="${vm.url('autopay')}">Sign up for EZ Pay</a>` : ''}</p>` : html`<p><a class="btn" href="${vm.url('home')}">Done</a></p>`}</section>`);
}

export function render(page, vm) { const fn = pages[page]; if (!fn) throw new Error(`newspaper template cannot render ${page}`); vm = observe(vm); return finish(vm, fn(vm)); }

export const css = `*{box-sizing:border-box}body.np{margin:0;min-height:100vh;display:flex;flex-direction:column;font:16px/1.55 Georgia,"Times New Roman",serif;color:#1a1a1a;background:#fff}a{color:#0a5a9c}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px;width:100%}
.ribbon{background:var(--brand);color:#fff;font:13px/1 Arial,Helvetica,sans-serif;letter-spacing:.04em}.ribbon .wrap{display:flex;justify-content:space-between;align-items:center;padding-top:9px;padding-bottom:9px}.ribbon span:first-child{text-transform:uppercase;font-weight:700}.ribbon a{color:#fff;margin-left:18px;text-decoration:none}.ribbon a:hover{text-decoration:underline}
.mast{border-bottom:4px double #1a1a1a}.mast .wrap{text-align:center;padding-top:22px;padding-bottom:12px}.nameplate{display:inline-flex;align-items:center;gap:14px;text-decoration:none;color:#111;font:700 42px/1.1 Georgia,"Times New Roman",serif;letter-spacing:-.01em}.logo{width:40px;height:40px}.dateline{margin:8px 0 0;font:12px Arial,Helvetica,sans-serif;text-transform:uppercase;letter-spacing:.12em;color:#555}
.body{flex:1;padding-top:28px;padding-bottom:40px}.body.with-side{display:grid;grid-template-columns:250px 1fr;gap:36px}main{min-width:0}main.narrow{max-width:480px;margin:0 auto}
.side{font-family:Arial,Helvetica,sans-serif;border-top:3px solid var(--brand);align-self:start}.side .side-h{font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.1em;margin:12px 0 8px;color:#333}.side ul{list-style:none;margin:0;padding:0}.side li a{display:block;padding:9px 10px;border-bottom:1px solid #e6e6e6;text-decoration:none;color:#222;font-size:14px}.side li a:hover{background:#f4f4f4}.side li a.on{font-weight:700;border-left:4px solid var(--brand);background:#f7f7f7}.side-help{font-size:13px;margin-top:14px}
h1{font-size:34px;line-height:1.15;margin:0 0 14px;font-weight:700}h2{font-size:21px;margin:0 0 10px}.kicker{font:700 12px Arial,Helvetica,sans-serif;text-transform:uppercase;letter-spacing:.14em;color:var(--brand);margin:0 0 6px}.lead{font-size:19px;color:#333}.small{font-size:14px}.muted{color:#666}
.section-rule{font:700 14px Arial,Helvetica,sans-serif;text-transform:uppercase;letter-spacing:.12em;border-top:1px solid #1a1a1a;padding-top:10px;margin-top:28px}
.btn{display:inline-block;font:700 15px Arial,Helvetica,sans-serif;padding:11px 20px;border:2px solid #1a1a1a;background:#fff;color:#1a1a1a;text-decoration:none;cursor:pointer;border-radius:3px}.btn:hover{background:#f2f2f2}.btn-primary{background:var(--brand);border-color:var(--brand);color:#fff}.btn-primary:hover{background:var(--brand);filter:brightness(1.15)}.btn-danger{background:#a4161a;border-color:#a4161a;color:#fff}.btn-quiet{border-color:transparent;text-decoration:underline}.btn-block{width:100%}.btn-link{background:none;border:0;color:#0a5a9c;text-decoration:underline;font:inherit;cursor:pointer;padding:0}
.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.actions.col{flex-direction:column;align-items:stretch}
.welcome{padding:10px 0 4px}.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.tile{display:flex;flex-direction:column;gap:6px;padding:18px;border:1px solid #d6d6d6;border-top:4px solid var(--brand);text-decoration:none;color:#1a1a1a}.tile strong{font-size:19px}.tile span{font:14px Arial,Helvetica,sans-serif;color:#555}.tile:hover{background:#fafafa}
.box{border:1px solid #d6d6d6;padding:22px;margin:0 0 20px;background:#fff}.auth{margin-top:10px}.cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}.cols .box{margin-bottom:20px}.cols3{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 16px}
.label{font:700 12px Arial,Helvetica,sans-serif;text-transform:uppercase;letter-spacing:.1em;color:#555;margin:0}.amount{font-size:40px;font-weight:700;margin:2px 0}.bill-top{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:14px}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:6px 20px;margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px}.kv dt{color:#555}.kv dd{margin:0}
ul.plain{list-style:none;padding:0;margin:0}ul.plain li{padding:5px 0}
.note{background:#f6f1e3;border-left:4px solid #b88a00;padding:12px 14px;margin:12px 0 18px;font-size:15px}.note.warn{background:#fdecea;border-color:#a4161a}
.status{font:700 14px Arial,Helvetica,sans-serif;text-transform:uppercase;letter-spacing:.08em;display:inline-block;padding:5px 10px;background:#eee;margin:0 0 10px}.status.on{background:#e3f1e6;color:#1d5e2b}.badge{font:700 11px Arial,sans-serif;background:var(--brand);color:#fff;padding:2px 6px;border-radius:2px}
.terms{background:#f7f7f7;padding:10px 14px;font-size:14px;margin:12px 0}
.wizard{display:flex;list-style:none;padding:0;margin:0 0 18px;font:14px Arial,Helvetica,sans-serif;border-bottom:1px solid #d6d6d6}.wizard li{flex:1;display:flex;align-items:center;gap:8px;padding:10px 0;color:#777}.wizard li span{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;border:2px solid #bbb;font-weight:700}.wizard li.on{color:#111;font-weight:700}.wizard li.on span{background:var(--brand);border-color:var(--brand);color:#fff}.wizard li.done span{background:#1a1a1a;border-color:#1a1a1a;color:#fff}
.field{margin:14px 0;font-family:Arial,Helvetica,sans-serif}.field label{display:block;font-weight:700;font-size:14px;margin-bottom:5px}.field input,.field select,.field textarea{width:100%;padding:10px;border:1px solid #888;border-radius:2px;font:15px Arial,Helvetica,sans-serif}.help{color:#666;font-size:13px}
fieldset{border:1px solid #d6d6d6;padding:12px 16px;margin:14px 0;font-family:Arial,Helvetica,sans-serif}legend{font-weight:700;padding:0 6px}.radio,.check{display:flex;align-items:center;gap:8px;margin:9px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px}.other-amount{width:120px;padding:6px;border:1px solid #888;font:inherit}details summary{cursor:pointer;color:#0a5a9c;margin:8px 0;font-family:Arial,sans-serif}
.plan-list{padding:0;border:0}.plan-list legend{padding:0;margin-bottom:8px}.plan-row{display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center;border:1px solid #d6d6d6;padding:16px;margin:0 0 10px;cursor:pointer}.plan-row.current{border:2px solid var(--brand)}.plan-info{display:flex;flex-direction:column;font-family:Georgia,serif}.plan-info strong{font-size:19px}.plan-info span{font:14px Arial,sans-serif;color:#555}.plan-rate{text-align:right;font-weight:700;font-size:20px;display:flex;flex-direction:column}.plan-rate small{font-weight:400;font-size:12px;color:#555}.plan-rate em{font:700 11px Arial,sans-serif;text-transform:uppercase;color:var(--brand)}
.offer{border:2px solid var(--brand);background:#fbfaf6}
.alert{padding:12px 16px;margin:0 0 16px;font-family:Arial,Helvetica,sans-serif}.alert-error{background:#fdecea;border-left:4px solid #a4161a;color:#7a1013}.alert-ok{background:#e3f1e6;border-left:4px solid #2e7d32;color:#1d5e2b}
.table{width:100%;border-collapse:collapse;font:14px Arial,Helvetica,sans-serif}.table th{text-align:left;border-bottom:2px solid #1a1a1a;padding:8px;font-size:12px;text-transform:uppercase;letter-spacing:.06em}.table td{padding:9px 8px;border-bottom:1px solid #e3e3e3}.table form{display:inline}.empty{color:#666}
.wallet{list-style:none;padding:0;margin:0;font-family:Arial,sans-serif}.wallet li{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #e3e3e3}.wallet form{display:inline}
.help-search{display:flex;gap:8px;margin:12px 0}.help-search input{flex:1;padding:10px;border:1px solid #888;font:15px Arial,sans-serif}.help-search .btn{border-radius:3px}.help-list li{margin:6px 0}.crumbs{font:13px Arial,sans-serif;color:#555}.article p{max-width:68ch}
hr{border:0;border-top:1px solid #ddd;margin:18px 0}
.foot{border-top:4px double #1a1a1a;padding:24px 0 14px;font:14px Arial,Helvetica,sans-serif;color:#444}.foot .wrap{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}.foot ul{list-style:none;margin:0;padding:0;display:flex;gap:18px}.foot-name{font:700 20px Georgia,serif;margin:0 0 6px;color:#111}.fine{font-size:12px;color:#777;display:block!important;margin-top:12px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media(max-width:860px){.body.with-side,.cols,.tiles,.cols3{grid-template-columns:1fr}.nameplate{font-size:30px}}
@media(max-width:860px){.body.with-side>*,.cols>*,.cols3>*{min-width:0}.table{display:block;overflow-x:auto;max-width:100%}dd{overflow-wrap:anywhere}}` + OBS_CSS;
