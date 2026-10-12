// Runs every released Batavia reference journey (shared with the Infinity reference
// runner) against a local server and requires each private grader to pass.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {start} from '../server.mjs';
import {BATAVIA_TASKS,runBataviaJourney} from '../infinity/reference-batavia.mjs';
const directory=new URL('../artifacts/batavia-reference-browser/',import.meta.url);mkdirSync(directory,{recursive:true});
const only=process.argv.slice(2);
const report={kind:'batavia_released_reference_journeys',tasks:[],page_errors:[],outbound_requests:[]};
const server=await start({port:0,adminPort:0,dbPath:':memory:'});let browser;
try{
 browser=await puppeteer.launch({headless:'shell',timeout:120000});report.browser_version=await browser.version();
 for(const [infinityId,taskId] of Object.entries(BATAVIA_TASKS)){
  if(only.length&&!only.includes(infinityId)&&!only.includes(taskId))continue;
  // Default context so the shared statement reference can set browser-level download behavior.
  const page=await browser.newPage();{const c=await page.createCDPSession();await c.send('Network.clearBrowserCookies');await c.detach();}page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(60000);await page.setViewport({width:1365,height:900});
  page.on('pageerror',e=>report.page_errors.push(taskId+': '+e.message));page.on('popup',p=>report.page_errors.push(taskId+': popup '+p.url()));
  await page.setRequestInterception(true);page.on('request',r=>{if(r.url().startsWith(server.baseUrl+'/')||r.url().startsWith('data:'))r.continue();else{report.outbound_requests.push(r.url());r.abort();}});
  const f=server.world.create({siteId:'batavia-utilities',taskId});let steps=0;
  const artifacts=fileURLToPath(new URL(infinityId+'/',directory));mkdirSync(artifacts,{recursive:true});
  try{
   assert.equal(server.world.evaluate(f.episodeId).success,false,taskId+' must not pass before any action');
   await page.goto(`${server.baseUrl}/enter/${f.episodeId}/${f.entryToken}`);
   const answer=await runBataviaJourney(taskId,{page,browser,base:server.baseUrl,artifacts,step:()=>steps++});
   const score=server.world.evaluate(f.episodeId,answer);await page.screenshot({path:artifacts+'final.png',fullPage:true});
   report.tasks.push({infinityId,taskId,steps,answer,success:score.success,failed:Object.entries(score.checks).filter(([,v])=>!v).map(([k])=>k)});
   assert.equal(score.success,true,taskId+' failed: '+JSON.stringify(score.checks));console.log('PASS',infinityId,taskId,steps+' steps');
  }finally{await page.close();}
 }
 assert.deepEqual(report.page_errors,[]);assert.deepEqual(report.outbound_requests,[]);report.all_passed=true;
}catch(e){report.all_passed=false;report.error=e.message;throw e;}
finally{writeFileSync(new URL('report.json',directory),JSON.stringify(report,null,2)+'\n');await browser?.close();await server.close();}
