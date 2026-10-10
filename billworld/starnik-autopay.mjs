import {utcDay} from './scheduler.mjs';
import {validateExpiry} from './wallet.mjs';
import {starnikFee} from './starnik-payment.mjs';

// Timing comes from the tenant policy. Midnight UTC, settlement, no catch-up,
// and one attempt per existing invoice are explicit local construction rules.
export function starnikAutoPayDays(policy){
 const days=policy?.autopay_days_before_due;
 if(!Number.isSafeInteger(days)||days<0||days>365)throw Error('Tenant AutoPay timing unavailable');
 return days;
}
export function starnikAutoPayTiming(policy){
 const days=starnikAutoPayDays(policy);
 return days===0?'on the due date':days+' '+(days===1?'day':'days')+' before the due date';
}
export function runStarnikAutoPay(s,from,to,ops){
 const enabled=s.accounts.filter(a=>a.autopay?.enabled);
 if(!enabled.length){s.now=to;return [];}
 const days=starnikAutoPayDays(ops.policy);
 if(enabled.some(a=>a.autopay.rule!=='days_before_due'||a.autopay.daysBeforeDue!==days))throw Error('Tenant AutoPay timing changed; enrollment requires review');
 const jobs=s.invoices.map(invoice=>({invoice,at:utcDay(invoice.dueDate)-days*86400000})).filter(j=>Number.isFinite(j.at)&&j.at>from&&j.at<=to).sort((a,b)=>a.at-b.at||a.invoice.id.localeCompare(b.invoice.id));
 const executed=[];s.starnikAutoPayKeys||=[];
 for(const {invoice,at} of jobs){
  const owner=s.accounts.find(a=>a.id===invoice.accountId),enrollment=owner?.autopay;
  if(!enrollment?.enabled||enrollment.rule!=='days_before_due'||!Number.isFinite(enrollment.enrolledAt)||enrollment.enrolledAt>=at)continue;
  const key='starnik-autopay:'+invoice.id;if(s.starnikAutoPayKeys.includes(key))continue;
  s.now=at;s.starnikAutoPayKeys.push(key);executed.push(key);
  const amount=ops.available(invoice),method=owner.methods.find(m=>m.id===enrollment.methodId);
  if(amount<=0){ops.event('autopay_skipped',{accountId:owner.id,invoiceId:invoice.id,reason:'No unreserved balance'});continue;}
  let failure=!method?'method_unavailable':method.autopayEligible===false?'method_ineligible':method.decline?'declined':null;
  if(!failure&&method.kind==='card')try{validateExpiry(method.expiry,at);}catch{failure='card_expired';}
  const fee=method?starnikFee(method.kind,amount,ops.policy):0;
  if(!failure&&(!['bank','card'].includes(method.kind)||!Number.isSafeInteger(amount)||!Number.isSafeInteger(fee)||fee<0))failure='construction_limit';
  const payment={id:'pay-'+(s.payments.length+1),accountId:owner.id,invoiceId:invoice.id,amountCents:amount,feeCents:failure?0:fee,method:method?ops.safeMethod(method):{kind:'unavailable',last4:'',label:'Unavailable method'},status:failure?'failed':s.pending?'pending':'posted',confirmation:ops.brand.autopayPrefix+'-'+s.seed+'-'+(s.payments.length+1),createdAt:at,initial:false,authenticated:true,source:'autopay',schedulerKey:key,receiptEmail:owner.email,...(failure?{failureReason:failure}:{})};
  s.payments.push(payment);ops.event(failure?'payment_declined':'payment_submitted',{accountId:owner.id,paymentId:payment.id,source:'autopay',...(failure?{failureReason:failure}:{})});
  ops.send(owner.email,failure?'Your local '+ops.brand.mailName+' AutoPay payment failed':'Your local '+ops.brand.mailName+' AutoPay confirmation',`Payment $${(amount/100).toFixed(2)}, fee $${(payment.feeCents/100).toFixed(2)}, status ${payment.status}. Confirmation: ${payment.confirmation}. This is a simulated attempt ${starnikAutoPayTiming(ops.policy)}.`);
 }
 s.now=to;return executed;
}
