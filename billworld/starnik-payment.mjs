// Local payment validation. Tenant fees are documented; processor behavior is synthetic.
import {walletInstrument} from './wallet.mjs';
const need=(v,m)=>{if(!v)throw Error(m);};
export function starnikPayment(input,now,balance){
 need(Number.isSafeInteger(input.amountCents)&&input.amountCents>0&&input.amountCents<=balance,'Enter a positive payment no greater than the outstanding balance');
 const billing={};for(const key of ['firstName','lastName','address','city','state','zip','country']){need(typeof input[key]==='string'&&input[key].trim().length>0&&input[key].length<=150,'Enter billing '+key);billing[key]=input[key].trim();}
 need(!input.email||typeof input.email==='string'&&input.email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email),'Enter a valid receipt email');billing.email=input.email||'';
 let method=walletInstrument(input,now);
 if(input.kind==='bank'){need(input.routing===input.confirmRouting,'Routing numbers must match');need(['Checking','Savings'].includes(input.accountType),'Choose Checking or Savings');need(typeof input.bankName==='string'&&input.bankName.trim().length>0&&input.bankName.length<=100,'Enter bank name');method={...method,accountType:input.accountType,bankName:input.bankName.trim(),label:input.accountType+' ending '+method.last4};}
 else {const n=input.cardNumber;const brand=/^4\d{12}(?:\d{3})?$/.test(n)?'Visa':n.length===16&&(/^5[1-5]/.test(n)||Number(n.slice(0,4))>=2221&&Number(n.slice(0,4))<=2720)?'Mastercard':n.length===16&&(/^(?:6011|65|64[4-9])/.test(n)||Number(n.slice(0,6))>=622126&&Number(n.slice(0,6))<=622925)?'Discover':null;need(brand&&input.cardType===brand,'Choose a supported card type matching its number');need(/^\d{3}$/.test(input.cvv),'Enter the three-digit card security code');method={...method,brand,label:brand+' ending '+method.last4};}
 return {method,billing,amountCents:input.amountCents};
}
export function starnikFee(kind,amount,policy){if(kind==='bank')return policy.bank_fee_cents;return Math.max(policy.card_fee_minimum_cents,Math.floor((amount*policy.card_fee_basis_points+5000)/10000));}
