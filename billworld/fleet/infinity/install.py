"""Install the Billworld Fleet app for WebArena-Infinity's runner.

The app directory is self-contained and can live anywhere; Infinity's runner takes it with --web-app. By default it is
written to billworld/fleet/infinity/build/app (next to the exported suites), so nothing is added to the upstream checkout.
It contains server.py / harness.py / verify.py, billworld-fleet.json (paths to the repo, the PRIVATE task file and the
runtime dir) and the public suites real-tasks.json (test), dev-tasks.json and train-tasks.json. The private task file is
not copied into the app directory.

The upstream checkout must carry the optional lifecycle hook (apps with harness.py) and AgentRunner.reset_for_task,
which billworld/infinity/bootstrap.py installs. This script checks for them and, with --bootstrap, runs that bootstrap.

Usage: python3 billworld/fleet/infinity/install.py [--export DIR] [--app DIR] [--checkout DIR] [--bootstrap]
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SUITES = ('real-tasks.json', 'dev-tasks.json', 'train-tasks.json')


def hooks_present(checkout):
    tasks = (checkout / 'evaluation/tasks.py').read_text()
    agents = (checkout / 'evaluation/agents.py').read_text()
    return 'hasattr(hooks, "run_task")' in tasks and 'async def reset_for_task' in agents


def install(export, app, checkout=None, bootstrap=False, runtime=None):
    export, app = export.resolve(), app.resolve()
    private = export / 'private-tasks.json'
    if not private.exists():
        raise SystemExit(f'No export at {export}; run node billworld/fleet/infinity/export.mjs first')
    if checkout:
        checkout = checkout.resolve()
        if not hooks_present(checkout):
            if not bootstrap:
                raise SystemExit(f'{checkout} lacks the Billworld lifecycle hook; run python3 billworld/infinity/bootstrap.py --checkout {checkout} (or pass --bootstrap)')
            subprocess.run([sys.executable, str(ROOT / 'billworld/infinity/bootstrap.py'), '--checkout', str(checkout)], check=True)
            if not hooks_present(checkout):
                raise SystemExit('Bootstrap did not install the lifecycle hook')
    app.mkdir(parents=True, exist_ok=True)
    for name in ('server.py', 'harness.py', 'verify.py'):
        shutil.copy2(HERE / 'app' / name, app / name)
    for name in SUITES:
        if (export / name).exists():
            shutil.copy2(export / name, app / name)
    runtime = (runtime or HERE / '.runtime').resolve()
    runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    (app / 'billworld-fleet.json').write_text(json.dumps({'root': str(ROOT), 'private': str(private), 'runtime': str(runtime)}, indent=2) + '\n')
    manifest = json.loads((export / 'manifest.json').read_text())
    print(f"Installed Fleet app at {app} (export {manifest['exportId']}: test {manifest['totals']['test']}, dev {manifest['totals']['dev']}, train {manifest['totals']['train']})")
    return app


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--export', type=Path, default=HERE / 'build')
    parser.add_argument('--app', type=Path, default=None)
    parser.add_argument('--checkout', type=Path, default=ROOT / '.upstream/webarena-infinity')
    parser.add_argument('--runtime', type=Path, default=None)
    parser.add_argument('--bootstrap', action='store_true')
    args = parser.parse_args()
    install(args.export, args.app or args.export / 'app', args.checkout if args.checkout.exists() else None, args.bootstrap, args.runtime)
