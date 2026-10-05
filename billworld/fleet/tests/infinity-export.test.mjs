// Fleet -> WebArena-Infinity integration: exporter splits/stratification, public/private separation, the task-bound
// control service (stored predicates only, immutable finish, drift refusal), the HTTP reference through the adapter,
// and the worker process contract used by the Python harness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../catalog.mjs';
import { start } from '../server.mjs';
import { exportSuites, selectTasks, splitOf, tenantGroup, heldOutFamilies, evidenceCohort, KNOWN_INFEASIBLE, DEFAULT_SALT } from '../infinity/export.mjs';
import { createControl, startControlServer } from '../infinity/control.mjs';
import { runReference, credentialsFrom } from '../infinity/reference.mjs';
import { spread } from '../infinity/run-reference.mjs';

const catalog = loadCatalog();
const PER = { test: 3, dev: 1, train: 1 };
let cached; const exported = () => cached ||= exportSuites({ catalog, write: false, perStratum: PER });

test('splits: deterministic, tenant groups never straddle splits, held-out families only in test', () => {
  const a = exported(); const b = exportSuites({ catalog, write: false, perStratum: PER });
  assert.deepEqual(Object.keys(a.privateFile.tasks), Object.keys(b.privateFile.tasks), 'same salt gives the same selection');
  assert.equal(a.manifest.exportId, b.manifest.exportId);
  const heldOut = heldOutFamilies([...catalog.byTemplate.keys()]);
  assert.equal(heldOut.length, 4); assert.ok(!heldOut.includes('offline'));
  assert.deepEqual(a.manifest.holdoutFamilies, heldOut);
  const groupSplit = new Map();
  for (const b2 of catalog.billers.values()) {
    const { split, axis } = splitOf(b2, { heldOut });
    if (heldOut.includes(b2.template)) { assert.equal(split, 'test'); assert.equal(axis, 'family'); continue; }
    const g = tenantGroup(b2); const prev = groupSplit.get(g);
    // A group whose members include a held-out family is still consistent for its non-held-out members.
    if (prev) assert.equal(split, prev, `tenant group ${g} straddles splits`); else groupSplit.set(g, split);
  }
  for (const s of ['dev', 'train']) assert.ok(a.suites[s].every(t => !heldOut.includes(t.template)), `${s} contains a held-out family`);
  assert.ok(a.suites.test.some(t => t.split_axis === 'family') && a.suites.test.some(t => t.split_axis === 'tenant'));
  const ids = new Map(); for (const [s, list] of Object.entries(a.suites)) for (const t of list) { assert.ok(!ids.has(t.biller_id) || ids.get(t.biller_id) === s, `biller ${t.biller_id} in two splits`); ids.set(t.biller_id, s); }
});

test('stratification: every template in test, per-(template, cohort) caps, cohorts labelled, infeasible tasks excluded', () => {
  const { suites } = exported();
  const templates = new Set([...catalog.byTemplate.keys()].filter(t => catalog.byTemplate.get(t).length));
  assert.deepEqual(new Set(suites.test.map(t => t.template)), templates, 'test covers every template with billers');
  for (const [split, list] of Object.entries(suites)) {
    const strata = {}; for (const t of list) { const k = `${t.template}|${t.evidence_cohort}`; strata[k] = (strata[k] || 0) + 1; }
    for (const [k, n] of Object.entries(strata)) assert.ok(n <= PER[split], `${split} ${k} has ${n} > ${PER[split]}`);
  }
  for (const t of Object.values(suites).flat()) {
    assert.equal(t.evidence_cohort, evidenceCohort(t.evidence));
    assert.ok(['documented', 'inferred', 'observed', 'synthetic', 'limitation'].includes(t.evidence_cohort));
    assert.ok(!KNOWN_INFEASIBLE.some(x => x.slug === t.task_type && (x.templates === '*' || x.templates.includes(t.template))), `infeasible ${t.id} exported`);
  }
  // Filters select a cohort.
  const only = selectTasks(catalog, { templates: ['smarthub'], slugs: ['pay-bank'], splits: ['test'], perStratum: { test: 2 } }).selected;
  assert.ok(only.length > 0 && only.every(x => x.task.template === 'smarthub' && x.task.id.endsWith(':pay-bank') && x.split === 'test'));
});

test('public task records carry no predicates, expected answers or seeds; instructions carry the credentials', () => {
  const { suites, privateFile } = exported();
  for (const t of Object.values(suites).flat()) {
    for (const k of ['predicates', 'answer', 'scenario', 'seed', 'digest', 'mailPassword']) assert.ok(!(k in t), `public ${t.id} has ${k}`);
    assert.equal(t.verify, 'verify.py'); assert.match(t.id, /^fleet-[a-z-]+-[0-9a-f]{10}$/);
    const priv = privateFile.tasks[t.id]; assert.ok(priv, 'private record exists');
    const creds = credentialsFrom(t.instruction);
    assert.equal(creds.email, priv.persona.email); assert.equal(creds.mailPassword, priv.mailPassword);
    if (['reset-then-pay', 'guest-pay'].includes(t.task_type)) assert.equal(creds.portalPassword, null, `${t.task_type} must not reveal the portal password`);
    if (t.task_type === 'help-phone') for (const d of priv.answer.expected) assert.ok(!t.instruction.replace(/\D/g, '').includes(d), 'help-phone instruction leaks the expected phone');
    assert.ok(!/no_unrequested_changes|amountFrom|predicate/.test(t.instruction));
  }
});

test('control: task-bound episodes grade stored predicates only; finish is immutable; drift is refused', async () => {
  const { suites, privateFile } = exported();
  const dataDir = mkdtempSync(join(tmpdir(), 'fleet-inf-test-'));
  const server = await start({ port: 0, adminPort: 0, dataDir, quiet: true, openWorld: false });
  try {
    const control = createControl({ server, privateFile });
    assert.throws(() => control.createEpisode({ taskId: 'fleet-nope-0000000000' }), e => e.status === 404);
    const pay = suites.test.find(t => t.task_type === 'pay-bank');
    // No-op with caller-supplied empty predicates still fails: the stored predicates are graded.
    const ep = control.createEpisode({ taskId: pay.id });
    assert.match(ep.startUrl, new RegExp(`/enter/${ep.episodeId}/[\\w-]+\\?to=%2Fb%2F${pay.biller_id}%2F$`));
    const first = control.finish({ episodeId: ep.episodeId, answer: '', predicates: [], metadata: { termination: 'completed' } });
    assert.equal(first.success, false); assert.ok(first.results.length >= 3); assert.equal(first.taskId, pay.id);
    const again = control.finish({ episodeId: ep.episodeId, answer: 'Confirmation 123' });
    assert.equal(again.replay, true); assert.deepEqual(again.results, first.results);
    // Reference passes; a correct ledger with a non-completed termination does not count as success.
    const ep2 = control.createEpisode({ taskId: pay.id });
    const ref = await runReference({ startUrl: ep2.startUrl, task: pay });
    assert.deepEqual(ref.errors, []);
    const timedOut = control.finish({ episodeId: ep2.episodeId, answer: ref.answer, metadata: { termination: 'timeout' } });
    assert.equal(timedOut.stateSuccess, true); assert.equal(timedOut.success, false); assert.equal(timedOut.termination, 'timeout');
    // Actions after finish are refused by the engine.
    const ep3 = control.createEpisode({ taskId: pay.id }); control.finish({ episodeId: ep3.episodeId });
    const late = await runReference({ startUrl: ep3.startUrl, task: pay }); assert.ok(late.errors.length > 0, 'a finished episode accepts no payment');
    // Drift: a tampered digest (catalog changed since export) is refused.
    const tampered = structuredClone(privateFile); tampered.tasks[pay.id].digest = '0'.repeat(64);
    const c2 = createControl({ server, privateFile: tampered });
    assert.throws(() => c2.createEpisode({ taskId: pay.id }), e => e.code === 'task_drift');
    assert.deepEqual(c2.drift().map(d => d.taskId), [pay.id]);
    assert.equal(control.drift().length, 0, 'fresh export has no drift');
    // HTTP wrapper requires the bearer token.
    const http = await startControlServer(control);
    try {
      assert.equal((await fetch(http.url + '/health')).status, 401);
      const h = await (await fetch(http.url + '/health', { headers: { Authorization: `Bearer ${http.token}` } })).json();
      assert.equal(h.ready, true); assert.equal(h.exportId, privateFile.exportId);
    } finally { await http.close(); }
  } finally { await server.close(); rmSync(dataDir, { recursive: true, force: true }); }
});

test('reference passes and no-op / wrong answers fail through the adapter (one task per template, all task types)', async () => {
  const { suites, privateFile } = exported();
  const all = [...suites.test, ...suites.dev, ...suites.train];
  const picked = spread(suites.test, { perTemplate: 1 });
  for (const type of new Set(all.map(t => t.task_type))) if (!picked.some(t => t.task_type === type)) picked.push(all.find(t => t.task_type === type));
  const dataDir = mkdtempSync(join(tmpdir(), 'fleet-inf-test-'));
  const server = await start({ port: 0, adminPort: 0, dataDir, quiet: true, openWorld: false });
  const control = createControl({ server, privateFile });
  const fails = [];
  try {
    for (const task of picked) {
      for (const mode of ['reference', 'noop', ...(task.answer_required ? ['wrong'] : [])]) {
        const ep = control.createEpisode({ taskId: task.id });
        const r = await runReference({ startUrl: ep.startUrl, task, mode });
        const s = control.finish({ episodeId: ep.episodeId, answer: r.answer });
        if (s.success !== (mode === 'reference')) fails.push(`${mode} ${task.template} ${task.task_type} ${task.id}: success=${s.success} ${[...r.errors, ...s.failureReasons].join(' | ')}`);
      }
    }
  } finally { await server.close(); rmSync(dataDir, { recursive: true, force: true }); }
  assert.equal(new Set(picked.map(t => t.template)).size, new Set(suites.test.map(t => t.template)).size); assert.ok(picked.length >= 26);
  assert.deepEqual(fails, []);
});

test('worker process: closed world, descriptor 0600, control API bound to the export', { timeout: 120000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-inf-worker-'));
  try {
    exportSuites({ catalog, out: dir, perStratum: { test: 1, dev: 0, train: 0 }, templates: ['smarthub', 'offline'] });
    const port = 20000 + Math.floor(Math.random() * 20000);
    const worker = fileURLToPath(new URL('../infinity/worker.mjs', import.meta.url));
    const child = spawn(process.execPath, [worker, String(port), '--private', join(dir, 'private-tasks.json'), '--runtime', join(dir, 'rt')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
    try {
      const desc = join(dir, 'rt', `worker-${port}.json`);
      for (let i = 0; i < 240 && !/worker ready/.test(out); i++) await new Promise(r => setTimeout(r, 250));
      assert.match(out, /worker ready/); assert.ok(existsSync(desc)); assert.equal(statSync(desc).mode & 0o777, 0o600);
      assert.ok(!out.includes(JSON.parse(readFileSync(desc, 'utf8')).controlToken), 'token never printed');
      const { controlUrl, controlToken } = JSON.parse(readFileSync(desc, 'utf8'));
      const call = (route, body) => fetch(`${controlUrl}/${route}`, { method: 'POST', headers: { Authorization: `Bearer ${controlToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
      const tasks = JSON.parse(readFileSync(join(dir, 'real-tasks.json'), 'utf8'));
      const ep = await call('episodes', { taskId: tasks[0].id });
      assert.ok(ep.startUrl.startsWith(`http://127.0.0.1:${port}/enter/`));
      // Closed world: a cookieless visit to a biller does not create an episode.
      const cold = await fetch(`http://127.0.0.1:${port}/b/${tasks[0].biller_id}/`, { redirect: 'manual' });
      assert.equal(cold.status, 401);
      const fin = await call('finish', { episodeId: ep.episodeId, answer: '' });
      assert.equal(fin.success, false); assert.equal(fin.taskId, tasks[0].id);
    } finally { child.kill('SIGTERM'); await new Promise(r => child.on('exit', r)); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('salt changes the sample but not the split rules', () => {
  const a = selectTasks(catalog, { salt: DEFAULT_SALT, splits: ['test'], perStratum: { test: 1 }, templates: ['kubra'] }).selected.map(x => x.task.id);
  const b = selectTasks(catalog, { salt: 'other-salt', splits: ['test'], perStratum: { test: 1 }, templates: ['kubra'] }).selected.map(x => x.task.id);
  assert.ok(a.length && b.length); assert.notDeepEqual(a, b);
});
