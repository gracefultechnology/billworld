// Flow-plan tiers for browser.mjs: every planned flow exists in the driver, tiers filter as documented, and the
// optional (feature-detected) flows are only planned in the extended tier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../catalog.mjs';
import { FLOWS, plannedFlows, CORE_FLOWS, EXTENDED_FLOWS, OPTIONAL_FLOWS } from './driver.mjs';

const catalog = await loadCatalog();
const pick = tpl => [...catalog.billers.values()].find(b => b.template === tpl);

test('every planned flow is implemented and tiers filter correctly', () => {
  for (const tpl of [...new Set([...catalog.billers.values()].map(b => b.template))]) {
    const b = pick(tpl);
    const std = plannedFlows(b, null, {}).map(([f]) => f), ext = plannedFlows(b, null, { extended: true }).map(([f]) => f);
    for (const f of [...ext, ...plannedFlows(b, null, { mobile: true, extended: true }).map(([x]) => x)]) assert.ok(FLOWS[f], `${tpl}: flow ${f} is not implemented`);
    assert.ok(std.every(f => !EXTENDED_FLOWS.has(f)), `${tpl}: standard tier contains extended flows`);
    assert.ok(std.every(f => ext.includes(f)), `${tpl}: extended tier is a superset`);
    assert.ok(!std.includes('mobile_smoke') && !ext.includes('mobile_smoke'), 'mobile_smoke only with --mobile');
    assert.deepEqual(plannedFlows(b, null, { smoke: true }).map(([f]) => f), ['mobile_smoke']);
    const core = plannedFlows(b, null, { core: true }).map(([f]) => f);
    assert.ok(core.every(f => CORE_FLOWS.includes(f) || f === 'offline'), `${tpl}: core tier ${core}`);
    if (b.template !== 'offline') { assert.deepEqual(core, CORE_FLOWS); for (const f of OPTIONAL_FLOWS) assert.ok(ext.includes(f) && !std.includes(f)); }
  }
});
