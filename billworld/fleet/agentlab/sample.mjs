// Deterministic task sample for blind agent runs.
// Usage:
//   node billworld/fleet/agentlab/sample.mjs --category electric [--per-biller 3] [--seed s]
//   node billworld/fleet/agentlab/sample.mjs --template smarthub [--max-billers 20]
//   node billworld/fleet/agentlab/sample.mjs --billers id1,id2
// Options: --tier dedicated|family|all (default: dedicated for --category/--template, falling back to family billers
// when the selection has no dedicated biller), --max-billers N (default 20), --types a,b (only these task types),
// --with-meta (adds template/category/cohort/slug to each row), --no-cover (skip the coverage pass that adds one task
// for every supported type the rotation did not reach).
// Output: JSON [{taskId, billerId, type}] on stdout. Types rotate across the selection so every task type that some
// selected biller supports is covered at least once before any type repeats for a biller.
import { start } from '../server.mjs';
import { typeOf, TYPE_ORDER, unit, slugOf } from './lib.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const category = arg('category', ''), template = arg('template', ''), billerArg = (arg('billers', '') || '').split(',').filter(Boolean);
const perBiller = Math.max(1, Number(arg('per-biller', 3)));
const seed = arg('seed', 'agentlab');
const tier = arg('tier', '');
const maxBillers = Math.max(1, Number(arg('max-billers', 20)));
const onlyTypes = (arg('types', '') || '').split(',').filter(Boolean);
const withMeta = process.argv.includes('--with-meta');
if (!category && !template && !billerArg.length) { console.error('Choose: --category <c> | --template <t> | --billers a,b'); process.exit(2); }

const server = await start({ port: 0, adminPort: 0, quiet: true });
try {
  const { world } = server;
  const all = [...world.catalog.billers.values()];
  let ids;
  if (billerArg.length) { for (const id of billerArg) world.biller(id); ids = billerArg; }
  else {
    const match = b => (category ? b.category === category || b.entry.bill_type === category : true) && (template ? b.template === template : true);
    const ded = all.filter(b => b.dossier && match(b)).map(b => b.id);
    const fam = all.filter(b => !b.dossier && match(b) && b.template !== 'offline').map(b => b.id);
    const offline = all.filter(b => !b.dossier && match(b) && b.template === 'offline').map(b => b.id);
    const order = list => list.slice().sort((a, b) => unit(`${seed}:${a}`) - unit(`${seed}:${b}`));
    if (tier === 'family') ids = order(fam).slice(0, maxBillers);
    else if (tier === 'all') ids = [...order(ded), ...order(fam), ...order(offline).slice(0, 1)].slice(0, maxBillers);
    else ids = (ded.length ? order(ded) : order(fam)).slice(0, maxBillers);
    if (template === 'offline' && !ids.length) ids = order(offline).slice(0, maxBillers);
    if (!ids.length) { console.error(`No billers match ${category ? `category ${category}` : ''}${template ? ` template ${template}` : ''}`); process.exit(1); }
  }
  // Each biller's tasks grouped by type.
  const perB = [];
  for (const id of ids) {
    const b = world.biller(id);
    const extra = new Set((b.dossier?.tasks?.extra || []).map(x => x.slug));
    const tasks = await server.admin(`/tasks?billerId=${encodeURIComponent(id)}`);
    const byType = new Map();
    for (const t of tasks) { const ty = typeOf(t, extra); if (onlyTypes.length && !onlyTypes.includes(ty)) continue; if (!byType.has(ty)) byType.set(ty, []); byType.get(ty).push(t); }
    perB.push({ b, byType });
  }
  // Rotation: each biller takes the types it supports that the sample has used least (ties: seeded order).
  const used = new Map(); const out = [];
  const pickTask = (list, key) => list.slice().sort((x, y) => unit(`${seed}:${key}:${x.id}`) - unit(`${seed}:${key}:${y.id}`))[0];
  const row = (t, b, type) => withMeta ? { taskId: t.id, billerId: b.id, type, slug: slugOf(t), template: b.template, category: b.category, cohort: t.cohort } : { taskId: t.id, billerId: b.id, type };
  for (const { b, byType } of perB) {
    const types = [...byType.keys()].sort((x, y) => (used.get(x) || 0) - (used.get(y) || 0) || unit(`${seed}:${b.id}:${x}`) - unit(`${seed}:${b.id}:${y}`));
    for (const ty of types.slice(0, perBiller)) { out.push(row(pickTask(byType.get(ty), b.id), b, ty)); used.set(ty, (used.get(ty) || 0) + 1); }
  }
  // Coverage pass: a type some biller supports but the rotation never reached gets one task from the biller with it.
  for (const ty of process.argv.includes('--no-cover') ? [] : TYPE_ORDER) {
    if (used.has(ty)) continue;
    const owner = perB.find(p => p.byType.has(ty)); if (!owner) continue;
    out.push(row(pickTask(owner.byType.get(ty), owner.b.id), owner.b, ty)); used.set(ty, 1);
  }
  process.stdout.write(JSON.stringify(out, null, 1) + '\n');
  const summary = [...used.entries()].sort((a, b) => TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0])).map(([k, v]) => `${k}=${v}`).join(' ');
  console.error(`${out.length} tasks, ${ids.length} billers; types: ${summary}`);
} finally { await server.close(); }
process.exit(0);
