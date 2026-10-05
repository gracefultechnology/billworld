const app = document.querySelector('#google-app');
const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const request = new URLSearchParams(location.search).get('request');
let selected = null, csrf = null, info;
async function api(path, data) {
  const res = await fetch(`/api/${path}`, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request, ...data }) } : {});
  const result = await res.json(); if (!res.ok) throw new Error(result.error); return result;
}
function frame(content) { app.innerHTML = `<section class="google-card"><p class="google-word">Google</p><p>Sign in with Google</p><div id="error" role="alert"></div>${content}</section>`; }
function chooser() { frame(`<h1>Choose an account</h1><p>to continue to ${escape(info.app)}</p><div class="google-accounts">${info.accounts.map(u => `<button data-sub="${u.sub}"><strong>${escape(u.name)}</strong><span>${escape(u.email)}</span></button>`).join('')}</div>`); }
app.addEventListener('click', async e => {
  const pick = e.target.closest('[data-sub]');
  if (pick) { selected = info.accounts.find(u => u.sub === pick.dataset.sub); frame(`<h1>Welcome</h1><p>${escape(selected.email)}</p><form id="login"><label for="password">Enter your Google password</label><input id="password" name="password" type="password" required autocomplete="current-password"><button>Next</button></form><button id="back">Choose another account</button>`); }
  if (e.target.id === 'back') chooser();
  const consent = e.target.closest('[data-consent]');
  if (consent) {
    consent.disabled = true;
    try { const result = await api('consent', { csrf, allow: consent.dataset.consent === 'yes' }); location.href = result.redirect; }
    catch (err) { document.querySelector('#error').textContent = err.message; consent.disabled = false; }
  }
});
app.addEventListener('submit', async e => {
  if (e.target.id !== 'login') return; e.preventDefault(); const button = e.target.querySelector('button'); button.disabled = true;
  try {
    const result = await api('login', { sub: selected.sub, password: new FormData(e.target).get('password') }); csrf = result.csrf;
    frame(`<h1>${escape(info.app)} wants access to your Google Account</h1><p>${escape(result.user.email)}</p><p>${escape(info.app)} will receive your name, email address, and a stable account identifier.</p><button data-consent="no">Cancel</button><button data-consent="yes">Continue</button>`);
  } catch (err) { document.querySelector('#error').textContent = err.message; button.disabled = false; }
});
api(`request?request=${encodeURIComponent(request)}`).then(r => { info = r; chooser(); }).catch(err => frame(`<h1>Sign-in unavailable</h1><p>${escape(err.message)}</p>`));
