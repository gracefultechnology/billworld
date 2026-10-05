"""Infinity server.py contract for Billworld Fleet; billing runs in the Node fleet worker."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=8000)
args = parser.parse_args()
config = json.loads((Path(__file__).parent / 'billworld-fleet.json').read_text())
command = [os.environ.get('BILLWORLD_NODE', 'node'), str(Path(config['root']) / 'billworld/fleet/infinity/worker.mjs'), str(args.port),
           '--private', config['private'], '--runtime', config['runtime']]
# Upstream pipes stdout without reading it; the worker prints one line, so the pipe cannot fill.
child = subprocess.Popen(command)

def stop(*_):
    child.terminate()

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
raise SystemExit(child.wait())
