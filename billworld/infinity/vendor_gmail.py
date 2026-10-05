"""Vendor pinned MIT Gmail frontend; retain original hashes and attribution."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
REVISION = '1ca77813bf8d8e4011aa3fb1f740f70d78bd522d'
parser = argparse.ArgumentParser()
parser.add_argument('--checkout', type=Path, default=ROOT / '.upstream/webarena-infinity')
checkout = parser.parse_args().checkout
assert subprocess.check_output(['git', '-C', str(checkout), 'rev-parse', 'HEAD'], text=True).strip() == REVISION
target = ROOT / 'billworld/public/gmail'
source = checkout / 'apps/gmail'
hashes = {}
for name in ['js/data.js', 'js/state.js', 'js/components.js', 'js/views.js', 'js/app.js', 'css/styles.css', 'index.html']:
    raw = (source / name).read_bytes()
    hashes[name] = hashlib.sha256(raw).hexdigest()
    (target / name).parent.mkdir(parents=True, exist_ok=True)
    if name == 'index.html':
        html = raw.decode().replace('href="css/', 'href="/gmail/css/').replace('src="js/', 'src="/gmail/js/')
        html = html.replace('</body>', '    <script src="/gmail/bridge.js"></script>\n</body>')
        (target / name).write_text(html)
    else:
        (target / name).write_bytes(raw)
shutil.copy2(checkout / 'LICENSE', target / 'LICENSE')
(target / 'provenance.json').write_text(json.dumps({'repository': 'https://github.com/web-arena-x/webarena-infinity',
    'revision': REVISION, 'source': 'apps/gmail', 'original_sha256': hashes,
    'modifications': ['index asset URLs and bridge script', 'separate bridge.js overrides state/auth integration; other copied files are unchanged']}, indent=2) + '\n')
print('Pinned Gmail frontend installed; bridge.js preserved')
