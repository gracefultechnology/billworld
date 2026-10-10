// Local payment validation. Tenant fees are documented; processor behavior is synthetic.
import {walletInstrument} from './wallet.mjs';
const need=(v,m)=>{if(!v)throw Error(m);};
export function starnikPayment(input,now,balance){
 need(Number.isSafeInteger(input.amountCents)&&input.amountCents>0&&input.amountCents<=balance,'Enter a positive payment no greater than the outstanding balance');
 return {...starnikInstrumentBilling(input,now),amountCents:input.amountCents};
}
export function starnikInstrumentBilling(input,now){
 const billing={};for(const key of ['firstName','lastName','address','city','state','zip','country']){need(typeof input[key]==='string'&&input[key].trim().length>0&&input[key].length<=150,'Enter billing '+key);billing[key]=input[key].trim();}
 need(!input.email||typeof input.email==='string'&&input.email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email),'Enter a valid receipt email');billing.email=input.email||'';
 let method=walletInstrument(input,now);
 if(input.kind==='bank'){need(input.routing===input.confirmRouting,'Routing numbers must match');need(['Checking','Savings'].includes(input.accountType),'Choose Checking or Savings');need(typeof input.bankName==='string'&&input.bankName.trim().length>0&&input.bankName.length<=100,'Enter bank name');method={...method,accountType:input.accountType,bankName:input.bankName.trim(),label:input.accountType+' ending '+method.last4};}
 else {const n=input.cardNumber;const brand=/^4\d{12}(?:\d{3})?$/.test(n)?'Visa':n.length===16&&(/^5[1-5]/.test(n)||Number(n.slice(0,4))>=2221&&Number(n.slice(0,4))<=2720)?'Mastercard':n.length===16&&(/^(?:6011|65|64[4-9])/.test(n)||Number(n.slice(0,6))>=622126&&Number(n.slice(0,6))<=622925)?'Discover':null;need(brand&&input.cardType===brand,'Choose a supported card type matching its number');need(/^\d{3}$/.test(input.cvv),'Enter the three-digit card security code');method={...method,brand,label:brand+' ending '+method.last4};}
 return {method,billing};
}
export function starnikFeePolicy(policy){
 const keys=['bank_fee_cents','card_fee_basis_points','card_fee_minimum_cents'];
 need(policy?.payment_fee_status!=='unverified','Tenant payment fee policy unavailable');
 need(policy&&keys.every(k=>Number.isSafeInteger(policy[k])&&policy[k]>=0),'Tenant payment fee policy unavailable');
 return Object.fromEntries(keys.map(k=>[k,policy[k]]));
}
export function starnikFeeDisclosure(policy){
 const p=starnikFeePolicy(policy),money=n=>'$'+(n/100).toFixed(2);
 return (p.bank_fee_cents===0?'Bank payments have no fee.':'Bank payments have a '+money(p.bank_fee_cents)+' fee.')+' Card payments have a '+(p.card_fee_basis_points/100)+'% fee'+(p.card_fee_minimum_cents?', minimum '+money(p.card_fee_minimum_cents):'')+'.';
}
export function starnikFee(kind,amount,policy){
 const p=starnikFeePolicy(policy);
 need(['bank','card'].includes(kind),'Payment method unavailable');
 need(Number.isSafeInteger(amount)&&amount>0,'Invalid payment amount');
 const fee=kind==='bank'?BigInt(p.bank_fee_cents):((BigInt(amount)*BigInt(p.card_fee_basis_points)+5000n)/10000n);
 const total=kind==='card'&&fee<BigInt(p.card_fee_minimum_cents)?BigInt(p.card_fee_minimum_cents):fee;
 need(total<=BigInt(Number.MAX_SAFE_INTEGER),'Payment fee exceeds construction limit');
 return Number(total);
}

// An explicit research gap is distinct from a malformed configured policy.
export function starnikPaymentAvailability(policy){
 if(policy?.payment_fee_status==='unverified'){
  need(['bank_fee_cents','card_fee_basis_points','card_fee_minimum_cents'].every(k=>!Object.hasOwn(policy,k)),'Unverified fee policy cannot contain fee amounts');
  return {paymentAvailable:false,feeDisclosure:null};
 }
 return {paymentAvailable:true,feeDisclosure:starnikFeeDisclosure(policy)};
}
