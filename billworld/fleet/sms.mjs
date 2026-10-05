// SMS channel for Fleet: the persona's phone inbox (web page /sms and connector /connector/sms), plus
// engine-independent delivery of sign-in codes by text message for the mfa:'sms' scenario.
//
// Storage lives on the episode object (persisted with it): ep.sms = { seq, messages: [{ id:'sms-N', ... }] }.
// The engine supports mfa:'sms' natively (engine.sms() writes the same ep.sms store and logs 'sms_sent'), and the
// server calls normalizeScenario with nativeSms:true. The legacy path (scenario rewritten to 'email' plus
// ep.channels.smsMfa, with installSmsMfa moving the code from the mailbox to the phone) is kept so episodes persisted
// before native support still work.
import { Fault, smsShortCode } from './engine.mjs';
import { html } from './kit.mjs';
import { shellPage } from './shell.mjs';

const store = ep => ep.sms || (ep.sms = { seq: 0, messages: [] });
export const shortCode = smsShortCode;
export const maskPhone = phone => { const d = String(phone || '').replace(/\D/g, ''); return d.length >= 4 ? `(•••) •••-${d.slice(-4)}` : 'your phone'; };

export function deliverSms(world, ep, billerId, text, { sender } = {}) {
  const s = store(ep);
  const b = billerId ? world.biller(billerId) : null;
  const msg = { id: `sms-${++s.seq}`, from: b ? shortCode(b.id) : (sender || '22000'), sender: sender || b?.brand.shortName || 'Billworld', to: ep.persona.phone, billerId: billerId || null, text: String(text).slice(0, 640), receivedAt: ep.clock, unread: true };
  s.messages.push(msg);
  world.event(ep, billerId, 'sms_sent', { smsId: msg.id });
  return msg;
}
export const serializeSms = m => ({ id: m.id, from: m.from, sender: m.sender, to: m.to, text: m.text, receivedAt: new Date(m.receivedAt).toISOString(), unread: !!m.unread });
export function smsById(ep, id) {
  if (typeof id !== 'string' || !/^sms-[1-9]\d{0,8}$/.test(id)) throw new Fault('A text message id (sms-N) is required', 400, 'bad_id');
  const m = store(ep).messages.find(x => x.id === id); if (!m) throw new Fault('Text message not found', 404, 'not_found'); return m;
}
// Newest first. Cursor = id of the last message returned (ids are monotonic).
export function listSms(ep, { q = '', limit, cursor } = {}) {
  const n = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 25));
  const terms = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  let list = store(ep).messages.slice().reverse().filter(m => terms.every(t => t === 'is:unread' ? m.unread : `${m.sender} ${m.from} ${m.text}`.toLowerCase().includes(t.replace(/^from:/, ''))));
  if (cursor) { if (!/^sms-\d+$/.test(String(cursor))) throw new Fault('Unknown cursor', 400, 'bad_cursor'); const c = Number(String(cursor).slice(4)); list = list.filter(m => Number(m.id.slice(4)) < c); }
  const out = list.slice(0, n);
  return { messages: out.map(serializeSms), nextCursor: list.length > n ? out[out.length - 1].id : null };
}

// ---------- mfa:'sms' scenario ----------
// Returns { scenario (engine-safe), smsMfa: { default: bool, billers: [ids] } }.
export function normalizeScenario(scenario = {}, { nativeSms = false } = {}) {
  const out = {}; const smsMfa = { default: false, billers: [] };
  for (const [k, v] of Object.entries(scenario || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && String(v.mfa || '').toLowerCase() === 'sms') {
      out[k] = nativeSms ? v : { ...v, mfa: 'email' }; // native: the engine texts the code itself; smsMfa is still recorded
      if (k === 'default') smsMfa.default = true; else smsMfa.billers.push(k);
    } else out[k] = v;
  }
  return { scenario: out, smsMfa };
}
// A biller-specific scenario that sets its own mfa overrides an episode-wide (default) SMS choice.
export const smsMfaFor = (ep, billerId) => { if (ep.accounts?.[billerId]?.mfa === 'sms') return true; const c = ep.channels?.smsMfa; return !!c && (!!c.billers?.includes(billerId) || (!!c.default && ep.scenario?.[billerId]?.mfa == null)); };

// Wraps this world instance's sendMfa (never the engine class) so SMS-scenario codes go to the phone, not the inbox.
export function installSmsMfa(world) {
  if (world.__smsMfaInstalled) return;
  const original = world.sendMfa.bind(world);
  world.sendMfa = function (ep, billerId, acct) {
    const before = ep.mailbox.length;
    const r = original(ep, billerId, acct);
    if (smsMfaFor(ep, billerId) && ep.mailbox.length === before + 1 && ep.mailbox[0].billerId === billerId && acct.mfaChallenge?.code && ep.mailbox[0].subject.includes(acct.mfaChallenge.code)) {
      ep.mailbox.shift();
      const name = world.biller(billerId).brand.shortName;
      deliverSms(world, ep, billerId, `${name}: ${acct.mfaChallenge.code} is your verification code. It expires in 10 minutes. Don't share this code with anyone.`);
      acct.mfaChannel = 'sms';
    }
    return r;
  };
  world.__smsMfaInstalled = true;
}

// ---------- phone web page ----------
const when = ms => new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export function renderSms({ ep, conversation, csrf = '' }) {
  const msgs = store(ep).messages;
  const convs = new Map();
  for (const m of msgs.slice().reverse()) { if (!convs.has(m.from)) convs.set(m.from, { from: m.from, sender: m.sender, last: m, unread: 0 }); if (m.unread) convs.get(m.from).unread++; }
  const head = html`<header class="dir-top"><a class="mail-logo" href="/sms">Billworld <b>Messages</b></a><span class="who">${ep.persona.phone}</span><a href="/mail">Mail</a></header>`;
  if (conversation) {
    const list = msgs.filter(m => m.from === conversation);
    if (!list.length) throw new Fault('Conversation not found', 404, 'not_found');
    return shellPage(`${list[0].sender} – Messages`, html`${head}<main class="dir sms"><p><a href="/sms">← All conversations</a></p><h1>${list[0].sender} <span class="small">${conversation}</span></h1><ol class="bubbles">${list.map(m => html`<li><p>${m.text}</p><time>${when(m.receivedAt)}</time></li>`)}</ol><form method="post" action="/sms/read"><input type="hidden" name="_csrf" value="${csrf}"><input type="hidden" name="from" value="${conversation}"><button type="submit" name="op" value="unread">Mark as unread</button></form></main>`);
  }
  return shellPage(`Messages${[...convs.values()].some(c => c.unread) ? ` (${[...convs.values()].reduce((a, c) => a + c.unread, 0)})` : ''}`, html`${head}<main class="dir sms"><h1>Messages</h1><p class="small">Text messages sent to ${ep.persona.name}'s phone ${ep.persona.phone}.</p><ul class="results convs">${convs.size ? [...convs.values()].map(c => html`<li class="${c.unread ? 'unread' : ''}"><a href="/sms/c/${c.from}"><b>${c.sender}</b> <span>${c.from}</span>${c.unread ? html` <b class="badge">${c.unread} new</b>` : ''}<br><span>${c.last.text.slice(0, 90)}</span> <time>${when(c.last.receivedAt)}</time></a></li>`) : html`<li class="empty">No text messages.</li>`}</ul></main>`);
}
export const smsCss = `.sms .small{color:#5f6368;font-size:13px}.convs li.unread b{color:#202124}.badge{background:#0b57d0;color:#fff;border-radius:10px;padding:0 8px;font-size:12px}.bubbles{list-style:none;padding:0;display:flex;flex-direction:column;gap:10px}.bubbles li{background:#e9eef6;border-radius:16px;padding:10px 14px;max-width:520px}.bubbles p{margin:0 0 4px;overflow-wrap:anywhere}.bubbles time{color:#5f6368;font-size:12px}.sms form button{border:1px solid #dadce0;background:#fff;color:#0b57d0;border-radius:16px;padding:6px 14px}`;
