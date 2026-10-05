import {createHash} from 'node:crypto';
const requireValue=(value,message)=>{if(!value)throw new Error(message);};
export function validateExpiry(expiry,now){requireValue(typeof expiry==='string'&&/^\d{2}\/\d{2}$/.test(expiry),'Enter expiration as MM/YY');const [month,year]=expiry.split('/').map(Number);requireValue(month>=1&&month<=12&&Date.UTC(2000+year,month,1)>now,'Card has expired');return expiry;}
export function walletInstrument(input,now){
 requireValue(['bank','card'].includes(input.kind),'Choose a bank account or card');requireValue(typeof input.name==='string'&&input.name.trim().length>0&&input.name.length<=100,'Enter the account holder name');
 let identity,method;
 if(input.kind==='bank'){
  requireValue(/^\d{9}$/.test(input.routing||'')&&/^\d{4,17}$/.test(input.accountNumber||''),'Enter valid routing and account numbers');
  const d=input.routing.split('').map(Number);requireValue((3*(d[0]+d[3]+d[6])+7*(d[1]+d[4]+d[7])+d[2]+d[5]+d[8])%10===0,'Routing number checksum is invalid');
  requireValue(input.accountNumber===input.confirmAccountNumber,'Bank account numbers must match');identity=`bank:${input.routing}:${input.accountNumber}`;method={kind:'bank',last4:input.accountNumber.slice(-4),label:`Checking ending ${input.accountNumber.slice(-4)}`};
 }else{
  requireValue(/^\d{13,19}$/.test(input.cardNumber||'')&&/^\d{3,4}$/.test(input.cvv||''),'Enter valid synthetic card details');const d=input.cardNumber.split('').reverse().map(Number);requireValue(d.reduce((n,x,i)=>n+(i%2?(x*2>9?x*2-9:x*2):x),0)%10===0,'Card number checksum is invalid');
  validateExpiry(input.expiry,now);identity=`card:${input.cardNumber}`;const brand=input.cardNumber.startsWith('4')?'Visa':input.cardNumber.startsWith('5')?'Mastercard':input.cardNumber.startsWith('3')?'American Express':'Card';method={kind:'card',last4:input.cardNumber.slice(-4),label:`${brand} ending ${input.cardNumber.slice(-4)}`,expiry:input.expiry,decline:input.cardNumber.endsWith('0002')};
 }
 return {...method,name:input.name.trim(),instrumentHash:createHash('sha256').update(identity).digest('hex'),version:1};
}
export const instrumentHash=(kind,number,routing='')=>createHash('sha256').update(kind==='card'?`card:${number}`:`bank:${routing}:${number}`).digest('hex');
