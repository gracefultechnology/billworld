import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {World} from '../engine.mjs';import {constructionSites,sites,tasks,constructionTasks} from '../registry.mjs';
const site=sites.get('onswc')||constructionSites.get('onswc'),task=id=>tasks.get(id)||constructionTasks.get(id);
const open=taskId=>{const w=new World(':memory:',{construction:true}),id=w.create({siteId:'onswc',taskId}).episodeId;return{w,id,login:(u='alex.onswc',p='ONSWC-2026!')=>w.starnikLogin(id,{username:u,password:p}).session};};
const fail=(r,name)=>{assert.equal(r.success,false);assert.equal(r.checks[name],false,name);};

test('ONSWC uses its own identity, tariff-derived invoices and labeled synthetic fees without borrowing GMG statements',()=>{
 const {w,id,login}=open('onswc-username-login-v1');try{assert.throws(()=>w.starnikLogin(id,{username:'alex.inframark',password:'Inframark-2026!'}));const session=login();const a=w.starnikAccount(id,session);
  assert.equal(a.siteName,'Old North State Water Company');assert.equal(a.achAvailable,true);assert.equal(a.serviceAddress,'1048 Rocklyn Way, Chapel Hill, NC 27516');
  const cur=a.invoices.find(i=>i.id==='inv-current');assert.deepEqual([cur.amountCents,cur.dueDate,cur.billDate,cur.pastDueDate,cur.remainingCents,cur.statementAvailable],[9439,'2026-10-01','2026-10-01','2026-10-16',9439,true]);
  assert.equal(a.invoices.find(i=>i.id==='inv-old').remainingCents,0);assert.equal(w.evaluate(id).success,true);
  for(const inv of w.state(id).invoices)assert.equal(inv.lines.reduce((n,l)=>n+l.amountCents,0),inv.amountCents);
  const p=w.starnikPaymentOptions(id,session);assert.equal(p.paymentAvailable,true);assert.match(p.feeDisclosure,/\$1\.50 fee.*3% fee, minimum \$2\.00/);
  assert.equal(site.documented_policy.payment_fee_status,'documented_existence_synthetic_amount');
  const doc=w.starnikStatement(id,session,'inv-current');assert.equal(doc.filename,'onswc-inv-current.pdf');assert.equal(createHash('sha256').update(doc.bytes).digest('hex'),task('onswc-download-current-bill-v1').goal.document_sha256);
  assert.throws(()=>w.starnikStatement(id,session,'inv-other'),/unavailable/);
  const history=w.starnikHistory(id,session);assert.ok(history.transactions.some(t=>t.description==='Bill ONS-2026-10-1048'&&t.date.startsWith('2026-10-01')));
 }finally{w.close();}
});

test('Saved bank and card checkout charge the tenant fee and the grader binds amount, method and receipt',()=>{
 for(const [taskId,methodId,amount,fee,remaining] of [['onswc-saved-bank-payment-v1','onswc-bank-1048',9439,150,0],['onswc-saved-card-payment-v1','onswc-card-4242',4000,200,5439]]){
  const {w,id,login}=open(taskId);try{const s=login();w.starnikAccount(id,s);w.starnikPaymentOptions(id,s);
   assert.ok(w.state(id).accounts[0].methods.every(m=>!m.id.startsWith('gmg-')));
   const q=w.starnikPaymentPrepare(id,s,{methodId,amountCents:amount});const review=w.starnikPaymentReview(id,s,q.token);assert.equal(review.feeCents,fee);
   assert.equal(w.evaluate(id).success,false);const receipt=w.starnikPaymentPay(id,s,q.token,{authorize:true});assert.match(receipt.confirmation,/^BW-ONSWC-/);
   assert.deepEqual(w.starnikPaymentPay(id,s,q.token,{authorize:true}),receipt);w.starnikPaymentReview(id,s,q.token,true);
   fail(w.evaluate(id),'final_balance_view');assert.equal(w.starnikPaymentOptions(id,s).balanceCents,remaining);const r=w.evaluate(id);assert.equal(r.success,true,JSON.stringify(r.checks));
  }finally{w.close();}
 }
 const {w,id,login}=open('onswc-saved-card-payment-v1');try{const s=login();w.starnikPaymentOptions(id,s);const q=w.starnikPaymentPrepare(id,s,{methodId:'onswc-bank-1048',amountCents:4000});w.starnikPaymentReview(id,s,q.token);w.starnikPaymentPay(id,s,q.token,{authorize:true});w.starnikPaymentReview(id,s,q.token,true);w.starnikPaymentOptions(id,s);fail(w.evaluate(id),'one_exact_payment');}finally{w.close();}
});

test('ACH Auto Draft enrollment requires review, agreement and the AutoPay duplicate warning; disabling AutoPay completes the task',()=>{
 const {w,id,login}=open('onswc-ach-enroll-v1');try{const s=login();const v=w.starnikAchAction(id,s,'view');assert.equal(v.autoPayWarning.hasConflict,true);assert.equal(v.residents[0].hasActiveACH,false);
  const input={residentId:'acct-primary',version:0,bankName:'Carolina Community Bank',achTransactionCodeId:1,routingNumber:'053000196',confirmRoutingNumber:'053000196',accountNumber:'7700123456',confirmAccountNumber:'7700123456'};
  assert.throws(()=>w.starnikAchAction(id,s,'prepare',{...input,confirmRoutingNumber:'021000021'}),/Routing Numbers do not match/);
  assert.throws(()=>w.starnikAchAction(id,s,'prepare',{...input,routingNumber:'053000197',confirmRoutingNumber:'053000197'}),/checksum/);
  assert.throws(()=>w.starnikAchAction(id,s,'prepare',{...input,confirmAccountNumber:'7700123457'}),/Account Numbers do not match/);
  const {token}=w.starnikAchAction(id,s,'prepare',input);assert.throws(()=>w.starnikAchAction(id,s,'save',{agreedToTerms:true,acknowledgeAutoPay:true},token),/Review the ACH agreement/);
  const review=w.starnikAchAction(id,s,'review',{},token);assert.equal(review.maskedAccountNumber,'XXXXXX3456');assert.equal(review.autoPayWarning.hasConflict,true);
  assert.throws(()=>w.starnikAchAction(id,s,'save',{agreedToTerms:false},token),/agree to the terms/);assert.throws(()=>w.starnikAchAction(id,s,'save',{agreedToTerms:true},token),/AutoPay warning/);
  const other=w.starnikLogin(id,{username:'jordan.onswc',password:'OtherONS-2026!'}).session;assert.throws(()=>w.starnikAchAction(id,other,'save',{agreedToTerms:true,acknowledgeAutoPay:true},token),/ACH review unavailable/);
  w.starnikAchAction(id,s,'save',{agreedToTerms:true,acknowledgeAutoPay:true},token);assert.equal(w.starnikAchAction(id,s,'save',{agreedToTerms:true,acknowledgeAutoPay:true},token).idempotent,true);
  w.starnikAchAction(id,s,'view');fail(w.evaluate(id),'final_autopay');
  assert.equal(w.starnikAutoPay(id,s).achEnabled,true);w.starnikAutoPayDisable(id,s,{confirmed:true});w.starnikAchAction(id,s,'view');
  const r=w.evaluate(id);assert.equal(r.success,true,JSON.stringify(r.checks));assert.equal(w.state(id).accounts[0].starnikAchDraft.accountLast4,'3456');
  assert.ok(w.state(id).mail.some(m=>m.subject==='Your local ONSWC ACH Auto Draft settings changed'&&m.text.includes('duplicate')));
 }finally{w.close();}
});

test('ACH change, deactivation and deletion are exact; extra deletion or skipped review fails the grader',()=>{
 {const {w,id,login}=open('onswc-ach-change-v1');try{const s=login();const v=w.starnikAchAction(id,s,'view');assert.equal(v.residents[0].hasActiveACH,true);assert.equal(v.autoPayWarning.hasConflict,false);
  assert.throws(()=>w.starnikAchAction(id,s,'prepare',{residentId:'acct-primary',version:0,bankName:'X',achTransactionCodeId:2,routingNumber:'053000196',confirmRoutingNumber:'053000196',accountNumber:'5500987654',confirmAccountNumber:'5500987654'}),/changed/);
  const {token}=w.starnikAchAction(id,s,'prepare',{residentId:'acct-primary',version:1,bankName:'Carolina Community Bank',achTransactionCodeId:2,routingNumber:'053000196',confirmRoutingNumber:'053000196',accountNumber:'5500987654',confirmAccountNumber:'5500987654'});
  w.starnikAchAction(id,s,'review',{},token);w.starnikAchAction(id,s,'save',{agreedToTerms:true},token);w.starnikAchAction(id,s,'view');const r=w.evaluate(id);assert.equal(r.success,true,JSON.stringify(r.checks));}finally{w.close();}}
 {const {w,id,login}=open('onswc-ach-stop-v1');try{const s=login();w.starnikAchAction(id,s,'view');assert.throws(()=>w.starnikAchAction(id,s,'deactivate',{residentId:'acct-primary'}),/Confirm/);w.starnikAchAction(id,s,'deactivate',{residentId:'acct-primary',confirmed:true});
  assert.throws(()=>w.starnikAchAction(id,s,'deactivate',{residentId:'acct-primary',confirmed:true}),/not active/);const v=w.starnikAchAction(id,s,'view');assert.equal(v.residents[0].hasBankOnFile,true);assert.equal(v.residents[0].maskedAccountNumber,'XXXXXX1048');
  const r=w.evaluate(id);assert.equal(r.success,true,JSON.stringify(r.checks));
  w.starnikAchAction(id,s,'delete',{residentId:'acct-primary',version:v.residents[0].version,confirmed:true});w.starnikAchAction(id,s,'view');fail(w.evaluate(id),'exact_ach');}finally{w.close();}}
});

test('ONSWC AutoPay enable acknowledges the active ACH draft, change and cancel use tenant timing, and the grader rejects extra changes',()=>{
 {const {w,id,login}=open('onswc-autopay-enable-v1');try{const s=login();const v=w.starnikAutoPay(id,s);assert.equal(v.achEnabled,true);assert.equal(v.textPayEnabled,false);assert.equal(v.timingDisclosure,'on the due date');
  const {token}=w.starnikAutoPayPrepare(id,s,{methodId:'onswc-bank-1048'});w.starnikAutoPayReview(id,s,token);assert.throws(()=>w.starnikAutoPayEnable(id,s,token,{agreedToTerms:true,confirmed:true}),/ACH/);
  w.starnikAutoPayEnable(id,s,token,{agreedToTerms:true,confirmed:true,acknowledgeAch:true});w.starnikAutoPay(id,s);const r=w.evaluate(id);assert.equal(r.success,true,JSON.stringify(r.checks));
  w.starnikAchAction(id,s,'deactivate',{residentId:'acct-primary',confirmed:true});fail(w.evaluate(id),'conflict_state');}finally{w.close();}}
 {const {w,id,login}=open('onswc-autopay-change-v1');try{const s=login();assert.equal(w.starnikAutoPay(id,s).enrollment.methodId,'onswc-bank-1048');const {token}=w.starnikAutoPayPrepare(id,s,{methodId:'onswc-card-4242'});w.starnikAutoPayReview(id,s,token);w.starnikAutoPayEnable(id,s,token,{agreedToTerms:true,confirmed:true});w.starnikAutoPay(id,s);const r=w.evaluate(id);assert.equal(r.success,true,JSON.stringify(r.checks));}finally{w.close();}}
 {const {w,id,login}=open('onswc-autopay-cancel-v1');try{const s=login();w.starnikAutoPay(id,s);w.starnikAutoPayDisable(id,s,{confirmed:true});w.starnikAutoPay(id,s);const r=w.evaluate(id);assert.equal(r.success,true,JSON.stringify(r.checks));}finally{w.close();}}
});

test('ONSWC paperless, wallet and history tasks grade on the tenant fixture',()=>{
 {const {w,id,login}=open('onswc-paperless-v1');try{const s=login();const v=w.starnikEBill(id,s);w.starnikEBillSave(id,s,{residentId:v.residentId,eBillOption:1,version:v.version});w.starnikEBill(id,s);const r=w.evaluate(id);assert.equal(r.success,true,JSON.stringify(r.checks));}finally{w.close();}}
 {const {w,id}=open('onswc-read-history-balances-v1');try{const s=w.starnikLogin(id,{username:'alex.onswc',password:'ONSWC-2026!'}).session;const h=w.starnikHistory(id,s);assert.deepEqual([h.balanceCents,h.pendingPayments.reduce((n,p)=>n+p.amountCents,0),h.availableCents],[9439,1000,8439]);assert.match(h.pendingPayments[0].confirmation,/^BW-ONSWC-PENDING/);
  assert.equal(w.evaluate(id,{postedBalanceCents:9439,pendingPaymentCents:1000,remainingBalanceCents:8439}).success,true);assert.equal(w.evaluate(id,{postedBalanceCents:9439,pendingPaymentCents:1000,remainingBalanceCents:9439}).success,false);}finally{w.close();}}
 {const {w,id,login}=open('onswc-manage-wallet-v1');try{const s=login();const g=task('onswc-manage-wallet-v1').goal;w.starnikWallet(id,s);const card=w.starnikWalletMethod(id,s,g.card_id);
  const e=w.starnikWalletPrepare(id,s,{methodId:g.card_id,version:card.method.version,kind:'card',cardType:'Visa',name:'Alex Morgan',cardNumber:'4242424242424242',cvv:'123',expiry:'12/31',...g.billing});w.starnikWalletReview(id,s,e.token);w.starnikWalletSave(id,s,e.token,{authorize:true});
  const b=w.starnikWalletPrepare(id,s,{kind:'bank',name:'Alex Morgan',bankName:'Test Bank',accountType:'Savings',routing:'021000021',confirmRouting:'021000021',accountNumber:'1234561048',confirmAccountNumber:'1234561048',...g.billing});w.starnikWalletReview(id,s,b.token);w.starnikWalletSave(id,s,b.token,{authorize:true});
  w.starnikWalletRemove(id,s,{methodId:g.remove_id,authorize:true});w.starnikWallet(id,s);const r=w.evaluate(id);assert.equal(r.success,true,JSON.stringify(r.checks));}finally{w.close();}}
});

test('ONSWC statement grader requires the authorized download and the exact filename',()=>{
 const {w,id,login}=open('onswc-download-current-bill-v1');try{const s=login();w.starnikAccount(id,s);fail(w.evaluate(id,{statementFilename:'onswc-inv-current.pdf'}),'authorized_exact_statement');w.starnikStatement(id,s,'inv-current');
  fail(w.evaluate(id,{statementFilename:'gmg-inv-current.pdf'}),'filename_reported');assert.equal(w.evaluate(id,{statementFilename:'onswc-inv-current.pdf'}).success,true);
  w.starnikStatement(id,s,'inv-old');fail(w.evaluate(id,{statementFilename:'onswc-inv-current.pdf'}),'only_requested_statement');}finally{w.close();}
 const manifest=JSON.parse(readFileSync(new URL('../research/onswc-statements.json',import.meta.url)));assert.equal(manifest.documents.length,3);assert.ok(manifest.documents.every(d=>d.siteId==='onswc'&&/^onswc-inv-/.test(d.file)));
});

test('ACH HTTP routes require a session, bind the review cookie and stay off for tenants without ACH policy',async()=>{
 const {start}=await import('../server.mjs');const s=await start({port:0,adminPort:0,dbPath:':memory:',construction:true});
 try{const open=async(siteId,taskId)=>{const f=s.world.create({siteId,taskId});let jar=`bw_episode=${f.episodeId}; bw_access=${f.entryToken}`;const absorb=r=>{for(const c of r.headers.getSetCookie()){const[pair]=c.split(';');const[name,value]=pair.split('=');jar=jar.split('; ').filter(p=>!p.startsWith(name+'=')).concat(value?[pair]:[]).join('; ');}return r;};
   return{f,get:async p=>absorb(await fetch(s.baseUrl+p,{headers:{Cookie:jar}})),post:async(p,d)=>absorb(await fetch(s.baseUrl+p,{method:'POST',headers:{Cookie:jar,Origin:s.baseUrl,'Content-Type':'application/json'},body:JSON.stringify(d)}))};};
  const a=await open('onswc','onswc-ach-enroll-v1');assert.equal((await a.get('/api/starnik/ach')).status,401);
  assert.equal((await a.post('/api/starnik/login',{username:'alex.onswc',password:'ONSWC-2026!'})).status,200);const v=await (await a.get('/api/starnik/ach')).json();assert.equal(v.residents[0].isACHEnabledForCommunity,true);
  assert.equal((await a.get('/api/starnik/ach/review')).status,404);
  const prep=await a.post('/api/starnik/ach/prepare',{residentId:'acct-primary',version:0,bankName:'Carolina Community Bank',achTransactionCodeId:1,routingNumber:'053000196',confirmRoutingNumber:'053000196',accountNumber:'7700123456',confirmAccountNumber:'7700123456'});assert.equal(prep.status,200);assert.deepEqual(await prep.json(),{ok:true});
  const review=await (await a.get('/api/starnik/ach/review')).json();assert.equal(review.autoPayWarning.hasConflict,true);assert.ok(!JSON.stringify(review).includes('7700123456'));
  // Another browser (no review cookie) cannot complete the reviewed enrollment.
  const b=await open('onswc','onswc-ach-enroll-v1');await b.post('/api/starnik/login',{username:'alex.onswc',password:'ONSWC-2026!'});assert.equal((await b.post('/api/starnik/ach/save',{agreedToTerms:true,acknowledgeAutoPay:true})).status,404);
  assert.equal((await a.post('/api/starnik/ach/save',{agreedToTerms:true,acknowledgeAutoPay:true})).status,200);
  const page=await (await a.get('/my-account/ach')).text();assert.match(page,/<script src="\/starnik\.js" data-inline-confirm="true" defer>/);
  const g=await open('greater-minnesota-gas','gmg-username-login-v1');await g.post('/api/starnik/login',{username:'alex.morgan',password:'Billworld-2026!'});const r=await g.get('/api/starnik/ach');assert.equal(r.status,404);assert.match((await r.json()).error,/not enabled for this community/);
  assert.doesNotMatch(await (await g.get('/my-account/autopay')).text(),/data-inline-confirm/);
 }finally{await s.close();}
});
