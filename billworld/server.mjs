import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { World, Fault, ENVIRONMENT_REVISION } from './engine.mjs';
import { MockGoogle } from './google.mjs';
import { SnapshotStore } from './snapshot-store.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const assets = new Map(['index.html', 'app.js', 'authoritypay.js','bank-draft.js','deposits.js','municipal.js','mychart.js','wvu-public.js','mychart-activation.js','mychart-recovery.js','personapay.js','personapay.css','paymentus.js','paymentus.css','paymentus.html','cusi.js','cusi.css', 'authoritypay.css', 'spotify.js', 'smarthub.js', 'smarthub.css', 'xpress.js', 'xpress.css', 'duluth.js', 'duluth.css', 'style.css', 'google.html', 'google.js'].map(name => [name, readFileSync(`${root}/public/${name}`)]));
assets.set('starnik.css',readFileSync(`${root}/public/starnik.css`));
assets.set('starnik.js',readFileSync(`${root}/public/starnik.js`));
assets.set('catalog-public.js',readFileSync(`${root}/public/catalog-public.js`));
const publicSnapshots = new SnapshotStore(`${root}/public/reference-pages`, {verifyBehavior(manifest){
  if (manifest.local_behavior && (!['public/municipal.js','public/mychart.js','public/wvu-public.js','public/mychart-activation.js','public/mychart-recovery.js','public/catalog-public.js'].includes(manifest.local_behavior.file) || createHash('sha256').update(assets.get(manifest.local_behavior.file.split('/').at(-1))).digest('hex') !== manifest.local_behavior.sha256)) throw Error('Public snapshot behavior hash mismatch');
}});
if (existsSync(`${root}/public/reference-assets/juneau-logo.png`)) assets.set('juneau-logo.png', readFileSync(`${root}/public/reference-assets/juneau-logo.png`));
for (const name of ['index.html', 'bridge.js', 'css/styles.css', 'js/data.js', 'js/state.js', 'js/components.js', 'js/views.js', 'js/app.js']) {
  const path = `${root}/public/gmail/${name}`;
  if (existsSync(path)) assets.set(`gmail/${name}`, readFileSync(path));
}
if (existsSync(`${root}/public/reference-assets/avec-logo.png`)) assets.set('avec-logo.png', readFileSync(`${root}/public/reference-assets/avec-logo.png`));
if (existsSync(`${root}/public/reference-assets/avec-background.jpg`)) assets.set('avec-background.jpg', readFileSync(`${root}/public/reference-assets/avec-background.jpg`));
for (const name of ['gvp-logo.png','gvp-background.png','xpress-logo.svg', 'homer-logo.png', 'xpress-background.jpg', 'duluth-logo.jpg', 'duluth-banner.jpg', 'duluth-identity.webp', 'duluth-google.svg', 'duluth-apple.svg', 'duluth-microsoft.svg', 'duluth-facebook.svg','ml-logo.png','ml-water.jpg','ml-karla.woff2','ml-lora.woff2','sweps-invoicecloud.png','sweps-draft-logo.png','sweps-visa.gif','sweps-mastercard.gif','sweps-amex.gif','sweps-discover.gif','sweps-bank.png','swepsonville-fees-2026-2027.pdf','swepsonville-water-policy.pdf']) if (existsSync(`${root}/public/reference-assets/${name}`)) assets.set(name, readFileSync(`${root}/public/reference-assets/${name}`));
const referenceDocuments = new Map();
for (const document of JSON.parse(readFileSync(`${root}/research/wvu-documents.json`, 'utf8')).documents) {
  if (!/^wvu-[a-z-]+\.pdf$/.test(document.file)) throw Error('Invalid reference document filename');
  const content = readFileSync(`${root}/public/reference-assets/${document.file}`);
  if (createHash('sha256').update(content).digest('hex') !== document.sha256) throw Error('Reference document hash mismatch');
  referenceDocuments.set(`/reference-assets/${document.file}`, content);
}
export const auditPublicSnapshots = () => publicSnapshots.audit();
const parseCookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim().split('=')).filter(v => v.length === 2));
const cookie = (name, value, maxAge = 3600) => `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
function json(res, data, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function body(req) {
  let data = ''; for await (const chunk of req) { data += chunk; if (data.length > 16384) throw new Fault('Request too large', 413); }
  try { return JSON.parse(data || '{}'); } catch { throw new Fault('Invalid JSON'); }
}
function isToken(actual, expected) { return typeof actual === 'string' && actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected)); }

export async function start({ port = 3100, adminPort = 3101, googlePort = 0, dbPath = `${root}/data/world.sqlite`, adminToken = randomBytes(32).toString('base64url'), compatibilityReady = false, construction = false } = {}) {
  const world = new World(dbPath,{construction});
  world.expireTrials();
  const deadlineMonitor = setInterval(() => { try { world.expireTrials(); } catch (error) { console.error('Trial deadline monitor failed:', error.message); } }, 1000);
  deadlineMonitor.unref();
  const google = new MockGoogle(world);
  const publicServer = http.createServer(async (req, res) => {
    try {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'");
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET' && url.pathname === '/health') return json(res, { status: 'ok', version: ENVIRONMENT_REVISION });
      // Infinity polls this route on agent setup. No private state is exposed.
      if (compatibilityReady && req.method === 'GET' && url.pathname === '/api/state') return json(res, { ready: true });
      if (req.method === 'GET' && (url.pathname === '/mail' || url.pathname.startsWith('/gmail/'))) {
        const name = url.pathname === '/mail' ? 'gmail/index.html' : url.pathname.slice(1);
        if (!assets.has(name)) throw new Fault('Mailbox asset not found', 404);
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'");
        res.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', 'Cache-Control': 'no-store' });
        return res.end(assets.get(name));
      }
      const entry = url.pathname.match(/^\/enter\/([^/]+)\/([^/]+)$/);
      if (entry && req.method === 'GET') {
        world.enter(entry[1], entry[2]);
        res.writeHead(302, { Location: '/', 'Set-Cookie': [cookie('bw_episode', entry[1]), cookie('bw_access', entry[2]), cookie('bw_session', '', 0), cookie('bw_mail', '', 0), cookie('bw_lookup', '', 0),cookie('bw_paymentus_link','',0),cookie('bw_paymentus_reset','',0),cookie('bw_paymentus_quote','',0),cookie('bw_starnik_quote','',0),cookie('bw_starnik_guest','',0),cookie('bw_starnik_pending','',0),cookie('bw_starnik_signup','',0),cookie('bw_starnik_reset','',0),cookie('bw_paymentus_autopay','',0),cookie('bw_cusi_registration','',0),cookie('bw_cusi_reset','',0),cookie('bw_cusi_quote','',0)] }); return res.end();
      }
      if (url.pathname.startsWith('/connector/')) {
        const id = req.headers['x-billworld-episode'];
        const token = (req.headers.authorization || '').replace(/^Bearer /, '');
        world.connector(id, token);
        if (req.method === 'GET' && url.pathname === '/connector/messages') return json(res, { messages: world.messages(id, token, url.searchParams.get('q') || '') });
        if (req.method === 'GET' && url.pathname === '/connector/message') return json(res, { message: world.message(id, token, url.searchParams.get('id')) });
        if (req.method === 'GET' && url.pathname === '/connector/attachment') return json(res, { attachment: world.attachment(id, token, url.searchParams.get('messageId'), url.searchParams.get('attachmentId')) });
        if (req.method === 'GET' && url.pathname === '/connector/thread') return json(res, { messages: world.thread(id, token, url.searchParams.get('id')) });
        if (req.method === 'POST' && url.pathname === '/connector/mark-read') return json(res, world.markRead(id, token, (await body(req)).id));
        if (req.method === 'POST' && url.pathname === '/connector/messages/update') { const input = await body(req); return json(res, world.updateMessage(id, token, input.id, input.changes)); }
        throw new Fault('Connector operation not found', 404);
      }
      const c = parseCookies(req);
      if (req.method === 'GET' && url.pathname === '/auth/google/callback') {
        const identityDestination=world.session(c.bw_episode,null).site.id==='duluth-comfortsystems'?'/utility/account':'/spotify/account';
        world.enter(c.bw_episode, c.bw_access);
        if (url.searchParams.get('error') === 'access_denied') {
          if (url.searchParams.get('state') !== c.bw_oauth) throw new Fault('OAuth state mismatch', 403);
          res.writeHead(302, { Location: identityDestination==='/utility/account'?'/identity/login?error=access_denied':'/spotify/login?error=access_denied', 'Set-Cookie': cookie('bw_oauth', '', 0) }); return res.end();
        }
        const result = google.complete(c.bw_episode, c.bw_oauth, Object.fromEntries(url.searchParams));
        res.writeHead(302, { Location: identityDestination, 'Set-Cookie': [cookie('bw_session', result.session), cookie('bw_oauth', '', 0)] }); return res.end();
      }
      if (url.pathname.startsWith('/api/')) {
        world.enter(c.bw_episode, c.bw_access);
        if (req.method === 'POST' && req.headers.origin !== `http://${req.headers.host}`) throw new Fault('Same-origin request required', 403);
        const id = c.bw_episode, session = c.bw_session;
        const starnikSite=world.session(id,null).site.runtime.kind==='starnik';
        if(url.pathname.startsWith('/api/starnik/')&&!starnikSite)throw new Fault('Starnik operation unavailable',404);
        if(starnikSite&&!url.pathname.startsWith('/api/mail')&&!['/api/session','/api/starnik/guest/quote','/api/starnik/guest/review','/api/starnik/guest/pay','/api/starnik/guest/receipt','/api/starnik/guest/lookup','/api/starnik/guest/account','/api/starnik/login','/api/starnik/logout','/api/starnik/account','/api/starnik/recovery/request','/api/starnik/recovery/grant','/api/starnik/recovery/complete','/api/starnik/signup/request','/api/starnik/signup/resend','/api/starnik/signup/grant','/api/starnik/signup/username','/api/starnik/signup/complete'].includes(url.pathname))throw new Fault('This operation is not implemented for the Starnik construction slice',404);
        const cusiSite=world.session(id,null).site.runtime.kind==='cusi';
        const paymentusSite=world.session(id,null).site.runtime.kind==='paymentus';
        if(url.pathname.startsWith('/api/paymentus/')&&!paymentusSite)throw new Fault('Paymentus operation unavailable',404);
        if(paymentusSite&&!url.pathname.startsWith('/api/mail')&&!['/api/session','/api/login','/api/logout','/api/reset/request','/api/paymentus/register','/api/paymentus/link/verify','/api/paymentus/link/review','/api/paymentus/link/add','/api/paymentus/link/receipt','/api/paymentus/account','/api/paymentus/autopay','/api/paymentus/autopay/quote','/api/paymentus/autopay/review','/api/paymentus/autopay/confirm','/api/paymentus/wallet','/api/paymentus/wallet/save','/api/paymentus/wallet/edit','/api/paymentus/wallet/remove','/api/paymentus/preferences','/api/paymentus/bills','/api/paymentus/history','/api/paymentus/bill-history','/api/paymentus/statement','/api/paymentus/quote','/api/paymentus/review','/api/paymentus/pay','/api/paymentus/receipt','/api/paymentus/recovery/grant','/api/paymentus/recovery/complete'].includes(url.pathname))throw new Fault('This operation is not implemented for the Paymentus construction slice',404);
        if(url.pathname.startsWith('/api/cusi/')&&!cusiSite)throw new Fault('CUSI operation unavailable',404);
        if(cusiSite&&!url.pathname.startsWith('/api/cusi/')&&!url.pathname.startsWith('/api/mail')&&url.pathname!=='/api/session')throw new Fault('This operation is not implemented for the CUSI construction slice',404);
        if(url.pathname.startsWith('/api/mychart/')&&world.session(id,null).site.runtime.kind!=='medical')throw new Fault('Medical operation unavailable',404);
        if(url.pathname.startsWith('/api/personapay/')&&world.session(id,null).site.runtime.kind!=='personapay')throw new Fault('PersonaPay operation unavailable',404);
        if(session&&!url.pathname.startsWith('/api/mail')&&url.pathname!=='/api/session')world.medicalActivity(id,session);
        if (req.method === 'GET') {
          if(['/api/starnik/guest/review','/api/starnik/guest/receipt'].includes(url.pathname))return json(res,world.starnikGuestReview(id,c.bw_starnik_guest,c.bw_starnik_quote,url.pathname.endsWith('/receipt')));
          if(url.pathname==='/api/starnik/guest/account')return json(res,world.starnikGuestAccount(id,c.bw_starnik_guest));
          if(url.pathname==='/api/starnik/signup/grant')return json(res,world.starnikRegistrationGrant(id,c.bw_starnik_signup));
          if(url.pathname==='/api/starnik/recovery/grant')return json(res,world.starnikRecoveryGrant(id,c.bw_starnik_reset));
          if(url.pathname==='/api/starnik/account')return json(res,world.starnikAccount(id,session));
          if(url.pathname==='/api/paymentus/link/review')return json(res,world.paymentusLinkReview(id,session,c.bw_paymentus_link));
          if(url.pathname==='/api/paymentus/link/receipt')return json(res,world.paymentusLinkReview(id,session,c.bw_paymentus_link,true));
          if(url.pathname==='/api/paymentus/preferences')return json(res,world.paymentusPreferences(id,session,url.searchParams.get('accountId')));
          if(url.pathname==='/api/paymentus/autopay')return json(res,world.paymentusAutoPay(id,session,url.searchParams.get('accountId')));
          if(url.pathname==='/api/paymentus/autopay/review')return json(res,world.paymentusAutoPayReview(id,session,c.bw_paymentus_autopay));
          if(url.pathname==='/api/paymentus/wallet')return json(res,world.paymentusWallet(id,session));
          if(url.pathname==='/api/paymentus/account')return json(res,world.paymentusAccount(id,session));
          if(url.pathname==='/api/paymentus/bills')return json(res,world.paymentusBills(id,session,url.searchParams.get('accountId')));
          if(url.pathname==='/api/paymentus/history')return json(res,world.paymentusHistory(id,session,url.searchParams.get('accountId')));
          if(url.pathname==='/api/paymentus/bill-history')return json(res,world.paymentusBillHistory(id,session,url.searchParams.get('accountId')));
          if(url.pathname==='/api/paymentus/statement'){
            const document=world.paymentusStatement(id,session,url.searchParams.get('invoiceId'));
            res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${document.filename}"`,'Content-Length':document.bytes.length,'Cache-Control':'no-store'});
            return res.end(document.bytes);
          }
          if(url.pathname==='/api/paymentus/review')return json(res,world.paymentusReview(id,session,c.bw_paymentus_quote));
          if(url.pathname==='/api/paymentus/receipt')return json(res,world.paymentusReview(id,session,c.bw_paymentus_quote,true));
          if(url.pathname==='/api/paymentus/recovery/grant')return json(res,world.paymentusRecoveryGrant(id,c.bw_paymentus_reset));
          if(url.pathname==='/api/cusi/account')return json(res,world.cusiAccount(id,session));
          if(url.pathname==='/api/cusi/bill')return json(res,world.cusiBill(id,session,url.searchParams.get('invoiceId')));
          if(url.pathname==='/api/cusi/review')return json(res,world.cusiReview(id,session,c.bw_cusi_quote));
          if(url.pathname==='/api/cusi/receipt')return json(res,world.cusiReview(id,session,c.bw_cusi_quote,true));
          if(url.pathname==='/api/cusi/registration/state')return json(res,world.cusiRegistrationState(id,c.bw_cusi_registration));
          if(url.pathname==='/api/cusi/recovery/grant')return json(res,world.cusiRecoveryGrant(id,c.bw_cusi_reset));
          if(url.pathname==='/api/personapay/status')return json(res,world.personaPayLoginStatus(id));
          if(url.pathname==='/api/personapay/plans')return json(res,{plans:world.personaPayPlans(id,session)});
          if(url.pathname==='/api/personapay/plans/review')return json(res,world.personaPayPlanReview(id,session,c.bw_dental_plan));
          if(url.pathname==='/api/personapay/statement')return json(res,world.personaPayStatement(id,session));
          if(url.pathname==='/api/personapay/review')return json(res,world.personaPayReview(id,session,c.bw_dental_quote));
          if(url.pathname==='/api/personapay/receipt')return json(res,world.personaPayReceipt(id,session,c.bw_dental_quote));
          if(url.pathname==='/api/mychart/recovery/status')return json(res,world.medicalRecoveryStatus(id,c.bw_medical_recovery_code,c.bw_medical_recovery_grant));
          if(url.pathname==='/api/mychart/activation/setup')return json(res,world.medicalActivationSetup(id,c.bw_medical_activation));
          if(url.pathname==='/api/mychart/guest')return json(res,world.smartGuestDashboard(id,c.bw_lookup));
          if(url.pathname==='/api/mychart/review')return json(res,world.medicalReview(id,session,c.bw_medical_quote));
          if(url.pathname==='/api/mychart/receipt')return json(res,world.medicalReceipt(id,c.bw_medical_quote));
          if (url.pathname === '/api/session') return json(res, world.session(id, session));
          if (['/api/authoritypay/guest', '/api/smarthub/guest', '/api/utility/guest'].includes(url.pathname)) return json(res, world.smartGuestDashboard(id, c.bw_lookup));
          if (url.pathname === '/api/dashboard') return json(res, world.dashboard(id, session));
          if (url.pathname === '/api/bank-draft/submission') return json(res,world.bankDraftReceipt(id,c.bw_draft));
          if (url.pathname === '/api/deposits/form') return json(res,world.depositForm(id,c.bw_deposit));
          if (url.pathname === '/api/deposits/review') return json(res,world.depositReview(id,c.bw_deposit_quote));
          if (url.pathname === '/api/deposits/receipt') return json(res,world.depositReceipt(id,c.bw_deposit_quote));
          if (url.pathname === '/api/invoices') return json(res, world.search(id, url.searchParams.get('customer'), session, url.searchParams.get('lookupToken')));
          if (url.pathname === '/api/mail/attachment') {
            const item=world.attachment(id,c.bw_mail,url.searchParams.get('messageId'),url.searchParams.get('attachmentId'));
            res.writeHead(200,{'Content-Type':item.mimeType,'Content-Length':item.sizeBytes,'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(item.name),'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
            return res.end(Buffer.from(item.dataBase64,'base64'));
          }
          if (url.pathname === '/api/mail') return json(res, { messages: world.messages(id, c.bw_mail, url.searchParams.get('q') || '') });
        }
        if (req.method === 'POST') {
          const input = await body(req); let result;
          if(url.pathname==='/api/starnik/login')result=world.starnikLogin(id,input);
          else if(url.pathname==='/api/starnik/guest/quote'){const r=world.starnikGuestQuote(id,c.bw_starnik_guest,input);res.setHeader('Set-Cookie',cookie('bw_starnik_quote',r.token,1500));const{token,...safe}=r;result=safe;}
          else if(url.pathname==='/api/starnik/guest/pay')result=world.starnikGuestPay(id,c.bw_starnik_guest,c.bw_starnik_quote,{authorize:input.authorize});
          else if(url.pathname==='/api/starnik/guest/lookup'){res.setHeader('Set-Cookie',cookie('bw_starnik_guest','',0));const r=world.starnikGuestLookup(id,input);res.setHeader('Set-Cookie',cookie('bw_starnik_guest',r.token,1500));result={verified:true,synthetic:true};}
          else if(['/api/starnik/signup/request','/api/starnik/signup/resend'].includes(url.pathname)){const r=url.pathname.endsWith('/resend')?world.starnikRegistrationResend(id,c.bw_starnik_pending):world.starnikRegistrationRequest(id,input);res.setHeader('Set-Cookie',[cookie('bw_starnik_pending',r.pendingToken,1800),cookie('bw_starnik_signup','',0)]);const{pendingToken,...safe}=r;result=safe;}
          else if(url.pathname==='/api/starnik/signup/username')result=world.starnikRegistrationUsername(id,c.bw_starnik_signup,input);
          else if(url.pathname==='/api/starnik/signup/complete')result=world.starnikRegistrationComplete(id,c.bw_starnik_signup,input);
          else if(url.pathname==='/api/starnik/recovery/request')result=world.starnikRecoveryRequest(id,input);
          else if(url.pathname==='/api/starnik/recovery/complete'){result=world.starnikRecoveryComplete(id,{...input,token:c.bw_starnik_reset});res.setHeader('Set-Cookie',[cookie('bw_starnik_reset','',0),cookie('bw_session','',0)]);}
          else if(url.pathname==='/api/starnik/logout'){result=world.logout(id,session);res.setHeader('Set-Cookie',cookie('bw_session','',0));}
          else if(url.pathname==='/api/paymentus/quote'){const r=world.paymentusQuote(id,session,input);res.setHeader('Set-Cookie',cookie('bw_paymentus_quote',r.token,600));const{token,...safe}=r;result=safe;}
          else if(url.pathname==='/api/paymentus/autopay/quote'){const r=world.paymentusAutoPayQuote(id,session,input);res.setHeader('Set-Cookie',cookie('bw_paymentus_autopay',r.token,600));const{token,...safe}=r;result=safe;}
          else if(url.pathname==='/api/paymentus/autopay/confirm')result=world.paymentusAutoPayConfirm(id,session,{token:c.bw_paymentus_autopay,authorize:input.authorize,acknowledgeCityDraft:input.acknowledgeCityDraft});
          else if(url.pathname.startsWith('/api/paymentus/wallet/'))result=world.wallet(id,session,url.pathname.slice('/api/paymentus/wallet/'.length),input);
          else if(url.pathname==='/api/paymentus/pay')result=world.paymentusPay(id,session,{token:c.bw_paymentus_quote,authorize:input.authorize});
          else if(url.pathname==='/api/paymentus/register')result=world.paymentusRegister(id,input);
          else if(url.pathname==='/api/paymentus/link/verify'){const r=world.paymentusLinkVerify(id,session,input);res.setHeader('Set-Cookie',cookie('bw_paymentus_link',r.token,1800));const{token,...safe}=r;result=safe;}
          else if(url.pathname==='/api/paymentus/link/add')result=world.paymentusLinkAdd(id,session,{...input,token:c.bw_paymentus_link});
          else if(url.pathname==='/api/paymentus/recovery/complete'){result=world.paymentusRecoveryComplete(id,{...input,token:c.bw_paymentus_reset});res.setHeader('Set-Cookie',[cookie('bw_paymentus_reset','',0),cookie('bw_session','',0)]);}
          else if(url.pathname==='/api/cusi/registration/lookup'){const r=world.cusiRegistrationLookup(id,input);res.setHeader('Set-Cookie',cookie('bw_cusi_registration',r.token,600));result={ok:true};}
          else if(url.pathname==='/api/cusi/registration/restart'){result=world.cusiRegistrationRestart(id,c.bw_cusi_registration);res.setHeader('Set-Cookie',cookie('bw_cusi_registration','',0));}
          else if(url.pathname==='/api/cusi/registration/confirm')result=world.cusiRegistrationConfirm(id,{...input,token:c.bw_cusi_registration});
          else if(url.pathname==='/api/cusi/registration/complete')result=world.cusiRegistrationComplete(id,{...input,token:c.bw_cusi_registration});
          else if(url.pathname==='/api/cusi/registration/recovery')result=world.cusiRegistrationRecovery(id,c.bw_cusi_registration);
          else if(url.pathname==='/api/cusi/login')result=world.cusiLogin(id,input);
          else if(url.pathname==='/api/cusi/quote'){const r=world.cusiQuote(id,session,input);res.setHeader('Set-Cookie',cookie('bw_cusi_quote',r.token,3600));const{token,...safe}=r;result=safe;}
          else if(url.pathname==='/api/cusi/pay')result=world.cusiPay(id,session,{token:c.bw_cusi_quote,authorize:input.authorize});
          else if(url.pathname==='/api/cusi/logout'){result=world.logout(id,session);res.setHeader('Set-Cookie',cookie('bw_session','',0));}
          else if(url.pathname==='/api/cusi/recovery/request')result=world.cusiRecoveryRequest(id,input);
          else if(url.pathname==='/api/cusi/recovery/complete'){result=world.cusiRecoveryComplete(id,{...input,token:c.bw_cusi_reset});res.setHeader('Set-Cookie',[cookie('bw_cusi_reset','',0),cookie('bw_session','',0)]);}
          else if(url.pathname==='/api/personapay/login')result=world.personaPayLogin(id,input);
          else if(url.pathname==='/api/personapay/plans/quote'){const r=world.personaPayPlanQuote(id,session,input);res.setHeader('Set-Cookie',cookie('bw_dental_plan',r.token,600));const {token,...safe}=r;result=safe;}
          else if(url.pathname==='/api/personapay/plans/enroll')result=world.personaPayPlanEnroll(id,session,{token:c.bw_dental_plan,authorize:input.authorize});
          else if(url.pathname==='/api/personapay/plans/cancel')result=world.personaPayPlanCancel(id,session,input);
          else if(url.pathname==='/api/personapay/quote'){const r=world.personaPayQuote(id,session,input);res.setHeader('Set-Cookie',cookie('bw_dental_quote',r.token,1800));const {token,...safe}=r;result=safe;}
          else if(url.pathname==='/api/personapay/pay')result=world.personaPayPay(id,session,{token:c.bw_dental_quote});
          else if(url.pathname==='/api/mychart/recovery/request'){const r=world.medicalRecoveryRequest(id,input);res.setHeader('Set-Cookie',[cookie('bw_medical_recovery_code',r.challengeToken,600),cookie('bw_medical_recovery_grant','',0)]);result={message:r.message};}
          else if(url.pathname==='/api/mychart/recovery/verify'){const r=world.medicalRecoveryVerify(id,c.bw_medical_recovery_code,input);res.setHeader('Set-Cookie',cookie('bw_medical_recovery_grant',r.grantToken,600));result={verified:true};}
          else if(url.pathname==='/api/mychart/recovery/complete'){result=world.medicalRecoveryComplete(id,c.bw_medical_recovery_grant,input);res.setHeader('Set-Cookie',[cookie('bw_medical_recovery_code','',0),cookie('bw_medical_recovery_grant','',0),cookie('bw_session','',0)]);}
          else if(url.pathname==='/api/mychart/activation/verify'){const r=world.medicalActivationVerify(id,input);res.setHeader('Set-Cookie',cookie('bw_medical_activation',r.setupToken,600));result={verified:true};}
          else if(url.pathname==='/api/mychart/activation/complete'){result=world.medicalActivationComplete(id,c.bw_medical_activation,input);res.setHeader('Set-Cookie',cookie('bw_medical_activation','',0));}
          else if(url.pathname==='/api/mychart/identity')result=world.medicalIdentityBegin(id,input);
          else if(url.pathname==='/api/mychart/lookup'){result=world.medicalLookup(id,input);res.setHeader('Set-Cookie',cookie('bw_lookup',result.lookupToken,900));}
          else if(url.pathname==='/api/mychart/quote'){result=world.quote(id,input.authenticated===true?session:null,{...input,lookupToken:c.bw_lookup});res.setHeader('Set-Cookie',cookie('bw_medical_quote',result.token,3600));const {token,...safe}=result;result=safe;}
          else if(url.pathname==='/api/mychart/pay'){result=world.pay(id,session,{token:c.bw_medical_quote});}
          else if (url.pathname === '/api/identity/begin') result=world.identityBegin(id,input);
          else if (url.pathname.startsWith('/api/wallet/')) result=world.wallet(id,session,url.pathname.slice('/api/wallet/'.length),input);
          else if (url.pathname === '/api/paperless') result=world.paperless(id,session,input);
          else if (url.pathname === '/api/login') result = world.login(id, input);
          else if (url.pathname === '/api/google/begin') { result = google.begin(id, `http://127.0.0.1:${publicServer.address().port}`); res.setHeader('Set-Cookie', cookie('bw_oauth', result.state, 600)); result = { authorizationUrl: result.authorizationUrl }; }
          else if (url.pathname === '/api/verify') result = world.verifyOtp(id, input);
          else if (['/api/authoritypay/lookup', '/api/smarthub/lookup', '/api/utility/lookup'].includes(url.pathname)) { result = world.smartLookup(id, input); if (result.lookupToken) res.setHeader('Set-Cookie', cookie('bw_lookup', result.lookupToken, 900)); }
          else if (url.pathname === '/api/smarthub/recover-email') result = world.recoverRegisteredEmail(id, input);
          else if (url.pathname === '/api/smarthub/change-password') result=world.changeFirstPassword(id,input);
          else if (url.pathname === '/api/register') result = world.register(id, input);
          else if (url.pathname === '/api/bank-draft/submit') { const draft=world.submitBankDraft(id,input);res.setHeader('Set-Cookie',cookie('bw_draft',draft.submissionToken));result={submission:draft.submission}; }
          else if (url.pathname === '/api/deposits/confirm') {const r=world.confirmDeposit(id,input);res.setHeader('Set-Cookie',cookie('bw_deposit',r.depositToken,900));result={deposit:r.deposit};}
          else if (url.pathname === '/api/deposits/quote') {result=world.quoteDeposit(id,session,{...input,depositToken:input.depositToken||c.bw_deposit});res.setHeader('Set-Cookie',cookie('bw_deposit_quote',result.token,3600));}
          else if (['/api/xpress/register','/api/utility/register'].includes(url.pathname)) result = world.registerProfile(id, input);
          else if (['/api/xpress/verify-email','/api/utility/verify-email'].includes(url.pathname)) result = world.verifyProfile(id, input);
          else if (['/api/xpress/account-lookup','/api/utility/account-lookup'].includes(url.pathname)) result = world.profileLookup(id, session, input);
          else if (['/api/xpress/link-account','/api/utility/link-account'].includes(url.pathname)) result = world.linkProfileAccount(id, session, input);
          else if (url.pathname === '/api/logout') { res.setHeader('Set-Cookie', cookie('bw_session', '', 0)); result = world.logout(id, session); }
          else if (url.pathname === '/api/reset/request') result = world.resetRequest(id, input);
          else if (url.pathname === '/api/reset/complete') result = world.resetPassword(id, input);
          else if (url.pathname === '/api/quote') result = world.quote(id, session, { ...input, lookupToken: input.lookupToken || c.bw_lookup });
          else if (url.pathname === '/api/pay') result = world.pay(id, session, input);
          else if (url.pathname === '/api/autopay') result = world.autopay(id, session, input);
          else if (url.pathname === '/api/schedule') result = world.schedule(id, session, input);
          else if (url.pathname === '/api/schedule/edit') result = world.editSchedule(id, session, input);
          else if (url.pathname === '/api/subscription/card') result = world.updateSubscriptionCard(id, session, input);
          else if (url.pathname === '/api/subscription/cancel') result = world.cancelSubscription(id, session);
          else if (url.pathname === '/api/paymentus/preferences') result=world.paymentusPreferencesUpdate(id,session,input);
          else if (url.pathname === '/api/mail/login') { result = world.mailboxLogin(id, input); res.setHeader('Set-Cookie', cookie('bw_mail', result.token)); result = { ok: true }; }
          else if (url.pathname === '/api/mail/read') result = world.markRead(id, c.bw_mail, input.id);
          else if (url.pathname === '/api/mail/update') result = world.updateMessage(id, c.bw_mail, input.id, input.changes);
          else if (url.pathname === '/api/mail/logout') { res.setHeader('Set-Cookie', cookie('bw_mail', '', 0)); result = { ok: true }; }
          else throw new Fault('Operation not found', 404);
          if (result.rejected) throw new Fault(result.message,401);
          if (result.session) { res.setHeader('Set-Cookie', cookie('bw_session', result.session)); const { session: _, ...safe } = result; result = safe; }
          return json(res, result);
        }
        throw new Fault('Operation not found', 404);
      }
      if (req.method === 'GET') {
        let snapshotPath = url.pathname, dentalBehavior=false;
        let cusiBehavior=false,cusiPage=false;
        let paymentusPage=false,starnikPage=false,starnikBehavior=false;
        const starnikRoutes={'portal-guest-current':'/starnikERP/',website:'/',login_url:'/billing', 'links-autopay_setup':'/autopay-help','links-view_bill':'/understanding-your-bill','links-payment_assistance':'/assistance',faq:'/faq','portal-register':'/RP/signup','portal-login':'/RP_Default.aspx','portal-forgot-password':'/RP/forgot-password','portal-username-current':'/RP/forgot-username'};
        const cusiRoutes={'website':'/','services':'/services','contact':'/contact','links-pay_bill':'/Account/Login','registration':'/Account/Registration','recovery':'/Account/ForgotPassword','terms':'/terms','privacy':'/privacy'};
        if(c.bw_episode){
          world.enter(c.bw_episode,c.bw_access);
          if(world.session(c.bw_episode,null).site.runtime.kind==='starnik'){
            if(url.pathname==='/starnik/signup/verify'&&url.searchParams.has('token')){world.starnikRegistrationGrant(c.bw_episode,url.searchParams.get('token'),true);res.writeHead(302,{Location:'/starnik/signup/setup','Set-Cookie':cookie('bw_starnik_signup',url.searchParams.get('token'),1800)});return res.end();}
            if(url.pathname==='/starnik/reset'&&url.searchParams.has('token')){world.starnikRecoveryGrant(c.bw_episode,url.searchParams.get('token'),true);res.writeHead(302,{Location:'/starnik/reset','Set-Cookie':cookie('bw_starnik_reset',url.searchParams.get('token'),900)});return res.end();}
            starnikPage=true;const kind=Object.keys(starnikRoutes).find(k=>starnikRoutes[k]===url.pathname)||(['/starnik/guest/review','/starnik/guest/receipt','/starnik/guest/account','/starnik/account','/starnik/reset','/starnik/signup/pending','/starnik/signup/setup','/starnik/signup/complete'].includes(url.pathname)?'portal-login':null);
            if(kind){snapshotPath='/reference-pages/biller_97db8399eb95ee4cb710-'+kind+'/index.html';starnikBehavior=['portal-guest-current','portal-login','portal-register','portal-forgot-password','portal-username-current'].includes(kind);}
          }
          if(world.session(c.bw_episode,null).site.runtime.kind==='paymentus'){
            paymentusPage=true;
            if(url.pathname==='/paymentus/reset'&&url.searchParams.has('token')){world.paymentusRecoveryGrant(c.bw_episode,url.searchParams.get('token'),true);res.writeHead(302,{Location:'/paymentus/reset','Set-Cookie':cookie('bw_paymentus_reset',url.searchParams.get('token'),900)});return res.end();}
            if(['/paymentus/login','/paymentus/recover','/paymentus/reset','/paymentus/accounts','/paymentus/register','/paymentus/add-account','/paymentus/verify-account','/paymentus/account-created','/paymentus/terms','/paymentus/bills','/paymentus/history','/paymentus/bill-history','/paymentus/autopay','/paymentus/autopay/review','/paymentus/autopay/confirmation','/paymentus/wallet','/paymentus/wallet/add','/paymentus/wallet/edit','/paymentus/wallet/remove','/paymentus/preferences','/paymentus/pay','/paymentus/review','/paymentus/receipt'].includes(url.pathname)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(assets.get('paymentus.html'));}
            if(url.pathname==='/')snapshotPath='/reference-pages/biller_c8edde62f56ee14f50e0-website/index.html';
          }
          if(world.session(c.bw_episode,null).site.runtime.kind==='cusi'){
            cusiPage=true;const kind=Object.keys(cusiRoutes).find(k=>cusiRoutes[k]===url.pathname)||(['/Account/Overview','/Account/Bill','/Account/Payment','/Account/PaymentReview','/Account/Receipt','/Account/ResetPassword'].includes(url.pathname)?'links-pay_bill':null);
            if(url.pathname==='/Account/ResetPassword'&&url.searchParams.has('token')){world.cusiRecoveryGrant(c.bw_episode,url.searchParams.get('token'));res.writeHead(302,{Location:'/Account/ResetPassword','Set-Cookie':cookie('bw_cusi_reset',url.searchParams.get('token'),900)});return res.end();}
            if(kind){snapshotPath='/reference-pages/biller_182c5bcdeb2841397831-'+kind+'/index.html';cusiBehavior=['links-pay_bill','recovery','registration'].includes(kind);}
          }
          if(world.session(c.bw_episode,null).site.runtime.kind==='personapay'){
            const kind={'/':'website','/insurance-financing':'help_center_url','/financing-options':'financing-options','/terms':'terms','/privacy':'privacy','/contact':'contact','/personapay/login':'portal','/personapay/account':'portal','/personapay/plan':'portal','/personapay/plan/review':'portal','/personapay/plans':'portal','/personapay/review':'portal','/personapay/receipt':'portal','/personapay/account-help':'account-help'}[url.pathname];
            if(kind){snapshotPath='/reference-pages/biller_3af3809e3e5a5bc0b943-'+kind+'/index.html';dentalBehavior=kind==='portal';}
          }
        }
        if ((['/','/utilities','/faq','/index.php','/departments/utilities/index.php','/faq/index.php'].includes(url.pathname)||url.pathname.startsWith('/billing')||url.pathname.startsWith('/MyChart')) && c.bw_episode) {
          world.enter(c.bw_episode, c.bw_access);
          const siteId=world.session(c.bw_episode,null).site.id;
          if(siteId==='wvu-medicine'){const kind={'/':'home','/billing':'billing','/billing/faq':'faq','/billing/understanding':'understanding','/billing/assistance':'assistance','/MyChart/help':'portal-faq','/MyChart/app/account-recovery/recovery-choice':'recovery-choice','/MyChart/app/account-recovery':'recovery-options','/MyChart/app/activation':'activation','/MyChart/app/activation/setup':'activation','/MyChart/Authentication/Login':'login','/MyChart/billing/guestpay':'guest','/MyChart/billing/account-summary':'guest','/MyChart/billing/receipt':'guest','/MyChart/billing/review':'guest'}[url.pathname];if(kind)snapshotPath='/reference-pages/biller_e8f5dad7794eeb4e8b7f-'+kind+'/index.html';}
          if(siteId==='gvp-electric'&&url.pathname==='/')snapshotPath='/reference-pages/gvp-home/index.html';
          if(siteId==='swepsonville-water') {
            const kind=url.pathname.includes('utilities')?'utilities':url.pathname.includes('faq')?'faq':'home';
            snapshotPath=`/reference-pages/biller_a46a4680fecf8553bc8a-${kind}/index.html`;
          }
        }
        if (publicSnapshots.has(snapshotPath)) {
          const snapshot = publicSnapshots.get(snapshotPath);
          res.writeHead(200, { 'Content-Type': snapshot.contentType==='text/html'?'text/html; charset=utf-8':snapshot.contentType, 'Cache-Control': 'no-store' });
          if(starnikPage&&snapshot.contentType==='text/html'){let markup=snapshot.content.toString('utf8');for(const[k,path]of Object.entries(starnikRoutes))markup=markup.replaceAll('href="/reference-pages/biller_97db8399eb95ee4cb710-'+k+'/index.html"','href="'+path+'"');markup=markup.replaceAll('href="/starnikERP/"','href="/starnikERP/#/rp_guestpay/rp_guestpay"');if(starnikBehavior)markup=markup.replace('</head>','<link rel="stylesheet" href="/starnik.css"></head>').replace('</body>','<script src="/starnik.js" defer></script></body>');return res.end(markup);}
          if(cusiPage&&snapshot.contentType==='text/html'){let markup=snapshot.content.toString('utf8');for(const [kind,path]of Object.entries(cusiRoutes))markup=markup.replaceAll('href="/reference-pages/biller_182c5bcdeb2841397831-'+kind+'/index.html"','href="'+path+'"');if(cusiBehavior)markup=markup.replace('</head>','<link rel="stylesheet" href="/cusi.css"></head>').replace('</body>','<script src="/cusi.js" defer></script></body>');return res.end(markup);}
          if(paymentusPage&&snapshot.contentType==='text/html')return res.end(snapshot.content.toString('utf8').replace('<a rel="noopener" aria-disabled="true" title="This destination is not yet available in Billworld">Visit the Paymentus Customer Portal link</a>','<a href="/paymentus/login">Visit the Paymentus Customer Portal link</a>'));
          return res.end(dentalBehavior?snapshot.content.toString('utf8').replace('</head>','<link rel="stylesheet" href="/personapay.css"></head>').replace('</body>','<script src="/personapay.js" defer></script></body>'):snapshot.content);
        }
        if (referenceDocuments.has(url.pathname)) {
          res.writeHead(200, { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' });
          return res.end(referenceDocuments.get(url.pathname));
        }
        if (url.pathname.startsWith('/reference-pages/')) throw new Fault('Public snapshot resource not found', 404);
        if (['/reference-assets/gvp-logo.png','/reference-assets/gvp-background.png','/reference-assets/avec-logo.png', '/reference-assets/avec-background.jpg', '/reference-assets/xpress-logo.svg', '/reference-assets/homer-logo.png', '/reference-assets/xpress-background.jpg', '/reference-assets/duluth-logo.jpg', '/reference-assets/duluth-banner.jpg', '/reference-assets/duluth-identity.webp', '/reference-assets/duluth-google.svg', '/reference-assets/duluth-apple.svg', '/reference-assets/duluth-microsoft.svg', '/reference-assets/duluth-facebook.svg','/reference-assets/ml-logo.png','/reference-assets/ml-water.jpg','/reference-assets/ml-karla.woff2','/reference-assets/ml-lora.woff2','/reference-assets/sweps-invoicecloud.png','/reference-assets/sweps-draft-logo.png','/reference-assets/sweps-visa.gif','/reference-assets/sweps-mastercard.gif','/reference-assets/sweps-amex.gif','/reference-assets/sweps-discover.gif','/reference-assets/sweps-bank.png','/reference-assets/swepsonville-fees-2026-2027.pdf','/reference-assets/swepsonville-water-policy.pdf'].includes(url.pathname)) {
          const name = url.pathname.split('/').at(-1); if (!assets.has(name)) throw new Fault('Reference asset not captured', 404);
          res.writeHead(200, { 'Content-Type': name.endsWith('.woff2')?'font/woff2':name.endsWith('.pdf')?'application/pdf':name.endsWith('.gif')?'image/gif':name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.png') ? 'image/png' : name.endsWith('.webp')?'image/webp':'image/jpeg' }); return res.end(assets.get(name));
        }
        if (url.pathname === '/reference-assets/juneau-logo.png') {
          if (!assets.has('juneau-logo.png')) throw new Fault('Run npm run capture to obtain the reference logo', 404);
          res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(assets.get('juneau-logo.png'));
        }
        const requestedAsset = url.pathname.slice(1);
        if(starnikPage&&!['starnik.js','starnik.css','catalog-public.js'].includes(requestedAsset))throw new Fault('Starnik route not implemented',404);
        if(paymentusPage&&!['paymentus.js','paymentus.css','catalog-public.js'].includes(requestedAsset))throw new Fault('Paymentus route not implemented',404);
        if(cusiPage&&!assets.has(requestedAsset))throw new Fault('CUSI route not implemented',404);
        const name = ['starnik.css','starnik.js','paymentus.js','paymentus.css','catalog-public.js','app.js', 'authoritypay.js','bank-draft.js','deposits.js','municipal.js','mychart.js','wvu-public.js','mychart-activation.js','mychart-recovery.js','personapay.js','personapay.css','cusi.js','cusi.css', 'authoritypay.css', 'spotify.js', 'smarthub.js', 'smarthub.css', 'xpress.js', 'xpress.css', 'duluth.js', 'duluth.css', 'style.css'].includes(requestedAsset) ? requestedAsset : 'index.html';
        res.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', 'Cache-Control': 'no-store' });
        return res.end(assets.get(name));
      }
      throw new Fault('Not found', 404);
    } catch (error) { json(res, { error: error instanceof Fault ? error.message : 'Internal server error' }, error.status || 500); if (!(error instanceof Fault)) console.error(error); }
  });
  const adminServer = http.createServer(async (req, res) => {
    try {
      const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
      if (!isToken(auth, adminToken)) throw new Fault('Admin access denied', 403);
      if (req.method !== 'POST') throw new Fault('POST required', 405);
      const url = new URL(req.url, 'http://localhost'); const input = await body(req);
      if (url.pathname === '/episodes') {
        const fixture = world.create(input); const actualPort = publicServer.address().port;
        return json(res, { ...fixture, startUrl: `http://127.0.0.1:${actualPort}/enter/${fixture.episodeId}/${fixture.entryToken}`, connectorUrl: `http://127.0.0.1:${actualPort}/connector/messages` });
      }
      if (url.pathname === '/evaluate') return json(res, world.evaluate(input.episodeId, { confirmation: input.confirmation, billingDate: input.billingDate, scheduledDate: input.scheduledDate,statementFilename:input.statementFilename }));
      if (url.pathname === '/actions/start') return json(res,world.startActionBudget(input.episodeId,input));
      if (url.pathname === '/actions/consume') return json(res,world.consumeAction(input.episodeId,input));
      if (url.pathname === '/finish') return json(res, world.finish(input.episodeId, input.outcome, input.metadata));
      if (url.pathname === '/report') return json(res, world.report(input));
      if (url.pathname === '/advance') return json(res, world.advance(input.episodeId, input.milliseconds));
      if (url.pathname === '/settle') return json(res, world.settle(input.episodeId));
      throw new Fault('Admin operation not found', 404);
    } catch (error) { json(res, { error: error instanceof Fault ? error.message : 'Internal server error' }, error.status || 500); }
  });
  const googleServer = http.createServer(async (req, res) => {
    try {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'");
      const url = new URL(req.url, google.issuer || 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/request') return json(res, google.publicRequest(url.searchParams.get('request')));
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        if (req.headers.origin !== google.issuer) throw new Fault('Same-origin request required', 403);
        const input = await body(req);
        if(url.pathname==='/api/mychart/activation/verify'){const r=world.medicalActivationVerify(id,input);res.setHeader('Set-Cookie',cookie('bw_medical_activation',r.setupToken,600));result={verified:true};}
          else if(url.pathname==='/api/mychart/activation/complete'){result=world.medicalActivationComplete(id,c.bw_medical_activation,input);res.setHeader('Set-Cookie',cookie('bw_medical_activation','',0));}
          else if(url.pathname==='/api/mychart/identity')result=world.medicalIdentityBegin(id,input);
          else if(url.pathname==='/api/mychart/lookup'){result=world.medicalLookup(id,input);res.setHeader('Set-Cookie',cookie('bw_lookup',result.lookupToken,900));}
          else if(url.pathname==='/api/mychart/quote'){result=world.quote(id,input.authenticated===true?session:null,{...input,lookupToken:c.bw_lookup});res.setHeader('Set-Cookie',cookie('bw_medical_quote',result.token,3600));const {token,...safe}=result;result=safe;}
          else if(url.pathname==='/api/mychart/pay'){result=world.pay(id,session,{token:c.bw_medical_quote});}
          else if (url.pathname === '/api/identity/begin') result=world.identityBegin(id,input);
          else if (url.pathname.startsWith('/api/wallet/')) result=world.wallet(id,session,url.pathname.slice('/api/wallet/'.length),input);
          else if (url.pathname === '/api/paperless') result=world.paperless(id,session,input);
          else if (url.pathname === '/api/login') return json(res, google.authenticate(input.request, input));
        if (url.pathname === '/api/consent') return json(res, google.consent(input.request, input));
        throw new Fault('Operation not found', 404);
      }
      if (req.method === 'GET') {
        const name = url.pathname === '/google.js' ? 'google.js' : url.pathname === '/style.css' ? 'style.css' : 'google.html';
        res.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', 'Cache-Control': 'no-store' }); return res.end(assets.get(name));
      }
      throw new Fault('Not found', 404);
    } catch (error) { json(res, { error: error instanceof Fault ? error.message : 'Internal identity error' }, error.status || 500); }
  });
  await new Promise(r => publicServer.listen(port, '127.0.0.1', r));
  await new Promise(r => adminServer.listen(adminPort, '127.0.0.1', r));
  await new Promise(r => googleServer.listen(googlePort, '127.0.0.1', r));
  google.issuer = `http://localhost:${googleServer.address().port}`;
  return { world, google, publicServer, adminServer, googleServer, adminToken, googleUrl: google.issuer,
    baseUrl: `http://127.0.0.1:${publicServer.address().port}`, adminUrl: `http://127.0.0.1:${adminServer.address().port}`,
    close: async () => { clearInterval(deadlineMonitor); world.sealActiveTrials('environment_error'); await Promise.all([new Promise(r => publicServer.close(r)), new Promise(r => adminServer.close(r)), new Promise(r => googleServer.close(r))]); world.close(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await start({ port: Number(process.env.BILLWORLD_PORT || 3100), adminPort: Number(process.env.BILLWORLD_ADMIN_PORT || 3101), ...(process.env.BILLWORLD_ADMIN_TOKEN ? { adminToken: process.env.BILLWORLD_ADMIN_TOKEN } : {}) });
  const fixture = server.world.create();
  const runner = { ...fixture, startUrl: `${server.baseUrl}/enter/${fixture.episodeId}/${fixture.entryToken}`, adminUrl: server.adminUrl, adminToken: server.adminToken };
  mkdirSync(`${root}/data`, { recursive: true }); writeFileSync(`${root}/data/local-runner.json`, JSON.stringify(runner, null, 2), { mode: 0o600 });
  const spotify = server.world.create({ siteId: 'spotify' });
  const spotifyRunner = { ...spotify, startUrl: `${server.baseUrl}/enter/${spotify.episodeId}/${spotify.entryToken}`, adminUrl: server.adminUrl, adminToken: server.adminToken, googleUrl: server.googleUrl };
  writeFileSync(`${root}/data/spotify-runner.json`, JSON.stringify(spotifyRunner, null, 2), { mode: 0o600 });
  const avec = server.world.create({ siteId: 'avec-electric' });
  const avecRunner = { ...avec, startUrl: `${server.baseUrl}/enter/${avec.episodeId}/${avec.entryToken}`, adminUrl: server.adminUrl, adminToken: server.adminToken };
  writeFileSync(`${root}/data/avec-runner.json`, JSON.stringify(avecRunner, null, 2), { mode: 0o600 });
  const homerRunners = [];
  for (const [filename, options] of [['homer-runner.json', {}], ['homer-registration-runner.json', { taskId: 'homer-register-link-pay-v1' }]]) {
    const homer = server.world.create({ siteId: 'homer-utilities', ...options });
    const homerRunner = { ...homer, startUrl: `${server.baseUrl}/enter/${homer.episodeId}/${homer.entryToken}`, adminUrl: server.adminUrl, adminToken: server.adminToken };
    writeFileSync(`${root}/data/${filename}`, JSON.stringify(homerRunner, null, 2), { mode: 0o600 }); homerRunners.push(homerRunner);
  }
  for(const [filename,taskId]of [['gvp-runner.json','gvp-pay-current-v1'],['gvp-registration-runner.json','gvp-register-pay-v1']]){const f=server.world.create({siteId:'gvp-electric',taskId}),r={...f,startUrl:`${server.baseUrl}/enter/${f.episodeId}/${f.entryToken}`,adminUrl:server.adminUrl,adminToken:server.adminToken};writeFileSync(`${root}/data/${filename}`,JSON.stringify(r,null,2),{mode:0o600});console.log(`Grand Valley Power: ${r.startUrl}`);}
  const duluthFixture=server.world.create({siteId:'duluth-comfortsystems'});
  const duluthRunner={...duluthFixture,startUrl:`${server.baseUrl}/enter/${duluthFixture.episodeId}/${duluthFixture.entryToken}`,adminUrl:server.adminUrl,adminToken:server.adminToken};
  writeFileSync(`${root}/data/duluth-runner.json`,JSON.stringify(duluthRunner,null,2),{mode:0o600});
  console.log(`Duluth: ${duluthRunner.startUrl}`);
  for(const [filename,taskId]of [['swepsonville-runner.json','swepsonville-guest-pay-v1'],['swepsonville-registration-runner.json','swepsonville-register-login-v1'],['swepsonville-recovery-runner.json','swepsonville-recover-login-v1'],['swepsonville-bankdraft-runner.json','swepsonville-bank-draft-request-v1'],['swepsonville-deposit-runner.json','swepsonville-deposit-payment-v1']]){
    const f=server.world.create({siteId:'swepsonville-water',taskId}),r={...f,startUrl:`${server.baseUrl}/enter/${f.episodeId}/${f.entryToken}`,adminUrl:server.adminUrl,adminToken:server.adminToken};
    writeFileSync(`${root}/data/${filename}`,JSON.stringify(r,null,2),{mode:0o600});console.log(`Swepsonville (${taskId}): ${r.startUrl}`);
  }
  for(const [filename,taskId]of [['wvu-runner.json','wvu-guest-visit-pay-v1'],['wvu-signed-runner.json','wvu-signed-visit-pay-v1'],['wvu-mfa-runner.json','wvu-mfa-visit-pay-v1'],['wvu-activation-runner.json','wvu-activation-visit-pay-v1'],['wvu-recovery-runner.json','wvu-recover-login-v1']]){
    const f=server.world.create({siteId:'wvu-medicine',taskId}),r={...f,startUrl:`${server.baseUrl}/enter/${f.episodeId}/${f.entryToken}`,adminUrl:server.adminUrl,adminToken:server.adminToken};
    writeFileSync(`${root}/data/${filename}`,JSON.stringify(r,null,2),{mode:0o600});console.log(`WVU Medicine (${taskId}): ${r.startUrl}`);
  }
  for(const [filename,taskId]of [['western-dental-runner.json','western-dental-full-pay-v1'],['western-dental-partial-runner.json','western-dental-partial-pay-v1'],['western-dental-overpay-runner.json','western-dental-overpay-pay-v1'],['western-dental-recurring-plan-runner.json','western-dental-recurring-plan-v1'],['western-dental-future-plan-runner.json','western-dental-future-plan-v1']]){
    const f=server.world.create({siteId:'western-dental',taskId}),r={...f,startUrl:`${server.baseUrl}/enter/${f.episodeId}/${f.entryToken}`,adminUrl:server.adminUrl,adminToken:server.adminToken};
    writeFileSync(`${root}/data/${filename}`,JSON.stringify(r,null,2),{mode:0o600});console.log(`Western Dental (${taskId}): ${r.startUrl}`);
  }
  console.log(`Juneau: ${runner.startUrl}\nSpotify: ${spotifyRunner.startUrl}\nAVEC: ${avecRunner.startUrl}\nHomer: ${homerRunners[0].startUrl}\nHomer registration: ${homerRunners[1].startUrl}\nRunner credentials: billworld/data/*-runner.json\nPrivate grader: ${server.adminUrl}\nMock Google: ${server.googleUrl}`);
  const stop = async () => { await server.close(); process.exit(0); }; process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
