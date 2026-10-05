// Channels: episode mail connector (REST + stdio MCP), SMS inbox and mfa:'sms', mock Google IdP + Sign in with Google,
// and task-bound grading / admin episode lifecycle.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { start } from '../server.mjs';
import { parseQuery } from '../mail-connector.mjs';
import { socialButtons } from '../kit.mjs';

const PASSWORD = 'Billworld-2026!';
const TPL = 'smarthub';
let server, dataDir, t, id, other;
before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'fleet-chan-'));
  // Research profiles are optional; the override marks one biller as observed offering Google sign-in.
  const probe = await start({ port: 0, adminPort: 0, quiet: true, google: false });
  const online = probe.world.catalog.byTemplate.get(TPL).filter(x => !probe.world.isOffline(probe.world.biller(x)));
  await probe.close();
  [id, other] = online;
  server = await start({ port: 0, adminPort: 0, dataDir, quiet: true, socialOverrides: { [id]: ['google'] } });
  t = server.templates.get(TPL);
});
after(async () => { await server.close(); rmSync(dataDir, { recursive: true, force: true }); });

// Cookie jar per host (127.0.0.1 fleet vs localhost IdP), no automatic redirects.
function browser() {
  const jars = new Map();
  const jar = host => jars.get(host) || jars.set(host, new Map()).get(host);
  const b = {
    jars,
    async req(url, { method = 'GET', form, headers = {} } = {}) {
      const u = new URL(url, server.baseUrl); const j = jar(u.host);
      const cookie = [...j].map(([k, v]) => `${k}=${v}`).join('; ');
      const r = await fetch(u, { method, redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...(form ? { 'content-type': 'application/x-www-form-urlencoded', origin: u.origin } : {}), ...headers }, body: form ? new URLSearchParams(form).toString() : undefined });
      for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (/Max-Age=0\b/.test(sc) || v === '') j.delete(k); else j.set(k, v); }
      const body = await r.text();
      const loc = r.headers.get('location');
      return { status: r.status, location: loc ? new URL(loc, u).toString() : null, body, url: u.toString(), csrf: body.match(/name="_csrf" value="([^"]*)"/)?.[1], idpCsrf: body.match(/name="csrf" value="([^"]*)"/)?.[1], tx: body.match(/name="tx" value="([^"]*)"/)?.[1] };
    },
    enter: ep => b.req(ep.entryUrl)
  };
  return b;
}
const url = (pg, q, bid = id) => server.baseUrl + server.urlFor(t, bid, pg, {}, q);
const newEpisode = (extra = {}) => server.admin('/episodes', { seed: `chan-${Math.random()}`, billerId: id, ...extra });
const conn = (ep, path, { method = 'GET', body, token = ep.connector.token, episode = ep.episodeId } = {}) =>
  fetch(`${server.baseUrl}/connector/${path}`, { method, headers: { authorization: `Bearer ${token}`, 'x-billworld-episode': episode, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, ...(await r.json()) }));
async function forgot(b, ep) { const f = await b.req(url('forgot')); const r = await b.req(url('forgot'), { method: 'POST', form: { identifier: ep.persona.email, _csrf: f.csrf } }); assert.equal(r.status, 303, r.body.slice(0, 300)); }
async function signIn(b, ep, password = PASSWORD) { const l = await b.req(url('login')); const r = await b.req(url('login'), { method: 'POST', form: { username: ep.persona.email, password, _csrf: l.csrf } }); assert.equal(r.status, 303, r.body.slice(0, 300)); return r; }

// ---------------- mail connector ----------------
test('connector: credentials are episode-scoped and distinct from the browser mailbox secret', async () => {
  const a = await newEpisode(), b = await newEpisode();
  assert.ok(a.connector.token && a.connector.token !== b.connector.token);
  assert.notEqual(a.connector.token, server.world.episode(a.episodeId).mailToken, 'connector token is not the mail cookie value');
  assert.equal((await conn(a, 'profile')).emailAddress, a.persona.email);
  assert.equal((await conn(a, 'profile', { token: 'x'.repeat(32) })).status, 401);
  assert.equal((await conn(a, 'profile', { token: b.connector.token })).status, 401, 'another episode token is refused');
  assert.equal((await conn(a, 'profile', { episode: 'ep-nope' })).status, 401);
  const r = await fetch(`${server.baseUrl}/connector/messages`); assert.equal(r.status, 401);
  assert.deepEqual(Object.keys(a.connector.mcp.env).sort(), ['BILLWORLD_EPISODE', 'BILLWORLD_FLEET_URL', 'BILLWORLD_MAIL_TOKEN']);
});

test('connector: Gmail-like search, read with absolute links, thread, flags, trash, pagination, webmail parity', async () => {
  const ep = await newEpisode(); const b = browser(); await b.enter(ep);
  await forgot(b, ep); await forgot(b, ep);
  const all = await conn(ep, 'messages'); assert.equal(all.status, 200); assert.ok(all.messages.length >= 3);
  const reset = await conn(ep, `messages?q=${encodeURIComponent('subject:reset')}`); assert.equal(reset.messages.length, 2);
  assert.equal((await conn(ep, `messages?q=${encodeURIComponent('-subject:reset')}`)).messages.length, all.messages.length - 2);
  assert.equal((await conn(ep, `messages?q=${encodeURIComponent('"verification code:" is:unread newer_than:1d')}`)).messages.length, 2);
  assert.equal((await conn(ep, `messages?q=${encodeURIComponent('subject:reset OR subject:welcome')}`)).messages.length, 3);
  assert.equal((await conn(ep, `messages?q=${encodeURIComponent('older_than:1d')}`)).messages.length, 0);
  assert.ok(!('text' in reset.messages[0]) && reset.messages[0].snippet, 'list returns summaries');
  // Newest first; the older code was superseded, the agent must use the newest message.
  const m = (await conn(ep, `message?id=${reset.messages[0].id}`)).message;
  assert.match(m.text, /Verification code: \d{6}/);
  assert.ok(m.links.length === 1 && m.links[0].url.startsWith(`${server.baseUrl}/b/${id}/`) && m.text.includes(m.links[0].url), 'links are absolute and inline');
  assert.equal(m.unread, true);
  const th = await conn(ep, `thread?id=${m.threadId}`); assert.equal(th.messages.length, 2); assert.ok(th.messages[0].receivedAt <= th.messages[1].receivedAt);
  assert.equal((await conn(ep, 'mark-read', { method: 'POST', body: { id: m.id } })).message.unread, false);
  assert.equal((await conn(ep, 'messages/update', { method: 'POST', body: { id: m.id, changes: { starred: true } } })).message.starred, true);
  assert.equal((await conn(ep, `messages?q=is:starred`)).messages.length, 1);
  await conn(ep, 'messages/update', { method: 'POST', body: { id: m.id, changes: { trashed: true } } });
  assert.equal((await conn(ep, 'messages?q=subject:reset')).messages.length, 1, 'trash is hidden by default');
  assert.equal((await conn(ep, 'messages?q=in:trash')).messages.length, 1);
  assert.deepEqual((await conn(ep, 'messages/update', { method: 'POST', body: { id: m.id, changes: { trashed: false } } })).message.labels, ['INBOX']);
  assert.equal((await conn(ep, 'messages/update', { method: 'POST', body: { id: m.id, changes: { subject: 'x' } } })).status, 400, 'contents are immutable');
  assert.equal((await conn(ep, 'messages/update', { method: 'POST', body: { id: m.id, changes: { unread: 'yes' } } })).status, 400);
  assert.equal((await conn(ep, 'message?id=mail-doesnotexist')).status, 404);
  assert.equal((await conn(ep, 'message?id=../../etc')).status, 400);
  // Pagination by cursor is stable while new mail arrives.
  const p1 = await conn(ep, 'messages?limit=2'); assert.equal(p1.messages.length, 2); assert.ok(p1.nextCursor);
  await forgot(b, ep);
  const p2 = await conn(ep, `messages?limit=2&cursor=${p1.nextCursor}`);
  assert.ok(p2.messages.length >= 1 && !p2.messages.some(x => p1.messages.some(y => y.id === x.id)), 'no duplicates across pages');
  assert.equal((await conn(ep, 'messages?cursor=mail-zzz')).status, 400);
  // The webmail search box uses the same query language.
  const ok = await b.req('/mail/login', { method: 'POST', form: { email: ep.persona.email, password: ep.credentials.mailbox.password } }); assert.equal(ok.status, 303);
  const web = await b.req(`/mail?q=${encodeURIComponent('subject:reset -is:starred')}`);
  const api = await conn(ep, `messages?q=${encodeURIComponent('subject:reset -is:starred')}`);
  assert.equal((web.body.match(/href="\/mail\/m\//g) || []).length, api.messages.length);
});

test('query parser: operators, negation, OR, quoted phrases, unknown operators as text', () => {
  const c = parseQuery('from:acme "due date" -is:read subject:"your bill" foo:bar a OR b');
  assert.deepEqual(c.map(x => x.any.map(y => [y.key, y.value, y.neg])), [[['from', 'acme', false]], [[null, 'due date', false]], [['is', 'read', true]], [['subject', 'your bill', false]], [[null, 'foo:bar', false]], [[null, 'a', false], [null, 'b', false]]]);
});

test('MCP stdio server: tool surface has no grading tools; reset-then-pay through the connector grades on the bound task', async () => {
  const ep = await newEpisode({ taskId: `${id}:reset-then-pay` });
  assert.equal(ep.task.id, `${id}:reset-then-pay`); assert.ok(!('predicates' in ep.task), 'agent-visible task part has no predicates');
  const client = new Client({ name: 'fleet-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: ep.connector.mcp.command, args: ep.connector.mcp.args, env: { ...ep.connector.mcp.env, PATH: process.env.PATH }, stderr: 'pipe' }));
  try {
    const tools = (await client.listTools()).tools.map(x => x.name).sort();
    assert.deepEqual(tools, ['gmail_get_profile', 'gmail_get_thread', 'gmail_list_messages', 'gmail_read_message', 'gmail_update_message', 'sms_list_messages', 'sms_read_message']);
    const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); assert.ok(!r.isError, r.content?.[0]?.text); return JSON.parse(r.content[0].text); };
    const b = browser(); await b.enter(ep);
    await forgot(b, ep);
    const list = await call('gmail_list_messages', { q: 'subject:reset is:unread', limit: 5 }); assert.equal(list.messages.length, 1);
    const msg = (await call('gmail_read_message', { id: list.messages[0].id })).message; assert.equal(msg.unread, false);
    const code = msg.text.match(/Verification code: (\d{6})/)[1];
    const bad = await client.callTool({ name: 'gmail_read_message', arguments: { id: 'not-an-id' } }); assert.ok(bad.isError);
    const rp = await b.req(url('reset'));
    const rr = await b.req(url('reset'), { method: 'POST', form: { code, password: 'Renewed-Pass-2026!', confirm: 'Renewed-Pass-2026!', _csrf: rp.csrf } }); assert.equal(rr.status, 303, rr.body.slice(0, 300));
    await signIn(b, ep, 'Renewed-Pass-2026!');
    let page = await b.req(url(t.flow.paySteps[0])); let r;
    for (const step of t.flow.paySteps.slice(0, -1)) { r = await b.req(url(step), { method: 'POST', form: { amountChoice: 'due', methodId: 'pm-chk', _csrf: page.csrf } }); assert.equal(r.status, 303, `${step}: ${r.body.slice(0, 200)}`); if (r.location === url('payReview')) break; page = await b.req(r.location); }
    const review = await b.req(url('payReview')); assert.equal(review.status, 200);
    const tok = review.body.match(/name="token" value="([^"]+)"/)[1];
    const paid = await b.req(url('payReview'), { method: 'POST', form: { token: tok, acceptTerms: 'on', _csrf: review.csrf } }); assert.equal(paid.status, 303); assert.match(paid.location, /receipt|confirmation/i);
    // Caller predicates cannot override the bound task: an empty list is ignored, not scored as success.
    const fin = await server.admin('/finish', { episodeId: ep.episodeId, predicates: [] });
    assert.equal(fin.taskId, `${id}:reset-then-pay`); assert.equal(fin.predicateSource, 'task'); assert.ok(fin.results.length >= 4);
    assert.equal(fin.success, true, JSON.stringify(fin.results.filter(x => !x.pass)));
  } finally { await client.close(); }
});

test('admin: /finish without a task needs predicates; list, reset (same credentials) and delete episodes', async () => {
  const ep = await newEpisode();
  await assert.rejects(server.admin('/finish', { episodeId: ep.episodeId, predicates: [] }), e => e.status === 400);
  const b = browser(); await b.enter(ep); await forgot(b, ep);
  assert.ok((await server.admin('/episodes')).some(x => x.episodeId === ep.episodeId));
  const before = (await conn(ep, 'messages')).messages.length;
  const reset = await server.admin(`/episodes/${ep.episodeId}/reset`, {});
  assert.equal(reset.episodeId, ep.episodeId); assert.equal(reset.connector.token, ep.connector.token); assert.equal(reset.entryUrl, ep.entryUrl);
  const after = (await conn(ep, 'messages')).messages; assert.ok(after.length < before && after.length === 1, 'mailbox back to the welcome message');
  assert.equal(server.world.episode(ep.episodeId).persona.email, ep.persona.email, 'same seed, same persona');
  const del = await fetch(`${server.adminUrl}/episodes/${ep.episodeId}`, { method: 'DELETE', headers: { authorization: `Bearer ${server.adminToken}` } }); assert.equal(del.status, 200);
  assert.equal((await conn(ep, 'profile')).status, 401);
  assert.ok(!existsSync(join(dataDir, `${ep.episodeId}.json`)));
  await assert.rejects(server.admin('/episodes', { taskId: `${id}:no-such-task` }), e => e.status === 404);
});

// ---------------- SMS ----------------
test("mfa:'sms' delivers the sign-in code to the phone (page + connector), not the inbox", async () => {
  const ep = await newEpisode({ scenario: { [id]: { mfa: 'sms' } } });
  assert.deepEqual(ep.channels.smsMfa.billers, [id]);
  const b = browser(); await b.enter(ep);
  const mailBefore = (await conn(ep, 'messages')).messages.length;
  const r = await signIn(b, ep); assert.match(r.location, new RegExp(server.urlFor(t, id, 'mfa').replace(/[.?]/g, '\\$&')));
  assert.equal((await conn(ep, 'messages')).messages.length, mailBefore, 'no code email');
  const sms = await conn(ep, 'sms'); assert.equal(sms.messages.length, 1); assert.equal(sms.messages[0].to, ep.persona.phone);
  const code = sms.messages[0].text.match(/\b(\d{6})\b/)[1];
  const phone = await b.req('/sms'); assert.equal(phone.status, 200); assert.match(phone.body, /1 new/);
  const conv = phone.body.match(/href="\/sms\/c\/(\d+)"/)[1];
  const thread = await b.req(`/sms/c/${conv}`); assert.ok(thread.body.includes(code));
  assert.equal((await conn(ep, 'sms?q=is:unread')).messages.length, 0, 'opening the conversation marks it read');
  const mfa = await b.req(r.location); assert.equal(mfa.status, 200);
  const wrong = await b.req(r.location, { method: 'POST', form: { code: '000000', _csrf: mfa.csrf, next: url('bill') } }); assert.equal(wrong.status, 400);
  const ok = await b.req(r.location, { method: 'POST', form: { code, _csrf: mfa.csrf } }); assert.equal(ok.status, 303);
  assert.equal((await b.req(url('dashboard'))).status, 200);
  const st = server.world.episode(ep.episodeId); assert.ok(st.events.some(e => e.type === 'login' && e.billerId === id && e.mfa));
  assert.equal((await b.req('/sms', { method: 'POST', form: { op: 'unread', from: conv, _csrf: 'bad' } })).status, 403);
  // Episode-wide default applies to other billers too.
  const ep2 = await newEpisode({ scenario: { default: { mfa: 'sms' } } }); assert.equal(ep2.channels.smsMfa.default, true);
});

// Full balance from saved checking through the template's pay wizard (as a signed-in browser would).
async function payFullFromChecking(b) {
  let page = await b.req(url(t.flow.paySteps[0])); let r;
  for (const step of t.flow.paySteps.slice(0, -1)) { r = await b.req(url(step), { method: 'POST', form: { amountChoice: 'due', methodId: 'pm-chk', _csrf: page.csrf } }); assert.equal(r.status, 303, `${step}: ${r.body.slice(0, 200)}`); if (r.location === url('payReview')) break; page = await b.req(r.location); }
  const review = await b.req(url('payReview')); assert.equal(review.status, 200);
  const paid = await b.req(url('payReview'), { method: 'POST', form: { token: review.body.match(/name="token" value="([^"]+)"/)[1], acceptTerms: 'on', _csrf: review.csrf } });
  assert.equal(paid.status, 303); assert.match(paid.location, /receipt|confirmation/i);
}

test('task-bound sms-mfa-pay: native SMS code on the phone page, graded on the task predicates', async () => {
  const tasks = await server.admin(`/tasks?billerId=${id}`); assert.ok(tasks.some(x => x.id === `${id}:sms-mfa-pay`));
  const ep = await newEpisode({ taskId: `${id}:sms-mfa-pay` }); const b = browser(); await b.enter(ep);
  const r = await signIn(b, ep); const mfa = await b.req(r.location); assert.match(mfa.body, /We texted/); assert.match(mfa.body, /name="op" value="resend"/);
  const conv = (await b.req('/sms')).body.match(/href="\/sms\/c\/(\d+)"/)[1];
  const code = [...(await b.req(`/sms/c/${conv}`)).body.matchAll(/\b(\d{6})\b/g)].at(-1)[1];
  assert.equal((await b.req(r.location, { method: 'POST', form: { code, _csrf: mfa.csrf } })).status, 303);
  const early = await server.admin('/evaluate', { episodeId: ep.episodeId }); assert.equal(early.success, false, 'no payment yet');
  await payFullFromChecking(b);
  const fin = await server.admin('/finish', { episodeId: ep.episodeId }); assert.equal(fin.taskId, `${id}:sms-mfa-pay`); assert.equal(fin.success, true, JSON.stringify(fin.results.filter(x => !x.pass)));
});

test('task-bound google-login-pay: offered only where Google sign-in renders; Google login + payment passes, password login fails', async () => {
  assert.ok((await server.admin(`/tasks?billerId=${id}`)).some(x => x.id === `${id}:google-login-pay`), 'override biller gets the task');
  assert.ok(!(await server.admin(`/tasks?billerId=${other}`)).some(x => x.id.endsWith(':google-login-pay')), 'no Google, no task');
  const ep = await newEpisode({ taskId: `${id}:google-login-pay` }); const b = browser(); await b.enter(ep);
  const { callback } = await googleFlow(b, ep); const cb = await b.req(callback); assert.equal(cb.status, 303, cb.body.slice(0, 200));
  await payFullFromChecking(b);
  const fin = await server.admin('/finish', { episodeId: ep.episodeId }); assert.equal(fin.success, true, JSON.stringify(fin.results.filter(x => !x.pass)));
  const ep2 = await newEpisode({ taskId: `${id}:google-login-pay` }); const b2 = browser(); await b2.enter(ep2); await signIn(b2, ep2); await payFullFromChecking(b2);
  const fin2 = await server.admin('/finish', { episodeId: ep2.episodeId }); assert.equal(fin2.success, false, 'a password sign-in does not satisfy the Google task');
});

// ---------------- Google ----------------
async function googleFlow(b, ep, { start = url('login'), expectChooser = false, consent = 'allow', email = ep.persona.email, password = ep.credentials.google.password } = {}) {
  const login = await b.req(start); assert.match(login.body, /data-social-login="google"/);
  const href = login.body.match(/href="([^"]*\/auth\/google[^"]*)"/)[1].replace(/&amp;/g, '&');
  const s = await b.req(href); assert.equal(s.status, 303); assert.ok(s.location.startsWith(server.googleUrl), s.location);
  const a = await b.req(s.location); assert.equal(a.status, 303);
  let page = await b.req(a.location);
  if (expectChooser) {
    assert.match(page.url, /\/signin\/chooser/); assert.ok(page.body.includes(email));
    const sub = page.body.match(/name="account" value="(\d+)"/)[1];
    const c = await b.req(`${server.googleUrl}/signin/chooser`, { method: 'POST', form: { tx: page.tx, csrf: page.idpCsrf, account: sub } });
    return c.location.startsWith(server.googleUrl) ? { consentPage: await b.req(c.location), callback: null } : { callback: c.location };
  }
  assert.match(page.url, /\/signin\/identifier/);
  const id1 = await b.req(`${server.googleUrl}/signin/identifier`, { method: 'POST', form: { tx: page.tx, csrf: page.idpCsrf, identifier: email } });
  assert.equal(id1.status, 303);
  page = await b.req(id1.location);
  const pw = await b.req(`${server.googleUrl}/signin/password`, { method: 'POST', form: { tx: page.tx, csrf: page.idpCsrf, password } });
  assert.equal(pw.status, 303, pw.body.slice(0, 200));
  const cp = await b.req(pw.location);
  if (!/\/consent/.test(cp.url)) return { callback: pw.location };
  assert.match(cp.body, /Sign in to /);
  const d = await b.req(`${server.googleUrl}/consent`, { method: 'POST', form: { tx: cp.tx, csrf: cp.idpCsrf, decision: consent } });
  return { callback: d.location };
}

test('Sign in with Google: chooser, password, consent, one-use code, PKCE/state/nonce, linking and login event', async () => {
  const ep = await newEpisode(); const b = browser(); await b.enter(ep);
  assert.ok(ep.credentials.google.issuer.startsWith('http://localhost:'));
  // Unknown account and wrong password are refused at the IdP.
  {
    const login = await b.req(url('login')); const href = login.body.match(/href="([^"]*\/auth\/google[^"]*)"/)[1].replace(/&amp;/g, '&');
    const s = await b.req(href); const a = await b.req(s.location); const pg = await b.req(a.location);
    const nf = await b.req(`${server.googleUrl}/signin/identifier`, { method: 'POST', form: { tx: pg.tx, csrf: pg.idpCsrf, identifier: 'nobody@billworld.test' } });
    assert.equal(nf.status, 400); assert.match(nf.body, /Couldn.t find your Google Account/);
    const id1 = await b.req(`${server.googleUrl}/signin/identifier`, { method: 'POST', form: { tx: pg.tx, csrf: pg.idpCsrf, identifier: ep.persona.email } });
    const pp = await b.req(id1.location);
    const wrong = await b.req(`${server.googleUrl}/signin/password`, { method: 'POST', form: { tx: pp.tx, csrf: pp.idpCsrf, password: 'nope-nope' } }); assert.equal(wrong.status, 400); assert.match(wrong.body, /Wrong password/);
    const forged = await b.req(`${server.googleUrl}/signin/password`, { method: 'POST', form: { tx: pp.tx, csrf: 'forged', password: ep.credentials.google.password } }); assert.equal(forged.status, 403);
    const other = browser(); assert.equal((await other.req(`${server.googleUrl}/signin/password?tx=${pp.tx}`)).status, 400, 'transaction is bound to the starting browser');
  }
  const { callback } = await googleFlow(b, ep);
  const cb = new URL(callback); assert.ok(cb.searchParams.get('code') && cb.searchParams.get('state') && cb.searchParams.get('iss') === server.googleUrl);
  const done = await b.req(callback); assert.equal(done.status, 303); assert.equal(done.location, url(t.flow.afterLogin));
  assert.equal((await b.req(url('dashboard'))).status, 200);
  const st = server.world.episode(ep.episodeId);
  assert.ok(st.events.some(e => e.billerId === id && e.type === 'login' && e.method === 'google'));
  assert.ok(st.events.some(e => e.billerId === id && e.type === 'google_linked'));
  assert.ok(st.identity.google.links[id].sub);
  const graded = await server.admin('/evaluate', { episodeId: ep.episodeId, predicates: [{ billerId: id, type: 'event', event: 'login', match: { method: 'google' } }] }); assert.equal(graded.success, true);
  // Replaying the callback: state already used, and the code itself is single-use at the token endpoint.
  const replay = await b.req(callback); assert.equal(replay.status, 303); assert.equal(replay.location, url('login'));
  const tokenReplay = await fetch(`${server.googleUrl}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: cb.searchParams.get('code'), client_id: server.rp.clientIdFor(id), client_secret: 'wrong', redirect_uri: server.rp.redirectFor(id), code_verifier: 'x'.repeat(43) }) });
  assert.equal(tokenReplay.status, 401);
  // Second sign-in: the IdP session shows the account chooser and remembered consent skips the consent screen.
  await b.req(url('logout', { _csrf: (await b.req(url('dashboard'))).body.match(/_csrf=([^"&]+)/)[1] }));
  const again = await googleFlow(b, ep, { expectChooser: true });
  assert.ok(again.callback, 'no consent screen the second time');
  assert.equal((await b.req(again.callback)).location, url(t.flow.afterLogin));
  assert.equal(server.world.episode(ep.episodeId).events.filter(e => e.type === 'google_linked').length, 1);
});

test('Sign in with Google: cancel, state mismatch, PKCE and token checks, unknown account, non-enabled billers', async () => {
  const ep = await newEpisode(); const b = browser(); await b.enter(ep);
  // Cancel at consent -> access_denied -> back to sign-in with a notice, no session.
  const denied = await googleFlow(b, ep, { consent: 'deny' });
  assert.equal(new URL(denied.callback).searchParams.get('error'), 'access_denied');
  const back = await b.req(denied.callback); assert.equal(back.location, url('login')); assert.ok(!b.jars.get(new URL(server.baseUrl).host).has('bwf_sid'));
  assert.match((await b.req(back.location)).body, /cancelled/);
  assert.ok(server.world.episode(ep.episodeId).events.some(e => e.type === 'google_login_cancelled'));
  // Forged state.
  const forged = await b.req(`${server.baseUrl}/b/${id}/auth/google/callback?code=4/x&state=forged`); assert.equal(forged.location, url('login'));
  assert.ok(server.world.episode(ep.episodeId).events.some(e => e.type === 'google_login_failed' && e.reason === 'state_mismatch'));
  // PKCE, client and token validation at the IdP / RP.
  const idp = server.idp; const e = server.world.episode(ep.episodeId);
  const cid = server.rp.clientIdFor(id);
  const flow = server.rp.begin(e, id, {});
  const par = [...idp.pars.values()].find(p => p.state === flow.state);
  const tx = { id: 'tx-test', ...par, done: false };
  const code = new URL(idp.issueCode(tx, e, idp.accounts(e)[0])).searchParams.get('code');
  const secret = idp.resolveClient(cid).secret;
  assert.throws(() => idp.exchangeCode({ code, clientId: cid, clientSecret: secret, redirectUri: server.rp.redirectFor(id), codeVerifier: 'y'.repeat(50) }), /PKCE/);
  assert.throws(() => idp.exchangeCode({ code, clientId: cid, clientSecret: secret, redirectUri: server.rp.redirectFor(id), codeVerifier: e.oauth[flow.state].verifier }), /already used/, 'a failed exchange still burns the code');
  const tok = idp.sign({ iss: idp.issuer, aud: cid, sub: '1', email: ep.persona.email, email_verified: true, nonce: 'n', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
  assert.equal(idp.verifyIdToken(tok, { audience: cid, nonce: 'n' }).sub, '1');
  assert.throws(() => idp.verifyIdToken(tok, { audience: cid, nonce: 'other' }), /nonce/);
  assert.throws(() => idp.verifyIdToken(tok, { audience: 'someone-else', nonce: 'n' }), /audience/);
  const [h, p, sig] = tok.split('.'); const tampered = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), email: 'evil@x.test' })).toString('base64url')}.${sig}`;
  assert.throws(() => idp.verifyIdToken(tampered, { audience: cid, nonce: 'n' }), /signature/);
  assert.throws(() => idp.pushAuthorization({ clientId: cid, clientSecret: secret, redirectUri: 'http://evil.test/cb', state: 's', nonce: 'n', codeChallenge: 'c', codeChallengeMethod: 'S256', tenant: e.id }), /redirect_uri/);
  assert.throws(() => idp.pushAuthorization({ clientId: cid, clientSecret: secret, redirectUri: server.rp.redirectFor(id), state: 's', nonce: 'n', codeChallenge: 'c', codeChallengeMethod: 'plain', tenant: e.id }), /S256/);
  const cfg = await (await fetch(`${server.googleUrl}/.well-known/openid-configuration`)).json(); assert.equal(cfg.issuer, server.googleUrl);
  assert.equal((await (await fetch(`${server.googleUrl}/oauth2/v3/certs`)).json()).keys[0].alg, 'RS256');
  // Unregistered persona: Google works but no biller account matches.
  const ep3 = await newEpisode({ scenario: { [id]: { registered: false } } }); const b3 = browser(); await b3.enter(ep3);
  const r3 = await b3.req((await googleFlow(b3, ep3)).callback); assert.equal(r3.location, url('login'));
  assert.ok(server.world.episode(ep3.episodeId).events.some(x => x.type === 'google_login_failed' && x.reason === 'no_matching_account'));
  // A biller without Google evidence has no button and no route; the IdP does not know its client.
  const lo = await b.req(url('login', null, other)); assert.equal(lo.status, 200); assert.doesNotMatch(lo.body, /data-social-login/);
  assert.equal((await b.req(`${server.baseUrl}/b/${other}/auth/google`)).status, 404);
  assert.equal(idp.resolveClient(server.rp.clientIdFor(other)), null);
  assert.equal(String(socialButtons({ socialProviders: [], nonce: 'n' })), '');
});

test('Google decoy account appears in the chooser but links to nothing', async () => {
  const ep = await newEpisode({ channels: { google: { decoy: true } } }); const b = browser(); await b.enter(ep);
  const work = `${ep.persona.first}.${ep.persona.last}@work.billworld.test`.toLowerCase();
  const r = await b.req((await googleFlow(b, ep, { email: work })).callback); assert.equal(r.location, url('login'));
  assert.ok(server.world.episode(ep.episodeId).events.some(x => x.type === 'google_login_failed' && x.reason === 'no_matching_account'));
});
