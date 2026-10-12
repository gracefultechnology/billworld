// City of Tuscaloosa public pages (reconstructed from captured text) and the Paymentus customer portal
// (layout from the Paymentus family guide; Tuscaloosa portal itself returned HTTP 403). All state is server-side.
(() => {
const app = document.querySelector('#app');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const money = c => '$' + (Number(c || 0) / 100).toFixed(2);
const fmt = d => d ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}` : '—';
const qs = new URLSearchParams(location.search);
const path = location.pathname.replace(/\/$/, '') || '/';
async function api(p, data) {
  const r = await fetch('/api/tus/' + p, data === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
  const out = await r.json().catch(() => ({error: 'Unexpected response'}));
  if (!r.ok) { const e = new Error(out.error || 'Request failed'); e.status = r.status; throw e; }
  return out;
}
const go = p => location.assign(p);
const field = (name, label, type = 'text', attrs = '', value = '') => `<label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}>`;
const errorBox = '<p class="error" role="alert" id="form-error"></p>';
const inert = text => `<span class="inert" aria-disabled="true" title="Not available in this simulation">${text}</span>`;

// ---------------- City website ----------------
function cityShell(title, body, {sub = true, heroTitle = title} = {}) {
  document.body.className = 'city'; document.title = `${title} | City of Tuscaloosa`;
  const subLinks = [['/onlineservices', 'Account Service Center'], ['/pay-water-bill', 'Pay Water Bill'], ['/onlineservices/useful-forms', 'Useful Forms']];
  app.innerHTML = `<div class="topbar"><span>No notifications.</span><span>Select Language</span></div>
  <header class="citynav" aria-label="City of Tuscaloosa"><a class="n311" href="/faqs">Tuscaloosa 311</a>${inert('Government')}<a href="/onlineservices">City Services</a><a class="seal" href="/" aria-label="City of Tuscaloosa home">City of<br>Tuscaloosa<br>Alabama</a>${inert('Live &amp; Play')}${inert('Business')}<a class="menu" href="/">Menu</a></header>
  <div class="hero"><h1>${esc(heroTitle)}</h1></div>
  ${sub ? `<nav class="subnav" aria-label="Water billing">${subLinks.map(([h, t]) => `<a href="${h}"${path === h ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>` : ''}
  <main class="citymain">${body}</main>
  <section class="band"><div><h2>Tuscaloosa 311</h2><p>Dial 311 within city limits<br>or 205-248-5311</p></div><div><h2>News Alerts</h2><p>Register for email news releases from the City of Tuscaloosa.</p>${inert('Sign up here')}</div></section>
  <footer class="cityfoot"><p>The City of Tuscaloosa, Alabama</p><div class="cols">
   <div><h3>Quick Links</h3><ul><li><a href="/">Home</a></li><li>${inert('Garbage, Trash &amp; Recycling')}</li><li><a href="/pay-water-bill">Pay My Water Bill</a></li><li>${inert('Pay Traffic Citation')}</li><li><a href="/faqs">FAQs</a></li></ul></div>
   <div><h3>Get in Touch</h3><ul><li>Water Business Office: 205-248-5500</li><li><a href="/mail">Email inbox (mock Gmail)</a></li></ul></div>
   <div><h3>City Hall Entrance &amp; Parking</h3><p>2230 7th Street<br>Tuscaloosa, AL 35401</p></div>
   <div><h3>Upcoming Events</h3><p><em>The City Council meets every Tuesday at 5 p.m.</em></p></div></div>
   <p>Billworld simulation: public text reconstructed from captured city pages; forms, portal and outcomes are local and synthetic.</p></footer>`;
}
const contactCards = '<div class="cards"><div><h3>Mailing Address</h3><p>P.O. Box 2090<br>Tuscaloosa, AL 35403</p></div><div><h3>Physical Address</h3><p>2230 Gary Fitts Street<br>Tuscaloosa, AL 35401</p></div><div><h3>Email</h3><p>ubcontact@tuscaloosa.com</p></div></div>';
const cityPages = {
  '/': () => cityShell('City of Tuscaloosa', `<h2>Let us help you</h2><p>Most common tasks and requests</p><div class="tiles">
    <div class="tile">Pay My Water Bill<a class="btn" href="/pay-water-bill" aria-label="Pay My Water Bill - go">Go</a></div>
    <div class="tile">Work With Us${inert('Go')}</div><div class="tile">Garbage, Trash &amp; Recycling${inert('Go')}</div><div class="tile">Pay Traffic or Parking Citation${inert('Go')}</div><div class="tile">Interactive Maps${inert('Go')}</div></div>
    <h2>Water and sewer billing</h2><ul><li><a href="/billinfo">Bill and Payment Information</a></li><li><a href="/ach">Auto Bill Payment</a></li><li><a href="/onlineservices">Account Service Center</a></li><li><a href="/ebill">Enroll in eBill</a></li><li><a href="/faqs">Water &amp; Sewer FAQs</a></li></ul>
    <h2>News and announcements</h2><p>Stay up to date with everything here.</p><ul><li>Tuscaloosa City Council elects District 2 Councilor as President Pro Tempore (September 30, 2026)</li><li>Lake Tuscaloosa boat landings designated as Drinking Water Protection Areas (September 29, 2026)</li><li>City to rename Alberta Park and 26th Avenue East after late Council President (September 28, 2026)</li></ul>`, {sub: false}),
  '/billinfo': () => cityShell('Bill and Payment Information', `<h2>Billing Information</h2><p>A normal billing cycle is approximately 30 days. If a meter reading is unobtainable, a bill will be issued based upon estimated consumption.</p><p>Failure to receive a bill does not exempt the customer from timely payment or preclude service termination.</p><p>A customer who feels that there is a billing error must notify the Water Business Office either in person or in writing prior to the delinquent date of the bill. This does not exempt the customer from paying the bill by the due date.</p>
    <h2>Payments</h2><ul><li><a href="/pay-water-bill">Pay online</a></li><li><a href="/ach">Automatic Bill Payment</a></li><li>Pay in person: City Hall Annex III, 2230 Gary Fitts Street, Tuscaloosa, AL 35401</li><li>Mailing a check or money order: P.O. Box 2090, Tuscaloosa, AL 35403</li><li>Pay at a MoneyGram outlet</li></ul>
    <h2>More payment information</h2><p>Payments made by check or money order should be made payable to the City of Tuscaloosa. Please include the customer number on the check or money order. Allow at least five days for mail payments to post.</p>
    <h2>Checks</h2><p>The City processes check payments through an electronic check debit system. Checks returned by the customer's financial institution result in additional charges and possible service termination. Two or more returned checks within a 12-month period suspend check-writing privileges.</p>
    <h2>Delinquent Accounts and Service Restoration</h2><p>Payments must be received in our office by the bill delinquent date. Otherwise, the account is subject to service interruption and additional fees. Making a payment after service has been disconnected does not automatically schedule reconnection; contact the Water Business Office at utilitybilling@tuscaloosa.com or 205-248-5500.</p>
    <h2>Rates and Consumption</h2><p>Residential customers' water consumption is billed in units of ten cubic feet. Ten cubic feet of water equals 74.8 gallons. Sewer charges are based on a customer's water consumption.</p>`),
  '/ach': () => cityShell('Auto Bill Payment', `<p>Register today through the link below to setup your online customer payment portal and create your autopay. This option allows our customers to pay their bills by setting up recurring payments that draft the water bill payment electronically each month from the customer's payment method of their choosing.</p>
    <p><a class="btn" href="/cp/tusl/register">Setup Online Customer Portal</a></p>
    <p class="notice-blue">The following payment methods are now accepted with NO FEES:</p><ul><li>Paypal</li><li>Paypal Credit</li><li>Venmo</li><li>Apple Pay</li><li>Google Pay</li><li>Amazon Pay</li><li>eCheck/ACH</li><li>Debit/Credit Cards</li></ul>
    <p class="notice-blue">A $30 fee will be assessed to the account for insufficient funds by the payment method per municipal code Chapter 2, Article V, Section 2-72.</p>${contactCards}
    <h2>FAQs</h2><details open><summary>If I choose this option, when will my payment be withdrawn from my checking account?</summary><p>The payment method of your choosing will be automatically drafted on the due date of your bill every month (either the 1st or the 15th).</p></details>
    <details open><summary>How long will it take for this service to become active?</summary><p>Activation of your online payment portal will happen immediately, and the first auto draft will be on the due date following the account setup.</p></details>
    <details open><summary>How will I know when my enrollment is complete and the service is active?</summary><p>By setting up your online payment portal and creating your auto pay, you should within 5-10 minutes from setup receive a confirmation email to the email address provided during the setup process.</p></details>`),
  '/onlineservices': () => cityShell('Account Service Center', `<h2>Pay Bills</h2><p>Please have your account number and customer number available from a recent bill.</p><p><a class="btn" href="/pay-water-bill">Pay My Water Bill</a></p>
    <h2>Fillable PDF Forms</h2><p>All PDF forms are fillable and can be completed on a computer or mobile device using a free PDF reader app.</p>
    <h3>New Account</h3><p>New customers who wish to apply for a new water, sewer and garbage account should complete this form and return it via email or hand delivery to the Business Services Center at 2230 Gary Fitts St.</p>${inert('New Account (PDF)')}
    <h3>Transfer Service</h3><p>Existing customers who wish to transfer their service should complete this form and return it via email or hand delivery.</p>${inert('Transfer Service (PDF)')}
    <h3>Cancel Service</h3><p>Existing customers who wish to permanently disconnect their service should complete this form and return it via email or hand delivery.</p>${inert('Cancel Service (PDF)')}
    <h3>Enroll in eBill</h3><p>Existing customers who wish to receive their monthly bills by email rather than paper mail can enroll in the eBill service. Simply click the link, accept the terms and conditions and follow the prompts.</p><p><a class="btn" href="/ebill">Enroll Now</a></p>
    <h3>Other Online Forms</h3><p>Is the service that you need not listed above? <a href="/onlineservices/useful-forms">Please check this link.</a></p>
    <h2>I don't know my account number and customer number. How can I get them?</h2><p>If you do not have this information, please email us to request it. In your email please include the account holder's name, service address, and the last four digits of the account holder's SS#.</p>`),
  '/onlineservices/useful-forms': () => cityShell('Useful Forms', `<p>All PDF forms are fillable. Return completed forms to ubcontact@tuscaloosa.com or the Business Services Center at 2230 Gary Fitts St. Paper forms are not available in this simulation.</p><ul>
    ${['Application for New Account', 'Application to Transfer Service', 'Application To Cancel Service', 'Automatic Bank Draft Cancellation', 'Leak Relief Application', 'Legal Statement', 'Name Change Agreement', 'Fire Hydrant Meter Permit Application', 'Fire Hydrant Meter Removal or Relocation', 'Official Claim Form for the City of Tuscaloosa'].map(f => `<li>${inert(f)}</li>`).join('')}</ul>
    <p>To receive bills by email, use <a href="/ebill">Enroll in eBill</a>. To pay online or set up AutoPay, use <a href="/pay-water-bill">Pay My Water Bill</a>.</p>`),
  '/faqs': () => cityShell('Frequently Asked Questions', `<h2>Water &amp; Sewer</h2>
    <details open><summary>How do I make online payments to my water account?</summary><p>Customers who already have an account with us can pay bills (with no service charge), view their past 12 bills and review account usage information online at <a href="/pay-water-bill">tuscaloosa.com/pay-water-bill</a>. You will need your account number and customer ID to utilize this service. If you don't have this information, email ubcontact@tuscaloosa.com with the account holder's name and service address to request it.</p></details>
    <details open><summary>How do I check my water account balance?</summary><p>Use <a href="/pay-water-bill">tuscaloosa.com/pay-water-bill</a> with your account number and customer ID, or call the Business Office at 205-248-5500.</p></details>
    <details open><summary>How do I set up automatic bill payments from my checking account?</summary><p>Bank draft forms (Automatic Bill Payment Option) are posted at City Services Useful Forms and are returned to ubcontact@tuscaloosa.com or the Business Office. Online AutoPay through the customer portal is described on the <a href="/ach">Auto Bill Payment</a> page.</p></details>
    <details open><summary>How do I open a new water account or transfer an account to a new location?</summary><p>Complete the New Account or Transfer Service form at <a href="/onlineservices/useful-forms">City Services Useful Forms</a> and email it to ubcontact@tuscaloosa.com, or visit the Business Services Center at 2230 Gary Fitts St.</p></details>
    <details open><summary>How does a customer discontinue service?</summary><p>Email ubcontact@tuscaloosa.com with the requested turn-off date, service address, account number, customer ID number, last four digits of the account holder's Social Security number and a forwarding address for final billing, or call 205-248-5500.</p></details>`),
  '/ebill': renderEBill,
};
function renderEBill() {
  cityShell('Useful Forms', `<h2>Enroll, Unsubscribe, or Update your eBill Information</h2><h3>Terms and Conditions</h3><p>To register to have your utility bills delivered via email, please read and agree to the following conditions:</p><ol>
    <li>By enrolling in e-billing, you are requesting that we stop mailing you a paper bill. You'll stop receiving a paper bill once we have successfully delivered a confirmation email to the email address you provide.</li>
    <li>You are responsible for paying your bill even if your e-bill is not received. The same is true of a paper water bill.</li>
    <li>Please check your spam filters and add donotreplymunis@tuscaloosa.com to your address book to avoid emails bouncing back.</li>
    <li>You may still continue to pay your bill in person at our Business office, by mail, online or by using <a href="/ach">Automatic Payment</a>.</li>
    <li>If for any reason your e-bills are returned as undeliverable, you will be switched back to paper bills. There may be a delay of one or two billing cycles before you receive a paper bill.</li>
    <li>The City may use your email address to contact you, but will not rent, sell, or otherwise make your account or contact information available to any third party, unless required by law.</li>
    <li>You may opt out of e-billing at any time by completing this form again and clicking "unsubscribe." There is no cost to enroll or unenroll in e-billing.</li></ol>
    <section class="form" aria-labelledby="ebill-form-title"><h3 id="ebill-form-title">eBill Request Form</h3><p>Reconstructed local form (the live page embeds a third-party form).</p><div id="ebill-result"></div>
    <form data-action="ebill"><fieldset><legend>Request type</legend>
      <label class="check"><input type="radio" name="action" value="enroll" checked> Enroll in eBill</label><label class="check"><input type="radio" name="action" value="update"> Update eBill email address</label><label class="check"><input type="radio" name="action" value="unsubscribe"> Unsubscribe (return to paper bills)</label></fieldset>
      ${field('accountNumber', 'Account Number', 'text', 'required autocomplete="off"')}${field('customerNumber', 'Customer Number', 'text', 'required autocomplete="off"')}${field('name', 'Account Holder Name', 'text', 'required autocomplete="name"')}
      ${field('email', 'Email Address for eBills', 'email', 'autocomplete="email"')}${field('confirmEmail', 'Confirm Email Address', 'email', 'autocomplete="email"')}
      <label class="check"><input type="checkbox" name="acceptTerms" value="yes"> I have read and agree to the eBill terms and conditions above.</label>${errorBox}<button type="submit">Submit</button></form></section>`);
  bind('ebill', async d => {
    const r = await api('ebill', {...d, acceptTerms: d.acceptTerms === 'yes'});
    document.querySelector('#ebill-result').innerHTML = `<div class="status" role="status"><p><strong>Thank you. Your eBill request was received.</strong></p><p>Reference: <strong id="ebill-reference">${esc(r.reference)}</strong>. Account ${esc(r.accountNumber)}: ${r.action === 'unsubscribe' ? 'unsubscribed; paper bills will resume' : `eBills will be sent to ${esc(r.email)}`}. A confirmation email was sent${r.email ? ' to ' + esc(r.email) : ''}.</p></div>`;
    document.querySelector('form[data-action="ebill"]').reset();
  });
}

// ---------------- Paymentus customer portal ----------------
let me = null;
const NAV = [['/cp/tusl/accounts', 'My Accounts'], ['/cp/tusl/pay', 'Pay My Bill'], ['/cp/tusl/autopay', 'AutoPay'], ['/cp/tusl/bill-history', 'Bill History'], ['/cp/tusl/history', 'Payment History'], ['/cp/tusl/wallet', 'My Wallet'], ['/cp/tusl/profile', 'My Profile'], ['/cp/tusl/logout', 'Log Out']];
function portal(title, body) {
  document.body.className = 'portal'; document.title = `${title} - City of Tuscaloosa Water and Sewer`;
  const signed = me && !['/cp/tusl', '/cp/tusl/register', '/cp/tusl/forgot', '/cp/tusl/reset'].includes(path) && !path.startsWith('/cp/tusl/guest');
  app.innerHTML = `<header class="phead"><a class="brand" href="${me ? '/cp/tusl/accounts' : '/cp/tusl'}"><span class="pseal" aria-hidden="true">CITY OF TUSCALOOSA</span><span><b>City of Tuscaloosa</b><small>Water and Sewer · Customer Portal</small></span></a><span>${me ? `Signed in as ${esc(me.email)}` : '<a href="/">tuscaloosa.com</a>'}</span></header>
  ${signed ? `<nav class="pnav" aria-label="Customer portal">${NAV.map(([h, t]) => `<a href="${h}"${path === h ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>` : ''}
  <main class="pmain"><h1>${esc(title)}</h1>${body}</main>
  <footer class="pfoot"><p>Payments are processed with no convenience fee. Questions: Water Business Office 205-248-5500 · ubcontact@tuscaloosa.com</p><p><a href="/">City of Tuscaloosa</a> · <a href="/billinfo">Billing help</a> · <a href="/ebill">eBill</a> · <a href="/mail">Email inbox (mock Gmail)</a></p><p>Billworld simulation of a Paymentus customer portal. Layout follows the Paymentus family guide; Tuscaloosa's live portal was not observable, and private screens are synthetic.</p></footer>`;
}
function bind(action, handler) {
  const form = document.querySelector(`form[data-action="${action}"]`); if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault(); const button = form.querySelector('button[type=submit]'), err = form.querySelector('.error');
    if (err) err.textContent = ''; if (button) button.disabled = true;
    try { await handler(Object.fromEntries(new FormData(form)), form); } catch (x) { if (x.status === 401 && /sign in/i.test(x.message)) { go('/cp/tusl?next=' + encodeURIComponent(location.pathname + location.search)); return; } if (err) err.textContent = x.message; else alert(x.message); }
    finally { if (button && button.isConnected) button.disabled = false; }
  });
}
function failPage(title, e, back = ['/cp/tusl/accounts', 'Return to My Accounts']) { portal(title, `<div class="box"><p class="error" role="alert">${esc(e.message)}</p><p><a class="pbtn" href="${back[0]}">${back[1]}</a></p></div>`); }
const cents = v => Math.round(Number(String(v || '').replace(/[$,\s]/g, '')) * 100);
let serverToday = null;
const today = () => serverToday;
function methodFields(prefix, {guest = false, saved = []} = {}) {
  const radio = (v, label, checked = false, attrs = '') => `<label class="check"><input type="radio" name="methodChoice" value="${v}" ${checked ? 'checked' : ''} ${attrs}> ${label}</label>`;
  return `<fieldset><legend>Payment method</legend>${saved.map((m, i) => radio('saved:' + m.id, `${esc(m.label)}${m.kind === 'card' ? ' (exp. ' + esc(m.expiry) + ')' : ''} — saved`, i === 0)).join('')}
   ${radio('new-bank', 'New checking or savings account (eCheck/ACH)', !saved.length)}${radio('new-card', 'New debit or credit card')}
   <p>Also accepted on the live portal with no fees: PayPal, PayPal Credit, Venmo, Apple Pay, Google Pay and Amazon Pay. These digital wallets are not available in this simulation.</p></fieldset>
   <fieldset data-for="new-bank" ${saved.length ? 'hidden' : ''}><legend>New bank account</legend>${field('bankName', 'Account holder name', 'text', 'autocomplete="name"')}${field('routing', 'Routing number', 'text', 'inputmode="numeric" autocomplete="off"')}${field('accountNumber', 'Bank account number', 'text', 'inputmode="numeric" autocomplete="off"')}${field('confirmAccountNumber', 'Confirm bank account number', 'text', 'inputmode="numeric" autocomplete="off"')}
    <label for="f-accountType">Account type</label><select id="f-accountType" name="accountType"><option value="Checking">Checking</option><option value="Savings">Savings</option></select></fieldset>
   <fieldset data-for="new-card" hidden><legend>New card</legend>${field('cardName', 'Name on card', 'text', 'autocomplete="cc-name"')}${field('cardNumber', 'Card number', 'text', 'inputmode="numeric" autocomplete="cc-number"')}${field('expiry', 'Expiration date (MM/YY)', 'text', 'placeholder="MM/YY" autocomplete="cc-exp"')}${field('cvv', 'Security code (CVV)', 'text', 'inputmode="numeric" autocomplete="cc-csc"')}${field('zipCode', 'Billing ZIP code', 'text', 'inputmode="numeric" autocomplete="postal-code"')}</fieldset>
   ${guest ? '' : '<label class="check" id="save-row"><input type="checkbox" name="saveMethod" value="yes"> Save this new payment method to My Wallet</label>'}`;
}
function wireMethods(form) {
  const sync = () => { const v = form.querySelector('[name=methodChoice]:checked')?.value; form.querySelectorAll('fieldset[data-for]').forEach(f => { f.hidden = f.dataset.for !== v; }); const save = form.querySelector('#save-row'); if (save) save.hidden = !(v || '').startsWith('new-'); };
  form.querySelectorAll('[name=methodChoice]').forEach(r => r.addEventListener('change', sync)); sync();
}
function methodInput(d) {
  const v = d.methodChoice || '';
  if (v.startsWith('saved:')) return {methodId: v.slice(6)};
  if (v === 'new-bank') return {kind: 'bank', name: d.bankName, routing: (d.routing || '').trim(), accountNumber: (d.accountNumber || '').trim(), confirmAccountNumber: (d.confirmAccountNumber || '').trim(), accountType: d.accountType, saveMethod: d.saveMethod === 'yes'};
  if (v === 'new-card') return {kind: 'card', name: d.cardName, cardNumber: (d.cardNumber || '').replace(/\s/g, ''), expiry: (d.expiry || '').trim(), cvv: (d.cvv || '').trim(), zipCode: (d.zipCode || '').trim(), saveMethod: d.saveMethod === 'yes'};
  throw new Error('Choose a payment method');
}
function amountFields(balance) {
  return `<fieldset><legend>Payment amount</legend><label class="check"><input type="radio" name="amountChoice" value="full" checked> Total amount due: ${money(balance)}</label><label class="check"><input type="radio" name="amountChoice" value="other"> Other amount</label>${field('otherAmount', 'Other amount (USD)', 'text', 'inputmode="decimal" placeholder="0.00"')}</fieldset>`;
}
const amountOf = (d, balance) => d.amountChoice === 'other' ? cents(d.otherAmount) : balance;
async function requireSignIn() {
  if (!me) { go('/cp/tusl?next=' + encodeURIComponent(location.pathname + location.search)); return false; }
  return true;
}
const reviewBox = r => `<div class="box"><dl class="kv"><dt>Account number</dt><dd>${esc(r.account.accountNumber)}</dd><dt>Service address</dt><dd>${esc(r.account.serviceAddress)}</dd><dt>Payment amount</dt><dd>${money(r.amountCents)}</dd><dt>Convenience fee</dt><dd>${money(r.feeCents)}</dd><dt>Total</dt><dd><strong>${money(r.totalCents)}</strong></dd><dt>Payment date</dt><dd>${fmt(r.paymentDate)}${r.scheduled ? ' (scheduled)' : ' (today)'}</dd><dt>Payment method</dt><dd>${esc(r.method.label)}${r.saveMethod ? ' — will be saved to My Wallet' : ''}</dd><dt>Receipt email</dt><dd>${esc(r.receiptEmail)}</dd></dl></div>`;

const pages = {
  async '/cp/tusl'() {
    if (me) { go(qs.get('next') || '/cp/tusl/accounts'); return; }
    portal('Login', `${qs.get('reset') ? '<p class="status" role="status">Your password was changed. Log in with your new password.</p>' : ''}<div class="row"><section class="box" aria-labelledby="login-h"><h2 id="login-h">Login to your account</h2><form data-action="login">${field('email', 'Email', 'email', 'required autocomplete="username"')}${field('password', 'Password', 'password', 'required autocomplete="current-password"')}${errorBox}<div class="actions"><button class="pbtn" type="submit">Login</button><a href="/cp/tusl/forgot">Forgot your password?</a></div></form><p>Don't have an account? <a href="/cp/tusl/register">Register Now</a></p></section>
     <section class="box" aria-labelledby="guest-h"><h2 id="guest-h">Make a One-Time Payment</h2><p>Pay without registering. Have your <strong>account number</strong> and <strong>customer number</strong> from a recent bill.</p><p><a class="pbtn" href="/cp/tusl/guest">Make a One-Time Payment</a></p><p>No convenience fees for eCheck/ACH, debit/credit cards, PayPal, PayPal Credit, Venmo, Apple Pay, Google Pay or Amazon Pay.</p></section></div>`);
    bind('login', async d => { const r = await api('login', d); go(r.needsAccount ? '/cp/tusl/add-account' : (qs.get('next')?.startsWith('/cp/tusl/') ? qs.get('next') : '/cp/tusl/accounts')); });
  },
  async '/cp/tusl/register'() {
    portal('New Account Information', `<div class="box"><p>Please enter all of the information below. After registering you will add your water account using the account number and customer number on your bill.</p><form data-action="register">
      ${field('email', 'E-Mail Address', 'email', 'required autocomplete="email"')}${field('confirmEmail', 'Confirm E-Mail Address', 'email', 'required autocomplete="email"')}${field('password', 'Password', 'password', 'required autocomplete="new-password"')}<p id="pw-help">8–64 characters with at least one letter and one number; no spaces.</p>${field('confirmPassword', 'Confirm Password', 'password', 'required autocomplete="new-password"')}
      ${field('firstName', 'First Name', 'text', 'required autocomplete="given-name"')}${field('lastName', 'Last Name', 'text', 'required autocomplete="family-name"')}${field('phone', 'Phone Number', 'tel', 'required autocomplete="tel"')}${field('zipCode', 'Zip Code', 'text', 'required autocomplete="postal-code"')}
      <label class="check"><input type="checkbox" name="acceptTerms" value="yes"> I accept the customer portal Terms and Conditions.</label>${errorBox}<div class="actions"><button class="pbtn" type="submit">Register</button><a href="/cp/tusl">Back to Login</a></div></form></div>`);
    bind('register', async d => { await api('register', {...d, acceptTerms: d.acceptTerms === 'yes'}); go('/cp/tusl/add-account'); });
  },
  async '/cp/tusl/forgot'() {
    portal('Forgot Password', `<div class="box"><p>Enter the email address for your profile. We will email you a link to reset your password.</p><form data-action="forgot">${field('email', 'Email Address', 'email', 'required autocomplete="username"')}${errorBox}<p id="forgot-status" role="status"></p><div class="actions"><button class="pbtn" type="submit">Continue</button><a href="/cp/tusl">Back to Login</a></div></form><p><a href="/mail">Open email inbox</a></p></div>`);
    bind('forgot', async d => { const r = await api('recovery/request', d); document.querySelector('#forgot-status').innerHTML = `<span class="status">${esc(r.message)}</span>`; });
  },
  async '/cp/tusl/reset'() {
    let grant; try { grant = await api('recovery/grant'); } catch (e) { failPage('Reset Password', e, ['/cp/tusl/forgot', 'Request a new reset link']); return; }
    portal('Choose a New Password', `<div class="box"><p>Choose a new password for ${esc(grant.email)}.</p><form data-action="reset">${field('password', 'New Password', 'password', 'required autocomplete="new-password"')}<p>8–64 characters with at least one letter and one number; no spaces.</p>${field('confirmPassword', 'Confirm New Password', 'password', 'required autocomplete="new-password"')}${errorBox}<button class="pbtn" type="submit">Reset Password</button></form></div>`);
    bind('reset', async d => { await api('recovery/complete', d); go('/cp/tusl?reset=1'); });
  },
  async '/cp/tusl/logout'() { await api('logout', {}); go('/cp/tusl'); },
  async '/cp/tusl/add-account'() {
    if (!await requireSignIn()) return;
    portal('Add Account', `<div class="box"><p>Enter the account number and customer number exactly as printed on your City of Tuscaloosa water bill.</p><form data-action="link">${field('accountNumber', 'Account Number', 'text', 'required autocomplete="off"')}${field('customerNumber', 'Customer Number', 'text', 'required autocomplete="off"')}${errorBox}<div class="actions"><button class="pbtn" type="submit">Verify</button><a href="/cp/tusl/accounts">Cancel</a></div></form><p>Don't know these numbers? Email ubcontact@tuscaloosa.com with the account holder's name and service address.</p></div>`);
    bind('link', async d => { await api('link/verify', d); go('/cp/tusl/add-account/verify'); });
  },
  async '/cp/tusl/add-account/verify'() {
    if (!await requireSignIn()) return;
    let r; try { r = await api('link/review'); } catch (e) { failPage('Verify Account', e, ['/cp/tusl/add-account', 'Enter account details again']); return; }
    portal('Verify Account', `<div class="box"><p>We found this account. Confirm it is yours before adding it to your profile.</p><dl class="kv"><dt>Account number</dt><dd>${esc(r.account.accountNumber)}</dd><dt>Customer number</dt><dd>${esc(r.account.customerNumber)}</dd><dt>Name</dt><dd>${esc(r.account.name)}</dd><dt>Service address</dt><dd>${esc(r.account.serviceAddress)}</dd></dl>
      <form data-action="link-confirm"><label class="check"><input type="checkbox" name="acceptTerms" value="yes"> I am the account holder or am authorized to view and pay this account.</label>${errorBox}<div class="actions"><button class="pbtn" type="submit">Add Account</button><a href="/cp/tusl/add-account">Back</a></div></form></div>`);
    bind('link-confirm', async d => { await api('link/confirm', {acceptTerms: d.acceptTerms === 'yes'}); go('/cp/tusl/add-account/done'); });
  },
  async '/cp/tusl/add-account/done'() {
    if (!await requireSignIn()) return;
    let r; try { r = await api('link/receipt'); } catch (e) { failPage('Account Added', e); return; }
    const svc = (await api('accounts')).accounts.find(a => a.accountNumber === r.account.accountNumber);
    portal('Account Added', `<div class="box"><p class="status" role="status">Account ${esc(r.account.accountNumber)} (${esc(r.account.serviceAddress)}) was added to your profile.</p><div class="actions"><a class="pbtn" href="/cp/tusl/accounts">Go to My Accounts</a>${svc ? `<a class="pbtn secondary" href="/cp/tusl/autopay/setup?account=${svc.id}">Set Up AutoPay for ${esc(svc.accountNumber)}</a><a class="pbtn secondary" href="/cp/tusl/pay?account=${svc.id}">Pay Now</a>` : ''}<a href="/cp/tusl/add-account">Add another account</a></div></div>`);
  },
  async '/cp/tusl/accounts'() {
    if (!await requireSignIn()) return;
    const r = await api('accounts');
    portal('My Accounts', (r.accounts.length ? r.accounts.map(a => `<section class="box" aria-labelledby="acct-${a.id}"><h2 id="acct-${a.id}">Account ${esc(a.accountNumber)} · ${esc(a.serviceAddress)}</h2><div class="row"><dl class="kv"><dt>Customer number</dt><dd>${esc(a.customerNumber)}</dd><dt>Amount due</dt><dd class="amount">${money(a.balanceCents)}</dd><dt>Due date</dt><dd>${a.balanceCents ? fmt(a.dueDate) : 'No balance due'}</dd></dl>
      <dl class="kv"><dt>AutoPay</dt><dd>${a.autopay.enabled ? `<span class="tag on">On</span> ${esc(a.autopay.method?.label)} · next draft ${fmt(a.autopay.nextDraftDate)}` : '<span class="tag off">Off</span>'}</dd><dt>Bill delivery</dt><dd>${a.ebill.status === 'enrolled' ? 'eBill (email)' : 'Paper bill'} · <a href="/ebill">Manage eBill</a></dd><dt>Scheduled payments</dt><dd>${a.scheduled}</dd></dl></div>
      <div class="actions"><a class="pbtn" href="/cp/tusl/pay?account=${a.id}" aria-label="Pay Now for account ${esc(a.accountNumber)}">Pay Now</a><a class="pbtn secondary" href="/cp/tusl/bill?account=${a.id}" aria-label="View Bill for account ${esc(a.accountNumber)}">View Bill</a><a href="/cp/tusl/bill-history?account=${a.id}" aria-label="Bill History for account ${esc(a.accountNumber)}">Bill History</a><a href="/cp/tusl/autopay/setup?account=${a.id}" aria-label="AutoPay settings for account ${esc(a.accountNumber)}">AutoPay settings</a></div></section>`).join('') : '<div class="box"><p>No accounts are linked to your profile yet.</p></div>') + '<p><a class="pbtn secondary" href="/cp/tusl/add-account">+ Add Account</a></p>');
  },
  async '/cp/tusl/bill'() {
    if (!await requireSignIn()) return;
    const id = qs.get('account'); if (!id) { await chooseAccount('View Bill', '/cp/tusl/bill'); return; }
    let r; try { r = await api('bills?account=' + encodeURIComponent(id)); } catch (e) { failPage('View Bill', e); return; }
    const b = r.bills[0];
    portal('View Bill', `<section class="box"><h2>Account ${esc(r.account.accountNumber)} · ${esc(r.account.serviceAddress)}</h2><div class="row"><dl class="kv"><dt>Statement date</dt><dd>${fmt(b.billDate)}</dd><dt>Service period</dt><dd>${esc(b.period)}</dd><dt>Due date</dt><dd>${fmt(b.dueDate)}</dd><dt>Usage</dt><dd>${b.units} units of 10 cubic feet (${b.gallons.toLocaleString()} gallons)</dd></dl>
      <table><caption class="sr">Charges</caption><thead><tr><th>Charge</th><th>Amount</th></tr></thead><tbody>${b.lines.map(l => `<tr><td>${esc(l.label)}</td><td>${money(l.amountCents)}</td></tr>`).join('')}<tr><th>Total</th><th>${money(b.amountCents)}</th></tr></tbody></table></div>
      <p>Account balance due: <strong>${money(r.account.balanceCents)}</strong> · Bill status: ${esc(b.status)}</p><div class="actions"><a class="pbtn" href="/cp/tusl/pay?account=${r.account.id}">Pay Now</a><a class="pbtn secondary" href="/api/tus/statement?invoiceId=${encodeURIComponent(b.id)}" download="${esc(b.filename)}">Download PDF</a><a href="/cp/tusl/bill-history?account=${r.account.id}">Bill History (past 12 bills)</a></div></section>`);
  },
  async '/cp/tusl/bill-history'() {
    if (!await requireSignIn()) return;
    const id = qs.get('account'); if (!id) { await chooseAccount('Bill History', '/cp/tusl/bill-history'); return; }
    let r; try { r = await api('bills?account=' + encodeURIComponent(id)); } catch (e) { failPage('Bill History', e); return; }
    portal('Bill History', `<p>Account ${esc(r.account.accountNumber)} · ${esc(r.account.serviceAddress)} · <a href="/cp/tusl/bill-history">Choose another account</a></p><table><caption>Past 12 bills</caption><thead><tr><th>Statement date</th><th>Due date</th><th>Usage</th><th>Amount</th><th>Status</th><th>Bill</th></tr></thead><tbody>
      ${r.bills.map(b => `<tr><td>${fmt(b.billDate)}</td><td>${fmt(b.dueDate)}</td><td>${b.units} units (${b.gallons.toLocaleString()} gal)</td><td>${money(b.amountCents)}</td><td>${esc(b.status)}</td><td><a href="/api/tus/statement?invoiceId=${encodeURIComponent(b.id)}" download="${esc(b.filename)}" aria-label="Download PDF for bill due ${fmt(b.dueDate)}" data-statement="${esc(b.id)}">Download PDF</a></td></tr>`).join('')}</tbody></table><p>${esc(r.coverage)}</p>`);
  },
  async '/cp/tusl/pay'() {
    if (!await requireSignIn()) return;
    const accts = (await api('accounts')).accounts, id = qs.get('account') || (accts.length === 1 ? accts[0].id : null);
    if (!id) { portal('Pay My Bill', accts.length ? `<div class="box"><p>Choose the account to pay.</p><ul>${accts.map(a => `<li><a href="/cp/tusl/pay?account=${a.id}">Account ${esc(a.accountNumber)} · ${esc(a.serviceAddress)} · due ${money(a.balanceCents)}</a></li>`).join('')}</ul></div>` : '<div class="box"><p>Add an account first.</p><a class="pbtn" href="/cp/tusl/add-account">Add Account</a></div>'); return; }
    const a = accts.find(x => x.id === id); if (!a) { failPage('Pay My Bill', new Error('Account not found in your profile')); return; }
    const w = await api('wallet');
    if (!a.balanceCents) { portal('Pay My Bill', `<div class="box"><p>Account ${esc(a.accountNumber)} has no balance due.</p><a href="/cp/tusl/accounts">Return to My Accounts</a></div>`); return; }
    portal('Make a Payment', `<section class="box"><h2>Account ${esc(a.accountNumber)} · ${esc(a.serviceAddress)}</h2><p>Amount due ${money(a.balanceCents)} · due ${fmt(a.dueDate)}</p>${a.autopay.enabled ? `<p class="warn">AutoPay is on for this account and will draft the remaining balance on ${fmt(a.autopay.nextDraftDate)}. A one-time payment reduces that draft.</p>` : ''}
      <form data-action="pay">${amountFields(a.balanceCents)}${field('paymentDate', 'Payment date', 'date', `required min="${today()}"`, today())}<p>Choose today to pay now, or a later date (within 60 days) to schedule the payment.</p>${methodFields('', {saved: w.methods})}${errorBox}<div class="actions"><button class="pbtn" type="submit">Continue to Review</button><a href="/cp/tusl/accounts">Cancel</a></div></form></section>`);
    const form = document.querySelector('form[data-action="pay"]'); wireMethods(form);
    bind('pay', async d => { await api('quote', {serviceAccountId: id, amountCents: amountOf(d, a.balanceCents), paymentDate: d.paymentDate, ...methodInput(d)}); go('/cp/tusl/pay/review'); });
  },
  async '/cp/tusl/pay/review'() { if (!await requireSignIn()) return; await reviewPage(false); },
  async '/cp/tusl/pay/receipt'() { if (!await requireSignIn()) return; await receiptPage(false); },
  async '/cp/tusl/guest'() {
    portal('Make a One-Time Payment', `<div class="box"><p>Enter the account number and customer number exactly as shown on your City of Tuscaloosa water bill.</p><form data-action="guest">${field('accountNumber', 'Account Number', 'text', 'required autocomplete="off"')}${field('customerNumber', 'Customer Number', 'text', 'required autocomplete="off"')}${errorBox}<div class="actions"><button class="pbtn" type="submit">Find Account</button><a href="/cp/tusl">Back to Login</a></div></form></div>`);
    bind('guest', async d => { await api('guest/lookup', d); go('/cp/tusl/guest/pay'); });
  },
  async '/cp/tusl/guest/pay'() {
    let g; try { g = await api('guest'); } catch (e) { failPage('Make a One-Time Payment', e, ['/cp/tusl/guest', 'Enter account details again']); return; }
    const a = g.account;
    if (!a.balanceCents) { portal('Make a One-Time Payment', `<div class="box"><p>Account ${esc(a.accountNumber)} has no balance due.</p><a href="/cp/tusl">Return to Login</a></div>`); return; }
    portal('Make a One-Time Payment', `<section class="box"><h2>Account ${esc(a.accountNumber)} · ${esc(a.serviceAddress)}</h2><p>Amount due ${money(a.balanceCents)} · due ${fmt(a.dueDate)}. One-time payments are processed today.</p>
      <form data-action="guest-pay">${amountFields(a.balanceCents)}${methodFields('', {guest: true})}${field('email', 'Email address for your receipt', 'email', 'required autocomplete="email"')}${errorBox}<div class="actions"><button class="pbtn" type="submit">Continue to Review</button><a href="/cp/tusl/guest">Start over</a></div></form></section>`);
    wireMethods(document.querySelector('form[data-action="guest-pay"]'));
    bind('guest-pay', async d => { await api('quote', {guest: true, amountCents: amountOf(d, a.balanceCents), email: d.email, ...methodInput(d)}); go('/cp/tusl/guest/review'); });
  },
  async '/cp/tusl/guest/review'() { await reviewPage(true); },
  async '/cp/tusl/guest/receipt'() { await receiptPage(true); },
  async '/cp/tusl/history'() {
    if (!await requireSignIn()) return;
    const r = await api('history'), sched = r.scheduled;
    portal('Payment History', `${qs.get('updated') ? '<p class="status" role="status">Your scheduled payment was updated.</p>' : ''}<div id="history-status" role="status"></div><section class="box"><h2>Scheduled Payments</h2>${sched.length ? `<table><thead><tr><th>Account</th><th>Payment date</th><th>Amount</th><th>Method</th><th>Confirmation</th><th>Status</th><th>Actions</th></tr></thead><tbody>${sched.map(p => `<tr><td>${esc(p.accountNumber)}</td><td>${fmt(p.date)}</td><td>${money(p.amountCents)}</td><td>${esc(p.method)}</td><td>${esc(p.confirmation)}</td><td>${esc(p.status)}</td><td>${p.status === 'scheduled' ? `<span class="actions"><a href="/cp/tusl/history/edit?id=${encodeURIComponent(p.id)}" aria-label="Edit scheduled payment of ${money(p.amountCents)} on ${fmt(p.date)}">Edit</a><button type="button" class="secondary" data-cancel="${esc(p.id)}" aria-label="Cancel scheduled payment of ${money(p.amountCents)} on ${fmt(p.date)}">Cancel</button></span><span data-confirm="${esc(p.id)}" hidden>Cancel this payment? <button type="button" class="danger" data-confirm-cancel="${esc(p.id)}" aria-label="Yes, cancel the ${money(p.amountCents)} payment on ${fmt(p.date)}">Yes, cancel payment</button> <button type="button" class="secondary" data-keep="${esc(p.id)}">Keep payment</button></span>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p>No scheduled payments.</p>'}</section>
      <section class="box"><h2>Payments</h2><table><thead><tr><th>Date</th><th>Account</th><th>Amount</th><th>Fee</th><th>Method</th><th>Type</th><th>Status</th><th>Confirmation</th></tr></thead><tbody>${r.payments.map(p => `<tr><td>${fmt(p.date)}</td><td>${esc(p.accountNumber)}</td><td>${money(p.amountCents)}</td><td>${money(p.feeCents)}</td><td>${esc(p.method)}</td><td>${esc({portal: 'One-time', guest: 'One-time (guest)', autopay: 'AutoPay', scheduled: 'Scheduled'}[p.source] || p.source)}</td><td>${esc(p.status)}</td><td>${esc(p.confirmation)}</td></tr>`).join('')}</tbody></table><p>${esc(r.coverage)}</p></section>`);
    app.addEventListener('click', async e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.cancel) { document.querySelector(`[data-confirm="${t.dataset.cancel}"]`).hidden = false; t.parentElement.hidden = true; document.querySelector(`[data-confirm-cancel="${t.dataset.cancel}"]`).focus(); }
      if (t.dataset.keep) { document.querySelector(`[data-confirm="${t.dataset.keep}"]`).hidden = true; document.querySelector(`[data-cancel="${t.dataset.keep}"]`).parentElement.hidden = false; }
      if (t.dataset.confirmCancel) { t.disabled = true; try { await api('schedule/cancel', {scheduleId: t.dataset.confirmCancel}); location.reload(); } catch (x) { document.querySelector('#history-status').innerHTML = `<p class="error" role="alert">${esc(x.message)}</p>`; t.disabled = false; } }
    });
  },
  async '/cp/tusl/history/edit'() {
    if (!await requireSignIn()) return;
    const r = await api('history'), p = r.scheduled.find(x => x.id === qs.get('id'));
    if (!p || p.status !== 'scheduled') { failPage('Edit Scheduled Payment', new Error('This scheduled payment is not available for editing.'), ['/cp/tusl/history', 'Return to Payment History']); return; }
    portal('Edit Scheduled Payment', `<div class="box"><p>Account ${esc(p.accountNumber)} · confirmation ${esc(p.confirmation)}</p><form data-action="edit">${field('amount', 'Payment amount (USD)', 'text', 'required inputmode="decimal"', (p.amountCents / 100).toFixed(2))}${field('date', 'Payment date', 'date', 'required', p.date)}
      <label for="f-methodId">Payment method</label><select id="f-methodId" name="methodId">${r.methods.map(m => `<option value="${esc(m.id)}" ${m.id === p.methodId ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>${errorBox}<div class="actions"><button class="pbtn" type="submit">Save Changes</button><a href="/cp/tusl/history">Cancel</a></div></form></div>`);
    bind('edit', async d => { await api('schedule/edit', {scheduleId: p.id, amountCents: cents(d.amount), date: d.date, methodId: d.methodId}); go('/cp/tusl/history?updated=1'); });
  },
  async '/cp/tusl/autopay'() {
    if (!await requireSignIn()) return;
    const r = await api('autopay');
    portal('AutoPay', `<p>AutoPay drafts your bill automatically on its due date each month (the 1st or the 15th, depending on your account). There is no fee. Activation is immediate; the first draft is on the next due date after setup.</p>${r.accounts.map(a => `<section class="box"><h2>Account ${esc(a.accountNumber)} · ${esc(a.serviceAddress)}</h2><p>Status: ${a.autopay.enabled ? `<span class="tag on">Enrolled</span> using ${esc(a.autopay.method?.label)} · next draft ${fmt(a.autopay.nextDraftDate)}` : '<span class="tag off">Not enrolled</span>'} · Bills due on the ${a.dueDay === 1 ? '1st' : '15th'}</p>
      <div class="actions">${a.autopay.enabled ? `<a class="pbtn" href="/cp/tusl/autopay/setup?account=${a.id}" aria-label="Change AutoPay payment method for account ${esc(a.accountNumber)}">Change Payment Method</a><a class="pbtn secondary" href="/cp/tusl/autopay/setup?account=${a.id}&amp;action=cancel" aria-label="Cancel AutoPay for account ${esc(a.accountNumber)}">Cancel AutoPay</a>` : `<a class="pbtn" href="/cp/tusl/autopay/setup?account=${a.id}" aria-label="Enroll account ${esc(a.accountNumber)} in AutoPay">Enroll in AutoPay</a>`}</div></section>`).join('') || '<div class="box"><p>Add an account first. <a href="/cp/tusl/add-account">Add Account</a></p></div>'}`);
  },
  async '/cp/tusl/autopay/setup'() {
    if (!await requireSignIn()) return;
    const r = await api('autopay'), a = r.accounts.find(x => x.id === qs.get('account'));
    if (!a) { failPage('AutoPay', new Error('Choose an account from AutoPay.'), ['/cp/tusl/autopay', 'Return to AutoPay']); return; }
    if (qs.get('action') === 'cancel') {
      if (!a.autopay.enabled) { failPage('Cancel AutoPay', new Error('AutoPay is not active for this account.'), ['/cp/tusl/autopay', 'Return to AutoPay']); return; }
      portal('Cancel AutoPay', `<div class="box"><p>Account ${esc(a.accountNumber)} · ${esc(a.serviceAddress)} is enrolled using ${esc(a.autopay.method?.label)}.</p><form data-action="autopay-cancel">${errorBox}<div class="actions"><button class="pbtn" type="submit">Review Cancellation</button><a href="/cp/tusl/autopay">Back</a></div></form></div>`);
      bind('autopay-cancel', async () => { await api('autopay/quote', {serviceAccountId: a.id, enabled: false}); go('/cp/tusl/autopay/review'); });
      return;
    }
    const back = encodeURIComponent(location.pathname + location.search);
    portal(a.autopay.enabled ? 'Change AutoPay' : 'Set Up AutoPay', `<div class="box"><h2>Account ${esc(a.accountNumber)} · ${esc(a.serviceAddress)}</h2><p>Your bill will be drafted on its due date (the ${a.dueDay === 1 ? '1st' : '15th'} of each month) from the payment method you choose. No convenience fee applies.</p>${a.autopay.enabled ? `<p>Currently using ${esc(a.autopay.method?.label)}.</p>` : ''}
      ${r.methods.length ? `<form data-action="autopay"><fieldset><legend>AutoPay payment method</legend>${r.methods.map((m, i) => `<label class="check"><input type="radio" name="methodId" value="${esc(m.id)}" ${(a.autopay.enabled ? a.autopay.method?.id !== m.id && i === r.methods.findIndex(x => x.id !== a.autopay.method?.id) : i === 0) ? 'checked' : ''}> ${esc(m.label)}${m.kind === 'card' ? ' (exp. ' + esc(m.expiry) + ')' : ''}${a.autopay.enabled && a.autopay.method?.id === m.id ? ' — current' : ''}</label>`).join('')}</fieldset>${errorBox}<div class="actions"><button class="pbtn" type="submit">Continue</button><a href="/cp/tusl/autopay">Back</a></div></form>` : '<p>You have no saved payment methods.</p>'}
      <p><a href="/cp/tusl/wallet/add?return=${back}">Add a payment method to My Wallet</a></p></div>`);
    bind('autopay', async d => { await api('autopay/quote', {serviceAccountId: a.id, enabled: true, methodId: d.methodId}); go('/cp/tusl/autopay/review'); });
  },
  async '/cp/tusl/autopay/review'() {
    if (!await requireSignIn()) return;
    let r; try { r = await api('autopay/review'); } catch (e) { failPage('Review AutoPay', e, ['/cp/tusl/autopay', 'Return to AutoPay']); return; }
    if (r.applied) { go('/cp/tusl/autopay/confirmation'); return; }
    const verb = r.enabled ? (r.change ? 'Change' : 'Enrollment') : 'Cancellation';
    portal('Review AutoPay', `<div class="box"><dl class="kv"><dt>Account</dt><dd>${esc(r.account.accountNumber)} · ${esc(r.account.serviceAddress)}</dd><dt>Action</dt><dd>${r.enabled ? (r.change ? 'Change AutoPay payment method' : 'Enroll in AutoPay') : 'Cancel AutoPay'}</dd>${r.previousMethod ? `<dt>Current method</dt><dd>${esc(r.previousMethod.label)}</dd>` : ''}${r.enabled ? `<dt>New method</dt><dd>${esc(r.method.label)}</dd><dt>Draft date</dt><dd>Bill due date each month (the ${r.account.dueDay === 1 ? '1st' : '15th'})</dd><dt>First/next draft</dt><dd>${fmt(r.firstDraftDate)}</dd><dt>Fee</dt><dd>${money(r.feeCents)}</dd>` : ''}</dl>
      <form data-action="autopay-confirm"><label class="check"><input type="checkbox" name="authorize" value="yes"> ${r.enabled ? 'I authorize the City of Tuscaloosa to draft my water bill balance from this payment method on each bill due date until I cancel AutoPay.' : 'I want to cancel AutoPay for this account. Future bills will not be paid automatically.'}</label>${errorBox}<div class="actions"><button class="pbtn" type="submit">Confirm ${verb}</button><a href="/cp/tusl/autopay">Back</a></div></form></div>`);
    bind('autopay-confirm', async d => { await api('autopay/confirm', {authorize: d.authorize === 'yes'}); go('/cp/tusl/autopay/confirmation'); });
  },
  async '/cp/tusl/autopay/confirmation'() {
    if (!await requireSignIn()) return;
    let r; try { r = await api('autopay/review'); } catch (e) { failPage('AutoPay Confirmation', e, ['/cp/tusl/autopay', 'Return to AutoPay']); return; }
    if (!r.applied) { go('/cp/tusl/autopay/review'); return; }
    portal('AutoPay Confirmation', `<div class="box"><p class="status" role="status">${r.enabled ? (r.change ? `AutoPay for account ${esc(r.account.accountNumber)} now uses ${esc(r.method.label)}.` : `Account ${esc(r.account.accountNumber)} is enrolled in AutoPay using ${esc(r.method.label)}. First draft: ${fmt(r.firstDraftDate)}.`) : `AutoPay for account ${esc(r.account.accountNumber)} was cancelled.`}</p><p>A confirmation email was sent to your profile email address.</p><div class="actions"><a class="pbtn" href="/cp/tusl/autopay">Back to AutoPay</a><a href="/cp/tusl/accounts">My Accounts</a></div></div>`);
  },
  async '/cp/tusl/wallet'() {
    if (!await requireSignIn()) return;
    const r = await api('wallet');
    portal('My Wallet', `<div id="wallet-status" role="status"></div><section class="box"><h2>Saved payment methods</h2>${r.methods.length ? `<table><thead><tr><th>Method</th><th>Name</th><th>Used by</th><th>Actions</th></tr></thead><tbody>${r.methods.map(m => `<tr><td>${esc(m.label)}${m.expiry ? ' · exp. ' + esc(m.expiry) : ''}</td><td>${esc(m.name)}</td><td>${m.autopayAccounts.length ? 'AutoPay for ' + m.autopayAccounts.map(esc).join(', ') : ''}${m.scheduledPayments ? ` ${m.scheduledPayments} scheduled payment(s)` : ''}</td><td><button type="button" class="secondary" data-remove="${esc(m.id)}" aria-label="Remove ${esc(m.label)}">Remove</button></td></tr>`).join('')}</tbody></table>` : '<p>No saved payment methods.</p>'}<p><a class="pbtn" href="/cp/tusl/wallet/add">Add Payment Method</a></p></section><p>Digital wallets accepted on the live portal (${r.walletTypes.map(esc).join(', ')}) are not available in this simulation.</p>`);
    app.addEventListener('click', async e => { const b = e.target.closest('[data-remove]'); if (!b) return; b.disabled = true; try { await api('wallet/remove', {methodId: b.dataset.remove}); location.reload(); } catch (x) { document.querySelector('#wallet-status').innerHTML = `<p class="error" role="alert">${esc(x.message)}</p>`; b.disabled = false; } });
  },
  async '/cp/tusl/wallet/add'() {
    if (!await requireSignIn()) return;
    const ret = qs.get('return'), dest = ret && ret.startsWith('/cp/tusl/') && !ret.startsWith('//') ? ret : '/cp/tusl/wallet';
    portal('Add Payment Method', `<div class="box"><form data-action="wallet-add">${methodFields('', {guest: true}).replace('<legend>Payment method</legend>', '<legend>Type of payment method</legend>')}${errorBox}<div class="actions"><button class="pbtn" type="submit">Save Payment Method</button><a href="${esc(dest)}">Cancel</a></div></form></div>`);
    wireMethods(document.querySelector('form[data-action="wallet-add"]'));
    bind('wallet-add', async d => { const m = methodInput(d); if (m.methodId) throw new Error('Choose a new bank account or card'); await api('wallet/add', m); go(dest); });
  },
  async '/cp/tusl/profile'() {
    if (!await requireSignIn()) return;
    portal('My Profile', `<div class="box"><p>Email: <strong>${esc(me.email)}</strong></p><form data-action="profile">${field('firstName', 'First Name', 'text', 'required', me.firstName)}${field('lastName', 'Last Name', 'text', 'required', me.lastName)}${field('phone', 'Phone Number', 'tel', 'required', me.phone)}${field('zipCode', 'Zip Code', 'text', 'required', me.zipCode)}${errorBox}<p id="profile-status" role="status"></p><button class="pbtn" type="submit">Save Profile</button></form><p>To change your password, log out and use <a href="/cp/tusl/forgot">Forgot your password?</a></p></div>`);
    bind('profile', async d => { await api('profile', d); document.querySelector('#profile-status').innerHTML = '<span class="status">Profile saved.</span>'; });
  },
};
async function chooseAccount(title, base) {
  const r = await api('accounts');
  if (r.accounts.length === 1) { go(`${base}?account=${r.accounts[0].id}`); return; }
  portal(title, `<div class="box"><p>Choose an account.</p><ul>${r.accounts.map(a => `<li><a href="${base}?account=${a.id}">Account ${esc(a.accountNumber)} · ${esc(a.serviceAddress)}</a></li>`).join('')}</ul>${r.accounts.length ? '' : '<p><a href="/cp/tusl/add-account">Add Account</a></p>'}</div>`);
}
async function reviewPage(guest) {
  const base = guest ? '/cp/tusl/guest' : '/cp/tusl/pay';
  let r; try { r = await api('review'); } catch (e) { failPage('Review Payment', e, [guest ? '/cp/tusl/guest' : '/cp/tusl/pay', 'Start a new payment']); return; }
  if (r.completed) { go(`${base}/receipt`); return; }
  portal('Review Payment', `${reviewBox(r)}<div class="box"><form data-action="submit-payment"><label class="check"><input type="checkbox" name="authorize" value="yes"> I authorize the City of Tuscaloosa to ${r.method.kind === 'bank' ? 'debit my bank account' : 'charge my card'} for ${money(r.totalCents)} ${r.scheduled ? 'on ' + fmt(r.paymentDate) : 'today'}.</label>${errorBox}<div class="actions"><button class="pbtn" type="submit">${r.scheduled ? 'Schedule Payment' : 'Submit Payment'}</button><a href="${guest ? '/cp/tusl/guest/pay' : '/cp/tusl/pay?account=' + encodeURIComponent(r.account.id)}">Edit payment details</a></div></form></div>`);
  bind('submit-payment', async d => { await api('pay', {authorize: d.authorize === 'yes'}); go(`${base}/receipt`); });
}
async function receiptPage(guest) {
  let r; try { r = await api('receipt'); } catch (e) { failPage('Payment Confirmation', e, [guest ? '/cp/tusl/guest' : '/cp/tusl/accounts', guest ? 'Make a one-time payment' : 'Return to My Accounts']); return; }
  portal(r.scheduled ? 'Payment Scheduled' : 'Payment Confirmation', `<div class="box"><p class="status" role="status">${r.scheduled ? `Your payment is scheduled for ${fmt(r.paymentDate)}.` : 'Thank you. Your payment was received.'}</p><p>Confirmation number: <strong id="confirmation">${esc(r.confirmation)}</strong></p></div>${reviewBox(r)}<p>A receipt was emailed to ${esc(r.receiptEmail)}.</p><div class="actions">${guest ? '<a class="pbtn" href="/cp/tusl">Return to Login</a>' : '<a class="pbtn" href="/cp/tusl/history">Payment History</a><a href="/cp/tusl/accounts">My Accounts</a>'}</div>`);
}

(async () => {
  try {
    if (path.startsWith('/cp/tusl')) { const r = await api('me'); me = r.profile; serverToday = r.today; }
    const page = pages[path] || cityPages[path];
    if (!page) { cityShell('Page Not Found', '<p>This page is not available. <a href="/">Return to the City of Tuscaloosa home page</a>.</p>'); return; }
    await page();
  } catch (e) {
    if (e.status === 401 && path.startsWith('/cp/tusl')) { go('/cp/tusl?next=' + encodeURIComponent(location.pathname + location.search)); return; }
    app.innerHTML = `<main class="pmain"><h1>Something went wrong</h1><p class="error" role="alert">${esc(e.message)}</p><p><a href="/">City of Tuscaloosa home</a> · <a href="/cp/tusl">Customer portal</a></p></main>`;
  }
})();
})();
