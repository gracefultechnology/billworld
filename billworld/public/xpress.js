// Public forms follow captured pages; private screens follow the official guide.
let ctx, preview, selected, review, receipt, payDate = '', chosenMethod = 'bank-1048';
const path = () => location.pathname === '/portal/reset' ? 'reset' : location.pathname === '/' ? 'login' : location.pathname.replace(/^\/xpress\/?/, '') || 'login';
const href = route => `/xpress/${route}`;
const go = route => ctx.navigate(href(route));
const esc = value => ctx.escape(value);
const money = cents => ctx.money(cents);
function field(name, label, type = 'text', value = '', extra = '') { return `<label>${label}<input name="${name}" aria-label="${label}" placeholder="${esc(label)}" type="${type}" value="${esc(value)}" required ${extra}></label>`; }
const form = (action, content, button) => `<form data-action="xpress-${action}">${content}<button>${button}</button></form>`;
const links = `<a href="${href('help')}">Billing help</a> · <a href="/mail">Email</a>`;
function shell(title, content, mode = '') {
  document.body.className = `xpress ${mode}`; document.title = 'Xpress Bill Pay · City of Homer';
  if (!document.querySelector('link[href="/xpress.css"]')) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/xpress.css'; document.head.append(link); }
  ctx.app.innerHTML = `<header class="xpress-header"><a href="${href('login')}"><img src="/reference-assets/xpress-logo.svg" alt="Xpress Bill Pay"></a><nav><a href="${href('login')}">USER LOGIN</a><a href="${href('register')}">SIGN UP</a>${ctx.auth ? `<a href="${href('logout')}">SIGN OUT</a>` : ''}</nav></header>${ctx.auth ? `<nav class="xpress-tabs"><a href="${href('organizations')}">ADD ACCOUNT</a><a href="${href('accounts')}">ACCOUNTS</a><a href="${href('autopay')}">AUTO PAYS</a><a href="${href('history')}">HISTORY</a><a href="${href('scheduled')}">SCHEDULED PAYMENTS</a></nav>` : `<nav class="xpress-tabs">${links}</nav>`}<main><div id="error" role="alert"></div><section class="xpress-panel"><h1>${title}</h1>${content}</section></main><footer>${links}<p>City of Homer Finance · 907-435-3114</p></footer>`;
}
function accountPanel(dashboard) {
  return `<div class="xpress-account"><img src="/reference-assets/homer-logo.png" alt="City of Homer"><div><h2>City of Homer</h2><p>Water/Sewer Utility · Account ${esc(dashboard.account.customerNumber)}</p><p>${esc(dashboard.account.name)}<br>1048 Harbor Way, Homer, AK 99603</p>${ctx.auth ? `<p>Auto Pay: ${dashboard.account.autopay.enabled ? 'On' : 'Off'} · Paperless: ${dashboard.account.paperless ? 'On' : 'Off'}</p>` : ''}</div></div>`;
}
const billingFields = () => field('billingAddress', 'Billing Address', 'text', ctx.auth?.profile?.address || '') + field('billingCity', 'City', 'text', ctx.auth?.profile?.city || '') + field('billingRegion', 'State/Province', 'text', ctx.auth?.profile?.region || '') + field('billingPostalCode', 'ZIP/Postal Code', 'text', ctx.auth?.profile?.postalCode || '') + field('contactPhone', 'Phone', 'tel', ctx.auth?.profile?.phone || '') + field('receiptEmail', 'Receipt Email', 'email', ctx.auth?.email || '');
async function render() {
  const route = path();
  if (route === 'logout') { await ctx.api('logout', {}); selected = review = receipt = preview = null; go('login'); return; }
  if (route === 'verify-email') {
    await ctx.api('xpress/verify-email', { token: new URLSearchParams(location.search).get('token') });
    history.replaceState({}, '', href('verified')); shell('Email Verified', `<p>Your email address has been verified.</p><a class="button" href="${href('login')}">Continue</a>`); return;
  }
  if (route === 'verified') { shell('Email Verified', `<p>Continue to login.</p><a class="button" href="${href('login')}">Continue</a>`); return; }
  if (route === 'login') {
    shell('LOGIN TO PAY YOUR BILLS ONLINE', `<img class="xpress-city" src="/reference-assets/homer-logo.png" alt="City of Homer">${form('login', field('email', 'EMAIL ADDRESS', 'email', '', 'autocomplete="username"') + field('password', 'PASSWORD', 'password', '', 'autocomplete="current-password"'), 'LOGIN')}<p><a href="${href('forgot')}">Forgot Password</a><br><a href="${href('register')}">Create a New Account</a></p><a class="button" href="${href('guest')}">CHECKOUT AS GUEST</a>`, 'xpress-login'); return;
  }
  if (route === 'register') {
    shell('CREATE ACCOUNT', form('register', `<div class="xpress-columns"><div>${field('email', 'EMAIL', 'email')}${field('password', 'CREATE A PASSWORD', 'password', '', 'minlength="8" maxlength="29"')}${field('confirmPassword', 'CONFIRM YOUR PASSWORD', 'password')}</div><aside><p>Please enter a password that:</p><ul><li>is at least 8 characters long</li><li>contains an uppercase and lowercase letter</li><li>contains a number</li><li>is less than 30 characters long</li><li>does not contain three repeated consecutive characters</li></ul></aside></div><hr><label>ACCOUNT TYPE<select name="accountType"><option value="personal">Personal</option><option value="business">Business</option></select></label><div class="xpress-columns">${field('firstName', 'FIRST NAME')}${field('lastName', 'LAST NAME')}${field('phone', 'PHONE', 'tel')}${field('address', 'ADDRESS')}${field('city', 'CITY')}<label>STATE/PROVINCE<select name="region" required><option value="">Choose State</option><option value="AK">Alaska</option></select></label>${field('postalCode', 'ZIP/POSTAL CODE')}</div><h3>Terms and Conditions</h3><p><a href="${href('terms')}">Terms &amp; Conditions</a> and <a href="${href('privacy')}">Privacy Policy</a></p><label class="xpress-check"><input type="checkbox" name="acceptTerms" required>I have read and agree to the Terms &amp; Conditions and Privacy Policy</label>`, 'NEXT')); return;
  }
  if (route === 'pending') { shell('Just One More Step', '<p>Check your inbox for “Verify email address for Xpress Bill Pay” and select Verify Email.</p><a class="button" href="/mail">Open email</a>'); return; }
  if (route === 'forgot') { shell('Forgot Password', form('forgot', field('email', 'EMAIL ADDRESS', 'email'), 'SUBMIT') + '<p id="notice"></p>' + links); return; }
  if (route === 'reset') { shell('Reset Password', form('reset', field('password', 'New Password', 'password', '', 'minlength="8" maxlength="29"') + field('confirmPassword', 'Confirm Password', 'password'), 'Save Password')); return; }
  if (['help', 'terms', 'privacy'].includes(route)) {
    const content = route === 'help' ? `<h2>Register and link your bill</h2><p>Create a personal profile, verify your email, then search for City of Homer. Match your account number and last name, confirm the account, and choose paperless if desired.</p><h2>Make a payment</h2><p>From Accounts choose Make a Payment, review the Bill Cart and proceed to Checkout. Select a saved method or enter bank/card details. Review and Confirm, then Submit Payment. A matching receipt is emailed.</p><h2>Payment options</h2><p>The public guide documents checking/savings, credit/debit cards, future payments and optional AutoPay.</p><h2>Current simulation limits</h2><p>Fees are set to zero for this local fixture because production fees are unverified. Dates, immediate posting and account data are synthetic. SMS, mobile login, business profiles, additional payers, other organizations and statement PDFs are unfinished.</p>` : `<p>This local simulation stores synthetic profile and billing information within your isolated episode. Account changes and payments apply only to the simulator.</p><p>Production legal text has not been reproduced. Captured source terms and privacy documents remain a research gap.</p>`;
    shell(route === 'help' ? 'Billing and Payment Help' : route === 'terms' ? 'Terms and Conditions' : 'Privacy Policy', content); return;
  }
  if (route === 'guest') {
    if (ctx.auth) { await ctx.api('logout', {}); ctx.auth = null; }
    shell('ENTER ACCOUNT INFORMATION', `<img class="xpress-city" src="/reference-assets/homer-logo.png" alt="City of Homer"><h3>Utility</h3>${form('guest', field('customerNumber', 'Account Number') + field('lastName', 'Last Name or Business Name') + '<h2>WHERE TO FIND YOUR ACCOUNT NUMBER</h2><p>Your account number appears on your paper bill. Contact your billing organization if it is unavailable.</p>', 'Search Account')}`, 'xpress-guest'); return;
  }
  const guestRoute = ['guest-bills', 'cart', 'checkout', 'review', 'success'].includes(route);
  if (!ctx.auth && !guestRoute) { go('login'); return; }
  let dashboard;
  if (ctx.auth) dashboard = await ctx.api('dashboard');
  else dashboard = await ctx.api('utility/guest');
  if (ctx.auth && !ctx.auth.billLinked && !['organizations', 'link', 'preview'].includes(route)) { go('organizations'); return; }
  if (route === 'organizations') {
    shell('Add New Account', form('organization', field('organization', 'Find your billing organization', 'search'), 'Search') + '<div id="organizations"></div>'); return;
  }
  if (route === 'link') { shell('Add New Account', '<h2>City of Homer</h2>' + form('lookup', field('customerNumber', 'Account Number') + field('lastName', 'Last Name or Business Name'), 'Locate Account')); return; }
  if (route === 'preview') {
    if (!preview) { go('link'); return; }
    shell('Confirm Account', `<h2>City of Homer</h2><p>Account ${esc(preview.customerNumber)} · ${esc(preview.name)}</p><p>${esc(preview.serviceAddress)}</p>${form('link', '<label class="xpress-check"><input type="checkbox" name="paperless">Sign up for paperless billing</label>', 'Add Account')}`); return;
  }
  if (route === 'linked') { shell('Account Added', `<p>You have successfully added your account!</p><a href="${href('accounts')}">Not Now</a> · <a class="button green" href="${href('autopay')}">Set up Auto Pay</a>`); return; }
  if (['accounts', 'guest-bills'].includes(route)) {
    shell('My Accounts', accountPanel(dashboard) + dashboard.invoices.map(i => `<article class="xpress-bill"><div><h3>${esc(i.period)}</h3><p>Invoice ${esc(i.number)} · Due ${esc(i.dueDate)}</p></div><div><h2>${money(i.remainingCents)}</h2>${i.remainingCents > 0 ? `<button data-invoice="${i.id}" class="green">MAKE A PAYMENT ${money(i.remainingCents)}</button>` : '<p>Paid</p>'}</div></article>`).join('')); return;
  }
  if (route === 'cart') {
    if (!selected) { go(ctx.auth ? 'accounts' : 'guest-bills'); return; }
    shell('Bill Cart', form('cart', `<div class="xpress-columns"><div><h2>City of Homer</h2><p>Account ${esc(dashboard.account.customerNumber)} · Due ${esc(selected.dueDate)}</p>${field('amount', 'Amount', 'number', (selected.remainingCents / 100).toFixed(2), `step="0.01" min="0.01" max="${(selected.remainingCents / 100).toFixed(2)}"`)}</div><div><h3>Cart Summary</h3><p>Total Amount: ${money(selected.remainingCents)}</p>${ctx.auth ? '<label class="xpress-check"><input name="timing" type="radio" value="now" checked>PAY NOW</label><label class="xpress-check"><input name="timing" type="radio" value="later">SCHEDULE PAYMENT ON</label><input name="date" aria-label="Select a Date" type="date">' : '<p>PAY NOW</p>'}</div></div>`, 'Proceed to Checkout')); return;
  }
  if (route === 'checkout') {
    if (!selected) { go(ctx.auth ? 'accounts' : 'guest-bills'); return; }
    const saved = ctx.auth?.methods || [];
    shell('Checkout', form('quote', `<h2>Payment Options</h2><label>Select Pay Method<select name="methodId">${saved.map(m => `<option value="${esc(m.id)}" ${chosenMethod === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}<option value="new-bank" ${chosenMethod === 'new-bank' ? 'selected' : ''}>New Bank Account</option><option value="new-card" ${chosenMethod === 'new-card' ? 'selected' : ''}>New Credit/Debit Card</option></select></label>${chosenMethod.startsWith('new-') || !saved.length ? `<div class="xpress-columns">${field('name', 'Name on Account', 'text', ctx.auth?.name || '')}${chosenMethod === 'new-card' ? field('cardNumber', 'Card Number') + field('expiry', 'Expiration MM/YY') + field('cvv', 'Security Code', 'password') : field('routing', 'Routing Number') + field('accountNumber', 'Account Number') + field('confirmAccountNumber', 'Verify Account Number')}${billingFields()}</div>` : ''}<h3>Payment Details</h3><p>Payment Amount: ${money(selected.amountCents)}</p>`, 'Review and Confirm')); return;
  }
  if (route === 'review') {
    if (!review) { go('checkout'); return; }
    shell('Review and Confirm', `<h2>City of Homer</h2><p>${esc(selected.number)}</p><p>Payment: ${money(review.amountCents)} · Fee: ${money(review.feeCents)} · Total: ${money(review.totalCents)}</p><p>Pay Method: ${esc(review.method.label)}</p><p>Receipt Email: ${esc(dashboard.account.email || 'alex@billworld.test')}</p>${payDate ? `<p>Scheduled Date: ${esc(payDate)}</p>` : ''}${form('pay', '', payDate ? 'Submit Scheduled Payment' : 'Submit Payment')}<a href="${href('checkout')}">Back to Checkout</a>`); return;
  }
  if (route === 'success') {
    if (!receipt) { go(ctx.auth ? 'history' : 'guest-bills'); return; }
    shell('SUCCESS!', `<h2>Your payment was ${esc(receipt.status)}.</h2><p>Confirmation: <strong id="confirmation">${esc(receipt.confirmation)}</strong></p><p>${money(receipt.amountCents)} · ${esc(receipt.method.label)}</p><p>A payment receipt has been sent to your email.</p><button data-print>Print Receipt</button><p><a href="${href(ctx.auth ? 'accounts' : 'guest-bills')}">Back to Bills</a></p>`); return;
  }
  if (route === 'history') { shell('Payment History', `<table><thead><tr><th>Confirmation</th><th>Amount</th><th>Status</th></tr></thead><tbody>${dashboard.payments.map(p => `<tr><td>${esc(p.confirmation)}</td><td>${money(p.amountCents)}</td><td>${esc(p.status)}</td></tr>`).join('')}</tbody></table>`); return; }
  if (route === 'autopay') { shell('Auto Pays', form('autopay', `<label>Auto Pay<select name="enabled"><option value="no" ${ctx.auth.autopay.enabled ? '' : 'selected'}>Off</option><option value="yes" ${ctx.auth.autopay.enabled ? 'selected' : ''}>On</option></select></label><label>Pay Method<select name="methodId">${ctx.auth.methods.map(m => `<option value="${m.id}" ${m.id === ctx.auth.autopay.methodId ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>${field('day', 'Recurring Day', 'number', ctx.auth.autopay.day, 'min="1" max="31"')}`, 'Save Auto Pay') + '<p id="notice"></p>'); return; }
  if (route === 'scheduled') { shell('Scheduled Payments', dashboard.scheduledPayments.length ? dashboard.scheduledPayments.map(p => `<article><p>${money(p.amountCents)} · ${esc(p.date)} · ${esc(p.status)}</p>${p.status === 'scheduled' ? `<form data-action="xpress-edit"><input type="hidden" name="scheduleId" value="${p.id}">${field('date', 'Payment Date', 'date', p.date)}<button>Save Date</button><button type="button" data-cancel="${p.id}">Cancel Payment</button></form>` : ''}</article>`).join('') : '<p>No scheduled payments.</p>'); return; }
  shell('Page unavailable', `<a href="${href('login')}">Return to login</a>`);
}
function showError(error) { const node = document.querySelector('#error'); if (node) node.textContent = error.message; }
export async function renderXpress(context) {
  ctx = context;
  if (!ctx.app.dataset.xpressBound) {
    ctx.app.dataset.xpressBound = 'true';
    ctx.app.addEventListener('click', event => {
      if (!document.body.classList.contains('xpress')) return;
      const link = event.target.closest('a'), button = event.target.closest('button');
      if (link && new URL(link.href).origin === location.origin) { event.preventDefault(); event.stopImmediatePropagation(); ctx.navigate(new URL(link.href).pathname + new URL(link.href).search); }
      else if (button?.dataset.invoice) { event.preventDefault(); event.stopImmediatePropagation(); (async () => { const d = await ctx.api(ctx.auth ? 'dashboard' : 'utility/guest'); selected = d.invoices.find(i => i.id === button.dataset.invoice); chosenMethod = ctx.auth ? 'bank-1048' : 'new-bank'; payDate = ''; go('cart'); })().catch(showError); }
      else if (button?.dataset.cancel) { event.preventDefault(); event.stopImmediatePropagation(); ctx.api('schedule/edit', { scheduleId: button.dataset.cancel, cancel: true }).then(() => ctx.refresh()).catch(showError); }
      else if (button?.hasAttribute('data-print')) { event.preventDefault(); event.stopImmediatePropagation(); window.print(); }
    }, true);
    ctx.app.addEventListener('change', event => { if (document.body.classList.contains('xpress') && event.target.matches('select[name="methodId"]') && path() === 'checkout') { chosenMethod = event.target.value; ctx.refresh().catch(showError); } });
    ctx.app.addEventListener('submit', event => {
      if (!document.body.classList.contains('xpress') || !event.target.dataset.action?.startsWith('xpress-')) return;
      event.preventDefault(); event.stopImmediatePropagation(); const formNode = event.target;
      const data = Object.fromEntries(new FormData(formNode)); const action = formNode.dataset.action.slice(7);
      (async () => {
        if (action === 'login') { await ctx.api('login', data); go('accounts'); }
        else if (action === 'register') { await ctx.api('xpress/register', { ...data, acceptTerms: formNode.elements.acceptTerms.checked }); go('pending'); }
        else if (action === 'forgot') { const r = await ctx.api('reset/request', data); document.querySelector('#notice').textContent = r.message; }
        else if (action === 'reset') { if (data.password !== data.confirmPassword) throw new Error('Passwords must match'); await ctx.api('reset/complete', { password: data.password, token: new URLSearchParams(location.search).get('token') }); go('login'); }
        else if (action === 'organization') { document.querySelector('#organizations').innerHTML = /homer/i.test(data.organization) ? `<a class="xpress-org" href="${href('link')}"><img src="/reference-assets/homer-logo.png" alt=""><span>City of Homer<br>Homer, Alaska</span></a>` : '<p>No matching billing organization in this episode.</p>'; }
        else if (action === 'lookup') { preview = await ctx.api('xpress/account-lookup', data); go('preview'); }
        else if (action === 'link') { await ctx.api('xpress/link-account', { token: preview.token, paperless: formNode.elements.paperless.checked }); preview = null; go('linked'); }
        else if (action === 'guest') { await ctx.api('utility/lookup', data); go('guest-bills'); }
        else if (action === 'cart') { const cents = Math.round(Number(data.amount) * 100); if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('Enter a payment amount'); selected.amountCents = cents; payDate = data.timing === 'later' ? data.date : ''; if (data.timing === 'later' && !payDate) throw new Error('Choose a scheduled date'); go('checkout'); }
        else if (action === 'quote') { const input = { ...data, invoiceId: selected.id, amountCents: selected.amountCents, customerNumber: (await ctx.api(ctx.auth ? 'dashboard' : 'utility/guest')).account.customerNumber }; if (data.methodId.startsWith('new-')) { delete input.methodId; input.kind = data.methodId.slice(4); } review = await ctx.api('quote', input); go('review'); }
        else if (action === 'pay') { if (payDate) { await ctx.api('schedule', { token: review.token, date: payDate }); go('scheduled'); } else { const result = await ctx.api('pay', { token: review.token }); if (result.declined) throw new Error(result.message); receipt = result; go('success'); } }
        else if (action === 'autopay') { await ctx.api('autopay', { enabled: data.enabled === 'yes', methodId: data.methodId, day: Number(data.day) }); await ctx.refresh(); document.querySelector('#notice').textContent = 'Auto Pay saved.'; }
        else if (action === 'edit') { await ctx.api('schedule/edit', { scheduleId: data.scheduleId, date: data.date }); await ctx.refresh(); }
      })().catch(showError);
    }, true);
  }
  try { await render(); } catch (error) { shell('Unable to Continue', `<a href="${href('login')}">Return to login</a>`); showError(error); }
}
