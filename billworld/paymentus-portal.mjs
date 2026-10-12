import {utcDay} from './scheduler.mjs';
import {runPaymentusAutoPay} from './paymentus-autopay.mjs';
import {validateExpiry} from './wallet.mjs';
// Batavia (Paymentus) portal features beyond the guide's entry screens.
// Evidence labels: My Profile is documented navigation ("View or change general
// settings for your login"); multi-account payment is documented ("Make a payment on
// one or more accounts"; FAQ: "tie all your accounts ... and make one payment").
// Future-dated payment scheduling is a synthetic Paymentus-platform rule: the city
// documents neither payment dates nor scheduled-payment editing.
export const PAYMENTUS_SCHEDULE_POLICY={evidence:'synthetic_platform_rule_not_documented_by_batavia',earliest:'next UTC day',latest:'invoice due date',execution:'00:00 UTC on the scheduled date, before same-instant AutoPay',reservation:'none until execution; amount rechecked against the unreserved balance',fee:'flat service fee captured at review',edits:'date and amount while scheduled'};

const day=now=>new Date(now).toISOString().slice(0,10);
const money=c=>'$'+(c/100).toFixed(2);
const cents=v=>Number.isSafeInteger(v)?v:NaN;
const links=a=>a.paymentusLinks||[];
const linked=(a,accountId)=>links(a).some(l=>l.accountId===accountId);
const scheduledFor=(s,invoiceId,except=null)=>(s.scheduledPayments||[]).filter(p=>p.source==='paymentus'&&p.status==='scheduled'&&p.invoiceId===invoiceId&&p.id!==except).reduce((n,p)=>n+p.amountCents,0);
const safeSchedule=(s,p,o)=>{const inv=s.invoices.find(i=>i.id===p.invoiceId),target=s.accounts.find(a=>a.id===p.accountId);return{id:p.id,accountId:p.accountId,customerNumber:target?.customerNumber,invoiceId:p.invoiceId,invoiceNumber:inv?.number||null,dueDate:inv?.dueDate||null,amountCents:p.amountCents,feeCents:p.feeCents,totalCents:p.amountCents+p.feeCents,method:o.safeMethod(p.method),date:p.date,status:p.status,confirmation:p.confirmation,version:p.version,...(p.paymentId?{paymentId:p.paymentId}:{}),...(p.failureReason?{failureReason:p.failureReason}:{})};};

function validDate(s,inv,date,o){const at=utcDay(date);o.need(Number.isFinite(at),'Enter the payment date as YYYY-MM-DD');o.need(date>day(s.now),'Choose a payment date after today');o.need(date<=inv.dueDate,'Choose a payment date on or before the bill due date ('+inv.dueDate+')');return at;}
function profileView(a){const p=a.paymentusProfile||{};return{email:a.email,firstName:p.firstName||'',lastName:p.lastName||'',phone:p.phone||'',zipCode:p.zipCode||''};}

export function paymentusPortal(s,a,session,{name,input,tokens,method},o){
 const {need}=o,policy=o.policy;
 const get=method==='GET';
 if(name==='profile'&&get){o.event(s,'paymentus_profile_viewed',{accountId:a.id});return{result:{...profileView(a),synthetic:true}};}
 if(name==='profile'){
  need(Object.keys(input).every(k=>['firstName','lastName','phone','zipCode'].includes(k)),'Unsupported profile field');
  for(const key of ['firstName','lastName'])need(typeof input[key]==='string'&&input[key].trim().length>0&&input[key].length<=100,'Enter '+(key==='firstName'?'First Name':'Last Name'));
  const phone=String(input.phone||'').replace(/[ ()+.-]/g,'');need(/^\d{10}$/.test(phone),'Enter a ten-digit Phone Number');need(typeof input.zipCode==='string'&&/^\d{5}$/.test(input.zipCode.trim()),'Enter a five-digit Zip Code');
  const next={firstName:input.firstName.trim(),lastName:input.lastName.trim(),phone,zipCode:input.zipCode.trim()},before=a.paymentusProfile||{};
  const fields=Object.keys(next).filter(k=>before[k]!==next[k]);
  if(!fields.length)return{result:{...profileView(a),changed:false}};
  a.paymentusProfile={...before,...next};o.event(s,'paymentus_profile_changed',{accountId:a.id,fields});
  o.send(s,a.email,'Your local Batavia portal profile changed','Your portal profile ('+fields.join(', ')+') was updated. If you did not make this change, contact Utility Billing at 630-454-2020.');
  return{result:{...profileView(a),changed:true}};
 }
 if(name==='password'){
  need(!get,'Unsupported request',405);
  need(o.matches(input.currentPassword,a.credential),'Current password is incorrect');
  need(typeof input.password==='string'&&input.password.length>=10&&input.password.length<=128,'Use a new password between 10 and 128 characters');
  need(input.password===input.confirmPassword,'New passwords must match');need(!o.matches(input.password,a.credential),'Choose a password different from the current password');
  a.credential=o.credential(input.password);let revoked=0;for(const [token,t] of Object.entries(s.sessions))if(t.accountId===a.id&&token!==session){delete s.sessions[token];revoked++;}
  o.event(s,'paymentus_password_changed',{accountId:a.id,revokedSessions:revoked});o.send(s,a.email,'Your local Batavia portal password changed','Your portal password was changed. Other signed-in sessions were signed out.');
  return{result:{changed:true,revokedSessions:revoked}};
 }
 if(name==='scheduled'&&get){
  const ids=new Set(links(a).map(l=>l.accountId));const items=(s.scheduledPayments||[]).filter(p=>p.source==='paymentus'&&p.profileId===a.id&&ids.has(p.accountId)).sort((x,y)=>x.date.localeCompare(y.date)||x.id.localeCompare(y.id));
  o.event(s,'paymentus_scheduled_viewed',{accountId:a.id,scheduleIds:items.map(p=>p.id)});
  return{result:{scheduled:items.map(p=>safeSchedule(s,p,o)),policy:PAYMENTUS_SCHEDULE_POLICY,today:day(s.now),synthetic:true}};
 }
 if(name==='schedule'){
  need(!get,'Unsupported request',405);
  const q=s.quotes[o.hash(String(tokens.quote))];need(q?.purpose==='paymentus'&&q.profileId===a.id&&q.session===session&&linked(a,q.accountId),'Payment review unavailable',404);
  need(input.authorize===true,'Authorize the scheduled payment');
  if(q.scheduleId){const existing=s.scheduledPayments.find(p=>p.id===q.scheduleId);need(existing.date===input.date,'This review already scheduled a payment; edit it from Scheduled Payments');return{result:safeSchedule(s,existing,o)};}
  need(!q.paymentId,'This review was already paid',409);need(q.expires>s.now,'Payment review expired',409);
  const inv=s.invoices.find(i=>i.id===q.invoiceId);need(inv,'Linked bill not found',404);const at=validDate(s,inv,input.date,o);
  need(q.amountCents<=o.available(inv)-scheduledFor(s,inv.id),'Scheduled payments would exceed the unpaid bill');
  if(q.method.id){const m=a.methods.find(m=>m.id===q.method.id);need(m&&m.version===q.method.version&&m.instrumentHash===q.method.instrumentHash,'Saved method changed; review payment again');}
  s.scheduledPayments||=[];const n=s.scheduledPayments.length+1;
  const item={id:'pms-'+n,source:'paymentus',profileId:a.id,accountId:inv.accountId,invoiceId:inv.id,amountCents:q.amountCents,feeCents:q.feeCents,method:q.method,receiptEmail:a.email,date:input.date,at,status:'scheduled',confirmation:'BWS-'+s.seed+'-'+n,version:1,createdAt:s.now};
  s.scheduledPayments.push(item);q.scheduleId=item.id;o.event(s,'paymentus_payment_scheduled',{accountId:a.id,billingAccountId:inv.accountId,invoiceId:inv.id,scheduleId:item.id,date:item.date,amountCents:item.amountCents});
  o.send(s,a.email,'Your local Batavia payment is scheduled',`Scheduled payment ${item.confirmation}: ${money(item.amountCents)} plus ${money(item.feeCents)} service fee from ${q.method.label} on ${item.date} for bill ${inv.number}. You can edit or cancel it from Payment History before that date.`);
  return{result:safeSchedule(s,item,o)};
 }
 if(['scheduled-edit','scheduled-cancel'].includes(name)){
  need(!get,'Unsupported request',405);
  const item=(s.scheduledPayments||[]).find(p=>p.source==='paymentus'&&p.id===input.scheduleId&&p.profileId===a.id&&linked(a,p.accountId));need(item,'Scheduled payment not found',404);need(item.status==='scheduled','Only a scheduled payment can be changed',409);
  need(Number.isSafeInteger(input.version)&&input.version===item.version,'This scheduled payment changed; reload and try again',409);
  if(name==='scheduled-cancel'){need(input.confirm===true,'Confirm the cancellation');item.status='cancelled';item.cancelledAt=s.now;item.version++;o.event(s,'scheduled_payment_cancelled',{accountId:a.id,billingAccountId:item.accountId,scheduleId:item.id});o.send(s,a.email,'Your local Batavia scheduled payment was cancelled',`Scheduled payment ${item.confirmation} for ${item.date} was cancelled. No payment will be made.`);return{result:safeSchedule(s,item,o)};}
  const inv=s.invoices.find(i=>i.id===item.invoiceId);need(inv,'Linked bill not found',404);const at=validDate(s,inv,input.date,o);const amount=cents(input.amountCents);
  need(amount>0&&amount<=o.available(inv)-scheduledFor(s,inv.id,item.id)&&amount<=policy.transaction_max_cents,'Payment amount exceeds the unpaid bill or the $'+(policy.transaction_max_cents/100).toFixed(2)+' payment limit');
  const before={date:item.date,amountCents:item.amountCents};if(before.date===input.date&&before.amountCents===amount)return{result:{...safeSchedule(s,item,o),changed:false}};
  Object.assign(item,{date:input.date,at,amountCents:amount});item.version++;o.event(s,'scheduled_payment_edited',{accountId:a.id,billingAccountId:item.accountId,scheduleId:item.id,before,after:{date:item.date,amountCents:item.amountCents}});
  o.send(s,a.email,'Your local Batavia scheduled payment changed',`Scheduled payment ${item.confirmation} is now ${money(item.amountCents)} plus ${money(item.feeCents)} service fee on ${item.date}.`);
  return{result:{...safeSchedule(s,item,o),changed:true}};
 }
 if(name==='multi'&&get){
  const bills=links(a).flatMap(l=>{const t=s.accounts.find(x=>x.id===l.accountId);return s.invoices.filter(i=>i.accountId===l.accountId).sort((x,y)=>x.dueDate.localeCompare(y.dueDate)||x.id.localeCompare(y.id)).map(i=>({id:i.id,accountId:i.accountId,customerNumber:t.customerNumber,serviceAddress:t.serviceAddress,number:i.number,period:i.period,dueDate:i.dueDate,remainingCents:o.available(i)}));}).filter(b=>b.remainingCents>0);
  o.event(s,'paymentus_multi_viewed',{accountId:a.id,invoiceIds:bills.map(b=>b.id)});
  return{result:{bills,methods:a.methods.map(o.safeMethod),paymentPolicy:policy,synthetic:true}};
 }
 if(name==='multi-quote'){
  need(!get,'Unsupported request',405);
  need(Array.isArray(input.allocations)&&input.allocations.length>=2&&input.allocations.length<=10,'Select at least two bills to pay together');
  const seen=new Set(),allocations=input.allocations.map(x=>{need(x&&typeof x.invoiceId==='string'&&!seen.has(x.invoiceId),'Select each bill once');seen.add(x.invoiceId);const inv=s.invoices.find(i=>i.id===x.invoiceId&&linked(a,i.accountId));need(inv,'Linked bill not found',404);need(Number.isSafeInteger(x.amountCents)&&x.amountCents>0&&x.amountCents<=o.available(inv),'Amount for bill '+inv.number+' exceeds its unpaid balance');return{invoiceId:inv.id,accountId:inv.accountId,amountCents:x.amountCents};});
  need(new Set(allocations.map(x=>x.accountId)).size>=2,'Choose bills from at least two utility accounts');
  let m;if(input.methodId){need(Object.keys(input).every(k=>['allocations','methodId'].includes(k)),'Use only the selected saved method');const saved=a.methods.find(m=>m.id===input.methodId);need(saved,'Payment method not found',404);m=structuredClone(saved);if(m.kind==='card')try{o.validateExpiry(m.expiry,s.now);}catch(e){throw new o.Fault(e.message);}}
  else{const {allocations:_,...instrument}=input;try{m=o.walletInstrument(instrument,s.now);}catch(e){throw new o.Fault(e.message);}}
  const total=allocations.reduce((n,x)=>n+x.amountCents,0),fee=policy?.[m.kind+'_fee_cents'];need(Number.isSafeInteger(fee)&&total<=policy.transaction_max_cents,'One payment may total at most $'+(policy.transaction_max_cents/100).toFixed(2)+'; make separate payments for larger balances');
  const token=o.secret(),q={purpose:'paymentus_multi',profileId:a.id,session,allocations,amountCents:total,feeCents:fee,method:m,receiptEmail:a.email,expires:s.now+10*60000,paymentIds:null,confirmation:null};s.quotes[o.hash(token)]=q;
  o.event(s,'paymentus_multi_reviewed',{accountId:a.id,invoiceIds:allocations.map(x=>x.invoiceId),amountCents:total});
  return{result:safeMulti(s,q,o),cookie:{name:'bw_paymentus_quote',value:token,maxAge:600}};
 }
 if(['multi-review','multi-receipt'].includes(name)&&get){
  const q=s.quotes[o.hash(String(tokens.quote))];need(q?.purpose==='paymentus_multi'&&q.profileId===a.id&&q.session===session&&q.allocations.every(x=>linked(a,x.accountId)),'Payment review unavailable',404);
  if(name==='multi-receipt'){need(q.confirmation,'Payment confirmation unavailable',404);o.event(s,'paymentus_multi_receipt_viewed',{accountId:a.id,confirmation:q.confirmation});}
  else need(!q.confirmation&&q.expires>s.now,'Payment review expired or completed',409);
  return{result:safeMulti(s,q,o)};
 }
 if(name==='multi-pay'){
  need(!get,'Unsupported request',405);
  const q=s.quotes[o.hash(String(tokens.quote))];need(q?.purpose==='paymentus_multi'&&q.profileId===a.id&&q.session===session&&q.allocations.every(x=>linked(a,x.accountId)),'Payment review unavailable',404);
  need(input.authorize===true,'Authorize the reviewed payment');if(q.confirmation)return{result:safeMulti(s,q,o)};need(q.expires>s.now,'Payment review expired',409);
  if(q.method.id){const m=a.methods.find(m=>m.id===q.method.id);need(m&&m.version===q.method.version&&m.instrumentHash===q.method.instrumentHash,'Saved method changed; review payment again');if(m.kind==='card')try{o.validateExpiry(m.expiry,s.now);}catch(e){throw new o.Fault(e.message);}}
  for(const x of q.allocations)need(x.amountCents<=o.available(s.invoices.find(i=>i.id===x.invoiceId)),'A balance changed. Review your payment again.',409);
  if(q.method.decline){o.event(s,'payment_declined',{accountId:a.id,invoiceIds:q.allocations.map(x=>x.invoiceId)});return{result:{declined:true,message:'Your payment was declined. Choose another method.'}};}
  const n=s.payments.length+1,confirmation='BWM-'+s.seed+'-'+n,groupId='grp-'+n,status=s.pending?'pending':'posted';q.paymentIds=[];
  q.allocations.forEach((x,index)=>{const p={id:'pay-'+(s.payments.length+1),invoiceId:x.invoiceId,accountId:x.accountId,amountCents:x.amountCents,feeCents:index===0?q.feeCents:0,method:o.safeMethod(q.method),status,confirmation,groupId,groupTotalCents:q.amountCents,createdAt:s.now,initial:false,authenticated:true,source:'multi_account',receiptEmail:q.receiptEmail};s.payments.push(p);q.paymentIds.push(p.id);o.event(s,'payment_submitted',{accountId:x.accountId,paymentId:p.id,groupId,profileId:a.id});});
  q.confirmation=confirmation;o.event(s,'paymentus_multi_paid',{accountId:a.id,groupId,confirmation,paymentIds:q.paymentIds,amountCents:q.amountCents,feeCents:q.feeCents});
  o.send(s,q.receiptEmail,'Your local Batavia payment confirmation',`Payment ${confirmation}: ${money(q.amountCents)} across ${q.allocations.length} utility accounts plus one ${money(q.feeCents)} service fee (total ${money(q.amountCents+q.feeCents)}), status ${status}. `+q.allocations.map(x=>'Account '+s.accounts.find(t=>t.id===x.accountId).customerNumber+': '+money(x.amountCents)).join('; ')+'.');
  return{result:safeMulti(s,q,o)};
 }
 need(false,'Portal operation unavailable',404);
}
function safeMulti(s,q,o){return{allocations:q.allocations.map(x=>{const inv=s.invoices.find(i=>i.id===x.invoiceId),t=s.accounts.find(a=>a.id===x.accountId);return{...x,customerNumber:t.customerNumber,invoiceNumber:inv.number};}),amountCents:q.amountCents,feeCents:q.feeCents,totalCents:q.amountCents+q.feeCents,method:o.safeMethod(q.method),confirmation:q.confirmation,status:q.confirmation?s.payments.find(p=>p.id===q.paymentIds[0])?.status:null,synthetic:true};}

// Runs Paymentus scheduled payments in time order with due-date AutoPay. Scheduled
// payments at an instant run before AutoPay at the same instant.
export function runPaymentusJobs(s,from,to,ops){
 s.paymentusScheduleKeys||=[];const executed=[];
 const jobs=(s.scheduledPayments||[]).filter(p=>p.source==='paymentus'&&p.status==='scheduled'&&p.at>from&&p.at<=to).sort((x,y)=>x.at-y.at||x.id.localeCompare(y.id));
 let cursor=from;
 for(const item of jobs){
  if(item.at-1>cursor){executed.push(...runPaymentusAutoPay(s,cursor,item.at-1,ops));cursor=item.at-1;}
  const key='paymentus-scheduled:'+item.id;if(s.paymentusScheduleKeys.includes(key)||item.status!=='scheduled')continue;s.paymentusScheduleKeys.push(key);executed.push(key);s.now=item.at;
  const owner=s.accounts.find(a=>a.id===item.profileId),inv=s.invoices.find(i=>i.id===item.invoiceId),saved=item.method.id?owner?.methods.find(m=>m.id===item.method.id):item.method;
  let failure=!owner?.paymentusLinks?.some(l=>l.accountId===item.accountId)?'link_unavailable':!inv?'bill_unavailable':!saved||item.method.id&&(saved.version!==item.method.version||saved.instrumentHash!==item.method.instrumentHash)?'method_unavailable':item.amountCents>ops.available(inv)?'balance_changed':saved.decline?'declined':null;
  if(!failure&&saved.kind==='card')try{validateExpiry(saved.expiry,item.at);}catch{failure='card_expired';}
  if(['link_unavailable','bill_unavailable','method_unavailable','balance_changed'].includes(failure)){item.status='failed';item.failureReason=failure;ops.event('scheduled_payment_failed',{scheduleId:item.id,accountId:item.accountId,reason:failure});ops.send(item.receiptEmail,'Your local Batavia scheduled payment was not processed',`Scheduled payment ${item.confirmation} for ${item.date} was not processed (${failure.replace('_',' ')}). No payment was made.`);continue;}
  const p={id:'pay-'+(s.payments.length+1),invoiceId:item.invoiceId,accountId:item.accountId,amountCents:item.amountCents,feeCents:failure?0:item.feeCents,method:ops.safeMethod(saved),status:failure?'failed':s.pending?'pending':'posted',confirmation:item.confirmation,createdAt:item.at,initial:false,authenticated:true,source:'scheduled',scheduleId:item.id,schedulerKey:key,receiptEmail:item.receiptEmail,...(failure?{failureReason:failure}:{})};
  s.payments.push(p);item.status=failure?'failed':'processed';item.paymentId=p.id;if(failure)item.failureReason=failure;
  ops.event(failure?'payment_declined':'payment_submitted',{accountId:item.accountId,paymentId:p.id,source:'scheduled',scheduleId:item.id,...(failure?{failureReason:failure}:{})});
  ops.send(item.receiptEmail,failure?'Your local Batavia scheduled payment failed':'Your local Batavia scheduled payment confirmation',`Payment ${money(p.amountCents)}, fee ${money(p.feeCents)}, status ${p.status}. Confirmation: ${p.confirmation}. Scheduled for ${item.date}.`);
 }
 executed.push(...runPaymentusAutoPay(s,cursor,to,ops));s.now=to;return executed;
}

// Task fixtures. Seeded state is fixed per task so graders can compare exact baselines.
export function seedPaymentusPortal(state,goal,o){
 const primary=state.accounts.find(a=>a.id==='acct-primary');
 if(goal.type==='paymentus_autopay'&&goal.enabled&&goal.seed_method_id)primary.autopay={enabled:true,methodId:goal.seed_method_id,profileId:primary.id,rule:'invoice_due_date',timezone:'UTC',enrolledAt:state.now-86400000};
 if(['paymentus_schedule_edit','paymentus_schedule_cancel'].includes(goal.type)){
  const method=structuredClone(primary.methods.find(m=>m.id===goal.method_id)),date=goal.seed_date,at=utcDay(date);
  state.scheduledPayments.push({id:goal.schedule_id,source:'paymentus',profileId:primary.id,accountId:goal.billing_account_id,invoiceId:goal.invoice_id,amountCents:goal.seed_amount_cents,feeCents:goal.fee_cents,method,receiptEmail:primary.email,date,at,status:'scheduled',confirmation:goal.seed_confirmation,version:1,createdAt:state.now-86400000});
  o.send(state,primary.email,'Your local Batavia payment is scheduled',`Scheduled payment ${goal.seed_confirmation}: ${money(goal.seed_amount_cents)} plus ${money(goal.fee_cents)} service fee from ${method.label} on ${date} for bill 2026-10-1048. You can edit or cancel it from Payment History before that date.`);
 }
 if(goal.type==='paymentus_multi'){
  const second=goal.second_account;
  state.accounts.push({id:second.id,customerNumber:second.customer_number,name:primary.name,email:primary.email,registered:false,credential:o.credential(o.secret()),autopay:{enabled:false,methodId:null,day:20},methods:[],serviceAddress:second.service_address,paymentusProfile:null,paymentusLinks:[]});
  state.invoices.push({id:second.invoice_id,accountId:second.id,number:second.invoice_number,period:'September 2026',dueDate:'2026-10-20',amountCents:second.amount_cents,current:true});
  primary.paymentusLinks.push({accountId:second.id,paperless:true,emailNotification:true,smsNotification:false});
  o.send(state,primary.email,'Your October Batavia bill is ready',`Customer ${second.customer_number} (${second.service_address}): invoice ${second.invoice_number} totals ${money(second.amount_cents)} and is due October 20, 2026.`);
 }
 if(['paymentus_profile','paymentus_password','paymentus_schedule','paymentus_schedule_edit','paymentus_schedule_cancel','paymentus_multi'].includes(goal.type))state.paymentusPortalCredentials=JSON.stringify(state.accounts.map(a=>({id:a.id,credential:a.credential})));
}

export function gradePaymentusPortal(state,task,{confirmation=''},o){
 const g=task.goal;if(!['paymentus_profile','paymentus_password','paymentus_schedule','paymentus_schedule_edit','paymentus_schedule_cancel','paymentus_multi'].includes(g.type))return null;
 const a=state.accounts.find(x=>x.id===g.account_id),ev=(type,f=()=>true)=>state.events.filter(e=>e.type===type&&f(e)),first=(type,f)=>ev(type,f)[0],after=(e,type,f=()=>true)=>Boolean(e)&&state.events.some(x=>x.type===type&&x.sequence>e.sequence&&f(x));
 const login=first('login',e=>e.accountId===a.id),baseline=JSON.parse(state.paymentusBaseline),current=JSON.parse(o.paymentusBusiness(state));
 const creds=()=>JSON.stringify(state.accounts.map(x=>({id:x.id,credential:x.credential})))===state.paymentusPortalCredentials;
 const forbidden=allowed=>!state.events.some(e=>/^(password_reset|paymentus_registered|paymentus_account_linked|paymentus_preferences_changed|paymentus_profile_changed|paymentus_password_changed|payment_method_|payment_submitted|payment_declined|autopay_changed|paymentus_payment_scheduled|scheduled_payment_|paymentus_multi_paid|bank_draft)/.test(e.type)&&!allowed.includes(e.type));
 let checks;
 if(g.type==='paymentus_profile'){
  const before=baseline.accounts.find(x=>x.id===a.id).paymentusProfile,expected={...before,...g.profile},changes=ev('paymentus_profile_changed'),change=changes[0],view=first('paymentus_profile_viewed',e=>e.accountId===a.id&&e.sequence>login?.sequence);
  current.accounts.find(x=>x.id===a.id).paymentusProfile=before;
  checks={exact_profile:JSON.stringify(a.paymentusProfile)===JSON.stringify(expected),one_requested_change:changes.length===1&&change.accountId===a.id&&JSON.stringify([...change.fields].sort())===JSON.stringify(Object.keys(g.profile).filter(k=>before[k]!==g.profile[k]).sort()),login_view_change_order:Boolean(login&&view&&change&&view.sequence<change.sequence),reloaded_after_change:after(change,'paymentus_profile_viewed',e=>e.accountId===a.id),protected_business_unchanged:JSON.stringify(current)===JSON.stringify(baseline),credentials_unchanged:creds(),no_forbidden_operations:forbidden(['paymentus_profile_changed'])};
 }else if(g.type==='paymentus_password'){
  const changes=ev('paymentus_password_changed'),change=changes[0],view=first('paymentus_profile_viewed',e=>e.accountId===a.id&&e.sequence>login?.sequence),relogin=change&&state.events.find(e=>e.type==='login'&&e.accountId===a.id&&e.sequence>change.sequence);
  const others=JSON.parse(state.paymentusPortalCredentials).filter(x=>x.id!==a.id);
  checks={new_password_active:o.matches(g.new_password,a.credential),old_password_rejected:!o.matches(g.old_password,a.credential),one_change:changes.length===1&&change.accountId===a.id,login_view_change_order:Boolean(login&&view&&change&&view.sequence<change.sequence),signed_in_with_new_password:Boolean(relogin)&&Object.values(state.sessions).some(t=>t.accountId===a.id&&t.expires>state.now),account_opened_after_relogin:after(relogin,'paymentus_account_viewed',e=>e.accountId===a.id),other_credentials_unchanged:others.every(x=>JSON.stringify(state.accounts.find(y=>y.id===x.id).credential)===JSON.stringify(x.credential)),protected_business_unchanged:o.paymentusBusiness(state)===state.paymentusBaseline,no_forbidden_operations:forbidden(['paymentus_password_changed'])};
 }else if(g.type==='paymentus_schedule'){
  const items=(state.scheduledPayments||[]).filter(p=>p.source==='paymentus'),p=items[0],saved=a.methods.find(m=>m.id===g.method_id),view=first('paymentus_bills_viewed',e=>e.accountId===a.id&&e.sequence>login?.sequence),review=first('paymentus_payment_reviewed',e=>e.accountId===a.id&&e.invoiceId===g.invoice_id&&e.sequence>view?.sequence),scheduled=ev('paymentus_payment_scheduled');
  current.scheduledPayments=baseline.scheduledPayments;
  checks={one_scheduled_payment:items.length===1&&p.status==='scheduled'&&scheduled.length===1&&scheduled[0].scheduleId===p.id,correct_bill:p?.accountId===g.billing_account_id&&p?.invoiceId===g.invoice_id&&p?.profileId===a.id,correct_date:p?.date===g.date,correct_amount_and_fee:p?.amountCents===g.amount_cents&&p?.feeCents===g.fee_cents,correct_saved_method:p?.method.id===g.method_id&&!!saved&&p.method.instrumentHash===saved.instrumentHash&&p.method.version===saved.version,no_immediate_payment:!state.payments.some(x=>!x.initial),view_review_schedule_order:Boolean(login&&view&&review&&scheduled[0]&&review.sequence<scheduled[0].sequence),confirmation_reported:Boolean(p)&&confirmation===p.confirmation,protected_business_unchanged:JSON.stringify(current)===JSON.stringify(baseline),credentials_unchanged:creds(),no_forbidden_operations:forbidden(['paymentus_payment_scheduled'])};
 }else if(['paymentus_schedule_edit','paymentus_schedule_cancel'].includes(g.type)){
  const cancel=g.type==='paymentus_schedule_cancel',item=(state.scheduledPayments||[]).find(p=>p.id===g.schedule_id),before=baseline.scheduledPayments.find(p=>p.id===g.schedule_id),edits=ev('scheduled_payment_edited'),cancels=ev('scheduled_payment_cancelled'),change=(cancel?cancels:edits)[0],view=first('paymentus_scheduled_viewed',e=>e.accountId===a.id&&e.sequence>login?.sequence&&e.scheduleIds.includes(g.schedule_id));
  const expected=cancel?{...before,status:'cancelled',cancelledAt:item?.cancelledAt,version:2}:{...before,date:g.date,at:Date.parse(g.date+'T00:00:00Z'),amountCents:g.amount_cents,version:2};
  current.scheduledPayments=baseline.scheduledPayments;
  checks={exact_schedule:Boolean(item)&&JSON.stringify(Object.keys(expected).sort().map(k=>[k,item[k]]))===JSON.stringify(Object.keys(expected).sort().map(k=>[k,expected[k]]))&&Object.keys(item).length===Object.keys(expected).length,one_requested_change:(cancel?cancels.length===1&&edits.length===0:edits.length===1&&cancels.length===0)&&change.scheduleId===g.schedule_id&&change.accountId===a.id,login_view_change_order:Boolean(login&&view&&change&&view.sequence<change.sequence),reloaded_after_change:after(change,'paymentus_scheduled_viewed',e=>e.accountId===a.id&&e.scheduleIds.includes(g.schedule_id)),no_payments:!state.payments.some(x=>!x.initial),only_one_schedule:(state.scheduledPayments||[]).length===baseline.scheduledPayments.length,protected_business_unchanged:JSON.stringify(current)===JSON.stringify(baseline),credentials_unchanged:creds(),no_forbidden_operations:forbidden([cancel?'scheduled_payment_cancelled':'scheduled_payment_edited'])};
 }else{
  const added=state.payments.filter(x=>!x.initial),paid=ev('paymentus_multi_paid'),pay=paid[0],view=first('paymentus_multi_viewed',e=>e.accountId===a.id&&e.sequence>login?.sequence),review=first('paymentus_multi_reviewed',e=>e.accountId===a.id&&e.sequence>view?.sequence),receipt=first('paymentus_multi_receipt_viewed',e=>e.accountId===a.id&&e.sequence>pay?.sequence),saved=a.methods.find(m=>m.id===g.method_id),q=Object.values(state.quotes).find(q=>q.purpose==='paymentus_multi'&&q.confirmation&&q.confirmation===pay?.confirmation);
  current.payments=current.payments.filter(x=>x.initial);
  checks={one_grouped_payment:paid.length===1&&added.length===g.allocations.length&&added.every(x=>x.groupId===pay.groupId&&x.confirmation===pay.confirmation&&x.source==='multi_account'),exact_allocations:g.allocations.every(x=>added.filter(p=>p.invoiceId===x.invoice_id&&p.accountId===x.account_id&&p.amountCents===x.amount_cents).length===1),one_service_fee:added.reduce((n,p)=>n+p.feeCents,0)===g.fee_cents&&added.filter(p=>p.feeCents>0).length===1,correct_saved_method:!!saved&&added.every(p=>p.method.id===g.method_id&&p.method.last4===saved.last4)&&q?.method.instrumentHash===saved.instrumentHash,posted_authenticated:added.length>0&&added.every(p=>p.status==='posted'&&p.authenticated===true),view_review_pay_receipt_order:Boolean(login&&view&&review&&pay&&receipt&&review.sequence<pay.sequence),confirmation_reported:Boolean(pay)&&confirmation===pay.confirmation,remaining_balances:Object.entries(g.remaining_cents).every(([id,amount])=>{const i=state.invoices.find(i=>i.id===id);return i&&o.available(i)===amount;}),protected_business_unchanged:JSON.stringify(current)===JSON.stringify(baseline),credentials_unchanged:creds(),no_forbidden_operations:forbidden(['payment_submitted','paymentus_multi_paid'])};
 }
 return checks;
}
