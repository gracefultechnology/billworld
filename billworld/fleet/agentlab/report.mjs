// Aggregate blind-agent results.
//   node billworld/fleet/agentlab/report.mjs [--runs r1,r2] [--all-attempts] [--include-abandoned] [--json] [--failures N]
// Reads fleet/.agentlab/<runId>/results.jsonl. By default only each task's FIRST attempt in a run counts (later
// attempts have seen the grading of the earlier one), and abandoned attempts (replaced by another start) are left out.
// Success rates are reported by category, template, task type, evidence cohort and tier; cohorts are never pooled in
// the headline (each is its own row).
import { join } from 'node:path';
import { LAB_DIR, listRuns, readJsonl } from './lib.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const flag = name => process.argv.includes(`--${name}`);
const runs = (arg('runs', '') || '').split(',').filter(Boolean);
const maxFailures = Number(arg('failures', 50));
const ids = runs.length ? runs : listRuns();
let rows = [];
for (const r of ids) rows.push(...readJsonl(join(LAB_DIR, r, 'results.jsonl')));
if (!flag('include-abandoned')) rows = rows.filter(r => r.termination !== 'abandoned');
if (!flag('all-attempts')) { const seen = new Set(); rows = rows.filter(r => { const k = `${r.runId}|${r.taskId}`; if (seen.has(k)) return false; seen.add(k); return true; }); }

const group = key => {
  const m = new Map();
  for (const r of rows) { const k = r[key] ?? '(none)'; const g = m.get(k) || { n: 0, pass: 0, steps: 0, ms: 0 }; g.n++; g.pass += r.success ? 1 : 0; g.steps += r.steps || 0; g.ms += r.ms || 0; m.set(k, g); }
  return [...m.entries()].sort((a, b) => b[1].n - a[1].n || String(a[0]).localeCompare(String(b[0]))).map(([k, g]) => ({ [key]: k, tasks: g.n, passed: g.pass, rate: `${(100 * g.pass / g.n).toFixed(1)}%`, avgSteps: +(g.steps / g.n).toFixed(1), avgSec: +(g.ms / g.n / 1000).toFixed(1) }));
};
const failures = rows.filter(r => !r.success).map(r => ({ runId: r.runId, taskId: r.taskId, attempt: r.attempt, type: r.type, template: r.template, cohort: r.cohort, termination: r.termination, steps: r.steps, failed: r.predicates.filter(p => !p.pass).map(p => `${p.type}${p.kind ? `(${p.kind})` : ''}${p.detail ? `: ${p.detail}` : ''}`), answer: r.answer, lastUrl: r.lastUrl, lastObservation: r.lastObservation }));
const out = { runs: ids, tasks: rows.length, passed: rows.filter(r => r.success).length, byCategory: group('category'), byTemplate: group('template'), byType: group('type'), byCohort: group('cohort'), byTier: group('tier'), failures };
if (flag('json')) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
console.log(`Runs: ${ids.join(', ') || '(none)'}\nTasks: ${out.tasks}, passed ${out.passed} (${out.tasks ? (100 * out.passed / out.tasks).toFixed(1) : '0.0'}%)${flag('all-attempts') ? ' [all attempts]' : ' [first attempt per task]'}`);
for (const [title, t] of [['Evidence cohort', out.byCohort], ['Task type', out.byType], ['Category', out.byCategory], ['Template', out.byTemplate], ['Tier', out.byTier]]) { if (!t.length) continue; console.log(`\n${title}`); console.table(t); }
if (failures.length) {
  console.log(`\nFailures (${failures.length}${failures.length > maxFailures ? `, first ${maxFailures}` : ''})`);
  for (const f of failures.slice(0, maxFailures)) {
    console.log(`\n- ${f.taskId} [run ${f.runId}, attempt ${f.attempt}, ${f.type}, ${f.template}, ${f.cohort}, ${f.termination}, ${f.steps} steps]`);
    for (const p of f.failed) console.log(`    FAIL ${p}`);
    console.log(`    answer: ${JSON.stringify((f.answer || '').slice(0, 300))}`);
    if (f.lastUrl) console.log(`    last URL: ${f.lastUrl}`);
    if (f.lastObservation) console.log(`    last observation: ${f.lastObservation.replace(/\n+/g, ' | ').slice(0, 600)}`);
  }
}
