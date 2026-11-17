import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {World} from '../engine.mjs';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import {createHash} from 'node:crypto';
import puppeteer from 'puppeteer';
import {startHttpsEpisode, startPasswordLoginEpisode} from '../integration/https-episode-host.mjs';
const read=(url,ca,headers={})=>new Promise((resolve,reject)=>{
 https.get(url,{ca,headers},res=>{
  const certificate=res.socket.getPeerX509Certificate();let body='';
  res.on('data',part=>body+=part);res.on('end',()=>resolve({status:res.statusCode,body,certificate,headers:res.headers}));
 }).on('error',reject);
});
test('HTTPS host separates agent inputs, grades recovered receipt and cleans up',async()=>{
 const outputRoot=await mkdtemp(join(tmpdir(),'billworld-host-test-'));let host,browser;
 try{
  host=await startHttpsEpisode({siteId:'homer-utilities',outputRoot,trial:{kind:'reference_script',agent:'puppeteer-host-regression'}});
  const {agentInputs:input,deviceTrust:trust}=host;
  await host.startActionBudget({unit:'browser_tool_invocation'});
  assert.equal((await host.reserveAction({name:'browser_flow'})).allowed,true);
  for(const scoped of [input.persona,input.connector,trust]){assert.equal(scoped.episodeId,input.episodeId);assert.equal(scoped.runId,input.runId);}
  assert.deepEqual(Object.keys(input.task).sort(),['budget','id','prompt','version']);
  for(const name of ['goal','adminToken','adminUrl','world','grade','caPath'])assert.equal(Object.hasOwn(input,name),false);
  assert.equal((await stat(host.reportPath)).mode&0o777,0o600);
  const ca=await readFile(trust.caPath);
  const health=await read(trust.billingOrigin+'/health',ca);assert.equal(health.status,200);
  const entry=await read(input.startUrl,ca);assert.equal(entry.status,302);assert.equal(new URL(entry.headers.location,input.startUrl).protocol,'https:');
  const plain=await new Promise(resolve=>{http.get(trust.billingOrigin.replace('https:','http:')+'/health',res=>{res.resume();resolve({status:res.statusCode});}).on('error',error=>resolve({error:error.code}));});
  assert.ok(plain.error||plain.status>=400,'TLS listener must not serve a downgraded HTTP request');
  assert.equal((await read(input.connector.url,ca)).status,401);
  assert.equal((await read(input.connector.url,ca,input.connector.headers)).status,200);
  assert.equal(new URL(input.googleUrl).protocol,'https:');
  assert.equal((await read(input.googleUrl,ca)).status,200);
  const spki=createHash('sha256').update(health.certificate.publicKey.export({type:'spki',format:'der'})).digest('base64');
  browser=await puppeteer.launch({headless:true,args:[`--ignore-certificate-errors-spki-list=${spki}`]});
  const page=await browser.newPage(),errors=[],outbound=[];
  page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
  page.on('request',request=>{
   const url=new URL(request.url());
   if(url.origin===trust.billingOrigin||url.origin===trust.googleOrigin||url.protocol==='data:')request.continue();
   else{outbound.push(request.url());request.abort();}
  });
  const title=text=>page.waitForFunction(text=>document.querySelector('h1')?.textContent===text,{},text);
  const submit=async(action,text)=>{await page.locator(`form[data-action="${action}"] button:not([type="button"])`).click();await title(text);};
  await page.goto(input.startUrl);await title('LOGIN TO PAY YOUR BILLS ONLINE');
  await page.locator('[name="email"]').fill(input.persona.credentials.email);await page.locator('[name="password"]').fill(input.persona.credentials.password);
  await submit('xpress-login','My Accounts');await page.locator('[data-invoice="inv-current"]').click();await title('Bill Cart');
  await submit('xpress-cart','Checkout');await submit('xpress-quote','Review and Confirm');await submit('xpress-pay','SUCCESS!');
  const confirmation=await page.$eval('#confirmation',e=>e.textContent);
  const missing=await host.grade({});assert.equal(missing.grade.success,false);assert.equal(missing.exactlyOnePayment,true);assert.equal(missing.reportedConfirmation,null);
  assert.deepEqual(Object.entries(missing.grade.checks).filter(([,pass])=>!pass).map(([name])=>name),['confirmation_reported']);
  await page.reload();await title('Payment History');
  const recovered=await page.$$eval('tbody tr',rows=>rows.map(row=>row.cells[0].textContent));assert.ok(recovered.includes(confirmation));
  const outcome=await host.grade({confirmation:recovered.find(value=>value===confirmation)});
  assert.equal(outcome.grade.success,true);assert.equal(outcome.exactlyOnePayment,true);assert.equal(outcome.confirmationMatchesPayment,true);
  assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);
  const finished=await host.finish({confirmation},{agentSteps:1});
  assert.equal(finished.success,true);assert.equal(finished.runId,input.runId);assert.equal(finished.actionsUsed,1);
  assert.deepEqual(await host.finish({}, {termination:'agent_error'}),finished,'terminal result cannot be revised');
  await browser.close();browser=null;
  await Promise.all([host.close({reason:'completed'}),host.close()]);
  assert.equal(existsSync(trust.caPath),false);
  const report=JSON.parse(await readFile(host.reportPath));assert.equal(report.phase,'closed');assert.equal(report.termination,'completed');assert.equal(report.completed,true);assert.equal(report.buildUnchanged,true);assert.equal(report.observations.length,3);assert.deepEqual(report.cleanupErrors,[]);
  await assert.rejects(host.grade({confirmation}),/closed/);
  await assert.rejects(read(trust.billingOrigin+'/health',ca),error=>error.code==='ECONNREFUSED');
 }finally{await browser?.close();await host?.close();await rm(outputRoot,{recursive:true,force:true});}
});
test('private saved login opens a synthetic bill account without changing billing or disclosing its fixture to the agent', async () => {
 const outputRoot = await mkdtemp(join(tmpdir(), 'billworld-password-login-'));
 let host, browser;
 try {
  let setup;
  host = await startPasswordLoginEpisode({outputRoot, provision: value => { setup = value; }});
  assert.deepEqual(host.agentInputs, {
   runId: setup.runId, episodeId: setup.episodeId, site: 'City of Batavia',
   prompt: 'Help me use my saved login to view my account.',
  });
  const ca = await readFile(setup.deviceTrust.caPath);
  const {certificate} = await read(setup.login.origin + '/health', ca);
  const spki = createHash('sha256').update(certificate.publicKey.export({type:'spki',format:'der'})).digest('base64');
  browser = await puppeteer.launch({headless:true, args:[`--ignore-certificate-errors-spki-list=${spki}`]});
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', request => {
   if (new URL(request.url()).origin === setup.login.origin || request.url().startsWith('data:')) request.continue();
   else request.abort();
  });
  await page.goto(setup.entryUrl);
  await page.goto(new URL('/paymentus/login', setup.login.origin).href);
  await page.locator('input[autocomplete="username"]').fill(setup.login.username);
  await page.locator('input[autocomplete="current-password"]').fill(setup.login.password);
  const before = await host.grade();
  assert.equal(before.grade.success, false);
  await page.locator('#paymentus-login button').click();
  await page.waitForSelector('#paymentus-account');
  const after = await host.grade();
  assert.equal(after.grade.success, true);
  assert.equal(after.paymentCount, 0);
  await host.close({reason:'completed'});
  assert.equal(existsSync(setup.deviceTrust.caPath), false);
 } finally {
  await browser?.close();
  await host?.close();
  await rm(outputRoot, {recursive:true, force:true});
 }
});

test('invalid episode produces a retained startup failure report',async()=>{
 const outputRoot=await mkdtemp(join(tmpdir(),'billworld-host-fail-'));
 try{
  await assert.rejects(startHttpsEpisode({siteId:'not-a-site',outputRoot}),/not implemented/);
  const [run]=await readdir(outputRoot);const report=JSON.parse(await readFile(join(outputRoot,run,'private-report.json')));
  assert.equal(report.phase,'startup_failed');assert.ok(report.finishedAt);assert.deepEqual(report.cleanupErrors,[]);
 }finally{await rm(outputRoot,{recursive:true,force:true});}
});

test('port conflict retains a startup failure and closes partially started listeners',async()=>{
 const occupied=net.createServer();await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));
 const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
 const billingPort=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const outputRoot=await mkdtemp(join(tmpdir(),'billworld-host-port-'));
 try{
  await assert.rejects(startHttpsEpisode({outputRoot,billingPort,googlePort:occupied.address().port}),error=>error.code==='EADDRINUSE');
  const [run]=await readdir(outputRoot);const report=JSON.parse(await readFile(join(outputRoot,run,'private-report.json')));
  assert.equal(report.phase,'startup_failed');assert.deepEqual(report.cleanupErrors,[]);
  const reused=net.createServer();await new Promise((resolve,reject)=>{reused.once('error',reject);reused.listen(billingPort,'127.0.0.1',resolve);});await new Promise(resolve=>reused.close(resolve));
 }finally{await new Promise(resolve=>occupied.close(resolve));await rm(outputRoot,{recursive:true,force:true});}
});

test('default close records interruption, never completion',async()=>{
 const outputRoot=await mkdtemp(join(tmpdir(),'billworld-host-interrupted-'));let host;
 try{
  host=await startHttpsEpisode({outputRoot});await host.close();
  const report=JSON.parse(await readFile(host.reportPath));assert.equal(report.termination,'interrupted');assert.equal(report.completed,false);assert.deepEqual(report.observations,[]);
 }finally{await host?.close();await rm(outputRoot,{recursive:true,force:true});}
});


test('supervisor budget is authoritative, episode-bound and absent from agent inputs',async()=>{
 const outputRoot=await mkdtemp(join(tmpdir(),'billworld-host-budget-'));let host;
 try{
  host=await startHttpsEpisode({outputRoot,trial:{kind:'grader_validation',agent:'budget-test'}});
  for(const key of ['finish','startActionBudget','reserveAction','trial'])assert.equal(Object.hasOwn(host.agentInputs,key),false);
  await assert.rejects(host.reserveAction({name:'click'}),/not started/);
  const budget=await host.startActionBudget({unit:'vision_action'});
  await assert.rejects(host.startActionBudget({unit:'browser_tool_invocation'}),/cannot change/);
  for(let i=0;i<budget.limit;i++)assert.equal((await host.reserveAction({name:'click'})).allowed,true);
  assert.equal((await host.reserveAction({name:'click'})).allowed,false);
  const finished=await host.finish();assert.equal(finished.termination,'action_budget_exceeded');
  assert.equal(finished.actionBudgetEnforced,true);assert.equal(finished.actionsUsed,budget.limit);assert.equal(finished.withinActionBudget,false);
  await host.close({reason:'completed'});
  const report=JSON.parse(await readFile(host.reportPath));assert.equal(report.completed,false);assert.equal(report.termination,'action_budget_exceeded');
 }finally{await host?.close();await rm(outputRoot,{recursive:true,force:true});}
});

test('trial close without finish seals cancellation and rejects late actions',async()=>{
 const outputRoot=await mkdtemp(join(tmpdir(),'billworld-host-cancel-'));let host;
 try{
  host=await startHttpsEpisode({outputRoot,trial:{kind:'grader_validation',agent:'cancel-test'}});
  await host.startActionBudget({unit:'vision_action'});await host.close();
  const report=JSON.parse(await readFile(host.reportPath));assert.equal(report.finished.termination,'cancelled');assert.equal(report.completed,false);
  await assert.rejects(host.reserveAction({name:'click'}),/closed/);
 }finally{await host?.close();await rm(outputRoot,{recursive:true,force:true});}
});


test('trial deadline overrides completion and completed trials require metering',async()=>{
 const outputRoot=await mkdtemp(join(tmpdir(),'billworld-host-timeout-'));let host;
 try{
  host=await startHttpsEpisode({outputRoot,trial:{kind:'grader_validation',agent:'deadline-test'}});
  await assert.rejects(host.finish(),/Start action budget/);
  await host.startActionBudget({unit:'vision_action'});
  const world=new World(join(dirname(host.reportPath),'world.sqlite'));
  try{
   const state=world.state(host.agentInputs.episodeId);
   state.createdAt=Date.now()-(host.agentInputs.task.budget.seconds+1)*1000;
   state.trial.deadlineAt=Date.now()-1000;world.save(state);
  }finally{world.close();}
  const finished=await host.finish();assert.equal(finished.termination,'timeout');assert.equal(finished.withinTimeBudget,false);
  await host.close({reason:'completed'});
  const report=JSON.parse(await readFile(host.reportPath));assert.equal(report.completed,false);assert.equal(report.termination,'timeout');
 }finally{await host?.close();await rm(outputRoot,{recursive:true,force:true});}
});
