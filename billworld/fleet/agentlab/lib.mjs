// Shared helpers for the blind agent harness (sample.mjs, session.mjs, act.mjs, report.mjs).
import { mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const FLEET_DIR = fileURLToPath(new URL('..', import.meta.url));
export const LAB_DIR = join(FLEET_DIR, '.agentlab');
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
