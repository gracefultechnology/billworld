import {utcDay} from './scheduler.mjs';
import {validateExpiry} from './wallet.mjs';
// Local construction rule: one attempt per existing invoice at its due-date midnight UTC.
// No catch-up, silent retry or synthetic generation of future utility bills.
export function runPaymentusAutoPay(s,from,to,ops){
 const jobs=s.invoices.map(invoice=>({invoice,at:utcDay(invoice.dueDate)})).filter(j=>Number.isFinite(j.at)&&j.at>from&&j.at<=to).sort((a,b)=>a.at-b.at||a.invoice.id.localeCompare(b.invoice.id));
 const executed=[];s.paymentusAutoPayKeys||=[];
 for(const{invoice,at}of jobs){
  const billing=s.accounts.find(a=>a.id===invoice.accountId),enrollment=billing?.autopay;if(!enrollment?.enabled||enrollment.rule!=='invoice_due_date'||enrollment.enrolledAt>=at)continue;
  const key='paymentus-autopay:'+invoice.id;if(s.paymentusAutoPayKeys.includes(key))continue;
  s.now=at;s.paymentusAutoPayKeys.push(key);executed.push(key);
  const owner=s.accounts.find(a=>a.id===enrollment.profileId),method=owner?.methods.find(m=>m.id===enrollment.methodId),amount=ops.available(invoice);
  if(amount<=0){ops.event('autopay_skipped',{accountId:billing.id,reason:'No unreserved balance',invoiceId:invoice.id});continue;}
  let failure=!owner?.paymentusLinks?.some(l=>l.accountId===billing.id)?'link_unavailable':!method?'method_unavailable':method.decline?'declined':null;
  if(!failure&&method.kind==='card')try{validateExpiry(method.expiry,at);}catch{failure='card_expired';}
  const policy=ops.policy,fee=policy?.[method?.kind+'_fee_cents'];
  if(!failure&&(!Number.isSafeInteger(amount)||!Number.isSafeInteger(policy?.transaction_max_cents)||amount>policy.transaction_max_cents||!Number.isSafeInteger(fee)||fee<0))failure='construction_limit';
  const p={id:'pay-'+(s.payments.length+1),accountId:billing.id,invoiceId:invoice.id,amountCents:amount,feeCents:failure?0:fee,method:method?ops.safeMethod(method):{kind:'unavailable',last4:'',label:'Unavailable method'},status:failure?'failed':s.pending?'pending':'posted',confirmation:'BWAP-'+s.seed+'-'+(s.payments.length+1),createdAt:at,initial:false,authenticated:true,source:'autopay',schedulerKey:key,receiptEmail:owner?.email||billing.email,...(failure?{failureReason:failure}:{})};
  s.payments.push(p);ops.event(failure?'payment_declined':'payment_submitted',{accountId:billing.id,paymentId:p.id,source:'autopay',...(failure?{failureReason:failure}:{})});
  ops.send(p.receiptEmail,failure?'Your local AutoPay payment failed':'Your local AutoPay payment confirmation',`Payment $${(amount/100).toFixed(2)}, fee $${(p.feeCents/100).toFixed(2)}, status ${p.status}. Confirmation: ${p.confirmation}. This is a simulated Paymentus due-date attempt.`);
 }
 s.now=to;return executed;
}
