import {requestOrigin} from './transport.mjs';
// HTTP surface for the City of Tuscaloosa / Paymentus slice. server.mjs dispatches here once per request.
import {readFileSync} from 'node:fs';
import {Fault} from './engine.mjs';

const root = new URL('.', import.meta.url);
const files = {'tuscaloosa.js': 'text/javascript', 'tuscaloosa.css': 'text/css'};
const assets = new Map(Object.keys(files).map(name => [name, readFileSync(new URL(`public/${name}`, root))]));
const shell = readFileSync(new URL('public/tuscaloosa.html', root));
export const tuscaloosaPages = ['/', '/billinfo', '/ach', '/onlineservices', '/onlineservices/useful-forms', '/ebill', '/faqs',
  '/cp/tusl', '/cp/tusl/register', '/cp/tusl/forgot', '/cp/tusl/reset', '/cp/tusl/add-account', '/cp/tusl/add-account/verify', '/cp/tusl/add-account/done',
  '/cp/tusl/accounts', '/cp/tusl/bill', '/cp/tusl/bill-history', '/cp/tusl/pay', '/cp/tusl/pay/review', '/cp/tusl/pay/receipt',
  '/cp/tusl/guest', '/cp/tusl/guest/pay', '/cp/tusl/guest/review', '/cp/tusl/guest/receipt',
  '/cp/tusl/history', '/cp/tusl/history/edit', '/cp/tusl/autopay', '/cp/tusl/autopay/setup', '/cp/tusl/autopay/review', '/cp/tusl/autopay/confirmation',
  '/cp/tusl/wallet', '/cp/tusl/wallet/add', '/cp/tusl/profile', '/cp/tusl/logout'];
const passthrough = path => path.startsWith('/api/mail') || path === '/api/session' || path === '/auth/google/callback';

function isTuscaloosa(world, id) {
  if (!id) return false;
  try { return world.state(id).siteId === 'tuscaloosa-water'; } catch { return false; }
}

export async function tuscaloosaRoute({req, res, url, c, world, json, body, cookie}) {
  const id = c.bw_episode;
  if (!isTuscaloosa(world, id) || passthrough(url.pathname)) return false;
  world.enter(id, c.bw_access);
  const session = c.bw_session, path = url.pathname;
  if (req.method === 'GET' && !path.startsWith('/api/')) {
    const name = path.slice(1);
    if (assets.has(name)) { res.writeHead(200, {'Content-Type': files[name], 'Cache-Control': 'no-store'}); res.end(assets.get(name)); return true; }
    if (path === '/pay-water-bill') { res.writeHead(302, {Location: '/cp/tusl'}); res.end(); return true; }
    if (path === '/cp/tusl/reset' && url.searchParams.has('token')) {
      const token = url.searchParams.get('token');
      let valid = true; try { world.tusRecoveryGrant(id, token, true); } catch { valid = false; }
      res.writeHead(302, {Location: '/cp/tusl/reset', 'Set-Cookie': cookie('bw_tus_reset', valid ? token : '', valid ? 1800 : 0)}); res.end(); return true;
    }
    if (!tuscaloosaPages.includes(path)) throw new Fault('Page not found', 404);
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}); res.end(shell); return true;
  }
  if (!path.startsWith('/api/')) throw new Fault('Not found', 404);
  if (req.method === 'POST' && req.headers.origin !== requestOrigin(req)) throw new Fault('Same-origin request required', 403);
  const cookies = [], set = (name, value, age) => cookies.push(cookie(name, value, age));
  const send = data => { if (cookies.length) res.setHeader('Set-Cookie', cookies); json(res, data); return true; };
  if (req.method === 'GET') {
    const q = url.searchParams;
    if (path === '/api/tus/statement') {
      const d = world.tusStatement(id, session, q.get('invoiceId'));
      res.writeHead(200, {'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${d.filename}"`, 'Content-Length': d.bytes.length, 'Cache-Control': 'no-store'}); res.end(d.bytes); return true;
    }
    const routes = {
      '/api/tus/me': () => world.tusProfile(id, session),
      '/api/tus/recovery/grant': () => world.tusRecoveryGrant(id, c.bw_tus_reset),
      '/api/tus/link/review': () => world.tusLinkReview(id, session, c.bw_tus_link),
      '/api/tus/link/receipt': () => world.tusLinkReview(id, session, c.bw_tus_link, true),
      '/api/tus/accounts': () => world.tusAccounts(id, session),
      '/api/tus/bills': () => world.tusBills(id, session, q.get('account')),
      '/api/tus/guest': () => world.tusGuest(id, c.bw_tus_guest),
      '/api/tus/review': () => world.tusReview(id, session, c.bw_tus_guest, c.bw_tus_quote),
      '/api/tus/receipt': () => world.tusReview(id, session, c.bw_tus_guest, c.bw_tus_quote, true),
      '/api/tus/history': () => world.tusHistory(id, session),
      '/api/tus/autopay': () => world.tusAutoPay(id, session),
      '/api/tus/autopay/review': () => world.tusAutoPayReview(id, session, c.bw_tus_autopay),
      '/api/tus/wallet': () => world.tusWallet(id, session),
    };
    if (!routes[path]) throw new Fault('Operation not found', 404);
    return send(routes[path]());
  }
  if (req.method !== 'POST') throw new Fault('Operation not found', 404);
  const input = await body(req);
  switch (path) {
    case '/api/tus/login': { const r = world.tusLogin(id, input); set('bw_session', r.session, 3600); return send({profile: r.profile, needsAccount: r.needsAccount}); }
    case '/api/tus/logout': { const r = world.tusLogout(id, session); set('bw_session', '', 0); set('bw_tus_quote', '', 0); set('bw_tus_autopay', '', 0); set('bw_tus_link', '', 0); return send(r); }
    case '/api/tus/register': { const r = world.tusRegister(id, input); set('bw_session', r.session, 3600); return send({profile: r.profile}); }
    case '/api/tus/profile': return send(world.tusProfileUpdate(id, session, input));
    case '/api/tus/recovery/request': return send(world.tusRecoveryRequest(id, input));
    case '/api/tus/recovery/complete': { const r = world.tusRecoveryComplete(id, c.bw_tus_reset, input); set('bw_tus_reset', '', 0); set('bw_session', '', 0); return send(r); }
    case '/api/tus/link/verify': { const r = world.tusLinkVerify(id, session, input); set('bw_tus_link', r.token, 1200); return send({verified: true}); }
    case '/api/tus/link/confirm': return send(world.tusLinkConfirm(id, session, c.bw_tus_link, input));
    case '/api/tus/guest/lookup': { const r = world.tusGuestLookup(id, input); set('bw_tus_guest', r.token, 1200); set('bw_tus_quote', '', 0); return send({verified: true}); }
    case '/api/tus/quote': { const r = world.tusQuote(id, session, c.bw_tus_guest, input); set('bw_tus_quote', r.token, 1800); return send(r.review); }
    case '/api/tus/pay': return send(world.tusPay(id, session, c.bw_tus_guest, c.bw_tus_quote, input));
    case '/api/tus/schedule/edit': return send(world.tusScheduleEdit(id, session, input));
    case '/api/tus/schedule/cancel': return send(world.tusScheduleCancel(id, session, input));
    case '/api/tus/autopay/quote': { const r = world.tusAutoPayQuote(id, session, input); set('bw_tus_autopay', r.token, 1800); return send(r.review); }
    case '/api/tus/autopay/confirm': return send(world.tusAutoPayConfirm(id, session, c.bw_tus_autopay, input));
    case '/api/tus/wallet/add': return send(world.tusWalletAdd(id, session, input));
    case '/api/tus/wallet/remove': return send(world.tusWalletRemove(id, session, input));
    case '/api/tus/ebill': return send(world.tusEBill(id, input));
  }
  throw new Fault('Operation not found', 404);
}
