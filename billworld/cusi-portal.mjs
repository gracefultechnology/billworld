// Lockwood (ePayUB / Continental Utility Solutions) authenticated portal continuation.
// Evidence: Lockwood public captures (login, registration, recovery, utility policy page),
// CUSI Plaid verification guide (Card / E-Check / Scheduled Bank Draft, linked-bank statuses)
// and the Hallsdale-Powell ePayUB brochure (Make a Payment > Schedule Bank Draft > "Schedule For",
// fees displayed before confirmation, AutoPay "Maximum or Fixed Amount", CONFIRM/CANCEL,
// ADD NEW CREDIT/DEBIT CARD AUTO PAY, communication preferences, account history).
// Private Lockwood layouts, fees, execution timing and verification responses are synthetic.
import {walletInstrument,validateExpiry,instrumentHash} from './wallet.mjs';
import {utcDay} from './scheduler.mjs';

const DAY=86400000;
export const CUSI_SERVICE_ADDRESS={'acct-primary':'1048 W 6th St, Lockwood, MO 65682','acct-secondary':'2099 S Main St, Lockwood, MO 65682'};
const money=c=>'$'+(c/100).toFixed(2);
const clone=v=>JSON.parse(JSON.stringify(v));

// Business snapshot used by private graders; credentials and sessions are excluded.
export const cusiPortalBusiness=s=>JSON.stringify({accounts:s.accounts.map(({credential,...a})=>a),invoices:s.invoices,payments:s.payments,scheduledPayments:s.scheduledPayments||[]});

const bank=(id,name,routing,number,type='Checking',now)=>({...walletInstrument({kind:'bank',name,routing,accountNumber:number,confirmAccountNumber:number},now),id,label:`${type} ending ${number.slice(-4)}`,accountType:type,verification:'verified',linkEmail:'alex@billworld.test',linkedAt:now-3*DAY});
const card=(id,name,number,expiry,now)=>({...walletInstrument({kind:'card',name,cardNumber:number,cvv:'123',expiry},now),id,savedAt:now-3*DAY});

export function cusiPortalSeed(s,task){
 for(const a of s.accounts){a.serviceAddress=CUSI_SERVICE_ADDRESS[a.id];a.autopay={enabled:false,methodId:null,option:null,amountCents:null,enrolledAt:null,version:1};a.cusiPreferences={paperless:false,email:true,phoneCall:false,printed:true,version:1};}
 const g=task?.goal||{},a=s.accounts[0];
 if(g.seed_methods){a.methods=[bank('cusi-bank-1048','Alex Morgan','021000021','000001048','Checking',s.now),card('cusi-card-4242','Alex Morgan','4242424242424242','12/29',s.now)];}
 if(g.seed_autopay)a.autopay={enabled:true,methodId:'cusi-card-4242',option:'fixed',amountCents:5000,enrolledAt:s.now-2*DAY,version:2};
 if(g.seed_drafts){
  s.scheduledPayments=[
   {id:'draft-1',accountId:a.id,invoiceId:'inv-current',amountCents:8432,feeCents:0,method:safe(a.methods[0]),methodId:'cusi-bank-1048',date:'2026-10-14',at:utcDay('2026-10-14'),status:'scheduled',confirmation:`SD-${s.seed}-1`,createdAt:s.now-DAY,version:1,source:'scheduled_bank_draft'},
   {id:'draft-2',accountId:a.id,invoiceId:'inv-current',amountCents:2000,feeCents:0,method:safe(a.methods[0]),methodId:'cusi-bank-1048',date:'2026-10-12',at:utcDay('2026-10-12'),status:'scheduled',confirmation:`SD-${s.seed}-2`,createdAt:s.now-DAY,version:1,source:'scheduled_bank_draft'}];
 }
 s.cusiPortalBaseline=cusiPortalBusiness(s);
}

const safe=({id,kind,last4,label,expiry,name,accountType,verification})=>({...(id?{id}:{}),kind,last4,label,...(expiry?{expiry}:{}),...(name?{name}:{}),...(accountType?{accountType}:{}),...(verification?{verification}:{})});
function policy(ctx,s){const p=ctx.site.construction_payment_policy;ctx.need(p?.synthetic===true&&Number.isSafeInteger(p.card_fee_cents)&&Number.isSafeInteger(p.bank_fee_cents),'Payment policy unavailable',503);return p;}
function fee(ctx,s,kind){return kind==='card'?policy(ctx,s).card_fee_cents:policy(ctx,s).bank_fee_cents;}
function documented(ctx){const d=ctx.site.documented_policy;return{dueDay:d.due_day,penaltyPercent:d.late_penalty_percent,disconnectDay:d.disconnect_after_day,trashCents:d.trash_monthly_cents};}
function lines(ctx,inv){
 if(inv.penalty)return[{label:`Late penalty (${documented(ctx).penaltyPercent}% of unpaid balance)`,amountCents:inv.amountCents}];
 const trash=Math.min(documented(ctx).trashCents,inv.amountCents),rest=inv.amountCents-trash,sewer=Math.round(rest*0.12),water=Math.round(rest*0.22),electric=rest-sewer-water;
 return[{label:'Electric',amountCents:electric,usage:Math.round(electric/12)+' kWh'},{label:'Water',amountCents:water,usage:Math.round(water/0.6)*10+' gallons'},{label:'Sewer',amountCents:sewer},{label:'Trash (BSW weekly collection)',amountCents:trash}];
}
const methodView=m=>({...safe(m),feeKind:m.kind,status:m.kind==='bank'?(m.verification==='verified'?'Verified':'Pending Micro Deposit Verification'):'Active'});
function invoiceView(ctx,s,inv){return{id:inv.id,number:inv.number,period:inv.period,dueDate:inv.dueDate,amountCents:inv.amountCents,remainingCents:ctx.available(s,inv),current:Boolean(inv.current),penalty:Boolean(inv.penalty)};}
function own(s,a){return s.invoices.filter(i=>i.accountId===a.id);}
function invoice(ctx,s,a,id){const inv=s.invoices.find(i=>i.id===id&&i.accountId===a.id);ctx.need(inv,'Bill not found',404);return inv;}
function money2cents(ctx,v){ctx.need(Number.isSafeInteger(v)&&v>0&&v<=1000000,'Enter a valid payment amount');return v;}
function method(ctx,a,id,{bankVerified=false}={}){const m=a.methods.find(m=>m.id===id);ctx.need(m,'Payment method not found',404);if(m.kind==='card'){try{validateExpiry(m.expiry,ctx.now);}catch(e){ctx.need(false,e.message);}}if(bankVerified&&m.kind==='bank')ctx.need(m.verification==='verified','Verify the linked bank account before using it');return m;}
function draftDate(ctx,s,inv,date,acknowledgeLate){
 const at=utcDay(date),{dueDay,disconnectDay,penaltyPercent}=documented(ctx);
 ctx.need(Number.isFinite(at),'Choose a Schedule For date');ctx.need(at>s.now,'Schedule For must be a future date');
 const due=utcDay(inv.dueDate),disconnect=utcDay(inv.dueDate.slice(0,8)+String(disconnectDay).padStart(2,'0'));
 ctx.need(at<=disconnect,`Schedule For must be on or before ${inv.dueDate.slice(0,8)+disconnectDay}; unpaid service is discontinued after the ${disconnectDay}th`);
 if(at>due)ctx.need(acknowledgeLate===true,`This date is after the ${dueDay}th due date. Acknowledge that a ${penaltyPercent}% late penalty will be added`);
 return{at,late:at>due};
}
function drafts(s,a){return(s.scheduledPayments||[]).filter(p=>p.accountId===a.id);}
function draftView(p){return{id:p.id,invoiceId:p.invoiceId,amountCents:p.amountCents,feeCents:p.feeCents,method:p.method,date:p.date,status:p.status,confirmation:p.confirmation,version:p.version,...(p.failureReason?{failureReason:p.failureReason}:{})};}
function autopayView(a){const ap=a.autopay;return{enabled:Boolean(ap.enabled),option:ap.option,amountCents:ap.amountCents,method:ap.enabled?safe(a.methods.find(m=>m.id===ap.methodId)||{kind:'unavailable',last4:'',label:'Unavailable method'}):null,version:ap.version};}
function findQuote(ctx,s,a,session,token,purposes){const q=s.quotes[ctx.hash(String(token||''))];ctx.need(q&&purposes.includes(q.purpose)&&q.accountId===a.id&&q.session===session,'Review not found. Start again from Make a Payment or AutoPay.',404);return q;}

// Returns {result} or, for card/E-Check commits, {delegatePay:true} so the engine ledger commits.
export function cusiPortalOperation(s,ctx,session,op,input={},token){
 const {need,event,send}=ctx,a=ctx.authorized(s,session);ctx.now=s.now;
 need(a.registered,'Please sign in again',401);
 switch(op){
  case 'overview':{
   event(s,'cusi_account_viewed',{accountId:a.id});
   const invs=own(s,a).map(i=>invoiceView(ctx,s,i)),current=invs.find(i=>i.current)||invs.at(-1),posted=s.payments.filter(p=>p.accountId===a.id&&['posted','pending'].includes(p.status)).sort((x,y)=>y.createdAt-x.createdAt)[0];
   return{account:{name:a.name,username:a.username,customerNumber:a.customerNumber,serviceAddress:a.serviceAddress,email:a.cusiProfile?.email||a.email},balanceCents:invs.reduce((n,i)=>n+i.remainingCents,0),pastDueCents:invs.filter(i=>i.remainingCents>0&&utcDay(i.dueDate)<s.now).reduce((n,i)=>n+i.remainingCents,0),current,invoices:invs,lastPayment:posted?{amountCents:posted.amountCents,date:new Date(posted.createdAt).toISOString().slice(0,10)}:null,autopay:autopayView(a),scheduled:drafts(s,a).filter(p=>p.status==='scheduled').map(draftView),preferences:a.cusiPreferences,policy:documented(ctx),today:new Date(s.now).toISOString().slice(0,10)};
  }
  case 'bill':{
   const inv=invoice(ctx,s,a,input.invoiceId);event(s,'cusi_bill_viewed',{accountId:a.id,invoiceId:inv.id});
   const paid=s.payments.filter(p=>p.accountId===a.id&&p.invoiceId===inv.id).map(p=>({date:new Date(p.createdAt).toISOString().slice(0,10),amountCents:p.amountCents,status:p.status,confirmation:p.confirmation}));
   return{invoice:invoiceView(ctx,s,inv),lines:lines(ctx,inv),payments:paid,account:{name:a.name,customerNumber:a.customerNumber,serviceAddress:a.serviceAddress},policy:documented(ctx),scheduled:drafts(s,a).filter(p=>p.status==='scheduled'&&p.invoiceId===inv.id).map(draftView)};
  }
  case 'history':{
   event(s,'cusi_history_viewed',{accountId:a.id});
   return{statements:own(s,a).map(i=>({...invoiceView(ctx,s,i),usage:lines(ctx,i).filter(l=>l.usage).map(l=>l.label+': '+l.usage).join(', ')})),payments:s.payments.filter(p=>p.accountId===a.id).sort((x,y)=>y.createdAt-x.createdAt).map(p=>({id:p.id,date:new Date(p.createdAt).toISOString().slice(0,10),invoiceId:p.invoiceId,amountCents:p.amountCents,feeCents:p.feeCents,method:p.method.label||((p.method.kind==='bank'?'Checking':'Card')+' ending '+p.method.last4),status:p.status,confirmation:p.confirmation,source:p.source||(p.initial?'history':'one_time'),...(p.failureReason?{failureReason:p.failureReason}:{})})),scheduled:drafts(s,a).map(draftView)};
  }
  case 'wallet':event(s,'cusi_wallet_viewed',{accountId:a.id});return{methods:a.methods.map(methodView),autopayMethodId:a.autopay.enabled?a.autopay.methodId:null,policy:{cardFeeCents:fee(ctx,s,'card'),bankFeeCents:fee(ctx,s,'bank')}};
  case 'wallet/card':{
   let m;try{m=walletInstrument({...input,kind:'card'},s.now);}catch(e){need(false,e.message);}
   need(!a.methods.some(x=>x.instrumentHash===m.instrumentHash),'This card is already saved');m.id='cusi-card-'+ctx.secret().slice(0,10);m.savedAt=s.now;a.methods.push(m);event(s,'cusi_card_saved',{accountId:a.id,methodId:m.id});return{method:methodView(m)};
  }
  case 'wallet/bank':{
   need(['Checking','Savings'].includes(input.accountType),'Choose Checking or Savings');need(typeof input.email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()),'Enter the email address for linked-account communication');need(input.consent===true,'Authorize bank account verification');
   let m;try{m=walletInstrument({...input,kind:'bank'},s.now);}catch(e){need(false,e.message);}
   need(!a.methods.some(x=>x.instrumentHash===m.instrumentHash),'This bank account is already linked');
   Object.assign(m,{id:'cusi-bank-'+ctx.secret().slice(0,10),label:`${input.accountType} ending ${m.last4}`,accountType:input.accountType,verification:'verified',linkEmail:input.email.trim().toLowerCase(),linkedAt:s.now});
   a.methods.push(m);event(s,'cusi_bank_linked',{accountId:a.id,methodId:m.id});send(s,input.email.trim().toLowerCase(),'Your bank account was linked to the local Lockwood portal',`${m.label} is verified for E-Check and Scheduled Bank Draft payments. This local verification is simulated; no bank was contacted.`);return{method:methodView(m)};
  }
  case 'wallet/remove':{
   const m=a.methods.find(m=>m.id===input.methodId);need(m,'Payment method not found',404);
   need(!(a.autopay.enabled&&a.autopay.methodId===m.id),'Cancel or change AutoPay before removing this payment method');
   need(!drafts(s,a).some(p=>p.status==='scheduled'&&p.methodId===m.id),'Cancel scheduled bank drafts that use this account first');
   for(const q of Object.values(s.quotes))if(q.methodId===m.id&&!q.paymentId&&!q.applied)q.expires=s.now;
   a.methods=a.methods.filter(x=>x.id!==m.id);event(s,'cusi_method_removed',{accountId:a.id,methodId:m.id});return{ok:true};
  }
  case 'payment/options':{
   const inv=invoice(ctx,s,a,input.invoiceId);
   return{invoice:invoiceView(ctx,s,inv),methods:a.methods.map(methodView),fees:{cardFeeCents:fee(ctx,s,'card'),bankFeeCents:fee(ctx,s,'bank')},policy:documented(ctx),today:new Date(s.now).toISOString().slice(0,10),scheduled:drafts(s,a).filter(p=>p.status==='scheduled'&&p.invoiceId===inv.id).map(draftView)};
  }
  case 'payment/quote':{
   const inv=invoice(ctx,s,a,input.invoiceId),amount=money2cents(ctx,input.amountCents);need(['card','echeck','draft'].includes(input.option),'Choose Credit/Debit Card, E-Check or Scheduled Bank Draft');
   let m,methodId=null;
   if(input.option==='card'&&!input.methodId){try{m=walletInstrument({...input,kind:'card'},s.now);}catch(e){need(false,e.message);}}
   else{need(typeof input.methodId==='string','Choose a saved payment method');m=method(ctx,a,input.methodId,{bankVerified:true});methodId=m.id;need(m.kind===(input.option==='card'?'card':'bank'),input.option==='card'?'Choose a saved card':'Choose a linked bank account');}
   const base={accountId:a.id,invoiceId:inv.id,session,guest:false,amountCents:amount,feeCents:fee(ctx,s,m.kind),method:clone(m),methodId,methodVersion:m.version||1,option:input.option,expires:s.now+10*60000,paymentId:null,reviewed:false},t=ctx.secret();
   if(input.option==='draft'){need(amount<=ctx.available(s,inv),'Payment amount exceeds the unpaid bill');const d=draftDate(ctx,s,inv,input.date,input.acknowledgeLate);s.quotes[ctx.hash(t)]={...base,purpose:'cusi_draft',date:input.date,at:d.at,late:d.late,scheduleId:null};}
   else{need(amount<=ctx.available(s,inv),'Payment amount exceeds the unpaid bill or is invalid');s.quotes[ctx.hash(t)]={...base,purpose:'cusi'};}
   event(s,input.option==='draft'?'cusi_draft_prepared':'cusi_payment_prepared',{accountId:a.id,invoiceId:inv.id});
   return{token:t};
  }
  case 'payment/review':{
   const q=findQuote(ctx,s,a,session,token,['cusi','cusi_draft']);need(!q.paymentId&&!q.scheduleId&&q.expires>s.now,'Payment review expired or completed',409);
   q.reviewed=true;event(s,q.purpose==='cusi'?'cusi_payment_reviewed':'cusi_draft_reviewed',{accountId:a.id,invoiceId:q.invoiceId});
   return{option:q.option,invoiceId:q.invoiceId,invoice:invoiceView(ctx,s,invoice(ctx,s,a,q.invoiceId)),amountCents:q.amountCents,feeCents:q.feeCents,totalCents:q.amountCents+q.feeCents,method:safe(q.method),...(q.date?{date:q.date,late:q.late}:{})};
  }
  case 'payment/confirm':{
   const q=findQuote(ctx,s,a,session,token,['cusi','cusi_draft']);need(input.authorize===true,'Authorize the reviewed payment');
   if(q.purpose==='cusi'){if(!q.paymentId){need(q.reviewed,'Review the payment first');if(q.methodId){const m=a.methods.find(m=>m.id===q.methodId);need(m&&(m.version||1)===q.methodVersion&&m.instrumentHash===q.method.instrumentHash,'Payment method changed; review the payment again');}}return{delegatePay:true};}
   if(q.scheduleId)return{result:{kind:'draft',draft:draftView(drafts(s,a).find(p=>p.id===q.scheduleId))}};
   need(q.reviewed&&q.expires>s.now,'Payment review expired; review again',409);const m=a.methods.find(m=>m.id===q.methodId);need(m&&(m.version||1)===q.methodVersion&&m.verification==='verified','Bank account changed; review again');
   s.scheduledPayments||=[];const n=s.scheduledPayments.length+1,item={id:'draft-'+n,accountId:a.id,invoiceId:q.invoiceId,amountCents:q.amountCents,feeCents:q.feeCents,method:safe(m),methodId:m.id,date:q.date,at:q.at,status:'scheduled',confirmation:`SD-${s.seed}-${n}`,createdAt:s.now,version:1,source:'scheduled_bank_draft'};
   s.scheduledPayments.push(item);q.scheduleId=item.id;event(s,'cusi_draft_scheduled',{accountId:a.id,scheduleId:item.id,invoiceId:item.invoiceId});
   send(s,a.cusiProfile?.email||a.email,'Your Lockwood scheduled bank draft confirmation',`Scheduled bank draft ${item.confirmation}: ${money(item.amountCents)} from ${item.method.label} on ${item.date}, fee ${money(item.feeCents)}. Manage it from Account History.`);
   return{result:{kind:'draft',draft:draftView(item)}};
  }
  case 'payment/receipt':{
   const q=findQuote(ctx,s,a,session,token,['cusi','cusi_draft']);
   if(q.purpose==='cusi'){need(q.paymentId,'Payment confirmation not found',404);const p=s.payments.find(p=>p.id===q.paymentId);event(s,'cusi_receipt_viewed',{accountId:a.id,paymentId:p.id});return{kind:'payment',payment:{...p,method:safe(p.method)}};}
   need(q.scheduleId,'Scheduled payment confirmation not found',404);const item=drafts(s,a).find(p=>p.id===q.scheduleId);event(s,'cusi_receipt_viewed',{accountId:a.id,scheduleId:item.id});return{kind:'draft',draft:draftView(item)};
  }
  case 'scheduled':{const item=drafts(s,a).find(p=>p.id===input.scheduleId);need(item,'Scheduled payment not found',404);event(s,'cusi_draft_viewed',{accountId:a.id,scheduleId:item.id});return{draft:draftView(item),invoice:invoiceView(ctx,s,invoice(ctx,s,a,item.invoiceId)),methods:a.methods.filter(m=>m.kind==='bank').map(methodView),policy:documented(ctx),today:new Date(s.now).toISOString().slice(0,10)};}
  case 'scheduled/update':{
   const item=drafts(s,a).find(p=>p.id===input.scheduleId);need(item&&item.status==='scheduled','Active scheduled payment not found',404);need(input.version===item.version,'This scheduled payment changed; reload it',409);
   const inv=invoice(ctx,s,a,item.invoiceId),amount=money2cents(ctx,input.amountCents);need(amount<=ctx.available(s,inv),'Payment amount exceeds the unpaid bill');const d=draftDate(ctx,s,inv,input.date,input.acknowledgeLate);
   const m=input.methodId===undefined?a.methods.find(m=>m.id===item.methodId):method(ctx,a,input.methodId,{bankVerified:true});need(m&&m.kind==='bank','Choose a linked bank account');
   need(item.date!==input.date||item.amountCents!==amount||item.methodId!==m.id,'Change the date, amount or bank account');
   Object.assign(item,{date:input.date,at:d.at,amountCents:amount,method:safe(m),methodId:m.id,version:item.version+1,updatedAt:s.now});event(s,'cusi_draft_updated',{accountId:a.id,scheduleId:item.id,date:item.date,amountCents:amount,methodId:m.id});
   send(s,a.cusiProfile?.email||a.email,'Your Lockwood scheduled bank draft was changed',`Scheduled bank draft ${item.confirmation} is now ${money(amount)} from ${item.method.label} on ${item.date}.`);return{draft:draftView(item)};
  }
  case 'scheduled/cancel':{
   const item=drafts(s,a).find(p=>p.id===input.scheduleId);need(item&&item.status==='scheduled','Active scheduled payment not found',404);need(input.confirm===true,'Confirm the cancellation');
   item.status='cancelled';item.cancelledAt=s.now;item.version++;event(s,'cusi_draft_cancelled',{accountId:a.id,scheduleId:item.id});send(s,a.cusiProfile?.email||a.email,'Your Lockwood scheduled bank draft was cancelled',`Scheduled bank draft ${item.confirmation} for ${money(item.amountCents)} on ${item.date} was cancelled. No payment will be made.`);return{draft:draftView(item)};
  }
  case 'autopay':event(s,'cusi_autopay_viewed',{accountId:a.id});return{autopay:autopayView(a),methods:a.methods.map(methodView),fees:{cardFeeCents:fee(ctx,s,'card'),bankFeeCents:fee(ctx,s,'bank')},policy:documented(ctx),scheduled:drafts(s,a).filter(p=>p.status==='scheduled').map(draftView)};
  case 'autopay/quote':{
   need(['maximum','fixed'].includes(input.option),'Choose a Payment Option: Maximum Amount or Fixed Amount');const amount=money2cents(ctx,input.amountCents);
   let m,newCard=null;
   if(input.methodId){m=method(ctx,a,input.methodId,{bankVerified:true});}
   else{try{newCard=walletInstrument({...input,kind:'card'},s.now);}catch(e){need(false,e.message);}need(!a.methods.some(x=>x.instrumentHash===newCard.instrumentHash),'This card is already saved; select it from your payment methods');m=newCard;}
   const t=ctx.secret();s.quotes[ctx.hash(t)]={purpose:'cusi_autopay',accountId:a.id,session,option:input.option,amountCents:amount,method:clone(m),methodId:newCard?null:m.id,methodVersion:m.version||1,newCard:newCard?clone(newCard):null,feeCents:fee(ctx,s,m.kind),expires:s.now+10*60000,reviewed:false,applied:false,autopayVersion:a.autopay.version};
   event(s,'cusi_autopay_prepared',{accountId:a.id});return{token:t};
  }
  case 'autopay/review':{
   const q=findQuote(ctx,s,a,session,token,['cusi_autopay']);need(!q.applied&&q.expires>s.now,'AutoPay review expired or completed',409);q.reviewed=true;event(s,'cusi_autopay_reviewed',{accountId:a.id});
   return{option:q.option,amountCents:q.amountCents,method:safe(q.method),newCard:Boolean(q.newCard),feeCents:q.feeCents,current:autopayView(a),dueDay:documented(ctx).dueDay};
  }
  case 'autopay/confirm':{
   const q=findQuote(ctx,s,a,session,token,['cusi_autopay']);if(q.applied)return{autopay:autopayView(a),idempotent:true};
   need(input.authorize===true,'Authorize AutoPay drafts on each due date');need(q.reviewed&&q.expires>s.now,'AutoPay review expired; review again',409);need(a.autopay.version===q.autopayVersion,'AutoPay settings changed; review again',409);
   let methodId=q.methodId;
   if(q.newCard){need(!a.methods.some(x=>x.instrumentHash===q.newCard.instrumentHash),'This card is already saved');const m={...q.newCard,id:'cusi-card-'+ctx.secret().slice(0,10),savedAt:s.now};a.methods.push(m);methodId=m.id;event(s,'cusi_card_saved',{accountId:a.id,methodId:m.id,via:'autopay'});}
   else{const m=a.methods.find(m=>m.id===methodId);need(m&&(m.version||1)===q.methodVersion,'Payment method changed; review again');}
   a.autopay={enabled:true,methodId,option:q.option,amountCents:q.amountCents,enrolledAt:s.now,version:a.autopay.version+1};q.applied=true;
   event(s,'autopay_changed',{accountId:a.id,enabled:true,methodId,option:q.option,amountCents:q.amountCents});
   const m=a.methods.find(m=>m.id===methodId);send(s,a.cusiProfile?.email||a.email,'Your Lockwood AutoPay enrollment',`AutoPay is set up: ${q.option==='maximum'?'pay each bill up to a maximum of '+money(q.amountCents):'pay a fixed '+money(q.amountCents)} from ${m.label} on the ${documented(ctx).dueDay}th.`);
   return{autopay:autopayView(a),idempotent:false};
  }
  case 'autopay/cancel':{
   need(a.autopay.enabled,'AutoPay is not active');need(input.confirm===true,'Confirm AutoPay cancellation');need(input.version===a.autopay.version,'AutoPay settings changed; reload',409);
   a.autopay={enabled:false,methodId:null,option:null,amountCents:null,enrolledAt:null,version:a.autopay.version+1};for(const q of Object.values(s.quotes))if(q.purpose==='cusi_autopay'&&q.accountId===a.id&&!q.applied)q.expires=s.now;
   event(s,'autopay_changed',{accountId:a.id,enabled:false,methodId:null});send(s,a.cusiProfile?.email||a.email,'Your Lockwood AutoPay was cancelled','AutoPay is cancelled. Future bills will not be paid automatically; existing scheduled bank drafts are unchanged.');return{autopay:autopayView(a)};
  }
  case 'preferences':event(s,'cusi_preferences_viewed',{accountId:a.id});return{preferences:a.cusiPreferences,email:a.cusiProfile?.email||a.email,phone:a.cusiPhone};
  case 'preferences/save':{
   const p=a.cusiPreferences;need(input.version===p.version,'Preferences changed; reload',409);
   for(const k of ['paperless','email','phoneCall','printed'])need(typeof input[k]==='boolean','Choose each communication preference');
   need(input.email||input.phoneCall||input.printed,'Keep at least one notification method');need(!input.paperless||input.email,'Paperless billing requires Email notifications');need(!(input.paperless&&input.printed),'Paperless billing stops printed notifications; turn off Printed');
   need(['paperless','email','phoneCall','printed'].some(k=>input[k]!==p[k]),'No preference changed');
   a.cusiPreferences={paperless:input.paperless,email:input.email,phoneCall:input.phoneCall,printed:input.printed,version:p.version+1};
   event(s,'cusi_preferences_changed',{accountId:a.id,...a.cusiPreferences});send(s,a.cusiProfile?.email||a.email,'Your Lockwood communication preferences changed',`Paperless billing: ${input.paperless?'On':'Off'}. Notifications: ${[input.email&&'Email',input.phoneCall&&'Phone Call',input.printed&&'Printed'].filter(Boolean).join(', ')}.`);return{preferences:a.cusiPreferences};
  }
 }
 need(false,'Unknown portal operation',404);
}

// Deterministic synthetic execution at 00:00 UTC: drafts on Schedule For date, AutoPay on the due date,
// documented 10% penalty the day after the due date on any unpaid balance. No retries or catch-up.
export function runCusiJobs(s,from,to,ops){
 const executed=[];s.cusiJobKeys||=[];const pol=ops.site.documented_policy,pay=ops.site.construction_payment_policy;
 const jobs=[];
 for(const item of s.scheduledPayments||[])if(item.status==='scheduled'&&item.at>from&&item.at<=to)jobs.push({at:item.at,order:0,type:'draft',item});
 for(const inv of s.invoices.filter(i=>!i.penalty)){const due=utcDay(inv.dueDate);if(due>from&&due<=to)jobs.push({at:due,order:1,type:'autopay',inv});if(due+DAY>from&&due+DAY<=to)jobs.push({at:due+DAY,order:2,type:'penalty',inv});}
 jobs.sort((x,y)=>x.at-y.at||x.order-y.order);
 const post=(a,inv,amount,m,source,extra={})=>{let failure=m.decline?'declined':null;if(m.kind==='card')try{validateExpiry(m.expiry,s.now);}catch{failure='card_expired';}
  const n=s.payments.length+1,p={id:'pay-'+n,accountId:a.id,invoiceId:inv.id,amountCents:amount,feeCents:failure?0:(m.kind==='card'?pay.card_fee_cents:pay.bank_fee_cents),method:safe(m),status:failure?'failed':s.pending?'pending':'posted',confirmation:`BW-${s.seed}-${n}`,createdAt:s.now,initial:false,authenticated:true,source,...extra,...(failure?{failureReason:failure}:{})};
  s.payments.push(p);ops.event(failure?'payment_declined':'payment_submitted',{accountId:a.id,paymentId:p.id,source,...(failure?{failureReason:failure}:{})});ops.send(a.cusiProfile?.email||a.email,failure?'Your Lockwood automatic payment failed':'Your Lockwood payment confirmation',`Payment ${money(amount)}, fee ${money(p.feeCents)}, status ${p.status}. Confirmation: ${p.confirmation}.`);return p;};
 for(const job of jobs){
  const key=job.type+':'+(job.item?.id||job.inv.id);if(s.cusiJobKeys.includes(key))continue;s.cusiJobKeys.push(key);s.now=job.at;executed.push(key);
  if(job.type==='draft'){const it=job.item,a=s.accounts.find(a=>a.id===it.accountId),inv=s.invoices.find(i=>i.id===it.invoiceId),m=a.methods.find(m=>m.id===it.methodId);
   if(!inv||!m||it.amountCents>ops.available(inv)){it.status='failed';it.failureReason=!m?'method_unavailable':'balance_changed';ops.event('scheduled_payment_failed',{accountId:a.id,scheduleId:it.id,reason:it.failureReason});ops.send(a.cusiProfile?.email||a.email,'Your Lockwood scheduled bank draft was not processed',`Scheduled bank draft ${it.confirmation} was not processed because ${it.failureReason==='method_unavailable'?'the bank account is no longer linked':'the bill balance is lower than the scheduled amount'}. No payment was made.`);continue;}
   const p=post(a,inv,it.amountCents,m,'scheduled_bank_draft',{scheduleId:it.id});it.status=p.status==='failed'?'failed':'processed';it.paymentId=p.id;continue;}
  if(job.type==='autopay'){const a=s.accounts.find(a=>a.id===job.inv.accountId),ap=a?.autopay;if(!ap?.enabled||ap.enrolledAt>=job.at)continue;const remaining=ops.available(job.inv);if(remaining<=0){ops.event('autopay_skipped',{accountId:a.id,invoiceId:job.inv.id,reason:'paid'});continue;}
   const m=a.methods.find(m=>m.id===ap.methodId);if(!m){ops.event('autopay_skipped',{accountId:a.id,invoiceId:job.inv.id,reason:'method_unavailable'});continue;}
   if(ap.option==='maximum'&&remaining>ap.amountCents){ops.event('autopay_skipped',{accountId:a.id,invoiceId:job.inv.id,reason:'exceeds_maximum'});ops.send(a.cusiProfile?.email||a.email,'Your Lockwood AutoPay was not drafted',`Bill ${job.inv.number} balance ${money(remaining)} exceeds your AutoPay maximum of ${money(ap.amountCents)}. Please make a payment by the ${pol.due_day}th.`);continue;}
   post(a,job.inv,ap.option==='maximum'?remaining:Math.min(ap.amountCents,remaining),m,'autopay');continue;}
  if(job.type==='penalty'){const inv=job.inv,remaining=ops.available(inv);if(remaining<=0||s.invoices.some(i=>i.parentInvoiceId===inv.id))continue;const a=s.accounts.find(a=>a.id===inv.accountId),amount=Math.round(remaining*pol.late_penalty_percent/100);
   const p={id:inv.id+'-penalty',accountId:a.id,number:inv.number+'-LP',period:inv.period+' late penalty',dueDate:inv.dueDate.slice(0,8)+String(pol.disconnect_after_day).padStart(2,'0'),amountCents:amount,current:false,penalty:true,parentInvoiceId:inv.id,synthetic:true};s.invoices.push(p);
   ops.event('late_penalty_assessed',{accountId:a.id,invoiceId:p.id,parentInvoiceId:inv.id,amountCents:amount});ops.send(a.cusiProfile?.email||a.email,'Lockwood late penalty notice',`Bill ${inv.number} was not paid by the ${pol.due_day}th. A ${pol.late_penalty_percent}% penalty of ${money(amount)} was added. Service is discontinued if the balance is not paid by the ${pol.disconnect_after_day}th.`);}
 }
 s.now=to;return executed;
}

// Private graders for released Lockwood portal tasks.
export function cusiPortalEvaluate(state,task,outcome,ctx){
 const g=task.goal,a=state.accounts.find(x=>x.id===g.account_id),base=JSON.parse(state.cusiPortalBaseline),cur=JSON.parse(cusiPortalBusiness(state)),oldA=base.accounts.find(x=>x.id===a.id),curA=cur.accounts.find(x=>x.id===a.id);
 const ev=(type,f=()=>true)=>state.events.filter(e=>e.type===type&&e.accountId===a.id&&f(e)),last=(type,f)=>ev(type,f).at(-1),first=(type,f)=>ev(type,f)[0];
 const verified=first('cusi_username_verified'),login=verified&&state.events.find(e=>e.type==='login'&&e.accountId===a.id&&e.sequence>verified.sequence);
 const oldPayIds=new Set(base.payments.map(p=>p.id)),added=state.payments.filter(p=>!oldPayIds.has(p.id)),oldDraftIds=new Set(base.scheduledPayments.map(p=>p.id)),addedDrafts=(state.scheduledPayments||[]).filter(p=>!oldDraftIds.has(p.id));
 const checks={signed_in:Boolean(verified&&login),no_identity_changes:!state.events.some(e=>['registered','password_reset'].includes(e.type)),other_accounts_unchanged:JSON.stringify(cur.accounts.filter(x=>x.id!==a.id))===JSON.stringify(base.accounts.filter(x=>x.id!==a.id))};
 const after=(e,ref)=>Boolean(e&&ref&&e.sequence>ref.sequence);
 const restore=(fields)=>{for(const f of fields)curA[f]=oldA[f];};
 if(g.type==='cusi_portal_echeck'){
  const newMethods=a.methods.filter(m=>!oldA.methods.some(o=>o.id===m.id)),m=newMethods[0],p=added[0],q=Object.values(state.quotes).find(q=>q.purpose==='cusi'&&q.paymentId===p?.id),paid=state.events.find(e=>e.type==='payment_submitted'&&e.paymentId===p?.id);
  const linked=first('cusi_bank_linked',e=>e.methodId===m?.id),bill=first('cusi_bill_viewed',e=>e.invoiceId===g.invoice_id),review=last('cusi_payment_reviewed',e=>e.invoiceId===g.invoice_id&&e.sequence<paid?.sequence),history=state.events.find(e=>e.type==='cusi_history_viewed'&&e.accountId===a.id&&e.sequence>paid?.sequence);
  Object.assign(checks,{one_linked_bank:newMethods.length===1&&oldA.methods.length===a.methods.length-1&&m.kind==='bank'&&m.instrumentHash===instrumentHash('bank',g.account_number,g.routing)&&m.name===g.name&&m.accountType===g.account_type&&m.verification==='verified'&&m.linkEmail===g.link_email,
   linked_after_login:after(linked,login),one_exact_payment:added.length===1&&p.accountId===a.id&&p.invoiceId===g.invoice_id&&p.amountCents===g.amount_cents&&p.feeCents===g.fee_cents&&p.status==='posted'&&p.authenticated===true&&p.method.kind==='bank'&&p.method.id===m?.id,
   echeck_review:Boolean(q&&q.option==='echeck'&&q.methodId===m?.id&&q.reviewed&&review&&after(paid,review)&&after(review,linked)),bill_viewed_before_payment:Boolean(bill&&after(paid,bill)),history_after_payment:Boolean(history),confirmation_reported:Boolean(p)&&outcome.confirmation===p.confirmation,
   no_drafts:addedDrafts.length===0,autopay_unchanged:JSON.stringify(a.autopay)===JSON.stringify(oldA.autopay)});
  restore(['methods']);cur.payments=cur.payments.filter(p=>oldPayIds.has(p.id));
 }else if(g.type==='cusi_portal_schedule'){
  const d=addedDrafts[0],sched=state.events.find(e=>e.type==='cusi_draft_scheduled'&&e.scheduleId===d?.id),review=last('cusi_draft_reviewed',e=>e.sequence<sched?.sequence),receipt=state.events.find(e=>e.type==='cusi_receipt_viewed'&&e.scheduleId===d?.id&&e.sequence>sched?.sequence);
  Object.assign(checks,{one_exact_draft:addedDrafts.length===1&&d.status==='scheduled'&&d.accountId===a.id&&d.invoiceId===g.invoice_id&&d.amountCents===g.amount_cents&&d.feeCents===g.fee_cents&&d.date===g.date&&d.methodId===g.method_id&&d.version===1,reviewed_before_scheduling:Boolean(review&&after(review,login)),receipt_viewed:Boolean(receipt),scheduled_date_reported:outcome.scheduledDate===g.date,no_immediate_payment:added.length===0,balances_unchanged:state.invoices.every(i=>ctx.available(state,i)===g.remaining_cents[i.id])});
  cur.scheduledPayments=cur.scheduledPayments.filter(p=>oldDraftIds.has(p.id));
 }else if(g.type==='cusi_portal_manage_drafts'){
  const keep=state.scheduledPayments.find(p=>p.id===g.reschedule_id),drop=state.scheduledPayments.find(p=>p.id===g.cancel_id),oldKeep=base.scheduledPayments.find(p=>p.id===g.reschedule_id),oldDrop=base.scheduledPayments.find(p=>p.id===g.cancel_id);
  const updates=ev('cusi_draft_updated'),cancels=ev('cusi_draft_cancelled'),lastChange=[...updates,...cancels].sort((x,y)=>y.sequence-x.sequence)[0],finalRead=lastChange&&state.events.find(e=>['cusi_history_viewed','cusi_account_viewed'].includes(e.type)&&e.accountId===a.id&&e.sequence>lastChange.sequence);
  Object.assign(checks,{rescheduled_exactly:Boolean(keep)&&JSON.stringify({...keep,updatedAt:undefined})===JSON.stringify({...oldKeep,date:g.new_date,at:utcDay(g.new_date),version:oldKeep.version+1,updatedAt:undefined}),cancelled_exactly:Boolean(drop)&&JSON.stringify({...drop,cancelledAt:undefined})===JSON.stringify({...oldDrop,status:'cancelled',version:oldDrop.version+1,cancelledAt:undefined}),
   one_update_one_cancel:updates.length===1&&updates[0].scheduleId===g.reschedule_id&&cancels.length===1&&cancels[0].scheduleId===g.cancel_id,changes_after_login:after(updates[0],login)&&after(cancels[0],login),final_read_after_changes:Boolean(finalRead),no_new_drafts:addedDrafts.length===0,no_payments:added.length===0});
  cur.scheduledPayments=base.scheduledPayments;
 }else if(g.type==='cusi_portal_autopay'){
  const changes=ev('autopay_changed'),change=changes[0],q=Object.values(state.quotes).find(q=>q.purpose==='cusi_autopay'&&q.applied),view=first('cusi_autopay_viewed',e=>after(e,login)),review=last('cusi_autopay_reviewed',e=>e.sequence<change?.sequence),finalRead=change&&state.events.find(e=>['cusi_autopay_viewed','cusi_account_viewed'].includes(e.type)&&e.accountId===a.id&&e.sequence>change.sequence);
  let methodOk=true,methodsExpected=oldA.methods;
  if(g.enabled&&g.card_number){const nm=a.methods.filter(m=>!oldA.methods.some(o=>o.id===m.id));methodOk=nm.length===1&&nm[0].kind==='card'&&nm[0].instrumentHash===instrumentHash('card',g.card_number)&&nm[0].name===g.name&&nm[0].expiry===g.expiry&&a.autopay.methodId===nm[0].id;methodsExpected=[...oldA.methods,nm[0]];}
  else if(g.enabled)methodOk=a.autopay.methodId===g.method_id;
  const exact=g.enabled?a.autopay.enabled===true&&a.autopay.option===g.option&&a.autopay.amountCents===g.amount_cents&&a.autopay.version===oldA.autopay.version+1&&a.autopay.enrolledAt===change?.at&&methodOk:JSON.stringify(a.autopay)===JSON.stringify({enabled:false,methodId:null,option:null,amountCents:null,enrolledAt:null,version:oldA.autopay.version+1});
  Object.assign(checks,{exact_enrollment:exact,one_requested_change:changes.length===1&&change.enabled===g.enabled,viewed_before_change:after(change,view),reviewed_enable:!g.enabled||Boolean(review&&q&&q.reviewed&&after(change,review)),final_read_after_change:Boolean(finalRead),wallet_as_expected:JSON.stringify(a.methods)===JSON.stringify(methodsExpected),no_payments:added.length===0,no_drafts:addedDrafts.length===0});
  restore(['autopay','methods']);
 }else if(g.type==='cusi_portal_preferences'){
  const changes=ev('cusi_preferences_changed'),change=changes[0],view=first('cusi_preferences_viewed',e=>after(e,login)),finalRead=change&&state.events.find(e=>e.type==='cusi_preferences_viewed'&&e.accountId===a.id&&e.sequence>change.sequence);
  Object.assign(checks,{exact_preferences:JSON.stringify(a.cusiPreferences)===JSON.stringify({paperless:g.paperless,email:g.email,phoneCall:g.phone_call,printed:g.printed,version:oldA.cusiPreferences.version+1}),one_change:changes.length===1,viewed_before_change:after(change,view),final_read_after_change:Boolean(finalRead),no_payments:added.length===0,no_drafts:addedDrafts.length===0});
  restore(['cusiPreferences']);
 }else ctx.need(false,'Unknown Lockwood portal task',500);
 checks.protected_state_unchanged=JSON.stringify(cur)===JSON.stringify(base);
 return checks;
}
