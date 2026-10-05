"""Real native vision dispatch validation; scripted, with no model calls."""
import argparse
import asyncio
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import uuid
from urllib.parse import urlsplit
from readiness import wait_ready

ROOT = Path(__file__).resolve().parents[2]

async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts-dir', type=Path, required=True)
    parser.add_argument('--chromium', type=Path)
    args = parser.parse_args()
    artifacts = args.artifacts_dir.resolve()
    if artifacts.exists() and any(artifacts.iterdir()):
        raise ValueError('Choose an empty artifacts directory')
    artifacts.mkdir(parents=True, exist_ok=True)
    chromium = args.chromium or Path(subprocess.check_output([
        'node', '--input-type=module', '-e',
        'import puppeteer from "puppeteer"; console.log(await puppeteer.executablePath({headless:"shell"}));'
    ], cwd=ROOT, text=True).strip())
    checkout = ROOT / '.upstream/webarena-infinity'
    app = checkout / 'apps/billworld-construction'
    sys.path.insert(0, str(checkout / 'evaluation'))
    from tasks import load_tasks, run_task
    from vision_agents import VisionAgentBase
    spec = importlib.util.spec_from_file_location('vision_budget_harness', app / 'harness.py')
    hooks = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hooks)
    limit = json.loads((ROOT / 'billworld/tasks/batavia-login.json').read_text())['budget']['actions']
    assert limit >= 4
    os.environ.update(BILLWORLD_RUN_KIND='grader_validation',
                      BILLWORLD_AGENT_LABEL='scripted-vision-action-budget-v1',
                      BILLWORLD_RUN_ID=uuid.uuid4().hex, ANONYMIZED_TELEMETRY='false')
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    url = f'http://127.0.0.1:{port}'
    summary = {'kind': 'grader_validation', 'autonomous_agent_score': False, 'passed': False}

    class ScriptedVision(VisionAgentBase):
        async def _launch_browser(self):
            from playwright.async_api import async_playwright
            self.requests = []
            self.page_errors = []
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(executable_path=str(chromium), headless=True)
            self._page = await self._browser.new_page(viewport={'width': 1440, 'height': 900})
            self._page.on('pageerror', lambda error: self.page_errors.append(str(error)))
            self._page.on('request', lambda request: self.requests.append((request.method, request.url)))
            cdp = await self._page.context.new_cdp_session(self._page)
            await cdp.send('Network.enable')
            await cdp.send('Network.setBlockedURLs', {'urlPatterns': [
                {'urlPattern': url + '/*', 'block': False},
                {'urlPattern': '*://*:*/*', 'block': True}]})

        async def dispatch(self, action):
            # As in the model loop, record the attempted action before dispatch.
            self._live_history.append({'step': len(self._live_history) + 1, 'action': action})
            await self.execute_action(action)

        async def coordinate(self, selector):
            box = await self._page.locator(selector).bounding_box()
            assert box
            return {'x': box['x'] + box['width'] / 2, 'y': box['y'] + box['height'] / 2}

        async def _run_agent_loop(self, *, screenshots_dir, **kwargs):
            await self.dispatch({'type': 'navigate', 'url': url + '/paymentus/login'})
            for selector, value in [('#email', 'alex@billworld.test'), ('#password', 'Billworld-2026!')]:
                await self.dispatch({'type': 'input', **await self.coordinate(selector), 'text': value})
            for _ in range(limit - 4):
                await self.dispatch({'type': 'hover', 'x': 5, 'y': 5})
            await self.dispatch({'type': 'click', **await self.coordinate('#paymentus-login button')})
            await self._page.locator('#paymentus-account').wait_for()
            episode = urlsplit(self._server_url).path.split('/')[2]
            self.pre_exhaustion_score = hooks.admin(url, 'evaluate', {'episodeId': episode})
            assert self.pre_exhaustion_score['success'], self.pre_exhaustion_score
            await self._page.screenshot(path=str(screenshots_dir / 'last-allowed-action.png'))
            await self.dispatch({'type': 'click', **await self.coordinate('#paymentus-logout')})
            raise AssertionError('Over-budget dispatch returned without stopping')

    runner = ScriptedVision()
    process = subprocess.Popen([sys.executable, 'server.py', '--port', str(port)], cwd=app,
                               stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        summary['startup_seconds'] = await wait_ready(url, process)
        task = next(task for task in load_tasks(str(app)) if task['id'] == 'task_c4')
        target = artifacts / 'task_c4'
        target.mkdir()
        result = await run_task(task, runner, url, str(app), target)
        summary['result'] = result
        assert result['termination'] == 'action_budget_exceeded', result
        assert result['actions_used'] == result['action_limit'] == limit
        assert result['action_budget_enforced'] and result['action_budget_unit'] == 'vision_action'
        assert not result['passed'] and result['finalization_status'] == 'persisted'
        assert await runner._page.locator('#paymentus-account').is_visible()
        assert not any(method == 'POST' and urlsplit(address).path == '/api/logout'
                       for method, address in runner.requests)
        assert not runner.page_errors, runner.page_errors
        history = json.loads((target / 'history.json').read_text())['history']
        assert len(history) == limit + 1
        assert runner._billworld_action_meter is None
        await runner._page.screenshot(path=str(target / 'screenshots/blocked-logout.png'))
        summary.update(passed=True, last_allowed_action_completed_login=True,
                       over_budget_logout_reached_browser=False, attempted_actions=len(history),
                       pre_exhaustion_checks=runner.pre_exhaustion_score['checks'],
                       chromium_version=runner._browser.version,
                       sdk_versions={name: importlib.metadata.version(name) for name in ['playwright', 'browser-use', 'pydantic']})
        print(f'PASS real vision browser: {limit} actions accepted, next logout blocked, failure persisted')
    except BaseException as error:
        summary['error'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        (artifacts / 'summary.json').write_text(json.dumps(summary, indent=2))
        await runner.teardown()
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

if __name__ == '__main__':
    asyncio.run(main())
