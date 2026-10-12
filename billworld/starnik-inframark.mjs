// Inframark-owned Starnik fixtures and private graders for tasks beyond the shared GMG set.
// Only tenants declaring `construction_fixture` (currently Inframark) are affected.
import {walletInstrument} from './wallet.mjs';
import {utcDay} from './scheduler.mjs';

const BILLING={firstName:'Alex',lastName:'Morgan',address:'1 Test Street',city:'Mankato',state:'MN',zip:'56001',country:'United States'};
function standardMethods(s,{bank_id,card_id}){
 return [
  {...walletInstrument({kind:'bank',name:'Alex Morgan',routing:'021000021',accountNumber:'1234561048',confirmAccountNumber:'1234561048'},s.now),id:bank_id,bankName:'Test Bank',accountType:'Checking',billing:{...BILLING}},
  {...walletInstrument({kind:'card',name:'Alex Morgan',cardNumber:'4242424242424242',cvv:'123',expiry:'12/30'},s.now),id:card_id,brand:'Visa',billing:{...BILLING}}
 ];
}

export function seedStarnikTenant(s,site,task,h){
 const fx=site?.construction_fixture;if(!fx)return;
 for(const a of s.accounts){const f=fx.accounts?.[a.id];if(f){a.starnikPaymentId=f.payment_id;a.serviceAddress=f.service_address;}}
 const ids=fx.method_ids||{};for(const a of s.accounts){for(const m of a.methods)if(ids[m.id])m.id=ids[m.id];if(ids[a.autopay?.methodId])a.autopay.methodId=ids[a.autopay.methodId];}
 for(const p of s.payments)if(p.id==='pay-gmg-pending'){p.id='pay-'+site.id+'-pending';p.confirmation=h.brand.paymentPrefix+'-PENDING-1048';}
 const g=task.goal,a=s.accounts.find(x=>x.id===g.account_id);
 if(g.type==='starnik_tenant_autopay'){
  a.methods=standardMethods(s,g);
  if(g.initial_method_id)a.autopay={enabled:true,methodId:g.initial_method_id,rule:'days_before_due',daysBeforeDue:h.autopayDays(),enrolledAt:s.now-86400000};
 }
 if(g.type==='starnik_schedule'){
  a.methods=standardMethods(s,g);
  for(const seed of g.seed_scheduled||[]){const m=a.methods.find(x=>x.id===seed.method_id);s.scheduledPayments.push({id:seed.id,accountId:a.id,status:'scheduled',date:seed.date,at:utcDay(seed.date),amountCents:seed.amount_cents,feeCents:h.fee(m.kind,seed.amount_cents),method:structuredClone(m),version:1,createdAt:s.now-86400000,updatedAt:s.now-86400000,confirmation:seed.confirmation,quoteId:null,source:'starnik_schedule'});}
 }
}

const allowed=(state,types)=>state.events.every(e=>['starnik_username_verified','login','starnik_account_viewed',...types].includes(e.type)||e.type.startsWith('mail'));
const first=(state,pred)=>state.events.find(pred);

export function gradeStarnikTenant(state,task,answers,h){
 const g=task.goal;
 if(g.type==='starnik_tenant_autopay'){
  const a=h.account(g.account_id),baseline=JSON.parse(state.starnikBaseline),current=JSON.parse(h.business()),old=baseline.accounts.find(x=>x.id===a.id),now=current.accounts.find(x=>x.id===a.id),days=h.autopayDays();
  const changes=state.events.filter(e=>['starnik_autopay_enabled','starnik_autopay_disabled'].includes(e.type)),change=changes[0],q=state.quotes[change?.quoteId];
  const login=first(state,e=>e.type==='login'&&e.accountId===a.id),view=first(state,e=>e.type==='starnik_autopay_viewed'&&e.accountId===a.id&&e.sequence>login?.sequence);
  const prepared=first(state,e=>e.type==='starnik_autopay_prepared'&&e.accountId===a.id&&e.quoteId===change?.quoteId&&e.methodId===g.method_id&&e.sequence>view?.sequence);
  const review=first(state,e=>e.type==='starnik_autopay_reviewed'&&e.accountId===a.id&&e.quoteId===change?.quoteId&&e.sequence>prepared?.sequence);
  const expected=g.enabled?{enabled:true,methodId:g.method_id,rule:'days_before_due',daysBeforeDue:days,enrolledAt:change?.at,quoteId:change?.quoteId}:{enabled:false,methodId:null,rule:'days_before_due',daysBeforeDue:days};
  now.autopay=old.autopay;
  return {
   exact_enrollment:JSON.stringify(a.autopay)===JSON.stringify(expected),
   initial_state_as_seeded:(old.autopay?.methodId??null)===(g.initial_method_id??null)&&(old.autopay?.enabled===true)===Boolean(g.initial_method_id),
   one_requested_change:changes.length===1&&change.accountId===a.id&&change.type===(g.enabled?'starnik_autopay_enabled':'starnik_autopay_disabled')&&(!g.enabled||change.methodId===g.method_id),
   login_view_change:!!view&&change?.sequence>view.sequence,
   reviewed_enable:!g.enabled||!!review&&change?.sequence>review.sequence&&q?.purpose==='starnik_autopay'&&q.applied===true&&q.reviewed===true&&q.accountId===a.id&&q.methodId===g.method_id&&q.methodVersion===a.methods.find(m=>m.id===g.method_id)?.version&&q.daysBeforeDue===days&&q.priorEnrollment===JSON.stringify(old.autopay),
   final_status_view:!!change&&state.events.some(e=>e.type==='starnik_autopay_viewed'&&e.accountId===a.id&&e.sequence>change.sequence),
   settings_email:!!change&&state.mail.some(m=>m.to===a.email&&m.subject==='Your local '+h.brand.mailName+' AutoPay settings changed'&&m.text.startsWith(g.enabled?'AutoPay is enabled':'AutoPay is disabled')),
   protected_state_unchanged:JSON.stringify(current)===JSON.stringify(baseline),
   no_forbidden_operations:allowed(state,['starnik_wallet_viewed','starnik_autopay_viewed',...(g.enabled?['starnik_autopay_prepared','starnik_autopay_reviewed','starnik_autopay_enabled']:['starnik_autopay_disabled'])])
  };
 }
 if(g.type==='starnik_schedule'){
  const a=h.account(g.account_id),baseline=JSON.parse(state.starnikBaseline),current=JSON.parse(h.business()),baseIds=new Set(baseline.scheduledPayments.map(p=>p.id));
  const login=first(state,e=>e.type==='login'&&e.accountId===a.id),view=first(state,e=>e.type==='starnik_schedule_viewed'&&e.accountId===a.id&&e.sequence>login?.sequence);
  const mutations=state.events.filter(e=>['starnik_schedule_created','starnik_schedule_updated','starnik_schedule_cancelled'].includes(e.type)),change=mutations[0];
  const finalView=!!change&&state.events.some(e=>e.type==='starnik_schedule_viewed'&&e.accountId===a.id&&e.sequence>change.sequence);
  const method=baseline.accounts.find(x=>x.id===a.id).methods.find(m=>m.id===g.method_id);
  const reviewedQuote=scheduleId=>{const q=state.quotes[change?.quoteId],prepared=first(state,e=>e.type==='starnik_schedule_prepared'&&e.quoteId===change?.quoteId&&e.accountId===a.id&&e.methodId===g.method_id&&e.scheduleId===scheduleId&&e.sequence>view?.sequence),review=first(state,e=>e.type==='starnik_schedule_reviewed'&&e.quoteId===change?.quoteId&&e.sequence>prepared?.sequence);
   return !!q&&!!review&&change.sequence>review.sequence&&q.purpose==='starnik_schedule'&&q.reviewed===true&&q.applied===change.scheduleId&&q.accountId===a.id&&q.amountCents===g.amount_cents&&q.feeCents===g.fee_cents&&q.date===g.date&&JSON.stringify(q.method)===JSON.stringify(method);};
  const exact=(item,version)=>!!item&&item.accountId===a.id&&item.status==='scheduled'&&item.date===g.date&&item.at===utcDay(g.date)&&item.amountCents===g.amount_cents&&item.feeCents===g.fee_cents&&JSON.stringify(item.method)===JSON.stringify(method)&&item.version===version&&item.source==='starnik_schedule';
  const others=skip=>JSON.stringify(current.scheduledPayments.filter(p=>baseIds.has(p.id)&&p.id!==skip))===JSON.stringify(baseline.scheduledPayments.filter(p=>p.id!==skip));
  const noPayments=JSON.stringify(current.payments)===JSON.stringify(baseline.payments);
  const rest=skip=>{const c=structuredClone(current),b=structuredClone(baseline);c.scheduledPayments=c.scheduledPayments.filter(p=>p.id!==skip&&baseIds.has(p.id));b.scheduledPayments=b.scheduledPayments.filter(p=>p.id!==skip);return JSON.stringify(c)===JSON.stringify(b);};
  let checks;
  if(g.mode==='create'){
   const added=current.scheduledPayments.filter(p=>!baseIds.has(p.id)),item=added[0];
   checks={exact_scheduled_payment:added.length===1&&exact(item,1)&&item.id===change?.scheduleId,one_ordered_create:mutations.length===1&&change.type==='starnik_schedule_created'&&!!view&&change.sequence>view.sequence,reviewed_quote:!!change&&reviewedQuote(null),scheduled_date_reported:answers.scheduledDate===g.date,no_immediate_payment:noPayments,existing_schedules_unchanged:others(null),confirmation_email:!!item&&state.mail.some(m=>m.to===a.email&&m.text.includes(item.confirmation)&&m.text.includes(g.date)),final_list_view:finalView,protected_state_unchanged:rest(null)};
  }else if(g.mode==='edit'){
   const item=current.scheduledPayments.find(p=>p.id===g.schedule_id),seed=baseline.scheduledPayments.find(p=>p.id===g.schedule_id);
   checks={exact_updated_payment:exact(item,2)&&!!seed&&item.confirmation===seed.confirmation&&item.createdAt===seed.createdAt,one_ordered_update:mutations.length===1&&change.type==='starnik_schedule_updated'&&change.scheduleId===g.schedule_id&&!!view&&change.sequence>view.sequence,reviewed_quote:!!change&&reviewedQuote(g.schedule_id),scheduled_date_reported:answers.scheduledDate===g.date,no_new_schedule:current.scheduledPayments.every(p=>baseIds.has(p.id)),no_immediate_payment:noPayments,other_schedules_unchanged:others(g.schedule_id),final_list_view:finalView,protected_state_unchanged:rest(g.schedule_id)};
  }else{
   const item=current.scheduledPayments.find(p=>p.id===g.schedule_id),seed=baseline.scheduledPayments.find(p=>p.id===g.schedule_id),{status:_s,version:_v,cancelledAt:_c,...kept}=item||{},{status:_bs,version:_bv,...seedKept}=seed||{};
   checks={cancelled_requested:!!item&&!!seed&&item.status==='cancelled'&&item.version===2&&JSON.stringify(kept)===JSON.stringify(seedKept),one_ordered_cancel:mutations.length===1&&change.type==='starnik_schedule_cancelled'&&change.scheduleId===g.schedule_id&&!!view&&change.sequence>view.sequence,no_new_schedule:current.scheduledPayments.every(p=>baseIds.has(p.id)),no_immediate_payment:noPayments,other_schedules_unchanged:others(g.schedule_id),final_list_view:finalView,protected_state_unchanged:rest(g.schedule_id)};
  }
  checks.no_forbidden_operations=allowed(state,['starnik_schedule_viewed','starnik_schedule_prepared','starnik_schedule_reviewed','starnik_wallet_viewed','starnik_history_viewed','starnik_payment_opened',...(g.mode==='create'?['starnik_schedule_created']:g.mode==='edit'?['starnik_schedule_updated']:['starnik_schedule_cancelled'])]);
  return checks;
 }
 return null;
}
