import test from 'node:test';import assert from 'node:assert/strict';import{World}from'../engine.mjs';import{starnikFee}from'../starnik-payment.mjs';
const bank={kind:'bank',name:'Alex Morgan',bankName:'Test Bank',accountType:'Checking',routing:'021000021',confirmRouting:'021000021',accountNumber:'1234561048',confirmAccountNumber:'1234561048',amountCents:8432,firstName:'Alex',lastName:'Morgan',address:'1 Test Street',city:'Mankato',state:'MN',zip:'56001',country:'United States',email:'alex@billworld.test'};
const card={...bank,kind:'card',cardType:'Visa',cardNumber:'4242424242424242',cvv:'123',expiry:'12/30'};
const billing={firstName:'Alex',lastName:'Morgan',address:'1 Test Street',city:'Mankato',state:'MN',zip:'56001',country:'United States',email:'alex@billworld.test'};
const setup=(kind='bank')=>{const w=new World(':memory:',{construction:true}),id=w.create({siteId:'inframark',taskId:'inframark-guest-'+kind+'-payment-v1'}).episodeId,g=w.starnikGuestLookup(id,{securityCode:'INF1048',serviceZip:'77001'}).token;return{w,id,g};};
const episode=taskId=>{const w=new World(':memory:',{construction:false}),id=w.create({siteId:'inframark',taskId}).episodeId;return{w,id};};
const signIn=(w,id)=>w.starnikLogin(id,{username:'alex.inframark',password:'Inframark-2026!'}).session;
const run=(taskId,flow,answers={})=>{const{w,id}=episode(taskId);try{const s=signIn(w,id);w.starnikAccount(id,s);const extra=flow(w,id,s)||{};return{w,id,s,result:w.evaluate(id,{...answers,...extra})};}catch(e){w.close();throw e;}};
const ok=(r,label)=>{assert.equal(r.result.success,true,label+': '+JSON.stringify(r.result.checks));r.w.close();};
const bad=(r,label)=>{assert.equal(r.result.success,false,label+' should fail');r.w.close();};

function finish(w,id,g,kind='bank'){const q=w.starnikGuestQuote(id,g,kind==='bank'?bank:card);w.starnikGuestReview(id,g,q.token);w.starnikGuestPay(id,g,q.token,{authorize:true});return q;}
test('Both guest payment graders require receipt and subsequent zero balance read',()=>{for(const kind of ['bank','card']){const{w,id,g}=setup(kind);try{assert.equal(w.evaluate(id).success,false);const q=finish(w,id,g,kind);assert.equal(w.evaluate(id).success,false);w.starnikGuestReview(id,g,q.token,true);assert.equal(w.evaluate(id).success,false);w.starnikGuestAccount(id,g);assert.equal(w.evaluate(id).success,true);}finally{w.close();}}});
test('Payment grader rejects side effects, altered payment, wrong method, removed receipt and broken event sequence',()=>{for(const mutate of [s=>s.accounts[0].autopay.enabled=true,s=>s.accounts[1].email='changed@test.local',s=>s.accounts[0].credential='changed',s=>s.invoices[2].amountCents++,s=>s.payments[0].amountCents++,s=>s.payments[1].feeCents++,s=>s.payments[1].method.last4='9999',s=>s.payments.push({...s.payments[1],id:'extra'}),s=>s.mail=[],s=>s.events=s.events.filter(e=>e.type!=='starnik_guest_reviewed'),s=>s.events=s.events.filter(e=>e.type!=='starnik_guest_verified'),s=>s.events=s.events.filter(e=>e.type!=='starnik_guest_receipt_viewed')]){const{w,id,g}=setup();try{const q=finish(w,id,g);w.starnikGuestReview(id,g,q.token,true);w.starnikGuestAccount(id,g);assert.equal(w.evaluate(id).success,true);w.transact(id,mutate);assert.equal(w.evaluate(id).success,false);}finally{w.close();}}});
test('Correct amount with wrong instrument or extra login cannot pass',()=>{for(const mode of ['instrument','login']){const{w,id,g}=setup();try{const q=w.starnikGuestQuote(id,g,{...bank,...(mode==='instrument'?{accountNumber:'1234569999',confirmAccountNumber:'1234569999'}:{})});w.starnikGuestReview(id,g,q.token);w.starnikGuestPay(id,g,q.token,{authorize:true});w.starnikGuestReview(id,g,q.token,true);w.starnikGuestAccount(id,g);if(mode==='login')w.starnikLogin(id,{username:'alex.inframark',password:'Inframark-2026!'});assert.equal(w.evaluate(id).success,false);}finally{w.close();}}});
test('Inframark identity, fees, statements and features cannot inherit GMG settings',()=>{
 const w=new World(':memory:',{construction:false});try{
 const id=w.create({siteId:'inframark',taskId:'inframark-username-login-v1'}).episodeId;
 assert.throws(()=>w.starnikLogin(id,{username:'alex.morgan',password:'Billworld-2026!'}));
 const session=w.starnikLogin(id,{username:'alex.inframark',password:'Inframark-2026!'}).session,v=w.starnikAccount(id,session);assert.equal(v.siteName,'Inframark');assert.equal(w.evaluate(id).success,true);
 assert.equal(v.account.paymentId,'10123-0001001048');assert.equal(v.scheduledAvailable,true);assert.ok(v.invoices.every(i=>i.statementAvailable===true));
 const doc=w.starnikStatement(id,session,'inv-current');assert.equal(doc.filename,'inframark-inv-current.pdf');assert.equal(doc.bytes.subarray(0,5).toString(),'%PDF-');
 const ap=w.starnikAutoPay(id,session);assert.equal(ap.enrollmentAvailable,true);assert.equal(ap.timingDisclosure,'on the due date');
 const guest=w.starnikGuestLookup(id,{securityCode:'INF1048',serviceZip:'77001'}).token;
 assert.equal(w.starnikGuestQuote(id,guest,bank).feeCents,100);assert.equal(w.starnikGuestQuote(id,guest,card).feeCents,253);
 assert.throws(()=>w.starnikGuestLookup(id,{securityCode:'GMG1048',serviceZip:'56001'}));
 assert.ok(w.state(id).accounts[0].methods.every(m=>!m.id.startsWith('gmg-')));
 }finally{w.close();}
});

// Signed-in flows
const signedPay=(methodId,amountCents,{receipt=true,reopen=true}={})=>(w,id,s)=>{w.starnikPaymentOptions(id,s);const{token}=w.starnikPaymentPrepare(id,s,{methodId,amountCents});w.starnikPaymentReview(id,s,token);w.starnikPaymentPay(id,s,token,{authorize:true});if(receipt)w.starnikPaymentReview(id,s,token,true);if(reopen)w.starnikPaymentOptions(id,s);};
test('Saved bank and card payments charge documented fees and require receipt then balance view',()=>{
 ok(run('inframark-saved-bank-payment-v1',signedPay('inframark-bank-1048',8432)),'bank');ok(run('inframark-saved-card-payment-v1',signedPay('inframark-card-4242',2000)),'card');
 assert.equal(starnikFee('card',2000,{bank_fee_cents:100,card_fee_basis_points:300,card_fee_minimum_cents:0}),60);
 bad(run('inframark-saved-bank-payment-v1',signedPay('inframark-card-4242',8432)),'wrong method');bad(run('inframark-saved-card-payment-v1',signedPay('inframark-card-4242',2500)),'wrong amount');
 bad(run('inframark-saved-bank-payment-v1',signedPay('inframark-bank-1048',8432,{receipt:false})),'no receipt');bad(run('inframark-saved-bank-payment-v1',signedPay('inframark-bank-1048',8432,{reopen:false})),'no balance view');
 bad(run('inframark-saved-bank-payment-v1',(w,id,s)=>{signedPay('inframark-bank-1048',4000)(w,id,s);signedPay('inframark-bank-1048',4432)(w,id,s);}),'split payment');
});
test('History, statement and paperless graders require exact reported values and ordered changes',()=>{
 ok(run('inframark-read-history-balances-v1',(w,id,s)=>{const h=w.starnikHistory(id,s);assert.equal(h.pendingPayments[0].confirmation,'BW-INFRAMARK-PENDING-1048');}, {postedBalanceCents:8432,pendingPaymentCents:1000,remainingBalanceCents:7432}),'history');
 bad(run('inframark-read-history-balances-v1',(w,id,s)=>{w.starnikHistory(id,s);},{postedBalanceCents:8432,pendingPaymentCents:0,remainingBalanceCents:8432}),'history wrong values');
 ok(run('inframark-download-current-bill-v1',(w,id,s)=>{w.starnikStatement(id,s,'inv-current');},{statementFilename:'inframark-inv-current.pdf'}),'statement');
 bad(run('inframark-download-current-bill-v1',(w,id,s)=>{w.starnikStatement(id,s,'inv-old');},{statementFilename:'inframark-inv-current.pdf'}),'wrong statement');
 const paperless=(option,again=true)=>(w,id,s)=>{const v=w.starnikEBill(id,s);w.starnikEBillSave(id,s,{residentId:v.residentId,eBillOption:option,version:v.version});if(again)w.starnikEBill(id,s);};
 ok(run('inframark-paperless-v1',paperless(1)),'paperless');bad(run('inframark-paperless-v1',paperless(2)),'paper and eBill');bad(run('inframark-paperless-v1',paperless(1,false)),'no reload');
});
test('Wallet grader requires the edited card, new savings and removed checking only',()=>{
 const flow=(remove=true)=>(w,id,s)=>{w.starnikWallet(id,s);const m=w.starnikWalletMethod(id,s,'inframark-card-4242').method;let t=w.starnikWalletPrepare(id,s,{...card,...billing,methodId:m.id,version:m.version,expiry:'12/31'}).token;w.starnikWalletReview(id,s,t);w.starnikWalletSave(id,s,t,{authorize:true});t=w.starnikWalletPrepare(id,s,{...bank,...billing,accountType:'Savings'}).token;w.starnikWalletReview(id,s,t);w.starnikWalletSave(id,s,t,{authorize:true});if(remove)w.starnikWalletRemove(id,s,{methodId:'inframark-bank-2099',authorize:true});w.starnikWallet(id,s);};
 ok(run('inframark-manage-wallet-v1',flow()),'wallet');bad(run('inframark-manage-wallet-v1',flow(false)),'no removal');
});
const apEnable=methodId=>(w,id,s)=>{w.starnikAutoPay(id,s);const{token}=w.starnikAutoPayPrepare(id,s,{methodId});w.starnikAutoPayReview(id,s,token);w.starnikAutoPayEnable(id,s,token,{agreedToTerms:true,confirmed:true});w.starnikAutoPay(id,s);};
test('AutoPay enroll, change and cancel use tenant timing and reject shortcuts',()=>{
 ok(run('inframark-autopay-enable-v1',apEnable('inframark-bank-1048')),'enable');ok(run('inframark-autopay-change-v1',apEnable('inframark-card-4242')),'change');
 ok(run('inframark-autopay-cancel-v1',(w,id,s)=>{w.starnikAutoPay(id,s);w.starnikAutoPayDisable(id,s,{confirmed:true});w.starnikAutoPay(id,s);}),'cancel');
 bad(run('inframark-autopay-enable-v1',apEnable('inframark-card-4242')),'enable wrong method');
 bad(run('inframark-autopay-change-v1',(w,id,s)=>{w.starnikAutoPay(id,s);w.starnikAutoPayDisable(id,s,{confirmed:true});apEnable('inframark-card-4242')(w,id,s);}),'change via disable+enable');
 bad(run('inframark-autopay-cancel-v1',(w,id,s)=>{w.starnikAutoPay(id,s);w.starnikAutoPayDisable(id,s,{confirmed:true});}),'cancel without reload');
 bad(run('inframark-autopay-enable-v1',(w,id,s)=>{apEnable('inframark-bank-1048')(w,id,s);signedPay('inframark-bank-1048',1000)(w,id,s);}),'enable plus payment');
 const{w,id}=episode('inframark-autopay-enable-v1');try{const s=signIn(w,id);apEnable('inframark-bank-1048')(w,id,s);const r=w.advance(id,17*86400000+8*3600000);assert.ok(r.executed.includes('starnik-autopay:inv-current'));const p=w.state(id).payments.at(-1);assert.deepEqual([p.amountCents,p.feeCents,p.status,p.createdAt],[8432,100,'posted',Date.parse('2026-10-20T00:00:00Z')]);}finally{w.close();}
});
const sched=(input,{again=true}={})=>(w,id,s)=>{w.starnikScheduleOp(id,'list',{session:s});const{token}=w.starnikScheduleOp(id,'prepare',{session:s,input});w.starnikScheduleOp(id,'review',{session:s,token});w.starnikScheduleOp(id,'confirm',{session:s,token,input:{authorize:true}});if(again)w.starnikScheduleOp(id,'list',{session:s});};
test('Scheduled payment create, edit and cancel graders require exact reviewed changes and no payment',()=>{
 ok(run('inframark-schedule-payment-v1',sched({methodId:'inframark-bank-1048',amountCents:8432,date:'2026-10-15'}),{scheduledDate:'2026-10-15'}),'create');
 bad(run('inframark-schedule-payment-v1',sched({methodId:'inframark-bank-1048',amountCents:8432,date:'2026-10-15'}),{scheduledDate:'2026-10-16'}),'wrong reported date');
 bad(run('inframark-schedule-payment-v1',sched({methodId:'inframark-card-4242',amountCents:8432,date:'2026-10-15'}),{scheduledDate:'2026-10-15'}),'wrong method');
 bad(run('inframark-schedule-payment-v1',sched({methodId:'inframark-bank-1048',amountCents:8432,date:'2026-10-15'},{again:false}),{scheduledDate:'2026-10-15'}),'no final view');
 bad(run('inframark-schedule-payment-v1',(w,id,s)=>{signedPay('inframark-bank-1048',8432)(w,id,s);},{scheduledDate:'2026-10-15'}),'pay now instead');
 const edit={scheduleId:'inframark-sched-1018',version:1,methodId:'inframark-card-4242',amountCents:8432,date:'2026-10-16'};
 ok(run('inframark-scheduled-edit-v1',sched(edit),{scheduledDate:'2026-10-16'}),'edit');
 bad(run('inframark-scheduled-edit-v1',(w,id,s)=>{w.starnikScheduleOp(id,'list',{session:s});w.starnikScheduleOp(id,'cancel',{session:s,input:{scheduleId:'inframark-sched-1018',version:1,confirmed:true}});sched({...edit,scheduleId:undefined,version:undefined})(w,id,s);},{scheduledDate:'2026-10-16'}),'cancel and recreate');
 bad(run('inframark-scheduled-edit-v1',sched({...edit,methodId:'inframark-bank-1048'}),{scheduledDate:'2026-10-16'}),'edit wrong method');
 const cancel=(scheduleId,again=true)=>(w,id,s)=>{w.starnikScheduleOp(id,'list',{session:s});w.starnikScheduleOp(id,'cancel',{session:s,input:{scheduleId,version:1,confirmed:true}});if(again)w.starnikScheduleOp(id,'list',{session:s});};
 ok(run('inframark-scheduled-cancel-v1',cancel('inframark-sched-1018')),'cancel');bad(run('inframark-scheduled-cancel-v1',cancel('inframark-sched-1010')),'cancel wrong payment');
 bad(run('inframark-scheduled-cancel-v1',(w,id,s)=>{cancel('inframark-sched-1018')(w,id,s);w.starnikScheduleOp(id,'cancel',{session:s,input:{scheduleId:'inframark-sched-1010',version:1,confirmed:true}});w.starnikScheduleOp(id,'list',{session:s});}),'cancel both');
});
test('Scheduled payments validate limits, require AutoPay duplicate acknowledgement and execute on their date',()=>{
 const{w,id}=episode('inframark-schedule-payment-v1');try{const s=signIn(w,id),prep=input=>w.starnikScheduleOp(id,'prepare',{session:s,input});
  assert.throws(()=>prep({methodId:'inframark-bank-1048',amountCents:8432,date:'2026-10-03'}),/Choose a payment date/);
  assert.throws(()=>prep({methodId:'inframark-bank-1048',amountCents:8432,date:'2026-12-31'}),/Choose a payment date/);
  assert.throws(()=>prep({methodId:'inframark-bank-1048',amountCents:8433,date:'2026-10-15'}),/no greater than/);
  assert.throws(()=>prep({methodId:'missing',amountCents:100,date:'2026-10-15'}),/saved payment method/);
  assert.throws(()=>w.starnikScheduleOp(id,'confirm',{session:s,token:prep({methodId:'inframark-bank-1048',amountCents:100,date:'2026-10-15'}).token,input:{authorize:true}}),/Review the scheduled payment again/);
  // Enabling AutoPay after preparing invalidates the review; a new review requires acknowledging duplicates.
  const t1=prep({methodId:'inframark-bank-1048',amountCents:5000,date:'2026-10-15'}).token;w.starnikScheduleOp(id,'review',{session:s,token:t1});apEnable('inframark-bank-1048')(w,id,s);
  assert.throws(()=>w.starnikScheduleOp(id,'confirm',{session:s,token:t1,input:{authorize:true}}),/AutoPay settings changed/);
  const t2=prep({methodId:'inframark-bank-1048',amountCents:5000,date:'2026-10-15'}).token,rv=w.starnikScheduleOp(id,'review',{session:s,token:t2});assert.equal(rv.autopayEnabled,true);
  assert.throws(()=>w.starnikScheduleOp(id,'confirm',{session:s,token:t2,input:{authorize:true}}),/Acknowledge that AutoPay/);
  const done=w.starnikScheduleOp(id,'confirm',{session:s,token:t2,input:{authorize:true,acknowledgeAutoPay:true}});assert.equal(w.starnikScheduleOp(id,'confirm',{session:s,token:t2,input:{authorize:true}}).idempotent,true);
  assert.throws(()=>w.starnikWalletRemove(id,s,{methodId:'inframark-bank-1048',authorize:true}),/Disable AutoPay|Cancel scheduled/);
  const r=w.advance(id,17*86400000+8*3600000);assert.ok(r.executed.includes('starnik-schedule:'+done.scheduleId));
  const st=w.state(id),item=st.scheduledPayments.find(p=>p.id===done.scheduleId),paid=st.payments.filter(p=>p.scheduleId===done.scheduleId);
  assert.equal(item.status,'paid');assert.deepEqual(paid.map(p=>[p.invoiceId,p.amountCents,p.feeCents,p.createdAt]),[['inv-current',5000,100,Date.parse('2026-10-15T00:00:00Z')]]);
  // AutoPay on the due date pays only the remaining unreserved balance.
  const auto=st.payments.find(p=>p.source==='autopay');assert.equal(auto.amountCents,3432);
 }finally{w.close();}
});
