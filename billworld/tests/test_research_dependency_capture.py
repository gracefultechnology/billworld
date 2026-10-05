import contextlib
import fcntl
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from billworld.research_dependency_capture import fetch,traverse,database


class DependencyCaptureTests(unittest.TestCase):
    def fixture(self,root,source=b"import './child.js';"):
        from billworld.tests.test_research_frontends import FrontendTests
        helper=FrontendTests();d,c,db,bid=helper.fixture(root)
        ev=helper.body(d/'frontends',source,status='frontend_captured',content_type='text/javascript',final_url='https://utility.example/app.js')
        ev['declared_kinds']=['script']
        db.execute("UPDATE assets SET status='frontend_captured',evidence=? WHERE url='https://utility.example/app.js'",(json.dumps(ev),));db.commit();db.close();c.close()
        return d,bid,helper,ev

    def capture(self,helper,bodies,attempts):
        def run(row,directory):
            attempts.append(row['url']);content=bodies[row['url']]
            if content is None:return row['id'],{'status':'fetch_error','attempted_at':'now','requested_url':row['url']}
            ev=helper.body(directory,content,status='frontend_captured',content_type='text/javascript',final_url=row['url'])
            ev.update(attempted_at='now',requested_url=row['url'],declared_kinds=['script'])
            return row['id'],ev
        return run

    def test_recursive_batches_cycles_resources_and_rooted_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            d,bid,h,ev=self.fixture(Path(tmp),b"import './child.js';new URL('./image.png',import.meta.url)")
            attempts=[];bodies={'https://utility.example/child.js':b"import './grand.js';",'https://utility.example/grand.js':b"import './child.js';"}
            with patch('billworld.research_dependency_capture.capture_asset',side_effect=self.capture(h,bodies,attempts)):
                first=fetch(d,bid,min_free_gib=0);second=fetch(d,bid,min_free_gib=0);third=fetch(d,bid,min_free_gib=0)
            self.assertEqual([first['attempted'],second['attempted'],third['attempted']],[1,1,0]);self.assertEqual(len(attempts),2)
            items=traverse(d,bid)['assets'];self.assertEqual(len(items),2)
            child=next(x for x in items if x['url'].endswith('/child.js'));self.assertEqual(child['references'][0]['parent_body_sha256'],ev['body_sha256'])
            self.assertEqual(len(child['references']),2);self.assertIn('dependency_candidates',child)
            db=database(d/'frontends/dependency-source')
            self.assertEqual(len(db.execute('SELECT * FROM attempts').fetchall()),2);db.close()

    def test_changed_or_tampered_root_and_child_invalidate_exports(self):
        with tempfile.TemporaryDirectory() as tmp:
            d,bid,h,ev=self.fixture(Path(tmp));attempts=[]
            with patch('billworld.research_dependency_capture.capture_asset',side_effect=self.capture(h,{'https://utility.example/child.js':b'const child=1;'},attempts)):fetch(d,bid,min_free_gib=0)
            item=traverse(d,bid)['assets'][0];path=d/item['source_directory']/item['evidence']['body_file'];path.write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError,'hash mismatch'):traverse(d,bid)
            path.write_bytes(b'const child=1;')
            import sqlite3
            db=sqlite3.connect(d/'frontends/frontends.sqlite');fresh=h.body(d/'frontends',b'const root=2;',status='frontend_captured',content_type='text/javascript')
            db.execute("UPDATE assets SET evidence=? WHERE url='https://utility.example/app.js'",(json.dumps(fresh),));db.commit();db.close()
            self.assertEqual(traverse(d,bid)['assets'],[])

    def test_network_retry_depth_bounds_and_third_party_are_explicit(self):
        with tempfile.TemporaryDirectory() as tmp:
            d,bid,h,ev=self.fixture(Path(tmp),b"import './child.js';import 'https://cdn.example/foreign.js';")
            attempts=[];bodies={'https://utility.example/child.js':None}
            with patch('billworld.research_dependency_capture.capture_asset',side_effect=self.capture(h,bodies,attempts)):
                self.assertEqual(fetch(d,bid,min_free_gib=0)['attempted'],1)
                self.assertEqual(fetch(d,bid,min_free_gib=0)['attempted'],0)
                bodies['https://utility.example/child.js']=b"import './grand.js';"
                result=fetch(d,bid,retry=True,max_depth=1,min_free_gib=0)
            self.assertEqual(result['attempted'],1);self.assertEqual(result['limits'],['max_depth_reached'])
            self.assertEqual(len(result['assets']),1)
            expanded=traverse(d,bid,prepare=True,third_party=True,max_nodes=1);self.assertIn('max_nodes_reached',expanded['limits'])

    def test_existing_verified_direct_capture_is_reused_and_owner_reserve_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            d,bid,h,ev=self.fixture(Path(tmp));children=d/'frontends/dependency-source';children.mkdir()
            with (children/'capture.lock').open('a') as lock:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                with self.assertRaisesRegex(RuntimeError,'already owns'):fetch(d,bid,min_free_gib=0)
            with patch('billworld.research_dependency_capture.shutil.disk_usage',return_value=type('Disk',(),{'free':0})()):
                with self.assertRaisesRegex(RuntimeError,'free-space'):fetch(d,bid)
            import sqlite3
            db=sqlite3.connect(d/'frontends/frontends.sqlite');url='https://utility.example/child.js';aid=hashlib.sha256(url.encode()).hexdigest()
            child=h.body(d/'frontends',b'const shared=1;',status='frontend_captured',content_type='text/javascript',final_url=url)
            db.execute('INSERT INTO assets VALUES(?,?,?,?)',(aid,url,'frontend_captured',json.dumps(child)));db.commit();db.close()
            with patch('billworld.research_dependency_capture.capture_asset') as network:result=fetch(d,bid,min_free_gib=0)
            network.assert_not_called();self.assertEqual(result['assets'][0]['source_directory'],'frontends')

    def test_source_packet_copies_child_with_separate_verified_edges(self):
        from billworld.source_packet import packet
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);d,bid,h,ev=self.fixture(root);attempts=[]
            with patch('billworld.research_dependency_capture.capture_asset',side_effect=self.capture(h,{'https://utility.example/child.js':b'const child=1;'},attempts)):fetch(d,bid,min_free_gib=0)
            with contextlib.redirect_stdout(io.StringIO()):target=packet(bid,root,d)
            meta=json.loads((target/'metadata.json').read_text());self.assertEqual(len(meta['source_dependency_assets']),1)
            item=meta['source_dependency_assets'][0];self.assertEqual((target/item['packet_file']).read_bytes(),b'const child=1;')
            self.assertEqual(len(meta['static_frontend_assets']),2);self.assertNotIn('page_url',item['references'][0])
