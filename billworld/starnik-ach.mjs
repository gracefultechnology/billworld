// Starnik ACH Auto Draft page. The page sequence (resident list with ON/OFF
// switch, bank form with confirmations, agreement, AutoPay conflict warning,
// deactivate and delete confirmations) follows the captured shared Starnik
// client bundle (ACHPage). Tenant enablement, agreement and warning wording are
// tenant policy; all persistence and validation here is a local reconstruction.
const fail=(message,status=400)=>{const e=Error(message);e.status=status;throw e;};
const need=(value,message,status)=>{if(!value)fail(message,status);};
const codes=types=>types.map((text,i)=>({achTransactionCodeId:i+1,text}));
export function starnikAchPolicy(site){
 const p=site?.documented_policy?.ach_draft;
 if(!p)return null;
 need(Array.isArray(p.account_types)&&p.account_types.length&&p.account_types.every(t=>['Checking','Savings'].includes(t)),'Tenant ACH account types unavailable',500);
 need(typeof p.agreement_text==='string'&&p.agreement_text.length>20&&typeof p.autopay_warning==='string'&&p.autopay_warning.length>20,'Tenant ACH wording unavailable',500);
 return p;
}
const masked=d=>d?{bankName:d.bankName,maskedAccountNumber:'XXXXXX'+d.accountLast4,accountType:d.accountType}:{bankName:'',maskedAccountNumber:'',accountType:''};
function warning(a,p){return a.autopay?.enabled?{hasConflict:true,warningMessage:p.autopay_warning}:{hasConflict:false,warningMessage:''};}
function grant(s,a,ctx){
 const q=s.quotes[ctx.hash(String(ctx.token||''))];
 need(q?.purpose==='starnik_ach'&&q.accountId===a.id&&q.session===ctx.session,'ACH review unavailable. Start again from the ACH page.',404);
 return q;
}
export function starnikAch(s,a,action,input,ctx){
 const p=starnikAchPolicy(ctx.site);need(p,'ACH payment setup is not enabled for this community.',404);
 const {event,send,hash,secret}=ctx,d=a.starnikAchDraft||null,mail=ctx.brand.mailName;
 if(action==='view'){
  event(s,'starnik_ach_viewed',{accountId:a.id});
  return{residents:[{residentId:a.id,residentName:a.name,accountNumber:a.customerNumber,serviceAddress:a.serviceAddress||'',isACHEnabledForCommunity:p.enabled_for_community===true,hasActiveACH:!!d?.active,hasBankOnFile:!!d,...masked(d),version:d?.version||0}],transactionCodes:codes(p.account_types),autoPayWarning:warning(a,p),customerServicePhone:p.customer_service_phone||null,synthetic:true};
 }
 if(action==='prepare'){
  need(p.enabled_for_community===true,'ACH payment setup is not enabled for this community.',403);
  need(input.residentId===a.id,'Account unavailable',404);
  const bankName=typeof input.bankName==='string'?input.bankName.trim():'';need(bankName.length>0&&bankName.length<=100,'*Required: enter the bank name');
  const types=codes(p.account_types),type=types.find(t=>t.achTransactionCodeId===input.achTransactionCodeId);need(type,'*Required: choose the account type');
  const routing=String(input.routingNumber||''),account=String(input.accountNumber||'');
  need(/^\d{9}$/.test(routing),'Enter a 9-digit bank routing number');
  const x=routing.split('').map(Number);need((3*(x[0]+x[3]+x[6])+7*(x[1]+x[4]+x[7])+x[2]+x[5]+x[8])%10===0,'Routing number checksum is invalid');
  need(routing===String(input.confirmRoutingNumber||''),'*Routing Numbers do not match.');
  need(/^\d{4,17}$/.test(account),'Enter a bank account number of 4 to 17 digits');
  need(account===String(input.confirmAccountNumber||''),'*Account Numbers do not match.');
  need(Number.isSafeInteger(input.version)&&input.version===(d?.version||0),'ACH settings changed; reload before editing',409);
  const instrumentHash=ctx.instrumentHash('bank',account,routing),token=secret();
  s.quotes[hash(token)]={purpose:'starnik_ach',accountId:a.id,session:ctx.session,details:{bankName,accountType:type.text,routingLast4:routing.slice(-4),accountLast4:account.slice(-4),instrumentHash},prior:JSON.stringify(d),expires:s.now+15*60000,reviewed:false,applied:false};
  event(s,'starnik_ach_prepared',{accountId:a.id,quoteId:hash(token)});return{token};
 }
 if(action==='review'){
  const q=grant(s,a,ctx);need(!q.applied&&q.expires>s.now,'ACH review expired or completed. Start again from the ACH page.',409);
  need(q.prior===JSON.stringify(d),'ACH settings changed; start again',409);
  q.reviewed=true;event(s,'starnik_ach_reviewed',{accountId:a.id,quoteId:hash(String(ctx.token))});
  return{residentName:a.name,accountNumber:a.customerNumber,bankName:q.details.bankName,accountType:q.details.accountType,maskedAccountNumber:'XXXXXX'+q.details.accountLast4,routingLast4:q.details.routingLast4,agreementText:p.agreement_text,autoPayWarning:warning(a,p),synthetic:true};
 }
 if(action==='save'){
  const q=grant(s,a,ctx);need(input.agreedToTerms===true,'You must agree to the terms and conditions to continue.');
  if(q.applied){need(a.starnikAchDraft?.quoteId===hash(String(ctx.token)),'ACH settings changed; start again',409);return{success:true,idempotent:true,message:'ACH settings saved.'};}
  need(q.reviewed&&q.expires>s.now,'Review the ACH agreement again',409);need(q.prior===JSON.stringify(d),'ACH settings changed; start again',409);
  const w=warning(a,p);need(!w.hasConflict||input.acknowledgeAutoPay===true,'Review the AutoPay warning before enabling ACH');
  a.starnikAchDraft={active:true,...q.details,version:(d?.version||0)+1,updatedAt:s.now,quoteId:hash(String(ctx.token))};a.starnikAch=true;q.applied=true;
  event(s,'starnik_ach_saved',{accountId:a.id,quoteId:hash(String(ctx.token)),autopayConflict:w.hasConflict,autopayConflictAcknowledged:w.hasConflict&&input.acknowledgeAutoPay===true});
  send(s,a.email,'Your local '+mail+' ACH Auto Draft settings changed','ACH Auto Draft is active from '+q.details.accountType+' ending '+q.details.accountLast4+' at '+q.details.bankName+'.'+(w.hasConflict?' AutoPay is also enabled on this account; review it to avoid duplicate payments.':'')+' This confirmation is simulated.');
  return{success:true,idempotent:false,message:'ACH settings saved successfully.'};
 }
 if(action==='deactivate'){
  need(input.confirmed===true,'Confirm deactivating ACH');need(input.residentId===a.id,'Account unavailable',404);need(d?.active,'ACH is not active for this account',409);
  a.starnikAchDraft={...d,active:false,version:d.version+1,updatedAt:s.now};delete a.starnikAchDraft.quoteId;a.starnikAch=false;
  event(s,'starnik_ach_deactivated',{accountId:a.id});send(s,a.email,'Your local '+mail+' ACH Auto Draft settings changed','ACH Auto Draft was deactivated. The bank account remains on file until deleted. This confirmation is simulated.');
  return{success:true,message:'ACH has been deactivated.'};
 }
 if(action==='delete'){
  need(input.confirmed===true,'Confirm deleting the ACH account');need(input.residentId===a.id,'Account unavailable',404);need(d,'No ACH account is on file',409);
  need(Number.isSafeInteger(input.version)&&input.version===d.version,'ACH settings changed; reload before deleting',409);
  a.starnikAchDraft=null;a.starnikAch=false;
  event(s,'starnik_ach_deleted',{accountId:a.id,wasActive:!!d.active});send(s,a.email,'Your local '+mail+' ACH Auto Draft settings changed','The ACH bank account was deleted and ACH Auto Draft is off. This confirmation is simulated.');
  return{success:true,message:'ACH account deleted.'};
 }
 fail('Unknown ACH operation',404);
}

// Private grader for tenant ACH tasks. `goal.expected` is the exact final ACH
// record (null means deleted); `goal.expected_changes` is the exact multiset of
// mutating events; AutoPay may only change when the goal says so.
export function gradeStarnikAch(state,goal,{starnikBusiness,instrumentHash}){
 const a=state.accounts.find(x=>x.id===goal.account_id),baseline=JSON.parse(state.starnikBaseline),current=JSON.parse(starnikBusiness(state)),old=baseline.accounts.find(x=>x.id===goal.account_id),now=current.accounts.find(x=>x.id===goal.account_id);
 const d=a?.starnikAchDraft,e=goal.expected,ev=state.events;
 const exact=e===null?d===null:!!d&&d.active===e.active&&d.bankName===e.bank_name&&d.accountType===e.account_type&&d.routingLast4===e.routing.slice(-4)&&d.accountLast4===e.account_number.slice(-4)&&d.instrumentHash===instrumentHash('bank',e.account_number,e.routing)&&a.starnikAch===e.active;
 const mutating=['starnik_ach_saved','starnik_ach_deactivated','starnik_ach_deleted','starnik_autopay_enabled','starnik_autopay_disabled','starnik_wallet_saved','starnik_wallet_updated','starnik_wallet_removed','starnik_ebill_changed'];
 const changes=ev.filter(x=>mutating.includes(x.type)),login=ev.find(x=>x.type==='login'&&x.accountId===a.id),view=ev.find(x=>x.type==='starnik_ach_viewed'&&x.accountId===a.id&&x.sequence>login?.sequence);
 const sorted=x=>[...x].sort().join('|');
 const saves=changes.filter(x=>x.type==='starnik_ach_saved');
 const checks={
  exact_ach:exact,
  exact_changes:sorted(changes.map(x=>x.type))===sorted(goal.expected_changes)&&changes.every(x=>x.accountId===a.id),
  login_view_then_change:!!view&&changes.length>0&&changes.every(x=>x.sequence>login.sequence)&&changes.filter(x=>x.type.startsWith('starnik_ach_')).every(x=>x.sequence>view.sequence),
  reviewed_agreement:saves.every(x=>{const q=state.quotes[x.quoteId];return q?.purpose==='starnik_ach'&&q.reviewed&&q.applied&&ev.some(r=>r.type==='starnik_ach_reviewed'&&r.quoteId===x.quoteId&&r.sequence<x.sequence);}),
  autopay_warning_acknowledged:!goal.require_autopay_warning||saves.length>0&&saves.every(x=>x.autopayConflict===true&&x.autopayConflictAcknowledged===true),
  final_autopay:JSON.stringify(a.autopay)===JSON.stringify(goal.autopay_enabled_final||!old.autopay.enabled?old.autopay:{enabled:false,methodId:null,rule:'days_before_due',daysBeforeDue:old.autopay.daysBeforeDue})&&a.autopay.enabled===goal.autopay_enabled_final,
  final_ach_view:changes.length>0&&ev.some(x=>x.type==='starnik_ach_viewed'&&x.accountId===a.id&&x.sequence>changes.at(-1).sequence),
 };
 now.starnikAchDraft=old.starnikAchDraft;now.starnikAch=old.starnikAch;now.autopay=old.autopay;
 checks.protected_state_unchanged=JSON.stringify(current)===JSON.stringify(baseline);
 const allowed=['starnik_username_verified','login','starnik_account_viewed','starnik_ach_viewed','starnik_ach_prepared','starnik_ach_reviewed','starnik_autopay_viewed','starnik_wallet_viewed','starnik_history_viewed',...goal.expected_changes];
 checks.no_forbidden_operations=ev.every(x=>allowed.includes(x.type)||x.type.startsWith('mail'));
 return checks;
}
