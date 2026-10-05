import { start } from '../server.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const port = Number(process.argv[2]);
if(process.argv.slice(3).some(arg=>arg!=='--construction')||process.argv.slice(3).length>1)throw new Error('Unsupported worker option');
const construction=process.argv[3]==='--construction';
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid worker port');
const data = resolve(new URL('../data/', import.meta.url).pathname);
mkdirSync(data, { recursive: true, mode: 0o700 });
const server = await start({ port, adminPort: 0, dbPath: `${data}/infinity-${port}.sqlite`, compatibilityReady: true, construction });
// A prior worker may have been killed before its failure hook could run.
server.world.sealActiveTrials('environment_error');
writeFileSync(`${data}/infinity-${port}.json`, JSON.stringify({ adminUrl: server.adminUrl, adminToken: server.adminToken, pid: process.pid, construction }), { mode: 0o600 });
console.log(`Billworld Infinity worker ready on ${server.baseUrl}`);
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await server.close(); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
