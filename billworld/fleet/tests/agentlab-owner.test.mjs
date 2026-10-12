// Regression: two auditors that picked the same runId shared one daemon, and the second auditor's `start` abandoned the
// first one's attempt mid-episode (harness:run-dir-collision). act.mjs now refuses runs it did not create via `new`
// and runs owned by a different key. These checks never start a daemon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACT = fileURLToPath(new URL('../agentlab/act.mjs', import.meta.url));
const lab = mkdtempSync(join(tmpdir(), 'agentlab-owner-'));
function act(args, key) {
  const env = { ...process.env, AGENTLAB_DIR: lab }; delete env.AGENTLAB_KEY; if (key !== undefined) env.AGENTLAB_KEY = key;
  try { return { code: 0, out: execFileSync(process.execPath, [ACT, ...args], { env, encoding: 'utf8', timeout: 20000 }) }; }
  catch (e) { return { code: e.status, out: String(e.stdout) }; }
}

test('a runId that was never created is refused, not created implicitly', () => {
  const r = act(['b5', 'start', 'some-task']);
  assert.equal(r.code, 2); assert.match(r.out, /does not exist/); assert.match(r.out, /act\.mjs new <label>/);
  assert.equal(existsSync(join(lab, 'b5')), false);
});

test('new gives every caller a distinct run with its own key, and a wrapper it never overwrites', () => {
  const wdir = join(lab, 'scratch');
  const a = act(['new', 'blind5', '--wrapper-dir', wdir]), b = act(['new', 'blind5', '--wrapper-dir', wdir]);
  assert.equal(a.code, 0, a.out); assert.equal(b.code, 0, b.out);
  const id = o => o.match(/^RUN (\S+)$/m)[1], key = o => o.match(/^KEY (\S+)$/m)[1], wr = o => o.match(/^WRAPPER (\S+)/m)[1];
  assert.match(id(a.out), /^blind5-[0-9a-f]{6}$/); assert.notEqual(id(a.out), id(b.out)); assert.notEqual(key(a.out), key(b.out));
  const owner = join(lab, id(a.out), 'owner.json');
  assert.equal(statSync(owner).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(owner, 'utf8')).key, key(a.out));
  const w = readFileSync(wr(a.out), 'utf8');
  assert.match(w, new RegExp(`AGENTLAB_KEY=${key(a.out)} exec node .* ${id(a.out)} "\\$@"`));
  assert.notEqual(wr(a.out), wr(b.out));

  // Another session reusing the run id: no key, or the other run's key, is refused before anything reaches the daemon.
  for (const k of [undefined, key(b.out), '']) {
    const r = act([id(a.out), 'start', 'lockwood:task_lw1'], k);
    assert.equal(r.code, 2, r.out); assert.match(r.out, /belongs to/); assert.match(r.out, /Nothing was sent/);
  }
  assert.equal(existsSync(join(lab, id(a.out), 'daemon.json')), false);
  assert.equal(existsSync(join(lab, id(a.out), 'state.json')), false);
});

test('legacy runs made before ownership (no owner.json) stay usable', () => {
  mkdirSync(join(lab, 'legacy-run'));
  const r = act(['legacy-run', 'stop']);   // no daemon: answers locally without starting one
  assert.equal(r.code, 0, r.out); assert.match(r.out, /is not running/);
});

test('bad labels are rejected', () => {
  for (const l of ['../x', '', '-x']) { const r = act(['new', l]); assert.equal(r.code, 2, r.out); }
});
