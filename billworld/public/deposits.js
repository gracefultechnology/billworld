export async function renderDeposits(ctx,paymentKind){
 const {app,escape:e,money,api}=ctx,p=location.pathname;
 document.body.className='authoritypay invoicecloud deposits';document.title='Deposits | Town of Swepsonville NC';
 const field=(name,label,type='text',value='',placeholder=label)=>`<label><span>${label} <b aria-hidden="true">*</b></span><input name="${name}" aria-label="${label}" type="${type}" value="${e(value)}" placeholder="${placeholder}" required></label>`;
 const form=(action,body,button)=>`<form data-action="authority-deposit-${action}">${body}<button>${button}</button></form>`;
 const frame=(title,body)=>{app.innerHTML=`<header><a href="/invoicecloud"><img src="/reference-assets/sweps-invoicecloud.png" alt="Town of Swepsonville NC home"></a><a href="/invoicecloud/contact">Contact Us</a></header><main class="deposit-layout"><section><a href="/invoicecloud">‹ Return to previous page</a><h1>${title}</h1><div id="error" role="alert"></div>${body}</section><aside id="deposit-help"><div class="accepted-methods">${['visa.gif','mastercard.gif','amex.gif','discover.gif','bank.png'].map((file,i)=>`<img src="/reference-assets/sweps-${file}" alt="${['Visa','MasterCard','American Express','Discover','Check Payment'][i]} Accepted">`).join('')}</div><h2>Need Help?</h2><p>You may reach us at (336) 578-5644.</p></aside></main><footer><strong>InvoiceCloud</strong> · <a href="/utilities">Billing help</a> · <a href="/mail">Email</a></footer>`;};
 if(p==='/invoicecloud/contact'){frame('Contact Us','<p>Phone:</p><p>(336) 578-5644</p>');return;}
 if(p==='/invoicecloud/deposits'){
  frame('Deposits',`<p>Please contact Town Hall regarding your deposit amount.<br><a href="#deposit-help">Click for more information.</a></p>${form('confirm',`<div class="deposit-pair">${field('depositAccountNumber','Account Number (e.g. 1234-5)')}${field('customerName','Name')}${field('serviceAddress','Service Address')}${field('depositAmount','Deposit Amount','text','','$0.00')}</div>`,'Confirm Your Information ›')}`);return;
 }
 if(p.endsWith('/confirm')||p.endsWith('/payment')){
  let d;try{d=(await api('deposits/form')).deposit;}catch{return ctx.navigate('/invoicecloud/deposits');}
  if(p.endsWith('/confirm')){frame('Confirm Your Information',`<p>Account Number: ${e(d.accountNumber)}</p><p>Name: ${e(d.customerName)}</p><p>Service Address: ${e(d.serviceAddress)}</p><p>Deposit Amount: ${money(d.amountCents)}</p><a class="button" href="/invoicecloud/deposits/payment">Continue to Payment</a>`);return;}
  frame('Deposit Payment Information',`<p>Service deposit: ${money(d.amountCents)}</p>${form('quote',`<label>Payment Method<select name="kind" data-payment-kind><option value="bank" ${paymentKind==='bank'?'selected':''}>Checking</option><option value="card" ${paymentKind==='card'?'selected':''}>Credit/Debit Card</option></select></label>`+field('name','Account Holder Name')+(paymentKind==='bank'?field('routing','Routing Number')+field('accountNumber','Bank Account Number'):field('cardNumber','Card Number')+field('expiry','Expiration (MM/YY)')+field('cvv','Security Code')),'Review Deposit Payment')}`);return;
 }
 if(p.endsWith('/review')){
  let q;try{q=await api('deposits/review');}catch{return ctx.navigate('/invoicecloud/deposits');}
  frame('Review Deposit Payment',`<p>Purpose: service deposit</p><p>Deposit ${money(q.amountCents)}</p><p>Convenience Fee ${money(q.feeCents)}</p><p>Total ${money(q.totalCents)}</p><p>${e(q.method.label)}</p>${form('pay','','Process Deposit Payment')}`);return;
 }
 if(p.endsWith('/receipt')){
  let r;try{r=(await api('deposits/receipt')).payment;}catch{return ctx.navigate('/invoicecloud/deposits');}
  frame('Deposit Payment Confirmation',`<p>Deposit payment ${e(r.status)}.</p><p>Confirmation: <strong id="confirmation">${e(r.confirmation)}</strong></p><p>Deposit ${money(r.amountCents)} · Fee ${money(r.feeCents)}</p><p>This deposit payment does not pay your utility invoice.</p><a href="/invoicecloud">Continue</a>`);return;
 }
 frame('Page not available','<a href="/invoicecloud/deposits">Return to Deposits</a>');
}
export async function submitDeposit(action,data,ctx){
 if(action==='deposit-confirm'){await ctx.api('deposits/confirm',data);return ctx.navigate('/invoicecloud/deposits/confirm');}
 if(action==='deposit-quote'){const {deposit}=await ctx.api('deposits/form');await ctx.api('deposits/quote',{...data,depositId:deposit.id,amountCents:deposit.amountCents});return ctx.navigate('/invoicecloud/deposits/review');}
 if(action==='deposit-pay'){const q=await ctx.api('deposits/review'),r=await ctx.api('pay',{token:q.token});if(r.declined)throw Error(r.message);return ctx.navigate('/invoicecloud/deposits/receipt');}
 throw Error('Deposit action unavailable');
}
