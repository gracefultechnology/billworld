// Authenticated HTTP regression test: for the first biller of every online template, sign in through the template's
// own forms, render every signed-in page and submit each account form through act() with ledger assertions.
// The catalog-wide version of the same checks is the sweep's "authed" phase.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { start } from '../server.mjs';
import { authedChecks, Client, parseForms, encodeForm, leakCheck } from './httpflows.mjs';

let server, agent;
before(async () => { server = await start({ port: 0, adminPort: 0, quiet: true }); agent = new http.Agent({ keepAlive: true, maxSockets: 8 }); });
after(async () => { agent.destroy(); await server.close(); });

test('form parser and encoder follow browser rules', () => {
  const [f] = parseForms('<form method="post" action="/x"><input type="hidden" name="_csrf" value="a&amp;b"><input type="radio" name="r" value="1"><input type="radio" name="r" value="2" checked><input type="checkbox" name="c"><select name="s"><option value="x">X</option><option value="y" selected>Y</option></select><textarea name="t">hi</textarea><button name="op" value="submit">Go</button></form>');
  assert.equal(encodeForm(f), '_csrf=a%26b&r=2&s=y&t=hi&op=submit');
  assert.equal(encodeForm(f, { r: '1', c: true }), '_csrf=a%26b&r=1&c=on&s=y&t=hi&op=submit');
  assert.throws(() => encodeForm(f, { missing: 'x' }), /no field missing/);
  assert.throws(() => encodeForm(f, { r: '9' }), /no option 9/);
  assert.equal(leakCheck('<p>evidence: inferred_family</p>'), 'research metadata in page: "inferred_family"');
  assert.equal(leakCheck('<p>Pay your bill</p>'), null);
});

test('every online template: signed-in pages render and account forms work over HTTP', async () => {
  const world = server.world; const failures = [];
  for (const [templateId, ids] of world.catalog.byTemplate) {
    if (templateId === 'offline') continue;
    const id = ids.find(x => world.biller(x).capabilities.online_account.support !== 'unsupported'); if (!id) continue;
    const ep = world.createEpisode({ seed: `authed-test-${id}`, kind: 'sweep' });
    const client = new Client(server.baseUrl, agent); client.cookies.set('bwf_ep', ep.id); client.cookies.set('bwf_at', ep.entryToken);
    const fails = await authedChecks({ server, world, ep, biller: world.biller(id), client });
    failures.push(...fails.map(f => `${templateId} ${id} ${f}`));
    world.episodes.delete(ep.id);
  }
  assert.deepEqual(failures, []);
});
