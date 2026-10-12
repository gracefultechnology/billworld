// Reference template: a conventional "My Account" biller portal. Every canonical page is implemented.
// Other templates copy this contract and replace layout, navigation, wording and step order with their family's.
import { html, raw, doc, logo, alert, form, field, select, checkbox, button, hidden, amountChooser, methodChooser, newMethodFields, dateField, table, paymentRows, helpList, helpBody, helpSearchForm, money, fmtDate, methodText, statusLabel, L } from '../kit.mjs';
import * as kitNs from '../kit.mjs';
import { loadCatalog } from '../catalog.mjs';
import { HERO_JUNK } from './_hygiene.mjs';
import { payNotice, payRows, payDate, fmtPayOn, scrollTable, balanceTable, billingCss } from './_generic-billing.mjs';
import { withdrawn, withdrawnView } from './_withdrawn.mjs';

export const meta = { id: 'generic', name: 'Generic biller portal', description: 'Fallback experience used when a template is not yet implemented.', families: [], sources: [],
  // Where the dedicated tier's dossier nav (vm.nav) goes (server.mjs withDossierNav).
  navSlots: { public: ['class:nav'], account: ['class:nav'] } };
export const flow = { paySteps: ['pay', 'payReview'] };

const nav = vm => vm.authenticated ? html`<nav class="nav" aria-label="Account"><a href="${vm.url('dashboard')}">${L(vm, 'dashboard', 'Overview')}</a><a href="${vm.url('bill')}">${L(vm, 'bill', 'View Bill')}</a><a href="${vm.url('pay')}">${L(vm, 'pay', 'Pay Bill')}</a><a href="${vm.url('history')}">${L(vm, 'history', 'Payment Activity')}</a><a href="${vm.url('autopay')}">${L(vm, 'autopay', 'AutoPay')}</a><a href="${vm.url('paperless')}">${L(vm, 'paperless', 'Paperless')}</a><a href="${vm.url('wallet')}">${L(vm, 'wallet', 'Payment Methods')}</a><a href="${vm.url('help')}">${L(vm, 'help', 'Help')}</a></nav>` : publicNav(vm);
// Public nav: the biller's observed top-level site sections (mapped to canonical pages, unmapped ones as plain text),
// followed by the canonical links they do not already cover.
function publicNav(vm) {
  const site = profileNav(vm);
  const canon = [['Home', vm.url('home')], ...(vm.biller.capabilities.guest_pay.support === 'supported' ? [['Quick Pay', vm.url('guest')]] : []), ['Help & FAQs', vm.url('help')]].filter(([, href]) => !site.some(i => i.href === href));
  return html`<nav class="nav" aria-label="Main">${site.map(i => i.href ? html`<a href="${i.href}">${i.label}</a>` : html`<span class="nav-txt" title="This section of the website is not part of this simulation">${i.label}</span>`)}${canon.map(([label, href]) => html`<a href="${href}">${label}</a>`)}</nav>`;
}
const offline = vm => vm.biller.capabilities.online_account.support === 'unsupported';

function shell(vm, title, body, { wide = false, fullTitle } = {}) {
  return doc(vm, { title: fullTitle || `${title} | ${vm.biller.brand.shortName}`, body: html`<header class="top"><a class="brand" href="${vm.url('home')}">${logo(vm)}<span>${vm.biller.brand.shortName}</span></a>${!offline(vm) ? (vm.authenticated ? html`<div class="who">Hi, ${vm.persona.first} · <a href="${vm.url('profile')}">${L(vm, 'profile', 'Profile')}</a> · <a href="${vm.url('logout')}">${L(vm, 'logout', 'Sign out')}</a></div>` : html`<a class="btn btn-small" href="${vm.url('login')}">${L(vm, 'login', 'Sign in')}</a>`) : ''}</header>${!offline(vm) ? nav(vm) : html`<nav class="nav"><a href="${vm.url('home')}">${L(vm, 'home', 'Home')}</a><a href="${vm.url('help')}">${L(vm, 'help', 'Help')}</a></nav>`}<main class="${wide ? 'wide' : ''}">${alert(vm)}${body}</main><footer class="foot"><p>${vm.biller.name}${vm.biller.phone ? ` · Customer service ${vm.biller.phone}` : ''}</p><p><a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact us</a> · <a href="${vm.url('help')}">${L(vm, 'help', 'Help center')}</a></p></footer>` });
}
const h1 = text => html`<h1>${text}</h1>`;

const pages = {
  home(vm) {
    if (offline(vm)) return shell(vm, 'Paying your bill', html`${h1(`Paying your ${vm.biller.name} bill`)}<p class="lead">Online account access and online bill payment are not available for this biller.</p><section class="card"><h2>How to pay</h2>${helpBody(vm.help.find(a => a.slug === 'pay-your-bill'))}</section>${vm.biller.phone ? html`<p>Questions? Call <strong>${vm.biller.phone}</strong>.</p>` : html`<p>Use the contact information printed on your paper bill.</p>`}`);
    const hero = profileHero(vm);
    return shell(vm, 'Home', html`<section class="hero"><div>${hero ? html`${h1(hero)}<h2 class="sub-h">Manage your ${vm.biller.name} account</h2>` : h1(`Manage your ${vm.biller.name} account`)}<p class="lead">View and pay your bill, set up AutoPay and go paperless.</p><p><a class="btn btn-primary" href="${vm.url('login')}">${L(vm, 'login', 'Sign in')}</a> <a class="btn" href="${vm.url('register')}">${L(vm, 'register', 'Register')}</a>${vm.biller.capabilities.guest_pay.support === 'supported' ? html` <a class="btn" href="${vm.url('guest')}">${L(vm, 'guest', 'Pay without signing in')}</a>` : ''}</p></div></section><section class="grid3"><div class="card"><h2>Pay your bill</h2><p>Pay online, by phone${vm.biller.payPhone ? ` (${vm.biller.payPhone})` : ''} or by mail.</p><a href="${vm.url('helpArticle', { slug: 'pay-your-bill' })}">Ways to pay</a></div>${vm.help.some(a => a.slug === 'autopay') ? html`<div class="card"><h2>AutoPay</h2><p>Never miss a due date.</p><a href="${vm.url('helpArticle', { slug: 'autopay' })}">Learn about AutoPay</a></div>` : ''}<div class="card"><h2>Need help?</h2>${helpSearchForm(vm)}</div></section>`, { fullTitle: profileTitle(vm, 'website', null) });
  },
  login(vm) {
    const lp = profileLogin(vm, { idLabel: 'Email or account number', submit: 'Sign in' });
    return shell(vm, 'Sign in', html`<div class="panel">${h1(L(vm, 'login', 'Sign in to My Account'))}${form(vm, 'login', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'username', label: lp.idLabel, autocomplete: 'username' })}${field(vm, { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' })}${button(lp.submit)}`)}${socialRow(vm)}<p><a href="${vm.url('forgot')}">${L(vm, 'forgot', 'Forgot password?')}</a> · <a href="${vm.url('register')}">${L(vm, 'register', 'Create an account')}</a></p></div>`, { fullTitle: profileTitle(vm, 'login', null) });
  },
  loginPassword(vm) { return pages.login(vm); },
  mfa(vm) { return shell(vm, 'Verify your identity', html`<div class="panel">${h1('Verify your identity')}<p>${mfaSent(vm, 'We sent a 6-digit code to the email address on your account.')}</p>${form(vm, 'mfa', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'code', label: 'Verification code', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' })}${button('Verify')}`)}${mfaResend(vm, { cls: 'btn btn-link' })}</div>`); },
  register(vm) { return shell(vm, 'Register', html`<div class="panel">${h1(L(vm, 'register', 'Create your online account'))}<p>You'll need your account number from a recent bill.</p>${form(vm, 'register', html`${field(vm, { name: 'accountNumber', label: 'Account number', inputmode: 'numeric' })}${field(vm, { name: 'lastName', label: 'Last name on account' })}${field(vm, { name: 'email', label: 'Email address', type: 'email', autocomplete: 'email' })}${field(vm, { name: 'password', label: 'Create password', type: 'password', autocomplete: 'new-password', help: '8+ characters with upper and lower case, a number and a symbol' })}${field(vm, { name: 'confirm', label: 'Confirm password', type: 'password', autocomplete: 'new-password' })}${button('Register')}`)}</div>`); },
  verify(vm) { return shell(vm, 'Verify email', html`<div class="panel">${h1('Verify your email')}<p>Open the verification link we emailed you.</p></div>`); },
  forgot(vm) { return shell(vm, 'Forgot password', html`<div class="panel">${h1(L(vm, 'forgot', 'Reset your password'))}${form(vm, 'forgot', html`${field(vm, { name: 'identifier', label: 'Email or account number', autocomplete: 'username' })}${button('Send reset code')}`)}</div>`); },
  reset(vm) { return shell(vm, 'Choose a new password', html`<div class="panel">${h1('Choose a new password')}<p>${vm.query.token ? 'Choose a new password for your account.' : 'Enter the code from your email.'}</p>${form(vm, 'reset', html`${vm.query.token ? hidden('token', vm.query.token) : field(vm, { name: 'code', label: 'Verification code', inputmode: 'numeric', autocomplete: 'one-time-code' })}${field(vm, { name: 'password', label: 'New password', type: 'password', autocomplete: 'new-password' })}${field(vm, { name: 'confirm', label: 'Confirm new password', type: 'password', autocomplete: 'new-password' })}${button('Reset password')}`)}</div>`); },
  guest(vm) { return shell(vm, 'Quick Pay', html`<div class="panel">${h1(L(vm, 'guest', 'Quick Pay'))}<p>Make a one-time payment without signing in.</p>${form(vm, 'guest', html`${field(vm, { name: 'accountNumber', label: 'Account number', inputmode: 'numeric' })}${field(vm, { name: 'zip', label: 'Service ZIP code', inputmode: 'numeric', maxlength: 5 })}${button('Find my bill')}`)}</div>`); },
  guestPay(vm) { return shell(vm, 'Quick Pay', html`${h1('Payment details')}<p>Account ${vm.accountMasked} · Amount due <strong>${money(vm.balanceCents)}</strong></p>${payNotice(vm)}${form(vm, 'guestPay', html`${amountChooser(vm)}<fieldset><legend>Payment method</legend>${newMethodFields(vm)}</fieldset>${button('Continue')}`)}`); },
  guestReview(vm) { return reviewPage(vm, 'guestReview'); },
  guestReceipt(vm) { return receiptPage(vm); },
  dashboard(vm) {
    return shell(vm, 'Account overview', html`${h1('Account overview')}<section class="grid2"><div class="card balance"><h2>${L(vm, 'amountDue', 'Amount due')}</h2><p class="big">${money(vm.balanceCents)}</p><p>Due ${vm.dueText}</p>${vm.pendingPayments.length ? html`<p class="muted">${vm.pendingPayments.length} payment(s) pending</p>` : ''}<p><a class="btn btn-primary" href="${vm.url('pay')}">${L(vm, 'pay', 'Pay bill')}</a> <a class="btn" href="${vm.url('bill')}">${L(vm, 'bill', 'View bill')}</a></p></div><div class="card"><h2>Account</h2><dl><dt>Account number</dt><dd>${vm.accountMasked}</dd><dt>Service address</dt><dd>${vm.account.serviceAddress}</dd><dt>AutoPay</dt><dd>${vm.autopay.enrolled ? 'On' : 'Off'} · <a href="${vm.url('autopay')}">Manage</a></dd><dt>Paperless</dt><dd>${vm.account.paperless ? 'On' : 'Off'} · <a href="${vm.url('paperless')}">Manage</a></dd>${vm.service.plan ? html`<dt>Plan</dt><dd>${vm.plans.find(p => p.current)?.name} · <a href="${vm.url('plan')}">Change</a></dd>` : ''}<dt>Status</dt><dd>${vm.service.status === 'active' ? 'Active' : vm.service.status === 'cancel_pending' ? `Ends ${fmtDate(vm.service.cancelAt)}` : 'Cancelled'}</dd></dl></div></section><section class="card"><h2>More</h2><ul class="links"><li><a href="${vm.url('statements')}">${L(vm, 'statements', 'Statements')}</a></li><li><a href="${vm.url('arrangement')}">${L(vm, 'arrangement', 'Payment plan')}</a></li><li><a href="${vm.url('contact')}">${L(vm, 'contact', 'Messages')}</a></li>${vm.biller.capabilities.cancel_service.support === 'supported' ? html`<li><a href="${vm.url('cancel')}">${vm.biller.kind === 'utility' ? 'Stop service' : 'Cancel service'}</a></li>` : ''}</ul></section>`);
  },
  bill(vm) { const inv = vm.invoice; return shell(vm, 'Current bill', html`${h1(L(vm, 'bill', 'Current bill'))}<p>Statement ${inv.number} · ${inv.period}</p>${scrollTable('Bill charges', ['Description', 'Amount'], [...inv.lines.map(l => [l.desc, money(l.cents)]), [html`<strong>Statement total</strong>`, html`<strong>${money(inv.amountCents)}</strong>`]])}${balanceTable(vm, { statement: 'Statement total', balance: 'Amount due' })}<p>Due date: <strong>${fmtDate(inv.dueAt)}</strong></p>${vm.scheduled.length ? html`<p class="muted">${vm.scheduled.length} scheduled payment(s) totalling ${money(vm.scheduled.reduce((a, p) => a + p.amountCents, 0))} · <a href="${vm.url('history')}">${L(vm, 'history', 'Payment activity')}</a></p>` : ''}<p><a class="btn btn-primary" href="${vm.url('pay')}">${L(vm, 'pay', 'Pay this bill')}</a> <a class="btn" href="${vm.url('statement', { id: inv.id })}">Download PDF</a></p>`); },
  statements(vm) { return shell(vm, 'Statements', html`${h1(L(vm, 'statements', 'Statements'))}${scrollTable('Statements', ['Statement date', 'Amount', 'Due', 'Statement'], vm.invoices.map(i => [fmtDate(i.issuedAt), money(i.amountCents), fmtDate(i.dueAt), html`<a href="${vm.url('statement', { id: i.id })}">View PDF</a>`]))}`); },
  pay(vm) { return shell(vm, 'Pay bill', html`${h1(L(vm, 'pay', 'Make a payment'))}<p>Current balance: <strong>${money(vm.balanceCents)}</strong> · Due ${vm.dueText}</p>${payNotice(vm)}${form(vm, 'pay', html`${amountChooser(vm)}${methodChooser(vm)}${dateField(vm)}${button('Continue to review')}`)}`); },
  payMethod(vm) { return pages.pay(vm); },
  payReview(vm) { return reviewPage(vm, 'payReview'); },
  payReceipt(vm) { return receiptPage(vm); },
  history(vm) { return shell(vm, 'Payment activity', html`${h1(L(vm, 'history', 'Payment activity'))}${scrollTable('Payment activity', ['Date', 'Amount', 'Method', 'Confirmation', 'Status', 'Action'], payRows(vm))}`, { wide: true }); },
  autopay(vm) {
    const ap = vm.autopay;
    return shell(vm, 'AutoPay', html`${h1(L(vm, 'autopay', 'AutoPay'))}${ap.enrolled ? html`<div class="card"><p><strong>AutoPay is on.</strong> We pay your ${ap.policy === 'fixed' ? `fixed amount of ${money(ap.fixedCents)}` : ap.policy === 'minimum' ? 'minimum payment' : 'full balance'} ${ap.day ? `on day ${ap.day}` : 'on each due date'} from ${vm.autopayMethod ? methodText(vm.autopayMethod) : 'your saved method'}.</p>${form(vm, 'autopay', html`${hidden('action', 'cancel')}${checkbox(vm, { name: 'confirm', label: 'I understand future bills will not be paid automatically.' })}${button('Cancel AutoPay', { cls: 'btn btn-danger' })}`)}</div><h2>Change AutoPay</h2>` : html`<p>AutoPay is off. Enroll to pay automatically each month.</p>`}${form(vm, 'autopay', html`${hidden('action', 'enroll')}${methodChooser(vm, { title: 'Pay from' })}${select(vm, { name: 'policy', label: 'Amount', options: [['full', 'Full amount due'], ...(['card', 'loan'].includes(vm.biller.kind) ? [['minimum', 'Minimum payment due']] : []), ['fixed', 'Fixed amount']] })}${field(vm, { name: 'fixedAmount', label: 'Fixed amount (if selected)', required: false, inputmode: 'decimal' })}${checkbox(vm, { name: 'acceptTerms', label: 'I authorize recurring payments under the AutoPay terms.' })}${button(ap.enrolled ? 'Save changes' : 'Enroll in AutoPay')}`)}`);
  },
  paperless(vm) { return shell(vm, 'Paperless billing', html`${h1(L(vm, 'paperless', 'Paperless billing'))}<p>Paperless is currently <strong>${vm.account.paperless ? 'on' : 'off'}</strong>.</p>${form(vm, 'paperless', html`${hidden('paperless', vm.account.paperless ? 'off' : 'on')}${!vm.account.paperless ? field(vm, { name: 'email', label: 'Email for bill notices', type: 'email', value: vm.persona.email }) : ''}${button(vm.account.paperless ? 'Switch to paper bills' : 'Go paperless')}`)}`); },
  wallet(vm) { return shell(vm, 'Payment methods', html`${h1(L(vm, 'wallet', 'Payment methods'))}<ul class="wallet">${vm.methods.map(m => html`<li>${methodText(m)}${m.nickname ? html` <span class="muted">(${m.nickname})</span>` : ''} ${form(vm, 'wallet', html`${hidden('op', 'remove')}${hidden('methodId', m.id)}<button type="submit" class="btn btn-link" aria-label="Remove ${methodText(m)}">Remove</button>`)}</li>`)}</ul><h2>Add a payment method</h2>${form(vm, 'wallet', html`${hidden('op', 'add')}${newMethodFields(vm)}${field(vm, { name: 'nickname', label: 'Nickname (optional)', required: false })}${button('Save method')}`)}`); },
  cancel(vm) {
    const kind = vm.biller.kind, noun = kind === 'subscription' ? 'membership' : kind === 'utility' ? 'service' : 'account';
    if (vm.service.status !== 'active' && vm.step !== 'done') return shell(vm, 'Cancel', html`${h1(L(vm, 'cancel', 'Cancellation'))}<p>Your ${noun} ${vm.service.status === 'cancel_pending' ? `is scheduled to end on ${fmtDate(vm.service.cancelAt)}` : 'is cancelled'}.</p>${vm.service.status === 'cancel_pending' ? form(vm, 'cancel', html`${hidden('step', 'undo')}${button('Keep my ' + noun)}`) : ''}`);
    const steps = {
      reason: html`${h1(kind === 'utility' ? 'Stop service' : `Cancel your ${noun}`)}${form(vm, 'cancel', html`${hidden('step', 'reason')}${select(vm, { name: 'reason', label: 'Why are you leaving?', options: [['', 'Select a reason'], ['moving', 'Moving'], ['cost', 'Too expensive'], ['not_using', 'Not using it enough'], ['switching', 'Switching providers'], ['other', 'Other']] })}${button('Continue')}`)}`,
      offer: html`${h1('Before you go')}<div class="card offer"><h2>Stay and get 50% off for 3 months</h2><p>Keep your ${noun} at half price for your next three bills.</p>${form(vm, 'cancel', html`${hidden('step', 'offer')}${button('Accept offer', { name: 'accept', value: 'yes' })} ${button('No thanks, continue cancelling', { cls: 'btn', name: 'accept', value: 'no' })}`)}</div>`,
      confirm: html`${h1('Confirm cancellation')}<p>${kind === 'subscription' ? `Your ${noun} will end on ${vm.dueText}, the end of your billing period.` : 'Choose when service should end. A final bill will be mailed to you.'}</p>${form(vm, 'cancel', html`${hidden('step', 'confirm')}${kind !== 'subscription' ? dateField(vm, { name: 'effectiveDate', label: 'Stop date' }) : ''}${checkbox(vm, { name: 'confirm', label: `Yes, cancel my ${noun}.` })}${button(`Cancel ${noun}`, { cls: 'btn btn-danger' })}`)}`,
      done: withdrawn(vm) ? withdrawnView(vm) : html`${h1('Cancellation confirmed')}<p>Your ${noun} will end on <strong>${vm.service.cancelAt ? fmtDate(vm.service.cancelAt) : ''}</strong>. Confirmation number <strong>${vm.service.confirmation || ''}</strong>.</p>`,
      kept: html`${h1('Thanks for staying')}<p>Your discount has been applied.</p>`
    };
    return shell(vm, 'Cancel', steps[vm.step]);
  },
  plan(vm) { return shell(vm, 'Change plan', html`${h1(L(vm, 'plan', 'Your plan'))}${vm.plans.length ? form(vm, 'plan', html`<fieldset><legend>Choose a plan</legend>${vm.plans.map(p => html`<label class="radio"><input type="radio" name="planId" value="${p.id}"${p.current ? raw(' checked') : ''}> ${p.name}${p.cents ? ` – ${money(p.cents)}/mo` : ''}${p.current ? ' (current)' : ''}</label>`)}</fieldset>${button('Change plan')}`) : html`<p>Plan changes are not available online.</p>`}`); },
  arrangement(vm) { return shell(vm, 'Payment plan', html`${h1(L(vm, 'arrangement', 'Payment plan'))}${vm.account.arrangement ? html`<p>You're paying ${money(vm.account.arrangement.monthlyCents)} per month for ${vm.account.arrangement.months} months.</p>` : form(vm, 'arrangement', html`<p>Spread your balance of ${money(vm.balanceCents)} over monthly payments.</p>${select(vm, { name: 'months', label: 'Number of months', options: [['3', '3 months'], ['6', '6 months'], ['12', '12 months']] })}${button('Set up plan')}`)}`); },
  contact(vm) { return shell(vm, 'Messages', html`${h1(L(vm, 'contact', 'Secure messages'))}${vm.account.messages.length ? html`<ul>${vm.account.messages.map(m => html`<li>${fmtDate(m.at)} – ${m.subject} (${m.status})</li>`)}</ul>` : ''}${form(vm, 'contact', html`${field(vm, { name: 'subject', label: 'Subject' })}<div class="field"><label for="f-message">Message</label><textarea id="f-message" name="message" required>${vm.values.message || ''}</textarea></div>${button('Send message')}`)}`); },
  profile(vm) { return shell(vm, 'Profile', html`${h1(L(vm, 'profile', 'Profile'))}<dl><dt>Name</dt><dd>${vm.persona.name}</dd><dt>Email</dt><dd>${vm.persona.email}</dd><dt>Phone</dt><dd>${vm.account.phone || 'Not provided'}</dd></dl>${form(vm, 'profile', html`${field(vm, { name: 'phone', label: 'Phone number', type: 'tel' })}${button('Update phone')}`)}`); },
  help(vm) { return shell(vm, 'Help center', html`${h1(L(vm, 'help', 'Help center'))}${helpSearchForm(vm)}${helpList(vm)}${profileHelpExcerpts(vm)}`); },
  helpArticle(vm) { return shell(vm, vm.article.title, html`<p><a href="${vm.url('help')}">${L(vm, 'help', 'Help center')}</a> ›</p>${h1(vm.article.title)}${helpBody(vm.article)}${profileArticleExcerpt(vm, vm.article)}`); },
  helpSearch(vm) { return shell(vm, 'Search help', html`${h1('Search results')}${helpSearchForm(vm)}${vm.results.length ? helpList(vm, vm.results) : html`<p>No articles match “${vm.query.q || ''}”.</p>`}`); }
};

function reviewPage(vm, page) {
  const d = vm.draft;
  return shell(vm, 'Review payment', html`${h1('Review your payment')}<dl class="review"><dt>Amount</dt><dd>${money(d.amountCents)}</dd>${d.feeCents ? html`<dt>Convenience fee</dt><dd>${money(d.feeCents)}</dd>` : ''}<dt>Total</dt><dd><strong>${money(d.totalCents)}</strong></dd><dt>Pay from</dt><dd>${methodText(d.method)}</dd><dt>Payment date</dt><dd>${d.payOn ? fmtPayOn(d.payOn) : 'Today'}</dd></dl>${form(vm, page, html`${hidden('token', d.token)}${hidden('op', 'submit')}${checkbox(vm, { name: 'acceptTerms', label: 'I authorize this payment and agree to the payment terms.' })}${button('Submit payment')}`)}${page === 'payReview' ? form(vm, page, html`${hidden('op', 'edit')}${button('Edit payment', { cls: 'btn btn-link' })}`) : ''}`);
}
function receiptPage(vm) {
  const p = vm.payment;
  return shell(vm, 'Payment confirmation', html`${h1(p.status === 'scheduled' ? 'Payment scheduled' : 'Thank you for your payment')}<div class="card receipt"><dl><dt>Confirmation number</dt><dd><strong>${p.confirmation}</strong></dd><dt>Amount</dt><dd>${money(p.amountCents)}</dd>${p.feeCents ? html`<dt>Fee</dt><dd>${money(p.feeCents)}</dd>` : ''}<dt>Method</dt><dd>${vm.paymentMethod ? methodText(vm.paymentMethod) : `****${p.methodLast4}`}</dd><dt>Date</dt><dd>${payDate(p)}</dd><dt>Status</dt><dd>${statusLabel(p.status)}</dd></dl></div>${vm.authenticated ? html`<p><a href="${vm.url('dashboard')}">Back to account overview</a></p>` : html`<p><a href="${vm.url('home')}">Done</a></p>`}`);
}

export function render(page, vm) { const fn = pages[page]; if (!fn) throw new Error(`generic template cannot render ${page}`); return fn(themedVm(vm)); }
// ---------------------------------------------------------------------------------------------------------------
// Per-biller profile helpers (shared by the smarthub, invoicecloud, xpress, paymentus, kubra, doxo and generic
// templates). biller.profile comes from research captures of the biller's real public site (catalog.mjs); it may be
// null, and every field is optional and untrusted: values are cleaned here and always rendered through html``.
// Nothing here creates a dead link: nav labels map to a canonical page or help article, or render as plain text.
// ---------------------------------------------------------------------------------------------------------------
const catalogProfile = id => { try { return id ? loadCatalog().billers.get(id)?.profile ?? null : null; } catch { return null; } };
export function profileOf(vm) {
  const b = vm?.biller || {};
  const p = 'profile' in b ? b.profile : vm?.profile !== undefined ? vm.profile : catalogProfile(b.id);
  return p && typeof p === 'object' ? p : null;
}
const clean = (v, max = 120) => { const s = typeof v === 'string' ? v.replace(/<\/?[a-z][^<>]{0,200}>/gi, ' ').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim() : ''; return s.length > max ? `${s.slice(0, max).replace(/\s+\S*$/, '')}…` : s; };
const JUNK_TITLE = /just a moment|attention required|access denied|forbidden|not found|\b40[0-9]\b|\b50[0-9]\b|\berror\b|captcha|are you (a )?(robot|human)|security check|cloudflare|incapsula|request rejected|untitled|^loading|^redirect|site (is )?(under maintenance|unavailable)|enable javascript|browser (is )?not supported|^document$|^index(\.html?)?$/i;
// Real page title of the biller's site (kind 'website') or login page (kind 'login'), or the fallback.
// Captures sometimes repeat a title or its first segment back to back ("HomeHome | X", "A | BA | B"): keep one copy.
const undouble = t => { for (let k = Math.floor(t.length / 2); k >= 3; k--) if (t.startsWith(t.slice(0, k), k)) return t.slice(k).trim(); return t; };
const LOGINISH = /log ?in|sign ?in|log ?on|sign ?on|account|portal|smarthub|online|pay|my ?[a-z]/i;
export function profileTitle(vm, kind, fallback) {
  if (kind === 'login' && !loginObserved(vm)) return fallback;
  const t = clean(undouble(clean(profileOf(vm)?.[kind]?.title, 400)), 90);
  return t.length >= 3 && !JUNK_TITLE.test(t) && (kind !== 'login' || LOGINISH.test(t)) ? t : fallback;
}
// The observed login page describes this template's own sign-in only when the research ties the biller to this
// portal family (familySignals) or the template is the biller's own site (generic); otherwise it is some other
// login (e.g. the biller's online banking) and is not mirrored onto the family portal.
export function loginObserved(vm) {
  const p = profileOf(vm); if (!p?.login || typeof p.login !== 'object') return false;
  const fam = Array.isArray(p.familySignals) ? p.familySignals.map(String) : [];
  return vm.template === 'generic' || fam.includes(vm.template) || (vm.biller?.family && fam.includes(vm.biller.family));
}
const JUNK_HERO = /cookie|javascript|browser|^welcome$|^home$|^menu$|skip to|^search|404|not found|captcha|just a moment|access denied|^loading|%[a-z0-9_]+|\{\{|\[\[|\bnews(room| flash)?\b|latest|popular resources|quick links|\blog ?in\b|sign ?in|election day|alert:|common requests|(quick|useful|helpful) links|links$|articles$|^[^a-z]*$|^\S+$/i;
export function profileHero(vm) {
  if (vm.tier === 'dedicated') return null;
  const h = clean(String(profileOf(vm)?.website?.heroHeading || '').replace(/\b[a-z]+_[a-z_]+\b/g, ' '), 110); // drop icon-font ligature words (offline_bolt)
  return h.length >= 4 && !JUNK_HERO.test(h) && !HERO_JUNK.test(h) ? h : null;
}

// ---- theme color: accepted only as #rgb/#rrggbb; darkened until white text on it has >= 4.5:1 contrast ----
const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
export const contrastOnWhite = hex => 1.05 / (lum(hex) + 0.05);
export function profileTheme(vm) {
  let c = String(profileOf(vm)?.website?.themeColor || '').trim().toLowerCase();
  const rgb = c.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(?:1|1\.0+|0?\.\d+)\s*)?\)$/);
  if (rgb) c = rgb.slice(1, 4).every(n => Number(n) <= 255) ? `#${rgb.slice(1, 4).map(n => Number(n).toString(16).padStart(2, '0')).join('')}` : '';
  if (/^#[0-9a-f]{3}$/.test(c)) c = `#${[...c.slice(1)].map(x => x + x).join('')}`;
  if (!/^#[0-9a-f]{6}$/.test(c)) return null;
  if (contrastOnWhite(c) < 1.6) return null; // white/near-white or pale tints carry no usable brand color
  for (let i = 0; i < 24 && contrastOnWhite(c) < 4.5; i++) c = `#${[1, 3, 5].map(j => Math.floor(parseInt(c.slice(j, j + 2), 16) * 0.9).toString(16).padStart(2, '0')).join('')}`;
  return contrastOnWhite(c) >= 4.5 ? c : null;
}
// The view model with the biller's observed theme color as its brand color (logo, --brand), when one validates.
export function themedVm(vm) {
  const c = profileTheme(vm);
  return c && vm?.biller?.brand ? { ...vm, biller: { ...vm.biller, brand: { ...vm.biller.brand, primary: c } } } : vm;
}

// ---- nav labels from the real site, mapped to canonical pages ----
const SKIP_LABEL = /^(.*\bmenu\b.*|copy|search|close|open|toggle( navigation)?|navigation|skip( to)?\b.*|english|español|espanol|translate|language|facebook|twitter|x|instagram|linkedin|youtube|tiktok|pinterest|nextdoor|rss|print|share|more|back|top|go|submit|\W*)$/i;
const NAV_RULES = [
  [/employee|staff|vendor|agent|broker|partner|admin|intranet|webmail/i, null],
  [/(sign up for|start|new|connect|establish|request) service|service request|start,? stop|stop service|cancel service|moving|disconnect|transfer service/i, { article: 'cancel-service' }],
  [/assistance|help (paying|with (your|my) bill)|liheap|energy help|hardship|bill help/i, { article: 'payment-assistance' }],
  [/auto[\s-]?pay|automatic (bill )?pay|recurring pay|bank draft|auto[\s-]?draft/i, { page: 'autopay', cap: 'autopay', article: 'autopay' }],
  [/paperless|\be-?bill|e-?statement|go green|electronic (bill|statement)/i, { page: 'paperless', cap: 'paperless', article: 'paperless' }],
  [/register|sign[\s-]?up|enroll|create (an |your )?account|new (user|customer)|first[\s-]time (login|user)/i, { page: 'register', pub: true }],
  [/log[\s-]?in|sign[\s-]?in|log[\s-]?on|sign[\s-]?on|my account|account (login|access)|online (account|services|banking|access)|customer portal|member portal|smarthub|portal/i, { page: 'login', authed: 'dashboard', pub: true }],
  [/ways to pay|payment (options|methods|locations)|how to pay|where to pay/i, { article: 'pay-your-bill' }],
  [/\bpay\b|payments?\b|bill ?pay|quick ?pay|pay ?now/i, { page: 'pay', guest: true, article: 'pay-your-bill' }],
  [/\bbill(s|ing)?\b|statements?|invoices?/i, { page: 'bill', article: 'view-your-bill' }],
  [/contact|customer (service|care)|reach us|call us|locations?|office hours/i, { article: 'contact-us' }],
  [/help|faq|support|questions|resources/i, { page: 'help', pub: true }],
  [/\bhome( page)?$/i, { page: 'home', pub: true }],
  [/^my ?[a-z0-9]{2,}$/i, { page: 'login', authed: 'dashboard', pub: true }]
];
const online = vm => vm.biller?.capabilities?.online_account?.support !== 'unsupported';
const capOk = (vm, cap) => !cap || ['supported', 'unknown'].includes(vm.biller?.capabilities?.[cap]?.support);
const articleHref = (vm, slug) => (vm.help || []).some(a => a.slug === slug) ? vm.url('helpArticle', { slug }) : null;
function navTarget(vm, label) {
  const rule = NAV_RULES.find(([re]) => re.test(label))?.[1];
  if (!rule) return null;
  const pageOk = pg => !!pg && !!vm.has?.(pg) && (online(vm) || pg === 'home' || pg === 'help') && capOk(vm, rule.cap);
  if (rule.guest && !vm.authenticated && vm.biller?.capabilities?.guest_pay?.support === 'supported' && pageOk('guest')) return vm.url('guest');
  const pg = vm.authenticated && rule.authed ? rule.authed : rule.page;
  if (pageOk(pg)) return vm.url(pg);
  return (rule.article && articleHref(vm, rule.article)) || (rule.page === 'help' ? vm.url('help') : null);
}
// [{ label, href|null }] from the observed top-level nav (deduplicated, at most `max`).
export function profileNav(vm, { max = 8 } = {}) {
  const seen = new Set(); const out = [];
  for (const raw of profileOf(vm)?.website?.navLabels || []) {
    const label = clean(raw, 40);
    if (label.length < 2 || label.length > 32 || SKIP_LABEL.test(label) || /[.!?]$/.test(label) || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase()); out.push({ label, href: navTarget(vm, label) });
    if (out.length >= max) break;
  }
  return out;
}
// A compact "biller website" nav bar. Unmapped sections are plain text (they are not part of this simulation).
export function profileNavBar(vm, { cls = 'pf-site', label } = {}) {
  const items = profileNav(vm).filter(i => i.href); // unmapped real-site sections are left out of the header nav
  if (!items.length) return '';
  return html`<nav class="${cls}" aria-label="${label || `${vm.biller.brand?.shortName || vm.biller.name} website`}"><ul>${items.map(i => i.href ? html`<li><a href="${i.href}">${i.label}</a></li>` : html`<li><span class="pf-txt" title="This section of the website is not part of this simulation">${i.label}</span></li>`)}</ul></nav>`;
}

// ---- login page: observed identifier field, submit wording and social providers ----
export function profileLogin(vm, { idLabel = 'Email', submit = 'Sign In' } = {}) {
  const l = loginObserved(vm) ? profileOf(vm).login : {};
  const fields = (Array.isArray(l.fields) ? l.fields : []).map(f => String(f).toLowerCase());
  let label = idLabel;
  if (!fields.includes('email') && fields.includes('username')) label = 'Username or Email';
  else if (!fields.includes('email') && fields.includes('account')) label = 'Account Number or Email';
  const btn = (Array.isArray(l.buttons) ? l.buttons : []).map(b => clean(b, 24)).find(b => /^(log ?in|sign ?in|log ?on|sign ?on|login|continue|next)( now| securely)?$/i.test(b));
  return { idLabel: label, submit: btn || submit, observed: !!(fields.length || btn) };
}
// Social sign-in buttons: only when the server enabled a provider for this biller (vm.socialProviders) and the kit
// helper exists, so a button never points at a route that does not exist.
export function socialRow(vm) {
  const providers = Array.isArray(vm.socialProviders) ? vm.socialProviders : [];
  if (!providers.includes('google') || typeof kitNs.socialButtons !== 'function') return '';
  const out = kitNs.socialButtons(vm);
  return out instanceof kitNs.Raw ? out : raw(out);
}

// ---- help: real excerpts from the biller's site ----
const KIND_SLUG = [[/assist|hardship|senior|arrangement|payment_plan/i, 'payment-assistance'], [/autopay_(cancel|stop)/i, 'cancel-autopay'], [/auto_?pay|recurring/i, 'autopay'], [/paperless|ebill|e_?statement/i, 'paperless'], [/statements?_history|history/i, 'billing-history'], [/view_?bill|bill_?view|statement|read_bill/i, 'view-your-bill'], [/schedul/i, 'scheduled-payments'], [/pay_?bill|ways_to_pay|payment|pay$/i, 'pay-your-bill'], [/regist|enroll|sign_?up|account_setup|create_account/i, 'register'], [/password|reset|forgot|login_help|recover/i, 'reset-password'], [/cancel|stop_service|disconnect|move/i, 'cancel-service'], [/contact|customer_service|phone/i, 'contact-us'], [/faq|help|support/i, 'faq']];
const JUNK_EXCERPT = /enable javascript|javascript is (disabled|required)|cookies? (policy|settings|preferences)|we use cookies|browser (is )?(not supported|out of date|outdated)|just a moment|access denied|captcha|page not found/i;
// Observed help excerpts. help.mjs (helpArticles) already merges the biller's real help text into the matching
// article (filtered: no URLs, prices or phone numbers that disagree with the catalog, capability-gated) and records it
// as article.observed; those vetted excerpts are preferred. Raw profile excerpts are used only when the help center
// carries no observed data at all (older help.mjs), and then only without digits/URLs.
export function profileHelp(vm) {
  const vetted = (vm.help || []).flatMap(a => (Array.isArray(a.observed) ? a.observed : []).map(o => ({ slug: a.slug, kind: String(o?.kind || ''), title: clean(undouble(clean(o?.title || '', 400)).replace(/\s+[|–—]\s+[^|–—]+$/, ''), 90), excerpt: clean(o?.excerpt, 600), inArticle: true })));
  const raw = vetted.length ? [] : (Array.isArray(profileOf(vm)?.help) ? profileOf(vm).help : []).filter(h => h && typeof h === 'object').map(h => ({ kind: String(h.kind || ''), title: clean(undouble(clean(h.title || (Array.isArray(h.headings) ? h.headings[0] : ''), 400)).replace(/\s+[|–—]\s+[^|–—]+$/, ''), 90), excerpt: clean(h.excerpt, 600) }))
    .filter(h => !/https?:\/\/|www\.|\d{3}/.test(h.excerpt)).map(h => ({ ...h, slug: KIND_SLUG.find(([re]) => re.test(h.kind))?.[1] || null }));
  return [...vetted, ...raw].filter(h => h.excerpt.length >= 40 && !JUNK_EXCERPT.test(h.excerpt) && !JUNK_TITLE.test(h.title || ''))
    .map(h => ({ ...h, excerpt: /[.!?…:)"”]$/.test(h.excerpt) ? h.excerpt : `${h.excerpt}…` }));
}
// Excerpt cards for the help index (at most 4).
export function profileHelpExcerpts(vm, { heading } = {}) {
  const items = profileHelp(vm).slice(0, 4);
  if (!items.length) return '';
  const name = vm.biller.brand?.shortName || vm.biller.name;
  return html`<section class="pf-help" aria-label="From the ${name} website"><h2>${heading || `From the ${name} website`}</h2><p class="pf-note">Text captured from ${name}'s public website; details may have changed.</p>${items.map(h => html`<article class="pf-quote">${h.title ? html`<h3>${h.slug && articleHref(vm, h.slug) ? html`<a href="${articleHref(vm, h.slug)}">${h.title}</a>` : h.title}</h3>` : ''}<blockquote><p>${h.excerpt}</p></blockquote></article>`)}</section>`;
}
// The excerpt matching one help article (by slug), as a quoted aside.
export function profileArticleExcerpt(vm, article) {
  // Articles that help.mjs already quoted (article.observed) show the quote in their own paragraphs.
  if (!article || (Array.isArray(article.observed) && article.observed.length)) return '';
  const h = profileHelp(vm).find(x => !x.inArticle && x.slug === article.slug);
  if (!h) return '';
  const name = vm.biller.brand?.shortName || vm.biller.name;
  return html`<aside class="pf-quote" aria-label="From the ${name} website"><p class="pf-src">From the ${name} website${h.title ? html`: <strong>${h.title}</strong>` : ''}</p><blockquote><p>${h.excerpt}</p></blockquote></aside>`;
}
// MFA copy: the server says where the code went (vm.mfaChannel 'email' | 'sms', vm.mfaDestination masked).
export const mfaSent = (vm, emailText) => vm.mfaChannel === 'sms' ? `We texted a 6-digit code to ${vm.mfaDestination || 'the mobile number on your account'}.` : emailText;
// "Resend code" for a pending sign-in (server act() mfa op=resend; superseding code, rate-limited by the engine).
export const mfaResend = (vm, { cls = 'btn btn-link', label = 'Resend code' } = {}) => form(vm, 'mfa', html`${hidden('op', 'resend')}${hidden('next', vm.query.next || '')}<p class="mfa-resend-row">Didn't get it? ${button(label, { cls })}</p>`, { cls: 'mfa-resend' });
export const profileCss = `.pf-site{max-width:100%;overflow:hidden}.pf-site ul{display:flex;flex-wrap:wrap;gap:2px 4px;list-style:none;margin:0;padding:0}.pf-site li{min-width:0}.pf-site a,.pf-site .pf-txt{display:inline-block;padding:6px 10px;font-size:14px;line-height:1.3;overflow-wrap:anywhere}.pf-site .pf-txt{color:inherit;opacity:.78;cursor:default}
.pf-hero{margin:4px 0 10px;font-size:1.15em;font-weight:600;overflow-wrap:anywhere}
.pf-help{margin:18px 0}.pf-help h2{font-size:1.1em;margin:0 0 4px}.pf-note,.pf-src{font-size:13px;opacity:.8;margin:0 0 8px}.pf-quote{margin:10px 0;overflow-wrap:anywhere}.pf-quote h3{font-size:1em;margin:0 0 4px}.pf-quote blockquote{margin:0;padding:8px 12px;border-left:4px solid var(--brand);background:rgba(127,127,127,.08)}.pf-quote blockquote p{margin:0}
.pf-social{margin:12px 0}
@media(max-width:600px){.pf-site a,.pf-site .pf-txt{padding:4px 7px;font-size:13px}}
.mfa-resend{margin:10px 0 0}.mfa-resend-row{margin:0;font-size:14px}.linkbtn{border:0;background:none;padding:2px 0;font:inherit;color:inherit;text-decoration:underline;cursor:pointer;font-weight:600}.linkbtn:focus-visible{outline:2px solid currentColor;outline-offset:2px}`;

export const css = `*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2933;background:#f4f6f8}a{color:var(--brand)}
.top{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center;padding:12px 24px;background:#fff;border-bottom:3px solid var(--brand)}.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;text-decoration:none;color:#1f2933}.logo{width:40px;height:40px}
.nav{display:flex;gap:4px;flex-wrap:wrap;background:var(--brand);padding:0 16px}.nav a{color:#fff;padding:10px 14px;text-decoration:none;font-weight:500}.nav a:hover{background:rgba(255,255,255,.15)}
main{max-width:960px;margin:24px auto;padding:0 16px}main.wide{max-width:1180px}.foot{text-align:center;color:#52606d;font-size:13px;padding:24px}
.btn{display:inline-block;border:1px solid var(--brand);background:#fff;color:var(--brand);padding:9px 18px;border-radius:6px;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}.btn-primary{background:var(--brand);color:#fff}.btn-danger{background:#b42318;border-color:#b42318;color:#fff}.btn-link{border:0;background:none;padding:0;color:var(--brand);text-decoration:underline}.btn-small{padding:6px 12px}
.panel{max-width:440px;margin:0 auto;background:#fff;padding:28px;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.12)}.card{background:#fff;padding:20px;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.1);margin-bottom:16px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}@media(max-width:720px){.grid2,.grid3{grid-template-columns:1fr}}
.hero{background:#fff;padding:32px;border-radius:10px;margin-bottom:16px;border-left:6px solid var(--brand)}.lead{font-size:18px;color:#52606d}.big{font-size:34px;font-weight:700;margin:4px 0}.muted{color:#7b8794}
.field{margin:12px 0}.field label{display:block;font-weight:600;margin-bottom:4px}.field input,.field select,.field textarea{width:100%;padding:9px 10px;border:1px solid #9aa5b1;border-radius:6px;font:inherit}.help{color:#7b8794}fieldset{border:1px solid #d9e2ec;border-radius:8px;margin:14px 0;padding:12px 16px}legend{font-weight:700}.radio,.check{display:block;margin:8px 0}.other-amount{width:120px;padding:4px 6px}
.alert{padding:12px 16px;border-radius:6px;margin-bottom:16px}.alert-error{background:#fde8e8;color:#9b1c1c;border:1px solid #f8b4b4}.alert-ok{background:#e6f6ec;color:#05603a;border:1px solid #a6e3bf}
.table{width:100%;border-collapse:collapse;background:#fff}.table th,.table td{text-align:left;padding:10px;border-bottom:1px solid #e4e7eb}.table th{background:#f0f4f8}dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px}dt{color:#52606d}dd{margin:0}
.help-search{display:flex;gap:8px;margin:12px 0}.help-search input{flex:1;padding:8px;border:1px solid #9aa5b1;border-radius:6px}.help-list li{margin:6px 0}.steps li{margin:4px 0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.wallet li{display:flex;gap:12px;align-items:center}.wallet form{display:inline}details summary{cursor:pointer;color:var(--brand);margin:8px 0}
${billingCss}
.nav .nav-txt{color:#fff;opacity:.8;padding:10px 14px;cursor:default}.sub-h{font-size:18px;margin:0 0 6px;color:#52606d}
${profileCss}
@media(max-width:600px){.nav .nav-txt{padding:9px 10px}.top{padding:10px 14px}.nav{padding:0 6px}.nav a{padding:9px 10px}.panel{padding:20px 16px}.hero{padding:20px 16px}dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:8px}}`;

