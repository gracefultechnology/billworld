// Synthetic Starnik future-dated payments (create, review, edit, cancel, execute).
// Enabled only for tenants that declare construction_schedule_policy. No source
// portal scheduling screen was observed; limits and execution timing are local rules.
import {utcDay} from './scheduler.mjs';
import {validateExpiry} from './wallet.mjs';

const DAY=86400000;
const money=n=>'$'+(n/100).toFixed(2);
const today=now=>new Date(now).toISOString().slice(0,10);

export function starnikSchedulePolicy(site){
 const p=site?.construction_schedule_policy;
 if(!p||p.synthetic!==true)return null;
 for(const k of ['min_days_ahead','max_days_ahead','max_active_per_account'])if(!Number.isSafeInteger(p[k])||p[k]<0||p[k]>366)throw Error('Tenant schedule policy invalid');
 if(p.min_days_ahead>p.max_days_ahead||p.max_active_per_account<1)throw Error('Tenant schedule policy invalid');
 return {min_days_ahead:p.min_days_ahead,max_days_ahead:p.max_days_ahead,max_active_per_account:p.max_active_per_account};
}

function window(now,policy){
 const base=utcDay(today(now));
 return {minDate:today(base+policy.min_days_ahead*DAY),maxDate:today(base+policy.max_days_ahead*DAY)};
}

const project=(item,h)=>({id:item.id,status:item.status,date:item.date,amountCents:item.amountCents,feeCents:item.feeCents,totalCents:item.amountCents+item.feeCents,method:h.safeMethod(item.method),version:item.version,confirmation:item.confirmation,...(item.paymentConfirmation?{paymentConfirmation:item.paymentConfirmation}:{}),...(item.failureReason?{failureReason:item.failureReason}:{})});

function balance(s,a,h){return s.invoices.filter(i=>i.accountId===a.id).reduce((n,i)=>n+h.available(i),0);}
function activeFor(s,a){return s.scheduledPayments.filter(p=>p.accountId===a.id&&p.status==='scheduled');}

function validate(s,a,h,policy,{methodId,amountCents,date},editing){
 const method=a.methods.find(m=>m.id===methodId);h.need(method,'Choose a saved payment method');
 if(method.kind==='card')try{validateExpiry(method.expiry,s.now);}catch(e){h.need(false,e.message);}
 h.need(typeof date==='string'&&Number.isFinite(utcDay(date)),'Enter the payment date as YYYY-MM-DD');
 const {minDate,maxDate}=window(s.now,policy);h.need(date>=minDate&&date<=maxDate,'Choose a payment date from '+minDate+' through '+maxDate);
 const others=activeFor(s,a).filter(p=>p.id!==editing?.id).reduce((n,p)=>n+p.amountCents,0),limit=balance(s,a,h)-others;
 h.need(Number.isSafeInteger(amountCents)&&amountCents>0&&amountCents<=limit,'Enter a positive amount no greater than '+money(Math.max(limit,0))+' (balance not already scheduled)');
 if(!editing)h.need(activeFor(s,a).length<policy.max_active_per_account,'You already have the maximum number of scheduled payments');
 return method;
}

export const starnikScheduleOps={
 list(s,{session},h){
  const policy=h.policy;h.need(policy,'Scheduled payments are unavailable for this portal',404);const a=h.authorized(session);
  h.event('starnik_schedule_viewed',{accountId:a.id});
  const items=s.scheduledPayments.filter(p=>p.accountId===a.id).sort((x,y)=>(x.status==='scheduled'?0:1)-(y.status==='scheduled'?0:1)||x.date.localeCompare(y.date)||x.id.localeCompare(y.id));
  const scheduledTotal=activeFor(s,a).reduce((n,p)=>n+p.amountCents,0),bal=balance(s,a,h);
  return {account:{name:a.name,customerNumber:a.customerNumber},balanceCents:bal,scheduledCents:scheduledTotal,availableToScheduleCents:Math.max(bal-scheduledTotal,0),methods:a.methods.map(h.safeMethod),scheduled:items.map(p=>project(p,h)),autopayEnabled:a.autopay?.enabled===true,feeDisclosure:h.feeDisclosure,...window(s.now,policy),maxActive:policy.max_active_per_account,synthetic:true};
 },
 prepare(s,{session,input},h){
  const policy=h.policy;h.need(policy,'Scheduled payments are unavailable for this portal',404);const a=h.authorized(session);
  let editing=null;
  if(input.scheduleId!==undefined&&input.scheduleId!==null&&input.scheduleId!==''){editing=s.scheduledPayments.find(p=>p.id===input.scheduleId&&p.accountId===a.id);h.need(editing&&editing.status==='scheduled','Scheduled payment unavailable',404);h.need(Number.isSafeInteger(input.version)&&input.version===editing.version,'Scheduled payment changed; reload before editing',409);}
  const method=validate(s,a,h,policy,input,editing);
  const token=h.secret(),q={purpose:'starnik_schedule',accountId:a.id,session,scheduleId:editing?.id||null,expectedVersion:editing?.version||null,method:structuredClone(method),amountCents:input.amountCents,date:input.date,feeCents:h.fee(method.kind,input.amountCents),autopayEnabled:a.autopay?.enabled===true,expires:s.now+600000,reviewed:false,applied:null};
  s.quotes[h.hash(token)]=q;h.event('starnik_schedule_prepared',{accountId:a.id,quoteId:h.hash(token),methodId:method.id,scheduleId:q.scheduleId});return{token};
 },
 review(s,{session,token},h){
  h.need(h.policy,'Scheduled payments are unavailable for this portal',404);const a=h.authorized(session),q=s.quotes[h.hash(String(token))];
  h.need(q?.purpose==='starnik_schedule'&&q.accountId===a.id&&q.session===session,'Scheduled payment review unavailable',404);
  if(q.applied){const item=s.scheduledPayments.find(p=>p.id===q.applied);return{applied:true,item:item?project(item,h):null,synthetic:true};}
  h.need(q.expires>s.now,'Scheduled payment review expired; start again',409);
  h.need(a.methods.some(m=>m.id===q.method.id&&JSON.stringify(m)===JSON.stringify(q.method)),'Payment method changed; start again',409);
  q.reviewed=true;h.event('starnik_schedule_reviewed',{accountId:a.id,quoteId:h.hash(String(token))});
  const previous=q.scheduleId?s.scheduledPayments.find(p=>p.id===q.scheduleId):null;
  return{applied:false,editing:!!q.scheduleId,previous:previous?project(previous,h):null,method:h.safeMethod(q.method),date:q.date,amountCents:q.amountCents,feeCents:q.feeCents,totalCents:q.amountCents+q.feeCents,autopayEnabled:q.autopayEnabled,feeDisclosure:h.feeDisclosure,synthetic:true};
 },
 confirm(s,{session,token,input},h){
  const policy=h.policy;h.need(policy,'Scheduled payments are unavailable for this portal',404);const a=h.authorized(session),key=h.hash(String(token)),q=s.quotes[key];
  h.need(q?.purpose==='starnik_schedule'&&q.accountId===a.id&&q.session===session,'Scheduled payment review unavailable',404);
  h.need(input?.authorize===true,'Authorize the scheduled payment');
  if(q.applied)return{scheduleId:q.applied,idempotent:true};
  h.need(q.reviewed&&q.expires>s.now,'Review the scheduled payment again');
  h.need(q.autopayEnabled===(a.autopay?.enabled===true),'AutoPay settings changed; start again',409);
  h.need(!q.autopayEnabled||input.acknowledgeAutoPay===true,'Acknowledge that AutoPay may also pay this balance');
  h.need(a.methods.some(m=>m.id===q.method.id&&JSON.stringify(m)===JSON.stringify(q.method)),'Payment method changed; start again',409);
  h.need(h.fee(q.method.kind,q.amountCents)===q.feeCents,'Payment fee changed; start again',409);
  let item=null;
  if(q.scheduleId){item=s.scheduledPayments.find(p=>p.id===q.scheduleId&&p.accountId===a.id);h.need(item&&item.status==='scheduled'&&item.version===q.expectedVersion,'Scheduled payment changed; start again',409);}
  validate(s,a,h,policy,{methodId:q.method.id,amountCents:q.amountCents,date:q.date},item);
  if(item){Object.assign(item,{date:q.date,at:utcDay(q.date),amountCents:q.amountCents,feeCents:q.feeCents,method:structuredClone(q.method),version:item.version+1,updatedAt:s.now,quoteId:key});}
  else{item={id:'starnik-sched-'+h.secret().slice(0,10),accountId:a.id,status:'scheduled',date:q.date,at:utcDay(q.date),amountCents:q.amountCents,feeCents:q.feeCents,method:structuredClone(q.method),version:1,createdAt:s.now,updatedAt:s.now,confirmation:h.brand.paymentPrefix+'-S'+h.secret().slice(0,8).toUpperCase(),quoteId:key,source:'starnik_schedule'};s.scheduledPayments.push(item);}
  q.applied=item.id;h.event(q.scheduleId?'starnik_schedule_updated':'starnik_schedule_created',{accountId:a.id,scheduleId:item.id,quoteId:key,version:item.version});
  h.send(a.email,'Your local '+h.brand.mailName+' scheduled payment '+(q.scheduleId?'was changed':'is confirmed'),'Scheduled '+money(item.amountCents)+' plus fee '+money(item.feeCents)+' on '+item.date+' from '+item.method.label+'. Reference: '+item.confirmation+'. This scheduled payment is simulated.');
  return{scheduleId:item.id,idempotent:false};
 },
 cancel(s,{session,input},h){
  h.need(h.policy,'Scheduled payments are unavailable for this portal',404);const a=h.authorized(session);
  const item=s.scheduledPayments.find(p=>p.id===input?.scheduleId&&p.accountId===a.id);h.need(item,'Scheduled payment unavailable',404);
  h.need(input.confirmed===true,'Confirm cancelling this scheduled payment');
  if(item.status==='cancelled')return{cancelled:true,idempotent:true};
  h.need(item.status==='scheduled','Only scheduled payments can be cancelled',409);
  h.need(Number.isSafeInteger(input.version)&&input.version===item.version,'Scheduled payment changed; reload before cancelling',409);
  item.status='cancelled';item.version++;item.cancelledAt=s.now;h.event('starnik_schedule_cancelled',{accountId:a.id,scheduleId:item.id,version:item.version});
  h.send(a.email,'Your local '+h.brand.mailName+' scheduled payment was cancelled','The '+money(item.amountCents)+' payment scheduled for '+item.date+' was cancelled. Reference: '+item.confirmation+'. This cancellation is simulated.');
  return{cancelled:true,idempotent:false};
 }
};

// Executes due scheduled payments at 00:00 UTC on their date. Restores s.now afterwards
// so the tenant AutoPay runner can process the same interval in order.
export function runStarnikScheduled(s,from,to,h){
 const due=(s.scheduledPayments||[]).filter(p=>p.source==='starnik_schedule'&&p.status==='scheduled'&&p.at>from&&p.at<=to).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
 const executed=[],start=s.now;
 for(const item of due){
  s.now=item.at;const a=s.accounts.find(x=>x.id===item.accountId),method=a?.methods.find(m=>m.id===item.method.id);
  const invoices=s.invoices.filter(i=>i.accountId===item.accountId).sort((x,y)=>x.dueDate.localeCompare(y.dueDate)||x.id.localeCompare(y.id));
  const outstanding=invoices.reduce((n,i)=>n+h.available(i),0),amount=Math.min(item.amountCents,outstanding);
  let failure=!method||method.instrumentHash!==item.method.instrumentHash?'method_unavailable':method.decline?'declined':amount<=0?'no_balance':null;
  if(!failure&&method.kind==='card')try{validateExpiry(method.expiry,item.at);}catch{failure='card_expired';}
  if(failure){item.status='failed';item.failureReason=failure;h.event('starnik_schedule_failed',{accountId:item.accountId,scheduleId:item.id,failureReason:failure});h.send(a.email,'Your local '+h.brand.mailName+' scheduled payment failed','The payment scheduled for '+item.date+' was not made ('+failure.replaceAll('_',' ')+'). This attempt is simulated.');executed.push('starnik-schedule:'+item.id);continue;}
  const fee=h.fee(method.kind,amount),confirmation=h.brand.paymentPrefix+'-'+h.secret().slice(0,10).toUpperCase();let remaining=amount,first=true;
  for(const invoice of invoices){const part=Math.min(remaining,h.available(invoice));if(part<=0)continue;s.payments.push({id:'pay-'+h.secret(),accountId:item.accountId,invoiceId:invoice.id,amountCents:part,feeCents:first?fee:0,method:h.safeMethod(method),status:s.pending?'pending':'posted',confirmation,createdAt:item.at,authenticated:true,source:'scheduled_payment',scheduleId:item.id});first=false;remaining-=part;}
  item.status='paid';item.paidAmountCents=amount;item.paidFeeCents=fee;item.paymentConfirmation=confirmation;
  h.event('starnik_schedule_executed',{accountId:item.accountId,scheduleId:item.id,confirmation,amountCents:amount,feeCents:fee});
  h.send(a.email,'Your local '+h.brand.mailName+' payment receipt','Payment $'+(amount/100).toFixed(2)+'; fee $'+(fee/100).toFixed(2)+'. Confirmation: '+confirmation+'. Scheduled payment '+item.confirmation+' ran on '+item.date+'. This is a simulated payment.');
  executed.push('starnik-schedule:'+item.id);
 }
 s.now=start;return executed;
}
