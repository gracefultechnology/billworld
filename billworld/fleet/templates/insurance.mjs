// Insurance carrier policyholder portal: "My Policies" home, a Billing & Payments section with a
// three-step "Make a payment" wizard (amount -> payment method -> review), recurring EFT, pay plans,
// paperless documents, and a no-login one-time payment keyed by policy number + last name + ZIP.
import { observe, finish, obsNav, obsFooter, heroText, heroLine, idLabel as obsIdLabel, submitLabel, social, helpExcerpts, articleExcerpt, mfaLead, mfaResend, OBS_CSS } from './_observed.mjs';
import { html, raw, doc, logo, alert, form, field, select, checkbox, button, hidden, amountChooser, methodChooser, newMethodFields, dateField, table, paymentRows, helpList, helpBody, helpSearchForm, money, fmtDate, methodText, statusLabel } from '../kit.mjs';

export const meta = {
  id: 'insurance',
  name: 'Insurance carrier policyholder portal',
  description: 'Personal-lines carrier self-service: My Policies, Billing & Payments, Make a payment (amount, payment method, review), recurring EFT, pay plan, payment extension, paperless documents, contact my agent, and a one-time payment without logging in (policy number, last name, ZIP).',
  families: ['insurance-auto', 'insurance-home', 'insurance-life', 'insurance-health', 'insurance-dental', 'insurance-vision', 'insurance-flood', 'insurance-ltc', 'insurance-pet', 'insurance-supplemental', 'insurance-earthquake', 'insurance-other'],
  sources: [
    'https://www.nationwide.com/bill-pay',
    'https://www.mercuryinsurance.com/payment/one-time-payment.html',
    'https://www.statefarm.com/customer-care/manage-your-accounts/pay-insurance-bill',
    'https://www.allstate.com/help-support/account/express-access (search result summary; page fetch timed out)',
    'https://www.securityfirstflorida.com/make-a-payment/ (search result summary)',
    'https://mwg.aaa.com/insurance/csaa-quick-pay (search result summary)'
  ],
  evidence: {
    observed_public: [
      'Public bill-pay pages offer "Pay now" plus "Log in to pay your bill" side by side (Nationwide).',
      'Pay-without-login asks for "account or policy number and ZIP code" (Nationwide); policy number, last name and ZIP (Allstate Express Access summary); policy number or email (Mercury "Make a One-Time Payment").',
      'Recurring bank drafts are called "Recurring electronic funds transfer (EFT)" (Nationwide); carriers link "Enroll in Autopay" from payment pages (Mercury).',
      'Payment channels listed: online, app, phone, mail (check or money order), EFT (Nationwide, State Farm).'
    ],
    documented: ['Policy number, premium amounts and the help-center phone/mail facts come from the research record for each biller.'],
    synthetic: [
      'Exact sidebar labels (My Policies, Billing & Payments, Billing documents, Pay plan, Payment extension, Contact my agent) are a composite of common carrier wording, not a copy of any one carrier.',
      'Three-step payment wizard order (amount, payment method, review) is synthesized from typical carrier flows.',
      'Visual style (utility bar, white masthead, left account sidebar) is a generic carrier composite; no carrier logos or artwork are reproduced.'
    ]
  }
};

export const routes = {
  home: '/', login: '/login', loginPassword: '/login/password', mfa: '/login/verify-identity', register: '/create-account', verify: '/create-account/verify', forgot: '/login/forgot', reset: '/login/reset',
  guest: '/pay-without-login', guestPay: '/pay-without-login/payment', guestReview: '/pay-without-login/review', guestReceipt: '/pay-without-login/confirmation/:id',
  dashboard: '/policyholder/my-policies', bill: '/policyholder/billing', statements: '/policyholder/billing/documents', statement: '/policyholder/billing/documents/:id.pdf',
  pay: '/policyholder/billing/make-a-payment', payMethod: '/policyholder/billing/make-a-payment/payment-method', payReview: '/policyholder/billing/make-a-payment/review', payReceipt: '/policyholder/billing/make-a-payment/confirmation/:id',
  history: '/policyholder/billing/payment-history', autopay: '/policyholder/billing/automatic-payments', paperless: '/policyholder/documents/paperless', wallet: '/policyholder/billing/payment-methods',
  cancel: '/policyholder/policy/cancel', plan: '/policyholder/billing/pay-plan', arrangement: '/policyholder/billing/payment-extension', contact: '/policyholder/contact-my-agent', profile: '/policyholder/profile', logout: '/logout',
  help: '/support', helpArticle: '/support/article/:slug', helpSearch: '/support/search'
};
export const flow = { paySteps: ['pay', 'payMethod', 'payReview'], loginSteps: 1, guestSteps: ['guest', 'guestPay', 'guestReview'] };

const POLICY_LABEL = { 'insurance-auto': 'Auto policy', 'insurance-home': 'Homeowners policy', 'insurance-life': 'Life insurance policy', 'insurance-health': 'Health plan', 'insurance-dental': 'Dental plan', 'insurance-vision': 'Vision plan', 'insurance-flood': 'Flood policy', 'insurance-ltc': 'Long-term care policy', 'insurance-pet': 'Pet insurance policy', 'insurance-supplemental': 'Supplemental policy', 'insurance-earthquake': 'Earthquake policy' };
const policyLabel = vm => POLICY_LABEL[vm.biller.billType] || 'Insurance policy';
const isPlan = vm => /health|dental|vision/.test(vm.biller.billType || '');
const offline = vm => vm.biller.capabilities.online_account.support === 'unsupported';
const guestOk = vm => vm.biller.capabilities.guest_pay.support === 'supported';
const cap = (vm, k) => vm.biller.capabilities[k]?.support === 'supported';
const idLabel = vm => isPlan(vm) ? 'Member ID' : 'Policy number';
const policyNo = vm => vm.account?.policyNumber || vm.account?.accountNumber || '';
const h1 = t => html`<h1>${t}</h1>`;

function masthead(vm) {
  const authed = vm.authenticated;
  return html`<div class="utility"><div class="wrap"><span>${vm.biller.phone ? html`Customer service <strong>${vm.biller.phone}</strong>` : 'Customer service'}</span><span><a href="${vm.url('help')}">Support</a>${!offline(vm) && !authed && guestOk(vm) ? html` · <a href="${vm.url('guest')}">Make a payment</a>` : ''}</span></div></div>
<header class="mast"><div class="wrap"><a class="brand" href="${vm.url(authed ? 'dashboard' : 'home')}">${logo(vm)}<span>${vm.biller.brand.shortName}</span></a>${offline(vm) ? '' : authed ? html`<div class="who"><span class="hello">Welcome, ${vm.persona.first}</span><a href="${vm.url('profile')}">My profile</a><a class="btn btn-outline btn-small" href="${vm.url('logout')}">Log out</a></div>` : html`<div class="who"><a class="btn btn-outline btn-small" href="${vm.url('register')}">Create account</a><a class="btn btn-primary btn-small" href="${vm.url('login')}">Log in</a></div>`}</div></header>`;
}
function sidebar(vm) {
  const on = p => vm.page === p || (p === 'pay' && ['payMethod', 'payReview', 'payReceipt'].includes(vm.page)) ? 'on' : '';
  const link = (p, label) => html`<li><a class="${on(p)}" href="${vm.url(p)}">${label}</a></li>`;
  return html`<aside class="side" aria-label="Policyholder menu"><p class="side-h">My Account</p><ul>${link('dashboard', 'My Policies')}</ul>
<p class="side-h">Billing &amp; Payments</p><ul>${link('bill', 'Billing summary')}${link('pay', 'Make a payment')}${link('history', 'Payment history')}${link('statements', 'Billing documents')}${cap(vm, 'autopay') ? link('autopay', 'Automatic payments (EFT)') : ''}${link('plan', 'Pay plan')}${link('wallet', 'Payment methods')}${link('arrangement', 'Payment extension')}</ul>
<p class="side-h">Documents &amp; Settings</p><ul>${cap(vm, 'paperless') ? link('paperless', 'Paperless preferences') : ''}${link('profile', 'Profile & contact info')}${link('contact', 'Contact my agent')}${cap(vm, 'cancel_service') ? link('cancel', isPlan(vm) ? 'Cancel coverage' : 'Cancel policy') : ''}${link('help', 'Support center')}</ul></aside>`;
}
function shell(vm, title, body) {
  const authed = vm.authenticated && !offline(vm);
  const publicNav = offline(vm) ? html`<nav class="tabs" aria-label="Main"><div class="wrap"><a href="${vm.url('home')}">Home</a><a href="${vm.url('help')}">Support</a></div></nav>`
    : !authed ? html`<nav class="tabs" aria-label="Main"><div class="wrap"><a href="${vm.url('home')}">Home</a>${guestOk(vm) ? html`<a href="${vm.url('guest')}">Pay a bill</a>` : html`<a href="${vm.url('login')}">Pay a bill</a>`}<a href="${vm.url('helpArticle', { slug: 'pay-your-bill' })}">Ways to pay</a><a href="${vm.url('help')}">Support</a></div></nav>` : '';
  return doc(vm, {
    title: `${title} | ${vm.biller.brand.shortName}`, bodyClass: authed ? 'authed' : 'public',
    body: html`${masthead(vm)}${publicNav}${obsNav(vm)}<div class="wrap page">${authed ? sidebar(vm) : ''}<main class="${authed ? 'content' : 'content solo'}">${alert(vm)}${body}</main></div>
<footer class="foot"><div class="wrap"><p><strong>${vm.biller.name}</strong>${vm.biller.phone ? ` · Policy service ${vm.biller.phone}` : ''}${vm.biller.payPhone ? ` · Pay by phone ${vm.biller.payPhone}` : ''}</p><p><a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact us</a> · <a href="${vm.url('help')}">Support center</a> · <span>Coverage is subject to the terms of your policy.</span></p>${!vm.authenticated ? obsFooter(vm) : ''}</div></footer>`
  });
}
const stepper = (vm, n) => html`<ol class="stepper" aria-label="Payment steps">${['Payment amount', 'Payment method', 'Review & submit'].map((s, i) => html`<li class="${i + 1 === n ? 'cur' : i + 1 < n ? 'done' : ''}"><span>${i + 1}</span>${s}</li>`)}</ol>`;
const policyBox = vm => html`<div class="policy-strip"><div><span class="lbl">${policyLabel(vm)}</span><strong>${policyNo(vm)}</strong></div><div><span class="lbl">Billing account</span><strong>${vm.accountMasked}</strong></div><div><span class="lbl">Amount due</span><strong>${money(vm.balanceCents)}</strong></div><div><span class="lbl">Due date</span><strong>${vm.dueText}</strong></div></div>`;

const pages = {
  home(vm) {
    if (offline(vm)) return shell(vm, 'Paying your premium', html`${h1(`Paying your ${vm.biller.name} premium`)}<p class="lead">Online account access and online bill payment are not available for this biller.</p><section class="card"><h2>How to pay</h2>${helpBody(vm.help.find(a => a.slug === 'pay-your-bill'))}</section>${vm.biller.phone ? html`<p>Questions? Call <strong>${vm.biller.phone}</strong>.</p>` : html`<p>Use the contact information printed on your billing notice.</p>`}`);
    return shell(vm, 'Pay your insurance bill', html`<section class="hero"><div class="hero-text">${h1('Pay your insurance bill')}${heroLine(vm)}<p class="lead">Log in to manage your ${isPlan(vm) ? 'plan' : 'policy'}, see your billing summary and set up automatic payments — or make a quick one-time payment.</p></div>
<div class="hero-actions card"><h2>Log in to pay your bill</h2><p>Manage billing, documents and your pay plan.</p><p><a class="btn btn-primary btn-block" href="${vm.url('login')}">Log in</a></p><p class="small">New here? <a href="${vm.url('register')}">Create an account</a></p>${guestOk(vm) ? html`<hr><h2>Pay without logging in</h2><p>Have your policy number, last name and ZIP code ready.</p><p><a class="btn btn-outline btn-block" href="${vm.url('guest')}">Pay now</a></p>` : ''}</div></section>
<section class="grid3"><div class="card"><h3>Automatic payments</h3><p>Have your premium drafted from your bank account each installment with recurring EFT.</p><a href="${vm.url('helpArticle', { slug: cap(vm, 'autopay') ? 'autopay' : 'pay-your-bill' })}">Learn about automatic payments</a></div><div class="card"><h3>Other ways to pay</h3><p>Pay by phone${vm.biller.payPhone ? ` at ${vm.biller.payPhone}` : ''}, by mail with a check or money order, or through your agent.</p><a href="${vm.url('helpArticle', { slug: 'pay-your-bill' })}">See all payment options</a></div><div class="card"><h3>Billing questions?</h3>${helpSearchForm(vm, { placeholder: 'Search billing help' })}</div></section>`);
  },
  login(vm) {
    return shell(vm, 'Log in', html`<div class="panel">${h1('Log in to your account')}${form(vm, 'login', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'username', label: obsIdLabel(vm, 'User ID or email'), autocomplete: 'username' })}${field(vm, { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' })}${button(submitLabel(vm, 'Log in'), { cls: 'btn btn-primary btn-block' })}`)}${social(vm)}<p class="small"><a href="${vm.url('forgot')}">Forgot user ID or password?</a></p><hr><p class="small">Don't have an account? <a href="${vm.url('register')}">Create one</a> with your billing account number.</p>${guestOk(vm) ? html`<p class="small"><a href="${vm.url('guest')}">Make a payment without logging in</a></p>` : ''}</div>`);
  },
  loginPassword(vm) { return pages.login(vm); },
  mfa(vm) { return shell(vm, 'Verify your identity', html`<div class="panel">${h1('Verify your identity')}<p>${mfaLead(vm, `For your security we sent a 6-digit verification code to the email address on your policy.`)}</p>${form(vm, 'mfa', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'code', label: 'Verification code', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' })}${button('Verify', { cls: 'btn btn-primary btn-block' })}`)}${mfaResend(vm)}</div>`); },
  register(vm) {
    return shell(vm, 'Create account', html`<div class="panel wide-panel">${h1('Create your online account')}<p>You'll need the billing account number shown on your billing notice or declarations page.</p>${form(vm, 'register', html`<fieldset><legend>Find your policy</legend>${field(vm, { name: 'accountNumber', label: 'Billing account number', inputmode: 'numeric' })}${field(vm, { name: 'lastName', label: 'Named insured last name', autocomplete: 'family-name' })}${field(vm, { name: 'zip', label: 'Mailing ZIP code', inputmode: 'numeric', maxlength: 5, autocomplete: 'postal-code' })}</fieldset><fieldset><legend>Sign-in details</legend>${field(vm, { name: 'email', label: 'Email address', type: 'email', autocomplete: 'email' })}${field(vm, { name: 'password', label: 'Create password', type: 'password', autocomplete: 'new-password', help: 'At least 8 characters with upper and lower case letters, a number and a symbol.' })}${field(vm, { name: 'confirm', label: 'Confirm password', type: 'password', autocomplete: 'new-password' })}</fieldset>${button('Create account', { cls: 'btn btn-primary' })}`)}</div>`);
  },
  verify(vm) { return shell(vm, 'Verify email', html`<div class="panel">${h1('Check your email')}<p>Open the verification link we emailed you to activate your account.</p><p><a href="${vm.url('login')}">Back to log in</a></p></div>`); },
  forgot(vm) { return shell(vm, 'Forgot user ID or password', html`<div class="panel">${h1('Forgot user ID or password')}<p>Enter the email address or billing account number on your policy. We'll email a verification code.</p>${form(vm, 'forgot', html`${field(vm, { name: 'identifier', label: 'Email or billing account number', autocomplete: 'username' })}${button('Send code', { cls: 'btn btn-primary btn-block' })}`)}<p class="small"><a href="${vm.url('login')}">Back to log in</a></p></div>`); },
  reset(vm) { return shell(vm, 'Reset password', html`<div class="panel">${h1('Reset your password')}<p>Enter the verification code we emailed you and choose a new password.</p>${form(vm, 'reset', html`${vm.query.token ? hidden('token', vm.query.token) : field(vm, { name: 'code', label: 'Verification code', inputmode: 'numeric', autocomplete: 'one-time-code' })}${field(vm, { name: 'password', label: 'New password', type: 'password', autocomplete: 'new-password' })}${field(vm, { name: 'confirm', label: 'Confirm new password', type: 'password', autocomplete: 'new-password' })}${button('Reset password', { cls: 'btn btn-primary btn-block' })}`)}</div>`); },
  guest(vm) {
    return shell(vm, 'Pay without logging in', html`<div class="panel wide-panel">${h1('Make a one-time payment')}<p>Pay your premium without logging in. Your policy number is on your billing notice, ID card or declarations page.</p>${form(vm, 'guest', html`${field(vm, { name: 'accountNumber', label: `${idLabel(vm)} or billing account number`, help: 'Enter letters and numbers without spaces.' })}${field(vm, { name: 'lastName', label: 'Named insured last name', autocomplete: 'family-name' })}${field(vm, { name: 'zip', label: 'ZIP code', inputmode: 'numeric', maxlength: 5, autocomplete: 'postal-code' })}${button('Continue', { cls: 'btn btn-primary' })}`)}<p class="small">Want to manage billing online? <a href="${vm.url('register')}">Create an account</a>.</p></div>`);
  },
  guestPay(vm) {
    return shell(vm, 'One-time payment', html`${h1('One-time payment')}<div class="policy-strip"><div><span class="lbl">${policyLabel(vm)}</span><strong>${policyNo(vm).replace(/.(?=.{4})/g, '•')}</strong></div><div><span class="lbl">Amount due</span><strong>${money(vm.balanceCents)}</strong></div><div><span class="lbl">Due date</span><strong>${vm.dueText}</strong></div></div>${form(vm, 'guestPay', html`<section class="card">${amountChooser(vm, { labels: { legend: 'How much would you like to pay?', due: 'Current amount due', other: 'Other amount' } })}</section><section class="card"><fieldset><legend>Payment information</legend>${newMethodFields(vm)}</fieldset></section>${button('Continue to review', { cls: 'btn btn-primary' })}`)}`);
  },
  guestReview(vm) { return reviewPage(vm, 'guestReview'); },
  guestReceipt(vm) { return receiptPage(vm); },
  dashboard(vm) {
    const st = vm.service.status;
    return shell(vm, 'My Policies', html`${h1('My Policies')}<section class="policy-card"><header><div><span class="tag">${st === 'active' ? 'Active' : st === 'cancel_pending' ? `Cancels ${fmtDate(vm.service.cancelAt)}` : 'Cancelled'}</span><h2>${policyLabel(vm)}</h2><p class="muted">${idLabel(vm)} <strong>${policyNo(vm)}</strong> · ${isPlan(vm) ? 'Subscriber' : 'Named insured'} ${vm.persona.name}</p></div><div class="due"><span class="lbl">Amount due</span><span class="big">${money(vm.balanceCents)}</span><span>Due ${vm.dueText}</span><a class="btn btn-primary" href="${vm.url('pay')}">Make a payment</a></div></header>
<dl class="facts"><dt>Billing account</dt><dd>${vm.accountMasked}</dd><dt>Policy address</dt><dd>${vm.account.serviceAddress}</dd><dt>Pay plan</dt><dd>${vm.plans.find(p => p.current)?.name || 'Monthly installments'} · <a href="${vm.url('plan')}">Change pay plan</a></dd>${cap(vm, 'autopay') ? html`<dt>Automatic payments</dt><dd>${vm.autopay.enrolled ? 'Enrolled (recurring EFT)' : 'Not enrolled'} · <a href="${vm.url('autopay')}">${vm.autopay.enrolled ? 'Manage' : 'Enroll'}</a></dd>` : ''}${cap(vm, 'paperless') ? html`<dt>Document delivery</dt><dd>${vm.account.paperless ? 'Paperless (email)' : 'U.S. Mail'} · <a href="${vm.url('paperless')}">Change</a></dd>` : ''}</dl>
${vm.pendingPayments.length || vm.scheduled.length ? html`<p class="note">${vm.pendingPayments.length ? `${vm.pendingPayments.length} payment(s) processing. ` : ''}${vm.scheduled.length ? `${vm.scheduled.length} scheduled payment(s). ` : ''}<a href="${vm.url('history')}">View payment history</a></p>` : ''}</section>
<section class="grid3"><a class="tile" href="${vm.url('bill')}"><strong>Billing summary</strong><span>See what's due and your installment breakdown</span></a><a class="tile" href="${vm.url('statements')}"><strong>Billing documents</strong><span>Billing notices and statements (PDF)</span></a><a class="tile" href="${vm.url('history')}"><strong>Payment history</strong><span>Payments made and scheduled</span></a></section>`);
  },
  bill(vm) {
    const inv = vm.invoice;
    return shell(vm, 'Billing summary', html`${h1('Billing summary')}${policyBox(vm)}<section class="card"><h2>Current installment</h2><p class="muted">Billing notice ${inv.number} · Coverage period ${inv.period}</p>${table(['Description', 'Amount'], [...inv.lines.map(l => [l.desc === 'Premium' ? `${policyLabel(vm)} premium installment` : l.desc, money(l.cents)]), [html`<strong>Total installment due</strong>`, html`<strong>${money(inv.amountCents)}</strong>`]])}<p>Due date: <strong>${fmtDate(inv.dueAt)}</strong>. Payments received after the due date may result in a late fee or a notice of cancellation for nonpayment.</p><p class="actions"><a class="btn btn-primary" href="${vm.url('pay')}">Make a payment</a><a class="btn btn-outline" href="${vm.url('statement', { id: inv.id })}">View billing notice (PDF)</a></p></section>`);
  },
  statements(vm) { return shell(vm, 'Billing documents', html`${h1('Billing documents')}<p>Billing notices for the last 12 months.</p>${table(['Notice date', 'Installment', 'Due date', 'Document'], vm.invoices.map(i => [fmtDate(i.issuedAt), money(i.amountCents), fmtDate(i.dueAt), html`<a href="${vm.url('statement', { id: i.id })}">Billing notice (PDF)</a>`]))}`); },
  pay(vm) {
    return shell(vm, 'Make a payment', html`${h1('Make a payment')}${stepper(vm, 1)}${policyBox(vm)}${form(vm, 'pay', html`<section class="card">${amountChooser(vm, { labels: { legend: 'Payment amount', due: 'Current amount due', other: 'Other amount' } })}${dateField(vm, { label: 'Payment date' })}<p class="small muted">Choose a future date to schedule your payment. Scheduled payments can be cancelled from Payment history.</p></section>${button('Next: Payment method', { cls: 'btn btn-primary' })}`)}`);
  },
  payMethod(vm) {
    return shell(vm, 'Make a payment', html`${h1('Make a payment')}${stepper(vm, 2)}${vm.draft?.amountCents ? html`<p class="lead">Paying <strong>${money(vm.draft.amountCents)}</strong>${vm.draft.payOn ? ` on ${vm.draft.payOn}` : ' today'} · <a href="${vm.url('pay')}">Change amount</a></p>` : ''}${form(vm, 'payMethod', html`<section class="card">${!vm.draft?.amountCents ? amountChooser(vm) : ''}${methodChooser(vm, { title: 'Payment method' })}</section>${button('Next: Review', { cls: 'btn btn-primary' })}`)}`);
  },
  payReview(vm) { return reviewPage(vm, 'payReview'); },
  payReceipt(vm) { return receiptPage(vm); },
  history(vm) { return shell(vm, 'Payment history', html`${h1('Payment history')}<p>Payments made in the last 12 months. You can cancel a scheduled payment before its payment date.</p>${table(['Payment date', 'Amount', 'Paid with', 'Confirmation #', 'Status', ''], paymentRows(vm))}`); },
  autopay(vm) {
    const ap = vm.autopay;
    return shell(vm, 'Automatic payments', html`${h1('Automatic payments (EFT)')}<p>With recurring electronic funds transfer, each installment is drafted from your account on its due date. You'll still receive a billing notice showing the draft amount and date.</p>
${ap.enrolled ? html`<section class="card ok-card"><h2>You're enrolled</h2><p>We draft your ${ap.policy === 'fixed' ? `fixed amount of ${money(ap.fixedCents)}` : 'full installment amount'} on each due date from ${vm.autopayMethod ? methodText(vm.autopayMethod) : 'your account on file'}.</p>${form(vm, 'autopay', html`${hidden('action', 'cancel')}${checkbox(vm, { name: 'confirm', label: 'I understand future installments will not be drafted automatically and I must pay each bill by its due date.' })}${button('Stop automatic payments', { cls: 'btn btn-danger' })}`)}</section><h2>Change automatic payments</h2>` : ''}
${form(vm, 'autopay', html`${hidden('action', 'enroll')}<section class="card">${methodChooser(vm, { title: 'Draft from' })}${select(vm, { name: 'policy', label: 'Draft amount', options: [['full', 'Full installment amount'], ['fixed', 'Fixed amount']] })}${field(vm, { name: 'fixedAmount', label: 'Fixed amount (if selected)', required: false, inputmode: 'decimal' })}${checkbox(vm, { name: 'acceptTerms', label: `I authorize ${vm.biller.brand.shortName} to initiate recurring electronic debits for my premium installments until I cancel this authorization.` })}</section>${button(ap.enrolled ? 'Save changes' : 'Enroll in automatic payments', { cls: 'btn btn-primary' })}`)}`);
  },
  paperless(vm) {
    return shell(vm, 'Paperless preferences', html`${h1('Paperless preferences')}<section class="card"><p>Billing notices and policy documents are currently delivered by <strong>${vm.account.paperless ? 'email (paperless)' : 'U.S. Mail'}</strong>.</p>${form(vm, 'paperless', html`${hidden('paperless', vm.account.paperless ? 'off' : 'on')}${!vm.account.paperless ? field(vm, { name: 'email', label: 'Email for billing notices and policy documents', type: 'email', value: vm.persona.email }) : ''}${button(vm.account.paperless ? 'Switch to paper documents' : 'Go paperless', { cls: 'btn btn-primary' })}`)}</section>`);
  },
  wallet(vm) {
    return shell(vm, 'Payment methods', html`${h1('Payment methods')}<section class="card"><h2>Saved payment methods</h2><ul class="wallet">${vm.methods.map(m => html`<li><span>${methodText(m)}${m.nickname ? html` <span class="muted">(${m.nickname})</span>` : ''}</span>${form(vm, 'wallet', html`${hidden('op', 'remove')}${hidden('methodId', m.id)}${button('Remove', { cls: 'btn btn-link' })}`)}</li>`)}</ul></section><section class="card"><h2>Add a payment method</h2>${form(vm, 'wallet', html`${hidden('op', 'add')}${newMethodFields(vm)}${field(vm, { name: 'nickname', label: 'Nickname (optional)', required: false })}${button('Save payment method', { cls: 'btn btn-primary' })}`)}</section>`);
  },
  cancel(vm) {
    const noun = isPlan(vm) ? 'coverage' : 'policy';
    if (vm.service.status !== 'active' && vm.step !== 'done') return shell(vm, 'Cancel', html`${h1(`Cancel ${noun}`)}<section class="card"><p>Your ${noun} ${vm.service.status === 'cancel_pending' ? `is scheduled to cancel on ${fmtDate(vm.service.cancelAt)}` : 'is cancelled'}.</p>${vm.service.status === 'cancel_pending' ? form(vm, 'cancel', html`${hidden('step', 'undo')}${button(`Keep my ${noun}`, { cls: 'btn btn-primary' })}`) : ''}</section>`);
    const steps = {
      reason: html`${h1(`Cancel ${noun}`)}<p>Before you cancel, talk with your agent about coverage changes or a different pay plan. ${isPlan(vm) ? '' : 'If you are financing or leasing a vehicle or have a mortgage, your lender may require continuous coverage.'}</p>${form(vm, 'cancel', html`${hidden('step', 'reason')}<section class="card">${select(vm, { name: 'reason', label: 'Reason for cancelling', options: [['', 'Select a reason'], ['moving', 'Moving / no longer need coverage'], ['cost', 'Premium too high'], ['switching', 'Purchased coverage elsewhere'], ['sold', 'Sold the vehicle or property'], ['other', 'Other']] })}</section>${button('Continue', { cls: 'btn btn-primary' })}`)}`,
      offer: html`${h1('Before you go')}<section class="card offer"><h2>Lower your installment instead</h2><p>Switch pay plans or adjust coverage and save on your next three installments.</p>${form(vm, 'cancel', html`${hidden('step', 'offer')}${button('Keep my policy with the discount', { name: 'accept', value: 'yes' })} ${button('No thanks, continue cancelling', { cls: 'btn btn-outline', name: 'accept', value: 'no' })}`)}</section>`,
      confirm: html`${h1('Confirm cancellation')}<p>Choose the date your ${noun} should end. Any unearned premium is refunded; any premium owed through the cancellation date will be billed.</p>${form(vm, 'cancel', html`${hidden('step', 'confirm')}<section class="card">${dateField(vm, { name: 'effectiveDate', label: 'Cancellation effective date' })}${checkbox(vm, { name: 'confirm', label: `Yes, cancel my ${noun} on this date.` })}</section>${button(`Cancel ${noun}`, { cls: 'btn btn-danger' })}`)}`,
      done: html`${h1('Cancellation request received')}<section class="card ok-card"><p>Your ${noun} will cancel on <strong>${vm.service.cancelAt ? fmtDate(vm.service.cancelAt) : ''}</strong>. Confirmation number <strong>${vm.service.confirmation || ''}</strong>.</p><p><a href="${vm.url('dashboard')}">Back to My Policies</a></p></section>`,
      kept: html`${h1('Thanks for staying with us')}<section class="card"><p>Your discount has been applied to your upcoming installments.</p></section>`
    };
    return shell(vm, 'Cancel', steps[vm.step]);
  },
  plan(vm) {
    return shell(vm, 'Pay plan', html`${h1('Pay plan')}<p>Your pay plan sets how often you're billed for your premium. Installment fees may apply to plans with more than one payment.</p>${vm.plans.length ? form(vm, 'plan', html`<section class="card"><fieldset><legend>Choose a pay plan</legend>${vm.plans.map(p => html`<label class="radio"><input type="radio" name="planId" value="${p.id}"${p.current ? raw(' checked') : ''}> <span>${p.name}${p.current ? ' (current)' : ''}</span></label>`)}</fieldset></section>${button('Update pay plan', { cls: 'btn btn-primary' })}`) : html`<section class="card"><p>Pay plan changes are handled by your agent. <a href="${vm.url('contact')}">Contact my agent</a></p></section>`}`);
  },
  arrangement(vm) {
    return shell(vm, 'Payment extension', html`${h1('Payment extension')}${vm.account.arrangement ? html`<section class="card ok-card"><p>Your balance is split into ${vm.account.arrangement.months} payments of ${money(vm.account.arrangement.monthlyCents)}.</p></section>` : form(vm, 'arrangement', html`<section class="card"><p>Can't pay your full balance of <strong>${money(vm.balanceCents)}</strong>? Spread it over additional installments to keep your coverage in force.</p>${select(vm, { name: 'months', label: 'Number of installments', options: [['3', '3 installments'], ['6', '6 installments'], ['12', '12 installments']] })}</section>${button('Request extension', { cls: 'btn btn-primary' })}`)}`);
  },
  contact(vm) {
    return shell(vm, 'Contact my agent', html`${h1('Contact my agent')}${vm.account.messages.length ? html`<section class="card"><h2>Your messages</h2><ul>${vm.account.messages.map(m => html`<li>${fmtDate(m.at)} – ${m.subject} (${m.status})</li>`)}</ul></section>` : ''}${form(vm, 'contact', html`<section class="card">${field(vm, { name: 'subject', label: 'Subject' })}<div class="field"><label for="f-message">Message to your agent or service team</label><textarea id="f-message" name="message" rows="5" required>${vm.values.message || ''}</textarea></div></section>${button('Send message', { cls: 'btn btn-primary' })}`)}${vm.biller.phone ? html`<p>Prefer to talk? Call <strong>${vm.biller.phone}</strong>.</p>` : ''}`);
  },
  profile(vm) { return shell(vm, 'Profile', html`${h1('Profile & contact info')}<section class="card"><dl class="facts"><dt>Named insured</dt><dd>${vm.persona.name}</dd><dt>Email</dt><dd>${vm.persona.email}</dd><dt>Phone</dt><dd>${vm.account.phone || 'Not provided'}</dd><dt>Mailing address</dt><dd>${vm.account.serviceAddress}</dd></dl></section>${form(vm, 'profile', html`<section class="card">${field(vm, { name: 'phone', label: 'Phone number', type: 'tel' })}</section>${button('Update phone', { cls: 'btn btn-primary' })}`)}`); },
  help(vm) {
    if (offline(vm)) return shell(vm, 'Support', html`${h1('Support')}<p class="lead">Online account access is not available for this biller.</p>${helpList(vm)}${helpExcerpts(vm)}`);
    return shell(vm, 'Support center', html`${h1('Support center')}${helpSearchForm(vm, { placeholder: 'Search billing & policy help' })}<section class="grid2"><div class="card"><h2>Billing &amp; payments</h2>${helpList(vm, vm.help.filter(a => ['payments', 'billing', 'autopay', 'assistance'].includes(a.topic)))}</div><div class="card"><h2>Account &amp; contact</h2>${helpList(vm, vm.help.filter(a => !['payments', 'billing', 'autopay', 'assistance'].includes(a.topic)))}</div></section>${helpExcerpts(vm)}`);
  },
  helpArticle(vm) { return shell(vm, vm.article.title, html`<p class="crumbs"><a href="${vm.url('help')}">Support center</a> › ${vm.article.title}</p>${h1(vm.article.title)}<article class="card">${helpBody(vm.article)}</article>${articleExcerpt(vm)}${helpSearchForm(vm, { placeholder: 'Search billing & policy help' })}`); },
  helpSearch(vm) { return shell(vm, 'Search support', html`<p class="crumbs"><a href="${vm.url('help')}">Support center</a> › Search</p>${h1('Search results')}${helpSearchForm(vm, { placeholder: 'Search billing & policy help' })}${vm.results.length ? helpList(vm, vm.results) : html`<p>No articles match “${vm.query.q || ''}”.</p>`}`); }
};

function reviewPage(vm, page) {
  const d = vm.draft;
  return shell(vm, 'Review payment', html`${h1(page === 'payReview' ? 'Make a payment' : 'Review your payment')}${page === 'payReview' ? stepper(vm, 3) : ''}<section class="card"><h2>Review &amp; submit</h2><dl class="facts"><dt>${policyLabel(vm)}</dt><dd>${policyNo(vm)}</dd><dt>Payment amount</dt><dd>${money(d.amountCents)}</dd>${d.feeCents ? html`<dt>Convenience fee</dt><dd>${money(d.feeCents)}</dd>` : ''}<dt>Total</dt><dd><strong>${money(d.totalCents)}</strong></dd><dt>Payment method</dt><dd>${methodText(d.method)}</dd><dt>Payment date</dt><dd>${d.payOn || 'Today'}</dd></dl>
${form(vm, page, html`${hidden('token', d.token)}${hidden('op', 'submit')}${checkbox(vm, { name: 'acceptTerms', label: `I authorize ${vm.biller.brand.shortName} to charge this payment method for the amount shown.` })}<p class="actions">${button('Submit payment', { cls: 'btn btn-primary' })}</p>`)}${page === 'payReview' ? form(vm, page, html`${hidden('op', 'edit')}${button('Edit payment', { cls: 'btn btn-link' })}`) : ''}</section>`);
}
function receiptPage(vm) {
  const p = vm.payment;
  return shell(vm, 'Payment confirmation', html`${h1(p.status === 'scheduled' ? 'Your payment is scheduled' : 'Thank you. Your payment was received.')}<section class="card ok-card"><dl class="facts"><dt>Confirmation number</dt><dd><strong>${p.confirmation}</strong></dd><dt>${policyLabel(vm)}</dt><dd>${policyNo(vm)}</dd><dt>Amount</dt><dd>${money(p.amountCents)}</dd>${p.feeCents ? html`<dt>Convenience fee</dt><dd>${money(p.feeCents)}</dd>` : ''}<dt>Paid with</dt><dd>${vm.paymentMethod ? methodText(vm.paymentMethod) : `****${p.methodLast4}`}</dd><dt>Payment date</dt><dd>${p.payOn || fmtDate(p.createdAt)}</dd><dt>Status</dt><dd>${statusLabel(p.status)}</dd></dl><p class="small muted">A confirmation email was sent to the address on your policy.</p></section>${vm.authenticated ? html`<p><a class="btn btn-outline" href="${vm.url('dashboard')}">Back to My Policies</a> <a href="${vm.url('history')}">Payment history</a></p>` : html`<p><a class="btn btn-outline" href="${vm.url('home')}">Done</a></p>`}`);
}

export function render(page, vm) { const fn = pages[page]; if (!fn) throw new Error(`insurance template cannot render ${page}`); vm = observe(vm); return finish(vm, fn(vm)); }

export const css = `*{box-sizing:border-box}html{background:#eef1f5}body{margin:0;font:15px/1.55 "Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#18202b;background:#eef1f5}a{color:var(--brand)}
.wrap{max-width:1180px;margin:0 auto;padding:0 20px}
.utility{background:#18202b;color:#cfd6df;font-size:13px}.utility .wrap{display:flex;justify-content:space-between;padding-top:6px;padding-bottom:6px}.utility a{color:#fff}.utility strong{color:#fff}
.mast{background:#fff;box-shadow:0 1px 0 #d6dce4}.mast .wrap{display:flex;justify-content:space-between;align-items:center;height:72px}.brand{display:flex;align-items:center;gap:12px;font-weight:700;font-size:20px;letter-spacing:-.2px;color:#18202b;text-decoration:none}.logo{width:42px;height:42px}
.who{display:flex;align-items:center;gap:14px}.who .hello{color:#4a5563}
.tabs{background:var(--brand)}.tabs .wrap{display:flex;gap:2px}.tabs a{color:#fff;text-decoration:none;padding:12px 18px;font-weight:600;font-size:14px;text-transform:uppercase;letter-spacing:.4px}.tabs a:hover{background:rgba(0,0,0,.18)}
.page{display:flex;gap:28px;align-items:flex-start;padding-top:28px;padding-bottom:40px}.content{flex:1;min-width:0}.content.solo{max-width:1180px}
.side{width:248px;flex:none;background:#fff;border-radius:4px;border-top:4px solid var(--brand);padding:8px 0 14px;box-shadow:0 1px 2px rgba(16,24,40,.08)}.side-h{margin:14px 18px 4px;font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#6b7684}.side ul{list-style:none;margin:0;padding:0}.side a{display:block;padding:7px 18px;color:#18202b;text-decoration:none;font-size:14px;border-left:3px solid transparent}.side a:hover{background:#f3f5f8}.side a.on{border-left-color:var(--brand);background:#f3f5f8;font-weight:700;color:var(--brand)}
h1{font-size:28px;font-weight:600;margin:0 0 16px;letter-spacing:-.3px}h2{font-size:19px;margin:0 0 10px}h3{font-size:16px;margin:0 0 8px}
.btn{display:inline-block;border:2px solid var(--brand);background:var(--brand);color:#fff;padding:10px 22px;border-radius:24px;font:inherit;font-weight:700;text-decoration:none;cursor:pointer;line-height:1.2}.btn-outline{background:#fff;color:var(--brand)}.btn-small{padding:6px 16px;font-size:14px}.btn-block{display:block;width:100%;text-align:center}.btn-danger{background:#b3261e;border-color:#b3261e}.btn-link{border:0;background:none;padding:0;color:var(--brand);text-decoration:underline;border-radius:0;font-weight:600}
.panel{max-width:460px;margin:0 auto;background:#fff;padding:32px;border-radius:4px;box-shadow:0 2px 6px rgba(16,24,40,.12);border-top:4px solid var(--brand)}.wide-panel{max-width:620px}
.card{background:#fff;padding:22px 24px;border-radius:4px;box-shadow:0 1px 2px rgba(16,24,40,.1);margin-bottom:18px}.ok-card{border-left:5px solid #1f7a3f}.offer{border-left:5px solid var(--accent)}
.hero{display:grid;grid-template-columns:1.4fr 1fr;gap:28px;align-items:start;margin-bottom:24px}.hero-text{padding:26px 0}.hero h1{font-size:40px}.hero-actions hr{border:0;border-top:1px solid #e1e6ec;margin:18px 0}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}@media(max-width:820px){.grid3,.grid2,.hero{grid-template-columns:1fr}.page{flex-direction:column}.side{width:100%}}
.lead{font-size:18px;color:#4a5563}.muted{color:#6b7684}.small{font-size:13px}.note{background:#f3f5f8;padding:10px 14px;border-radius:4px}
.tile{display:block;background:#fff;padding:18px;border-radius:4px;box-shadow:0 1px 2px rgba(16,24,40,.1);text-decoration:none;color:#18202b;border-bottom:3px solid var(--brand)}.tile strong{display:block;color:var(--brand);margin-bottom:4px}.tile span{font-size:13px;color:#4a5563}
.policy-card{background:#fff;border-radius:4px;box-shadow:0 1px 3px rgba(16,24,40,.14);margin-bottom:22px;overflow:hidden}.policy-card header{display:flex;justify-content:space-between;gap:20px;padding:22px 24px;border-bottom:1px solid #e1e6ec}.policy-card .facts{padding:18px 24px}.policy-card .note{margin:0 24px 18px}
.due{display:flex;flex-direction:column;align-items:flex-end;gap:4px;min-width:200px}.big{font-size:32px;font-weight:700}.lbl{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#6b7684}
.tag{display:inline-block;background:#e3f3e8;color:#1f7a3f;font-size:12px;font-weight:700;padding:2px 10px;border-radius:12px;margin-bottom:6px}
.policy-strip{display:grid;grid-template-columns:repeat(4,1fr);background:#fff;border-radius:4px;box-shadow:0 1px 2px rgba(16,24,40,.1);margin-bottom:18px}.policy-strip>div{padding:14px 18px;border-right:1px solid #e1e6ec}.policy-strip>div:last-child{border-right:0}
.stepper{display:flex;list-style:none;padding:0;margin:0 0 18px;gap:0;counter-reset:s}.stepper li{flex:1;padding:10px 12px;background:#dfe4ea;color:#4a5563;font-weight:600;font-size:14px;display:flex;align-items:center;gap:8px}.stepper li span{display:inline-flex;width:24px;height:24px;border-radius:50%;background:#fff;align-items:center;justify-content:center;font-size:13px}.stepper li.cur{background:var(--brand);color:#fff}.stepper li.cur span{color:var(--brand)}.stepper li.done{background:#c9d3de}
.field{margin:14px 0}.field label{display:block;font-weight:600;margin-bottom:5px;font-size:14px}.field input,.field select,.field textarea{width:100%;padding:10px 12px;border:1px solid #8e99a8;border-radius:3px;font:inherit;background:#fff}.field input:focus,.field select:focus{outline:2px solid var(--brand);outline-offset:1px}.help{color:#6b7684;font-size:13px}
fieldset{border:0;border-top:1px solid #e1e6ec;margin:8px 0;padding:10px 0}legend{font-weight:700;font-size:16px;padding-right:8px}.radio,.check{display:flex;gap:8px;align-items:center;margin:10px 0}.amounts .radio{padding:10px 12px;border:1px solid #d6dce4;border-radius:4px}.amt{margin-left:auto}.other-amount{width:130px;padding:6px 8px;margin-left:auto;border:1px solid #8e99a8;border-radius:3px}
.alert{padding:12px 16px;border-radius:4px;margin-bottom:18px}.alert-error{background:#fdecea;color:#8c1d18;border-left:5px solid #b3261e}.alert-ok{background:#e3f3e8;color:#1f5c33;border-left:5px solid #1f7a3f}
.table{width:100%;border-collapse:collapse;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.1)}.table th,.table td{text-align:left;padding:11px 14px;border-bottom:1px solid #e1e6ec}.table th{background:#f3f5f8;font-size:13px;text-transform:uppercase;letter-spacing:.4px;color:#4a5563}.table form{margin:0}
dl.facts{display:grid;grid-template-columns:max-content 1fr;gap:8px 22px;margin:0}dt{color:#6b7684}dd{margin:0}
.actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.crumbs{font-size:14px;color:#6b7684}
.help-search{display:flex;gap:8px;margin:12px 0}.help-search input{flex:1;padding:9px 12px;border:1px solid #8e99a8;border-radius:3px;font:inherit}.help-search .btn{border-radius:3px}.help-list{padding-left:18px}.help-list li{margin:6px 0}.steps li{margin:4px 0}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.wallet{list-style:none;padding:0;margin:0}.wallet li{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #e1e6ec}.wallet form{display:inline}details summary{cursor:pointer;color:var(--brand);font-weight:600;margin:10px 0}
.foot{background:#18202b;color:#cfd6df;font-size:13px;padding:22px 0}.foot a{color:#fff}
@media(max-width:820px){.mast .wrap{flex-wrap:wrap;height:auto;min-height:64px;gap:8px 14px;padding-top:10px;padding-bottom:10px}.who{flex-wrap:wrap;gap:8px 12px;margin-left:auto}.content{width:100%;max-width:100%}.policy-strip{grid-template-columns:repeat(2,minmax(0,1fr))}.policy-strip>div{border-bottom:1px solid #e1e6ec}.stepper{flex-wrap:wrap}.stepper li{flex:1 1 120px}.grid3>*,.grid2>*,.hero>*{min-width:0}.table{display:block;overflow-x:auto;max-width:100%}dd{overflow-wrap:anywhere}}` + OBS_CSS;
