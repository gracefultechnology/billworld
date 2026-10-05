import hashlib, json, pathlib, tempfile, unittest
from unittest.mock import patch
import sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import build_public_snapshot as module

class SnapshotTests(unittest.TestCase):
    def test_catalog_snapshot_uses_only_usable_captures_and_verified_documents(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(module,'ROOT',pathlib.Path(tmp)):
            root=pathlib.Path(tmp);source,_=self.fixture(root);capture='biller_0123456789abcdef0123-website';source.rename(source.parent/capture);source=source.parent/capture
            markup=b'<html><body><a href="/billing">Billing</a><a href="/blocked">Pay</a><a href="/guide.pdf">Guide</a><button data-toggle="collapse" data-target="#Fees">Fees</button><div id="Fees" class="collapse">Published fee</div><form><input name="password"><button>Submit</button></form><script>pay()</script></body></html>'
            (source/'page.html').write_bytes(markup);(root/'public').mkdir();(root/'public/catalog-public.js').write_text('// local collapse only')
            pdf=b'%PDF-fixture';(root/'captures/guide.pdf').write_bytes(pdf);digest=hashlib.sha256(pdf).hexdigest()
            data={'pages':[{'id':capture,'requestedUrl':'https://example.org/','finalUrl':'https://example.org/','contentStatus':'captured_requires_review','htmlSha256':hashlib.sha256(markup).hexdigest()},{'id':capture.replace('website','billing'),'requestedUrl':'https://example.org/billing','finalUrl':'https://example.org/billing','contentStatus':'captured_requires_review'},{'id':capture.replace('website','blocked'),'requestedUrl':'https://example.org/blocked','finalUrl':'https://example.org/blocked','contentStatus':'http_error'}],'documents':[{'url':'https://example.org/guide.pdf','file':'guide.pdf','sha256':digest}]}
            manifest=root/'captures'/('biller_0123456789abcdef0123-manifest.json');manifest.write_text(json.dumps(data));module.build(capture);dest=root/'public/reference-pages'/capture;page=(dest/'index.html').read_text()
            self.assertIn('/reference-pages/'+capture.replace('website','billing')+'/index.html',page);self.assertNotIn('href="/blocked"',page);self.assertIn('aria-disabled="true"',page);self.assertIn('/reference-pages/'+capture+'/'+digest,page);self.assertEqual((dest/digest).read_bytes(),pdf);self.assertNotIn('pay()',page);self.assertIn('catalog-public.js',page);self.assertNotIn('municipal.js',page);self.assertNotIn('<form',page);self.assertIn('disabled',page)
            with self.assertRaisesRegex(ValueError,'usable'):module.build(capture.replace('website','blocked'))
            with self.assertRaisesRegex(ValueError,'Invalid'):module.build('../escape')
            data['documents'][0]['sha256']='0'*64;manifest.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError,'Document hash'):module.build(capture)
    def test_observed_cssom_rules_restore_script_inserted_styles_without_executing_script(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(module,'ROOT',pathlib.Path(tmp)):
            root=pathlib.Path(tmp);source,digest=self.fixture(root)
            raw=json.dumps([{'index':0,'css':'.x{color:red;background:url(/hero.png)}'}]).encode()
            (source/'inline-styles.json').write_bytes(raw)
            manifest=root/'research/gvp-public.json';metadata=json.loads(manifest.read_text());metadata['pages'][0]['inlineStylesSha256']=hashlib.sha256(raw).hexdigest();manifest.write_text(json.dumps(metadata))
            module.build();dest=root/'public/reference-pages/gvp-home';files=json.loads((dest/'manifest.json').read_text())['files']
            css=''.join((dest/name).read_text() for name,item in files.items() if item['contentType']=='text/css')
            self.assertIn('color:red',css);self.assertIn('/reference-pages/gvp-home/'+digest,css);self.assertNotIn('<script',(dest/'index.html').read_text())
            (source/'inline-styles.json').write_bytes(raw+b'changed')
            with self.assertRaisesRegex(ValueError,'CSSOM hash'):module.build()
    def fixture(self, root):
        source=root/'captures/gvp-home';source.mkdir(parents=True);(source/'assets').mkdir()
        html=b'''<html><head><style>.x{background:url(/hero.png)}</style><script>fetch("https://production.example/pay")</script></head><body><form action="https://production.example/pay"><input name="card"></form><a href="https://gvp.smarthub.coop/ui/#/login" onclick="steal()">Login</a><a href="https://production.example/account">Other</a><img src="/hero.png"></body></html>'''
        (source/'page.html').write_bytes(html);raw=b'image-reference';digest=hashlib.sha256(raw).hexdigest();(source/'assets'/digest).write_bytes(raw)
        (source/'assets.json').write_text(json.dumps([{'url':'https://www.gvp.org/hero.png','resourceType':'image','sha256':digest,'file':'assets/'+digest,'contentType':'image/png'}]));(root/'research').mkdir();(root/'research/gvp-public.json').write_text(json.dumps({'pages':[{'id':'gvp-home','finalUrl':'https://www.gvp.org/','contentStatus':'captured_requires_review','htmlSha256':hashlib.sha256(html).hexdigest()}]}));return source,digest
    def test_reuses_verified_assets_but_removes_production_execution(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(module,'ROOT',pathlib.Path(tmp)):
            root=pathlib.Path(tmp);_,digest=self.fixture(root);module.build();dest=root/'public/reference-pages/gvp-home';page=(dest/'index.html').read_text();css=''.join((dest/name).read_text() for name,info in json.loads((dest/'manifest.json').read_text())['files'].items() if info['contentType']=='text/css')
            self.assertNotIn('<script',page);self.assertNotIn('onclick',page);self.assertNotIn('<form',page);self.assertNotIn('production.example',page);self.assertIn('disabled',page);self.assertIn('aria-disabled="true"',page);self.assertIn('/smarthub/ui/#/login',page);self.assertIn('/reference-pages/gvp-home/'+digest,css);self.assertEqual((dest/digest).read_bytes(),b'image-reference')
            manifest=json.loads((dest/'manifest.json').read_text());self.assertIn('https://production.example/account',manifest['unsupported_navigation'])
    def test_lockwood_construction_preserves_shadow_banner_labels_and_capture_navigation(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(module,'ROOT',pathlib.Path(tmp)):
            root=pathlib.Path(tmp);source,_=self.fixture(root);capture='biller_182c5bcdeb2841397831-links-pay_bill';source.rename(source.parent/capture);source=source.parent/capture
            markup=b'<html><body><cookie-consent-banner btn-label-only-essential-and-continue="Agree to Required" btn-label-accept-and-continue="Agree to All"><div slot="text">Cookie choices</div></cookie-consent-banner><form action="https://lockwoodmo.epayub.com/Account/Login"><input id="Username"></form><a href="/Account/Registration">Register</a><a href="/Unavailable">Unavailable</a><script>submitPayment()</script></body></html>'
            (source/'page.html').write_bytes(markup)
            data={'pages':[{'id':capture,'requestedUrl':'https://lockwoodmo.epayub.com/','finalUrl':'https://lockwoodmo.epayub.com/Account/Login?ReturnUrl=%2F','contentStatus':'captured_requires_review','htmlSha256':hashlib.sha256(markup).hexdigest()},{'id':'biller_182c5bcdeb2841397831-registration','requestedUrl':'https://lockwoodmo.epayub.com/Account/Registration','finalUrl':'https://lockwoodmo.epayub.com/Account/Registration','contentStatus':'captured_requires_review'}]}
            (root/'research/lockwood-public.json').write_text(json.dumps(data));module.build(capture)
            dest=root/'public/reference-pages'/capture;page=(dest/'index.html').read_text();manifest=json.loads((dest/'manifest.json').read_text())
            self.assertNotIn('<script',page);self.assertNotIn('<form',page);self.assertNotIn('submitPayment',page);self.assertIn('<input id="Username" disabled>',page);self.assertIn('Agree to Required',page);self.assertIn('Agree to All',page);self.assertIn('class="lockwood-cookie-reference"',page)
            self.assertIn('href="/reference-pages/biller_182c5bcdeb2841397831-registration/index.html"',page);self.assertIn('aria-disabled="true"',page);self.assertEqual(manifest['construction_stage'],'inert_public_reconstruction_not_activated_runtime');self.assertNotIn('local_behavior',manifest)

    def test_rejects_modified_capture_and_modified_asset(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(module,'ROOT',pathlib.Path(tmp)):
            root=pathlib.Path(tmp);source,digest=self.fixture(root);original=(source/'page.html').read_bytes();(source/'page.html').write_bytes(original+b'changed')
            with self.assertRaisesRegex(ValueError,'HTML capture hash'):module.build()
            (source/'page.html').write_bytes(original);(source/'assets'/digest).write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'Asset hash'):module.build()
    def test_municipal_links_respect_captured_base_and_only_local_controls_execute(self):
        parser=module.Snapshot('https://www.swepsonvillenc.com/faq/index.php',{'https://www.swepsonvillenc.com/logo.png':'/local-logo'},capture='town-faq',heading=None,routes={'https://www.swepsonvillenc.com/index.php':'/','https://swepsonville.authoritypay.com':'/site'})
        parser.feed('''<html><head><base href="https://www.swepsonvillenc.com/"><script src="https://tracking.test/run.js"></script></head><body><a href="index.php" target="_blank">Home</a><a href="https://swepsonville.authoritypay.com/">Pay</a><img src="data:," data-src="logo.png"><input id="faq-filter"><input name="bank"><button data-controls="next">Next</button><form action="https://production.test/charge"><button>Submit</button></form></body></html>''');parser.close();page=''.join(parser.output)
        self.assertIn('href="/"',page);self.assertIn('href="/site"',page);self.assertIn('src="/local-logo"',page);self.assertNotIn('target=',page);self.assertNotIn('<form',page);self.assertNotIn('production.test',page);self.assertNotIn('tracking.test',page);self.assertIn('<input id="faq-filter">',page);self.assertIn('<input disabled>',page);self.assertIn('<button data-controls="next">',page);self.assertIn('<button disabled>Submit',page);self.assertEqual(page.count('<script'),1);self.assertIn('src="/municipal.js"',page)
    def test_unsupported_municipal_destination_cannot_be_used_as_a_billing_link(self):
        parser=module.Snapshot('https://www.swepsonvillenc.com/',{},capture='town',routes={'https://swepsonville.authoritypay.com':'/site'})
        parser.feed('<a href="https://swepsonville.authoritypay.com/evil">Other</a><div style="background:url(https://production.test/pixel)"></div>');page=''.join(parser.output)
        self.assertIn('aria-disabled="true"',page);self.assertNotIn('href=',page);self.assertIn('data:,',''.join(parser.styles));self.assertIn('https://production.test/pixel',parser.missing)

    def test_rejects_loading_capture_even_when_its_html_hash_matches(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(module,'ROOT',pathlib.Path(tmp)):
            root=pathlib.Path(tmp);self.fixture(root);manifest=root/'research/gvp-public.json';data=json.loads(manifest.read_text());data['pages'][0]['contentStatus']='application_not_ready';manifest.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError,'not a usable'):module.build()
            self.assertFalse((root/'public/reference-pages/gvp-home').exists())
    def test_nonmunicipal_reconstruction_does_not_inherit_municipal_behavior(self):
        parser=module.Snapshot('https://wvumedicine.org/',{},capture='medical',heading=None,routes={'https://wvumedicine.org/billing':'/billing'},behavior_script=None)
        parser.feed('<html><body><script src="https://production.test/app.js"></script><a href="/billing">Pay</a></body></html>');parser.close();page=''.join(parser.output)
        self.assertIn('href="/billing"',page);self.assertNotIn('<script',page);self.assertNotIn('municipal.js',page)

    def test_captured_css_imports_remain_local_and_missing_imports_are_removed(self):
        parser=module.Snapshot('https://source.test/',{'https://source.test/css/theme.css':'/reference-pages/example/theme','https://source.test/My%20Image.png':'/reference-pages/example/image'},capture='example')
        css=parser.css('@import "./theme.css" screen; @import url("https://missing.test/theme.css"); .hero{background:url("../My Image.png")}', 'https://source.test/css/main.css')
        self.assertIn('@import url("/reference-pages/example/theme") screen;',css);self.assertNotIn('missing.test',css);self.assertIn('url("/reference-pages/example/image")',css)

    def test_minified_css_imports_with_semicolons_are_localized_or_removed(self):
        url='https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&display=swap'
        for prefix in ['@import', '@IMPORT ', '@import\n']:
            parser=module.Snapshot('https://source.test/', {url:'/reference-pages/fonts'})
            css=parser.css(prefix+'"'+url+'";body{color:red}')
            self.assertEqual(css, '@import url("/reference-pages/fonts");body{color:red}')
            missing=module.Snapshot('https://source.test/', {})
            self.assertEqual(missing.css(prefix+'"'+url+'";body{color:red}'), 'body{color:red}')
            self.assertIn(url, missing.missing)

    def test_inline_stylesheets_keep_their_cascade_positions(self):
        parser=module.Snapshot('https://source.test/',{'https://source.test/theme.css':'/local-theme'},capture='cascade',behavior_script=None)
        parser.feed('<head><style>.label{color:red}</style><link rel="stylesheet" href="/theme.css"><style>.label{color:blue}</style></head>');parser.close()
        page=''.join(parser.output);red=hashlib.sha256(b'.label{color:red}').hexdigest();blue=hashlib.sha256(b'.label{color:blue}').hexdigest()
        self.assertLess(page.index(red),page.index('/local-theme'));self.assertLess(page.index('/local-theme'),page.index(blue));self.assertEqual(parser.styles,[]);self.assertEqual(parser.stylesheets[red],b'.label{color:red}')

    def test_svg_symbol_fragments_resolve_to_captured_sprite_without_navigation(self):
        parser=module.Snapshot('https://source.test/',{'https://source.test/library.svg':'/reference-pages/sprite','https://source.test/library.svg#globe':'/reference-pages/sprite'},routes={},behavior_script=None)
        parser.feed('<svg><use xlink:href="/library.svg#globe"></use><use href="/library.svg#arrow"></use><use href="#inline"></use><use href="https://missing.test/library.svg#missing"></use></svg>')
        page=''.join(parser.output)
        self.assertIn('xlink:href="/reference-pages/sprite#globe"',page);self.assertIn('href="/reference-pages/sprite#arrow"',page);self.assertIn('href="#inline"',page);self.assertNotIn('missing.test',page);self.assertIn('data:,',page)
