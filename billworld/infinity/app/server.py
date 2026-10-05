"""Infinity server.py contract; billing remains in the existing Node service."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=8000)
args = parser.parse_args()
config = json.loads((Path(__file__).parent / 'billworld-root.json').read_text())
root = Path(config['root'])
command = [os.environ.get('BILLWORLD_NODE', 'node'), str(root / 'billworld/infinity/worker.mjs'), str(args.port)]
if config.get('construction', False) is True:
    command.append('--construction')
child = subprocess.Popen(command)

def stop(*_):
    child.terminate()

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
raise SystemExit(child.wait())
