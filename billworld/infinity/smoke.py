"""Exercise upstream run_task/report with scripted Puppeteer, without an API key."""
import argparse
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import uuid
import tempfile
from urllib.request import urlopen, Request
from urllib.error import HTTPError
from readiness import wait_ready

ROOT = Path(__file__).resolve().parents[2]
# The upstream evaluator needs its pinned dependencies (requests, ...). When this script is started with a Python that
# lacks them (e.g. the system python3), re-run it under the checkout's pinned environment instead of failing on import.
if importlib.util.find_spec('requests') is None and not os.environ.get('BILLWORLD_SMOKE_REEXEC'):
    for candidate in (ROOT / '.upstream/smoke-venv/bin/python', ROOT / '.upstream/review-venv/bin/python'):
        if candidate.exists() and Path(sys.executable).resolve() != candidate.resolve():
            os.environ['BILLWORLD_SMOKE_REEXEC'] = '1'
            print(f'smoke.py: {sys.executable} lacks the Infinity dependencies; re-running with {candidate}', file=sys.stderr, flush=True)
            os.execv(str(candidate), [str(candidate), str(Path(__file__).resolve()), *sys.argv[1:]])
parser = argparse.ArgumentParser()
parser.add_argument('--connector', action='store_true', help='Also validate native BrowserUse MCP tool registration without a model')
parser.add_argument('--lifecycle-only', action='store_true', help='Validate failure accounting without browser/model runs')
parser.add_argument('--construction', action='store_true', help='Run only the separate draft app/cohort; no released coverage added')
parser.add_argument('--task-ids', help='Comma-separated upstream task IDs for a scoped browser reference run')
parser.add_argument('--checkout', type=Path, default=ROOT / '.upstream/webarena-infinity')
parser.add_argument('--artifacts-dir', type=Path, help='Separate output directory so a scoped run cannot overwrite a full-run report')
args = parser.parse_args()
sys.path.insert(0, str(args.checkout / 'evaluation'))
from agents import AgentResult
from tasks import load_tasks, run_task
import tasks as upstream_tasks
from report import generate_report

class EnvironmentFailure(RuntimeError):
    billworld_failure_kind = 'environment_error'

class Reference:
    async def reset_for_task(self, start_url):
        self.start_url = start_url  # The reference launches a new browser for every task.

    async def run(self, task, server_url, task_dir):
        assert server_url == self.start_url
        begin = time.monotonic()
        process = await asyncio.create_subprocess_exec('node', str(ROOT / 'billworld/infinity/reference.mjs'),
            server_url, task_dir.name, str(task_dir), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, stderr = await process.communicate()
        if process.returncode:
            (task_dir / 'reference-error.txt').write_text(stderr.decode())
            if 'BrowserLauncher.js' in stderr.decode() and 'WS endpoint' in stderr.decode():
                raise EnvironmentFailure('Reference browser launch failed')
            raise RuntimeError(stderr.decode())
        result = json.loads(stdout)
        return AgentResult(time.monotonic() - begin, result['steps'], True, json.dumps(result['answer']), result['errors'])

class NoAction(Reference):
    async def run(self, **kwargs):
        return AgentResult(0, 0, True, '{}', [])

class Crash(NoAction):
    async def run(self, **kwargs):
        raise RuntimeError('Synthetic agent crash')

class SetupCrash(NoAction):
    async def reset_for_task(self, start_url):
        raise RuntimeError('Synthetic browser setup failure')

class ActionFlood(NoAction):
    action_budget_unit = 'browser_tool_invocation'
    def configure_action_budget(self, consume):
        self.consume = consume
    async def run(self, **kwargs):
        self.dispatched = 0
        for _ in range(10000):
            self.consume('synthetic_probe')
            self.dispatched += 1
        raise AssertionError('Action budget did not stop the runner')

class Timeout(NoAction):
    async def run(self, **kwargs):
        raise asyncio.TimeoutError()

class Hanging(NoAction):
    def __init__(self):
        self.entered = asyncio.Event()
        self.cancelled = False
    async def run(self, **kwargs):
        self.entered.set()
        try:
            await asyncio.Future()
        finally:
            self.cancelled = True

async def main():
    os.environ['BILLWORLD_RUN_KIND'] = 'reference_script'
    os.environ['BILLWORLD_AGENT_LABEL'] = 'infinity-puppeteer-reference-v1'
    os.environ['BILLWORLD_RUN_ID'] = uuid.uuid4().hex
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0)); port = reservation.getsockname()[1]
    url = f'http://127.0.0.1:{port}'
    app = args.checkout / ('apps/billworld-construction' if args.construction else 'apps/billworld')
    artifacts = args.artifacts_dir.resolve() if args.artifacts_dir else ROOT / ('billworld/artifacts/infinity/construction' if args.construction else 'billworld/artifacts/infinity')
    if args.artifacts_dir and artifacts.exists() and any(artifacts.iterdir()):
        raise ValueError('Choose an empty artifacts directory to preserve previous runs')
    artifacts.mkdir(parents=True, exist_ok=True)
    process = subprocess.Popen([sys.executable, 'server.py', '--port', str(port)], cwd=app,
                               stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        startup_seconds = await wait_ready(url, process)
        for method, path in [('PUT', '/api/state'), ('POST', '/api/reset')]:
            try:
                urlopen(Request(url + path, method=method, data=b'{}'), timeout=2)
                raise AssertionError('Public control/state mutation was accepted')
            except HTTPError as error:
                assert error.code in (401, 403)
        tasks = load_tasks(str(app))
        spec = importlib.util.spec_from_file_location('lifecycle_harness', app / 'harness.py')
        hooks = importlib.util.module_from_spec(spec); spec.loader.exec_module(hooks)
        os.environ['BILLWORLD_RUN_KIND'] = 'grader_validation'
        fail_dir = artifacts / 'negative' / tasks[0]['id']; fail_dir.mkdir(parents=True, exist_ok=True)
        negative = await run_task(tasks[0], NoAction(), url, str(app), fail_dir)
        assert negative['passed'] is False
        lifecycle = []
        for label, runner, expected in [('crash', Crash(), 'agent_error'), ('setup', SetupCrash(), 'environment_error'), ('timeout', Timeout(), 'timeout')]:
            target = artifacts / 'lifecycle' / label; target.mkdir(parents=True, exist_ok=True)
            result = await run_task(tasks[0], runner, url, str(app), target)
            assert not result['passed'] and result['termination'] == expected and result['finalization_status'] == 'persisted', result
            lifecycle.append(result)
        # Exercise cancellation through the upstream entry point and verify its durable result.
        target = artifacts / 'lifecycle' / 'cancel'; target.mkdir(parents=True, exist_ok=True)
        runner = Hanging()
        job = asyncio.create_task(run_task(tasks[0], runner, url, str(app), target))
        await runner.entered.wait(); job.cancel()
        try:
            await job
            raise AssertionError('Cancellation did not propagate')
        except asyncio.CancelledError:
            pass
        result = json.loads((target / 'result.json').read_text())
        assert runner.cancelled and result['termination'] == 'cancelled' and result['finalization_status'] == 'persisted'
        lifecycle.append(result)
        # A short runner deadline is injected only in this test, not into task/world policy.
        original_prepare = hooks.prepare
        def short_prepare(server_url, task, trial_context=None):
            prepared = original_prepare(server_url, task, trial_context); prepared['remaining_seconds'] = .05; return prepared
        hooks.prepare = short_prepare
        try:
            target = artifacts / 'lifecycle' / 'deadline'; target.mkdir(parents=True, exist_ok=True)
            runner = Hanging(); result = await hooks.run_task(url, tasks[0], runner, target)
            assert runner.cancelled and result['termination'] == 'timeout' and result['finalization_status'] == 'persisted'
            lifecycle.append(result)
        finally:
            hooks.prepare = original_prepare
        report = hooks.admin(url, 'report', {'kind': 'grader_validation'})
        assert report['siteCohort'] == ('construction' if args.construction else 'released')
        if args.construction:
            released = hooks.admin(url, 'report', {'kind': 'grader_validation', 'siteCohort': 'released'})
            assert released['trials'] == 0 and released['activeAttempts'] == 0
        current = [r for r in report['trialsDetail'] if r.get('runId') == os.environ['BILLWORLD_RUN_ID']]
        assert len(current) == 6 and all(not r['success'] for r in current), current
        assert report['activeAttempts'] == 0
        print('PASS persisted no-action, agent crash, setup failure, timeout, cancellation and deadline failure')
        target = artifacts / 'lifecycle' / 'action-budget'; target.mkdir(parents=True, exist_ok=True)
        flood = ActionFlood()
        budget_result = await run_task(tasks[0], flood, url, str(app), target)
        assert budget_result['termination'] == 'action_budget_exceeded' and not budget_result['passed'], budget_result
        assert budget_result['action_budget_enforced'] and budget_result['actions_used'] == budget_result['action_limit'] == flood.dispatched
        assert flood.consume is None and 'action_budget' in budget_result['failure_reasons']
        lifecycle.append(budget_result)
        print('PASS private action budget rejects the next dispatch and persists failure')
        # Existing apps without a private harness retain their reset/verifier contract.
        class LegacyAgent:
            async def run(self, *, task, server_url, task_dir):
                assert server_url == url
                return AgentResult(0, 0, True, '{}', [])
        original_reset = upstream_tasks.reset_state
        reset_calls = []
        upstream_tasks.reset_state = lambda server_url: reset_calls.append(server_url)
        try:
            with tempfile.TemporaryDirectory() as legacy_dir:
                legacy = Path(legacy_dir)
                (legacy / 'verify.py').write_text('def verify(server_url):\n    return True, "Legacy verifier called"\n')
                result = await run_task({'id':'legacy','instruction':'Legacy control case','verify':'verify.py'}, LegacyAgent(), url, str(legacy), legacy)
                assert result['passed'] and result['verifier_message'] == 'Legacy verifier called'
                assert reset_calls == [url] and 'episode_id' not in result
        finally:
            upstream_tasks.reset_state = original_reset
        print('PASS upstream app without harness retains reset + verifier lifecycle')
        # Match native run1/run2 artifact layout, without an environment override.
        saved_run_id = os.environ.pop('BILLWORLD_RUN_ID')
        saved_label = os.environ['BILLWORLD_AGENT_LABEL']
        os.environ['BILLWORLD_AGENT_LABEL'] = 'infinity-repetition-fixture-v1'
        try:
            repeat_results = []
            for number in (1, 2):
                target = artifacts / 'lifecycle' / 'repetitions' / f'run{number}' / tasks[0]['id']; target.mkdir(parents=True, exist_ok=True)
                repeat_results.append(await run_task(tasks[0], NoAction(), url, str(app), target))
            assert [r['attempt_number'] for r in repeat_results] == [1, 2]
            assert repeat_results[0]['run_id'] == repeat_results[1]['run_id']
            repeats = hooks.admin(url, 'report', {'kind': 'grader_validation', 'agent': 'infinity-repetition-fixture-v1'})
            assert repeats['firstAttempt']['trials'] == 1 and repeats['bestOfObservedAttempts']['series'] == 1
            assert repeats['bestOfObservedAttempts']['attemptsPerSeries'] == {'2': 1}
        finally:
            os.environ['BILLWORLD_RUN_ID'] = saved_run_id
            os.environ['BILLWORLD_AGENT_LABEL'] = saved_label
        print('PASS native repetition lineage separates first attempt from observed retries')
        os.environ['BILLWORLD_RUN_KIND'] = 'reference_script'
        if args.task_ids:
            selected_ids = args.task_ids.split(',')
            assert set(selected_ids) <= {t['id'] for t in tasks}, 'Unknown task ID'
            tasks = [t for t in tasks if t['id'] in selected_ids]
        if args.lifecycle_only:
            tasks = []
        results = []
        for task in tasks:
            target = artifacts / task['id']; target.mkdir(exist_ok=True)
            result = await run_task(task, Reference(), url, str(app), target)
            assert result['passed'], result
            results.append(result); print('PASS upstream lifecycle + UI + private verifier:', task['id'])
        reference_report = hooks.admin(url, 'report', {'kind':'reference_script'})
        current_references = [r for r in reference_report['trialsDetail'] if r.get('runId') == os.environ['BILLWORLD_RUN_ID']]
        assert len(current_references) == len(results) and all(r['success'] for r in current_references)
        other_report = hooks.admin(url, 'report', {'kind':'reference_script', 'siteCohort':'released' if args.construction else 'construction'})
        assert not any(r.get('runId') == os.environ['BILLWORLD_RUN_ID'] for r in other_report['trialsDetail'])
        if args.connector:
            from agents import BrowserUseAgent
            spec = importlib.util.spec_from_file_location('connector_harness', app / 'harness.py')
            hooks = importlib.util.module_from_spec(spec); spec.loader.exec_module(hooks)
            os.environ['BILLWORLD_ACCESS_MODE'] = 'browser_and_email_connector'
            prepared = hooks.prepare(url, tasks[0])
            runner = BrowserUseAgent(None)
            try:
                await runner.configure_tools(prepared['mcp_servers'])
                registry = runner._task_tools.registry
                names = prepared['mcp_servers'][0]['tool_filter']
                assert all(name in registry.registry.actions for name in names)
                listed = await registry.execute_action('gmail_list_messages', {'limit': 1})
                payload = json.loads(listed.extracted_content)
                assert len(payload['messages']) == 1
                message_id = payload['messages'][0]['id']
                read = await registry.execute_action('gmail_read_message', {'id': message_id})
                assert json.loads(read.extracted_content)['message']['id'] == message_id
                changed = await registry.execute_action('gmail_update_message', {'id': message_id, 'changes': {'starred': True}})
                assert json.loads(changed.extracted_content)['starred'] is True
                print('PASS native BrowserUse registration + MCP list/read/update (no model)')
            finally:
                await runner._disconnect_tools()
                os.environ['BILLWORLD_ACCESS_MODE'] = 'browser_only'
        if results:
            generate_report(results, 'scripted-reference', 'adapter-smoke', artifacts)
        # Kill only the child worker owned by this smoke process, then recover its database.
        os.environ['BILLWORLD_RUN_KIND'] = 'grader_validation'
        recovering = hooks.prepare(url, load_tasks(str(app))[0])
        control = json.loads(hooks.worker(url).read_text())
        owner = int(subprocess.check_output(['ps', '-p', str(control['pid']), '-o', 'ppid='], text=True).strip())
        assert owner == process.pid, 'Recovery test may only stop its own child worker'
        os.kill(control['pid'], signal.SIGKILL)
        process.wait(timeout=10)
        process = subprocess.Popen([sys.executable, 'server.py', '--port', str(port)], cwd=app,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        recovery_seconds = await wait_ready(url, process, label='recovery')
        recovered_report = hooks.admin(url, 'report', {'kind': 'grader_validation'})
        recovered = next(r for r in recovered_report['trialsDetail'] if r['episodeId'] == recovering['episode_id'])
        assert recovered['termination'] == 'environment_error' and not recovered['success']
        assert recovered_report['activeAttempts'] == 0
        print('PASS owned worker SIGKILL + database recovery seals interrupted attempt')
        summary_file = 'lifecycle-summary.json' if args.lifecycle_only else 'summary.json'
        (artifacts / summary_file).write_text(json.dumps({'kind': 'grader_validation' if args.lifecycle_only else 'reference_script', 'negative_rejected': True,
            'site_cohort': 'construction' if args.construction else 'released',
            'upstream_revision': '1ca77813bf8d8e4011aa3fb1f740f70d78bd522d', 'tasks': results, 'lifecycle_failures': lifecycle,
            'reference_report': reference_report, 'other_cohort_reference_report': other_report, 'trial_report': recovered_report, 'legacy_lifecycle_passed': True, 'repetition_lineage_passed': True, 'worker_recovery': recovered, 'environment_startup_seconds': startup_seconds, 'environment_recovery_seconds': recovery_seconds}, indent=2))
    finally:
        process.send_signal(signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait()

asyncio.run(main())
