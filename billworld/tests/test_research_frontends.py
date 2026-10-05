import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
import sqlite3
import threading
import unittest
from unittest.mock import patch
from billworld.research_catalog import database as catalog_database
from billworld.research_frontends import Dependencies, reference_url, same_host, database, initialize, pending, capture_asset, biller_assets, main, status
from billworld.research_frontends import checked_body, fetch_work
from billworld.source_packet import packet
from audit_billworld import identity


class FrontendTests(unittest.TestCase):
    def fixture(self, root):
        directory = root/'billworld/research-data'
        catalog = catalog_database(directory)
        entry = {'name':'Example Utility','website':'https://utility.example/','login_url':'https://utility.example/login'}
        (root/'categories').mkdir(); (root/'billworld/sites').mkdir(); (root/'billworld/captures').mkdir()
        (root/'categories/water.json').write_text(json.dumps({'entries':[entry]}))
        bid = identity(entry,'water')
        content = b'<script src="/app.js"></script><link rel="stylesheet" href="https://cdn.example/app.css"><script src="/app.js"></script>'
        ev = self.body(directory, content, content_type='text/html', final_url=entry['website'], status='http_captured')
        catalog.execute('INSERT INTO urls VALUES(?,?,?,?)', ('page',entry['website'],'http_captured',json.dumps(ev)))
        catalog.execute('INSERT INTO routes VALUES(?,?,?,?)',(bid,'website',entry['website'],'page'))
        catalog.commit()
        db = database(directory/'frontends'); initialize(db,directory)
        return directory,catalog,db,bid

    def body(self,directory,content,**extra):
        sha = hashlib.sha256(content).hexdigest(); (directory/'bodies').mkdir(exist_ok=True)
        (directory/'bodies'/sha).write_bytes(content)
        return {'body_file':'bodies/'+sha,'body_sha256':sha,**extra}

    def test_dependency_types_base_and_local_exclusion(self):
        p = Dependencies('https://utility.example/start')
        p.feed('<base href="/dist/"><script src="app.js#part"></script><link rel="modulepreload" href="mod.js"><link rel="preload" as="style" href="app.css"><link rel="icon" href="icon.png"><script src="http://127.0.0.1/a.js"></script>')
        self.assertEqual(p.refs,{('https://utility.example/dist/app.js','script'),('https://utility.example/dist/mod.js','script'),('https://utility.example/dist/app.css','style')})
        for url in ['http://localhost/a','http://192.168.1.1/a','http://[::1]/a','file:///x','https://user:pass@x.example/a','http://app.local/a']:
            self.assertIsNone(reference_url('https://utility.example/',url))
        self.assertTrue(same_host('https://www.utility.example/','http://utility.example/app.js'))
        self.assertFalse(same_host('https://utility.example/','https://cdn.utility.example/app.js'))

    def test_inventory_deduplicates_preserves_status_and_defaults_to_same_host(self):
        with tempfile.TemporaryDirectory() as tmp:
            d,c,db,bid = self.fixture(Path(tmp))
            self.assertEqual(db.execute('SELECT COUNT(*) FROM refs').fetchone()[0],2)
            work = pending(db,100); self.assertEqual([r['url'] for r in work],['https://utility.example/app.js'])
            self.assertEqual(len(pending(db,100,third_party=True)),2)
            self.assertEqual(len(pending(db,100,biller_id=bid)),1)
            self.assertEqual(pending(db,100,biller_id='missing-biller'),[])
            db.execute("UPDATE assets SET status='fetch_error' WHERE url=?",(work[0]['url'],));db.commit()
            initialize(db,d); self.assertEqual(pending(db,100),[]);self.assertEqual(len(pending(db,100,retry=True)),1)
            db.close();c.close()

    def test_corrupt_or_escaping_page_is_excluded_and_associations_removed(self):
        with tempfile.TemporaryDirectory() as tmp:
            d,c,db,bid = self.fixture(Path(tmp))
            ev = json.loads(c.execute('SELECT evidence FROM urls').fetchone()[0]);(d/ev['body_file']).write_text('tampered')
            report = initialize(db,d);self.assertEqual(report['integrity_failures'],1)
            self.assertEqual(pending(db,100,True),[]);self.assertEqual(biller_assets(d,bid),[])
            ev['body_file']='../../outside';c.execute('UPDATE urls SET evidence=?',(json.dumps(ev),));c.commit()
            self.assertEqual(initialize(db,d)['integrity_failures'],1)
            db.close();c.close()

    def test_http_200_html_or_binary_is_never_exportable_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp)
            for content,mime,expected in [(b'<!DOCTYPE html>challenge','text/javascript','not_frontend_content'),(b'<html>login','text/html','not_frontend_content'),(b'PNG','image/png','not_frontend_content'),(b'const app=1','application/javascript','frontend_captured'),(b'body{color:red}','text/css','frontend_captured')]:
                ev=self.body(d,content,status='http_captured',content_type=mime)
                with patch('billworld.research_frontends.capture',return_value=('asset',ev)) as mock:
                    _,result=capture_asset({'id':'asset','url':'https://example.com/a'},d)
                self.assertEqual(result['status'],expected);self.assertEqual(mock.call_args.kwargs['max_bytes'],8*1024*1024)
            ev=self.body(d,b'body{color:red}',status='http_captured',content_type='text/css')
            with patch('billworld.research_frontends.capture',return_value=('asset',ev)):
                _,result=capture_asset({'id':'asset','url':'https://example.com/a','kinds':'script'},d)
            self.assertEqual(result['status'],'not_frontend_content')

    def test_packet_exports_verified_sources_and_revises_when_bundle_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);d,c,db,bid=self.fixture(root)
            ev=self.body(d/'frontends',b'const app=1;',status='frontend_captured',content_type='application/javascript')
            db.execute('UPDATE assets SET status=?,evidence=? WHERE url=?',('frontend_captured',json.dumps(ev),'https://utility.example/app.js'));db.commit()
            with contextlib.redirect_stdout(io.StringIO()): first=packet(bid,root,d)
            assets=json.loads((first/'metadata.json').read_text())['static_frontend_assets']
            fetched=next(a for a in assets if a['status']=='frontend_captured')
            self.assertEqual((first/fetched['packet_file']).read_bytes(),b'const app=1;')
            self.assertEqual(fetched['references'][0]['page_url'],'https://utility.example/')
            self.assertEqual(fetched['execution_policy'],'reference_only_not_runtime')
            unfetched=next(a for a in assets if a['status']=='pending');self.assertNotIn('packet_file',unfetched)
            ev=self.body(d/'frontends',b'const app=2;',status='frontend_captured',content_type='application/javascript')
            db.execute('UPDATE assets SET evidence=? WHERE url=?',(json.dumps(ev),'https://utility.example/app.js'));db.commit()
            with contextlib.redirect_stdout(io.StringIO()): second=packet(bid,root,d)
            self.assertNotEqual(first,second)
            (d/'frontends'/ev['body_file']).write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError,'hash mismatch'): packet(bid,root,d)
            ev['body_file']='../outside';db.execute('UPDATE assets SET evidence=? WHERE url=?',(json.dumps(ev),'https://utility.example/app.js'));db.commit()
            with self.assertRaisesRegex(ValueError,'path escapes'): packet(bid,root,d)
            db.close();c.close()

    def test_stale_page_hash_prevents_bundle_export_even_with_old_associations(self):
        with tempfile.TemporaryDirectory() as tmp:
            d,c,db,bid=self.fixture(Path(tmp))
            fresh=self.body(d,b'<html>new page</html>',status='http_captured',content_type='text/html')
            c.execute('UPDATE urls SET evidence=?',(json.dumps(fresh),));c.commit()
            self.assertEqual(biller_assets(d,bid),[])
            db.close();c.close()

    def test_shared_bundle_retains_biller_specific_page_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            d,c,db,bid=self.fixture(Path(tmp))
            c.execute('INSERT INTO routes VALUES(?,?,?,?)',('other-biller','website','https://utility.example/','page'));c.commit()
            initialize(db,d)
            self.assertEqual(len(pending(db,100)),1)
            self.assertEqual(biller_assets(d,bid),biller_assets(d,'other-biller'))
            db.close();c.close()

    def test_progress_counts_shared_assets_once_and_avoids_expanding_duplicate_references(self):
        with tempfile.TemporaryDirectory() as tmp:
            db=database(Path(tmp))
            db.executemany('INSERT INTO assets(id,url,status) VALUES(?,?,?)',[(f'asset-{i}',f'https://example.com/{i}.js','pending' if i%2 else 'frontend_captured') for i in range(100)])
            db.execute("INSERT INTO assets(id,url) VALUES('unreferenced','https://example.com/unused.js')")
            db.executemany('INSERT INTO pages(id,url,body_sha256) VALUES(?,?,?)',[(f'page-{i}',f'https://example.com/{i}','hash') for i in range(100)])
            db.executemany('INSERT INTO page_billers VALUES(?,?)',[(f'page-{i}',f'biller-{i%5}') for i in range(100)])
            db.executemany('INSERT INTO refs VALUES(?,?,?,?)',[(f'page-{i}',f'asset-{j}','script','same_host' if j<80 else 'third_party') for i in range(100) for j in range(100)])
            db.commit()
            counts=status(db)
            self.assertEqual(counts['billers_with_static_references'],5)
            self.assertEqual(counts['same_host_pending'],40)
            self.assertEqual(counts['active_asset_status_counts'],{'frontend_captured':50,'pending':50})
            def measured(query):
                instructions=[0]
                def progress():instructions[0]+=1;return 0
                db.set_progress_handler(progress,1)
                try:return db.execute(query).fetchone()[0],instructions
                finally:db.set_progress_handler(None,0)
            pairs=[
                ('SELECT COUNT(DISTINCT b.biller_id) FROM page_billers b JOIN refs r ON r.page_id=b.page_id','SELECT COUNT(DISTINCT b.biller_id) FROM page_billers b WHERE EXISTS (SELECT 1 FROM refs r WHERE r.page_id=b.page_id)',5),
                ("SELECT COUNT(DISTINCT a.id) FROM assets a JOIN refs r ON r.asset_id=a.id WHERE a.status='pending' AND r.scope='same_host'","SELECT COUNT(*) FROM assets a WHERE a.status='pending' AND EXISTS (SELECT 1 FROM refs r WHERE r.asset_id=a.id AND r.scope='same_host')",40)]
            for before,after,expected in pairs:
                old,old_steps=measured(before);new,new_steps=measured(after)
                self.assertEqual(old,expected);self.assertEqual(new,expected)
                self.assertLess(new_steps[0],old_steps[0]/5)
            previous="SELECT COUNT(*) FROM assets WHERE id IN (SELECT asset_id FROM refs)"
            current="SELECT COUNT(*) FROM assets a WHERE EXISTS (SELECT 1 FROM refs r WHERE r.asset_id=a.id)"
            old,old_steps=measured(previous);new,new_steps=measured(current)
            self.assertEqual(old,100);self.assertEqual(new,100)
            self.assertLess(new_steps[0],old_steps[0]/5)
            indexes={row[1] for row in db.execute('PRAGMA index_list(refs)')}
            self.assertIn('refs_asset_scope',indexes)
            db.close()

    def test_cli_persists_attempts_and_resumes_network_failures_explicitly(self):
        with tempfile.TemporaryDirectory() as tmp:
            d,c,db,bid=self.fixture(Path(tmp)); db.close();c.close()
            def failure(row,directory):
                return row['id'], {'status':'fetch_error','attempted_at':'first','requested_url':row['url']}
            argv=['research_frontends','fetch','--directory',str(d),'--workers','1']
            with patch('sys.argv',argv), patch('billworld.research_frontends.capture_asset',side_effect=failure) as fetch, contextlib.redirect_stdout(io.StringIO()):
                main();self.assertEqual(fetch.call_count,1)
                main();self.assertEqual(fetch.call_count,1)
            def success(row,directory):
                ev=self.body(directory,b'const app=1;',status='frontend_captured',attempted_at='second',requested_url=row['url'])
                return row['id'],ev
            with patch('sys.argv',argv+['--retry']), patch('billworld.research_frontends.capture_asset',side_effect=success) as fetch, contextlib.redirect_stdout(io.StringIO()):
                main();self.assertEqual(fetch.call_count,1)
            db=database(d/'frontends')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM attempts').fetchone()[0],2)
            self.assertEqual(json.loads((d/'frontends/status.json').read_text())['active_asset_status_counts'],{'frontend_captured':1,'pending':1})
            db.close()

    def test_interrupted_inventory_resumes_from_committed_batch(self):
        with tempfile.TemporaryDirectory() as tmp:
            d,c,db,bid=self.fixture(Path(tmp))
            ev=c.execute('SELECT evidence FROM urls').fetchone()[0]
            for n in range(250):
                c.execute('INSERT INTO urls VALUES(?,?,?,?)',(f'page-{n}',f'https://utility.example/{n}','http_captured',ev))
            c.commit();calls=0
            def interrupted(directory,evidence):
                nonlocal calls
                calls+=1
                if calls == 251: raise KeyboardInterrupt()
                return checked_body(directory,evidence)
            with patch('billworld.research_frontends.checked_body',side_effect=interrupted), self.assertRaises(KeyboardInterrupt): initialize(db,d)
            db.close();db=database(d/'frontends')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM pages').fetchone()[0],250)
            self.assertEqual(json.loads((d/'frontends/inventory-progress.json').read_text())['phase'],'in_progress')
            report=initialize(db,d)
            self.assertEqual(report['html_pages'],251);self.assertEqual(report['reused_pages'],250)
            self.assertEqual(json.loads((d/'frontends/inventory-progress.json').read_text())['phase'],'completed')
            db.close();c.close()

    def test_download_commit_waits_for_inventory_writer_then_persists(self):
        with tempfile.TemporaryDirectory() as tmp:
            d,c,db,bid=self.fixture(Path(tmp));c.close()
            self.assertGreaterEqual(db.execute('PRAGMA busy_timeout').fetchone()[0],30000)
            work=pending(db,1)
            writer=sqlite3.connect(d/'frontends/frontends.sqlite',check_same_thread=False)
            writer.execute('BEGIN IMMEDIATE')
            release=threading.Timer(0.15,writer.commit);release.start()
            ev={'status':'fetch_error','attempted_at':'locked-test','requested_url':work[0]['url']}
            with patch('billworld.research_frontends.capture_asset',return_value=(work[0]['id'],ev)),contextlib.redirect_stdout(io.StringIO()):
                fetch_work(db,d/'frontends',work,1)
            release.join();writer.close()
            self.assertEqual(db.execute('SELECT COUNT(*) FROM attempts').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT status FROM assets WHERE id=?',(work[0]['id'],)).fetchone()[0],'fetch_error')
            db.close()

if __name__ == '__main__': unittest.main()
