// Runs any agent command over a Billworld split and writes a results file valid against results.schema.json.
//   node billworld/benchmark/run.mjs --split billpay_core_10 --agent-cmd '<shell command>'
//        [--out dir] [--agent name] [--agent-version v] [--model id] [--cohort agent|grader_validation|reference_script] [--task task_m1 ...]
// The runner is the harness: it owns the simulator, the admin token and the private grade. The agent command
// gets one JSON object on stdin per task and answers one JSON object (its outcome) on stdout:
//   stdin  {prompt, startUrl, persona, outcomeFields, budget:{seconds,actions,unit}, meterUrl}
//   stdout {"confirmation": "..."}   the last JSON object printed; only the keys in outcomeFields are kept,
//          strings for confirmation/billingDate/scheduledDate/statementFilename, integers for the *Cents keys
// Before every browser action the agent POSTs {"name": "<action>"} (name matching [A-Za-z0-9_.:-]{1,100}) to
// meterUrl and stops when the reply says {"allowed": false}; the runner also stops it then, and when the time
// budget runs out. A malformed request gets {"error"} with no "allowed" key: it spends nothing and is not a stop.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,createWriteStream} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import {start} from '../server.mjs';
import {ENVIRONMENT_REVISION} from '../engine.mjs';
import {validate,schema} from './score.mjs';

const here=dirname(fileURLToPath(import.meta.url)),repo=join(here,'../..');
const UNIT='browser_tool_invocation',MAX_STDOUT=1<<20,DRAIN_MS=2000,ACTION_NAME=/^[A-Za-z0-9_.:-]{1,100}$/;
// The graders compare each field by its type (engine.mjs and charlotte.mjs call .trim() on the strings), so a value
// of another type is dropped here: a malformed answer grades as missing instead of crashing /finish.
const FIELD_TYPES={confirmation:'string',billingDate:'string',scheduledDate:'string',statementFilename:'string',
  postedBalanceCents:'integer',pendingPaymentCents:'integer',remainingBalanceCents:'integer'};
const typed=(key,value)=>FIELD_TYPES[key]==='integer'?Number.isSafeInteger(value):typeof value===(FIELD_TYPES[key]??'string');
// Credentials only: the episode reply also carries the private task and goal, entry and connector tokens.
const PERSONA_KEYS=['credentials','googleCredentials','replacementCard','dentalCredentials','cusiCredentials','medicalCredentials','cid'];

const publicTasks=()=>({tasks:readFileSync(join(here,'data/tasks.jsonl'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)),
  splits:JSON.parse(readFileSync(join(here,'data/splits.json'),'utf8'))});

/** The agent's outcome: the last JSON object it printed, narrowed to the keys the task's grader reads and their types.
 * Tries all of stdout, then the trailing block from the last line opening with '{' (a pretty-printed object), then
 * single lines from the end; only a plain object counts, so a trailing log scalar does not hide the answer. */
export function parseOutcome(stdout,fields){
  const text=stdout.trim();if(!text)return null;
  const lines=text.split('\n'),open=lines.findLastIndex(line=>line.startsWith('{'));
  let value=null;
  for(const candidate of [text,...(open>=0?[lines.slice(open).join('\n')]:[]),...lines.toReversed()]){
    try{const parsed=JSON.parse(candidate);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)){value=parsed;break;}}catch{}
  }
  if(!value)return null;
  return Object.fromEntries(fields.filter(key=>Object.hasOwn(value,key)&&typed(key,value[key])).map(key=>[key,value[key]]));
}

// Stops the shell and everything it started: the command runs in its own process group, which can outlive the
// shell (a browser or `cmd &`), so the group is killed even after the shell has exited.
function stop(child){
  try{process.kill(-child.pid,'SIGKILL');}catch{if(child.exitCode===null&&child.signalCode===null)try{child.kill('SIGKILL');}catch{}}
}

/** Meter endpoint: one secret path per episode, so an agent can spend only its own budget and never sees the admin API. */
async function startMeter(consume){
  const episodes=new Map();
  const server=http.createServer(async(req,res)=>{
    const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
    const entry=episodes.get(req.url.replace(/^\/meter\//,''));
    if(req.method!=='POST'||!entry)return reply(404,{allowed:false});
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)return reply(413,{error:'body too large'});}
    // A malformed request spends nothing; its reply has no `allowed`, so an agent does not mistake it for the budget's end.
    let name='browser_action';try{const input=raw?JSON.parse(raw):{};if(typeof input.name==='string')name=input.name;}catch{return reply(400,{error:'JSON body required'});}
    if(!ACTION_NAME.test(name))return reply(400,{error:'name must match [A-Za-z0-9_.:-]{1,100}'});
    try{
      const result=await consume(entry.episodeId,name);
      if(!result.allowed)entry.exhausted();
      reply(200,{allowed:result.allowed,used:result.used,limit:result.limit});
    }catch(error){reply(500,{allowed:false,error:error.message});}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const base=`http://127.0.0.1:${server.address().port}/meter/`;
  return {open(episodeId,exhausted){const key=randomBytes(18).toString('base64url');episodes.set(key,{episodeId,exhausted});return {url:base+key,close:()=>episodes.delete(key)};},
    close:()=>new Promise(done=>{server.closeAllConnections?.();server.close(done);})};
}

/** Runs one agent process to its end; resolves with the termination the harness observed and the agent's stdout. */
function runAgent({agentCmd,input,deadlineMs,cwd,logPath,env,onSpawn}){
  return new Promise(done=>{
    const log=createWriteStream(logPath);
    const child=spawn(agentCmd,{shell:true,detached:true,cwd,env,stdio:['pipe','pipe','pipe']});
    let stdout='',stopped=null,settled=false,exited=false,code=null,ended=false,drain;
    const finish=termination=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(drain);stop(child);log.end();done({termination,stdout});};
    const halt=reason=>{if(exited)return;if(!stopped)stopped=reason;stop(child);};
    const settle=()=>{if(exited&&ended)finish(stopped??(code===0?'completed':'agent_error'));};
    const timer=setTimeout(()=>halt('timeout'),Math.max(0,deadlineMs));
    onSpawn(halt);
    // The outcome is printed last, so keep the tail of a long stdout.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{stdout=(stdout+chunk).slice(-MAX_STDOUT);});
    child.stdout.on('end',()=>{ended=true;settle();});
    child.stderr.pipe(log,{end:false});
    child.stdin.on('error',()=>{}); // An agent may exit without reading its input.
    child.stdin.end(JSON.stringify(input)+'\n');
    child.on('error',()=>finish(stopped??'agent_error'));
    // Settle on 'exit', not 'close': a process the agent left behind holds the pipes open until the budget ends.
    // Reaping the group closes them, and the drain window bounds the wait for what is still buffered.
    child.on('exit',exitCode=>{exited=true;code=exitCode;clearTimeout(timer);stop(child);drain=setTimeout(()=>{ended=true;settle();},DRAIN_MS);settle();});
  });
}

export async function run({split,agentCmd,out,cohort='agent',agent='agent',agentVersion='unknown',model=null,only=[],dbPath,adminToken,log=message=>console.error(message)}={}){
  if(!split||!agentCmd)throw Error('Usage: run.mjs --split <split> --agent-cmd <command> [--out dir] [--agent name --agent-version v --model id] [--task id ...]');
  if(!schema.properties.cohort.enum.includes(cohort))throw Error(`Unknown cohort ${cohort}`);
  const {tasks,splits}=publicTasks(),byId=new Map(tasks.map(task=>[task.reference_id,task]));
  if(!splits[split])throw Error(`Unknown split ${split}; expected one of ${Object.keys(splits).join(', ')}`);
  const unknown=only.filter(id=>!splits[split].includes(id));
  if(unknown.length)throw Error(`Not in ${split}: ${unknown.join(', ')}`);
  const ids=splits[split].filter(id=>!only.length||only.includes(id));
  const billworldCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
  // A run from uncommitted simulator or task changes is not the commit it names; the results say so.
  const billworldDirty=execFileSync('git',['status','--porcelain','--','billworld'],{cwd:repo,encoding:'utf8'}).trim()!=='';
  if(billworldDirty)log(`billworld/ has uncommitted changes; results are marked billworldDirty, not ${billworldCommit}`);
  out=resolve(out??join(repo,'billworld/data/benchmark-runs',new Date().toISOString().replace(/[:.]/g,'-')));
  mkdirSync(join(out,'agent-logs'),{recursive:true,mode:0o700});
  const runId=randomUUID(),runAt=new Date().toISOString();
  // The database holds the private goals and grades: it lives with the supervisor's output, never in the agent's directory.
  const sim=await start({port:0,adminPort:0,googlePort:0,dbPath:dbPath??join(out,'world.sqlite'),...(adminToken?{adminToken}:{})});
  const admin=async(path,body)=>{
    const response=await fetch(sim.adminUrl+path,{method:'POST',headers:{Authorization:`Bearer ${sim.adminToken}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const reply=await response.json();if(!response.ok)throw Error(`${path}: ${reply.error??response.status}`);return reply;
  };
  const meter=await startMeter((episodeId,name)=>admin('/actions/consume',{episodeId,name}));
  // The agent inherits the caller's environment minus anything naming Billworld's admin access.
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^BILLWORLD_/.test(key)));
  let current=null,cancelled=false;
  const cancel=()=>{cancelled=true;current?.('cancelled');};
  process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  const trials=[];
  try{
    for(const referenceId of ids){
      const task=byId.get(referenceId),seed=splits.released.indexOf(referenceId)+1;
      const base={referenceId,taskId:task.task_id,seed,taskVersion:task.version,environmentRevision:ENVIRONMENT_REVISION,attempt:1};
      if(cancelled){trials.push({...base,success:false,termination:'cancelled',agentActions:0,elapsedMilliseconds:0});continue;}
      let fixture;
      try{
        fixture=await admin('/episodes',{siteId:task.site_id,taskId:task.task_id,seed,trial:{kind:cohort,agent,model:model||null,runId,attemptNumber:1,accessMode:'browser_only'}});
        if(fixture.task.id!==task.task_id||fixture.task.version!==task.version)throw Error(`${referenceId} is version ${fixture.task.version} in the simulator, ${task.version} in data/tasks.jsonl`);
      }catch(error){
        log(`${referenceId}: environment error: ${error.message}`);
        trials.push({...base,success:false,termination:'environment_error',agentActions:0,elapsedMilliseconds:0});continue;
      }
      const created=Date.now();
      let termination,outcome={},halt=()=>{};
      const lease=meter.open(fixture.episodeId,()=>halt('action_budget_exceeded'));
      try{
        await admin('/actions/start',{episodeId:fixture.episodeId,unit:UNIT});
        // A signal during episode setup found no agent to stop: the episode is finished as cancelled, never started.
        if(cancelled)termination='cancelled';
        else{
          const input={prompt:task.prompt,startUrl:fixture.startUrl,
            persona:Object.fromEntries(PERSONA_KEYS.filter(key=>fixture[key]!==undefined).map(key=>[key,fixture[key]])),
            outcomeFields:task.outcome_fields,budget:{seconds:task.budget_seconds,actions:task.budget_actions,unit:UNIT},meterUrl:lease.url};
          const cwd=mkdtempSync(join(tmpdir(),'billworld-agent-'));
          try{
            const result=await runAgent({agentCmd,input,cwd,env,logPath:join(out,'agent-logs',`${referenceId}.log`),
              deadlineMs:task.budget_seconds*1000-(Date.now()-created),onSpawn:stopAgent=>{halt=stopAgent;current=stopAgent;if(cancelled)stopAgent('cancelled');}});
            termination=result.termination;
            if(termination==='completed'){const parsed=parseOutcome(result.stdout,task.outcome_fields);if(parsed)outcome=parsed;else termination='agent_error';}
          }finally{current=null;rmSync(cwd,{recursive:true,force:true});}
        }
      }catch(error){log(`${referenceId}: environment error: ${error.message}`);termination='environment_error';}
      finally{lease.close();}
      try{
        const finished=await admin('/finish',{episodeId:fixture.episodeId,outcome,metadata:{termination,agentElapsedMilliseconds:Date.now()-created}});
        trials.push({...base,taskVersion:finished.taskVersion,environmentRevision:finished.environmentRevision,success:finished.success===true,
          termination:finished.termination,agentActions:finished.actionsUsed??0,elapsedMilliseconds:finished.elapsedMilliseconds,evidence:out});
        log(`${referenceId}: ${finished.success?'passed':'failed'} (${finished.termination})`);
      }catch(error){
        log(`${referenceId}: environment error: ${error.message}`);
        trials.push({...base,success:false,termination:'environment_error',agentActions:0,elapsedMilliseconds:Date.now()-created,evidence:out});
      }
    }
  }finally{
    process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);
    await meter.close();await sim.close();
  }
  const results={billworldCommit,...(billworldDirty?{billworldDirty}:{}),split,cohort,agent:{name:agent,version:agentVersion,model:model||null,accessMode:'browser_only'},assistance:'none',runAt,trials};
  const errors=validate(schema,results);
  if(errors.length)throw Error(`Results do not match results.schema.json:\n${errors.join('\n')}`);
  const path=join(out,'results.json');
  writeFileSync(path,JSON.stringify(results,null,2)+'\n');
  return {results,path};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),value=flag=>{const index=args.indexOf(flag);return index>=0?args[index+1]:undefined;};
  const only=args.flatMap((arg,index)=>arg==='--task'?args[index+1].split(','):[]);
  try{
    const {path,results}=await run({split:value('--split'),agentCmd:value('--agent-cmd'),out:value('--out'),cohort:value('--cohort'),agent:value('--agent'),
      agentVersion:value('--agent-version'),model:value('--model'),only});
    console.log(`${results.trials.filter(trial=>trial.success).length} / ${results.trials.length} passed\n${path}`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
