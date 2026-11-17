// Scores a Billworld results file: checks it against results.schema.json and the public task data, then
// prints the strict pass rate with a Wilson 95% interval per split and per category.
//   node billworld/benchmark/score.mjs results.json [--json]
// Every task of the declared split is in the denominator: a task with no trial counts as failed.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url)),repo=join(here,'../..');
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const lines=text=>text.split('\n').filter(Boolean).map(line=>JSON.parse(line));
export const schema=read(join(here,'results.schema.json'));

/** Validates value against the subset of JSON Schema that results.schema.json uses. An unknown keyword is an
 * error, so the schema cannot grow a construct this validator silently ignores. */
export function validate(node,value,path='$'){
  const known=new Set(['$schema','$id','title','description','type','enum','required','properties','additionalProperties','items','minItems','minimum','pattern','format']);
  const unknown=Object.keys(node).filter(key=>!known.has(key));
  if(unknown.length)throw Error(`Unsupported schema keyword at ${path}: ${unknown.join(', ')}`);
  const is={string:v=>typeof v==='string',boolean:v=>typeof v==='boolean',integer:Number.isSafeInteger,number:Number.isFinite,null:v=>v===null,
    array:Array.isArray,object:v=>v!==null&&typeof v==='object'&&!Array.isArray(v)};
  if(node.type!==undefined){const types=[node.type].flat();if(!types.some(type=>is[type](value)))return [`${path}: expected ${types.join(' or ')}`];}
  if(node.enum&&!node.enum.some(option=>option===value))return [`${path}: must be one of ${node.enum.join(', ')}`];
  const errors=[];
  if(typeof value==='string'){
    if(node.pattern&&!new RegExp(node.pattern,'u').test(value))errors.push(`${path}: does not match ${node.pattern}`);
    if(node.format==='date-time'&&!(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(value)&&!Number.isNaN(Date.parse(value))))errors.push(`${path}: not a date-time`);
  }
  if(typeof value==='number'&&node.minimum!==undefined&&value<node.minimum)errors.push(`${path}: below ${node.minimum}`);
  if(Array.isArray(value)){
    if(node.minItems!==undefined&&value.length<node.minItems)errors.push(`${path}: fewer than ${node.minItems} items`);
    if(node.items)value.forEach((item,index)=>errors.push(...validate(node.items,item,`${path}[${index}]`)));
  }
  if(is.object(value)){
    for(const key of node.required??[])if(!Object.hasOwn(value,key))errors.push(`${path}: missing ${key}`);
    for(const [key,item] of Object.entries(value)){
      if(node.properties&&Object.hasOwn(node.properties,key))errors.push(...validate(node.properties[key],item,`${path}.${key}`));
      else if(node.additionalProperties===false)errors.push(`${path}: unexpected ${key}`);
    }
  }
  return errors;
}

/** Wilson score interval for k passes in n trials at 95% confidence. */
export function wilson(k,n,z=1.96){
  if(!n)return [0,1];
  const p=k/n,d=1+z*z/n,c=p+z*z/(2*n),m=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n));
  return [Math.max(0,(c-m)/d),Math.min(1,(c+m)/d)];
}

const publicData=()=>({tasks:lines(readFileSync(join(here,'data/tasks.jsonl'),'utf8')),splits:read(join(here,'data/splits.json'))});

/** The public task data at a commit, or null when this checkout does not have that commit. */
function tasksAt(commit){
  try{return execFileSync('git',['show',`${commit}:billworld/benchmark/data/tasks.jsonl`],{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch{return null;}
}

/** Checks a results object and scores it. Errors make it unscoreable; warnings are reported beside the score. */
export function score(results,{tasks,splits}=publicData(),{commitTasks=tasksAt}={}){
  const errors=validate(schema,results),warnings=[];
  if(errors.length)return {errors,warnings};
  const byId=new Map(tasks.map(task=>[task.reference_id,task])),wanted=splits[results.split];
  if(!wanted)return {errors:[`Unknown split ${results.split}`],warnings};
  const first=new Map(),seen=new Set();
  for(const trial of results.trials){
    const task=byId.get(trial.referenceId),where=`${trial.referenceId} attempt ${trial.attempt}`;
    if(!task||!wanted.includes(trial.referenceId)){errors.push(`${where}: not in split ${results.split}`);continue;}
    if(trial.taskId!==task.task_id)errors.push(`${where}: taskId ${trial.taskId} is not ${task.task_id}`);
    if(trial.taskVersion!==task.version)errors.push(`${where}: taskVersion ${trial.taskVersion} is not the released version ${task.version}`);
    const seed=splits.released.indexOf(trial.referenceId)+1;
    if(trial.seed!==seed)warnings.push(`${where}: seed ${trial.seed} is not the comparable seed ${seed}`);
    if(seen.has(where)){errors.push(`${where}: duplicate attempt`);continue;}
    seen.add(where);
    if(!first.has(trial.referenceId)||trial.attempt<first.get(trial.referenceId).attempt)first.set(trial.referenceId,trial);
  }
  // The commit names the simulator a run used; its public task data must be the data scored against here.
  const atCommit=commitTasks(results.billworldCommit);
  if(results.billworldDirty)warnings.push(`the run had uncommitted changes in billworld/; it did not run exactly ${results.billworldCommit}`);
  if(atCommit===null)warnings.push(`billworldCommit ${results.billworldCommit} is not in this checkout; task data not compared`);
  else if(atCommit!==readFileSync(join(here,'data/tasks.jsonl'),'utf8'))warnings.push(`data/tasks.jsonl at ${results.billworldCommit} differs from this checkout`);
  if(errors.length)return {errors,warnings};
  const rate=ids=>{const passed=ids.filter(id=>first.get(id)?.success===true).length,[low,high]=wilson(passed,ids.length);
    return {passed,total:ids.length,missing:ids.filter(id=>!first.has(id)).length,rate:ids.length?passed/ids.length:null,low,high};};
  // Smaller splits inside the declared one are scored too, from the same first attempts.
  const inside=Object.entries(splits).filter(([,ids])=>ids.every(id=>wanted.includes(id)));
  const categories=[...new Set(wanted.map(id=>byId.get(id).category))].sort();
  return {errors,warnings,split:results.split,cohort:results.cohort,agent:results.agent,assistance:results.assistance,
    splits:Object.fromEntries(inside.map(([name,ids])=>[name,rate(ids)])),
    categories:Object.fromEntries(categories.map(category=>[category,rate(wanted.filter(id=>byId.get(id).category===category))]))};
}

const percent=value=>(value*100).toFixed(1)+'%';
const row=(name,r)=>`${name.padEnd(18)} ${String(r.passed).padStart(4)} / ${String(r.total).padEnd(4)} ${percent(r.rate).padStart(6)}  95% CI ${percent(r.low)}–${percent(r.high)}${r.missing?`  (${r.missing} without a trial, counted failed)`:''}`;

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [path]=process.argv.slice(2).filter(arg=>!arg.startsWith('--'));
  if(!path){console.error('Usage: node billworld/benchmark/score.mjs <results.json> [--json]');process.exit(2);}
  const report=score(read(path));
  if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));
  else{
    for(const warning of report.warnings)console.warn(`warning: ${warning}`);
    for(const error of report.errors)console.error(`error: ${error}`);
    if(!report.errors.length){
      console.log(`${report.agent.name} (${report.agent.model??'no model'}), cohort ${report.cohort}, assistance ${report.assistance}`);
      console.log('Split');for(const [name,r] of Object.entries(report.splits))console.log('  '+row(name,r));
      console.log('Category');for(const [name,r] of Object.entries(report.categories))console.log('  '+row(name,r));
    }
  }
  if(report.errors.length)process.exitCode=1;
}
