// City of Tuscaloosa Water & Sewer (Paymentus customer portal, tenant "tusl") runtime.
// Documented public policy (tuscaloosa.com/billinfo, /ach, /onlineservices, /ebill, /faqs) drives the
// rules below; private portal layouts, timing and identifiers are synthetic (see sites/tuscaloosa.json).
import {createHash, randomBytes, randomInt} from 'node:crypto';
import {walletInstrument, validateExpiry, instrumentHash} from './wallet.mjs';

export const TUS_SITE_ID = 'tuscaloosa-water';
const DAY = 86400000;
const isTus = (s, siteFor) => siteFor(s).runtime?.kind === 'tuscaloosa';
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const money = cents => '$' + (cents / 100).toFixed(2);
const sha = value => createHash('sha256').update(value).digest('hex');
const MAX_SCHEDULE_DAYS = 60; // synthetic: the live scheduling window is unobserved
const NSF_FEE_CENTS = 3000;   // documented: $30 insufficient-funds fee (municipal code 2-72)
const WALLET_TYPES = ['PayPal', 'PayPal Credit', 'Venmo', 'Apple Pay', 'Google Pay', 'Amazon Pay'];

// Units of ten cubic feet (documented); 1 unit = 74.8 gallons (documented). Charges are synthetic.
const charges = units => ({water: 1126 + 38 * units, sewer: 1240 + 45 * units, garbage: 1750});
function invoiceFor(id, svc, dueDate, units, extra = {}) {
  const lines = charges(units), due = new Date(dueDate + 'T00:00:00Z');
  const billDate = iso(due.getTime() - 15 * DAY), periodEnd = iso(due.getTime() - 20 * DAY), periodStart = iso(due.getTime() - 50 * DAY);
  return {id, accountId: svc.ownerId, serviceAccountId: svc.id, number: `${svc.accountNumber}-${dueDate.slice(0, 7).replace('-', '')}`, billDate, period: `${periodStart} to ${periodEnd}`,
    dueDate, units, gallons: Math.round(units * 74.8), lines: [{label: 'Water', amountCents: lines.water}, {label: 'Sewer', amountCents: lines.sewer}, {label: 'Garbage', amountCents: lines.garbage}],
    amountCents: lines.water + lines.sewer + lines.garbage, current: false, ...extra};
}
function pdfDocument(lines) {
  const esc = t => String(t).replace(/[^\x20-\x7e]/g, '-').replace(/[\\()]/g, c => '\\' + c);
  const content = 'BT /F1 11 Tf 50 760 Td 15 TL ' + lines.map(l => `(${esc(l)}) '`).join(' ') + ' ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let out = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export function installTuscaloosa(World, T) {
  const {need, authorized, account, event, secret, hash, credential, matches, siteFor, taskFor} = T;
  const P = World.prototype;
  const tus = s => isTus(s, siteFor);
  const policy = s => siteFor(s).documented_policy;
  const goal = s => taskFor(s).goal;
  const mail = (s, to, from, subject, text) => { const m = {id: `mail-${s.mail.length + 1}`, threadId: `thread-${s.mail.length + 1}`, from, to, subject, text, receivedAt: new Date(s.now).toISOString(), unread: true, attachments: []}; s.mail.push(m); return m; };
  const portalMail = (s, to, subject, text) => mail(s, to, 'no-reply@tuscaloosa.paymentus.billworld.test', subject, text);
  const cityMail = (s, to, subject, text) => mail(s, to, 'donotreplymunis@tuscaloosa.billworld.test', subject, text);
  const svcById = (s, id) => { const v = s.tusServiceAccounts.find(x => x.id === id); need(v, 'Account not found', 404); return v; };
  const linked = (s, a) => (a.tusLinks || []).map(id => svcById(s, id));
  const linkedSvc = (s, a, id) => { need((a.tusLinks || []).includes(id), 'Account not found in your profile', 404); return svcById(s, id); };
  const reserved = (s, inv) => s.payments.filter(p => ['posted', 'pending'].includes(p.status)).reduce((n, p) => n + (p.allocations || []).filter(x => x.invoiceId === inv.id).reduce((m, x) => m + x.amountCents, 0), 0);
  const remaining = (s, inv) => inv.amountCents - reserved(s, inv);
  const invoices = (s, svc) => s.invoices.filter(i => i.serviceAccountId === svc.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const balance = (s, svc) => invoices(s, svc).reduce((n, i) => n + Math.max(0, remaining(s, i)), 0);
  const today = s => iso(s.now);
  const nextDue = (s, svc) => invoices(s, svc).find(i => i.dueDate > today(s) && remaining(s, i) > 0)?.dueDate || null;
  const safeMethod = m => ({id: m.id, kind: m.kind, last4: m.last4, label: m.label, ...(m.expiry ? {expiry: m.expiry} : {}), ...(m.accountType ? {accountType: m.accountType} : {}), name: m.name});
  const profileView = a => ({id: a.id, email: a.email, firstName: a.tusProfile?.firstName || '', lastName: a.tusProfile?.lastName || '', phone: a.tusProfile?.phone || '', zipCode: a.tusProfile?.zipCode || ''});
  const svcView = (s, svc, a) => {
    const inv = invoices(s, svc), latest = inv.at(-1), due = inv.find(i => remaining(s, i) > 0);
    return {id: svc.id, accountNumber: svc.accountNumber, customerNumber: svc.customerNumber, name: svc.name, serviceAddress: svc.serviceAddress, dueDay: svc.dueDay,
      balanceCents: balance(s, svc), dueDate: due?.dueDate || null, latestInvoiceId: latest?.id || null, latestBillDate: latest?.billDate || null, latestAmountCents: latest?.amountCents || 0,
      autopay: {enabled: svc.autopay.enabled, method: svc.autopay.enabled ? safeMethod(a ? a.methods.find(m => m.id === svc.autopay.methodId) || {id: svc.autopay.methodId, label: 'Payment method on another profile'} : {id: svc.autopay.methodId, label: 'Saved payment method'}) : null, nextDraftDate: svc.autopay.enabled ? autopayNext(s, svc) : null, managedHere: !svc.autopay.enabled || svc.autopay.profileId === a?.id},
      ebill: {status: svc.ebill.status}, scheduled: (s.scheduledPayments || []).filter(p => p.serviceAccountId === svc.id && p.status === 'scheduled').length};
  };
  const autopayNext = (s, svc) => { const d = invoices(s, svc).find(i => i.dueDate >= svc.autopay.firstDraftDate && i.dueDate > today(s) && remaining(s, i) > 0); return d?.dueDate || nextCycleDate(s, svc); };
  const nextCycleDate = (s, svc) => { const d = new Date(s.now); for (let i = 1; i <= 62; i++) { const c = new Date(d.getTime() + i * DAY); if (c.getUTCDate() === svc.dueDay) return iso(c.getTime()); } return null; };
  const business = s => JSON.stringify({svc: s.tusServiceAccounts, invoices: s.invoices, payments: s.payments, scheduled: s.scheduledPayments, methods: s.accounts.map(a => [a.id, a.methods]), links: s.accounts.map(a => [a.id, a.tusLinks, a.tusProfile, a.registered])});
  const credentials = s => JSON.stringify(s.accounts.map(a => [a.id, a.credential]));
  const part = (s, key) => JSON.stringify(({
    autopay: () => s.tusServiceAccounts.map(v => [v.id, v.autopay]),
    ebill: () => s.tusServiceAccounts.map(v => [v.id, v.ebill]),
    payments: () => s.payments,
    scheduled: () => s.scheduledPayments,
    wallet: () => s.accounts.map(a => [a.id, a.methods, a.defaultMethodId || null]),
    profiles: () => s.accounts.map(a => [a.id, a.email, a.registered, a.tusProfile, a.tusLinks]),
    credentials: () => s.accounts.map(a => [a.id, a.credential]),
    invoices: () => s.invoices,
  })[key]());
  const PARTS = ['autopay', 'ebill', 'payments', 'scheduled', 'wallet', 'profiles', 'credentials', 'invoices'];
  const passwordRule = p => need(typeof p === 'string' && p.length >= 8 && p.length <= 64 && /[A-Za-z]/.test(p) && /[0-9]/.test(p) && !/\s/.test(p), 'Password must be 8–64 characters with at least one letter and one number and no spaces');
  const confirmationNumber = s => { let c; do c = String(randomInt(10000000, 99999999)); while (s.payments.some(p => p.confirmation === c) || (s.scheduledPayments || []).some(p => p.confirmation === c)); return c; };
  const resolveSvc = (s, accountNumber, customerNumber) => {
    need(typeof accountNumber === 'string' && typeof customerNumber === 'string' && accountNumber.trim() && customerNumber.trim(), 'Enter both your account number and customer number');
    const norm = v => v.replace(/[\s-]/g, '');
    const svc = s.tusServiceAccounts.find(v => v.accountNumber === norm(accountNumber) && v.customerNumber === norm(customerNumber));
    need(svc, 'The account number and customer number do not match our records. Both numbers are printed on your bill.');
    return svc;
  };

  P.tusSeed = function (s) {
    const g = goal(s), registration = g.type === 'tus_registration';
    s.tusServiceAccounts = [
      {id: 'svc-home', accountNumber: '2048106', customerNumber: '1001048', ownerId: 'acct-primary', name: 'ALEX MORGAN', serviceAddress: '1048 Queen City Ave, Tuscaloosa, AL 35401', dueDay: 15},
      {id: 'svc-rental', accountNumber: '2048107', customerNumber: '1001048', ownerId: 'acct-primary', name: 'ALEX MORGAN', serviceAddress: '312 Hackberry Ln, Tuscaloosa, AL 35401', dueDay: 1},
      {id: 'svc-other', accountNumber: '2099207', customerNumber: '2002099', ownerId: 'acct-secondary', name: 'JORDAN LEE', serviceAddress: '2099 Greensboro Ave, Tuscaloosa, AL 35401', dueDay: 15},
    ].map(v => ({...v, autopay: {enabled: false, methodId: null, profileId: null, enrolledAt: null, firstDraftDate: null, version: 1}, ebill: {status: 'paper', email: null, version: 1, updatedAt: null}}));
    const [home, rental, other] = s.tusServiceAccounts;
    const homeUnits = [48, 45, 44, 47, 50, 49, 53, 58, 61, 64, 59, 52];
    const homeDue = ['2025-11-15', '2025-12-15', '2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15', '2026-05-15', '2026-06-15', '2026-07-15', '2026-08-15', '2026-09-15', '2026-10-15'];
    s.invoices = homeDue.map((d, i) => invoiceFor(i === 11 ? 'inv-current' : i === 10 ? 'inv-old' : `inv-home-${d.slice(0, 7)}`, home, d, homeUnits[i], {current: i === 11}));
    s.invoices.push(invoiceFor('inv-rental-2026-09', rental, '2026-09-01', 21), invoiceFor('inv-rental-current', rental, '2026-10-01', 23, {current: true}), invoiceFor('inv-other', other, '2026-10-15', 15, {current: true}));
    s.payments = s.invoices.filter(i => !['inv-current', 'inv-other'].includes(i.id)).map((i, n) => {
      const rentalBill = i.serviceAccountId === 'svc-rental', when = Date.parse(i.dueDate + 'T12:00:00Z') - (rentalBill ? 0 : 3 * DAY);
      return {id: `pay-hist-${n + 1}`, invoiceId: i.id, accountId: 'acct-primary', serviceAccountId: i.serviceAccountId, allocations: [{invoiceId: i.id, amountCents: i.amountCents}], amountCents: i.amountCents, feeCents: 0,
        method: rentalBill ? {kind: 'card', last4: '4242', label: 'Visa ending 4242'} : {kind: 'bank', last4: '1048', label: 'Checking ending 1048'}, status: 'posted', source: rentalBill ? 'autopay' : 'portal',
        confirmation: String(31000000 + n * 7919), paymentDate: iso(when), createdAt: when, initial: true, authenticated: true};
    });
    s.scheduledPayments = [];
    for (const a of s.accounts) {
      a.methods = [];
      a.tusProfile = a.registered ? {firstName: a.name.split(' ')[0], lastName: a.name.split(' ').at(-1), phone: a.id === 'acct-primary' ? '2055550148' : '2055550299', zipCode: '35401'} : null;
      a.tusLinks = a.registered ? s.tusServiceAccounts.filter(v => v.ownerId === a.id).map(v => v.id) : [];
    }
    const alex = s.accounts[0];
    if (registration) { alex.registered = false; alex.tusProfile = null; alex.tusLinks = []; alex.credential = null; }
    else {
      alex.methods = [
        {id: 'bank-1048', kind: 'bank', last4: '1048', label: 'Checking ending 1048', accountType: 'Checking', name: 'Alex Morgan', instrumentHash: instrumentHash('bank', '000001048', '021000021'), version: 1},
        {id: 'card-4242', kind: 'card', last4: '4242', label: 'Visa ending 4242', expiry: '12/29', name: 'Alex Morgan', instrumentHash: instrumentHash('card', '4242424242424242'), version: 1},
      ];
      rental.autopay = {enabled: true, methodId: 'card-4242', profileId: 'acct-primary', enrolledAt: s.now - 120 * DAY, firstDraftDate: '2026-07-01', version: 1};
      if (g.type === 'tus_autopay') home.autopay = {enabled: true, methodId: 'card-4242', profileId: 'acct-primary', enrolledAt: s.now - 40 * DAY, firstDraftDate: '2026-09-15', version: 1};
      if (g.type === 'tus_schedule') {
        s.scheduledPayments.push(
          {id: 'sch-1', accountId: 'acct-primary', profileId: 'acct-primary', serviceAccountId: 'svc-home', amountCents: 8432, date: '2026-10-14', method: safeMethod(alex.methods[1]), methodId: 'card-4242', status: 'scheduled', confirmation: '41000001', createdAt: s.now - 2 * DAY, version: 1},
          {id: 'sch-2', accountId: 'acct-primary', profileId: 'acct-primary', serviceAccountId: 'svc-home', amountCents: 2000, date: '2026-10-09', method: safeMethod(alex.methods[0]), methodId: 'bank-1048', status: 'scheduled', confirmation: '41000002', createdAt: s.now - DAY, version: 1});
      }
    }
    s.mail = [];
    cityMail(s, 'alex@billworld.test', 'Your City of Tuscaloosa water bill is ready', `Account Number 2048106, Customer Number 1001048 (1048 Queen City Ave). Statement date ${s.invoices.find(i => i.id === 'inv-current').billDate}: water, sewer and garbage total $84.32, due October 15, 2026. Usage: 52 units (520 cubic feet, about 3,890 gallons). Pay online with no fees at tuscaloosa.com/pay-water-bill. This is a Billworld simulation message.`);
    if (!registration) portalMail(s, 'alex@billworld.test', 'AutoPay payment processed', 'An AutoPay payment of ' + money(s.invoices.find(i => i.id === 'inv-rental-current').amountCents) + ' for account 2048107 (312 Hackberry Ln) was processed on 10/01/2026 using Visa ending 4242.');
    s.tusRegistrations = []; s.tusEBillSubmissions = []; s.tusDownloads = [];
    s.tusBaseline = Object.fromEntries(PARTS.map(k => [k, part(s, k)]));
  };

  // ---------- authentication ----------
  P.tusLogin = function (id, {email, password} = {}) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404);
      const a = s.accounts.find(x => x.registered && x.email.toLowerCase() === String(email || '').trim().toLowerCase());
      if (!a || !a.credential || !matches(password, a.credential)) { event(s, 'tus_login_failed', {}); need(false, 'The email or password you entered is incorrect.', 401); }
      const token = secret(); s.sessions[token] = {accountId: a.id, expires: s.now + 30 * 60000}; event(s, 'login', {accountId: a.id}); event(s, 'tus_login', {accountId: a.id});
      return {session: token, profile: profileView(a), needsAccount: !(a.tusLinks || []).length};
    });
  };
  P.tusLogout = function (id, session) { return this.transact(id, s => { if (s.sessions[session]) { event(s, 'tus_logout', {accountId: s.sessions[session].accountId}); delete s.sessions[session]; } return {ok: true}; }); };
  P.tusProfile = function (id, session) {
    const s = this.state(id); need(tus(s), 'Unavailable', 404);
    const sess = s.sessions[session]; if (!sess || sess.expires <= s.now) return {profile: null, today: today(s)};
    const a = account(s, sess.accountId); return {profile: profileView(a), linked: (a.tusLinks || []).length, today: today(s)};
  };
  P.tusRegister = function (id, input = {}) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404);
      const email = String(input.email || '').trim().toLowerCase();
      need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter a valid email address');
      need(email === String(input.confirmEmail || '').trim().toLowerCase(), 'Email addresses do not match');
      passwordRule(input.password); need(input.password === input.confirmPassword, 'Passwords do not match');
      for (const [k, label] of [['firstName', 'first name'], ['lastName', 'last name']]) need(typeof input[k] === 'string' && input[k].trim().length > 0 && input[k].length <= 50, `Enter your ${label}`);
      const phone = String(input.phone || '').replace(/\D/g, ''); need(/^\d{10}$/.test(phone), 'Enter a 10-digit phone number');
      need(/^\d{5}$/.test(String(input.zipCode || '')), 'Enter a 5-digit ZIP code');
      need(input.acceptTerms === true, 'Accept the Terms and Conditions to continue');
      let a = s.accounts.find(x => x.email.toLowerCase() === email);
      need(!a?.registered, 'A profile with this email already exists. Sign in or use Forgot Password.');
      if (!a) { a = {id: `acct-new-${s.accounts.length + 1}`, customerNumber: null, name: `${input.firstName.trim()} ${input.lastName.trim()}`, email, registered: false, credential: null, autopay: {enabled: false, methodId: null}, methods: [], tusLinks: []}; s.accounts.push(a); }
      a.registered = true; a.credential = credential(input.password); a.tusProfile = {firstName: input.firstName.trim(), lastName: input.lastName.trim(), phone, zipCode: input.zipCode}; a.tusLinks = []; a.methods = a.methods || [];
      s.tusRegistrations.push({accountId: a.id, at: s.now}); event(s, 'tus_registered', {accountId: a.id}); event(s, 'registered', {accountId: a.id, identityMethod: 'tus_profile'});
      portalMail(s, a.email, 'Welcome to the City of Tuscaloosa customer portal', `Your customer portal profile for ${a.email} was created. Add your water account using the Account Number and Customer Number printed on your bill. You can then pay with no fees, view your past 12 bills and set up AutoPay.`);
      const token = secret(); s.sessions[token] = {accountId: a.id, expires: s.now + 30 * 60000}; event(s, 'login', {accountId: a.id}); event(s, 'tus_login', {accountId: a.id, afterRegistration: true});
      return {session: token, profile: profileView(a)};
    });
  };
  P.tusProfileUpdate = function (id, session, input = {}) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404); const a = authorized(s, session);
      for (const [k, label] of [['firstName', 'first name'], ['lastName', 'last name']]) need(typeof input[k] === 'string' && input[k].trim().length > 0 && input[k].length <= 50, `Enter your ${label}`);
      const phone = String(input.phone || '').replace(/\D/g, ''); need(/^\d{10}$/.test(phone), 'Enter a 10-digit phone number'); need(/^\d{5}$/.test(String(input.zipCode || '')), 'Enter a 5-digit ZIP code');
      a.tusProfile = {firstName: input.firstName.trim(), lastName: input.lastName.trim(), phone, zipCode: input.zipCode}; event(s, 'tus_profile_updated', {accountId: a.id}); return {profile: profileView(a)};
    });
  };
  // ---------- password recovery (email link) ----------
  P.tusRecoveryRequest = function (id, {email} = {}) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404); need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim()), 'Enter a valid email address');
      const a = s.accounts.find(x => x.registered && x.email.toLowerCase() === String(email).trim().toLowerCase());
      if (a) {
        for (const c of Object.values(s.challenges)) if (c.kind === 'tus_reset' && c.accountId === a.id && !c.used) { c.used = true; c.superseded = true; }
        const token = secret(); s.challenges[hash(token)] = {kind: 'tus_reset', accountId: a.id, used: false, expires: s.now + 30 * 60000};
        event(s, 'tus_recovery_requested', {accountId: a.id});
        portalMail(s, a.email, 'Reset your City of Tuscaloosa customer portal password', `We received a request to reset the password for ${a.email}. Open /cp/tusl/reset?token=${token} to choose a new password. This link expires in 30 minutes and can be used once. If you did not request this, you can ignore this email.`);
      }
      return {message: 'If a profile exists for that email address, we sent instructions to reset your password. Check your email.'};
    });
  };
  const resetGrant = (s, token) => { const c = s.challenges[hash(String(token || ''))]; need(c?.kind === 'tus_reset' && !c.used && c.expires > s.now, 'This password reset link has expired or was already used. Request a new link.', 401); return c; };
  P.tusRecoveryGrant = function (id, token, opened = false) { return this.transact(id, s => { need(tus(s), 'Unavailable', 404); const c = resetGrant(s, token); if (opened) event(s, 'tus_recovery_link_opened', {accountId: c.accountId}); return {email: account(s, c.accountId).email}; }); };
  P.tusRecoveryComplete = function (id, token, {password, confirmPassword} = {}) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404); const c = resetGrant(s, token); passwordRule(password); need(password === confirmPassword, 'Passwords do not match');
      const a = account(s, c.accountId); need(!matches(password, a.credential), 'Choose a password you have not used for this profile');
      a.credential = credential(password); c.used = true;
      for (const [k, v] of Object.entries(s.sessions)) if (v.accountId === a.id) delete s.sessions[k];
      event(s, 'password_reset', {accountId: a.id, identityMethod: 'tus_email_link'});
      portalMail(s, a.email, 'Your customer portal password was changed', 'The password for your City of Tuscaloosa customer portal profile was changed. If you did not make this change, contact ubcontact@tuscaloosa.com or 205-248-5500.');
      return {ok: true};
    });
  };
  // ---------- account linking (Account Number + Customer Number, documented) ----------
  P.tusLinkVerify = function (id, session, input = {}) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404); const a = authorized(s, session);
      const svc = resolveSvc(s, input.accountNumber, input.customerNumber);
      need(!(a.tusLinks || []).includes(svc.id), 'This account is already in your profile');
      for (const c of Object.values(s.challenges)) if (c.kind === 'tus_link' && c.accountId === a.id && !c.used) { c.used = true; c.superseded = true; }
      const token = secret(); s.challenges[hash(token)] = {kind: 'tus_link', accountId: a.id, session, serviceAccountId: svc.id, used: false, expires: s.now + 20 * 60000};
      event(s, 'tus_account_verified', {accountId: a.id, serviceAccountId: svc.id}); return {token};
    });
  };
  const linkGrant = (s, a, session, token, receipt = false) => { const c = s.challenges[hash(String(token || ''))]; need(c?.kind === 'tus_link' && c.accountId === a.id && c.session === session && !c.superseded, 'Account verification is unavailable. Enter your account details again.', 404); need(receipt ? c.used : !c.used && c.expires > s.now, receipt ? 'Account verification is unavailable.' : 'Account verification expired. Enter your account details again.', 409); return c; };
  P.tusLinkReview = function (id, session, token, receipt = false) {
    const s = this.state(id); need(tus(s), 'Unavailable', 404); const a = authorized(s, session), c = linkGrant(s, a, session, token, receipt), svc = svcById(s, c.serviceAccountId);
    return {account: {accountNumber: svc.accountNumber, customerNumber: svc.customerNumber, name: svc.name, serviceAddress: svc.serviceAddress}, linked: c.used};
  };
  P.tusLinkConfirm = function (id, session, token, {acceptTerms} = {}) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404); const a = authorized(s, session), c = linkGrant(s, a, session, token);
      need(acceptTerms === true, 'Confirm that you are authorized to manage this account');
      need(!(a.tusLinks || []).includes(c.serviceAccountId), 'This account is already in your profile');
      a.tusLinks = [...(a.tusLinks || []), c.serviceAccountId]; c.used = true; event(s, 'tus_account_linked', {accountId: a.id, serviceAccountId: c.serviceAccountId}); return {linked: true};
    });
  };
  P.tusAccounts = function (id, session) {
    return this.transact(id, s => { need(tus(s), 'Unavailable', 404); const a = authorized(s, session); event(s, 'tus_accounts_viewed', {accountId: a.id}); return {profile: profileView(a), accounts: linked(s, a).map(v => svcView(s, v, a)), synthetic: true}; });
  };
  // ---------- bills & statements ----------
  const billView = (s, i) => ({id: i.id, number: i.number, billDate: i.billDate, period: i.period, dueDate: i.dueDate, units: i.units, gallons: i.gallons, lines: i.lines, amountCents: i.amountCents, remainingCents: Math.max(0, remaining(s, i)), status: remaining(s, i) <= 0 ? 'Paid' : i.dueDate < today(s) ? 'Past due' : 'Due', filename: statementName(s, i)});
  const statementName = (s, i) => `tuscaloosa-water-${svcById(s, i.serviceAccountId).accountNumber}-${i.billDate}.pdf`;
  P.tusBills = function (id, session, svcId) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404); const a = authorized(s, session), svc = linkedSvc(s, a, svcId);
      event(s, 'tus_bills_viewed', {accountId: a.id, serviceAccountId: svc.id});
      return {account: svcView(s, svc, a), bills: invoices(s, svc).slice(-12).reverse().map(i => billView(s, i)), coverage: 'Past 12 bills (documented capability); line items and amounts are synthetic.'};
    });
  };
  P.tusStatement = function (id, session, invoiceId) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404); const a = authorized(s, session), inv = s.invoices.find(i => i.id === invoiceId); need(inv && (a.tusLinks || []).includes(inv.serviceAccountId), 'Bill not found', 404);
      const svc = svcById(s, inv.serviceAccountId);
      const lines = ['City of Tuscaloosa Water & Sewer Department', 'P.O. Box 2090, Tuscaloosa, AL 35403  |  205-248-5500', 'BILLWORLD SIMULATION - SYNTHETIC STATEMENT', '',
        `Account Number: ${svc.accountNumber}    Customer Number: ${svc.customerNumber}`, `Name: ${svc.name}`, `Service Address: ${svc.serviceAddress}`, '',
        `Statement Date: ${inv.billDate}    Due Date: ${inv.dueDate}`, `Service Period: ${inv.period}`, `Usage: ${inv.units} units of 10 cubic feet (${inv.gallons} gallons)`, '',
        ...inv.lines.map(l => `${l.label.padEnd(12)} ${money(l.amountCents)}`), `Total Amount Due: ${money(inv.amountCents)}`, '',
        'Please include your customer number on checks. Pay online with no fees.'];
      const bytes = pdfDocument(lines), filename = statementName(s, inv), digest = sha(bytes);
      s.tusDownloads.push({accountId: a.id, invoiceId: inv.id, filename, sha256: digest, at: s.now});
      event(s, 'tus_statement_downloaded', {accountId: a.id, serviceAccountId: svc.id, invoiceId: inv.id, filename, sha256: digest});
      return {filename, bytes, sha256: digest};
    });
  };
  // ---------- payment method validation ----------
  function newInstrument(s, input, allowSave) {
    need(['bank', 'card'].includes(input.kind), 'Choose a payment method');
    let m;
    try {
      m = walletInstrument(input.kind === 'bank' ? {kind: 'bank', name: input.name, routing: input.routing, accountNumber: input.accountNumber, confirmAccountNumber: input.confirmAccountNumber} : {kind: 'card', name: input.name, cardNumber: String(input.cardNumber || '').replace(/\s/g, ''), cvv: input.cvv, expiry: input.expiry}, s.now);
    } catch (e) { need(false, e.message); }
    if (input.kind === 'bank') { need(['Checking', 'Savings'].includes(input.accountType), 'Choose checking or savings'); m.accountType = input.accountType; m.label = `${input.accountType} ending ${m.last4}`; m.nsf = String(input.accountNumber).endsWith('0009'); }
    else { need(/^\d{5}$/.test(String(input.zipCode || '')), 'Enter the card billing ZIP code'); m.zipCode = input.zipCode; }
    return {...m, save: allowSave && input.saveMethod === true};
  }
  const savedMethod = (a, methodId) => { const m = (a.methods || []).find(x => x.id === methodId); need(m, 'Choose a saved payment method'); return m; };
  // ---------- one-time payment (signed-in or guest) ----------
  P.tusGuestLookup = function (id, input = {}) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404); const svc = resolveSvc(s, input.accountNumber, input.customerNumber);
      for (const c of Object.values(s.challenges)) if (c.kind === 'tus_guest' && !c.used) c.used = true;
      const token = secret(); s.challenges[hash(token)] = {kind: 'tus_guest', serviceAccountId: svc.id, used: false, expires: s.now + 20 * 60000};
      event(s, 'tus_guest_lookup', {serviceAccountId: svc.id}); return {token};
    });
  };
  const guestGrant = (s, token) => { const c = s.challenges[hash(String(token || ''))]; need(c?.kind === 'tus_guest' && !c.used && c.expires > s.now, 'Your one-time payment session expired. Enter your account number and customer number again.', 401); return c; };
  P.tusGuest = function (id, token) {
    const s = this.state(id); need(tus(s), 'Unavailable', 404); const c = guestGrant(s, token), svc = svcById(s, c.serviceAccountId), due = invoices(s, svc).find(i => remaining(s, i) > 0);
    return {account: {accountNumber: svc.accountNumber, serviceAddress: svc.serviceAddress.replace(/^\d+/, '***'), balanceCents: balance(s, svc), dueDate: due?.dueDate || null}};
  };
  P.tusQuote = function (id, session, guestToken, input = {}) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404);
      let a = null, svc, guest = false;
      if (input.guest === true) { const c = guestGrant(s, guestToken); svc = svcById(s, c.serviceAccountId); guest = true; }
      else { a = authorized(s, session); svc = linkedSvc(s, a, input.serviceAccountId); }
      const bal = balance(s, svc); need(bal > 0, 'This account has no balance due');
      need(Number.isSafeInteger(input.amountCents) && input.amountCents >= 100, 'Enter a payment amount of at least $1.00');
      need(input.amountCents <= bal, `The payment amount cannot exceed the balance due of ${money(bal)}`);
      const date = guest ? today(s) : String(input.paymentDate || today(s));
      need(/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date + 'T00:00:00Z')), 'Choose a payment date');
      need(date >= today(s), 'The payment date cannot be in the past');
      need(Date.parse(date + 'T00:00:00Z') - Date.parse(today(s) + 'T00:00:00Z') <= MAX_SCHEDULE_DAYS * DAY, `Choose a payment date within ${MAX_SCHEDULE_DAYS} days`);
      let method;
      if (!guest && input.methodId) { const m = savedMethod(a, input.methodId); try { validateExpiry(m.expiry || '12/99', s.now); } catch (e) { need(m.kind !== 'card', 'This card has expired. Update it in My Wallet or choose another method.'); } method = {...m, saved: true}; }
      else method = newInstrument(s, input, !guest);
      need(!(method.kind === 'card' && method.decline), 'Payment method was declined');
      const email = guest ? String(input.email || '').trim() : a.email;
      need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter an email address for your receipt');
      for (const q of Object.values(s.quotes)) if (q.purpose === 'tus_payment' && !q.paymentId && (guest ? q.guest && q.serviceAccountId === svc.id : q.profileId === a.id)) q.superseded = true;
      const token = secret(), q = {purpose: 'tus_payment', guest, profileId: a?.id || null, session: guest ? null : session, guestToken: guest ? hash(String(guestToken)) : null, serviceAccountId: svc.id, amountCents: input.amountCents, feeCents: 0, paymentDate: date,
        method: {id: method.saved ? method.id : null, kind: method.kind, last4: method.last4, label: method.label, name: method.name, ...(method.expiry ? {expiry: method.expiry} : {}), ...(method.accountType ? {accountType: method.accountType} : {}), ...(method.zipCode ? {zipCode: method.zipCode} : {}), instrumentHash: method.instrumentHash, version: method.version || 1, nsf: Boolean(method.nsf)},
        saveMethod: Boolean(method.save), receiptEmail: email, expires: s.now + 15 * 60000, paymentId: null, scheduleId: null, superseded: false};
      s.quotes[hash(token)] = q; event(s, 'tus_payment_reviewed', {accountId: a?.id || null, serviceAccountId: svc.id, guest});
      return {token, review: reviewView(s, q)};
    });
  };
  const reviewView = (s, q) => { const svc = svcById(s, q.serviceAccountId); return {guest: q.guest, account: {accountNumber: svc.accountNumber, serviceAddress: q.guest ? svc.serviceAddress.replace(/^\d+/, '***') : svc.serviceAddress, id: q.guest ? null : svc.id}, amountCents: q.amountCents, feeCents: 0, totalCents: q.amountCents, paymentDate: q.paymentDate, scheduled: q.paymentDate > today(s), method: {kind: q.method.kind, label: q.method.label, name: q.method.name}, saveMethod: q.saveMethod, receiptEmail: q.receiptEmail, completed: Boolean(q.paymentId || q.scheduleId), confirmation: q.paymentId ? s.payments.find(p => p.id === q.paymentId)?.confirmation : q.scheduleId ? s.scheduledPayments.find(p => p.id === q.scheduleId)?.confirmation : null, status: q.paymentId ? s.payments.find(p => p.id === q.paymentId)?.status : q.scheduleId ? 'scheduled' : null}; };
  const quoteFor = (s, session, guestToken, token) => {
    const q = s.quotes[hash(String(token || ''))]; need(q?.purpose === 'tus_payment', 'Payment review is unavailable. Start your payment again.', 404);
    if (q.guest) need(q.guestToken === hash(String(guestToken || '')), 'Payment review is unavailable. Start your payment again.', 404);
    else { const a = authorized(s, session); need(q.profileId === a.id && q.session === session, 'Payment review is unavailable. Start your payment again.', 404); }
    return q;
  };
  P.tusReview = function (id, session, guestToken, token, receipt = false) {
    const s = this.state(id); need(tus(s), 'Unavailable', 404); const q = quoteFor(s, session, guestToken, token);
    if (receipt) need(q.paymentId || q.scheduleId, 'No completed payment to show', 404); else need(!q.superseded && (q.paymentId || q.scheduleId || q.expires > s.now), 'Payment review expired. Start your payment again.', 409);
    return reviewView(s, q);
  };
  const allocate = (s, svc, amount) => { const out = []; let left = amount; for (const i of invoices(s, svc)) { const r = remaining(s, i); if (r > 0 && left > 0) { const x = Math.min(r, left); out.push({invoiceId: i.id, amountCents: x}); left -= x; } } return {allocations: out, unallocated: left}; };
  function postPayment(s, {profileId, svc, amountCents, method, source, authenticated, receiptEmail, date, scheduleId = null}) {
    const {allocations} = allocate(s, svc, amountCents), applied = allocations.reduce((n, x) => n + x.amountCents, 0);
    const returned = method.kind === 'bank' && method.nsf && source !== 'portal' && source !== 'guest';
    const p = {id: `pay-${s.payments.length + 1}`, invoiceId: allocations[0]?.invoiceId || null, accountId: profileId || svc.ownerId, profileId, serviceAccountId: svc.id, allocations: returned ? [] : allocations, amountCents: applied, feeCents: 0,
      method: {id: method.id || null, kind: method.kind, last4: method.last4, label: method.label, instrumentHash: method.instrumentHash, ...(method.expiry ? {expiry: method.expiry} : {}), name: method.name, ...(method.zipCode ? {zipCode: method.zipCode} : {})},
      status: returned ? 'returned' : 'posted', source, authenticated, receiptEmail, paymentDate: date, createdAt: s.now, confirmation: confirmationNumber(s), scheduleId};
    s.payments.push(p);
    return p;
  }
  P.tusPay = function (id, session, guestToken, token, {authorize} = {}) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404); const q = quoteFor(s, session, guestToken, token);
      if (q.paymentId || q.scheduleId) return reviewView(s, q);
      need(!q.superseded, 'This payment review was replaced by a newer one. Start your payment again.', 409); need(q.expires > s.now, 'Payment review expired. Start your payment again.', 409);
      need(authorize === true, 'Check the box to authorize this payment');
      const svc = svcById(s, q.serviceAccountId), a = q.profileId ? account(s, q.profileId) : null;
      if (q.method.id) { const m = a.methods.find(x => x.id === q.method.id); need(m && m.version === q.method.version && m.instrumentHash === q.method.instrumentHash, 'Your saved payment method changed. Review the payment again.', 409); }
      need(q.amountCents <= balance(s, svc), 'The balance changed. Review the payment again.', 409);
      let methodId = q.method.id;
      if (q.saveMethod) {
        const existing = a.methods.find(m => m.instrumentHash === q.method.instrumentHash);
        if (existing) methodId = existing.id;
        else { const {nsf, ...stored} = q.method; methodId = `${q.method.kind}-${q.method.last4}-${a.methods.length + 1}`; a.methods.push({...stored, id: methodId, version: 1, ...(nsf ? {nsf} : {})}); event(s, 'payment_method_added', {accountId: a.id, methodId}); }
      }
      if (q.paymentDate > today(s)) {
        const p = {id: `sch-${s.scheduledPayments.length + 1}-${randomBytes(3).toString('hex')}`, accountId: a.id, profileId: a.id, serviceAccountId: svc.id, amountCents: q.amountCents, date: q.paymentDate, method: {kind: q.method.kind, last4: q.method.last4, label: q.method.label}, methodId, instrument: methodId ? null : q.method, status: 'scheduled', confirmation: confirmationNumber(s), createdAt: s.now, version: 1};
        s.scheduledPayments.push(p); q.scheduleId = p.id; event(s, 'tus_payment_scheduled', {accountId: a.id, scheduleId: p.id, serviceAccountId: svc.id, amountCents: p.amountCents, date: p.date});
        portalMail(s, q.receiptEmail, 'Your payment is scheduled', `A payment of ${money(p.amountCents)} for account ${svc.accountNumber} is scheduled for ${p.date} using ${p.method.label}. Confirmation number: ${p.confirmation}. You can edit or cancel it from Payment History before that date. Convenience fee: $0.00.`);
        return reviewView(s, q);
      }
      const p = postPayment(s, {profileId: a?.id || null, svc, amountCents: q.amountCents, method: {...q.method, id: methodId}, source: q.guest ? 'guest' : 'portal', authenticated: !q.guest, receiptEmail: q.receiptEmail, date: today(s)});
      q.paymentId = p.id; event(s, 'payment_submitted', {accountId: a?.id || null, paymentId: p.id, serviceAccountId: svc.id, guest: q.guest});
      portalMail(s, q.receiptEmail, 'Payment confirmation - City of Tuscaloosa Water and Sewer', `Thank you. Your payment of ${money(p.amountCents)} for account ${svc.accountNumber} was received on ${p.paymentDate} using ${p.method.label}. Convenience fee: $0.00. Confirmation number: ${p.confirmation}.`);
      return reviewView(s, q);
    });
  };
  // ---------- history & scheduled payments ----------
  P.tusHistory = function (id, session) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404); const a = authorized(s, session), ids = new Set(a.tusLinks || []), acct = id2 => svcById(s, id2).accountNumber;
      event(s, 'tus_history_viewed', {accountId: a.id});
      return {payments: s.payments.filter(p => ids.has(p.serviceAccountId)).sort((x, y) => (y.paymentDate || '').localeCompare(x.paymentDate || '') || y.createdAt - x.createdAt).map(p => ({id: p.id, accountNumber: acct(p.serviceAccountId), amountCents: p.amountCents, feeCents: p.feeCents, date: p.paymentDate, method: p.method.label, status: p.status, source: p.source, confirmation: p.confirmation})),
        scheduled: (s.scheduledPayments || []).filter(p => ids.has(p.serviceAccountId) && p.profileId === a.id).sort((x, y) => x.date.localeCompare(y.date)).map(p => ({id: p.id, serviceAccountId: p.serviceAccountId, accountNumber: acct(p.serviceAccountId), amountCents: p.amountCents, date: p.date, method: p.method.label, methodId: p.methodId, status: p.status, confirmation: p.confirmation})),
        methods: a.methods.map(safeMethod), coverage: 'Local seeded and submitted payments; live retention unverified.'};
    });
  };
  const ownedSchedule = (s, a, scheduleId) => { const p = (s.scheduledPayments || []).find(x => x.id === scheduleId && x.profileId === a.id && (a.tusLinks || []).includes(x.serviceAccountId)); need(p, 'Scheduled payment not found', 404); need(p.status === 'scheduled', 'Only scheduled payments can be changed'); return p; };
  P.tusScheduleEdit = function (id, session, input = {}) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404); const a = authorized(s, session), p = ownedSchedule(s, a, input.scheduleId), svc = svcById(s, p.serviceAccountId);
      need(Number.isSafeInteger(input.amountCents) && input.amountCents >= 100, 'Enter a payment amount of at least $1.00'); need(input.amountCents <= balance(s, svc), `The payment amount cannot exceed the balance due of ${money(balance(s, svc))}`);
      const date = String(input.date || ''); need(/^\d{4}-\d{2}-\d{2}$/.test(date), 'Choose a payment date'); need(date > today(s), 'Choose a future date. To pay today, cancel this payment and make a new payment.');
      need(Date.parse(date + 'T00:00:00Z') - Date.parse(today(s) + 'T00:00:00Z') <= MAX_SCHEDULE_DAYS * DAY, `Choose a payment date within ${MAX_SCHEDULE_DAYS} days`);
      const m = savedMethod(a, input.methodId); if (m.kind === 'card') { try { validateExpiry(m.expiry, s.now); } catch { need(false, 'This card has expired'); } }
      const before = {amountCents: p.amountCents, date: p.date, methodId: p.methodId};
      if (before.amountCents === input.amountCents && before.date === date && before.methodId === m.id) return {changed: false};
      Object.assign(p, {amountCents: input.amountCents, date, methodId: m.id, instrument: null, method: {kind: m.kind, last4: m.last4, label: m.label}, version: p.version + 1, updatedAt: s.now});
      event(s, 'tus_schedule_edited', {accountId: a.id, scheduleId: p.id, before, after: {amountCents: p.amountCents, date, methodId: m.id}});
      portalMail(s, a.email, 'Your scheduled payment was updated', `Your scheduled payment ${p.confirmation} for account ${svc.accountNumber} is now ${money(p.amountCents)} on ${p.date} using ${p.method.label}.`);
      return {changed: true};
    });
  };
  P.tusScheduleCancel = function (id, session, {scheduleId} = {}) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404); const a = authorized(s, session), p = ownedSchedule(s, a, scheduleId), svc = svcById(s, p.serviceAccountId);
      p.status = 'cancelled'; p.cancelledAt = s.now; p.version++; event(s, 'tus_schedule_cancelled', {accountId: a.id, scheduleId: p.id});
      portalMail(s, a.email, 'Your scheduled payment was cancelled', `Scheduled payment ${p.confirmation} of ${money(p.amountCents)} for account ${svc.accountNumber} on ${p.date} was cancelled. No payment will be made.`);
      return {cancelled: true};
    });
  };
  // ---------- AutoPay (documented: drafts on the bill due date, the 1st or 15th) ----------
  P.tusAutoPay = function (id, session) {
    return this.transact(id, s => { need(tus(s), 'Unavailable', 404); const a = authorized(s, session); event(s, 'tus_autopay_viewed', {accountId: a.id}); return {accounts: linked(s, a).map(v => svcView(s, v, a)), methods: a.methods.map(safeMethod)}; });
  };
  P.tusAutoPayQuote = function (id, session, input = {}) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404); const a = authorized(s, session), svc = linkedSvc(s, a, input.serviceAccountId);
      need(typeof input.enabled === 'boolean', 'Choose an AutoPay action');
      need(!svc.autopay.enabled || svc.autopay.profileId === a.id, 'AutoPay for this account is managed from another profile', 403);
      let method = null;
      if (input.enabled) {
        method = input.methodId ? savedMethod(a, input.methodId) : null; need(method, 'Choose a saved payment method for AutoPay. Add one in My Wallet first.');
        if (method.kind === 'card') { try { validateExpiry(method.expiry, s.now); } catch { need(false, 'This card has expired'); } }
        need(!(svc.autopay.enabled && svc.autopay.methodId === method.id), 'AutoPay already uses this payment method');
      } else need(svc.autopay.enabled, 'AutoPay is not active for this account');
      for (const q of Object.values(s.quotes)) if (q.purpose === 'tus_autopay' && q.profileId === a.id && !q.applied) q.superseded = true;
      const firstDraft = input.enabled ? (svc.autopay.enabled ? autopayNext(s, svc) : (invoices(s, svc).find(i => i.dueDate > today(s) && remaining(s, i) > 0)?.dueDate || nextCycleDate(s, svc))) : null;
      const token = secret(), q = {purpose: 'tus_autopay', profileId: a.id, session, serviceAccountId: svc.id, enabled: input.enabled, change: svc.autopay.enabled && input.enabled, methodId: method?.id || null, methodVersion: method?.version || null, previous: JSON.stringify(svc.autopay), firstDraftDate: firstDraft, expires: s.now + 15 * 60000, applied: false, superseded: false};
      s.quotes[hash(token)] = q; event(s, 'tus_autopay_reviewed', {accountId: a.id, serviceAccountId: svc.id, enabled: q.enabled});
      return {token, review: autopayReview(s, a, q)};
    });
  };
  const autopayReview = (s, a, q) => { const svc = svcById(s, q.serviceAccountId), m = q.methodId ? a.methods.find(x => x.id === q.methodId) : null, prev = JSON.parse(q.previous); return {account: {id: svc.id, accountNumber: svc.accountNumber, serviceAddress: svc.serviceAddress, dueDay: svc.dueDay}, enabled: q.enabled, change: q.change, method: m ? safeMethod(m) : null, previousMethod: prev.enabled ? safeMethod(a.methods.find(x => x.id === prev.methodId) || {id: prev.methodId, label: 'Saved payment method'}) : null, firstDraftDate: q.firstDraftDate, applied: q.applied, feeCents: 0}; };
  const autopayGrant = (s, a, session, token) => { const q = s.quotes[hash(String(token || ''))]; need(q?.purpose === 'tus_autopay' && q.profileId === a.id && q.session === session, 'AutoPay review is unavailable. Start again from AutoPay.', 404); return q; };
  P.tusAutoPayReview = function (id, session, token) { const s = this.state(id); need(tus(s), 'Unavailable', 404); const a = authorized(s, session), q = autopayGrant(s, a, session, token); need(q.applied || !q.superseded && q.expires > s.now, 'AutoPay review expired. Start again from AutoPay.', 409); return autopayReview(s, a, q); };
  P.tusAutoPayConfirm = function (id, session, token, {authorize} = {}) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404); const a = authorized(s, session), q = autopayGrant(s, a, session, token);
      if (q.applied) return autopayReview(s, a, q);
      need(!q.superseded && q.expires > s.now, 'AutoPay review expired. Start again from AutoPay.', 409);
      need(authorize === true, q.enabled ? 'Check the box to authorize recurring AutoPay drafts' : 'Check the box to confirm cancelling AutoPay');
      const svc = svcById(s, q.serviceAccountId); need(JSON.stringify(svc.autopay) === q.previous, 'AutoPay settings changed. Review again.', 409);
      if (q.enabled) { const m = a.methods.find(x => x.id === q.methodId); need(m && m.version === q.methodVersion, 'Your saved payment method changed. Review again.', 409); }
      const before = svc.autopay;
      svc.autopay = q.enabled ? {enabled: true, methodId: q.methodId, profileId: a.id, enrolledAt: q.change ? before.enrolledAt : s.now, firstDraftDate: q.change ? before.firstDraftDate : q.firstDraftDate, version: before.version + 1} : {enabled: false, methodId: null, profileId: null, enrolledAt: null, firstDraftDate: null, version: before.version + 1, cancelledAt: s.now};
      q.applied = true;
      event(s, 'autopay_changed', {accountId: a.id, serviceAccountId: svc.id, enabled: q.enabled, methodId: q.methodId, change: q.change});
      const m = q.enabled ? a.methods.find(x => x.id === q.methodId) : null;
      // Documented: a confirmation email follows enrollment (live delay 5-10 minutes; delivered immediately here).
      portalMail(s, a.email, q.enabled ? (q.change ? 'Your AutoPay payment method was updated' : 'AutoPay enrollment confirmation') : 'Your AutoPay was cancelled',
        q.enabled ? `AutoPay for account ${svc.accountNumber} (${svc.serviceAddress}) is active using ${m.label}. Your bill will be drafted automatically on its due date each month (the ${svc.dueDay === 1 ? '1st' : '15th'}). Next draft: ${autopayNext(s, svc)}. No convenience fee applies.` : `AutoPay for account ${svc.accountNumber} (${svc.serviceAddress}) was cancelled. Future bills will not be drafted automatically. Scheduled one-time payments are not affected.`);
      return autopayReview(s, a, q);
    });
  };
  // ---------- wallet ----------
  P.tusWallet = function (id, session) { return this.transact(id, s => { need(tus(s), 'Unavailable', 404); const a = authorized(s, session); event(s, 'tus_wallet_viewed', {accountId: a.id}); return {methods: a.methods.map(m => ({...safeMethod(m), autopayAccounts: s.tusServiceAccounts.filter(v => v.autopay.enabled && v.autopay.profileId === a.id && v.autopay.methodId === m.id).map(v => v.accountNumber), scheduledPayments: (s.scheduledPayments || []).filter(p => p.status === 'scheduled' && p.profileId === a.id && p.methodId === m.id).length})), walletTypes: WALLET_TYPES}; }); };
  P.tusWalletAdd = function (id, session, input = {}) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404); const a = authorized(s, session), m = newInstrument(s, input, true);
      need(!a.methods.some(x => x.instrumentHash === m.instrumentHash), 'This payment method is already in your wallet');
      need(a.methods.length < 10, 'Your wallet can hold up to 10 payment methods');
      const {save, ...stored} = m, methodId = `${m.kind}-${m.last4}-${a.methods.length + 1}`; a.methods.push({...stored, id: methodId, version: 1});
      event(s, 'payment_method_added', {accountId: a.id, methodId}); return {method: safeMethod(a.methods.at(-1))};
    });
  };
  P.tusWalletRemove = function (id, session, {methodId} = {}) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404); const a = authorized(s, session), m = a.methods.find(x => x.id === methodId); need(m, 'Payment method not found', 404);
      need(!s.tusServiceAccounts.some(v => v.autopay.enabled && v.autopay.profileId === a.id && v.autopay.methodId === m.id), 'This method is used for AutoPay. Change or cancel AutoPay first.');
      need(!(s.scheduledPayments || []).some(p => p.status === 'scheduled' && p.profileId === a.id && p.methodId === m.id), 'This method is used by a scheduled payment. Edit or cancel that payment first.');
      a.methods = a.methods.filter(x => x.id !== m.id); event(s, 'payment_method_removed', {accountId: a.id, methodId: m.id}); return {removed: true};
    });
  };
  // ---------- eBill (city website form, documented separately from the payment portal) ----------
  P.tusEBill = function (id, input = {}) {
    return this.transact(id, s => {
      need(tus(s), 'Unavailable', 404);
      need(input.acceptTerms === true, 'Read and agree to the eBill terms and conditions');
      need(['enroll', 'update', 'unsubscribe'].includes(input.action), 'Choose Enroll, Update or Unsubscribe');
      const svc = resolveSvc(s, input.accountNumber, input.customerNumber);
      const name = String(input.name || '').trim(); need(name.length > 0, 'Enter the account holder name');
      const normName = v => v.toUpperCase().replace(/[^A-Z]/g, ''); need(normName(name) === normName(svc.name) || normName(name) === normName(svc.name.split(' ').reverse().join(' ')), 'The account holder name does not match this account');
      const email = String(input.email || '').trim().toLowerCase();
      if (input.action !== 'unsubscribe') { need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter the email address for your eBills'); need(email === String(input.confirmEmail || '').trim().toLowerCase(), 'Email addresses do not match'); }
      if (input.action === 'enroll') need(svc.ebill.status !== 'enrolled', 'This account is already enrolled in eBill. Choose Update to change the email address.');
      if (input.action === 'update') need(svc.ebill.status === 'enrolled', 'This account is not enrolled in eBill. Choose Enroll.');
      if (input.action === 'unsubscribe') need(svc.ebill.status === 'enrolled', 'This account is not enrolled in eBill.');
      const before = {...svc.ebill}, reference = `EB-${String(s.tusEBillSubmissions.length + 1).padStart(4, '0')}-${svc.accountNumber.slice(-4)}`;
      const to = input.action === 'unsubscribe' ? svc.ebill.email : email;
      // Documented: paper bills stop once the confirmation email is successfully delivered.
      cityMail(s, to, input.action === 'unsubscribe' ? 'You have unsubscribed from City of Tuscaloosa eBill' : 'City of Tuscaloosa eBill enrollment confirmation',
        input.action === 'unsubscribe' ? `Account ${svc.accountNumber} has been unsubscribed from e-billing (reference ${reference}). Paper bills will resume; there may be a delay of one or two billing cycles.` : `Account ${svc.accountNumber} (${svc.serviceAddress}) will receive bills by email at ${email} (reference ${reference}). Paper bills stop now that this confirmation was delivered. Add donotreplymunis@tuscaloosa.com to your address book.`);
      svc.ebill = input.action === 'unsubscribe' ? {status: 'paper', email: null, version: before.version + 1, updatedAt: s.now} : {status: 'enrolled', email, version: before.version + 1, updatedAt: s.now};
      s.tusEBillSubmissions.push({reference, serviceAccountId: svc.id, action: input.action, email: to, name, at: s.now});
      event(s, 'tus_ebill_changed', {serviceAccountId: svc.id, action: input.action, email: svc.ebill.email, reference});
      return {reference, action: input.action, accountNumber: svc.accountNumber, email: to};
    });
  };
  // ---------- clock: scheduled payments and AutoPay drafts ----------
  P.tusRun = function (s, from, to) {
    const executed = [], fromDay = iso(from), toDay = iso(to);
    const days = []; for (let t = Date.parse(fromDay + 'T00:00:00Z') + DAY; t <= Date.parse(toDay + 'T00:00:00Z'); t += DAY) days.push(iso(t));
    for (const day of days) {
      s.now = Math.max(s.now, Date.parse(day + 'T06:00:00Z'));
      for (const p of (s.scheduledPayments || []).filter(x => x.status === 'scheduled' && x.date <= day)) {
        const a = account(s, p.profileId), svc = svcById(s, p.serviceAccountId), m = p.methodId ? a.methods.find(x => x.id === p.methodId) : p.instrument;
        if (!m) { p.status = 'failed'; p.failure = 'payment method removed'; event(s, 'tus_schedule_failed', {scheduleId: p.id, reason: p.failure}); executed.push({scheduleId: p.id, status: 'failed'}); continue; }
        if (m.kind === 'card') { try { validateExpiry(m.expiry, s.now); } catch { p.status = 'failed'; p.failure = 'card expired'; event(s, 'tus_schedule_failed', {scheduleId: p.id, reason: p.failure}); portalMail(s, a.email, 'Your scheduled payment could not be processed', `Scheduled payment ${p.confirmation} for account ${svc.accountNumber} failed because ${m.label} has expired.`); executed.push({scheduleId: p.id, status: 'failed'}); continue; } }
        const amount = Math.min(p.amountCents, balance(s, svc));
        if (amount <= 0) { p.status = 'skipped'; p.failure = 'no balance due'; event(s, 'tus_schedule_skipped', {scheduleId: p.id}); executed.push({scheduleId: p.id, status: 'skipped'}); continue; }
        const pay = postPayment(s, {profileId: a.id, svc, amountCents: amount, method: m, source: 'scheduled', authenticated: true, receiptEmail: a.email, date: day, scheduleId: p.id});
        p.status = pay.status === 'returned' ? 'returned' : 'processed'; p.paymentId = pay.id; event(s, 'tus_schedule_executed', {scheduleId: p.id, paymentId: pay.id, status: pay.status});
        if (pay.status === 'returned') nsf(s, a, svc, pay); else portalMail(s, a.email, 'Scheduled payment processed', `Your scheduled payment of ${money(pay.amountCents)} for account ${svc.accountNumber} was processed on ${day}. Confirmation number: ${pay.confirmation}.`);
        executed.push({scheduleId: p.id, paymentId: pay.id, status: pay.status});
      }
      for (const svc of s.tusServiceAccounts.filter(v => v.autopay.enabled)) {
        for (const inv of invoices(s, svc).filter(i => i.dueDate === day && i.dueDate >= svc.autopay.firstDraftDate && !i.purpose)) {
          const key = `tus-autopay:${svc.id}:${inv.id}`; if (s.schedulerKeys.includes(key)) continue; s.schedulerKeys.push(key);
          const a = account(s, svc.autopay.profileId), m = a.methods.find(x => x.id === svc.autopay.methodId), amount = balance(s, svc);
          if (amount <= 0) { event(s, 'tus_autopay_skipped', {serviceAccountId: svc.id, invoiceId: inv.id, reason: 'no balance due'}); executed.push({serviceAccountId: svc.id, invoiceId: inv.id, status: 'skipped'}); continue; }
          let failure = !m ? 'payment method removed' : null; if (m?.kind === 'card') { try { validateExpiry(m.expiry, s.now); } catch { failure = 'card expired'; } }
          if (failure) { event(s, 'tus_autopay_failed', {serviceAccountId: svc.id, invoiceId: inv.id, reason: failure}); portalMail(s, a.email, 'AutoPay payment could not be processed', `AutoPay for account ${svc.accountNumber} could not draft ${money(amount)} on ${day}: ${failure}. Please pay by the delinquent date to avoid service interruption.`); executed.push({serviceAccountId: svc.id, invoiceId: inv.id, status: 'failed'}); continue; }
          const pay = postPayment(s, {profileId: a.id, svc, amountCents: amount, method: m, source: 'autopay', authenticated: true, receiptEmail: a.email, date: day});
          event(s, 'tus_autopay_executed', {serviceAccountId: svc.id, invoiceId: inv.id, paymentId: pay.id, status: pay.status});
          if (pay.status === 'returned') nsf(s, a, svc, pay); else portalMail(s, a.email, 'AutoPay payment processed', `An AutoPay payment of ${money(pay.amountCents)} for account ${svc.accountNumber} was processed on ${day} using ${m.label}. Confirmation number: ${pay.confirmation}.`);
          executed.push({serviceAccountId: svc.id, invoiceId: inv.id, paymentId: pay.id, status: pay.status});
        }
      }
    }
    s.now = to;
    return executed;
  };
  function nsf(s, a, svc, pay) {
    const fee = {id: `inv-nsf-${pay.id}`, accountId: svc.ownerId, serviceAccountId: svc.id, number: `${svc.accountNumber}-NSF`, billDate: iso(s.now), period: 'Returned payment fee', dueDate: iso(s.now + 15 * DAY), units: 0, gallons: 0, lines: [{label: 'Insufficient funds fee', amountCents: NSF_FEE_CENTS}], amountCents: NSF_FEE_CENTS, current: false, purpose: 'nsf_fee'};
    s.invoices.push(fee); event(s, 'tus_payment_returned', {paymentId: pay.id, serviceAccountId: svc.id, feeInvoiceId: fee.id, feeCents: NSF_FEE_CENTS});
    portalMail(s, a.email, 'Payment returned for insufficient funds', `Your payment of ${money(pay.amountCents)} for account ${svc.accountNumber} (confirmation ${pay.confirmation}) was returned for insufficient funds. A $30.00 fee was assessed per municipal code Chapter 2, Article V, Section 2-72. Your balance is now ${money(balance(s, svc))}.`);
  }
  // ---------- grading ----------
  P.tusEvaluate = function (id, outcome = {}) {
    const s = this.state(id), task = taskFor(s), g = task.goal, ev = type => s.events.filter(e => e.type === type);
    const unchanged = (...keys) => keys.every(k => part(s, k) === s.tusBaseline[k]);
    const newPayments = s.payments.filter(p => !p.initial), seq = e => e?.sequence ?? Infinity;
    const others = keys => PARTS.filter(k => !keys.includes(k));
    let checks;
    const answer = String(outcome.confirmation || '').trim();
    if (g.type === 'tus_payment') {
      const p = newPayments[0], method = p?.method;
      checks = {exactly_one_payment: newPayments.length === 1, correct_service_account: p?.serviceAccountId === g.service_account_id, correct_amount: p?.amountCents === g.amount_cents,
        correct_allocation: JSON.stringify(p?.allocations) === JSON.stringify(g.allocations), no_fee: p?.feeCents === 0, posted_today: p?.status === 'posted' && p?.paymentDate === iso(Date.parse('2026-10-03T16:00:00Z')),
        correct_instrument: method?.instrumentHash === (g.method_id ? s.accounts[0].methods.find(m => m.id === g.method_id)?.instrumentHash ?? '' : instrumentHash(g.method_kind, g.method_number, g.routing || '')) && method?.kind === g.method_kind,
        confirmation_reported: Boolean(p) && answer === p.confirmation, no_scheduled_payments: part(s, 'scheduled') === s.tusBaseline.scheduled};
      if (g.guest) Object.assign(checks, {guest_payment: p?.authenticated === false && p?.source === 'guest', correct_receipt_email: p?.receiptEmail === g.receipt_email, card_holder_and_zip: method?.name === g.holder_name && method?.zipCode === g.zip_code && method?.expiry === g.expiry, no_sign_in: !ev('tus_login').length, wallet_unchanged: unchanged('wallet')});
      else Object.assign(checks, {authenticated_payment: p?.authenticated === true && p?.source === 'portal' && p?.profileId === 'acct-primary', saved_method_used: p?.method.id === g.method_id, wallet_unchanged: unchanged('wallet')});
      Object.assign(checks, {other_state_unchanged: unchanged('autopay', 'ebill', 'profiles', 'credentials', 'invoices')});
    } else if (g.type === 'tus_registration') {
      const a = s.accounts.find(x => x.email === g.email), reg = ev('tus_registered').filter(e => e.accountId === a?.id), link = ev('tus_account_linked').find(e => e.accountId === a?.id), ap = ev('autopay_changed').filter(e => e.accountId === a?.id);
      const home = svcById(s, g.service_account_id), m = a?.methods.find(x => x.id === home.autopay.methodId);
      checks = {registered_once: reg.length === 1 && s.accounts.filter(x => x.registered && x.id.startsWith('acct-new')).length === 0, correct_password: Boolean(a?.credential) && matches(g.password, a.credential),
        correct_profile: a?.tusProfile?.firstName === g.first_name && a?.tusProfile?.lastName === g.last_name && a?.tusProfile?.phone === g.phone && a?.tusProfile?.zipCode === g.zip_code,
        linked_only_requested_account: JSON.stringify(a?.tusLinks) === JSON.stringify([g.service_account_id]) && Boolean(link) && seq(reg[0]) < seq(link),
        new_bank_saved: a?.methods.length === 1 && m?.kind === 'bank' && m?.instrumentHash === instrumentHash('bank', g.bank_account_number, g.routing) && m?.accountType === g.account_type && m?.name === g.holder_name,
        autopay_enabled: home.autopay.enabled === true && home.autopay.profileId === a?.id && ap.length === 1 && seq(link) < seq(ap[0]),
        autopay_first_draft_next_due_date: home.autopay.firstDraftDate === g.first_draft_date,
        confirmation_email_sent: s.mail.some(x => x.to === g.email && x.subject === 'AutoPay enrollment confirmation'),
        other_autopay_unchanged: s.tusServiceAccounts.filter(v => v.id !== home.id).every(v => JSON.stringify(v.autopay) === JSON.stringify(JSON.parse(s.tusBaseline.autopay).find(([k]) => k === v.id)[1])),
        no_payments: newPayments.length === 0 && part(s, 'scheduled') === s.tusBaseline.scheduled, ebill_unchanged: unchanged('ebill', 'invoices')};
    } else if (g.type === 'tus_recovery') {
      const a = account(s, 'acct-primary'), resets = ev('password_reset').filter(e => e.accountId === a.id), reset = resets.at(-1), opened = ev('tus_recovery_link_opened').filter(e => e.accountId === a.id).at(-1);
      checks = {reset_once_by_email_link: resets.length === 1 && reset.identityMethod === 'tus_email_link' && seq(opened) < seq(reset), correct_new_password: matches(g.new_password, a.credential),
        signed_in_after_reset: s.events.some(e => e.type === 'tus_login' && e.accountId === a.id && e.sequence > seq(reset)), accounts_viewed_after_login: s.events.some(e => e.type === 'tus_accounts_viewed' && e.accountId === a.id && e.sequence > seq(reset)),
        other_credentials_unchanged: JSON.stringify(JSON.parse(part(s, 'credentials')).filter(([k]) => k !== a.id)) === JSON.stringify(JSON.parse(s.tusBaseline.credentials).filter(([k]) => k !== a.id)),
        business_state_unchanged: unchanged(...others(['credentials']))};
    } else if (g.type === 'tus_schedule') {
      const keep = s.scheduledPayments.find(p => p.id === g.edit_schedule_id), drop = s.scheduledPayments.find(p => p.id === g.cancel_schedule_id);
      checks = {edited_payment_date: keep?.status === 'scheduled' && keep?.date === g.new_date, edited_payment_method: keep?.methodId === g.new_method_id, edited_payment_amount_kept: keep?.amountCents === g.amount_cents,
        other_payment_cancelled: drop?.status === 'cancelled' && ev('tus_schedule_cancelled').length === 1, no_new_payments_or_schedules: newPayments.length === 0 && s.scheduledPayments.length === 2,
        scheduled_date_reported: String(outcome.scheduledDate || '').trim() === g.new_date, other_state_unchanged: unchanged('autopay', 'ebill', 'wallet', 'profiles', 'credentials', 'invoices', 'payments')};
    } else if (g.type === 'tus_autopay') {
      const change = svcById(s, g.change_service_account_id), cancel = svcById(s, g.cancel_service_account_id), base = Object.fromEntries(JSON.parse(s.tusBaseline.autopay));
      checks = {changed_method: change.autopay.enabled && change.autopay.methodId === g.new_method_id && change.autopay.profileId === 'acct-primary', change_kept_original_enrollment: change.autopay.enrolledAt === base[change.id].enrolledAt && change.autopay.firstDraftDate === base[change.id].firstDraftDate,
        cancelled_other: cancel.autopay.enabled === false && ev('autopay_changed').some(e => e.serviceAccountId === cancel.id && e.enabled === false),
        exactly_two_changes: ev('autopay_changed').length === 2, unrelated_autopay_unchanged: s.tusServiceAccounts.filter(v => ![change.id, cancel.id].includes(v.id)).every(v => JSON.stringify(v.autopay) === JSON.stringify(base[v.id])),
        no_payments: newPayments.length === 0, other_state_unchanged: unchanged('ebill', 'wallet', 'profiles', 'credentials', 'invoices', 'scheduled', 'payments')};
    } else if (g.type === 'tus_ebill') {
      const svc = svcById(s, g.service_account_id), subs = s.tusEBillSubmissions.filter(x => x.serviceAccountId === svc.id), base = Object.fromEntries(JSON.parse(s.tusBaseline.ebill));
      checks = {enrolled: svc.ebill.status === 'enrolled' && svc.ebill.email === g.email, single_enrollment_submission: subs.length === 1 && subs[0].action === 'enroll' && s.tusEBillSubmissions.length === 1,
        confirmation_delivered: s.mail.some(m => m.to === g.email && m.subject === 'City of Tuscaloosa eBill enrollment confirmation' && m.text.includes(svc.accountNumber)),
        other_accounts_paper: s.tusServiceAccounts.filter(v => v.id !== svc.id).every(v => JSON.stringify(v.ebill) === JSON.stringify(base[v.id])),
        portal_untouched: !ev('tus_login').length && unchanged(...others(['ebill']))};
    } else if (g.type === 'tus_statement') {
      const d = s.tusDownloads.filter(x => x.invoiceId === g.invoice_id), inv = s.invoices.find(i => i.id === g.invoice_id);
      checks = {statement_downloaded: d.length >= 1 && d.every(x => x.accountId === 'acct-primary'), correct_filename_reported: String(outcome.statementFilename || '').trim() === statementName(s, inv),
        bill_history_viewed: ev('tus_bills_viewed').some(e => e.serviceAccountId === inv.serviceAccountId && e.sequence < seq(s.events.find(x => x.type === 'tus_statement_downloaded' && x.invoiceId === g.invoice_id))),
        business_state_unchanged: unchanged(...PARTS)};
    } else need(false, 'Unknown Tuscaloosa task type', 500);
    return {taskId: task.id, episodeId: id, success: Object.values(checks).every(Boolean), checks, evidenceCohort: task.evidence_cohort};
  };
}
