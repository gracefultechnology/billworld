// Builds the Billworld leaderboard from results files: each is checked exactly as score.mjs checks it, then ranked
// by first-attempt strict pass rate with a Wilson 95% interval, one board per split and one table per cohort and
// assistance level. Different cohorts and assistance levels are never pooled; each results file is one row.
//   node billworld/benchmark/leaderboard.mjs results.json [more.json ...] [--out dir]
// Writes <split>.md and <split>.json for every split with at least one row into --out (default
// billworld/data/leaderboard). Any file that score.mjs rejects, or a run submitted twice, fails the build and nothing is written.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {score,schema} from './score.mjs';

const here=dirname(fileURLToPath(import.meta.url)),repo=join(here,'../..');
const COHORTS=schema.properties.cohort.enum,ASSISTANCE=schema.properties.assistance.enum;

/** Ranks entries ({source, results}) per split. `scoreOptions` are score()'s data and options, for tests.
 * A run declared on one split is also ranked on every split inside it (score.mjs scores those from the same first
 * attempts, with every task of that split in the denominator); `runSplit` says which split it ran. */
export function leaderboard(entries,{data,commitTasks}={}){
  const errors=[],rows=[],runs=new Map();
  for(const {source,results} of entries){
    const report=score(results,data,commitTasks?{commitTasks}:undefined);
    if(report.errors.length){errors.push(...report.errors.map(error=>`${source}: ${error}`));continue;}
    const key=JSON.stringify([results.agent.name,results.agent.version,results.agent.model,results.runAt,results.billworldCommit,results.split,results.cohort]);
    if(runs.has(key)){errors.push(`${source}: the same run as ${runs.get(key)}`);continue;}
    runs.set(key,source);
    for(const [split,rate] of Object.entries(report.splits))rows.push({split,cohort:results.cohort,assistance:results.assistance,
      agent:results.agent.name,version:results.agent.version,model:results.agent.model,accessMode:results.agent.accessMode??null,
      billworldCommit:results.billworldCommit,billworldDirty:results.billworldDirty===true,runAt:results.runAt,runSplit:results.split,
      passed:rate.passed,total:rate.total,missing:rate.missing,rate:rate.rate,low:rate.low,high:rate.high,source,warnings:report.warnings});
  }
  if(errors.length)return {errors,boards:{}};
  const splitOrder=Object.keys(data?.splits??JSON.parse(readFileSync(join(here,'data/splits.json'),'utf8')));
  const byRate=(a,b)=>b.rate-a.rate||b.low-a.low||a.runAt.localeCompare(b.runAt)||a.agent.localeCompare(b.agent);
  const boards={};
  for(const split of splitOrder){
    const inSplit=rows.filter(row=>row.split===split);
    if(!inSplit.length)continue;
    boards[split]=COHORTS.flatMap(cohort=>ASSISTANCE.map(assistance=>({cohort,assistance,
      rows:inSplit.filter(row=>row.cohort===cohort&&row.assistance===assistance).sort(byRate)})))
      .filter(table=>table.rows.length).map(({cohort,assistance,rows})=>({cohort,assistance,
        // Competition ranking: equal pass rates share a rank.
        rows:rows.map(({split:_,cohort:__,assistance:___,...row},index)=>({rank:rows.findIndex(other=>other.rate===row.rate)+1,...row}))}));
  }
  return {errors,boards};
}

const percent=value=>(value*100).toFixed(1)+'%';
const cell=value=>value===null||value===undefined||value===''?'—':String(value).replace(/\|/g,'\\|').replace(/\n/g,' ');

/** One split's board as Markdown: a table per cohort and assistance level. */
export function markdown(split,tables){
  const out=[`# Billworld leaderboard: \`${split}\``,'',
    'First-attempt strict pass rate, with every task of the split in the denominator (tasks without a trial count as failed), '+
    'and its Wilson 95% interval. Each table is one cohort at one assistance level; tables are never pooled. '+
    'A row marked † has scorer warnings, listed in the JSON file.',''];
  for(const {cohort,assistance,rows} of tables){
    out.push(`## Cohort \`${cohort}\`, assistance \`${assistance}\``,'',
      '| Rank | Agent | Version | Model | Access mode | Billworld commit | Run at | Run split | Passed | Pass rate | 95% CI |',
      '|---:|---|---|---|---|---|---|---|---:|---:|---|');
    for(const row of rows)out.push(`| ${row.rank} | ${cell(row.agent)}${row.warnings.length?' †':''} | ${cell(row.version)} | ${cell(row.model)} | ${cell(row.accessMode)} | `+
      `\`${row.billworldCommit.slice(0,12)}\`${row.billworldDirty?' (dirty)':''} | ${cell(row.runAt)} | ${cell(row.runSplit)} | ${row.passed} / ${row.total} | `+
      `${percent(row.rate)} | ${percent(row.low)}–${percent(row.high)} |`);
    out.push('');
  }
  return out.join('\n');
}

/** The files a build writes: <split>.md and <split>.json per board. */
export const files=boards=>Object.fromEntries(Object.entries(boards).flatMap(([split,tables])=>[
  [`${split}.md`,markdown(split,tables)],
  [`${split}.json`,JSON.stringify({split,metric:'first_attempt_strict_pass_rate',interval:'wilson_95',tables},null,2)+'\n']]));

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),outIndex=args.indexOf('--out');
  const out=resolve(outIndex>=0?args[outIndex+1]:join(repo,'billworld/data/leaderboard'));
  const paths=args.filter((arg,index)=>!arg.startsWith('--')&&!(outIndex>=0&&index===outIndex+1));
  if(!paths.length){console.error('Usage: node billworld/benchmark/leaderboard.mjs <results.json> [more.json ...] [--out dir]');process.exit(2);}
  const entries=[],errors=[];
  for(const path of paths){try{entries.push({source:path,results:JSON.parse(readFileSync(path,'utf8'))});}catch(error){errors.push(`${path}: ${error.message}`);}}
  const built=errors.length?{errors,boards:{}}:leaderboard(entries);
  for(const error of built.errors)console.error(`error: ${error}`);
  if(built.errors.length)process.exitCode=1;
  else{
    mkdirSync(out,{recursive:true});
    for(const [name,text] of Object.entries(files(built.boards))){writeFileSync(join(out,name),text);console.log(join(out,name));}
  }
}
