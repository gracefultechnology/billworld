// The public Billworld benchmark files: every released task's public prompt and budget, its site,
// and the fixed splits, written as JSON Lines for a dataset hub. Private goals, graders, persona
// credentials and captured assets stay in the runtime.
//   node billworld/benchmark/export.mjs            write billworld/benchmark/data
//   node billworld/benchmark/export.mjs --check    fail if the committed files are stale
import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url)),root=join(here,'..');
const read=path=>JSON.parse(readFileSync(path,'utf8'));

/** One bill-payment task on each of ten different sites (nine portal families): the core split. */
export const BILLPAY_CORE=['task_m1','task_m3','task_m4','task_m5','task_m6','task_m8','task_m11','task_m12','task_md1','task_bat4'];

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
      category:category(task.id),prompt:task.prompt,budget_seconds:task.budget.seconds,budget_actions:task.budget.actions,evidence_cohort:task.evidence_cohort,
      splits:['released',...(BILLPAY_CORE.includes(referenceId)?['billpay-core-10']:[])]};
  }); // The evaluator's order: a task's seed is its position in it, starting at 1.
  const core=tasks.filter(task=>task.splits.includes('billpay-core-10'));
  if(core.length!==BILLPAY_CORE.length||new Set(core.map(task=>task.site_id)).size!==BILLPAY_CORE.length||core.some(task=>task.category!=='payment'))
    throw Error('The core split must be ten payment tasks on ten different sites');
  const siteRows=[...new Set(tasks.map(task=>task.site_id))].sort().map(id=>{
    const site=sites.get(id);
    return {site_id:id,site_name:site.name,portal_family:site.portal_family,implementation_status:site.implementation_status,revision:site.revision,
      released_tasks:tasks.filter(task=>task.site_id===id).length,fidelity_limits:site.fidelity_limits??[]};
  });
  const splits={released:tasks.map(task=>task.reference_id),'billpay-core-10':BILLPAY_CORE};
  return {tasks,sites:siteRows,splits};
}

const files=({tasks,sites,splits})=>({
  'data/tasks.jsonl':tasks.map(row=>JSON.stringify(row)).join('\n')+'\n',
  'data/sites.jsonl':sites.map(row=>JSON.stringify(row)).join('\n')+'\n',
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
