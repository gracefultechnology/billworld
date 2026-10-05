// Public Western Dental input configuration establishes these field shapes.
// Matching, session duration and mock CAPTCHA semantics are synthetic fixtures.
export function personaPayIdentifiers({ accountNumber, zipCode, dateOfBirth } = {}) {
  if (typeof accountNumber !== 'string' || !/^\d{5,10}$/.test(accountNumber)) throw Error('Enter the account number without the dash');
  if (typeof zipCode !== 'string' || !/^\d{5}$/.test(zipCode)) throw Error('Enter a five-digit ZIP code');
  if (typeof dateOfBirth !== 'string' || !/^\d{2}\/\d{2}\/\d{4}$/.test(dateOfBirth)) throw Error('Enter the date of birth as MM/DD/YYYY');
  const [month, day, year] = dateOfBirth.split('/').map(Number);
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw Error('Enter a valid date of birth');
  return { accountNumber, zipCode, dateOfBirth };
}

export function seedPersonaPay(state) {
  state.personaPayFailures = 0;
  Object.assign(state.accounts[0], { customerNumber: '123001048', personaPayZip: '56007', personaPayBirth: '04/12/1985' });
  Object.assign(state.accounts[1], { customerNumber: '234002099', personaPayZip: '63863', personaPayBirth: '02/29/1988' });
  // No observed stored wallet: do not inherit the utility fixture's saved methods.
  for (const a of state.accounts) a.methods = [];
  state.invoices.push({ id:'inv-second',accountId:'acct-primary',number:'DENTAL-2026-1049',period:'Separate synthetic dental charge',dueDate:'2026-10-20',amountCents:12500,current:true });
}

// WeightedSplit and editable distribution are public configuration flags.
// Largest-remainder rounding and overpayment credit are explicit synthetic policies.
export function personaPayDistribution(lines, amountCents, edited, scheduledAdjustment=false) {
  if (!Number.isSafeInteger(amountCents) || amountCents < (scheduledAdjustment?1:100) || amountCents > 200000000) throw Error('Payment must be between $1.00 and $2,000,000.00');
  if (!lines.length || lines.some(l=>!Number.isSafeInteger(l.balanceCents)||l.balanceCents<=0)) throw Error('Choose unpaid charges');
  const balanceCents=lines.reduce((n,l)=>n+l.balanceCents,0);
  const applied=Math.min(amountCents,balanceCents);
  let allocations;
  if (edited !== undefined) {
    if (!Array.isArray(edited) || !edited.length || edited.length > lines.length) throw Error('Enter a distribution for the selected charges');
    const seen=new Set();
    allocations=edited.map(x=>{
      const line=lines.find(l=>l.invoiceId===x.invoiceId);
      if (!line||seen.has(x.invoiceId)||!Number.isSafeInteger(x.amountCents)||x.amountCents<=0||x.amountCents>line.balanceCents) throw Error('Distribution must use each selected charge at most once without exceeding its balance');
      seen.add(x.invoiceId);return {invoiceId:x.invoiceId,amountCents:x.amountCents};
    });
    if (allocations.reduce((n,x)=>n+x.amountCents,0)!==applied) throw Error('Distribution must equal the amount applied to charges');
  } else {
    const weighted=lines.map((l,index)=>{
      const numerator=BigInt(applied)*BigInt(l.balanceCents),denominator=BigInt(balanceCents);
      return {invoiceId:l.invoiceId,amountCents:Number(numerator/denominator),remainder:numerator%denominator,index};
    });
    let extra=applied-weighted.reduce((n,x)=>n+x.amountCents,0);
    for(const x of [...weighted].sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1)){if(extra--<=0)break;x.amountCents++;}
    allocations=weighted.filter(x=>x.amountCents>0).map(({invoiceId,amountCents})=>({invoiceId,amountCents}));
  }
  if (allocations.some(x=>x.amountCents<(scheduledAdjustment?1:100)||x.amountCents>100000000)) throw Error('Each charge payment must be between $1.00 and $1,000,000.00; select fewer charges or edit distribution');
  return {allocations,creditCents:amountCents-applied,balanceCents};
}
