import test from 'node:test'; import assert from 'node:assert/strict'; import { start } from '../server.mjs';

async function session(s, siteId, taskId) {
  const f = s.world.create({ siteId, taskId });
  let jar = `bw_episode=${f.episodeId}; bw_access=${f.entryToken}`;
  const absorb = res => { for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'); const [name, value] = pair.split('='); jar = jar.split('; ').filter(p => !p.startsWith(name + '=')).concat(value ? [pair] : []).join('; '); } return res; };
  const post = async (path, data) => absorb(await fetch(s.baseUrl + path, { method: 'POST', headers: { Cookie: jar, Origin: s.baseUrl, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }));
  const get = async path => absorb(await fetch(s.baseUrl + path, { headers: { Cookie: jar } }));
  const code = () => s.world.messages(f.episodeId, f.connectorToken, 'subject:verification')[0].text.match(/code is (\d{6})/)[1];
  return { f, post, get, code, jar: () => jar };
}

test('Juneau email-code challenge survives leaving the page: HttpOnly cookie, single use, expiry', async () => {
  const s = await start({ port: 0, adminPort: 0, dbPath: ':memory:' });
  try {
    const a = await session(s, 'juneau-utilities', 'juneau-pay-email-mfa-v1');
    assert.equal((await (await a.get('/api/verify/status')).json()).pending, false);
    const login = await a.post('/api/login', { email: 'alex@billworld.test', password: 'Billworld-2026!' });
    assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie'), /bw_otp=[^;]+; HttpOnly; SameSite=Lax/);
    assert.equal((await (await a.get('/api/verify/status')).json()).pending, true);
    // A one-tab agent lost page memory: verify with only the code.
    assert.equal((await a.post('/api/verify', { code: '000000' === a.code() ? '111111' : '000000' })).status, 401);
    assert.equal((await (await a.get('/api/verify/status')).json()).pending, true, 'a wrong code keeps the challenge pending');
    const ok = await a.post('/api/verify', { code: a.code() }); assert.equal(ok.status, 200);
    assert.match(a.jar(), /bw_session=/); assert.doesNotMatch(a.jar(), /bw_otp=/);
    assert.equal((await (await a.get('/api/dashboard')).status), 200);
    assert.equal((await a.post('/api/verify', { code: a.code() })).status, 401, 'challenge is single-use');
    // Expiry: a fresh challenge expires after five minutes.
    const b = await session(s, 'juneau-utilities', 'juneau-pay-email-mfa-v1');
    await b.post('/api/login', { email: 'alex@billworld.test', password: 'Billworld-2026!' });
    s.world.advance(b.f.episodeId, 5 * 60000 + 1000);
    assert.equal((await (await b.get('/api/verify/status')).json()).pending, false);
    assert.equal((await b.post('/api/verify', { code: b.code() })).status, 401);
    // Another episode's cookie cannot satisfy this episode's challenge.
    const c = await session(s, 'juneau-utilities', 'juneau-pay-email-mfa-v1');
    await c.post('/api/login', { email: 'alex@billworld.test', password: 'Billworld-2026!' });
    const foreign = c.jar().match(/bw_otp=([^;]+)/)[1];
    assert.equal((await b.post('/api/verify', { challenge: foreign, code: c.code() })).status, 401);
  } finally { await s.close(); }
});

test('WVU MyChart email-code challenge is server-side so the login page can resume it', async () => {
  const s = await start({ port: 0, adminPort: 0, dbPath: ':memory:' });
  try {
    const a = await session(s, 'wvu-medicine', 'wvu-mfa-visit-pay-v1');
    const identity = await (await a.post('/api/mychart/identity', { username: 'alex.morgan' })).json();
    const login = await (await a.post('/api/login', { username: 'alex.morgan', password: 'Billworld-2026!', identityChallenge: identity.challenge })).json();
    assert.ok(login.challenge);
    assert.equal((await (await a.get('/api/verify/status')).json()).pending, true);
    assert.equal((await a.post('/api/verify', { code: a.code() })).status, 200);
    assert.equal((await a.get('/api/dashboard')).status, 200);
  } finally { await s.close(); }
});

test('AVEC, GVP and Homer do not list the decline fixture; new profiles start with an empty wallet', async () => {
  const s = await start({ port: 0, adminPort: 0, dbPath: ':memory:' });
  try {
    for (const siteId of ['avec-electric', 'gvp-electric', 'homer-utilities']) {
      const f = s.world.create({ siteId }), methods = s.world.state(f.episodeId).accounts[0].methods;
      assert.ok(methods.length > 0, siteId); assert.equal(methods.some(m => m.decline || m.last4 === '0002'), false, siteId);
    }
    for (const taskId of ['gvp-register-pay-v1', 'homer-register-link-pay-v1']) {
      const siteId = taskId.startsWith('gvp') ? 'gvp-electric' : 'homer-utilities', f = s.world.create({ siteId, taskId });
      assert.deepEqual(s.world.state(f.episodeId).accounts[0].methods, [], taskId);
    }
    const j = s.world.create({ siteId: 'juneau-utilities' });
    assert.ok(s.world.state(j.episodeId).accounts[0].methods.some(m => m.id === 'card-decline'), 'Juneau keeps its documented decline fixture');
  } finally { await s.close(); }
});

test('Swepsonville reset email is AuthorityPay branded and links to the AuthorityPay reset route', async () => {
  const s = await start({ port: 0, adminPort: 0, dbPath: ':memory:' });
  try {
    const f = s.world.create({ siteId: 'swepsonville-water', taskId: 'swepsonville-recover-login-v1' });
    s.world.resetRequest(f.episodeId, { email: 'alex@billworld.test' });
    const m = s.world.messages(f.episodeId, f.connectorToken, 'subject:reset')[0];
    assert.doesNotMatch(m.subject + m.text, /Billworld portal|\/portal\/reset/);
    assert.match(m.subject, /Swepsonville/); assert.match(m.text, /\/site\/reset-password\?token=/);
    const page = await fetch(s.baseUrl + '/site/reset-password?token=x', { headers: { Cookie: `bw_episode=${f.episodeId}; bw_access=${f.entryToken}` } });
    assert.equal(page.status, 200);
  } finally { await s.close(); }
});

test('Generic-portal reset emails name the biller (Juneau), not "Billworld portal"', async () => {
  const s = await start({ port: 0, adminPort: 0, dbPath: ':memory:' });
  try {
    const f = s.world.create({ siteId: 'juneau-utilities', taskId: 'juneau-recover-password-v1' });
    s.world.resetRequest(f.episodeId, { email: 'alex@billworld.test' });
    const m = s.world.messages(f.episodeId, f.connectorToken, 'subject:reset')[0];
    assert.equal(m.subject, 'Reset your City and Borough of Juneau Utilities password');
    assert.match(m.text, /\/portal\/reset\?token=/);
  } finally { await s.close(); }
});
