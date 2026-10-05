// Streaming / subscription / membership account (Netflix / Spotify / Hulu style).
// Distinctives: dark UI, email-first sign-in ("Continue" then password), an Account page built around the
// membership (plan, next payment, payment method) rather than "amount due", Change plan cards, Receipts,
// "Cancel membership" with a survey, a retention offer and "Finish cancellation", and Restart membership.
import { observe, finish, obsNav, obsFooter, heroText, heroLine, idLabel, submitLabel, social, helpExcerpts, articleExcerpt, mfaLead, mfaResend, OBS_CSS } from './_observed.mjs';
import { html, raw, doc, logo, alert, form, field, select, checkbox, button, hidden, methodChooser, newMethodFields, dateField, table, paymentRows, helpList, helpBody, helpSearchForm, money, fmtDate, methodText, statusLabel } from '../kit.mjs';

export const meta = {
  id: 'streaming',
  name: 'Streaming / subscription membership account (Netflix/Spotify-style)',
  description: 'Account page centred on the membership: plan, next payment, payment method, receipts, change plan, auto-renew payments and cancel membership with a retention offer.',
  families: ['streaming', 'subscription', 'membership', 'home-security', 'medical-alert', 'storage'],
  sources: [
    'https://help.netflix.com/en/node/407',
    'https://help.netflix.com/en/node/22',
    'https://accounts.spotify.com/en/login (local capture billworld/captures/spotify-login)',
    'https://support.spotify.com/us/article/cancel-premium/ (local capture billworld/captures/spotify-cancellation-help)',
    'https://support.spotify.com/us/article/change-payment-details/ (local capture billworld/captures/spotify-payment-help)'
  ],
  evidence: {
    observed_public: [
      'Spotify login (capture): email-first form "Welcome back" > Email > "Continue", then credentials; "Don\'t have an account? Sign up"',
      'Spotify support (capture): topics "Payments & billing" and "Manage your account"; cancel via "Manage your plan" > "Cancel subscription"; Premium stays until the next billing date',
      'Spotify support (capture): payment details managed under "Payment methods" with Add / Change / Remove, saved payment methods',
      'Netflix help: cancel from "Manage your membership" > "Cancel" > "Finish Cancellation"; access continues to the end of the billing period; confirmation email; check "Payment History"',
      'Netflix help: "Change Plan" page'
    ],
    documented: [
      'Catalog notes for subscriptions and memberships (e.g. NFL+ "Profile > Manage Subscription > Plan Details", Chewy Autoship) describe plan/payment management under an account/profile area'
    ],
    synthetic: [
      'Dark visual theme, left account sidebar, and plan cards are original approximations',
      'Retention offer (50% off 3 months) and reason survey come from the shared engine',
      '"Pay now" balance payment, scheduled payment date and installments are synthetic for benchmarking (real streaming services charge the card on file)',
      'Plan names per bill type (membership, storage, home security, medical alert) are invented'
    ]
  }
};

export const routes = {
  home: '/', login: '/login', loginPassword: '/login/password', mfa: '/login/code', register: '/signup', verify: '/signup/verify', forgot: '/loginhelp', reset: '/loginhelp/reset',
  guest: '/payinvoice', guestPay: '/payinvoice/payment', guestReview: '/payinvoice/review', guestReceipt: '/payinvoice/receipt/:id',
  dashboard: '/account', bill: '/account/billing', statements: '/account/receipts', statement: '/account/receipts/:id.pdf',
  pay: '/account/billing/pay', payMethod: '/account/billing/pay/method', payReview: '/account/billing/pay/confirm', payReceipt: '/account/billing/pay/success/:id',
  history: '/account/payment-history', autopay: '/account/autopay', paperless: '/account/notifications', wallet: '/account/payment-methods', cancel: '/account/cancel-membership',
  plan: '/account/membership/plan', arrangement: '/account/billing/installments', contact: '/account/contact', profile: '/account/profile', logout: '/logout',
  help: '/help', helpArticle: '/help/article/:slug', helpSearch: '/help/search'
};
export const flow = { paySteps: ['pay', 'payReview'], loginSteps: 2, guestSteps: ['guest', 'guestPay', 'guestReview'] };

const offline = vm => vm.biller.capabilities.online_account.support === 'unsupported';
const guestOk = vm => vm.biller.capabilities.guest_pay.support === 'supported';
const cancelOk = vm => vm.biller.capabilities.cancel_service.support === 'supported';
const short = vm => vm.biller.brand.shortName;
const NOUN = { streaming: 'membership', membership: 'membership', subscription: 'subscription', storage: 'rental', 'home-security': 'service plan', 'medical-alert': 'service plan' };
const noun = vm => NOUN[vm.biller.billType] || 'membership';
const Noun = vm => noun(vm)[0].toUpperCase() + noun(vm).slice(1);
const PLAN_NAMES = {
  membership: { basic: 'Individual', standard: 'Household', premium: 'Sustaining' },
  storage: { basic: 'Small unit (5×5)', standard: 'Medium unit (10×10)', premium: 'Large unit (10×20)' },
  'home-security': { basic: 'Self monitoring', standard: 'Professional monitoring', premium: 'Pro monitoring + video' },
  'medical-alert': { basic: 'In-home system', standard: 'On-the-go', premium: 'On-the-go + fall detection' }
};
// Plan bullets keyed by bill type like PLAN_NAMES; anything not listed uses the streaming/subscription default.
const PLAN_FEATURES = {
  default: {
    basic: ['Our lowest price', 'Core features', 'Cancel anytime'],
    standard: ['Everything in the lowest tier', 'More devices & members', 'Most popular'],
    premium: ['Everything we offer', 'Highest quality & priority support', 'Best value for households']
  },
  membership: {
    basic: ['Member benefits for one person', 'Member newsletter', 'Renews automatically'],
    standard: ['Benefits for everyone in your household', 'Member newsletter & events', 'Most popular'],
    premium: ['All household benefits', 'Sustaining-member recognition & extras', 'Supports the organization most']
  },
  storage: {
    basic: ['About the size of a small closet', 'Boxes, seasonal items and small furniture', 'Month-to-month rental'],
    standard: ['About half of a one-car garage', 'Contents of a one-bedroom apartment', 'Most popular size'],
    premium: ['About the size of a one-car garage', 'Contents of a three-bedroom home or a vehicle', 'Month-to-month rental']
  },
  'home-security': {
    basic: ['Alerts sent to your phone', 'Door, window and motion sensors', 'No monitoring center'],
    standard: ['24/7 monitoring center', 'Police, fire and medical dispatch', 'Most popular'],
    premium: ['24/7 professional monitoring', 'Video cameras with cloud recording', 'Mobile app control']
  },
  'medical-alert': {
    basic: ['Base station and help button for the home', '24/7 emergency response center', 'Works with a landline or cellular'],
    standard: ['Mobile help button with GPS', '24/7 emergency response, at home or away', 'Most popular'],
    premium: ['Mobile help button with GPS', 'Automatic fall detection', '24/7 emergency response center']
  }
};
const planFeatures = (vm, p) => (PLAN_FEATURES[vm.biller.billType] || PLAN_FEATURES.default)[p.id] || [];
const planName = (vm, p) => PLAN_NAMES[vm.biller.billType]?.[p.id] || p.name;
const currentPlan = vm => vm.plans?.find(p => p.current);
const cardOnFile = vm => vm.autopay?.enrolled && vm.autopayMethod ? vm.autopayMethod : vm.methods?.find(m => !m.expired);
const memberSince = vm => vm.invoices?.length ? new Date(vm.invoices[vm.invoices.length - 1].issuedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/New_York' }) : '';

// ---------- chrome ----------
function header(vm) {
  return html`<header class="top"><a class="brand" href="${vm.url(vm.authenticated ? 'dashboard' : 'home')}">${logo(vm)}<span>${short(vm)}</span></a><div class="top-right">${offline(vm) ? html`<a href="${vm.url('help')}">Help</a>`
    : vm.authenticated ? html`<a href="${vm.url('help')}">Help Center</a><a class="avatar-link" href="${vm.url('dashboard')}"><span class="avatar">${vm.persona.first[0]}</span><span>Account</span></a><a href="${vm.url('logout')}">Sign out</a>`
    : html`${guestOk(vm) ? html`<a href="${vm.url('guest')}">Pay an invoice</a>` : ''}<a href="${vm.url('help')}">Help</a><a class="btn btn-brand btn-sm" href="${vm.url('login')}">Sign In</a>`}</div></header>`;
}
const ACCOUNT = [['dashboard', 'Overview'], ['plan', 'Membership'], ['bill', 'Billing details'], ['wallet', 'Payment methods'], ['history', 'Payment history'], ['statements', 'Bills & receipts'], ['autopay', 'Automatic payments'], ['paperless', 'Notifications'], ['profile', 'Profile'], ['contact', 'Contact us']];
const GROUP = { pay: 'bill', payMethod: 'bill', payReview: 'bill', payReceipt: 'bill', arrangement: 'bill', cancel: 'plan' };
function sidebar(vm) {
  const active = GROUP[vm.page] || vm.page;
  return html`<nav class="side" aria-label="Account"><p class="side-title">Account</p>${ACCOUNT.map(([p, t]) => html`<a href="${vm.url(p)}"${p === active ? raw(' class="on" aria-current="page"') : ''}><span class="dot" aria-hidden="true"></span>${p === 'plan' ? Noun(vm) : t}</a>`)}<a class="side-help" href="${vm.url('help')}">Help Center</a></nav>`;
}
function footer(vm) {
  return html`<footer class="foot"><p>Questions? ${vm.biller.phone ? html`Call <a href="${vm.url('helpArticle', { slug: 'contact-us' })}">${vm.biller.phone}</a>` : html`<a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact us</a>`}</p><div class="foot-links"><a href="${vm.url('help')}">Help Center</a><a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact Us</a><a href="${vm.url('helpArticle', { slug: 'pay-your-bill' })}">Payments &amp; billing</a></div>${!vm.authenticated ? obsFooter(vm) : ''}<p class="fine">Demo account site for ${vm.biller.name}. Not affiliated with the real company.</p></footer>`;
}
function shell(vm, title, body, { account = vm.authenticated && !['help', 'helpArticle', 'helpSearch'].includes(vm.page), narrow = false } = {}) {
  return doc(vm, { title: `${title} - ${short(vm)}`, bodyClass: 'sv', body: html`${header(vm)}${obsNav(vm)}${account ? html`<div class="acct-wrap">${sidebar(vm)}<main class="acct-main">${alert(vm)}${body}</main></div>` : html`<main class="page${narrow ? ' narrow' : ''}">${alert(vm)}${body}</main>`}${footer(vm)}` });
}
const row = (href, title, sub, cls = '') => html`<a class="row ${cls}" href="${href}"><span><strong>${title}</strong>${sub ? html`<small>${sub}</small>` : ''}</span><span class="chev" aria-hidden="true">›</span></a>`;

// ---------- pages ----------
const pages = {
  home(vm) {
    if (offline(vm)) {
      const art = vm.help.find(a => a.slug === 'pay-your-bill');
      return shell(vm, 'Payments', html`<section class="hero small-hero"><h1>Paying for ${vm.biller.name}</h1><p class="lead">Online account access and online payment are not available for this ${noun(vm)}.</p></section><section class="card">${art ? html`<h2>How to pay</h2>${helpBody(art)}` : ''}${vm.biller.phone ? html`<p>Questions? Call <strong>${vm.biller.phone}</strong>.</p>` : html`<p>Use the contact information on your statement.</p>`}</section>`);
    }
    const faq = vm.help.filter(a => ['pay-your-bill', 'cancel-service', 'autopay', 'reset-password', 'contact-us'].includes(a.slug));
    return shell(vm, 'Home', html`<section class="hero"><h1>${heroText(vm, vm.biller.name)}</h1><p class="lead">Manage your ${noun(vm)}, payment details and receipts.</p><p>Ready? Enter your email to sign in to your account.</p>${form(vm, 'login', html`<div class="email-row"><label class="sr-only" for="hero-email">Email address</label><input id="hero-email" name="username" type="email" autocomplete="email" placeholder="Email address" required>${button('Continue ›', { cls: 'btn btn-brand btn-lg' })}</div>`, { cls: 'hero-form' })}<p class="muted">New to ${short(vm)}? <a href="${vm.url('register')}">Sign up now</a>${guestOk(vm) ? html` · <a href="${vm.url('guest')}">Pay an invoice without signing in</a>` : ''}</p></section>
<section class="faq"><h2>Frequently Asked Questions</h2>${faq.map(a => html`<details class="faq-item"><summary>${a.title}</summary><div class="faq-body">${helpBody(a)}<p><a href="${vm.url('helpArticle', { slug: a.slug })}">Read more</a></p></div></details>`)}<p class="center"><a class="btn btn-ghost" href="${vm.url('help')}">Visit the Help Center</a></p></section>`);
  },
  login(vm) {
    return shell(vm, 'Log in', html`<div class="auth">${logo(vm, 'logo logo-lg')}<h1>Log in to ${short(vm)}</h1>${form(vm, 'login', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'username', label: idLabel(vm, 'Email or username'), autocomplete: 'username' })}${button(submitLabel(vm, 'Continue', 'next'), { cls: 'btn btn-brand btn-block' })}`)}${social(vm)}<p><a href="${vm.url('forgot')}">Forgot your password?</a></p><hr><p class="muted">Don't have an account? <a href="${vm.url('register')}">Sign up for ${short(vm)}</a></p></div>`, { narrow: true });
  },
  loginPassword(vm) {
    const u = vm.values.username || vm.query.u || '';
    return shell(vm, 'Enter password', html`<div class="auth">${logo(vm, 'logo logo-lg')}<h1>Enter your password</h1><p class="chip">${u} <a href="${vm.url('login')}">Change</a></p>${form(vm, 'loginPassword', html`${hidden('next', vm.query.next || '')}${hidden('username', u)}${field(vm, { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' })}${button(submitLabel(vm, 'Log In', 'final'), { cls: 'btn btn-brand btn-block' })}`)}<p><a href="${vm.url('forgot')}">Forgot your password?</a></p></div>`, { narrow: true });
  },
  mfa(vm) { return shell(vm, 'Enter code', html`<div class="auth"><h1>Enter the 6-digit code</h1><p class="muted">${mfaLead(vm, `We emailed a code to the address on your account.`)}</p>${form(vm, 'mfa', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'code', label: 'Code', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' })}${button('Log In', { cls: 'btn btn-brand btn-block' })}`)}${mfaResend(vm)}</div>`, { narrow: true }); },
  register(vm) {
    return shell(vm, 'Sign up', html`<div class="auth"><h1>Create your online account</h1><p class="muted">Link your existing ${noun(vm)} using the member number on your welcome email or receipt.</p>${form(vm, 'register', html`${field(vm, { name: 'email', label: 'Email', type: 'email', autocomplete: 'email' })}${field(vm, { name: 'accountNumber', label: 'Member number', inputmode: 'numeric' })}${field(vm, { name: 'password', label: 'Create a password', type: 'password', autocomplete: 'new-password', help: '8+ characters with upper and lower case, a number and a symbol.' })}${field(vm, { name: 'confirm', label: 'Confirm password', type: 'password', autocomplete: 'new-password' })}${button('Sign Up', { cls: 'btn btn-brand btn-block' })}`)}<p class="muted">Already have an account? <a href="${vm.url('login')}">Log in</a></p></div>`, { narrow: true });
  },
  verify(vm) { return shell(vm, 'Verify email', html`<div class="auth"><h1>Check your inbox</h1><p>Tap the link in the email we sent to verify your address.</p><p><a href="${vm.url('login')}">Back to log in</a></p></div>`, { narrow: true }); },
  forgot(vm) { return shell(vm, 'Reset password', html`<div class="auth"><h1>Reset your password</h1><p class="muted">Enter your email address or username and we'll send you a code.</p>${form(vm, 'forgot', html`${field(vm, { name: 'identifier', label: 'Email address or username', autocomplete: 'username' })}${button('Send', { cls: 'btn btn-brand btn-block' })}`)}<p><a href="${vm.url('login')}">Back to log in</a></p></div>`, { narrow: true }); },
  reset(vm) { return shell(vm, 'New password', html`<div class="auth"><h1>Choose a new password</h1>${form(vm, 'reset', html`${vm.query.token ? hidden('token', vm.query.token) : field(vm, { name: 'code', label: 'Code from email', inputmode: 'numeric', autocomplete: 'one-time-code' })}${field(vm, { name: 'password', label: 'New password', type: 'password', autocomplete: 'new-password' })}${field(vm, { name: 'confirm', label: 'Repeat new password', type: 'password', autocomplete: 'new-password' })}${button('Save password', { cls: 'btn btn-brand btn-block' })}`)}</div>`, { narrow: true }); },
  guest(vm) { return shell(vm, 'Pay an invoice', html`<div class="auth"><h1>Pay an invoice</h1><p class="muted">No account needed. Enter your member number and billing ZIP code.</p>${form(vm, 'guest', html`${field(vm, { name: 'accountNumber', label: 'Member number', inputmode: 'numeric' })}${field(vm, { name: 'zip', label: 'Billing ZIP code', inputmode: 'numeric', maxlength: 5 })}${button('Find invoice', { cls: 'btn btn-brand btn-block' })}`)}<p class="muted"><a href="${vm.url('login')}">Log in</a> to manage your ${noun(vm)}.</p></div>`, { narrow: true }); },
  guestPay(vm) { return shell(vm, 'Payment', html`<h1>Payment details</h1><p class="muted">Member ${vm.accountMasked} · Balance <strong>${money(vm.balanceCents)}</strong></p><div class="card">${form(vm, 'guestPay', html`${amountBlock(vm)}<fieldset class="plain"><legend>Card or bank account</legend>${newMethodFields(vm)}</fieldset>${button('Review payment', { cls: 'btn btn-brand' })}`)}</div>`); },
  guestReview(vm) { return reviewPage(vm, 'guestReview'); },
  guestReceipt(vm) { return receiptPage(vm); },

  dashboard(vm) {
    const plan = currentPlan(vm); const svc = vm.service; const m = cardOnFile(vm);
    return shell(vm, 'Account', html`<h1>Account</h1><p class="muted">${vm.persona.email}${memberSince(vm) ? ` · Member since ${memberSince(vm)}` : ''}</p>
${svc.status === 'cancel_pending' ? html`<div class="banner">Your ${noun(vm)} ends on <strong>${fmtDate(svc.cancelAt)}</strong>. ${form(vm, 'cancel', html`${hidden('step', 'undo')}${button(`Restart ${noun(vm)}`, { cls: 'btn btn-brand btn-sm' })}`, { cls: 'inline' })}</div>` : ''}
<section class="card member"><p class="eyebrow">${Noun(vm)} details</p><div class="member-top"><div><h2>${plan ? `${planName(vm, plan)} plan` : `${Noun(vm)}`}</h2>${plan?.cents ? html`<p class="price">${money(plan.cents)}<span>/month</span></p>` : ''}</div>${svc.status === 'active' ? html`<span class="pill-tag">Active</span>` : html`<span class="pill-tag warn">Ending</span>`}</div>
<p>Next payment: <strong>${money(vm.balanceCents)}</strong> on ${vm.dueText}${vm.autopay.enrolled ? ' (automatic)' : ''}</p>${m ? html`<p class="pm">${methodText(m)}</p>` : ''}${vm.balanceCents > 0 ? html`<p><a class="btn btn-brand" href="${vm.url('pay')}">Pay now</a></p>` : ''}</section>
<section class="card rows"><h2 class="h-sm">Quick links</h2>${row(vm.url('plan'), 'Change plan', plan ? `Currently ${planName(vm, plan)}` : '')}${row(vm.url('wallet'), 'Manage payment method', m ? methodText(m) : 'Add a card or bank account')}${row(vm.url('bill'), 'Billing details', `Next payment ${vm.dueText}`)}${row(vm.url('history'), 'Payment history', '')}${row(vm.url('statements'), 'Bills & receipts', '')}${row(vm.url('autopay'), 'Automatic payments', vm.autopay.enrolled ? 'On' : 'Off')}${row(vm.url('paperless'), 'Notifications & paper statements', vm.account.paperless ? 'Paperless' : 'Paper statements by mail')}${row(vm.url('arrangement'), 'Split a payment', 'Pay a balance in installments')}${cancelOk(vm) && svc.status === 'active' ? row(vm.url('cancel'), `Cancel ${noun(vm)}`, '', 'danger') : ''}</section>`);
  },
  bill(vm) {
    const inv = vm.invoice; const plan = currentPlan(vm);
    return shell(vm, 'Billing details', html`<h1>Billing details</h1><section class="card"><div class="split"><div><p class="eyebrow">Next payment</p><p class="price big">${money(Math.max(0, vm.balanceCents))}</p><p class="muted">Due ${fmtDate(inv.dueAt)} · Service period ${inv.period}</p></div><div class="stack"><a class="btn btn-brand" href="${vm.url('pay')}">Pay now</a><a class="btn btn-ghost" href="${vm.url('statement', { id: inv.id })}">${inv.balanceCents > 0 ? 'Download bill (PDF)' : 'Download receipt (PDF)'}</a></div></div>
${table(['Description', 'Amount'], [...inv.lines.map(l => [plan && l.desc === 'Membership' ? `${Noun(vm)} – ${planName(vm, plan)}` : l.desc, money(l.cents)]), [html`<strong>Total</strong>`, html`<strong>${money(inv.amountCents)}</strong>`]], 'table')}</section>
<section class="card rows">${row(vm.url('history'), 'Payment history', 'See past payments')}${row(vm.url('statements'), 'Bills & receipts', 'Download bills and past receipts')}${row(vm.url('arrangement'), 'Need more time to pay?', 'Split your balance into installments')}</section>`);
  },
  statements(vm) { const plan = currentPlan(vm); return shell(vm, 'Bills & receipts', html`<h1>Billing history &amp; receipts</h1><section class="card">${table(['Date', 'Description', 'Service period', 'Total', ''], vm.invoices.map(i => [fmtDate(i.issuedAt), `${Noun(vm)}${plan ? ` – ${planName(vm, plan)}` : ''}`, i.period, money(i.amountCents), html`<a href="${vm.url('statement', { id: i.id })}">${i.balanceCents > 0 ? 'Bill (PDF)' : 'Receipt (PDF)'}</a>`]))}</section>`); },
  pay(vm) {
    return shell(vm, 'Pay now', html`<h1>Pay now</h1><p class="muted">Balance ${money(vm.balanceCents)} · due ${vm.dueText}</p><section class="card">${form(vm, 'pay', html`${amountBlock(vm)}<div class="pm-block">${methodChooser(vm, { title: 'Pay with' })}</div>${dateField(vm, { label: 'Payment date' })}${button('Review payment', { cls: 'btn btn-brand' })}`)}</section>`);
  },
  payMethod(vm) { return pages.pay(vm); },
  payReview(vm) { return reviewPage(vm, 'payReview'); },
  payReceipt(vm) { return receiptPage(vm); },
  history(vm) { return shell(vm, 'Payment history', html`<h1>Payment history</h1><section class="card">${table(['Date', 'Amount', 'Payment method', 'Reference', 'Status', ''], paymentRows(vm))}</section><p class="muted">Looking for a receipt? <a href="${vm.url('statements')}">See receipts</a></p>`); },
  autopay(vm) {
    const ap = vm.autopay;
    const enroll = form(vm, 'autopay', html`${hidden('action', 'enroll')}${methodChooser(vm, { title: 'Charge renewals to' })}${checkbox(vm, { name: 'acceptTerms', label: `I authorize ${short(vm)} to charge this method automatically for each renewal until I cancel.` })}${button(ap.enrolled ? 'Save' : 'Turn on automatic payments', { cls: 'btn btn-brand' })}`);
    return shell(vm, 'Automatic payments', html`<h1>Automatic payments</h1><p class="muted">Your ${noun(vm)} renews every month. With AutoPay on, we charge your payment method on each renewal date.</p>
${ap.enrolled ? html`<section class="card"><p class="eyebrow">Status</p><h2>AutoPay is on</h2><p>Renewals are charged to ${vm.autopayMethod ? methodText(vm.autopayMethod) : 'your saved method'}. Next charge ${money(vm.balanceCents)} on ${vm.dueText}.</p>${form(vm, 'autopay', html`${hidden('action', 'cancel')}${checkbox(vm, { name: 'confirm', label: "I understand I'll need to pay each renewal myself." })}${button('Turn off AutoPay', { cls: 'btn btn-ghost' })}`)}</section><section class="card"><h2 class="h-sm">Change payment method for AutoPay</h2>${enroll}</section>`
      : html`<section class="card"><p class="eyebrow">Status</p><h2>AutoPay is off</h2>${enroll}</section>`}`);
  },
  paperless(vm) {
    const on = vm.account.paperless;
    return shell(vm, 'Notifications', html`<h1>Notifications</h1><section class="card"><h2 class="h-sm">Paper statements</h2><p>${on ? `Paperless is on. Receipts and billing notices go to ${vm.persona.email}.` : 'You currently receive paper statements by mail. Go paperless to get them by email instead.'}</p>${form(vm, 'paperless', html`${hidden('paperless', on ? 'off' : 'on')}${!on ? field(vm, { name: 'email', label: 'Send receipts to', type: 'email', value: vm.persona.email }) : ''}${button(on ? 'Turn paper statements back on' : 'Go paperless', { cls: on ? 'btn btn-ghost' : 'btn btn-brand' })}`)}</section>`);
  },
  wallet(vm) {
    return shell(vm, 'Payment methods', html`<h1>Payment methods</h1><section class="card"><h2 class="h-sm">Saved payment methods</h2><ul class="wallet">${vm.methods.length ? vm.methods.map(m => html`<li><span class="cardchip">${m.type === 'bank' ? 'BANK' : (m.brand || 'CARD').toUpperCase()}</span><span class="grow">${methodText(m)}${m.exp ? html`<small> · Expires ${m.exp}</small>` : ''}${vm.autopay.enrolled && vm.autopay.methodId === m.id ? html` <span class="pill-tag">AutoPay</span>` : ''}</span>${form(vm, 'wallet', html`${hidden('op', 'remove')}${hidden('methodId', m.id)}${button('Remove', { cls: 'link' })}`)}</li>`) : html`<li>No saved payment methods.</li>`}</ul></section><section class="card"><h2 class="h-sm">Add payment method</h2>${form(vm, 'wallet', html`${hidden('op', 'add')}${newMethodFields(vm)}${field(vm, { name: 'nickname', label: 'Nickname (optional)', required: false })}${button('Add payment method', { cls: 'btn btn-brand' })}`)}<p class="muted small">You may see a small temporary authorization charge when you add a card.</p></section>`);
  },
  cancel(vm) {
    const svc = vm.service; const n = noun(vm);
    if (svc.status !== 'active' && vm.step !== 'done') return shell(vm, `Cancel ${n}`, html`<h1>Your ${n}</h1><section class="card"><p>${svc.status === 'cancel_pending' ? html`Your ${n} is cancelled and ends on <strong>${fmtDate(svc.cancelAt)}</strong>. You won't be charged again.` : `Your ${n} has ended.`}</p>${svc.status === 'cancel_pending' ? form(vm, 'cancel', html`${hidden('step', 'undo')}${button(`Restart ${n}`, { cls: 'btn btn-brand' })}`) : ''}</section>`);
    const reasons = [['cost', "It's too expensive"], ['not_using', "I don't use it enough"], ['switching', "I'm switching to another service"], ['moving', "I'm moving"], ['technical', 'Technical problems'], ['other', 'Something else']];
    const body = {
      reason: html`<h1>Cancel ${n}</h1><section class="card"><h2 class="h-sm">Before you go, tell us why you're leaving</h2>${form(vm, 'cancel', html`${hidden('step', 'reason')}<fieldset class="plain choices">${reasons.map(([v, t]) => html`<label class="choice"><input type="radio" name="reason" value="${v}"${vm.values.reason === v ? raw(' checked') : ''}> <span>${t}</span></label>`)}</fieldset>${button('Continue to cancel', { cls: 'btn btn-brand' })} <a class="btn btn-ghost" href="${vm.url('dashboard')}">Back to account</a>`)}</section>`,
      offer: html`<h1>Wait — don't miss this</h1><section class="card offer"><p class="eyebrow">Special offer</p><h2>Stay for 50% off your next 3 months</h2><p>Keep your ${currentPlan(vm) ? planName(vm, currentPlan(vm)) : ''} plan at half price. You can still cancel anytime.</p>${form(vm, 'cancel', html`${hidden('step', 'offer')}<div class="stack-row">${button('Get 50% off', { cls: 'btn btn-brand', name: 'accept', value: 'yes' })}${button('No thanks, continue to cancel', { cls: 'btn btn-ghost', name: 'accept', value: 'no' })}</div>`)}<p class="muted small">Prefer a lower price? <a href="${vm.url('plan')}">Change your plan</a> instead.</p></section>`,
      confirm: html`<h1>Finish cancellation</h1><section class="card"><ul class="ticks"><li>Your ${n} will end on <strong>${vm.dueText}</strong>, the end of your current billing period.</li><li>You won't be charged again after that.</li><li>Restart anytime — your profile and preferences are kept for 10 months.</li></ul>${form(vm, 'cancel', html`${hidden('step', 'confirm')}${checkbox(vm, { name: 'confirm', label: `Yes, cancel my ${n}.` })}${button('Finish Cancellation', { cls: 'btn btn-danger' })}`)}</section>`,
      done: html`<h1>Your ${n} has been cancelled</h1><section class="card"><p>You can keep using ${short(vm)} until <strong>${svc.cancelAt ? fmtDate(svc.cancelAt) : ''}</strong>.</p><p>Confirmation <strong>${svc.confirmation || ''}</strong> — we emailed you a copy.</p>${form(vm, 'cancel', html`${hidden('step', 'undo')}${button(`Restart ${n}`, { cls: 'btn btn-brand' })}`)}</section>`,
      kept: html`<h1>You're all set</h1><section class="card"><p>50% off has been applied to your next 3 payments. Enjoy!</p><p><a class="btn btn-brand" href="${vm.url('dashboard')}">Back to account</a></p></section>`
    };
    return shell(vm, `Cancel ${n}`, body[vm.step]);
  },
  plan(vm) {
    const svc = vm.service;
    return shell(vm, 'Change plan', html`<h1>${Noun(vm)}</h1><p class="muted">Change plan — your new price starts on your next billing date.</p>${vm.plans.length ? form(vm, 'plan', html`<fieldset class="plain plans"><legend class="sr-only">Choose a plan</legend>${vm.plans.map(p => html`<label class="plan${p.current ? ' current' : ''}"><span class="plan-head"><input type="radio" name="planId" value="${p.id}"${p.current ? raw(' checked') : ''}><span class="plan-title">${planName(vm, p)}</span>${p.current ? html`<span class="pill-tag">Current plan</span>` : ''}</span><span class="plan-price">${money(p.cents)}<small>/month</small></span><ul>${(planFeatures(vm, p)).map(f => html`<li>${f}</li>`)}</ul></label>`)}</fieldset>${button('Save', { cls: 'btn btn-brand' })}`) : html`<p>Plan changes are not available online.</p>`}${cancelOk(vm) && svc.status === 'active' ? html`<section class="card rows">${row(vm.url('cancel'), `Cancel ${noun(vm)}`, '', 'danger')}</section>` : ''}`);
  },
  arrangement(vm) {
    return shell(vm, 'Split a payment', html`<h1>Split a payment</h1><section class="card">${vm.account.arrangement ? html`<p>You're paying <strong>${money(vm.account.arrangement.monthlyCents)}</strong> a month for ${vm.account.arrangement.months} months.</p>` : form(vm, 'arrangement', html`<p>Spread your balance of <strong>${money(vm.balanceCents)}</strong> over a few months.</p>${select(vm, { name: 'months', label: 'Installments', options: [['3', '3 monthly payments'], ['6', '6 monthly payments'], ['12', '12 monthly payments']] })}${button('Set up installments', { cls: 'btn btn-brand' })}`)}</section>`);
  },
  contact(vm) {
    return shell(vm, 'Contact us', html`<h1>Contact us</h1>${vm.account.messages.length ? html`<section class="card"><h2 class="h-sm">Your requests</h2>${table(['Date', 'Topic', 'Status'], vm.account.messages.map(m => [fmtDate(m.at), m.subject, m.status]))}</section>` : ''}<section class="card">${form(vm, 'contact', html`${select(vm, { name: 'subject', label: 'What can we help with?', options: [['Payments & billing', 'Payments & billing'], ['Manage my account', 'Manage my account'], ['Charged incorrectly', 'I was charged incorrectly'], ['Something else', 'Something else']] })}<div class="field"><label for="f-message">Describe your issue</label><textarea id="f-message" name="message" rows="5" required>${vm.values.message || ''}</textarea></div>${button('Send', { cls: 'btn btn-brand' })}`)}</section>`);
  },
  profile(vm) {
    return shell(vm, 'Profile', html`<h1>Profile</h1><section class="card"><dl class="kv"><dt>Name</dt><dd>${vm.persona.name}</dd><dt>Email</dt><dd>${vm.persona.email}</dd><dt>Phone</dt><dd>${vm.account.phone || 'Add a phone number'}</dd><dt>Member number</dt><dd>${vm.accountMasked}</dd></dl>${form(vm, 'profile', html`${field(vm, { name: 'phone', label: 'Phone number', type: 'tel', autocomplete: 'tel' })}${button('Save profile', { cls: 'btn btn-brand' })}`)}</section>`);
  },
  help(vm) {
    const groups = [['Payments & billing', ['payments', 'billing', 'autopay', 'assistance']], ['Manage your account', ['account']], ['More help', ['contact', 'faq']]];
    return shell(vm, 'Help Center', html`<section class="hero small-hero"><h1>How can we help?</h1>${helpSearchForm(vm, { placeholder: 'Search for answers' })}</section><div class="help-grid">${groups.map(([label, topics]) => { const list = vm.help.filter(a => topics.includes(a.topic)); return list.length ? html`<section class="card"><h2 class="h-sm">${label}</h2>${helpList(vm, list)}</section>` : ''; })}</div>${helpExcerpts(vm)}${vm.authenticated ? html`<p class="center"><a href="${vm.url('contact')}">Contact us</a></p>` : ''}`, { account: false });
  },
  helpArticle(vm) { return shell(vm, vm.article.title, html`<p class="crumbs"><a href="${vm.url('help')}">Help Center</a> / Article</p><article class="card article"><h1>${vm.article.title}</h1>${helpBody(vm.article)}<p class="muted small">Was this article helpful?</p></article>${articleExcerpt(vm)}`, { account: false }); },
  helpSearch(vm) { return shell(vm, 'Search', html`<p class="crumbs"><a href="${vm.url('help')}">Help Center</a> / Search</p><h1>Results for “${vm.query.q || ''}”</h1>${helpSearchForm(vm, { placeholder: 'Search for answers' })}<section class="card">${vm.results.length ? helpList(vm, vm.results) : html`<p>We couldn't find anything for that. Try other words.</p>`}</section>`, { account: false }); }
};

function amountBlock(vm) {
  const sel = vm.values.amountChoice || vm.draft?.amountKey || 'due';
  const otherVal = vm.values.amount ?? (vm.draft?.amountKey === 'other' ? (vm.draft.amountCents / 100).toFixed(2) : '');
  return html`<fieldset class="plain amounts"><legend>Amount</legend>${vm.amountOptions.map(o => html`<label class="choice"><input type="radio" name="amountChoice" value="${o.key}"${sel === o.key ? raw(' checked') : ''}> <span>${o.key === 'due' ? 'Balance due' : o.key === 'other' ? 'Different amount' : o.label}</span>${o.cents != null ? html`<strong class="amt">${money(o.cents)}</strong>` : html`<input class="other-amount" name="amount" inputmode="decimal" aria-label="Different amount" placeholder="0.00" value="${otherVal}">`}</label>`)}</fieldset>`;
}
function reviewPage(vm, page) {
  const d = vm.draft;
  return shell(vm, 'Confirm payment', html`<h1>Confirm your payment</h1><section class="card"><dl class="kv"><dt>Amount</dt><dd>${money(d.amountCents)}</dd>${d.feeCents ? html`<dt>Fee</dt><dd>${money(d.feeCents)}</dd>` : ''}<dt>Total</dt><dd><strong>${money(d.totalCents)}</strong></dd><dt>Pay with</dt><dd>${methodText(d.method)}</dd><dt>Date</dt><dd>${d.payOn || 'Today'}</dd></dl>${form(vm, page, html`${hidden('token', d.token)}${hidden('op', 'submit')}${checkbox(vm, { name: 'acceptTerms', label: `I agree to the ${short(vm)} Terms of Use and authorize this charge.` })}${button(`Pay ${money(d.totalCents)}`, { cls: 'btn btn-brand' })}`)}${page === 'payReview' ? form(vm, page, html`${hidden('op', 'edit')}${button('Change payment details', { cls: 'link' })}`) : ''}</section>`);
}
function receiptPage(vm) {
  const p = vm.payment;
  return shell(vm, 'Payment complete', html`<section class="card done"><div class="tick" aria-hidden="true">✓</div><h1>${p.status === 'scheduled' ? 'Payment scheduled' : 'Payment successful'}</h1><dl class="kv"><dt>Reference</dt><dd><strong>${p.confirmation}</strong></dd><dt>Amount</dt><dd>${money(p.amountCents)}</dd>${p.feeCents ? html`<dt>Fee</dt><dd>${money(p.feeCents)}</dd>` : ''}<dt>Paid with</dt><dd>${vm.paymentMethod ? methodText(vm.paymentMethod) : `•••• ${p.methodLast4}`}</dd><dt>Date</dt><dd>${p.payOn || fmtDate(p.createdAt)}</dd><dt>Status</dt><dd>${statusLabel(p.status)}</dd></dl><p class="muted">A receipt was sent to your email.</p>${vm.authenticated ? html`<p><a class="btn btn-brand" href="${vm.url('dashboard')}">Back to account</a> <a class="btn btn-ghost" href="${vm.url('history')}">Payment history</a></p>` : html`<p><a class="btn btn-brand" href="${vm.url('home')}">Done</a></p>`}</section>`);
}

export function render(page, vm) { const fn = pages[page]; if (!fn) throw new Error(`streaming template cannot render ${page}`); vm = observe(vm); return finish(vm, fn(vm)); }

export const css = `*{box-sizing:border-box}body.sv{margin:0;min-height:100vh;display:flex;flex-direction:column;font:16px/1.5 "Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;background:#0f0f10;color:#f5f5f5}a{color:#fff}
.top{display:flex;justify-content:space-between;align-items:center;padding:16px 40px;background:linear-gradient(#000,#0f0f10)}.brand{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-weight:800;font-size:22px;letter-spacing:-.02em}.logo{width:36px;height:36px}.logo-lg{width:52px;height:52px}
.top-right{display:flex;align-items:center;gap:22px;font-size:15px}.top-right a{text-decoration:none;color:#e5e5e5}.top-right a:hover{color:#fff;text-decoration:underline}.avatar-link{display:flex;align-items:center;gap:8px}.avatar{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:6px;background:var(--brand);color:#fff;font-weight:700;border:1px solid #fff3}
.btn{display:inline-block;border-radius:999px;padding:11px 26px;font:inherit;font-weight:700;text-decoration:none;cursor:pointer;border:1px solid #fff;background:transparent;color:#fff;line-height:1.2}.btn-brand{background:var(--brand);border-color:#ffffff40;color:#fff}.btn-brand:hover{filter:brightness(1.25)}.btn-ghost{border-color:#8a8a8a}.btn-ghost:hover{border-color:#fff}.btn-danger{background:#e50914;border-color:#e50914}.btn-sm{padding:7px 16px;font-size:14px}.btn-lg{padding:14px 28px;font-size:18px}.btn-block{width:100%}.link{background:none;border:0;color:#fff;text-decoration:underline;cursor:pointer;font:inherit;padding:0}
main.page{width:100%;max-width:1000px;margin:0 auto;padding:24px 24px 48px;flex:1}main.narrow{max-width:460px}
.acct-wrap{flex:1;display:grid;grid-template-columns:240px 1fr;gap:40px;max-width:1120px;width:100%;margin:0 auto;padding:24px 24px 48px}.acct-main{min-width:0}
.side{display:flex;flex-direction:column;gap:2px;position:sticky;top:16px;align-self:start}.side-title{font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:#9a9a9a;margin:0 0 8px}.side a{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:6px;text-decoration:none;color:#c8c8c8;font-weight:600}.side a:hover{background:#ffffff12;color:#fff}.side a.on{background:#ffffff1c;color:#fff}.side .dot{width:6px;height:6px;border-radius:50%;background:transparent}.side a.on .dot{background:var(--accent);box-shadow:0 0 0 2px #fff}.side-help{margin-top:12px;border-top:1px solid #2a2a2a;padding-top:14px!important}
h1{font-size:34px;letter-spacing:-.02em;margin:0 0 6px;line-height:1.15}h2{font-size:22px;margin:0 0 10px}.h-sm{font-size:18px}.muted{color:#a3a3a3}.small{font-size:14px}.center{text-align:center}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:12px;font-weight:700;color:#a3a3a3;margin:0 0 6px}
.card{background:#1c1c1e;border:1px solid #2c2c2e;border-radius:12px;padding:24px;margin:18px 0}.member{background:linear-gradient(135deg,#1c1c1e 55%,#2b2b31)}.member-top{display:flex;justify-content:space-between;align-items:flex-start}.price{font-size:26px;font-weight:800;margin:0}.price span,.price small{font-size:14px;color:#a3a3a3;font-weight:400}.price.big{font-size:40px}.pm{color:#c8c8c8}
.pill-tag{display:inline-block;font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;background:#1f3d2a;color:#7ee2a0}.pill-tag.warn{background:#463414;color:#ffcf70}
.rows{padding:8px 0}.rows h2{padding:10px 24px 4px}.row{display:flex;justify-content:space-between;align-items:center;padding:14px 24px;text-decoration:none;color:#fff;border-top:1px solid #2c2c2e}.row:hover{background:#ffffff0d}.row span{display:flex;flex-direction:column}.row small{color:#a3a3a3}.chev{font-size:26px;color:#8a8a8a}.row.danger strong{color:#ff6b6b}
.split{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:16px}.stack{display:flex;flex-direction:column;gap:10px}.stack-row{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}
.banner{background:#463414;color:#ffe2a8;border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}.inline{display:inline}
.hero{text-align:center;padding:72px 24px 56px;background:radial-gradient(ellipse at top,#ffffff14,transparent 60%),linear-gradient(135deg,var(--brand),#0f0f10 70%);border-radius:0 0 24px 24px;margin:-24px 0 24px}.hero h1{font-size:48px}.hero .lead{font-size:22px}.small-hero{padding:44px 24px}.small-hero h1{font-size:36px}
.email-row{display:flex;gap:10px;max-width:620px;margin:0 auto 16px}.email-row input{flex:1;padding:16px;border-radius:6px;border:1px solid #8a8a8a;background:#000a;color:#fff;font:inherit;font-size:17px}
.faq{max-width:820px;margin:0 auto}.faq h2{text-align:center;font-size:30px}.faq-item{background:#2d2d2f;margin:8px 0}.faq-item summary{text-decoration:none;padding:20px 24px;font-size:20px;cursor:pointer;list-style:none;display:flex;justify-content:space-between}.faq-item summary::after{content:"+";font-size:30px;line-height:.8}.faq-item[open] summary::after{content:"×"}.faq-body{padding:0 24px 18px;border-top:1px solid #0f0f10}
.auth{background:#000c;border:1px solid #2c2c2e;border-radius:12px;padding:40px;margin-top:20px}.auth h1{font-size:30px;margin-top:10px}.chip{display:inline-flex;gap:10px;background:#2c2c2e;border-radius:999px;padding:6px 14px;font-size:14px}.step-label{font-size:12px;letter-spacing:.1em;color:#a3a3a3;margin:0}hr{border:0;border-top:1px solid #333;margin:22px 0}
.field{margin:14px 0}.field label{display:block;font-weight:700;font-size:14px;margin-bottom:6px;color:#e5e5e5}.field input,.field select,.field textarea{width:100%;padding:13px 14px;border:1px solid #6b6b6b;border-radius:6px;background:#121212;color:#fff;font:inherit}.field input:focus,.field select:focus,.field textarea:focus{outline:2px solid #fff;border-color:#fff}.help{color:#a3a3a3;font-size:13px}
fieldset{border:1px solid #2c2c2e;border-radius:10px;padding:14px 16px;margin:14px 0}fieldset.plain{border:0;padding:0}legend{font-weight:800;font-size:17px;margin-bottom:8px;padding:0}.radio,.check{display:flex;align-items:center;gap:10px;margin:8px 0}.radio input,.check input,.choice input{accent-color:var(--accent);width:18px;height:18px}
.choice{display:flex;align-items:center;gap:12px;border:1px solid #3a3a3c;border-radius:10px;padding:14px 16px;margin:8px 0;cursor:pointer}.choice:hover{border-color:#8a8a8a}.choice .amt{margin-left:auto}.other-amount{margin-left:auto;width:120px;padding:8px 10px;border-radius:6px;border:1px solid #6b6b6b;background:#121212;color:#fff;font:inherit}
.methods{border:0;padding:0}.pm-block{margin:10px 0}details summary{cursor:pointer;color:#fff;text-decoration:underline;margin:10px 0}
.plans{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.plan{display:flex;flex-direction:column;gap:8px;background:#1c1c1e;border:2px solid #3a3a3c;border-radius:14px;padding:20px;cursor:pointer;background-image:linear-gradient(160deg,#ffffff0a,transparent)}.plan.current{border-color:#fff}.plan-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.plan-title{font-weight:800;font-size:19px}.plan-price{font-size:24px;font-weight:800}.plan-price small{font-size:13px;color:#a3a3a3;font-weight:400}.plan ul{margin:0;padding-left:18px;color:#c8c8c8;font-size:14px}.plan input{width:18px;height:18px;accent-color:var(--accent)}
.offer{border-color:var(--accent);background:linear-gradient(135deg,#1c1c1e,#26262b)}.ticks{padding-left:20px}.ticks li{margin:8px 0}
.alert{padding:14px 18px;border-radius:8px;margin:12px 0}.alert-error{background:#4a1416;color:#ffb4b4;border-left:4px solid #e50914}.alert-ok{background:#123222;color:#9ff0bd;border-left:4px solid #3ecf74}
.table{width:100%;border-collapse:collapse}.table th,.table td{padding:12px 8px;text-align:left;border-bottom:1px solid #2c2c2e}.table th{color:#a3a3a3;font-size:13px;font-weight:600}.table form{display:inline}.empty{color:#a3a3a3}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:8px 24px;margin:0 0 18px}.kv dt{color:#a3a3a3}.kv dd{margin:0}
.wallet{list-style:none;margin:0;padding:0}.wallet li{display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid #2c2c2e}.wallet .grow{flex:1}.wallet small{color:#a3a3a3}.wallet form{display:inline}.cardchip{font-size:11px;font-weight:800;letter-spacing:.06em;background:#f5f5f5;color:#111;border-radius:4px;padding:4px 7px;min-width:56px;text-align:center}
.done .tick{width:52px;height:52px;border-radius:50%;background:#3ecf74;color:#06210f;display:grid;place-items:center;font-size:28px;font-weight:800;margin-bottom:12px}
.help-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.help-grid .card{margin:0}.help-search{display:flex;gap:8px;max-width:620px;margin:16px auto}.help-search input{flex:1;padding:14px 16px;border-radius:999px;border:0;font:inherit;background:#fff;color:#111}.help-search .btn{border-radius:999px;background:#fff;color:#111;border:0}.help-list{margin:0;padding-left:18px}.help-list li{margin:8px 0}.help-list a{color:#e5e5e5}.crumbs{color:#a3a3a3;font-size:14px}.crumbs a{color:#e5e5e5}.article p{max-width:70ch;color:#dcdcdc}
.foot{border-top:1px solid #222;color:#8c8c8c;padding:28px 40px;font-size:14px}.foot a{color:#a8a8a8}.foot-links{display:flex;gap:24px;flex-wrap:wrap;margin:10px 0}.fine{font-size:12px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media(max-width:860px){.acct-wrap{grid-template-columns:1fr}.side{position:static;flex-direction:row;flex-wrap:wrap}.plans,.help-grid{grid-template-columns:1fr}.top{padding:12px 16px}.email-row{flex-direction:column}}
@media(max-width:860px){.top{flex-wrap:wrap;gap:8px 14px}.top-right{flex-wrap:wrap;gap:8px 16px;margin-left:auto}.help-search input{min-width:0}.help-search .btn{flex:none}.acct-wrap>*{min-width:0}.table{display:block;overflow-x:auto;max-width:100%}dd{overflow-wrap:anywhere}}` + OBS_CSS;
