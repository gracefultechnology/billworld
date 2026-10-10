// Loads dedicated-biller dossiers (billers/<billerId>.json) and applies them to catalog records.
// Invalid dossiers are never applied (the biller stays on the family tier); their errors are kept in
// loadDossiers().errors and reported by billers/validate.mjs and at server start.
// FLEET_DOSSIERS=0 disables dossiers entirely (every biller renders from its family template).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { validateDossier } from './schema.mjs';

const dir = new URL('./', import.meta.url);
export const dossierDir = dir;
// Dossier evidence -> catalog evidence label (tasks.mjs evidenceCohort groups these by prefix).
export const EVIDENCE_LABEL = { observed_public: 'observed_public', documented_official: 'documented_official', inferred: 'inferred_dossier', synthetic: 'synthetic_flow' };

let cache = null;
export function readDossierFiles() {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort().map(f => {
    const id = f.slice(0, -5);
    try { return { id, file: f, data: JSON.parse(readFileSync(new URL(f, dir), 'utf8')) }; } catch (e) { return { id, file: f, parseError: e.message }; }
  });
}
export function loadDossiers({ refresh = false } = {}) {
  if (cache && !refresh) return cache;
  const dossiers = new Map(), errors = {};
  if (!['0', 'false', 'no'].includes(String(process.env.FLEET_DOSSIERS || '').toLowerCase())) {
    for (const f of readDossierFiles()) {
      if (f.parseError) { errors[f.id] = [`JSON parse error: ${f.parseError}`]; continue; }
      const errs = validateDossier(f.data, { fileId: f.id });
      if (errs.length) errors[f.id] = errs; else dossiers.set(f.id, f.data);
    }
  }
  cache = { dossiers, errors };
  return cache;
}

// Merge a dossier onto a built catalog biller (mutates it). `recompute(entry, resolved)` re-derives capabilities when
// the dossier moves the biller to another template.
export function applyDossier(biller, d, { recompute } = {}) {
  biller.tier = 'dedicated';
  Object.defineProperty(biller, 'dossier', { value: d, enumerable: false, configurable: true, writable: true });
  if (d.template && d.template !== biller.template) {
    const resolved = { template: d.template, family: d.template, kind: biller.kind, signal: 'dedicated_dossier' };
    Object.assign(biller, resolved);
    if (recompute) biller.capabilities = recompute(biller.entry, resolved);
  }
  if (d.brand) {
    const b = biller.brand = { ...biller.brand };
    if (d.brand.shortName) b.shortName = d.brand.shortName;
    if (d.brand.displayName) b.displayName = d.brand.displayName;
    if (d.brand.primary) b.primary = d.brand.primary;
    if (d.brand.accent) b.accent = d.brand.accent;
    if (d.brand.monogram) b.monogram = d.brand.monogram;
  }
  if (d.capabilities) {
    const caps = biller.capabilities = { ...biller.capabilities };
    for (const [k, c] of Object.entries(d.capabilities)) caps[k] = { support: c.support, evidence: EVIDENCE_LABEL[c.evidence] || c.evidence, ...(c.source ? { source: c.source } : {}), ...(c.note ? { note: c.note } : {}), ...(c.channel ? { channel: c.channel } : {}), ...(c.phone ? { phone: String(c.phone).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '') } : {}), dossier: true };
    // AutoPay cancel cannot outlive AutoPay itself unless the dossier says so explicitly.
    if (caps.autopay?.support !== 'supported' && caps.autopay_cancel?.support === 'supported' && !d.capabilities.autopay_cancel) caps.autopay_cancel = { ...caps.autopay_cancel, support: caps.autopay.support };
  }
  // Full-balance-only billers offer no payment plans online: the plan page explains instead of showing a form.
  if (d.billing?.fullBalanceOnly && biller.capabilities.payment_arrangement?.support === 'supported') biller.capabilities = { ...biller.capabilities, payment_arrangement: { support: 'unsupported', evidence: 'inferred_dossier', note: 'Payment plans are not offered online; online payments must cover the full balance.', dossier: true } };
  if (d.auth?.socialProviders) {
    const g = d.auth.socialProviders.includes('google');
    biller.capabilities = { ...biller.capabilities, google_login: g ? { support: 'supported', evidence: EVIDENCE_LABEL[d.auth.evidence] || 'documented_official', dossier: true } : { support: 'unsupported', evidence: EVIDENCE_LABEL[d.auth.evidence] || 'documented_official', dossier: true } };
  }
  const f = d.billing?.fees;
  if (f) biller.fees = { bankCents: f.bankCents ?? null, cardCents: f.cardCents ?? null, cardPercent: f.cardPercent ?? null, evidence: EVIDENCE_LABEL[f.evidence] || f.evidence, ...(f.source ? { source: f.source } : {}),
    ...Object.fromEntries(['cardMinCents', 'autopayCardCents', 'autopayCardPercent', 'guestBankCents', 'guestCardCents'].filter(k => f[k] != null).map(k => [k, f[k]])), ...(f.notes ? { notes: f.notes } : {}) };
  // Phone numbers: dossier contact first, then the pay-by-phone capability's number, else the catalog's.
  const digits10 = v => String(v).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const show = v => { const x = digits10(v); return `${x.slice(0, 3)}-${x.slice(3, 6)}-${x.slice(6)}`; };
  const phone = d.contact?.phone, payPhone = d.contact?.payPhone || d.capabilities?.pay_by_phone?.phone;
  if (biller.contact && (phone || payPhone)) {
    biller.contact = { ...biller.contact, ...(phone ? { phone: show(phone), phones: [digits10(phone), ...(biller.contact.phones || []).filter(x => x !== digits10(phone))] } : {}), ...(payPhone ? { payPhone: show(payPhone), payPhones: [digits10(payPhone), ...(biller.contact.payPhones || []).filter(x => x !== digits10(payPhone))] } : {}) };
  }
  return biller;
}
