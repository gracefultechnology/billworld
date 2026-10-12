// City of Malden municipal pages and Edmunds WIPP (wippId=MCPW) reconstruction for Billworld.
// Labels follow the captured WIPP bundle; layouts are reconstructed. All state lives on the server.
(() => {
  const app = document.getElementById('app');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = c => `$${(Number(c) / 100).toFixed(2)}`;
  const fmtDate = d => { if (!d) return ''; const [y, m, day] = d.split('-'); return `${m}/${day}/${y}`; };
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(location.search);
  async function api(route, body) {
    const res = await fetch('/api/wipp/' + route, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({ error: 'Something Went Wrong' }));
    if (!res.ok) { const e = new Error(data.error || 'Something Went Wrong'); e.status = res.status; throw e; }
    return data;
  }
  const formData = form => Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '']));
  const alertBox = (msg, kind = 'error') => msg ? `<div class="${kind === 'error' ? 'msg-error' : 'msg-ok'}" role="${kind === 'error' ? 'alert' : 'status'}">${esc(msg)}</div>` : '';
  function showError(scope, error) {
    const box = (scope || document).querySelector('[data-error]') || document.querySelector('[data-error]');
    if (box) { box.innerHTML = alertBox(error.message || String(error)); box.querySelector('[role=alert]')?.focus?.(); }
    else alert(error.message || String(error));
  }
  function bind(selector, event, handler) { for (const el of app.querySelectorAll(selector)) el.addEventListener(event, async e => { if (event === 'submit') e.preventDefault(); const btns = el.querySelectorAll('button'); try { btns.forEach(b => b.disabled = true); await handler(e, el); } catch (err) { if (err.status === 401 && /Session/.test(err.message)) { location.assign('/wipp/home?expired=1'); return; } showError(el.closest('section,main') || el, err); } finally { btns.forEach(b => b.disabled = false); } }); }
  const go = url => location.assign(url);

  // ---------------- Municipal (Revize) reconstruction ----------------
  const disabledLink = label => `<span class="nav-disabled" aria-disabled="true" title="This destination is not available in Billworld">${esc(label)}</span>`;
  const portalUrl = '/wipp/home?wippId=MCPW';
  function municipal(title, body) {
    document.title = title;
    app.innerHTML = `<a class="skip" href="#main">Skip to main content</a>
<div class="m-top"><span>607 N. Douglass St. | Malden, MO 63863</span><span>573.276.4502</span><span class="m-top-right">info@maldenmo.com</span></div>
<header class="m-header"><a class="m-logo" href="/" aria-label="City of Malden, Missouri home"><img src="/malden-logo.png" alt="Malden Missouri" data-fallback="MALDEN"></a>
<nav class="m-nav" aria-label="Main"><ul>
<li><a href="/">Home</a></li><li>${disabledLink('Government')}</li>
<li class="has-sub"><a href="/departments/public_works_office/index.php">Departments</a><ul aria-label="Departments"><li><a href="/departments/public_works_office/index.php">Board of Public Works</a></li><li>${disabledLink('City Hall')}</li><li>${disabledLink('Municipal Court')}</li></ul></li>
<li>${disabledLink('Residents')}</li>
<li class="has-sub"><a href="/how_do_i/faq.php">How Do I</a><ul aria-label="How Do I"><li><a href="/how_do_i/faq.php">FAQ</a></li><li><a href="/how_do_i/pay_bill_online.php">Pay Bill Online</a></li><li><a href="${portalUrl}">Pay Utility Bill</a></li></ul></li>
</ul></nav><label class="m-search">Search<input type="search" disabled aria-disabled="true" placeholder="Search is not available"></label></header>
<main id="main">${body}</main>
<footer class="m-footer"><div class="m-foot-brand"><img src="/malden-footer-logo.png" alt="Malden Missouri" data-fallback="MALDEN"><p>607 N. Douglass St. Malden, MO 63863<br>573-276-4502<br>info@maldenmo.com</p></div>
<div><h2>Resources</h2><ul><li>${disabledLink('Board & Committee Vacancies')}</li><li>${disabledLink('Available Properties')}</li><li>${disabledLink('Sign up for Text Messages')}</li></ul></div>
<div><h2>Departments</h2><ul><li>${disabledLink('City Hall')}</li><li><a href="/departments/public_works_office/index.php">Board of Public Works</a></li><li>${disabledLink('BPW - Electric')}</li><li>${disabledLink('BPW - Water/Wastewater')}</li></ul></div>
<div><h2>Apply For</h2><ul><li>${disabledLink('Building Permit')}</li><li>${disabledLink('Business License')}</li><li>${disabledLink('Employment')}</li></ul></div>
<div><h2>Pay Bill Online</h2><ul><li><a href="${portalUrl}">Pay Utility Bill</a></li><li>${disabledLink('Pay City Taxes')}</li></ul></div>
<p class="m-powered">Powered by revize., Government Website Experts · Billworld local reconstruction</p></footer>`;
    for (const img of app.querySelectorAll('img[data-fallback]')) img.addEventListener('error', () => { const s = document.createElement('span'); s.className = 'm-wordmark'; s.innerHTML = 'MALDEN<small>MISSOURI</small>'; img.replaceWith(s); });
  }
  function home() {
    municipal('Welcome to Malden, MO', `<section class="m-hero" aria-label="Welcome"><p class="m-hero-small">Welcome to the</p><h1>City of Malden <span>Missouri</span></h1></section>
<nav class="m-qlinks" aria-label="Quick links"><a href="${portalUrl}"><span aria-hidden="true">💧</span>Pay Utility Bill</a>${disabledLink('Pay City Taxes')}${disabledLink('Agendas & Minutes')}${disabledLink('Contact Us')}${disabledLink('Employment')}</nav>
<section class="m-news"><h2>News</h2><ul><li>Halloween Parade</li><li>Malden Splash Pad Open</li><li>Important Information About Your Drinking Water</li><li>City Of Malden Waste Collection Site</li><li>Text Alert Sign Up</li><li>Fire Service Area Information</li></ul></section>
<section class="m-events"><h2>Upcoming Events</h2><ul><li><b>Oct 12</b> Holiday - Columbus Day</li><li><b>Oct 19</b> October Council Meeting</li><li><b>Oct 21</b> Park Board Meeting</li><li><b>Oct 27</b> Court</li><li><b>Oct 27</b> Board Of Public Works Board Meeting</li></ul></section>`);
  }
  const accordion = (id, title, html) => `<div class="acc"><h3><button type="button" aria-expanded="false" aria-controls="acc-${id}" data-acc>${esc(title)}</button></h3><div class="acc-body" id="acc-${id}" hidden>${html}</div></div>`;
  function publicWorks() {
    municipal('Board of Public Works', `<div class="m-page"><aside class="m-related"><h2>Related Pages</h2><ul><li><a href="${portalUrl}">Pay Utility Bill</a></li><li>${disabledLink('Sign Up For Nixle')}</li></ul></aside><div class="m-content">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/departments/public_works_office/index.php">Departments</a> › <span>Board Of Public Works</span></nav>
<h1>Board of Public Works</h1><p><b>Board of Public Works</b><br>607 N Douglass St.<br>Malden, MO 63863<br>Office 573-276-2238<br>Fax 573-276-2239<br><b>Email</b>: utilities@maldenmo.com</p><p><b>Office Hours</b><br>Monday - Friday 8:00 a.m. to 5:00 p.m.</p>
<h2 class="acc-title">Public Works Office</h2>
${accordion('admin', 'Administration', '<p>BPW Office Manager · Utility Director · Electrical Supervisor · Power Plant Superintendent · Water/Wastewater Superintendent</p>')}
${accordion('board', 'Board Of Public Works Board', '<p>The BPW Board consists of four members and a council liaison. The Board meets on the last Tuesday of every month at 5:00PM at the BPW office located at 607 N Douglass St.</p>')}
${accordion('service', 'Utility Service , Billing & Payments', '<p>The Malden Board of Public Works (BPW) is a city-owned utility providing the City with electric, water and wastewater services. In addition to calculating the bills and accepting payments we can also assist you with questions about your bill and request for utility connections or disconnections. We service approximately 2,300 residential and business customers.</p>')}
${accordion('apply', 'Applying for Utilities', '<p>Before utilities can be connected, a deposit must be paid and a Utility Application must be completed. Renters are required to show a copy of their lease agreement for rental property. Homeowners must submit the front page of either their abstract or deed. Every person applying for utilities must present proof of identification such as a driver’s license and must be at least 18 years of age.</p>')}
${accordion('billing', 'Billing', '<p>Utility bills are mailed on or before the 25th of every month. Utility customers should contact the BPW immediately if they do not receive a bill as scheduled. Utility bills are due by the 10th of each month; a 5% late fee is assessed on any balance not paid by the 10th of the month.</p><p>GO PAPERLESS: Visit or contact our office to sign up to receive your utility bill electronically</p><p>Bills must be paid in full by the 25th of each month; any account not paid by 8:00 a.m. on the 26th of each month will be subject to disconnect and assessed a $40.00 reconnect fee.</p><p>The Utility will reconnect service after hours for Non-payment Disconnection Customers only from 5:00 p.m. - 10 p.m. Standby Call-out fee for re-connection of services for Non-payment Customers only (after hours 5:00 p.m. - 10 p.m.) will be charged an ADDITIONAL $35.00. All re-connection requests made after 10:00 p.m. will be reconnected the following morning.</p>')}
${accordion('pay', 'Convenient Payment Options', `<p><b>Automatic Bank Draft:</b> This allows customers to authorize the automatic bank transfer of funds directly from your financial institution to pay your utility bill every month.</p><p><b>Online:</b> Customers can make a payment by credit card or check with no additional charge. <a href="${portalUrl}">Click here to pay now</a></p><p><b>By Phone:</b> Coming Soon</p><p><b>In the Office:</b> For customers who prefer to make payments in person, we accept cash, checks and credit/debit cards.</p><p><b>Night Drop Box:</b> For customers convenience a drive-up deposit box is located on the south side of the building.</p><p><b>By Mail:</b> Please mail your payment in time to arrive by the due date stated on your utility bill.</p>`)}
</div></div>`);
    bind('[data-acc]', 'click', (e, b) => { const open = b.getAttribute('aria-expanded') === 'true'; b.setAttribute('aria-expanded', String(!open)); document.getElementById(b.getAttribute('aria-controls')).hidden = open; });
  }
  function faq() {
    municipal('Welcome to Malden, MO', `<div class="m-page"><aside class="m-related"><h2>Related Pages</h2><ul><li>${disabledLink('Apply for')}</li><li>${disabledLink('Contact Us')}</li><li><a href="/how_do_i/faq.php">FAQ</a></li><li><a href="/how_do_i/pay_bill_online.php">Pay Bill Online</a></li></ul></aside><div class="m-content">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <span>How Do I</span> › <span>FAQ</span></nav><h1>FAQ</h1>
<p class="note">The captured FAQ page has no published questions. Utility billing answers are on the <a href="/departments/public_works_office/index.php">Board of Public Works</a> page.</p></div></div>`);
  }
  function payOnline() {
    municipal('Pay Bill Online', `<div class="m-page"><aside class="m-related"><h2>Related Pages</h2><ul><li><a href="/how_do_i/faq.php">FAQ</a></li><li><a href="/how_do_i/pay_bill_online.php">Pay Bill Online</a></li></ul></aside><div class="m-content">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <span>How Do I</span> › <span>Pay Bill Online</span></nav><h1>Pay Bill Online</h1><ul class="big-links"><li><a href="${portalUrl}">Pay Utility Bill</a></li><li>${disabledLink('Pay City Taxes (separate tax portal, not available)')}</li></ul></div></div>`);
  }

  // ---------------- WIPP portal ----------------
  let state = null;
  function wipp(title, body, { nav = true } = {}) {
    document.title = `${title} | WIPP`;
    const u = state?.user;
    const links = [['/wipp/summary', 'Summary'], ['/wipp/billing-accounts', 'Billing Accounts'], ['/wipp/e-billing', 'eBilling'], ['/wipp/e-wallet', 'eWallet'], ['/wipp/auto-pay', 'AutoPay'], ['/wipp/profile', 'Profile']];
    app.innerHTML = `<a class="skip" href="#main">Skip to main content</a>
<header class="w-header"><div class="w-brand"><a href="${u ? '/wipp/summary' : '/wipp/home'}"><span class="w-city">City of Malden</span><span class="w-tenant">Board of Public Works · Utility Payments</span></a></div>
<div class="w-user">${u ? `<span>Signed in as ${esc(u.email)}</span><button type="button" data-logout>Log Out</button>` : `<a href="/wipp/home">Login</a>`}<a href="/">City of Malden home</a></div></header>
${u && nav ? `<nav class="w-nav" aria-label="Portal">${links.map(([href, label]) => `<a href="${href}"${path === href ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>` : ''}
<main id="main" class="w-main"><div data-error></div>${body}</main>
<footer class="w-footer"><p>Need help? <b>Contact</b> the Board of Public Works: 573-276-2238 · utilities@maldenmo.com · 607 N Douglass St., Malden, MO 63863</p><p>© 2025 Edmunds GovTech · WIPP local reconstruction for Billworld</p></footer>`;
    bind('[data-logout]', 'click', async () => { await api('logout', {}); go('/wipp/home'); });
  }
  const requireUser = () => { if (!state.user) { go('/wipp/home?login=required'); return false; } return true; };

  function loginPage() {
    if (state.user) return go('/wipp/summary');
    const notice = params.get('expired') ? 'Session Expired. Please log in again.' : params.get('login') ? 'Please log in to continue.' : params.get('reset') ? 'Your password has been reset. Log in with your new password.' : params.get('deleted') ? 'Your account has been deleted' : '';
    wipp('Home', `<div class="w-columns"><section class="card" aria-labelledby="login-h"><h1 id="login-h">Account Log In</h1>${alertBox(notice, 'ok')}
<form data-form="login"><label>E-Mail<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button type="submit" class="primary">Login</button></form>
<p><a href="/wipp/password">Forgot your password?</a></p><p>New user? <a href="/wipp/create-account">Create Account</a></p></section>
<section class="card" aria-labelledby="guest-h"><h2 id="guest-h">One-time payment</h2><p>Don't want to login? <a href="/wipp/lookup">Lookup your account to make a one-time payment.</a></p></section></div>`);
    bind('[data-form=login]', 'submit', async (e, f) => { const r = await api('login', formData(f)); if (r.resetRequired) return go('/wipp/password?required=1'); go('/wipp/summary'); });
  }

  function lookupPage() {
    wipp('Account Lookup', `<section class="card"><h1>Lookup your account</h1><div role="tablist" aria-label="Account types" class="tabs"><button role="tab" aria-selected="true" type="button">Utility Accounts</button><button role="tab" aria-selected="false" type="button" disabled title="Malden city taxes use a separate portal">Property Tax Accounts</button></div>
<form data-form="lookup"><fieldset><legend>Search by</legend><label class="inline"><input type="radio" name="by" value="accountId" checked> Account Id</label><label class="inline"><input type="radio" name="by" value="name"> Tenant Name</label><label class="inline"><input type="radio" name="by" value="location"> Location</label></fieldset>
<label>Search value<input name="value" required autocomplete="off"></label><button type="submit" class="primary">Search</button></form><div data-results></div></section><p><a href="/wipp/home">Return to Login</a></p>`);
    bind('[data-form=lookup]', 'submit', async (e, f) => {
      const r = await api('lookup', formData(f)); const box = app.querySelector('[data-results]');
      box.innerHTML = r.results.length ? `<table><caption>Utility Accounts</caption><thead><tr><th>Account Id</th><th>Tenant Name</th><th>Location</th><th><span class="sr">Action</span></th></tr></thead><tbody>${r.results.map(x => `<tr><td>${esc(x.accountId)}</td><td>${esc(x.tenantName)}</td><td>${esc(x.location)}</td><td><button type="button" data-select="${esc(x.accountId)}" data-name="${esc(x.tenantName)}" data-loc="${esc(x.location)}" aria-label="View/Pay Account ${esc(x.accountId)}">View/Pay Account</button></td></tr>`).join('')}</tbody></table><div data-confirm></div>` : alertBox('No results found.');
      bind('[data-select]', 'click', (e, b) => {
        const c = app.querySelector('[data-confirm]');
        c.innerHTML = `<section role="dialog" aria-labelledby="confirm-h" class="dialog"><h2 id="confirm-h">Confirm Account Details</h2><dl><dt>Account Id</dt><dd>${esc(b.dataset.select)}</dd><dt>Tenant Name</dt><dd>${esc(b.dataset.name)}</dd><dt>Location</dt><dd>${esc(b.dataset.loc)}</dd></dl><div data-error></div><button type="button" class="primary" data-confirm-account="${esc(b.dataset.select)}">Confirm</button> <button type="button" data-cancel>Cancel</button></section>`;
        bind('[data-confirm-account]', 'click', async (e, btn) => { const r = await api('lookup/confirm', { accountId: btn.dataset.confirmAccount }); go(`/wipp/view/utility/${encodeURIComponent(r.accountId)}`); });
        bind('[data-cancel]', 'click', () => { c.innerHTML = ''; });
        c.querySelector('[data-confirm-account]').focus();
      });
    });
  }

  function passwordRulesHtml() { return `<ul class="rules" aria-label="Password requirements"><li>8-30 Characters</li><li>1 Uppercase</li><li>1 Lowercase</li><li>1 Number</li><li>1 Special Character</li></ul>`; }
  function createAccountPage() {
    const pending = state.pending.registration;
    if (params.get('success') && state.user) return wipp('Success!', `<section class="card"><h1>Success!</h1><p>Your account has been created and your E-Mail is verified.</p><p><a class="button primary" href="/wipp/summary">Continue to Complete Account Setup</a></p></section>`);
    if (pending) {
      wipp('Verify E-Mail', `<section class="card"><h1>Verify E-Mail</h1>${alertBox('Verification Code Sent. Please check your email.', 'ok')}<p>Enter the verification code we sent to <b>${esc(pending.email)}</b>.</p>
<form data-form="verify"><label>Verification Code<input name="code" inputmode="numeric" autocomplete="one-time-code" required></label><button type="submit" class="primary">Verify E-Mail</button></form>
<p><button type="button" data-resend>Resend Verification E-Mail</button> <button type="button" data-restart>Use a different E-Mail</button></p><p>You can open the <a href="/mail">mock Gmail inbox</a> in this tab; this step stays pending when you come back.</p></section>`, { nav: false });
      bind('[data-form=verify]', 'submit', async (e, f) => { await api('register/verify', formData(f)); go('/wipp/create-account?success=1'); });
      bind('[data-resend]', 'click', async () => { await api('register/resend', {}); app.querySelector('[data-error]').innerHTML = alertBox('A new verification code was sent. Earlier codes no longer work.', 'ok'); });
      bind('[data-restart]', 'click', async () => { await api('register/cancel', {}); go('/wipp/create-account'); });
      return;
    }
    wipp('Create Account', `<section class="card"><h1>Create Account</h1><form data-form="register" novalidate>
<div class="grid2"><label>First Name<input name="firstName" autocomplete="given-name" required></label><label>Last Name<input name="lastName" autocomplete="family-name" required></label></div>
<label>E-Mail Address<input name="email" type="email" autocomplete="email" required></label><label>Re-Type E-Mail Address<input name="confirmEmail" type="email" autocomplete="off" required></label>
<label>Mobile Phone<input name="mobile" type="tel" placeholder="(999) 999-9999" autocomplete="tel"></label>
<label>Password<input name="password" type="password" autocomplete="new-password" required></label><label>Re-Type Password<input name="confirmPassword" type="password" autocomplete="new-password" required></label>${passwordRulesHtml()}
<button type="submit" class="primary">Create Account</button> <a href="/wipp/home">Cancel</a></form><div data-exists></div></section>`, { nav: false });
    bind('[data-form=register]', 'submit', async (e, f) => {
      const r = await api('register', formData(f));
      if (r.exists) { app.querySelector('[data-exists]').innerHTML = `<section role="dialog" class="dialog" aria-labelledby="exists-h"><h2 id="exists-h">Account Already Exists</h2><p>${esc(r.message)}</p><a class="button primary" href="/wipp/home">Go to Login</a> <button type="button" data-different>Use a different E-Mail</button></section>`; bind('[data-different]', 'click', () => { app.querySelector('[data-exists]').innerHTML = ''; f.email.focus(); }); return; }
      go('/wipp/create-account');
    });
  }

  function passwordPage() {
    const pending = state.pending.reset;
    if (pending) {
      wipp('Reset Password', `<section class="card"><h1>Reset Password</h1>${params.get('required') ? alertBox('Password reset required', 'ok') : ''}<p>An email has been sent with a temporary password. Use it to complete the following form:</p>
<form data-form="reset"><label>E-Mail<input name="email" type="email" value="${esc(pending.email)}" autocomplete="username" required></label><label>Temporary Password<input name="tempPassword" type="password" autocomplete="off" required></label>
<label>New Password<input name="password" type="password" autocomplete="new-password" required></label><label>Re-Type Password<input name="confirmPassword" type="password" autocomplete="new-password" required></label>${passwordRulesHtml()}<p class="note">Note: Previous passwords cannot be reused</p>
<button type="submit" class="primary">Reset Password</button></form><p><button type="button" data-again>Send a new temporary password</button> <a href="/wipp/home">Return to Login</a></p><p>The <a href="/mail">mock Gmail inbox</a> opens in this tab; this form stays available when you return.</p></section>`, { nav: false });
      bind('[data-form=reset]', 'submit', async (e, f) => { await api('password/reset', formData(f)); go('/wipp/home?reset=1'); });
      bind('[data-again]', 'click', async () => { await api('password/request', { email: pending.email }); app.querySelector('[data-error]').innerHTML = alertBox('A new temporary password was sent.', 'ok'); });
      return;
    }
    wipp('Forgot Password', `<section class="card"><h1>Forgot Password</h1><p>Enter your E-Mail to reset your password.</p><form data-form="forgot"><label>E-Mail<input name="email" type="email" autocomplete="username" required></label><button type="submit" class="primary">Submit</button></form><p><a href="/wipp/home">Return to Login</a></p></section>`, { nav: false });
    bind('[data-form=forgot]', 'submit', async (e, f) => { await api('password/request', formData(f)); go('/wipp/password'); });
  }

  const tag = (on, yes, no) => `<span class="tag ${on ? 'on' : 'off'}">${on ? yes : no}</span>`;
  async function summaryPage() {
    if (!requireUser()) return;
    const r = await api('summary');
    wipp('Summary', `<h1>Summary</h1>${r.setupRequired ? `<section class="card setup"><h2>Complete Account Setup</h2><p>Please add at least one billing account to continue.</p><a class="button primary" href="/wipp/billing-accounts">Add a Billing Account</a></section>` : ''}
${r.accounts.map(a => `<section class="card acct" aria-labelledby="acct-${esc(a.id)}"><h2 id="acct-${esc(a.id)}">Utility Account ${esc(a.id)}</h2><p>${esc(a.serviceLocation)}</p>
${a.disconnected ? alertBox('Service Disconnected') : ''}${a.overdue ? alertBox('Payment is overdue. Please pay immediately to avoid late fees.') : ''}
<dl class="facts"><dt>Current Balance</dt><dd>${money(a.balanceCents)}</dd><dt>Due Date</dt><dd>${esc(fmtDate(a.currentBill?.dueDate))}</dd></dl>
<p>${tag(a.autopay.enrolled && a.autopay.mine, 'Enrolled in Auto-Pay', a.directWithdrawal ? 'Direct Withdrawal' : 'Not Enrolled in Auto-Pay')} ${tag(a.ebilling.enrolled, 'Enrolled in eBilling', 'Not Enrolled in eBilling')}</p>
${a.scheduled.length ? `<h3>Upcoming scheduled payments</h3><ul>${a.scheduled.map(x => `<li>A payment of <strong>${money(x.amountCents)}</strong> will be paid on ${esc(fmtDate(x.date))}</li>`).join('')}</ul>` : ''}
<a class="button primary" href="/wipp/view/utility/${encodeURIComponent(a.id)}" aria-label="View/Pay Account ${esc(a.id)}">View/Pay Account</a></section>`).join('')}`);
  }

  async function billingAccountsPage() {
    if (!requireUser()) return;
    const r = await api('summary');
    wipp('Billing Accounts', `<h1>My Billing Accounts</h1>${r.accounts.length ? `<table><thead><tr><th>Type</th><th>Account ID</th><th>Location</th><th>Balance</th><th><span class="sr">Action</span></th></tr></thead><tbody>${r.accounts.map(a => `<tr><td>Utility</td><td>${esc(a.id)}</td><td>${esc(a.serviceLocation)}</td><td>${money(a.balanceCents)}</td><td><button type="button" data-remove="${esc(a.id)}" aria-label="Remove account ${esc(a.id)}">Remove</button></td></tr>`).join('')}</tbody></table>` : `<p>Please add at least one billing account to continue.</p>`}<div data-remove-confirm></div>
<section class="card"><h2>Add a Billing Account</h2><form data-form="add"><label>Type<select name="type" required><option value="utility">Utility</option></select></label><label>Account ID<input name="accountId" required autocomplete="off"></label><label>Balance<input name="balance" inputmode="decimal" placeholder="$0.00" required autocomplete="off"></label><p class="hint">Enter the current balance shown on your most recent bill to confirm the account.</p><button type="submit" class="primary">Add</button></form><div data-link-confirm></div></section>`);
    const confirm = (d) => {
      app.querySelector('[data-link-confirm]').innerHTML = `<section role="dialog" class="dialog" aria-labelledby="link-h"><h2 id="link-h">Confirm Account Details</h2><dl><dt>Account ID</dt><dd>${esc(d.accountId)}</dd>${d.customerName ? `<dt>Customer Name</dt><dd>${esc(d.customerName)}</dd><dt>Service Location</dt><dd>${esc(d.serviceLocation)}</dd>` : ''}</dl><div data-error></div><button type="button" class="primary" data-link="${esc(d.accountId)}">Confirm</button> <button type="button" data-link-cancel>Cancel</button></section>`;
      bind('[data-link]', 'click', async (e, b) => { await api('accounts/confirm', { accountId: b.dataset.link }); go('/wipp/billing-accounts'); });
      bind('[data-link-cancel]', 'click', () => { app.querySelector('[data-link-confirm]').innerHTML = ''; });
    };
    if (state.pending.link) confirm(state.pending.link);
    bind('[data-form=add]', 'submit', async (e, f) => { const r = await api('accounts/add', formData(f)); confirm(r.confirm); });
    bind('[data-remove]', 'click', (e, b) => {
      const box = app.querySelector('[data-remove-confirm]'); box.innerHTML = `<section role="dialog" class="dialog" aria-labelledby="rm-h"><h2 id="rm-h">Remove Account</h2><p>Are you sure you want to remove this account? (${esc(b.dataset.remove)})</p><div data-error></div><button type="button" class="primary" data-yes>Yes</button> <button type="button" data-no>No</button></section>`;
      bind('[data-yes]', 'click', async () => { await api('accounts/remove', { accountId: b.dataset.remove }); go('/wipp/billing-accounts'); }); bind('[data-no]', 'click', () => { box.innerHTML = ''; });
    });
  }

  async function viewPage(id) {
    let a;
    try { a = await api('account?id=' + encodeURIComponent(id)); }
    catch (e) { wipp('Account', `<h1>Account ${esc(id)}</h1>${alertBox(e.message)}<p><a href="${state.user ? '/wipp/billing-accounts' : '/wipp/lookup'}">${state.user ? 'Go to Billing Accounts' : 'Lookup your account'}</a></p>`); return; }
    const signedIn = !!a.history;
    wipp(`Account ${a.id}`, `<nav class="crumbs" aria-label="Breadcrumb">${signedIn ? '<a href="/wipp/summary">Summary</a> › ' : '<a href="/wipp/lookup">Lookup</a> › '}<span>Utility Account ${esc(a.id)}</span></nav><h1>Utility Account ${esc(a.id)}</h1>
${a.disconnected ? `<div class="msg-error" role="alert"><b>Service Disconnected</b><br>Utility service has been disconnected for non-payment. Payment must be made at the office in order to restore service.</div>` : ''}
${a.pendingPayment ? alertBox('There is a pending payment on this account.', 'ok') : ''}${a.overdue ? alertBox('Payment is overdue. Please pay immediately to avoid late fees.') : ''}
<section class="card"><h2>Account Information</h2><dl class="facts"><dt>Account Id</dt><dd>${esc(a.id)}</dd><dt>Customer Name</dt><dd>${esc(a.customerName)}</dd><dt>Service Location</dt><dd>${esc(a.serviceLocation)}, ${esc(a.city)}</dd>${a.currentBill ? `<dt>Bill Date</dt><dd>${fmtDate(a.currentBill.billDate)}</dd><dt>Due Date</dt><dd>${fmtDate(a.currentBill.dueDate)}</dd>` : ''}</dl></section>
<section class="card"><h2>Current Bill</h2>${a.currentBill ? `<table><thead><tr><th>Service</th><th>Current Bill</th></tr></thead><tbody>${a.currentBill.charges.map(c => `<tr><td>${esc(c.service)}</td><td>${money(c.amountCents)}</td></tr>`).join('')}${a.currentBill.lateFeeCents ? `<tr><td>Late Charge (5%)</td><td>${money(a.currentBill.lateFeeCents)}</td></tr>` : ''}</tbody></table>` : '<p>No invoices found.</p>'}
<dl class="facts totals"><dt>Current Balance</dt><dd>${money(Math.max(0, a.balanceCents - a.delinquentCents))}</dd><dt>Delinquent Balance</dt><dd>${money(a.delinquentCents)}</dd><dt>Account Total</dt><dd><strong>${money(a.balanceCents)}</strong>${a.creditCents ? ' (credit)' : ''}</dd></dl>
<p class="hint">Balance Includes any Adjustments to Your Account</p>
<div class="actions">${a.onlinePayments ? (a.balanceCents > 0 ? `<a class="button primary" href="/wipp/pay/${encodeURIComponent(a.id)}">Make Payment</a>` : '<span>No balance due.</span>') : `<span class="msg-error" role="note">Online payments cannot be accepted for this account.</span>`}${signedIn ? ` <a class="button" href="/wipp/bill/${encodeURIComponent(a.id)}">View Current Bill</a>` : ''}</div></section>
${signedIn ? `
${a.meters.length ? `<section class="card"><h2>Meter Readings</h2><table><thead><tr><th>Service</th><th>Read Date</th><th>Reading</th><th>Usage</th></tr></thead><tbody>${a.meters.map(m => `<tr><td>${esc(m.service)}</td><td>${fmtDate(m.readDate)}</td><td>${m.reading}</td><td>${m.usage} ${esc(m.unit)}</td></tr>`).join('')}</tbody></table></section>` : ''}
<section class="card"><h2>Upcoming scheduled payments</h2>${a.scheduled.length ? `<ul class="sched">${a.scheduled.map(x => `<li data-sched="${esc(x.id)}"><p>A payment of <strong>${money(x.amountCents)}</strong> will be paid on <strong>${fmtDate(x.date)}</strong> using ${esc(x.method)}.</p><button type="button" data-edit="${esc(x.id)}" data-amount="${(x.amountCents / 100).toFixed(2)}" data-date="${esc(x.date)}" aria-label="Edit Scheduled Payment of ${money(x.amountCents)} on ${fmtDate(x.date)}">Edit Scheduled Payment</button> <button type="button" data-delete="${esc(x.id)}" aria-label="Delete Scheduled Payment of ${money(x.amountCents)} on ${fmtDate(x.date)}">Delete Scheduled Payment</button><div data-sched-panel></div></li>`).join('')}</ul>` : '<p>No upcoming scheduled payments.</p>'}</section>
<section class="card"><h2>Payment History</h2>${a.history.length ? `<table><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Type</th><th>Status</th><th>Confirmation</th></tr></thead><tbody>${a.history.map(p => `<tr><td>${fmtDate(p.date)}</td><td>${money(p.amountCents)}</td><td>${esc(p.method.label)}</td><td>${esc({ guest: 'One-time', signed: 'Online', scheduled: 'Scheduled', autopay: 'AutoPay' }[p.channel] || p.channel)}</td><td>${esc(p.status)}</td><td>${esc(p.confirmation)}</td></tr>`).join('')}</tbody></table>` : '<p>No payments found.</p>'}</section>
<section class="card"><h2>Enrollment</h2><p>${tag(a.autopay.enrolled && a.autopay.mine, `You're enrolled in AutoPay${a.autopay.method ? ' (' + esc(a.autopay.method) + ')' : ''}`, a.directWithdrawal ? 'Enrolled in Direct Withdrawal' : 'Not enrolled in AutoPay')} ${tag(a.ebilling.enrolled, "You're enrolled in eBilling", 'Not enrolled in eBilling')}</p><p><a href="/wipp/auto-pay">Manage AutoPay</a> · <a href="/wipp/e-billing">Manage eBilling</a></p></section>` : `<p><a href="/wipp/home">Log in</a> to view payment history, schedule payments or manage AutoPay.</p>`}`);
    bind('[data-edit]', 'click', (e, b) => {
      const panel = b.parentElement.querySelector('[data-sched-panel]');
      panel.innerHTML = `<form data-form="edit-sched" class="dialog" aria-label="Edit Scheduled Payment"><h3>Edit Scheduled Payment</h3><div data-error></div><label>Amount<input name="amount" inputmode="decimal" value="${esc(b.dataset.amount)}" required></label><label>Date<input name="date" type="date" value="${esc(b.dataset.date)}" required></label><button type="submit" class="primary">Save</button> <button type="button" data-close>Cancel</button></form>`;
      bind('[data-form=edit-sched]', 'submit', async (e, f) => { await api('schedule/edit', { scheduleId: b.dataset.edit, ...formData(f) }); location.reload(); });
      bind('[data-close]', 'click', () => { panel.innerHTML = ''; });
    });
    bind('[data-delete]', 'click', (e, b) => {
      const panel = b.parentElement.querySelector('[data-sched-panel]');
      panel.innerHTML = `<section role="dialog" class="dialog" aria-label="Delete Scheduled Payment"><p>Are you sure you want to delete this scheduled payment?</p><div data-error></div><button type="button" class="primary" data-yes>Yes</button> <button type="button" data-no>No</button></section>`;
      bind('[data-yes]', 'click', async () => { await api('schedule/delete', { scheduleId: b.dataset.delete }); location.reload(); });
      bind('[data-no]', 'click', () => { panel.innerHTML = ''; });
    });
  }

  async function payPage(id) {
    let a; try { a = await api('account?id=' + encodeURIComponent(id)); } catch (e) { wipp('Make Payment', `<h1>Make Payment</h1>${alertBox(e.message)}<p><a href="/wipp/lookup">Lookup your account</a></p>`); return; }
    const signedIn = !!a.history;
    if (!a.onlinePayments) return wipp('Make Payment', `<h1>Make Payment</h1>${alertBox('Online payments cannot be accepted for this account.')}<p><a href="/wipp/view/utility/${encodeURIComponent(a.id)}">Return to Account</a></p>`);
    wipp('Make Payment', `<nav class="crumbs" aria-label="Breadcrumb"><a href="/wipp/view/utility/${encodeURIComponent(a.id)}">Utility Account ${esc(a.id)}</a> › <span>Make Payment</span></nav><h1>Make Payment</h1>
<p>Utility Account ${esc(a.id)} · ${esc(a.serviceLocation)} · Bill Amount: <strong>${money(a.balanceCents)}</strong></p>
${signedIn && a.autopay.enrolled ? alertBox('This account is enrolled in AutoPay. A scheduled AutoPay payment may still process for the current bill.', 'ok') : ''}
<form data-form="pay" class="card"><fieldset><legend>1. Select payment method</legend><label class="inline"><input type="radio" name="methodType" value="card" required> Credit/Debit</label><label class="inline"><input type="radio" name="methodType" value="echeck"> eCheck</label><p class="note">PLEASE NOTE: There is no fee when paying by eCheck. Card payments also carry no additional charge for City of Malden utility bills.</p></fieldset>
<fieldset><legend>2. Select payment amount</legend><label class="inline"><input type="radio" name="amountChoice" value="bill" checked> Bill Amount (${money(a.balanceCents)})</label><label class="inline"><input type="radio" name="amountChoice" value="other"> Pay Other Amount</label><label>Payment Amount<input name="amount" inputmode="decimal" placeholder="$0.00" autocomplete="off"></label></fieldset>
${signedIn ? `<fieldset><legend>3. Schedule Payment</legend><label class="inline"><input type="radio" name="when" value="now" checked> Pay today (${fmtDate(state.now)})</label><label class="inline"><input type="radio" name="when" value="later"> Schedule for a later date</label><label>Scheduled Date<input name="date" type="date" min="${esc(state.now)}"></label><p class="hint">Scheduled payments use a saved eWallet payment method.</p></fieldset>` : ''}
<fieldset><legend>Terms & Conditions</legend><p class="terms">Payments are processed by Link2Gov on behalf of the City of Malden Board of Public Works. Payments made after the due date are subject to the 5% late fee. A receipt is sent to the E-Mail you provide.</p><label class="inline"><input type="checkbox" name="terms" value="yes" required> I accept the Terms & Conditions</label></fieldset>
<div data-error></div><button type="submit" class="primary">Continue</button> <a href="/wipp/view/utility/${encodeURIComponent(a.id)}">Cancel</a></form><div data-transfer></div>`);
    bind('[data-form=pay]', 'submit', async (e, f) => {
      const d = formData(f);
      if (!d.methodType) throw new Error('Please select a payment method.');
      const body = { accountId: a.id, methodType: d.methodType, amountChoice: d.amountChoice, amount: d.amount, terms: d.terms === 'yes' };
      if (d.when === 'later') { if (!d.date) throw new Error('Enter a Scheduled Date'); body.date = d.date; }
      await api('checkout/start', body);
      f.hidden = true;
      app.querySelector('[data-transfer]').innerHTML = `<section class="card" role="status"><h2>Preparing secure payment…</h2><p>You will now be transferred to the Link2Gov website to enter your payment information.</p><a class="button primary" href="/wipp/link2gov">Continue to Link2Gov</a></section>`;
      app.querySelector('[data-transfer] a').focus();
    });
  }

  async function link2govPage() {
    let c; try { c = await api('checkout'); } catch { return wipp('Link2Gov', `<h1>Payment Details</h1>${alertBox('No payment in progress. Start from Make Payment on your account.')}<p><a href="${state.user ? '/wipp/summary' : '/wipp/lookup'}">Return</a></p>`, { nav: false }); }
    if (c.stage === 'complete') return go('/wipp/confirmation');
    document.title = 'Link2Gov Payment';
    const summary = `<dl class="facts"><dt>Payee</dt><dd>City of Malden Board of Public Works</dd><dt>Utility Account</dt><dd>${esc(c.accountId)} · ${esc(c.serviceLocation)}</dd><dt>Payment Amount</dt><dd>${money(c.amountCents)}</dd><dt>Convenience Fee</dt><dd>${money(c.feeCents)}</dd><dt>Total Amount</dt><dd><strong>${money(c.totalCents)}</strong></dd><dt>Payment Date</dt><dd>${fmtDate(c.date)}${c.scheduled ? ' (Scheduled)' : ''}</dd></dl>`;
    const card = c.methodType === 'card';
    const newFields = card
      ? `<label>Name on Card<input name="name" autocomplete="cc-name"></label><label>Card Number<input name="cardNumber" inputmode="numeric" autocomplete="cc-number"></label><div class="grid2"><label>Expiration Date (MM/YY)<input name="expiry" placeholder="MM/YY" autocomplete="cc-exp"></label><label>CVV<input name="cvv" inputmode="numeric" autocomplete="cc-csc"></label></div>`
      : `<label>Name on Account<input name="name" autocomplete="name"></label><fieldset><legend>Account Ownership</legend><label class="inline"><input type="radio" name="ownership" value="personal" checked> Personal</label><label class="inline"><input type="radio" name="ownership" value="business"> Business</label></fieldset><label>Account Type<select name="accountType"><option value="checking">Checking</option><option value="savings">Savings</option></select></label><label>Routing Number<input name="routing" inputmode="numeric" autocomplete="off"></label><label>Account Number<input name="accountNumber" inputmode="numeric" autocomplete="off"></label><label>Re-Type Account Number<input name="confirmAccountNumber" inputmode="numeric" autocomplete="off"></label>`;
    const review = c.stage === 'review' && !params.get('edit');
    app.innerHTML = `<a class="skip" href="#main">Skip to main content</a><header class="l2g-header"><span class="l2g-logo">Link2Gov</span><span>Secure payment for City of Malden Board of Public Works</span></header>
<main id="main" class="w-main l2g"><ol class="steps" aria-label="Progress"><li${review ? '' : ' aria-current="step"'}>Payment Details</li><li${review ? ' aria-current="step"' : ''}>Review</li><li>Confirmation</li></ol><div data-error></div>
<h1>${review ? 'Review Payment' : 'Payment Details'}</h1><section class="card">${summary}</section>
${review ? `<section class="card"><h2>Payment Method</h2><p>${esc(c.method.label)}</p><p>Receipt E-Mail: ${esc(c.email)}</p>
<form data-form="submit"><label class="inline"><input type="checkbox" name="authorize" value="yes" required> I authorize the City of Malden Board of Public Works to ${c.scheduled ? `charge ${money(c.totalCents)} on ${fmtDate(c.date)}` : `charge ${money(c.totalCents)} today`}.</label><button type="submit" class="primary">${c.scheduled ? 'Schedule Payment' : 'Submit Payment'}</button> <a href="/wipp/link2gov?edit=1">Edit Payment Details</a></form></section>`
        : `<form data-form="details" class="card"><fieldset><legend>${card ? 'Credit/Debit Card' : 'eCheck (Bank Account)'}</legend>
${c.savedMethods.length ? `${c.savedMethods.map((m, i) => `<label class="inline block"><input type="radio" name="source" value="saved:${esc(m.id)}"${i === 0 ? ' checked' : ''}> ${esc(m.label)}${m.nickname ? ' — ' + esc(m.nickname) : ''}</label>`).join('')}` : ''}
${c.scheduled ? (c.savedMethods.length ? '' : alertBox('Scheduled payments must use a saved eWallet payment method. Add one in eWallet first.')) : `<label class="inline block"><input type="radio" name="source" value="new"${c.savedMethods.length ? '' : ' checked'}> Use a new ${card ? 'card' : 'bank account'}</label><div class="newmethod">${newFields}<label>Zip<input name="zip" inputmode="numeric" autocomplete="postal-code"></label></div>`}
</fieldset><label>E-Mail (receipt)<input name="email" type="email" value="${esc(c.email || state.user?.email || '')}" autocomplete="email"></label>
<button type="submit" class="primary">Continue</button> <button type="button" data-cancel-payment>Cancel Payment</button></form>`}
</main><footer class="w-footer"><p>Link2Gov reconstruction · Billworld local simulation. No real payment is made.</p></footer>`;
    bind('[data-form=details]', 'submit', async (e, f) => {
      const d = formData(f); if (!d.source) throw new Error('Select a Payment Method');
      const body = d.source.startsWith('saved:') ? { source: 'saved', methodId: d.source.slice(6), email: d.email } : { source: 'new', ...d };
      await api('checkout/details', body); go('/wipp/link2gov');
    });
    bind('[data-form=submit]', 'submit', async (e, f) => { await api('checkout/submit', { authorize: formData(f).authorize === 'yes' }); go('/wipp/confirmation'); });
    bind('[data-cancel-payment]', 'click', async () => { await api('checkout/cancel', {}); go(`/wipp/view/utility/${encodeURIComponent(c.accountId)}`); });
  }

  async function confirmationPage() {
    let c; try { c = await api('checkout'); } catch { return wipp('Confirmation', `<h1>Confirmation</h1>${alertBox('No payment in progress.')}`); }
    if (c.stage !== 'complete') return go('/wipp/link2gov');
    const r = c.receipt;
    wipp('Confirmation', `<h1>Confirmation</h1><section class="card receipt" aria-labelledby="rc-h"><h2 id="rc-h">${r.scheduled ? 'Payment Scheduled' : 'Payment Complete'}</h2>
${r.scheduled ? `<p>A payment of <strong>${money(r.amountCents)}</strong> will be paid on <strong>${fmtDate(r.date)}</strong> using ${esc(r.method)}.</p>` : `<dl class="facts"><dt>Confirmation Number</dt><dd data-confirmation>${esc(r.confirmation)}</dd><dt>Utility Account</dt><dd>${esc(c.accountId)}</dd><dt>Payment Amount</dt><dd>${money(r.amountCents)}</dd><dt>Convenience Fee</dt><dd>${money(r.feeCents)}</dd><dt>Total Amount</dt><dd>${money(r.totalCents)}</dd><dt>Payment Method</dt><dd>${esc(r.method)}</dd><dt>Date</dt><dd>${fmtDate(r.date)}</dd><dt>Status</dt><dd>${esc(r.status)}</dd></dl><p>A receipt has been sent to your E-Mail address (${esc(r.emailedTo)}).</p>`}
<button type="button" data-print>Print</button></section><p><a href="/wipp/view/utility/${encodeURIComponent(c.accountId)}">Return to Account</a> · <a href="${state.user ? '/wipp/summary' : '/wipp/home'}">Return to Home</a></p>`);
    bind('[data-print]', 'click', () => window.print());
  }

  async function billPage(id) {
    if (!requireUser()) return;
    let b; try { b = await api('statement?id=' + encodeURIComponent(id)); } catch (e) { return wipp('View Current Bill', `<h1>View Current Bill</h1>${alertBox(e.message)}`); }
    const p = b.policy || {};
    wipp('View Current Bill', `<nav class="crumbs" aria-label="Breadcrumb"><a href="/wipp/view/utility/${encodeURIComponent(b.account.id)}">Utility Account ${esc(b.account.id)}</a> › <span>Current Bill</span></nav>
<article class="bill" aria-labelledby="bill-h"><header><h1 id="bill-h">City of Malden Board of Public Works — Utility Bill</h1><p>607 N Douglass St., Malden, MO 63863 · 573-276-2238</p></header>
<dl class="facts"><dt>Account Id</dt><dd>${esc(b.account.id)}</dd><dt>Customer Name</dt><dd>${esc(b.account.customerName)}</dd><dt>Service Location</dt><dd>${esc(b.account.serviceLocation)}, ${esc(b.account.city)}</dd><dt>Billing Period</dt><dd>${esc(b.bill.period)}</dd><dt>Bill Date</dt><dd>${fmtDate(b.bill.billDate)}</dd><dt>Due Date</dt><dd data-due>${fmtDate(b.bill.dueDate)}</dd></dl>
<table><caption>Meter Readings</caption><thead><tr><th>Service</th><th>Meter</th><th>Read Date</th><th>Previous</th><th>Reading</th><th>Usage</th></tr></thead><tbody>${b.meters.map(m => `<tr><td>${esc(m.service)}</td><td>${esc(m.meter)}</td><td>${fmtDate(m.readDate)}</td><td>${m.previous}</td><td>${m.reading}</td><td>${m.usage} ${esc(m.unit)}</td></tr>`).join('')}</tbody></table>
<table><caption>Current Charges</caption><thead><tr><th>Service</th><th>Amount</th></tr></thead><tbody>${b.bill.charges.map(c => `<tr><td>${esc(c.service)}</td><td>${money(c.amountCents)}</td></tr>`).join('')}${b.bill.lateFeeCents ? `<tr><td>Late Charge</td><td>${money(b.bill.lateFeeCents)}</td></tr>` : ''}<tr><th>Current Bill</th><th>${money(b.bill.amountCents + (b.bill.lateFeeCents || 0))}</th></tr></tbody></table>
<dl class="facts totals"><dt>Previous Balance</dt><dd>${money(b.previousBalanceCents)}</dd><dt>Payments Since Bill Date</dt><dd>-${money(b.paymentsSinceBillCents)}</dd><dt>Total Amount Due</dt><dd data-balance><strong>${money(b.balanceCents)}</strong></dd></dl>
<p class="terms">Bills are due by the ${p.due_day || 10}th; a ${p.late_charge_percent || 5}% late fee is assessed on any balance not paid by the 10th. Accounts not paid by 8:00 a.m. on the 26th are subject to disconnect and a $40.00 reconnect fee.</p></article>
<button type="button" data-print>Print</button> <a href="/wipp/view/utility/${encodeURIComponent(b.account.id)}">Return to Account</a>`);
    bind('[data-print]', 'click', () => window.print());
  }

  async function ebillingPage() {
    if (!requireUser()) return;
    const r = await api('ebilling');
    wipp('eBilling', `<h1>eBilling</h1>${r.accounts.length ? r.accounts.map(a => `<section class="card" aria-labelledby="eb-${esc(a.id)}"><h2 id="eb-${esc(a.id)}">Utility Account ${esc(a.id)}</h2><p>${esc(a.serviceLocation)}</p>
<p>${a.ebilling.enrolled ? `You're enrolled in eBilling${a.ebilling.printed ? ' (also receiving a printed bill)' : ''}` : 'Not enrolled in eBilling'}</p>
<form data-form="eb" data-account="${esc(a.id)}"><label class="inline"><input type="checkbox" name="printed" value="yes"${a.ebilling.printed && a.ebilling.enrolled ? ' checked' : ''}> Also receive printed bill</label>
${a.ebilling.enrolled ? `<button type="submit" name="op" value="save" class="primary" aria-label="Save eBilling for ${esc(a.id)}">Save</button> <button type="button" data-unenroll="${esc(a.id)}" aria-label="Unenroll ${esc(a.id)} from eBilling">Unenroll</button>` : `<button type="submit" class="primary" aria-label="Enroll ${esc(a.id)} in eBilling">Enroll</button>`}</form></section>`).join('') : '<p>Please add at least one billing account to continue. <a href="/wipp/billing-accounts">Billing Accounts</a></p>'}`);
    bind('[data-form=eb]', 'submit', async (e, f) => { await api('ebilling', { accountId: f.dataset.account, enrolled: true, printed: f.printed.checked }); location.reload(); });
    bind('[data-unenroll]', 'click', async (e, b) => { await api('ebilling', { accountId: b.dataset.unenroll, enrolled: false }); location.reload(); });
  }

  const billingFields = `<fieldset><legend>Billing Information</legend><label>Address<input name="address" autocomplete="street-address"></label><div class="grid3"><label>City<input name="city" autocomplete="address-level2"></label><label>State<input name="state" maxlength="2" placeholder="MO" autocomplete="address-level1"></label><label>Zip<input name="zip" inputmode="numeric" autocomplete="postal-code"></label></div></fieldset>`;
  async function walletPage() {
    if (!requireUser()) return;
    const r = await api('wallet'), mode = params.get('add');
    wipp('eWallet', `<h1>My Payment Methods</h1>${r.methods.length ? `<ul class="wallet">${r.methods.map(m => `<li><div><strong>${esc(m.label)}</strong>${m.nickname ? ` — ${esc(m.nickname)}` : ''}${m.expiry ? ` · Expires ${esc(m.expiry)}` : ''}${m.accountType ? ` · ${esc(m.ownership === 'business' ? 'Business' : 'Personal')}` : ''}</div><button type="button" data-edit="${esc(m.id)}" data-nick="${esc(m.nickname)}" data-exp="${esc(m.expiry || '')}" aria-label="Edit ${esc(m.label)}">Edit</button> <button type="button" data-del="${esc(m.id)}" aria-label="Remove ${esc(m.label)}">Remove</button><div data-panel></div></li>`).join('')}</ul>` : '<p>Your eWallet is currently empty.</p>'}
<p>Add a Payment Method to your account: <a class="button" href="/wipp/e-wallet?add=bank">Add Checking Account</a> <a class="button" href="/wipp/e-wallet?add=card">Add Card</a></p>
${mode === 'bank' ? `<form data-form="add" data-kind="bank" class="card"><h2>Add Checking Account</h2><label>Bank Nickname (optional)<input name="nickname"></label><fieldset><legend>Account Ownership</legend><label class="inline"><input type="radio" name="ownership" value="personal" checked> Personal</label><label class="inline"><input type="radio" name="ownership" value="business"> Business</label></fieldset><label>Account Type<select name="accountType"><option value="checking">Checking</option><option value="savings">Savings</option></select></label><label>Name on Account<input name="name" autocomplete="name"></label><label>Routing Number<input name="routing" inputmode="numeric"></label><label>Account Number<input name="accountNumber" inputmode="numeric"></label><label>Re-Type Account Number<input name="confirmAccountNumber" inputmode="numeric"></label>${billingFields}<button type="submit" class="primary">Save</button> <a href="/wipp/e-wallet">Cancel</a></form>` : ''}
${mode === 'card' ? `<form data-form="add" data-kind="card" class="card"><h2>Add Card</h2><label>Card Nickname (optional)<input name="nickname"></label><label>Name on Card<input name="name" autocomplete="cc-name"></label><label>Card Number<input name="cardNumber" inputmode="numeric" autocomplete="cc-number"></label><div class="grid2"><label>Expiration Date (MM/YY)<input name="expiry" placeholder="MM/YY" autocomplete="cc-exp"></label><label>CVV<input name="cvv" inputmode="numeric" autocomplete="cc-csc"></label></div>${billingFields}<button type="submit" class="primary">Save</button> <a href="/wipp/e-wallet">Cancel</a></form>` : ''}`);
    bind('[data-form=add]', 'submit', async (e, f) => { await api('wallet/add', { kind: f.dataset.kind, ...formData(f) }); go('/wipp/e-wallet'); });
    bind('[data-edit]', 'click', (e, b) => { const p = b.parentElement.querySelector('[data-panel]'); p.innerHTML = `<form data-form="edit" class="dialog" aria-label="Edit payment method"><div data-error></div><label>Nickname<input name="nickname" value="${esc(b.dataset.nick)}"></label>${b.dataset.exp ? `<label>Expiration Date (MM/YY)<input name="expiry" value="${esc(b.dataset.exp)}"></label>` : ''}<button type="submit" class="primary">Save</button> <button type="button" data-close>Cancel</button></form>`;
      bind('[data-form=edit]', 'submit', async (e, f) => { await api('wallet/edit', { methodId: b.dataset.edit, ...formData(f) }); location.reload(); }); bind('[data-close]', 'click', () => { p.innerHTML = ''; }); });
    bind('[data-del]', 'click', (e, b) => { const p = b.parentElement.querySelector('[data-panel]'); p.innerHTML = `<section role="dialog" class="dialog" aria-label="Remove payment method"><p>Are you sure you want to remove this payment method?</p><div data-error></div><button type="button" class="primary" data-yes>Yes</button> <button type="button" data-no>No</button></section>`;
      bind('[data-yes]', 'click', async () => { await api('wallet/delete', { methodId: b.dataset.del }); location.reload(); }); bind('[data-no]', 'click', () => { p.innerHTML = ''; }); });
  }

  async function autopayPage() {
    if (!requireUser()) return;
    const r = await api('autopay');
    const options = sel => r.methods.map(m => `<option value="${esc(m.id)}"${m.id === sel ? ' selected' : ''}>${esc(m.label)}${m.nickname ? ' — ' + esc(m.nickname) : ''}</option>`).join('');
    wipp('AutoPay', `<h1>AutoPay</h1><p class="note">Note: Changes to AutoPay enrollment and payment method must be completed at least 3 business days before the due date. Changes made after that may not apply to the current bill.</p>
${r.accounts.length ? r.accounts.map(a => `<section class="card" aria-labelledby="ap-${esc(a.id)}"><h2 id="ap-${esc(a.id)}">Utility Account ${esc(a.id)}</h2><p>${esc(a.serviceLocation)}${a.dueDate ? ` · Due ${fmtDate(a.dueDate)} · change cutoff ${fmtDate(a.cutoff)}` : ''}</p><div data-error></div>
${a.status === 'direct_withdrawal' ? `<p class="msg-error" role="note">This Account cannot be enrolled in AutoPay because it is already enrolled in Direct Withdrawal.</p>`
  : a.status === 'other_user' ? `<p class="msg-error" role="note">Another user is already enrolled in AutoPay for this account.</p>`
  : a.status === 'enrolled' ? `<p class="status-line"><strong>You're enrolled in AutoPay</strong> using ${esc(a.method || 'an inactive payment method')}.</p>
<form data-form="ap" data-account="${esc(a.id)}"><label>Select a payment method<select name="methodId">${options(a.methodId)}</select></label><button type="submit" class="primary" aria-label="Save AutoPay payment method for ${esc(a.id)}">Save</button></form>
<button type="button" data-unenroll="${esc(a.id)}" aria-label="Unenroll ${esc(a.id)} from Autopay">Unenroll from Autopay</button><div data-panel></div>`
  : r.methods.length ? `<p class="status-line"><strong>Not enrolled in AutoPay</strong></p><form data-form="ap" data-account="${esc(a.id)}"><label>Select a Payment Method<select name="methodId" required><option value="">Select a payment method</option>${options('')}</select></label><button type="submit" class="primary" aria-label="Enroll ${esc(a.id)} in AutoPay">Enroll</button></form>`
  : `<p class="status-line"><strong>Not enrolled in AutoPay</strong></p><p>You have no payment methods. Please add a payment method to enable autopay. <a href="/wipp/e-wallet">eWallet</a></p>`}
</section>`).join('') : '<p>Please add at least one billing account to continue. <a href="/wipp/billing-accounts">Billing Accounts</a></p>'}
<section class="card"><h2>ACH Direct Withdrawal</h2><p>The City's ACH Direct Withdrawal (automatic bank draft) is a separate paper enrollment handled by the Board of Public Works. <a href="/wipp/direct-withdrawal">Click here to sign up for Direct Withdrawal</a></p></section>`);
    bind('[data-form=ap]', 'submit', async (e, f) => { const d = formData(f); if (!d.methodId) throw new Error('Please select a payment method.'); await api('autopay/enroll', { accountId: f.dataset.account, methodId: d.methodId }); location.reload(); });
    bind('[data-unenroll]', 'click', (e, b) => { const p = b.parentElement.querySelector('[data-panel]'); p.innerHTML = `<section role="dialog" class="dialog" aria-labelledby="un-h"><h3 id="un-h">Confirm Unenroll</h3><p>Unenroll from Autopay for account ${esc(b.dataset.unenroll)}? An AutoPay payment already prepared for the current bill may still process.</p><button type="button" class="primary" data-yes>Confirm Unenroll</button> <button type="button" data-no>Cancel</button></section>`;
      bind('[data-yes]', 'click', async () => { await api('autopay/unenroll', { accountId: b.dataset.unenroll, confirm: true }); location.reload(); }); bind('[data-no]', 'click', () => { p.innerHTML = ''; }); });
  }

  function directWithdrawalPage() {
    wipp('ACH Direct Withdrawal', `<h1>ACH Direct Withdrawal</h1><section class="card"><h2>How to Enroll</h2><ol><li>Complete the ACH Direct Withdrawal form (available from the Board of Public Works office)</li><li>Attach a voided check</li><li>Drop off or mail the completed form to:<address>City of Malden Board of Public Works<br>607 N Douglass St.<br>Malden, MO 63863</address></li></ol><p class="note">Direct Withdrawal is processed by the office, not online. An account enrolled in Direct Withdrawal cannot also be enrolled in AutoPay.</p></section><p><a href="${state.user ? '/wipp/auto-pay' : '/wipp/home'}">Back</a></p>`);
  }

  async function profilePage() {
    if (!requireUser()) return;
    const u = await api('profile');
    wipp('Profile', `<h1>Profile</h1><section class="card"><h2>Personal Account</h2><form data-form="profile"><div class="grid2"><label>First Name<input name="firstName" value="${esc(u.firstName)}" required></label><label>Last Name<input name="lastName" value="${esc(u.lastName)}" required></label></div><label>Email<input value="${esc(u.email)}" readonly aria-readonly="true"></label><label>Mobile Number<input name="mobile" value="${esc(u.mobile)}" placeholder="(999) 999-9999"></label><button type="submit" class="primary">Save</button></form></section>
<section class="card"><h2>Change Password</h2><form data-form="password"><label>Current Password<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>New Password<input name="password" type="password" autocomplete="new-password" required></label><label>Re-Type Password<input name="confirmPassword" type="password" autocomplete="new-password" required></label>${passwordRulesHtml()}<button type="submit" class="primary">Change Password</button></form></section>
<section class="card"><h2>Delete Account</h2><p>Deleting your portal account removes your login, AutoPay enrollments and scheduled payments. Your utility account with the City is not closed.</p><button type="button" data-delete>Delete Account</button><div data-panel></div></section>`);
    bind('[data-form=profile]', 'submit', async (e, f) => { await api('profile', formData(f)); app.querySelector('[data-error]').innerHTML = alertBox('Profile saved.', 'ok'); });
    bind('[data-form=password]', 'submit', async (e, f) => { await api('profile/password', formData(f)); f.reset(); app.querySelector('[data-error]').innerHTML = alertBox('Password changed.', 'ok'); });
    bind('[data-delete]', 'click', (e, b) => { const p = b.parentElement.querySelector('[data-panel]'); p.innerHTML = `<section role="dialog" class="dialog" aria-label="Delete Account"><p>Are you sure you want to delete your account?</p><button type="button" class="primary" data-yes>Yes</button> <button type="button" data-no>No</button></section>`;
      bind('[data-yes]', 'click', async () => { await api('profile/delete', { confirm: true }); go('/wipp/home?deleted=1'); }); bind('[data-no]', 'click', () => { p.innerHTML = ''; }); });
  }

  async function wippRoute() {
    state = await api('state');
    const m = path.match(/^\/wipp\/(view\/utility|v\/utility|pay|bill)\/([^/]+)$/);
    if (m) return m[1] === 'pay' ? payPage(decodeURIComponent(m[2])) : m[1] === 'bill' ? billPage(decodeURIComponent(m[2])) : viewPage(decodeURIComponent(m[2]));
    const routes = { '/wipp': loginPage, '/wipp/home': loginPage, '/wipp/lookup': lookupPage, '/wipp/create-account': createAccountPage, '/wipp/password': passwordPage, '/wipp/summary': summaryPage, '/wipp/billing-accounts': billingAccountsPage, '/wipp/e-billing': ebillingPage, '/wipp/e-wallet': walletPage, '/wipp/auto-pay': autopayPage, '/wipp/direct-withdrawal': directWithdrawalPage, '/wipp/profile': profilePage, '/wipp/link2gov': link2govPage, '/wipp/confirmation': confirmationPage };
    const page = routes[path];
    if (!page) return wipp('Not Found', `<h1>Page not found</h1><p><a href="/wipp/home">Return to Home</a></p>`);
    return page();
  }

  const publicRoutes = { '/': home, '/index.php': home, '/departments/public_works_office/index.php': publicWorks, '/how_do_i/faq.php': faq, '/how_do_i/pay_bill_online.php': payOnline };
  (async () => {
    try { if (publicRoutes[path]) publicRoutes[path](); else await wippRoute(); }
    catch (err) { if (err.status === 401) return go('/wipp/home?expired=1'); app.innerHTML = `<main id="main" class="w-main"><h1>Something Went Wrong</h1>${alertBox(err.message)}<p><a href="/wipp/home">Return to Home</a></p></main>`; }
  })();
})();
