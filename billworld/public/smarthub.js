// SmartHub public screens reconstructed from captures; private screens are synthetic.
let changeToken=sessionStorage.getItem('gvp-password-change')||'',context, lookup, registration, quote, receipt, invoice, challenge, recoveryTab = 'password';
const route = () => location.pathname === '/portal/reset' ? 'reset' : location.hash.replace(/^#\//, '') || 'login';
const href = name => `/smarthub/ui/#/${name}`;
const nav = name => { history.pushState({}, '', href(name)); context.refresh(); };
const form = (action, content, button = 'Continue') => `<form data-action="hub-${action}">${content}<button>${button}</button></form>`;
function field(name, label, type = 'text', value = '', extra = '') {
  return `<label>${label} <span aria-hidden="true">*</span><input name="${name}" aria-label="${label}" type="${type}" value="${context.escape(value)}" required ${extra}></label>`;
}
const identity = email => field('customerNumber', 'Billing Account Number', 'text', '', 'inputmode="numeric" pattern="[0-9]+"') + '<small>Only numbers are allowed.</small>' + field('lastName', 'Last Name or Business Name') + (email ? field('email', 'Email', 'email') : '');
const money = n => context.money(n);
function shell(title, content, narrow = false) {
  const { app, auth } = context;
  document.body.className = title === (context.site?.branding?.title||'Alaska Village SmartHub') ? 'smarthub hub-login' : 'smarthub'; document.title = context.site?.branding?.title||'Alaska Village SmartHub';if(context.site?.id==='gvp-electric'){document.body.classList.add('gvp');if(route()==='paynow')document.body.classList.add('hub-login','hub-guest');}
  if (!document.querySelector('link[href="/smarthub.css"]')) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/smarthub.css'; document.head.append(link); }
  app.innerHTML = `<header class="hub-header"><a href="${href('login')}" class="hub-brand"><img src="${context.site?.branding?.logo||'/reference-assets/avec-logo.png'}" alt="${context.escape(context.site?.branding?.name||'Alaska Village Electric Cooperative')}"></a><h1>${title}</h1></header>${auth ? `<nav class="hub-nav"><a href="${href('home')}">Home</a><a href="${href('makeAPayment')}">Billing &amp; Payments</a><a href="${href('paymentHistory')}">Payment History</a><a href="${href('autoPay')}">Auto Pay</a><a href="${href('scheduled')}">Scheduled Payments</a>${context.site?.id==='gvp-electric'?`<a href="${href('paperless')}">Settings / Paperless Billing</a>`:''}<a href="${href('logout')}">Sign Out</a></nav>` : ''}<main class="${narrow ? 'hub-narrow' : 'hub-wide'}"><div id="error" role="alert"></div>${content}</main><footer>${context.escape(context.site?.branding?.footer||'Alaska Village Electric Cooperative | 4831 Eagle Street, Anchorage, AK 99503 | 907-561-1818')}<br><a href="${href('help')}">Billing and payment help</a> · <a href="/mail">Email</a></footer>`;
}
const err = error => { const box = document.querySelector('#error'); if (box) box.textContent = error.message; };
function gvpPublicPage(path) {
  const login = `<a href="${href('login')}">SmartHub Login</a>`, register = `<a href="${href('registration')}">Create an account</a>`, guest = `<a href="${href('paynow')}">One-time Payment</a>`;
  const navigation = `<nav aria-label="Member Hub"><a href="/">Home</a> · <a href="/ways-pay">Ways to Pay</a> · <a href="/SmartHub">SmartHub</a> · <a href="/paperless">E-Bill (Paperless Billing)</a></nav>`;
  if (path === '/SmartHub') return ['SMARTHUB', navigation + `<p>Manage your account online with SmartHub. Pay bills, review billing information and set up automatic payments.</p><p>${login} · ${register}</p><h2>Register your account on the web</h2><ol><li>Use the numeric account number from your bill, your last name or business name and your email.</li><li>Complete the account verification questions.</li><li>Check your email for a temporary password.</li><li>Sign in with that password and choose a new password.</li></ol><h2>Pay your bill and manage Auto Pay</h2><p>Open Bill &amp; Pay, then Auto Pay Program to enroll. Drafts occur on the 18th or the next business day.</p><p><a href="/ways-pay">Explore payment options</a> · <a href="/paperless">Sign up for paperless billing</a></p>`];
  if (path === '/paperless') return ['E-BILL (PAPERLESS BILLING)', navigation + `<h2>Sign up for paperless billing</h2><p>With E-Bill, printed statements stop and an email tells you when your statement is available. You can continue paying online or using another payment method.</p><p>${login} · ${register}</p><h2>From your account</h2><p>Open Settings, select Paperless Billing, enable Go Paperless and confirm.</p><h2>Earlier web instructions</h2><p>The web guide also describes My Profile, My Information, Update My Paperless Settings, switching OFF to ON and confirming Yes.</p><h2>In the SmartHub app</h2><p>Sign in, open Settings, choose Paperless Billing and switch it ON.</p><p><a href="/ways-pay?tab=ebill">E-Bill payment guidance</a> · <a href="/ways-pay?tab=autopay">Auto Pay</a></p>`];
  const tabs = {
    autopay: ['Auto Pay', `<p>Your bill can be withdrawn automatically from checking, savings or a credit/debit card. You still receive a monthly statement showing the amount.</p><p>Bank drafts qualify for Shared Savings; credit and debit cards do not.</p><ol><li>Sign in to SmartHub.</li><li>Open Bill &amp; Pay.</li><li>Select Auto Pay Program and follow the enrollment steps.</li></ol><p>Drafts occur on the 18th of the month or the next business day.</p><p>${login} · ${register}</p>`],
    online: ['Online', `<p>SmartHub provides account management and billing history. PayNow accepts a one-time payment without an account or login.</p><p>Official SmartHub and PayNow transactions have no additional payment fees. Other bill-payment providers may charge fees or deliver payments late.</p><p>${login} · ${guest}</p>`],
    app: ['By App', '<p>SmartHub is available for Android and iOS phones and tablets, as well as on the web. The app offers payments, account inquiries, usage and notifications.</p><p><a href="/SmartHub">SmartHub account guide</a></p>'],
    phone: ['By Phone', '<p>The automated payment number is 1-855-939-3619. It accepts one-time checking or credit/debit card payments.</p><p>Have your account number or associated phone number and your GVP PIN ready. Bank payments also need the routing and account numbers.</p><p>Phone payments do not set up recurring drafts. Use SmartHub Auto Pay or contact member services at 970-242-0040.</p>'],
    office: ['In Person', '<p>The office is at 845 22 Road, Grand Junction, Colorado 81505, Monday–Friday, 8 a.m.–5 p.m., excluding closures. Cash, checks and major credit cards are accepted.</p>'],
    mail: ['Mail', '<p>Send your payment and bill stub to Grand Valley Power, PO Box 190, Grand Junction, CO 81502-0190. Allow mailing time; choose a faster payment option when the due date is within 2–3 days.</p>'],
    dropbox: ['Drop Box', '<p>Drop boxes are at the office and Grand Valley City Market and Safeway stores, excluding City Market at 12th and Patterson and Safeway in the Redlands.</p><p>Use a check or money order in an envelope with your bill stub and name. Grocery-store deposits are mailed to GVP. To prevent disconnection or meet a near due date, use an immediate payment option.</p>'],
    ebill: ['E-Bill', `<p>Receive a bill notification electronically and review billing information in SmartHub. Enroll through Settings, Paperless Billing, then turn Go Paperless ON.</p><p>${login} · ${register} · <a href="/paperless">Paperless billing guide</a></p>`]
  };
  const selected = new URLSearchParams(location.search).get('tab'), key = Object.hasOwn(tabs, selected) ? selected : 'autopay';
  return ['WAYS TO PAY', navigation + `<nav class="hub-tabs" aria-label="Payment options">${Object.entries(tabs).map(([id,[label]])=>`<a href="/ways-pay?tab=${id}" ${key===id?'aria-current="page"':''}>${label}</a>`).join('')}</nav><section aria-labelledby="payment-option"><h2 id="payment-option">${tabs[key][0]}</h2>${tabs[key][1]}</section><p>To prevent disconnection, use an immediate payment option rather than a drop box.</p>`];
}
export async function renderSmartHub(settings) {
  context = settings; const r = context.site?.id==='gvp-electric'&&['/ways-pay','/SmartHub','/paperless'].includes(location.pathname)?'help':route(), { auth, api, escape: e, isCurrent = () => true } = settings;
  if(context.site?.id==='gvp-electric'&&location.pathname==='/'){shell('Grand Valley Power',`<nav><a href="${href('login')}">SmartHub Login</a> · <a href="${href('paynow')}">One-time Payment</a> · <a href="/ways-pay">Ways to Pay</a> · <a href="/SmartHub">SmartHub guide</a> · <a href="/paperless">Paperless billing</a></nav><h2>Manage My Account</h2><p>View and pay bills, manage automatic payments and enroll in E-Bill.</p><a class="button" href="${href('login')}">SmartHub</a><h2>Payment Options</h2><p>Pay online with checking or a credit/debit card.</p><a href="${href('help')}">Billing and payment information</a>`);return;}
  if(r==='changePassword'){shell('CHANGE PASSWORD',form('first-password',field('password','New Password','password','','minlength="10" maxlength="128"')+field('confirmPassword','Confirm Password','password'),'Save Password'));return;}
  if(r==='registrationSent'){shell('REGISTRATION COMPLETE','<p>Check your email for a temporary password. Sign in with it and choose a new password.</p><a href="/mail">Open email</a> · <a href="'+href('login')+'">Sign In</a>');return;}
  if (r === 'login') {
    shell(context.site?.branding?.title||'Alaska Village SmartHub', form('login', field('email', 'Email', 'email', '', 'autocomplete="username" placeholder="Email"') + '<button type="button" data-show-password>Show Password</button>' + field('password', 'Password', 'password', '', 'autocomplete="current-password" placeholder="Password"'), 'Sign In') + `<p><a href="${href('accountAccess')}">Can’t access your account?</a></p><p>Don't have an account? <a href="${href('registration')}">Register now.</a></p><p><a href="${href('paynow')}">Pay Now</a></p>`, true); return;
  }
  if (r === 'accountAccess') {
    shell('ACCOUNT ACCESS', `<div class="hub-tabs"><button data-recovery-tab="password" ${recoveryTab === 'password' ? 'class="active"' : ''}>Reset Password</button><button data-recovery-tab="email" ${recoveryTab === 'email' ? 'class="active"' : ''}>Recover Registered Email</button></div><p>Required fields marked with an asterisk</p>${form('recover', identity(recoveryTab === 'password'))}<p id="notice" role="status"></p><a href="${href('login')}">Cancel</a>`); return;
  }
  if (r === 'registration') {
    shell('ACCOUNT REGISTRATION', '<p>Required fields marked with an asterisk</p>' + form('registration-start', identity(true) + field('confirmEmail', 'Confirm Email', 'email')) + `<a href="${href('login')}">Cancel</a>`); return;
  }
  if (r === 'registrationVerify') {
    if (!registration) return nav('registration');
    if(context.site?.id==='gvp-electric'){shell('VERIFY ACCOUNT DETAILS',form('registration-finish',field('verificationAmount','Current bill amount','number','','step="0.01" min="0.01"'),'Submit'));return;}
    shell('VERIFY ACCOUNT DETAILS', form('registration-finish', field('ssnLast4', 'Last four digits of Social Security number', 'text', '', 'pattern="[0-9]{4}" inputmode="numeric"') + field('phone', 'Phone number', 'tel') + field('password', 'Password', 'password', '', 'minlength="10" maxlength="128"') + field('confirmPassword', 'Confirm Password', 'password'), 'Register')); return;
  }
  if (r === 'reset') {
    shell('RESET PASSWORD', form('reset', field('password', 'New Password', 'password', '', 'minlength="10" maxlength="128"') + field('confirmPassword', 'Confirm Password', 'password'), 'Save Password')); return;
  }
  if (r === 'twoFactor') {
    shell('VERIFY SIGN IN', '<p>A verification code was sent to your email.</p>' + form('verify', field('code', 'Verification Code', 'text', '', 'pattern="[0-9]{6}"')) + '<a href="/mail">Open email</a>'); return;
  }
  if (r === 'paynow') {
    shell('Welcome to the Pay Now Site', form('lookup', field('customerNumber', 'Account Number', 'text', '', 'inputmode="numeric" placeholder="Account Number"') + field('lastName', 'Last Name or Business Name','text','','placeholder="Last Name or Business Name"'), 'Sign In'), true); return;
  }
  if(r==='help'&&context.site?.id==='gvp-electric'){const [title,content]=gvpPublicPage(['/SmartHub','/paperless'].includes(location.pathname)?location.pathname:'/ways-pay');shell(title,content);return;}
  if (r === 'help') {
    shell('BILLING AND PAYMENT OPTIONS', '<h2>Pay online</h2><p>AVEC offers Visa, Mastercard, American Express, Discover, PayPal, Apple Pay, e-check and ACH payments.</p><h2>Registration</h2><p>Have your account number, the last four digits of your Social Security number, phone number and email ready. The identity details must match the cooperative’s records. Contact Member Services at (800) 478-1818 for help updating your information.</p><h2>Auto Pay and scheduling</h2><p>Enroll using a preferred payment method on the due date or choose a recurring day. You can also schedule a one-time payment for a chosen date.</p><p><a href="' + href('login') + '">Sign in</a> · <a href="' + href('paynow') + '">Pay Now</a></p><h2>Available in this local environment</h2><p>Checking and card payments are supported. PayPal and Apple Pay integrations are pending. Fees, balances, settlement and private account screens use synthetic fixtures; consult the environment evidence manifest for fidelity details.</p>'); return;
  }
  if (r === 'logout') { await api('logout', {}); if (!isCurrent()) return; lookup = quote = receipt = null; return nav('login'); }
  if (r === 'confirmation') {
    if (!receipt) return nav(auth ? 'paymentHistory' : 'paynow');
    shell('PAYMENT CONFIRMATION', `<p>Your payment was ${e(receipt.status)}.</p><p>Confirmation: <strong id="confirmation">${e(receipt.confirmation)}</strong></p><p>Amount ${money(receipt.amountCents)} · Fee ${money(receipt.feeCents)}</p><p>${e(receipt.method.label)}</p><a href="${href(auth ? 'paymentHistory' : 'paynow')}">Continue</a>`); return;
  }
  if (r === 'review') {
    if (!quote) return nav('makeAPayment');
    shell('REVIEW PAYMENT', `<p>Account ${e(invoice.accountNumber)}</p><p>Payment ${money(quote.amountCents)} · Fee ${money(quote.feeCents)} · Total ${money(quote.totalCents)}</p><p>${e(quote.method.label)}</p>${form('pay', '', 'Submit Payment')}${auth ? form('schedule', field('date', 'Payment Date', 'date'), 'Schedule Payment') : ''}<a href="${href('makeAPayment')}">Change payment details</a>`); return;
  }
  if (!auth && !lookup) { try { const guest = await api('smarthub/guest'); if (!isCurrent()) return; lookup = guest; } catch { if (!isCurrent()) return; return nav(r === 'makeAPayment' ? 'paynow' : 'login'); } }
  const dashboard = auth ? await api('dashboard') : await api('smarthub/guest');
  if (!isCurrent()) return;
  const account = dashboard.account;
  if (r === 'home') {
    const due = dashboard.invoices.filter(i => i.remainingCents > 0).reduce((n, i) => n + i.remainingCents, 0);
    shell('HOME', `<h2>Hello, ${e(account.name)}</h2><p>Account ${e(account.customerNumber)}</p><p>Total due <strong>${money(due)}</strong></p><a class="button" href="${href('makeAPayment')}">Make A Payment</a><p><a href="${href('paymentHistory')}">Payment History</a></p>`); return;
  }
  if (r === 'makeAPayment') {
    const unpaid = dashboard.invoices.filter(i => i.remainingCents > 0); invoice = unpaid[0];
    if (!invoice) { shell('BILLING & PAYMENTS', '<p>No unpaid bills.</p>'); return; }
    invoice.accountNumber = account.customerNumber;
    shell('MAKE A PAYMENT', `<p>Account ${e(account.customerNumber)} · ${e(account.name)}</p>` + form('quote', `<label>Invoice<select name="invoiceId">${unpaid.map(i => `<option value="${e(i.id)}">${e(i.number)} · due ${e(i.dueDate)} · ${money(i.remainingCents)}</option>`).join('')}</select></label>` + field('amount', 'Payment Amount', 'number', (invoice.remainingCents / 100).toFixed(2), 'min="0.01" step="0.01"') + `<label>Payment Method<select name="methodId"><option value="">New checking account</option>${auth ? account.methods.map(m => `<option value="${e(m.id)}">${e(m.label)}</option>`).join('') : ''}<option value="new-card">New credit/debit card</option></select></label><fieldset class="hub-method" data-method-fields="new"><label>Account holder name<input name="name"></label></fieldset><fieldset class="hub-method" data-method-fields="bank"><label>Routing number<input name="routing" inputmode="numeric"></label><label>Bank account number<input name="accountNumber" inputmode="numeric"></label></fieldset><fieldset class="hub-method" data-method-fields="card"><label>Card number<input name="cardNumber" inputmode="numeric"></label><label>Expiry (MM/YY)<input name="expiry"></label><label>Security code<input name="cvv"></label></fieldset>`, 'Review Payment'));
    // Show only the fields that apply to the selected payment method; disabled fieldsets are not submitted.
    const methodSelect = context.app.querySelector('[name="methodId"]'), syncMethod = () => { const v = methodSelect.value, shown = { new: v === '' || v === 'new-card', bank: v === '', card: v === 'new-card' }; for (const set of context.app.querySelectorAll('[data-method-fields]')) { const on = shown[set.dataset.methodFields]; set.hidden = !on; set.disabled = !on; } };
    methodSelect.addEventListener('change', syncMethod); syncMethod(); return;
  }
  if (!auth) return nav('login');
  if(r==='paperless'){shell('PAPERLESS BILLING',form('paperless',`<label><input type="checkbox" name="enabled" ${account.paperless?'checked':''}>Go Paperless</label>`,'Confirm')+'<p id="notice"></p>');return;}
  if (r === 'paymentHistory') {
    shell('PAYMENT HISTORY', `<table><thead><tr><th>Confirmation</th><th>Amount</th><th>Status</th></tr></thead><tbody>${dashboard.payments.map(p => `<tr><td>${e(p.confirmation)}</td><td>${money(p.amountCents)}</td><td>${e(p.status)}</td></tr>`).join('')}</tbody></table>`); return;
  }
  if (r === 'autoPay') {
    shell('AUTO PAY', `<p>Current setting: ${account.autopay.enabled ? 'Enabled' : 'Disabled'}</p>` + form('autopay', `<label>Enrollment<select name="enabled"><option value="no" ${!account.autopay.enabled ? 'selected' : ''}>Disabled</option><option value="yes" ${account.autopay.enabled ? 'selected' : ''}>Enabled</option></select></label><label>Payment Method<select name="methodId">${account.methods.map(m => `<option value="${e(m.id)}" ${m.id === account.autopay.methodId ? 'selected' : ''}>${e(m.label)}</option>`).join('')}</select></label>` + (context.site?.id==='gvp-electric'?'<p>Draft day: 18th or next business day.</p><input name="day" type="hidden" value="18">':field('day', 'Recurring day of month', 'number', account.autopay.day, 'min="1" max="31"')), 'Save') + '<p id="notice" role="status"></p>'); return;
  }
  if (r === 'scheduled') {
    shell('SCHEDULED PAYMENTS', dashboard.scheduledPayments.map(p => `<section><p>${money(p.amountCents)} · ${e(p.date)} · ${e(p.status)}</p>${p.status === 'scheduled' ? form('edit-schedule', `<input name="scheduleId" type="hidden" value="${e(p.id)}">${field('date', 'Payment Date', 'date', p.date)}`, 'Save Date') + `<button data-cancel="${e(p.id)}">Cancel Payment</button>` : ''}</section>`).join('') || '<p>No scheduled payments.</p>'); return;
  }
  shell('PAGE NOT FOUND', `<a href="${href('login')}">Return to sign in</a>`);
}
const app = document.querySelector('#app');
app.addEventListener('click', async event => {
  if (!document.body.classList.contains('smarthub')) return;
  const link = event.target.closest('a');
  if (link && new URL(link.href).origin === location.origin && new URL(link.href).hash) { event.preventDefault(); event.stopImmediatePropagation(); history.pushState({}, '', link.href); context.refresh(); }
  const toggle = event.target.closest('[data-show-password]');
  if (toggle) { event.preventDefault(); event.stopImmediatePropagation(); const p = app.querySelector('[name="password"]'); p.type = p.type === 'password' ? 'text' : 'password'; }
  const tab = event.target.closest('[data-recovery-tab]');
  if (tab) { event.preventDefault(); event.stopImmediatePropagation(); recoveryTab = tab.dataset.recoveryTab; context.refresh(); }
  const cancel = event.target.closest('[data-cancel]');
  if (cancel) { event.preventDefault(); event.stopImmediatePropagation(); try { await context.api('schedule/edit', { scheduleId: cancel.dataset.cancel, cancel: true }); context.refresh(); } catch (error) { err(error); } }
}, true);
app.addEventListener('submit', async event => {
  if (!document.body.classList.contains('smarthub')) return;
  event.preventDefault(); event.stopImmediatePropagation(); const f = event.target, data = Object.fromEntries(new FormData(f)), action = f.dataset.action?.slice(4), button = f.querySelector('button');
  button.disabled = true; document.querySelector('#error').textContent = '';
  const { api } = context;
  try {
    if (action === 'login') { const result = await api('login', data); challenge = result.challenge; if(result.changeToken){changeToken=result.changeToken;sessionStorage.setItem('gvp-password-change',changeToken);nav('changePassword');}else nav(challenge ? 'twoFactor' : 'home'); }
    else if (action === 'verify') { await api('verify', { ...data, challenge }); nav('home'); }
    else if (action === 'lookup') { lookup = await api('smarthub/lookup', data); nav('makeAPayment'); }
    else if (action === 'registration-start') { registration = { ...data, ...await api('smarthub/lookup', { ...data, registration: true }) }; nav('registrationVerify'); }
    else if(action==='first-password'){if(data.password!==data.confirmPassword)throw Error('Passwords must match');await api('smarthub/change-password',{changeToken,password:data.password});sessionStorage.removeItem('gvp-password-change');changeToken='';nav('home');}
    else if(action==='paperless'){await api('paperless',{enabled:f.elements.enabled.checked});await context.refresh();document.querySelector('#notice').textContent='Paperless settings saved.';}
    else if (action === 'registration-finish') { if(context.site?.id==='gvp-electric'){await api('register',{...registration,...data});registration=null;nav('registrationSent');return;}if (data.password !== data.confirmPassword) throw new Error('Passwords must match'); await api('register', { ...registration, ...data }); registration = null; nav('home'); }
    else if (action === 'recover') { const result = await api(recoveryTab === 'password' ? 'reset/request' : 'smarthub/recover-email', data); document.querySelector('#notice').textContent = result.message; }
    else if (action === 'reset') { if (data.password !== data.confirmPassword) throw new Error('Passwords must match'); await api('reset/complete', { token: new URLSearchParams(location.search).get('token'), password: data.password }); nav('login'); }
    else if (action === 'quote') {
      const saved = data.methodId && data.methodId !== 'new-card';
      quote = await api('quote', { ...data, methodId: saved ? data.methodId : undefined, kind: data.methodId === 'new-card' ? 'card' : 'bank', customerNumber: invoice.accountNumber, lookupToken: lookup?.lookupToken, amountCents: Math.round(Number(data.amount) * 100) }); nav('review');
    } else if (action === 'pay') { const result = await api('pay', { token: quote.token }); if (result.declined) throw new Error(result.message); receipt = result; nav('confirmation'); }
    else if (action === 'schedule') { await api('schedule', { token: quote.token, date: data.date }); nav('scheduled'); }
    else if (action === 'edit-schedule') { await api('schedule/edit', data); context.refresh(); }
    else if (action === 'autopay') { await api('autopay', { enabled: data.enabled === 'yes', methodId: data.methodId, day: Number(data.day) }); await context.refresh(); document.querySelector('#notice').textContent = 'Auto Pay settings saved.'; }
  } catch (error) { err(error); }
  finally { if (button.isConnected) button.disabled = false; }
}, true);
