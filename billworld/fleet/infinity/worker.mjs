// Infinity worker: one Fleet server per Infinity worker port, plus the private task-bound control service.
// Usage: node worker.mjs <port> [--private <private-tasks.json>] [--runtime <dir>]
// Writes <runtime>/worker-<port>.json (mode 0600) with the control URL and token for the Python harness. Nothing
// private is printed. The public port serves only the fleet (closed world: only /enter links start episodes).
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from '../server.mjs';
import { createControl, startControlServer } from './control.mjs';
import { DEFAULT_OUT } from './export.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid worker port');
const privatePath = resolve(arg('private', process.env.BILLWORLD_FLEET_INFINITY_PRIVATE || `${DEFAULT_OUT}/private-tasks.json`));
const runtime = resolve(arg('runtime', process.env.BILLWORLD_FLEET_INFINITY_RUNTIME || `${here}/.runtime`));
mkdirSync(runtime, { recursive: true, mode: 0o700 });
const dataDir = `${runtime}/episodes-${port}`;
const privateFile = JSON.parse(readFileSync(privatePath, 'utf8'));

const server = await start({ port, adminPort: 0, dataDir, quiet: true, openWorld: false });
const control = createControl({ server, privateFile });
const ctl = await startControlServer(control);
const descriptor = `${runtime}/worker-${port}.json`;
writeFileSync(descriptor, JSON.stringify({ controlUrl: ctl.url, controlToken: ctl.token, baseUrl: server.baseUrl, pid: process.pid, exportId: privateFile.exportId, dataDir }), { mode: 0o600 });
const drifted = control.drift();
console.log(`Billworld Fleet Infinity worker ready on ${server.baseUrl} (export ${privateFile.exportId}${drifted.length ? `; WARNING ${drifted.length} tasks drifted since export, re-export` : ''})`);
let stopping = false;
async function stop() { if (stopping) return; stopping = true; try { rmSync(descriptor, { force: true }); } catch {} await Promise.all([server.close(), ctl.close()]); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
