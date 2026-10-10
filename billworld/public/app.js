import { renderAuthorityPay } from './authoritypay.js';
import { renderSmartHub } from './smarthub.js';
import { renderDuluth } from './duluth.js';
import { renderXpress } from './xpress.js';
import { renderSpotify, setSpotifyEmail } from './spotify.js';
const app = document.querySelector('#app');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
let auth = null, siteInfo = null, searchResult = null, invoice = null, quote = null, receipt = null, challenge = null, selectedKind = 'bank';
async function api(path, data) {
  const res = await fetch(`/api/${path}`, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await res.json(); if (!res.ok) throw new Error(result.error); return result;
}
const input = (name, label, type = 'text', value = '', attrs = '') => `<label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${escape(value)}" ${attrs}>`;
const panel = content => `<section class="panel">${content}</section>`;
function shell(content, mail = false) {
  document.body.className = mail ? 'mail' : '';
  app.innerHTML = `<header><div class="badge">${mail ? 'Mock mailbox' : 'Billworld simulation'}</div><strong>${mail ? 'Gmail' : 'City and Borough of Juneau'}</strong><nav>${mail ? '<a href="/mail">Inbox</a><a href="/portal">Utilities portal</a>' : '<a href="/">Home</a><a href="/help">Billing FAQs</a><a href="/portal">Water/Sewer payment</a>' + (auth ? '<a href="/portal/account">Your account</a><a href="/portal/history">Payment history</a><a href="/portal/scheduled">Scheduled payments</a><a href="/portal/autopay">AutoPay</a><a href="/portal/logout">Sign out</a>' : '<a href="/portal/login">Sign In</a>') + '<a href="/mail">Email</a>'}</nav></header><main><div id="error" role="alert"></div>${content}</main><footer>Local Billworld simulation. Public flow instructions are documented; private layout, recovery, optional MFA and posting behavior are reconstructed or synthetic.</footer>`;
}
function navigate(path) { if (path.split('?')[0] === '/mail') { location.href = path; return; } history.pushState({}, '', path); render().catch(showError); }
function showError(err) { const node = document.querySelector('#error'); if (node) node.innerHTML = `<p class="error">${escape(err.message)}</p>`; }
function invoicesTable(items) {
  return `<table><thead><tr><th>Select</th><th>Invoice</th><th>Period</th><th>Due</th><th>Unpaid</th><th></th></tr></thead><tbody>${items.map(i => `<tr><td><input type="radio" name="invoice" aria-label="Select invoice ${escape(i.number)}" value="${i.id}" ${i.remainingCents > 0 ? '' : 'disabled'}></td><td>${escape(i.number)}${i.current ? ' (current)' : ''}</td><td>${escape(i.period)}</td><td>${escape(i.dueDate)}</td><td>${money(i.remainingCents)}</td><td><a href="/portal/invoice?id=${i.id}">View Invoice</a></td></tr>`).join('')}</tbody></table>`;
}
let renderRevision = 0, renderedUrl;
async function render() {
  const revision = ++renderRevision, url = location.href;
  renderedUrl = url;
  const isCurrent = () => revision === renderRevision && location.href === url;
  const path = location.pathname;
  try { const session = await api('session'); if (!isCurrent()) return; auth = session.account; siteInfo = session.site; document.title = `${siteInfo.name} · Billworld`; }
  catch { if (!isCurrent()) return; shell('<h1>Start a Billworld episode</h1><p>Use the episode URL supplied by the runner. Each episode has isolated billing and email state.</p>'); return; }
  if(siteInfo.runtime?.frontend==='authoritypay'){await renderAuthorityPay({site:siteInfo,auth,api,app,escape,money,navigate,refresh:render});return;}
  if (siteInfo.id === 'duluth-comfortsystems' && path!=='/mail') { await renderDuluth({auth,api,app,escape,money,navigate,refresh:render}); return; }
  if (siteInfo.id === 'avec-electric'||siteInfo.runtime?.frontend==='smarthub') { await renderSmartHub({ site:siteInfo, auth, api, app, escape, money, refresh: render, isCurrent }); return; }
  if (siteInfo.id === 'homer-utilities') { await renderXpress({ auth, api, app, escape, money, navigate, refresh: render }); return; }
  if (siteInfo.id === 'spotify' && !['/mail', '/portal/forgot', '/portal/reset', '/portal/logout', '/portal/verify'].includes(path)) {
    await renderSpotify({ path, auth, api, app, escape, money, panel, input, navigate }); return;
  }
  if (path === '/') {
    shell('<h1>Utilities Division</h1><p>Water and wastewater services for Juneau.</p><div class="grid">' + panel('<h2>View and pay your bill</h2><p>Search invoices using your customer number, or sign in to manage your account.</p><a class="button" href="/portal">Pay your utility bill</a>') + panel('<h2>Billing and payment information</h2><p>Learn about payment options, convenience fees, and automatic payments.</p><a href="/help">Read billing FAQs</a>') + '</div>'); return;
  }
  if (path === '/help') {
    shell('<h1>Utility billing FAQs</h1>' + panel('<h2>View and pay without registration</h2><p>Choose Water/Sewer, enter your customer number, and select Search Invoices. Select a current invoice and add it to your cart. Review the invoice, choose a payment method, enter payment information, and review before processing payment.</p><a href="/portal">Open Water/Sewer</a><h2>Payment fees</h2><p>EFT/check payments have no convenience fee. Credit/debit card payments have a fee of 3.29% or $2.95, whichever is higher.</p><h2>Register and sign in</h2><p>Registration requires an existing bill. Use your customer number, email and password. Registered users can view invoices, history, and manage AutoPay.</p><h2>AutoPay</h2><p>Automatic payments are initiated on the 20th. Choose a saved payment method and save your AutoPay setup.</p><h2>Simulation limits</h2><p>Cancellation, password recovery, optional email verification and immediate posting are synthetic in this release. Scheduled execution is synthetic; statement PDFs remain to be implemented.</p>')); return;
  }
  if (path === '/portal') {
    document.body.className = 'cloud';
    app.innerHTML = `<header class="cloud-header"><a class="city-brand" href="/"><img src="/reference-assets/juneau-logo.png" alt="City & Borough of Juneau, AK home"></a><nav><a href="/portal/login">Sign In</a><a href="/help">Contact Us</a></nav></header><main class="cloud-layout"><section class="cloud-content"><div class="cloud-intro"><h1>Pay or View Bills</h1><p>Please select an item to get started.</p></div><div class="cloud-options"><a href="/portal/search">Water/Sewer <span>❯</span></a><a href="/portal/unavailable?bill=business-tax">Business Property Taxes <span>❯</span></a><a href="/portal/unavailable?bill=real-tax">Real Property Tax <span>❯</span></a><a href="/portal/unavailable?bill=misc-billing">Miscellaneous Billing <span>❯</span></a><a href="/portal/unavailable?bill=misc-payments">Miscellaneous Payments <span>❯</span></a></div><div class="cloud-description"><p>View and pay your water and sewer bills online.</p><p>No registration is required for One Time Pay. Select Water/Sewer to search your invoices.</p><p>Credit/debit card payments have a service fee of 3.29%, with a minimum fee of $2.95. ACH payments have no service fee.</p></div><section class="cloud-features"><h2>Pay online</h2><div class="grid"><div><h3>Fast and easy</h3><p>Pay online and confirm payment without registering.</p></div><div><h3>Safe and secure</h3><p>Review your invoice and payment details before submitting.</p></div><div><h3>Eco-friendly</h3><p>View your bill online.</p></div></div></section></section><aside><h3>Need Help?</h3><p>For water and sewer billing questions, read the billing FAQs.</p><a href="/help">How does it work?</a><p><a href="/portal/register">Register your account</a></p><p><a href="/mail">Email</a></p></aside></main><footer>Billworld local simulation · InvoiceCloud public landing layout reconstructed from captured evidence. Other bill types remain unimplemented.</footer>`;
    return;
  }
  if (path === '/portal/unavailable') { shell('<h1>Bill type not implemented yet</h1><p>This Billworld slice currently covers water and sewer billing. The source portal also offers other bill types, which remain in the implementation backlog.</p><a href="/portal">Return to bill types</a>'); return; }
  if (path === '/portal/login') {
    shell('<h1>Sign In</h1>' + panel(`<form data-action="login">${input('email', 'Email address', 'email', '', 'required autocomplete="username"')}${input('password', 'Password', 'password', '', 'required autocomplete="current-password"')}<button>Sign In</button></form><p><a href="/portal/forgot">Forgot your password?</a> · <a href="/portal/register">Register Now</a></p>`)); return;
  }
  if (path === '/portal/verify') {
    shell('<h1>Verify your sign-in</h1>' + panel(`<p>A verification code was sent to your email. Use the newest message.</p><form data-action="verify">${input('code', 'Verification code', 'text', '', 'required pattern="[0-9]{6}" autocomplete="one-time-code"')}<button>Verify</button></form><p><a href="/mail">Open email</a> · <a href="/portal/login">Request another code by signing in again</a></p>`)); return;
  }
  if (path === '/portal/register') {
    shell('<h1>Register your account</h1>' + panel(`<p>You need a customer number from an existing bill.</p><form data-action="register">${input('customerNumber', 'Customer number', 'text', '', 'required')}${input('email', 'Email address', 'email', '', 'required')}${input('confirmEmail', 'Confirm email address', 'email', '', 'required')}${input('password', 'Password', 'password', '', 'required minlength="10" maxlength="128"')}${input('confirmPassword', 'Confirm password', 'password', '', 'required')}<button>Complete Registration</button></form>`)); return;
  }
  if (path === '/portal/forgot') {
    shell('<h1>Reset your password</h1>' + panel(`<form data-action="forgot">${input('email', 'Email address', 'email', '', 'required')}<button>Send reset link</button></form><p id="reset-notice"></p><a href="/mail">Open email</a>`)); return;
  }
  if (path === '/portal/reset') {
    shell('<h1>Choose a new password</h1>' + panel(`<form data-action="reset">${input('password', 'New password', 'password', '', 'required minlength="10" maxlength="128"')}${input('confirmPassword', 'Confirm new password', 'password', '', 'required')}<button>Save new password</button></form>`)); return;
  }
  if (path === '/portal/logout') { await api('logout', {}); auth = null; navigate('/portal/login'); return; }
  if (path === '/portal/search') {
    shell('<h1>Search Invoices</h1>' + panel(`<form data-action="search">${input('customerNumber', 'Customer number', 'text', '', 'required')}<button>Search Invoices</button></form>`)); return;
  }
  if (path === '/portal/results') {
    if (!searchResult) return navigate('/portal/search');
    shell('<h1>Search Results</h1>' + panel(`<p>Customer ${escape(searchResult.account.customerNumber)} · ${escape(searchResult.account.name)}</p><form data-action="select">${invoicesTable(searchResult.invoices)}<button>Add Selected Invoices to Your Cart</button></form>`)); return;
  }
  if (path === '/portal/account' || path === '/portal/history' || path === '/portal/autopay' || path === '/portal/scheduled') {
    if (!auth) return navigate('/portal/login');
    const dashboard = await api('dashboard'); searchResult = { account: dashboard.account, invoices: dashboard.invoices };
    if (path === '/portal/account') shell('<h1>Your Account At A Glance</h1>' + panel(`<p>${escape(auth.name)} · Customer ${escape(auth.customerNumber)}</p><form data-action="select">${invoicesTable(dashboard.invoices)}<button>Add Selected Invoices to Your Cart</button></form><p><a href="/portal/history">Payment history</a> · <a href="/portal/autopay">AutoPay settings</a></p>`));
    if (path === '/portal/history') shell('<h1>Payment history</h1>' + panel(`<table><thead><tr><th>Confirmation</th><th>Amount</th><th>Fee</th><th>Status</th></tr></thead><tbody>${dashboard.payments.map(p => `<tr><td>${escape(p.confirmation)}</td><td>${money(p.amountCents)}</td><td>${money(p.feeCents)}</td><td>${escape(p.status)}</td></tr>`).join('')}</tbody></table>`));
    if (path === '/portal/scheduled') shell('<h1>Scheduled payments</h1>' + panel(dashboard.scheduledPayments.length ? dashboard.scheduledPayments.map(p => `<article class="panel"><p>${money(p.amountCents)} · ${escape(p.date)} · ${escape(p.status)} · ${escape(p.method.label)}</p>${p.status === 'scheduled' ? `<form data-action="schedule-edit"><input type="hidden" name="scheduleId" value="${p.id}">${input('date-' + p.id, 'New scheduled date', 'date', p.date)}<button>Save scheduled date</button><button type="button" data-cancel-schedule="${p.id}">Cancel payment</button></form>` : ''}</article>`).join('') : '<p>No scheduled payments.</p>'));
    if (path === '/portal/autopay') shell('<h1>AutoPay</h1>' + panel(`<p>Current setting: <strong>${auth.autopay.enabled ? 'Enabled' : 'Disabled'}</strong>. Payments begin on the 20th of each month.</p><form data-action="autopay"><label for="methodId">Payment method</label><select id="methodId" name="methodId">${auth.methods.map(m => `<option value="${m.id}" ${m.id === auth.autopay.methodId ? 'selected' : ''}>${escape(m.label)}${m.kind === 'card' ? ' (convenience fee applies)' : ' (no fee)'}</option>`).join('')}</select><label><input type="radio" name="enabled" value="yes" ${auth.autopay.enabled ? 'checked' : ''}> Yes, enable AutoPay</label><label><input type="radio" name="enabled" value="no" ${!auth.autopay.enabled ? 'checked' : ''}> No, disable AutoPay</label><button>Save this AutoPay Setup</button></form><p id="autopay-notice"></p>`));
    return;
  }
  if (path === '/portal/invoice') {
    if (!searchResult) return navigate('/portal/search');
    const i = searchResult.invoices.find(i => i.id === new URLSearchParams(location.search).get('id'));
    if (!i) throw new Error('Invoice not found');
    shell('<h1>View Invoice</h1>' + panel(`<h2>Water and sewer statement</h2><p>Invoice ${escape(i.number)} · ${escape(i.period)}</p><p>Due ${escape(i.dueDate)}</p><p class="total">Unpaid ${money(i.remainingCents)}</p><a href="${auth ? '/portal/account' : '/portal/results'}">Back to invoices</a>`)); return;
  }
  if (path === '/portal/cart') {
    if (!invoice) return navigate(auth ? '/portal/account' : '/portal/search');
    shell('<h1>Review your selection</h1>' + panel(`<p>Invoice ${escape(invoice.number)}</p><p class="total">${money(invoice.remainingCents)}</p><a class="button" href="/portal/method">Proceed to Payment</a>`)); return;
  }
  if (path === '/portal/method') {
    if (!invoice) return navigate(auth ? '/portal/account' : '/portal/search');
    shell('<h1>Choose payment method</h1>' + panel(`<form data-action="method"><label for="kind">Payment method</label><select id="kind" name="kind"><option value="bank">EFT (check) — no fee</option><option value="card">Credit/Debit Card — 3.29%, minimum $2.95</option></select><label for="amount">Payment amount</label><input id="amount" name="amount" type="number" step="0.01" min="0.01" max="${invoice.remainingCents / 100}" value="${(invoice.remainingCents / 100).toFixed(2)}" required><button>Continue to Payment Information</button></form>`)); return;
  }
  if (path === '/portal/information') {
    if (!invoice) return navigate('/portal/search');
    const methods = auth?.methods.filter(m => m.kind === selectedKind) || [];
    shell('<h1>Payment Information</h1>' + panel(`<form data-action="quote">${methods.length ? `<label for="methodId">Saved payment method</label><select id="methodId" name="methodId"><option value="">Use a new payment method</option>${methods.map(m => `<option value="${m.id}">${escape(m.label)}</option>`).join('')}</select>` : ''}${input('name', 'Account holder name')}${selectedKind === 'bank' ? input('routing', 'Routing number') + input('accountNumber', 'Bank account number') : input('cardNumber', 'Card number') + input('expiry', 'Expiration (MM/YY)') + input('cvv', 'Security code')}<button>Continue to Review Payment</button></form>`)); return;
  }
  if (path === '/portal/review') {
    if (!quote) return navigate(auth ? '/portal/account' : '/portal/search');
    shell('<h1>Review Payment</h1>' + panel(`<p>Invoice ${escape(invoice.number)}</p><p>Payment method: ${escape(quote.method.label)}</p><p>Payment: <strong>${money(quote.amountCents)}</strong></p><p>Convenience fee: <strong>${money(quote.feeCents)}</strong></p><p class="total">Total ${money(quote.totalCents)}</p><form data-action="pay"><button class="green">Process Payment</button></form>${auth ? `<form data-action="schedule">${input('date', 'Scheduled payment date', 'date', '', 'required')}<button>Schedule payment</button></form>` : ''}<a href="/portal/method">Change payment details</a>`)); return;
  }
  if (path === '/portal/receipt') {
    if (!receipt) return navigate(auth ? '/portal/history' : '/portal/search');
    shell('<h1>Payment confirmation</h1>' + panel(`<p class="success">Your payment has been ${escape(receipt.status)}.</p><p>Confirmation number: <strong id="confirmation">${escape(receipt.confirmation)}</strong></p><p>Payment ${money(receipt.amountCents)} · Fee ${money(receipt.feeCents)}</p><p>Method ${escape(receipt.method.label)}</p><a href="/portal/search">Search invoices</a>${auth ? ' · <a href="/portal/history">Payment history</a>' : ''}<p>A confirmation has been sent to your account email.</p>`)); return;
  }
  if (path === '/mail') { location.replace('/mail'); return; }
  shell('<h1>Page not found</h1><a href="/">Return home</a>');
}
app.addEventListener('click', async e => {
  const cancelSchedule = e.target.closest('[data-cancel-schedule]');
  if (cancelSchedule) { try { await api('schedule/edit', { scheduleId: cancelSchedule.dataset.cancelSchedule, cancel: true }); await render(); } catch (err) { showError(err); } }
  const google = e.target.closest('[data-google]');
  if (google) { google.disabled = true; try { const result = await api('google/begin', {}); location.href = result.authorizationUrl; } catch (err) { showError(err); google.disabled = false; } }
  const link = e.target.closest('a');
  if (link && new URL(link.href).origin === location.origin) { e.preventDefault(); navigate(new URL(link.href).pathname + new URL(link.href).search); }
});
app.addEventListener('submit', async e => {
  const form = e.target.closest('form[data-action]'); if (!form) return;
  e.preventDefault(); const action = form.dataset.action; const data = Object.fromEntries(new FormData(form));
  const button = form.querySelector('button'); button.disabled = true;
  document.querySelector('#error').innerHTML = '';
  try {
    if (action === 'spotify-email') { setSpotifyEmail(data.email); navigate('/spotify/password'); }
    else if (action === 'spotify-login') { const result = await api('login', data); if (result.challenge) { challenge = result.challenge; navigate('/portal/verify'); } else navigate('/spotify/account'); }
    else if (action === 'spotify-card') { await api('subscription/card', data); navigate('/spotify/payment-methods'); }
    else if (action === 'spotify-cancel') { await api('subscription/cancel', {}); navigate('/spotify/account'); }
    else if (action === 'login') { const result = await api('login', data); if (result.challenge) { challenge = result.challenge; navigate('/portal/verify'); } else navigate('/portal/account'); }
    else if (action === 'verify') { await api('verify', { ...data, challenge }); navigate('/portal/account'); }
    else if (action === 'register') { if (data.email !== data.confirmEmail || data.password !== data.confirmPassword) throw new Error('Email addresses and passwords must match'); await api('register', data); navigate('/portal/account'); }
    else if (action === 'forgot') { const r = await api('reset/request', data); document.querySelector('#reset-notice').textContent = r.message; }
    else if (action === 'reset') { if (data.password !== data.confirmPassword) throw new Error('Passwords must match'); await api('reset/complete', { token: new URLSearchParams(location.search).get('token'), password: data.password }); navigate('/portal/login'); }
    else if (action === 'search') { searchResult = await api(`invoices?customer=${encodeURIComponent(data.customerNumber)}`); navigate('/portal/results'); }
    else if (action === 'select') { invoice = searchResult.invoices.find(i => i.id === data.invoice); if (!invoice) throw new Error('Select an unpaid invoice'); quote = null; navigate('/portal/cart'); }
    else if (action === 'method') { selectedKind = data.kind; invoice.amountCentsToPay = Math.round(Number(data.amount) * 100); navigate('/portal/information'); }
    else if (action === 'quote') { quote = await api('quote', { ...data, kind: selectedKind, invoiceId: invoice.id, customerNumber: searchResult.account.customerNumber, amountCents: invoice.amountCentsToPay }); navigate('/portal/review'); }
    else if (action === 'pay') { const result = await api('pay', { token: quote.token }); if (result.declined) throw new Error(result.message); receipt = result; navigate('/portal/receipt'); }
    else if (action === 'schedule') { await api('schedule', { token: quote.token, date: data.date }); navigate('/portal/scheduled'); }
    else if (action === 'schedule-edit') { await api('schedule/edit', { scheduleId: data.scheduleId, date: data['date-' + data.scheduleId] }); await render(); }
    else if (action === 'autopay') { await api('autopay', { enabled: data.enabled === 'yes', methodId: data.methodId }); await render(); document.querySelector('#autopay-notice').textContent = 'AutoPay settings saved.'; }
  } catch (err) { showError(err); }
  finally { if (button.isConnected) button.disabled = false; }
});
// A fragment traversal can emit both events for one URL. Render it once.
const renderNavigation = () => { if (location.href !== renderedUrl) render().catch(showError); };
window.addEventListener('hashchange', renderNavigation);
window.addEventListener('popstate', renderNavigation);
render().catch(showError);
