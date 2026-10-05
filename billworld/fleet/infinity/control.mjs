// Private, task-bound episode control for the Infinity adapter.
//
// The fleet admin API (/episodes, /finish) grades whatever predicates its caller sends and stores no task binding.
// This control service fixes that for Infinity runs without editing server.mjs: an episode is created FOR an exported
// task id, the predicates and answer spec are re-derived from the catalog (generateTasks) and must match the digest
// recorded at export time, they are stored on the episode, and /finish grades only those stored predicates plus the
// agent's final message. Callers can never supply predicates. /finish is idempotent (first result is immutable).
//
// Endpoints (bearer token, 127.0.0.1 only):
//   GET  /health                     {ready, exportId, fleetRevision, tasks}
//   POST /episodes {taskId, trial}   -> {episodeId, startUrl, deadlineAt, trial}
//   POST /evaluate {episodeId}       diagnostic grade of the stored predicates (does not finish)
//   POST /finish {episodeId, answer, metadata:{termination, agentSteps, agentElapsedMilliseconds}}
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { generateTasks } from '../tasks.mjs';
import { FLEET_REVISION } from '../engine.mjs';
import { predicateDigest, stableJson, EXPORT_FORMAT } from './export.mjs';

export const GRADER_VERSION = 'fleet-infinity-grader/1';
export const TERMINATIONS = ['completed', 'agent_error', 'timeout', 'cancelled', 'environment_error'];
const isToken = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
class ControlError extends Error { constructor(message, status = 400, code = 'invalid') { super(message); this.status = status; this.code = code; } }

export function createControl({ server, privateFile, now = () => Date.now(), dropFinished = true }) {
  if (privateFile?.format !== EXPORT_FORMAT) throw new Error(`Unsupported private task file (expected ${EXPORT_FORMAT})`);
  if (privateFile.fleetRevision !== FLEET_REVISION) console.warn(`[fleet-infinity] export was built for ${privateFile.fleetRevision}, worker runs ${FLEET_REVISION}; digests decide whether each task is still valid`);
  const { world } = server;

  function createEpisode({ taskId, trial = {} } = {}) {
    const rec = privateFile.tasks[taskId];
    if (!rec) throw new ControlError('Unknown task id for this export', 404, 'unknown_task');
    const b = world.biller(rec.billerId);
    const task = generateTasks(b).find(t => t.id === rec.fleetTaskId);
    if (!task) throw new ControlError('Task no longer generated for this biller (catalog changed); re-export', 409, 'task_drift');
    const digest = predicateDigest(task);
    if (digest !== rec.digest) throw new ControlError('Task predicates changed since export; re-export', 409, 'task_drift');
    if (!task.predicates?.length) throw new ControlError('Task has no predicates', 500, 'no_predicates');
    const ep = world.createEpisode({ seed: rec.seed, scenario: task.scenario, kind: 'infinity' });
    if (stableJson(ep.persona) !== stableJson(rec.persona)) { world.episodes.delete(ep.id); throw new ControlError('Persona derivation changed since export; re-export', 409, 'task_drift'); }
    ep.mailPassword = rec.mailPassword;
    world.account(ep, rec.billerId); // seed the ledger now so balances/baselines are fixed at episode start
    const createdAt = now();
    ep.binding = {
      taskId, fleetTaskId: task.id, billerId: task.billerId, predicates: task.predicates, answer: task.answer, digest, exportId: privateFile.exportId,
      fleetRevision: FLEET_REVISION, graderVersion: GRADER_VERSION, createdAt, deadlineAt: createdAt + rec.timeLimitSeconds * 1000,
      trial: { kind: String(trial.kind || 'agent'), agent: trial.agent ?? null, model: trial.model ?? null, runId: trial.runId ?? null, attemptNumber: Number(trial.attemptNumber) || 1, accessMode: 'browser_only' }
    };
    world.persist(ep);
    const startUrl = `${server.baseUrl}/enter/${ep.id}/${ep.entryToken}?to=${encodeURIComponent(rec.startPath)}`;
    return { episodeId: ep.id, startUrl, deadlineAt: ep.binding.deadlineAt, trial: ep.binding.trial, taskId, fleetTaskId: task.id };
  }

  const bound = id => { const ep = world.episode(id); if (!ep.binding) throw new ControlError('Episode is not bound to an exported task', 409, 'unbound'); return ep; };
  const grade = (ep, answer) => world.evaluate(ep, ep.binding.predicates, answer == null ? {} : { answer });

  function evaluate({ episodeId }) { const ep = bound(episodeId); const r = grade(ep); return { success: r.success, results: r.results.map(({ type, pass, detail }) => ({ type, pass, detail })) }; }

  function finish({ episodeId, answer = null, metadata = {} } = {}) {
    const ep = bound(episodeId);
    if (ep.finished) return { ...ep.finished, replay: true };
    const termination = TERMINATIONS.includes(metadata.termination) ? metadata.termination : 'completed';
    const text = typeof answer === 'string' ? answer.slice(0, 4000) : null;
    if (text && text.trim()) world.submitAnswer(ep, text);
    const r = grade(ep);
    const finishedAt = now();
    const deadlineExceeded = finishedAt > ep.binding.deadlineAt + 5000;
    const failureReasons = r.results.filter(x => !x.pass).map(x => `${x.type}${x.detail ? `: ${x.detail}` : ''}`);
    if (termination !== 'completed') failureReasons.unshift(`termination: ${termination}`);
    if (deadlineExceeded) failureReasons.unshift('deadline exceeded');
    const outcome = {
      taskId: ep.binding.taskId, fleetTaskId: ep.binding.fleetTaskId, episodeId: ep.id,
      success: r.success && termination === 'completed' && !deadlineExceeded, stateSuccess: r.success, termination, deadlineExceeded, failureReasons,
      results: r.results.map(({ type, pass, detail }) => ({ type, pass, detail })), answerSubmitted: !!(text && text.trim()),
      exportId: ep.binding.exportId, digest: ep.binding.digest, fleetRevision: FLEET_REVISION, graderVersion: GRADER_VERSION, trial: ep.binding.trial,
      metadata: { agentSteps: Number.isInteger(metadata.agentSteps) ? metadata.agentSteps : null, agentElapsedMilliseconds: Number.isFinite(metadata.agentElapsedMilliseconds) ? metadata.agentElapsedMilliseconds : null },
      elapsedMilliseconds: finishedAt - ep.binding.createdAt
    };
    world.finish(ep, outcome);
    if (dropFinished) world.episodes.delete(ep.id); // persisted on disk; memory stays bounded over long runs
    return { ...ep.finished, replay: false };
  }
  // Tasks whose catalog/generator inputs changed since export (they would be refused at /episodes).
  function drift() {
    const out = [];
    for (const [taskId, rec] of Object.entries(privateFile.tasks)) {
      let b = null; try { b = world.biller(rec.billerId); } catch { out.push({ taskId, reason: 'biller_missing' }); continue; }
      const task = generateTasks(b).find(t => t.id === rec.fleetTaskId);
      if (!task) out.push({ taskId, reason: 'task_missing' }); else if (predicateDigest(task) !== rec.digest) out.push({ taskId, reason: 'digest_changed' });
    }
    return out;
  }
  return { createEpisode, evaluate, finish, drift, privateFile };
}

// HTTP wrapper; returns {url, token, close}.
export async function startControlServer(control, { port = 0, token = randomBytes(24).toString('base64url') } = {}) {
  const srv = http.createServer(async (req, res) => {
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      if (!isToken((req.headers.authorization || '').replace(/^Bearer /, ''), token)) return json({ error: 'unauthorized' }, 401);
      const url = new URL(req.url, 'http://control');
      let input = {};
      if (req.method === 'POST') { let data = ''; for await (const c of req) { data += c; if (data.length > 65536) throw new ControlError('Request too large', 413); } input = data ? JSON.parse(data) : {}; }
      if (url.pathname === '/health') return json({ ready: true, exportId: control.privateFile.exportId, fleetRevision: FLEET_REVISION, tasks: Object.keys(control.privateFile.tasks).length });
      if (url.pathname === '/drift') return json(control.drift());
      if (req.method !== 'POST') return json({ error: 'not found' }, 404);
      if (url.pathname === '/episodes') return json(control.createEpisode(input));
      if (url.pathname === '/evaluate') return json(control.evaluate(input));
      if (url.pathname === '/finish') return json(control.finish(input));
      return json({ error: 'not found' }, 404);
    } catch (e) { json({ error: e.message, code: e.code }, e.status || (e instanceof SyntaxError ? 400 : 500)); }
  });
  await new Promise(r => srv.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, token, close: () => new Promise(r => srv.close(r)) };
}
