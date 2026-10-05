// Summarize Infinity results for Fleet tasks with the cohorts kept apart.
// Reads every result.json under the given directories (Infinity run dirs or smoke artifacts) written by the Fleet
// harness (site_cohort "fleet"). Reports first-attempt strict success by split, evidence cohort, split axis, template and
// task type, and termination counts. Documented, observed, inferred and limitation cohorts are never pooled into one
// headline number; "all" is shown only as a descriptive total.
// Usage: node billworld/fleet/infinity/report.mjs <results-dir> [...] [--json out.json]
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function collect(dirs) {
  const out = [];
  const walk = d => { for (const name of readdirSync(d)) { const p = join(d, name); const st = statSync(p); if (st.isDirectory()) walk(p); else if (name === 'result.json') { try { const r = JSON.parse(readFileSync(p, 'utf8')); if (r.site_cohort === 'fleet') out.push({ ...r, path: p }); } catch {} } } };
  for (const d of dirs) walk(resolve(d));
  return out;
}
export function summarize(rows) {
  const first = rows.filter(r => (r.attempt_number ?? 1) === 1);
  const rate = list => ({ total: list.length, passed: list.filter(r => r.passed).length, rate: list.length ? +(list.filter(r => r.passed).length / list.length).toFixed(4) : null });
  const by = (list, key) => { const m = {}; for (const r of list) (m[r[key] ?? 'unknown'] ||= []).push(r); return Object.fromEntries(Object.entries(m).sort().map(([k, v]) => [k, rate(v)])); };
  const terminations = {}; for (const r of first) terminations[r.termination || 'unknown'] = (terminations[r.termination || 'unknown'] || 0) + 1;
  const splits = {};
  for (const [split, list] of Object.entries(first.reduce((m, r) => ((m[r.split || 'unknown'] ||= []).push(r), m), {}))) {
    splits[split] = { byEvidenceCohort: by(list, 'evidence_cohort'), bySplitAxis: by(list, 'split_axis'), byTemplate: by(list, 'template'), byTaskType: by(list, 'task_type'), byDifficulty: by(list, 'difficulty'), descriptiveTotal: rate(list) };
  }
  return { attempts: rows.length, firstAttempts: first.length, exportIds: [...new Set(rows.map(r => r.export_id).filter(Boolean))], fleetRevisions: [...new Set(rows.map(r => r.fleet_revision).filter(Boolean))], terminations, splits };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2); const j = args.indexOf('--json'); const out = j >= 0 ? args.splice(j, 2)[1] : null;
  if (!args.length) { console.error('usage: report.mjs <results-dir> [...] [--json out.json]'); process.exit(2); }
  const s = summarize(collect(args));
  if (out) writeFileSync(resolve(out), JSON.stringify(s, null, 2));
  console.log(`attempts ${s.attempts}, first attempts ${s.firstAttempts}, exports ${s.exportIds.join(',') || '-'}, terminations ${JSON.stringify(s.terminations)}`);
  if (s.exportIds.length > 1) console.log('WARNING: results mix several exports; compare cohorts within one export only');
  for (const [split, v] of Object.entries(s.splits)) {
    console.log(`\n[${split}] descriptive total ${v.descriptiveTotal.passed}/${v.descriptiveTotal.total}`);
    console.table(Object.fromEntries(Object.entries(v.byEvidenceCohort).map(([k, x]) => [`cohort:${k}`, x])));
    console.table(Object.fromEntries(Object.entries(v.bySplitAxis).map(([k, x]) => [`axis:${k}`, x])));
  }
}
