import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from billworld.discover_routes import load_candidates,index_candidates
from billworld.catalog_index import load_captures


class SelectiveEvidenceTests(unittest.TestCase):
    def fixture(self,directory):
        rows=[{'biller_id':'a','label':'first'},{'biller_id':'b','label':'other'},{'biller_id':'a','label':'last'}]
        path=directory/'route-candidates.jsonl'
        path.write_text(''.join(json.dumps(r)+'\n' for r in rows));return path,rows

    def test_targeted_stream_preserves_unsorted_associations_without_bulk_text_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp);path,rows=self.fixture(directory)
            with patch.object(Path,'read_text',side_effect=AssertionError('No bulk source read')):
                result=load_candidates(directory,biller_id='a')
            self.assertEqual(dict(result),{'a':[rows[0],rows[2]]})

    def test_indexed_noncontiguous_chunks_match_full_scan_and_missing_biller(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp);path,rows=self.fixture(directory);summary=index_candidates(directory)
            self.assertEqual(summary['source_sha256'],hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(dict(load_candidates(directory,biller_id='a')),{'a':[rows[0],rows[2]]})
            self.assertEqual(dict(load_candidates(directory,biller_id='missing')), {})
            self.assertEqual(dict(load_candidates(directory)),{'a':[rows[0],rows[2]],'b':[rows[1]]})

    def test_stale_index_falls_back_to_current_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp);path,rows=self.fixture(directory);index_candidates(directory)
            rows.append({'biller_id':'a','label':'fresh'})
            path.write_text(''.join(json.dumps(r)+'\n' for r in rows))
            self.assertEqual(load_candidates(directory,biller_id='a')['a'][-1]['label'],'fresh')

    def test_same_stat_tampering_or_invalid_span_cannot_supply_indexed_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp);path,rows=self.fixture(directory);index_candidates(directory)
            before=path.stat();path.write_bytes(path.read_bytes().replace(b'first',b'wrong'))
            os.utime(path,ns=(before.st_atime_ns,before.st_mtime_ns))
            with self.assertRaisesRegex(ValueError,'chunk hash mismatch'):load_candidates(directory,biller_id='a')
            index=directory/'route-candidates-index.json';data=json.loads(index.read_text())
            data['billers']['a'][0]['offset']=-1;index.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError,'outside source'):load_candidates(directory,biller_id='a')

    def test_index_cannot_associate_another_billers_chunk(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp);path,rows=self.fixture(directory);index_candidates(directory)
            index=directory/'route-candidates-index.json';data=json.loads(index.read_text())
            data['billers']['a']=data['billers']['b'];index.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError,'association mismatch'):load_candidates(directory,biller_id='a')

    def test_capture_lookup_decodes_only_requested_urls(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp);db=sqlite3.connect(directory/'catalog.sqlite')
            db.execute('CREATE TABLE urls(url TEXT UNIQUE,evidence TEXT)')
            db.executemany('INSERT INTO urls VALUES(?,?)',[('https://a.example/',json.dumps({'status':'http_captured'})),('https://other.example/','not-json')]);db.commit();db.close()
            self.assertEqual(load_captures(directory,urls=['https://a.example/',None,'https://missing.example/']),{'https://a.example/':{'status':'http_captured'}})
            self.assertEqual(load_captures(directory,urls=[]),{})

if __name__ == '__main__': unittest.main()
