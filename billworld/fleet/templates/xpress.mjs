// Xpress Bill Pay: multi-biller consumer payment site used by small cities and utilities.
// Public screens mirror the City of Homer captures (billworld/captures/homer-login, -guest, -register, -forgot);
// signed-in flow follows the Homer "Create a Log-in and Make Utility Payments" guide: Accounts -> Make a Payment
// -> Bill Cart -> Proceed to Checkout -> pay method -> Review and Confirm -> Submit Payment -> SUCCESS!.
import { html, raw, doc, logo, alert, form, field, select, checkbox, button, hidden, amountChooser, methodChooser, newMethodFields, dateField, table, paymentRows, helpList, helpBody, helpSearchForm, money, fmtDate, methodText, statusLabel, L } from '../kit.mjs';
import { payNotice, payRows, payDate, fmtPayOn, scrollTable, balanceTable, billingCss } from './_generic-billing.mjs';
import { profileTitle, profileHero, profileNavBar, profileLogin, socialRow, profileHelpExcerpts, profileArticleExcerpt, themedVm, profileCss, mfaSent, mfaResend } from './generic.mjs';
import { withdrawn, withdrawnView } from './_withdrawn.mjs';

export const meta = {
  id: 'xpress',
  // Where the dedicated tier's dossier nav (vm.nav) goes: the first element matching a selector (class:<token> or
  // aria:<label>) is re-filled with the dossier's items; observed real-site navs yield on public pages (server.mjs withDossierNav).
  navSlots: { public: ['class:xb-grey'], account: ['class:xb-tabs'] },
  name: 'Xpress Bill Pay',
  description: 'Email + password login card over a hero with "Checkout as Guest", account lookup by account number + last name, ACCOUNTS / HISTORY / PAY METHODS / CART tabs, bill cart -> checkout -> review and confirm -> SUCCESS!.',
  families: ['xpress', 'xpressbillpay'],
  sources: [
    'https://xpressbillpay.com/#/?org=cityofhomer11061',
    'https://guest.xpressbillpay.com/refer/cityofhomer11061',
    'https://xpressbillpay.com/customer/#/register/register',
    'https://xpressbillpay.com/#/forgot-password',
    'https://www.cityofhomer-ak.gov/finance/create-log-and-make-utility-payments-xpress-bill-pay'
  ],
  evidence: {
    observed_public: [
      'Header links MERCHANT LOGIN / USER LOGIN / SIGN UP (boxed) and grey bar ABOUT US, SECURITY, CONTACT US, FAQ, FOR MERCHANTS (captures/homer-login)',
      'Login card over a photo hero: biller seal, "LOGIN TO PAY YOUR BILLS ONLINE", EMAIL / MOBILE radio, EMAIL ADDRESS + PASSWORD (Required), Forgot Password, Create a New Account, LOGIN, CHECKOUT AS GUEST (captures/homer-login)',
      '"A TRUSTED WAY TO PAY" and "TOP-RATED CUSTOMER SUPPORT" sections; footer ABOUT US SECURITY JOBS FAQ CONTACT US PRIVACY POLICY TERMS AND CONDITIONS MERCHANTS (captures/homer-login)',
      'Guest: "ENTER ACCOUNT INFORMATION", type label (Utility), Account Number, Last Name or Business Name, "WHERE TO FIND YOUR ACCOUNT NUMBER", Back / Search Account, Pay by phone, "Powered By" footer (captures/homer-guest)',
      'Sign up: EMAIL, CREATE A PASSWORD, CONFIRM YOUR PASSWORD with password rules list, Personal/Business ACCOUNT TYPE, name/phone/address/ZIP, terms text, NEXT (captures/homer-register)',
      'FORGOT YOUR PASSWORD?: "enter the email address or mobile number associated with your account", Already a Member? LOGIN, SUBMIT (captures/homer-forgot)'
    ],
    documented: [
      'Make a Payment -> Proceed to Checkout -> choose checking/savings or credit/debit -> Review and confirm -> Submit Payment; "Back to Checkout" on review; green "SUCCESS!" with printable receipt (cityofhomer-ak.gov guide)',
      'ADD MORE BILLS TO THE CART before checkout; ACCOUNTS tab lists linked bills; link bill by account number + last name; optional paperless; Set up Auto Pay / Not Now (guide)',
      'Up to a year of history online; emailed receipts; Auto Pay each month (guide)'
    ],
    synthetic: [
      'Signed-in tab bar styling (the mobile app shows Accounts / History / Pay Methods / Cart; web layout approximated)',
      'Registration links the bill in the same form (real site links the bill after email verification); first name, phone and street address omitted because the engine has no fields for them',
      'Platform wordmark replaced by the biller monogram; hero photo replaced by a CSS gradient',
      'Stop Service, Payment Plan, Change Plan, Contact message form and MFA screens',
      '"+ Add Account" page explains that additional bills are linked by the billing organization (the engine models one account per biller)'
    ]
  }
};

export const routes = {
  home: '/', login: '/login', loginPassword: '/login/password', mfa: '/login/verify', register: '/customer/register', verify: '/customer/register/verify', forgot: '/forgot-password', reset: '/reset-password',
  guest: '/guest', guestPay: '/guest/checkout', guestReview: '/guest/review', guestReceipt: '/guest/success/:id',
  dashboard: '/customer/accounts', bill: '/customer/accounts/bill', statements: '/customer/accounts/bill-history', statement: '/customer/accounts/bill-history/:id.pdf',
  pay: '/customer/cart', payMethod: '/customer/checkout', payReview: '/customer/checkout/review', payReceipt: '/customer/checkout/success/:id',
  history: '/customer/history', autopay: '/customer/autopay', paperless: '/customer/accounts/paperless', wallet: '/customer/pay-methods',
  cancel: '/customer/accounts/stop-service', plan: '/customer/accounts/plan', arrangement: '/customer/accounts/payment-plan', contact: '/customer/contact-us', profile: '/customer/profile', logout: '/logout',
  help: '/faq', helpArticle: '/faq/:slug', helpSearch: '/faq-search',
  linkAccount: '/customer/accounts/link'
};
export const flow = { paySteps: ['pay', 'payMethod', 'payReview'], loginSteps: 1, guestSteps: ['guest', 'guestPay', 'guestReview'] };

const offline = vm => vm.biller.capabilities.online_account.support === 'unsupported';
const billType = vm => ({ utility: 'Utility', telecom: 'Utility', tax: 'Tax', invoice: 'Billing' }[vm.biller.kind] || 'Billing');
const up = s => String(s).toUpperCase();

function topbar(vm) {
  const right = vm.authenticated
    ? html`<span class="hello">${up(vm.persona.first)}</span><a href="${vm.url('profile')}">${L(vm, 'profile', 'PROFILE')}</a><a class="boxed" href="${vm.url('logout')}">${L(vm, 'logout', 'LOGOUT')}</a>`
    : html`<a href="${vm.url('login')}">${L(vm, 'login', 'USER LOGIN')}</a><a class="boxed" href="${vm.url('register')}">${L(vm, 'register', 'SIGN UP')}</a>`;
  return html`<header class="xb-top"><div class="xb-wrap"><a class="xb-brand" href="${vm.url(vm.authenticated ? 'dashboard' : 'home')}">${logo(vm)}<span><b>${vm.biller.brand.shortName}</b><small>ONLINE BILL PAY</small></span></a>${offline(vm) ? '' : html`<nav class="xb-right" aria-label="Account">${right}</nav>`}</div></header>`;
}
const greybar = vm => html`<nav class="xb-grey" aria-label="Site"><div class="xb-wrap"><a href="${vm.url('helpArticle', { slug: 'pay-your-bill' })}">WAYS TO PAY</a><a href="${vm.url('helpArticle', { slug: 'contact-us' })}">CONTACT US</a><a href="${vm.url('help')}">${L(vm, 'help', 'FAQ')}</a></div></nav>`;
const footer = vm => html`<footer class="xb-foot"><nav class="xb-wrap" aria-label="Footer"><a href="${vm.url('helpArticle', { slug: 'pay-your-bill' })}">WAYS TO PAY</a><a href="${vm.url('help')}">${L(vm, 'help', 'FAQ')}</a><a href="${vm.url('helpArticle', { slug: 'contact-us' })}">CONTACT US</a></nav><p class="xb-wrap copy">Use of this site is subject to the Xpress Bill Pay Terms and Conditions and Privacy Policy.</p><p class="xb-wrap copy">${vm.biller.name}${vm.biller.payPhone ? ` · Pay by phone: ${vm.biller.payPhone}` : ''} · Powered by Xpress Bill Pay</p></footer>`;

function tabs(vm) {
  const T = (pages, page, label, badge = '') => html`<a class="${pages.includes(vm.page) ? 'on' : ''}" href="${vm.url(page)}"${pages.includes(vm.page) ? raw(' aria-current="page"') : ''}>${label}${badge}</a>`;
  const cart = vm.draft?.amountCents ? html` <span class="badge" aria-hidden="true">1</span><span class="sr-only">(1 item)</span>` : '';
  return html`<nav class="xb-tabs" aria-label="Customer"><div class="xb-wrap">${T(['dashboard', 'bill', 'statements', 'paperless', 'cancel', 'plan', 'arrangement', 'linkAccount'], 'dashboard', 'ACCOUNTS')}${T(['history'], 'history', 'HISTORY')}${T(['wallet'], 'wallet', 'PAY METHODS')}${vm.biller.capabilities.autopay.support === 'supported' ? T(['autopay'], 'autopay', 'AUTO PAY') : ''}${T(['pay', 'payMethod', 'payReview', 'payReceipt'], 'pay', 'CART', cart)}${T(['contact'], 'contact', 'CONTACT')}${T(['help', 'helpArticle', 'helpSearch'], 'help', 'FAQ')}</div></nav>`;
}

function shell(vm, title, body, { narrow = false } = {}) {
  return doc(vm, { title: `${title} | ${vm.biller.brand.shortName} | Xpress Bill Pay`, bodyClass: 'xb', body: html`${topbar(vm)}${vm.authenticated ? tabs(vm) : html`${greybar(vm)}${profileNavBar(vm, { cls: 'pf-site xb-site' })}`}<main class="xb-wrap xb-main${narrow ? ' narrow' : ''}"><h1 class="xb-h1">${up(title)}</h1>${alert(vm)}${body}</main>${footer(vm)}` });
}
const xbtn = (label, cls = 'xbtn') => button(label, { cls });
const xlink = (href, label, cls = 'xbtn') => html`<a class="${cls}" href="${href}">${label}</a>`;
const box = (inner, cls = '') => html`<section class="xbox ${cls}">${inner}</section>`;

// Hero + login card shared by home and login (the real home page *is* the login page).
function loginHero(vm) {
  const lp = profileLogin(vm, { idLabel: 'Email Address', submit: 'Login' }); const hero = profileHero(vm);
  const loginForm = form(vm, 'login', html`${hidden('next', vm.query.next || '')}<div class="seg" role="radiogroup" aria-label="Login with"><label><input type="radio" name="loginWith" value="email" checked> EMAIL</label><label><input type="radio" name="loginWith" value="mobile" disabled> MOBILE</label></div>${field(vm, { name: 'username', label: up(lp.idLabel), autocomplete: 'username', placeholder: lp.idLabel, cls: 'ufield' })}${field(vm, { name: 'password', label: 'PASSWORD', type: 'password', autocomplete: 'current-password', placeholder: 'Password', cls: 'ufield' })}<div class="card-row"><div class="card-links"><a href="${vm.url('forgot')}">${L(vm, 'forgot', 'Forgot Password')}</a><a href="${vm.url('register')}">${L(vm, 'register', 'Create a New Account')}</a></div>${xbtn(up(lp.submit), 'xbtn steel')}</div>`);
  return html`<section class="hero"><div class="xb-wrap hero-in"><div class="hero-copy"><p class="tw">THE TRUSTED<br>WAY TO PAY</p><p>${vm.biller.name}</p>${hero ? html`<p class="pf-hero">${hero}</p>` : ''}</div><div class="login-card"><div class="seal">${logo(vm, 'logo seal-logo')}</div><h1 class="card-h">LOGIN TO PAY YOUR<br>BILLS ONLINE</h1>${alert(vm)}${loginForm}${socialRow(vm)}<p class="guest-row"><a class="xbtn navy" href="${vm.url('guest')}">${L(vm, 'guest', 'CHECKOUT AS GUEST')}</a></p></div></div></section><section class="xb-wrap trusted"><div class="phone" aria-hidden="true"><div class="ph-screen"><p>My Bills</p><span></span><span></span><span></span></div></div><div><h2 class="red">A TRUSTED WAY TO PAY</h2><p>Xpress Bill Pay works closely with cities, governments, and business to provide you a seamless bill-paying experience.</p><p>Trust Xpress Bill Pay to manage your bills.</p><ul><li>Authorized by your billing organization.</li><li>24-7 Access using any device.</li><li>Automatic payments means you're never late.</li></ul><p><a href="${vm.url('register')}">${L(vm, 'register', 'SIGN UP ›')}›</a></p></div></section><section class="xb-wrap support"><h2 class="red rule"><span>TOP-RATED CUSTOMER SUPPORT</span></h2><div class="sup-grid"><div><h3 class="red">CUSTOMER SUPPORT:</h3>${vm.biller.phone ? html`<p><strong>Phone</strong><br>${vm.biller.phone}</p>` : ''}<p><strong>Hours</strong><br>Weekdays 6am - 6pm (Mountain Time)<br>Email: Any time</p><p><a href="${vm.url('helpArticle', { slug: 'contact-us' })}">Contact Us ››</a></p></div><div><h3 class="red">${up(vm.biller.brand.shortName)}:</h3>${vm.biller.phone ? html`<p>Billing questions: ${vm.biller.phone}</p>` : ''}${vm.biller.payPhone ? html`<p>Pay by phone: ${vm.biller.payPhone}</p>` : ''}<p><a href="${vm.url('help')}">${L(vm, 'help', 'FAQ ›')}›</a></p></div></div></section>`;
}
const publicPage = (vm, title, inner, { slim = false, main = false, fullTitle } = {}) => doc(vm, { title: fullTitle || `${title} | Xpress Bill Pay`, bodyClass: 'xb', body: html`${topbar(vm)}${slim ? '' : greybar(vm)}${profileNavBar(vm, { cls: 'pf-site xb-site' })}${main ? html`<main>${inner}</main>` : inner}${footer(vm)}` });

const pages = {
  home(vm) {
    if (offline(vm)) return shell(vm, 'Paying your bill', box(html`<h2>Paying your ${vm.biller.name} bill</h2><p>Online account access and online bill payment are not available for this biller.</p>${helpBody(vm.help.find(a => a.slug === 'pay-your-bill'))}${vm.biller.phone ? html`<p>Questions? Call <strong>${vm.biller.phone}</strong>.</p>` : html`<p>Use the contact information printed on your paper bill.</p>`}<p><a href="${vm.url('help')}">${L(vm, 'help', 'FAQ')}</a></p>`));
    return publicPage(vm, vm.biller.brand.shortName, loginHero(vm), { main: true, fullTitle: profileTitle(vm, 'website', null) });
  },
  login(vm) { return publicPage(vm, 'User Login', loginHero(vm), { main: true, fullTitle: profileTitle(vm, 'login', null) }); },
  loginPassword(vm) { return pages.login(vm); },
  mfa(vm) { return shell(vm, 'Verify Your Login', box(html`<p>${mfaSent(vm, 'We sent a 6-digit verification code to your email address.')}</p>${form(vm, 'mfa', html`${hidden('next', vm.query.next || '')}${field(vm, { name: 'code', label: 'VERIFICATION CODE', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code', cls: 'ufield' })}${xbtn('VERIFY')}`)}${mfaResend(vm, { cls: 'linkbtn' })}`), { narrow: true }); },
  register(vm) {
    return shell(vm, 'Create Account', box(form(vm, 'register', html`${field(vm, { name: 'email', label: 'EMAIL', type: 'email', autocomplete: 'email', cls: 'ufield' })}${field(vm, { name: 'password', label: 'CREATE A PASSWORD', type: 'password', autocomplete: 'new-password', cls: 'ufield' })}${field(vm, { name: 'confirm', label: 'CONFIRM YOUR PASSWORD', type: 'password', autocomplete: 'new-password', cls: 'ufield' })}<div class="rules"><p>Please enter a password that:</p><ul><li>is at least 8 characters long</li><li>contains at least one uppercase letter</li><li>contains at least one lowercase letter</li><li>contains at least one number and one symbol</li></ul></div><div class="seg"><label><input type="radio" name="accountKind" value="personal" checked> Personal</label><label><input type="radio" name="accountKind" value="business"> Business</label></div><h2 class="sec">LINK YOUR ${up(vm.biller.brand.shortName)} BILL</h2>${field(vm, { name: 'accountNumber', label: 'ACCOUNT NUMBER', inputmode: 'numeric', cls: 'ufield' })}${field(vm, { name: 'lastName', label: 'LAST NAME OR BUSINESS NAME', cls: 'ufield' })}${field(vm, { name: 'zip', label: 'ZIP/POSTAL CODE', inputmode: 'numeric', maxlength: 5, cls: 'ufield' })}<p class="terms"><strong>Terms and Conditions:</strong> Please read the Terms &amp; Conditions and Privacy Policy. By selecting NEXT you agree to the Terms &amp; Conditions and Privacy Policy.</p>${xbtn('NEXT')}`)), { narrow: true });
  },
  verify(vm) { return shell(vm, 'Verify Email', box(html`<p>We sent an email with the subject “Verify email address”. Click <strong>Verify Email</strong> in that message, then <a href="${vm.url('login')}">${L(vm, 'login', 'log in')}</a>.</p>`), { narrow: true }); },
  forgot(vm) { return shell(vm, 'Forgot Your Password?', box(html`<p>To reset your password, enter the email address or mobile number associated with your account.</p>${form(vm, 'forgot', html`${field(vm, { name: 'identifier', label: 'EMAIL ADDRESS', autocomplete: 'username', cls: 'ufield' })}<div class="card-row"><div class="card-links"><span>Already a Member?</span><a href="${vm.url('login')}">${L(vm, 'login', 'LOGIN')}</a></div>${xbtn('SUBMIT')}</div>`)}`), { narrow: true }); },
  reset(vm) { return shell(vm, 'Reset Password', box(form(vm, 'reset', html`${vm.query.token ? hidden('token', vm.query.token) : field(vm, { name: 'code', label: 'VERIFICATION CODE', inputmode: 'numeric', autocomplete: 'one-time-code', cls: 'ufield' })}${field(vm, { name: 'password', label: 'NEW PASSWORD', type: 'password', autocomplete: 'new-password', cls: 'ufield' })}${field(vm, { name: 'confirm', label: 'CONFIRM YOUR PASSWORD', type: 'password', autocomplete: 'new-password', cls: 'ufield' })}${xbtn('SUBMIT')}`)), { narrow: true }); },
  guest(vm) {
    return publicPage(vm, 'Guest Checkout', html`<main class="guest-col">${logo(vm, 'logo seal-logo')}<h1 class="gbar">${L(vm, 'guest', 'ENTER ACCOUNT INFORMATION')}</h1>${alert(vm)}${form(vm, 'guest', html`<p class="gtype"><span class="ico" aria-hidden="true">▤</span> ${billType(vm)}</p><div class="icofield"><span class="ico" aria-hidden="true">●</span>${field(vm, { name: 'accountNumber', label: 'Account Number', inputmode: 'numeric', cls: 'ufield' })}</div><div class="icofield"><span class="ico" aria-hidden="true">⌂</span>${field(vm, { name: 'lastName', label: 'Last Name or Business Name', cls: 'ufield' })}</div><h2 class="gbar">WHERE TO FIND YOUR ACCOUNT NUMBER</h2><h3 class="center">Find your account number</h3><p class="center small">Your billing Account Number identifies your specific account for billing purposes. It is generally printed on your paper bill. If you do not have your account number, contact your Billing Organization.</p><div class="gbtns"><a class="xbtn navy" href="${vm.url('home')}">Back</a>${xbtn('Search Account', 'xbtn grey')}</div>`)}${vm.biller.payPhone ? html`<p class="center">Pay by phone: ${vm.biller.payPhone}</p>` : ''}<p class="center small">Powered By : Xpress Bill Pay</p></main>`, { slim: true });
  },
  guestPay(vm) {
    return shell(vm, 'Guest Checkout', html`${payNotice(vm, { autopayName: 'Auto Pay' })}${cartRow(vm)}${box(form(vm, 'guestPay', html`${amountChooser(vm, { labels: { legend: 'PAYMENT AMOUNT', due: 'Amount Due' } })}<fieldset class="methods"><legend>SELECT PAY METHOD</legend><p class="small muted">Checking or savings account (eCheck) or credit/debit card.</p>${newMethodFields(vm)}</fieldset>${xbtn('CONTINUE')}`))}`);
  },
  guestReview(vm) { return reviewPage(vm, 'guestReview'); },
  guestReceipt(vm) { return receiptPage(vm); },

  dashboard(vm) {
    const c = vm.biller.capabilities;
    return shell(vm, 'My Bills', html`<div class="bills-head"><p>${vm.persona.name} · ${vm.persona.email}</p><a class="addacct" href="${vm.url('linkAccount')}">+ Add Account</a></div><article class="bill-card"><header><h2>${vm.biller.name} <span class="chev">›</span></h2><span class="tag">${billType(vm)}</span></header><div class="bill-grid"><div><span class="lbl">ACCOUNT</span>${vm.accountMasked}<br><span class="muted small">${vm.account.serviceAddress}</span></div><div><span class="lbl">DUE</span>${vm.dueText}</div><div><span class="lbl">AMOUNT</span><strong class="amt">${money(vm.balanceCents)}</strong></div><div class="bill-pay">${xlink(vm.url('pay'), 'MAKE A PAYMENT', 'xbtn green')}${vm.autopay.enrolled ? html`<span class="ap">AUTO PAY SCHEDULED</span>` : ''}</div></div><footer class="bill-links"><a href="${vm.url('bill')}">${L(vm, 'bill', 'View Bill')}</a><a href="${vm.url('statements')}">${L(vm, 'statements', 'Bill History')}</a><a href="${vm.url('history')}">${L(vm, 'history', 'Payment History')}</a>${c.autopay.support === 'supported' ? html`<a href="${vm.url('autopay')}">${vm.autopay.enrolled ? 'Manage Auto Pay' : 'Set up Auto Pay'}</a>` : ''}${c.paperless.support === 'supported' ? html`<a href="${vm.url('paperless')}">Paperless: ${vm.account.paperless ? 'On' : 'Off'}</a>` : ''}<a href="${vm.url('wallet')}">${L(vm, 'wallet', 'Pay Methods')}</a><a href="${vm.url('arrangement')}">${L(vm, 'arrangement', 'Payment Plan')}</a>${vm.plans?.length ? html`<a href="${vm.url('plan')}">Change Plan</a>` : ''}${c.cancel_service.support === 'supported' ? html`<a href="${vm.url('cancel')}">${vm.biller.kind === 'utility' ? 'Stop Service' : 'Cancel Service'}</a>` : ''}<a href="${vm.url('contact')}">${L(vm, 'contact', 'Contact Biller')}</a><a href="${vm.url('profile')}">${L(vm, 'profile', 'Profile')}</a></footer></article>${vm.scheduled.length || vm.pendingPayments.length ? html`<p class="muted">${vm.scheduled.length} scheduled · ${vm.pendingPayments.length} pending payment(s). <a href="${vm.url('history')}">${L(vm, 'history', 'View history')}</a></p>` : ''}`);
  },
  bill(vm) { const inv = vm.invoice; return shell(vm, 'View Bill', box(html`<p class="muted">Statement ${inv.number} · ${inv.period}</p>${scrollTable('Bill charges', ['DESCRIPTION', 'AMOUNT'], [...inv.lines.map(l => [l.desc, money(l.cents)]), [html`<strong>TOTAL</strong>`, html`<strong>${money(inv.amountCents)}</strong>`]], 'table xtable')}${balanceTable(vm, { statement: 'Statement total', pastDue: 'Previous balance (past due)', posted: 'Payments received', pending: 'Payments processing', balance: 'Amount due' })}<p>Amount due: <strong>${money(vm.balanceCents)}</strong> · Due ${fmtDate(inv.dueAt)}</p>${vm.scheduled.length ? html`<p class="muted">${vm.scheduled.length} scheduled payment(s) totalling ${money(vm.scheduled.reduce((a, p) => a + p.amountCents, 0))} · <a href="${vm.url('history')}">${L(vm, 'history', 'History')}</a></p>` : ''}<p class="btn-row">${xlink(vm.url('pay'), 'MAKE A PAYMENT', 'xbtn green')}${xlink(vm.url('statement', { id: inv.id }), 'DOWNLOAD PDF', 'xbtn ghost')}${xlink(vm.url('statements'), 'BILL HISTORY', 'xbtn ghost')}</p>`)); },
  statements(vm) { return shell(vm, 'Bill History', box(scrollTable('Bill history', ['BILL DATE', 'DUE DATE', 'AMOUNT', 'BILL'], vm.invoices.map(i => [fmtDate(i.issuedAt), fmtDate(i.dueAt), money(i.amountCents), html`<a href="${vm.url('statement', { id: i.id })}">View PDF</a>`]), 'table xtable'))); },
  pay(vm) {
    return shell(vm, 'Bill Cart', html`${payNotice(vm, { autopayName: 'Auto Pay' })}${cartRow(vm)}${box(form(vm, 'pay', html`${amountChooser(vm, { labels: { legend: 'PAYMENT AMOUNT', due: 'Amount Due' } })}<div class="card-row"><a href="${vm.url('dashboard')}">ADD MORE BILLS TO THE CART</a>${xbtn('PROCEED TO CHECKOUT', 'xbtn green')}</div>`))}`);
  },
  payMethod(vm) {
    const d = vm.draft;
    return shell(vm, 'Checkout', html`<p class="crumbs"><a href="${vm.url('pay')}">${L(vm, 'pay', '‹ Back to Cart')}</a></p>${box(html`<p>Cart total: <strong>${d?.amountCents ? money(d.amountCents) : '—'}</strong></p>${form(vm, 'payMethod', html`${methodChooser(vm, { title: 'SELECT PAY METHOD' })}${dateField(vm, { label: 'PAYMENT DATE' })}${xbtn('CONTINUE')}`)}`)}`);
  },
  payReview(vm) { return reviewPage(vm, 'payReview'); },
  payReceipt(vm) { return receiptPage(vm); },
  history(vm) { return shell(vm, 'History', box(scrollTable('Payment history', ['DATE', 'AMOUNT', 'PAY METHOD', 'CONFIRMATION', 'STATUS', 'ACTION'], payRows(vm), 'table xtable'))); },
  autopay(vm) {
    const ap = vm.autopay;
    return shell(vm, 'Auto Pay', html`${ap.enrolled ? box(html`<p class="ap">AUTO PAY SCHEDULED</p><p>${vm.biller.name}: ${ap.policy === 'fixed' ? `fixed ${money(ap.fixedCents)}` : 'full amount due'} ${ap.day ? `on day ${ap.day} of each month` : 'on the due date'} from ${vm.autopayMethod ? methodText(vm.autopayMethod) : 'your pay method'}.</p>${form(vm, 'autopay', html`${hidden('action', 'cancel')}${checkbox(vm, { name: 'confirm', label: 'I understand future bills will not be paid automatically.' })}${xbtn('CANCEL AUTO PAY', 'xbtn red')}`)}`) : ''}${box(html`<h2 class="sec">${ap.enrolled ? 'EDIT AUTO PAY' : 'SET UP AUTO PAY'}</h2><p>Your bill will be paid automatically each month.</p>${form(vm, 'autopay', html`${hidden('action', 'enroll')}${methodChooser(vm, { title: 'STEP 1: SELECT PAY METHOD' })}<fieldset><legend>STEP 2: AMOUNT AND DATE</legend>${select(vm, { name: 'policy', label: 'PAY', options: [['full', 'Full amount due'], ['fixed', 'Fixed amount']], cls: 'ufield' })}${field(vm, { name: 'fixedAmount', label: 'FIXED AMOUNT (if selected)', required: false, inputmode: 'decimal', cls: 'ufield' })}${select(vm, { name: 'day', label: 'PAY ON', options: [['', 'The due date'], ...Array.from({ length: 28 }, (_, i) => [String(i + 1), `Day ${i + 1} of each month`])], cls: 'ufield' })}</fieldset>${checkbox(vm, { name: 'acceptTerms', label: 'I authorize recurring payments and agree to the Auto Pay Terms and Conditions.' })}<div class="card-row"><a href="${vm.url('dashboard')}">${L(vm, 'dashboard', 'Not Now')}</a>${xbtn(ap.enrolled ? 'SAVE AUTO PAY' : 'SET UP AUTO PAY', 'xbtn green')}</div>`)}`)}`);
  },
  paperless(vm) { return shell(vm, 'Paperless', box(html`<p>Paperless billing is <strong>${vm.account.paperless ? 'ON' : 'OFF'}</strong>. With paperless billing you will not receive paper statements via mail; you will receive an email notification when your bill is ready to view.</p>${form(vm, 'paperless', html`${hidden('paperless', vm.account.paperless ? 'off' : 'on')}${!vm.account.paperless ? field(vm, { name: 'email', label: 'EMAIL FOR BILL NOTIFICATIONS', type: 'email', value: vm.persona.email, cls: 'ufield' }) : ''}${xbtn(vm.account.paperless ? 'RECEIVE PAPER BILLS' : 'OPT IN TO PAPERLESS')}`)}`)); },
  wallet(vm) { return shell(vm, 'Pay Methods', html`${box(vm.methods.length ? html`<ul class="pm-list">${vm.methods.map(m => html`<li><span>${methodText(m)}${m.nickname ? html` <span class="muted">(${m.nickname})</span>` : ''}</span>${form(vm, 'wallet', html`${hidden('op', 'remove')}${hidden('methodId', m.id)}<button type="submit" class="linkish" aria-label="Delete ${methodText(m)}">DELETE</button>`)}</li>`)}</ul>` : html`<p>No saved pay methods.</p>`)}${box(html`<h2 class="sec">ADD PAY METHOD</h2>${form(vm, 'wallet', html`${hidden('op', 'add')}${newMethodFields(vm)}${field(vm, { name: 'nickname', label: 'NICKNAME (optional)', required: false, cls: 'ufield' })}${xbtn('SAVE PAY METHOD')}`)}`)}`); },
  cancel(vm) {
    const label = vm.biller.kind === 'utility' ? 'Stop Service' : 'Cancel Service';
    if (vm.service.status !== 'active' && vm.step !== 'done') return shell(vm, label, box(html`<p>Your service ${vm.service.status === 'cancel_pending' ? `is scheduled to end on ${fmtDate(vm.service.cancelAt)}` : 'is cancelled'}.</p>${vm.service.status === 'cancel_pending' ? form(vm, 'cancel', html`${hidden('step', 'undo')}${xbtn('KEEP MY SERVICE')}`) : ''}`));
    const s = {
      reason: form(vm, 'cancel', html`${hidden('step', 'reason')}${select(vm, { name: 'reason', label: 'REASON', options: [['', 'Select a reason'], ['moving', 'Moving'], ['cost', 'Cost'], ['switching', 'Switching providers'], ['other', 'Other']], cls: 'ufield' })}${xbtn('CONTINUE')}`),
      offer: html`<p><strong>Stay and save:</strong> 50% off your next 3 bills.</p>${form(vm, 'cancel', html`${hidden('step', 'offer')}<div class="btn-row">${button('ACCEPT OFFER', { cls: 'xbtn green', name: 'accept', value: 'yes' })}${button('NO THANKS, CONTINUE', { cls: 'xbtn ghost', name: 'accept', value: 'no' })}</div>`)}`,
      confirm: form(vm, 'cancel', html`<p>A final bill will be sent to you.</p>${hidden('step', 'confirm')}${dateField(vm, { name: 'effectiveDate', label: 'STOP DATE' })}${checkbox(vm, { name: 'confirm', label: `Yes, ${label.toLowerCase()} on this date.` })}${xbtn(up(label), 'xbtn red')}`),
      done: withdrawn(vm) ? withdrawnView(vm) : html`<p class="success">SUCCESS!</p><p>Your service will end on <strong>${vm.service.cancelAt ? fmtDate(vm.service.cancelAt) : ''}</strong>. Confirmation number <strong>${vm.service.confirmation || ''}</strong>.</p>`,
      kept: html`<p class="success">Thanks for staying! Your discount has been applied.</p>`
    };
    return shell(vm, label, box(s[vm.step]));
  },
  plan(vm) { return shell(vm, 'Change Plan', box(vm.plans.length ? form(vm, 'plan', html`<fieldset><legend>CHOOSE A PLAN</legend>${vm.plans.map(p => html`<label class="radio"><input type="radio" name="planId" value="${p.id}"${p.current ? raw(' checked') : ''}> ${p.name}${p.cents ? ` – ${money(p.cents)}/mo` : ''}${p.current ? ' (current)' : ''}</label>`)}</fieldset>${xbtn('CHANGE PLAN')}`) : html`<p>Plan changes are not available online.</p>`)); },
  arrangement(vm) { return shell(vm, 'Payment Plan', box(vm.account.arrangement ? html`<p>You're paying ${money(vm.account.arrangement.monthlyCents)} per month for ${vm.account.arrangement.months} months.</p>` : form(vm, 'arrangement', html`<p>Spread your balance of ${money(vm.balanceCents)} over monthly payments.</p>${select(vm, { name: 'months', label: 'NUMBER OF MONTHS', options: [['3', '3 months'], ['6', '6 months'], ['12', '12 months']], cls: 'ufield' })}${xbtn('SET UP PLAN')}`))); },
  contact(vm) { return shell(vm, 'Contact Us', html`${vm.account.messages.length ? box(html`<ul>${vm.account.messages.map(m => html`<li>${fmtDate(m.at)} – ${m.subject} (${m.status})</li>`)}</ul>`) : ''}${box(form(vm, 'contact', html`${field(vm, { name: 'subject', label: 'SUBJECT', cls: 'ufield' })}<div class="ufield"><label for="f-message">MESSAGE</label><textarea id="f-message" name="message" required>${vm.values.message || ''}</textarea></div>${xbtn('SEND')}`))}`); },
  profile(vm) { return shell(vm, 'Profile', html`${box(html`<dl class="kv"><dt>NAME</dt><dd>${vm.persona.name}</dd><dt>EMAIL</dt><dd>${vm.persona.email}</dd><dt>MOBILE</dt><dd>${vm.account.phone || 'Not provided'}</dd></dl>`)}${box(html`<h2 class="sec">TEXT MESSAGES</h2><p>Save your mobile number to receive text messages about statements, payments and Auto Pays.</p>${form(vm, 'profile', html`${field(vm, { name: 'phone', label: 'MOBILE NUMBER', type: 'tel', cls: 'ufield' })}${xbtn('SAVE MOBILE NUMBER')}`)}`)}`); },
  help(vm) { return shell(vm, 'FAQ', box(html`${helpSearchForm(vm, { placeholder: 'Search FAQ' })}${helpList(vm)}${profileHelpExcerpts(vm)}`)); },
  helpArticle(vm) { return shell(vm, vm.article.title, box(html`<p class="crumbs"><a href="${vm.url('help')}">${L(vm, 'help', '‹ FAQ')}</a></p>${helpBody(vm.article)}${profileArticleExcerpt(vm, vm.article)}`)); },
  linkAccount(vm) { return shell(vm, 'Add Account', box(html`<h2 class="sec">LINK ANOTHER BILL</h2><p>Your ${vm.biller.name} account ${vm.accountMasked} is already linked to this login.</p><p>To add another ${vm.biller.name} account or a bill from a different organization, contact the billing organization${vm.biller.phone ? html` at <strong>${vm.biller.phone}</strong>` : ''} so they can confirm the account number and last name on file. Additional bills cannot be linked online from this page.</p><p class="btn-row">${xlink(vm.url('dashboard'), 'BACK TO MY BILLS', 'xbtn ghost')}${xlink(vm.url('helpArticle', { slug: 'contact-us' }), 'CONTACT US', 'xbtn ghost')}</p>`), { narrow: true }); },
  helpSearch(vm) { return shell(vm, 'FAQ Search', box(html`${helpSearchForm(vm, { placeholder: 'Search FAQ' })}${vm.results.length ? helpList(vm, vm.results) : html`<p>No answers match “${vm.query.q || ''}”.</p>`}`)); }
};

const cartRow = vm => html`<div class="cart-row"><div><strong>${vm.biller.name}</strong><br><span class="muted small">${billType(vm)} · Account ${vm.accountMasked}</span></div><div><span class="lbl">DUE</span>${vm.dueText}</div><div><span class="lbl">AMOUNT DUE</span><strong>${money(vm.balanceCents)}</strong></div></div>`;

function reviewPage(vm, page) {
  const d = vm.draft;
  return shell(vm, 'Review and Confirm', html`${page === 'payReview' ? html`<p class="crumbs"><a href="${vm.url('payMethod')}">${L(vm, 'payMethod', '‹ Back to Checkout')}</a></p>` : ''}${box(html`<dl class="kv"><dt>BILL</dt><dd>${vm.biller.name} · ${vm.accountMasked}</dd><dt>PAYMENT AMOUNT</dt><dd>${money(d.amountCents)}</dd>${d.feeCents ? html`<dt>CONVENIENCE FEE</dt><dd>${money(d.feeCents)}</dd>` : ''}<dt>TOTAL</dt><dd><strong>${money(d.totalCents)}</strong></dd><dt>PAY METHOD</dt><dd>${methodText(d.method)}</dd><dt>PAYMENT DATE</dt><dd>${d.payOn ? fmtPayOn(d.payOn) : 'Today'}</dd></dl>${form(vm, page, html`${hidden('token', d.token)}${hidden('op', 'submit')}${checkbox(vm, { name: 'acceptTerms', label: 'I authorize this payment and agree to the Terms and Conditions.' })}${xbtn('SUBMIT PAYMENT', 'xbtn green')}`)}${page === 'payReview' ? form(vm, page, html`${hidden('op', 'edit')}${button('Edit cart', { cls: 'linkish' })}`) : ''}`)}`);
}
function receiptPage(vm) {
  const p = vm.payment;
  return shell(vm, 'Receipt', box(html`<p class="success">SUCCESS!</p><p>${p.status === 'scheduled' ? 'Your payment has been scheduled.' : 'Your payment was submitted.'} An email receipt has been sent.</p><dl class="kv"><dt>CONFIRMATION #</dt><dd><strong>${p.confirmation}</strong></dd><dt>AMOUNT</dt><dd>${money(p.amountCents)}</dd>${p.feeCents ? html`<dt>FEE</dt><dd>${money(p.feeCents)}</dd>` : ''}<dt>PAY METHOD</dt><dd>${vm.paymentMethod ? methodText(vm.paymentMethod) : `****${p.methodLast4}`}</dd><dt>DATE</dt><dd>${payDate(p)}</dd><dt>STATUS</dt><dd>${statusLabel(p.status)}</dd></dl><p>${vm.authenticated ? html`<a href="${vm.url('dashboard')}">Back to My Bills</a> · <a href="${vm.url('history')}">${L(vm, 'history', 'History')}</a>` : html`<a href="${vm.url('home')}">Done</a> · <a href="${vm.url('register')}">Sign up to save time next time</a>`}</p>`));
}

export function render(page, vm) { const fn = pages[page]; if (!fn) throw new Error(`xpress template cannot render ${page}`); return fn(themedVm(vm)); }

export const css = `*{box-sizing:border-box}body{margin:0;font:15px/1.5 "Avenir Next","Avenir","Segoe UI",Helvetica,Arial,sans-serif;color:#333;background:#fff}a{color:#1f5f99}
:root{--xred:#e2231a;--navy:#1f4e79;--steel:#7d97b2;--green:#3c9a3c}
.xb-wrap{max-width:1140px;margin:0 auto;padding:0 20px}
.xb-top{background:#fff}.xb-top .xb-wrap{display:flex;justify-content:space-between;align-items:center;height:66px}
.xb-brand{display:flex;align-items:center;gap:10px;text-decoration:none}.xb-brand .logo{width:40px;height:40px}.xb-brand b{display:block;color:var(--xred);font-size:20px;line-height:1.1}.xb-brand small{color:#777;letter-spacing:2px;font-size:12px}
.xb-right{display:flex;gap:22px;align-items:center}.xb-right a{color:#1f4e79;text-decoration:none;font-size:13px;font-weight:600;letter-spacing:.5px}.xb-right .boxed{border:2px solid #1f4e79;padding:4px 20px;border-radius:2px}.hello{font-size:13px;color:#555}
.xb-grey{background:#e6eaed}.xb-grey .xb-wrap{display:flex;gap:22px;height:42px;align-items:center;padding-left:130px}.xb-grey a{color:#333;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:.4px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.xb-tabs{background:#1f4e79}.xb-tabs .xb-wrap{display:flex;flex-wrap:wrap}.xb-tabs a{color:#dfe8f1;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:.6px;padding:13px 20px;border-bottom:4px solid transparent}.xb-tabs a.on{color:#fff;border-bottom-color:var(--xred);background:rgba(255,255,255,.08)}.badge{display:inline-block;background:var(--xred);color:#fff;border-radius:9px;font-size:11px;padding:0 6px;margin-left:5px}
.hero{background:linear-gradient(180deg,#e9e6e2 0%,#f4f2ef 55%,#c9a77c 56%,#b48d5d 62%,#ece9e5 63%,#f4f2ef 100%);padding:34px 0}
.hero-in{display:flex;justify-content:space-between;align-items:center;gap:30px}
.hero-copy{flex:1;background:linear-gradient(160deg,#20324a 0%,#c45b2c 55%,#f0a54a 75%,#3b2a1f 100%);color:#fff;padding:30px;border:10px solid #222;border-radius:6px;min-height:240px;max-width:520px}.tw{font-size:26px;font-weight:600;letter-spacing:1px;line-height:1.15;margin:0 0 12px}
.login-card{width:272px;background:#fff;padding:14px 22px 22px;box-shadow:0 2px 10px rgba(0,0,0,.15);text-align:center}
.seal{border-bottom:1px solid #ddd;padding-bottom:10px}.seal-logo{width:86px;height:86px}
.card-h{font-size:14px;font-weight:600;letter-spacing:.6px;color:#333;margin:14px 0 8px}
.seg{display:flex;justify-content:space-around;margin:6px 0 10px;font-size:11px;font-weight:600}.seg label{display:flex;gap:4px;align-items:center}
.ufield{margin:10px 0 14px;text-align:left}.ufield label{display:block;font-size:10px;font-weight:600;letter-spacing:.6px;color:#555}.ufield input,.ufield select,.ufield textarea{width:100%;border:0;border-bottom:2px solid #9aa4ad;padding:6px 10px;font:inherit;font-size:16px;background:transparent;border-radius:0}.ufield textarea{border:1px solid #9aa4ad;min-height:110px}.ufield input:focus,.ufield select:focus,.ufield textarea:focus{outline:2px solid var(--navy);outline-offset:2px;border-bottom-color:var(--navy)}.field input:focus,.field select:focus,.help-search input:focus{outline:2px solid var(--navy);outline-offset:2px}.ufield .help{display:block}
.card-row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:10px;flex-wrap:wrap}.card-links{display:flex;flex-direction:column;align-items:flex-start;font-size:12px;font-weight:600}
.guest-row{margin:22px 0 0}
.xbtn{display:inline-block;border:0;border-radius:3px;padding:9px 22px;font:600 14px "Avenir Next",Helvetica,Arial,sans-serif;letter-spacing:.5px;color:#fff;background:var(--navy);text-decoration:none;cursor:pointer}.xbtn.steel{background:var(--steel)}.xbtn.navy{background:#1f4e79}.xbtn.green{background:var(--green)}.xbtn.red{background:#c0392b}.xbtn.grey{background:#d6d6d6;color:#444}.xbtn.ghost{background:#fff;color:#1f4e79;border:1px solid #1f4e79}
.linkish{border:0;background:none;color:#c0392b;font:inherit;font-size:12px;font-weight:600;cursor:pointer;padding:0}
.trusted{display:grid;grid-template-columns:260px 1fr;gap:40px;align-items:center;padding:60px 20px 40px}.trusted ul{padding-left:20px}.red{color:var(--xred);font-size:15px;letter-spacing:.6px;font-weight:600}
.phone{width:150px;height:280px;border:10px solid #e8e8e8;border-radius:24px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.15);margin:auto}.ph-screen{padding:10px}.ph-screen p{text-align:center;font-size:12px;margin:0 0 8px}.ph-screen span{display:block;height:34px;border-bottom:1px solid #ddd;background:linear-gradient(90deg,#c8d6e5 40%,transparent 40%) no-repeat 0 8px/100% 8px}
.support{padding:10px 20px 50px}.rule{display:flex;align-items:center;gap:16px;text-align:center}.rule::before,.rule::after{content:"";flex:1;border-top:1px solid #999}.sup-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:20px}
.xb-foot{background:#e6eaed;padding:24px 0 30px;margin-top:40px}.xb-foot nav{display:flex;flex-wrap:wrap;gap:22px;justify-content:center;border-bottom:1px solid #c5ccd2;padding-bottom:22px}.xb-foot a{color:#333;text-decoration:none;font-size:13px;font-weight:600;letter-spacing:.4px}.copy{font-size:13px;color:#444;margin-top:16px}
.xb-main{padding-top:24px;min-height:55vh}.xb-main.narrow{max-width:560px}.xb-h1{font-size:22px;letter-spacing:1px;font-weight:600;color:#333;margin:0 0 16px}
.xbox{border:1px solid #dde2e6;background:#fff;padding:18px 22px;margin-bottom:16px;box-shadow:0 1px 2px rgba(0,0,0,.05)}.sec{font-size:15px;letter-spacing:.6px;color:#1f4e79;margin:4px 0 10px}
.guest-col{max-width:445px;margin:20px auto 0;text-align:left}.guest-col>.logo{display:block;margin:0 auto 12px}.gbar{background:#f1f1f1;font-size:22px;font-weight:700;color:#444;padding:8px 20px;margin:0 0 14px;letter-spacing:.3px}.gtype{font-weight:600;font-size:16px;margin-left:18px}.icofield{display:flex;gap:12px;align-items:center;margin-left:18px}.icofield .ufield{margin:6px 0}.icofield label{font-size:12px}.icofield .ufield{flex:1}.ico{font-size:20px;color:#555}.gbtns{display:flex;justify-content:flex-end;gap:8px;margin:24px 0 12px}.center{text-align:center}.small{font-size:13px}.muted{color:#777}
.rules{font-size:13px;color:#555;background:#f7f7f7;padding:6px 14px;margin-bottom:10px}.rules ul{margin:4px 0;padding-left:18px}.terms{font-size:13px;color:#555}
.bills-head{display:flex;justify-content:space-between;align-items:center;color:#555}.addacct{font-size:13px;font-weight:600}
.bill-card{border:1px solid #d5dbe0;margin:10px 0 16px}.bill-card header{display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid #eee}.bill-card h2{font-family:Georgia,serif;font-weight:400;color:#1f4e79;font-size:20px;margin:0}.chev{color:#999}.tag{font-size:12px;background:#eef3f8;color:#1f4e79;padding:2px 10px;border-radius:10px}
.bill-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1.3fr;gap:16px;padding:16px 18px;align-items:center}.lbl{display:block;font-size:11px;letter-spacing:.8px;color:#888;font-weight:600}.amt{font-size:22px;color:#333}.bill-pay{text-align:right}.ap{display:block;color:var(--green);font-size:11px;font-weight:700;letter-spacing:.6px;margin-top:6px}
.bill-links{display:flex;flex-wrap:wrap;gap:6px 18px;padding:10px 18px;background:#f6f8fa;border-top:1px solid #eee;font-size:13px}.bill-links a{font-weight:600;text-decoration:none}
.cart-row{display:grid;grid-template-columns:2fr 1fr 1fr;gap:16px;border:1px solid #d5dbe0;border-left:5px solid var(--green);padding:12px 18px;margin-bottom:16px;align-items:center}
.crumbs{margin:0 0 10px;font-size:13px;font-weight:600}.crumbs a{text-decoration:none}
.btn-row{display:flex;gap:10px;flex-wrap:wrap}
.success{color:#fff;background:var(--green);font-weight:700;letter-spacing:1px;padding:10px 14px;display:inline-block}
.pm-list{list-style:none;padding:0;margin:0}.pm-list li{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #eee;padding:10px 0}.pm-list form{margin:0}
.table{width:100%;border-collapse:collapse}.xtable th{font-size:11px;letter-spacing:.8px;color:#888;text-align:left;border-bottom:2px solid #dde2e6;padding:8px}.xtable td{padding:10px 8px;border-bottom:1px solid #eee}.xtable form{margin:0}.empty{color:#888}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:6px 18px}.kv dt{font-size:12px;letter-spacing:.6px;color:#888;font-weight:600}.kv dd{margin:0}
fieldset{border:1px solid #dde2e6;padding:10px 16px;margin:12px 0}legend{font-size:12px;letter-spacing:.8px;font-weight:700;color:#1f4e79}.radio,.check{display:block;margin:8px 0}.other-amount{width:120px;padding:4px 6px;border:1px solid #9aa4ad}
.field{margin:10px 0}.field label{display:block;font-size:11px;font-weight:600;letter-spacing:.5px;color:#555}.field input,.field select{width:100%;max-width:360px;border:0;border-bottom:2px solid #9aa4ad;padding:6px 8px;font:inherit}.help{font-size:12px;color:#777}
details summary{cursor:pointer;color:#1f4e79;font-weight:600;margin:8px 0}
.alert{padding:10px 14px;margin:0 0 14px;font-size:14px;text-align:left}.alert-error{background:#fdecea;color:#a61b1b;border-left:4px solid var(--xred)}.alert-ok{background:#eaf6ea;color:#24692a;border-left:4px solid var(--green)}
.help-search{display:flex;gap:8px;margin:0 0 12px}.help-search input{flex:1;border:0;border-bottom:2px solid #9aa4ad;padding:6px 8px;font:inherit}.help-search .btn{background:#1f4e79;color:#fff;border:0;padding:6px 16px;font-weight:600;cursor:pointer}.help-list li{margin:6px 0}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media(max-width:820px){.hero-in{flex-direction:column}.login-card{width:100%}.trusted,.sup-grid,.bill-grid,.cart-row{grid-template-columns:1fr}.xb-grey .xb-wrap{padding-left:20px}.bill-pay{text-align:left}}
${billingCss}
.xb-foot .copy{text-align:center}
@media(max-width:600px){.xb-wrap{padding:0 14px}.xb-top .xb-wrap{height:auto;min-height:60px;flex-wrap:wrap;gap:8px;padding-top:8px;padding-bottom:8px}.xb-right{gap:14px}.xb-right .boxed{padding:4px 12px}.xb-grey .xb-wrap{gap:14px;height:auto;min-height:42px;flex-wrap:wrap;padding-left:14px}.xb-tabs a{padding:10px 10px;font-size:13px}.hero{padding:20px 0}.hero-copy{padding:18px;border-width:6px;min-height:0}.trusted{padding:30px 14px 20px;gap:20px}.xbox{padding:14px}.kv{grid-template-columns:1fr;gap:2px}.kv dd{margin-bottom:8px}.gbar{font-size:18px;padding:8px 12px}.icofield{margin-left:0}.guest-col{padding:0 14px}.xb-foot nav{gap:14px}}
${profileCss}
.xb-site{background:#fff;border-bottom:1px solid #dfe3e6}.xb-site ul{max-width:1140px;margin:0 auto;padding:0 20px 0 120px}.xb-site a{color:#1f3b57;font-weight:600}.xb-site .pf-txt{color:#555}.hero-copy .pf-hero{color:#fff;font-size:17px}@media(max-width:820px){.xb-site ul{padding:0 10px}}`;
