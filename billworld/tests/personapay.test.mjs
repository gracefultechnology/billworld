import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { World } from '../engine.mjs';
import { sites, tasks } from '../registry.mjs';
import { personaPayIdentifiers } from '../personapay.mjs';

const siteId='personapay-domain-fixture', taskId='personapay-domain-fixture-v1';
sites.set(siteId,{id:siteId,name:'Dental construction fixture',default_task_id:taskId,runtime:{kind:'personapay',mail_sender_slug:'dental'},billing_policy:{fee_cents:0}});
tasks.set(taskId,{id:taskId,site_id:siteId,evidence_cohort:'observed_public_and_synthetic',budget:{seconds:300},goal:{}});
test.after(()=>{sites.delete(siteId);tasks.delete(taskId);});
const input={accountNumber:'123001048',zipCode:'56007',dateOfBirth:'04/12/1985'};
const create=()=>{const w=new World();return {w,id:w.create({siteId}).episodeId};};

test('PersonaPay field shapes preserve configured lengths, leading zeros and calendar dates',()=>{
  assert.deepEqual(personaPayIdentifiers({...input,accountNumber:'00123',dateOfBirth:'02/29/2000'}),{...input,accountNumber:'00123',dateOfBirth:'02/29/2000'});
  for(const extra of [{accountNumber:'123-001048'},{accountNumber:123001048},{accountNumber:'1234'},{accountNumber:'12345678901'},{zipCode:'5600'},{zipCode:56007},{dateOfBirth:'02/29/1900'},{dateOfBirth:'02/30/2000'},{dateOfBirth:'13/01/2000'},{dateOfBirth:'00/01/2000'},{dateOfBirth:'04/12/0000'},{dateOfBirth:'4/12/1985'}])assert.throws(()=>personaPayIdentifiers({...input,...extra}));
});
test('All three identifiers must match the same account; failures reveal no account information',()=>{
  const {w,id}=create();try{
    for(const extra of [{zipCode:'63863'},{dateOfBirth:'02/29/1988'},{accountNumber:'234002099'}])assert.throws(()=>w.personaPayLogin(id,{...input,...extra}),/Account details could not be verified/);
    assert.equal(Object.keys(w.state(id).sessions).length,0);
    assert.deepEqual(w.personaPayLoginStatus(id),{captchaRequired:true});
    const r=w.personaPayLogin(id,{...input,captcha:true});assert.equal(r.account.id,'acct-primary');assert.deepEqual(r.account.methods,[]);
    assert.equal('personaPayBirth' in r.account,false);assert.equal('personaPayZip' in r.account,false);
    assert.deepEqual(w.personaPayLoginStatus(id),{captchaRequired:false});
    assert.equal(w.session(id,r.session).account.id,'acct-primary');
    assert.equal(w.state(id).events.filter(e=>e.type==='personapay_login_failed').length,3);
    assert.equal(w.state(id).events.filter(e=>e.type==='personapay_identity_verified').length,1);
  }finally{w.close();}
});
test('Third failed match enables CAPTCHA; truthy strings and omission cannot bypass it',()=>{
  const {w,id}=create();try{
    for(let i=0;i<3;i++){assert.throws(()=>w.personaPayLogin(id,{...input,zipCode:'99999'}));assert.equal(w.personaPayLoginStatus(id).captchaRequired,i===2);}
    for(const captcha of [undefined,false,'true',1,{}])assert.throws(()=>w.personaPayLogin(id,{...input,captcha}),/CAPTCHA/);
    assert.equal(w.state(id).personaPayFailures,3);assert.equal(Object.keys(w.state(id).sessions).length,0);
    assert.throws(()=>w.personaPayLogin(id,{...input,zipCode:'99999',captcha:true}),/verified/);
    assert.equal(w.state(id).personaPayFailures,4);
    assert.ok(w.personaPayLogin(id,{...input,captcha:true}).session);
  }finally{w.close();}
});
test('Failure counter survives database reopen but is isolated from another episode',()=>{
  const dir=mkdtempSync(join(tmpdir(),'billworld-personapay-'));let w=new World(join(dir,'episodes.sqlite'));
  try{
    const id=w.create({siteId}).episodeId;
    for(let i=0;i<3;i++)assert.throws(()=>w.personaPayLogin(id,{...input,zipCode:'99999'}));
    w.close();w=new World(join(dir,'episodes.sqlite'));assert.equal(w.personaPayLoginStatus(id).captchaRequired,true);
    const other=w.create({siteId}).episodeId;assert.equal(w.personaPayLoginStatus(other).captchaRequired,false);
    assert.ok(w.personaPayLogin(other,input).session);assert.throws(()=>w.personaPayLogin(id,input),/CAPTCHA/);
  }finally{w.close();rmSync(dir,{recursive:true,force:true});}
});
test('Session grants cannot reveal another account, cross episodes, survive logout or expire',()=>{
  const {w,id}=create();try{
    const session=w.personaPayLogin(id,input).session,other=w.create({siteId}).episodeId;
    assert.equal(w.search(id,input.accountNumber,session).account.id,'acct-primary');
    assert.throws(()=>w.search(id,'234002099',session),/sign in/);
    assert.equal(w.session(other,session).account,null);
    assert.throws(()=>w.search(other,input.accountNumber,session),/sign in/);
    w.logout(id,session);assert.equal(w.session(id,session).account,null);
    const replacement=w.personaPayLogin(id,input).session;w.advance(id,31*60000);assert.equal(w.session(id,replacement).account,null);
    assert.throws(()=>w.search(id,input.accountNumber,replacement),/sign in/);
  }finally{w.close();}
});
test('Inherited authentication and anonymous account lookup do not bypass identifier matching',()=>{
  const {w,id}=create();try{
    assert.throws(()=>w.login(id,{email:'alex@billworld.test',password:'Billworld-2026!'}),/account number/);
    assert.throws(()=>w.resetRequest(id,{email:'alex@billworld.test'}),/unavailable/);
    assert.throws(()=>w.register(id,{customerNumber:input.accountNumber,email:'alex@billworld.test',password:'Billworld-2026!'}),/unavailable/);
    assert.throws(()=>w.smartLookup(id,{customerNumber:input.accountNumber,lastName:'Morgan'}),/account number/);
    assert.throws(()=>w.search(id,input.accountNumber),/sign in/);
    assert.throws(()=>w.medicalLookup(id,{accountNumber:input.accountNumber,lastName:'Morgan',captcha:true}),/unavailable/);
    assert.throws(()=>w.googleUsers(id),/unavailable|not supported/i);
    assert.equal(w.state(id).mail.length,1);assert.equal(Object.keys(w.state(id).sessions).length,0);
    const fixture=w.fixture(w.state(id));assert.deepEqual(fixture.dentalCredentials,input);assert.equal('password' in fixture.credentials,false);
  }finally{w.close();}
});
