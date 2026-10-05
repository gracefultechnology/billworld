export function depositAmountCents(value){
 if(typeof value!=='string'||!/^\d{1,7}(?:\.\d{1,2})?$/.test(value.trim()))throw Error('Enter a positive deposit amount with at most two decimal places');
 const [whole,fraction='']=value.trim().split('.'),amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(amount<=0)throw Error('Enter a positive deposit amount');return amount;
}
