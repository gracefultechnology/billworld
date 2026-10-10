// Dedicated-tier progress: node billworld/fleet/billers/status.mjs [--category electric] [--next 5] [--goal 20] [--json]
// Per catalog category: the dedicated billers (billers/<id>.json), each one's validation and latest browser status
// (fleet/.artifacts/dedicated/<id>.json, written by tests/dedicated.mjs), and progress toward the goal of
// GOAL (10) green dedicated billers per category. --next N lists the most popular billers of each category that have
// no dossier yet (billers/rankings/<category>.json when present, else catalog approx_customers).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { loadCatalog } from '../catalog.mjs';
import { readDossierFiles } from './load.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
// Tier goal per category: 10 for the first tier; raise it (--goal 20 or FLEET_DEDICATED_GOAL=20) for the next tier.
export const GOAL = Number(arg('goal', process.env.FLEET_DEDICATED_GOAL || 10)) || 10;
const latestDir = new URL('../.artifacts/dedicated/', import.meta.url);
const rankDir = new URL('./rankings/', import.meta.url);

export function dedicatedStatus({ next = 0 } = {}) {
  const catalog = loadCatalog();
  const files = new Map(readDossierFiles().map(f => [f.data?.id || f.id, f]));
  const latest = id => { const u = new URL(`${id}.json`, latestDir); try { return existsSync(u) ? JSON.parse(readFileSync(u, 'utf8')) : null; } catch { return null; } };
  const categories = [...new Set([...catalog.billers.values()].map(b => b.category))].sort();
  const out = {};
  for (const c of categories) {
    const ids = [...files.keys()].filter(id => catalog.billers.get(id)?.category === c);
    const rows = ids.map(id => {
      const b = catalog.billers.get(id); const r = latest(id);
      const applied = catalog.dedicated.includes(id);
      const errors = catalog.dossierErrors?.[id] || [];
      // A run is stale when the dossier changed after it (file mtime is not tracked in git; compare reviewedAt too).
      const status = !applied ? 'invalid' : !r ? 'untested' : r.status === 'pass' && !r.quick ? 'green' : r.status === 'pass' ? 'green_quick' : r.status;
      return { id, name: b.entry.name, template: b.template, status, testedAt: r?.at || null, tag: r?.tag || null, flows: r ? `${r.passed}/${r.flows}` : null, failed: r?.failed || [], warnings: r?.warnings || [], errors };
    });
    let suggestions = [];
    if (next) {
      const rf = new URL(`${c}.json`, rankDir);
      let ranked = [];
      try { if (existsSync(rf)) ranked = JSON.parse(readFileSync(rf, 'utf8')).map(x => x.billerId).filter(id => catalog.billers.get(id)); } catch { ranked = []; }
      if (!ranked.length) ranked = [...catalog.billers.values()].filter(b => b.category === c && b.template !== 'offline').sort((a, b) => (b.entry.approx_customers || 0) - (a.entry.approx_customers || 0)).map(b => b.id);
      suggestions = ranked.filter(id => !files.has(id)).slice(0, next).map(id => ({ id, name: catalog.billers.get(id).entry.name, template: catalog.billers.get(id).template }));
    }
    out[c] = { goal: GOAL, dedicated: rows.length, green: rows.filter(r => r.status === 'green').length, billers: rows, ...(next ? { next: suggestions } : {}) };
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const next = Number(arg('next', 0)) || 0; const only = arg('category', '');
  const st = dedicatedStatus({ next });
  if (process.argv.includes('--json')) { console.log(JSON.stringify(only ? { [only]: st[only] } : st, null, 1)); process.exit(0); }
  let total = 0, green = 0;
  for (const [c, s] of Object.entries(st)) {
    total += Math.min(s.green, GOAL); green += s.green;
    if (only && c !== only) continue;
    console.log(`${c.padEnd(26)} ${String(s.green).padStart(2)}/${GOAL} green  (${s.dedicated} dossier${s.dedicated === 1 ? '' : 's'})`);
    for (const r of s.billers) {
      console.log(`   ${r.status.padEnd(11)} ${r.id}  ${r.name} [${r.template}]${r.flows ? ` flows ${r.flows}` : ''}${r.testedAt ? ` @ ${r.testedAt.slice(0, 16)} (${r.tag})` : ''}`);
      for (const f of r.failed) console.log(`      fail ${f.flow}: ${f.error}`);
      for (const e of r.errors.slice(0, 5)) console.log(`      invalid: ${e}`);
      for (const w of r.warnings.slice(0, 5)) console.log(`      warn: ${w}`);
    }
    for (const n of s.next || []) console.log(`   next        ${n.id}  ${n.name} [${n.template}]`);
  }
  const cats = Object.keys(st).length;
  console.log(`\nGoal: ${GOAL} green dedicated billers in each of ${cats} categories = ${GOAL * cats}. Progress: ${total}/${GOAL * cats} (${green} green in total).`);
  void readdirSync;
}
