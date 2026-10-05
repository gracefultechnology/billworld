// Node-level adapter check without Python: for each selected exported task, create a task-bound episode through the
// control service, run the scripted HTTP reference (and a no-op / wrong-answer attempt), and grade via /finish.
// The Python smoke (smoke.py) runs the same reference through Infinity's own run_task lifecycle.
//
// Usage: node billworld/fleet/infinity/run-reference.mjs [--export dir] [--suite real-tasks] [--per-template 2]
//          [--task-types a,b] [--limit n] [--negatives all|sample|none] [--out results.json] [--concurrency 4]
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { start } from '../server.mjs';
import { createControl } from './control.mjs';
import { runReference } from './reference.mjs';
import { DEFAULT_OUT } from './export.mjs';

// Spread a suite over templates and task types: up to `perTemplate` tasks per template, distinct task types first.
export function spread(tasks, { perTemplate = 2, taskTypes = null } = {}) {
  const byT = new Map();
  for (const t of tasks) { if (taskTypes && !taskTypes.includes(t.task_type)) continue; if (!byT.has(t.template)) byT.set(t.template, []); byT.get(t.template).push(t); }
  const out = []; const typeUse = new Map();
  for (const [, list] of [...byT].sort(([a], [b]) => a.localeCompare(b))) {
    const picked = []; const rest = [...list];
    // Within a template: rotate evidence cohorts, then prefer task types used least so far across templates.
    const key = t => [picked.filter(p => p.evidence_cohort === t.evidence_cohort).length, picked.some(p => p.task_type === t.task_type) ? 1 : 0, typeUse.get(t.task_type) || 0];
    while (picked.length < perTemplate && rest.length) {
      rest.sort((x, y) => { const a = key(x), b = key(y); return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; });
      const t = rest.shift(); picked.push(t); typeUse.set(t.task_type, (typeUse.get(t.task_type) || 0) + 1);
    }
    out.push(...picked);
  }
  return out;
}

export async function runAll({ exportDir = DEFAULT_OUT, suite = 'real-tasks', tasks = null, perTemplate = 2, taskTypes = null, limit = Infinity, negatives = 'all', concurrency = 4, log = console.log } = {}) {
  const privateFile = JSON.parse(readFileSync(resolve(exportDir, 'private-tasks.json'), 'utf8'));
  const suiteTasks = tasks || spread(JSON.parse(readFileSync(resolve(exportDir, `${suite}.json`), 'utf8')), { perTemplate, taskTypes }).slice(0, limit);
  const dataDir = mkdtempSync(join(tmpdir(), 'fleet-inf-'));
  const server = await start({ port: 0, adminPort: 0, dataDir, quiet: true, openWorld: false });
  const control = createControl({ server, privateFile });
  const results = [];
  const attempt = async (task, mode) => {
    let ep;
    try { ep = control.createEpisode({ taskId: task.id, trial: { kind: 'reference_script', agent: `fleet-http-${mode}` } }); }
    catch (e) { return { id: task.id, fleetTaskId: task.fleet_task_id, template: task.template, taskType: task.task_type, evidenceCohort: task.evidence_cohort, split: task.split, mode, passed: false, setupError: e.code || 'error', errors: [e.message], failureReasons: [] }; }

    const began = Date.now(); const ref = await runReference({ startUrl: ep.startUrl, task, mode });
    const score = control.finish({ episodeId: ep.episodeId, answer: ref.answer, metadata: { termination: 'completed', agentSteps: ref.steps, agentElapsedMilliseconds: Date.now() - began } });
    return { id: task.id, fleetTaskId: task.fleet_task_id, template: task.template, taskType: task.task_type, evidenceCohort: task.evidence_cohort, split: task.split, mode, passed: score.success, steps: ref.steps, errors: ref.errors, answer: ref.answer, failureReasons: score.failureReasons };
  };
  const queue = suiteTasks.map((t, i) => ({ t, i }));
  try {
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const { t, i } = queue.shift();
        const r = await attempt(t, 'reference'); results.push(r);
        log(`${r.passed ? 'PASS' : 'FAIL'} reference ${t.template} ${t.task_type} ${t.id}${r.passed ? '' : ` — ${[...r.errors, ...r.failureReasons].join(' | ').slice(0, 300)}`}`);
        if (r.setupError) continue;
        if (negatives === 'all' || (negatives === 'sample' && i % 3 === 0)) {
          const n = await attempt(t, 'noop'); results.push(n);
          if (n.passed) log(`FAIL noop passed ${t.template} ${t.task_type} ${t.id}`);
          if (t.answer_required) { const w = await attempt(t, 'wrong'); results.push(w); if (w.passed) log(`FAIL wrong-answer passed ${t.template} ${t.task_type} ${t.id}`); }
        }
      }
    }));
  } finally { await server.close(); rmSync(dataDir, { recursive: true, force: true }); }
  const ref = results.filter(r => r.mode === 'reference'); const neg = results.filter(r => r.mode !== 'reference');
  const summary = { exportId: privateFile.exportId, tasks: ref.length, drifted: ref.filter(r => r.setupError === 'task_drift').length, referencePassed: ref.filter(r => r.passed).length, templates: new Set(ref.map(r => r.template)).size, taskTypes: new Set(ref.map(r => r.taskType)).size, negatives: neg.length, negativesWronglyPassed: neg.filter(r => r.passed).length };
  return { summary, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
  const { summary, results } = await runAll({ exportDir: resolve(arg('export', DEFAULT_OUT)), suite: arg('suite', 'real-tasks'), perTemplate: Number(arg('per-template', 2)), taskTypes: arg('task-types', null)?.split(','), limit: Number(arg('limit', Infinity)), negatives: arg('negatives', 'all'), concurrency: Number(arg('concurrency', 4)) });
  if (arg('out')) writeFileSync(resolve(arg('out')), JSON.stringify({ at: new Date().toISOString(), summary, results }, null, 1));
  console.log(JSON.stringify(summary));
  process.exit(summary.referencePassed === summary.tasks && !summary.negativesWronglyPassed ? 0 : 1);
}
