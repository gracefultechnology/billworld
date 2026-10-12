import test from 'node:test';import assert from 'node:assert/strict';
import {World} from '../engine.mjs';import {sites} from '../registry.mjs';import {starnikFixtureCredentials} from '../starnik-fixture.mjs';
const site=sites.get('greater-minnesota-gas'),ids=['acct-primary','acct-secondary','acct-cabin'];
function scenario(taskId,fn){const old=site.construction_account_credentials,w=new World(':memory:',{construction:true});try{site.construction_account_credentials={'acct-primary':{username:'water.alex',password:'Water-2026!',security_code:'WATER1048',service_zip:'10001'},'acct-secondary':{username:'water.jordan',password:'Second-2026!',security_code:'WATER2099',service_zip:'10002'},'acct-cabin':{username:'water.cabin',password:'Cabin-2026!',security_code:'WATER3077',service_zip:'10003'}};const fixture=w.create({siteId:site.id,taskId});fn(w,fixture);}finally{site.construction_account_credentials=old;w.close();}}
test('Missing, duplicate and malformed fixture fields never inherit GMG identities',()=>{
 assert.throws(()=>starnikFixtureCredentials({},ids),/unavailable/);
 for(const delta of [{username:'bad'},{password:'short'},{security_code:''},{service_zip:'1000'}, {username:'JORDAN.LEE'},{security_code:'GMG2099'}]){const copy=structuredClone(site);Object.assign(copy.construction_account_credentials['acct-primary'],delta);assert.throws(()=>starnikFixtureCredentials(copy,ids));}
 const extra=structuredClone(site);extra.construction_account_credentials.other={};assert.throws(()=>starnikFixtureCredentials(extra,ids));
});
test('Tenant credentials drive fixture metadata, login, recovery and guest lookup',()=>scenario('gmg-username-login-v1',(w,f)=>{
 const id=f.episodeId;assert.equal(f.credentials.username,'water.alex');assert.equal(f.credentials.password,'Water-2026!');assert.equal(f.credentials.securityCode,'WATER1048');assert.equal(f.credentials.serviceZip,'10001');
 assert.throws(()=>w.starnikLogin(id,{username:'alex.morgan',password:'Billworld-2026!'}));
 const session=w.starnikLogin(id,{username:'water.alex',password:'Water-2026!'}).session;assert.equal(w.starnikAccount(id,session).account.username,'water.alex');
 assert.throws(()=>w.starnikGuestLookup(id,{securityCode:'GMG1048',serviceZip:'56001'}));assert.throws(()=>w.starnikGuestLookup(id,{securityCode:'WATER1048',serviceZip:'10002'}));assert.ok(w.starnikGuestLookup(id,{securityCode:'WATER1048',serviceZip:'10001'}).token);
 w.starnikRecoveryRequest(id,{kind:'username',email:'alex@billworld.test'});assert.ok(w.state(id).mail.at(-1).text.includes('water.alex'));
 w.starnikRecoveryRequest(id,{kind:'password',username:'water.alex'});assert.ok(w.state(id).mail.at(-1).text.includes('/starnik/reset?token='));
 const serialized=JSON.stringify(w.state(id));for(const secret of ['Water-2026!','Second-2026!','WATER1048','WATER2099'])assert.equal(serialized.includes(secret),false);
}));
test('Alternate registration security code reaches verified mailbox and new credentials',()=>scenario('gmg-register-account-v1',(w,f)=>{
 const id=f.episodeId,email='alex@billworld.test';assert.throws(()=>w.starnikRegistrationRequest(id,{securityCode:'GMG1048',email,confirmEmail:email}));
 w.starnikRegistrationRequest(id,{securityCode:'WATER1048',email,confirmEmail:email});const token=w.state(id).mail.at(-1).text.match(/token=([\w-]+)/)[1];w.starnikRegistrationGrant(id,token,true);w.starnikRegistrationUsername(id,token,{username:'water.new'});w.starnikRegistrationComplete(id,token,{username:'water.new',password:'NewWater-2026!',confirmPassword:'NewWater-2026!'});const session=w.starnikLogin(id,{username:'water.new',password:'NewWater-2026!'}).session;assert.equal(w.starnikAccount(id,session).account.username,'water.new');
}));
