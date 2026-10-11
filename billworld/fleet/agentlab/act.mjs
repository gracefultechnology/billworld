#!/usr/bin/env node
// The ONLY interface an auditor agent uses during an attempt.
//   node billworld/fleet/agentlab/act.mjs <runId> <command> [args...] [--observe]
//   node billworld/fleet/agentlab/act.mjs <runId> help
// Starts the run's daemon (session.mjs) on first use and restarts it if it died. Commands run one at a time per run;
// different runIds are fully isolated (own server, browser, ports, files).
import { spawn } from 'node:child_process';
import { openSync, closeSync, rmSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureRunDir, readJson, sleep } from './lib.mjs';

const [runId, cmd, ...rest] = process.argv.slice(2);
if (!runId || !cmd) { console.log('Usage: act.mjs <runId> <command> [args...]   (act.mjs <runId> help for the command list)'); process.exit(2); }
let dir; try { dir = ensureRunDir(runId); } catch (e) { console.log(`ERROR: ${e.message}`); process.exit(2); }
const observe = rest.includes('--observe');
const args = rest.filter(a => a !== '--observe');
const daemonFile = join(dir, 'daemon.json');
const CLIENT_TIMEOUT = Number(process.env.AGENTLAB_CLIENT_TIMEOUT_MS || 90000);

async function call(d, body, timeout = CLIENT_TIMEOUT) {
  const r = await fetch(`http://127.0.0.1:${d.port}/`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-agentlab-token': d.token }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  return r.json();
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function live() {
  const d = readJson(daemonFile); if (!d || !alive(d.pid)) return null;
  try { const r = await call(d, { cmd: 'ping' }, 3000); return r.ok ? d : null; } catch { return null; }
}
async function ensureDaemon() {
  let d = await live(); if (d) return d;
  if (cmd === 'stop') { console.log(`Run ${runId} is not running.`); process.exit(0); }
  // One spawner at a time per run (lock file; stale after 90 s).
  const lock = join(dir, 'spawn.lock');
  for (let i = 0; i < 900; i++) {
    try { closeSync(openSync(lock, 'wx')); break; }
    catch { try { if (Date.now() - statSync(lock).mtimeMs > 90000) rmSync(lock, { force: true }); } catch {} await sleep(100); if ((d = await live())) return d; }
  }
  try {
    if ((d = await live())) return d;
    const stale = readJson(daemonFile); if (stale?.pid && alive(stale.pid)) { try { process.kill(stale.pid, 'SIGKILL'); } catch {} }
    rmSync(daemonFile, { force: true });
    const logFd = openSync(join(dir, 'daemon.log'), 'a');
    const child = spawn(process.execPath, [fileURLToPath(new URL('./session.mjs', import.meta.url)), runId], { detached: true, stdio: ['ignore', logFd, logFd], env: process.env });
    child.unref(); closeSync(logFd);
    const until = Date.now() + 120000;
    while (Date.now() < until) { await sleep(150); if (existsSync(daemonFile) && (d = await live())) return d; if (child.exitCode != null) break; }
    throw new Error(`the run daemon did not start (see ${join(dir, 'daemon.log')})`);
  } finally { rmSync(lock, { force: true }); }
}

try {
  const d = await ensureDaemon();
  const r = await call(d, { cmd, args, observe }, cmd === 'stop' ? 10000 : CLIENT_TIMEOUT);
  console.log(r.output ?? r.error ?? JSON.stringify(r));
  process.exit(String(r.output || '').startsWith('ERROR') ? 1 : 0);
} catch (e) {
  console.log(`ERROR: ${e.name === 'TimeoutError' ? 'the harness did not answer in time; retry the command (the daemon restarts automatically if it died)' : e.message}`);
  process.exit(1);
}
