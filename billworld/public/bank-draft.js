export async function renderBankDraft(ctx){
 const {app,escape:e,api}=ctx;
 document.body.className='authoritypay bankdraft';document.title='Bank Draft Form | Town of Swepsonville';
 const field=(name,label,type='text',placeholder='')=>`<label><span class="draft-label">${label} <b aria-hidden="true">*</b></span><input name="${name}" aria-label="${label}" type="${type}" placeholder="${placeholder}" required maxlength="200"></label>`;
 const frame=body=>{app.innerHTML=`<main class="draft-sheet">${body}</main><footer><a href="/">Town of Swepsonville</a> · <a href="/utilities">Billing help</a> · <a href="/mail">Email</a></footer>`;};
 if(location.pathname==='/bank-draft/submitted'){
  let receipt;try{receipt=(await api('bank-draft/submission')).submission;}catch{return ctx.navigate('/bank-draft');}
  frame(`<h1>Bank Draft Request Submitted</h1><p id="notice" role="status">Your enrollment request was received for town review. AutoPay is not active and no payment has been made.</p><p>Request confirmation: <strong id="confirmation">${e(receipt.confirmation)}</strong></p><p>${e(receipt.customerName)} · ${e(receipt.serviceAddress)}</p><p>${e(receipt.bankName)} · ${e(receipt.method.label)}</p><p>Signed ${e(receipt.signedDate)}.</p><p>Published draft window: last week of each month. An exact execution date and production activation process are unobserved.</p><p>No credit report was accessed.</p><a href="/">Return to Town of Swepsonville</a>`);return;
 }
 frame(`<h1>BANK DRAFT FORM</h1><div id="error" role="alert"></div><section class="draft-town"><strong>TOWN OF SWEPSONVILLE</strong><p>2747 DARREL NEWTON DR GRAHAM, NC 27253</p><p>PHONE (336) 578-5644</p><p>FAX (336) 578-5196</p></section><form data-action="authority-bank-draft">
 <div class="draft-pair">${field('customerNumber','ACCOUNT NUMBER')}${field('customerName','CUSTOMER NAME')}</div>
 ${field('serviceAddress','SERVICE ADDRESS')}
 <section class="draft-section"><h2>BANK INFO</h2><p>Use the synthetic bank details supplied for this episode.</p></section>
 <div class="draft-pair">${field('bankName','BANK NAME')}${field('accountNumber','BANK ACCOUNT NUMBER')}${field('routing','BANK ROUTING NUMBER')}</div>
 <fieldset><legend>BACNK ACCOUNT TYPE *</legend><div class="draft-type-options"><label><input type="radio" name="accountType" value="checking" required> CHECKING</label><label><input type="radio" name="accountType" value="savings" required> SAVINGS</label></div></fieldset>
 <p class="draft-window">NOTE: ALL PAYMENTS WILL BE DRAFTED DURING THE LAST WEEK OF EACH MONTH.</p>
 <section class="draft-section"><h2>CONTACT INFO</h2><p>(In case we have questions)</p></section>
 <div class="draft-pair">${field('phone','MOBILE PHONE NUMBER','tel')}${field('email','EMAIL ADDRESS','email')}</div>
 <div class="draft-pair"><div>${field('signature','SIGNATURE')}<small>YOUR SIGNATURE AUTHORIZES A CREDIT REPORT TO BE ACCESSED</small></div>${field('date','DATE','text','MM/DD/YYYY')}</div>
 <label class="draft-consent"><input name="creditReportConsent" type="checkbox" required> I authorize this local bank-draft request and acknowledge the signature disclosure. No credit report will be accessed in this simulation.</label>
 <div class="draft-submit"><button>Submit</button></div></form>`);
}
