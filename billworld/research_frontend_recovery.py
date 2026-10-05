"""Explicit bounded requeue of DNS failures in a specified UTC time window.

Retains old attempt evidence and a transactional requeue audit. Never retries HTTP
errors, malformed URLs or successful captures. Uses the main supervisor lock.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import uuid

from billworld.research_catalog import DEFAULT
from billworld.research_frontends import database
from billworld.research_frontend_queue import supervisor_owner


def timestamp(value):
    parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
    if parsed.tzinfo is None or parsed.utcoffset().total_seconds()!=0:
        raise ValueError('Use an explicit UTC timestamp')
    return parsed


def recover(source_directory, since, until, limit=1000):
    start,end=timestamp(since),timestamp(until)
    if start>=end:raise ValueError('Recovery window must have increasing bounds')
    if isinstance(limit,bool) or not isinstance(limit,int) or not 1<=limit<=10000:
        raise ValueError('Recovery limit must be 1–10000')
    directory=source_directory/'frontends'
    with supervisor_owner(directory):
        db=database(directory)
        try:
            # Bound selection before any status mutation. Parse dates rather than
            # relying on lexicographic equivalence of ISO timestamp spellings.
            selected=[]
            for asset_id,evidence in db.execute("SELECT id,evidence FROM assets WHERE status='fetch_error' ORDER BY id"):
                previous=json.loads(evidence or '{}')
                if not str(previous.get('error','')).startswith('gaierror:'):continue
                try:at=timestamp(previous.get('attempted_at',''))
                except (ValueError,AttributeError):continue
                if start<=at<end:
                    selected.append((asset_id,evidence))
                    if len(selected)>=limit:break
            batch_id=uuid.uuid4().hex;queued_at=datetime.now(timezone.utc).isoformat()
            db.execute('''CREATE TABLE IF NOT EXISTS dns_requeues(
                batch_id TEXT,asset_id TEXT,queued_at TEXT,prior_evidence TEXT,
                reason TEXT,PRIMARY KEY(batch_id,asset_id))''')
            count=0
            with db:
                for asset_id,evidence in selected:
                    changed=db.execute("UPDATE assets SET status='pending' WHERE id=? AND status='fetch_error' AND evidence=?",(asset_id,evidence)).rowcount
                    if changed:
                        db.execute('INSERT INTO dns_requeues VALUES(?,?,?,?,?)',
                                   (batch_id,asset_id,queued_at,evidence,'Explicit DNS recovery '+since+' to '+until))
                        count+=1
            return {'batch_id':batch_id,'queued_at':queued_at,'since_inclusive':since,
                    'until_exclusive':until,'limit':limit,'requeued':count,
                    'policy':'Previous evidence and attempts preserved; no network requests; pending collector applies normal public GET rules'}
        finally:db.close()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--directory',type=Path,default=DEFAULT)
    p.add_argument('--since',required=True);p.add_argument('--until',required=True)
    p.add_argument('--limit',type=int,default=1000);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    if a.output.exists():p.error('Choose a new output receipt to preserve previous recovery evidence')
    result=recover(a.directory,a.since,a.until,a.limit)
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
