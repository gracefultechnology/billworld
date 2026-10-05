"""Validate the Fleet adapter through Infinity's own run_task lifecycle with a scripted reference (no model, no API key).

Starts the app's server.py (the fleet worker) exactly as Infinity's runner would, then for a stratified selection of
exported tasks (default: 2 per template of the test suite, distinct task types first):
  * reference   the scripted HTTP reference (reference.mjs) must PASS through harness.run_task;
  * no-op       an agent that does nothing and answers "" must FAIL;
  * wrong       for answer tasks, a confident wrong final message must FAIL;
plus lifecycle checks (agent crash, browser-setup crash, timeout, cancellation, deadline) and grader-binding checks
(caller predicates are ignored, /finish is immutable, an unknown task id is rejected).
Writes results.json, summary.json and Infinity's report.html under --artifacts-dir.

Usage (repo root):
  .upstream/smoke-venv/bin/python billworld/fleet/infinity/smoke.py --artifacts-dir /abs/empty/dir [--per-template 2]
      [--suite real-tasks] [--task-ids a,b] [--export billworld/fleet/infinity/build] [--checkout .upstream/webarena-infinity]
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import uuid
from urllib.error import HTTPError
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--checkout', type=Path, default=ROOT / '.upstream/webarena-infinity')
parser.add_argument('--export', type=Path, default=HERE / 'build')
parser.add_argument('--suite', default='real-tasks')
parser.add_argument('--per-template', type=int, default=2)
parser.add_argument('--task-ids')
parser.add_argument('--negatives', choices=['all', 'none'], default='all')
parser.add_argument('--artifacts-dir', type=Path, required=True)
parser.add_argument('--startup-timeout', type=float, default=180)
args = parser.parse_args()
sys.path.insert(0, str(args.checkout / 'evaluation'))
sys.path.insert(0, str(HERE))
from agents import AgentResult  # noqa: E402
from tasks import run_task  # noqa: E402
from report import generate_report  # noqa: E402
import install as fleet_install  # noqa: E402


class EnvironmentFailure(RuntimeError):
    billworld_failure_kind = 'environment_error'


class Reference:
    mode = 'reference'

    async def reset_for_task(self, start_url):
        self.start_url = start_url  # each attempt uses a fresh HTTP client (fresh cookie jar)

    async def run(self, task, server_url, task_dir):
        assert server_url == self.start_url
        public = next(t for t in self.tasks if t['instruction'] == task)
        (task_dir / 'task.json').write_text(json.dumps(public))
        begin = time.monotonic()
        process = await asyncio.create_subprocess_exec(os.environ.get('BILLWORLD_NODE', 'node'), str(HERE / 'reference.mjs'), server_url, str(task_dir / 'task.json'), '--mode', self.mode,
                                                       stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, stderr = await process.communicate()
        if process.returncode:
            (task_dir / 'reference-error.txt').write_text(stderr.decode())
            raise EnvironmentFailure('reference process failed')
        out = json.loads(stdout)
        (task_dir / 'reference.json').write_text(json.dumps(out, indent=2))
        return AgentResult(time.monotonic() - begin, out['steps'], True, out['answer'], out['errors'])


class NoAction(Reference):
    mode = 'noop'


class WrongAnswer(Reference):
    mode = 'wrong'


class Crash(Reference):
    async def run(self, **kwargs):
        raise RuntimeError('Synthetic agent crash')


class SetupCrash(Reference):
    async def reset_for_task(self, start_url):
        raise RuntimeError('Synthetic browser setup failure')


class Timeout(Reference):
    async def run(self, **kwargs):
        raise asyncio.TimeoutError()


class Hanging(Reference):
    def __init__(self):
        self.entered = asyncio.Event()
        self.cancelled = False

    async def run(self, **kwargs):
        self.entered.set()
        try:
            await asyncio.Future()
        finally:
            self.cancelled = True


def spread(tasks, per_template):
    by_template, out, type_use = {}, [], {}
    for t in tasks:
        by_template.setdefault(t['template'], []).append(t)
    for template in sorted(by_template):
        picked = []
        candidates = list(by_template[template])
        while len(picked) < per_template and candidates:
            candidates.sort(key=lambda t: (sum(p['evidence_cohort'] == t['evidence_cohort'] for p in picked),
                                           any(p['task_type'] == t['task_type'] for p in picked), type_use.get(t['task_type'], 0)))
            t = candidates.pop(0)
            picked.append(t)
            type_use[t['task_type']] = type_use.get(t['task_type'], 0) + 1
        out.extend(picked)
    return out


def control(app, port, route, payload):
    config = json.loads((app / 'billworld-fleet.json').read_text())
    worker = json.loads((Path(config['runtime']) / f'worker-{port}.json').read_text())
    request = Request(worker['controlUrl'] + '/' + route, data=json.dumps(payload).encode(),
                      headers={'Authorization': 'Bearer ' + worker['controlToken'], 'Content-Type': 'application/json'})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


async def wait_ready(url, process, descriptor, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError('Fleet worker exited during startup')
        try:
            with urlopen(url + '/', timeout=2) as response:
                if response.status == 200 and descriptor.exists():
                    return
        except OSError:
            pass
        await asyncio.sleep(0.25)
    raise RuntimeError(f'Fleet worker not ready after {timeout:g}s')


async def main():
    artifacts = args.artifacts_dir.resolve()
    if artifacts.exists() and any(artifacts.iterdir()):
        raise SystemExit('Choose an empty --artifacts-dir so earlier runs are preserved')
    artifacts.mkdir(parents=True, exist_ok=True)
    app = fleet_install.install(args.export, artifacts / 'app', args.checkout, bootstrap=False, runtime=artifacts / 'runtime')
    suite = json.loads((app / f'{args.suite}.json').read_text())
    selected = [t for t in suite if t['id'] in args.task_ids.split(',')] if args.task_ids else spread(suite, args.per_template)
    for cls in (Reference,):
        cls.tasks = suite
    os.environ.update({'BILLWORLD_RUN_KIND': 'reference_script', 'BILLWORLD_AGENT_LABEL': 'fleet-http-reference-v1', 'BILLWORLD_RUN_ID': uuid.uuid4().hex})
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    url = f'http://127.0.0.1:{port}'
    log = open(artifacts / 'worker.log', 'w')
    process = subprocess.Popen([sys.executable, 'server.py', '--port', str(port)], cwd=app, stdout=log, stderr=subprocess.STDOUT)
    results, negatives, lifecycle, checks = [], [], [], {}
    try:
        await wait_ready(url, process, artifacts / 'runtime' / f'worker-{port}.json', args.startup_timeout)
        # Public surface: no admin/control routes on the agent-facing port.
        for path in ('/episodes', '/finish', '/evaluate', '/state'):
            try:
                urlopen(Request(url + path, method='POST', data=b'{}'), timeout=5)
                raise AssertionError(f'public {path} accepted a POST')
            except HTTPError as error:
                assert error.code in (403, 404), (path, error.code)
        checks['public_control_routes_absent'] = True
        for i, task in enumerate(selected):
            target = artifacts / 'reference' / task['id']
            target.mkdir(parents=True, exist_ok=True)
            r = await run_task(task, Reference(), url, str(app), target)
            results.append(r)
            print(f"{'PASS' if r['passed'] else 'FAIL'} reference {task['template']} {task['task_type']} {task['id']}" + ('' if r['passed'] else f" — {r['verifier_message'][:240]} {r['errors']}"), flush=True)
            if args.negatives == 'all':
                for label, runner in [('noop', NoAction())] + ([('wrong', WrongAnswer())] if task.get('answer_required') else []):
                    target = artifacts / label / task['id']
                    target.mkdir(parents=True, exist_ok=True)
                    n = await run_task(task, runner, url, str(app), target)
                    negatives.append({**n, 'mode': label})
                    if n['passed']:
                        print(f"FAIL {label} attempt passed {task['id']}", flush=True)
        # Lifecycle accounting through the harness.
        os.environ['BILLWORLD_RUN_KIND'] = 'grader_validation'
        probe = selected[0]
        for label, runner, expected in [('crash', Crash(), 'agent_error'), ('setup', SetupCrash(), 'environment_error'), ('timeout', Timeout(), 'timeout')]:
            target = artifacts / 'lifecycle' / label
            target.mkdir(parents=True, exist_ok=True)
            r = await run_task(probe, runner, url, str(app), target)
            assert not r['passed'] and r['termination'] == expected and r['finalization_status'] == 'persisted', r
            lifecycle.append({'label': label, 'termination': r['termination'], 'passed': r['passed']})
        target = artifacts / 'lifecycle' / 'cancel'
        target.mkdir(parents=True, exist_ok=True)
        runner = Hanging()
        job = asyncio.create_task(run_task(probe, runner, url, str(app), target))
        await runner.entered.wait()
        job.cancel()
        try:
            await job
            raise AssertionError('Cancellation did not propagate')
        except asyncio.CancelledError:
            pass
        r = json.loads((target / 'result.json').read_text())
        assert runner.cancelled and r['termination'] == 'cancelled' and r['finalization_status'] == 'persisted', r
        lifecycle.append({'label': 'cancel', 'termination': r['termination'], 'passed': r['passed']})
        import importlib.util
        spec = importlib.util.spec_from_file_location('fleet_harness', app / 'harness.py')
        hooks = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(hooks)
        original = hooks.prepare

        def short_prepare(server_url, task, trial_context=None):
            prepared = original(server_url, task, trial_context)
            prepared['remaining_seconds'] = 0.05
            return prepared
        hooks.prepare = short_prepare
        target = artifacts / 'lifecycle' / 'deadline'
        target.mkdir(parents=True, exist_ok=True)
        runner = Hanging()
        r = await hooks.run_task(url, probe, runner, target)
        assert runner.cancelled and r['termination'] == 'timeout' and r['finalization_status'] == 'persisted', r
        lifecycle.append({'label': 'deadline', 'termination': r['termination'], 'passed': r['passed']})
        # Grader binding: callers cannot choose predicates; /finish is immutable; unknown tasks are refused.
        ep = control(app, port, 'episodes', {'taskId': probe['id'], 'trial': {'kind': 'grader_validation'}})
        first = control(app, port, 'finish', {'episodeId': ep['episodeId'], 'answer': '', 'predicates': [], 'metadata': {'termination': 'completed'}})
        again = control(app, port, 'finish', {'episodeId': ep['episodeId'], 'answer': 'anything', 'metadata': {'termination': 'completed'}})
        assert first['success'] is False and len(first['results']) > 0, first
        assert again['replay'] is True and again['success'] == first['success'] and again['results'] == first['results'], again
        try:
            control(app, port, 'episodes', {'taskId': 'fleet-not-a-task'})
            raise AssertionError('unknown task accepted')
        except HTTPError as error:
            assert error.code == 404
        checks.update({'caller_predicates_ignored': True, 'finish_immutable': True, 'unknown_task_rejected': True})
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
        log.close()
    (artifacts / 'results.json').write_text(json.dumps(results, indent=2))
    (artifacts / 'negatives.json').write_text(json.dumps(negatives, indent=2))
    generate_report(results, 'fleet-http-reference', 'fleet-adapter-smoke', artifacts)

    def tally(rows, key):
        out = {}
        for r in rows:
            k = r.get(key)
            out.setdefault(k, {'total': 0, 'passed': 0})
            out[k]['total'] += 1
            out[k]['passed'] += int(bool(r['passed']))
        return out
    summary = {'kind': 'reference_script', 'suite': args.suite, 'tasks': len(results), 'reference_passed': sum(r['passed'] for r in results),
               'templates': len({r['template'] for r in results}), 'task_types': len({r['task_type'] for r in results}),
               'negatives': len(negatives), 'negatives_wrongly_passed': sum(n['passed'] for n in negatives),
               'by_template': tally(results, 'template'), 'by_evidence_cohort': tally(results, 'evidence_cohort'), 'by_split_axis': tally(results, 'split_axis'),
               'lifecycle': lifecycle, 'checks': checks}
    (artifacts / 'summary.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps({k: summary[k] for k in ('tasks', 'reference_passed', 'templates', 'task_types', 'negatives', 'negatives_wrongly_passed')}))
    failed = [r['task_id'] for r in results if not r['passed']]
    if failed or summary['negatives_wrongly_passed']:
        raise SystemExit(f'Reference failures: {failed}; negatives passed: {summary["negatives_wrongly_passed"]}')


asyncio.run(main())
