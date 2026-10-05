"""Bound environment setup separately from a benchmark episode deadline."""
import asyncio
import json
import time
from urllib.request import urlopen


async def wait_ready(url, process, label='startup', timeout=60):
    if timeout <= 0:
        raise ValueError('Positive readiness timeout required')
    begin = time.monotonic()
    deadline = begin + timeout
    while True:
        if process.poll() is not None:
            raise RuntimeError(process.stderr.read().decode())
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError(f'Worker {label} timed out after {timeout:g} seconds')
        try:
            with urlopen(url + '/api/state', timeout=min(1, remaining)) as response:
                if json.load(response) != {'ready': True}:
                    raise RuntimeError('Unexpected public worker readiness response')
            return time.monotonic() - begin
        except OSError:
            await asyncio.sleep(min(.1, max(0, deadline-time.monotonic())))
