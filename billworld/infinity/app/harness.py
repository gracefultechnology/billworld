"""Private lifecycle hooks for Infinity; never served to the browser."""
import json
import os
import asyncio
import time
import uuid
import re
import hashlib
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

CONFIG = json.loads((Path(__file__).parent / 'billworld-root.json').read_text())
ROOT = Path(CONFIG['root'])
CONSTRUCTION = CONFIG.get('construction', False) is True
SITE_COHORT = 'construction' if CONSTRUCTION else 'released'

# Control-flow exceptions bypass SDK catches that turn ordinary tool errors into
# model feedback and keep running. The private lifecycle catches them explicitly.
class ActionBudgetExceeded(BaseException):
    billworld_action_stop = True


class ActionMeterUnavailable(BaseException):
    billworld_action_stop = True


def install_action_budget(server_url, prepared, runner):
    if not hasattr(runner, 'configure_action_budget'):
        if prepared['trial_metadata']['kind'] == 'agent':
            raise RuntimeError('Agent runner cannot enforce the task action budget')
        return
    unit = getattr(runner, 'action_budget_unit', None)
    admin(server_url, 'actions/start', {'episodeId': prepared['episode_id'], 'unit': unit})
    def consume(name):
        name = re.sub(r'[^A-Za-z0-9_.:-]', '_', str(name))[:100] or 'unknown'
        try:
            result = admin(server_url, 'actions/consume', {'episodeId': prepared['episode_id'], 'name': name})
            if not isinstance(result, dict) or type(result.get('allowed')) is not bool:
                raise ValueError('Invalid private meter response')
        except Exception:
            raise ActionMeterUnavailable() from None
        if not result.get('allowed'):
            raise ActionBudgetExceeded()
    runner.configure_action_budget(consume)
RELEASED_TASKS = {
    'task_m1': ('juneau-utilities', 'juneau-pay-current-no-fee-v1'),
    'task_m2': ('juneau-utilities', 'juneau-enable-autopay-v1'),
    'task_h1': ('juneau-utilities', 'juneau-schedule-payment-v1'),
    'task_h2': ('spotify', 'spotify-update-card-v1'),
    'task_h3': ('juneau-utilities', 'juneau-pay-email-mfa-v1'),
    'task_m3': ('avec-electric', 'avec-pay-current-v1'),
    'task_h4': ('juneau-utilities', 'juneau-recover-password-v1'),
    'task_m4': ('homer-utilities', 'homer-pay-current-v1'),
    'task_h5': ('homer-utilities', 'homer-register-link-pay-v1'),
    'task_m5': ('duluth-comfortsystems', 'duluth-pay-current-v1'),
    'task_h6': ('duluth-comfortsystems', 'duluth-register-link-pay-v1'),
    'task_h7': ('duluth-comfortsystems', 'duluth-google-pay-v1'),
    'task_m6': ('gvp-electric','gvp-pay-current-v1'),
    'task_h9': ('gvp-electric','gvp-register-pay-v1'),
    'task_m7': ('gvp-electric','gvp-enable-autopay-v1'),
    'task_h8': ('duluth-comfortsystems', 'duluth-manage-wallet-v1'),
    'task_m8': ('swepsonville-water','swepsonville-guest-pay-v1'),
    'task_h10': ('swepsonville-water','swepsonville-register-login-v1'),
    'task_h11': ('swepsonville-water','swepsonville-recover-login-v1'),
    'task_m9': ('swepsonville-water','swepsonville-bank-draft-request-v1'),
    'task_m10': ('swepsonville-water','swepsonville-deposit-payment-v1'),
    'task_m11': ('wvu-medicine','wvu-guest-visit-pay-v1'),
    'task_h12': ('wvu-medicine','wvu-signed-visit-pay-v1'),
    'task_h13': ('wvu-medicine','wvu-mfa-visit-pay-v1'),
    'task_h14': ('wvu-medicine','wvu-activation-visit-pay-v1'),
    'task_h15': ('wvu-medicine','wvu-recover-login-v1'),
    'task_m12': ('western-dental','western-dental-full-pay-v1'),
    'task_h16': ('western-dental','western-dental-partial-pay-v1'),
    'task_h17': ('western-dental','western-dental-overpay-pay-v1'),
    'task_h18': ('western-dental','western-dental-recurring-plan-v1'),
    'task_h19': ('western-dental','western-dental-future-plan-v1'),
}
CONSTRUCTION_TASKS = {
    'task_c1': ('lockwood', 'lockwood-username-login-v1'),
    'task_c2': ('lockwood', 'lockwood-recover-login-v1'),
    'task_c3': ('lockwood', 'lockwood-pay-current-card-v1'),
    'task_c4': ('batavia-utilities', 'batavia-email-login-v1'),
    'task_c5': ('batavia-utilities', 'batavia-recover-login-v1'),
    'task_c6': ('batavia-utilities', 'batavia-register-link-v1'),
    'task_c7': ('lockwood', 'lockwood-register-login-v1'),
    'task_c8': ('batavia-utilities', 'batavia-pay-current-bank-v1'),
    'task_c9': ('batavia-utilities', 'batavia-pay-current-card-v1'),
    'task_c10': ('batavia-utilities', 'batavia-pay-verify-history-v1'),
    'task_c11': ('batavia-utilities', 'batavia-notifications-v1'),
    'task_c12': ('batavia-utilities', 'batavia-download-current-bill-v1'),
    'task_c14': ('batavia-utilities', 'batavia-enable-autopay-v1'),
    'task_c18': ('greater-minnesota-gas', 'gmg-register-account-v1'),
    'task_c17': ('greater-minnesota-gas', 'gmg-recover-username-password-v1'),
    'task_c16': ('greater-minnesota-gas', 'gmg-username-login-v1'),
    'task_c15': ('batavia-utilities', 'batavia-cancel-autopay-v1'),
    'task_c13': ('batavia-utilities', 'batavia-manage-wallet-v1'),
}
TASKS = CONSTRUCTION_TASKS if CONSTRUCTION else RELEASED_TASKS

def worker(server_url):
    parsed = urlparse(server_url)
    if parsed.hostname not in ('localhost', '127.0.0.1') or not parsed.port:
        raise ValueError('This adapter currently supports local workers only')
    return ROOT / f'billworld/data/infinity-{parsed.port}.json'

def admin(server_url, route, payload):
    control = json.loads(worker(server_url).read_text())
    if bool(control.get('construction', False)) != CONSTRUCTION:
        raise ValueError('Worker/app construction cohort mismatch')
    if route == 'report':
        payload = {'siteCohort': SITE_COHORT, **payload}
    request = Request(control['adminUrl'] + '/' + route, data=json.dumps(payload).encode(),
                      headers={'Authorization': 'Bearer ' + control['adminToken'], 'Content-Type': 'application/json'})
    with urlopen(request, timeout=15) as response:
        return json.load(response)

def prepare(server_url, task, trial_context=None):
    mode = os.environ.get('BILLWORLD_ACCESS_MODE', 'browser_only')
    if mode not in ('browser_only', 'browser_and_email_connector'):
        raise ValueError('Unsupported Billworld access mode')
    trial_context = trial_context or {}
    run_id = os.environ.get('BILLWORLD_RUN_ID') or trial_context.get('runId') or uuid.uuid4().hex
    trial = {'kind': os.environ.get('BILLWORLD_RUN_KIND', 'agent'),
             'agent': os.environ.get('BILLWORLD_AGENT_LABEL', 'infinity-unspecified'),
             'accessMode': mode, 'runId': run_id,
             'attemptNumber': int(os.environ.get('BILLWORLD_ATTEMPT_NUMBER', str(trial_context.get('attemptNumber', 1)))),
             'model': os.environ.get('BILLWORLD_MODEL_ID'),
             'scaffold': 'webarena-infinity@1ca77813bf8d8e4011aa3fb1f740f70d78bd522d'}
    state_path = worker(server_url).with_suffix('.episode.json')
    if state_path.exists():
        previous = json.loads(state_path.read_text())
        if previous.get('trialStarted'):
            admin(server_url, 'finish', {'episodeId': previous['episodeId'], 'metadata': {'termination': 'environment_error'}})
    site, task_id = TASKS[task['id']]
    fixture = admin(server_url, 'episodes', {'siteId': site, 'taskId': task_id, 'seed': list(TASKS).index(task['id']) + 1, 'trial': trial})
    descriptor = os.open(state_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        json.dump({'episodeId': fixture['episodeId'], 'taskId': task_id, 'trialStarted': True}, output)
    prepared = {'start_url': fixture['startUrl'], 'episode_id': fixture['episodeId'],
                'site_cohort': SITE_COHORT,
                'trial_metadata': fixture['trial']['metadata'],
                'remaining_seconds': max(0, (fixture['trial']['deadlineAt'] - time.time() * 1000) / 1000)}
    if mode == 'browser_and_email_connector':
        prepared['mcp_servers'] = [{'server_name': 'billworld_mail', 'command': os.environ.get('BILLWORLD_NODE', 'node'),
            'args': [str(ROOT / 'billworld/mail-mcp.mjs')], 'env': {'BILLWORLD_MAIL_URL': server_url,
            'BILLWORLD_EPISODE': fixture['episodeId'], 'BILLWORLD_MAIL_TOKEN': fixture['connectorToken']},
            'tool_filter': ['gmail_list_messages', 'gmail_read_message', 'gmail_get_thread', 'gmail_get_attachment', 'gmail_update_message']}]
    return prepared

def verify_run(server_url, task, result, *, prepared=None, termination='completed', include_score=False):
    state = json.loads(worker(server_url).with_suffix('.episode.json').read_text())
    if state['taskId'] != TASKS[task['id']][1]:
        raise ValueError('Task/episode mismatch')
    if prepared and state['episodeId'] != prepared['episode_id']:
        raise ValueError('Episode changed while a task was running')
    final = result.final_result or '{}'
    try:
        outcome = json.loads(final)
        if not isinstance(outcome, dict):
            outcome = {}
    except (ValueError, TypeError):
        outcome = {}
    # Only expected answer fields are passed to grading, never state supplied by an agent.
    outcome = {key: outcome[key] for key in ('confirmation', 'billingDate', 'scheduledDate', 'statementFilename')
               if isinstance(outcome.get(key), str)}
    score = admin(server_url, 'finish', {'episodeId': state['episodeId'], 'outcome': outcome,
        'metadata': {'termination': termination,
                     'agentSteps': result.steps if isinstance(result.steps, int) and result.steps >= 0 else None,
                     'agentElapsedMilliseconds': max(0, round(result.elapsed * 1000))}})
    if bool(score.get('constructionSlice', False)) != CONSTRUCTION:
        raise ValueError('Episode/app construction cohort mismatch')
    failed = score.get('failureReasons', [name for name, passed in score['checks'].items() if not passed])
    message = 'Verified private billing state' if score['success'] else 'Failed: ' + ', '.join(failed)
    return (score['success'], message, score) if include_score else (score['success'], message)

async def run_task(server_url, task, agent_runner, task_dir):
    """Infinity's optional lifecycle, with durable failure grading for Billworld."""
    from agents import AgentResult
    started = time.monotonic()
    prepared = None
    result = None
    phase = 'prepare'
    termination = 'completed'
    cancelled = False
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
                raise RuntimeError('Billing tasks require fresh browser contexts')
            await agent_runner.reset_for_task(prepared['start_url'])
            if prepared.get('mcp_servers'):
                phase = 'connector_setup'
                if not hasattr(agent_runner, 'configure_tools'):
                    raise RuntimeError('Connector track requires a tool-capable AgentRunner')
                await agent_runner.configure_tools(prepared['mcp_servers'])
            phase = 'action_budget_setup'
            install_action_budget(server_url, prepared, agent_runner)
            phase = 'agent'
            return await agent_runner.run(task=task['instruction'], server_url=prepared['start_url'], task_dir=task_dir)
        result = await asyncio.wait_for(drive(), timeout=prepared['remaining_seconds'])
    except ActionBudgetExceeded:
        termination = 'action_budget_exceeded'
    except ActionMeterUnavailable:
        termination = 'environment_error'
    except asyncio.CancelledError:
        termination = 'cancelled'
        cancelled = True
    except asyncio.TimeoutError:
        termination = 'timeout'
    except Exception as error:
        termination = 'environment_error' if phase != 'agent' or isinstance(error, OSError) or getattr(error, 'billworld_failure_kind', None) == 'environment_error' else 'agent_error'
        # Exception text may contain URLs/tokens; retain its type and phase only.
        result = AgentResult(time.monotonic() - started, -1, False, None, [f'{type(error).__name__} during {phase}'])
    finally:
        if hasattr(agent_runner, 'configure_action_budget'):
            agent_runner.configure_action_budget(None)
        if hasattr(agent_runner, '_disconnect_tools'):
            try:
                await asyncio.wait_for(agent_runner._disconnect_tools(), timeout=5)
            except Exception:
                termination = 'environment_error'
    if result is None:
        steps = -1
        try:
            history = json.loads((task_dir / 'history.json').read_text())
            steps = len(history if isinstance(history, list) else history.get('history', []))
        except (OSError, ValueError, TypeError):
            pass
        result = AgentResult(time.monotonic() - started, steps, False, None, [f'{termination} during {phase}'])
    finalization_status = 'no_episode'
    failure_reasons = []
    passed = False
    verifier_message = 'Environment failed before episode preparation'
    score = None
    if prepared:
        try:
            passed, verifier_message, score = verify_run(server_url, task, result, prepared=prepared, termination=termination, include_score=True)
            termination = score['termination']
            failure_reasons = score['failureReasons']
            finalization_status = 'persisted'
        except Exception:
            # The worker deadline/recovery monitor seals a durable started trial.
            finalization_status = 'unavailable_requires_recovery'
            verifier_message = 'Private verification unavailable; started trial requires deadline/recovery finalization'
            termination = 'environment_error'
    task_result = {'task_id': task['id'], 'difficulty': task.get('difficulty', ''), 'instruction': task['instruction'],
                   'site_cohort': SITE_COHORT,
                   'passed': passed, 'verifier_message': verifier_message, 'elapsed': result.elapsed,
                   'steps': result.steps, 'is_done': result.is_done, 'final_result': result.final_result,
                   'errors': result.errors, 'termination': termination, 'phase': phase,
                   'finalization_status': finalization_status,
                   'environment_build_id': score.get('environmentBuildId') if score else None,
                   'evaluator_build_id': score.get('evaluatorBuildId') if score else None,
                   'build_changed_during_episode': score.get('buildChangedDuringEpisode') if score else None,
                   'action_budget_enforced': score.get('actionBudgetEnforced') if score else None,
                   'action_budget_unit': score.get('actionBudgetUnit') if score else None,
                   'action_limit': score.get('actionLimit') if score else None,
                   'actions_used': score.get('actionsUsed') if score else None,
                   'failure_reasons': failure_reasons,
                   'run_id': prepared['trial_metadata']['runId'] if prepared else None,
                   'attempt_number': prepared['trial_metadata']['attemptNumber'] if prepared else None,
                   'episode_id': prepared['episode_id'] if prepared else None}
    (task_dir / 'result.json').write_text(json.dumps(task_result, indent=2))
    if cancelled:
        raise asyncio.CancelledError()
    return task_result
