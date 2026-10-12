// State / county motor-vehicle e-services: registration renewal portals (state DMV "Renew Now" flows,
// county tag-office renewal portals such as altags.com). Guest-first renewal by plate + class + last name,
// a "MyDMV"-style account for vehicles/notices, renewal-fee breakdown with a card processing fee,
// and no automatic payments unless the research record documents them.
import { observe, finish, obsNav, obsFooter, heroText, heroLine, idLabel, submitLabel, social, helpExcerpts, articleExcerpt, mfaLead, mfaResend, OBS_CSS } from './_observed.mjs';
import { payDate, html, raw, doc, logo, alert, form, field, select, checkbox, button, hidden, methodChooser, newMethodFields, dateField, table, paymentRows, helpList, helpBody, helpSearchForm, money, fmtDate, methodText, statusLabel, L } from '../kit.mjs';
import { withdrawn, withdrawnView } from './_withdrawn.mjs';

export const meta = {
  id: 'dmv',
  // Where the dedicated tier"s dossier nav (vm.nav) goes: the first element matching a selector (class:<token> or aria:<label>) is
  // re-filled with the dossier"s items; observed real-site navs are superseded on public pages. See server.mjs withDossierNav.
  navSlots: { public: ['class:svc-nav'], account: ['class:svc-nav'] },
  name: 'Motor vehicle registration renewal (state DMV / county tag office)',
  description: 'Government e-services portal: guest-first "Renew Now" registration renewal looked up by plate number, registration class and last name; MyDMV-style account with vehicles, renewal notices and transaction history; itemized renewal fees with a card processing fee; automatic payments and paperless notices only when documented.',
  families: ['state-dmv-renewal', 'county-tag-office', 'altags-ingenuity'],
  sources: [
    'https://www.dmv.ca.gov/portal/vehicle-registration/vehicle-registration-renewal/',
    'https://dmv.ny.gov/registration/renew-registration',
    'https://www.altags.com/Baldwin_License/',
    'https://online.dmv.alaska.gov/OnlineGateway/Account/Login (catalog login_url)',
    'https://www.txdmv.gov/faqs (via search results on Texas by Texas renewal)'
  ],
  evidence: {
    observed_public: [
      'CA DMV: "Renew Now" primary action; requires license plate number and last 5 of VIN; insurance must be on file; smog certification; cannot renew online with unpaid parking citations; sibling actions "Check Your Status", "Update Info", "File for PNO"',
      'NY DMV: online renewal needs plate number, registration class, last name or business name on the registration, and a credit/debit card; fee shown matches the renewal notice; temporary registration printable after renewal',
      'Alabama county tag offices (altags.com): renew automobiles/trailers in one transaction; "3% processing charge with a minimum charge of $3.50"; decals mailed within 7 business days; refunds only for overpayments via the county office',
      'Texas by Texas: renewal window opens 90 days before expiration; insurance and inspection must be on file; confirmation email serves as proof until the sticker arrives'
    ],
    documented: ['Card processing fee percent/flat when stated in the research notes (catalog parseFees)', 'Biller phone, mailing address and service area from the research record'],
    synthetic: [
      'URL structure (/vehicle-services/registration/renew, /mydmv/...)',
      'Registration class list and wording of the insurance certification',
      'Default card processing fee of 2.35% (minimum $1.95) when none is documented (engine default for government billers)',
      'Yearly renewal history: four annual renewal notices (the current one open)',
      'Vehicle year/make, customer-number format'
    ]
  }
};

export const routes = {
  home: '/', login: '/mydmv/sign-in', loginPassword: '/mydmv/sign-in/password', mfa: '/mydmv/sign-in/verify', register: '/mydmv/create-account', verify: '/mydmv/create-account/verify', forgot: '/mydmv/forgot-password', reset: '/mydmv/reset-password',
  guest: '/vehicle-services/registration/renew', guestPay: '/vehicle-services/registration/renew/fees', guestReview: '/vehicle-services/registration/renew/review', guestReceipt: '/vehicle-services/registration/renew/confirmation/:id',
  dashboard: '/mydmv/home', bill: '/mydmv/vehicles/registration', statements: '/mydmv/notices', statement: '/mydmv/notices/:id.pdf',
  pay: '/mydmv/renew/fees', payMethod: '/mydmv/renew/payment', payReview: '/mydmv/renew/review', payReceipt: '/mydmv/renew/confirmation/:id',
  history: '/mydmv/transactions', autopay: '/mydmv/auto-renew', paperless: '/mydmv/notifications', wallet: '/mydmv/payment-options', cancel: '/mydmv/surrender-registration', plan: '/mydmv/registration-type',
  arrangement: '/mydmv/payment-arrangements', contact: '/mydmv/contact', profile: '/mydmv/profile', logout: '/mydmv/sign-out',
  help: '/online-services/help', helpArticle: '/online-services/help/topics/:slug', helpSearch: '/online-services/help/search'
};
export const flow = { paySteps: ['pay', 'payMethod', 'payReview'], loginSteps: 1, guestSteps: ['guest', 'guestPay', 'guestReview'] };

const sup = (vm, cap) => vm.biller.capabilities[cap]?.support === 'supported';
const offline = vm => vm.biller.capabilities.online_account.support === 'unsupported';
const isCounty = vm => /county|parish|probate|tag|license (?:office|commissioner)|tax (?:collector|assessor)/i.test(vm.biller.name);
const agencyNoun = vm => isCounty(vm) ? 'tag office' : 'DMV';
const agencyOffice = vm => isCounty(vm) ? 'tag office' : 'DMV office';
const acctName = vm => isCounty(vm) ? 'Online Tag Services' : 'MyDMV';

// Card fee wording mirrors engine.fee(): documented percent/flat, else the synthetic government default.
function cardFee(vm, cents) {
  const f = vm.biller.fees;
  if (f.cardPercent != null) return { text: `${f.cardPercent}% of the transaction${f.cardMinCents ? ` (minimum ${money(f.cardMinCents)})` : ''}`, cents: Math.max(f.cardMinCents || 0, Math.round(cents * f.cardPercent / 100)) };
  if (f.cardCents != null) return { text: f.cardCents ? `${money(f.cardCents)} per transaction` : 'no processing fee', cents: f.cardCents };
  return { text: '2.35% (minimum $1.95)', cents: Math.max(195, Math.round(cents * 0.0235)) };
}
const bankFee = vm => vm.biller.fees.bankCents ?? 0;
const vehicleText = vm => { const v = vm.account.vehicles?.[0] || {}; return `${v.year || ''} ${v.make || ''}`.trim() || 'Passenger vehicle'; };
const CLASSES = [['PAS', 'PAS – Passenger'], ['COM', 'COM – Commercial'], ['MOT', 'MOT – Motorcycle'], ['TRL', 'TRL – Trailer'], ['SRF', 'SRF – Special/Personalized']];

function header(vm) {
  return html`<div class="gov-banner"><span class="flag" aria-hidden="true"></span>Official online services of ${vm.biller.name}</div>
<header class="agency"><a class="agency-id" href="${vm.url('home')}">${logo(vm)}<span><strong>${vm.biller.brand.shortName}</strong><small>Motor Vehicle Services</small></span></a>${offline(vm) ? '' : vm.authenticated ? html`<div class="acct-chip"><span>Signed in as <strong>${vm.persona.name}</strong></span><a href="${vm.url('profile')}">${L(vm, 'profile', 'My profile')}</a><a href="${vm.url('logout')}">${L(vm, 'logout', 'Sign out')}</a></div>` : html`<div class="acct-chip"><a class="chip-btn" href="${vm.url('login')}">${acctName(vm)} Sign In</a></div>`}</header>`;
}
function navBar(vm) {
  if (offline(vm)) return html`<nav class="svc-nav" aria-label="Main"><a href="${vm.url('home')}">${L(vm, 'home', 'Home')}</a><a href="${vm.url('help')}">${L(vm, 'help', 'Help & FAQs')}</a></nav>`;
  const cur = p => vm.page === p ? raw(' aria-current="page"') : '';
  if (vm.authenticated) return html`<nav class="svc-nav" aria-label="${acctName(vm)}"><a href="${vm.url('dashboard')}"${cur('dashboard')}>${acctName(vm)} Home</a><a href="${vm.url('bill')}"${cur('bill')}>${L(vm, 'bill', 'My Vehicles')}</a><a href="${vm.url('pay')}"${cur('pay')}>${L(vm, 'pay', 'Renew & Pay Fees')}</a><a href="${vm.url('statements')}"${cur('statements')}>${L(vm, 'statements', 'Notices')}</a><a href="${vm.url('history')}"${cur('history')}>${L(vm, 'history', 'Transaction History')}</a><a href="${vm.url('wallet')}"${cur('wallet')}>${L(vm, 'wallet', 'Payment Options')}</a><a href="${vm.url('help')}"${cur('help')}>${L(vm, 'help', 'Help & FAQs')}</a></nav>`;
  return html`<nav class="svc-nav" aria-label="Main"><a href="${vm.url('home')}"${cur('home')}>${L(vm, 'home', 'Online Services')}</a>${sup(vm, 'guest_pay') ? html`<a href="${vm.url('guest')}"${cur('guest')}>${L(vm, 'guest', 'Renew Registration')}</a>` : ''}<a href="${vm.url('login')}"${cur('login')}>${acctName(vm)} Account</a><a href="${vm.url('help')}"${cur('help')}>${L(vm, 'help', 'Help & FAQs')}</a></nav>`;
}
function shell(vm, title, body, { crumbs = null, cls = '' } = {}) {
  return doc(vm, {
    title: `${title} | ${vm.biller.brand.shortName}`, bodyClass: 'dmv',
    body: html`<a class="skip" href="#main">Skip to main content</a>${header(vm)}${navBar(vm)}${obsNav(vm)}<main id="main" class="${cls}">${crumbs ? html`<ol class="crumbs">${crumbs.map(([t, u]) => html`<li>${u ? html`<a href="${u}">${t}</a>` : t}</li>`)}<li aria-current="page">${title}</li></ol>` : ''}${alert(vm)}${body}</main>
<footer class="gov-foot"><div class="foot-cols"><div><h2>${vm.biller.brand.shortName}</h2><p>${vm.biller.serviceArea || ''}</p>${vm.biller.phone ? html`<p>Customer service: <strong>${vm.biller.phone}</strong></p>` : ''}</div><div><h2>Online services</h2><ul>${!offline(vm) && sup(vm, 'guest_pay') ? html`<li><a href="${vm.url('guest')}">${L(vm, 'guest', 'Renew a registration')}</a></li>` : ''}<li><a href="${vm.url('helpArticle', { slug: 'pay-your-bill' })}">Fees &amp; ways to pay</a></li><li><a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact us</a></li><li><a href="${vm.url('help')}">${L(vm, 'help', 'Help & FAQs')}</a></li></ul></div><div><h2>Accessibility &amp; privacy</h2><p>This is a secure state/county e-service. Do not share your registration PIN or payment details by email.</p></div></div>${!vm.authenticated && vm.obs?.footer?.length ? html`<div class="foot-cols">${obsFooter(vm)}</div>` : ''}</footer>`
  });
}
const acctCrumbs = vm => [[`${acctName(vm)} Home`, vm.url('dashboard')]];
const steps = (labels, current) => html`<ol class="stepper" aria-label="Progress">${labels.map((l, i) => html`<li class="${i < current ? 'done' : i === current ? 'now' : ''}"${i === current ? raw(' aria-current="step"') : ''}><span>${i + 1}</span>${l}</li>`)}</ol>`;
const GUEST_STEPS = ['Find vehicle', 'Fees & payment', 'Review & certify', 'Confirmation'];
const PAY_STEPS = ['Renewal fees', 'Payment method', 'Review & submit', 'Confirmation'];

function feeTable(vm, { showCardFee = true } = {}) {
  const inv = vm.invoice; const fee = cardFee(vm, vm.balanceCents);
  const rows = inv.lines.map(l => [l.desc, money(l.cents)]);
  rows.push([html`<strong>Total renewal fees</strong>`, html`<strong>${money(inv.amountCents)}</strong>`]);
  if (vm.balanceCents !== inv.amountCents) rows.push([html`<strong>${L(vm, 'amountDue', 'Amount due now')}</strong>`, html`<strong>${money(vm.balanceCents)}</strong>`]);
  return html`${table(['Fee', 'Amount'], rows, 'table fees')}${showCardFee ? html`<p class="fee-note"><strong>Processing fee:</strong> card payments add ${fee.text}${fee.cents ? ` (about ${money(fee.cents)} on this renewal)` : ''}. Electronic check (bank account): ${bankFee(vm) ? money(bankFee(vm)) : 'no fee'}. The fee is charged by the payment processor and is non-refundable.</p>` : ''}`;
}
function vehicleCard(vm) {
  return html`<section class="vehicle-card" aria-label="Vehicle"><div class="plate" aria-label="License plate">${vm.account.plate}</div><dl class="facts"><dt>Vehicle</dt><dd>${vehicleText(vm)}</dd><dt>Registration class</dt><dd>PAS – Passenger</dd><dt>Registration expires</dt><dd>${vm.dueText}</dd><dt>Decal mailing address</dt><dd>${vm.account.serviceAddress}</dd></dl></section>`;
}
// Payment-method fields for guests: e-check or card, nothing saved.
function guestMethod(vm) {
  return html`<fieldset class="methods"><legend>How would you like to pay?</legend>${select(vm, { name: 'methodType', label: 'Payment type', options: [['', 'Select payment type…'], ['card', 'Credit or debit card'], ['bank', 'Electronic check (checking/savings)']] })}<div class="pm-grid"><div class="card-fields"><h3>Card</h3>${field(vm, { name: 'cardNumber', label: 'Card number', required: false, autocomplete: 'cc-number', inputmode: 'numeric' })}${field(vm, { name: 'exp', label: 'Expiration (MM/YY)', required: false, autocomplete: 'cc-exp', placeholder: 'MM/YY' })}${field(vm, { name: 'cvv', label: 'Security code (CVV)', required: false, autocomplete: 'cc-csc', inputmode: 'numeric', maxlength: 4 })}${field(vm, { name: 'holder', label: 'Name on card', required: false, autocomplete: 'cc-name' })}</div><div class="bank-fields"><h3>Electronic check</h3>${select(vm, { name: 'accountType', label: 'Account type', options: [['checking', 'Checking'], ['savings', 'Savings']] })}${field(vm, { name: 'routing', label: 'Routing number', required: false, inputmode: 'numeric', maxlength: 9 })}${field(vm, { name: 'bankAccount', label: 'Account number', required: false, inputmode: 'numeric' })}${field(vm, { name: 'bankAccountConfirm', label: 'Re-enter account number', required: false, inputmode: 'numeric' })}</div></div></fieldset>`;
}
function notOffered(vm, title, lead, more) {
  return shell(vm, title, html`<h1>${title}</h1><div class="notice notice-info"><p><strong>${lead}</strong></p>${more}</div><p><a class="btn" href="${vm.url('dashboard')}">Back to ${acctName(vm)} Home</a></p>`, { crumbs: acctCrumbs(vm) });
}

const pages = {
  home(vm) {
    if (offline(vm)) return shell(vm, 'Registration renewal', html`<h1>Renewing a registration with ${vm.biller.name}</h1>${heroLine(vm)}<div class="notice notice-warn"><p><strong>Online renewal and online payment are not available for this office.</strong></p></div><section class="panel"><h2>How to renew</h2>${helpBody(vm.help.find(a => a.slug === 'pay-your-bill'))}</section>${vm.biller.phone ? html`<p>Questions? Call <strong>${vm.biller.phone}</strong>.</p>` : html`<p>Use the contact information printed on your renewal notice.</p>`}`);
    const fee = cardFee(vm, 10000);
    return shell(vm, 'Online Services', html`<section class="hero"><div><p class="eyebrow">Vehicle services</p><h1>Renew your vehicle registration online</h1>${heroLine(vm)}<p class="lead">Renew in a few minutes with your license plate number. Your registration card and decal are mailed to the address on file.</p><p class="cta">${sup(vm, 'guest_pay') ? html`<a class="btn btn-primary btn-lg" href="${vm.url('guest')}">${L(vm, 'guest', 'Renew Now')}</a>` : ''}<a class="btn btn-lg" href="${vm.url('login')}">Sign in to ${acctName(vm)}</a></p><p class="small">New to ${acctName(vm)}? <a href="${vm.url('register')}">${L(vm, 'register', 'Create an account')}</a> to see all your vehicles, notices and receipts.</p></div><aside class="need"><h2>What you need</h2><ul><li>License plate number</li><li>Registration class (shown on your renewal notice)</li><li>Last name or business name on the registration</li><li>Proof of liability insurance on file</li><li>Credit/debit card (${fee.text} processing fee) or checking account</li></ul></aside></section>
<section class="tiles"><a class="tile" href="${sup(vm, 'guest_pay') ? vm.url('guest') : vm.url('login')}"><h2>Renew a registration</h2><p>Plates expiring within 90 days or up to one year expired.</p></a><a class="tile" href="${vm.url('login')}"><h2>${acctName(vm)} account</h2><p>Vehicles, renewal notices, receipts and saved payment options.</p></a><a class="tile" href="${vm.url('helpArticle', { slug: 'pay-your-bill' })}"><h2>Fees &amp; ways to pay</h2><p>Online, by mail${vm.biller.payPhone ? ', by phone' : ''} or in person at a ${agencyNoun(vm)}.</p></a><div class="tile"><h2>Search help</h2>${helpSearchForm(vm, { placeholder: 'Search registration help' })}</div></section>
<section class="panel"><h2>You cannot renew online if</h2><ul class="check-list"><li>Your registration has been expired for more than one year</li><li>Insurance or an emissions/safety inspection is not on file</li><li>You have unpaid parking citations, toll violations or a registration hold</li><li>You need to change the vehicle owner or registration class</li></ul><p>Visit a ${agencyOffice(vm)} for these transactions.</p></section>`);
  },
  login(vm) {
    return shell(vm, `${acctName(vm)} Sign In`, html`<div class="split"><section class="panel">${html`<h1>${acctName(vm)} Sign In</h1>`}${form(vm, 'login', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'username', label: idLabel(vm, 'Email address or customer number'), autocomplete: 'username' })}${field(vm, { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' })}${button(submitLabel(vm, 'Sign In'))}`)}${social(vm)}<p class="links"><a href="${vm.url('forgot')}">${L(vm, 'forgot', 'Forgot password?')}</a><a href="${vm.url('register')}">Create ${/^[AEIOU]/i.test(acctName(vm)) ? "an" : "a"} ${acctName(vm)} account</a></p></section><aside class="panel alt"><h2>Just renewing?</h2><p>You don't need an account to renew a registration.</p>${sup(vm, 'guest_pay') ? html`<p><a class="btn btn-primary" href="${vm.url('guest')}">${L(vm, 'guest', 'Renew without signing in')}</a></p>` : ''}<p class="small">Have your plate number and the last name on the registration ready.</p></aside></div>`);
  },
  loginPassword(vm) { return pages.login(vm); },
  mfa(vm) { return shell(vm, 'Verify your identity', html`<section class="panel narrow"><h1>Verify your identity</h1><p>${mfaLead(vm, `For your security we emailed a 6-digit verification code to the address on your ${acctName(vm)} account.`)}</p>${form(vm, 'mfa', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'code', label: 'Verification code', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' })}${button('Verify and continue')}`)}${mfaResend(vm)}</section>`); },
  register(vm) {
    return shell(vm, `Create ${/^[AEIOU]/i.test(acctName(vm)) ? "an" : "a"} ${acctName(vm)} account`, html`<section class="panel narrow"><h1>Create ${/^[AEIOU]/i.test(acctName(vm)) ? "an" : "a"} ${acctName(vm)} account</h1><p>Your customer number is printed on your renewal notice and registration card.</p>${form(vm, 'register', html`<fieldset><legend>Identify your record</legend>${field(vm, { name: 'accountNumber', label: 'Customer number', inputmode: 'numeric' })}${field(vm, { name: 'lastName', label: 'Last name (or business name) on the registration' })}${field(vm, { name: 'zip', label: 'Residence ZIP code', inputmode: 'numeric', maxlength: 5 })}</fieldset><fieldset><legend>Sign-in details</legend>${field(vm, { name: 'email', label: 'Email address', type: 'email', autocomplete: 'email' })}${field(vm, { name: 'password', label: 'Create password', type: 'password', autocomplete: 'new-password', help: '8–64 characters with upper and lower case letters, a number and a symbol' })}${field(vm, { name: 'confirm', label: 'Confirm password', type: 'password', autocomplete: 'new-password' })}</fieldset>${button('Create account')}`)}</section>`);
  },
  verify(vm) { return shell(vm, 'Verify your email', html`<section class="panel narrow"><h1>Verify your email</h1><p>Open the verification link we emailed you to activate your ${acctName(vm)} account.</p></section>`); },
  forgot(vm) { return shell(vm, 'Forgot password', html`<section class="panel narrow"><h1>${L(vm, 'forgot', 'Forgot password')}</h1><p>Enter your email address or customer number. If we find your account, we'll email a verification code.</p>${form(vm, 'forgot', html`${field(vm, { name: 'identifier', label: 'Email address or customer number', autocomplete: 'username' })}${button('Send verification code')}`)}</section>`); },
  reset(vm) { return shell(vm, 'Reset password', html`<section class="panel narrow"><h1>Reset your password</h1>${form(vm, 'reset', html`${vm.query.token ? hidden('token', vm.query.token) : field(vm, { name: 'code', label: 'Verification code from your email', inputmode: 'numeric', autocomplete: 'one-time-code' })}${field(vm, { name: 'password', label: 'New password', type: 'password', autocomplete: 'new-password' })}${field(vm, { name: 'confirm', label: 'Confirm new password', type: 'password', autocomplete: 'new-password' })}${button('Reset password')}`)}</section>`); },

  guest(vm) {
    return shell(vm, 'Renew Registration', html`${steps(GUEST_STEPS, 0)}<div class="split"><section class="panel"><h1>${L(vm, 'guest', 'Renew Registration')}</h1><p>Enter your vehicle information exactly as it appears on your renewal notice.</p>${form(vm, 'guest', html`${field(vm, { name: 'plate', label: 'License plate number', help: 'Letters and numbers only, no spaces or dashes', autocomplete: 'off' })}${select(vm, { name: 'regClass', label: 'Registration class', options: CLASSES })}${field(vm, { name: 'lastName', label: 'Last name or business name on the registration' })}${button('Find my vehicle')}`)}</section><aside class="panel alt"><h2>Before you start</h2><ul class="check-list"><li>Liability insurance must be reported to the ${agencyNoun(vm)} by your insurer.</li><li>Any required emissions or safety inspection must be on file.</li><li>Renew up to 90 days before expiration.</li></ul><p class="small">Need to change your address? Update it before renewing so your decal is mailed to the right place.</p></aside></div>`, { crumbs: [['Online Services', vm.url('home')]] });
  },
  guestPay(vm) {
    return shell(vm, 'Renewal fees and payment', html`${steps(GUEST_STEPS, 1)}<h1>Confirm vehicle and renewal fees</h1>${vehicleCard(vm)}<section class="panel"><h2>Renewal fees</h2><p class="small">Renewal notice ${vm.invoice.number} · renews registration through one year from ${vm.dueText}</p>${feeTable(vm)}</section>${form(vm, 'guestPay', html`${hidden('amountChoice', 'due')}${guestMethod(vm)}<div class="actions">${button('Continue to review')}<a class="btn btn-link" href="${vm.url('guest')}">Start over</a></div>`)}`);
  },
  guestReview(vm) { return reviewPage(vm, 'guestReview'); },
  guestReceipt(vm) { return receiptPage(vm); },

  dashboard(vm) {
    const status = vm.service.status === 'active' ? (vm.balanceCents > 0 ? 'Renewal due' : 'Current') : 'Inactive';
    return shell(vm, `${acctName(vm)} Home`, html`<h1>Welcome, ${vm.persona.first}</h1>${vm.balanceCents > 0 ? html`<div class="notice notice-warn"><p><strong>Registration renewal due.</strong> Plate ${vm.account.plate} expires ${vm.dueText}. Fees due: <strong>${money(vm.balanceCents)}</strong>.</p><p><a class="btn btn-primary" href="${vm.url('pay')}">${L(vm, 'pay', 'Renew now')}</a></p></div>` : html`<div class="notice notice-ok"><p>All registrations on your account are current.</p></div>`}${vm.scheduled.length ? html`<p class="notice notice-info">You have ${vm.scheduled.length} scheduled payment(s). <a href="${vm.url('history')}">${L(vm, 'history', 'View transaction history')}</a></p>` : ''}${vm.pendingPayments.length ? html`<p class="muted">${vm.pendingPayments.length} renewal payment(s) processing — decals are mailed after the payment posts.</p>` : ''}
<div class="dash"><section><h2>My Vehicles</h2>${table(['Plate', 'Vehicle', 'Expires', 'Status', 'Actions'], [[html`<span class="plate sm">${vm.account.plate}</span>`, vehicleText(vm), vm.dueText, status, html`<a href="${vm.url('bill')}">${L(vm, 'bill', 'View registration')}</a> · <a href="${vm.url('pay')}">${L(vm, 'pay', 'Renew')}</a>`]])}
<h2>Account</h2><dl class="facts"><dt>Customer number</dt><dd>${vm.accountMasked}</dd><dt>Mailing address</dt><dd>${vm.account.serviceAddress}</dd><dt>Email</dt><dd>${vm.persona.email}</dd>${sup(vm, 'paperless') ? html`<dt>Email renewal notices</dt><dd>${vm.account.paperless ? 'On' : 'Off'} · <a href="${vm.url('paperless')}">${L(vm, 'paperless', 'Notification settings')}</a></dd>` : ''}${sup(vm, 'autopay') ? html`<dt>Auto-renew</dt><dd>${vm.autopay.enrolled ? 'On' : 'Off'} · <a href="${vm.url('autopay')}">Manage auto-renew</a></dd>` : ''}</dl></section>
<aside class="quick"><h2>I want to…</h2><ul><li><a href="${vm.url('pay')}">${L(vm, 'pay', 'Renew a registration')}</a></li><li><a href="${vm.url('statements')}">${L(vm, 'statements', 'View renewal notices')}</a></li><li><a href="${vm.url('history')}">${L(vm, 'history', 'View transaction history & receipts')}</a></li><li><a href="${vm.url('wallet')}">Manage payment options</a></li>${sup(vm, 'autopay') ? html`<li><a href="${vm.url('autopay')}">${L(vm, 'autopay', 'Set up auto-renew')}</a></li>` : ''}${sup(vm, 'paperless') ? html`<li><a href="${vm.url('paperless')}">${L(vm, 'paperless', 'Get renewal notices by email')}</a></li>` : ''}<li><a href="${vm.url('profile')}">Update my address or phone</a></li><li><a href="${vm.url('contact')}">Contact the ${agencyNoun(vm)}</a></li>${sup(vm, 'cancel_service') ? html`<li><a href="${vm.url('cancel')}">${L(vm, 'cancel', 'Surrender plates')}</a></li>` : ''}</ul></aside></div>`);
  },
  bill(vm) {
    const inv = vm.invoice;
    return shell(vm, 'Vehicle registration', html`<h1>Vehicle registration – ${vm.account.plate}</h1>${vehicleCard(vm)}<section class="panel"><h2>Renewal notice ${inv.number}</h2><p class="small">Issued ${fmtDate(inv.issuedAt)} · Renew by <strong>${fmtDate(inv.dueAt)}</strong></p>${feeTable(vm)}<p class="amount-due">Amount due: <strong>${money(vm.balanceCents)}</strong></p><p class="actions"><a class="btn btn-primary" href="${vm.url('pay')}">${L(vm, 'pay', 'Renew & pay fees')}</a><a class="btn" href="${vm.url('statement', { id: inv.id })}">Download renewal notice (PDF)</a></p></section>`, { crumbs: acctCrumbs(vm) });
  },
  statements(vm) {
    return shell(vm, 'Notices', html`<h1>${L(vm, 'statements', 'Renewal and fee notices')}</h1><p>Notices issued for vehicles on your account. Select a notice to open a printable PDF copy.</p>${table(['Notice date', 'Notice', 'Amount', 'Due', 'Status', ''], vm.invoices.map((i, n) => [fmtDate(i.issuedAt), `Renewal notice ${i.number}`, money(i.amountCents), fmtDate(i.dueAt), i.balanceCents > 0 ? 'Open' : 'Paid', html`<a href="${vm.url('statement', { id: i.id })}">View PDF</a>`]))}`, { crumbs: acctCrumbs(vm) });
  },
  pay(vm) {
    return shell(vm, 'Renew & pay fees', html`${steps(PAY_STEPS, 0)}<h1>${L(vm, 'pay', 'Renewal fees')}</h1>${vehicleCard(vm)}<section class="panel">${feeTable(vm, { showCardFee: false })}</section>${form(vm, 'pay', html`${amountRadios(vm)}<div class="actions">${button('Continue to payment')}<a class="btn btn-link" href="${vm.url('dashboard')}">${L(vm, 'dashboard', 'Cancel')}</a></div>`)}`, { crumbs: acctCrumbs(vm) });
  },
  payMethod(vm) {
    const fee = cardFee(vm, vm.draft?.amountCents || vm.balanceCents);
    return shell(vm, 'Payment method', html`${steps(PAY_STEPS, 1)}<h1>Payment method</h1>${vm.draft?.amountCents ? html`<p>Paying <strong>${money(vm.draft.amountCents)}</strong> toward plate ${vm.account.plate}. <a href="${vm.url('pay')}">Change amount</a></p>` : html`<p class="notice notice-info">Choose the fees to pay first. <a href="${vm.url('pay')}">Go to renewal fees</a></p>`}<p class="fee-note">Card payments add a processing fee of ${fee.text}. Electronic checks: ${bankFee(vm) ? money(bankFee(vm)) : 'no fee'}.</p>${form(vm, 'payMethod', html`${methodChooser(vm, { title: 'Pay with' })}${dateField(vm, { name: 'payOn', label: 'Payment date' })}<p class="small">Choose a future date to schedule the payment. Your registration renews when the payment posts.</p><div class="actions">${button('Continue to review')}<a class="btn btn-link" href="${vm.url('pay')}">Back</a></div>`)}`, { crumbs: acctCrumbs(vm) });
  },
  payReview(vm) { return reviewPage(vm, 'payReview'); },
  payReceipt(vm) { return receiptPage(vm); },
  history(vm) { return shell(vm, 'Transaction history', html`<h1>${L(vm, 'history', 'Transaction history')}</h1><p>Renewals and fee payments made online. Scheduled payments can be cancelled until they begin processing.</p>${table(['Date', 'Amount', 'Paid with', 'Confirmation', 'Status', ''], paymentRows(vm))}`, { crumbs: acctCrumbs(vm), cls: 'wide' }); },
  autopay(vm) {
    if (!sup(vm, 'autopay')) return notOffered(vm, 'Auto-renew', 'Automatic renewal payments are not offered online.', html`<p>Registration must be renewed each period. We mail (or email, where available) a renewal notice before your registration expires; renew from ${acctName(vm)} or with Renew Now.</p>`);
    const ap = vm.autopay;
    return shell(vm, 'Auto-renew', html`<h1>${L(vm, 'autopay', 'Auto-renew')}</h1><p>Auto-renew pays your renewal fees on the renewal due date, as long as insurance and inspection requirements are met.</p>${ap.enrolled ? html`<section class="panel"><p><strong>Auto-renew is on</strong> using ${vm.autopayMethod ? methodText(vm.autopayMethod) : 'your saved payment option'}.</p>${form(vm, 'autopay', html`${hidden('action', 'cancel')}${checkbox(vm, { name: 'confirm', label: 'I understand I must renew manually in the future.' })}${button('Turn off auto-renew', { cls: 'btn btn-danger' })}`)}</section><h2>Change auto-renew</h2>` : ''}${form(vm, 'autopay', html`${hidden('action', 'enroll')}${hidden('policy', 'full')}${methodChooser(vm, { title: 'Pay renewal fees from' })}${checkbox(vm, { name: 'acceptTerms', label: 'I authorize automatic payment of my renewal fees, including any card processing fee.' })}${button(ap.enrolled ? 'Save auto-renew' : 'Turn on auto-renew')}`)}`, { crumbs: acctCrumbs(vm) });
  },
  paperless(vm) {
    if (!sup(vm, 'paperless')) return notOffered(vm, 'Notification settings', 'Email-only (paperless) renewal notices are not offered online.', html`<p>Renewal notices are mailed to the address on your registration. Keep your address current from <a href="${vm.url('profile')}">${L(vm, 'profile', 'My profile')}</a>.</p>`);
    return shell(vm, 'Notification settings', html`<h1>${L(vm, 'paperless', 'Notification settings')}</h1><section class="panel"><p>Paperless renewal notices are <strong>${vm.account.paperless ? 'on' : 'off'}</strong>.</p>${form(vm, 'paperless', html`${hidden('paperless', vm.account.paperless ? 'off' : 'on')}${!vm.account.paperless ? field(vm, { name: 'email', label: 'Email renewal notices to', type: 'email', value: vm.persona.email }) : ''}${button(vm.account.paperless ? 'Mail paper notices instead' : 'Email my renewal notices (stop paper)')}`)}</section>`, { crumbs: acctCrumbs(vm) });
  },
  wallet(vm) {
    return shell(vm, 'Payment options', html`<h1>${L(vm, 'wallet', 'Payment options')}</h1><p>Saved payment options can be used for renewals and fees. Card payments include a processing fee of ${cardFee(vm, 10000).text}.</p><ul class="wallet">${vm.methods.map(m => html`<li><span>${methodText(m)}${m.nickname ? html` <span class="muted">(${m.nickname})</span>` : ''}</span>${form(vm, 'wallet', html`${hidden('op', 'remove')}${hidden('methodId', m.id)}<button type="submit" class="btn btn-link" aria-label="Remove ${methodText(m)}">Remove</button>`)}</li>`)}</ul><section class="panel"><h2>Add a payment option</h2>${form(vm, 'wallet', html`${hidden('op', 'add')}${newMethodFields(vm)}${field(vm, { name: 'nickname', label: 'Nickname (optional)', required: false })}${button('Save payment option')}`)}</section>`, { crumbs: acctCrumbs(vm) });
  },
  cancel(vm) {
    if (!sup(vm, 'cancel_service')) return notOffered(vm, 'Surrender plates', 'Registrations cannot be cancelled online.', html`<p>To cancel a registration or surrender plates (for example after selling the vehicle or moving out of state), return the plates to a ${agencyOffice(vm)}. ${vm.biller.phone ? `Questions: ${vm.biller.phone}.` : ''}</p>`);
    if (vm.service.status !== 'active' && vm.step !== 'done') return shell(vm, 'Surrender plates', html`<h1>${L(vm, 'cancel', 'Surrender plates')}</h1><p>Your registration ${vm.service.status === 'cancel_pending' ? `ends on ${fmtDate(vm.service.cancelAt)}` : 'is cancelled'}.</p>${vm.service.status === 'cancel_pending' ? form(vm, 'cancel', html`${hidden('step', 'undo')}${button('Keep my registration')}`) : ''}`, { crumbs: acctCrumbs(vm) });
    const s = {
      reason: html`<h1>Surrender plates</h1>${form(vm, 'cancel', html`${hidden('step', 'reason')}${select(vm, { name: 'reason', label: 'Reason', options: [['', 'Select a reason'], ['moving', 'Moving out of state'], ['sold', 'Vehicle sold or transferred'], ['not_using', 'Vehicle not in use'], ['other', 'Other']] })}${button('Continue')}`)}`,
      offer: html`<h1>Surrender plates</h1>${form(vm, 'cancel', html`${hidden('step', 'offer')}${button('Continue', { name: 'accept', value: 'no' })}`)}`,
      confirm: html`<h1>Confirm surrender</h1>${form(vm, 'cancel', html`${hidden('step', 'confirm')}${dateField(vm, { name: 'effectiveDate', label: 'Cancel registration effective' })}${checkbox(vm, { name: 'confirm', label: 'I will return the plates to a tag office.' })}${button('Cancel registration', { cls: 'btn btn-danger' })}`)}`,
      done: withdrawn(vm) ? withdrawnView(vm) : html`<h1>Request received</h1><p>Registration ends <strong>${vm.service.cancelAt ? fmtDate(vm.service.cancelAt) : ''}</strong>. Confirmation <strong>${vm.service.confirmation || ''}</strong>.</p>`,
      kept: html`<h1>Registration kept</h1>`
    };
    return shell(vm, 'Surrender plates', s[vm.step], { crumbs: acctCrumbs(vm) });
  },
  plan(vm) { return notOffered(vm, 'Registration type', 'Registration class changes are not available online.', html`<p>To change a registration class or plate type (for example to a personalized or disability plate), visit a ${agencyOffice(vm)} with your current registration.</p>`); },
  arrangement(vm) { return notOffered(vm, 'Payment arrangements', 'Installment plans are not offered for registration fees.', html`<p>Renewal fees must be paid in full before a registration and decal can be issued. Late fees may apply after the expiration date.</p>`); },
  contact(vm) {
    return shell(vm, 'Contact us', html`<h1>Contact the ${agencyNoun(vm)}</h1>${vm.account.messages.length ? html`<section class="panel"><h2>Your inquiries</h2><ul>${vm.account.messages.map(m => html`<li>${fmtDate(m.at)} – ${m.subject} (${m.status})</li>`)}</ul></section>` : ''}<section class="panel">${form(vm, 'contact', html`${field(vm, { name: 'subject', label: 'Subject' })}<div class="field"><label for="f-message">Your question</label><textarea id="f-message" name="message" rows="6" required>${vm.values.message || ''}</textarea><small class="help">Don't include card or bank numbers.</small></div>${button('Submit inquiry')}`)}</section>${vm.biller.phone ? html`<p>Phone: <strong>${vm.biller.phone}</strong></p>` : ''}`, { crumbs: acctCrumbs(vm) });
  },
  profile(vm) {
    return shell(vm, 'My profile', html`<h1>${L(vm, 'profile', 'My profile')}</h1><section class="panel"><dl class="facts"><dt>Name</dt><dd>${vm.persona.name}</dd><dt>Email</dt><dd>${vm.persona.email}</dd><dt>Mailing address</dt><dd>${vm.account.serviceAddress}</dd><dt>Phone</dt><dd>${vm.account.phone || 'Not provided'}</dd></dl></section><section class="panel"><h2>Update phone number</h2>${form(vm, 'profile', html`${field(vm, { name: 'phone', label: 'Phone number', type: 'tel' })}${button('Save phone number')}`)}<p class="small">Address changes must be filed with the ${agencyNoun(vm)} within the time required by state law.</p></section>`, { crumbs: acctCrumbs(vm) });
  },
  help(vm) {
    const groups = {}; for (const a of vm.help) (groups[a.topic] ||= []).push(a);
    const names = { payments: 'Fees & payments', billing: 'Notices & records', autopay: 'Auto-renew', account: `${acctName(vm)} account`, assistance: 'Assistance', contact: 'Contact', faq: 'Frequently asked questions' };
    return shell(vm, 'Help & FAQs', html`<h1>${L(vm, 'help', 'Help & FAQs')}</h1>${helpSearchForm(vm, { placeholder: 'Search registration help' })}<div class="help-groups">${Object.entries(groups).map(([k, list]) => html`<section class="panel"><h2>${names[k] || k}</h2>${helpList(vm, list)}</section>`)}</div>${helpExcerpts(vm)}`, { crumbs: [['Online Services', vm.url('home')]] });
  },
  helpArticle(vm) { return shell(vm, vm.article.title, html`<article class="panel"><h1>${vm.article.title}</h1>${helpBody(vm.article)}</article>${articleExcerpt(vm)}<p><a href="${vm.url('help')}">‹ Back to Help &amp; FAQs</a></p>`, { crumbs: [['Online Services', vm.url('home')], ['Help & FAQs', vm.url('help')]] }); },
  helpSearch(vm) { return shell(vm, 'Search help', html`<h1>Search help</h1>${helpSearchForm(vm, { placeholder: 'Search registration help' })}${vm.results.length ? helpList(vm, vm.results) : html`<p>No help topics match “${vm.query.q || ''}”.</p>`}`, { crumbs: [['Online Services', vm.url('home')], ['Help & FAQs', vm.url('help')]] }); }
};

function amountRadios(vm) {
  const sel = vm.values.amountChoice || vm.draft?.amountKey || 'due';
  const labels = { due: 'Total renewal fees due', other: 'Other amount (partial payment toward fees due)' };
  return html`<fieldset class="amounts"><legend>Amount to pay</legend>${vm.amountOptions.map(o => html`<label class="radio"><input type="radio" name="amountChoice" value="${o.key}"${sel === o.key ? raw(' checked') : ''}> <span>${labels[o.key] || o.label}</span>${o.cents != null ? html` <strong class="amt">${money(o.cents)}</strong>` : html` <input class="other-amount" name="amount" inputmode="decimal" aria-label="Other amount" placeholder="0.00" value="${vm.values.amount ?? (vm.draft?.amountKey === 'other' ? (vm.draft.amountCents / 100).toFixed(2) : '')}">`}</label>`)}<p class="small">Your registration and decal are issued only when all renewal fees are paid.</p></fieldset>`;
}
function reviewPage(vm, page) {
  const d = vm.draft; const guest = page === 'guestReview';
  return shell(vm, 'Review and certify', html`${steps(guest ? GUEST_STEPS : PAY_STEPS, 2)}<h1>Review and certify</h1><div class="review-grid"><section class="panel"><h2>Vehicle</h2><dl class="facts"><dt>Plate</dt><dd>${vm.account.plate}</dd><dt>Vehicle</dt><dd>${vehicleText(vm)}</dd><dt>Decal mailed to</dt><dd>${vm.account.serviceAddress}</dd></dl></section><section class="panel"><h2>Payment</h2><dl class="facts"><dt>Renewal fees</dt><dd>${money(d.amountCents)}</dd><dt>Processing fee</dt><dd>${money(d.feeCents || 0)}</dd><dt>Total charge</dt><dd><strong>${money(d.totalCents)}</strong></dd><dt>Paid with</dt><dd>${methodText(d.method)}</dd><dt>Payment date</dt><dd>${d.payOn || 'Today'}</dd></dl></section></div>${form(vm, page, html`${hidden('token', d.token)}${hidden('op', 'submit')}<div class="certify">${checkbox(vm, { name: 'acceptTerms', label: 'I certify that this vehicle is covered by the liability insurance required by state law, that the information above is correct, and I authorize this charge. Processing fees are non-refundable.' })}</div><div class="actions">${button('Submit renewal payment')}</div>`)}${!guest ? form(vm, page, html`${hidden('op', 'edit')}${button('Edit payment', { cls: 'btn btn-link' })}`) : html`<p><a href="${vm.url('guestPay')}">‹ Change payment details</a></p>`}`);
}
function receiptPage(vm) {
  const p = vm.payment; const scheduled = p.status === 'scheduled'; const failed = p.status === 'failed';
  // A partial payment does not renew the registration: fees are still due and no decal is issued yet.
  const partial = !scheduled && !failed && vm.balanceCents > 0;
  return shell(vm, 'Confirmation', html`${steps(vm.authenticated ? PAY_STEPS : GUEST_STEPS, 3)}<h1>${scheduled ? 'Renewal payment scheduled' : failed ? 'Payment not completed' : partial ? 'Partial payment received' : 'Renewal submitted'}</h1>${partial ? html`<div class="notice notice-warn"><p><strong>Partial payment received; ${money(vm.balanceCents)} still due before your registration can be renewed.</strong> Your registration card and decal are issued only after all renewal fees are paid.</p></div>` : ''}<section class="panel receipt"><dl class="facts"><dt>Confirmation number</dt><dd><strong>${p.confirmation}</strong></dd><dt>Plate</dt><dd>${vm.account.plate}</dd><dt>Renewal fees</dt><dd>${money(p.amountCents)}</dd>${p.feeCents ? html`<dt>Processing fee</dt><dd>${money(p.feeCents)}</dd>` : ''}<dt>Total charged</dt><dd>${money(p.amountCents + (p.feeCents || 0))}</dd><dt>Paid with</dt><dd>${vm.paymentMethod ? methodText(vm.paymentMethod) : `****${p.methodLast4}`}</dd><dt>Date</dt><dd>${payDate(p)}</dd><dt>Status</dt><dd>${statusLabel(p.status)}</dd></dl></section>${!scheduled && !failed && !partial ? html`<div class="notice notice-info"><p>Keep this confirmation as proof of renewal until your registration card and decal arrive by mail (usually within 7–10 business days). A copy was emailed to you.</p></div>` : ''}<p class="actions">${vm.authenticated ? html`<a class="btn btn-primary" href="${vm.url('dashboard')}">Back to ${acctName(vm)} Home</a><a class="btn" href="${vm.url('history')}">${L(vm, 'history', 'Transaction history')}</a>` : html`<a class="btn btn-primary" href="${vm.url('home')}">Done</a>`}</p>`);
}

export function render(page, vm) { const fn = pages[page]; if (!fn) throw new Error(`dmv template cannot render ${page}`); vm = observe(vm); return finish(vm, fn(vm)); }

export const css = `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;font:16px/1.55 "Source Sans Pro","Public Sans","Helvetica Neue",Helvetica,Arial,sans-serif;color:#1b1b1b;background:#f0f0f0;display:flex;flex-direction:column;min-height:100vh}main{flex:1 0 auto;width:100%}
a{color:#005ea2}a:hover{color:#1a4480}h1,h2,h3{font-family:Merriweather,Georgia,"Times New Roman",serif;color:#162e51;line-height:1.25}h1{font-size:30px;margin:8px 0 16px}h2{font-size:20px;margin:0 0 10px}h3{font-size:16px}
.skip{position:absolute;left:-999px}.skip:focus{left:8px;top:8px;background:#fff;padding:8px;z-index:9}
.gov-banner{background:#e6e6e6;font-size:13px;padding:4px 24px;display:flex;align-items:center;gap:8px;color:#1b1b1b}.flag{display:inline-block;width:16px;height:11px;background:linear-gradient(#b22234 0 15%,#fff 15% 30%,#b22234 30% 45%,#fff 45% 60%,#b22234 60% 75%,#fff 75% 90%,#b22234 90%);border:1px solid #999}
.agency{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;background:#fff;padding:14px 24px;border-bottom:1px solid #dfe1e2}.agency-id{display:flex;gap:12px;align-items:center;text-decoration:none;color:#162e51}.agency-id strong{display:block;font-family:Merriweather,Georgia,serif;font-size:21px}.agency-id small{display:block;color:#565c65;font-size:14px;text-transform:uppercase;letter-spacing:.06em}.logo{width:48px;height:48px}
.acct-chip{display:flex;gap:16px;align-items:center;font-size:14px}.chip-btn{background:#162e51;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none;font-weight:700}.chip-btn:hover{color:#fff;background:#1a4480}
.svc-nav{display:flex;flex-wrap:wrap;background:#162e51;padding:0 16px;border-bottom:4px solid var(--brand)}.svc-nav a{color:#fff;text-decoration:none;padding:12px 16px;font-weight:600;font-size:15px}.svc-nav a:hover,.svc-nav a[aria-current]{background:#1a4480;box-shadow:inset 0 -4px 0 #ffbe2e}
main{max-width:1040px;margin:0 auto;padding:20px 20px 40px}main.wide{max-width:1200px}
.crumbs{list-style:none;padding:0;margin:0 0 8px;display:flex;flex-wrap:wrap;font-size:14px;color:#565c65}.crumbs li+li:before{content:"›";margin:0 8px}
.hero{display:grid;grid-template-columns:1.6fr 1fr;gap:24px;background:#fff;border-top:6px solid var(--brand);padding:28px;margin-bottom:20px}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:#565c65;font-size:13px;margin:0}.lead{font-size:19px;color:#3d4551}.cta{display:flex;gap:12px;flex-wrap:wrap}.need{background:#f1f7fd;border-left:4px solid #005ea2;padding:16px 20px}.need ul{padding-left:20px;margin:0}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px}.tile{display:block;background:#fff;border:1px solid #dfe1e2;border-top:4px solid #162e51;padding:16px;text-decoration:none;color:#1b1b1b}a.tile:hover{border-top-color:#ffbe2e}.tile h2{font-size:17px;color:#005ea2}.tile p{margin:0;font-size:14px;color:#3d4551}
.panel{background:#fff;border:1px solid #dfe1e2;padding:20px 24px;margin-bottom:16px}.panel.alt{background:#f1f7fd;border-color:#c2d9ee}.panel.narrow{max-width:560px;margin:0 auto 16px}.split{display:grid;grid-template-columns:1.4fr 1fr;gap:20px;align-items:start}
.btn{display:inline-block;border:2px solid #005ea2;background:#fff;color:#005ea2;padding:9px 20px;border-radius:4px;font:inherit;font-weight:700;text-decoration:none;cursor:pointer;line-height:1.2}.btn-primary{background:#005ea2;color:#fff}.btn-primary:hover{background:#1a4480;color:#fff;border-color:#1a4480}.btn-lg{padding:13px 26px;font-size:18px}.btn-danger{background:#b50909;border-color:#b50909;color:#fff}.btn-link{border:0;background:none;padding:0;color:#005ea2;text-decoration:underline;font-weight:400}
.actions{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:16px}.links{display:flex;gap:20px;flex-wrap:wrap}.small{font-size:14px;color:#565c65}.muted{color:#71767a}
.field{margin:14px 0}.field label{display:block;font-weight:700;margin-bottom:4px}.field input,.field select,.field textarea{width:100%;max-width:30rem;padding:9px 10px;border:1px solid #565c65;border-radius:0;font:inherit;background:#fff}.field input:focus,.field select:focus,textarea:focus{outline:3px solid #2491ff;outline-offset:0}.help{display:block;color:#565c65;font-size:14px}
fieldset{border:1px solid #dfe1e2;padding:12px 18px;margin:16px 0;background:#fff}legend{font-weight:700;font-family:Merriweather,Georgia,serif;color:#162e51;padding:0 6px}.radio,.check{display:block;margin:10px 0}.other-amount{width:120px;padding:5px 8px;border:1px solid #565c65}.amt{margin-left:6px}
.pm-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.pm-grid h3{margin:12px 0 0;border-bottom:1px solid #dfe1e2;padding-bottom:4px}
.stepper{list-style:none;display:flex;padding:0;margin:4px 0 20px;counter-reset:s;gap:4px}.stepper li{flex:1;border-bottom:8px solid #dfe1e2;padding-bottom:6px;font-size:14px;color:#565c65;display:flex;gap:6px;align-items:center}.stepper li span{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#dfe1e2;color:#1b1b1b;font-weight:700;font-size:13px}.stepper li.done{border-color:#162e51}.stepper li.done span{background:#162e51;color:#fff}.stepper li.now{border-color:#005ea2;color:#1b1b1b;font-weight:700}.stepper li.now span{background:#005ea2;color:#fff}
.vehicle-card{display:flex;gap:24px;align-items:center;background:#fff;border:1px solid #dfe1e2;border-left:6px solid var(--brand);padding:18px 22px;margin-bottom:16px}.plate{font:700 26px/1 "Courier New",Courier,monospace;letter-spacing:.12em;border:3px solid #162e51;border-radius:8px;padding:14px 18px;background:linear-gradient(#fff 70%,#e7f2f5);color:#162e51;min-width:170px;text-align:center}.plate.sm{font-size:14px;padding:3px 8px;border-width:2px;border-radius:4px;min-width:0;display:inline-block}
dl.facts{display:grid;grid-template-columns:max-content 1fr;gap:6px 18px;margin:0}dl.facts dt{color:#565c65}dl.facts dd{margin:0;font-weight:600}
.table{width:100%;border-collapse:collapse;background:#fff;margin:8px 0}.table th,.table td{text-align:left;padding:10px 12px;border-bottom:1px solid #dfe1e2}.table th{background:#f0f0f0;font-size:14px;text-transform:uppercase;letter-spacing:.03em;color:#3d4551}.table td:last-child{white-space:nowrap}.fees td:last-child,.fees th:last-child{text-align:right}.empty{color:#71767a}
.fee-note{background:#faf3d1;border-left:4px solid #ffbe2e;padding:10px 14px;font-size:14px}.amount-due{font-size:20px}
.notice{padding:14px 18px;border-left:6px solid;margin:0 0 16px;background:#fff}.notice p{margin:4px 0}.notice-warn{border-color:#ffbe2e;background:#faf3d1}.notice-ok{border-color:#00a91c;background:#ecf3ec}.notice-info{border-color:#00bde3;background:#e7f6f8}
.alert{padding:14px 18px;margin-bottom:16px;border-left:6px solid}.alert-error{background:#f4e3db;border-color:#d54309;color:#1b1b1b}.alert-ok{background:#ecf3ec;border-color:#00a91c}
.dash{display:grid;grid-template-columns:2fr 1fr;gap:24px;align-items:start}.quick{background:#fff;border:1px solid #dfe1e2;border-top:4px solid #ffbe2e;padding:16px 20px}.quick ul{list-style:none;padding:0;margin:0}.quick li{padding:8px 0;border-bottom:1px solid #f0f0f0}
.review-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.certify{background:#f1f7fd;border:1px solid #c2d9ee;padding:8px 16px}.receipt{border-top:6px solid #00a91c}
.check-list{padding-left:20px}.check-list li{margin:6px 0}.wallet{list-style:none;padding:0}.wallet li{display:flex;justify-content:space-between;align-items:center;background:#fff;border:1px solid #dfe1e2;padding:10px 16px;margin-bottom:8px}.wallet form{display:inline}
details summary{cursor:pointer;color:#005ea2;font-weight:700;margin:8px 0}.help-search{display:flex;gap:8px;margin:10px 0 18px}.help-search input{flex:1;padding:9px;border:1px solid #565c65;font:inherit}.help-search .btn{border-radius:0}.help-groups{display:grid;grid-template-columns:1fr 1fr;gap:16px}.help-list{padding-left:20px}.help-list li{margin:6px 0}.steps li{margin:4px 0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.gov-foot{background:#162e51;color:#fff;margin-top:24px;padding:28px 24px}.gov-foot a{color:#fff}.gov-foot h2{color:#fff;font-size:16px;font-family:inherit}.foot-cols{max-width:1040px;margin:0 auto;display:grid;grid-template-columns:repeat(3,1fr);gap:24px;font-size:14px}.foot-cols ul{list-style:none;padding:0;margin:0}.foot-cols li{margin:4px 0}
@media(max-width:760px){.hero,.split,.dash,.review-grid,.pm-grid,.help-groups,.foot-cols{grid-template-columns:1fr}.tiles{grid-template-columns:1fr 1fr}.vehicle-card{flex-direction:column;align-items:flex-start}.svc-nav a{padding:10px}.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.table{display:block;overflow-x:auto;max-width:100%}.stepper{flex-wrap:wrap}.stepper li{flex:1 1 140px}.hero>*,.split>*,.dash>*,.review-grid>*,.pm-grid>*{min-width:0}dd{overflow-wrap:anywhere}}
@media(max-width:560px){.tiles{grid-template-columns:minmax(0,1fr)}.help-search{flex-wrap:wrap}.help-search input{min-width:0}}` + OBS_CSS;
