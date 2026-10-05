import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from billworld.research_dependencies import database,analyze,resolve_references,kind,run

class DependencyTests(unittest.TestCase):
    def fixture(self,d,source=b"import './child.js';",mime='text/javascript'):
        digest=hashlib.sha256(source).hexdigest();(d/'bodies').mkdir(exist_ok=True);(d/'bodies'/digest).write_bytes(source)
        return {'id':'asset','url':'https://original.example/old.js','status':'frontend_captured','evidence':{'body_file':'bodies/'+digest,'body_sha256':digest,'final_url':'https://cdn.example/modules/app.js','content_type':mime,'declared_kinds':['script']}}

    def test_redirect_base_scope_and_unresolvable_references(self):
        refs=[{'specifier':value,'kind':'script','syntax':'ImportDeclaration'} for value in ['./a.js','../b.js','pkg','https://127.0.0.1/private.js','node:fs','http://[broken','https://u:p@other.example/a.js']]
        refs += [{'specifier':value,'kind':'resource','syntax':'css-url'} for value in ['image.png','#mask','','data:image/png;base64,AAAA']]
        resolved,unresolved=resolve_references('https://cdn.example/modules/app.js',{'references':refs})
        self.assertEqual([x['url'] for x in resolved],['https://cdn.example/modules/a.js','https://cdn.example/b.js','https://cdn.example/modules/image.png'])
        self.assertTrue(any(x['reason']=='bare_module_requires_import_map' for x in unresolved));self.assertTrue(any(x['reason']=='embedded_fragment' for x in unresolved));self.assertEqual(len(unresolved),8)

    def test_hash_verified_cache_and_revision_base_or_body_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp);db=database(d);row=self.fixture(d)
            first,hit=analyze(db,d,row,'parser-v1');self.assertFalse(hit);self.assertEqual(first['dependencies'][0]['url'],'https://cdn.example/modules/child.js')
            with patch('billworld.research_dependencies.parse',side_effect=AssertionError('must reuse')):
                again,hit=analyze(db,d,row,'parser-v1');self.assertTrue(hit);self.assertEqual(again,first)
            self.assertFalse(analyze(db,d,row,'parser-v2')[1]);row['evidence']['final_url']='https://new.example/app.js';self.assertFalse(analyze(db,d,row,'parser-v2')[1])
            row=self.fixture(d,b"import './other.js';");changed,hit=analyze(db,d,row,'parser-v2');self.assertFalse(hit);self.assertNotEqual(changed['body_sha256'],first['body_sha256'])
            (d/row['evidence']['body_file']).write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError,'hash mismatch'):analyze(db,d,row,'parser-v2')
            row['evidence']['body_file']='../outside'
            with self.assertRaisesRegex(ValueError,'path escapes'):analyze(db,d,row,'parser-v2')
            db.close()

    def test_unfetched_ambiguous_invalid_and_legacy_encoding_are_not_guessed(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp);db=database(d);row=self.fixture(d,b'import ???');report,_=analyze(db,d,row,'v1');self.assertEqual(report['parse']['status'],'parse_error')
            row['status']='pending';self.assertEqual(analyze(db,d,row,'v1'),(None,False));row=self.fixture(d,b'abc','text/plain');row['evidence']['declared_kinds']=['script','style'];report,_=analyze(db,d,row,'v2');self.assertEqual(report['parse']['status'],'ambiguous_source_kind')
            row=self.fixture(d,b"import './caf\xe9.js';",'text/javascript; charset=iso-8859-1');report,_=analyze(db,d,row,'v3');self.assertEqual(report['parse']['status'],'parsed');self.assertIn('café',report['dependencies'][0]['specifier'])
            db.close()

    def test_parser_timeout_is_recorded_without_losing_source_provenance(self):
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp);db=database(d);row=self.fixture(d)
            with patch('billworld.research_dependencies.subprocess.run',side_effect=subprocess.TimeoutExpired('node',30)):
                report,_=analyze(db,d,row,'v1')
            self.assertEqual(report['parse']['status'],'parser_timeout');self.assertEqual(report['body_sha256'],row['evidence']['body_sha256']);db.close()

    def test_mime_and_role_changes_invalidate_cache_even_with_unchanged_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp);db=database(d);row=self.fixture(d,b'body{}')
            report,_=analyze(db,d,row,'v1');self.assertEqual(report['kind'],'script')
            row['evidence']['content_type']='text/css';row['evidence']['declared_kinds']=['style']
            report,reused=analyze(db,d,row,'v1');self.assertFalse(reused);self.assertEqual(report['kind'],'style');db.close()

    def test_global_batches_advance_past_cached_metadata_but_explicit_exports_verify_bytes(self):
        from billworld.research_frontends import database as frontends
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);d=root/'frontends';db=frontends(d)
            for name in ['a','b']:
                row=self.fixture(d,f"import './{name}-child.js';".encode());row['id']=name;row['url']=f'https://original.example/{name}.js'
                db.execute('INSERT INTO assets(id,url,status,evidence) VALUES(?,?,?,?)',(name,row['url'],row['status'],json.dumps(row['evidence'])))
                db.execute('INSERT INTO refs VALUES(?,?,?,?)',('page',name,'script','same_host'))
            db.commit();db.close()
            first=run(root,limit=1);second=run(root,limit=1);third=run(root,limit=1)
            self.assertEqual(first['analyses'][0]['asset_id'],'a');self.assertEqual(second['analyses'][0]['asset_id'],'b')
            self.assertEqual(second['skipped_metadata_current'],1);self.assertEqual(third['analyzed_or_reused'],0)
            ev=first['analyses'][0];(d/'bodies'/ev['body_sha256']).write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError,'hash mismatch'):run(root,limit=1,include_current=True)

    def test_source_packet_includes_only_current_hash_bound_dependency_reports(self):
        import contextlib,io
        from billworld.tests.test_research_frontends import FrontendTests
        from billworld.source_packet import packet
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);helper=FrontendTests();d,c,db,bid=helper.fixture(root)
            ev=helper.body(d/'frontends',b"import './child.js';",status='frontend_captured',content_type='text/javascript')
            ev['declared_kinds']=['script']
            db.execute("UPDATE assets SET status='frontend_captured',evidence=? WHERE url='https://utility.example/app.js'",(json.dumps(ev),));db.commit()
            result=run(d,biller_id=bid);self.assertEqual(result['analyzed_or_reused'],1)
            with contextlib.redirect_stdout(io.StringIO()):first=packet(bid,root,d)
            metadata=json.loads((first/'metadata.json').read_text());reports=metadata['frontend_dependency_candidates']
            self.assertEqual(len(reports),1);self.assertEqual(reports[0]['body_sha256'],ev['body_sha256'])
            self.assertEqual(reports[0]['dependencies'][0]['url'],'https://utility.example/child.js')
            ev['final_url']='https://new.example/app.js';db.execute("UPDATE assets SET evidence=? WHERE url='https://utility.example/app.js'",(json.dumps(ev),));db.commit()
            with contextlib.redirect_stdout(io.StringIO()):second=packet(bid,root,d)
            self.assertNotEqual(first,second);self.assertEqual(json.loads((second/'metadata.json').read_text())['frontend_dependency_candidates'],[])
            db.close();c.close()
