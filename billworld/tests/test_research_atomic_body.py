import concurrent.futures
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from billworld.research_catalog import publish_body

class AtomicBodyTests(unittest.TestCase):
    def test_existing_body_remains_complete_until_publication(self):
        import os
        with tempfile.TemporaryDirectory() as d:
            target=Path(d)/'bodies'/'sha';target.parent.mkdir();target.write_bytes(b'old')
            replace=os.replace
            def observe(source,destination):
                self.assertEqual(target.read_bytes(),b'old')
                self.assertEqual(Path(source).read_bytes(),b'new')
                replace(source,destination)
            with patch('billworld.research_catalog.os.replace',side_effect=observe):publish_body(target,b'new')
            self.assertEqual(target.read_bytes(),b'new');self.assertEqual(list(target.parent.iterdir()),[target])
    def test_failed_publication_keeps_previous_body_and_removes_temporary(self):
        with tempfile.TemporaryDirectory() as d:
            target=Path(d)/'bodies'/'sha';target.parent.mkdir();target.write_bytes(b'old')
            with patch('billworld.research_catalog.os.replace',side_effect=OSError('disk failure')):
                with self.assertRaises(OSError):publish_body(target,b'new')
            self.assertEqual(target.read_bytes(),b'old');self.assertEqual(list(target.parent.iterdir()),[target])
    def test_concurrent_writers_and_reader_never_observe_truncated_shared_hash(self):
        with tempfile.TemporaryDirectory() as d:
            content=b'public evidence '*100000;digest=hashlib.sha256(content).hexdigest();target=Path(d)/'bodies'/digest;publish_body(target,content)
            def writer():
                for _ in range(12):publish_body(target,content)
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                jobs=[pool.submit(writer) for _ in range(3)]
                for _ in range(100):self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(),digest)
                for job in jobs:job.result()
            self.assertEqual(list(target.parent.iterdir()),[target])
