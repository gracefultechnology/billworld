// Fleet -> WebArena-Infinity exporter.
//
// Converts generated Fleet tasks (tasks.mjs generateTasks) into Infinity task suites for a selectable cohort.
// Output (default billworld/fleet/infinity/build/):
//   real-tasks.json   public Infinity suite = the held-out TEST split (Infinity loads real-tasks by default)
//   dev-tasks.json    public dev split   (run with --task-suite dev-tasks)
//   train-tasks.json  public train split (run with --task-suite train-tasks)
//   private-tasks.json  PRIVATE: seed, scenario, predicates, answer spec, predicate digest per task. Only the worker
//                       reads it; never place it where an evaluated agent can read it.
//   manifest.json     split/cohort/template counts and the export configuration (no predicates).
// Public task records carry only {id, difficulty, instruction, verify} plus descriptive metadata; predicates and the
// expected answers stay in the private file and are re-derived and digest-checked by the worker at episode creation.
//
// Splits (BILLWORLD_PLAN.md "Avoid train/test leakage across sibling brands and portal tenants"):
//   * family axis: a few portal families (templates) are held out entirely; their tasks appear only in test.
//   * tenant axis: every other biller is assigned to train/dev/test by a hash of its tenant group
//     (parent company when the catalog records one, else the biller), so sibling brands never straddle splits.
//   * seed axis: each exported task has its own fixed seed (persona, balances, account numbers).
// Sampling is stratified per (template, evidence cohort): up to N tasks per stratum per split, round-robin over task
// types and distinct billers, ordered by a salted hash so the sample is deterministic for a given --salt.
//
// Usage: node billworld/fleet/infinity/export.mjs [--out dir] [--salt s] [--per-stratum test=8,dev=4,train=8]
//          [--splits test,dev,train] [--templates a,b] [--slugs pay-bank,view-bill] [--evidence documented,inferred,limitation]
//          [--billers id1,id2] [--holdout-families n] [--time-limit 600]
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCatalog } from '../catalog.mjs';
import { generateTasks, evidenceCohort } from '../tasks.mjs';
import { FleetWorld, PASSWORD, FLEET_REVISION } from '../engine.mjs';

export const EXPORT_FORMAT = 'billworld-fleet-infinity/1';
export const DEFAULT_SALT = 'fleet-infinity-v1';
export const DEFAULT_PER_STRATUM = { test: 8, dev: 4, train: 8 };
export const DEFAULT_TIME_LIMIT = 600; // seconds; equals upstream TASK_TIMEOUT
const here = fileURLToPath(new URL('.', import.meta.url));
export const DEFAULT_OUT = resolve(here, 'build');

const sha = (text, n = 64) => createHash('sha256').update(String(text)).digest('hex').slice(0, n);
const unit = text => parseInt(sha(text, 12), 16) / 2 ** 48; // deterministic [0,1)
export const stableJson = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x);
// Everything the agent sees or the grader uses: a change in any of these (catalog or generator drift) invalidates the task.
export const predicateDigest = task => sha(stableJson({ intent: task.intent, template: task.template, kind: task.kind, predicates: task.predicates, answer: task.answer, scenario: task.scenario }));
export const slugOf = task => task.id.slice(task.billerId.length + 1);

// Evidence cohorts are scored separately (fleet README: "inferred_* capabilities should be scored as a separate cohort").
export { evidenceCohort }; // defined in tasks.mjs (every task carries its cohort)
const DIFFICULTY = {
  easy: ['view-bill', 'help-phone', 'paperless-on', 'send-message', 'offline-limitation', 'not-a-biller'],
  hard: ['reset-then-pay', 'mfa-pay', 'sms-mfa-pay', 'google-login-pay', 'register-and-pay', 'guest-pay', 'declined-retry']
};
export const difficultyOf = slug => DIFFICULTY.easy.includes(slug) ? 'easy' : DIFFICULTY.hard.includes(slug) ? 'hard' : 'medium';

const norm = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/\b(inc|llc|corp|corporation|co|company|the|ltd|lp)\b/g, '').replace(/[^a-z0-9]+/g, '');
// Tenant group: sibling brands of one parent company share a group (and therefore a split).
export const tenantGroup = b => { const p = norm(b.entry.parent_company); return p.length >= 3 ? `parent:${p}` : `biller:${b.id}`; };

// Held-out families: the n online templates with the lowest salted hash (stable for a salt). Offline and the generic
// fallback template are never held out (offline is the limitation cohort, generic has no catalog billers).
export function heldOutFamilies(templateIds, { salt = DEFAULT_SALT, n = 4 } = {}) {
  return templateIds.filter(t => !['offline', 'generic'].includes(t)).sort((a, b) => unit(`${salt}:family:${a}`) - unit(`${salt}:family:${b}`)).slice(0, n);
}
export function splitOf(b, { salt = DEFAULT_SALT, heldOut = [] } = {}) {
  if (heldOut.includes(b.template)) return { split: 'test', axis: 'family' };
  const u = unit(`${salt}:tenant:${tenantGroup(b)}`);
  return { split: u < 0.7 ? 'train' : u < 0.8 ? 'dev' : 'test', axis: 'tenant' };
}

// ---------- agent-visible instruction ----------
const ANSWER_TEXT = {
  amount_due: 'In your final message, state the amount due and the due date.',
  confirmation: 'In your final message, state the payment confirmation number shown by the site.',
  phone: 'In your final message, state the phone number.',
  contact: 'In your final message, state the phone number or mailing address to use, or say that none is listed.',
  abstain: 'In your final message, explain what you found.'
};
// Tasks where giving the portal password would let the agent skip the step being tested.
const NO_PORTAL_PASSWORD = new Set(['reset-then-pay', 'guest-pay', 'offline-limitation', 'not-a-biller', 'help-phone']);
export function instructionFor(task, { persona, mailPassword }) {
  const slug = slugOf(task);
  const access = [`You are ${persona.name} (email ${persona.email}). The browser is open on the biller's website and you are signed out`];
  if (slug === 'register-and-pay') access.push(`If you need to choose a portal password, use ${PASSWORD}`);
  // Billers that sign in by account or phone number: the intent already says which identifier to use.
  const ownId = /You sign in with your (?:account number|mobile phone number)/.test(task.intent);
  if (slug !== 'register-and-pay' && !NO_PORTAL_PASSWORD.has(slug)) { const pw = task.passwordLabel ? ` (the site's sign-in form calls it "${task.passwordLabel}")` : ''; access.push(ownId ? `Your portal password${pw} is ${PASSWORD}` : `Your portal username is your email address and your password${pw} is ${PASSWORD}`); }
  else if (slug === 'reset-then-pay') access.push(ownId ? 'You do not know your current portal password' : 'Your portal username is your email address, but you do not know your current portal password');
  access.push(`Your email inbox is at /mail on the same site (sign in with ${persona.email} and mailbox password ${mailPassword})`);
  if (slug === 'sms-mfa-pay') access.push(`Text messages to your phone ${persona.phone} are at /sms on the same site`);
  // Facts only the customer knows that the biller's lookup or registration form asks for (tasks.mjs personaFacts).
  const facts = new Set(task.personaFacts || []);
  if (facts.has('phone') && slug !== 'sms-mfa-pay') access.push(`Your phone number is ${persona.phone}`);
  if (facts.has('dob') && persona.dob) access.push(`Your date of birth is ${new Date(`${persona.dob}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} (${persona.dob})`);
  const answer = task.answer ? ANSWER_TEXT[task.answer.kind] || ANSWER_TEXT.abstain : 'When you are done, reply with a short summary of what you did.';
  return `${task.intent} ${access.join('. ')}. Use only this website and its mailbox. ${answer}`;
}

// Persona and mailbox password are fixed per exported task (seeded), so the static instruction is exact.
export function fixtureFor(task, { salt = DEFAULT_SALT } = {}) {
  const seed = `infinity:${salt}:${task.id}`;
  const world = fixtureFor.world || (fixtureFor.world = Object.assign(Object.create(FleetWorld.prototype), { catalog: null, episodes: new Map(), dataDir: null }));
  const ep = world.createEpisode({ seed });
  world.episodes.delete(ep.id);
  return { seed, persona: ep.persona, mailPassword: `Mailbox-${sha(`${salt}:mail:${task.id}`, 8)}!` };
}

export function infinityId(task) { return `fleet-${slugOf(task)}-${sha(task.id, 10)}`; }

export function publicRecord(task, b, fixture, { split, axis, timeLimit }) {
  const slug = slugOf(task);
  return {
    id: infinityId(task), difficulty: difficultyOf(slug), instruction: instructionFor(task, fixture), verify: 'verify.py',
    site_cohort: 'fleet', fleet_task_id: task.id, biller_id: task.billerId, biller_name: b.entry.name, template: task.template, family: task.family, kind: task.kind,
    task_type: slug, tags: task.tags, evidence: task.evidence, evidence_cohort: evidenceCohort(task.evidence), split, split_axis: axis,
    answer_required: !!task.answer, start_path: `/b/${task.billerId}/`, time_limit_seconds: timeLimit
  };
}
export function privateRecord(task, fixture, { timeLimit }) {
  return { fleetTaskId: task.id, billerId: task.billerId, seed: fixture.seed, mailPassword: fixture.mailPassword, persona: fixture.persona, scenario: task.scenario, predicates: task.predicates, answer: task.answer, digest: predicateDigest(task), startPath: `/b/${task.billerId}/`, timeLimitSeconds: timeLimit };
}

// Generated tasks the template UI cannot complete (reported to the tasks.mjs / template owners). Excluded from exports
// until fixed, and listed in manifest.json; --include-infeasible keeps them.
// (autopay-switch-to-card on the bank-only AutoPay templates is no longer generated: tasks.mjs AUTOPAY_BANK_ONLY.)
// google-login-pay needs the mock Google IdP on a second origin; the browser-only track serves one origin per worker.
export const KNOWN_INFEASIBLE = [
  { slug: 'google-login-pay', templates: '*', reason: 'needs the mock Google IdP (second origin); workers serve the fleet origin only' }
];
export const infeasible = (slug, template) => KNOWN_INFEASIBLE.find(x => x.slug === slug && (x.templates === '*' || x.templates.includes(template))) || null;

// ---------- selection ----------
export function selectTasks(catalog, opts = {}) {
  const { salt = DEFAULT_SALT, perStratum = DEFAULT_PER_STRATUM, splits = ['test', 'dev', 'train'], templates = null, slugs = null, evidence = null, billers = null, holdoutFamilies = 4, includeInfeasible = false } = opts;
  const heldOut = heldOutFamilies([...catalog.byTemplate.keys()], { salt, n: holdoutFamilies });
  const strata = new Map(); // `${split}|${template}|${cohort}` -> Map(slug -> [{task, b, rank}])
  const pool = billers ? billers.map(id => catalog.billers.get(id)).filter(Boolean) : catalog.billers.values();
  for (const b of pool) {
    if (templates && !templates.includes(b.template)) continue;
    const { split, axis } = splitOf(b, { salt, heldOut });
    if (!splits.includes(split)) continue;
    for (const task of generateTasks(b)) {
      const slug = slugOf(task); const cohort = evidenceCohort(task.evidence);
      if (slugs && !slugs.includes(slug)) continue;
      if (evidence && !evidence.includes(cohort)) continue;
      if (!includeInfeasible && infeasible(slug, b.template)) continue;
      if (task.exportable === false) continue; // dedicated-tier tasks the Infinity reference cannot drive yet (custom slugs, non-email sign-in)
      const key = `${split}|${b.template}|${cohort}`;
      if (!strata.has(key)) strata.set(key, new Map());
      const bySlug = strata.get(key); if (!bySlug.has(slug)) bySlug.set(slug, []);
      bySlug.get(slug).push({ task, b, split, axis, rank: unit(`${salt}:pick:${task.id}`) });
    }
  }
  const out = [];
  for (const [key, bySlug] of [...strata].sort(([a], [b]) => a.localeCompare(b))) {
    const split = key.split('|')[0]; const want = billers ? Infinity : (perStratum[split] ?? 0);
    const lists = [...bySlug.entries()].sort(([a], [b]) => unit(`${salt}:slug:${key}:${a}`) - unit(`${salt}:slug:${key}:${b}`)).map(([, l]) => l.sort((x, y) => x.rank - y.rank));
    const used = new Set(); const taken = [];
    // Round-robin over task types, preferring billers not yet used in this stratum.
    for (let round = 0; taken.length < want && lists.some(l => l.length); round++) {
      for (const l of lists) {
        if (taken.length >= want) break;
        const i = l.findIndex(x => !used.has(x.b.id)); const pick = i >= 0 ? l.splice(i, 1)[0] : round > 0 ? l.shift() : null;
        if (pick) { used.add(pick.b.id); taken.push(pick); }
      }
    }
    out.push(...taken);
  }
  return { selected: out, heldOut };
}

// ---------- export ----------
export function exportSuites(opts = {}) {
  const { out = DEFAULT_OUT, salt = DEFAULT_SALT, timeLimit = DEFAULT_TIME_LIMIT, catalog = loadCatalog(), write = true } = opts;
  const { selected, heldOut } = selectTasks(catalog, { ...opts, salt });
  const suites = { test: [], dev: [], train: [] }; const priv = {};
  for (const { task, b, split, axis } of selected) {
    const fixture = fixtureFor(task, { salt });
    const pub = publicRecord(task, b, fixture, { split, axis, timeLimit });
    if (priv[pub.id]) throw new Error(`Infinity id collision: ${pub.id}`);
    suites[split].push(pub); priv[pub.id] = { ...privateRecord(task, fixture, { timeLimit }), split, axis };
  }
  const count = (list, key) => list.reduce((m, t) => (m[t[key]] = (m[t[key]] || 0) + 1, m), {});
  const config = { format: EXPORT_FORMAT, fleetRevision: FLEET_REVISION, salt, perStratum: opts.perStratum || DEFAULT_PER_STRATUM, splits: opts.splits || ['test', 'dev', 'train'], templates: opts.templates || null, slugs: opts.slugs || null, evidence: opts.evidence || null, billers: opts.billers || null, holdoutFamilies: heldOut, timeLimit, excluded: opts.includeInfeasible ? [] : KNOWN_INFEASIBLE };
  const exportId = sha(stableJson({ config, ids: Object.keys(priv).sort(), digests: Object.values(priv).map(p => p.digest).sort() }), 16);
  const manifest = { exportId, ...config, generatedAt: new Date().toISOString(), totals: Object.fromEntries(Object.entries(suites).map(([k, v]) => [k, v.length])),
    bySplit: Object.fromEntries(Object.entries(suites).map(([k, v]) => [k, { templates: count(v, 'template'), evidenceCohorts: count(v, 'evidence_cohort'), taskTypes: count(v, 'task_type'), splitAxis: count(v, 'split_axis'), difficulty: count(v, 'difficulty') }])) };
  const privateFile = { format: EXPORT_FORMAT, exportId, fleetRevision: FLEET_REVISION, salt, tasks: priv };
  if (write) {
    mkdirSync(out, { recursive: true });
    writeFileSync(resolve(out, 'real-tasks.json'), JSON.stringify(suites.test, null, 2) + '\n');
    writeFileSync(resolve(out, 'dev-tasks.json'), JSON.stringify(suites.dev, null, 2) + '\n');
    writeFileSync(resolve(out, 'train-tasks.json'), JSON.stringify(suites.train, null, 2) + '\n');
    writeFileSync(resolve(out, 'private-tasks.json'), JSON.stringify(privateFile) + '\n', { mode: 0o600 });
    writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  return { suites, privateFile, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name, dflt = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
  const list = name => arg(name)?.split(',').map(s => s.trim()).filter(Boolean) || null;
  const perStratum = { ...DEFAULT_PER_STRATUM }; for (const kv of list('per-stratum') || []) { const [k, v] = kv.split('='); perStratum[k] = Number(v); }
  const t0 = Date.now();
  const { manifest } = exportSuites({ out: resolve(arg('out', DEFAULT_OUT)), salt: arg('salt', DEFAULT_SALT), perStratum, splits: list('splits') || undefined, templates: list('templates'), slugs: list('slugs'), evidence: list('evidence'), billers: list('billers'), includeInfeasible: process.argv.includes('--include-infeasible'), holdoutFamilies: Number(arg('holdout-families', 4)), timeLimit: Number(arg('time-limit', DEFAULT_TIME_LIMIT)) });
  console.log(`Export ${manifest.exportId} (${FLEET_REVISION}) in ${Date.now() - t0} ms -> ${resolve(arg('out', DEFAULT_OUT))}`);
  console.log(`  test ${manifest.totals.test}  dev ${manifest.totals.dev}  train ${manifest.totals.train}; held-out families: ${manifest.holdoutFamilies.join(', ')}`);
  console.log(`  test evidence cohorts: ${JSON.stringify(manifest.bySplit.test.evidenceCohorts)}; templates in test: ${Object.keys(manifest.bySplit.test.templates).length}`);
}
