import { randomBytes, createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { Fault } from './engine.mjs';
const token = () => randomBytes(32).toString('base64url');
const digest = v => createHash('sha256').update(v).digest('base64url');
const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
const requireValue = (v, text) => { if (!v) throw new Fault(text, 403); };

// Local OIDC-like simulation. No real Google credentials or requests are used.
export class MockGoogle {
  constructor(world) {
    this.world = world; this.keys = generateKeyPairSync('ed25519');
    world.db.exec('CREATE TABLE IF NOT EXISTS google_requests (id TEXT PRIMARY KEY, state TEXT NOT NULL)');
  }
  save(r) { this.world.db.prepare('INSERT OR REPLACE INTO google_requests(id,state) VALUES(?,?)').run(r.id, JSON.stringify(r)); }
  request(id) {
    requireValue(typeof id === 'string', 'Authorization request required');
    const row = this.world.db.prepare('SELECT state FROM google_requests WHERE id=?').get(id);
    requireValue(row, 'Authorization request not found'); const r = JSON.parse(row.state);
    requireValue(!r.used && r.expires > this.world.state(r.episodeId).now, 'Authorization request expired or used'); return r;
  }
  begin(episodeId, origin) {
    this.world.googleUsers(episodeId);
    const r = { id: token(), episodeId, state: token(), nonce: token(), verifier: token(), clientId: this.world.state(episodeId).siteId==='duluth-comfortsystems'?'billworld-duluth':'billworld-spotify', app: this.world.state(episodeId).siteId==='duluth-comfortsystems'?'ComfortSystems':'Spotify',
      redirectUri: `${origin}/auth/google/callback`, issuer: this.issuer, expires: this.world.state(episodeId).now + 10 * 60000,
      used: false, user: null, code: null };
    r.challenge = digest(r.verifier); this.save(r);
    return { requestId: r.id, state: r.state, authorizationUrl: `${this.issuer}/authorize?request=${r.id}` };
  }
  publicRequest(id) { const r = this.request(id); return { requestId: r.id, app: r.app || 'Spotify', accounts: this.world.googleUsers(r.episodeId) }; }
  authenticate(id, credentials) {
    const r = this.request(id); r.user = this.world.authenticateGoogle(r.episodeId, credentials); r.providerCsrf = token(); this.save(r);
    return { csrf: r.providerCsrf, user: r.user };
  }
  consent(id, { csrf, allow }) {
    const r = this.request(id); requireValue(r.user && r.providerCsrf === csrf, 'Sign in before approving consent');
    if (!allow) { r.used = true; this.save(r); return { redirect: `${r.redirectUri}?error=access_denied&state=${r.state}&request=${r.id}` }; }
    r.code = token(); r.providerCsrf = null; this.save(r);
    return { redirect: `${r.redirectUri}?code=${r.code}&state=${r.state}&request=${r.id}` };
  }
  mint(r) {
    const now = Math.floor(this.world.state(r.episodeId).now / 1000);
    const claims = { iss: r.issuer, aud: r.clientId, sub: r.user.sub, email: r.user.email, email_verified: true, nonce: r.nonce, iat: now, exp: now + 60 };
    const data = `${b64({ alg: 'EdDSA', typ: 'JWT' })}.${b64(claims)}`;
    return `${data}.${sign(null, Buffer.from(data), this.keys.privateKey).toString('base64url')}`;
  }
  validate(jwt, r) {
    const [header, payload, signature] = jwt.split('.');
    requireValue(header && payload && signature && verify(null, Buffer.from(`${header}.${payload}`), this.keys.publicKey, Buffer.from(signature, 'base64url')), 'Invalid identity signature');
    const h = JSON.parse(Buffer.from(header, 'base64url')); const claims = JSON.parse(Buffer.from(payload, 'base64url'));
    requireValue(h.alg === 'EdDSA' && claims.iss === this.issuer && claims.aud === r.clientId && claims.nonce === r.nonce && claims.exp > Math.floor(this.world.state(r.episodeId).now / 1000), 'Invalid identity claims'); return claims;
  }
  complete(episodeId, browserState, input) {
    const r = this.request(input.request);
    requireValue(r.episodeId === episodeId && browserState === r.state && input.state === r.state, 'OAuth state mismatch');
    requireValue(input.code && input.code === r.code && digest(r.verifier) === r.challenge, 'Authorization code or PKCE mismatch');
    const claims = this.validate(this.mint(r), r);
    const result = this.world.googleSession(episodeId, claims); r.used = true; this.save(r); return result;
  }
}
