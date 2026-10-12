// Charlotte County Utilities - reconstructed Paymentus customer portal (local Billworld simulation).
'use strict';
const root = document.querySelector('#ccu');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const money = c => '$' + (c / 100).toFixed(2);
const longDate = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'}) : '';
const shortDate = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric'}) : '';
const params = new URLSearchParams(location.search);
const path = location.pathname.replace(/\/$/, '');
class HttpError extends Error { constructor(message, status) { super(message); this.status = status; } }
async function api(route, input) {
  const response = await fetch('/api/ccu/' + route, input ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)} : {});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(data.error || 'Request failed', response.status);
  return data;
}
const errorBox = '<p class="error" role="alert"></p>';
function bind(selector, action) {
  const form = root.querySelector(selector);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type=submit],button:not([type])'), error = form.querySelector('.error');
    if (button) button.disabled = true; if (error) error.textContent = '';
    try { await action(form, Object.fromEntries(new FormData(form))); }
    catch (e) { if (error) error.textContent = e.message; else alert(e.message); }
    finally { if (button) button.disabled = false; }
  });
}
const checked = (form, name) => !!form.querySelector(`[name="${name}"]`)?.checked;
function page(title, body, {narrow = false} = {}) {
  document.title = title + ' | Charlotte County Utilities Online Payments';
  root.innerHTML = `<section class="card${narrow ? ' narrow' : ''}"><h1>${esc(title)}</h1>${body}</section>`;
}
const NAV = [['/cp/ccfl/accounts', 'My Accounts'], ['/cp/ccfl/pay', 'Make a Payment'], ['/cp/ccfl/scheduled', 'Scheduled Payments'], ['/cp/ccfl/history', 'Payment History'], ['/cp/ccfl/bills', 'Bill History'], null, ['/cp/ccfl/autopay', 'Automatic Payments'], ['/cp/ccfl/paperless', 'Paperless Billing & Notifications'], ['/cp/ccfl/wallet', 'My Wallet (Payment Methods)'], ['/cp/ccfl/add-account', 'Add Account'], ['/cp/ccfl/profile', 'My Profile']];
function portal(title, body) {
  document.title = title + ' | Charlotte County Utilities Online Payments';
  const current = '/' + path.split('/').slice(1, 4).join('/');
  root.innerHTML = `<div class="layout"><nav class="portal-nav" aria-label="Customer portal">${NAV.map(item => item ? `<a href="${item[0]}"${item[0] === current ? ' aria-current="page"' : ''}>${esc(item[1])}</a>` : '<h2>Setup</h2>').join('')}<button type="button" class="secondary" id="ccu-logout">Log Out</button></nav><section class="card"><h1>${esc(title)}</h1>${body}</section></div>`;
  root.querySelector('#ccu-logout').addEventListener('click', async () => { await api('logout', {}); location.href = '/cp/ccfl'; });
}
const methodOptions = (wallet, selected) => wallet.map(m => `<option value="${esc(m.id)}"${m.id === selected ? ' selected' : ''}>${esc(m.label)}${m.expiry ? ' (exp ' + esc(m.expiry) + ')' : ''}</option>`).join('');
const field = (name, label, attrs = '') => `<label for="${name}">${esc(label)}</label><input id="${name}" name="${name}" ${attrs}>`;
function instrumentFields(prefix = '') {
  return `<div data-instrument="bank">${field('name', 'Name on bank account', 'autocomplete="name"')}<label for="accountType">Account type</label><select id="accountType" name="accountType"><option>Checking</option><option>Savings</option></select>${field('routing', 'Routing number (9 digits)', 'inputmode="numeric" autocomplete="off"')}${field('accountNumber', 'Bank account number', 'inputmode="numeric" autocomplete="off"')}${field('confirmAccountNumber', 'Confirm bank account number', 'inputmode="numeric" autocomplete="off"')}</div>
  <div data-instrument="card">${field('cardName', 'Name on card', 'autocomplete="cc-name"')}${field('cardNumber', 'Card number (Visa, Mastercard or Discover)', 'inputmode="numeric" autocomplete="off"')}${field('expiry', 'Expiration date (MM/YY)', 'placeholder="MM/YY" autocomplete="off"')}${field('cvv', 'Security code (CVV)', 'inputmode="numeric" autocomplete="off"')}</div>`;
}
const WALLET_OPTIONS = '<optgroup label="Digital wallets (documented; not simulated here)"><option value="paypal" disabled>PayPal - not available in this simulation</option><option value="paypalcredit" disabled>PayPal Credit - not available in this simulation</option><option value="venmo" disabled>Venmo - not available in this simulation</option><option value="applepay" disabled>Apple Pay - not available in this simulation</option><option value="googlepay" disabled>Google Pay - not available in this simulation</option></optgroup>';
function wireInstrument(select, policy) {
  const fee = root.querySelector('#ccu-fee');
  const update = () => {
    const v = select.value, kind = v.startsWith('saved:') ? select.selectedOptions[0].dataset.kind : v;
    for (const section of root.querySelectorAll('[data-instrument]')) { const active = section.dataset.instrument === v; section.hidden = !active; for (const input of section.querySelectorAll('input,select')) input.disabled = !active; }
    const save = root.querySelector('#ccu-save'); if (save) save.hidden = v.startsWith('saved:');
    if (fee) fee.textContent = kind ? `Convenience fee for this method: ${money(policy.fees[kind])} (charged by Paymentus; not paid to Charlotte County Utilities).` : '';
  };
  select.addEventListener('change', update); update();
}
function instrumentInput(input) {
  if (input.method === 'card') return {method: 'card', name: input.cardName, cardNumber: (input.cardNumber || '').replace(/\s/g, ''), expiry: input.expiry, cvv: input.cvv};
  if (input.method === 'bank') return {method: 'bank', name: input.name, accountType: input.accountType, routing: input.routing, accountNumber: input.accountNumber, confirmAccountNumber: input.confirmAccountNumber};
  return {method: input.method};
}
const reviewList = q => `<dl class="grid"><dt>Account number</dt><dd>${esc(q.accountNumber)}</dd><dt>Service address</dt><dd>${esc(q.serviceAddress)}</dd><dt>Bill</dt><dd>${esc(q.invoiceNumber)} (due ${esc(shortDate(q.dueDate))})</dd><dt>Payment amount</dt><dd>${money(q.amountCents)}</dd><dt>Convenience fee</dt><dd>${money(q.feeCents)}</dd><dt>Total charged</dt><dd id="ccu-total">${money(q.totalCents)}</dd><dt>Payment method</dt><dd>${esc(q.method.label)}</dd><dt>Payment date</dt><dd>${q.scheduled ? esc(longDate(q.date)) + ' (scheduled)' : 'Today'}</dd>${q.postingDate ? `<dt>Expected posting date</dt><dd>${esc(longDate(q.postingDate))}</dd>` : ''}</dl>`;

const pages = {
  '/cp/ccfl': async () => {
    const session = await api('session');
    if (session.profile) { location.replace('/cp/ccfl/accounts'); return; }
    root.innerHTML = `<div class="split"><section class="card"><h1>Log In</h1><form id="ccu-login">${field('email', 'Email', 'type="email" autocomplete="username" required')}${field('password', 'Password', 'type="password" autocomplete="current-password" required')}${errorBox}<div class="actions"><button type="submit">Log In</button><a href="/cp/ccfl/recover">Forgot your password?</a></div></form><p>New to online payments? <a href="/cp/ccfl/register">Register Now</a></p></section>
    <section class="card"><h2>Pay Without Registering</h2><p>Make a one-time payment with your account number and service address ZIP code. No enrollment required.</p><p><a href="/cp/ccfl/quickpay">Pay Without Registering</a></p>
    <div class="notice"><strong>Previously enrolled in eBill?</strong> To protect customer information, Charlotte County Utilities did not transfer profiles from the previous eBill (Billtrust) system. Please register again.</div>
    <p>Convenience fees charged by Paymentus (not paid to the County): ACH bank payment $1.00; debit/credit card (Visa, Mastercard, Discover) and digital wallets $2.95. <a href="/cp/ccfl/help">Fees and posting times</a></p>
    <p>Facing an urgent disconnection notice? Call 941.764.4300 when making your payment.</p></section></div>`;
    document.title = 'Log In | Charlotte County Utilities Online Payments';
    bind('#ccu-login', async (form, input) => { await api('login', {email: input.email, password: input.password}); location.href = '/cp/ccfl/accounts'; });
  },
  '/cp/ccfl/help': async () => {
    page('Fees and Posting Times', `<p>Source: Charlotte County Utilities "Water Bill Payment Options" chart and Pay My Utility Bill page.</p><table><thead><tr><th scope="col">Channel</th><th scope="col">Posting time</th><th scope="col">Fee</th><th scope="col">Methods</th></tr></thead><tbody>
    <tr><td>Online, signed in</td><td>Same business day if paid before 8 p.m.; otherwise next business day</td><td>ACH $1.00; card $2.95</td><td>ACH, debit, credit (Visa, Mastercard, Discover)</td></tr>
    <tr><td>Pay Without Registering</td><td>Same business day if paid before 8 p.m.; otherwise next business day</td><td>ACH $1.00; card or digital wallet $2.95</td><td>ACH, debit, credit, digital wallets</td></tr>
    <tr><td>Telephone (IVR 833-615-0490)</td><td>Same business day if paid before 8 p.m.</td><td>ACH $1.00; card $2.95</td><td>ACH, debit, credit</td></tr>
    <tr><td>AutoPay</td><td>On the bill due date (simulated timing)</td><td>ACH $1.00; card $2.95 per payment</td><td>Saved bank account or card</td></tr>
    <tr><td>Mail / drop box / in person</td><td>See county website</td><td>No fee (cash, check, money order)</td><td>Not available online</td></tr></tbody></table>
    <p class="notice">Digital wallets (PayPal, PayPal Credit, Venmo, Apple Pay, Google Pay) and retail cash payments are documented by the County but are not simulated in this environment. Bank-to-bank bill pay from your own bank is different from ACH through Paymentus.</p><p><a href="/cp/ccfl">Back to Log In</a></p>`);
  },
  '/cp/ccfl/register': async () => {
    page('Create Your Profile', `<p class="notice">Returning eBill customers must register again; previous eBill (Billtrust) logins were not transferred.</p><form id="ccu-register">${field('email', 'Email address', 'type="email" autocomplete="email" required')}${field('confirmEmail', 'Confirm email address', 'type="email" autocomplete="email" required')}${field('password', 'Password (8–32 characters with a letter and a number)', 'type="password" autocomplete="new-password" required')}${field('confirmPassword', 'Confirm password', 'type="password" autocomplete="new-password" required')}${field('firstName', 'First name', 'autocomplete="given-name" required')}${field('lastName', 'Last name', 'autocomplete="family-name" required')}${field('phone', 'Phone number (10 digits)', 'type="tel" autocomplete="tel" required')}${field('zip', 'ZIP code', 'inputmode="numeric" autocomplete="postal-code" required')}<label class="choice"><input type="checkbox" name="acceptTerms"> I accept the Terms of Use (simulated terms)</label>${errorBox}<button type="submit">Register</button></form><p><a href="/cp/ccfl">Back to Log In</a></p>`, {narrow: true});
    bind('#ccu-register', async (form, input) => { await api('register', {...input, acceptTerms: checked(form, 'acceptTerms')}); location.href = '/cp/ccfl/add-account'; });
  },
  '/cp/ccfl/recover': async () => {
    page('Forgot Password', `<p>Enter the email address for your profile. We will email you a link to reset your password.</p><form id="ccu-recover">${field('email', 'Email address', 'type="email" autocomplete="username" required')}${errorBox}<p class="status" id="ccu-recover-status" role="status"></p><button type="submit">Send Reset Link</button></form><p><a href="/cp/ccfl">Back to Log In</a> · <a href="/mail">Open Gmail</a></p>`, {narrow: true});
    bind('#ccu-recover', async (form, input) => { const r = await api('recover', input); root.querySelector('#ccu-recover-status').textContent = r.message; });
  },
  '/cp/ccfl/reset': async () => {
    const token = params.get('token') || '';
    const check = await api('reset/check?token=' + encodeURIComponent(token));
    page('Reset Password', `<p>Choose a new password for ${esc(check.email)}.</p><form id="ccu-reset">${field('password', 'New password (8–32 characters with a letter and a number)', 'type="password" autocomplete="new-password" required')}${field('confirmPassword', 'Confirm new password', 'type="password" autocomplete="new-password" required')}${errorBox}<button type="submit">Reset Password</button></form>`, {narrow: true});
    bind('#ccu-reset', async (form, input) => { await api('reset', {token, ...input}); page('Password Changed', '<p class="status" role="status">Your password was changed. Log in with your new password.</p><p><a href="/cp/ccfl">Log In</a></p>', {narrow: true}); });
  },
  '/cp/ccfl/quickpay': async () => {
    page('Pay Without Registering', `<p>Enter the account number exactly as shown on your bill (for example 00000-000000) and the ZIP code of the service address.</p><form id="ccu-guest-lookup">${field('accountNumber', 'Account number', 'autocomplete="off" required')}${field('zip', 'Service address ZIP code', 'inputmode="numeric" autocomplete="off" required')}${errorBox}<button type="submit">Find My Account</button></form><p><a href="/cp/ccfl">Back to Log In</a></p>`, {narrow: true});
    bind('#ccu-guest-lookup', async (form, input) => { await api('guest/lookup', input); location.href = '/cp/ccfl/quickpay/pay'; });
  },
  '/cp/ccfl/quickpay/pay': async () => {
    const a = await api('guest/account');
    page('Payment Details', `<dl class="grid"><dt>Account number</dt><dd>${esc(a.accountNumber)}</dd><dt>Name</dt><dd>${esc(a.name)}</dd><dt>Service address</dt><dd>${esc(a.serviceAddress)}</dd><dt>Amount due</dt><dd id="ccu-guest-balance">${money(a.balanceCents)}</dd><dt>Due date</dt><dd>${esc(shortDate(a.dueDate))}</dd></dl>
    ${a.balanceCents > 0 ? `<form id="ccu-guest-pay">${field('amount', 'Payment amount ($)', `inputmode="decimal" value="${(a.balanceCents / 100).toFixed(2)}" required`)}<label for="method">Payment method</label><select id="method" name="method"><option value="bank">Bank account (ACH) - $1.00 fee</option><option value="card">Debit or credit card - $2.95 fee</option>${WALLET_OPTIONS}</select><p id="ccu-fee"></p>${instrumentFields()}${field('email', 'Email for receipt (optional)', 'type="email" autocomplete="email"')}${errorBox}<button type="submit">Continue</button></form>` : '<p>No balance is due on this account.</p>'}
    <p>Payments made before 8 p.m. Eastern on a business day post the same day; otherwise they post the next business day (expected: ${esc(longDate(a.postingPreview))}).</p><p><a href="/cp/ccfl/quickpay">Look up a different account</a></p>`, {narrow: true});
    if (a.balanceCents <= 0) return;
    wireInstrument(root.querySelector('#method'), a.policy);
    bind('#ccu-guest-pay', async (form, input) => { await api('guest/quote', {amount: input.amount, email: input.email, ...instrumentInput(input)}); location.href = '/cp/ccfl/quickpay/review'; });
  },
  '/cp/ccfl/quickpay/review': async () => {
    const q = await api('guest/review'); if (q.committed) { location.replace('/cp/ccfl/quickpay/receipt'); return; }
    page('Review Payment', `${reviewList(q)}${q.email ? `<p>Receipt email: ${esc(q.email)}</p>` : ''}<form id="ccu-guest-confirm"><label class="choice"><input type="checkbox" name="authorize"> I authorize Paymentus to charge the total shown, including the convenience fee, for this one-time payment.</label>${errorBox}<div class="actions"><button type="submit">Submit Payment</button><a href="/cp/ccfl/quickpay/pay">Edit payment</a></div></form>`, {narrow: true});
    bind('#ccu-guest-confirm', async form => { await api('guest/pay', {authorize: checked(form, 'authorize')}); location.href = '/cp/ccfl/quickpay/receipt'; });
  },
  '/cp/ccfl/quickpay/receipt': async () => {
    const {payment: p} = await api('guest/receipt');
    page('Payment Confirmation', `<p class="status" role="status">Thank you. Your payment was submitted.</p><dl class="grid"><dt>Confirmation number</dt><dd id="ccu-confirmation">${esc(p.confirmation)}</dd><dt>Account number</dt><dd>${esc(p.accountNumber)}</dd><dt>Payment amount</dt><dd>${money(p.amountCents)}</dd><dt>Convenience fee</dt><dd>${money(p.feeCents)}</dd><dt>Total charged</dt><dd>${money(p.totalCents)}</dd><dt>Payment method</dt><dd>${esc(p.method.label)}</dd><dt>Status</dt><dd>Pending - expected to post ${esc(longDate(p.postingDate))}</dd></dl><p><a href="/cp/ccfl">Done</a></p>`, {narrow: true});
  },
  '/cp/ccfl/accounts': async () => {
    const v = await api('accounts');
    portal('My Accounts', `<p>Welcome, ${esc(v.profile.firstName)} ${esc(v.profile.lastName)} (${esc(v.profile.email)})</p>${v.accounts.length ? v.accounts.map(a => `<article class="card" data-account-id="${esc(a.accountId)}"><h2>Account ${esc(a.accountNumber)}</h2><p>${esc(a.serviceAddress)}</p><dl class="grid"><dt>Amount due</dt><dd data-amount-due>${money(a.amountDueCents)}</dd><dt>Due date</dt><dd>${a.dueDate ? esc(shortDate(a.dueDate)) : 'No balance due'}</dd>${a.pendingCents ? `<dt>Pending payments</dt><dd>${money(a.pendingCents)}</dd>` : ''}<dt>AutoPay</dt><dd>${a.autopay.enabled ? 'On - ' + esc(a.autopay.method?.label || '') : 'Off'}</dd><dt>Scheduled payments</dt><dd>${a.scheduledCount}</dd><dt>Paperless billing</dt><dd>${a.paperless ? 'On' : 'Off'}</dd></dl><div class="actions">${a.amountDueCents > 0 ? `<a href="/cp/ccfl/pay?accountId=${encodeURIComponent(a.accountId)}">Pay Now</a>` : ''}${a.latestBill ? `<a href="/cp/ccfl/bills?accountId=${encodeURIComponent(a.accountId)}">View Bills</a>` : ''}<a href="/cp/ccfl/history?accountId=${encodeURIComponent(a.accountId)}">Payment History</a><a href="/cp/ccfl/autopay/edit?accountId=${encodeURIComponent(a.accountId)}">AutoPay settings</a></div></article>`).join('') : '<p class="notice">No utility accounts are linked to this profile yet.</p>'}<p><a href="/cp/ccfl/add-account">Add Account</a></p>`);
  },
  '/cp/ccfl/profile': async () => {
    const p = await api('profile');
    portal('My Profile', `<dl class="grid"><dt>Email</dt><dd>${esc(p.email)}</dd><dt>Name</dt><dd>${esc(p.firstName)} ${esc(p.lastName)}</dd><dt>Phone</dt><dd>${esc(p.phone)}</dd><dt>ZIP code</dt><dd>${esc(p.zip)}</dd></dl><p class="notice">Address and name changes for the utility account cannot be made online; contact the Utilities Department at 941.764.4300.</p>`);
  },
  '/cp/ccfl/add-account': async () => {
    await api('profile');
    portal('Add Account', `<p>Enter the information exactly as shown on your Charlotte County Utilities bill.</p><form id="ccu-link">${field('accountNumber', 'Account number (for example 00000-000000)', 'autocomplete="off" required')}${field('streetNumber', 'Service address street number (everything before the first space)', 'autocomplete="off" required')}<label for="paperless">Paperless billing</label><select id="paperless" name="paperless"><option value="false">No - continue mailing paper bills</option><option value="true">Yes - email my bills instead of mailing them</option></select>${errorBox}<button type="submit">Verify</button></form>`);
    bind('#ccu-link', async (form, input) => { await api('link/verify', {accountNumber: input.accountNumber, streetNumber: input.streetNumber, paperless: input.paperless === 'true'}); location.href = '/cp/ccfl/add-account/verify'; });
  },
  '/cp/ccfl/add-account/verify': async () => {
    const r = await api('link/review'); if (r.added) { location.replace('/cp/ccfl/accounts'); return; }
    portal('Verify Account Information', `<p>If this information is correct, select Add Account.</p><dl class="grid"><dt>Account number</dt><dd>${esc(r.accountNumber)}</dd><dt>Name</dt><dd>${esc(r.name)}</dd><dt>Service address</dt><dd>${esc(r.serviceAddress)}</dd><dt>Paperless billing</dt><dd>${r.paperless ? 'Yes' : 'No'}</dd></dl><form id="ccu-link-add"><label class="choice"><input type="checkbox" name="emailNotify"> Email me when a new bill is ready</label><label class="choice"><input type="checkbox" name="authorize"> I agree to the Terms and Conditions (simulated terms; adding an account makes no payment)</label>${errorBox}<div class="actions"><button type="submit">Add Account</button><a href="/cp/ccfl/add-account">Back</a></div></form>`);
    bind('#ccu-link-add', async form => { await api('link/add', {authorize: checked(form, 'authorize'), emailNotify: checked(form, 'emailNotify')}); location.href = '/cp/ccfl/accounts'; });
  },
  '/cp/ccfl/pay': async () => {
    const v = await api('pay/options' + (params.get('accountId') ? '?accountId=' + encodeURIComponent(params.get('accountId')) : ''));
    const inv = v.invoice;
    portal('Make a Payment', `<form id="ccu-pay"><label for="accountId">Account</label><select id="accountId" name="accountId">${v.links.map(l => `<option value="${esc(l.accountId)}"${l.accountId === v.account.accountId ? ' selected' : ''}>${esc(l.accountNumber)}</option>`).join('')}</select>
    <dl class="grid"><dt>Service address</dt><dd>${esc(v.account.serviceAddress)}</dd><dt>Amount due</dt><dd id="ccu-amount-due">${money(v.account.amountDueCents)}</dd><dt>Due date</dt><dd>${inv ? esc(shortDate(inv.dueDate)) : 'No balance due'}</dd></dl>
    ${inv ? `${field('amount', 'Payment amount ($)', `inputmode="decimal" value="${(inv.balanceCents / 100).toFixed(2)}" required`)}${field('date', 'Payment date (YYYY-MM-DD; today or a future date to schedule)', `value="${esc(v.today)}" placeholder="YYYY-MM-DD" autocomplete="off" required`)}
    <label for="method">Payment method</label><select id="method" name="method">${v.wallet.map(m => `<option value="saved:${esc(m.id)}" data-kind="${esc(m.kind)}">My Wallet: ${esc(m.label)}</option>`).join('')}<option value="bank">New bank account (ACH) - $1.00 fee</option><option value="card">New debit or credit card - $2.95 fee</option>${WALLET_OPTIONS}</select><p id="ccu-fee"></p>${instrumentFields()}
    <label class="choice" id="ccu-save"><input type="checkbox" name="saveMethod"> Save this payment method to My Wallet</label>${errorBox}<button type="submit">Continue</button>` : ''}</form>
    <p>Payments made today post ${esc(longDate(v.postingPreview))} (same business day if before 8 p.m. Eastern, otherwise next business day).</p>`);
    root.querySelector('#accountId').addEventListener('change', e => { location.href = '/cp/ccfl/pay?accountId=' + encodeURIComponent(e.target.value); });
    if (!inv) return;
    wireInstrument(root.querySelector('#method'), v.policy);
    bind('#ccu-pay', async (form, input) => { await api('pay/quote', {accountId: input.accountId, amount: input.amount, date: input.date.trim(), saveMethod: checked(form, 'saveMethod'), ...instrumentInput(input)}); location.href = '/cp/ccfl/pay/review'; });
  },
  '/cp/ccfl/pay/review': async () => {
    const q = await api('pay/review'); if (q.committed) { location.replace('/cp/ccfl/pay/receipt'); return; }
    portal(q.scheduled ? 'Review Scheduled Payment' : 'Review Payment', `${reviewList(q)}${q.saveMethod ? '<p>This payment method will be saved to My Wallet.</p>' : ''}<form id="ccu-pay-confirm"><label class="choice"><input type="checkbox" name="authorize"> I authorize Paymentus to charge the total shown, including the convenience fee${q.scheduled ? ', on the scheduled date' : ''}.</label>${errorBox}<div class="actions"><button type="submit">${q.scheduled ? 'Schedule Payment' : 'Submit Payment'}</button><a href="/cp/ccfl/pay?accountId=${encodeURIComponent(q.accountId)}">Edit payment</a></div></form>`);
    bind('#ccu-pay-confirm', async form => { await api('pay/submit', {authorize: checked(form, 'authorize')}); location.href = '/cp/ccfl/pay/receipt'; });
  },
  '/cp/ccfl/pay/receipt': async () => {
    const r = await api('pay/receipt');
    if (r.type === 'scheduled') { const x = r.scheduled; portal('Payment Scheduled', `<p class="status" role="status">Your payment is scheduled.</p><dl class="grid"><dt>Account number</dt><dd>${esc(x.accountNumber)}</dd><dt>Scheduled date</dt><dd id="ccu-scheduled-date">${esc(x.date)}</dd><dt>Payment amount</dt><dd>${money(x.amountCents)}</dd><dt>Convenience fee</dt><dd>${money(x.feeCents)}</dd><dt>Payment method</dt><dd>${esc(x.method.label)}</dd></dl><p><a href="/cp/ccfl/scheduled">View Scheduled Payments</a></p>`); return; }
    const p = r.payment;
    portal('Payment Confirmation', `<p class="status" role="status">Thank you. Your payment was submitted.</p><dl class="grid"><dt>Confirmation number</dt><dd id="ccu-confirmation">${esc(p.confirmation)}</dd><dt>Account number</dt><dd>${esc(p.accountNumber)}</dd><dt>Payment amount</dt><dd>${money(p.amountCents)}</dd><dt>Convenience fee</dt><dd>${money(p.feeCents)}</dd><dt>Total charged</dt><dd>${money(p.totalCents)}</dd><dt>Payment method</dt><dd>${esc(p.method.label)}</dd><dt>Status</dt><dd>Pending - expected to post ${esc(longDate(p.postingDate))}</dd></dl><p><a href="/cp/ccfl/history">Payment History</a></p>`);
  },
  '/cp/ccfl/scheduled': async () => {
    const v = await api('scheduled'), active = v.scheduled.filter(x => x.status === 'scheduled');
    portal('Scheduled Payments', `<p class="notice">Scheduled payments keep the payment method chosen when they were created. If you change your AutoPay or wallet payment method, update future scheduled payments here as well.</p>${v.scheduled.length ? `<table><thead><tr><th scope="col">Date</th><th scope="col">Account</th><th scope="col">Amount</th><th scope="col">Fee</th><th scope="col">Method</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>${v.scheduled.map(x => `<tr data-schedule-id="${esc(x.id)}"><td>${esc(x.date)}</td><td>${esc(x.accountNumber)}</td><td>${money(x.amountCents)}</td><td>${money(x.feeCents)}</td><td>${esc(x.method.label)}</td><td>${esc({scheduled: 'Scheduled', cancelled: 'Cancelled', processed: 'Processed', failed: 'Not processed'}[x.status])}</td><td>${x.status === 'scheduled' ? `<a href="/cp/ccfl/scheduled/edit?id=${encodeURIComponent(x.id)}" aria-label="Edit payment scheduled for ${esc(x.date)}">Edit</a> · <a href="/cp/ccfl/scheduled/cancel?id=${encodeURIComponent(x.id)}" aria-label="Cancel payment scheduled for ${esc(x.date)}">Cancel</a>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}${active.length ? '' : '<p>You have no pending scheduled payments.</p>'}<p><a href="/cp/ccfl/pay">Make or schedule a payment</a></p>`);
  },
  '/cp/ccfl/scheduled/edit': async () => {
    const v = await api('scheduled'), x = v.scheduled.find(y => y.id === params.get('id'));
    if (!x || x.status !== 'scheduled') throw new Error('Scheduled payment not found or no longer editable');
    const ap = v.autopay[x.accountId];
    portal('Edit Scheduled Payment', `<p id="ccu-scheduled-current">Account ${esc(x.accountNumber)}. Currently ${money(x.amountCents)} on ${esc(longDate(x.date))} from ${esc(x.method.label)} (fee ${money(x.feeCents)}).</p>${ap ? `<p class="notice">AutoPay for this account uses ${esc(ap.label)}. This scheduled payment is separate and is not updated automatically.</p>` : ''}<form id="ccu-scheduled-edit">${field('date', 'Payment date (YYYY-MM-DD)', `value="${esc(x.date)}" autocomplete="off" required`)}${field('amount', 'Payment amount ($)', `inputmode="decimal" value="${(x.amountCents / 100).toFixed(2)}" required`)}<label for="methodId">Payment method</label><select id="methodId" name="methodId">${methodOptions(v.wallet, x.method.id)}</select><p>Fee: bank account $1.00; card $2.95.</p>${errorBox}<p class="status" id="ccu-scheduled-status" role="status"></p><div class="actions"><button type="submit">Save Changes</button><a href="/cp/ccfl/scheduled">Back to Scheduled Payments</a></div></form>`);
    bind('#ccu-scheduled-edit', async (form, input) => { const r = await api('scheduled/edit', {id: x.id, date: input.date.trim(), amount: input.amount, methodId: input.methodId}); root.querySelector('#ccu-scheduled-status').textContent = `Saved: ${money(r.amountCents)} on ${r.date} from ${r.method.label} (fee ${money(r.feeCents)}).`; const cur = root.querySelector('#ccu-scheduled-current'); if (cur) cur.textContent = `Account ${x.accountNumber}. Currently ${money(r.amountCents)} on ${longDate(r.date)} from ${r.method.label} (fee ${money(r.feeCents)}).`; });
  },
  '/cp/ccfl/scheduled/cancel': async () => {
    const v = await api('scheduled'), x = v.scheduled.find(y => y.id === params.get('id'));
    if (!x || x.status !== 'scheduled') throw new Error('Scheduled payment not found or no longer pending');
    portal('Cancel Scheduled Payment', `<dl class="grid"><dt>Account</dt><dd>${esc(x.accountNumber)}</dd><dt>Date</dt><dd>${esc(longDate(x.date))}</dd><dt>Amount</dt><dd>${money(x.amountCents)}</dd><dt>Method</dt><dd>${esc(x.method.label)}</dd></dl><form id="ccu-scheduled-cancel"><label class="choice"><input type="checkbox" name="confirm"> Yes, cancel this scheduled payment</label>${errorBox}<div class="actions"><button type="submit">Cancel Payment</button><a href="/cp/ccfl/scheduled">Keep this payment</a></div></form>`);
    bind('#ccu-scheduled-cancel', async form => { await api('scheduled/cancel', {id: x.id, confirm: checked(form, 'confirm')}); location.href = '/cp/ccfl/scheduled'; });
  },
  '/cp/ccfl/autopay': async () => {
    const v = await api('autopay');
    portal('Automatic Payments', `<p>Setup &gt; Automatic Payments. AutoPay pays the account balance on each bill due date. Convenience fee per automatic payment: bank account (ACH) $1.00; debit/credit card $2.95.</p>${v.accounts.map(a => `<article class="card" data-account-id="${esc(a.accountId)}"><h2>Account ${esc(a.accountNumber)}</h2><p>${esc(a.serviceAddress)}</p><p data-autopay-status>${a.enabled ? `AutoPay is ON using ${esc(a.method?.label || 'a payment method')} (fee ${money(a.feeCents)} per payment)` : 'AutoPay is OFF'}</p>${a.managedByOtherProfile ? '<p>AutoPay for this account is managed by another profile.</p>' : `<a href="/cp/ccfl/autopay/edit?accountId=${encodeURIComponent(a.accountId)}">${a.enabled ? 'Change or cancel AutoPay' : 'Set up AutoPay'} for account ${esc(a.accountNumber)}</a>`}</article>`).join('') || '<p>Add an account first.</p>'}`);
  },
  '/cp/ccfl/autopay/edit': async () => {
    const v = await api('autopay'), a = v.accounts.find(x => x.accountId === params.get('accountId'));
    if (!a) throw new Error('Linked account not found');
    portal(a.enabled ? 'Change Automatic Payments' : 'Set Up Automatic Payments', `<p>Account ${esc(a.accountNumber)} - ${a.enabled ? `currently ON using ${esc(a.method?.label)}` : 'currently OFF'}.</p>${v.wallet.length ? '' : '<p class="warn">Add a payment method in My Wallet before setting up AutoPay.</p>'}<form id="ccu-autopay"><label for="action">Action</label><select id="action" name="action"><option value="enroll">${a.enabled ? 'Change AutoPay payment method' : 'Enroll in AutoPay'}</option>${a.enabled ? '<option value="cancel">Cancel AutoPay</option>' : ''}</select><label for="methodId">Pay from (My Wallet)</label><select id="methodId" name="methodId">${methodOptions(v.wallet, a.method?.id)}</select>${errorBox}<div class="actions"><button type="submit">Continue</button><a href="/cp/ccfl/wallet/add">Add a payment method</a></div></form>`);
    const action = root.querySelector('#action'), method = root.querySelector('#methodId'); const sync = () => { method.disabled = action.value === 'cancel'; }; action.addEventListener('change', sync); sync();
    bind('#ccu-autopay', async (form, input) => { await api('autopay/quote', {accountId: a.accountId, enabled: input.action !== 'cancel', methodId: input.methodId}); location.href = '/cp/ccfl/autopay/review'; });
  },
  '/cp/ccfl/autopay/review': async () => {
    const q = await api('autopay/review'); if (q.applied) { location.replace('/cp/ccfl/autopay/done'); return; }
    const scheduledNote = q.scheduledPayments.length ? `<p class="warn">This account has ${q.scheduledPayments.length} scheduled payment(s): ${q.scheduledPayments.map(x => `${esc(x.date)} ${money(x.amountCents)} from ${esc(x.method.label)}`).join('; ')}. Scheduled payments are not changed by AutoPay; update or cancel them under Scheduled Payments to avoid paying twice.</p>` : '';
    portal('Review Automatic Payments', `<dl class="grid"><dt>Account</dt><dd>${esc(q.accountNumber)}</dd><dt>Change</dt><dd>${q.enabled ? 'Enroll / update AutoPay' : 'Cancel AutoPay'}</dd>${q.enabled ? `<dt>Pay from</dt><dd>${esc(q.method.label)}</dd><dt>Fee per automatic payment</dt><dd>${money(q.feeCents)}</dd><dt>Next payment</dt><dd>On the due date ${q.nextDueDate ? '(' + esc(shortDate(q.nextDueDate)) + ')' : ''}</dd>` : ''}</dl>${scheduledNote}<form id="ccu-autopay-confirm">${q.enabled ? `<label class="choice"><input type="checkbox" name="acknowledgeFee"> I understand Paymentus charges a ${money(q.feeCents)} convenience fee for each automatic payment.</label>` : ''}<label class="choice"><input type="checkbox" name="authorize"> I authorize this AutoPay ${q.enabled ? 'enrollment' : 'cancellation'}.</label>${errorBox}<div class="actions"><button type="submit">Confirm</button><a href="/cp/ccfl/autopay">Back</a></div></form>`);
    bind('#ccu-autopay-confirm', async form => { await api('autopay/confirm', {authorize: checked(form, 'authorize'), acknowledgeFee: checked(form, 'acknowledgeFee')}); location.href = '/cp/ccfl/autopay/done'; });
  },
  '/cp/ccfl/autopay/done': async () => {
    const q = await api('autopay/review');
    portal('Automatic Payments Updated', `<p class="status" role="status">AutoPay ${q.enabled ? `is ON for account ${esc(q.accountNumber)} using ${esc(q.method.label)}` : `was cancelled for account ${esc(q.accountNumber)}`}. No payment was made today.</p>${q.scheduledPayments.length ? '<p class="warn">You still have scheduled payments for this account. They keep their own payment method.</p>' : ''}<p><a href="/cp/ccfl/autopay">View Automatic Payments</a></p>`);
  },
  '/cp/ccfl/paperless': async () => {
    const v = await api('paperless');
    portal('Paperless Billing & Notifications', `<p>Bills and alerts are sent to ${esc(v.email)}.</p>${v.accounts.map(a => `<form class="card" data-account-id="${esc(a.accountId)}" id="ccu-paperless-${esc(a.accountId)}"><h2>Account ${esc(a.accountNumber)}</h2><label class="choice"><input type="checkbox" name="paperless"${a.paperless ? ' checked' : ''}> Paperless billing (stop paper bills for account ${esc(a.accountNumber)})</label><label class="choice"><input type="checkbox" name="emailNotify"${a.emailNotify ? ' checked' : ''}> Email me when a new bill is ready</label><label class="choice"><input type="checkbox" name="smsNotify"${a.smsNotify ? ' checked' : ''}> Text me when a new bill is ready</label>${field('mobile-' + a.accountId, 'Mobile number for text alerts (10 digits)', `name="mobile" type="tel" value="${esc(a.mobile)}"`).replace(`name="mobile-${a.accountId}" `, '')}${errorBox}<p class="status" role="status"></p><button type="submit">Save Preferences</button></form>`).join('')}`);
    for (const form of root.querySelectorAll('form[data-account-id]')) form.addEventListener('submit', async event => {
      event.preventDefault(); const error = form.querySelector('.error'), status = form.querySelector('.status'); error.textContent = ''; status.textContent = '';
      try { await api('paperless', {accountId: form.dataset.accountId, paperless: checked(form, 'paperless'), emailNotify: checked(form, 'emailNotify'), smsNotify: checked(form, 'smsNotify'), mobile: form.querySelector('[name=mobile]').value}); status.textContent = 'Preferences saved.'; } catch (e) { error.textContent = e.message; }
    });
  },
  '/cp/ccfl/wallet': async () => {
    const v = await api('wallet'), usage = Object.fromEntries(v.usage.map(u => [u.id, u]));
    portal('My Wallet', `${v.wallet.length ? `<table><thead><tr><th scope="col">Payment method</th><th scope="col">Name</th><th scope="col">Used for</th><th scope="col">Actions</th></tr></thead><tbody>${v.wallet.map(m => `<tr data-method-id="${esc(m.id)}"><td>${esc(m.label)}${m.expiry ? ' (exp ' + esc(m.expiry) + ')' : ''}</td><td>${esc(m.name)}</td><td>${[usage[m.id]?.autopay ? 'AutoPay' : '', usage[m.id]?.scheduled ? 'Scheduled payment' : ''].filter(Boolean).join(', ') || '-'}</td><td><a href="/cp/ccfl/wallet/remove?id=${encodeURIComponent(m.id)}" aria-label="Remove ${esc(m.label)}">Remove</a></td></tr>`).join('')}</tbody></table>` : '<p>No saved payment methods.</p>'}<p><a href="/cp/ccfl/wallet/add">Add Payment Method</a></p>`);
  },
  '/cp/ccfl/wallet/add': async () => {
    await api('wallet');
    portal('Add Payment Method', `<form id="ccu-wallet-add"><label for="method">Type</label><select id="method" name="method"><option value="bank">Bank account (ACH)</option><option value="card">Debit or credit card</option></select>${instrumentFields()}${errorBox}<div class="actions"><button type="submit">Save Payment Method</button><a href="/cp/ccfl/wallet">Cancel</a></div></form>`);
    wireInstrument(root.querySelector('#method'), {fees: {bank: 100, card: 295}});
    bind('#ccu-wallet-add', async (form, input) => { const i = instrumentInput(input); await api('wallet/add', {...i, kind: i.method}); location.href = '/cp/ccfl/wallet'; });
  },
  '/cp/ccfl/wallet/remove': async () => {
    const v = await api('wallet'), m = v.wallet.find(x => x.id === params.get('id')); if (!m) throw new Error('Payment method not found');
    portal('Remove Payment Method', `<p>Remove ${esc(m.label)} from My Wallet?</p><p class="notice">Scheduled payments that use this method keep their saved payment details. AutoPay must be changed before its method can be removed.</p><form id="ccu-wallet-remove"><label class="choice"><input type="checkbox" name="confirm"> Yes, remove this payment method</label>${errorBox}<div class="actions"><button type="submit">Remove</button><a href="/cp/ccfl/wallet">Cancel</a></div></form>`);
    bind('#ccu-wallet-remove', async form => { await api('wallet/remove', {methodId: m.id, confirm: checked(form, 'confirm')}); location.href = '/cp/ccfl/wallet'; });
  },
  '/cp/ccfl/history': async () => {
    const v = await api('history' + (params.get('accountId') ? '?accountId=' + encodeURIComponent(params.get('accountId')) : ''));
    portal('Payment History', v.payments.length ? `<table><thead><tr><th scope="col">Submitted</th><th scope="col">Confirmation number</th><th scope="col">Account</th><th scope="col">Amount</th><th scope="col">Fee</th><th scope="col">Method</th><th scope="col">Channel</th><th scope="col">Status</th></tr></thead><tbody>${v.payments.map(p => `<tr data-payment-id="${esc(p.id)}"><td>${esc(p.submittedDate)}</td><td>${esc(p.confirmation)}</td><td>${esc(p.accountNumber)}</td><td>${money(p.amountCents)}</td><td>${money(p.feeCents)}</td><td>${esc(p.method.label)}</td><td>${esc({portal: 'Online', quickpay: 'Pay Without Registering', scheduled: 'Scheduled', autopay: 'AutoPay'}[p.source] || p.source)}</td><td>${esc(p.status === 'pending' ? 'Pending (posts ' + p.postingDate + ')' : p.status === 'posted' ? 'Posted ' + (p.postingDate || '') : 'Failed')}</td></tr>`).join('')}</tbody></table>` : '<p>No payments found.</p>');
  },
  '/cp/ccfl/bills': async () => {
    const v = await api('bills' + (params.get('accountId') ? '?accountId=' + encodeURIComponent(params.get('accountId')) : ''));
    portal('Bill History', v.bills.length ? `<table><thead><tr><th scope="col">Bill date</th><th scope="col">Account</th><th scope="col">Amount</th><th scope="col">Due date</th><th scope="col">Unpaid balance</th><th scope="col">Statement</th></tr></thead><tbody>${v.bills.map(b => `<tr data-invoice-id="${esc(b.invoiceId)}"><td>${esc(b.billDate)}</td><td>${esc(b.accountNumber)}</td><td>${money(b.amountCents)}</td><td>${esc(b.dueDate)}</td><td>${money(b.balanceCents)}</td><td><a href="/api/ccu/statement?invoiceId=${encodeURIComponent(b.invoiceId)}" download="${esc(b.filename)}" data-statement="${esc(b.invoiceId)}" aria-label="View Bill dated ${esc(b.billDate)} (PDF ${esc(b.filename)})">View Bill</a><br><small>${esc(b.filename)}</small></td></tr>`).join('')}</tbody></table><p>Statements are simulated PDFs following the county "How to Read Your Bill" layout.</p>` : '<p>No bills found.</p>');
  }
};

(async () => {
  const handler = pages[path] || pages[path.replace(/\/[^/]+$/, '')];
  try {
    if (!pages[path]) throw new HttpError('This page is not available', 404);
    await handler();
  } catch (e) {
    const login = e.status === 401;
    page(login ? 'Please Log In' : 'Something went wrong', `<p class="error" role="alert">${esc(e.message)}</p><p><a href="/cp/ccfl">${login ? 'Log In' : 'Back to the portal home page'}</a></p>`, {narrow: true});
  }
})();
