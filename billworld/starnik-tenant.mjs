// Tenant-scoped Starnik fixture overrides. Only tenants that declare
// `tenant_fixture` in their site manifest are changed; GMG/Inframark keep the
// shared fixture exactly as before.
import {starnikFee} from './starnik-payment.mjs';
import {utcDay} from './scheduler.mjs';
const money=/^\d{4}-\d{2}-\d{2}$/;
export function starnikTenantFixture(state,site,task,{walletInstrument}){
 const config=site?.tenant_fixture;if(!config)return;
 const slug=site.runtime.mail_sender_slug;
 for(const x of config.invoices||[]){
  const inv=state.invoices.find(i=>i.id===x.id);if(!inv)throw Error('Tenant invoice override has no fixture invoice');
  for(const key of ['billDate','dueDate','pastDueDate'])if(x[key]!==undefined&&!money.test(x[key]))throw Error('Invalid tenant invoice date');
  if(!Number.isSafeInteger(x.amountCents)||x.amountCents<=0||(x.lines||[]).reduce((n,l)=>n+l.amountCents,0)!==x.amountCents)throw Error('Tenant invoice lines must equal the invoice amount');
  const old=inv.amountCents;Object.assign(inv,{number:x.number,period:x.period,dueDate:x.dueDate,amountCents:x.amountCents,...(x.billDate?{billDate:x.billDate}:{}),...(x.pastDueDate?{pastDueDate:x.pastDueDate}:{}),lines:structuredClone(x.lines||[])});
  // Seeded payments that settled the old invoice keep settling it.
  for(const p of state.payments)if(p.initial&&p.invoiceId===inv.id&&p.amountCents===old)p.amountCents=inv.amountCents;
 }
 for(const a of state.accounts){
  if(config.service_addresses?.[a.id])a.serviceAddress=config.service_addresses[a.id];
  a.starnikAchDraft=null;
  // Rename shared GMG fixture identifiers so a tenant never displays another biller's IDs.
  for(const m of a.methods)if(typeof m.id==='string'&&m.id.startsWith('gmg-'))m.id=slug+m.id.slice(3);
  if(a.autopay?.methodId?.startsWith?.('gmg-'))a.autopay.methodId=slug+a.autopay.methodId.slice(3);
 }
 for(const p of state.payments)if(p.id==='pay-gmg-pending'){p.id='pay-'+slug+'-pending';p.confirmation=site.runtime.payment_confirmation_prefix+'-PENDING-1048';}
 const goal=task?.goal||{},a=state.accounts[0],days=site.documented_policy?.autopay_days_before_due;
 if(config.text_pay===false)for(const x of state.accounts)if(x.starnikTextPay!==undefined)x.starnikTextPay=false;
 if(['starnik_autopay','starnik_ach'].includes(goal.type)){
  const bank=(id,number)=>({...walletInstrument({kind:'bank',name:a.name,routing:'021000021',accountNumber:number,confirmAccountNumber:number},state.now),id,bankName:'Test Bank',accountType:'Checking'});
  if(goal.type==='starnik_ach'&&!a.methods.length)a.methods=[bank(slug+'-bank-1048','1234561048')];
  // Shared fixture convention: initial_method_id is an existing enrollment being changed.
  const prior=goal.initial_method_id||(goal.type==='starnik_autopay'&&!goal.enabled?goal.method_id:goal.autopay_method_id);
  if(prior)a.autopay={enabled:true,methodId:prior,rule:'days_before_due',daysBeforeDue:days,enrolledAt:state.now-86400000};
  else if(goal.type==='starnik_autopay')a.autopay={enabled:false,methodId:null,day:20};
  const ach=goal.prior_ach;
  if(ach)a.starnikAchDraft={active:ach.active!==false,bankName:ach.bank_name,accountType:ach.account_type,routingLast4:ach.routing.slice(-4),accountLast4:ach.account_number.slice(-4),instrumentHash:walletInstrument({kind:'bank',name:a.name,routing:ach.routing,accountNumber:ach.account_number,confirmAccountNumber:ach.account_number},state.now).instrumentHash,version:1,updatedAt:state.now-86400000};
  }
 // Future-dated payments (shared starnik-schedule.mjs) for tenants opting in without an Inframark-style construction_fixture.
 if(goal.type==='starnik_schedule'&&site.construction_schedule_policy&&!site.construction_fixture){
  const billing={firstName:'Alex',lastName:'Morgan',...(config.billing||{})};
  a.methods=[{...walletInstrument({kind:'bank',name:a.name,routing:'021000021',accountNumber:'1234561048',confirmAccountNumber:'1234561048'},state.now),id:goal.bank_id,bankName:'Test Bank',accountType:'Checking',billing:{...billing}},{...walletInstrument({kind:'card',name:a.name,cardNumber:'4242424242424242',cvv:'123',expiry:'12/30'},state.now),id:goal.card_id,brand:'Visa',billing:{...billing}}];
  for(const seed of goal.seed_scheduled||[]){const m=a.methods.find(x=>x.id===seed.method_id);state.scheduledPayments.push({id:seed.id,accountId:a.id,status:'scheduled',date:seed.date,at:utcDay(seed.date),amountCents:seed.amount_cents,feeCents:starnikFee(m.kind,seed.amount_cents,site.documented_policy),method:structuredClone(m),version:1,createdAt:state.now-86400000,updatedAt:state.now-86400000,confirmation:seed.confirmation,quoteId:null,source:'starnik_schedule'});}
 }
 for(const x of state.accounts)x.starnikAch=!!x.starnikAchDraft?.active;
}
