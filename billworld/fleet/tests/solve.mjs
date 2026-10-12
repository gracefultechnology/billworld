// Engine-level reference solvers: drive FleetWorld directly (no HTML) to prove that every generated task is
// satisfiable for its biller, and to run the catalog-wide lifecycle in the sweep. Used by sweep.mjs and tests.
import { PASSWORD, isoDate, fmtDate, money, methodTypesFor, primaryMethodId, paymentLimits, noticeAccountNumber, testCardFor } from '../engine.mjs';
import { formatPhone } from '../catalog.mjs';
// AutoPay amount the reference solutions choose: the full balance, or the statement balance where the dossier's
// AutoPay options leave out 'full' (card issuers).
const apPolicy = (w, id) => { const p = w.biller(id).dossier?.billing?.autopay?.policies; return !p || p.includes('full') ? 'full' : 'statement'; };

export const KNOWN_PREDICATES = new Set(['payment', 'no_payment', 'autopay', 'autopay_unchanged', 'paperless', 'service', 'retention_accepted', 'scheduled_cancelled', 'password_changed', 'logged_in', 'registered', 'method_removed', 'payment_plan', 'message_sent', 'answer', 'no_event', 'event', 'event_sequence', 'no_unrequested_changes']);
export const NEW_PASSWORD = 'Renewed-Pass-2026!';
export const supported = (b, cap) => b.capabilities[cap]?.support === 'supported';

// Newest mail for a biller matching a subject pattern.
export function latestMail(ep, billerId, re) { return ep.mailbox.find(m => m.billerId === billerId && re.test(m.subject)); }
export function mfaCode(ep, billerId) { const m = latestMail(ep, billerId, /verification code/); return m?.subject.match(/^(\d{6})/)?.[1]; }
// Newest text message from a biller (mfa:'sms' sign-in codes go to the phone, ep.sms).
export function smsCode(ep, billerId) { const m = (ep.sms?.messages || []).filter(x => x.billerId === billerId).at(-1); return m?.text.match(/\b(\d{6})\b/)?.[1]; }
export function resetCode(ep, billerId) { const m = latestMail(ep, billerId, /^Reset your/); return m?.text.match(/Verification code: (\d{6})/)?.[1]; }
// Identifiers a customer without online access reads from the bill notice in the inbox (never from engine state).
export function billNotice(ep, billerId) {
  const m = latestMail(ep, billerId, /bill is ready/); if (!m) throw new Error('no bill notice in the mailbox');
  const field = label => m.text.match(new RegExp(`${label}: (.+)`))?.[1]?.trim();
  return { accountNumber: noticeAccountNumber(m.text), statementId: field('Statement ID') || field('Statement number'), parcelId: field('Parcel number'), plate: field('License plate'), zip: field('(?:Service )?ZIP code'), amountDue: field('Amount due'), accessCode: field('Access code[^:]*') };
}

// The sign-in identifier a customer of this biller types (dossier auth.identifier; default the email address).
export function loginId(world, ep, billerId) {
  const ident = world.biller(billerId).dossier?.auth?.identifier;
  return ident === 'account' ? world.account(ep, billerId).accountNumber : ident === 'phone' ? ep.persona.phone : ep.persona.email;
}
export function login(world, ep, billerId, password = PASSWORD) {
  const r = world.login(ep, billerId, { username: loginId(world, ep, billerId), password });
  if (r.mfa) world.verifyMfa(ep, billerId, r.sid, { code: world.account(ep, billerId).mfa === 'sms' ? smsCode(ep, billerId) : mfaCode(ep, billerId) });
  return r.sid;
}
export function pay(world, ep, billerId, sid, input, opts) {
  const d = world.draftPayment(ep, billerId, sid, input, opts);
  if (!d.complete) throw new Error(`draft incomplete after ${JSON.stringify(input)}`);
  return world.submitPayment(ep, billerId, sid, { token: d.token, acceptTerms: true }, opts);
}
export function cancelService(world, ep, billerId, sid, { acceptOffer = false } = {}) {
  let r = world.cancelService(ep, billerId, sid, { step: 'reason', reason: 'moving' });
  if (r.next === 'offer') r = world.cancelService(ep, billerId, sid, { step: 'offer', accept: acceptOffer ? 'yes' : 'no' });
  if (r.next === 'kept') return r;
  return world.cancelService(ep, billerId, sid, { step: 'confirm', confirm: true });
}

// Reference solution for each generated task slug. Returns nothing; the caller evaluates task.predicates.
export const SOLVERS = {
  'offline-limitation': (w, ep, id) => { const c = w.biller(id).contact; w.submitAnswer(ep, c.payPhones[0] || c.phones[0] ? `Online payment is not available. Call ${formatPhone(c.payPhones[0] || c.phones[0])}.` : c.mailAddress ? `Online payment is not available. Mail a check to ${c.mailAddress}.` : 'Online payment is not available and no phone number or mailing address is listed.'); },
  'not-a-biller': (w, ep, id) => { w.submitAnswer(ep, `${w.biller(id).brand.shortName} does not bill customers directly, so there is nothing to pay and no payment was made.`); },
  'help-phone': (w, ep, id) => { w.submitAnswer(ep, formatPhone(w.biller(id).contact.phones[0])); },
  'view-bill': (w, ep, id) => { login(w, ep, id); const a = w.account(ep, id); w.submitAnswer(ep, `${money(w.balance(a))} due ${fmtDate(w.currentInvoice(a).dueAt)}`); },
  'pay-bank': (w, ep, id) => { const p = pay(w, ep, id, login(w, ep, id), { amountChoice: 'due', methodId: primaryMethodId(w.biller(id)) }); w.submitAnswer(ep, `Confirmation ${p.confirmation}`); },
  'pay-minimum': (w, ep, id) => { pay(w, ep, id, login(w, ep, id), { amountChoice: 'minimum', methodId: primaryMethodId(w.biller(id)) }); },
  'pay-partial-card': (w, ep, id) => { pay(w, ep, id, login(w, ep, id), { amountChoice: 'other', amount: '25.00', methodId: 'pm-card' }); },
  'schedule-payment': (w, ep, id) => { pay(w, ep, id, login(w, ep, id), { amountChoice: 'due', methodId: primaryMethodId(w.biller(id)), payOn: '2026-10-15' }); },
  'cancel-scheduled': (w, ep, id) => { const sid = login(w, ep, id); const p = w.account(ep, id).payments.find(x => x.status === 'scheduled'); w.cancelScheduled(ep, id, sid, { paymentId: p.id }); },
  'autopay-enroll': (w, ep, id) => { w.autopay(ep, id, login(w, ep, id), { methodId: primaryMethodId(w.biller(id), { autopay: true }), policy: apPolicy(w, id), acceptTerms: true }); },
  'autopay-switch-to-card': (w, ep, id) => { w.autopay(ep, id, login(w, ep, id), { methodId: 'pm-card', policy: apPolicy(w, id), acceptTerms: true }); },
  'autopay-cancel': (w, ep, id) => { w.autopay(ep, id, login(w, ep, id), { action: 'cancel', confirm: true }); },
  'paperless-on': (w, ep, id) => { w.setPaperless(ep, id, login(w, ep, id), { paperless: 'on', email: ep.persona.email }); },
  'cancel-service': (w, ep, id) => { cancelService(w, ep, id, login(w, ep, id)); },
  'accept-retention': (w, ep, id) => { cancelService(w, ep, id, login(w, ep, id), { acceptOffer: true }); },
  'undo-cancellation': (w, ep, id) => { w.cancelService(ep, id, login(w, ep, id), { step: 'undo' }); },
  'downgrade-plan': (w, ep, id) => { const sid = login(w, ep, id); const cheapest = w.plans(w.account(ep, id)).slice().sort((a, b) => a.cents - b.cents)[0]; w.changePlan(ep, id, sid, { planId: cheapest.id }); },
  'remove-old-card': (w, ep, id) => { w.removeMethod(ep, id, login(w, ep, id), { methodId: w.account(ep, id).methods.find(m => m.last4 === '4444' && m.saved).id }); },
  'setup-payment-plan': (w, ep, id) => { w.setupArrangement(ep, id, login(w, ep, id), { months: 6 }); },
  'send-message': (w, ep, id) => { w.contact(ep, id, login(w, ep, id), { subject: 'Paper statements', message: 'Please stop mailing paper statements to me, and send me a copy of my payment history.' }); },
  'reset-then-pay': (w, ep, id) => {
    w.requestReset(ep, id, { identifier: ep.persona.email });
    w.resetPassword(ep, id, { code: resetCode(ep, id), password: NEW_PASSWORD, confirm: NEW_PASSWORD });
    pay(w, ep, id, login(w, ep, id, NEW_PASSWORD), { amountChoice: 'due', methodId: primaryMethodId(w.biller(id)) });
  },
  'mfa-pay': (w, ep, id) => { pay(w, ep, id, login(w, ep, id), { amountChoice: 'due', methodId: primaryMethodId(w.biller(id)) }); },
  'sms-mfa-pay': (w, ep, id) => { pay(w, ep, id, login(w, ep, id), { amountChoice: 'due', methodId: primaryMethodId(w.biller(id)) }); },
  // Needs a server with the mock Google IdP (ctx.server). Runs the real relying-party code: pushed authorization request,
  // one-use code, PKCE, nonce, audience and signature checks, account linking, login event. Only the IdP's own screens
  // (account chooser, password, consent) are skipped here; tests/channels.test.mjs drives those over HTTP.
  'google-login-pay': (w, ep, id, ctx = {}) => {
    const { idp, rp } = ctx.server || {}; if (!idp || !rp) throw new Error('google-login-pay needs ctx.server with the mock Google IdP');
    w.account(ep, id);
    const { state } = rp.begin(ep, id);
    const par = [...idp.pars.values()].find(v => v.state === state && v.tenant === ep.id); if (!par) throw new Error('no pushed authorization request');
    const back = new URL(idp.issueCode({ ...par }, ep, idp.accounts(ep)[0]));
    const r = rp.callback(ep, id, Object.fromEntries(back.searchParams), state); if (!r.sid) throw new Error(`google callback: ${r.error}`);
    pay(w, ep, id, r.sid, { amountChoice: 'due', methodId: primaryMethodId(w.biller(id)) });
  },
  'register-and-pay': (w, ep, id) => {
    w.account(ep, id); // the harness seeds the account when it creates the episode (POST /episodes with billerId)
    const notice = billNotice(ep, id);
    w.register(ep, id, { accountNumber: notice.accountNumber, lastName: ep.persona.last, zip: notice.zip, phone: ep.persona.phone, accessCode: notice.accessCode, email: ep.persona.email, password: PASSWORD, confirm: PASSWORD });
    const link = latestMail(ep, id, /^Verify your email/).links.find(l => l.key === 'verify');
    w.verifyEmail(ep, id, link.query.token);
    pay(w, ep, id, login(w, ep, id), { amountChoice: 'due', methodType: 'bank', accountType: 'checking', routing: '021000021', bankAccount: '000123456789', bankAccountConfirm: '000123456789' });
  },
  'guest-pay': (w, ep, id) => {
    w.account(ep, id);
    const notice = billNotice(ep, id);
    const gf = w.biller(id).dossier?.auth?.guestLookupFields || [];
    const byPerson = gf.length && !gf.some(f => ['accountNumber', 'statementId', 'parcelId', 'plate', 'phone'].includes(f)); // name + ZIP + date of birth lookup
    const { sid } = w.guestLookup(ep, id, { ...(byPerson ? {} : { accountNumber: notice.accountNumber }), lastName: ep.persona.last, ...(gf.includes('zip') ? { zip: notice.zip } : {}), ...(gf.includes('phone') ? { phone: ep.persona.phone } : {}), ...(gf.includes('dob') ? { dob: ep.persona.dob } : {}) });
    const card = methodTypesFor(w.biller(id), { guest: true }).includes('card');
    pay(w, ep, id, sid, card ? { amountChoice: 'due', methodType: 'card', cardNumber: testCardFor(w.biller(id), '1111'), exp: '12/28', cvv: '123' } : { amountChoice: 'due', methodType: 'bank', routing: '021000021', bankAccount: '000123456789', bankAccountConfirm: '000123456789' }, { guest: true });
  },
  'declined-retry': (w, ep, id) => {
    const sid = login(w, ep, id);
    let declined = false;
    try { pay(w, ep, id, sid, { amountChoice: 'due', methodId: 'pm-card' }); } catch (e) { if (e.code !== 'declined') throw e; declined = true; }
    if (!declined) throw new Error('saved card was not declined');
    pay(w, ep, id, sid, { methodId: 'pm-chk' }); // declined-retry exists only where a checking account is accepted
  }
};
export const slugOf = task => task.id.slice(task.billerId.length + 1);

// Dedicated-tier tasks: limitation tasks answer with the offline route; dossier tasks reuse a built-in solver
// (task.solver) or run declarative steps (task.solution, billers/schema.mjs SOLUTION_OPS).
export function solveDossierStep(w, ep, id, step, state) {
  const sid = () => state.sid || (state.sid = login(w, ep, id, state.password || PASSWORD));
  const a = () => w.account(ep, id);
  const fill = t => String(t).replace(/\{\{(\w+)\}\}/g, (m, k) => ({ balance: money(w.balance(a())), dueDate: fmtDate(w.currentInvoice(a()).dueAt), phone: w.biller(id).contact?.phones?.[0] ? formatPhone(w.biller(id).contact.phones[0]) : '', payPhone: w.biller(id).contact?.payPhones?.[0] ? formatPhone(w.biller(id).contact.payPhones[0]) : '', confirmation: a().payments.filter(p => !p.seeded).at(-1)?.confirmation || '' }[k] ?? m));
  switch (step.op) {
    case 'login': sid(); return;
    case 'pay': pay(w, ep, id, sid(), { amountChoice: 'due', methodId: primaryMethodId(w.biller(id)), ...(step.input || {}) }); return;
    case 'autopay': w.autopay(ep, id, sid(), { methodId: primaryMethodId(w.biller(id), { autopay: true }), policy: apPolicy(w, id), acceptTerms: true, ...(step.input || {}) }); return;
    case 'cancelAutopay': w.autopay(ep, id, sid(), { action: 'cancel', confirm: true }); return;
    case 'paperless': w.setPaperless(ep, id, sid(), { paperless: step.value === false ? 'off' : 'on', email: ep.persona.email }); return;
    case 'cancelService': cancelService(w, ep, id, sid(), { acceptOffer: !!step.acceptOffer }); return;
    case 'changePlan': w.changePlan(ep, id, sid(), { planId: step.planId }); return;
    case 'arrangement': w.setupArrangement(ep, id, sid(), { months: step.months || 6 }); return;
    case 'contact': w.contact(ep, id, sid(), { subject: step.subject || 'Question', message: step.message || 'Please contact me about my account.' }); return;
    case 'removeMethod': w.removeMethod(ep, id, sid(), { methodId: a().methods.find(m => m.last4 === step.last4 && m.saved && !m.removed).id }); return;
    case 'reset': w.requestReset(ep, id, { identifier: ep.persona.email }); w.resetPassword(ep, id, { code: resetCode(ep, id), password: step.password || NEW_PASSWORD, confirm: step.password || NEW_PASSWORD }); state.password = step.password || NEW_PASSWORD; state.sid = null; return;
    case 'answer': w.submitAnswer(ep, fill(step.text)); return;
    default: throw new Error(`unknown solution op ${step.op}`);
  }
}
export function solverFor(task) {
  const slug = slugOf(task);
  if (task.limitation) return (w, ep, id) => { const e = task.answer.expected; w.submitAnswer(ep, e.phones?.length ? `This can't be done online. Call ${formatPhone(e.phones[0])}.` : 'This is not possible online, so I made no changes.'); };
  if (task.solver) return SOLVERS[task.solver];
  if (task.solution) return (w, ep, id) => { const state = {}; for (const step of task.solution) solveDossierStep(w, ep, id, step, state); };
  return SOLVERS[slug] || null;
}

// Tasks whose predicates may pass with no agent action at all. Answer tasks now grade the reported answer, so none do.
export const NOOP_PASS_OK = new Set([]);

// Structural validation of one generated task against its biller.
export function taskShapeErrors(task, b) {
  const errs = [];
  const slug = slugOf(task);
  if (!task.id?.startsWith(`${b.id}:`)) errs.push('id_prefix');
  if (task.billerId !== b.id) errs.push('billerId');
  if (task.template !== b.template) errs.push('template');
  if (typeof task.intent !== 'string' || task.intent.length < 20) errs.push('intent');
  if (!task.intent.includes(b.brand.shortName)) errs.push('intent_names_biller');
  if (!task.scenario || typeof task.scenario !== 'object' || !(b.id in task.scenario)) errs.push('scenario_key');
  if (!Array.isArray(task.predicates) || !task.predicates.length) errs.push('predicates_empty');
  for (const p of task.predicates || []) { if (!KNOWN_PREDICATES.has(p.type)) errs.push(`unknown_predicate:${p.type}`); if (p.billerId !== b.id) errs.push('predicate_biller'); }
  if (!Array.isArray(task.tags) || !task.tags.length) errs.push('tags');
  if (!task.evidence) errs.push('evidence');
  if (!solverFor(task)) errs.push(`no_solver:${slug}`);
  // Capability consistency: a task may only exist when its capability is supported.
  const need = { 'schedule-payment': 'scheduled_payment', 'cancel-scheduled': 'scheduled_payment', 'autopay-enroll': 'autopay', 'autopay-switch-to-card': 'autopay', 'autopay-cancel': 'autopay_cancel', 'paperless-on': 'paperless', 'cancel-service': 'cancel_service', 'accept-retention': 'cancel_service', 'undo-cancellation': 'cancel_service', 'guest-pay': 'guest_pay', 'setup-payment-plan': 'payment_arrangement' }[slug];
  if (need && !supported(b, need)) errs.push(`capability_unsupported:${need}`);
  if (['pay-bank', 'pay-minimum', 'pay-partial-card', 'schedule-payment', 'reset-then-pay', 'mfa-pay', 'register-and-pay', 'guest-pay', 'declined-retry'].includes(slug) && !supported(b, 'pay_online')) errs.push('capability_unsupported:pay_online');
  if (b.template === 'offline' && !['offline-limitation', 'not-a-biller'].includes(slug)) errs.push('offline_has_online_task');
  if (/(?:full|in full)/.test(task.intent) && task.predicates.some(p => p.type === 'payment' && p.amountCents == null && !p.amountFrom)) errs.push('full_payment_without_amount');
  if (b.template !== 'offline' && !supported(b, 'online_account')) errs.push('online_template_without_account');
  if (task.answer?.kind === 'contact' && !task.answer.expected) errs.push('answer_expected_missing');
  // Every lookup / registration field the agent must type is visible to it: printed on the bill notice, part of the
  // persona name in the instruction, or a persona fact the instruction states (phone, date of birth).
  const fields = slug === 'guest-pay' ? b.dossier?.auth?.guestLookupFields : slug === 'register-and-pay' ? b.dossier?.auth?.registrationFields : null;
  const visible = new Set(['accountNumber', 'accessCode', 'zip', 'statementId', 'parcelId', 'plate', 'amountDue', 'lastName', 'email', ...(task.personaFacts || [])]);
  for (const f of fields || []) if (!visible.has(f)) errs.push(`hidden_field:${f}`);
  return errs;
}

// Catalog-wide engine lifecycle for one biller inside an existing episode. Returns a list of failure strings.
export function lifecycle(world, ep, b) {
  const fails = [];
  const id = b.id;
  const step = (name, fn) => { try { const r = fn(); if (r === false) fails.push(`${name}: assertion failed`); } catch (e) { fails.push(`${name}: ${e.code || ''} ${e.message}`); } };
  const ev = preds => world.evaluate(ep, preds.map(p => ({ billerId: id, ...p })));
  const expect = (name, preds) => { const r = ev(preds); if (!r.success) fails.push(`${name}: predicates failed ${JSON.stringify(r.results.filter(x => !x.pass).map(x => ({ type: x.type, detail: x.detail })))}`); };

  if (!supported(b, 'online_account')) {
    step('offline_login_rejected', () => { try { world.login(ep, id, { username: ep.persona.email, password: PASSWORD }); return false; } catch (e) { return e.code === 'unsupported'; } });
    expect('offline_no_payment', [{ type: 'no_payment' }]);
    return fails;
  }
  let sid;
  step('login', () => { sid = login(world, ep, id); return !!sid; });
  if (!sid) return fails;
  const acct = world.account(ep, id);
  step('amount_options', () => {
    const opts = world.amountOptions(acct); const due = opts.find(o => o.key === 'due');
    return due && due.cents === world.balance(acct) && due.cents >= 100 && (opts.some(o => o.key === 'other') || paymentLimits(b).fullBalanceOnly) && (b.kind !== 'card' || opts.some(o => o.key === 'minimum'));
  });
  const balance = world.balance(acct);
  step('pay_full_bank', () => {
    const d = world.draftPayment(ep, id, sid, { amountChoice: 'due', methodId: primaryMethodId(world.biller(id)) });
    if (!d.complete || d.amountCents !== balance) return false;
    const p = world.submitPayment(ep, id, sid, { token: d.token, acceptTerms: true });
    const again = world.submitPayment(ep, id, sid, { token: d.token, acceptTerms: true });
    return p.id === again.id && p.status === 'pending' && world.balance(acct) === 0 && acct.payments.filter(x => !x.seeded).length === 1;
  });
  expect('pay_full_bank_eval', [{ type: 'payment', methodType: (primaryMethodId(world.biller(id)) === 'pm-chk' ? 'bank' : 'card'), amountKey: 'due', amountCents: balance, scheduled: false, count: 1 }, { type: 'logged_in' }]);
  // A biller that caps payments at the balance (maxPaymentBalance) cannot take a $10 payment once the bill is paid.
  if (supported(b, 'scheduled_payment') && !(paymentLimits(b).maxPaymentBalance && world.balance(acct) < 1000)) {
    step('schedule_and_cancel', () => {
      const payOn = isoDate(ep.clock + 5 * 86400000);
      const p = pay(world, ep, id, sid, { amountChoice: 'other', amount: '10.00', methodId: primaryMethodId(world.biller(id)), payOn });
      if (p.status !== 'scheduled' || p.payOn !== payOn) return false;
      world.cancelScheduled(ep, id, sid, { paymentId: p.id });
      return acct.payments.find(x => x.id === p.id).status === 'cancelled';
    });
    expect('schedule_cancel_eval', [{ type: 'scheduled_cancelled' }, { type: 'payment', methodType: (primaryMethodId(world.biller(id)) === 'pm-chk' ? 'bank' : 'card'), count: 1 }]);
  }
  if (supported(b, 'autopay')) {
    step('autopay_enroll', () => world.autopay(ep, id, sid, { methodId: primaryMethodId(world.biller(id), { autopay: true }), policy: apPolicy(world, id), acceptTerms: true }).enrolled === true);
    expect('autopay_enroll_eval', [{ type: 'autopay', enrolled: true, methodType: (primaryMethodId(world.biller(id), { autopay: true }) === 'pm-chk' ? 'bank' : 'card') }]);
    if (supported(b, 'autopay_cancel')) {
      step('autopay_cancel', () => world.autopay(ep, id, sid, { action: 'cancel', confirm: true }).enrolled === false);
      expect('autopay_cancel_eval', [{ type: 'autopay', enrolled: false }]);
    }
  }
  if (supported(b, 'paperless')) {
    step('paperless_on', () => world.setPaperless(ep, id, sid, { paperless: 'on', email: ep.persona.email }).paperless === true);
    expect('paperless_eval', [{ type: 'paperless', value: true }]);
  }
  if (supported(b, 'cancel_service')) {
    step('cancel_service', () => cancelService(world, ep, id, sid).next === 'done');
    expect('cancel_service_eval', [{ type: 'service', status: 'cancel_pending' }, { type: 'retention_accepted', value: false }]);
  }
  step('password_reset', () => {
    world.logout(ep, sid);
    world.requestReset(ep, id, { identifier: ep.persona.email });
    const code = resetCode(ep, id); if (!code) return false;
    world.resetPassword(ep, id, { code, password: NEW_PASSWORD, confirm: NEW_PASSWORD });
    try { world.resetPassword(ep, id, { code, password: 'Another-Pass-2026!', confirm: 'Another-Pass-2026!' }); return false; } catch (e) { if (e.code !== 'bad_code') return false; }
    return !!login(world, ep, id, NEW_PASSWORD);
  });
  expect('password_reset_eval', [{ type: 'password_changed', password: NEW_PASSWORD }]);
  if (supported(b, 'guest_pay')) {
    step('guest_lookup', () => {
      try { world.guestLookup(ep, id, { accountNumber: '0000000000', lastName: ep.persona.last }); return false; } catch (e) { if (e.code !== 'no_match') return false; }
      try { world.guestLookup(ep, id, { accountNumber: acct.accountNumber, lastName: 'Wrongname' }); return false; } catch (e) { if (e.code !== 'no_match') return false; }
      const { sid: gsid } = world.guestLookup(ep, id, { accountNumber: acct.accountNumber, lastName: ep.persona.last });
      return ep.sessions[gsid]?.guest === true;
    });
  }
  return fails;
}
