import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomInt, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { sites, tasks, constructionSites, constructionTasks } from './registry.mjs';
import { walletInstrument, validateExpiry, instrumentHash } from './wallet.mjs';
import { runScheduler, utcDay } from './scheduler.mjs';
import {validateBankDraft,safeBankDraft} from './bank-draft.mjs';
import {depositAmountCents} from './deposits.mjs';
import { seedMedicalBills, medicalScope } from './medical.mjs';
import { seedPersonaPay, personaPayIdentifiers, personaPayDistribution } from './personapay.mjs';
import { dentalPlanSchedule, runDentalPlans } from './personapay-plans.mjs';
import {PROCESS_BUILD} from './build-fingerprint.mjs';
import {paymentusStatementDocument} from './paymentus-statements.mjs';
import {starnikPayment,starnikFee} from './starnik-payment.mjs';
import {runPaymentusAutoPay} from './paymentus-autopay.mjs';

export const ENVIRONMENT_REVISION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
export const site = sites.get('juneau-utilities');
export const task = tasks.get('juneau-pay-current-no-fee-v1');
export const spotifySite = sites.get('spotify');
export const spotifyTask = tasks.get('spotify-update-card-v1');
export const autopayTask = tasks.get('juneau-enable-autopay-v1');
export const scheduleTask = tasks.get('juneau-schedule-payment-v1');
export const emailMfaTask = tasks.get('juneau-pay-email-mfa-v1');
export const recoveryTask = tasks.get('juneau-recover-password-v1');
export const avecSite = sites.get('avec-electric');
export const avecTask = tasks.get('avec-pay-current-v1');
const lookupSite = id => sites.get(id)||constructionSites.get(id);
const lookupTask = id => tasks.get(id)||constructionTasks.get(id);
const siteFor = s => lookupSite(s.siteId || 'juneau-utilities');
const taskFor = s => lookupTask(s.taskId) || lookupTask(siteFor(s).default_task_id);
function runtimeFee(s, kind, amount) {
  const p = siteFor(s).billing_policy;
  if (Number.isSafeInteger(p?.fee_cents)) return p.fee_cents;
  if (kind === 'bank' && Number.isSafeInteger(p?.ach_fee_cents)) return p.ach_fee_cents;
  if (kind === 'card' && Number.isSafeInteger(p?.card_fee_basis_points) && Number.isSafeInteger(p?.card_fee_minimum_cents)) return Math.max(p.card_fee_minimum_cents, Math.floor((amount * p.card_fee_basis_points + 5000) / 10000));
  throw new Fault('This site has no configured payment fee policy');
}
export class Fault extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const secret = () => randomBytes(24).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
function credential(password) {
  const salt = secret();
  return { salt, digest: scryptSync(password, salt, 32).toString('hex') };
}
function matches(password, cred) {
  return typeof password === 'string' && timingSafeEqual(scryptSync(password, cred.salt, 32), Buffer.from(cred.digest, 'hex'));
}
function need(value, message, status = 400) { if (!value) throw new Fault(message, status); }
function trialMetadata(input) {
  need(input && typeof input === 'object' && !Array.isArray(input), 'Declare trial metadata');
  need(['agent', 'reference_script', 'grader_validation'].includes(input.kind), 'Declare the evaluation kind');
  need(typeof input.agent === 'string' && input.agent.length > 0 && input.agent.length <= 200, 'Declare the agent or reference script');
  const accessMode = input.accessMode || 'browser_only';
  need(['browser_only', 'browser_and_email_connector'].includes(accessMode), 'Declare a supported access mode');
  for (const key of ['runId', 'model', 'scaffold']) need(input[key] === undefined || input[key] === null || typeof input[key] === 'string' && input[key].length > 0 && input[key].length <= 200, `Invalid ${key}`);
  need(input.attemptNumber === undefined || Number.isSafeInteger(input.attemptNumber) && input.attemptNumber >= 1, 'Invalid attempt number');
  return { kind: input.kind, agent: input.agent, accessMode, runId: input.runId || null, model: input.model || null, scaffold: input.scaffold || null, attemptNumber: input.attemptNumber || 1 };
}
function account(state, id) { const a = state.accounts.find(a => a.id === id); need(a, 'Account not found', 404); return a; }
function authorized(state, session) {
  const s = state.sessions[session];
  need(s && s.expires > state.now, 'Please sign in again', 401);
  return account(state, s.accountId);
}
const profileFlow = s => ['email_verification_then_account_link', 'email_code_then_account_link'].includes(siteFor(s).runtime.profile_flow);
const smartHub = s => s.siteId==='avec-electric'||siteFor(s).runtime.frontend==='smarthub';
const swepsonville = s => s.siteId==='swepsonville-water';
const duluth = s => s.siteId === 'duluth-comfortsystems';
const medical = s => siteFor(s).runtime.kind === 'medical';
const personaPay = s => siteFor(s).runtime.kind === 'personapay';
function starnikPassword(password){need(typeof password==='string'&&password.length>=8&&password.length<=24&&/[a-zA-Z]/.test(password)&&/[0-9]/.test(password)&&/[-!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~]/.test(password)&&!/[\s<>]/.test(password),'Use 8–24 characters with a letter, number and special character; no spaces or angle brackets');}
const starnik = s => siteFor(s).runtime.kind === 'starnik';
const starnikBusiness = s => JSON.stringify({accounts:s.accounts,invoices:s.invoices,payments:s.payments,scheduledPayments:s.scheduledPayments});
const cusi = s => siteFor(s).runtime.kind === 'cusi';
function cusiPasswordPolicy(s){const p=siteFor(s).password_policy;need(p&&Number.isSafeInteger(p.minimum_length)&&Number.isSafeInteger(p.maximum_length),'Password policy unavailable',503);return{minimum_length:p.minimum_length,maximum_length:p.maximum_length,digit:p.digit,lowercase:p.lowercase,uppercase:p.uppercase,non_alphanumeric:p.non_alphanumeric};}
function cusiPassword(s,password){const p=cusiPasswordPolicy(s);need(typeof password==='string'&&password.length>=p.minimum_length&&password.length<=p.maximum_length&&(!p.digit||/[0-9]/.test(password))&&(!p.lowercase||/[a-z]/.test(password))&&(!p.uppercase||/[A-Z]/.test(password))&&(!p.non_alphanumeric||/[^A-Za-z0-9]/.test(password)),`Use ${p.minimum_length}–${p.maximum_length} characters with uppercase, lowercase, a digit and a non-alphanumeric character`);}
const paymentus = s => siteFor(s).runtime.kind === 'paymentus';
const paymentusIdentity = a => ({id:a.id,email:a.email,name:a.paymentusProfile?`${a.paymentusProfile.firstName} ${a.paymentusProfile.lastName}`:a.name,registered:a.registered});
const cusiBusiness = s => JSON.stringify({accounts:s.accounts.map(a=>{if(a.id!=='acct-primary')return a;const {credential,registered,username,cusiProfile,...rest}=a;return rest;}),invoices:s.invoices,payments:s.payments,scheduledPayments:s.scheduledPayments});
const paymentusBusiness = (s,registration=false) => JSON.stringify({ accounts:s.accounts.map(a=>{const {credential,...rest}=a;if(a.id!=='acct-primary')return a;if(registration){const {registered,paymentusProfile,paymentusLinks,...protectedFields}=rest;return protectedFields;}return rest;}), invoices:s.invoices, payments:s.payments, scheduledPayments:s.scheduledPayments });
const fullNameLookup = s => siteFor(s).runtime.guest_lookup === 'account_number_and_full_name';
const guardedLookup = s => personaPay(s) || medical(s) || ['account_number_and_last_name','account_number_and_full_name'].includes(siteFor(s).runtime.guest_lookup);
function linkedBilling(s, a) {
  need(!profileFlow(s) || a.profileVerified && a.billLinked, 'Verify your email and link a billing account first', 403);
}
function profilePassword(password) {
  need(typeof password === 'string' && password.length >= 8 && password.length < 30 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && !/(.)\1{2,}/.test(password), 'Use 8–29 characters with uppercase, lowercase and a number, without three repeated consecutive characters');
}
function duluthPassword(password,email) {
        need(typeof password==='string' && password.length>=8 && password.length<=128 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password), 'Use at least eight characters with uppercase, lowercase and a number');
        need(!email.split('@')[0].toLowerCase().split(/[^a-z0-9]+/).filter(v=>v.length>=3).some(v=>password.toLowerCase().includes(v)), 'Password must not contain parts of your email');
        need(!['Password123','Password123!','Welcome123!'].includes(password), 'Choose a less common password');
}
function event(state, type, data = {}) { state.events.push({ sequence: state.events.length + 1, at: state.now, type, ...data }); }
function mailAttachment(item) {
  need(item && typeof item==='object' && /^attachment-[1-9]\d*$/.test(item.id), 'Invalid attachment evidence',500);
  need(typeof item.name==='string' && item.name.length>0 && item.name.length<=200 && !/[\x00-\x1f\x7f/\\]/.test(item.name), 'Invalid attachment filename',500);
  need(['text/plain','application/pdf','image/png','image/jpeg','application/octet-stream'].includes(item.mimeType), 'Unsupported attachment content type',500);
  need(typeof item.dataBase64==='string' && item.dataBase64.length<=1398104, 'Attachment exceeds one MiB',500);
  const data=Buffer.from(item.dataBase64,'base64');
  need(data.length<=1048576 && data.toString('base64')===item.dataBase64, 'Invalid attachment encoding',500);
  const sha256=createHash('sha256').update(data).digest('hex');
  need(item.sizeBytes===data.length && item.sha256===sha256, 'Attachment integrity mismatch',500);
  return {id:item.id,name:item.name,mimeType:item.mimeType,sizeBytes:data.length,sha256};
}
function mailboxProjection(message) {
  const attachments=message.attachments||[];
  need(Array.isArray(attachments)&&attachments.length<=20, 'Invalid attachments',500);
  need(new Set(attachments.map(a=>a.id)).size===attachments.length,'Duplicate attachment ID',500);
  return {...message,attachments:attachments.map(mailAttachment)};
}
function send(state, recipient, subject, text) {
  const message = { id: `mail-${state.mail.length + 1}`, threadId: `thread-${state.mail.length + 1}`,
    from: `billing@${siteFor(state).runtime.mail_sender_slug}.billworld.test`, to: recipient, subject, text, receivedAt: new Date(state.now).toISOString(), unread: true, attachments: [] };
  state.mail.push(message); return message;
}
function cusiResetLink(s,a){
  for(const c of Object.values(s.challenges))if(c.accountId===a.id&&c.kind==='cusi_reset')c.used=true;
  const token=secret();s.challenges[hash(token)]={kind:'cusi_reset',accountId:a.id,used:false,expires:s.now+15*60000};
  event(s,'cusi_recovery_requested',{accountId:a.id});send(s,a.cusiProfile?.email||a.email,'Your local Lockwood password reset link',`Open /Account/ResetPassword?token=${token} to choose a new password. This simulated recovery grant expires in 15 minutes and can be used once. The public portal's Email Link entry is observed; delivery and continuation are synthetic.`);
}
function available(state, inv) {
  const reserved = state.payments.filter(p=>['posted','pending'].includes(p.status)).reduce((n,p)=>n+(Array.isArray(p.allocations)?p.allocations.filter(x=>x.invoiceId===inv.id).reduce((a,x)=>a+x.amountCents,0):(inv.purpose==='deposit'?p.depositId===inv.id:p.invoiceId===inv.id)?p.amountCents:0),0);
  return inv.amountCents - reserved;
}
const safeMethod = ({ id, kind, last4, label, expiry, name }) => ({ ...(id ? { id } : {}), kind, last4, label, ...(expiry?{expiry}:{}), ...(name?{name}:{}) });
const safeAccount = a => ({ id: a.id, customerNumber: a.billLinked === false ? null : a.customerNumber, name: a.name, email: a.email, registered: a.registered, autopay: a.autopay, methods: a.billLinked === false ? [] : a.methods.map(safeMethod), ...(a.paperless!==undefined?{paperless:a.paperless}:{}), ...(a.defaultMethodId!==undefined?{defaultMethodId:a.defaultMethodId}:{}), ...(a.profileVerified !== undefined ? { profileVerified: a.profileVerified, billLinked: a.billLinked, paperless: a.paperless, profile: a.profile } : {}) });

export function feeCents(kind, amount) {
  return kind === 'bank' ? 0 : Math.max(site.billing_policy.card_fee_minimum_cents,
    Math.floor((amount * site.billing_policy.card_fee_basis_points + 5000) / 10000));
}

export class World {
  constructor(path = ':memory:', {construction=false} = {}) {
    this.construction=construction===true;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY, state TEXT NOT NULL)');
  }
  close() { this.db.close(); }
  state(id) {
    need(typeof id === 'string' && id.length > 0, 'Episode access required', 401);
    const row = this.db.prepare('SELECT state FROM episodes WHERE id=?').get(id);
    need(row, 'Episode not found', 404); return JSON.parse(row.state);
  }
  save(state) { this.db.prepare('INSERT OR REPLACE INTO episodes(id,state) VALUES(?,?)').run(state.id, JSON.stringify(state)); }
  transact(id, fn, { finalizing = false } = {}) {
    if (!finalizing) {
      const before = this.state(id);
      if (before.trial && !before.finished && Date.now() > before.trial.deadlineAt) this.finish(id, {}, { termination: 'timeout' });
    }
    this.db.exec('BEGIN IMMEDIATE');
    try { const s = this.state(id); need(!s.finished, 'Episode is finished', 409); need(finalizing||!s.actionBudget?.exhausted,'Action budget exhausted',409); const result = fn(s); this.save(s); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  create({ seed = 1, emailOtp = false, registered = true, pending = false, siteId = 'juneau-utilities', partnerBilling = false, taskId, trial } = {}) {
    need(Number.isInteger(seed) && seed >= 0, 'seed must be a nonnegative integer');
    need(sites.has(siteId)||this.construction&&constructionSites.has(siteId), 'Site is not implemented');
    need(!taskId || lookupTask(taskId)?.site_id === siteId, 'Task does not belong to this site');
    if (lookupTask(taskId)?.goal.temp_password_required || ['account_registration','paymentus_registration','cusi_registration','starnik_registration'].includes(lookupTask(taskId)?.goal.type)) registered=false;
    if (lookupTask(taskId)?.goal.profile_verification_required) registered = false;
    if (lookupTask(taskId)?.goal.medical_activation_required) registered = false;
    const id = `episode-${secret()}`;
    const mailboxPassword = 'Mailbox-2026!';
    const state = { id, seed, siteId, constructionSlice:constructionSites.has(siteId), taskId: taskId || lookupSite(siteId).default_task_id, now: Date.parse('2026-10-03T16:00:00Z'), createdAt: Date.now(), scheduledPayments: [], schedulerKeys: [],
      entryToken: secret(), connectorToken: secret(), emailOtp: Boolean(emailOtp) || taskId === emailMfaTask.id || Boolean(lookupTask(taskId)?.goal.email_mfa_required), pending: Boolean(pending),
      buildProvenance:{schema:PROCESS_BUILD.schema,environmentBuildId:PROCESS_BUILD.environmentBuildId,evaluatorBuildId:PROCESS_BUILD.evaluatorBuildId},
      mailboxCredential: credential(mailboxPassword), sessions: {}, challenges: {}, quotes: {}, payments: [], events: [], mail: [],
      accounts: [
        { id: 'acct-primary', customerNumber: '1001048', name: 'Alex Morgan', email: 'alex@billworld.test', registered: Boolean(registered), credential: credential('Billworld-2026!'), autopay: { enabled: false, methodId: null, day: 20 }, methods: [
          { id: 'bank-1048', kind: 'bank', last4: '1048', label: 'Checking ending 1048' },
          { id: 'card-4242', kind: 'card', last4: '4242', label: 'Visa ending 4242' },
          { id: 'card-decline', kind: 'card', last4: '0002', label: 'Declined card ending 0002', decline: true }
        ] },
        { id: 'acct-secondary', customerNumber: '2002099', name: 'Jordan Lee', email: 'jordan@billworld.test', registered: true, credential: credential('Other-2026!'), autopay: { enabled: false, methodId: null, day: 20 }, methods: [] }
      ],
      invoices: [
        { id: 'inv-current', accountId: 'acct-primary', number: '2026-10-1048', period: 'September 2026', dueDate: '2026-10-20', amountCents: 8432, current: true },
        { id: 'inv-old', accountId: 'acct-primary', number: '2026-09-1048', period: 'August 2026', dueDate: '2026-09-20', amountCents: 7219, current: false },
        { id: 'inv-other', accountId: 'acct-secondary', number: '2026-10-2099', period: 'September 2026', dueDate: '2026-10-20', amountCents: 5190, current: true }
      ],
    };
    state.payments.push({ id: 'pay-historical', invoiceId: 'inv-old', accountId: 'acct-primary', amountCents: 7219, feeCents: 0, method: { kind: 'bank', last4: '1048' }, status: 'posted', confirmation: 'BW-OLD-1048', createdAt: state.now - 14 * 86400000, initial: true });
    send(state, 'alex@billworld.test', 'September payment receipt', 'Your previous payment of $72.19 was posted. Confirmation: BW-OLD-1048.');
    send(state, 'alex@billworld.test', 'Your October water/sewer bill is ready', 'Customer 1001048: invoice 2026-10-1048 totals $84.32 and is due October 20, 2026.');
    if (medical(state)) {
      seedMedicalBills(state); state.mail = [];
      send(state, 'alex@billworld.test', 'Your medical billing statement', 'Guarantor Alex Morgan, account 1001048: visit account 100104801 has a balance of $84.32; visit account 100104802 has a separate balance of $125.00. The July visit was previously paid.');
      if(!state.accounts[0].registered){
        const code=randomBytes(5).toString('hex').toUpperCase();
        state.challenges[hash(code)]={kind:'medical_activation_code',accountId:'acct-primary',expires:state.now+24*60*60000,used:false};
        state.medicalActivationFailures=0;
        send(state,'alex@billworld.test','Your MyWVUChart activation code',`Your local activation code is ${code.slice(0,5)}-${code.slice(5)}. Enter both parts on the activation page. This simulated code expires in 24 hours and can be used once. No real patient information is included.`);
        event(state,'medical_activation_issued',{accountId:'acct-primary'});
      }
    }
    if (personaPay(state)) {
      seedPersonaPay(state); state.mail = [];
      send(state, 'alex@billworld.test', 'Your local dental account statement', 'Synthetic account 123001048: charges $84.32 and $125.00, total $209.32. ZIP 56007; date of birth 04/12/1985. These fixture identifiers do not describe a real patient.');
    }
    if (siteId === 'avec-electric') {
      state.accounts[0].ssnLast4 = '1048'; state.accounts[0].phone = '9075550148';
      state.accounts[1].ssnLast4 = '2099'; state.accounts[1].phone = '9075550299';
      state.mail = [];
      send(state, 'alex@billworld.test', 'September electric payment receipt', 'Your previous payment of $72.19 was posted. Confirmation: BW-OLD-1048.');
      send(state, 'alex@billworld.test', 'Your October electric bill is ready', 'Account 1001048: invoice 2026-10-1048 totals $84.32 and is due October 20, 2026.');
    }
    if(paymentus(state)){
      for(const a of state.accounts)for(const m of a.methods){m.version=1;m.name=a.name;if(m.kind==='card')m.expiry='12/29';}
      for(const [i,kind,number,routing] of [[0,'bank','000001048','021000021'],[1,'card','4242424242424242',''],[2,'card','4000000000000002','']])state.accounts[0].methods[i].instrumentHash=instrumentHash(kind,number,routing);
      for(const a of state.accounts){a.serviceAddress=a.id==='acct-primary'?'36W123 Main St, Batavia, IL 60510':'101-103 North St, Batavia, IL 60510';a.paymentusProfile=a.registered?{firstName:a.name.split(' ')[0],lastName:a.name.split(' ').at(-1),phone:'6305550148',zipCode:'60510'}:null;a.paymentusLinks=a.registered?[{accountId:a.id,paperless:false,emailNotification:false,smsNotification:false}]:[];}
      if(taskFor(state).goal.type==='paymentus_autopay'&&!taskFor(state).goal.enabled)state.accounts[0].autopay={enabled:true,methodId:'bank-1048',profileId:'acct-primary',rule:'invoice_due_date',timezone:'UTC',enrolledAt:state.now-86400000};
      state.mail=[];send(state,'alex@billworld.test','Your local Batavia utility account','Synthetic account 1001048 has service address 36W123 Main St, Batavia, IL 60510. Guide-based access and account linking are available; Bank payment checkout is synthetic; current live fees and settlement remain unverified.');state.paymentusBaseline=paymentusBusiness(state,taskFor(state).goal.type==='paymentus_registration');if(taskFor(state).goal.type==='paymentus_preferences')state.paymentusPreferenceCredentials=JSON.stringify(state.accounts.map(a=>({id:a.id,credential:a.credential})));if(['paymentus_statement','paymentus_wallet','paymentus_autopay'].includes(taskFor(state).goal.type))state.paymentusReadOnlyCredentials=JSON.stringify(state.accounts.map(a=>({id:a.id,credential:a.credential})));
    }
    if(starnik(state)){for(const a of state.accounts){a.username=a.id==='acct-primary'?'alex.morgan':'jordan.lee';a.methods=[];a.starnikSecurityHash=hash(a.id==='acct-primary'?'GMG1048':'GMG2099');a.starnikServiceZip=a.id==='acct-primary'?'56001':'55001';}state.mail=[];send(state,'alex@billworld.test','Your local Greater Minnesota Gas account','Local test account 1001048 belongs to Alex Morgan. Username: alex.morgan. All balances and private account screens are simulated.');state.starnikBaseline=starnikBusiness(state);}
    if(cusi(state)){state.accounts[0].username='alex.morgan';state.accounts[1].username='jordan.lee';state.accounts[0].cusiPhone='4175550148';state.accounts[1].cusiPhone='4175550189';for(const a of state.accounts){a.methods=[];a.cusiProfile=null;}for(const inv of state.invoices)inv.dueDate=inv.dueDate.slice(0,8)+'15';state.mail=[];send(state,'alex@billworld.test','Your local Lockwood utility account','Synthetic account 1001048 belongs to Alex Morgan with associated phone 4175550148. Public registration entry is observed; lookup and continuation are simulated.');state.cusiRegistrationBaseline=cusiBusiness(state);}
    if(siteId==='swepsonville-water'){state.deposits=[{id:'dep-service',purpose:'deposit',accountId:'acct-primary',accountNumber:'1048-1',amountCents:15000},{id:'dep-other',purpose:'deposit',accountId:'acct-secondary',accountNumber:'2099-1',amountCents:20000}];state.accounts[0].serviceAddress='1048 River Road, Graham, NC 27253';state.accounts[1].serviceAddress='2099 River Road, Graham, NC 27253';state.accounts[0].cidHash=hash('C1048');state.accounts[1].cidHash=hash('C2099');for(const a of state.accounts)for(const m of a.methods)if(m.kind==='card')m.expiry='12/29';state.mail=[];send(state,'alex@billworld.test','Your Swepsonville utility bill','Account 1001048: the local current bill is $84.32.');}
    if(siteId==='gvp-electric'){for(const a of state.accounts){a.paperless=false;for(const m of a.methods)if(m.kind==='card')m.expiry='12/29';}state.mail=[];send(state,'alex@billworld.test','Your Grand Valley Power bill is ready','Account 1001048: current invoice totals $84.32.');}
    if (profileFlow(state)) {
      for (const a of state.accounts) {
        a.profileVerified = a.registered; a.billLinked = a.registered; a.paperless = false;
        a.profile = { firstName: a.name.split(' ')[0], lastName: a.name.split(' ').at(-1), phone: a.id === 'acct-primary' ? '9075550148' : '9075550299', address: '1048 Harbor Way', city: 'Homer', region: 'AK', postalCode: '99603' };
      }
    }
    if (duluth(state)) {
      for(const a of state.accounts){a.defaultMethodId=a.methods[0]?.id||null;for(const m of a.methods){m.version=1;m.name=a.name;if(m.kind==='card')m.expiry='12/29';}}
      Object.assign(state.accounts[0].methods[0],{instrumentHash:instrumentHash('bank','000001048','021000021')});
      Object.assign(state.accounts[0].methods[1],{instrumentHash:instrumentHash('card','4242424242424242')});
      Object.assign(state.accounts[0].methods[2],{instrumentHash:instrumentHash('card','4000000000000002')});
      state.accounts[0].customerNumber = '100001048-001'; state.accounts[1].customerNumber = '200002099-001';
      for (const a of state.accounts) Object.assign(a.profile, { city:'Duluth', region:'MN', postalCode:'55802', phone:'2185550148' });
      state.mail = []; send(state, 'alex@billworld.test', 'Your October ComfortSystems bill is ready', 'Account 100001048-001: current bill $84.32, due October 20, 2026.');
    }
    if (siteId === 'spotify' || duluth(state)) state.googleUsers = [
      { sub:'google-alex', email:'alex@billworld.test', name:'Alex Morgan', credential:credential('Google-2026!'), linkedAccountId:'acct-primary' },
      { sub:'google-jordan', email:'jordan@billworld.test', name:'Jordan Lee', credential:credential('OtherGoogle-2026!'), linkedAccountId:'acct-secondary' }
    ];
    if (siteId === 'spotify') {
      state.invoices = []; state.payments = []; state.mail = [];
      state.subscription = { accountId: 'acct-primary', plan: 'Premium Individual', amountCents: 1599, renewalDate: '2026-10-20', status: 'active', billingProvider: partnerBilling ? 'partner' : 'spotify', method: { kind: 'card', last4: '4242', label: 'Visa ending 4242' } };
      send(state, 'alex@billworld.test', 'Your Premium subscription receipt', 'Premium Individual is active. Your next billing date is October 20, 2026. Current card ends in 4242.');
    }
    if (trial !== undefined) state.trial = { metadata: trialMetadata(trial), startedAt: state.createdAt, deadlineAt: state.createdAt + taskFor(state).budget.seconds * 1000 };
    this.save(state);
    return this.fixture(state, mailboxPassword);
  }
  fixture(state, mailboxPassword = 'Mailbox-2026!') {
    return { episodeId: state.id, siteId: state.siteId || 'juneau-utilities', entryToken: state.entryToken, connectorToken: state.connectorToken, task: taskFor(state),
      credentials: { email: 'alex@billworld.test', ...(personaPay(state)?{}:{password:'Billworld-2026!'}), mailboxPassword, customerNumber: state.accounts[0].customerNumber, checking: { routing: '021000021', account: '000001048', name: 'Alex Morgan' }, ...(state.siteId === 'avec-electric' ? { lastName: 'Morgan', ssnLast4: '1048', phone: '9075550148' } : {}), ...(profileFlow(state) ? { profile: state.accounts[0].profile } : {}) },
      ...(['spotify','duluth-comfortsystems'].includes(state.siteId) ? { googleCredentials: { email: 'alex@billworld.test', password: 'Google-2026!' }, replacementCard: { name: 'Alex Morgan', number: '5555555555554444', expiry: '12/29', cvv: '123' } } : {}),
      ...(personaPay(state)?{dentalCredentials:{accountNumber:state.accounts[0].customerNumber,zipCode:state.accounts[0].personaPayZip,dateOfBirth:state.accounts[0].personaPayBirth}}:{}),
      ...(cusi(state)?{cusiCredentials:{username:'alex.morgan'}}:{}),
      ...(medical(state)?{medicalCredentials:{username:'alex.morgan',lastName:'Morgan',visitAccountNumber:'100104801'}}:{}), ...(state.siteId==='swepsonville-water'?{cid:'C1048'}:{}), seed: state.seed, evidenceCohort: taskFor(state).evidence_cohort, ...(state.trial ? { trial: state.trial } : {}) };
  }
  enter(id, token) { const s = this.state(id); need(sites.has(s.siteId)||this.construction&&constructionSites.has(s.siteId),'Construction episode is not enabled on this worker',404); need(token === s.entryToken, 'Invalid episode access', 403); return true; }
  connector(id, token) { const s = this.state(id); need(sites.has(s.siteId)||this.construction&&constructionSites.has(s.siteId),'Construction episode is not enabled on this worker',404); need(token === s.connectorToken, 'Mailbox access denied', 403); return s; }
  session(id, session) {
    const s = this.state(id); const auth = s.sessions[session];
    return { account: auth && auth.expires > s.now ? (paymentus(s)?paymentusIdentity(account(s,auth.accountId)):safeAccount(account(s, auth.accountId))) : null, site: siteFor(s), now: s.now };
  }
  paymentusAccount(id,session){
    return this.transact(id,s=>{need(paymentus(s),'Paymentus account unavailable',404);const a=authorized(s,session);event(s,'paymentus_account_viewed',{accountId:a.id});return{account:paymentusIdentity(a),links:(a.paymentusLinks||[]).map(link=>{const target=account(s,link.accountId),invoices=s.invoices.filter(i=>i.accountId===target.id).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.id.localeCompare(b.id)),latest=[...invoices].sort((a,b)=>b.dueDate.localeCompare(a.dueDate)||a.id.localeCompare(b.id))[0],payments=s.payments.filter(p=>p.accountId===target.id&&invoices.some(i=>i.id===p.invoiceId)),posted=i=>payments.filter(p=>p.invoiceId===i.id&&p.status==='posted').reduce((n,p)=>n+p.amountCents,0),due=invoices.find(i=>i.amountCents>posted(i))||latest;return{...link,customerNumber:target.customerNumber,name:target.name,serviceAddress:target.serviceAddress,latestInvoiceId:latest?.id||null,dueDate:due?.dueDate||null,amountDueCents:invoices.reduce((n,i)=>n+Math.max(0,i.amountCents-posted(i)),0),pendingCents:payments.filter(p=>p.status==='pending').reduce((n,p)=>n+p.amountCents,0),availableCents:invoices.reduce((n,i)=>n+available(s,i),0)};}),synthetic:true,capabilities:{login:true,recovery:true,registration:true,billing:true,bankPayment:true,cardPayment:true,wallet:true,savedMethodPayment:true}};});
  }
  paymentusPreferences(id,session,billingAccountId) {
    return this.transact(id,s=>{
      need(paymentus(s),'Paymentus preferences unavailable',404);const a=authorized(s,session),link=(a.paymentusLinks||[]).find(l=>l.accountId===billingAccountId);
      need(link,'Linked account not found',404);const target=account(s,link.accountId);
      event(s,'paymentus_preferences_viewed',{accountId:a.id,billingAccountId:target.id});
      return {accountId:target.id,customerNumber:target.customerNumber,serviceAddress:target.serviceAddress,paperless:link.paperless,emailNotification:link.emailNotification,smsNotification:link.smsNotification,synthetic:true};
    });
  }
  paymentusPreferencesUpdate(id,session,input) {
    return this.transact(id,s=>{
      need(paymentus(s),'Paymentus preferences unavailable',404);const a=authorized(s,session);
      need(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===4&&Object.keys(input).every(k=>['accountId','paperless','emailNotification','smsNotification'].includes(k)),'Choose only billing notification settings');
      need(['paperless','emailNotification','smsNotification'].every(k=>typeof input[k]==='boolean'),'Choose paperless and notification settings');
      const link=(a.paymentusLinks||[]).find(l=>l.accountId===input.accountId);need(link,'Linked account not found',404);
      const changes={paperless:input.paperless,emailNotification:input.emailNotification,smsNotification:input.smsNotification};
      if(Object.entries(changes).some(([k,v])=>link[k]!==v)){Object.assign(link,changes);event(s,'paymentus_preferences_changed',{accountId:a.id,billingAccountId:link.accountId,...changes});}
      return {...changes,accountId:link.accountId,synthetic:true};
    });
  }
  paymentusBills(id,session,billingAccountId=null){
    return this.transact(id,s=>{need(paymentus(s),'Paymentus bills unavailable',404);const a=authorized(s,session),ids=new Set((a.paymentusLinks||[]).map(l=>l.accountId));if(billingAccountId!==null){need(ids.has(billingAccountId),'Linked account not found',404);for(const accountId of ids)if(accountId!==billingAccountId)ids.delete(accountId);}event(s,'paymentus_bills_viewed',{accountId:a.id});return{invoices:s.invoices.filter(i=>ids.has(i.accountId)).map(i=>({...i,remainingCents:available(s,i)})),payments:s.payments.filter(p=>ids.has(p.accountId)),synthetic:true,paymentPolicy:siteFor(s).construction_payment_policy};});
  }
  paymentusAutoPay(id,session,billingAccountId){
    return this.transact(id,s=>{need(paymentus(s),'Paymentus AutoPay unavailable',404);const a=authorized(s,session);need(a.paymentusLinks.some(l=>l.accountId===billingAccountId),'Linked account not found',404);const target=account(s,billingAccountId),active=target.autopay,owned=!active.enabled||active.profileId===a.id;
      event(s,'paymentus_autopay_viewed',{accountId:a.id,billingAccountId});
      return{accountId:target.id,customerNumber:target.customerNumber,enabled:active.enabled,managedByThisProfile:owned,method:owned&&active.enabled?safeMethod(a.methods.find(m=>m.id===active.methodId)||{kind:'unavailable',label:'Unavailable method',last4:''}):null,methods:a.methods.map(safeMethod),nextDueDate:s.invoices.filter(i=>i.accountId===target.id&&utcDay(i.dueDate)>s.now&&available(s,i)>0).sort((x,y)=>x.dueDate.localeCompare(y.dueDate))[0]?.dueDate||null,policy:siteFor(s).construction_payment_policy,synthetic:true};});
  }
  paymentusAutoPayQuote(id,session,input){
    return this.transact(id,s=>{need(paymentus(s),'Paymentus AutoPay unavailable',404);const a=authorized(s,session);need(a.paymentusLinks.some(l=>l.accountId===input.accountId),'Linked account not found',404);const target=account(s,input.accountId);need(typeof input.enabled==='boolean','Choose an AutoPay setting');need(!target.autopay.enabled||target.autopay.profileId===a.id,'AutoPay is managed by another portal profile',403);
      let method={kind:'none',last4:'',label:'No automatic payment method'};
      if(input.enabled){const saved=a.methods.find(m=>m.id===input.methodId);need(saved,'Choose a saved payment method');if(saved.kind==='card')try{validateExpiry(saved.expiry,s.now);}catch(e){throw new Fault(e.message);}method=structuredClone(saved);}
      const token=secret(),q={purpose:'paymentus_autopay',profileId:a.id,accountId:target.id,session,enabled:input.enabled,method,feeCents:input.enabled?siteFor(s).construction_payment_policy[method.kind+'_fee_cents']:0,transactionMaxCents:siteFor(s).construction_payment_policy.transaction_max_cents,previous:JSON.stringify(target.autopay),expires:s.now+10*60000,applied:false};s.quotes[hash(token)]=q;event(s,'paymentus_autopay_reviewed',{accountId:a.id,billingAccountId:target.id,enabled:q.enabled});return{token,...this.safePaymentusAutoPay(q)};});
  }
  safePaymentusAutoPay(q){return{accountId:q.accountId,enabled:q.enabled,method:q.enabled?safeMethod(q.method):null,rule:'invoice_due_date',timezone:'UTC',feeCents:q.feeCents,transactionMaxCents:q.transactionMaxCents,applied:q.applied,synthetic:true};}
  paymentusAutoPayReview(id,session,token){const s=this.state(id);need(paymentus(s),'Paymentus AutoPay unavailable',404);const a=authorized(s,session),q=s.quotes[hash(String(token))];need(q?.purpose==='paymentus_autopay'&&q.profileId===a.id&&q.session===session&&a.paymentusLinks.some(l=>l.accountId===q.accountId),'AutoPay review unavailable',404);need(q.applied||q.expires>s.now,'AutoPay review expired',409);return this.safePaymentusAutoPay(q);}
  paymentusAutoPayConfirm(id,session,{token,authorize,acknowledgeCityDraft}){
    return this.transact(id,s=>{need(paymentus(s),'Paymentus AutoPay unavailable',404);const a=authorized(s,session),q=s.quotes[hash(String(token))];need(q?.purpose==='paymentus_autopay'&&q.profileId===a.id&&q.session===session&&a.paymentusLinks.some(l=>l.accountId===q.accountId),'AutoPay review unavailable',404);need(authorize===true,'Authorize this AutoPay change');if(q.enabled)need(acknowledgeCityDraft===true,'Confirm that you are not already enrolled in city bank draft');if(q.applied)return this.safePaymentusAutoPay(q);need(q.expires>s.now,'AutoPay review expired',409);const target=account(s,q.accountId);need(JSON.stringify(target.autopay)===q.previous,'AutoPay settings changed; review again',409);
      if(q.enabled){const m=a.methods.find(m=>m.id===q.method.id);need(m&&m.version===q.method.version&&m.instrumentHash===q.method.instrumentHash,'Saved method changed; review again',409);if(m.kind==='card')try{validateExpiry(m.expiry,s.now);}catch(e){throw new Fault(e.message);}}
      target.autopay={enabled:q.enabled,methodId:q.enabled?q.method.id:null,profileId:q.enabled?a.id:null,rule:'invoice_due_date',timezone:'UTC',enrolledAt:q.enabled?s.now:null};q.applied=true;event(s,'autopay_changed',{accountId:target.id,profileId:a.id,enabled:q.enabled,methodId:target.autopay.methodId});send(s,a.email,'Your local Paymentus AutoPay settings changed',`Utility account ${target.customerNumber}: AutoPay ${q.enabled?'enabled':'disabled'}. Local rule: one attempt per future invoice on its due date at 00:00 UTC. Fees apply to successful payments. This does not enroll or cancel the separate city bank-draft service.`);return this.safePaymentusAutoPay(q);});
  }
  paymentusWallet(id,session){return this.transact(id,s=>{need(paymentus(s),'Paymentus wallet unavailable',404);const a=authorized(s,session);event(s,'paymentus_wallet_viewed',{accountId:a.id});return{methods:a.methods.map(safeMethod),synthetic:true};});}
  paymentusQuote(id,session,input){
    return this.transact(id,s=>{
      need(paymentus(s),'Paymentus payment unavailable',404);const a=authorized(s,session),inv=s.invoices.find(i=>i.id===input.invoiceId&&(a.paymentusLinks||[]).some(l=>l.accountId===i.accountId));need(inv,'Linked bill not found',404);
      let method;
      if(input.methodId){need(Object.keys(input).every(k=>['invoiceId','amountCents','methodId'].includes(k)),'Use only the selected saved method');const saved=a.methods.find(m=>m.id===input.methodId);need(saved,'Payment method not found',404);method=structuredClone(saved);if(method.kind==='card')try{validateExpiry(method.expiry,s.now);}catch(e){throw new Fault(e.message);}}
      else try{method=walletInstrument(input,s.now);}catch(e){throw new Fault(e.message);}
      const policy=siteFor(s).construction_payment_policy,fee=policy?.[method.kind+'_fee_cents'];need(policy?.synthetic===true&&policy.supported_methods?.includes(method.kind)&&Number.isSafeInteger(fee)&&fee>=0&&Number.isSafeInteger(policy.transaction_max_cents)&&policy.transaction_max_cents>0,'Construction payment policy unavailable');
      need(Number.isSafeInteger(input.amountCents)&&input.amountCents>0&&input.amountCents<=available(s,inv)&&input.amountCents<=policy.transaction_max_cents,'Payment amount exceeds the unpaid bill or construction limit');
      const token=secret(),q={purpose:'paymentus',profileId:a.id,accountId:inv.accountId,invoiceId:inv.id,session,guest:false,amountCents:input.amountCents,feeCents:fee,method,receiptEmail:a.email,expires:s.now+10*60000,paymentId:null};s.quotes[hash(token)]=q;event(s,'paymentus_payment_reviewed',{accountId:a.id,billingAccountId:inv.accountId,invoiceId:inv.id});return{token,...this.safeQuote(q),synthetic:true};
    });
  }
  paymentusHistory(id,session,billingAccountId=null){
    return this.transact(id,s=>{
      need(paymentus(s),'Paymentus history unavailable',404);const a=authorized(s,session),ids=new Set((a.paymentusLinks||[]).map(l=>l.accountId));if(billingAccountId!==null){need(ids.has(billingAccountId),'Linked account not found',404);for(const accountId of ids)if(accountId!==billingAccountId)ids.delete(accountId);}
      const payments=s.payments.filter(p=>ids.has(p.accountId)).map(p=>({id:p.id,accountId:p.accountId,customerNumber:account(s,p.accountId).customerNumber,invoiceNumber:s.invoices.find(i=>i.id===p.invoiceId)?.number||null,amountCents:p.amountCents,feeCents:p.feeCents,totalCents:p.amountCents+p.feeCents,status:p.status,confirmation:p.confirmation,createdAt:p.createdAt,method:safeMethod(p.method)})).sort((a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id));
      event(s,'paymentus_payment_history_viewed',{accountId:a.id,paymentIds:payments.map(p=>p.id)});return{payments,synthetic:true,coverage:'Local seeded and submitted payments only; historical live retention/channel coverage unverified'};
    });
  }
  paymentusBillHistory(id,session,billingAccountId=null){
    return this.transact(id,s=>{
      need(paymentus(s),'Paymentus bill history unavailable',404);const a=authorized(s,session),ids=new Set((a.paymentusLinks||[]).map(l=>l.accountId));if(billingAccountId!==null){need(ids.has(billingAccountId),'Linked account not found',404);for(const accountId of ids)if(accountId!==billingAccountId)ids.delete(accountId);}
      const invoices=s.invoices.filter(i=>ids.has(i.accountId)).map(i=>{const payments=s.payments.filter(p=>p.invoiceId===i.id&&p.accountId===i.accountId),postedCents=payments.filter(p=>p.status==='posted').reduce((n,p)=>n+p.amountCents,0),pendingCents=payments.filter(p=>p.status==='pending').reduce((n,p)=>n+p.amountCents,0);return{...i,customerNumber:account(s,i.accountId).customerNumber,postedCents,pendingCents,remainingCents:available(s,i),status:postedCents>=i.amountCents?'paid':pendingCents>0?'payment_pending':'unpaid'};}).sort((a,b)=>b.dueDate.localeCompare(a.dueDate)||a.id.localeCompare(b.id));
      event(s,'paymentus_bill_history_viewed',{accountId:a.id,invoiceIds:invoices.map(i=>i.id)});return{invoices,synthetic:true,coverage:'Synthetic local bill summary; original bill PDFs, line items and live history retention unverified'};
    });
  }
  paymentusStatement(id,session,invoiceId){
    return this.transact(id,s=>{
      need(paymentus(s),'Paymentus statement unavailable',404);const profile=authorized(s,session);
      const inv=s.invoices.find(i=>i.id===invoiceId&&(profile.paymentusLinks||[]).some(l=>l.accountId===i.accountId));
      need(inv,'Linked bill not found',404);const target=account(s,inv.accountId);
      const document=paymentusStatementDocument({siteId:s.siteId,invoiceId:inv.id,accountId:inv.accountId,number:inv.number,period:inv.period,dueDate:inv.dueDate,amountCents:inv.amountCents,customerNumber:target.customerNumber,name:target.name,serviceAddress:target.serviceAddress});
      need(document,'Synthetic statement unavailable for this bill',404);
      event(s,'paymentus_statement_downloaded',{accountId:profile.id,billingAccountId:inv.accountId,invoiceId:inv.id,sha256:document.sha256});
      return document;
    });
  }
  paymentusReview(id,session,token,receipt=false){
    const s=this.state(id);need(paymentus(s),'Paymentus review unavailable',404);const a=authorized(s,session),q=s.quotes[hash(String(token))];need(q?.purpose==='paymentus'&&q.profileId===a.id&&q.session===session&&(a.paymentusLinks||[]).some(l=>l.accountId===q.accountId),'Payment review unavailable',404);
    if(receipt){need(q.paymentId,'Payment confirmation unavailable',404);return{payment:s.payments.find(p=>p.id===q.paymentId),synthetic:true};}
    need(!q.paymentId&&q.expires>s.now,'Payment review expired or completed',409);return{...this.safeQuote(q),synthetic:true};
  }
  paymentusPay(id,session,{token,authorize}){
    const s=this.state(id);need(paymentus(s),'Paymentus payment unavailable',404);const a=authorized(s,session),q=s.quotes[hash(String(token))];need(q?.purpose==='paymentus'&&q.profileId===a.id&&q.session===session&&(a.paymentusLinks||[]).some(l=>l.accountId===q.accountId),'Payment review unavailable',404);return this.pay(id,session,{token,authorize});
  }
  paymentusRegister(id,input){
    return this.transact(id,s=>{
      need(paymentus(s),'Paymentus registration unavailable',404);
      need(typeof input.email==='string'&&/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email),'Enter an Email Address');const a=s.accounts.find(a=>a.email===input.email.trim().toLowerCase());need(a&&!a.registered,'Account unavailable or already registered');
      need(typeof input.password==='string'&&input.password.length>=10&&input.password.length<=128,'Use a password between 10 and 128 characters');
      for(const key of ['firstName','lastName'])need(typeof input[key]==='string'&&input[key].trim().length>0&&input[key].length<=100,'Enter '+key);
      const phone=String(input.phone||'').replace(/[ ()+.-]/g,'');need(/^\d{10}$/.test(phone),'Enter a ten-digit Phone Number');need(typeof input.zipCode==='string'&&/^\d{5}$/.test(input.zipCode),'Enter a five-digit Zip Code');
      a.paymentusProfile={firstName:input.firstName.trim(),lastName:input.lastName.trim(),phone,zipCode:input.zipCode};a.registered=true;a.credential=credential(input.password);a.paymentusLinks=[];event(s,'paymentus_registered',{accountId:a.id});send(s,a.email,'Your local Batavia portal access was created','Portal access is ready. Verify your utility account number and service-address prefix to link your bill.');return this.issueSession(s,a);
    });
  }
  paymentusLinkVerify(id,session,input){
    return this.transact(id,s=>{
      need(paymentus(s),'Paymentus account linking unavailable',404);const a=authorized(s,session);need(typeof input.customerNumber==='string'&&typeof input.serviceAddressPrefix==='string','Enter account number and service-address prefix');need(typeof input.paperless==='boolean','Choose Paperless Yes or No');
      const target=s.accounts.find(t=>t.customerNumber===input.customerNumber.trim()&&t.serviceAddress.split(' ')[0]===input.serviceAddressPrefix.trim());need(target,'Account number and service address could not be verified');need(!a.paymentusLinks.some(link=>link.accountId===target.id),'Account already linked');
      for(const grant of Object.values(s.challenges))if(grant.kind==='paymentus_link'&&grant.accountId===a.id&&!grant.linked){grant.used=true;grant.superseded=true;}
      const token=secret();s.challenges[hash(token)]={kind:'paymentus_link',accountId:a.id,targetAccountId:target.id,session,paperless:input.paperless,used:false,expires:s.now+10*60000};event(s,'paymentus_account_verified',{accountId:a.id,billingAccountId:target.id});return{token,account:{customerNumber:target.customerNumber,name:target.name,serviceAddress:target.serviceAddress},paperless:input.paperless};
    });
  }
  paymentusLinkReview(id,session,token,receipt=false){
    const s=this.state(id);need(paymentus(s),'Paymentus account linking unavailable',404);const a=authorized(s,session),grant=s.challenges[hash(String(token))];need(grant?.kind==='paymentus_link'&&grant.accountId===a.id&&grant.session===session,'Account verification unavailable',401);need(receipt?grant.used&&!grant.superseded:!grant.used&&grant.expires>s.now,'Account verification expired or unavailable',401);const target=account(s,grant.targetAccountId);return{account:{customerNumber:target.customerNumber,name:target.name,serviceAddress:target.serviceAddress},paperless:grant.paperless,linked:grant.used};
  }
  paymentusLinkAdd(id,session,{token,authorize,emailNotification,smsNotification}){
    return this.transact(id,s=>{
      need(paymentus(s),'Paymentus account linking unavailable',404);const a=authorized(s,session),grant=s.challenges[hash(String(token))];need(grant?.kind==='paymentus_link'&&grant.accountId===a.id&&grant.session===session,'Account verification unavailable',401);if(grant.used&&grant.linked)return{linked:true};need(!grant.used&&grant.expires>s.now,'Account verification expired or unavailable',401);
      need(authorize===true,'Agree to the Payment Authorization Terms');need(typeof emailNotification==='boolean'&&typeof smsNotification==='boolean','Choose notification options');need(!a.paymentusLinks.some(link=>link.accountId===grant.targetAccountId),'Account already linked');a.paymentusLinks.push({accountId:grant.targetAccountId,paperless:grant.paperless,emailNotification,smsNotification});grant.used=true;grant.linked=true;event(s,'paymentus_account_linked',{accountId:a.id,billingAccountId:grant.targetAccountId,paperless:grant.paperless,emailNotification,smsNotification});return{linked:true};
    });
  }
  paymentusRecoveryGrant(id,token,opened=false){
    return this.transact(id,s=>{need(paymentus(s),'Paymentus recovery unavailable',404);const c=s.challenges[hash(String(token))];need(c?.kind==='reset'&&!c.used&&c.expires>s.now,'Reset link expired or unavailable',401);if(opened)event(s,'paymentus_recovery_link_opened',{accountId:c.accountId});return{available:true,synthetic:true};});
  }
  paymentusRecoveryComplete(id,{token,password,confirmPassword}){
    this.paymentusRecoveryGrant(id,token);need(password===confirmPassword,'Passwords must match');return this.resetPassword(id,{token,password});
  }
  starnikRegistrationRequest(id,{securityCode,email,confirmEmail}){return this.transact(id,s=>{need(starnik(s),'Starnik registration unavailable',404);need(typeof securityCode==='string'&&/^[a-zA-Z0-9.@_-]+$/.test(securityCode.trim()),'Enter a valid security code');need(typeof email==='string'&&email.length<=50&&/^[a-zA-Z0-9-_.]+@[a-zA-Z0-9-_.]+\.[a-zA-Z0-9_]+$/.test(email),'Enter a valid email address');need(typeof confirmEmail==='string'&&email.toLowerCase()===confirmEmail.toLowerCase(),'Email addresses must match');const a=s.accounts.find(a=>a.starnikSecurityHash===hash(securityCode.trim()));need(a,'Security code not found');need(!a.registered,'This account is already registered');need(email.toLowerCase()===a.email.toLowerCase(),'This construction fixture supports the utility contact mailbox only');return this.starnikIssueSignup(s,a,email.toLowerCase());});}
  starnikIssueSignup(s,a,email){for(const c of Object.values(s.challenges))if(c.kind==='starnik_signup'&&c.accountId===a.id)c.used=true;const token=secret(),pendingToken=secret();s.challenges[hash(token)]={kind:'starnik_signup',accountId:a.id,email,pendingHash:hash(pendingToken),expires:s.now+30*60000,verified:false,used:false,completed:false};send(s,email,'Verify your local GMG email',`Verify your email: /starnik/signup/verify?token=${token} . This local link expires in 30 minutes. You will then choose your username and password.`);event(s,'starnik_signup_requested',{accountId:a.id,email});return{pendingToken,email,message:'A verification email has been sent.'};}
  starnikRegistrationResend(id,pendingToken){return this.transact(id,s=>{need(starnik(s),'Starnik registration unavailable',404);const c=Object.values(s.challenges).find(c=>c.kind==='starnik_signup'&&c.pendingHash===hash(String(pendingToken))&&!c.used&&!c.verified&&c.expires>s.now);need(c,'Pending registration expired or unavailable',401);const a=account(s,c.accountId);need(!a.registered,'This account is already registered');return this.starnikIssueSignup(s,a,c.email);});}
  starnikRegistrationGrant(id,token,open=false){return this.transact(id,s=>{need(starnik(s),'Starnik registration unavailable',404);const c=s.challenges[hash(String(token))];need(c?.kind==='starnik_signup'&&(!c.used||c.completed)&&c.expires>s.now,'Registration link expired or unavailable',401);if(open&&!c.verified&&!c.completed){c.verified=true;event(s,'starnik_signup_verified',{accountId:c.accountId,email:c.email});}need(c.verified,'Open the verification email first',403);return{email:c.email,complete:c.completed,username:c.completed?account(s,c.accountId).username:null,synthetic:true};});}
  starnikRegistrationUsername(id,token,{username}){return this.transact(id,s=>{need(starnik(s),'Starnik registration unavailable',404);const c=s.challenges[hash(String(token))];need(c?.kind==='starnik_signup'&&c.verified&&!c.used&&c.expires>s.now,'Verified registration expired or unavailable',401);need(typeof username==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9.@_-]{5,49}$/.test(username),'Use a username of 6–50 letters, numbers, dots, @, underscores or hyphens');const available=!s.accounts.some(a=>a.registered&&a.username.toLowerCase()===username.toLowerCase());c.checkedUsername=available?username:null;event(s,'starnik_signup_username_checked',{accountId:c.accountId,username,available});return{available};});}
  starnikRegistrationComplete(id,token,{username,password,confirmPassword}){return this.transact(id,s=>{need(starnik(s),'Starnik registration unavailable',404);const c=s.challenges[hash(String(token))];need(c?.kind==='starnik_signup'&&c.verified&&(!c.used||c.completed)&&c.expires>s.now,'Verified registration expired or unavailable',401);if(c.completed)return{complete:true};const a=account(s,c.accountId);need(!a.registered,'This account is already registered');need(username===c.checkedUsername&&typeof username==='string','Check username availability first');need(!s.accounts.some(a=>a.registered&&a.username.toLowerCase()===username.toLowerCase()),'Username is no longer available');starnikPassword(password);need(password===confirmPassword,'Passwords must match');a.username=username;a.credential=credential(password);a.registered=true;c.used=true;c.completed=true;event(s,'starnik_registered',{accountId:a.id,email:c.email,username});send(s,c.email,'Your local GMG account was created','Your simulated account is ready. Sign in at /RP_Default.aspx.');return{complete:true};});}
  starnikRecoveryRequest(id,{kind,username,email}){
    return this.transact(id,s=>{need(starnik(s),'Starnik recovery unavailable',404);need(['username','password'].includes(kind),'Choose a recovery flow');let a;
      if(kind==='username'){need(typeof email==='string'&&email.length<=200&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Enter your email address');a=s.accounts.find(a=>a.registered&&a.email.toLowerCase()===email.toLowerCase());}
      else{need(typeof username==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9.@_-]{5,49}$/.test(username),'Enter a valid username of 6–50 characters without spaces');a=s.accounts.find(a=>a.registered&&a.username.toLowerCase()===username.toLowerCase());}
      if(a){if(kind==='username'){send(s,a.email,'Your local GMG username',`Your username is ${a.username}. Sign in at /RP_Default.aspx or request a password reset at /RP/forgot-password.`);event(s,'starnik_username_sent',{accountId:a.id});}
        else{for(const c of Object.values(s.challenges))if(c.kind==='starnik_reset'&&c.accountId===a.id)c.used=true;const token=secret();s.challenges[hash(token)]={kind:'starnik_reset',accountId:a.id,expires:s.now+15*60000,used:false};send(s,a.email,'Reset your local GMG password',`Reset your password: /starnik/reset?token=${token} . This local link expires in 15 minutes and can be used once.`);event(s,'starnik_reset_requested',{accountId:a.id});}}
      return{message:'If the account exists, a recovery email has been sent.'};});
  }
  starnikRecoveryGrant(id,token,opened=false){return this.transact(id,s=>{need(starnik(s),'Starnik recovery unavailable',404);const c=s.challenges[hash(String(token))];need(c?.kind==='starnik_reset'&&!c.used&&c.expires>s.now,'Reset link expired or unavailable',401);if(opened)event(s,'starnik_reset_opened',{accountId:c.accountId});return{available:true,synthetic:true};});}
  starnikRecoveryComplete(id,{token,password,confirmPassword}){return this.transact(id,s=>{need(starnik(s),'Starnik recovery unavailable',404);const c=s.challenges[hash(String(token))];need(c?.kind==='starnik_reset'&&!c.used&&c.expires>s.now,'Reset link expired or unavailable',401);
    starnikPassword(password);need(password===confirmPassword,'Passwords must match');const a=account(s,c.accountId);a.credential=credential(password);for(const grant of Object.values(s.challenges))if(grant.kind==='starnik_reset'&&grant.accountId===a.id)grant.used=true;for(const[key,value]of Object.entries(s.sessions))if(value.accountId===a.id)delete s.sessions[key];event(s,'starnik_password_reset',{accountId:a.id});send(s,a.email,'Your local GMG password changed','Your simulated password changed. Sign in at /RP_Default.aspx with your new password.');return{ok:true};});}
  starnikGuestLookup(id,{securityCode,serviceZip}){
    return this.transact(id,s=>{need(starnik(s),'Starnik guest lookup unavailable',404);
      need(typeof securityCode==='string'&&securityCode.length<=50&&/^[a-zA-Z0-9][a-zA-Z0-9_@.-]*$/.test(securityCode.trim()),'Enter a valid account security code');
      need(typeof serviceZip==='string'&&serviceZip.length<=10&&serviceZip.trim().length>0,'Enter a service ZIP code');
      const a=s.accounts.find(a=>a.starnikSecurityHash===hash(securityCode.trim())&&a.starnikServiceZip===serviceZip.trim());
      need(a,'We could not locate the account. Please verify the information and try again.',401);
      const token=randomBytes(24).toString('hex');s.challenges[hash(token)]={kind:'starnik_guest',accountId:a.id,expires:s.now+25*60000};
      event(s,'starnik_guest_verified',{accountId:a.id});return{token,synthetic:true};
    });
  }
  starnikGuestAccount(id,token){return this.transact(id,s=>{need(starnik(s),'Starnik guest lookup unavailable',404);const grant=s.challenges[hash(String(token))];need(grant?.kind==='starnik_guest'&&grant.expires>s.now,'Guest verification expired or unavailable',401);const a=account(s,grant.accountId);event(s,'starnik_guest_account_viewed',{accountId:a.id});return{account:{name:a.name,customerNumber:a.customerNumber},balanceCents:s.invoices.filter(i=>i.accountId===a.id).reduce((sum,i)=>sum+available(s,i),0),expiresAt:grant.expires,synthetic:true};});}
  starnikGuestGrant(s,token){need(starnik(s),'Starnik guest payment unavailable',404);const g=s.challenges[hash(String(token))];need(g?.kind==='starnik_guest'&&g.expires>s.now,'Guest verification expired or unavailable',401);return g;}
  starnikGuestQuote(id,guestToken,input){return this.transact(id,s=>{const g=this.starnikGuestGrant(s,guestToken),invoices=s.invoices.filter(i=>i.accountId===g.accountId).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));const balance=invoices.reduce((sum,i)=>sum+available(s,i),0);let validated;try{validated=starnikPayment(input,s.now,balance);}catch(e){throw new Fault(e.message);}let remaining=validated.amountCents;const allocations=[];for(const i of invoices){const amount=Math.min(remaining,available(s,i));if(amount>0)allocations.push({invoiceId:i.id,amountCents:amount});remaining-=amount;}
    const token=secret(),q={purpose:'starnik_guest',accountId:g.accountId,guestHash:hash(guestToken),...validated,allocations,feeCents:starnikFee(validated.method.kind,validated.amountCents,siteFor(s).documented_policy),expires:Math.min(g.expires,s.now+10*60000),receipt:null};s.quotes[hash(token)]=q;event(s,'starnik_guest_quoted',{accountId:g.accountId});return{token,...this.starnikSafeQuote(q)};});}
  starnikSafeQuote(q){return{amountCents:q.amountCents,feeCents:q.feeCents,totalCents:q.amountCents+q.feeCents,method:safeMethod(q.method),billing:q.billing,synthetic:true};}
  starnikGuestReview(id,guestToken,token,receipt=false){return this.transact(id,s=>{const g=this.starnikGuestGrant(s,guestToken),q=s.quotes[hash(String(token))];need(q?.purpose==='starnik_guest'&&q.guestHash===hash(guestToken)&&q.accountId===g.accountId,'Payment review unavailable',404);if(receipt){need(q.receipt,'Receipt unavailable',404);event(s,'starnik_guest_receipt_viewed',{accountId:g.accountId});return q.receipt;}need(!q.receipt&&q.expires>s.now,'Payment review expired or completed',409);q.reviewed=true;event(s,'starnik_guest_reviewed',{accountId:g.accountId});return this.starnikSafeQuote(q);});}
  starnikGuestPay(id,guestToken,token,{authorize}){return this.transact(id,s=>{const g=this.starnikGuestGrant(s,guestToken),q=s.quotes[hash(String(token))];need(q?.purpose==='starnik_guest'&&q.guestHash===hash(guestToken)&&q.accountId===g.accountId,'Payment review unavailable',404);need(authorize===true,'Authorize the reviewed payment');if(q.receipt)return q.receipt;need(q.reviewed&&q.expires>s.now,'Review the payment again');for(const allocation of q.allocations){const i=s.invoices.find(i=>i.id===allocation.invoiceId&&i.accountId===g.accountId);need(i&&available(s,i)>=allocation.amountCents,'The balance changed. Review your payment again.');}if(q.method.kind==='card')try{validateExpiry(q.method.expiry,s.now);}catch(e){throw new Fault(e.message);}if(q.method.decline){event(s,'starnik_guest_declined',{accountId:g.accountId});return{declined:true,message:'Your payment was declined. Choose another method.'};}
    const confirmation='BW-GMG-'+secret().slice(0,10).toUpperCase();for(const [index,allocation]of q.allocations.entries())s.payments.push({id:'pay-'+secret(),accountId:g.accountId,invoiceId:allocation.invoiceId,amountCents:allocation.amountCents,feeCents:index===0?q.feeCents:0,method:safeMethod(q.method),status:'posted',confirmation,createdAt:s.now});q.receipt={...this.starnikSafeQuote(q),confirmation,authorizationCode:'SIMULATED',paymentDate:new Date(s.now).toISOString(),status:'posted'};event(s,'starnik_guest_paid',{accountId:g.accountId,amountCents:q.amountCents,feeCents:q.feeCents,confirmation});if(q.billing.email)send(s,q.billing.email,'Your local GMG payment receipt','Payment $'+(q.amountCents/100).toFixed(2)+'; fee $'+(q.feeCents/100).toFixed(2)+'. Confirmation: '+confirmation+'. This is a simulated payment.');return q.receipt;});}
  starnikLogin(id,{username,password}){
    return this.transact(id,s=>{need(starnik(s),'Starnik login unavailable',404);need(typeof username==='string'&&username.trim().length>0&&username.length<=128,'Enter your username');const a=s.accounts.find(a=>a.registered&&a.username.toLowerCase()===username.trim().toLowerCase());need(a&&matches(password,a.credential),'Username or password is incorrect',401);event(s,'starnik_username_verified',{accountId:a.id});return this.issueSession(s,a);});
  }
  starnikAccount(id,session){
    return this.transact(id,s=>{need(starnik(s),'Starnik account unavailable',404);const a=authorized(s,session);event(s,'starnik_account_viewed',{accountId:a.id});return{account:{id:a.id,name:a.name,username:a.username,email:a.email,customerNumber:a.customerNumber},invoices:s.invoices.filter(i=>i.accountId===a.id).map(i=>({id:i.id,number:i.number,period:i.period,dueDate:i.dueDate,amountCents:i.amountCents,remainingCents:available(s,i)})),synthetic:true};});
  }
  cusiLogin(id,{username,password}){
    return this.transact(id,s=>{
      need(cusi(s),'CUSI login unavailable',404);
      need(typeof username==='string'&&username.trim().length>0&&username.length<=128,'Enter your username');
      const a=s.accounts.find(a=>a.registered&&a.username.toLowerCase()===username.trim().toLowerCase());
      need(a&&matches(password,a.credential),'Username or password is incorrect',401);
      event(s,'cusi_username_verified',{accountId:a.id});return this.issueSession(s,a);
    });
  }
  cusiAccount(id,session){
    return this.transact(id,s=>{need(cusi(s),'CUSI account unavailable',404);const a=authorized(s,session);event(s,'cusi_account_viewed',{accountId:a.id});return {...this.dashboard(id,session),username:a.username,capabilities:{billing:true,cardPayment:true,bankPayment:false,registrationContinuation:true},synthetic:true,paymentPolicy:siteFor(s).construction_payment_policy};});
  }
  cusiBill(id,session,invoiceId){
    return this.transact(id,s=>{need(cusi(s),'CUSI bill unavailable',404);const a=authorized(s,session),inv=s.invoices.find(i=>i.id===invoiceId&&i.accountId===a.id);need(inv,'Bill not found',404);event(s,'cusi_bill_viewed',{accountId:a.id,invoiceId:inv.id});return{invoice:{...inv,remainingCents:available(s,inv)},account:safeAccount(a),synthetic:true};});
  }
  cusiQuote(id,session,input){
    return this.transact(id,s=>{
      need(cusi(s),'CUSI payment unavailable',404);const a=authorized(s,session),inv=s.invoices.find(i=>i.id===input.invoiceId&&i.accountId===a.id);need(inv,'Bill not found',404);
      need(input.kind==='card','Bank verification is not implemented for this construction tenant');need(!input.methodId,'Saved methods are not implemented');
      need(Number.isSafeInteger(input.amountCents)&&input.amountCents>0&&input.amountCents<=available(s,inv),'Payment amount exceeds the unpaid invoice or is invalid');
      let method;try{method=walletInstrument(input,s.now);}catch(e){throw new Fault(e.message);}
      const policy=siteFor(s).construction_payment_policy;need(policy?.synthetic===true&&Number.isSafeInteger(policy.card_fee_cents)&&policy.card_fee_cents>=0,'Construction payment policy unavailable');
      const token=secret(),q={purpose:'cusi',invoiceId:inv.id,accountId:a.id,session,guest:false,amountCents:input.amountCents,feeCents:policy.card_fee_cents,method,expires:s.now+10*60000,paymentId:null};
      s.quotes[hash(token)]=q;event(s,'cusi_payment_reviewed',{accountId:a.id,invoiceId:inv.id});return{token,...this.safeQuote(q),synthetic:true};
    });
  }
  cusiReview(id,session,token,receipt=false){
    const s=this.state(id);need(cusi(s),'CUSI review unavailable',404);const a=authorized(s,session),q=s.quotes[hash(String(token))];need(q?.purpose==='cusi'&&q.session===session&&q.accountId===a.id,'Payment review not found',404);
    if(receipt){need(q.paymentId,'Payment confirmation not found',404);const p=s.payments.find(p=>p.id===q.paymentId);need(p,'Payment confirmation not found',404);return{payment:p,synthetic:true};}
    need(!q.paymentId&&q.expires>s.now,'Payment review expired or completed',409);return{...this.safeQuote(q),synthetic:true};
  }
  cusiPay(id,session,{token,authorize}){
    const s=this.state(id);need(cusi(s),'CUSI payment unavailable',404);const a=authorized(s,session),q=s.quotes[hash(String(token))];need(q?.purpose==='cusi'&&q.session===session&&q.accountId===a.id,'Payment review not found',404);return this.pay(id,session,{token,authorize});
  }
  cusiRegistrationLookup(id,{accountNumber,phone}){
    return this.transact(id,s=>{need(cusi(s),'CUSI registration unavailable',404);need(typeof accountNumber==='string'&&typeof phone==='string','Enter account number and phone');const digits=phone.replace(/[^0-9.]/g,'').slice(-10),a=s.accounts.find(a=>a.customerNumber===accountNumber.trim()&&a.cusiPhone===digits);need(a,'Account and associated phone do not match',404);for(const c of Object.values(s.challenges))if(c.kind==='cusi_registration'&&c.accountId===a.id&&!c.used)c.used=true;const token=secret();s.challenges[hash(token)]={kind:'cusi_registration',accountId:a.id,stage:'verify',reviewed:false,used:false,expires:s.now+10*60000};event(s,'cusi_registration_lookup',{accountId:a.id});return{token};});
  }
  cusiRegistrationState(id,token){
    return this.transact(id,s=>{need(cusi(s),'CUSI registration unavailable',404);if(!token)return{stage:'lookup'};const c=s.challenges[hash(String(token))];need(c?.kind==='cusi_registration'&&c.expires>s.now&&(!c.used||['complete','recovery_sent'].includes(c.stage)),'Registration expired or unavailable',401);const a=account(s,c.accountId);if(c.stage==='verify'){c.reviewed=true;event(s,'cusi_registration_reviewed',{accountId:a.id});}if(c.stage==='complete')event(s,'cusi_registration_complete_viewed',{accountId:a.id});return{stage:c.stage,account:{name:a.name,customerNumber:a.customerNumber,...(a.registered?{registered:true}:{})},passwordPolicy:cusiPasswordPolicy(s),profile:c.stage==='complete'?a.cusiProfile:null};});
  }
  cusiRegistrationRestart(id,token){return this.transact(id,s=>{need(cusi(s),'CUSI registration unavailable',404);const c=s.challenges[hash(String(token))];if(c?.kind==='cusi_registration'&&c.stage!=='complete'){c.used=true;c.stage='abandoned';}return{ok:true};});}
  cusiRegistrationConfirm(id,{token,confirmAccount}){
    return this.transact(id,s=>{need(cusi(s),'CUSI registration unavailable',404);const c=s.challenges[hash(String(token))];need(c?.kind==='cusi_registration'&&!c.used&&c.expires>s.now&&c.stage==='verify','Registration verification unavailable',401);need(c.reviewed&&confirmAccount===true,'Review and confirm the matched account');c.stage=account(s,c.accountId).registered?'registered':'user';event(s,'cusi_registration_confirmed',{accountId:c.accountId});return{ok:true};});
  }
  cusiRegistrationRecovery(id,token){return this.transact(id,s=>{need(cusi(s),'CUSI registration unavailable',404);const c=s.challenges[hash(String(token))];need(c?.kind==='cusi_registration'&&c.expires>s.now,'Registration verification expired or unavailable',401);if(c.used){need(c.stage==='recovery_sent','Registration verification unavailable',401);return{ok:true,idempotent:true};}need(c.stage==='registered'&&c.reviewed,'Review and confirm the registered account');const a=account(s,c.accountId);need(a.registered,'Account is not registered');cusiResetLink(s,a);c.used=true;c.stage='recovery_sent';event(s,'cusi_registration_recovery_sent',{accountId:a.id});return{ok:true,idempotent:false};});}
  cusiRegistrationComplete(id,{token,username,email,password,confirmPassword,consent}){
    return this.transact(id,s=>{need(cusi(s),'CUSI registration unavailable',404);const c=s.challenges[hash(String(token))];need(c?.kind==='cusi_registration'&&c.expires>s.now,'Registration expired or unavailable',401);if(c.used){need(c.stage==='complete','Registration unavailable',401);return{ok:true,idempotent:true};}need(c.stage==='user','Confirm the matched account first');const a=account(s,c.accountId);need(!a.registered,'Account already registered',409);need(typeof username==='string'&&username.trim().length>0&&username.trim().length<=128&&!/\s/.test(username.trim()),'Username cannot contain spaces and must be 1–128 characters');username=username.trim();need(!s.accounts.some(b=>b.id!==a.id&&b.registered&&b.username.toLowerCase()===username.toLowerCase()),'Username is not available',409);need(typeof email==='string'&&email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Enter a valid email address');email=email.trim().toLowerCase();need(!s.accounts.some(b=>b.id!==a.id&&(b.cusiProfile?.email||b.email).toLowerCase()===email),'Email is already enrolled',409);cusiPassword(s,password);need(password===confirmPassword,'Passwords must match');need(consent===true,'Accept terms and privacy agreement');a.username=username;a.cusiProfile={email};a.credential=credential(password);a.registered=true;c.used=true;c.stage='complete';for(const [key,session]of Object.entries(s.sessions))if(session.accountId===a.id)delete s.sessions[key];event(s,'registered',{accountId:a.id,identityMethod:'cusi_account_phone',consent:true});send(s,email,'Your local Lockwood account is registered','Your local account was created. Sign in with your new username and password.');return{ok:true,idempotent:false};});
  }
  cusiRecoveryRequest(id,{username}){
    return this.transact(id,s=>{
      need(cusi(s),'CUSI recovery unavailable',404);need(typeof username==='string'&&username.trim().length>0&&username.length<=128,'Enter your username');
      const a=s.accounts.find(a=>a.registered&&a.username.toLowerCase()===username.trim().toLowerCase());
      if(a)cusiResetLink(s,a);
      return{ok:true,message:'If the username is enrolled, an email link has been sent.'};
    });
  }
  cusiRecoveryGrant(id,token){const s=this.state(id);need(cusi(s),'CUSI recovery unavailable',404);const c=s.challenges[hash(String(token))];need(c?.kind==='cusi_reset'&&!c.used&&c.expires>s.now,'Reset link expired or unavailable',401);return{available:true,synthetic:true,passwordPolicy:cusiPasswordPolicy(s)};}
  cusiRecoveryComplete(id,{token,password,confirmPassword}){
    return this.transact(id,s=>{
      need(cusi(s),'CUSI recovery unavailable',404);const c=s.challenges[hash(String(token))];need(c?.kind==='cusi_reset'&&!c.used&&c.expires>s.now,'Reset link expired or unavailable',401);
      cusiPassword(s,password);need(password===confirmPassword,'Passwords must match');
      const a=account(s,c.accountId);a.credential=credential(password);for(const grant of Object.values(s.challenges))if(grant.accountId===a.id&&grant.kind==='cusi_reset')grant.used=true;
      for(const [key,session]of Object.entries(s.sessions))if(session.accountId===a.id)delete s.sessions[key];
      event(s,'password_reset',{accountId:a.id,identityMethod:'cusi_email_link'});send(s,a.cusiProfile?.email||a.email,'Your local Lockwood password changed','Your simulated password changed. Sign in with the new password.');return{ok:true};
    });
  }
  identityBegin(id, {email}) {
    return this.transact(id, s => { need(duluth(s), 'Email-first login unavailable', 404); need(typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200, 'Enter an email address');
      const token=secret(); s.challenges[hash(token)]={kind:'identity_email',email,expires:s.now+10*60000,used:false}; return {challenge:token,email}; });
  }
  medicalIdentityBegin(id, { username }) {
    return this.transact(id,s=>{need(medical(s),'Medical login unavailable',404);need(typeof username==='string'&&/^[a-zA-Z0-9_.@-]{1,128}$/.test(username),'Enter your MyWVUChart username');const token=secret();s.challenges[hash(token)]={kind:'medical_identity',username,used:false,expires:s.now+10*60000};return{challenge:token,username};});
  }
  medicalRecoveryRequest(id,{contact}){
    return this.transact(id,s=>{
      need(medical(s),'Medical recovery unavailable',404);
      need(typeof contact==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)&&contact.length<=200,'Use the enrolled email address; text recovery is unavailable in this fixture');
      const email=contact.trim().toLowerCase(),a=s.accounts.find(a=>a.registered&&a.recoveryEmail===email);
      if(a)for(const c of Object.values(s.challenges))if(c.accountId===a.id&&['medical_recovery_code','medical_recovery_grant'].includes(c.kind))c.used=true;
      const token=secret(),code=String(randomInt(100000,1000000));
      s.challenges[hash(token)]={kind:'medical_recovery_code',accountId:a?.id||null,codeHash:hash(code),expires:s.now+10*60000,used:false,attempts:0};
      if(a)send(s,a.email,'Your MyWVUChart recovery code',`Your local recovery code is ${code}. It expires in 10 minutes and can be used once. This is a synthetic email verification challenge.`);
      return{challengeToken:token,message:'If this email address is enrolled, a recovery code has been sent.'};
    });
  }
  medicalRecoveryStatus(id,challengeToken,grantToken){
    const s=this.state(id);need(medical(s),'Medical recovery unavailable',404);
    const grant=s.challenges[hash(String(grantToken))];
    if(grant?.kind==='medical_recovery_grant'&&!grant.used&&grant.expires>s.now)return{phase:'password',username:account(s,grant.accountId).username};
    const code=s.challenges[hash(String(challengeToken))];
    return{phase:code?.kind==='medical_recovery_code'&&!code.used&&code.expires>s.now&&code.attempts<5?'code':'contact'};
  }
  medicalRecoveryVerify(id,token,{code}){
    const result=this.transact(id,s=>{
      need(medical(s),'Medical recovery unavailable',404);const c=s.challenges[hash(String(token))];
      if(c?.kind!=='medical_recovery_code'||c.used||c.expires<=s.now||c.attempts>=5)return{error:'Recovery code expired or unavailable'};
      c.attempts++;
      if(!c.accountId||typeof code!=='string'||hash(code)!==c.codeHash)return{error:'Recovery code is incorrect'};
      c.used=true;const grant=secret();s.challenges[hash(grant)]={kind:'medical_recovery_grant',accountId:c.accountId,used:false,expires:s.now+10*60000};
      event(s,'medical_recovery_verified',{accountId:c.accountId});return{grantToken:grant};
    });
    if(result.error)throw new Fault(result.error,401);return result;
  }
  medicalRecoveryComplete(id,token,{password,confirmPassword}){
    return this.transact(id,s=>{
      need(medical(s),'Medical recovery unavailable',404);const grant=s.challenges[hash(String(token))];
      need(grant?.kind==='medical_recovery_grant'&&!grant.used&&grant.expires>s.now,'Recovery verification expired or unavailable',401);
      need(typeof password==='string'&&password.length>=10&&password.length<=128&&password===confirmPassword,'Use matching passwords between 10 and 128 characters');
      const a=account(s,grant.accountId);need(a.registered,'Account unavailable',401);a.credential=credential(password);grant.used=true;
      for(const [key,session]of Object.entries(s.sessions))if(session.accountId===a.id)delete s.sessions[key];
      for(const c of Object.values(s.challenges))if(c.accountId===a.id&&['medical_recovery_code','medical_recovery_grant','otp'].includes(c.kind))c.used=true;
      event(s,'password_reset',{accountId:a.id,identityMethod:'medical_email_code'});send(s,a.email,'Your MyWVUChart password changed','Your local password has been reset. Sign in with the new password.');return{ok:true};
    });
  }
  medicalActivationVerify(id,{part1,part2}){
    const result=this.transact(id,s=>{
      need(medical(s),'Medical activation unavailable',404);
      const key=typeof part1==='string'&&typeof part2==='string'&&/^[A-Z0-9]{5}$/i.test(part1)&&/^[A-Z0-9]{5}$/i.test(part2)?hash((part1+part2).toUpperCase()):'';
      const code=s.challenges[key];
      if((s.medicalActivationFailures||0)>=5||!code||code.kind!=='medical_activation_code'||code.used||code.expires<=s.now||account(s,code.accountId).registered){s.medicalActivationFailures=(s.medicalActivationFailures||0)+1;return{error:'Activation code expired or unavailable'};}
      code.used=true;
      const token=secret();s.challenges[hash(token)]={kind:'medical_activation_setup',accountId:code.accountId,expires:s.now+10*60000,used:false};
      event(s,'medical_activation_verified',{accountId:code.accountId});return{setupToken:token};
    });
    if(result.error)throw new Fault(result.error,401);return result;
  }
  medicalActivationSetup(id,token){
    const s=this.state(id);need(medical(s),'Medical activation unavailable',404);const grant=s.challenges[hash(String(token))];
    need(grant?.kind==='medical_activation_setup'&&!grant.used&&grant.expires>s.now&&!account(s,grant.accountId).registered,'Activation setup expired or unavailable',401);
    const a=account(s,grant.accountId);return{email:a.email,username:a.username};
  }
  medicalActivationComplete(id,token,{username,password,confirmPassword}){
    return this.transact(id,s=>{
      need(medical(s),'Medical activation unavailable',404);const grant=s.challenges[hash(String(token))];
      need(grant?.kind==='medical_activation_setup'&&!grant.used&&grant.expires>s.now,'Activation setup expired or unavailable',401);
      const a=account(s,grant.accountId);need(!a.registered,'Account already registered');
      need(typeof username==='string'&&/^[a-zA-Z0-9_.-]{1,128}$/.test(username),'Choose a username using letters, numbers, dots, underscores or hyphens');
      const normalized=username.toLowerCase();need(!s.accounts.some(other=>other.id!==a.id&&other.username.toLowerCase()===normalized),'Username unavailable');
      need(typeof password==='string'&&password.length>=10&&password.length<=128&&password===confirmPassword,'Use matching passwords between 10 and 128 characters');
      a.username=normalized;a.credential=credential(password);a.registered=true;grant.used=true;
      event(s,'registered',{accountId:a.id,identityMethod:'activation_code'});send(s,a.email,'Your MyWVUChart account is ready','Your local account has been activated. Sign in using your chosen username and password.');return{registered:true};
    });
  }
  login(id, { email, username, password, identityChallenge }) {
    return this.transact(id, s => {
      need(!starnik(s),'Use Starnik username login',404);
      need(!cusi(s),'Use CUSI username login',404);
      need(!personaPay(s), 'Use account number, ZIP code and date of birth', 404);
      let identity; if (duluth(s)) { identity=s.challenges[hash(String(identityChallenge))]; need(identity && identity.kind==='identity_email' && identity.email===email && !identity.used && identity.expires>s.now, 'Enter your email before the password', 401); }
      if(medical(s)){identity=s.challenges[hash(String(identityChallenge))];need(identity?.kind==='medical_identity'&&!identity.used&&identity.expires>s.now&&identity.username===username,'Enter your username before the password',401);}
      const a = s.accounts.find(a => (medical(s)?a.username===username:a.email===email) && a.registered);
      need(a && matches(password, a.credential), 'Email or password is incorrect', 401);
      need(!profileFlow(s) || a.profileVerified, 'Verify your email before signing in', 401);
      if(a.mustChangePassword){need(a.tempExpires>s.now,'Temporary password expired',401);const token=secret();s.challenges[hash(token)]={kind:'first_password_change',accountId:a.id,expires:s.now+5*60000,used:false};a.tempExpires=0;event(s,'temporary_password_verified',{accountId:a.id});return {changeToken:token};}
      if (identity) identity.used=true;
      if (s.emailOtp) {
        for (const c of Object.values(s.challenges)) if (c.accountId === a.id && c.kind === 'otp') c.used = true;
        const token = secret(); const code = String(randomBytes(4).readUInt32BE() % 1000000).padStart(6, '0');
        s.challenges[hash(token)] = { kind: 'otp', accountId: a.id, code, expires: s.now + 5 * 60000, used: false, attempts: 0 };
        send(s, a.email, 'Your sign-in verification code', `Your code is ${code}. It expires in 5 minutes. If you request a new code, use the newest message.`);
        event(s, 'challenge_sent', { accountId: a.id }); return { challenge: token };
      }
      return this.issueSession(s, a);
    });
  }
  personaPayLoginStatus(id) {
    const s = this.state(id); need(personaPay(s), 'PersonaPay login unavailable', 404);
    return { captchaRequired: s.personaPayFailures >= 3 };
  }
  personaPayLogin(id, input) {
    need(personaPay(this.state(id)), 'PersonaPay login unavailable', 404);
    let identifiers; try { identifiers = personaPayIdentifiers(input); } catch (error) { throw new Fault(error.message); }
    // Failed matches must commit before raising a Fault; otherwise rollback loses the counter.
    const result = this.transact(id, s => {
      if (s.personaPayFailures >= 3 && input.captcha !== true) return { error: 'Complete the local CAPTCHA', status: 403 };
      const a = s.accounts.find(a => a.customerNumber === identifiers.accountNumber && a.personaPayZip === identifiers.zipCode && a.personaPayBirth === identifiers.dateOfBirth);
      if (!a) {
        s.personaPayFailures++;
        event(s, 'personapay_login_failed', { captchaRequired: s.personaPayFailures >= 3 });
        return { error: 'Account details could not be verified', status: 401 };
      }
      s.personaPayFailures = 0;
      event(s, 'personapay_identity_verified', { accountId: a.id });
      return this.issueSession(s, a);
    });
    need(!result.error, result.error, result.status); return result;
  }
  personaPayStatement(id,session) {
    const s=this.state(id);need(personaPay(s),'PersonaPay account unavailable',404);const a=authorized(s,session);
    const invoices=s.invoices.filter(i=>i.accountId===a.id).map(i=>({...i,remainingCents:available(s,i)}));
    const payments=s.payments.filter(p=>p.accountId===a.id);
    return {account:safeAccount(a),invoices,balanceCents:invoices.reduce((n,i)=>n+i.remainingCents,0),creditCents:payments.filter(p=>p.status==='posted').reduce((n,p)=>n+(p.creditCents||0),0),pendingCreditCents:payments.filter(p=>p.status==='pending').reduce((n,p)=>n+(p.creditCents||0),0),payments};
  }
  personaPayQuote(id,session,input) {
    return this.transact(id,s=>{
      need(personaPay(s),'PersonaPay payment unavailable',404);const a=authorized(s,session);
      need(!input.methodId,'This tenant does not offer a stored wallet');
      const eligible=s.invoices.filter(i=>i.accountId===a.id&&available(s,i)>0);
      const ids=input.invoiceIds===undefined?eligible.map(i=>i.id):input.invoiceIds;
      need(Array.isArray(ids)&&ids.length&&new Set(ids).size===ids.length,'Select unpaid charges');
      const lines=ids.map(id=>{const i=eligible.find(i=>i.id===id);need(i,'Selected charge is unavailable',403);return {invoiceId:i.id,balanceCents:available(s,i)};});
      let method,distribution;try{method=walletInstrument(input,s.now);distribution=personaPayDistribution(lines,input.amountCents,input.allocations);}catch(error){throw new Fault(error.message);}
      const token=secret();const q={purpose:'personapay',accountId:a.id,session,amountCents:input.amountCents,feeCents:0,method,lines,...distribution,expires:s.now+10*60000,paymentId:null};
      s.quotes[hash(token)]=q;return {token,...this.safePersonaPayQuote(q)};
    });
  }
  safePersonaPayQuote(q){return {amountCents:q.amountCents,feeCents:0,totalCents:q.amountCents,method:safeMethod(q.method),allocations:q.allocations,creditCents:q.creditCents};}
  personaPayReview(id,session,token){
    const s=this.state(id);need(personaPay(s),'PersonaPay payment unavailable',404);authorized(s,session);
    const q=s.quotes[hash(String(token))];need(q?.purpose==='personapay'&&q.session===session&&!q.paymentId&&q.expires>s.now,'Payment review expired or unavailable',401);return this.safePersonaPayQuote(q);
  }
  personaPayPay(id,session,{token}){
    return this.transact(id,s=>{
      need(personaPay(s),'PersonaPay payment unavailable',404);const a=authorized(s,session);
      const q=s.quotes[hash(String(token))];need(q?.purpose==='personapay'&&q.accountId===a.id&&q.session===session,'Payment review unavailable',403);
      if(q.paymentId)return s.payments.find(p=>p.id===q.paymentId);
      need(q.expires>s.now,'Payment review expired',401);
      need(q.lines.every(l=>available(s,s.invoices.find(i=>i.id===l.invoiceId))===l.balanceCents),'The balance changed. Review your payment again.',409);
      if(q.method.decline){event(s,'payment_declined',{accountId:a.id});return {declined:true,message:'Your payment was declined. Choose another method.'};}
      const p={id:`pay-${s.payments.length+1}`,purpose:'personapay',accountId:a.id,amountCents:q.amountCents,feeCents:0,method:safeMethod(q.method),allocations:q.allocations,creditCents:q.creditCents,status:s.pending?'pending':'posted',confirmation:`DPAY-${s.seed}-${s.payments.length+1}`,createdAt:s.now,initial:false,authenticated:true};
      s.payments.push(p);q.paymentId=p.id;event(s,'payment_submitted',{accountId:a.id,paymentId:p.id});
      send(s,a.email,'Your local dental payment confirmation',`Payment $${(p.amountCents/100).toFixed(2)}, fee $0.00, status ${p.status}. Confirmation: ${p.confirmation}. Local credit: $${(p.creditCents/100).toFixed(2)}. Allocation, credit and posting are simulated.`);
      return p;
    });
  }
  personaPayReceipt(id,session,token){const s=this.state(id);need(personaPay(s),'PersonaPay receipt unavailable',404);const a=authorized(s,session),q=s.quotes[hash(String(token))];need(q?.purpose==='personapay'&&q.accountId===a.id&&q.session===session&&q.paymentId,'Receipt unavailable',401);return s.payments.find(p=>p.id===q.paymentId);}
  personaPayPlanQuote(id,session,input){
    return this.transact(id,s=>{
      need(personaPay(s),'Dental plans unavailable',404);const a=authorized(s,session);
      need(input.type!=='recurring'||!(s.dentalPlans||[]).some(p=>p.type==='recurring'&&p.accountId===a.id&&['active','needs_attention'].includes(p.status)),'An open recurring plan already exists',409);
      const ids=input.invoiceIds;need(Array.isArray(ids)&&ids.length&&new Set(ids).size===ids.length,'Select unpaid charges');
      const lines=ids.map(id=>{const inv=s.invoices.find(i=>i.id===id);need(inv&&inv.accountId===a.id&&available(s,inv)>0,'Selected charge is unavailable',403);return {invoiceId:id,balanceCents:available(s,inv)};});
      let schedule,method;try{schedule=dentalPlanSchedule(input,lines,s.now);method=walletInstrument(input,s.now);for(const i of schedule.installments)personaPayDistribution(lines,i.amountCents);if(schedule.initialCents)personaPayDistribution(lines,schedule.initialCents);}catch(e){throw new Fault(e.message);}
      const token=secret(),q={purpose:'dental_plan',accountId:a.id,session,type:input.type,lines,invoiceIds:ids,method,...schedule,expires:s.now+10*60000,planId:null};s.quotes[hash(token)]=q;return {token,...this.safeDentalPlan(q)};
    });
  }
  safeDentalPlan(p){return {id:p.id,type:p.type,accountId:p.accountId,status:p.status,invoiceIds:p.invoiceIds,totalCents:p.totalCents,initialCents:p.initialCents,recurrence:p.recurrence,method:safeMethod(p.method),installments:p.installments,confirmation:p.confirmation};}
  personaPayPlans(id,session){const s=this.state(id);need(personaPay(s),'Dental plans unavailable',404);const a=authorized(s,session);return (s.dentalPlans||[]).filter(p=>p.accountId===a.id).map(p=>this.safeDentalPlan(p));}
  personaPayPlanReview(id,session,token){const s=this.state(id);need(personaPay(s),'Dental plans unavailable',404);authorized(s,session);const q=s.quotes[hash(String(token))];need(q?.purpose==='dental_plan'&&q.session===session&&!q.planId&&q.expires>s.now,'Plan review expired or unavailable',401);return this.safeDentalPlan(q);}
  personaPayPlanEnroll(id,session,{token,authorize}){
    return this.transact(id,s=>{
      need(personaPay(s),'Dental plans unavailable',404);const a=authorized(s,session),q=s.quotes[hash(String(token))];
      need(q?.purpose==='dental_plan'&&q.session===session&&q.accountId===a.id,'Plan review unavailable',403);need(authorize===true,'Authorize the scheduled payments');
      if(q.planId)return this.safeDentalPlan(s.dentalPlans.find(p=>p.id===q.planId));
      need(q.expires>s.now,'Plan review expired',401);
      s.dentalPlans||=[];need(q.type!=='recurring'||!s.dentalPlans.some(p=>p.type==='recurring'&&p.accountId===a.id&&['active','needs_attention'].includes(p.status)),'An open recurring plan already exists',409);
      need(q.lines.every(l=>{const inv=s.invoices.find(i=>i.id===l.invoiceId);return inv&&available(s,inv)===l.balanceCents;}),'The balance changed. Review your plan again.',409);
      const p={...q,id:`dental-plan-${s.dentalPlans.length+1}`,status:'active',createdAt:s.now,confirmation:`DPLAN-${s.seed}-${s.dentalPlans.length+1}`};delete p.session;delete p.expires;delete p.planId;
      s.dentalPlans.push(p);q.planId=p.id;event(s,'dental_plan_enrolled',{accountId:a.id,planId:p.id,planType:p.type});
      if(p.initialCents){const payment=this.dentalPlanPost(s,p,q.lines,p.initialCents,true);p.initialPaymentId=payment.id;if(payment.status==='failed'){p.status='closed_initial_decline';for(const i of p.installments)i.status='cancelled';}}
      send(s,a.email,'Your local dental payment plan',`Plan ${p.confirmation}, total $${(p.totalCents/100).toFixed(2)}, status ${p.status}. Scheduled payments are simulated; your stored wallet and utility AutoPay were not changed.`);
      return this.safeDentalPlan(p);
    });
  }
  personaPayPlanCancel(id,session,{planId}){
    return this.transact(id,s=>{need(personaPay(s),'Dental plans unavailable',404);const a=authorized(s,session),p=s.dentalPlans?.find(p=>p.id===planId);need(p&&p.accountId===a.id,'Plan unavailable',404);if(['active','needs_attention'].includes(p.status)){p.status='cancelled';for(const i of p.installments)if(i.status==='scheduled')i.status='cancelled';event(s,'dental_plan_cancelled',{accountId:a.id,planId:p.id});send(s,a.email,'Your local dental plan was cancelled',`Plan ${p.confirmation} cancelled. Completed payments were not refunded; no further installments will run.`);}return this.safeDentalPlan(p);});
  }
  dentalPlanPost(s,plan,lines,amount,initial=false){
    let failure=plan.method.decline?'declined':null;if(plan.method.kind==='card')try{validateExpiry(plan.method.expiry,s.now);}catch{failure='card_expired';}
    let distribution;try{distribution=personaPayDistribution(lines,amount,undefined,!initial);}catch{failure||='allocation_unavailable';}
    const p={id:`pay-${s.payments.length+1}`,purpose:'personapay',accountId:plan.accountId,amountCents:amount,feeCents:0,method:safeMethod(plan.method),allocations:failure?[]:distribution.allocations,creditCents:0,status:failure?'failed':s.pending?'pending':'posted',confirmation:`DPSCHED-${s.seed}-${s.payments.length+1}`,createdAt:s.now,initial:false,source:'dental_plan',planId:plan.id,...(failure?{failureReason:failure}:{})};
    s.payments.push(p);event(s,failure?'payment_declined':'payment_submitted',{accountId:p.accountId,paymentId:p.id,planId:plan.id,source:'dental_plan'});
    send(s,account(s,p.accountId).email,failure?'Your local dental installment failed':'Your local dental installment confirmation',`Plan ${plan.confirmation}: $${(amount/100).toFixed(2)}, status ${p.status}. Confirmation ${p.confirmation}. Execution and balance adjustments are simulated.`);return p;
  }
  issueSession(s, a) { need(!a.mustChangePassword,'Change the temporary password first',403);const token = secret(); s.sessions[token] = { accountId: a.id, expires: s.now + (medical(s)?10:30) * 60000 }; event(s, 'login', { accountId: a.id }); return { session: token, account: paymentus(s)?paymentusIdentity(a):safeAccount(a) }; }
  medicalActivity(id,session){const s=this.state(id);if(!medical(s)||s.finished||!s.sessions[session]||s.sessions[session].expires<=s.now)return;return this.transact(id,s=>{s.sessions[session].expires=s.now+10*60000;});}
  medicalReceipt(id,token){const s=this.state(id);need(medical(s),'Medical receipt unavailable',404);const q=s.quotes[hash(String(token))];need(q?.paymentId&&q.receiptExpires>s.now,'Receipt unavailable or expired',401);const p=s.payments.find(p=>p.id===q.paymentId);return{payment:{...p,visitAccountNumber:s.invoices.find(i=>i.id===p.invoiceId).visitAccountNumber}};}
  medicalReview(id,session,token){const s=this.state(id);need(medical(s),'Medical review unavailable',404);const q=s.quotes[hash(String(token))];need(q&&!q.paymentId&&q.expires>s.now,'Payment review expired or already submitted',401);if(q.session){authorized(s,session);need(q.session===session,'Payment session changed',403);}const inv=s.invoices.find(i=>i.id===q.invoiceId),a=account(s,q.accountId);return{...this.safeQuote(q),guest:q.guest,invoice:{...inv,remainingCents:available(s,inv)},account:{id:a.id,customerNumber:a.customerNumber,name:a.name}};}
  verifyOtp(id, { challenge, code }) {
    // Persist failed attempts too; throwing inside a transaction would undo them.
    const result = this.transact(id, s => {
      const c = s.challenges[hash(String(challenge))];
      if (!c || c.kind !== 'otp' || c.used || c.expires <= s.now || c.attempts >= 5) return { error: 'Verification code expired or unavailable' };
      c.attempts++;
      if (code !== c.code) return { error: 'Verification code is incorrect' };
      c.used = true; event(s, 'email_mfa_verified', { accountId: c.accountId }); return this.issueSession(s, account(s, c.accountId));
    });
    need(!result.error, result.error || 'Verification failed', 401); return result;
  }
  logout(id, token) { return this.transact(id, s => { delete s.sessions[token]; return { ok: true }; }); }
  resetRequest(id, { email, customerNumber, lastName }) {
    return this.transact(id, s => {
      need(!cusi(s),'Use username-based CUSI recovery',404);
      need(!personaPay(s), 'Password recovery is unavailable for this identifier login', 404);
      need(!medical(s),'Use MyWVUChart email-code recovery',404);
      const a = s.accounts.find(a => a.email === email && a.registered && (!smartHub(s) || a.customerNumber === customerNumber && a.name.toLowerCase().endsWith(' ' + String(lastName).trim().toLowerCase())));
      if (a) {
        for (const c of Object.values(s.challenges)) if (c.accountId === a.id && c.kind === 'reset') c.used = true;
        const token = secret(); s.challenges[hash(token)] = { kind: 'reset', accountId: a.id, expires: s.now + 15 * 60000, used: false };
        if(paymentus(s))event(s,'paymentus_recovery_requested',{accountId:a.id});
        send(s, a.email, paymentus(s)?'Reset your local Batavia portal password':'Reset your Billworld portal password', `Open ${paymentus(s)?'/paymentus/reset':'/portal/reset'}?token=${token} to choose a new password. This simulated link expires in 15 minutes and can be used once.`);
      }
      return { ok: true, message: 'If the account exists, a reset link has been sent.' };
    });
  }
  resetPassword(id, { token, password }) {
    return this.transact(id, s => {
      const c = s.challenges[hash(String(token))];
      need(c && c.kind === 'reset' && !c.used && c.expires > s.now, 'Reset link expired or already used');
      if (duluth(s)) duluthPassword(password,account(s,c.accountId).email);
      else if (profileFlow(s)) profilePassword(password);
      else need(typeof password === 'string' && password.length >= 10 && password.length <= 128, 'Use a password between 10 and 128 characters');
      const a = account(s, c.accountId); a.credential = credential(password);if(s.siteId==='gvp-electric'){a.mustChangePassword=false;a.tempExpires=0;for(const grant of Object.values(s.challenges))if(grant.accountId===a.id&&grant.kind==='first_password_change')grant.used=true;} c.used = true;
      for (const [key, session] of Object.entries(s.sessions)) if (session.accountId === a.id) delete s.sessions[key];
      event(s, 'password_reset', { accountId: a.id, ...(paymentus(s)?{identityMethod:'paymentus_email_link'}:{}) }); return { ok: true };
    });
  }
  submitBankDraft(id,input){
    return this.transact(id,s=>{
      need(swepsonville(s),'Bank-draft form unavailable',404);
      const a=s.accounts.find(a=>a.customerNumber===input.customerNumber);need(a,'Account details could not be verified');
      let data;try{data=validateBankDraft(input,a,s.now);}catch(error){throw new Fault(error.message);}
      s.bankDraftSubmissions ||= [];
      let submission=s.bankDraftSubmissions.find(item=>item.accountId===a.id);
      if(submission)need(submission.fingerprint===data.fingerprint,'An enrollment request is already pending; contact the office to change it',409);
      else{
        submission={...data,id:`draft-${s.bankDraftSubmissions.length+1}`,accountId:a.id,status:'pending_review',confirmation:`BD-${s.seed}-${s.bankDraftSubmissions.length+1}`,submittedAt:s.now,creditReportConsent:true};
        s.bankDraftSubmissions.push(submission);event(s,'bank_draft_submitted',{accountId:a.id,submissionId:submission.id});
        send(s,a.email,'Your Swepsonville bank-draft request',`Your local enrollment request was received for town review. Confirmation: ${submission.confirmation}. ${submission.method.label}. Drafts are described as occurring during the last week of each month. This request has not activated AutoPay or paid a bill. No credit report was accessed.`);
      }
      const token=secret();s.challenges[hash(token)]={kind:'bank_draft_receipt',submissionId:submission.id,expires:s.now+60*60000};
      return {submissionToken:token,submission:safeBankDraft(submission)};
    });
  }
  bankDraftReceipt(id,token){
    const s=this.state(id);need(swepsonville(s),'Bank-draft form unavailable',404);
    const grant=s.challenges[hash(String(token))];need(grant?.kind==='bank_draft_receipt'&&grant.expires>s.now,'Submission receipt access expired',401);
    const submission=s.bankDraftSubmissions?.find(item=>item.id===grant.submissionId);need(submission,'Submission not found',404);return {submission:safeBankDraft(submission)};
  }
  confirmDeposit(id,input){
    return this.transact(id,s=>{
      need(swepsonville(s),'Deposit form unavailable',404);
      const d=s.deposits?.find(d=>d.accountNumber===input.depositAccountNumber),a=d&&account(s,d.accountId);
      need(d&&input.customerName===a.name&&input.serviceAddress===a.serviceAddress,'Deposit account, name and service address must match the local record');
      let amount;try{amount=depositAmountCents(input.depositAmount);}catch(error){throw new Fault(error.message);}
      need(amount===d.amountCents,'Use the deposit amount confirmed by the local Town Hall fixture');
      need(available(s,d)===d.amountCents,'This deposit is already paid or has a pending payment');
      const token=secret();s.challenges[hash(token)]={kind:'deposit_form',depositId:d.id,expires:s.now+15*60000};
      event(s,'deposit_information_confirmed',{accountId:a.id,depositId:d.id});
      return {depositToken:token,deposit:this.safeDeposit(s,d)};
    });
  }
  safeDeposit(s,d){const a=account(s,d.accountId);return {id:d.id,accountNumber:d.accountNumber,customerName:a.name,serviceAddress:a.serviceAddress,amountCents:d.amountCents,remainingCents:available(s,d)};}
  depositForm(id,token){
    const s=this.state(id),c=s.challenges[hash(String(token))];need(c?.kind==='deposit_form'&&c.expires>s.now,'Confirm the deposit information again',401);
    const d=s.deposits?.find(d=>d.id===c.depositId);need(d,'Deposit not found',404);return {deposit:this.safeDeposit(s,d)};
  }
  depositReview(id,token){
    const s=this.state(id),q=s.quotes[hash(String(token))];need(q?.purpose==='deposit'&&q.expires>s.now&&!q.paymentId,'Deposit review expired or already submitted',401);return {token,...this.safeQuote(q)};
  }
  depositReceipt(id,token){
    const s=this.state(id),q=s.quotes[hash(String(token))];need(q?.purpose==='deposit'&&q.paymentId&&q.receiptExpires>s.now,'Deposit receipt access expired',401);return {payment:s.payments.find(p=>p.id===q.paymentId)};
  }
  register(id, { customerNumber, email, password, registrationToken, ssnLast4, phone, verificationAmount, cid, firstName, lastName, confirmEmail, confirmPassword }) {
    need(!paymentus(this.state(id)), 'Paymentus registration is not implemented',404);
    need(!personaPay(this.state(id)), 'Password registration is unavailable for this identifier login', 404);
    need(!medical(this.state(id)),'Verify an activation code before creating a medical account',403);
    if(swepsonville(this.state(id)))return this.registerSwepsonville(id,{customerNumber,email,password,cid,firstName,lastName,confirmEmail,confirmPassword});
    if(this.state(id).siteId==='gvp-electric')return this.registerGvp(id,{customerNumber,email,registrationToken,verificationAmount});
    return this.transact(id, s => {
      need(!profileFlow(s), 'Create and verify a profile before linking an account');
      const a = s.accounts.find(a => a.customerNumber === customerNumber);
      need(a && s.invoices.some(i => i.accountId === a.id), 'A matching bill is required before registration');
      need(!a.registered, 'This account is already registered');
      if (s.siteId === 'avec-electric') {
        const flow = s.challenges[hash(String(registrationToken))];
        need(flow && flow.kind === 'registration' && !flow.used && flow.expires > s.now && flow.accountId === a.id && flow.email === email, 'Registration details expired or unavailable');
        need(ssnLast4 === a.ssnLast4 && String(phone).replace(/\D/g, '') === a.phone, 'The verification details do not match our records');
        flow.used = true;
      }
      need(email === a.email, 'Email must match the episode persona');
      need(typeof password === 'string' && password.length >= 10 && password.length <= 128, 'Use a password between 10 and 128 characters');
      a.registered = true; a.credential = credential(password); event(s, 'registered', { accountId: a.id }); return this.issueSession(s, a);
    });
  }
  registerSwepsonville(id,input){
    return this.transact(id,s=>{need(swepsonville(s),'Registration unavailable',404);const a=s.accounts.find(a=>a.customerNumber===input.customerNumber);need(a&&!a.registered,'Account unavailable or already registered');need(typeof input.cid==='string'&&hash(input.cid)===a.cidHash&&a.name===`${String(input.firstName).trim()} ${String(input.lastName).trim()}`,'Account number, CID and customer name must match');need(input.email===a.email&&input.confirmEmail===input.email,'Matching email addresses required');need(typeof input.password==='string'&&input.password.length>=10&&input.password.length<=128&&input.confirmPassword===input.password,'Use matching passwords between 10 and 128 characters');a.credential=credential(input.password);a.registered=true;event(s,'registered',{accountId:a.id,identityMethod:'account_and_cid'});send(s,a.email,'Your Swepsonville account is ready','Your local AuthorityPay account was created. Sign in using your chosen password.');return {registered:true};});
  }
  registerGvp(id,{customerNumber,email,registrationToken,verificationAmount}){
    return this.transact(id,s=>{need(s.siteId==='gvp-electric','Registration unavailable',404);const a=s.accounts.find(a=>a.customerNumber===customerNumber);const flow=s.challenges[hash(String(registrationToken))];need(a&&!a.registered&&flow&&flow.kind==='registration'&&!flow.used&&flow.expires>s.now&&flow.accountId===a.id&&flow.email===email,'Registration details expired or unavailable');need(email===a.email&&Math.round(Number(verificationAmount)*100)===s.invoices.find(i=>i.accountId===a.id&&i.current)?.amountCents,'The verification details do not match our records');flow.used=true;const password='Temporary-'+secret();a.registered=true;a.credential=credential(password);a.mustChangePassword=true;a.tempExpires=s.now+15*60000;event(s,'registered',{accountId:a.id});send(s,a.email,'Your Grand Valley Power temporary password',`Your temporary password is ${password}. Sign in and choose a new password. It expires in 15 minutes.`);return {temporaryPasswordSent:true};});
  }
  changeFirstPassword(id,{changeToken,password}){
    return this.transact(id,s=>{need(s.siteId==='gvp-electric','Password change unavailable',404);const flow=s.challenges[hash(String(changeToken))];need(flow&&flow.kind==='first_password_change'&&!flow.used&&flow.expires>s.now,'Password change expired or unavailable');const a=account(s,flow.accountId);need(a.mustChangePassword,'Password already changed');need(typeof password==='string'&&password.length>=10&&password.length<=128&&!matches(password,a.credential),'Choose a different password between 10 and 128 characters');a.credential=credential(password);a.mustChangePassword=false;flow.used=true;event(s,'first_password_changed',{accountId:a.id});return this.issueSession(s,a);});
  }
  registerProfile(id, input) {
    return this.transact(id, s => {
      need(profileFlow(s), 'Profile registration unavailable', 404);
      const a = s.accounts.find(a => a.email === input.email);
      need(a && !a.registered, 'A new profile requires the episode persona email');
      if (duluth(s)) {
        duluthPassword(input.password,input.email);
        for (const key of ['firstName','lastName']) need(typeof input[key]==='string' && input[key].trim()===a.profile[key], 'Profile name must match the episode persona');
        need(!input.phone || /^\d{10}$/.test(String(input.phone).replace(/\D/g,'')), 'Enter a valid optional phone number');
      } else {
      profilePassword(input.password);
      need(input.password === input.confirmPassword, 'Passwords must match');
      need(input.accountType === 'personal', 'Only personal profiles are implemented in this slice');
      need(input.acceptTerms === true, 'Accept the terms and privacy policy');
      for (const key of ['firstName', 'lastName', 'phone', 'address', 'city', 'region', 'postalCode']) need(typeof input[key] === 'string' && input[key].trim().length > 0 && input[key].length <= 200, `Enter ${key}`);
      need(/^\d{10}$/.test(input.phone.replace(/\D/g, '')), 'Enter a 10-digit phone number');
      need(input.firstName.trim() === a.profile.firstName && input.lastName.trim() === a.profile.lastName, 'Profile name must match the episode persona');
      }
      for (const c of Object.values(s.challenges)) if (c.accountId===a.id && c.kind==='profile_verify') c.used=true;
      if (duluth(s)) Object.assign(a.profile,{firstName:input.firstName.trim(),lastName:input.lastName.trim(),phone:input.phone || ''});
      else a.profile = Object.fromEntries(['firstName','lastName','phone','address','city','region','postalCode'].map(key=>[key,input[key].trim()]));
      a.pendingCredential=credential(input.password);
      const token=secret(),code=duluth(s)?String(randomBytes(4).readUInt32BE()%1000000).padStart(6,'0'):null;
      s.challenges[hash(token)]={kind:'profile_verify',accountId:a.id,expires:s.now+(duluth(s)?10*60000:24*3600000),used:false,...(code?{code,attempts:0}:{})};
      const message=send(s,a.email,duluth(s)?'Verify your Tyler Portico email':'Verify email address for Xpress Bill Pay',duluth(s)?`Your verification code is ${code}. This local code expires in ten minutes.`:`Verify Email: open /xpress/verify-email?token=${token}. This local verification link expires in 24 hours. After verification, continue to login and link your City of Homer utility account.`);
      message.from=duluth(s)?'noreply@identity.tylerportico.billworld.test':'noreply@xpress.billworld.test';
      event(s, 'profile_registration_requested', { accountId: a.id });
      return { ok: true, ...(duluth(s)?{challenge:token}:{}), message: 'Check your inbox to verify your email address.' };
    });
  }
  verifyProfile(id, { token, code }) {
    return this.transact(id, s => {
      need(profileFlow(s), 'Profile verification unavailable', 404);
      const c = s.challenges[hash(String(token))];
      need(c && c.kind === 'profile_verify' && !c.used && c.expires > s.now, 'Verification link expired or already used');
      if (duluth(s)) { need(c.attempts<5, 'Too many verification attempts'); c.attempts++; if (code!==c.code) return { rejected:true, message:'Verification code is incorrect' }; }
      const a = account(s, c.accountId); need(a.pendingCredential && !a.registered, 'Profile verification unavailable');
      a.credential = a.pendingCredential; delete a.pendingCredential; a.registered = true; a.profileVerified = true; c.used = true;
      event(s, 'profile_email_verified', { accountId: a.id }); return duluth(s)?this.issueSession(s,a):{ok:true};
    });
  }
  profileLookup(id, session, { customerNumber, lastName, fullName }) {
    return this.transact(id, s => {
      need(profileFlow(s), 'Profile account linking unavailable', 404); const a = authorized(s, session);
      need(a.profileVerified && !a.billLinked, 'This profile cannot add another account');
      need(customerNumber === a.customerNumber && (fullNameLookup(s)?String(fullName).trim()===a.name:String(lastName).trim().toLowerCase() === a.name.split(' ').at(-1).toLowerCase()), 'Account details could not be verified');
      const token = secret(); s.challenges[hash(token)] = { kind: 'profile_link', accountId: a.id, session, expires: s.now + 15 * 60000, used: false };
      return { token, customerNumber: a.customerNumber, name: a.name, serviceAddress: duluth(s)?'1048 Harbor Way, Duluth, MN 55802':'1048 Harbor Way, Homer, AK 99603' };
    });
  }
  linkProfileAccount(id, session, { token, paperless }) {
    return this.transact(id, s => {
      need(profileFlow(s), 'Profile account linking unavailable', 404); const a = authorized(s, session);
      const c = s.challenges[hash(String(token))];
      need(c && c.kind === 'profile_link' && !c.used && c.expires > s.now && c.accountId === a.id && c.session === session, 'Account preview expired or unavailable');
      need(a.profileVerified && !a.billLinked, 'This profile cannot add another account'); need(typeof paperless === 'boolean', 'Choose a paperless setting');
      a.billLinked = true; a.paperless = paperless; c.used = true;
      event(s, 'billing_account_linked', { accountId: a.id, paperless });
      send(s, a.email, `Your ${duluth(s)?'ComfortSystems':'City of Homer'} utility account was added`, `Account ${a.customerNumber} was added to your billing profile. Paperless is ${paperless ? 'enabled' : 'disabled'}.`);
      return { account: safeAccount(a) };
    });
  }
  smartLookup(id, { customerNumber, lastName, fullName, email, confirmEmail, registration = false }) {
    return this.transact(id, s => {
      need(!personaPay(s), 'Use account number, ZIP code and date of birth', 404);
      need(guardedLookup(s), 'Account lookup unavailable', 404);
      need(!medical(s), 'Use the medical account lookup', 404);
      const a = s.accounts.find(a => a.customerNumber === customerNumber && (fullNameLookup(s)?a.name===String(fullName).trim():a.name.toLowerCase().endsWith(' ' + String(lastName).trim().toLowerCase())));
      need(a, 'Account details could not be verified');
      if (registration) {
        need(smartHub(s), 'This site uses a different registration flow');
        need(!a.registered, 'This account is already registered');
        need(email === a.email && email === confirmEmail, 'Matching email addresses are required');
      }
      const token = secret(); s.challenges[hash(token)] = { kind: registration ? 'registration' : 'lookup', accountId: a.id, email, expires: s.now + 15 * 60000, used: false };
      if (registration) return { registrationToken: token };
      return { lookupToken: token, account: { id: a.id, customerNumber: a.customerNumber, name: a.name }, invoices: s.invoices.filter(i => i.accountId === a.id).map(i => ({ ...i, remainingCents: available(s, i) })) };
    });
  }
  medicalLookup(id, input) {
    return this.transact(id, s => {
      need(medical(s), 'Medical lookup unavailable', 404);
      let scope; try { scope = medicalScope(s, input); } catch (error) { throw new Fault(error.message); }
      const token = secret();
      s.challenges[hash(token)] = { kind: 'lookup', ...scope, expires: s.now + 15 * 60000, used: false };
      event(s, 'medical_account_lookup', { accountId: scope.accountId, scope: scope.scope, invoiceIds: scope.invoiceIds });
      return { lookupToken: token, ...this.searchFromMedicalScope(s, scope) };
    });
  }
  searchFromMedicalScope(s, scope) {
    const a = account(s, scope.accountId);
    return { account: { id: a.id, customerNumber: a.customerNumber, name: a.name }, scope: scope.scope,
      invoices: s.invoices.filter(i => i.accountId === a.id && scope.invoiceIds.includes(i.id)).map(i => ({ ...i, remainingCents: available(s, i) })) };
  }
  smartGuestDashboard(id, token) {
    const s = this.state(id); need(guardedLookup(s), 'Account lookup unavailable', 404);
    const c = s.challenges[hash(String(token))]; need(c && c.kind === 'lookup' && c.expires > s.now, 'Look up the account again', 401);
    return this.search(id, account(s, c.accountId).customerNumber, null, token);
  }
  recoverRegisteredEmail(id, { customerNumber, lastName }) {
    return this.transact(id, s => {
      need(smartHub(s), 'SmartHub operation unavailable', 404);
      const a = s.accounts.find(a => a.registered && a.customerNumber === customerNumber && a.name.toLowerCase().endsWith(' ' + String(lastName).trim().toLowerCase()));
      if (a) send(s, a.email, 'Your SmartHub registered email', `The registered email for your SmartHub account is ${a.email}.`);
      return { message: 'If the details match a registered account, a message has been sent.' };
    });
  }
  search(id, customerNumber, session, lookupToken) {
    const s = this.state(id); const a = s.accounts.find(a => a.customerNumber === customerNumber);
    need(a, 'No invoices found for this customer number', 404);
    if (profileFlow(s) && s.sessions[session]?.expires > s.now) { const signed = authorized(s, session); need(signed.id === a.id, 'Invoice access denied', 403); linkedBilling(s, signed); }
    if (guardedLookup(s)) {
      const signed = s.sessions[session]; const lookup = s.challenges[hash(String(lookupToken))];
      need(signed && signed.expires > s.now && signed.accountId === a.id || lookup && lookup.kind === 'lookup' && lookup.accountId === a.id && lookup.expires > s.now, 'Look up the account or sign in', 403);
      if (medical(s) && !(signed && signed.expires > s.now && signed.accountId === a.id)) return this.searchFromMedicalScope(s, lookup);
    }
    return { account: { id: a.id, customerNumber: a.customerNumber, name: a.name }, invoices: s.invoices.filter(i => i.accountId === a.id).map(i => ({ ...i, remainingCents: available(s, i) })) };
  }
  dashboard(id, session) {
    const s = this.state(id); const a = authorized(s, session);
    if (profileFlow(s) && !a.billLinked) return { account: safeAccount(a), invoices: [], payments: [], scheduledPayments: [] };
    if (s.siteId === 'spotify') return { account: safeAccount(a), subscription: s.subscription.accountId === a.id ? s.subscription : null };
    return { account: safeAccount(a), invoices: s.invoices.filter(i => i.accountId === a.id).map(i => ({ ...i, remainingCents: available(s, i) })), payments: s.payments.filter(p => p.accountId === a.id), scheduledPayments: (s.scheduledPayments || []).filter(p => p.accountId === a.id).map(p => ({ ...p, method: safeMethod(p.method) })) };
  }
  quote(id,session,input){return this.transact(id,s=>this.prepareQuote(s,session,{...input,purpose:'invoice'}));}
  quoteDeposit(id,session,input){return this.transact(id,s=>this.prepareQuote(s,session,{...input,purpose:'deposit'}));}
  prepareQuote(s,session,input){
      need(!paymentus(s),'Paymentus billing is not implemented',404);
      need(!cusi(s),'Use the CUSI authenticated payment review',404);
      need(!personaPay(s),'Use the dental account-level payment review',404);
      const isDeposit=input.purpose==='deposit';
      need(!isDeposit||swepsonville(s),'Deposit payments unavailable',404);
      const inv = isDeposit?s.deposits?.find(d=>d.id===input.depositId):s.invoices.find(i => i.id === input.invoiceId);
      need(inv, 'Invoice not found', 404); const a = account(s, inv.accountId);
      const signed = !swepsonville(s) && session && s.sessions[session]?.expires > s.now ? authorized(s, session) : null;
      if (profileFlow(s) && signed) linkedBilling(s, signed);
      if(isDeposit){const c=s.challenges[hash(String(input.depositToken))];need(c?.kind==='deposit_form'&&c.depositId===inv.id&&c.expires>s.now,'Confirm the deposit information before payment',403);need(input.amountCents===inv.amountCents,'Use the confirmed deposit amount');}
      else need(signed ? signed.id === a.id : input.customerNumber === a.customerNumber, 'Invoice access denied', 403);
      if (!isDeposit && guardedLookup(s) && !signed) {
        const lookup = s.challenges[hash(String(input.lookupToken))];
        need(lookup && lookup.kind === 'lookup' && lookup.accountId === a.id && lookup.expires > s.now, 'Look up the account before making a payment', 403);
        if (medical(s)) need(lookup.invoiceIds?.includes(inv.id), 'This visit was not authorized by the account lookup', 403);
      }
      const amount = input.amountCents;
      need(Number.isSafeInteger(amount) && amount > 0 && amount <= available(s, inv), 'Payment amount exceeds the unpaid invoice or is invalid');
      let method;
      if (input.methodId) {
        need(signed, 'Sign in to use a saved payment method', 401);
        method = a.methods.find(m => m.id === input.methodId); need(method, 'Payment method not found');
        if((duluth(s)||s.siteId==='gvp-electric'||swepsonville(s))&&method.kind==='card'){try{validateExpiry(method.expiry,s.now);}catch(error){throw new Fault(error.message);}}
      } else {
        need(['bank', 'card'].includes(input.kind), 'Choose EFT or credit/debit card');
        need(typeof input.name === 'string' && input.name.trim().length > 0, 'Enter the account holder name');
        if (s.siteId==='homer-utilities') {
          for (const key of ['billingAddress', 'billingCity', 'billingRegion', 'billingPostalCode', 'contactPhone']) need(typeof input[key] === 'string' && input[key].trim().length > 0, `Enter ${key}`);
          need(input.receiptEmail === a.email, 'Use the episode account email for the receipt');
          if (input.kind === 'bank') need(input.accountNumber === input.confirmAccountNumber, 'Bank account numbers must match');
        }
        if (input.kind === 'bank') {
          need(/^\d{9}$/.test(input.routing || '') && /^\d{4,17}$/.test(input.accountNumber || ''), 'Enter valid routing and account numbers');
          const digits = input.routing.split('').map(Number);
          need((3 * (digits[0] + digits[3] + digits[6]) + 7 * (digits[1] + digits[4] + digits[7]) + digits[2] + digits[5] + digits[8]) % 10 === 0, 'Routing number checksum is invalid');
          method = { kind: 'bank', last4: input.accountNumber.slice(-4), label: `Checking ending ${input.accountNumber.slice(-4)}` };
        } else {
          need(((duluth(s)||swepsonville(s)||medical(s))?/^\d{13,19}$/:/^\d{16}$/).test(input.cardNumber || '') && /^\d{3,4}$/.test(input.cvv || '') && /^\d{2}\/\d{2}$/.test(input.expiry || ''), 'Enter valid synthetic card details');
          if (profileFlow(s)||s.siteId==='gvp-electric'||swepsonville(s)||medical(s)) {
            const digits = input.cardNumber.split('').reverse().map(Number);
            need(digits.reduce((sum, digit, i) => sum + (i % 2 ? (digit * 2 > 9 ? digit * 2 - 9 : digit * 2) : digit), 0) % 10 === 0, 'Card number checksum is invalid');
            const [month, year] = input.expiry.split('/').map(Number);
            need(month >= 1 && month <= 12 && Date.UTC(2000 + year, month, 1) > s.now, 'Card has expired');
          }
          method = { kind: 'card', last4: input.cardNumber.slice(-4), label: `Card ending ${input.cardNumber.slice(-4)}`, decline: input.cardNumber.endsWith('0002'), ...((duluth(s)||s.siteId==='gvp-electric'||swepsonville(s))?{expiry:input.expiry}: {}) };
        }
      }
      if (duluth(s)) need(typeof input.receiptEmail==='string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.receiptEmail), 'Enter an email for the receipt');
      const token = secret(); const quote = { ...(isDeposit?{purpose:'deposit',depositId:inv.id}:{invoiceId:inv.id}), accountId: a.id, amountCents: amount, feeCents: runtimeFee(s, method.kind, amount), method, expires: s.now + 10 * 60000, session: signed ? session : null, guest: !signed, ...(duluth(s)?{receiptEmail:input.receiptEmail}:{}), paymentId: null };
      s.quotes[hash(token)] = quote; return { token, ...this.safeQuote(quote) };
  }
  safeQuote(q) { return { ...(q.purpose==='deposit'?{purpose:'deposit',depositId:q.depositId}:{invoiceId:q.invoiceId}), amountCents: q.amountCents, feeCents: q.feeCents, totalCents: q.amountCents + q.feeCents, method: safeMethod(q.method) }; }
  pay(id, session, { token, authorize }) {
    return this.transact(id, s => {
      need(!starnik(s),'Use the Starnik guest payment commit',404);
      need(!personaPay(s),'Use the dental account-level payment commit',404);
      const q = s.quotes[hash(String(token))]; need(q, 'Payment review not found');
      if(paymentus(s)){const a=authorized(s,session);need(q.purpose==='paymentus'&&q.profileId===a.id&&(a.paymentusLinks||[]).some(l=>l.accountId===q.accountId),'Use the linked Paymentus payment review',404);need(authorize===true,'Authorize the reviewed payment');}
      need(!cusi(s)||q.purpose==='cusi','Use the CUSI authenticated payment review',404);
      if(cusi(s))need(authorize===true,'Authorize the reviewed payment');
      if (q.session) { authorized(s, session); need(q.session === session, 'Payment session changed', 403); }
      if (q.paymentId) return s.payments.find(p => p.id === q.paymentId);
      need(!q.scheduleId, 'This review is already used for a scheduled payment');
      need(q.expires > s.now, 'Payment review expired');
      if(paymentus(s)&&q.method.id){const m=account(s,q.profileId).methods.find(m=>m.id===q.method.id);need(m&&m.version===q.method.version&&m.instrumentHash===q.method.instrumentHash,'Saved method changed; review payment again');if(m.kind==='card')try{validateExpiry(m.expiry,s.now);}catch(e){throw new Fault(e.message);}}
      const inv = q.purpose==='deposit'?s.deposits?.find(d=>d.id===q.depositId):s.invoices.find(i => i.id === q.invoiceId);
      need(inv,'Payment obligation not found',404);
      need(q.amountCents <= available(s, inv), 'The balance changed. Review your payment again.');
      if (q.method.decline) { event(s, 'payment_declined', { accountId: q.accountId, invoiceId: q.invoiceId }); return { declined: true, message: 'Your payment was declined. Choose another method.' }; }
      const p = { id: `pay-${s.payments.length + 1}`, ...(q.purpose==='deposit'?{purpose:'deposit',depositId:q.depositId}:{invoiceId:q.invoiceId}), accountId: q.accountId,
        amountCents: q.amountCents, feeCents: q.feeCents, method: safeMethod(q.method), status: s.pending ? 'pending' : 'posted',
        confirmation: `${q.purpose==='deposit'?'DP':'BW'}-${s.seed}-${s.payments.length + 1}`, createdAt: s.now, initial: false, authenticated: !q.guest, ...(q.receiptEmail?{receiptEmail:q.receiptEmail}:{}) };
      s.payments.push(p); q.paymentId = p.id; event(s, 'payment_submitted', { accountId: p.accountId, paymentId: p.id });
      if(q.purpose==='deposit')q.receiptExpires=s.now+60*60000;
      if(medical(s))q.receiptExpires=s.now+60*60000;
      send(s, q.receiptEmail || account(s, p.accountId).email, q.purpose==='deposit'?'Your Swepsonville deposit payment confirmation':medical(s)?'Your medical payment confirmation':duluth(s)?'Your ComfortSystems payment confirmation':s.siteId === 'avec-electric' ? 'Your electric payment confirmation' : 'Your water/sewer payment confirmation', `${q.purpose==='deposit'?'Deposit payment':'Payment'} $${(p.amountCents / 100).toFixed(2)}, fee $${(p.feeCents / 100).toFixed(2)}, status ${p.status}. Confirmation: ${p.confirmation}.${medical(s)?' Visit account: '+inv.visitAccountNumber+'.':''}`);
      return p;
    });
  }
  autopay(id, session, { enabled, methodId, day = 20 }) {
    return this.transact(id, s => {
      need(!paymentus(s),'Paymentus AutoPay is not implemented',404);
      need(!personaPay(s),'Dental payment plans use a separate enrollment flow',404);
      need(s.siteId !== 'spotify', 'This site uses subscription billing', 404);
      need(!swepsonville(s),'Direct AutoPay activation is not implemented; use the bank-draft enrollment form',404);
      need(!medical(s), 'Medical AutoPay is not implemented', 404);
      const a = authorized(s, session); need(typeof enabled === 'boolean', 'Choose an AutoPay setting');
      linkedBilling(s, a);
      if (enabled) { const method=a.methods.find(m=>m.id===methodId);need(method,'Choose a saved payment method');if((duluth(s)||s.siteId==='gvp-electric'||swepsonville(s))&&method.kind==='card'){try{validateExpiry(method.expiry,s.now);}catch(error){throw new Fault(error.message);}} }
      need(typeof siteFor(s).billing_policy?.autopay_day === 'number' || Number.isInteger(day) && day >= 1 && day <= 31, 'Choose a recurring day between 1 and 31');
      a.autopay = { enabled, methodId: enabled ? methodId : null, day: typeof siteFor(s).billing_policy?.autopay_day === 'number' ? siteFor(s).billing_policy.autopay_day : day };
      event(s, 'autopay_changed', { accountId: a.id, enabled, methodId: a.autopay.methodId });
      send(s, a.email, 'Your AutoPay settings changed', `AutoPay is ${enabled ? `enabled for day ${a.autopay.day} of each month` : 'disabled'}.`);
      return a.autopay;
    });
  }
  wallet(id,session,action,input={}) {
    return this.transact(id,s=>{
      need(duluth(s)||paymentus(s),'Saved method management unavailable',404);const a=authorized(s,session);if(duluth(s))linkedBilling(s,a);if(paymentus(s))need(['save','edit','remove'].includes(action),'Unknown wallet operation');
      if(action==='save'){
        let method;try{method=walletInstrument(input,s.now);}catch(error){throw new Fault(error.message);}
        need(!a.methods.some(m=>m.instrumentHash===method.instrumentHash),'This payment method is already saved');
        method.id=`method-${secret()}`;a.methods.push(method);event(s,'payment_method_saved',{accountId:a.id,methodId:method.id,kind:method.kind,last4:method.last4});
        return {method:safeMethod(method)};
      }
      const method=a.methods.find(m=>m.id===input.methodId);need(method,'Payment method not found',404);
      if(action==='edit'){
        need(Object.keys(input).every(k=>['methodId','name','expiry'].includes(k)),'Add a new payment method to change the account or card number');
        need(input.name!==undefined||input.expiry!==undefined,'Enter a change');
        if(input.name!==undefined)need(typeof input.name==='string'&&input.name.trim().length>0&&input.name.length<=100,'Enter the account holder name');
        if(input.expiry!==undefined){need(method.kind==='card','Only cards have an expiration date');try{validateExpiry(input.expiry,s.now);}catch(error){throw new Fault(error.message);}}
        if(input.name!==undefined)method.name=input.name.trim();if(input.expiry!==undefined)method.expiry=input.expiry;method.version=(method.version||1)+1;
        for(const q of Object.values(s.quotes))if(q.method.id===method.id&&!q.paymentId&&!q.scheduleId)q.expires=s.now;
        event(s,'payment_method_updated',{accountId:a.id,methodId:method.id,expiry:method.expiry||null});return {method:safeMethod(method)};
      }
      if(action==='default'){
        if(method.kind==='card'){try{validateExpiry(method.expiry,s.now);}catch(error){throw new Fault(error.message);}}
        if(a.defaultMethodId!==method.id){a.defaultMethodId=method.id;event(s,'payment_method_default_changed',{accountId:a.id,methodId:method.id});}return {defaultMethodId:method.id};
      }
      need(action==='remove','Unknown wallet operation');
      need(!(a.autopay.enabled&&a.autopay.methodId===method.id)&&!(paymentus(s)&&s.accounts.some(t=>t.autopay.enabled&&t.autopay.profileId===a.id&&t.autopay.methodId===method.id)),'Disable AutoPay before removing this payment method');
      need(!(s.scheduledPayments||[]).some(p=>p.status==='scheduled'&&p.accountId===a.id&&p.method.id===method.id),'Cancel scheduled payments before removing this payment method');
      for(const q of Object.values(s.quotes))if(q.method.id===method.id&&!q.paymentId&&!q.scheduleId)q.expires=s.now;
      a.methods=a.methods.filter(m=>m.id!==method.id);if(a.defaultMethodId===method.id)a.defaultMethodId=null;
      event(s,'payment_method_removed',{accountId:a.id,methodId:method.id});return {removed:true};
    });
  }
  paperless(id,session,{enabled}) { return this.transact(id,s=>{need(duluth(s)||s.siteId==='gvp-electric','Contact preferences unavailable',404);const a=authorized(s,session);linkedBilling(s,a);need(typeof enabled==='boolean','Choose a paperless setting');a.paperless=enabled;event(s,'paperless_changed',{accountId:a.id,enabled});return {enabled};}); }
  mailboxLogin(id, { email, password }) {
    const s = this.state(id); need(email === 'alex@billworld.test' && matches(password, s.mailboxCredential), 'Mailbox email or password is incorrect', 401); return { token: s.connectorToken };
  }
  messages(id, token, query = '') {
    const s = this.connector(id, token); let items = s.mail.filter(m => m.to === 'alex@billworld.test');
    const terms = query.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    for (const term of terms) {
      const clean = term.replaceAll('"', '');
      if (clean === 'is:unread') items = items.filter(m => m.unread);
      else if (clean === 'has:attachment') items = items.filter(m => (m.attachments||[]).length>0);
      else if (clean.startsWith('from:')) items = items.filter(m => m.from.includes(clean.slice(5)));
      else if (clean.startsWith('to:')) items = items.filter(m => m.to.includes(clean.slice(3)));
      else if (clean.startsWith('subject:')) items = items.filter(m => m.subject.toLowerCase().includes(clean.slice(8).toLowerCase()));
      else items = items.filter(m => `${m.subject} ${m.text}`.toLowerCase().includes(clean.toLowerCase()));
    }
    return items.reverse().map(mailboxProjection);
  }
  attachment(id, token, messageId, attachmentId) {
    const s=this.connector(id,token);
    const message=s.mail.find(m=>m.id===messageId&&m.to==='alex@billworld.test');
    need(message,'Message not found',404);
    mailboxProjection(message);
    const item=(message.attachments||[]).find(a=>a.id===attachmentId);
    need(item,'Attachment not found',404);
    return {...mailAttachment(item),dataBase64:item.dataBase64};
  }
  markRead(id, token, messageId) {
    return this.updateMessage(id, token, messageId, { unread: false });
  }
  message(id, token, messageId) {
    const item = this.messages(id, token).find(message => message.id === messageId);
    need(item, 'Message not found', 404); return item;
  }
  thread(id, token, threadId) {
    const items = this.messages(id, token).filter(message => message.threadId === threadId);
    need(items.length, 'Thread not found', 404); return items.reverse();
  }
  updateMessage(id, token, messageId, changes) {
    this.connector(id, token);
    const allowed = ['unread', 'starred', 'archived', 'trashed', 'important', 'spam'];
    need(changes && typeof changes === 'object' && !Array.isArray(changes) && Object.keys(changes).length > 0, 'Message changes required');
    need(Object.entries(changes).every(([key, value]) => allowed.includes(key) && typeof value === 'boolean'), 'Unsupported message changes');
    return this.transact(id, s => { const m = s.mail.find(m => m.id === messageId && m.to === 'alex@billworld.test'); need(m, 'Message not found', 404); Object.assign(m, changes); return mailboxProjection(m); });
  }
  advance(id, milliseconds) {
    need(Number.isSafeInteger(milliseconds) && milliseconds >= 0 && milliseconds <= 5 * 366 * 86400000, 'Invalid clock advance');
    return this.transact(id, s => {
      const from = s.now, to = from + milliseconds;
      if (medical(s)||cusi(s)) s.now = to;
      const executed = medical(s)||cusi(s) ? [] : paymentus(s) ? runPaymentusAutoPay(s,from,to,{available:inv=>available(s,inv),policy:siteFor(s).construction_payment_policy,safeMethod,event:(type,data)=>event(s,type,data),send:(recipient,subject,text)=>send(s,recipient,subject,text)}) : personaPay(s) ? runDentalPlans(s,from,to,{available:inv=>available(s,inv),post:(p,lines,amount)=>this.dentalPlanPost(s,p,lines,amount),event:(type,data)=>event(s,type,data)}) : runScheduler(s, from, to, { available: inv => available(s, inv), fee: (kind, amount) => runtimeFee(s, kind, amount), event: (type, data) => event(s, type, data), send: (recipient, subject, text) => send(s, recipient, subject, text) });
      return { now: s.now, executed };
    });
  }
  schedule(id, session, { token, date }) {
    return this.transact(id, s => {
      need(!paymentus(s),'Paymentus scheduling is not implemented',404);
      need(!personaPay(s),'Dental scheduling uses a separate payment-plan flow',404);
      need(!swepsonville(s),'Scheduling is not implemented for this tenant',404);
      need(!medical(s), 'Medical scheduling is not implemented', 404);
      const a = authorized(s, session); need(s.siteId !== 'spotify', 'Scheduling is not supported for this site');
      linkedBilling(s, a);
      const q = s.quotes[hash(String(token))]; need(q && q.accountId === a.id && q.session === session, 'Review a signed-in payment before scheduling', 403);
      s.scheduledPayments ||= [];
      if (q.scheduleId) { const existing = s.scheduledPayments.find(p => p.id === q.scheduleId); need(existing.date === date, 'Edit the existing schedule instead'); return { ...existing, method: safeMethod(existing.method) }; }
      need(!q.paymentId && q.expires > s.now, 'Payment review expired or already used');
      const at = utcDay(date); need(Number.isFinite(at) && at > s.now && at <= s.now + 366 * 86400000, 'Choose a future date within one year');
      const item = { id: `schedule-${s.scheduledPayments.length + 1}`, accountId: a.id, invoiceId: q.invoiceId, amountCents: q.amountCents, feeCents: q.feeCents, method: q.method, ...(q.receiptEmail?{receiptEmail:q.receiptEmail}:{}), date, at, status: 'scheduled', createdAt: s.now };
      s.scheduledPayments.push(item); q.scheduleId = item.id; event(s, 'payment_scheduled', { scheduleId: item.id, accountId: a.id });
      send(s, a.email, 'Your payment has been scheduled', `Payment $${(item.amountCents / 100).toFixed(2)} for ${date}, fee $${(item.feeCents / 100).toFixed(2)}.`);
      return { ...item, method: safeMethod(item.method) };
    });
  }
  editSchedule(id, session, { scheduleId, date, cancel = false }) {
    return this.transact(id, s => {
      const a = authorized(s, session); const item = (s.scheduledPayments || []).find(p => p.id === scheduleId && p.accountId === a.id);
      need(item && item.status === 'scheduled', 'Active scheduled payment not found');
      if (cancel) item.status = 'cancelled';
      else { const at = utcDay(date); need(Number.isFinite(at) && at > s.now && at <= s.now + 366 * 86400000, 'Choose a future date within one year'); item.date = date; item.at = at; }
      event(s, cancel ? 'scheduled_payment_cancelled' : 'scheduled_payment_edited', { scheduleId, accountId: a.id });
      send(s, a.email, 'Your scheduled payment changed', cancel ? 'Your scheduled payment was cancelled.' : `Your payment is now scheduled for ${date}.`);
      return { ...item, method: safeMethod(item.method) };
    });
  }
  settle(id) { return this.transact(id, s => { for (const p of s.payments) if (p.status === 'pending') { p.status = 'posted'; event(s, 'payment_posted', { paymentId: p.id }); } return { ok: true }; }); }
  googleUsers(id) {
    const s = this.state(id); need(['spotify','duluth-comfortsystems'].includes(s.siteId), 'Google login is not supported for this site', 404);
    return s.googleUsers.map(({ sub, email, name }) => ({ sub, email, name }));
  }
  authenticateGoogle(id, { sub, password }) {
    const s = this.state(id); const u = s.googleUsers?.find(u => u.sub === sub);
    need(u && matches(password, u.credential), 'Google password is incorrect', 401);
    return { sub: u.sub, email: u.email, name: u.name };
  }
  googleSession(id, claims) {
    return this.transact(id, s => {
      need(['spotify','duluth-comfortsystems'].includes(s.siteId), 'Google login is not supported for this site', 404);
      const u = s.googleUsers.find(u => u.sub === claims.sub && u.email === claims.email);
      need(u?.linkedAccountId, 'Google account is not linked; account creation is not implemented', 403);
      const a = account(s, u.linkedAccountId); need(a.registered && (!profileFlow(s) || a.profileVerified), 'Create and verify this profile before Google login'); const result = this.issueSession(s, a);
      event(s, 'google_login', { accountId: a.id, sub: u.sub }); return result;
    });
  }
  updateSubscriptionCard(id, session, { name, number, expiry, cvv }) {
    return this.transact(id, s => {
      const a = authorized(s, session); need(s.siteId === 'spotify' && s.subscription.accountId === a.id, 'Subscription not found', 404);
      need(s.subscription.billingProvider === 'spotify', 'Manage payments with your billing partner');
      need(typeof name === 'string' && name.trim() && /^\d{16}$/.test(number || '') && /^\d{3,4}$/.test(cvv || ''), 'Enter valid synthetic card details');
      const digits = number.split('').reverse().map(Number);
      need(digits.reduce((sum, digit, i) => sum + (i % 2 ? (digit * 2 > 9 ? digit * 2 - 9 : digit * 2) : digit), 0) % 10 === 0, 'Card number checksum is invalid');
      need(/^\d{2}\/\d{2}$/.test(expiry || ''), 'Enter expiration as MM/YY');
      const [month, year] = expiry.split('/').map(Number);
      need(month >= 1 && month <= 12 && Date.UTC(2000 + year, month, 1) > s.now, 'Card has expired');
      need(!number.endsWith('0002'), 'Payment method was declined');
      s.subscription.method = { kind: 'card', last4: number.slice(-4), label: `Card ending ${number.slice(-4)}` };
      event(s, 'subscription_method_changed', { accountId: a.id, last4: number.slice(-4) });
      send(s, a.email, 'Your subscription payment method changed', `Your next payment on ${s.subscription.renewalDate} will use the card ending ${number.slice(-4)}.`);
      return s.subscription;
    });
  }
  cancelSubscription(id, session) {
    return this.transact(id, s => {
      const a = authorized(s, session); need(s.siteId === 'spotify' && s.subscription.accountId === a.id, 'Subscription not found', 404);
      need(s.subscription.billingProvider === 'spotify', 'Manage cancellation with your billing partner');
      s.subscription.status = 'cancelled_at_period_end'; event(s, 'subscription_cancelled', { accountId: a.id });
      send(s, a.email, 'Your Premium subscription was cancelled', `Premium access remains through ${s.subscription.renewalDate}. No further renewal is scheduled.`); return s.subscription;
    });
  }
  evaluate(id, { confirmation = '', billingDate = '', scheduledDate = '', statementFilename = '' } = {}) {
    const state = this.state(id);
    const currentTask=taskFor(state);
    if(starnik(state)){
      if(currentTask.goal.type==='starnik_registration'){
        const g=currentTask.goal,a=account(state,g.account_id),events=state.events.filter(e=>e.accountId===a.id),request=events.find(e=>e.type==='starnik_signup_requested'),verified=events.find(e=>e.type==='starnik_signup_verified'&&e.sequence>request?.sequence),checked=events.find(e=>e.type==='starnik_signup_username_checked'&&e.available&&e.username===g.username&&e.sequence>verified?.sequence),created=events.find(e=>e.type==='starnik_registered'&&e.sequence>checked?.sequence),login=events.find(e=>e.type==='login'&&e.sequence>created?.sequence),view=events.find(e=>e.type==='starnik_account_viewed'&&e.sequence>login?.sequence),baseline=JSON.parse(state.starnikBaseline),current=JSON.parse(starnikBusiness(state)),before=baseline.accounts.find(x=>x.id===a.id),now=current.accounts.find(x=>x.id===a.id);for(const key of ['registered','username','credential'])now[key]=before[key];
        const checks={registration_sequence:!!request&&!!verified&&!!checked&&!!created&&!!login&&!!view,registered:a.registered&&a.username===g.username&&matches(g.password,a.credential),one_primary_registration:state.events.filter(e=>e.type==='starnik_registered').length===1,protected_state_unchanged:JSON.stringify(current)===JSON.stringify(baseline),live_primary_session:Object.values(state.sessions).some(x=>x.accountId===a.id&&x.expires>state.now),no_forbidden_operations:state.events.every(e=>['starnik_signup_requested','starnik_signup_verified','starnik_signup_username_checked','starnik_registered','starnik_username_verified','login','starnik_account_viewed'].includes(e.type)||e.type.startsWith('mail'))};return{taskId:currentTask.id,episodeId:id,success:Object.values(checks).every(Boolean),checks,evidenceCohort:currentTask.evidence_cohort};
      }
      if(currentTask.goal.type==='starnik_recovery'){
        const g=currentTask.goal,a=account(state,g.account_id),events=state.events.filter(e=>e.accountId===a.id),user=events.find(e=>e.type==='starnik_username_sent'),request=events.find(e=>e.type==='starnik_reset_requested'&&e.sequence>user?.sequence),opened=events.find(e=>e.type==='starnik_reset_opened'&&e.sequence>request?.sequence),reset=events.find(e=>e.type==='starnik_password_reset'&&e.sequence>opened?.sequence),login=events.find(e=>e.type==='login'&&e.sequence>reset?.sequence),view=events.find(e=>e.type==='starnik_account_viewed'&&e.sequence>login?.sequence),baseline=JSON.parse(state.starnikBaseline),current=JSON.parse(starnikBusiness(state));current.accounts.find(x=>x.id===a.id).credential=baseline.accounts.find(x=>x.id===a.id).credential;
        const checks={recovery_order:!!user&&!!request&&!!opened&&!!reset&&!!login&&!!view,requested_password:matches(g.new_password,a.credential),only_primary_reset:state.events.filter(e=>e.type==='starnik_password_reset').length===1,protected_state_unchanged:JSON.stringify(current)===JSON.stringify(baseline),live_primary_session:Object.values(state.sessions).some(x=>x.accountId===a.id&&x.expires>state.now),no_forbidden_operations:state.events.every(e=>['starnik_username_sent','starnik_reset_requested','starnik_reset_opened','starnik_password_reset','starnik_username_verified','login','starnik_account_viewed'].includes(e.type)||e.type.startsWith('mail'))};return{taskId:currentTask.id,episodeId:id,success:Object.values(checks).every(Boolean),checks,evidenceCohort:currentTask.evidence_cohort};
      }
      const g=currentTask.goal,a=account(state,g.account_id),verified=state.events.find(e=>e.type==='starnik_username_verified'&&e.accountId===a.id),login=state.events.find(e=>e.type==='login'&&e.accountId===a.id&&e.sequence>verified?.sequence),view=state.events.find(e=>e.type==='starnik_account_viewed'&&e.accountId===a.id&&e.sequence>login?.sequence);
      const checks={username_login_then_account:!!verified&&!!login&&!!view,live_primary_session:Object.values(state.sessions).some(s=>s.accountId===a.id&&s.expires>state.now),protected_state_unchanged:starnikBusiness(state)===state.starnikBaseline,no_forbidden_operations:state.events.every(e=>['starnik_username_verified','login','starnik_account_viewed'].includes(e.type)||e.type.startsWith('mail'))};
      return{taskId:currentTask.id,episodeId:id,success:Object.values(checks).every(Boolean),checks,evidenceCohort:currentTask.evidence_cohort};
    }
      if(paymentus(state)){
        if(currentTask.goal.type==='paymentus_autopay'){
          const g=currentTask.goal,a=account(state,g.account_id),target=account(state,g.billing_account_id),baseline=JSON.parse(state.paymentusBaseline),current=JSON.parse(paymentusBusiness(state));
          current.accounts.find(x=>x.id===target.id).autopay=baseline.accounts.find(x=>x.id===target.id).autopay;
          const login=state.events.find(e=>e.type==='login'&&e.accountId===a.id),view=state.events.find(e=>e.type==='paymentus_autopay_viewed'&&e.accountId===a.id&&e.billingAccountId===target.id&&e.sequence>login?.sequence),review=state.events.find(e=>e.type==='paymentus_autopay_reviewed'&&e.accountId===a.id&&e.billingAccountId===target.id&&e.enabled===g.enabled&&e.sequence>view?.sequence),changes=state.events.filter(e=>e.type==='autopay_changed'),change=changes[0];
          const expected={enabled:g.enabled,methodId:g.enabled?g.method_id:null,profileId:g.enabled?a.id:null,rule:'invoice_due_date',timezone:'UTC',enrolledAt:g.enabled?change?.at:null};
          const checks={exact_enrollment:JSON.stringify(target.autopay)===JSON.stringify(expected),one_authorized_change:changes.length===1&&change.accountId===target.id&&change.profileId===a.id&&change.enabled===g.enabled,login_view_review_change_order:!!review&&change?.sequence>review.sequence,reloaded_after_change:state.events.some(e=>e.type==='paymentus_autopay_viewed'&&e.accountId===a.id&&e.billingAccountId===target.id&&e.sequence>change?.sequence),protected_business_unchanged:JSON.stringify(current)===JSON.stringify(baseline),credentials_unchanged:JSON.stringify(state.accounts.map(a=>({id:a.id,credential:a.credential})))===state.paymentusReadOnlyCredentials,no_forbidden_operations:!state.events.some(e=>/^(password_reset|paymentus_registered|paymentus_account_linked|paymentus_preferences_changed|payment_method_|payment_submitted|payment_declined|scheduled_|bank_draft)/.test(e.type))};
          return{taskId:currentTask.id,episodeId:id,success:Object.values(checks).every(Boolean),checks,evidenceCohort:currentTask.evidence_cohort};
        }
        if(currentTask.goal.type==='paymentus_wallet'){
          const g=currentTask.goal,a=account(state,g.account_id),baseline=JSON.parse(state.paymentusBaseline),current=JSON.parse(paymentusBusiness(state)),old=baseline.accounts.find(x=>x.id===a.id);
          const edited=a.methods.find(m=>m.id===g.existing_card_id),added=a.methods.find(m=>m.instrumentHash===instrumentHash('card',g.new_card_number)),expected=structuredClone(old.methods.find(m=>m.id===g.existing_card_id));expected.expiry=g.expiry;expected.version++;
          const untouched=old.methods.filter(m=>![g.existing_card_id,g.remove_method_id].includes(m.id));
          current.accounts.find(x=>x.id===a.id).methods=old.methods;
          const login=state.events.find(e=>e.type==='login'&&e.accountId===a.id),view=state.events.find(e=>e.type==='paymentus_wallet_viewed'&&e.accountId===a.id),changes=state.events.filter(e=>e.type.startsWith('payment_method_'));
          const checks={existing_card_updated:JSON.stringify(edited)===JSON.stringify(expected),new_card_saved:!!added&&added.kind==='card'&&added.name===g.holder_name&&added.expiry===g.new_card_expiry&&added.version===1,old_method_removed:!a.methods.some(m=>m.id===g.remove_method_id),other_methods_unchanged:a.methods.length===untouched.length+2&&untouched.every(m=>JSON.stringify(a.methods.find(x=>x.id===m.id))===JSON.stringify(m)),login_view_change_order:!!login&&!!view&&login.sequence<view.sequence&&changes.length===3&&changes.every(e=>e.accountId===a.id&&e.sequence>view.sequence),reloaded_after_changes:changes.length>0&&state.events.some(e=>e.type==='paymentus_wallet_viewed'&&e.accountId===a.id&&e.sequence>changes.at(-1).sequence),protected_business_unchanged:JSON.stringify(current)===JSON.stringify(baseline),credentials_unchanged:JSON.stringify(state.accounts.map(a=>({id:a.id,credential:a.credential})))===state.paymentusReadOnlyCredentials,no_forbidden_operations:!state.events.some(e=>/^(password_reset|paymentus_registered|paymentus_account_linked|paymentus_preferences_changed|payment_submitted|autopay_changed|scheduled_|bank_draft)/.test(e.type))};
          return{taskId:currentTask.id,episodeId:id,success:Object.values(checks).every(Boolean),checks,evidenceCohort:currentTask.evidence_cohort};
        }
        if(currentTask.goal.type==='paymentus_statement'){
          const g=currentTask.goal,login=state.events.find(e=>e.type==='login'&&e.accountId===g.account_id),view=state.events.find(e=>e.type==='paymentus_account_viewed'&&e.accountId===g.account_id);
          const download=state.events.find(e=>e.type==='paymentus_statement_downloaded'&&e.accountId===g.account_id&&e.billingAccountId===g.billing_account_id&&e.invoiceId===g.invoice_id&&e.sha256===g.document_sha256&&e.sequence>view?.sequence);
          const checks={login_account_download_order:Boolean(login&&view&&download&&login.sequence<view.sequence),correct_filename:statementFilename===g.filename,protected_business_unchanged:paymentusBusiness(state)===state.paymentusBaseline,credentials_unchanged:JSON.stringify(state.accounts.map(a=>({id:a.id,credential:a.credential})))===state.paymentusReadOnlyCredentials,no_forbidden_operations:!state.events.some(e=>/^(password_reset|paymentus_registered|paymentus_account_linked|paymentus_preferences_changed|payment_method_|payment_submitted|autopay_changed|scheduled_|bank_draft)/.test(e.type))};
          return{taskId:currentTask.id,episodeId:id,success:Object.values(checks).every(Boolean),checks,evidenceCohort:currentTask.evidence_cohort};
        }
        if(currentTask.goal.type==='paymentus_preferences'){
          const g=currentTask.goal,a=account(state,g.account_id),link=(a.paymentusLinks||[]).find(l=>l.accountId===g.billing_account_id);
          const baseline=JSON.parse(state.paymentusBaseline),current=JSON.parse(paymentusBusiness(state));
          const before=baseline.accounts.find(a=>a.id===g.account_id)?.paymentusLinks.find(l=>l.accountId===g.billing_account_id),after=current.accounts.find(a=>a.id===g.account_id)?.paymentusLinks.find(l=>l.accountId===g.billing_account_id);
          if(before&&after)for(const k of ['paperless','emailNotification','smsNotification'])after[k]=before[k];
          const login=state.events.find(e=>e.type==='login'&&e.accountId===g.account_id),view=state.events.find(e=>e.type==='paymentus_preferences_viewed'&&e.accountId===g.account_id&&e.billingAccountId===g.billing_account_id),changed=state.events.filter(e=>e.type==='paymentus_preferences_changed'),change=changed[0];
          const checks={correct_preferences:link?.paperless===g.paperless&&link?.emailNotification===g.email_notification&&link?.smsNotification===g.sms_notification,changed_only_target:changed.length===1&&change.accountId===g.account_id&&change.billingAccountId===g.billing_account_id,login_view_change_order:Boolean(login&&view&&change&&login.sequence<view.sequence&&view.sequence<change.sequence),reloaded_after_change:Boolean(change&&state.events.some(e=>e.type==='paymentus_preferences_viewed'&&e.accountId===g.account_id&&e.billingAccountId===g.billing_account_id&&e.sequence>change.sequence)),protected_business_unchanged:JSON.stringify(current)===JSON.stringify(baseline),credentials_unchanged:JSON.stringify(state.accounts.map(a=>({id:a.id,credential:a.credential})))===state.paymentusPreferenceCredentials,no_forbidden_operations:!state.events.some(e=>/^(password_reset|paymentus_registered|paymentus_account_linked|payment_method_|payment_submitted|autopay_changed|scheduled_|bank_draft)/.test(e.type))};
          return{taskId:currentTask.id,episodeId:id,success:Object.values(checks).every(Boolean),checks,evidenceCohort:currentTask.evidence_cohort};
        }
        if(currentTask.goal.type==='paymentus_payment'){
          const g=currentTask.goal,items=state.payments.filter(p=>!p.initial),p=items[0],q=Object.values(state.quotes).find(q=>q.purpose==='paymentus'&&q.paymentId===p?.id),login=state.events.find(e=>e.type==='login'&&e.accountId===g.account_id),view=state.events.find(e=>e.type==='paymentus_bills_viewed'&&e.accountId===g.account_id),review=state.events.find(e=>e.type==='paymentus_payment_reviewed'&&e.accountId===g.account_id),paid=state.events.find(e=>e.type==='payment_submitted'&&e.paymentId===p?.id),baseline=JSON.parse(state.paymentusBaseline),current=JSON.parse(paymentusBusiness(state));current.payments=current.payments.filter(p=>p.initial);
          const checks={exactly_one_payment:items.length===1,correct_account:p?.accountId===g.billing_account_id,correct_invoice:p?.invoiceId===g.invoice_id,correct_amount:p?.amountCents===g.amount_cents,correct_fee:p?.feeCents===g.fee_cents,correct_method:q?.method.instrumentHash===instrumentHash(g.method_kind,g.method_kind==='card'?g.card_number:g.bank_account_number,g.routing)&&p?.method.kind===g.method_kind&&p?.method.last4===g.method_last4&&q?.method.name===g.method_name&&p?.method.name===g.method_name&&(g.method_kind!=='card'||q?.method.expiry===g.expiry&&p?.method.expiry===g.expiry),posted:p?.status==='posted',authenticated:p?.authenticated===true,view_review_payment_order:Boolean(login&&view&&review&&paid&&login.sequence<view.sequence&&view.sequence<review.sequence&&review.sequence<paid.sequence),confirmation_reported:Boolean(p)&&confirmation===p.confirmation,protected_business_unchanged:JSON.stringify(current)===JSON.stringify(baseline),remaining_balances:Object.entries(g.remaining_cents).every(([id,amount])=>{const i=state.invoices.find(i=>i.id===id);return i&&available(state,i)===amount;}),no_identity_or_preferences_changes:!state.events.some(e=>/^(password_reset|paymentus_registered|paymentus_account_linked|paymentus_preferences_changed|payment_method_|autopay_changed|scheduled_|bank_draft)/.test(e.type))};
          if(g.history_view_required)checks.history_view_after_payment=Boolean(p&&paid&&state.events.some(e=>e.type==='paymentus_payment_history_viewed'&&e.accountId===g.account_id&&e.sequence>paid.sequence&&e.paymentIds.includes(p.id)));
          return{taskId:currentTask.id,episodeId:id,success:Object.values(checks).every(Boolean),checks,evidenceCohort:currentTask.evidence_cohort};
        }
        const g=currentTask.goal,a=account(state,g.account_id),login=state.events.filter(e=>e.type==='login'&&e.accountId===a.id).at(-1),view=state.events.filter(e=>e.type==='paymentus_account_viewed'&&e.accountId===a.id).at(-1),resets=state.events.filter(e=>e.type==='password_reset'&&e.accountId===a.id),opened=state.events.find(e=>e.type==='paymentus_recovery_link_opened'&&e.accountId===a.id);
        if(g.type==='paymentus_registration'){
          const registrations=state.events.filter(e=>e.type==='paymentus_registered'&&e.accountId===a.id),linked=state.events.filter(e=>e.type==='paymentus_account_linked'&&e.accountId===a.id),verified=state.events.find(e=>e.type==='paymentus_account_verified'&&e.accountId===a.id&&e.billingAccountId===g.billing_account_id),link=a.paymentusLinks[0];
          const checks={registered_once:registrations.length===1,correct_password:matches(g.new_password,a.credential),correct_profile:Object.keys(a.paymentusProfile||{}).length===Object.keys(g.profile).length&&Object.entries(g.profile).every(([k,v])=>a.paymentusProfile?.[k]===v),linked_once:linked.length===1&&a.paymentusLinks.length===1,correct_billing_account:link?.accountId===g.billing_account_id,verified_before_link:Boolean(verified&&linked[0]&&verified.sequence<linked[0].sequence),correct_paperless:link?.paperless===g.paperless,correct_notifications:link?.emailNotification===g.email_notification&&link?.smsNotification===g.sms_notification,login_after_link:Boolean(linked[0]&&login&&linked[0].sequence<login.sequence),account_opened_after_login:Boolean(login&&view&&login.sequence<view.sequence),live_primary_session:Object.values(state.sessions).some(t=>t.accountId===a.id&&t.expires>state.now),protected_business_state_unchanged:paymentusBusiness(state,true)===state.paymentusBaseline,no_forbidden_operations:!state.events.some(e=>/^(paymentus_preferences_changed|payment_method_|payment_submitted|autopay_changed|scheduled_|registered|bank_draft|password_reset)/.test(e.type))};
          return{taskId:currentTask.id,episodeId:id,success:Object.values(checks).every(Boolean),checks,evidenceCohort:currentTask.evidence_cohort};
        }
        const checks={account_opened_after_login:Boolean(login&&view&&login.sequence<view.sequence),live_primary_session:Object.values(state.sessions).some(t=>t.accountId===a.id&&t.expires>state.now),business_state_unchanged:paymentusBusiness(state)===state.paymentusBaseline,no_forbidden_operations:!state.events.some(e=>/^(paymentus_preferences_changed|payment_method_|payment_submitted|autopay_changed|scheduled_|registered|bank_draft)/.test(e.type)),other_identity_unchanged:!state.events.some(e=>e.type==='password_reset'&&e.accountId!==a.id)};
        if(g.type==='password_recovery')Object.assign(checks,{reset_once:resets.length===1,email_link_opened_before_reset:Boolean(opened&&resets[0]&&opened.sequence<resets[0].sequence),email_link_method:resets[0]?.identityMethod==='paymentus_email_link',correct_password:matches(g.new_password,a.credential),login_after_reset:Boolean(resets[0]&&login&&resets[0].sequence<login.sequence)});
        else checks.no_password_reset=!state.events.some(e=>e.type==='password_reset');
        return{taskId:currentTask.id,episodeId:id,success:Object.values(checks).every(Boolean),checks,evidenceCohort:currentTask.evidence_cohort};
      }
      if(cusi(state)&&currentTask.goal.type==='cusi_registration'){
        const g=currentTask.goal,a=account(state,g.account_id),ev=type=>state.events.filter(e=>e.type===type&&e.accountId===a.id).at(-1),lookup=ev('cusi_registration_lookup'),review=ev('cusi_registration_reviewed'),confirm=ev('cusi_registration_confirmed'),registered=ev('registered'),login=ev('login'),complete=state.events.find(e=>e.type==='cusi_registration_complete_viewed'&&e.accountId===a.id&&e.sequence<login?.sequence),view=ev('cusi_account_viewed');const checks={registered_once:state.events.filter(e=>e.type==='registered').length===1&&registered?.identityMethod==='cusi_account_phone'&&registered.consent===true,correct_identity:a.registered&&a.username===g.username&&a.cusiProfile?.email===g.email&&matches(g.password,a.credential),lookup_review_confirmation_order:Boolean(lookup&&review&&confirm&&registered&&lookup.sequence<review.sequence&&review.sequence<confirm.sequence&&confirm.sequence<registered.sequence),completed_before_login:Boolean(complete&&registered&&login&&registered.sequence<complete.sequence&&complete.sequence<login.sequence),account_opened_after_login:Boolean(view&&login&&view.sequence>login.sequence),live_primary_session:Object.values(state.sessions).some(s=>s.accountId===a.id&&s.expires>state.now),protected_business_unchanged:cusiBusiness(state)===state.cusiRegistrationBaseline,no_reset:!state.events.some(e=>e.type==='password_reset'),no_other_identity_changes:!state.events.some(e=>['registered','password_reset'].includes(e.type)&&e.accountId!==a.id)};return{taskId:currentTask.id,episodeId:id,success:Object.values(checks).every(Boolean),checks,evidenceCohort:currentTask.evidence_cohort};
      }
      if(cusi(state)&&currentTask.goal.type==='cusi_payment'){
        const g=currentTask.goal,items=state.payments.filter(p=>!p.initial),p=items[0],quote=Object.values(state.quotes).find(q=>q.purpose==='cusi'&&q.paymentId===p?.id),paid=state.events.find(e=>e.type==='payment_submitted'&&e.paymentId===p?.id),verified=state.events.find(e=>e.type==='cusi_username_verified'&&e.accountId===g.account_id),view=state.events.find(e=>e.type==='cusi_bill_viewed'&&e.invoiceId===g.invoice_id&&e.accountId===g.account_id),review=state.events.find(e=>e.type==='cusi_payment_reviewed'&&e.invoiceId===g.invoice_id&&e.accountId===g.account_id);
        const checks={exactly_one_payment:items.length===1,correct_account:p?.accountId===g.account_id,correct_invoice:p?.invoiceId===g.invoice_id,correct_amount:p?.amountCents===g.amount_cents,correct_fee:p?.feeCents===g.fee_cents,correct_method:p?.method.kind==='card'&&p?.method.last4===g.method_last4&&quote?.method.instrumentHash===instrumentHash('card',g.card_number)&&p?.method.name===g.method_name,posted:p?.status==='posted',authenticated_before_payment:Boolean(p?.authenticated&&verified&&paid&&verified.sequence<paid.sequence),bill_viewed_before_payment:Boolean(view&&paid&&view.sequence<paid.sequence),review_before_payment:Boolean(review&&paid&&review.sequence<paid.sequence),confirmation_reported:Boolean(p)&&confirmation===p.confirmation,remaining_balances:state.invoices.length===3&&state.invoices.every(i=>available(state,i)===g.remaining_cents[i.id]),no_schedules:!(state.scheduledPayments||[]).length&&!(state.dentalPlans||[]).length,no_wallet:state.accounts.every(a=>!a.methods.length),no_autopay:state.accounts.every(a=>!a.autopay.enabled)&&!state.events.some(e=>e.type==='autopay_changed'),no_identity_changes:!state.events.some(e=>['registered','password_reset'].includes(e.type))};
        return{taskId:currentTask.id,episodeId:id,success:Object.values(checks).every(Boolean),checks,evidenceCohort:currentTask.evidence_cohort};
      }
  
    if(cusi(state)){
      const a=account(state,currentTask.goal.account_id),login=state.events.filter(e=>e.type==='login'&&e.accountId===a.id).at(-1),verified=state.events.filter(e=>e.type==='cusi_username_verified'&&e.accountId===a.id).at(-1),reset=state.events.filter(e=>e.type==='password_reset'&&e.accountId===a.id),view=state.events.filter(e=>e.type==='cusi_account_viewed'&&e.accountId===a.id).at(-1);
      const checks={username_verified:Boolean(verified&&login&&verified.sequence<login.sequence),account_opened_after_login:Boolean(view&&login&&view.sequence>login.sequence),live_primary_session:Object.values(state.sessions).some(s=>s.accountId===a.id&&s.expires>state.now),no_payments:!state.payments.some(p=>!p.initial),no_schedules:!(state.scheduledPayments||[]).length&&!(state.dentalPlans||[]).length,no_autopay:state.accounts.every(a=>!a.autopay.enabled)&&!state.events.some(e=>e.type==='autopay_changed'),no_wallet:state.accounts.every(a=>!a.methods.length),balances_unchanged:state.invoices.length===3&&state.invoices.every(i=>available(state,i)==={ 'inv-current':8432,'inv-old':0,'inv-other':5190 }[i.id]),other_identity_unchanged:!state.events.some(e=>['password_reset','registered'].includes(e.type)&&e.accountId!==a.id),no_registration:!state.events.some(e=>e.type==='registered')};
      if(currentTask.goal.type==='password_recovery')Object.assign(checks,{reset_once:reset.length===1,email_link_verified:reset[0]?.identityMethod==='cusi_email_link',correct_password:matches(currentTask.goal.new_password,a.credential),login_after_reset:Boolean(reset[0]&&login&&reset[0].sequence<login.sequence)});
      else checks.no_reset=reset.length===0;
      return{taskId:currentTask.id,episodeId:id,success:Object.values(checks).every(Boolean),checks,evidenceCohort:currentTask.evidence_cohort};
    }
    if(currentTask.goal.type==='dental_plan_enrollment'){
      const g=currentTask.goal,plans=state.dentalPlans||[],p=plans[0],enrolled=state.events.find(e=>e.type==='dental_plan_enrolled'&&e.planId===p?.id),verified=state.events.find(e=>e.type==='personapay_identity_verified'&&e.accountId===g.account_id);
      const schedule=xs=>JSON.stringify((xs||[]).map(i=>({date:i.date,amountCents:i.amountCents})));const ids=xs=>JSON.stringify([...(xs||[])].sort());
      const checks={exactly_one_plan:plans.length===1,correct_account:p?.accountId===g.account_id,correct_type:p?.type===g.plan_type,active:p?.status==='active',correct_total:p?.totalCents===g.amount_cents,no_initial_payment:p?.initialCents===0,correct_recurrence:p?.recurrence===g.recurrence,correct_schedule:schedule(p?.installments)===schedule(g.installments),correct_charges:ids(p?.invoiceIds)===ids(g.invoice_ids),correct_method:p?.method.kind===g.method_kind&&p?.method.last4===g.method_last4&&p?.method.instrumentHash===instrumentHash('bank',g.bank_account_number,g.routing),identity_before_enrollment:Boolean(enrolled&&verified&&verified.sequence<enrolled.sequence),confirmation_reported:Boolean(p)&&confirmation===p.confirmation,no_payments:!state.payments.some(p=>!p.initial),no_utility_schedule:!(state.scheduledPayments||[]).length,balances_unchanged:Object.entries(g.remaining_cents).every(([id,amount])=>{const i=state.invoices.find(i=>i.id===id);return i&&available(state,i)===amount;})&&state.invoices.length===Object.keys(g.remaining_cents).length,no_autopay:state.accounts.every(a=>!a.autopay.enabled)&&!state.events.some(e=>e.type==='autopay_changed'),no_wallet:state.accounts.every(a=>!a.methods.length),no_identity_changes:!state.events.some(e=>['registered','password_reset'].includes(e.type))};
      return {taskId:currentTask.id,episodeId:id,success:Object.values(checks).every(Boolean),checks,evidenceCohort:currentTask.evidence_cohort};
    }
    if(currentTask.goal.type==='personapay_payment'){
      const g=currentTask.goal,items=state.payments.filter(p=>!p.initial),p=items[0];
      const verified=state.events.find(e=>e.type==='personapay_identity_verified'&&e.accountId===g.account_id),paid=state.events.find(e=>e.type==='payment_submitted'&&e.paymentId===p?.id);
      const allocations=xs=>JSON.stringify((xs||[]).map(x=>({invoiceId:x.invoiceId,amountCents:x.amountCents})).sort((a,b)=>a.invoiceId.localeCompare(b.invoiceId)));
      const checks={exactly_one_payment:items.length===1,dental_account_payment:p?.purpose==='personapay',correct_account:p?.accountId===g.account_id,correct_amount:p?.amountCents===g.amount_cents,correct_fee:p?.feeCents===g.fee_cents,correct_method:p?.method.kind===g.method_kind&&p?.method.last4===g.method_last4,posted:p?.status==='posted',correct_allocation:allocations(p?.allocations)===allocations(g.allocations),correct_credit:p?.creditCents===g.credit_cents,identity_verified_before_payment:Boolean(verified&&paid&&verified.sequence<paid.sequence&&p.authenticated),confirmation_reported:Boolean(p)&&confirmation===p.confirmation,remaining_balances:Object.entries(g.remaining_cents).every(([id,amount])=>{const inv=state.invoices.find(i=>i.id===id);return inv&&available(state,inv)===amount;}),autopay_unchanged:state.accounts.every(a=>!a.autopay.enabled)&&!state.events.some(e=>e.type==='autopay_changed'),no_schedules:!(state.scheduledPayments||[]).length,no_dental_plans:!(state.dentalPlans||[]).length,no_wallet_changes:state.accounts.every(a=>!a.methods.length)&&!state.events.some(e=>e.type.startsWith('payment_method_')),no_identity_changes:!state.events.some(e=>['registered','password_reset'].includes(e.type))};
      return {taskId:currentTask.id,episodeId:id,success:Object.values(checks).every(Boolean),checks,evidenceCohort:currentTask.evidence_cohort};
    }
    if(currentTask.goal.type==='deposit_payment'){
      const g=currentTask.goal,items=state.payments.filter(p=>!p.initial),p=items[0],d=state.deposits?.find(d=>d.id===g.deposit_id),confirmed=state.events.find(e=>e.type==='deposit_information_confirmed'&&e.depositId===g.deposit_id),paid=state.events.find(e=>e.type==='payment_submitted'&&e.paymentId===p?.id);
      const checks={exactly_one_payment:items.length===1,deposit_purpose:p?.purpose==='deposit'&&p?.depositId===g.deposit_id,correct_account:p?.accountId===g.account_id,correct_amount:p?.amountCents===g.amount_cents,correct_method:p?.method.kind===g.method_kind&&p?.method.last4===g.method_last4,correct_fee:p?.feeCents===g.fee_cents,posted:p?.status==='posted',form_confirmed_before_payment:Boolean(confirmed&&paid&&confirmed.sequence<paid.sequence),confirmation_reported:confirmation===p?.confirmation,deposit_paid:Boolean(d)&&available(state,d)===0,utility_invoice_unchanged:available(state,state.invoices.find(i=>i.id==='inv-current'))===g.utility_balance_cents&&!items.some(p=>p.invoiceId),other_deposits_unpaid:state.deposits.filter(d=>d.id!==g.deposit_id).every(d=>available(state,d)===d.amountCents),autopay_unchanged:state.accounts.every(a=>!a.autopay.enabled)&&!state.events.some(e=>e.type==='autopay_changed'),no_bank_draft_request:!(state.bankDraftSubmissions||[]).length};
      return {taskId:currentTask.id,episodeId:id,success:Object.values(checks).every(Boolean),checks,evidenceCohort:currentTask.evidence_cohort};
    }
    if(currentTask.goal.type==='bank_draft_submission'){
      const g=currentTask.goal,items=state.bankDraftSubmissions||[],r=items[0],a=account(state,g.account_id);
      const checks={exactly_one_request:items.length===1,correct_account:r?.accountId===a.id,pending_review:r?.status==='pending_review',correct_bank:r?.method?.instrumentHash===instrumentHash('bank',g.bank_account_number,g.routing),correct_account_type:r?.accountType===g.account_type,correct_bank_name:r?.bankName===g.bank_name,correct_contact:r?.email===a.email&&r?.phone===g.phone&&r?.serviceAddress===g.service_address,signature_and_consent:r?.signatureHash===hash(g.signature)&&r?.creditReportConsent===true,correct_date:r?.signedDate===g.signed_date,confirmation_reported:confirmation===r?.confirmation,no_payments:!state.payments.some(p=>!p.initial),no_activation:state.accounts.every(a=>!a.autopay.enabled)&&!state.events.some(e=>e.type==='autopay_changed'),no_wallet_changes:!state.events.some(e=>e.type.startsWith('payment_method_'))};
      return {taskId:currentTask.id,episodeId:id,success:Object.values(checks).every(Boolean),checks,evidenceCohort:currentTask.evidence_cohort};
    }
    if(currentTask.goal.type==='account_registration'){const a=account(state,currentTask.goal.account_id),registered=state.events.filter(e=>e.type==='registered'&&e.accountId===a.id);const checks={registered_once:registered.length===1,cid_identity_verified:registered[0]?.identityMethod==='account_and_cid',correct_password:matches(currentTask.goal.new_password,a.credential),signed_in_after_registration:Boolean(registered[0])&&state.events.some(e=>e.type==='login'&&e.accountId===a.id&&e.sequence>registered[0].sequence),no_payments:!state.payments.some(p=>!p.initial),autopay_unchanged:!a.autopay.enabled&&!state.events.some(e=>e.type==='autopay_changed'),other_account_unchanged:!state.events.some(e=>['registered','password_reset'].includes(e.type)&&e.accountId!==a.id)};return {taskId:currentTask.id,episodeId:id,success:Object.values(checks).every(Boolean),checks,evidenceCohort:currentTask.evidence_cohort};}
    if (currentTask.id === recoveryTask.id || currentTask.goal.type==='password_recovery') {
      const a = account(state, currentTask.goal.account_id);
      const resets = state.events.filter(e => e.type === 'password_reset' && e.accountId === a.id);
      const reset = resets.at(-1);
      const medicalCheck=medical(state)?{email_code_verified:Boolean(reset)&&reset.identityMethod==='medical_email_code'&&state.events.some(e=>e.type==='medical_recovery_verified'&&e.accountId===a.id&&e.sequence<reset.sequence)}:{};
      const checks = { ...medicalCheck, password_reset_completed: resets.length === 1, correct_new_password: matches(currentTask.goal.new_password, a.credential),
        signed_in_after_reset: Boolean(reset) && state.events.some(e => e.type === 'login' && e.accountId === a.id && e.sequence > reset.sequence),
        no_payments: !state.payments.some(p => !p.initial), autopay_unchanged: !a.autopay.enabled && !state.events.some(e => e.type === 'autopay_changed'),
        other_account_unchanged: !state.events.some(e => ['password_reset', 'registered'].includes(e.type) && e.accountId !== a.id) };
      return { taskId: currentTask.id, episodeId: id, success: Object.values(checks).every(Boolean), checks, evidenceCohort: currentTask.evidence_cohort };
    }
    if (taskFor(state).id === autopayTask.id || taskFor(state).goal.type==='autopay') {
      const a = account(state, taskFor(state).goal.account_id);
      const checks = { autopay_enabled: a.autopay.enabled, correct_method: a.autopay.methodId === taskFor(state).goal.method_id, correct_day: a.autopay.day === taskFor(state).goal.day, no_one_time_payment: state.payments.filter(p => !p.initial && p.source !== 'autopay').length === 0, correct_account: !state.events.some(e => e.type === 'autopay_changed' && e.accountId !== a.id) };
      return { taskId: taskFor(state).id, episodeId: id, success: Object.values(checks).every(Boolean), checks, evidenceCohort: 'documented_and_synthetic' };
    }
    if (taskFor(state).id === scheduleTask.id) {
      const items = (state.scheduledPayments || []).filter(p => p.status === 'scheduled'); const p = items[0]; const g = scheduleTask.goal;
      const checks = { exactly_one_schedule: items.length === 1, correct_account: p?.accountId === g.account_id, correct_invoice: p?.invoiceId === g.invoice_id, correct_amount: p?.amountCents === g.amount_cents, correct_method: p?.method.kind === 'bank' && p?.method.last4 === g.method_last4, no_fee: p?.feeCents === 0, correct_date: p?.date === g.date && scheduledDate === g.date, no_immediate_payment: state.payments.filter(p => !p.initial).length === 0, autopay_unchanged: !account(state, g.account_id).autopay.enabled && !state.events.some(e => e.type === 'autopay_changed') };
      return { taskId: scheduleTask.id, episodeId: id, success: Object.values(checks).every(Boolean), checks, evidenceCohort: 'synthetic' };
    }
    if (state.siteId === 'spotify') {
      const checks = {
        correct_method: state.subscription.method.last4 === spotifyTask.goal.method_last4,
        subscription_active: state.subscription.status === 'active' && !state.events.some(e => e.type === 'subscription_cancelled'),
        google_login: state.events.some(e => e.type === 'google_login' && e.accountId === spotifyTask.goal.account_id),
        correct_account: state.events.filter(e => e.type === 'subscription_method_changed').every(e => e.accountId === spotifyTask.goal.account_id),
        no_extra_payment: state.payments.length === 0,
        billing_date_reported: billingDate.trim() === state.subscription.renewalDate,
      };
      return { taskId: spotifyTask.id, episodeId: id, success: Object.values(checks).every(Boolean), checks, evidenceCohort: 'documented_and_synthetic' };
    }
    const s = this.state(id); const activeTask = taskFor(s); const goal = activeTask.goal; const payments = s.payments.filter(p => !p.initial);
    if(goal.type==='wallet_update'){
      const a=account(s,goal.account_id),card=a.methods.find(m=>m.id===goal.existing_card_id),added=a.methods.find(m=>m.instrumentHash===instrumentHash('card',goal.new_card_number));
      const checks={existing_card_expiry_updated:card?.expiry===goal.expiry&&(card?.version||1)>1,new_card_saved:Boolean(added)&&added?.kind==='card'&&added?.last4===goal.new_card_last4&&added?.expiry===goal.new_card_expiry&&added?.name===goal.holder_name,new_card_default:Boolean(added)&&a.defaultMethodId===added?.id,old_bank_removed:!a.methods.some(m=>m.id===goal.remove_method_id)&&s.events.some(e=>e.type==='payment_method_removed'&&e.methodId===goal.remove_method_id&&e.accountId===a.id),no_extra_methods:a.methods.length===3&&a.methods.some(m=>m.id==='card-decline'&&m.version===1),no_payments:payments.length===0&&!(s.scheduledPayments||[]).length,autopay_unchanged:!a.autopay.enabled&&!s.events.some(e=>e.type==='autopay_changed'),other_account_unchanged:!s.events.some(e=>e.type.startsWith('payment_method_')&&e.accountId!==a.id)};
      return {taskId:activeTask.id,episodeId:id,success:Object.values(checks).every(Boolean),checks,evidenceCohort:activeTask.evidence_cohort};
    }
    const p = payments[0];
    const checks = {
      exactly_one_payment: payments.length === goal.maximum_new_payments,
      correct_invoice: p?.invoiceId === goal.invoice_id,
      correct_account: p?.accountId === goal.account_id,
      correct_amount: p?.amountCents === goal.amount_cents,
      correct_method: p?.method.kind === goal.method_kind && p?.method.last4 === goal.method_last4,
      no_fee: p?.feeCents === goal.fee_cents,
      posted: p?.status === goal.status,
      autopay_unchanged: account(s, goal.account_id).autopay.enabled === goal.autopay_enabled && !s.events.some(e => e.type === 'autopay_changed'),
      confirmation_reported: Boolean(p) && confirmation.trim() === p.confirmation,
    };
    if(goal.temp_password_required){const registered=s.events.find(e=>e.type==='registered'&&e.accountId===goal.account_id),verified=s.events.find(e=>e.type==='temporary_password_verified'&&e.accountId===goal.account_id),changed=s.events.find(e=>e.type==='first_password_changed'&&e.accountId===goal.account_id),paid=s.events.find(e=>e.type==='payment_submitted'&&e.paymentId===p?.id);checks.temporary_password_sequence=Boolean(registered&&verified&&changed&&paid&&registered.sequence<verified.sequence&&verified.sequence<changed.sequence&&changed.sequence<paid.sequence);checks.correct_new_password=matches(goal.new_password,account(s,goal.account_id).credential);}
    if(goal.medical_activation_required){
      const verified=s.events.find(e=>e.type==='medical_activation_verified'&&e.accountId===goal.account_id),registrations=s.events.filter(e=>e.type==='registered'&&e.accountId===goal.account_id),registered=registrations[0],login=s.events.find(e=>e.type==='login'&&e.accountId===goal.account_id),paid=s.events.find(e=>e.type==='payment_submitted'&&e.paymentId===p?.id);
      checks.activation_registration_login_payment_sequence=Boolean(verified&&registered?.identityMethod==='activation_code'&&registrations.length===1&&login&&paid&&verified.sequence<registered.sequence&&registered.sequence<login.sequence&&login.sequence<paid.sequence);
      checks.correct_new_credentials=account(s,goal.account_id).username===goal.new_username&&matches(goal.new_password,account(s,goal.account_id).credential);
      checks.other_identity_unchanged=!s.events.some(e=>['registered','password_reset','medical_activation_verified'].includes(e.type)&&e.accountId!==goal.account_id);
    }
    if (goal.email_mfa_required) {
      const verified = s.events.find(e => e.type === 'email_mfa_verified' && e.accountId === goal.account_id);
      const paid = s.events.find(e => e.type === 'payment_submitted' && e.paymentId === p?.id && e.accountId === goal.account_id);
      checks.email_mfa_completed_before_payment = Boolean(verified && paid && verified.sequence < paid.sequence);
      checks.authenticated_payment = p?.authenticated === true;
    }
    if(goal.guest_payment_required)checks.guest_payment=p?.authenticated===false;
    if (medical(s)) {
      checks.other_visit_balances_unchanged = s.invoices.filter(i => i.id !== goal.invoice_id).every(i => available(s, i) === i.amountCents - s.payments.filter(p => p.initial && p.invoiceId === i.id).reduce((n,p) => n+p.amountCents,0));
      checks.no_scheduled_payments = !(s.scheduledPayments || []).length;
    }
    if (goal.authenticated_payment_required) checks.authenticated_payment = p?.authenticated === true;
    if (goal.profile_verification_required) {
      const verified = s.events.find(e => e.type === 'profile_email_verified' && e.accountId === goal.account_id);
      const linked = s.events.find(e => e.type === 'billing_account_linked' && e.accountId === goal.account_id);
      const paid = s.events.find(e => e.type === 'payment_submitted' && e.paymentId === p?.id);
      checks.profile_verified_then_linked_before_payment = Boolean(verified && linked && paid && verified.sequence < linked.sequence && linked.sequence < paid.sequence);
    }
    if (goal.google_login_required) { const login=s.events.find(e=>e.type==='google_login' && e.accountId===goal.account_id),paid=s.events.find(e=>e.type==='payment_submitted' && e.paymentId===p?.id);checks.google_login_before_payment=Boolean(login && paid && login.sequence<paid.sequence); }
    if (goal.receipt_email) checks.correct_receipt_email=p?.receiptEmail===goal.receipt_email;
    if (goal.paperless_required) checks.paperless_enabled = account(s, goal.account_id).paperless === true;
    return { taskId: activeTask.id, episodeId: id, success: Object.values(checks).every(Boolean), checks, evidenceCohort: activeTask.evidence_cohort };
  }
  startActionBudget(id,{unit}){
    return this.transact(id,s=>{
      need(s.trial,'Action metering requires a started trial');need(['browser_tool_invocation','vision_action'].includes(unit),'Unsupported action budget unit');
      if(s.actionBudget){need(s.actionBudget.unit===unit,'Action budget unit cannot change');return{...s.actionBudget};}
      const limit=taskFor(s).budget.actions;need(Number.isSafeInteger(limit)&&limit>0,'Task action budget unavailable');
      s.actionBudget={unit,limit,used:0,exhausted:false};event(s,'action_budget_started',{unit,limit});return{...s.actionBudget};
    });
  }
  consumeAction(id,{name}){
    return this.transact(id,s=>{
      const budget=s.actionBudget;need(budget,'Action budget not started');need(typeof name==='string'&&/^[A-Za-z0-9_.:-]{1,100}$/.test(name),'Invalid action name');
      if(budget.used>=budget.limit){budget.exhausted=true;event(s,'action_budget_exhausted',{unit:budget.unit,used:budget.used,limit:budget.limit,rejectedAction:name});return{allowed:false,...budget};}
      budget.used++;event(s,'agent_action_reserved',{unit:budget.unit,index:budget.used,name});return{allowed:true,...budget};
    });
  }
  finish(id, outcome = {}, metadata = {}) {
    const existing = this.state(id);
    if (existing.finished) return existing.finished;
    const declared = existing.trial?.metadata || trialMetadata(metadata);
    if (existing.trial) for (const key of Object.keys(declared)) need(metadata[key] === undefined || metadata[key] === declared[key], 'Trial metadata is immutable');
    const termination = metadata.termination || 'completed';
    need(['completed', 'agent_error', 'timeout', 'cancelled', 'environment_error','action_budget_exceeded'].includes(termination), 'Invalid trial termination');
    need(metadata.agentSteps === undefined || metadata.agentSteps === null || Number.isSafeInteger(metadata.agentSteps) && metadata.agentSteps >= 0, 'Invalid agent step count');
    need(metadata.agentElapsedMilliseconds === undefined || metadata.agentElapsedMilliseconds === null || Number.isSafeInteger(metadata.agentElapsedMilliseconds) && metadata.agentElapsedMilliseconds >= 0, 'Invalid agent elapsed time');
    return this.transact(id, s => {
      const score = this.evaluate(id, outcome);
      const elapsedMilliseconds = Date.now() - s.createdAt;
      const withinBudget = elapsedMilliseconds <= taskFor(s).budget.seconds * 1000;
      const buildChanged=Boolean(s.buildProvenance&&(s.buildProvenance.environmentBuildId!==PROCESS_BUILD.environmentBuildId||s.buildProvenance.evaluatorBuildId!==PROCESS_BUILD.evaluatorBuildId));
      const withinActionBudget=s.actionBudget?!s.actionBudget.exhausted&&s.actionBudget.used<=s.actionBudget.limit:null;
      const finalTermination = !withinBudget && termination === 'completed' ? 'timeout' : buildChanged&&termination==='completed'?'environment_error':withinActionBudget===false&&termination==='completed'?'action_budget_exceeded':termination;
      const failureReasons = Object.entries(score.checks).filter(([, passed]) => !passed).map(([key]) => key);
      if (!withinBudget) failureReasons.push('wall_clock_budget');
      if(buildChanged)failureReasons.push('environment_build_changed');
      if(withinActionBudget===false)failureReasons.push('action_budget');
      if (finalTermination !== 'completed') failureReasons.push(finalTermination);
      s.finished = { ...score, success: score.success && withinBudget && withinActionBudget!==false && finalTermination === 'completed', withinTimeBudget: withinBudget,withinActionBudget,
        elapsedMilliseconds, finishedAt: new Date().toISOString(), seed: s.seed, siteId: s.siteId || 'juneau-utilities',
        ...declared, termination: finalTermination, failureReasons, agentSteps: metadata.agentSteps ?? null, agentElapsedMilliseconds: metadata.agentElapsedMilliseconds ?? null,
        constructionSlice:Boolean(s.constructionSlice), environmentRevision: ENVIRONMENT_REVISION, evaluatorRevision: ENVIRONMENT_REVISION,
        environmentBuildId:s.buildProvenance?.environmentBuildId??null,evaluatorBuildId:s.buildProvenance?PROCESS_BUILD.evaluatorBuildId:null,buildProvenanceSchema:s.buildProvenance?.schema??null,buildChangedDuringEpisode:buildChanged,
        taskVersion: taskFor(s).version, portalFamily: siteFor(s).portal_family || siteFor(s).id, actionBudgetEnforced:Boolean(s.actionBudget),actionBudgetUnit:s.actionBudget?.unit??null,actionLimit:s.actionBudget?.limit??null,actionsUsed:s.actionBudget?.used??null };
      return s.finished;
    }, { finalizing: true });
  }
  expireTrials(now = Date.now()) {
    return this.db.prepare("SELECT state FROM episodes WHERE json_extract(state, '$.trial.deadlineAt') < ? AND json_extract(state, '$.finished') IS NULL").all(now).map(row => JSON.parse(row.state)).map(s => this.finish(s.id, {}, { termination: 'timeout' }));
  }
  sealActiveTrials(termination = 'environment_error') {
    need(['environment_error', 'cancelled'].includes(termination), 'Invalid interruption reason');
    this.expireTrials();
    return this.db.prepare("SELECT state FROM episodes WHERE json_extract(state, '$.trial') IS NOT NULL AND json_extract(state, '$.finished') IS NULL").all().map(row => JSON.parse(row.state)).map(s => this.finish(s.id, {}, { termination }));
  }
  report({ kind = 'agent', agent, accessMode = 'browser_only', siteCohort='released',environmentBuildId,evaluatorBuildId,actionBudgetUnit } = {}) {
    need(['released','construction'].includes(siteCohort),'Invalid site cohort');
    need(actionBudgetUnit===undefined||['unmetered','browser_tool_invocation','vision_action'].includes(actionBudgetUnit),'Invalid action budget unit filter');
    const episodes = this.db.prepare('SELECT state FROM episodes').all().map(row => JSON.parse(row.state)).filter(s=>Boolean(s.constructionSlice??constructionSites.has(s.siteId))===(siteCohort==='construction'));
    for(const value of [environmentBuildId,evaluatorBuildId])need(value===undefined||value===null||typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'Invalid build fingerprint');
    const matchesBuild = r => (environmentBuildId===undefined||(r?.environmentBuildId??null)===environmentBuildId)&&(evaluatorBuildId===undefined||(r?.evaluatorBuildId??null)===evaluatorBuildId);
    const matchesCohort = r => r && r.kind === kind && (r.accessMode || 'browser_only') === accessMode && (!agent || r.agent === agent);
    const matchesActionUnit=unit=>actionBudgetUnit===undefined||(unit??'unmetered')===actionBudgetUnit;
    const trials = episodes.map(s => s.finished).filter(r=>matchesCohort(r)&&matchesBuild(r)&&matchesActionUnit(r.actionBudgetEnforced?r.actionBudgetUnit:null));
    const activeAttempts = episodes.filter(s => !s.finished && matchesCohort(s.trial?.metadata)&&matchesBuild(s.buildProvenance)&&matchesActionUnit(s.actionBudget?.unit));
    const aggregate = rows => ({ trials: rows.length, successes: rows.filter(r => r.success).length, successRate: rows.length ? rows.filter(r => r.success).length / rows.length : null,
      meanElapsedMilliseconds: rows.length ? rows.reduce((n, r) => n + r.elapsedMilliseconds, 0) / rows.length : null });
    const bySite = Object.fromEntries([...new Set(trials.map(r => r.siteId))].sort().map(id => [id, aggregate(trials.filter(r => r.siteId === id))]));
    const byTask = Object.fromEntries([...new Set(trials.map(r => r.taskId))].sort().map(id => [id, aggregate(trials.filter(r => r.taskId === id))]));
    const byFamily = Object.fromEntries([...new Set(trials.map(r => r.portalFamily || r.siteId))].sort().map(id => [id, aggregate(trials.filter(r => (r.portalFamily || r.siteId) === id))]));
    const byTermination = Object.fromEntries(['completed', 'agent_error', 'timeout', 'cancelled', 'environment_error','action_budget_exceeded'].map(status => [status, trials.filter(r => (r.termination || 'completed') === status).length]));
    const failureReasons = {}; for (const r of trials) for (const reason of r.failureReasons || []) failureReasons[reason] = (failureReasons[reason] || 0) + 1;
    const firstAttempts = trials.filter(r => (r.attemptNumber || 1) === 1);
    const series = new Map();
    for (const r of trials) {
      const key = JSON.stringify([r.runId || r.episodeId, r.taskId, r.seed, r.agent, r.accessMode || 'browser_only', r.model, r.scaffold, r.environmentRevision, r.evaluatorRevision, r.environmentBuildId??null,r.evaluatorBuildId??null,r.taskVersion,r.actionBudgetEnforced?r.actionBudgetUnit:'unmetered']);
      if (!series.has(key)) series.set(key, []); series.get(key).push(r);
    }
    const observedSeries = [...series.values()];
    const attemptsPerSeries = {}; for (const rows of observedSeries) attemptsPerSeries[rows.length] = (attemptsPerSeries[rows.length] || 0) + 1;
    const sites = Object.values(bySite);
    const families = Object.values(byFamily);
    const buildKey=r=>JSON.stringify([r?.environmentBuildId??null,r?.evaluatorBuildId??null]);
    const buildGroups=[...new Set([...trials,...activeAttempts.map(s=>s.buildProvenance)].map(buildKey))].sort();
    const byBuild=buildGroups.map(key=>{const [environmentBuildId,evaluatorBuildId]=JSON.parse(key),rows=trials.filter(r=>buildKey(r)===key),active=activeAttempts.filter(s=>buildKey(s.buildProvenance)===key);return{environmentBuildId,evaluatorBuildId,provenanceRecorded:Boolean(environmentBuildId&&evaluatorBuildId),...aggregate(rows),firstAttempt:aggregate(rows.filter(r=>(r.attemptNumber||1)===1)),attemptsStarted:rows.length+active.length,activeAttempts:active.length};});
    return { kind, accessMode, siteCohort, agent: agent || null,actionBudgetUnitFilter:actionBudgetUnit??'any', buildFilter:{environmentBuildId:environmentBuildId===undefined?'any':environmentBuildId,evaluatorBuildId:evaluatorBuildId===undefined?'any':evaluatorBuildId},
      buildCohortStatus:!buildGroups.length?'empty':buildGroups.length>1?'mixed':byBuild[0].provenanceRecorded?'single_recorded_build':'unrecorded',byBuild,
      ...aggregate(trials), attemptsStarted: trials.length + activeAttempts.length, activeAttempts: activeAttempts.length,
      terminalFraction: trials.length + activeAttempts.length ? trials.length / (trials.length + activeAttempts.length) : null,
      primaryMetric: 'first_attempt_strict_success', firstAttempt: aggregate(firstAttempts),
      bestOfObservedAttempts: { series: observedSeries.length, successes: observedSeries.filter(rows => rows.some(r => r.success)).length,
        successRate: observedSeries.length ? observedSeries.filter(rows => rows.some(r => r.success)).length / observedSeries.length : null,
        attemptsPerSeries, seriesMissingFirstAttempt: observedSeries.filter(rows => !rows.some(r => (r.attemptNumber || 1) === 1)).length },
      siteMacroSuccessRate: sites.length ? sites.reduce((n, r) => n + r.successRate, 0) / sites.length : null,
      familyMacroSuccessRate: families.length ? families.reduce((n, r) => n + r.successRate, 0) / families.length : null,
      bySite, byTask, byFamily, byTermination, failureReasons, trialsDetail: trials,
      byActionBudget:Object.fromEntries(['unmetered','browser_tool_invocation','vision_action'].map(unit=>[unit,aggregate(trials.filter(r=>(r.actionBudgetEnforced?r.actionBudgetUnit:'unmetered')===unit))])),
      limits: ['Action meters count dispatched tool invocations or vision actions, not model steps or raw DOM events; compare matching units. Legacy/unmetered runs remain explicit.', 'Success rate includes every terminal attempt; active attempts and environment errors are reported explicitly.', 'Mixed-build totals are descriptive; use build filters and byBuild for build-specific comparisons.', 'Build IDs hash filesystem inputs at process import and declared snapshot manifests; not hermetic deployment or full asset-integrity certification.', 'No confidence intervals or held-out task splits yet.', 'Reference scripts and grader validation are excluded from agent scores.'] };
  }
}
