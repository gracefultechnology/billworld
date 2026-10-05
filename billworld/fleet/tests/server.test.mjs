// HTTP-level tests for server.mjs: episode cookies, CSRF, mailbox hardening, input robustness, session-expiry checkout.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start } from '../server.mjs';
import { money } from '../engine.mjs';

const PASSWORD = 'Billworld-2026!';
let server, dataDir, port;
before(async () => { dataDir = mkdtempSync(join(tmpdir(), 'fleet-srv-')); server = await start({ port: 0, adminPort: 0, dataDir, quiet: true }); port = new URL(server.baseUrl).port; });
after(() => server.close());

const firstOnline = tpl => server.world.catalog.byTemplate.get(tpl).find(id => server.world.biller(id).capabilities.online_account.support !== 'unsupported');

// Minimal cookie-jar client (no redirects followed).
function client(extra = {}) {
  const jar = new Map();
  const c = {
    jar,
    async req(path, { method = 'GET', form, headers = {} } = {}) {
      const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      const r = await fetch(server.baseUrl + path, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...extra, ...headers }, body: form ? new URLSearchParams(form).toString() : undefined });
      for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (/Max-Age=0\b/.test(sc) || v === '') jar.delete(k); else jar.set(k, v); }
      const body = await r.text();
      return { status: r.status, location: r.headers.get('location'), headers: r.headers, body, csrf: body.match(/name="_csrf" value="([^"]*)"/)?.[1] };
    },
    async enter(episode) { const u = new URL(episode.entryUrl); return c.req(u.pathname + u.search); }
  };
  return c;
}
const newEpisode = (billerId, extra = {}) => server.admin('/episodes', { seed: `srv-${Math.random()}`, billerId, ...extra });

test('cookieless visit renders without creating an episode; the second visit (cookie returned) creates exactly one', async () => {
  const id = firstOnline('smarthub'); const before = server.world.episodes.size;
  for (let i = 0; i < 20; i++) { const r = await fetch(`${server.baseUrl}/b/${id}/`); assert.equal(r.status, 200); }
  assert.equal(server.world.episodes.size, before, 'no episodes retained for cookieless crawls');
  const c = client();
  const r1 = await c.req(`/b/${id}/`); assert.equal(r1.status, 200); assert.ok(c.jar.has(`bwf_new_${port}`));
  const r2 = await c.req(`/b/${id}/`); assert.equal(r2.status, 200); assert.ok(c.jar.has(`bwf_ep_${port}`));
  assert.equal(server.world.episodes.size, before + 1);
  assert.ok(!readdirSync(dataDir).some(f => f.includes(c.jar.get(`bwf_ep_${port}`))), 'open-world episode not persisted before any mutation');
});

test('a lost or invalid episode cookie shows an explicit notice instead of silently starting over', async () => {
  const id = firstOnline('smarthub'); const c = client();
  c.jar.set(`bwf_ep_${port}`, 'ep-doesnotexist'); c.jar.set(`bwf_at_${port}`, 'x');
  const before = server.world.episodes.size;
  const r = await c.req(server.urlFor(server.templates.get('smarthub'), id, 'dashboard'));
  assert.equal(r.status, 410); assert.match(r.body, /session has ended/i); assert.match(r.body, /start-demo/);
  assert.equal(server.world.episodes.size, before);
  const s = await c.req(`/start-demo?to=${encodeURIComponent(`/b/${id}/`)}`); assert.equal(s.status, 303); assert.equal(s.location, `/b/${id}/`);
  assert.equal((await c.req(`/b/${id}/`)).status, 200);
});

test('openWorld:false refuses cookieless visits; entry links still work; cookies are port-scoped and long-lived', async () => {
  const s2 = await start({ port: 0, adminPort: 0, quiet: true, openWorld: false });
  try {
    const id = firstOnline('smarthub');
    const r = await fetch(`${s2.baseUrl}/b/${id}/`, { redirect: 'manual' }); assert.equal(r.status, 401); assert.equal(s2.world.episodes.size, 0);
    const ep = await s2.admin('/episodes', { seed: 'ow', billerId: id });
    const e = await fetch(ep.entryUrl, { redirect: 'manual' }); assert.equal(e.status, 303);
    const sc = e.headers.getSetCookie().join('\n'); const p2 = new URL(s2.baseUrl).port;
    assert.match(sc, new RegExp(`bwf_ep_${p2}=${ep.episodeId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`));
  } finally { await s2.close(); }
});

test('open-world episodes are evicted past the cap', async () => {
  const s3 = await start({ port: 0, adminPort: 0, quiet: true, maxOpenEpisodes: 5 });
  try { for (let i = 0; i < 12; i++) await fetch(`${s3.baseUrl}/start-demo`, { redirect: 'manual' }); assert.ok(s3.world.episodes.size <= 5, `size ${s3.world.episodes.size}`); } finally { await s3.close(); }
});

test('CSRF token is independent of the session id; wrong token is rejected; public forms need a token', async () => {
  const id = firstOnline('smarthub'); const ep = await newEpisode(id); const c = client(); await c.enter(ep); const L = server.urlFor(server.templates.get('smarthub'), id, 'login');
  const login = await c.req(L); assert.ok(login.csrf);
  const bad = await c.req(L, { method: 'POST', form: { username: ep.persona.email, password: PASSWORD, _csrf: 'nope' } }); assert.equal(bad.status, 403); assert.match(bad.body, /session changed/i);
  const ok = await c.req(L, { method: 'POST', form: { username: ep.persona.email, password: PASSWORD, _csrf: login.csrf } }); assert.equal(ok.status, 303);
  const sid = c.jar.get('bwf_sid'); assert.ok(sid);
  const dash = await c.req(ok.location); assert.equal(dash.status, 200);
  const tok = dash.csrf || decodeURIComponent(dash.body.match(/logout[^"]*_csrf=([^"&]+)/)?.[1] || '');
  assert.ok(tok && !sid.startsWith(tok.slice(0, 6)) && !tok.startsWith(sid.slice(0, 6)), 'token does not leak the session id');
  // GET sign-out without the token does not sign out; the template link (with token) does.
  const noTok = await c.req(server.urlFor(server.templates.get('smarthub'), id, 'logout')); assert.equal(noTok.status, 303); assert.ok(c.jar.has('bwf_sid'));
  assert.equal((await c.req(server.urlFor(server.templates.get('smarthub'), id, 'dashboard'))).status, 200);
  const link = dash.body.match(/href="([^"]*logout[^"]*)"/)[1].replace(/&amp;/g, '&');
  await c.req(link); assert.ok(!c.jar.has('bwf_sid'));
});

test('two-step login keeps the user id out of the URL', async () => {
  const id = firstOnline('bank-billpay'); const t = server.templates.get('bank-billpay'); const ep = await newEpisode(id); const c = client(); await c.enter(ep);
  const l = await c.req(server.urlFor(t, id, 'login'));
  const s1 = await c.req(server.urlFor(t, id, 'login'), { method: 'POST', form: { username: ep.persona.email, _csrf: l.csrf } });
  assert.equal(s1.status, 303); assert.ok(!s1.location.includes(encodeURIComponent(ep.persona.email)) && !s1.location.includes('u='), s1.location);
  const p = await c.req(s1.location); assert.equal(p.status, 200); assert.ok(p.body.includes(ep.persona.email));
  const s2 = await c.req(s1.location, { method: 'POST', form: { username: ep.persona.email, password: PASSWORD, _csrf: p.csrf } });
  assert.equal(s2.status, 303); assert.ok(c.jar.has('bwf_sid')); assert.ok(!c.jar.has('bwf_lu'));
});

test('malformed cookies, paths, Origin and entry targets never cause a 500', async () => {
  const id = firstOnline('smarthub'); const ep = await newEpisode(id); const c = client(); await c.enter(ep);
  c.jar.set('x', '%E0%A4%A');
  assert.equal((await c.req(`/b/${id}/`)).status, 200);
  const help = server.urlFor(server.templates.get('smarthub'), id, 'helpArticle', { slug: 'x' }).replace(/x$/, '%E0%A4%A');
  assert.equal((await c.req(help)).status, 400);
  assert.equal((await c.req(server.urlFor(server.templates.get('smarthub'), id, 'login'), { method: 'POST', form: { a: 1 }, headers: { origin: 'garbage' } })).status, 403);
  const u = new URL(ep.entryUrl);
  const r = await c.req(`${u.pathname}?to=${encodeURIComponent(`/b/${id}/\r\nSet-Cookie: x=1`)}`); assert.equal(r.status, 303); assert.equal(r.location, '/');
});

test('mailbox: per-episode password, lockout, CSRF, Origin check, same-site back, and frame protection', async () => {
  const id = firstOnline('smarthub'); const ep = await newEpisode(id); const c = client(); await c.enter(ep);
  assert.notEqual(ep.credentials.mailbox.password, 'Mailbox-2026!');
  const g = await c.req('/mail'); assert.match(g.headers.get('content-security-policy') || '', /frame-ancestors 'none'/); assert.equal(g.headers.get('x-frame-options'), 'DENY');
  const ok = await c.req('/mail/login', { method: 'POST', form: { email: ep.persona.email, password: ep.credentials.mailbox.password } }); assert.equal(ok.status, 303);
  const inbox = await c.req('/mail'); const msgId = inbox.body.match(/href="\/mail\/m\/([\w-]+)"/)[1];
  const msg = await c.req(`/mail/m/${msgId}`); assert.ok(msg.csrf);
  assert.equal((await c.req('/mail/action', { method: 'POST', form: { id: msgId, op: 'star', _csrf: 'bad' } })).status, 403);
  assert.equal((await c.req('/mail/action', { method: 'POST', form: { id: msgId, op: 'trash', _csrf: msg.csrf }, headers: { origin: 'https://evil.example' } })).status, 403);
  const off = await c.req('/mail/action', { method: 'POST', form: { id: msgId, op: 'star', _csrf: msg.csrf, back: 'https://evil.example/phish' } }); assert.equal(off.location, '/mail');
  const on = await c.req('/mail/action', { method: 'POST', form: { id: msgId, op: 'star', _csrf: msg.csrf, back: `/mail/m/${msgId}` } }); assert.equal(on.location, `/mail/m/${msgId}`);
  assert.doesNotMatch((await c.req('/nope')).body, /javascript:/);
  // Lockout after repeated failures, even with the right password afterwards.
  const d = client(); await d.enter(ep);
  for (let i = 0; i < 10; i++) assert.equal((await d.req('/mail/login', { method: 'POST', form: { email: ep.persona.email, password: 'wrong-' + i } })).status, 401);
  assert.equal((await d.req('/mail/login', { method: 'POST', form: { email: ep.persona.email, password: ep.credentials.mailbox.password } })).status, 429);
});

test('session expiry mid-checkout: re-login recovers to the first pay step and exactly one payment posts', async () => {
  const tpl = 'smarthub'; const t = server.templates.get(tpl); const id = firstOnline(tpl); const ep = await newEpisode(id); const c = client(); await c.enter(ep);
  const url = (pg, p, q) => server.urlFor(t, id, pg, p, q);
  const signIn = async (next) => { const l = await c.req(url('login', {}, next ? { next } : null)); const r = await c.req(url('login'), { method: 'POST', form: { username: ep.persona.email, password: PASSWORD, _csrf: l.csrf, ...(next ? { next } : {}) } }); assert.equal(r.status, 303); return r.location; };
  await signIn();
  const acct = await server.admin(`/account?episodeId=${ep.episodeId}&billerId=${id}`); const methodId = acct.methods.find(m => m.saved && !m.expired && !m.removed).id;
  const draftTo = async () => { let page = await c.req(url(t.flow.paySteps[0])); let r;
    for (const step of t.flow.paySteps.slice(0, -1)) { r = await c.req(url(step), { method: 'POST', form: { amountChoice: 'due', methodId, _csrf: page.csrf } }); assert.equal(r.status, 303, `${step}: ${r.body.slice(0, 200)}`); if (r.location === url('payReview')) break; page = await c.req(r.location); }
    assert.equal(r.location, url('payReview')); return c.req(url('payReview')); };
  const review = await draftTo(); assert.equal(review.status, 200);
  await server.admin('/advance', { episodeId: ep.episodeId, milliseconds: 31 * 60000 });
  const expired = await c.req(url('payReview'), { method: 'POST', form: { _csrf: review.csrf, acceptTerms: 'on', token: 'x' } }); assert.equal(expired.status, 303); assert.match(expired.location, /next=/);
  const after = await signIn(new URL(expired.location, 'http://x').searchParams.get('next'));
  const back = await c.req(after); assert.equal(back.status, 303, 'stale review page is not shown'); assert.equal(back.location, url(t.flow.paySteps[0]));
  const review2 = await draftTo(); const tok = (await server.admin(`/account?episodeId=${ep.episodeId}&billerId=${id}`)).draft.token;
  const done = await c.req(url('payReview'), { method: 'POST', form: { _csrf: review2.csrf, acceptTerms: 'on', token: tok } }); assert.equal(done.status, 303, done.body.slice(0, 300)); assert.match(done.location, /receipt|confirmation/i);
  const final = await server.admin(`/account?episodeId=${ep.episodeId}&billerId=${id}`); assert.equal(final.payments.filter(p => !p.seeded).length, 1);
});

test('bill pages: the amount-due headline is the account balance (past due included) and drops to $0.00 after a full payment', async () => {
  const text = h => h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const dueLabels = tx => [...tx.matchAll(/\b(amount due|balance due|total due|next payment|payment due|current balance|total amount due)\s*:?\s*\$([\d,]+\.\d\d)/gi)].map(m => [m[1], m[2]]);
  for (const [tpl, t] of server.templates) {
    if (tpl === 'offline' || tpl === 'generic') continue;
    const id = server.world.catalog.byTemplate.get(tpl).find(x => { const b = server.world.biller(x); return b.capabilities.online_account.support !== 'unsupported' && b.capabilities.pay_online.support === 'supported'; });
    const ep = await newEpisode(id, { scenario: { [id]: { pastDueCents: 5000 } } }); const c = client(); await c.enter(ep);
    const e = server.world.episode(ep.episodeId); const sid = server.world.login(e, id, { username: e.persona.email, password: PASSWORD }).sid; c.jar.set('bwf_sid', sid);
    const a = server.world.account(e, id); const bal = server.world.balance(a);
    const before = text((await c.req(server.urlFor(t, id, 'bill'))).body);
    assert.ok(before.includes(money(bal)), `${tpl}: bill page shows the balance ${money(bal)}`);
    for (const [l, v] of dueLabels(before)) assert.equal(`$${v}`, money(bal), `${tpl}: "${l}" shows $${v}, balance is ${money(bal)}`);
    const d = server.world.draftPayment(e, id, sid, { amountChoice: 'due', methodId: 'pm-chk' }); server.world.submitPayment(e, id, sid, { token: d.token, acceptTerms: true });
    const after = text((await c.req(server.urlFor(t, id, 'bill'))).body);
    for (const [l, v] of dueLabels(after)) assert.equal(v, '0.00', `${tpl}: "${l}" still shows $${v} after a full payment`);
  }
});
