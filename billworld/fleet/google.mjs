// Mock Google identity provider (separate origin) + the relying-party side of "Sign in with Google" for Fleet billers.
// No real Google endpoint, credential or brand asset is used.
//
// IdP (own HTTP server, default http://localhost:<googlePort>; a different host than the fleet's 127.0.0.1, so
// cookies never mix):
//   GET  /.well-known/openid-configuration, GET /oauth2/v3/certs (RS256 JWKS)
//   GET  /o/oauth2/v2/auth?client_id&request_uri     authorization (Pushed Authorization Request required)
//   GET|POST /signin/chooser | /signin/identifier | /signin/password | /consent ; POST /signin/cancel
//   POST /token                                      code -> id_token (client_secret_post + PKCE S256)
// Accounts are episode-scoped ("tenant" = episode): the persona's account (email = persona email, password = the
// episode mailbox password: one account for mail and identity) and, with ep.channels.google.decoy, a second
// account that no biller knows. An IdP browser session (cookie) remembers signed-in accounts for the chooser.
// Prior consent per client is remembered (ep.identity.google.grants) and skips the consent screen.
//
// RP (inside the fleet server): GET /b/<id>/auth/google starts the flow (state cookie, nonce, PKCE verifier pushed
// server-side), GET /b/<id>/auth/google/callback validates state, exchanges the one-use code with the verifier,
// verifies the id_token (signature, iss, aud, exp, nonce, email_verified) and links the Google subject to the
// biller account whose sign-in email matches. Events: google_login_started, google_consent_granted|denied,
// google_signin_failed, google_login_cancelled, google_login_failed{reason}, google_linked, login{method:'google'}.
import http from 'node:http';
import { randomBytes, createHash, createHmac, generateKeyPairSync, createSign, createVerify, createPublicKey, timingSafeEqual } from 'node:crypto';
import { Fault } from './engine.mjs';
import { html, raw, esc } from './kit.mjs';

const tok = (n = 24) => randomBytes(n).toString('base64url');
const s256 = v => createHash('sha256').update(String(v)).digest('base64url');
const b64json = v => Buffer.from(JSON.stringify(v)).toString('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const MIN = 60000;
const PAR_TTL = 10 * MIN, TX_TTL = 20 * MIN, CODE_TTL = 5 * MIN, SESSION_TTL = 12 * 60 * MIN;

// Which billers offer Google sign-in: research evidence (profile.login.socialProviders) or a template that declares
// it (meta.socialProviders includes 'google' / meta.googleLogin === true). Offline billers never do.
export function googleSupport(biller, template, overrides = null) {
  if (!biller || biller.template === 'offline' || biller.capabilities?.online_account?.support === 'unsupported') return null;
  const o = overrides?.[biller.id]; if (Array.isArray(o)) return o.map(String).includes('google') ? 'override' : null;
  let profile = null; try { profile = biller.profile; } catch { profile = null; }
  if (Array.isArray(profile?.login?.socialProviders) && profile.login.socialProviders.map(s => String(s).toLowerCase()).includes('google')) return 'observed_public';
  const m = template?.meta || {};
  if (m.googleLogin === true || (Array.isArray(m.socialProviders) && m.socialProviders.includes('google'))) return 'template';
  return null;
}

// ---------- pages ----------
const CSS = `*{box-sizing:border-box}body{margin:0;font:14px/1.5 Roboto,Arial,Helvetica,sans-serif;color:#1f1f1f;background:#f0f4f9}main{max-width:1040px;margin:48px auto;background:#fff;border-radius:28px;padding:36px 40px;display:grid;grid-template-columns:1fr 1fr;gap:32px}@media(max-width:720px){main{grid-template-columns:1fr;margin:0;border-radius:0;padding:24px 16px;min-height:100vh}}.g{font-size:28px;font-weight:500;color:#4285f4}h1{font-size:32px;font-weight:400;margin:16px 0 8px}p{margin:0 0 12px;overflow-wrap:anywhere}.who{display:inline-block;border:1px solid #c4c7c5;border-radius:16px;padding:2px 12px;margin:4px 0 12px}label{display:block;margin:12px 0;color:#444746}input[type=email],input[type=password],input[type=text]{display:block;width:100%;padding:14px;border:1px solid #747775;border-radius:4px;font-size:16px;margin-top:6px}input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid #0b57d0;outline-offset:2px}.err{color:#b3261e}.row{display:flex;justify-content:flex-end;gap:12px;align-items:center;margin-top:24px;flex-wrap:wrap}button{border:0;border-radius:20px;padding:10px 24px;font-size:14px;cursor:pointer;background:#0b57d0;color:#fff}button.text{background:none;color:#0b57d0}ul.acc{list-style:none;padding:0;margin:0}ul.acc li{border-bottom:1px solid #e1e3e1}ul.acc button{width:100%;text-align:left;background:none;color:#1f1f1f;border-radius:0;padding:12px 4px}ul.acc small{display:block;color:#444746}.scopes li{margin:6px 0}.small{color:#444746;font-size:12px}a{color:#0b57d0}`;
// form-action must also allow the relying parties: Chrome applies it to the redirect that follows a form POST.
const pageCsp = targets => `default-src 'none'; style-src 'self'; img-src 'self' data:; form-action 'self' ${targets.join(' ')}; frame-ancestors 'none'; base-uri 'none'`;
const doc = (title, left, right) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link rel="stylesheet" href="/style.css"></head><body><main><div><div class="g" aria-label="Google">G</div>${left}</div><div>${right}</div></main></body></html>`;

export class MockGoogle {
  // resolveClient(clientId) -> { clientId, name, secret, redirectUris: [...], tenantOk?(ep) } | null
  constructor({ world, resolveClient, host = '127.0.0.1', publicHost = 'localhost', port = 0, quiet = true } = {}) {
    Object.assign(this, { world, resolveClient, host, publicHost, port, quiet, formTargets: ['http://127.0.0.1:*', 'http://localhost:*'] });
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = privateKey; this.publicKey = publicKey; this.kid = s256(publicKey.export({ type: 'spki', format: 'der' })).slice(0, 16);
    this.secret = tok(32);
    this.pars = new Map(); this.txs = new Map(); this.codes = new Map(); this.sessions = new Map();
  }
  get issuer() { return this._issuer; }
  jwks() { const jwk = this.publicKey.export({ format: 'jwk' }); return { keys: [{ ...jwk, kid: this.kid, alg: 'RS256', use: 'sig' }] }; }
  ck(name) { return `${name}_${this.boundPort}`; }

  // ---- tenant (episode) accounts ----
  accounts(ep) {
    const sub = email => String(BigInt('0x' + createHmac('sha256', this.secret).update(`${ep.id}:${email}`).digest('hex').slice(0, 15)) + 100000000000000000000n);
    const list = [{ sub: sub(ep.persona.email), email: ep.persona.email, name: ep.persona.name, given_name: ep.persona.first, family_name: ep.persona.last, password: () => ep.mailPassword }];
    if (ep.channels?.google?.decoy) { const email = `${ep.persona.first}.${ep.persona.last}@work.billworld.test`.toLowerCase(); list.push({ sub: sub(email), email, name: `${ep.persona.name} (Work)`, given_name: ep.persona.first, family_name: ep.persona.last, password: () => ep.mailPassword }); }
    return list;
  }
  identity(ep) { return (ep.identity ||= {}).google ||= { grants: {}, links: {} }; }
  sweep() { const now = Date.now(); for (const m of [this.pars, this.txs, this.codes, this.sessions]) for (const [k, v] of m) if (v.expires < now) m.delete(k); }

  // ---- RP-facing (server-to-server) ----
  pushAuthorization({ clientId, clientSecret, redirectUri, scope = 'openid email profile', state, nonce, codeChallenge, codeChallengeMethod, tenant, loginHint, billerId = null }) {
    this.sweep();
    const c = this.resolveClient(clientId);
    if (!c || !same(clientSecret, c.secret)) throw new Fault('invalid_client', 401, 'invalid_client');
    if (!c.redirectUris.includes(redirectUri)) throw new Fault('redirect_uri_mismatch', 400, 'redirect_uri_mismatch');
    if (!String(scope).split(/\s+/).includes('openid')) throw new Fault('invalid_scope: openid required', 400, 'invalid_scope');
    if (!state || !nonce || !codeChallenge || codeChallengeMethod !== 'S256') throw new Fault('invalid_request: state, nonce and S256 code_challenge are required', 400, 'invalid_request');
    this.world.episode(tenant);
    const requestUri = `urn:ietf:params:oauth:request_uri:${tok(18)}`;
    this.pars.set(requestUri, { clientId, redirectUri, scope, state, nonce, codeChallenge, tenant, loginHint, billerId, expires: Date.now() + PAR_TTL, used: false });
    return { request_uri: requestUri, expires_in: PAR_TTL / 1000 };
  }
  authorizeUrl(clientId, requestUri) { return `${this.issuer}/o/oauth2/v2/auth?${new URLSearchParams({ client_id: clientId, request_uri: requestUri })}`; }
  exchangeCode({ code, clientId, clientSecret, redirectUri, codeVerifier }) {
    const c = this.resolveClient(clientId);
    if (!c || !same(clientSecret, c.secret)) throw new Fault('invalid_client', 401, 'invalid_client');
    const g = typeof code === 'string' && this.codes.get(code);
    if (!g) throw new Fault('invalid_grant: unknown code', 400, 'invalid_grant');
    if (g.used) { this.codes.delete(code); throw new Fault('invalid_grant: code already used', 400, 'invalid_grant'); }
    g.used = true;
    if (g.expires < Date.now()) throw new Fault('invalid_grant: code expired', 400, 'invalid_grant');
    if (g.clientId !== clientId || g.redirectUri !== redirectUri) throw new Fault('invalid_grant: client or redirect_uri mismatch', 400, 'invalid_grant');
    if (typeof codeVerifier !== 'string' || codeVerifier.length < 43 || s256(codeVerifier) !== g.codeChallenge) throw new Fault('invalid_grant: PKCE verification failed', 400, 'invalid_grant');
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: this.issuer, azp: clientId, aud: clientId, sub: g.account.sub, email: g.account.email, email_verified: true, name: g.account.name, given_name: g.account.given_name, family_name: g.account.family_name, nonce: g.nonce, iat: now, exp: now + 3600 };
    return { access_token: `ya29.mock-${tok(24)}`, token_type: 'Bearer', expires_in: 3599, scope: g.scope, id_token: this.sign(claims) };
  }
  sign(claims) {
    const data = `${b64json({ alg: 'RS256', kid: this.kid, typ: 'JWT' })}.${b64json(claims)}`;
    return `${data}.${createSign('RSA-SHA256').update(data).sign(this.privateKey).toString('base64url')}`;
  }
  // RP verification against the published JWKS (not the private key object).
  verifyIdToken(jwt, { audience, nonce }) {
    const parts = String(jwt || '').split('.');
    if (parts.length !== 3) throw new Fault('Malformed identity token', 401, 'bad_token');
    let h, c; try { h = JSON.parse(Buffer.from(parts[0], 'base64url')); c = JSON.parse(Buffer.from(parts[1], 'base64url')); } catch { throw new Fault('Malformed identity token', 401, 'bad_token'); }
    const jwk = this.jwks().keys.find(k => k.kid === h.kid);
    if (h.alg !== 'RS256' || !jwk) throw new Fault('Unknown identity token key', 401, 'bad_token');
    const ok = createVerify('RSA-SHA256').update(`${parts[0]}.${parts[1]}`).verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
    if (!ok) throw new Fault('Invalid identity token signature', 401, 'bad_signature');
    const now = Math.floor(Date.now() / 1000);
    if (c.iss !== this.issuer) throw new Fault('Identity token issuer mismatch', 401, 'bad_issuer');
    if (c.aud !== audience) throw new Fault('Identity token audience mismatch', 401, 'bad_audience');
    if (!(c.exp > now) || c.iat > now + 60) throw new Fault('Identity token expired', 401, 'expired_token');
    if (!nonce || c.nonce !== nonce) throw new Fault('Identity token nonce mismatch', 401, 'bad_nonce');
    if (c.email_verified !== true) throw new Fault('Google email is not verified', 401, 'unverified_email');
    return c;
  }
  // Forget every in-flight request and browser session for an episode (admin reset/delete).
  resetTenant(epId) { for (const m of [this.pars, this.txs, this.codes]) for (const [k, v] of m) if (v.tenant === epId) m.delete(k); for (const [k, v] of this.sessions) if (v.tenant === epId) this.sessions.delete(k); }

  // ---- browser-facing ----
  redirectBack(tx, params) { tx.done = true; const u = new URL(tx.redirectUri); for (const [k, v] of Object.entries({ ...params, state: tx.state })) u.searchParams.set(k, v); return u.toString(); }
  issueCode(tx, ep, account) {
    const code = `4/${tok(30)}`;
    this.codes.set(code, { clientId: tx.clientId, redirectUri: tx.redirectUri, codeChallenge: tx.codeChallenge, nonce: tx.nonce, scope: tx.scope, tenant: tx.tenant, account: { ...account, password: undefined }, expires: Date.now() + CODE_TTL, used: false });
    return this.redirectBack(tx, { code, scope: tx.scope, iss: this.issuer, authuser: '0' });
  }
  csrfFor(tx) { return createHmac('sha256', this.secret).update(`csrf:${tx.id}:${tx.binding}`).digest('base64url').slice(0, 24); }

  async handle(req, res) {
    const url = new URL(req.url, 'http://idp.invalid');
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim()).filter(Boolean).map(s => { const i = s.indexOf('='); return [s.slice(0, i), decodeURIComponent(s.slice(i + 1))]; }));
    const headers = { 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    const send = (status, body, type = 'text/html; charset=utf-8', extra = {}) => { res.writeHead(status, { ...headers, 'Content-Type': type, ...(type.startsWith('text/html') ? { 'Content-Security-Policy': pageCsp(this.formTargets) } : {}), ...extra }); res.end(body); };
    const json = (status, data) => send(status, JSON.stringify(data), 'application/json');
    const go = (location, cookieList = []) => { res.writeHead(303, { ...headers, Location: location, 'Set-Cookie': cookieList }); res.end(); };
    const setCk = (name, value, maxAge) => `${this.ck(name)}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/${maxAge != null ? `; Max-Age=${maxAge}` : ''}`;
    const errorPage = (status, title, detail) => send(status, doc('Error – Sign in', html`<h1>${title}</h1>`, html`<p>${detail}</p><p class="small">The application that sent you here made an invalid request. Go back to the site and try again.</p>`));
    const body = async () => { let d = ''; for await (const c of req) { d += c; if (d.length > 16384) throw new Fault('Request too large', 413); } return (req.headers['content-type'] || '').includes('json') ? JSON.parse(d || '{}') : Object.fromEntries(new URLSearchParams(d)); };
    try {
      const p = url.pathname;
      if (p === '/style.css') return send(200, CSS, 'text/css');
      if (p === '/.well-known/openid-configuration') return json(200, { issuer: this.issuer, authorization_endpoint: `${this.issuer}/o/oauth2/v2/auth`, token_endpoint: `${this.issuer}/token`, jwks_uri: `${this.issuer}/oauth2/v3/certs`, response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], scopes_supported: ['openid', 'email', 'profile'], code_challenge_methods_supported: ['S256'], require_pushed_authorization_requests: true, token_endpoint_auth_methods_supported: ['client_secret_post'] });
      if (p === '/oauth2/v3/certs') return json(200, this.jwks());
      if (p === '/token' && req.method === 'POST') {
        try { const b = await body(); if (b.grant_type !== 'authorization_code') throw new Fault('unsupported_grant_type', 400, 'unsupported_grant_type'); return json(200, this.exchangeCode({ code: b.code, clientId: b.client_id, clientSecret: b.client_secret, redirectUri: b.redirect_uri, codeVerifier: b.code_verifier })); }
        catch (e) { if (!(e instanceof Fault)) throw e; return json(e.status, { error: e.code, error_description: e.message }); }
      }
      if (p === '/' || p === '') return send(200, doc('Mock Google Accounts', html`<h1>Mock Google Accounts</h1>`, html`<p>This local identity provider signs Billworld personas in to Billworld billers that offer “Sign in with Google”. Start from a biller's sign-in page.</p>`));

      if (p === '/o/oauth2/v2/auth' && req.method === 'GET') {
        this.sweep();
        const clientId = url.searchParams.get('client_id'); const requestUri = url.searchParams.get('request_uri');
        const c = clientId && this.resolveClient(clientId);
        if (!c) return errorPage(401, 'Access blocked: authorization error', 'Error 401: invalid_client. The OAuth client was not found.');
        const par = requestUri && this.pars.get(requestUri);
        if (!par || par.used || par.expires < Date.now() || par.clientId !== clientId) return errorPage(400, 'Access blocked: this request is invalid', 'Error 400: invalid_request. The sign-in request expired or was already used. Go back to the site and choose “Sign in with Google” again.');
        par.used = true;
        const binding = cookies[this.ck('GTX')] || tok(16);
        const tx = { id: tok(16), binding, ...par, clientName: c.name, expires: Date.now() + TX_TTL, fails: 0, done: false, account: null };
        this.txs.set(tx.id, tx);
        const sess = this.sessions.get(cookies[this.ck('GSID')]);
        const signedIn = sess && sess.tenant === tx.tenant && sess.accounts.length;
        return go(`/signin/${signedIn ? 'chooser' : 'identifier'}?tx=${tx.id}`, [setCk('GTX', binding)]);
      }

      if (p === '/favicon.ico') return send(204, '', 'image/x-icon');
      if (!['/signin/chooser', '/signin/identifier', '/signin/password', '/consent', '/signin/cancel'].includes(p)) return errorPage(404, 'Not found', 'That page does not exist.');
      // Every sign-in step below needs a live transaction bound to this browser.
      let input = {};
      if (req.method === 'POST') { const o = req.headers.origin; if (o && o !== 'null' && o !== this.issuer && o !== `http://${req.headers.host}`) return errorPage(403, 'Request blocked', 'Cross-site request.'); input = await body(); }
      const tx = this.txs.get(input.tx || url.searchParams.get('tx'));
      if (!tx || tx.expires < Date.now() || tx.done) return errorPage(400, 'This sign-in session ended', 'The sign-in request expired or was already completed. Go back to the site and start again.');
      if (!same(cookies[this.ck('GTX')], tx.binding)) return errorPage(400, 'This sign-in session ended', 'Open the sign-in link in the same browser you started from.');
      if (req.method === 'POST' && !same(input.csrf, this.csrfFor(tx))) return errorPage(403, 'Request blocked', 'Reload the page and try again.');
      const ep = this.world.episode(tx.tenant);
      const accounts = this.accounts(ep);
      const csrf = html`<input type="hidden" name="tx" value="${tx.id}"><input type="hidden" name="csrf" value="${this.csrfFor(tx)}">`;
      const cancelForm = html`<form method="post" action="/signin/cancel">${csrf}<button class="text" type="submit">Cancel</button></form>`;
      const app = html`<p>to continue to <b>${tx.clientName}</b></p>`;
      const sessCookie = () => { let sid = cookies[this.ck('GSID')]; let s = this.sessions.get(sid); if (!s || s.tenant !== tx.tenant) { sid = tok(18); s = { tenant: tx.tenant, accounts: [], expires: Date.now() + SESSION_TTL }; this.sessions.set(sid, s); } return { sid, s }; };
      const afterSignIn = (account, setCookies = []) => {
        tx.account = account;
        const grants = this.identity(ep).grants;
        if (grants[tx.clientId]) { this.world.event(ep, tx.billerId || null, 'google_consent_reused', {}); this.world.persist(ep); return go(this.issueCode(tx, ep, account), setCookies); }
        return go(`/consent?tx=${tx.id}`, setCookies);
      };

      if (p === '/signin/cancel' && req.method === 'POST') { this.world.event(ep, billerOf(tx), 'google_consent_denied', { stage: 'signin' }); this.world.persist(ep); return go(this.redirectBack(tx, { error: 'access_denied' })); }

      if (p === '/signin/chooser') {
        const sess = this.sessions.get(cookies[this.ck('GSID')]);
        const signed = sess && sess.tenant === tx.tenant ? accounts.filter(a => sess.accounts.includes(a.sub)) : [];
        if (req.method === 'POST') {
          if (input.account === 'other') return go(`/signin/identifier?tx=${tx.id}`);
          const a = signed.find(x => x.sub === input.account);
          if (!a) return go(`/signin/identifier?tx=${tx.id}`);
          return afterSignIn(a);
        }
        if (!signed.length) return go(`/signin/identifier?tx=${tx.id}`);
        return send(200, doc('Sign in – Google Accounts', html`<h1>Choose an account</h1>${app}`, html`<form method="post" action="/signin/chooser">${csrf}<ul class="acc">${signed.map(a => html`<li><button type="submit" name="account" value="${a.sub}">${a.name}<small>${a.email}</small></button></li>`)}<li><button type="submit" name="account" value="other">Use another account</button></li></ul></form><div class="row">${cancelForm}</div>`));
      }
      if (p === '/signin/identifier') {
        let error = null;
        if (req.method === 'POST') {
          const email = String(input.identifier || '').trim().toLowerCase();
          const a = accounts.find(x => x.email === email);
          if (a) { tx.pendingEmail = a.email; return go(`/signin/password?tx=${tx.id}`); }
          error = email ? 'Couldn’t find your Google Account' : 'Enter an email or phone number';
        }
        const hint = !error && tx.loginHint ? tx.loginHint : '';
        return send(error ? 400 : 200, doc('Sign in – Google Accounts', html`<h1>Sign in</h1>${app}`, html`<form method="post" action="/signin/identifier">${csrf}<label for="identifier">Email or phone<input id="identifier" name="identifier" type="email" autocomplete="username" required value="${hint}"${error ? raw(' aria-invalid="true" aria-describedby="err"') : ''}></label>${error ? html`<p class="err" id="err" role="alert">${error}</p>` : ''}<p class="small">Not your computer? Use a private browsing window to sign in.</p><div class="row"><button type="submit">Next</button></div></form><div class="row">${cancelForm}</div>`));
      }
      if (p === '/signin/password') {
        const a = accounts.find(x => x.email === tx.pendingEmail);
        if (!a) return go(`/signin/identifier?tx=${tx.id}`);
        let error = null;
        if (req.method === 'POST') {
          if (tx.fails >= 5) error = 'Too many failed attempts. Try again later.';
          else if (typeof input.password === 'string' && same(input.password, a.password())) {
            const { sid, s } = sessCookie(); if (!s.accounts.includes(a.sub)) s.accounts.push(a.sub);
            return afterSignIn(a, [setCk('GSID', sid, SESSION_TTL / 1000)]);
          } else { tx.fails++; this.world.event(ep, billerOf(tx), 'google_signin_failed', {}); this.world.persist(ep); error = tx.fails >= 5 ? 'Too many failed attempts. Try again later.' : 'Wrong password. Try again or click Forgot password to reset it.'; }
        }
        return send(error ? 400 : 200, doc('Sign in – Google Accounts', html`<h1>Welcome</h1><p class="who">${a.email}</p>`, html`<form method="post" action="/signin/password">${csrf}<label for="password">Enter your password<input id="password" name="password" type="password" autocomplete="current-password" required${error ? raw(' aria-invalid="true" aria-describedby="err"') : ''}></label>${error ? html`<p class="err" id="err" role="alert">${error}</p>` : ''}<p class="small">Forgot password? Use the password for your Billworld Mail inbox.</p><div class="row"><a href="/signin/identifier?tx=${tx.id}">Use another account</a><button type="submit">Next</button></div></form><div class="row">${cancelForm}</div>`));
      }
      if (p === '/consent') {
        const a = tx.account; if (!a) return go(`/signin/identifier?tx=${tx.id}`);
        if (req.method === 'POST') {
          if (input.decision === 'allow') { this.identity(ep).grants[tx.clientId] = { at: ep.clock, scope: tx.scope }; this.world.event(ep, billerOf(tx), 'google_consent_granted', {}); this.world.persist(ep); return go(this.issueCode(tx, ep, a)); }
          this.world.event(ep, billerOf(tx), 'google_consent_denied', { stage: 'consent' }); this.world.persist(ep);
          return go(this.redirectBack(tx, { error: 'access_denied' }));
        }
        return send(200, doc(`Sign in to ${tx.clientName} – Google Accounts`, html`<h1>Sign in to ${tx.clientName}</h1><p class="who">${a.email}</p>`, html`<p>By continuing, Google will share your name, email address and profile picture with ${tx.clientName}.</p><ul class="scopes"><li>Your name and profile picture</li><li>Your email address (${a.email})</li></ul><p class="small">You can manage Sign in with Google in your Google Account. ${tx.clientName}'s privacy policy and terms apply.</p><form method="post" action="/consent">${csrf}<div class="row"><button class="text" type="submit" name="decision" value="deny">Cancel</button><button type="submit" name="decision" value="allow">Continue</button></div></form>`));
      }
      return errorPage(404, 'Not found', 'That page does not exist.');
    } catch (e) {
      if (!(e instanceof Fault) && !this.quiet) console.error(e);
      if (res.headersSent) return;
      return errorPage(e instanceof Fault ? e.status : 500, 'Something went wrong', e instanceof Fault ? e.message : 'Unexpected error');
    }
  }

  async listen() {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise(r => this.server.listen(this.port, this.host, r));
    this.boundPort = this.server.address().port;
    this._issuer = `http://${this.publicHost}:${this.boundPort}`;
    return this;
  }
  close() { return new Promise(r => this.server ? this.server.close(r) : r()); }
}
const billerOf = tx => tx.billerId || null;

// ---------- relying party (fleet server side) ----------
// clientId for a biller; secrets are HMACs of a per-server secret so the IdP and RP agree without storage.
export function createGoogleRp({ world, idp, baseUrl, secret = tok(32), enabled }) {
  const clientIdFor = billerId => `fleet-${billerId}.apps.billworld.test`;
  const billerFromClient = clientId => String(clientId || '').match(/^fleet-([\w-]+)\.apps\.billworld\.test$/)?.[1] || null;
  const secretFor = clientId => createHmac('sha256', secret).update(`client:${clientId}`).digest('base64url');
  const redirectFor = billerId => `${baseUrl()}/b/${billerId}/auth/google/callback`;
  idp.resolveClient = clientId => {
    const id = billerFromClient(clientId); if (!id) return null;
    let b; try { b = world.biller(id); } catch { return null; }
    if (!enabled(b)) return null;
    return { clientId, name: b.entry.name, secret: secretFor(clientId), redirectUris: [redirectFor(id)] };
  };
  return {
    clientIdFor, redirectFor,
    // Starts a flow: returns { location, pending } where pending is stored on the episode under its state.
    begin(ep, billerId, { next } = {}) {
      world.guard(ep);
      const state = tok(18), nonce = tok(18), verifier = tok(48);
      const clientId = clientIdFor(billerId);
      const { request_uri } = idp.pushAuthorization({ clientId, clientSecret: secretFor(clientId), redirectUri: redirectFor(billerId), state, nonce, codeChallenge: s256(verifier), codeChallengeMethod: 'S256', tenant: ep.id, billerId });
      const oauth = (ep.oauth ||= {});
      for (const [k, v] of Object.entries(oauth)) if (v.wallExpires < Date.now() || v.used) delete oauth[k];
      oauth[state] = { billerId, nonce, verifier, next: next || null, wallExpires: Date.now() + 20 * MIN, used: false };
      world.event(ep, billerId, 'google_login_started', {}); world.persist(ep);
      return { location: idp.authorizeUrl(clientId, request_uri), state };
    },
    // Validates the callback. Returns { sid?, next, cancelled?, error? } — never throws for user-facing failures.
    callback(ep, billerId, query, stateCookie) {
      world.guard(ep);
      const fail = (reason, message) => { world.event(ep, billerId, 'google_login_failed', { reason }); world.persist(ep); return { error: message, reason }; };
      const state = query.state;
      const pending = typeof state === 'string' && ep.oauth?.[state];
      if (!pending || !same(stateCookie, state) || pending.billerId !== billerId) return fail('state_mismatch', 'Sign in with Google could not be completed (the request did not match). Try again.');
      if (pending.used || pending.wallExpires < Date.now()) return fail('state_expired', 'That Google sign-in request expired. Try again.');
      pending.used = true;
      if (query.error) { world.event(ep, billerId, 'google_login_cancelled', { error: String(query.error).slice(0, 40) }); world.persist(ep); return { cancelled: true, error: 'Google sign-in was cancelled.' }; }
      if (query.iss && query.iss !== idp.issuer) return fail('issuer_mismatch', 'Sign in with Google could not be completed. Try again.');
      let claims;
      try {
        const clientId = clientIdFor(billerId);
        const t = idp.exchangeCode({ code: query.code, clientId, clientSecret: secretFor(clientId), redirectUri: redirectFor(billerId), codeVerifier: pending.verifier });
        claims = idp.verifyIdToken(t.id_token, { audience: clientId, nonce: pending.nonce });
      } catch (e) { if (!(e instanceof Fault)) throw e; return fail(e.code || 'token_error', 'Sign in with Google could not be completed. Try again.'); }
      const b = world.biller(billerId);
      if (world.isOffline(b)) return fail('unsupported', 'Online accounts are not available for this biller.');
      const acct = world.account(ep, billerId);
      const g = idp.identity(ep);
      const linkedSub = g.links[billerId]?.sub;
      if (linkedSub && linkedSub !== claims.sub) return fail('different_google_account', `This ${b.brand.shortName} account is linked to a different Google account.`);
      if (!linkedSub && (!acct.registered || !acct.emailVerified || String(acct.username).toLowerCase() !== String(claims.email).toLowerCase()))
        return fail('no_matching_account', `We couldn't find a ${b.brand.shortName} online account for ${claims.email}. Sign in with your user ID and password, or register first.`);
      if (world.releaseLock) world.releaseLock(ep, acct);
      if (acct.lockedUntil > ep.clock) return fail('locked', 'Your account is temporarily locked after too many attempts. Reset your password or try again later.');
      if (!linkedSub) { g.links[billerId] = { sub: claims.sub, email: claims.email, at: ep.clock }; world.event(ep, billerId, 'google_linked', { email: claims.email }); }
      const sid = world.startSession(ep, billerId, true);
      acct.failedLogins = 0;
      world.event(ep, billerId, 'login', { method: 'google' }); world.persist(ep);
      return { sid, next: pending.next };
    }
  };
}
