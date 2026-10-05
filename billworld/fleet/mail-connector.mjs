// Episode-scoped mail (and SMS) connector for Fleet: a Gmail-like REST surface on the public server, used by
// fleet/mail-mcp.mjs and by runners that hand an agent "email tools" instead of (or as well as) the webmail UI.
//
// Auth: `Authorization: Bearer <connector token>` + `X-Billworld-Episode: <episode id>`. The connector token is
// derived from the episode mailbox secret (never equal to the browser mail cookie), returned only by the private
// admin API (POST /episodes -> connector.token). No grading or billing state is reachable from here.
//
// Endpoints (all JSON):
//   GET  /connector/profile                         -> { emailAddress, phoneNumber, messagesTotal, unread }
//   GET  /connector/messages?q=&limit=&cursor=      -> { messages:[summary], nextCursor, resultSizeEstimate }
//   GET  /connector/message?id=mail-...             -> { message } (does not change unread)
//   GET  /connector/thread?id=thr-...               -> { threadId, messages:[full] } oldest first
//   POST /connector/mark-read {id}                  -> { message }
//   POST /connector/messages/update {id, changes}   -> { message }   changes: unread/starred/archived/trashed booleans
//   GET  /connector/sms?q=&limit=&cursor=           -> { messages, nextCursor }  (persona's phone, newest first)
//   GET  /connector/sms/message?id=sms-N            -> { message }
//   POST /connector/sms/update {id, changes:{unread}} -> { message }
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Fault } from './engine.mjs';
import { listSms, smsById, serializeSms } from './sms.mjs';

const DAY = 86400000, HOUR = 3600000;
export const connectorToken = ep => createHmac('sha256', String(ep.mailToken)).update(`connector-v1:${ep.id}`).digest('base64url').slice(0, 32);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ---------- Gmail-like query subset ----------
// Supported: free text, "quoted phrases", from:, to:, subject:, is:unread|read|starred, in:inbox|trash|starred|anywhere,
// label:inbox|starred|trash, has:link|attachment, newer_than:/older_than: Nd|Nh|Nm(onths)|Ny, after:/before: YYYY/MM/DD,
// a leading '-' negates a clause, and `A OR B` (also `{A B}`) matches either. Unknown operators are free text, as in Gmail.
export function parseQuery(q = '') {
  const toks = String(q).slice(0, 1000).match(/-?(?:[a-z_]+:)?(?:"[^"]*"?|\{[^}]*\}?|[^\s"{}]+)/gi) || [];
  const clauses = [];
  let orNext = false;
  for (const raw of toks) {
    if (raw === 'OR' || raw === '|') { orNext = clauses.length > 0; continue; }
    let t = raw, neg = false;
    if (t.startsWith('-') && t.length > 1) { neg = true; t = t.slice(1); }
    let c;
    if (t.startsWith('{')) { const inner = parseQuery(t.replace(/^\{|\}$/g, '')).flatMap(g => g.any); c = { neg, any: inner }; }
    else {
      const m = t.match(/^([a-z_]+):(.*)$/i);
      const key = m && KEYS.has(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
      const value = (key ? m[2] : t).replace(/^"|"$/g, '').toLowerCase();
      if (!value && !key) continue;
      c = { neg, any: [{ key, value }] };
    }
    if (orNext && clauses.length) { clauses[clauses.length - 1].any.push(...c.any.map(x => ({ ...x, neg: c.neg }))); orNext = false; continue; }
    c.any = c.any.map(x => ({ ...x, neg: x.neg ?? c.neg })); clauses.push(c);
  }
  return clauses;
}
const KEYS = new Set(['from', 'to', 'subject', 'is', 'in', 'label', 'has', 'newer_than', 'older_than', 'after', 'before', 'newer', 'older']);
const span = v => { const m = String(v).match(/^(\d{1,4})([dhmy])$/); if (!m) return null; return Number(m[1]) * ({ h: HOUR, d: DAY, m: 30 * DAY, y: 365 * DAY }[m[2]]); };
const dateOf = v => { const m = String(v).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
const plain = m => String(m.text || '').replace(/\{\{link:\w+\}\}/g, ' ');
function term(m, { key, value }, now) {
  const trashed = m.labels.includes('TRASH');
  switch (key) {
    case null: return `${m.from}\n${m.to}\n${m.subject}\n${plain(m)}`.toLowerCase().includes(value);
    case 'from': return m.from.toLowerCase().includes(value);
    case 'to': return String(m.to).toLowerCase().includes(value);
    case 'subject': return m.subject.toLowerCase().includes(value);
    case 'is': return value === 'unread' ? !!m.unread : value === 'read' ? !m.unread : value === 'starred' ? !!m.starred : value === 'important' ? !!m.important : false;
    case 'in': case 'label': return value === 'anywhere' || value === 'all' ? true : value === 'trash' ? trashed : value === 'starred' ? !!m.starred : value === 'inbox' ? m.labels.includes('INBOX') && !trashed : m.labels.map(l => l.toLowerCase()).includes(value);
    case 'has': return value === 'link' ? (m.links || []).length > 0 : value === 'attachment' ? (m.attachments || []).length > 0 : false;
    case 'newer_than': case 'newer': { const s = span(value); return s != null && m.receivedAt >= now - s; }
    case 'older_than': case 'older': { const s = span(value); return s != null && m.receivedAt < now - s; }
    case 'after': { const d = dateOf(value); return d != null && m.receivedAt >= d; }
    case 'before': { const d = dateOf(value); return d != null && m.receivedAt < d; }
  }
  return false;
}
// Trash is excluded unless the query asks for it (in:trash / in:anywhere), as in Gmail.
export function searchMessages(ep, q = '') {
  const clauses = parseQuery(q);
  const wantsTrash = clauses.some(c => c.any.some(x => !x.neg && (x.key === 'in' || x.key === 'label') && ['trash', 'anywhere', 'all'].includes(x.value)));
  return ep.mailbox.filter(m => (wantsTrash || !m.labels.includes('TRASH')) && clauses.every(c => c.any.some(x => term(m, x, ep.clock) !== !!x.neg)));
}

// ---------- serialization ----------
// linkUrl(message, link) returns an absolute URL for a {{link:key}} placeholder.
export function renderText(m, linkUrl) {
  return String(m.text || '').replace(/\{\{link:(\w+)\}\}/g, (_, key) => { const l = (m.links || []).find(x => x.key === key); return l ? linkUrl(m, l) : ''; });
}
export function summary(m) {
  return { id: m.id, threadId: m.threadId, from: m.from, to: m.to, subject: m.subject, snippet: plain(m).replace(/\s+/g, ' ').trim().slice(0, 160), receivedAt: new Date(m.receivedAt).toISOString(), unread: !!m.unread, starred: !!m.starred, labels: m.labels.slice() };
}
export function fullMessage(m, linkUrl) {
  return { ...summary(m), text: renderText(m, linkUrl), links: (m.links || []).map(l => ({ url: linkUrl(m, l) })), attachments: [] };
}
// Cursor = id of the last message returned; continues by mailbox position, so new mail never shifts a page.
function page(list, all, { limit = 25, cursor }) {
  const n = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 25));
  let rest = list;
  if (cursor) {
    const at = all.findIndex(m => m.id === cursor);
    if (at < 0) throw new Fault('Unknown or expired cursor. Start again without a cursor.', 400, 'bad_cursor');
    const pos = new Map(all.map((m, i) => [m.id, i]));
    rest = list.filter(m => pos.get(m.id) > at);
  }
  const out = rest.slice(0, n);
  return { items: out, nextCursor: rest.length > n ? out[out.length - 1].id : null, total: rest.length };
}

export function applyChanges(m, changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Fault('changes must be an object', 400, 'bad_changes');
  const allowed = ['unread', 'starred', 'archived', 'trashed', 'important'];
  const keys = Object.keys(changes);
  if (!keys.length || keys.some(k => !allowed.includes(k) || typeof changes[k] !== 'boolean')) throw new Fault(`changes may only set booleans for: ${allowed.join(', ')}`, 400, 'bad_changes');
  if ('unread' in changes) m.unread = changes.unread;
  if ('starred' in changes) m.starred = changes.starred;
  if ('important' in changes) m.important = changes.important;
  if (changes.trashed === true && !m.labels.includes('TRASH')) { m.prevLabels = m.labels.slice(); m.labels = ['TRASH']; }
  if (changes.trashed === false && m.labels.includes('TRASH')) { m.labels = (m.prevLabels || ['INBOX']).filter(l => l !== 'TRASH'); delete m.prevLabels; }
  if (changes.archived === true) m.labels = m.labels.filter(l => l !== 'INBOX');
  if (changes.archived === false && !m.labels.includes('INBOX') && !m.labels.includes('TRASH')) m.labels = ['INBOX', ...m.labels];
  return m;
}

// HTTP handler factory. readBody(req) parses JSON; linkUrl(m, l) -> absolute URL; json(res, status, data).
export function createConnector({ world, linkUrl, readBody, json }) {
  function auth(req) {
    const id = req.headers['x-billworld-episode'];
    const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/)?.[1];
    if (typeof id !== 'string' || !/^ep-[\w-]{1,64}$/.test(id) || !bearer) throw new Fault('Connector credentials required', 401, 'unauthorized');
    let ep; try { ep = world.episode(id); } catch { ep = null; }
    if (!ep || !same(bearer, connectorToken(ep))) throw new Fault('Invalid connector credentials', 401, 'unauthorized'); // one message: no episode enumeration
    return ep;
  }
  const find = (ep, id) => {
    if (typeof id !== 'string' || !/^mail-[\w-]{1,40}$/.test(id)) throw new Fault('A message id (mail-...) is required', 400, 'bad_id');
    const m = ep.mailbox.find(x => x.id === id); if (!m) throw new Fault('Message not found', 404, 'not_found'); return m;
  };
  return async function handle(req, res, url) {
    try {
      if (req.headers.cookie && !req.headers.authorization) throw new Fault('Connector credentials required', 401, 'unauthorized');
      const ep = auth(req);
      const p = url.pathname.slice('/connector'.length);
      const sp = url.searchParams;
      if (req.method === 'GET') {
        if (p === '/profile') return json(res, 200, { emailAddress: ep.persona.email, phoneNumber: ep.persona.phone, messagesTotal: ep.mailbox.filter(m => !m.labels.includes('TRASH')).length, unread: ep.mailbox.filter(m => m.unread && !m.labels.includes('TRASH')).length });
        if (p === '/messages') { const list = searchMessages(ep, sp.get('q') || ''); const pg = page(list, ep.mailbox, { limit: sp.get('limit'), cursor: sp.get('cursor') }); return json(res, 200, { messages: pg.items.map(summary), nextCursor: pg.nextCursor, resultSizeEstimate: list.length }); }
        if (p === '/message') return json(res, 200, { message: fullMessage(find(ep, sp.get('id')), linkUrl) });
        if (p === '/thread') {
          const tid = sp.get('id'); if (typeof tid !== 'string' || !/^thr-[\w-]{1,40}$/.test(tid)) throw new Fault('A thread id (thr-...) is required', 400, 'bad_id');
          const msgs = ep.mailbox.filter(m => m.threadId === tid && !m.labels.includes('TRASH')).slice().reverse();
          if (!msgs.length) throw new Fault('Thread not found', 404, 'not_found');
          return json(res, 200, { threadId: tid, messages: msgs.map(m => fullMessage(m, linkUrl)) });
        }
        if (p === '/sms') { const r = listSms(ep, { q: sp.get('q') || '', limit: sp.get('limit'), cursor: sp.get('cursor') }); return json(res, 200, r); }
        if (p === '/sms/message') return json(res, 200, { message: serializeSms(smsById(ep, sp.get('id'))) });
      }
      if (req.method === 'POST') {
        const input = await readBody(req);
        if (p === '/mark-read') { const m = find(ep, input.id); m.unread = false; world.persist(ep); return json(res, 200, { message: fullMessage(m, linkUrl) }); }
        if (p === '/messages/update') { const m = applyChanges(find(ep, input.id), input.changes); world.persist(ep); return json(res, 200, { message: fullMessage(m, linkUrl) }); }
        if (p === '/sms/update') {
          const s = smsById(ep, input.id); const ch = input.changes;
          if (!ch || typeof ch !== 'object' || Object.keys(ch).length !== 1 || typeof ch.unread !== 'boolean') throw new Fault('changes may only set unread (boolean)', 400, 'bad_changes');
          s.unread = ch.unread; world.persist(ep); return json(res, 200, { message: serializeSms(s) });
        }
      }
      throw new Fault('Connector operation not found', 404, 'not_found');
    } catch (e) {
      if (!(e instanceof Fault)) throw e;
      return json(res, e.status, { error: e.message, code: e.code });
    }
  };
}
