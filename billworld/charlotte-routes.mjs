// HTTP routing for the Charlotte County Utilities slice. Mounted by server.mjs before the shared router;
// it only claims requests for episodes whose site runtime is charlotte_paymentus (plus /api/ccu/* rejection elsewhere).
import {readFileSync} from 'node:fs';
import {isCharlotte} from './charlotte.mjs';

const PREFIX = 'biller_7b18707708e2ec35fd63';
const asset = name => readFileSync(new URL('./public/' + name, import.meta.url));
const shell = asset('ccu.html'), files = {'/ccu.js': [asset('ccu.js'), 'text/javascript'], '/ccu.css': [asset('ccu.css'), 'text/css']};
const PUBLIC = {'/': 'website', '/departments/utilities/': 'website', '/departments/utilities/billing/': 'links-pay_bill', '/departments/utilities/utilities-faq.stml': 'help_center_url'};
const DISABLED = '<a aria-label="" aria-disabled="true" title="This destination is not yet available in Billworld">';
function rewrite(html) {
  return html
    .replace(DISABLED + 'www.charlottecountyfl.gov/Paymentus', '<a href="/cp/ccfl">www.charlottecountyfl.gov/Paymentus')
    .replace(DISABLED + 'Manage your account online', '<a href="/cp/ccfl">Manage your account online')
    .replaceAll('<a aria-disabled="true" title="This destination is not yet available in Billworld" data-module-object-id="2" data-id="4229" data-layout="" data-levels="">Pay My Utility Bill', `<a href="/reference-pages/${PREFIX}-links-pay_bill/index.html">Pay My Utility Bill`)
    .replaceAll('<a aria-disabled="true" title="This destination is not yet available in Billworld" data-module-object-id="2" data-id="4231" data-layout="" data-levels="">Electronic Bill Account Search', '<a href="/cp/ccfl">Electronic Bill Account Search');
}

export async function charlotteRoute({req, res, url, c, world, body, json, Fault, cookie, snapshots}) {
  const path = url.pathname, api = path.startsWith('/api/ccu/');
  if (!c.bw_episode) { if (api) throw new Fault('Charlotte County operation unavailable', 404); return false; }
  let site;
  try { world.enter(c.bw_episode, c.bw_access); site = world.session(c.bw_episode, null).site; } catch (error) { if (api) throw error; return false; }
  if (!isCharlotte(site)) { if (api) throw new Fault('Charlotte County operation unavailable', 404); return false; }
  if (path.startsWith('/api/')) {
    if (path === '/api/session' || path.startsWith('/api/mail')) return false;
    if (!api) throw new Fault('This operation is not available for Charlotte County Utilities', 404);
    if (req.method === 'POST' && req.headers.origin !== `http://${req.headers.host}`) throw new Fault('Same-origin request required', 403);
    if (!['GET', 'POST'].includes(req.method)) throw new Fault('Method not allowed', 405);
    const input = req.method === 'POST' ? await body(req) : {};
    const result = world.charlotte(c.bw_episode, req.method, path.slice('/api/ccu/'.length), {session: c.bw_session, query: Object.fromEntries(url.searchParams), input});
    if (result.download) {
      res.writeHead(200, {'Content-Type': result.download.contentType, 'Content-Disposition': `attachment; filename="${result.download.filename}"`, 'Cache-Control': 'no-store'});
      res.end(result.download.bytes); return true;
    }
    if ('session' in result) { res.setHeader('Set-Cookie', cookie('bw_session', result.session, result.session ? 3600 : 0)); delete result.session; }
    json(res, result); return true;
  }
  if (req.method !== 'GET') return false;
  if (path === '/cp/ccfl' || path.startsWith('/cp/ccfl/')) { res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}); res.end(shell); return true; }
  if (files[path]) { res.writeHead(200, {'Content-Type': files[path][1], 'Cache-Control': 'no-store'}); res.end(files[path][0]); return true; }
  const snapshotPath = PUBLIC[path] ? `/reference-pages/${PREFIX}-${PUBLIC[path]}/index.html` : path.startsWith(`/reference-pages/${PREFIX}-`) && path.endsWith('/index.html') ? path : null;
  if (snapshotPath && snapshots.has(snapshotPath)) {
    const snapshot = snapshots.get(snapshotPath);
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
    res.end(rewrite(snapshot.content.toString('utf8'))); return true;
  }
  return false;
}
