import {utcDay} from './scheduler.mjs';
const day=86400000;
export function dentalMonth(date,months){const d=new Date(utcDay(date)),first=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+months,1));const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();first.setUTCDate(Math.min(d.getUTCDate(),last));return first.toISOString().slice(0,10);}
// Limits from the public Western Dental configuration. Offer selection, equal
// installment rounding, same-day cutoff and execution remain synthetic.
export function dentalPlanSchedule(input,lines,now){
 const balance=lines.reduce((n,l)=>n+l.balanceCents,0),today=new Date(now).toISOString().slice(0,10),at=utcDay(input.firstDate);
 if(!['recurring','future'].includes(input.type))throw Error('Choose recurring or future payment');
 const delay=input.type==='future'?4:7;
 if(!Number.isFinite(at)||at<utcDay(today)||at>utcDay(today)+delay*day)throw Error(`Choose a first payment date within ${delay} days`);
 let total=input.amountCents,initial=input.initialCents??0,cycles=input.cycles;
 if(!Number.isSafeInteger(total)||total<100||total>balance||total>200000000)throw Error('Plan amount must be within the unpaid selected balance and payment limits');
 if(input.type==='future'){
  if(initial!==0)throw Error('Future payment has no initial installment');
  return {totalCents:total,initialCents:0,recurrence:null,installments:[{date:input.firstDate,at:Math.max(at,now),amountCents:total,status:'scheduled'}]};
 }
 if(total<10000||total>99999999)throw Error('Recurring plans require $100.00–$999,999.99');
 if(!Number.isSafeInteger(initial)||initial<0||initial>=total)throw Error('Initial amount must be nonnegative and below the plan total');
 if(!['Monthly','BiWeekly','Weekly'].includes(input.recurrence)||!Number.isInteger(cycles)||cycles<1||cycles>2000)throw Error('Choose a supported recurrence and installment count');
 const remaining=total-initial,base=Math.floor(remaining/cycles),extra=remaining%cycles;
 if(base<10000)throw Error('Each scheduled installment must be at least $100.00');
 const horizon=utcDay(dentalMonth(today,36));
 const installments=Array.from({length:cycles},(_,i)=>{
  const date=input.recurrence==='Monthly'?dentalMonth(input.firstDate,i):new Date(at+i*(input.recurrence==='Weekly'?7:14)*day).toISOString().slice(0,10);
  if(utcDay(date)>horizon)throw Error('Plan must end within 36 months');
  return {date,at:Math.max(utcDay(date),now),amountCents:base+(i<extra?1:0),status:'scheduled'};
 });
 return {totalCents:total,initialCents:initial,recurrence:input.recurrence,installments};
}
export function runDentalPlans(s,from,to,ops){
 const jobs=(s.dentalPlans||[]).filter(p=>p.status==='active').flatMap(p=>p.installments.filter(i=>i.status==='scheduled'&&i.at>=from&&i.at<=to).map(i=>({p,i})));
 jobs.sort((a,b)=>a.i.at-b.i.at||a.p.id.localeCompare(b.p.id));const executed=[];
 for(const {p,i}of jobs){
  if(p.status!=='active'||i.status!=='scheduled')continue;
  s.now=i.at;const lines=p.invoiceIds.map(id=>s.invoices.find(x=>x.id===id)).filter(Boolean).map(x=>({invoiceId:x.id,balanceCents:ops.available(x)})).filter(x=>x.balanceCents>0);
  const unpaid=lines.reduce((n,x)=>n+x.balanceCents,0);
  if(!unpaid){i.status='skipped';ops.event('dental_installment_skipped',{planId:p.id,reason:'Selected charges already paid'});}
  else{
   const amount=Math.min(i.amountCents,unpaid);const result=ops.post(p,lines,amount);
   i.status=result.status==='failed'?'failed':'processed';i.paymentId=result.id;i.actualAmountCents=amount;
  }
  const key=`dental:${p.id}:${p.installments.indexOf(i)}`;executed.push(key);
  if(!p.installments.some(x=>x.status==='scheduled')){p.status=p.installments.some(x=>x.status==='failed')?'needs_attention':'completed';ops.event('dental_plan_finished',{planId:p.id,status:p.status});}
 }
 s.now=to;return executed;
}
