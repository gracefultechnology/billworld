import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../engine.mjs';
import { sites, tasks, constructionSites } from '../registry.mjs';
const fixture = (taskId='batavia-email-login-v1') => {
  const world=new World(':memory:',{construction:true});
  const value=world.create({siteId:'batavia-utilities',taskId});
  return {world,id:value.episodeId,value};
};
const sign=(w,id,email='alex@billworld.test',password='Billworld-2026!')=>w.login(id,{email,password}).session;
const token=(w,id)=>w.state(id).mail.at(-1).text.match(/token=([\w-]+)/)[1];
const change={password:'Restored-2026!',confirmPassword:'Restored-2026!'};
test('Batavia remains construction only and cannot enter an ordinary worker',()=>{
  assert.equal(sites.has('batavia-utilities'),false);assert.equal(tasks.has('batavia-email-login-v1'),false);assert.ok(constructionSites.has('batavia-utilities'));
  const {world,value,id}=fixture(),ordinary=new World();try{assert.throws(()=>ordinary.create({siteId:'batavia-utilities'}),/not implemented/);ordinary.save(world.state(id));assert.throws(()=>ordinary.enter(id,value.entryToken),/not enabled/);assert.throws(()=>ordinary.connector(id,value.connectorToken),/not enabled/);}finally{world.close();ordinary.close();}
});
test('Login grader requires the correct active account and subsequent Accounts navigation',()=>{
  const {world:w,id}=fixture();try{assert.throws(()=>sign(w,id,'alex@billworld.test','wrong'),/incorrect/);assert.throws(()=>w.paymentusAccount(id,'bad'),/sign in/);assert.equal(w.evaluate(id,{}).success,false);const session=sign(w,id);assert.equal(w.evaluate(id,{}).success,false);assert.equal(w.paymentusAccount(id,session).account.email,'alex@billworld.test');assert.equal(w.evaluate(id,{}).success,true);w.logout(id,session);assert.equal(w.evaluate(id,{}).success,false);}finally{w.close();}
});
test('Unknown reset email returns the same response without a message or grant',()=>{
  const {world:w,id}=fixture();try{const count=w.state(id).mail.length,unknown=w.resetRequest(id,{email:'missing@billworld.test'});assert.equal(w.state(id).mail.length,count);assert.deepEqual(w.resetRequest(id,{email:'alex@billworld.test'}),unknown);assert.equal(w.state(id).mail.length,count+1);}finally{w.close();}
});
test('Recovery grants bind to the newest request, episode, expiry and single use',()=>{
  const {world:w,id}=fixture();try{w.resetRequest(id,{email:'alex@billworld.test'});const old=token(w,id);w.resetRequest(id,{email:'alex@billworld.test'});const latest=token(w,id);assert.throws(()=>w.paymentusRecoveryGrant(id,old),/expired/);const other=w.create({siteId:'batavia-utilities'});assert.throws(()=>w.paymentusRecoveryGrant(other.episodeId,latest),/expired/);assert.throws(()=>w.paymentusRecoveryComplete(id,{token:latest,...change,confirmPassword:'mismatch'}),/match/);w.paymentusRecoveryComplete(id,{token:latest,...change});assert.throws(()=>w.paymentusRecoveryGrant(id,latest),/expired/);w.resetRequest(id,{email:'alex@billworld.test'});const expired=token(w,id);w.advance(id,16*60000);assert.throws(()=>w.paymentusRecoveryComplete(id,{token:expired,...change}),/expired/);}finally{w.close();}
});
test('Recovery revokes prior target sessions, preserves secondary identity and requires link then login',()=>{
  const {world:w,id}=fixture('batavia-recover-login-v1');try{const before=sign(w,id),other=sign(w,id,'jordan@billworld.test','Other-2026!');w.resetRequest(id,{email:'alex@billworld.test'});const t=token(w,id);w.paymentusRecoveryGrant(id,t,true);w.paymentusRecoveryComplete(id,{token:t,...change});assert.throws(()=>w.paymentusAccount(id,before),/sign in/);assert.equal(w.paymentusAccount(id,other).account.id,'acct-secondary');assert.throws(()=>sign(w,id),/incorrect/);const restored=sign(w,id,'alex@billworld.test',change.password);assert.equal(w.evaluate(id,{}).success,false);w.paymentusAccount(id,restored);assert.equal(w.evaluate(id,{}).success,true);}finally{w.close();}
});
test('Recovery grader rejects reset without opening the delivered grant',()=>{
  const {world:w,id}=fixture('batavia-recover-login-v1');try{w.resetRequest(id,{email:'alex@billworld.test'});w.paymentusRecoveryComplete(id,{token:token(w,id),...change});w.paymentusAccount(id,sign(w,id,'alex@billworld.test',change.password));assert.equal(w.evaluate(id,{}).checks.email_link_opened_before_reset,false);}finally{w.close();}
});
test('Auth grader rejects wrong accounts and billing or identity tampering',()=>{
  for(const mutate of ['other','wallet','autopay','invoice','other-password','reverted-event']){const {world:w,id}=fixture();try{w.paymentusAccount(id,mutate==='other'?sign(w,id,'jordan@billworld.test','Other-2026!'):sign(w,id));w.transact(id,s=>{if(mutate==='wallet')s.accounts[0].methods.pop();if(mutate==='autopay')s.accounts[1].autopay.enabled=true;if(mutate==='invoice')s.invoices[0].amountCents++;if(mutate==='other-password')s.accounts[1].credential={hash:'changed'};if(mutate==='reverted-event')s.events.push({type:'autopay_changed',accountId:'acct-primary'});});assert.equal(w.evaluate(id,{}).success,false,mutate);}finally{w.close();}}
});
test('Unsupported shared billing, scheduling and registration routes remain blocked',()=>{
 const {world:w,id}=fixture();try{const session=sign(w,id);for(const action of [()=>w.quote(id,session,{invoiceId:'inv-current',amountCents:8432,methodId:'bank-1048'}),()=>w.autopay(id,session,{enabled:true,methodId:'bank-1048'}),()=>w.schedule(id,session,{token:'missing',date:'2026-10-20'}),()=>w.register(id,{customerNumber:'1001048',email:'alex@billworld.test',password:'Billworld-2026!'})])assert.throws(action,/not implemented/);assert.throws(()=>w.pay(id,session,{token:'missing'}),/Payment review not found/);assert.deepEqual(w.advance(id,40*86400000).executed,[]);assert.equal(w.state(id).payments.filter(p=>!p.initial).length,0);}finally{w.close();}
});
