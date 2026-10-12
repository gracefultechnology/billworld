// Greater Minnesota Gas first-slice coverage: documented multiple accounts, billing-address
// updates and AutoPay method change, plus graders that reject shortcuts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../engine.mjs';
import {tasks} from '../registry.mjs';

const site='greater-minnesota-gas';
const arizona={line1:'2210 E Saguaro Dr',line2:'Apt 4',city:'Mesa',state:'AZ',zip:'85203'};
function setup(taskId,{construction=false}={}){const w=new World(':memory:',{construction}),id=w.create({siteId:site,taskId}).episodeId,session=w.starnikLogin(id,{username:'alex.morgan',password:'Billworld-2026!'}).session;return{w,id,session};}
const ebill=(w,id,session,option)=>{const v=w.starnikEBill(id,session);return w.starnikEBillSave(id,session,{residentId:v.residentId,eBillOption:option,version:v.version});};

test('GMG is a released first slice with every task available to a non-construction worker',()=>{
  const ids=[...tasks.values()].filter(t=>t.site_id===site).map(t=>t.id).sort();
  assert.deepEqual(ids,['gmg-autopay-cancel-v1','gmg-autopay-change-v1','gmg-autopay-enable-v1','gmg-download-current-bill-v1','gmg-ebill-paper-v1','gmg-guest-bank-payment-v1','gmg-guest-card-payment-v1','gmg-link-account-ebill-v1','gmg-mailing-address-v1','gmg-manage-wallet-v1','gmg-paperless-v1','gmg-read-history-balances-v1','gmg-recover-username-password-v1','gmg-register-account-v1','gmg-saved-bank-payment-v1','gmg-saved-card-payment-v1','gmg-username-login-v1']);
  const w=new World(':memory:');try{for(const taskId of ids){const e=w.create({siteId:site,taskId});assert.equal(w.state(e.episodeId).constructionSlice,false);assert.equal(w.evaluate(e.episodeId).success,false,taskId);}}finally{w.close();}
});

test('Fixture seeds the cabin account, addresses and its own immutable statement',()=>{
  const{w,id}=setup('gmg-username-login-v1');try{const s=w.state(id),cabin=s.accounts.find(a=>a.id==='acct-cabin');
    assert.equal(cabin.registered,false);assert.equal(cabin.customerNumber,'3003077');assert.equal(cabin.serviceAddress,'3077 Cedar Lake Rd, New Ulm, MN 56073');
    assert.deepEqual(s.accounts.find(a=>a.id==='acct-primary').starnikMailing,{line1:'1048 Prairie Wind Dr',line2:'',city:'Mankato',state:'MN',zip:'56001',version:1});
    assert.equal(s.invoices.find(i=>i.id==='inv-cabin').amountCents,6150);assert.ok(s.accounts.every(a=>Array.isArray(a.starnikLinkedAccountIds)&&!a.starnikLinkedAccountIds.length));
    assert.throws(()=>w.starnikLogin(id,{username:'alex.cabin',password:'Cabin-2026!'}),/incorrect/);
  }finally{w.close();}
});

test('Linking needs the exact account number and security code, rejects other profiles and locks after five failures',()=>{
  const{w,id,session}=setup('gmg-link-account-ebill-v1');try{
    assert.throws(()=>w.starnikAccountLink(id,session,{accountNumber:'3003077',securityCode:'GMG1048'}),/do not match/);
    assert.throws(()=>w.starnikAccountLink(id,session,{accountNumber:'1001048',securityCode:'GMG1048'}),/already on your profile/);
    assert.throws(()=>w.starnikAccountLink(id,session,{accountNumber:'2002099',securityCode:'GMG2099'}),/another online profile/);
    assert.throws(()=>w.starnikAccountLink(id,session,{accountNumber:'abc',securityCode:'GMG3077'}),/account number/);
    assert.throws(()=>w.starnikAccountSwitch(id,session,{accountId:'acct-cabin'}),/unavailable/);
    assert.deepEqual(w.starnikAccountLink(id,session,{accountNumber:' 3003077 ',securityCode:' GMG3077 '}),{accountId:'acct-cabin',customerNumber:'3003077'});
    assert.throws(()=>w.starnikAccountLink(id,session,{accountNumber:'3003077',securityCode:'GMG3077'}),/already on your profile/);
    assert.ok(w.state(id).mail.some(m=>m.subject.includes('account was added')));
    const other=setup('gmg-link-account-ebill-v1');try{for(let i=0;i<5;i++)assert.throws(()=>other.w.starnikAccountLink(other.id,other.session,{accountNumber:'3003077',securityCode:'WRONG'+i}),/do not match/);
      assert.throws(()=>other.w.starnikAccountLink(other.id,other.session,{accountNumber:'3003077',securityCode:'GMG3077'}),/Too many/);
      const fresh=other.w.starnikLogin(other.id,{username:'alex.morgan',password:'Billworld-2026!'}).session;assert.equal(other.w.starnikAccountLink(other.id,fresh,{accountNumber:'3003077',securityCode:'GMG3077'}).accountId,'acct-cabin');}finally{other.w.close();}
  }finally{w.close();}
});

test('Switching scopes account pages to the linked account; reset revokes switched sessions; unlink restores the profile',()=>{
  const{w,id,session}=setup('gmg-link-account-ebill-v1');try{w.starnikAccountLink(id,session,{accountNumber:'3003077',securityCode:'GMG3077'});
    w.starnikAccountSwitch(id,session,{accountId:'acct-cabin'});const view=w.starnikAccount(id,session);
    assert.equal(view.linkedView,true);assert.equal(view.account.customerNumber,'3003077');assert.equal(view.account.username,'alex.morgan');assert.deepEqual(view.invoices.map(i=>i.id),['inv-cabin']);assert.equal(view.invoices[0].statementAvailable,true);
    assert.equal(w.starnikStatement(id,session,'inv-cabin').filename,'gmg-inv-cabin.pdf');assert.throws(()=>w.starnikStatement(id,session,'inv-current'),/unavailable/);
    assert.equal(w.starnikPaymentOptions(id,session).balanceCents,6150);assert.equal(w.starnikHistory(id,session).account.customerNumber,'3003077');
    assert.throws(()=>w.starnikAccountUnlink(id,session,{accountId:'acct-cabin'}),/Confirm/);
    w.transact(id,s=>{s.accounts.find(a=>a.id==='acct-cabin').autopay.enabled=true;});assert.throws(()=>w.starnikAccountUnlink(id,session,{accountId:'acct-cabin',confirmed:true}),/Disable AutoPay/);w.transact(id,s=>{s.accounts.find(a=>a.id==='acct-cabin').autopay.enabled=false;});
    w.starnikAccountUnlink(id,session,{accountId:'acct-cabin',confirmed:true});assert.equal(w.starnikAccount(id,session).account.customerNumber,'1001048');assert.throws(()=>w.starnikAccountSwitch(id,session,{accountId:'acct-cabin'}),/unavailable/);
    w.starnikAccountLink(id,session,{accountNumber:'3003077',securityCode:'GMG3077'});w.starnikAccountSwitch(id,session,{accountId:'acct-cabin'});
    w.starnikRecoveryRequest(id,{kind:'password',username:'alex.morgan'});const token=/token=([^ ]+)/.exec(w.state(id).mail.at(-1).text)[1];w.starnikRecoveryComplete(id,{token,password:'Restored-2026!',confirmPassword:'Restored-2026!'});
    assert.throws(()=>w.starnikAccount(id,session),/sign in/i);
  }finally{w.close();}
});

test('Mailing address validates input, versions, no-change and leaves the service address alone',()=>{
  const{w,id,session}=setup('gmg-mailing-address-v1');try{const v=w.starnikMailing(id,session);
    for(const bad of [{...arizona,state:'XX'},{...arizona,zip:'8520'},{...arizona,line1:''},{...arizona,city:'<b>'},{...arizona,line2:'x'.repeat(61)}])assert.throws(()=>w.starnikMailingSave(id,session,{...bad,version:v.version}));
    assert.throws(()=>w.starnikMailingSave(id,session,{...arizona,version:v.version+1}),/reload/);
    assert.equal(w.starnikMailingSave(id,session,{...v.mailing,version:v.version}).changed,false);
    assert.deepEqual(w.starnikMailingSave(id,session,{...arizona,state:'az',line1:' 2210  E Saguaro Dr ',version:v.version}),{changed:true,message:'Your mailing address was updated.',version:2});
    const after=w.starnikMailing(id,session);assert.deepEqual(after.mailing,arizona);assert.equal(after.serviceAddress,'1048 Prairie Wind Dr, Mankato, MN 56001');
    assert.throws(()=>w.starnikMailingSave(id,session,{...arizona,city:'Tempe',version:1}),/reload/);
  }finally{w.close();}
});

test('Mailing grader needs one exact change after a view and a final read; rejects shortcuts and side effects',()=>{
  const run=(fn)=>{const x=setup('gmg-mailing-address-v1');try{fn(x);return x.w.evaluate(x.id);}finally{x.w.close();}};
  const complete=({w,id,session})=>{const v=w.starnikMailing(id,session);w.starnikMailingSave(id,session,{...arizona,version:v.version});};
  assert.equal(run(x=>{complete(x);x.w.starnikMailing(x.id,x.session);}).success,true);
  assert.equal(run(x=>complete(x)).checks.final_address_view,false);
  assert.equal(run(x=>{x.w.transact(x.id,s=>{s.accounts[0].starnikMailing={...arizona,version:2};});x.w.starnikMailing(x.id,x.session);}).success,false);
  assert.equal(run(x=>{const v=x.w.starnikMailing(x.id,x.session);x.w.starnikMailingSave(x.id,x.session,{...arizona,city:'Tempe',version:v.version});x.w.starnikMailingSave(x.id,x.session,{...arizona,version:2});x.w.starnikMailing(x.id,x.session);}).checks.one_requested_change,false);
  assert.equal(run(x=>{complete(x);x.w.transact(x.id,s=>{s.accounts[0].serviceAddress='elsewhere';});x.w.starnikMailing(x.id,x.session);}).success,false);
  assert.equal(run(x=>{complete(x);ebill(x.w,x.id,x.session,1);x.w.starnikMailing(x.id,x.session);}).success,false);
  assert.equal(run(x=>{x.w.starnikHistory(x.id,x.session);x.w.starnikWallet(x.id,x.session);complete(x);x.w.starnikMailing(x.id,x.session);}).success,true,'read-only browsing is not penalized');
});

test('Linked-account grader requires link, switch, linked eBill change and leaves the primary on paper',()=>{
  const run=(fn)=>{const x=setup('gmg-link-account-ebill-v1');try{fn(x);return x.w.evaluate(x.id);}finally{x.w.close();}};
  const link=({w,id,session})=>{w.starnikAccounts(id,session);w.starnikAccountLink(id,session,{accountNumber:'3003077',securityCode:'GMG3077'});};
  assert.equal(run(x=>{link(x);x.w.starnikAccountSwitch(x.id,x.session,{accountId:'acct-cabin'});ebill(x.w,x.id,x.session,1);x.w.starnikEBill(x.id,x.session);}).success,true);
  assert.equal(run(x=>{x.w.starnikAccounts(x.id,x.session);assert.throws(()=>x.w.starnikAccountLink(x.id,x.session,{accountNumber:'3003077',securityCode:'nope'}),/do not match/);}).success,false);
  assert.equal(run(x=>{link(x);ebill(x.w,x.id,x.session,1);x.w.starnikEBill(x.id,x.session);}).success,false,'changing the primary account fails');
  assert.equal(run(x=>{link(x);x.w.starnikAccountSwitch(x.id,x.session,{accountId:'acct-cabin'});ebill(x.w,x.id,x.session,2);x.w.starnikEBill(x.id,x.session);}).success,false,'wrong option');
  assert.equal(run(x=>{x.w.transact(x.id,s=>{s.accounts[0].starnikLinkedAccountIds=['acct-cabin'];});x.w.starnikAccountSwitch(x.id,x.session,{accountId:'acct-cabin'});ebill(x.w,x.id,x.session,1);x.w.starnikEBill(x.id,x.session);}).success,false,'state injection without link');
  assert.equal(run(x=>{link(x);x.w.starnikAccountSwitch(x.id,x.session,{accountId:'acct-cabin'});ebill(x.w,x.id,x.session,1);x.w.starnikAccountUnlink(x.id,x.session,{accountId:'acct-cabin',confirmed:true});x.w.starnikAccountLink(x.id,x.session,{accountNumber:'3003077',securityCode:'GMG3077'});x.w.starnikAccounts(x.id,x.session);}).success,false,'unlink/relink detour');
  assert.equal(run(x=>{link(x);x.w.starnikAccountSwitch(x.id,x.session,{accountId:'acct-cabin'});ebill(x.w,x.id,x.session,1);const v=x.w.starnikMailing(x.id,x.session);x.w.starnikMailingSave(x.id,x.session,{...arizona,version:v.version});}).success,false,'address side effect');
});

test('AutoPay change keeps AutoPay enrolled, requires review of the card terms and rejects a disable/enable detour',()=>{
  const run=(fn)=>{const x=setup('gmg-autopay-change-v1');try{fn(x);return x.w.evaluate(x.id);}finally{x.w.close();}};
  const change=({w,id,session},methodId='gmg-card-4242')=>{w.starnikAutoPay(id,session);const{token}=w.starnikAutoPayPrepare(id,session,{methodId});const r=w.starnikAutoPayReview(id,session,token);w.starnikAutoPayEnable(id,session,token,{agreedToTerms:true,confirmed:true,acknowledgeAch:true});return r;};
  const initial=setup('gmg-autopay-change-v1');try{const v=initial.w.starnikAutoPay(initial.id,initial.session);assert.equal(v.enrollment.enabled,true);assert.equal(v.enrollment.methodId,'gmg-bank-1048');assert.equal(v.textPayEnabled,false);}finally{initial.w.close();}
  assert.equal(run(x=>{const r=change(x);assert.match(r.feeDisclosure,/2\.75%/);x.w.starnikAutoPay(x.id,x.session);}).success,true);
  assert.equal(run(x=>change(x)).checks.final_status_view,false);
  assert.equal(run(x=>{change(x,'gmg-bank-1048');x.w.starnikAutoPay(x.id,x.session);}).success,false);
  assert.equal(run(x=>{x.w.starnikAutoPayDisable(x.id,x.session,{confirmed:true});change(x);x.w.starnikAutoPay(x.id,x.session);}).success,false);
  assert.equal(run(x=>{x.w.starnikAutoPay(x.id,x.session);x.w.transact(x.id,s=>{s.accounts[0].autopay={...s.accounts[0].autopay,methodId:'gmg-card-4242'};});x.w.starnikAutoPay(x.id,x.session);}).success,false);
});

test('Features stay gated to tenants that declare them',()=>{
  const w=new World(':memory:',{construction:true});try{const id=w.create({siteId:'inframark',taskId:'inframark-username-login-v1'}).episodeId,session=w.starnikLogin(id,{username:'alex.inframark',password:'Inframark-2026!'}).session;
    assert.throws(()=>w.starnikAccounts(id,session),/unavailable/);assert.throws(()=>w.starnikMailing(id,session),/unavailable/);}finally{w.close();}
});
