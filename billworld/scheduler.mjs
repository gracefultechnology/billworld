import {validateExpiry} from './wallet.mjs';
// Deterministic synthetic execution policy: jobs run at 00:00 UTC.
// Source docs establish the AutoPay day, not cutoff times or settlement rules.
export function utcDay(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const value = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date ? value : NaN;
}
export function nextMonth(date) {
  const d = new Date(utcDay(date)); const day = d.getUTCDate();
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last)); return first.toISOString().slice(0, 10);
}
export function runScheduler(s, from, to, ops) {
  s.schedulerKeys ||= []; s.scheduledPayments ||= [];
  const executed = [];
  const once = (key, fn) => { if (s.schedulerKeys.includes(key)) return; s.schedulerKeys.push(key); fn(); executed.push(key); };
  function post({ invoice, amount, method, fee, key, source, receiptEmail }) {
    let failureReason=method.decline?'declined':null;
    if(['duluth-comfortsystems','gvp-electric'].includes(s.siteId)&&method.kind==='card'){try{validateExpiry(method.expiry,s.now);}catch{failureReason='card_expired';}}
    const status = failureReason ? 'failed' : (s.pending ? 'pending' : 'posted');
    const p = { id: `pay-${s.payments.length + 1}`, accountId: invoice.accountId, invoiceId: invoice.id, amountCents: amount,
      feeCents: fee, method: { kind: method.kind, last4: method.last4, label: method.label }, status,
      confirmation: `BW-${s.seed}-${s.payments.length + 1}`, createdAt: s.now, initial: false, source, schedulerKey: key, ...(failureReason?{failureReason}:{}), ...(receiptEmail?{receiptEmail}:{}) };
    s.payments.push(p); ops.event('payment_' + (status === 'failed' ? 'declined' : 'submitted'), { paymentId: p.id, accountId: p.accountId, source, ...(failureReason?{failureReason}:{}) });
    const a = s.accounts.find(a => a.id === p.accountId);
    ops.send(receiptEmail || a.email, status === 'failed' ? 'Your automatic payment failed' : (s.siteId === 'spotify' ? 'Your Premium payment confirmation' : s.siteId === 'avec-electric' ? 'Your electric payment confirmation' : 'Your water/sewer payment confirmation'), `Payment $${(amount / 100).toFixed(2)}, fee $${(fee / 100).toFixed(2)}, status ${status}. Confirmation: ${p.confirmation}.`);
    return p;
  }
  const jobs = [];
  if (s.siteId === 'spotify') {
    let date = s.subscription.renewalDate;
    for (let i = 0; i < 120 && utcDay(date) <= to; i++, date = nextMonth(date)) {
      const at = utcDay(date); if (at > from) jobs.push({ at, type: 'subscription', date });
    }
  } else {
    let d = new Date(from); let year = d.getUTCFullYear(), month = d.getUTCMonth();
    for (let i = 0; i <= 120; i++) {
      const billAt = Date.UTC(year, month, 1);
      const period = `${year}-${String(month + 1).padStart(2, '0')}`;
      if (billAt > from && billAt <= to) jobs.push({ at: billAt, type: 'invoice', period });
      for (const a of s.accounts.filter(a => a.autopay.enabled)) {
        const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        let payAt = Date.UTC(year, month, Math.min(a.autopay.day || 20, last));
        if(s.siteId==='gvp-electric'){while([0,6].includes(new Date(payAt).getUTCDay()))payAt+=86400000;}
        if (payAt > from && payAt <= to) jobs.push({ at: payAt, type: 'autopay', period, accountId: a.id });
      }
      if (billAt > to) break;
      month++; if (month === 12) { month = 0; year++; }
    }
  }
  for (const item of s.scheduledPayments) if (item.status === 'scheduled' && item.at > from && item.at <= to) jobs.push({ at: item.at, type: 'scheduled', item });
  jobs.sort((a, b) => a.at - b.at || ({ invoice: 0, scheduled: 1, autopay: 2, subscription: 3 }[a.type] - { invoice: 0, scheduled: 1, autopay: 2, subscription: 3 }[b.type]));
  for (const job of jobs) {
    s.now = job.at;
    if (job.type === 'invoice') {
      once(`invoice:${job.period}`, () => {
        const a = s.accounts[0]; const id = `inv-${job.period}`;
        if (s.invoices.some(i => i.id === id)) return;
        for (const old of s.invoices.filter(i => i.accountId === a.id)) old.current = false;
        const invoice = { id, accountId: a.id, number: `${job.period}-1048`, period: job.period, dueDate: `${job.period}-20`, amountCents: s.recurringAmountCents || 8432, current: true, synthetic: true };
        s.invoices.push(invoice); ops.event('invoice_created', { invoiceId: id, accountId: a.id }); ops.send(a.email, s.siteId === 'avec-electric' ? 'Your electric bill is ready' : 'Your water/sewer bill is ready', `Invoice ${invoice.number}: $${(invoice.amountCents / 100).toFixed(2)} due ${invoice.dueDate}.`);
      });
    }
    if (job.type === 'autopay') {
      for (const a of s.accounts) if (a.autopay.enabled && a.id === job.accountId) once(`autopay:${a.id}:${job.period}`, () => {
        const inv = s.invoices.find(i => i.accountId === a.id && i.dueDate.slice(0, 7) === job.period);
        const method = a.methods.find(m => m.id === a.autopay.methodId);
        if (!inv || !method || ops.available(inv) <= 0) { ops.event('autopay_skipped', { accountId: a.id, reason: 'No unpaid invoice or usable method' }); return; }
        const amount = ops.available(inv); post({ invoice: inv, amount, method, fee: ops.fee(method.kind, amount), key: `autopay:${a.id}:${job.period}`, source: 'autopay' });
      });
    }
    if (job.type === 'scheduled') once(`scheduled:${job.item.id}`, () => {
      const item = job.item; const inv = s.invoices.find(i => i.id === item.invoiceId);
      if (!inv || item.amountCents > ops.available(inv)) {
        item.status = 'failed'; ops.event('scheduled_payment_failed', { scheduleId: item.id, reason: 'Invoice balance changed' });
        ops.send(s.accounts.find(a => a.id === item.accountId).email, 'Your scheduled payment was not processed', 'The invoice balance changed. No additional payment was made.'); return;
      }
      const method=s.siteId==='duluth-comfortsystems'&&item.method.id?s.accounts.find(a=>a.id===item.accountId)?.methods.find(m=>m.id===item.method.id):item.method;
      if(!method){item.status='failed';ops.event('scheduled_payment_failed',{scheduleId:item.id,reason:'Saved method missing'});return;}
      const p = post({ invoice: inv, amount: item.amountCents, method, fee: item.feeCents, key: `scheduled:${item.id}`, source: 'scheduled', receiptEmail:item.receiptEmail }); item.status = p.status === 'failed' ? 'failed' : 'processed'; item.paymentId = p.id;
    });
    if (job.type === 'subscription') once(`subscription:${job.date}`, () => {
      const sub = s.subscription;
      if (sub.status === 'cancelled_at_period_end') { sub.status = 'free'; sub.plan = 'Spotify Free'; ops.event('subscription_expired', { accountId: sub.accountId }); return; }
      if (sub.status !== 'active' || sub.billingProvider !== 'spotify') return;
      const invoice = { id: `spotify-${job.date}`, accountId: sub.accountId, amountCents: sub.amountCents };
      s.invoices.push(invoice); post({ invoice, amount: sub.amountCents, method: sub.method, fee: 0, key: `subscription:${job.date}`, source: 'subscription' });
      sub.renewalDate = nextMonth(job.date); ops.send(s.accounts.find(a => a.id === sub.accountId).email, 'Your Premium renewal receipt', `Premium renewed. Next billing date: ${sub.renewalDate}.`);
    });
  }
  s.now = to; return executed;
}
