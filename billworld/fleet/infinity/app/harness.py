"""Private Infinity lifecycle hooks for Billworld Fleet tasks; never served to the browser.

prepare()    creates a task-bound episode through the worker's private control service (POST /episodes {taskId}).
             The agent receives only the start URL (episode entry link) and the task instruction, which carries the
             persona, portal password and mailbox password. Predicates never leave the worker.
verify_run() sends the agent's final message as the answer to POST /finish. The worker grades the predicates it
             stored at episode creation (callers cannot supply predicates) and returns an immutable record.
run_task()   Infinity's optional lifecycle: deadline, cancellation, agent/environment error accounting, result.json.
"""
import asyncio
import hashlib
import json
import os
import re
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

CONFIG = json.loads((Path(__file__).parent / 'billworld-fleet.json').read_text())
RUNTIME = Path(CONFIG['runtime'])
SITE_COHORT = 'fleet'


def descriptor(server_url):
    parsed = urlparse(server_url)
    if parsed.hostname not in ('localhost', '127.0.0.1') or not parsed.port:
        raise ValueError('The Fleet adapter supports local workers only')
    return RUNTIME / f'worker-{parsed.port}.json'


def control(server_url, route, payload, timeout=30):
    worker = json.loads(descriptor(server_url).read_text())
    request = Request(worker['controlUrl'] + '/' + route, data=json.dumps(payload).encode(),
                      headers={'Authorization': 'Bearer ' + worker['controlToken'], 'Content-Type': 'application/json'})
    with urlopen(request, timeout=timeout) as response:
        return json.load(response)


def state_path(server_url):
    return descriptor(server_url).with_suffix('.episode.json')


def prepare(server_url, task, trial_context=None):
    trial_context = trial_context or {}
    trial = {'kind': os.environ.get('BILLWORLD_RUN_KIND', 'agent'),
             'agent': os.environ.get('BILLWORLD_AGENT_LABEL', 'infinity-unspecified'),
             'model': os.environ.get('BILLWORLD_MODEL_ID'),
             'runId': os.environ.get('BILLWORLD_RUN_ID') or trial_context.get('runId') or uuid.uuid4().hex,
             'attemptNumber': int(os.environ.get('BILLWORLD_ATTEMPT_NUMBER', str(trial_context.get('attemptNumber', 1))))}
    path = state_path(server_url)
    if path.exists():
        # A previous task on this worker started but was never finalized (crash/kill): seal it as an environment error.
        previous = json.loads(path.read_text())
        try:
            control(server_url, 'finish', {'episodeId': previous['episodeId'], 'metadata': {'termination': 'environment_error'}})
        except Exception:
            pass
    episode = control(server_url, 'episodes', {'taskId': task['id'], 'trial': trial})
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as output:
        json.dump({'episodeId': episode['episodeId'], 'taskId': task['id']}, output)
    return {'start_url': episode['startUrl'], 'episode_id': episode['episodeId'], 'trial': episode['trial'],
            'remaining_seconds': max(0, (episode['deadlineAt'] - time.time() * 1000) / 1000)}


def answer_from(final_result):
    """The agent's final message is the answer. A JSON object with an "answer" string uses that field."""
    if not isinstance(final_result, str):
        return None
    try:
        parsed = json.loads(final_result)
        if isinstance(parsed, dict) and isinstance(parsed.get('answer'), str):
            return parsed['answer'][:4000]
    except (ValueError, TypeError):
        pass
    return final_result[:4000]


def verify_run(server_url, task, result, *, prepared=None, termination='completed', include_score=False):
    state = json.loads(state_path(server_url).read_text())
    if state['taskId'] != task['id']:
        raise ValueError('Task/episode mismatch')
    if prepared and state['episodeId'] != prepared['episode_id']:
        raise ValueError('Episode changed while the task was running')
    score = control(server_url, 'finish', {
        'episodeId': state['episodeId'], 'answer': answer_from(result.final_result),
        'metadata': {'termination': termination,
                     'agentSteps': result.steps if isinstance(result.steps, int) and result.steps >= 0 else None,
                     'agentElapsedMilliseconds': max(0, round((result.elapsed or 0) * 1000))}})
    if score.get('taskId') != task['id']:
        raise ValueError('Grader returned a record for another task')
    state_path(server_url).unlink(missing_ok=True)
    message = 'Verified private billing state' if score['success'] else 'Failed: ' + '; '.join(score.get('failureReasons', []))
    return (score['success'], message, score) if include_score else (score['success'], message)


async def run_task(server_url, task, agent_runner, task_dir):
    from agents import AgentResult
    started = time.monotonic()
    prepared, result, phase, termination, cancelled = None, None, 'prepare', 'completed', False
    try:
        run_dir = task_dir.parent.resolve()
        repetition = re.fullmatch(r'run([1-9][0-9]*)', run_dir.name)
        series_dir = run_dir.parent if repetition else run_dir
        trial_context = {'runId': hashlib.sha256(str(series_dir).encode()).hexdigest()[:32],
                         'attemptNumber': int(repetition.group(1)) if repetition else 1}
        prepared = prepare(server_url, task, trial_context)

        async def drive():
            nonlocal phase
            phase = 'browser_setup'
            if not hasattr(agent_runner, 'reset_for_task'):
                raise RuntimeError('Fleet tasks require fresh browser contexts (AgentRunner.reset_for_task)')
            await agent_runner.reset_for_task(prepared['start_url'])
            phase = 'agent'
            return await agent_runner.run(task=task['instruction'], server_url=prepared['start_url'], task_dir=task_dir)
        result = await asyncio.wait_for(drive(), timeout=prepared['remaining_seconds'])
    except asyncio.CancelledError:
        termination, cancelled = 'cancelled', True
    except asyncio.TimeoutError:
        termination = 'timeout'
    except Exception as error:
        termination = 'environment_error' if phase != 'agent' or isinstance(error, OSError) or getattr(error, 'billworld_failure_kind', None) == 'environment_error' else 'agent_error'
        # Exception text may contain the entry URL; keep its type and phase only.
        result = AgentResult(time.monotonic() - started, -1, False, None, [f'{type(error).__name__} during {phase}'])
    if result is None:
        result = AgentResult(time.monotonic() - started, -1, False, None, [f'{termination} during {phase}'])
    passed, message, score, finalization = False, 'Environment failed before episode preparation', None, 'no_episode'
    if prepared:
        try:
            passed, message, score = verify_run(server_url, task, result, prepared=prepared, termination=termination, include_score=True)
            finalization = 'persisted'
        except Exception as error:
            message, finalization, termination = f'Private verification unavailable ({type(error).__name__})', 'unavailable', 'environment_error'
    task_result = {
        'task_id': task['id'], 'difficulty': task.get('difficulty', ''), 'instruction': task['instruction'],
        'site_cohort': SITE_COHORT, 'fleet_task_id': task.get('fleet_task_id'), 'template': task.get('template'),
        'task_type': task.get('task_type'), 'evidence': task.get('evidence'), 'evidence_cohort': task.get('evidence_cohort'),
        'split': task.get('split'), 'split_axis': task.get('split_axis'),
        'passed': passed, 'verifier_message': message, 'elapsed': result.elapsed, 'steps': result.steps,
        'is_done': result.is_done, 'final_result': result.final_result, 'errors': result.errors,
        'termination': score.get('termination', termination) if score else termination, 'phase': phase,
        'finalization_status': finalization, 'failure_reasons': score.get('failureReasons', []) if score else [],
        'predicates': score.get('results', []) if score else [], 'state_success': score.get('stateSuccess') if score else None,
        'export_id': score.get('exportId') if score else None, 'fleet_revision': score.get('fleetRevision') if score else None,
        'grader_version': score.get('graderVersion') if score else None,
        'run_id': prepared['trial']['runId'] if prepared else None, 'attempt_number': prepared['trial']['attemptNumber'] if prepared else None,
        'episode_id': prepared['episode_id'] if prepared else None}
    (task_dir / 'result.json').write_text(json.dumps(task_result, indent=2))
    if cancelled:
        raise asyncio.CancelledError()
    return task_result
