// Municipal / regional income-tax agency portal modeled on RITA (Regional Income Tax Agency, Ohio):
// "MyAccount" for registered taxpayers and "FastPay" for one-time payments without an account, with tax-year
// and payment-type selection (balance due, estimated payment, extension) and a Pay.gov-style
// "Payment Information → Payment Method → Review and Submit" sequence with an authorization statement.
// Also serves other Pay.gov / Tax & Tags style government collection records routed to this family.
import { html, raw, doc, logo, alert, form, field, select, button, hidden, dateField, table, paymentRows, helpList, helpBody, helpSearchForm, money, fmtDate, methodText, L } from '../kit.mjs';
import { applyProfile, siteNav, profileDocTitle, heroBanner, heroText, loginProfile, socialBlock, helpExcerpts, naNotice, PROFILE_CSS, mfaSent, mfaResend } from './_profile-parts.mjs';
import { offline, sup, isTax, cardFeeText, bankFeeText, methodFields, savedMethods, amountRadios, reviewRows, reviewForm, receiptRows, cancelBody, autopayBody, stepper } from './_municipal-portal-gov.mjs';

export const meta = {
  id: 'income-tax',
  // Where the dedicated tier's dossier nav (vm.nav) goes: the first element matching a selector (class:<token> or
  // aria:<label>) is re-filled with the dossier's items; observed real-site navs yield on public pages (server.mjs withDossierNav).
  navSlots: { public: ['class:menu'], account: ['class:side'] },
  name: 'Income tax agency (MyAccount / FastPay)',
  description: 'Municipal and regional income-tax agency portal in the RITA style with Pay.gov-like payment steps: MyAccount sign-in, FastPay one-time payments, tax year and payment type (balance due / estimated / extension), ACH no fee vs. card service charge, estimates and billing statements.',
  families: ['rita', 'municipal-income-tax', 'pay-gov', 'iowa-tax-and-tags'],
  sources: [
    'https://www.ritaohio.com/',
    'https://www.ritaohio.com/Individuals/Home/Estimates',
    'https://www.ritaohio.com/Individuals/Home/MakeAPayment (404 page; still lists FastPay / MyAccount / Make a payment links)',
    'https://www.pay.gov/public/home',
    'https://www.pay.gov/public/form/start/47619855 (returned the home page)'
  ],
  evidence: {
    observed_public: [
      'Top-level menu: MyAccount, FastPay, Welcome New Taxpayers, Forms, Individuals, Businesses, Tax Professionals, Municipal Income Tax, RITA Municipalities, Tax Rates, Resources, About, Contact, FAQs (ritaohio.com)',
      '"FastPay" makes a one-time payment without creating an account; MyAccount offers "File and Pay" and "View and Amend Estimate"',
      'Accepted payments: ACH (checking/savings) no fee; credit/debit card 2.75% service charge; check',
      'Quarterly estimated payments due on the IRS schedule; estimate required when owing $200 or more',
      'Billing Statement FAQs and Collections (Payment Plans) FAQ categories',
      'Pay.gov home: "Browse Payments", "See All Forms", "Help"; "The secure way to pay U.S. Federal Government Agencies"'
    ],
    documented: [
      'Pay.gov form flow: find the agency form → complete the form → choose a payment method → review and submit with an authorization checkbox',
      'Iowa Tax & Tags: choose county and tax type, search, select payment option; e-check and card fees'
    ],
    synthetic: [
      'Exact MyAccount signed-in menu labels and layout (MyAccount was not accessed)',
      'FastPay identity check uses account ID + last name (engine contract) rather than SSN',
      'Card fee uses the catalog fee when documented, otherwise the engine default for government/tax (2.35%, min $1.95) — RITA itself documents 2.75%',
      'Scheduled estimated payments page standing in for AutoPay; tax-year and payment-type selectors are informational and not graded'
    ]
  }
};

export const routes = {
  home: '/', login: '/MyAccount/Login', loginPassword: '/MyAccount/Login/Password', mfa: '/MyAccount/Login/Verify', register: '/MyAccount/Register', verify: '/MyAccount/Register/Verify', forgot: '/MyAccount/ForgotPassword', reset: '/MyAccount/ResetPassword',
  guest: '/FastPay', guestPay: '/FastPay/PaymentInformation', guestReview: '/FastPay/ReviewAndSubmit', guestReceipt: '/FastPay/Confirmation/:id',
  dashboard: '/MyAccount/Home', bill: '/MyAccount/AccountBalance', statements: '/MyAccount/StatementsAndNotices', statement: '/MyAccount/StatementsAndNotices/:id.pdf',
  pay: '/MyAccount/MakeAPayment', payMethod: '/MyAccount/MakeAPayment/PaymentMethod', payReview: '/MyAccount/MakeAPayment/ReviewAndSubmit', payReceipt: '/MyAccount/MakeAPayment/Confirmation/:id',
  history: '/MyAccount/PaymentHistory', autopay: '/MyAccount/ScheduledPayments', paperless: '/MyAccount/NoticePreferences', wallet: '/MyAccount/BankAccountsAndCards', cancel: '/MyAccount/CloseAccount', plan: '/MyAccount/Estimates',
  arrangement: '/MyAccount/PaymentPlan', contact: '/MyAccount/MessageCenter', profile: '/MyAccount/Profile', logout: '/MyAccount/Logout',
  help: '/FAQs', helpArticle: '/FAQs/:slug', helpSearch: '/FAQs-Search'
};
export const flow = { paySteps: ['pay', 'payMethod', 'payReview'], loginSteps: 1, guestSteps: ['guest', 'guestPay', 'guestReview'] };

const agency = vm => isTax(vm) ? 'Income Tax' : vm.biller.kind === 'medical' ? 'Patient Payments' : 'Online Payments';
const years = vm => { const y = new Date(vm.now).getUTCFullYear(); return [y, y - 1, y - 2].map(v => [String(v), String(v)]); };
const amountLabels = vm => isTax(vm) ? { due: 'Balance due on account', installment: 'Next estimated payment', other: 'Other amount' } : { due: 'Account balance', other: 'Other amount' };
const STEPS = ['Payment Information', 'Payment Method', 'Review and Submit'];

function topMenu(vm) {
  if (offline(vm)) return html`<a href="${vm.url('home')}">${L(vm, 'home', 'Home')}</a><a href="${vm.url('help')}">${L(vm, 'help', 'FAQs')}</a>`;
  return html`<a href="${vm.url(vm.authenticated ? 'dashboard' : 'login')}" class="mi">MyAccount</a><a href="${vm.url('guest')}" class="mi">${L(vm, 'guest', 'FastPay')}</a><a href="${vm.url('helpArticle', { slug: 'pay-your-bill' })}">Ways to Pay</a><a href="${vm.url('help')}">${L(vm, 'help', 'FAQs')}</a><a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact</a>`;
}
function side(vm) {
  const l = (pg, label) => html`<li><a href="${vm.url(pg)}"${vm.page === pg ? raw(' class="on" aria-current="page"') : ''}>${L(vm, pg, label)}</a></li>`;
  return html`<nav class="side" aria-label="MyAccount"><p class="side-h">MyAccount</p><ul>${l('dashboard', 'Account Summary')}${l('bill', isTax(vm) ? 'Account Balance' : 'Balance Details')}${l('pay', 'Make a Payment')}${l('history', 'Payment History')}${l('statements', isTax(vm) ? 'Statements & Notices' : 'Statements')}${isTax(vm) ? l('plan', 'Estimates') : ''}${l('autopay', 'Scheduled Payments')}${l('wallet', 'Bank Accounts & Cards')}${l('paperless', 'Notice Preferences')}${l('arrangement', 'Payment Plan')}${l('contact', 'Message Center')}${l('profile', 'Profile')}${sup(vm, 'cancel_service') ? l('cancel', 'Close Account') : ''}${l('help', 'FAQs')}</ul></nav>`;
}
function shell(vm, title, body, { my = vm.authenticated && !offline(vm) } = {}) {
  return doc(vm, { title: profileDocTitle(vm) || `${title} - ${vm.biller.brand.shortName}`, body: html`<div class="util"><span>${vm.biller.name}</span>${!offline(vm) ? (vm.authenticated ? html`<span>Welcome, ${vm.persona.first} | <a href="${vm.url('logout')}">${L(vm, 'logout', 'Log Out')}</a></span>` : html`<span><a href="${vm.url('login')}">${L(vm, 'login', 'MyAccount Login')}</a> | <a href="${vm.url('register')}">${L(vm, 'register', 'Register')}</a></span>`) : ''}</div><header class="hdr"><a class="brand" href="${vm.url('home')}">${logo(vm)}<span><b>${vm.biller.brand.shortName}</b><small>${agency(vm)}</small></span></a><nav class="menu" aria-label="Main">${topMenu(vm)}</nav></header>${siteNav(vm, { cls: 'pf-nav-light' })}<div class="page${my ? ' my' : ''}">${my ? side(vm) : ''}<main id="main">${alert(vm)}${body}</main></div><footer class="foot"><div><b>${vm.biller.brand.shortName}</b>${vm.biller.phone ? html` · ${vm.biller.phone}` : ''}${vm.biller.mailAddress ? html`<br>Payments: ${vm.biller.mailAddress}` : ''}</div><div><a href="${vm.url('help')}">${L(vm, 'help', 'FAQs')}</a> · <a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact</a> · <a href="${vm.url('helpArticle', { slug: 'pay-your-bill' })}">Payment options</a></div><p>Electronic payments are processed faster than paper returns and checks.</p></footer>` });
}
const h1 = t => html`<h1>${t}</h1>`;
const panelH1 = (title, inner, cls = '') => html`<section class="panel ${cls}"><h1 class="ph">${title}</h1><div class="pb">${inner}</div></section>`;
const panel = (title, inner, cls = '') => html`<section class="panel ${cls}">${title ? html`<div class="ph">${title}</div>` : ''}<div class="pb">${inner}</div></section>`;
const taxSelectors = vm => isTax(vm) ? html`<div class="row2">${select(vm, { name: 'taxYear', label: 'Tax year', options: years(vm) })}${select(vm, { name: 'paymentType', label: 'Payment type', options: [['balance', 'Balance due / billing statement'], ['estimate', 'Estimated payment'], ['extension', 'Extension payment'], ['return', 'Payment with return']] })}</div>` : '';

const pages = {
  home(vm) {
    if (offline(vm)) return shell(vm, 'Payment options', html`${h1(`Paying ${vm.biller.name}`)}<p class="lead">Online account access and online payment are not available for this agency.</p>${panel('How to pay', helpBody(vm.help.find(a => a.slug === 'pay-your-bill')))}`);
    return shell(vm, agency(vm), html`<section class="banner"><h1>${vm.biller.brand.shortName} ${agency(vm)}</h1>${heroBanner(vm, { cls: 'pf-hero-inv' })}<p>${isTax(vm) ? 'File, pay and manage your income tax account online.' : 'Pay and manage your account online.'} Electronic forms and payments are processed faster than paper returns and checks.</p></section><div class="tiles"><a class="tile" href="${vm.url('login')}"><b>${L(vm, 'login', 'MyAccount')}</b><span>${isTax(vm) ? 'File and pay, view balances and estimates, and see payment history.' : 'View balances, statements and payment history.'}</span></a><a class="tile" href="${vm.url('guest')}"><b>${L(vm, 'guest', 'FastPay')}</b><span>Make a one-time payment without creating an account.</span></a>${isTax(vm) ? html`<a class="tile" href="${vm.url('helpArticle', { slug: 'pay-your-bill' })}"><b>Estimated payments</b><span>Owe $200 or more after credits? Make quarterly estimated payments.</span></a>` : html`<a class="tile" href="${vm.url('help')}"><b>${L(vm, 'help', 'FAQs')}</b><span>Answers about payments, statements and accounts.</span></a>`}</div><div class="two">${panel('Ways to pay', html`<ul class="ways"><li><b>ACH</b> (checking or savings) — ${bankFeeText(vm)}</li><li><b>Credit/debit card</b> — ${cardFeeText(vm)}</li>${vm.biller.payPhone ? html`<li><b>Phone</b> — ${vm.biller.payPhone}</li>` : ''}${vm.biller.mailAddress ? html`<li><b>Mail</b> — ${vm.biller.mailAddress}</li>` : ''}</ul>`)}${panel('New user?', html`<p>Register for MyAccount with the account ID on your ${isTax(vm) ? 'billing statement or notice' : 'statement'}.</p><p><a class="btn btn-primary" href="${vm.url('register')}">${L(vm, 'register', 'Register for MyAccount')}</a></p>${helpSearchForm(vm, { placeholder: 'Search FAQs' })}`)}</div>`, { my: false });
  },
  login(vm) { const lp = loginProfile(vm); return shell(vm, 'MyAccount Login', html`<div class="auth">${panelH1('MyAccount Login', html`${form(vm, 'login', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'username', label: lp.userLabel || 'Username or email', autocomplete: 'username', help: lp.userHelp })}${field(vm, { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' })}${button(lp.submit || 'Log In', { cls: 'btn btn-primary' })}`)}${socialBlock(vm)}<p><a href="${vm.url('forgot')}">${L(vm, 'forgot', 'Forgot username or password?')}</a></p>`)}${panel('Not registered?', html`<p>Create a MyAccount to file, pay and manage your account online.</p><p><a class="btn" href="${vm.url('register')}">${L(vm, 'register', 'Register')}</a></p><p>Just making a payment? Use <a href="${vm.url('guest')}">${L(vm, 'guest', 'FastPay')}</a>.</p>`)}</div>`, { my: false }); },
  loginPassword(vm) { return pages.login(vm); },
  mfa(vm) { return shell(vm, 'Security code', panelH1('Enter your security code', html`<p>${mfaSent(vm, 'We emailed a 6-digit security code to the address on your MyAccount profile.')}</p>${form(vm, 'mfa', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'code', label: 'Security code', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' })}${button('Continue', { cls: 'btn btn-primary' })}`)}${mfaResend(vm)}`, 'narrow'), { my: false }); },
  register(vm) { return shell(vm, 'Register', panelH1('MyAccount Registration', html`<p>You will need the account ID printed on your ${isTax(vm) ? 'billing statement or notice' : 'statement'}.</p>${form(vm, 'register', html`${field(vm, { name: 'accountNumber', label: 'Account ID', inputmode: 'numeric' })}${field(vm, { name: 'lastName', label: 'Last name' })}${field(vm, { name: 'email', label: 'Email address', type: 'email', autocomplete: 'email' })}${field(vm, { name: 'password', label: 'Create password', type: 'password', autocomplete: 'new-password', help: '8–64 characters: upper and lower case, a number and a symbol' })}${field(vm, { name: 'confirm', label: 'Confirm password', type: 'password', autocomplete: 'new-password' })}${button('Register', { cls: 'btn btn-primary' })}`)}`, 'narrow'), { my: false }); },
  verify(vm) { return shell(vm, 'Verify email', panelH1('Verify your email', html`<p>Open the link we emailed you to activate MyAccount.</p>`, 'narrow'), { my: false }); },
  forgot(vm) { return shell(vm, 'Forgot password', panelH1('Forgot Username or Password', html`${form(vm, 'forgot', html`${field(vm, { name: 'identifier', label: 'Email address or account ID', autocomplete: 'username' })}${button('Send code', { cls: 'btn btn-primary' })}`)}<p><a href="${vm.url('login')}">Back to login</a></p>`, 'narrow'), { my: false }); },
  reset(vm) { return shell(vm, 'Reset password', panelH1('Reset Password', form(vm, 'reset', html`${vm.query.token ? hidden('token', vm.query.token) : field(vm, { name: 'code', label: 'Code from email', inputmode: 'numeric', autocomplete: 'one-time-code' })}${field(vm, { name: 'password', label: 'New password', type: 'password', autocomplete: 'new-password' })}${field(vm, { name: 'confirm', label: 'Confirm new password', type: 'password', autocomplete: 'new-password' })}${button('Reset password', { cls: 'btn btn-primary' })}`), 'narrow'), { my: false }); },

  guest(vm) {
    return shell(vm, 'FastPay', html`${h1(L(vm, 'guest', 'FastPay'))}<p class="lead">Make a one-time payment without creating an account.</p>${panel('Taxpayer identification', html`${form(vm, 'guest', html`${field(vm, { name: 'accountNumber', label: 'Account ID', help: isTax(vm) ? 'Found at the top of your billing statement, notice or estimate voucher.' : 'Found on your statement.' })}${field(vm, { name: 'lastName', label: 'Last name (as shown on your account)' })}${button('Continue', { cls: 'btn btn-primary' })}`)}<p class="muted">Have a MyAccount? <a href="${vm.url('login')}">${L(vm, 'login', 'Log in')}</a> to see balances and history.</p>`, 'narrow')}`, { my: false });
  },
  guestPay(vm) {
    return shell(vm, 'FastPay – Payment Information', html`${h1('FastPay')}${stepper(STEPS, 0)}${panel('Payment Information', html`<p>Account ${vm.accountMasked} · Balance <strong>${money(vm.balanceCents)}</strong></p>${form(vm, 'guestPay', html`${taxSelectors(vm)}${amountRadios(vm, amountLabels(vm), 'Payment amount')}<fieldset><legend>Payment Method</legend>${methodFields(vm, { typeLabel: 'Select payment method', bankLabel: `Bank account (ACH) — ${bankFeeText(vm)}`, cardLabel: `Debit or credit card — ${cardFeeText(vm)}`, save: false })}</fieldset>${button('Continue', { cls: 'btn btn-primary' })} <a class="btn" href="${vm.url('home')}">${L(vm, 'home', 'Cancel')}</a>`)}`)}`, { my: false });
  },
  guestReview(vm) { return reviewPage(vm, 'guestReview'); },
  guestReceipt(vm) { return receiptPage(vm); },

  dashboard(vm) {
    const inst = vm.account.installments || [];
    return shell(vm, 'Account Summary', html`${h1('Account Summary')}${vm.pendingPayments.length ? html`<p class="info">${vm.pendingPayments.length} payment(s) pending. ACH payments post in 2 business days.</p>` : ''}<div class="two">${panel('Balance', html`<p class="big">${money(vm.balanceCents)}</p><p>${isTax(vm) ? 'Balance due per most recent billing statement' : 'Current balance'} · due ${vm.dueText}</p><p><a class="btn btn-primary" href="${vm.url('pay')}">${L(vm, 'pay', 'Make a Payment')}</a> <a class="btn" href="${vm.url('bill')}">${L(vm, 'bill', 'View Account Balance')}</a></p>`)}${panel('Account', html`<dl class="kv"><dt>Account ID</dt><dd>${vm.accountMasked}</dd><dt>Name</dt><dd>${vm.persona.name}</dd><dt>Address</dt><dd>${vm.account.serviceAddress}</dd><dt>Notices</dt><dd>${vm.account.paperless ? 'Electronic' : 'Mail'} · <a href="${vm.url('paperless')}">Change</a></dd><dt>Scheduled payments</dt><dd>${vm.autopay.enrolled ? 'On' : 'None'} · <a href="${vm.url('autopay')}">Manage</a></dd></dl>`)}</div>${isTax(vm) && inst.length ? panel('Estimated payments', table(['Voucher', 'Due', 'Amount', 'Status'], inst.map(i => [`Estimate ${i.n}`, fmtDate(i.dueAt), money(i.cents), i.paid ? 'Paid' : 'Open'])) ) : ''}${panel('Recent activity', html`${table(['Date', 'Amount', 'Method', 'Confirmation', 'Status', ''], paymentRows(vm).slice(0, 3))}<p><a href="${vm.url('history')}">View all payments</a> · <a href="${vm.url('statements')}">${L(vm, 'statements', 'Statements & notices')}</a></p>`)}`);
  },
  bill(vm) {
    const inv = vm.invoice;
    return shell(vm, 'Account Balance', html`${h1(isTax(vm) ? 'Account Balance' : 'Balance Details')}${panel(`${isTax(vm) ? 'Billing statement' : 'Statement'} ${inv.number}`, html`<dl class="kv"><dt>Period</dt><dd>${inv.period}</dd><dt>Statement date</dt><dd>${fmtDate(inv.issuedAt)}</dd><dt>${L(vm, 'dueDate', 'Due date')}</dt><dd>${fmtDate(inv.dueAt)}</dd></dl>${table(['Description', 'Amount'], [...inv.lines.map(l => [isTax(vm) && l.desc === 'Tax due' ? `Municipal income tax due` : l.desc, money(l.cents)]), [html`<b>Total</b>`, html`<b>${money(inv.amountCents)}</b>`]])}<p class="total">Balance due: <b>${money(vm.balanceCents)}</b></p><p><a class="btn btn-primary" href="${vm.url('pay')}">${L(vm, 'pay', 'Make a Payment')}</a> <a class="btn" href="${vm.url('statement', { id: inv.id })}">View statement (PDF)</a></p>`)}`);
  },
  statements(vm) { return shell(vm, 'Statements & Notices', html`${h1(isTax(vm) ? 'Statements & Notices' : 'Statements')}${panel('', table(['Date', 'Document', 'Amount', 'Due', ''], vm.invoices.map(i => [fmtDate(i.issuedAt), `${isTax(vm) ? 'Billing statement' : 'Statement'} ${i.number}`, money(i.amountCents), fmtDate(i.dueAt), html`<a href="${vm.url('statement', { id: i.id })}">View PDF</a>`])))}`); },
  pay(vm) {
    return shell(vm, 'Make a Payment', html`${h1(L(vm, 'pay', 'Make a Payment'))}${stepper(STEPS, 0)}${panel('Payment Information', html`<p>Balance due <b>${money(vm.balanceCents)}</b> · due ${vm.dueText}</p>${form(vm, 'pay', html`${taxSelectors(vm)}${amountRadios(vm, amountLabels(vm), 'Payment amount')}${dateField(vm, { label: 'Payment date' })}${button('Continue', { cls: 'btn btn-primary' })}`)}`)}`);
  },
  payMethod(vm) {
    return shell(vm, 'Payment Method', html`${h1('Make a Payment')}${stepper(STEPS, 1)}${panel('Payment Method', html`<p>Amount: <b>${vm.draft?.amountCents ? money(vm.draft.amountCents) : ''}</b>${vm.draft?.payOn ? ` · scheduled for ${vm.draft.payOn}` : ''} · <a href="${vm.url('pay')}">Edit</a></p>${form(vm, 'payMethod', html`${savedMethods(vm, { legend: 'Select a payment method', newLabel: 'Add a bank account or card', fields: { typeLabel: 'Payment method', bankLabel: `Bank account (ACH) — ${bankFeeText(vm)}`, cardLabel: `Debit or credit card — ${cardFeeText(vm)}` } })}<p class="muted">A ${cardFeeText(vm)} applies to card payments and is retained by the card processor.</p>${button('Continue', { cls: 'btn btn-primary' })}`)}`)}`);
  },
  payReview(vm) { return reviewPage(vm, 'payReview'); },
  payReceipt(vm) { return receiptPage(vm); },
  history(vm) { return shell(vm, 'Payment History', html`${h1(L(vm, 'history', 'Payment History'))}${panel('', table(['Date', 'Amount', 'Method', 'Confirmation', 'Status', ''], paymentRows(vm)))}`); },
  autopay(vm) { return shell(vm, 'Scheduled Payments', panel('', autopayBody(vm, { title: 'Scheduled Payments', intro: isTax(vm) ? 'Set up recurring ACH payments so each estimated payment or billing statement is paid on its due date.' : 'Set up recurring payments on each due date.', offLabel: 'Recurring payments are not offered online for this account.', methodsBlock: savedMethods(vm, { legend: 'Pay from', fields: { save: false } }) }))); },
  paperless(vm) { return shell(vm, 'Notice Preferences', panel('', html`${h1(L(vm, 'paperless', 'Notice Preferences'))}${sup(vm, 'paperless') ? html`<p>You currently receive notices by <b>${vm.account.paperless ? 'email' : 'mail'}</b>.</p>${form(vm, 'paperless', html`${hidden('paperless', vm.account.paperless ? 'off' : 'on')}${!vm.account.paperless ? field(vm, { name: 'email', label: 'Email for electronic notices', type: 'email', value: vm.persona.email }) : ''}${button(vm.account.paperless ? 'Receive notices by mail' : 'Receive notices electronically', { cls: 'btn btn-primary' })}`)}` : html`<p>Billing statements and notices are mailed to your address of record. Electronic notices are not offered online for this account.</p>`}`)); },
  wallet(vm) { return shell(vm, 'Bank Accounts & Cards', html`${h1(L(vm, 'wallet', 'Bank Accounts & Cards'))}${panel('Saved', html`<ul class="wallet">${vm.methods.map(m => html`<li><span>${methodText(m)}</span>${form(vm, 'wallet', html`${hidden('op', 'remove')}${hidden('methodId', m.id)}<button type="submit" class="btn btn-link" aria-label="Delete ${methodText(m)}">Delete</button>`)}</li>`)}</ul>`)}${panel('Add', form(vm, 'wallet', html`${hidden('op', 'add')}${methodFields(vm, { typeLabel: 'Type', bankLabel: 'Bank account (ACH)', cardLabel: 'Debit or credit card', save: false })}${field(vm, { name: 'nickname', label: 'Nickname (optional)', required: false })}${button('Save', { cls: 'btn btn-primary' })}`))}`); },
  cancel(vm) {
    if (!sup(vm, 'cancel_service')) return shell(vm, 'Close Account', panel('', html`${h1(L(vm, 'cancel', 'Close Account'))}<p>${isTax(vm) ? 'If you moved out of a member municipality or stopped working there, file a final return and update your residency in MyAccount. Tax accounts cannot be closed online.' : 'This account cannot be closed online.'} Contact us${vm.biller.phone ? ` at ${vm.biller.phone}` : ''}.</p>`));
    return shell(vm, 'Close Account', panel('', cancelBody(vm, { noun: 'account', title: 'Close Account', reasons: [['', 'Select a reason'], ['moving', 'Moving'], ['other', 'Other']] })));
  },
  plan(vm) {
    const inst = vm.account.installments || [];
    return shell(vm, 'Estimates', panel('', html`${h1(isTax(vm) ? 'Estimates' : 'Plans')}${isTax(vm) ? html`<p>Estimated payments are due quarterly on the same dates as federal estimates. Use View and Amend Estimate when filing to change your estimate.</p>${table(['Voucher', 'Due', 'Amount', 'Status'], inst.map(i => [`Estimate ${i.n}`, fmtDate(i.dueAt), money(i.cents), i.paid ? 'Paid' : 'Open']))}<p><a class="btn btn-primary" href="${vm.url('pay')}">${L(vm, 'pay', 'Pay an estimate')}</a></p>` : vm.plans.length ? form(vm, 'plan', html`<fieldset><legend>Choose a plan</legend>${vm.plans.map(p => html`<label class="radio"><input type="radio" name="planId" value="${p.id}"${p.current ? raw(' checked') : ''}> ${p.name}${p.current ? ' (current)' : ''}</label>`)}</fieldset>${button('Change plan', { cls: 'btn btn-primary' })}`) : html`<p>No plan options are available online.</p>`}`)); },
  arrangement(vm) { return shell(vm, 'Payment Plan', panel('', html`${h1(L(vm, 'arrangement', 'Payment Plan'))}${vm.account.arrangement ? html`<p>Your payment plan: ${money(vm.account.arrangement.monthlyCents)} per month for ${vm.account.arrangement.months} months. Interest and penalty continue to accrue until the balance is paid.</p>` : form(vm, 'arrangement', html`<p>Can't pay your balance of ${money(vm.balanceCents)} in full? Request a payment plan.</p>${select(vm, { name: 'months', label: 'Monthly payments', options: [['3', '3'], ['6', '6'], ['12', '12']] })}${button('Request payment plan', { cls: 'btn btn-primary' })}`)}`)); },
  contact(vm) { return shell(vm, 'Message Center', html`${h1(L(vm, 'contact', 'Message Center'))}${vm.account.messages.length ? panel('Sent messages', html`<ul>${vm.account.messages.map(m => html`<li>${fmtDate(m.at)} – ${m.subject} (${m.status})</li>`)}</ul>`) : ''}${panel('New message', form(vm, 'contact', html`${field(vm, { name: 'subject', label: 'Subject' })}<div class="field"><label for="f-message">Message</label><textarea id="f-message" name="message" required>${vm.values.message || ''}</textarea></div>${button('Send', { cls: 'btn btn-primary' })}`))}`); },
  profile(vm) { return shell(vm, 'Profile', panel('', html`${h1(L(vm, 'profile', 'Profile'))}<dl class="kv"><dt>Name</dt><dd>${vm.persona.name}</dd><dt>Email</dt><dd>${vm.persona.email}</dd><dt>Phone</dt><dd>${vm.account.phone || 'Not provided'}</dd></dl>${form(vm, 'profile', html`${field(vm, { name: 'phone', label: 'Phone', type: 'tel' })}${button('Update', { cls: 'btn btn-primary' })}`)}`)); },
  help(vm) { return shell(vm, 'FAQs', html`${h1(L(vm, 'help', 'FAQs'))}${helpSearchForm(vm, { placeholder: 'Search FAQs' })}${panel('Topics', helpList(vm))}${helpExcerpts(vm)}`); },
  helpArticle(vm) { return shell(vm, vm.article.title, html`<p class="crumbs"><a href="${vm.url('help')}">${L(vm, 'help', 'FAQs')}</a> / ${vm.article.title}</p>${h1(vm.article.title)}${panel('', helpBody(vm.article))}${helpExcerpts(vm, vm.article.slug)}${helpSearchForm(vm, { placeholder: 'Search FAQs' })}`); },
  helpSearch(vm) { return shell(vm, 'Search FAQs', html`${h1('Search FAQs')}${naNotice(vm)}${helpSearchForm(vm, { placeholder: 'Search FAQs' })}${panel('Results', vm.results.length ? helpList(vm, vm.results) : html`<p>No FAQs match “${vm.query.q || ''}”.</p>`)}`); }
};

function reviewPage(vm, page) {
  const guest = page === 'guestReview';
  return shell(vm, 'Review and Submit', html`${h1(guest ? 'FastPay' : 'Make a Payment')}${stepper(STEPS, 2)}${panel('Review and Submit', html`<p>Review your payment information. Your payment is not complete until you select <b>Submit Payment</b>.</p>${reviewRows(vm, { feeLabel: 'Service charge', totalLabel: 'Total authorized', extra: [['Account ID', vm.accountMasked], ['Payer', vm.persona?.name || 'Guest payer']] })}${reviewForm(vm, page, { terms: `I authorize ${vm.biller.name} to debit my account or charge my card for the total shown. I understand card service charges are non-refundable.`, submit: 'Submit Payment', edit: 'Previous' })}`)}`, { my: !guest && vm.authenticated });
}
function receiptPage(vm) {
  const p = vm.payment;
  return shell(vm, 'Payment Confirmation', html`${h1('Payment Confirmation')}${panel(p.status === 'scheduled' ? 'Your payment has been scheduled' : 'Your payment has been submitted', html`${receiptRows(vm, { extra: [['Account ID', vm.accountMasked]] })}<p>${vm.authenticated ? html`<a class="btn btn-primary" href="${vm.url('dashboard')}">Return to Account Summary</a>` : html`<a class="btn btn-primary" href="${vm.url('home')}">Return home</a>`}</p>`, 'ok')}`, { my: vm.authenticated });
}

export function render(page, vm) { const fn = pages[page]; if (!fn) throw new Error(`income-tax cannot render ${page}`); return fn(applyProfile(vm)); }

export const css = `*{box-sizing:border-box}body{margin:0;font:15px/1.5 "Segoe UI",Tahoma,Arial,sans-serif;color:#222;background:#eef2f5}a{color:#00577d}
.util{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;background:#003a57;color:#cfe3ee;font-size:13px;padding:6px 24px}.util a{color:#fff}
.hdr{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;background:#fff;padding:14px 24px;border-bottom:4px solid #6cb33f}.brand{display:flex;align-items:center;gap:12px;text-decoration:none;color:#003a57}.brand .logo{width:46px;height:46px}.brand b{display:block;font-size:21px}.brand small{display:block;font-size:13px;color:#5b6b75;text-transform:uppercase;letter-spacing:.06em}
.menu{display:flex;flex-wrap:wrap;gap:2px}.menu a{padding:9px 14px;color:#003a57;text-decoration:none;font-weight:600;font-size:14px;border-radius:3px}.menu a:hover{background:#e3eef4}.menu a.mi{background:#00577d;color:#fff;margin-left:4px}
.page{max-width:1120px;margin:0 auto;padding:24px 16px}.page.my{display:grid;grid-template-columns:230px 1fr;gap:24px;align-items:start}
.side{background:#fff;border:1px solid #c9d6de}.side .side-h{margin:0;font-weight:700;background:#003a57;color:#fff;font-size:15px;padding:10px 14px}.side ul{list-style:none;margin:0;padding:6px 0}.side a{display:block;padding:7px 14px;text-decoration:none;color:#00374f;font-size:14px}.side a:hover{background:#eef5f9}.side a.on{background:#e1f0d8;border-left:4px solid #6cb33f;font-weight:600;padding-left:10px}
h1{font-size:26px;color:#003a57;margin:0 0 14px;font-weight:600}.lead{font-size:17px;color:#3c4b55}
.banner{background:linear-gradient(120deg,#003a57,#00577d 60%,var(--brand));color:#fff;padding:28px 30px;border-radius:4px;margin-bottom:18px}.banner h1{color:#fff;font-size:30px}.banner p{margin:0;max-width:720px}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:18px}.tile{display:block;background:#fff;border:1px solid #c9d6de;border-top:5px solid #6cb33f;padding:18px;text-decoration:none;color:#222;border-radius:3px}.tile b{display:block;font-size:20px;color:#00577d;margin-bottom:6px}.tile:hover{box-shadow:0 2px 8px rgba(0,0,0,.12)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}.auth{display:grid;grid-template-columns:1.2fr 1fr;gap:16px;max-width:860px}
.panel{background:#fff;border:1px solid #c9d6de;border-radius:3px;margin-bottom:16px}.ph{background:#f3f7f9;border-bottom:1px solid #c9d6de;padding:10px 16px;font-weight:700;color:#003a57}.pb{padding:16px 18px}.narrow{max-width:520px}.panel h1.ph{font-size:16px;margin:0;line-height:1.4}.panel.ok .ph{background:#e1f0d8;color:#2d5b16}
.btn{display:inline-block;padding:9px 20px;border:1px solid #00577d;background:#fff;color:#00577d;font:600 14px "Segoe UI",Tahoma,Arial,sans-serif;text-decoration:none;cursor:pointer;border-radius:3px}.btn-primary{background:#6cb33f;border-color:#5a9a33;color:#fff}.btn-primary:hover{background:#5a9a33}.btn-link{border:0;background:none;padding:0;color:#00577d;text-decoration:underline}.btn-danger{background:#b3261e;border-color:#b3261e;color:#fff}
.field{margin:12px 0}.field label{display:block;font-weight:600;font-size:14px;margin-bottom:3px}.field input,.field select,.field textarea{width:100%;padding:8px 10px;border:1px solid #8aa0ad;border-radius:3px;font:inherit;background:#fff}.field textarea{min-height:110px}.help{display:block;font-size:12px;color:#5b6b75}.row2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
fieldset{border:1px solid #c9d6de;border-radius:3px;padding:10px 16px;margin:14px 0}legend{font-weight:700;color:#003a57}.radio,.check{display:block;margin:8px 0}.other-amount{width:120px;padding:5px;border:1px solid #8aa0ad;border-radius:3px}.amt{margin-left:6px}.fee-tag{font-size:12px;color:#5b6b75;margin-left:6px}
.pm-new .bank-fields,.pm-new .card-fields{display:none}.pm-new:has(select[name=methodType] option[value=bank]:checked) .bank-fields{display:block}.pm-new:has(select[name=methodType] option[value=card]:checked) .card-fields{display:block}
details summary{cursor:pointer;color:#00577d;font-weight:600;margin:8px 0}.actions{margin-top:14px}.edit-form{margin-top:8px}
.alert{padding:11px 15px;border-radius:3px;margin-bottom:14px}.alert-error{background:#fdecea;border:1px solid #e4a29c;color:#8a1c14}.alert-ok{background:#e1f0d8;border:1px solid #a9d18e;color:#2d5b16}.info{background:#e8f3fa;border:1px solid #a8cde2;padding:9px 14px;border-radius:3px}
.stepper{display:flex;list-style:none;padding:0;margin:0 0 16px;gap:6px}.stepper li{flex:1;background:#dfe7ec;color:#5b6b75;padding:8px 12px;font-size:14px;clip-path:polygon(0 0,94% 0,100% 50%,94% 100%,0 100%,6% 50%)}.stepper li:first-child{clip-path:polygon(0 0,94% 0,100% 50%,94% 100%,0 100%)}.stepper .current{background:#00577d;color:#fff;font-weight:600}.stepper .done{background:#b9d9a3;color:#2d5b16}.stepper .n{font-weight:700;margin:0 4px 0 8px}
.big{font-size:34px;font-weight:600;color:#003a57;margin:0}.total{font-size:18px;text-align:right}.kv,.review{display:grid;grid-template-columns:max-content 1fr;gap:6px 22px}.kv dt,.review dt{color:#5b6b75}.kv dd,.review dd{margin:0}.conf{font-size:18px}
.table{width:100%;border-collapse:collapse;font-size:14px}.table th{background:#f3f7f9;text-align:left;padding:8px;border-bottom:2px solid #c9d6de;color:#003a57}.table td{padding:8px;border-bottom:1px solid #e1e8ec}.table form{display:inline}.empty{color:#5b6b75}
.ways{padding-left:18px}.ways li{margin:6px 0}.muted{color:#5b6b75}.crumbs{font-size:13px}
.wallet{list-style:none;padding:0;margin:0}.wallet li{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e1e8ec}.wallet form{display:inline}
.help-search{display:flex;gap:8px;margin:12px 0}.help-search input{flex:1;padding:8px;border:1px solid #8aa0ad;border-radius:3px;font:inherit}.help-list li{margin:7px 0}
.foot{background:#003a57;color:#cfe3ee;font-size:13px;padding:20px 24px;margin-top:24px;display:grid;gap:6px}.foot a{color:#fff}.foot p{margin:0;color:#9fbfd0}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.page.my>main{min-width:0}
@media(max-width:600px){.table{display:block;overflow-x:auto;max-width:100%}.hdr{padding:12px}.util{flex-wrap:wrap}}
@media(max-width:860px){.page.my{grid-template-columns:minmax(0,1fr)}.page.my,.two,.tiles,.auth,.row2{grid-template-columns:1fr}.stepper{flex-direction:column}.stepper li{clip-path:none}}
${PROFILE_CSS}
`;
