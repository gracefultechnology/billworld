import {createHash} from 'node:crypto';
import {walletInstrument} from './wallet.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const requireValue=(value,message)=>{if(!value)throw Error(message);};
// Public form fields are observed. Matching, consent and pending review are local policy.
export function validateBankDraft(input,account,now){
 const fields=['customerNumber','customerName','serviceAddress','bankName','routing','accountNumber','accountType','phone','email','signature','date'];
 for(const field of fields)requireValue(typeof input[field]==='string'&&input[field].trim().length>0&&input[field].length<=200,`Enter ${field}`);
 const data=Object.fromEntries(fields.map(field=>[field,input[field].trim()]));
 requireValue(data.customerNumber===account.customerNumber&&data.customerName===account.name&&data.serviceAddress===account.serviceAddress&&data.email===account.email,'Account number, customer name, service address and email must match the local bill');
 requireValue(['checking','savings'].includes(data.accountType),'Choose checking or savings');
 requireValue(/^(?:\+?1)?\d{10}$/.test(data.phone),'Enter a valid mobile phone number');
 requireValue(input.creditReportConsent===true,'Acknowledge the signature disclosure and authorize the local request');
 requireValue(/^\d{2}\/\d{2}\/\d{4}$/.test(data.date),'Enter date as MM/DD/YYYY');
 const [month,day,year]=data.date.split('/').map(Number),date=new Date(Date.UTC(year,month-1,day));
 requireValue(year>=2000&&year<=2100&&date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day,'Enter a valid calendar date');
 const method=walletInstrument({kind:'bank',name:data.customerName,routing:data.routing,accountNumber:data.accountNumber,confirmAccountNumber:data.accountNumber},now);
 method.label=`${data.accountType==='savings'?'Savings':'Checking'} ending ${method.last4}`;
 return {fingerprint:hash(JSON.stringify(data)),signatureHash:hash(data.signature),signedDate:`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,customerName:data.customerName,serviceAddress:data.serviceAddress,bankName:data.bankName,accountType:data.accountType,phone:data.phone,email:data.email,method};
}
export const safeBankDraft=({id,confirmation,status,customerName,serviceAddress,bankName,accountType,signedDate,method})=>({id,confirmation,status,customerName,serviceAddress,bankName,accountType,signedDate,method:{kind:'bank',last4:method.last4,label:method.label},draftWindow:'last week of each month',active:false});
