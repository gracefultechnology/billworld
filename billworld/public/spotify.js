let loginEmail = null;
export function setSpotifyEmail(email) { loginEmail = email; }
export async function renderSpotify(ctx) {
  const { path, auth, api, app, escape, money, panel, input, navigate } = ctx;
  document.body.className = 'spotify';
  function shell(content) { app.innerHTML = `<header><strong>Spotify</strong><nav><a href="/">Home</a><a href="/spotify/account">Account</a><a href="/help">Support</a><a href="/mail">Email</a>${auth ? '<a href="/portal/logout">Log out</a>' : '<a href="/spotify/login">Log in</a>'}</nav></header><main><div id="error" role="alert"></div>${content}</main><footer>Billworld simulation · Public sign-in behavior documented; private billing screens reconstructed; subscription amounts are synthetic.</footer>`; }
  if (path === '/') { shell('<h1>Music for everyone</h1><p>Manage your Premium plan and payment details.</p><a class="button" href="/spotify/account">Manage your account</a>'); return; }
  if (['/spotify/login', '/portal/login'].includes(path)) {
    shell(`<section class="spotify-login"><h1>Welcome back</h1><form data-action="spotify-email">${input('email', 'Email', 'email', '', 'required autocomplete="username"')}<button>Continue</button></form><p>or</p><button type="button" class="google-button" data-google>Continue with Google</button><p><a class="button google-button" href="/spotify/login-method-unavailable?provider=facebook">Continue with Facebook</a></p><p><a class="button google-button" href="/spotify/login-method-unavailable?provider=apple">Continue with Apple</a></p>${new URLSearchParams(location.search).get('error') ? '<p>Google sign-in was cancelled. You can try again.</p>' : ''}</section>`); return;
  }
  if (path === '/spotify/password') {
    if (!loginEmail) return navigate('/spotify/login');
    shell(`<section class="spotify-login"><h1>Enter your password</h1><form data-action="spotify-login"><input name="email" type="hidden" value="${escape(loginEmail)}">${input('password', 'Password', 'password', '', 'required autocomplete="current-password"')}<button>Log in</button></form><a href="/portal/forgot">Forgot your password?</a></section>`); return;
  }
  if (path === '/spotify/login-method-unavailable') { shell('<h1>Login method not implemented yet</h1><p>This method is present on the source login page but remains in the Billworld backlog.</p><a href="/spotify/login">Return to login</a>'); return; }
  if (path === '/help') {
    shell('<h1>Spotify Support</h1>' + panel('<h2>Logging in with Google</h2><p>If Google is connected to your Spotify account, choose Continue with Google. Different email addresses may lead to a different account. Password recovery is available through email.</p><h2>Change your payment details</h2><p>Open Payment methods, choose Change, enter the replacement method, and confirm. A temporary authorization hold may occur. If a partner manages your subscription, update billing with that provider.</p><h2>Cancel Premium</h2><p>Open Manage your plan, then Cancel subscription. Premium access continues through the paid period before the account switches to Free.</p><a href="/spotify/account">Manage your account</a>')); return;
  }
  if (!auth) { navigate('/spotify/login'); return; }
  const dashboard = await api('dashboard'); const sub = dashboard.subscription;
  if (!sub) { shell('<h1>Your account</h1><p>No Premium subscription is associated with this account. Check the Google account you selected.</p><a href="/portal/logout">Log out and choose another account</a>'); return; }
  if (['/spotify/account', '/portal/account'].includes(path)) {
    shell('<h1>Account overview</h1>' + panel(`<h2>${escape(sub.plan)}</h2><p>${escape(auth.email)}</p><p>Status: ${escape(sub.status)}</p><p>${sub.status === 'active' ? 'Next billing date' : 'Premium access ends'}: <strong>${escape(sub.renewalDate)}</strong></p><p>${money(sub.amountCents)} per month · ${escape(sub.method.label)}</p><a class="button" href="/spotify/subscription">Manage your plan</a><a class="button" href="/spotify/payment-methods">Payment methods</a>`)); return;
  }
  if (path === '/spotify/subscription') {
    shell('<h1>Manage your plan</h1>' + panel(`<h2>${escape(sub.plan)}</h2><p>${sub.status === 'active' ? 'Next payment' : 'Access through'} ${escape(sub.renewalDate)}</p><p>Payment method: ${escape(sub.method.label)}</p>${sub.billingProvider === 'partner' ? '<p class="notice">Your subscription is managed by a billing partner. Update payments or cancellation with that provider.</p>' : '<a class="button" href="/spotify/payment-methods">Payment methods</a><p><a href="/spotify/cancel">Cancel subscription</a></p>'}`)); return;
  }
  if (path === '/spotify/payment-methods') {
    shell('<h1>Payment methods</h1>' + panel(`<p>Current method: ${escape(sub.method.label)}</p><p>Next billing date: ${escape(sub.renewalDate)}</p>${sub.billingProvider === 'partner' ? '<p>Your billing partner manages payment methods.</p>' : '<a class="button" href="/spotify/payment">Change</a>'}`)); return;
  }
  if (path === '/spotify/payment') {
    if (sub.billingProvider === 'partner') return navigate('/spotify/subscription');
    shell('<h1>Change payment method</h1>' + panel(`<p>Your next renewal on ${escape(sub.renewalDate)} will use the replacement card.</p><form data-action="spotify-card">${input('name', 'Name on card', 'text', '', 'required')}${input('number', 'Card number', 'text', '', 'required inputmode="numeric"')}${input('expiry', 'Expiration (MM/YY)', 'text', '', 'required')}${input('cvv', 'Security code', 'password', '', 'required')}<button>Add/Change payment method</button></form><p id="card-notice"></p>`)); return;
  }
  if (path === '/spotify/cancel') {
    shell('<h1>Cancel Premium?</h1>' + panel(`<p>Your Premium benefits will remain available through ${escape(sub.renewalDate)}. Your next renewal will be stopped.</p><form data-action="spotify-cancel"><button>Continue to cancel</button></form><a href="/spotify/subscription">Keep Premium</a>`)); return;
  }
  shell('<h1>Page not implemented</h1><a href="/spotify/account">Return to your account</a>');
}
