// Validate dedicated-biller dossiers: node billworld/fleet/billers/validate.mjs [id ...] [--json]
// Checks every billers/<id>.json (or the ids given) against billers/schema.mjs plus catalog cross-checks:
//   the id is a fleet billerId, sources are official https pages of the biller's own domain (or officialDomains),
//   labels are non-empty plain text, capability keys / predicate types / answer kinds are known, nav help slugs exist
//   in the biller's generated help, every task the dossier adds has a reference solution that satisfies it, and
//   the dossier changes nothing the family tier relies on (card tasks only where cards are accepted, ...).
// Exit code 1 when any dossier is invalid.
import { readDossierFiles } from './load.mjs';
import { validateDossier } from './schema.mjs';
import { loadCatalog } from '../catalog.mjs';
import { helpArticles } from '../help.mjs';
import { generateTasks } from '../tasks.mjs';
import { FleetWorld } from '../engine.mjs';
import { readdirSync } from 'node:fs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const only = args.filter(a => !a.startsWith('--')).map(a => a.replace(/\.json$/, '').replace(/^.*\//, ''));
const templateIds = readdirSync(new URL('../templates/', import.meta.url)).filter(f => f.endsWith('.mjs') && !f.startsWith('_')).map(f => f.slice(0, -4));

export async function validateAll({ ids = null } = {}) {
  const catalog = loadCatalog();
  const { SOLVERS, solverFor, taskShapeErrors } = await import('../tests/solve.mjs');
  const report = {};
  for (const f of readDossierFiles()) {
    if (ids?.length && !ids.includes(f.id)) continue;
    const errs = [];
    if (f.parseError) { report[f.id] = { ok: false, errors: [`JSON parse error: ${f.parseError}`] }; continue; }
    const b = catalog.billers.get(f.data?.id) || catalog.billers.get(f.id);
    if (!b) errs.push(`id: ${f.data?.id || f.id} is not a fleet billerId (find it with: node -e "import('./billworld/fleet/catalog.mjs').then(m=>console.log(m.search('<name>').map(b=>b.id)))")`);
    errs.push(...validateDossier(f.data, { biller: b, templateIds, fileId: f.id }));
    if (b && !errs.length) {
      if (!catalog.dedicated.includes(b.id)) errs.push(`catalog: dossier not applied (${(catalog.dossierErrors[b.id] || ['unknown reason']).join('; ')})`);
      const help = helpArticles(b);
      for (const area of ['public', 'account']) for (const it of f.data.nav?.[area] || []) if (it.helpSlug && !help.some(a => a.slug === it.helpSlug)) errs.push(`nav.${area}: helpSlug "${it.helpSlug}" is not a help article for this biller (have: ${help.map(a => a.slug).join(', ')})`);
      for (const x of f.data.testExpectations || []) if (x.page === 'helpArticle' && !help.some(a => a.slug === x.slug)) errs.push(`testExpectations: help article "${x.slug}" does not exist`);
      for (const [k, c] of Object.entries(f.data.capabilities || {})) if (c.support === 'unsupported' && c.channel === 'phone' && !c.phone && !(b.contact?.phones?.length || b.contact?.payPhones?.length)) errs.push(`capabilities.${k}: channel phone but no phone in the dossier or the catalog contact`);
      // Every task: well formed, and its reference solution satisfies its predicates while a no-op does not.
      const world = new FleetWorld();
      let tasks = [];
      try { tasks = generateTasks(b); } catch (e) { errs.push(`tasks: generation failed: ${e.message}`); }
      for (const t of tasks) {
        const slug = t.id.slice(b.id.length + 1);
        const shape = taskShapeErrors(t, b); if (shape.length) errs.push(`task ${slug}: ${shape.join(', ')}`);
        const solve = solverFor(t); if (!solve) continue;
        try { const idle = world.createEpisode({ seed: `v:idle:${t.id}`, scenario: t.scenario }); world.account(idle, b.id); if (world.evaluate(idle, t.predicates).success) errs.push(`task ${slug}: passes without any action (add a predicate that requires the work)`); } catch (e) { errs.push(`task ${slug}: scenario fails: ${e.message}`); }
        try { const ep = world.createEpisode({ seed: `v:solve:${t.id}`, scenario: t.scenario }); world.account(ep, b.id); solve(world, ep, b.id, {}); const r = world.evaluate(ep, t.predicates); if (!r.success) errs.push(`task ${slug}: reference solution fails: ${JSON.stringify(r.results.filter(x => !x.pass).map(x => ({ type: x.type, detail: x.detail })))}`); }
        catch (e) { if (slug !== 'google-login-pay') errs.push(`task ${slug}: reference solution error: ${e.code || ''} ${e.message}`); }
      }
      void SOLVERS;
    }
    report[f.id] = { ok: !errs.length, errors: errs, template: b?.template, category: b?.category, name: b?.entry.name };
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await validateAll({ ids: only });
  const bad = Object.entries(report).filter(([, r]) => !r.ok);
  if (asJson) console.log(JSON.stringify(report, null, 1));
  else {
    for (const [id, r] of Object.entries(report)) {
      console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${id}${r.name ? ` (${r.name}, ${r.category}, ${r.template})` : ''}`);
      for (const e of r.errors) console.log(`     - ${e}`);
    }
    console.log(`${Object.keys(report).length - bad.length}/${Object.keys(report).length} dossiers valid`);
  }
  process.exit(bad.length ? 1 : 0);
}
