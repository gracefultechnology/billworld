// HTTP surface for the Malden / Edmunds WIPP slice. Kept out of server.mjs so the shared router only dispatches here.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Fault } from './engine.mjs';

const root = new URL('.', import.meta.url);
const files = { 'malden.js': 'text/javascript', 'malden.css': 'text/css' };
const assets = new Map(Object.keys(files).map(name => [name, readFileSync(new URL(`public/${name}`, root))]));
const shell = readFileSync(new URL('public/malden.html', root));
// Optional captured reference images (git-ignored captures). Served only when present and hash-verified.
const captured = { 'malden-logo.png': ['biller_34e035827712c07332b7-website', 'fccb367e4cf1', 'image/png'], 'malden-footer-logo.png': ['biller_34e035827712c07332b7-website', '1c1e62ea91bf', 'image/png'], 'malden-watertower.jpg': ['biller_34e035827712c07332b7-website', '8bfdb623ac98', 'image/jpeg'] };
for (const [name, [dir, prefix, type]] of Object.entries(captured)) {
  try {
    const listing = JSON.parse(readFileSync(new URL(`captures/${dir}/assets.json`, root)));
    const entry = (Array.isArray(listing) ? listing : listing.assets || []).find(a => (a.sha256 || '').startsWith(prefix));
    const path = entry && new URL(`captures/${dir}/assets/${entry.sha256}`, root);
    if (path && existsSync(path)) { const bytes = readFileSync(path); if (createHash('sha256').update(bytes).digest('hex') === entry.sha256) assets.set(name, bytes), files[name] = type; }
  } catch { /* capture absent: page falls back to text branding */ }
}
export const wippPagePaths = ['/', '/index.php', '/departments/public_works_office/index.php', '/how_do_i/faq.php', '/how_do_i/pay_bill_online.php'];
const isPage = path => wippPagePaths.includes(path) || /^\/wipp(\/[A-Za-z0-9/_-]*)?$/.test(path);

export function wippPage(url, res) {
  const name = url.pathname.slice(1);
  if (assets.has(name)) { res.writeHead(200, { 'Content-Type': files[name], 'Cache-Control': 'no-store' }); return res.end(assets.get(name)); }
  if (!isPage(url.pathname)) throw new Fault('Not found', 404);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(shell);
}

export function wippApi(world, { id, session, method, url, input, setCookie, cookie }) {
  const p = url.pathname.slice('/api/wipp/'.length), q = url.searchParams;
  if (method === 'GET') {
    switch (p) {
      case 'state': return world.wippState(id, session);
      case 'summary': return world.wippSummary(id, session);
      case 'account': return world.wippAccount(id, session, q.get('id'));
      case 'statement': return world.wippStatement(id, session, q.get('id'));
      case 'checkout': return world.wippCheckout(id);
      case 'wallet': return world.wippWallet(id, session);
      case 'autopay': return world.wippAutoPay(id, session);
      case 'ebilling': return world.wippEBilling(id, session);
      case 'profile': return world.wippProfile(id, session);
    }
    throw new Fault('Operation not found', 404);
  }
  const withSession = r => { if (r.session) { setCookie(cookie('bw_session', r.session)); const { session: _, ...safe } = r; return safe; } return r; };
  switch (p) {
    case 'login': return withSession(world.wippLogin(id, input));
    case 'logout': setCookie(cookie('bw_session', '', 0)); return world.wippLogout(id, session);
    case 'register': return world.wippRegister(id, input);
    case 'register/resend': return world.wippRegisterResend(id);
    case 'register/cancel': return world.wippRegisterCancel(id);
    case 'register/verify': return withSession(world.wippRegisterVerify(id, input));
    case 'password/request': return world.wippPasswordRequest(id, input);
    case 'password/reset': setCookie(cookie('bw_session', '', 0)); return world.wippPasswordReset(id, input);
    case 'lookup': return world.wippLookup(id, input);
    case 'lookup/confirm': return world.wippLookupConfirm(id, input);
    case 'accounts/add': return world.wippAddAccount(id, session, input);
    case 'accounts/confirm': return world.wippConfirmAccount(id, session, input);
    case 'accounts/remove': return world.wippRemoveAccount(id, session, input);
    case 'checkout/start': return world.wippCheckoutStart(id, session, input);
    case 'checkout/details': return world.wippCheckoutDetails(id, session, input);
    case 'checkout/submit': return world.wippCheckoutSubmit(id, session, input);
    case 'checkout/cancel': return world.wippCheckoutCancel(id);
    case 'schedule/edit': return world.wippScheduleEdit(id, session, input);
    case 'schedule/delete': return world.wippScheduleDelete(id, session, input);
    case 'wallet/add': return world.wippWalletAdd(id, session, input);
    case 'wallet/edit': return world.wippWalletEdit(id, session, input);
    case 'wallet/delete': return world.wippWalletDelete(id, session, input);
    case 'autopay/enroll': return world.wippAutoPayEnroll(id, session, input);
    case 'autopay/unenroll': return world.wippAutoPayUnenroll(id, session, input);
    case 'ebilling': return world.wippEBillingSave(id, session, input);
    case 'profile': return world.wippProfileSave(id, session, input);
    case 'profile/password': return world.wippChangePassword(id, session, input);
    case 'profile/delete': setCookie(cookie('bw_session', '', 0)); return world.wippDeleteProfile(id, session, input);
  }
  throw new Fault('Operation not found', 404);
}
