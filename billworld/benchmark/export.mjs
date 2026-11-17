// The public Billworld benchmark files: every released task's public prompt and budget, its site,
// and the fixed splits, written as JSON Lines for a dataset hub. Private goals, graders, persona
// credentials and captured assets stay in the runtime.
//   node billworld/benchmark/export.mjs            write billworld/benchmark/data
//   node billworld/benchmark/export.mjs --check    fail if the committed files are stale
import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const here=dirname(fileURLToPath(import.meta.url)),root=join(here,'..');
const read=path=>JSON.parse(readFileSync(path,'utf8'));

/** One bill-payment task on each of ten different sites (nine portal families): the core split. */
/** Split ids use underscores, which dataset hubs accept as split names. */
export const CORE_SPLIT='billpay_core_10';
export const BILLPAY_CORE=['task_m1','task_m3','task_m4','task_m5','task_m6','task_m8','task_m11','task_m12','task_md1','task_bat4'];

/** The held-out split: released tasks that agents, prompts and harnesses are never tuned or iterated on. It is
 * frozen here, like the core split, so a new release never moves a task into or out of it silently. It was picked by
 * selectHeldOut() below from the released tasks of this export, and build() checks that it still is that pick. */
export const HELD_OUT_SPLIT='held_out';
export const HELD_OUT=['task_m2','task_m9','task_h12','task_h18','task_md2','task_md4','task_inf1','task_inf4','task_inf10','task_inf14','task_inf16','task_onswc2','task_onswc6','task_onswc9','task_onswc13','task_onswc16','task_bat3','task_bat6',
  'task_bat9','task_bat12','task_bat17','task_ccu2','task_ccu6','task_ccu10','task_ccu11','task_gmg5','task_gmg9','task_gmg12','task_gmg15','task_gmg16','task_tus1','task_tus4','task_lw1','task_lw3','task_lw6'];
export const HELD_OUT_SALT='billworld-held-out-v1';

/** The held-out pick, deterministic from the public rows alone. Candidates are the released tasks outside the core split.
 * Strata are the categories: each holds out round(n/4) of its n candidates (a singleton category holds out none, so
 * every category stays developable). Categories are filled smallest first (ties by name); within one, each pick is the
 * candidate whose portal family, then site, would have the smallest share of its candidates held out (picks so far,
 * plus this one, over its candidates), so families and sites are held out in proportion to their size; ties go to the
 * lowest SHA-256 of `${HELD_OUT_SALT}:${reference_id}`. The result is in released order. */
export function selectHeldOut(tasks,core=BILLPAY_CORE){
  const candidates=tasks.filter(task=>!core.includes(task.reference_id));
  const rank=id=>createHash('sha256').update(`${HELD_OUT_SALT}:${id}`).digest('hex');
  const byCategory=Map.groupBy(candidates,task=>task.category);
  const order=[...byCategory.keys()].sort((a,b)=>byCategory.get(a).length-byCategory.get(b).length||a.localeCompare(b));
  const families=new Map(),sites=new Map(),picked=new Set();
  const count=(map,key)=>map.get(key)??0;
  const familySize=Map.groupBy(candidates,task=>task.portal_family),siteSize=Map.groupBy(candidates,task=>task.site_id);
  // The share of a family's (or site's) candidates already held out, counting the pick being weighed.
  const share=(map,sizes,key)=>(count(map,key)+1)/sizes.get(key).length;
  for(const category of order){
    const pool=byCategory.get(category).map(task=>({task,rank:rank(task.reference_id)}));
    for(let k=Math.round(pool.length/4);k>0;k--){
      pool.sort((a,b)=>share(families,familySize,a.task.portal_family)-share(families,familySize,b.task.portal_family)
        ||share(sites,siteSize,a.task.site_id)-share(sites,siteSize,b.task.site_id)||a.rank.localeCompare(b.rank));
      const {task}=pool.shift();
      picked.add(task.reference_id);
      families.set(task.portal_family,count(families,task.portal_family)+1);sites.set(task.site_id,count(sites,task.site_id)+1);
    }
  }
  return tasks.map(task=>task.reference_id).filter(id=>picked.has(id));
}

/** The outcome keys each private grader reads, by goal type: an audit of evaluate() in engine.mjs and the
 * site graders it delegates to (paymentus-portal, cusi-portal, charlotte, starnik-inframark, wipp, tuscaloosa).
 * A new goal type fails the export until it is added here, so a column never guesses what is graded. */
const OUTCOME_BY_TYPE={
  account_registration:[],autopay:[],bank_draft_submission:['confirmation'],
  ccu_autopay:[],ccu_history:['confirmation'],ccu_paperless:[],ccu_quickpay:['confirmation'],ccu_recovery:[],ccu_registration_payment:['confirmation'],
  ccu_schedule:['scheduledDate'],ccu_scheduled_cancel:[],ccu_scheduled_update:['scheduledDate'],ccu_signed_payment:['confirmation'],ccu_statement:['statementFilename'],
  cusi_payment:['confirmation'],cusi_portal_autopay:[],cusi_portal_echeck:['confirmation'],cusi_portal_manage_drafts:[],cusi_portal_preferences:[],
  cusi_portal_schedule:['scheduledDate'],cusi_registration:[],
  deposit_payment:['confirmation'],dental_plan_enrollment:['confirmation'],email_login:[],password_recovery:[],personapay_payment:['confirmation'],
  paymentus_autopay:[],paymentus_multi:['confirmation'],paymentus_password:[],paymentus_payment:['confirmation'],paymentus_preferences:[],paymentus_profile:[],
  paymentus_registration:[],paymentus_schedule:['confirmation'],paymentus_schedule_cancel:[],paymentus_schedule_edit:[],paymentus_statement:['statementFilename'],paymentus_wallet:[],
  starnik_ach:[],starnik_autopay:[],starnik_ebill:[],starnik_guest_payment:[],starnik_history:['postedBalanceCents','pendingPaymentCents','remainingBalanceCents'],
  starnik_linked_account:[],starnik_login:[],starnik_mailing_address:[],starnik_recovery:[],starnik_registration:[],starnik_signed_payment:[],
  starnik_statement:['statementFilename'],starnik_tenant_autopay:[],starnik_wallet:[],
  tus_autopay:[],tus_ebill:[],tus_payment:['confirmation'],tus_recovery:[],tus_registration:[],tus_schedule:['scheduledDate'],tus_statement:['statementFilename'],
  username_login:[],wallet_update:[],
  wipp_autopay_cancel:[],wipp_autopay_change:[],wipp_autopay_enroll:[],wipp_payment:['confirmation'],wipp_recovery:[],wipp_registration:[],
  wipp_schedule:['scheduledDate'],wipp_statement:['billingDate','remainingBalanceCents'],
};
const has=(goal,keys)=>keys.every(key=>Object.hasOwn(goal,key));

/** The outcome keys a task's private grader compares with state. Only key names leave the manifest, never goal values. */
export function outcomeFields(goal){
  if(!goal||typeof goal!=='object')throw Error('Task has no goal');
  if(goal.type==='starnik_schedule'){ // Only created and edited schedules ask for the date back.
    if(goal.mode==='cancel')return [];
    if(['create','edit'].includes(goal.mode))return ['scheduledDate'];
    throw Error(`Unknown starnik_schedule mode: ${goal.mode}`);
  }
  if(goal.type!==undefined){
    if(!Object.hasOwn(OUTCOME_BY_TYPE,goal.type))throw Error(`Unknown goal type: ${goal.type}`);
    return [...OUTCOME_BY_TYPE[goal.type]];
  }
  // Untyped goals are the first Juneau, Spotify and shared-payment graders, which engine.mjs picks by task;
  // each shape below is exactly one of them.
  if(has(goal,['subscription_status','billing_date_required']))return ['billingDate'];
  if(has(goal,['method_id','day'])&&!has(goal,['invoice_id']))return [];
  if(has(goal,['invoice_id','date'])&&!has(goal,['method_kind']))return ['scheduledDate'];
  if(has(goal,['new_password'])&&!has(goal,['invoice_id']))return [];
  if(has(goal,['invoice_id','amount_cents','method_kind','method_last4','fee_cents','status']))return ['confirmation'];
  throw Error(`Unknown untyped goal shape: ${Object.keys(goal).sort().join(',')}`);
}

/** What a task asks for, from its task id: a coarse public label for slicing results. */
export function category(taskId){
  const rules=[['recover',/recover|reset|forgot|username/],['register',/register|registration|activation|enroll-account|link/],['autopay',/autopay|auto-pay|bank-draft|ach|draft/],
    ['schedule',/schedule/],['statements',/statement|history|download/],['wallet',/wallet|card-update|update-card|payment-method/],['paperless',/paperless|ebill/],
    ['account',/profile|mailing|address|phone|notification|password|email-login/],['view',/view-bill/],['plan',/plan|installment/],['payment',/pay|deposit|payment/]];
  return rules.find(([,pattern])=>pattern.test(taskId))?.[0]??'other';
}

export function build(){
  const mapping=read(join(root,'infinity/app/tasks.json')).released;
  const manifests=new Map(readdirSync(join(root,'tasks')).filter(name=>name.endsWith('.json')).map(name=>read(join(root,'tasks',name))).map(task=>[`${task.site_id}/${task.id}`,task]));
  const sites=new Map(readdirSync(join(root,'sites')).filter(name=>name.endsWith('.json')).map(name=>read(join(root,'sites',name))).map(site=>[site.id,site]));
  const tasks=Object.entries(mapping).map(([referenceId,[siteId,taskId]])=>{
    const task=manifests.get(`${siteId}/${taskId}`),site=sites.get(siteId);
    if(!task||!site)throw Error(`Missing manifest for ${referenceId}`);
    if(!Number.isInteger(task.budget?.seconds)||!Number.isInteger(task.budget?.actions))throw Error(`Missing budget for ${referenceId}`);
    return {reference_id:referenceId,task_id:task.id,version:task.version,site_id:siteId,site_name:site.name,portal_family:site.portal_family,
      category:category(task.id),prompt:task.prompt,budget_seconds:task.budget.seconds,budget_actions:task.budget.actions,outcome_fields:outcomeFields(task.goal),evidence_cohort:task.evidence_cohort,
      splits:['released',...(BILLPAY_CORE.includes(referenceId)?[CORE_SPLIT]:[]),...(HELD_OUT.includes(referenceId)?[HELD_OUT_SPLIT]:[])]};
  }); // The evaluator's order: a task's seed is its position in it, starting at 1.
  const core=tasks.filter(task=>task.splits.includes(CORE_SPLIT));
  if(core.length!==BILLPAY_CORE.length||new Set(core.map(task=>task.site_id)).size!==BILLPAY_CORE.length||core.some(task=>task.category!=='payment'))
    throw Error('The core split must be ten payment tasks on ten different sites');
  const pick=selectHeldOut(tasks);
  if(JSON.stringify(pick)!==JSON.stringify(HELD_OUT))
    throw Error(`HELD_OUT is not the held-out pick of these released tasks; a release that changes it must decide so: ${JSON.stringify(pick)}`);
  if(HELD_OUT.some(id=>BILLPAY_CORE.includes(id)))throw Error('The held-out split must be disjoint from the core split');
  if(HELD_OUT.length<0.2*tasks.length||HELD_OUT.length>0.25*tasks.length)throw Error('The held-out split must be 20-25% of the released tasks');
  const siteRows=[...new Set(tasks.map(task=>task.site_id))].sort().map(id=>{
    const site=sites.get(id);
    return {site_id:id,site_name:site.name,portal_family:site.portal_family,implementation_status:site.implementation_status,revision:site.revision,
      released_tasks:tasks.filter(task=>task.site_id===id).length,fidelity_limits:site.fidelity_limits??[]};
  });
  const splits={released:tasks.map(task=>task.reference_id),[CORE_SPLIT]:BILLPAY_CORE,[HELD_OUT_SPLIT]:HELD_OUT};
  return {tasks,sites:siteRows,splits};
}

export const files=({tasks,sites,splits})=>({
  'data/tasks.jsonl':tasks.map(row=>JSON.stringify(row)).join('\n')+'\n',
  'data/sites.jsonl':sites.map(row=>JSON.stringify(row)).join('\n')+'\n',
  [`data/${CORE_SPLIT}.jsonl`]:tasks.filter(row=>row.splits.includes(CORE_SPLIT)).map(row=>JSON.stringify(row)).join('\n')+'\n',
  [`data/${HELD_OUT_SPLIT}.jsonl`]:tasks.filter(row=>row.splits.includes(HELD_OUT_SPLIT)).map(row=>JSON.stringify(row)).join('\n')+'\n',
  'data/splits.json':JSON.stringify(splits,null,2)+'\n',
});

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const written=files(build());
  if(process.argv.includes('--check')){
    const stale=Object.entries(written).filter(([path,text])=>{try{return readFileSync(join(here,path),'utf8')!==text;}catch{return true;}}).map(([path])=>path);
    if(stale.length)throw Error(`Stale benchmark files (run node billworld/benchmark/export.mjs): ${stale.join(', ')}`);
  } else {
    mkdirSync(join(here,'data'),{recursive:true});
    for(const [path,text] of Object.entries(written))writeFileSync(join(here,path),text);
    console.log(Object.keys(written).join('\n'));
  }
}
