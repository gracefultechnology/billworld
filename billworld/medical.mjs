// Synthetic obligations; public source establishes guarantor/visit distinctions,
// not these balances, lookup matching rules or downstream checkout behavior.
export function seedMedicalBills(state) {
  state.accounts[0].username = 'alex.morgan';
  // Synthetic fixture: this account previously enrolled its email for recovery.
  state.accounts[0].recoveryEmail = state.accounts[0].registered ? state.accounts[0].email : null;
  state.accounts[1].username = 'jordan.lee';
  state.invoices = [
    { id: 'inv-current', accountId: 'acct-primary', visitAccountNumber: '100104801', patientName: 'Taylor Morgan', number: 'VISIT-100104801', period: 'September 2026 visit', dueDate: '2026-10-20', amountCents: 8432, current: true },
    { id: 'inv-second', accountId: 'acct-primary', visitAccountNumber: '100104802', patientName: 'Alex Morgan', number: 'VISIT-100104802', period: 'August 2026 visit', dueDate: '2026-10-20', amountCents: 12500, current: true },
    { id: 'inv-old', accountId: 'acct-primary', visitAccountNumber: '100104800', patientName: 'Alex Morgan', number: 'VISIT-100104800', period: 'July 2026 visit', dueDate: '2026-09-20', amountCents: 7219, current: false },
    { id: 'inv-other', accountId: 'acct-secondary', visitAccountNumber: '200209901', patientName: 'Jordan Lee', number: 'VISIT-200209901', period: 'September 2026 visit', dueDate: '2026-10-20', amountCents: 5190, current: true },
  ];
}

export function medicalScope(state, { accountNumber, lastName, captcha }) {
  if (captcha !== true) throw Error('Complete the local CAPTCHA');
  if (typeof accountNumber !== 'string' || !/^\d{1,20}$/.test(accountNumber.trim()) || typeof lastName !== 'string' || !lastName.trim()) throw Error('Enter the account number without the alpha character and the guarantor last name');
  const number = accountNumber.trim();
  const visit = state.invoices.find(i => i.visitAccountNumber === number);
  const guarantor = state.accounts.find(a => a.customerNumber === number);
  const a = guarantor || state.accounts.find(a => a.id === visit?.accountId);
  if (!a || a.name.split(' ').at(-1).toLowerCase() !== lastName.trim().toLowerCase()) throw Error('Account details could not be verified');
  return { accountId: a.id, scope: guarantor ? 'guarantor' : 'visit', invoiceIds: guarantor ? state.invoices.filter(i => i.accountId === a.id).map(i => i.id) : [visit.id] };
}
