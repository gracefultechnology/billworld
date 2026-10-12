// Shared helpers for the blind agent harness (sample.mjs, session.mjs, act.mjs, report.mjs).
import { mkdirSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const FLEET_DIR = fileURLToPath(new URL('..', import.meta.url));
export const LAB_DIR = process.env.AGENTLAB_DIR || join(FLEET_DIR, '.agentlab');
export const runDir = runId => {
  if (!/^[A-Za-z0-9][\w.-]{0,63}$/.test(runId || '')) throw new Error(`Invalid runId "${runId}": use 1-64 chars of letters, digits, '.', '_' or '-'`);
  return join(LAB_DIR, runId);
};
export const ensureRunDir = runId => { const d = runDir(runId); mkdirSync(join(d, 'screenshots'), { recursive: true }); mkdirSync(join(d, 'data'), { recursive: true }); return d; };
export const readJson = (file, dflt = null) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return dflt; } };
export const readJsonl = file => existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
export const listRuns = () => existsSync(LAB_DIR) ? readdirSync(LAB_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) : [];
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export const slugOf = task => task.id.slice(task.billerId.length + 1);

// Task type groups used for sampling rotation and reporting.
const TYPE_BY_SLUG = {
  'pay-bank': 'payment', 'pay-minimum': 'payment', 'pay-partial-card': 'payment', 'declined-retry': 'payment',
  'schedule-payment': 'scheduled', 'cancel-scheduled': 'cancel-scheduled',
  'autopay-enroll': 'autopay-enroll', 'autopay-switch-to-card': 'autopay-enroll', 'autopay-cancel': 'autopay-cancel',
  'paperless-on': 'paperless',
  'cancel-service': 'cancel-service', 'accept-retention': 'cancel-service', 'undo-cancellation': 'cancel-service',
  'downgrade-plan': 'plan-change',
  'reset-then-pay': 'reset-then-pay', 'mfa-pay': 'mfa-email', 'sms-mfa-pay': 'mfa-sms', 'google-login-pay': 'google-login',
  'register-and-pay': 'register-and-pay', 'guest-pay': 'guest-pay',
  'view-bill': 'view-bill', 'help-phone': 'help',
  'offline-limitation': 'limitation', 'not-a-biller': 'limitation',
  'setup-payment-plan': 'account-other', 'send-message': 'account-other', 'remove-old-card': 'account-other'
};
// dossierExtra: slugs from the biller's dossier tasks.extra (biller-specific tasks).
export function typeOf(task, dossierExtra = new Set()) {
  const slug = slugOf(task);
  if (dossierExtra.has(slug)) return 'dossier';
  if (/-limitation$/.test(slug)) return 'limitation';
  return TYPE_BY_SLUG[slug] || 'other';
}
export const TYPE_ORDER = ['payment', 'scheduled', 'cancel-scheduled', 'autopay-enroll', 'autopay-cancel', 'paperless', 'cancel-service', 'limitation', 'plan-change', 'reset-then-pay', 'mfa-email', 'mfa-sms', 'register-and-pay', 'guest-pay', 'view-bill', 'help', 'dossier', 'account-other', 'google-login', 'other'];

// Deterministic 32-bit hash -> [0,1).
export function unit(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1e9) / 1e9; }

// Run ownership. A run created with `act.mjs new <label>` gets a random suffix (so two auditors that pick the same label
// still get different runs) and an owner key in owner.json (0600). Every later command must carry that key in
// AGENTLAB_KEY, so a second session that reuses the runId (for example a copied wrapper) is refused instead of
// silently driving -- and abandoning -- the first session's attempt. Runs made before ownership existed have no
// owner.json and stay usable; act.mjs no longer creates a run implicitly.
export const OWNER_FILE = 'owner.json';
export function newRun(label) {
  if (!/^[A-Za-z0-9][\w.-]{0,40}$/.test(label || '')) throw new Error(`Invalid label "${label}": use 1-41 chars of letters, digits, '.', '_' or '-'`);
  mkdirSync(LAB_DIR, { recursive: true });
  for (let i = 0; i < 8; i++) {
    const runId = `${label}-${randomBytes(3).toString('hex')}`;
    const d = runDir(runId);
    try { mkdirSync(d); } catch (e) { if (e.code === 'EEXIST') continue; throw e; }   // exclusive: never reuse a run
    const key = randomBytes(16).toString('hex');
    writeFileSync(join(d, OWNER_FILE), JSON.stringify({ key, label, createdAt: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
    ensureRunDir(runId);
    return { runId, key, dir: d };
  }
  throw new Error('could not allocate a unique run id; retry');
}
// -> null when the caller may use the run, else the refusal text.
export function runAccessError(runId, key = process.env.AGENTLAB_KEY) {
  let d; try { d = runDir(runId); } catch (e) { return e.message; }
  const create = 'Create your own run with: node billworld/fleet/agentlab/act.mjs new <label>   (it prints the run id, the key and a wrapper)';
  if (!existsSync(d)) return `Run "${runId}" does not exist. Runs are no longer created implicitly, so two sessions cannot share one by picking the same name. ${create}`;
  const owner = readJson(join(d, OWNER_FILE));
  if (!owner) return null;   // legacy run (made before ownership)
  const a = Buffer.from(String(key || '')), b = Buffer.from(String(owner.key || ''));
  if (a.length === b.length && b.length && timingSafeEqual(a, b)) return null;
  return `Run "${runId}" belongs to ${key ? 'another session (AGENTLAB_KEY does not match)' : 'a session whose key you did not pass (set AGENTLAB_KEY to the key printed by "new")'}. Nothing was sent to it. If you did not create this run, do not use it: another auditor is working in it. ${create}`;
}
