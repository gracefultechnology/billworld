#!/usr/bin/env python3
"""Build an inert, local public-page reconstruction from hash-verified captures.
Original scripts never execute. Unsupported navigation remains visibly disabled.
"""
import argparse, hashlib, html, json, pathlib, re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, unquote, quote, urldefrag
ROOT = pathlib.Path(__file__).resolve().parent
VOID = set('area base br col embed hr img input link meta param source track wbr'.split())
DROP = set('script iframe object embed base noscript'.split())

class Snapshot(HTMLParser):
    def __init__(self, base, asset_urls, capture='gvp-home', heading='Grand Valley Power', routes=None, behavior_script='municipal.js', public_controls=False):
        super().__init__(convert_charrefs=False)
        self.base=base; self.asset_urls=asset_urls; self.output=[]; self.styles=[]; self.stylesheets={}; self.suppressed=[]; self.style_depth=False; self.style_text=[]; self.unsupported=set(); self.missing=set()
        self.capture=capture; self.heading=heading; self.routes=routes
        self.behavior_script=behavior_script
        self.public_controls=public_controls
    def resource(self, value, base=None):
        if value.startswith(('data:','#')): return value
        if value in self.asset_urls.values():return value
        target=quote(urljoin(base or self.base, value),safe=":/?#[]@!$&'()*+,;=%")
        base_target,fragment=urldefrag(target)
        if fragment and base_target in self.asset_urls:return self.asset_urls[base_target]+'#'+fragment
        if target in self.asset_urls:return self.asset_urls[target]
        self.missing.add(target);return 'data:,'
    def css(self, text, base=None):
        def imported(m):
            value=(m[1] or m[3]).strip().strip('\"\'')
            local=self.resource(value,base)
            return '' if local.startswith('data:') else '@import url("'+local+'")'+m[4]+';'
        text=re.sub(r'@import\s*(?:url\(([^)]*)\)|([\"\'])(.*?)\2)([^;]*);', imported, text, flags=re.I)
        return re.sub(r'url\(\s*([\"\']?)(.*?)\1\s*\)',lambda m:'url("'+self.resource(m[2],base)+'")',text,flags=re.I)
    def navigation(self, value):
        if value.startswith('#'):return value
        target=urljoin(self.base,value)
        if self.routes is not None:
            local=self.routes.get(unquote(target).rstrip('/'))
            if local:return local
            self.unsupported.add(target);return None
        u=urlsplit(urljoin(self.base,value))
        if u.hostname=='gvp.smarthub.coop' and u.path.rstrip('/') in ('/ui','/Login.html'):
            return '/smarthub/ui/#/'+(u.fragment.removeprefix('/') or 'login')
        if u.hostname in ('www.gvp.org','gvp.org') and u.path in ('/','/ways-pay','/SmartHub','/paperless'):return u.path
        self.unsupported.add(urljoin(self.base,value));return None
    def handle_starttag(self, tag, attrs):
        if self.suppressed:
            if tag not in VOID:self.suppressed.append(tag)
            return
        if tag in DROP:
            if tag=='base':
                value=dict(attrs).get('href')
                if value:self.base=urljoin(self.base,value)
            if tag not in VOID:self.suppressed.append(tag)
            return
        if tag=='style':self.style_depth=True;self.style_text=[];return
        values=dict(attrs)
        if tag=='img' and values.get('data-src'):
            values['src']=values['data-src']
        if tag=='img':
            values['loading']='eager'
            # Browsers may fetch only a responsive candidate, not the src fallback.
            source=quote(urljoin(self.base,values.get('src','')),safe=":/?#[]@!$&'()*+,;=%")
            if source not in self.asset_urls and not values.get('src','').startswith('data:'):
                for candidate in (values.get('srcset') or '').split(','):
                    parts=candidate.strip().split()
                    if parts and quote(urljoin(self.base,parts[0]),safe=":/?#[]@!$&'()*+,;=%") in self.asset_urls:
                        values['src']=parts[0];break
        if tag=='meta' and any(k in values for k in ('http-equiv','content')):return
        if tag=='link' and values.get('rel') not in ('stylesheet','icon'):return
        if tag=='form':tag='div';values={'class':values.get('class','')+' captured-form'}
        styles=values.pop('style',None)
        if styles:
            # Inline declarations outrank ordinary source selectors. A plain class
            # loses to Angular's scoped two-part selectors (e.g. modal opacity).
            name='snapshot-inline-'+str(len(self.styles));self.styles.append(':is(#billworld-inline-priority#billworld-inline-priority-2, .'+name+'){'+self.css(styles)+'}');values['class']=values.get('class','')+' '+name
        kept=[]
        for key,value in values.items():
            if key.startswith('on') or key in ('action','formaction','integrity','crossorigin','srcset','ping','nonce','target','data-src','data-style'):continue
            if key=='href':
                value=self.resource(value) if tag in ('link','use') else self.navigation(value)
                if value is None:kept.extend([('aria-disabled','true'),('title','This destination is not yet available in Billworld')]);continue
            if key in ('src','poster'):
                value=self.resource(value)
                if tag=='img' and value=='data:,':value='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E'
            if tag=='use' and key=='xlink:href':value=self.resource(value)
            if tag in ('input','button','select','textarea') and key=='name':continue
            kept.append((key,value))
        interactive=self.routes is not None and (values.get('id')=='faq-filter' or (tag=='button' and values.get('data-controls') in ('prev','next')))
        if self.public_controls:interactive=tag=='button' and values.get('data-toggle')=='collapse' and bool(re.fullmatch(r'#[a-zA-Z][\w-]*',values.get('data-target','')))
        if tag in ('input','button','select','textarea') and not interactive:kept.append(('disabled',None))
        self.output.append('<'+tag+''.join(' '+k+(('="'+html.escape(v,quote=True)+'"') if v is not None else '') for k,v in kept)+'>')
        if tag=='body' and self.heading:self.output.append('<h1 class="snapshot-heading">'+html.escape(self.heading)+'</h1>')
    def handle_endtag(self, tag):
        if self.suppressed:
            if tag==self.suppressed[-1]:self.suppressed.pop()
            return
        if tag=='style':
            self.style_depth=False
            raw=self.css(''.join(self.style_text)).encode()
            digest=hashlib.sha256(raw).hexdigest();self.stylesheets[digest]=raw
            self.output.append('<link rel="stylesheet" href="/reference-pages/'+self.capture+'/'+digest+'">')
            return
        if tag in DROP or tag in VOID:return
        if tag=='head':self.output.append('<link rel="stylesheet" href="/reference-pages/'+self.capture+'/reconstruction.css">')
        if tag=='body' and self.routes is not None and self.behavior_script:self.output.append('<script src="/'+self.behavior_script+'" defer></script>')
        self.output.append('</'+('div' if tag=='form' else tag)+'>')
    def handle_data(self, data):
        if self.suppressed:return
        if self.style_depth:self.style_text.append(data)
        else:self.output.append(data)
    def handle_entityref(self, name):self.handle_data('&'+name+';')
    def handle_charref(self, name):self.handle_data('&#'+name+';')
    def handle_decl(self, decl):self.output.append('<!'+decl+'>')

def build(capture='gvp-home', manifest_path=None):
    if not re.fullmatch(r'(?:gvp-home|biller_[a-f0-9]{20}-[a-zA-Z0-9_-]+)',capture):raise ValueError('Invalid public capture ID')
    source=ROOT/'captures'/capture
    municipal=capture.startswith('biller_a46a4680fecf8553bc8a-')
    wvu=capture.startswith('biller_e8f5dad7794eeb4e8b7f-')
    dental=capture.startswith('biller_3af3809e3e5a5bc0b943-')
    lockwood=capture.startswith('biller_182c5bcdeb2841397831-')
    onswc=capture.startswith('biller_f8c0443c690b342b429a-')
    catalog=capture.startswith('biller_') and not any((municipal,wvu,dental,lockwood))
    manifest_path=pathlib.Path(manifest_path) if manifest_path else ROOT/'captures'/(capture[:27]+'-manifest.json') if catalog else ROOT/'research'/('lockwood-public.json' if lockwood else 'western-dental-public.json' if dental else 'wvu-public.json' if wvu else 'swepsonville-public.json' if municipal else 'gvp-public.json')
    research_manifest=json.loads(manifest_path.read_text())
    record=next(p for p in research_manifest['pages'] if p['id']==capture)
    if record.get('contentStatus')!='captured_requires_review':raise ValueError('Capture is not a usable public UI reference')
    content=(source/'page.html').read_bytes()
    if hashlib.sha256(content).hexdigest()!=record['htmlSha256']:raise ValueError('HTML capture hash mismatch')
    assets=[a for a in json.loads((source/'assets.json').read_text()) if (a['resourceType'] in ('stylesheet','image','font') or a['resourceType']=='other' and a.get('contentType','').split(';')[0]=='image/svg+xml') and a.get('bytes')!=0]
    output=ROOT/'public/reference-pages'/capture;output.mkdir(parents=True,exist_ok=True)
    mapping={a['url']:'/reference-pages/'+capture+'/'+a['sha256'] for a in assets}
    for a in assets:
        if a.get('contentType','').split(';')[0]=='image/svg+xml':mapping[urldefrag(a['url'])[0]]='/reference-pages/'+capture+'/'+a['sha256']
    if municipal:
        # Resolve only redirect aliases whose original requests were captured.
        requests={r['url'] for r in json.loads((source/'network.json').read_text()) if r['status'] in (301,302,307,308)}
        for a in assets:
            for prefix,replacement in [('https://cms7files1.revize.com/swepsonvillenc/','https://www.swepsonvillenc.com/'),('https://cdn1-global.revize.com/','https://www.swepsonvillenc.com/revize/')]:
                if a['url'].startswith(prefix):
                    alias=replacement+a['url'][len(prefix):]
                    if alias in requests:mapping[alias]=mapping[a['url']]
    routes=None;heading='Grand Valley Power'
    documents=[]
    if catalog:
        heading=None;routes={}
        for page in research_manifest['pages']:
            if page.get('contentStatus')!='captured_requires_review':continue
            if not re.fullmatch(re.escape(capture[:27])+r'-[a-zA-Z0-9_-]+',page['id']):raise ValueError('Catalog capture association mismatch')
            for alias in (page['requestedUrl'],page['finalUrl']):routes[unquote(alias).rstrip('/')]= '/reference-pages/'+page['id']+'/index.html'
        for doc in research_manifest.get('documents',[]):
            path=(ROOT/'captures'/doc['file']).resolve()
            if not path.is_relative_to((ROOT/'captures').resolve()):raise ValueError('Document path escapes captures')
            raw=path.read_bytes()
            if not raw.startswith(b'%PDF') or hashlib.sha256(raw).hexdigest()!=doc['sha256']:raise ValueError('Document hash or format mismatch')
            routes[unquote(doc['url']).rstrip('/')]= '/reference-pages/'+capture+'/'+doc['sha256']
            documents.append((doc,raw))
    if lockwood:
        # This tenant remains construction-only. Link reviewed captures to one
        # another without suggesting that the disabled source forms work.
        heading=None;routes={}
        for page in research_manifest['pages']:
            if page.get('contentStatus')!='captured_requires_review':continue
            target='/reference-pages/'+page['id']+'/index.html'
            for alias in (page['requestedUrl'],page['finalUrl']):routes[unquote(alias).rstrip('/')]=target
        routes['https://lockwoodmo.epayub.com/Account/Login']='/reference-pages/biller_182c5bcdeb2841397831-links-pay_bill/index.html'
    if dental:
        heading=None
        local={'en-us':'/','en-us/insurance-financing':'/insurance-financing','en-us/insurance-financing/financing-options':'/financing-options','en-us/terms-and-conditions':'/terms','en-us/privacy-policy':'/privacy','en-us/about-us/contact-us':'/contact'}
        routes={'https://www.westerndental.com/'+path:value for path,value in local.items()}
        routes['https://www.personapay.com/western-dental/login']='/personapay/login'
    if municipal:
        local={'':'/','index.php':'/','departments/utilities/index.php':'/utilities','faq/index.php':'/faq'}
        routes={unquote('https://'+host+'/'+path).rstrip('/'):value for host in ('www.swepsonvillenc.com','swepsonvillenc.com') for path,value in local.items()}
        routes.update({'https://swepsonville.authoritypay.com':'/site','https://form.jotform.com/SwepsNC/bank-draft-form':'/bank-draft'})
        for doc in json.loads((ROOT/'research/swepsonville-documents.json').read_text())['documents']:
            routes[unquote(doc['url']).rstrip('/')]='/reference-assets/'+doc['file']
            # FAQ links use the observed Revize file origin for these same PDFs.
            alias=doc['url'].replace('https://www.swepsonvillenc.com/','https://cms7files1.revize.com/swepsonvillenc/')
            if unquote(alias) in unquote(content.decode('utf-8')):
                routes[unquote(alias).rstrip('/')]='/reference-assets/'+doc['file']
        heading='Town of Swepsonville' if capture.endswith('-home') else 'Utilities' if capture.endswith('-utilities') else None
    if wvu:
        heading=None
        local={'':'/','billing-and-insurance/pay-a-bill':'/billing','billing-and-insurance/pay-a-bill/billing-faq':'/billing/faq','billing-and-insurance/pay-a-bill/understanding-billing':'/billing/understanding','billing-and-insurance/financial-assistance':'/billing/assistance'}
        routes={'https://'+host+'/'+path:value for host in ('wvumedicine.org','www.wvumedicine.org') for path,value in local.items()}
        # Snapshot.navigation strips trailing slash from fully resolved URLs.
        routes={key.rstrip('/'):value for key,value in routes.items()}
        routes.update({'https://mywvuchart.com/MyChart':'/MyChart/Authentication/Login','https://mywvuchart.com/MyChart/Authentication/Login':'/MyChart/Authentication/Login','https://mywvuchart.com/MyChart/app/activation':'/MyChart/app/activation','https://mywvuchart.com/MyChart/billing/guestpay':'/MyChart/billing/guestpay','https://mywvuchart.com/MyChart//billing/guestpay':'/MyChart/billing/guestpay','https://mywvuchart.com/MyChart/Authentication/Login/StandardFile?option=Faq':'/MyChart/help'})
        for doc in json.loads((ROOT/'research/wvu-documents.json').read_text())['documents']:
            raw=(ROOT/'public/reference-assets'/doc['file']).read_bytes()
            if hashlib.sha256(raw).hexdigest()!=doc['sha256']:raise ValueError('WVU document hash mismatch')
            routes[unquote(doc['url']).rstrip('/')]='/reference-assets/'+doc['file']
        routes.update({'https://mywvuchart.com/MyChart/app/account-recovery/recovery-choice':'/MyChart/app/account-recovery/recovery-choice','https://mywvuchart.com/MyChart/app/account-recovery':'/MyChart/app/account-recovery'})
    recovery=wvu and capture.endswith(('-recovery-choice','-recovery-options'))
    activation=wvu and capture.endswith('-activation')
    mychart=wvu and capture.endswith(('-guest','-login'))
    parser=Snapshot(record['finalUrl'],mapping,capture,heading,routes,behavior_script='onswc-public.js' if onswc else 'catalog-public.js' if catalog else None if dental or lockwood else 'mychart-recovery.js' if recovery else 'mychart-activation.js' if activation else 'mychart.js' if mychart else 'wvu-public.js' if wvu else 'municipal.js',public_controls=catalog);files={}
    for doc,raw in documents:
        (output/doc['sha256']).write_bytes(raw);files[doc['sha256']]={'sha256':doc['sha256'],'contentType':'application/pdf','source_url':doc['url'],'evidence_type':'documented_public'}
    base_match=re.search(r'<base\s+href=[\"\']([^\"\']+)',content.decode('utf-8'),re.I)
    if base_match:parser.base=urljoin(record['finalUrl'],base_match[1])
    for a in assets:
        path=(source/a['file']).resolve()
        if not path.is_relative_to(source.resolve()):raise ValueError('Asset path escape')
        raw=path.read_bytes()
        if hashlib.sha256(raw).hexdigest()!=a['sha256']:raise ValueError('Asset hash mismatch')
        if a['resourceType']=='stylesheet':raw=parser.css(raw.decode('utf-8',errors='replace'),a['url']).encode()
        (output/a['sha256']).write_bytes(raw);files[a['sha256']]={'sha256':hashlib.sha256(raw).hexdigest(),'contentType':a['contentType'],'source_sha256':a['sha256'],'source_url':a['url']}
    markup=content.decode('utf-8')
    if lockwood:
        # The consent component renders through a shadow root in production.
        # Its captured attributes retain the labels, but page.content() does
        # not serialize its internal layout. Rebuild that visible shell only.
        def cookie_reference(match):
            labels=dict(re.findall(r'(btn-label-(?:accept|only-essential)-and-continue)="([^"]+)"',match[1]))
            buttons=''.join('<button type="button" disabled>'+html.escape(labels[key])+'</button>' for key in ('btn-label-only-essential-and-continue','btn-label-accept-and-continue') if key in labels)
            return '<div class="lockwood-cookie-reference">'+match[2]+'<div class="lockwood-cookie-buttons">'+buttons+'</div></div>'
        markup=re.sub(r'<cookie-consent-banner\b([^>]*)>(.*?)</cookie-consent-banner>',cookie_reference,markup,flags=re.I|re.S)
    if record.get('inlineStylesSha256'):
        style_bytes=(source/'inline-styles.json').read_bytes()
        if hashlib.sha256(style_bytes).hexdigest()!=record['inlineStylesSha256']:raise ValueError('Captured inline CSSOM hash mismatch')
        styles={s['index']:s['css'] for s in json.loads(style_bytes) if 'css' in s}
        index=iter(range(len(re.findall(r'<style\b',markup,re.I))))
        def observed_style(match):
            ordinal=next(index)
            return match[1]+styles.get(ordinal,match[2])+match[3]
        markup=re.sub(r'(<style\b[^>]*>)(.*?)(</style\s*>)',observed_style,markup,flags=re.I|re.S)
    parser.feed(markup);parser.close()
    for digest,raw in parser.stylesheets.items():
        (output/digest).write_bytes(raw);files[digest]={'sha256':digest,'contentType':'text/css','origin':'sanitized_inline_stylesheet'}
    css='\n'.join(parser.styles)+'\n.snapshot-heading{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}a[aria-disabled=true]{cursor:default} .mm-menu{display:none}\n'
    if municipal:css+='\n'+(ROOT/'public/municipal.css').read_text()
    if lockwood:css+='\n.lockwood-cookie-reference{position:fixed;bottom:15px;left:15px;right:15px;z-index:9999;background:#29302f;color:white;padding:14px 23px;font-size:14px;line-height:20px;box-shadow:0 1px 7px #777}.lockwood-cookie-reference a{color:white;text-decoration:underline}.lockwood-cookie-buttons{display:flex;justify-content:flex-end;gap:8px;margin-top:24px}.lockwood-cookie-buttons button{height:54px;padding:0 36px;border:1px solid white;background:transparent;color:white;font-weight:bold}.lockwood-cookie-buttons button:last-child{background:#49b54f;border-color:#49b54f}\n'
    if recovery:css+='\n'+(ROOT/'public/mychart-recovery.css').read_text()
    if activation:css+='\n'+(ROOT/'public/mychart-activation.css').read_text()
    elif mychart:css+='\n'+(ROOT/'public/mychart.css').read_text()
    elif wvu:css+='\n'+(ROOT/'public/wvu-public.css').read_text()
    for name,raw,mime in [('index.html',''.join(parser.output).encode(),'text/html'),('reconstruction.css',css.encode(),'text/css')]:
        (output/name).write_bytes(raw);files[name]={'sha256':hashlib.sha256(raw).hexdigest(),'contentType':mime}
    manifest={'source_inline_styles_sha256':record.get('inlineStylesSha256'),'source_html_sha256':record['htmlSha256'],'source_url':record['finalUrl'],'files':files,'missing_asset_urls':sorted(parser.missing),'unsupported_navigation':sorted(parser.unsupported),'policy':'static reconstruction; original scripts and form submission disabled; billing links target local flows; other destinations unfinished'}
    if municipal:
        manifest['local_behavior']={'file':'public/municipal.js','sha256':hashlib.sha256((ROOT/'public/municipal.js').read_bytes()).hexdigest(),'controls':['menu dropdowns','responsive quick-link carousel','FAQ expansion and text search'],'original_scripts_executed':False}
    if recovery:manifest['local_behavior']={'file':'public/mychart-recovery.js','sha256':hashlib.sha256((ROOT/'public/mychart-recovery.js').read_bytes()).hexdigest(),'controls':['captured recovery choice and enrolled contact entry','synthetic email-code verification and password reset'],'original_scripts_executed':False}
    elif activation:manifest['local_behavior']={'file':'public/mychart-activation.js','sha256':hashlib.sha256((ROOT/'public/mychart-activation.js').read_bytes()).hexdigest(),'controls':['two-part activation code','synthetic username/password setup'],'original_scripts_executed':False}
    elif wvu and not mychart and not recovery:manifest['local_behavior']={'file':'public/wvu-public.js','sha256':hashlib.sha256((ROOT/'public/wvu-public.js').read_bytes()).hexdigest(),'controls':['billing FAQ accordions','mobile menu and billing submenu'],'original_scripts_executed':False}
    if mychart:manifest['local_behavior']={'file':'public/mychart.js','sha256':hashlib.sha256((ROOT/'public/mychart.js').read_bytes()).hexdigest(),'controls':['guest lookup','visit selection','payment review and receipt','username/password login'],'original_scripts_executed':False}
    if catalog:
        manifest['local_behavior']={'file':'public/catalog-public.js','sha256':hashlib.sha256((ROOT/'public/catalog-public.js').read_bytes()).hexdigest(),'controls':['captured public collapse accordions'],'original_scripts_executed':False}
    if onswc:manifest['local_behavior']={'file':'public/onswc-public.js','sha256':hashlib.sha256((ROOT/'public/onswc-public.js').read_bytes()).hexdigest(),'controls':['one-open FAQ accordion','water and wastewater rate tabs'],'original_scripts_executed':False}
    if dental or lockwood or catalog:manifest['construction_stage']='inert_public_reconstruction_not_activated_runtime'
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return {'page':capture,'files':len(files),'missing_asset_urls':len(parser.missing),'unsupported_navigation':len(parser.unsupported),'manifest':str(output/'manifest.json')}
if __name__=='__main__':
    args=argparse.ArgumentParser();args.add_argument('--capture',default='gvp-home');args.add_argument('--manifest',type=pathlib.Path);value=args.parse_args();print(json.dumps(build(value.capture,value.manifest),indent=2))
