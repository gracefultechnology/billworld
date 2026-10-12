// Scripted one-tab UI references for the City of Malden / Edmunds WIPP tasks (task_md*). Not an autonomous agent.
export async function maldenReference(page, base, taskId, step) {
  const h1 = t => page.waitForFunction(x => document.querySelector('h1')?.textContent.trim() === x, {}, t);
  const go = async (p, t) => { step(); await page.goto(base + p, { waitUntil: 'domcontentloaded' }); if (t) await h1(t); };
  const fill = (n, v, scope = '') => { step(); return page.locator(`${scope} [name="${n}"]`.trim()).fill(v, { typingThreshold: 0 }); };
  const click = s => { step(); return page.locator(s).click(); };
  const nav = async (s, t) => { step(); await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.locator(s).click()]); if (t) await h1(t); };
  const submitNav = (f, t) => nav(`form[data-form="${f}"] button[type=submit]`, t);
  const login = async (password = 'Billworld-2026!') => { await go('/wipp/home', 'Account Log In'); await fill('email', 'alex@billworld.test'); await fill('password', password); await submitNav('login', 'Summary'); };
  async function mail(subject) {
    await go('/mail');
    if (await page.$('form[data-action="mail-login"]')) { await fill('email', 'alex@billworld.test'); await fill('password', 'Mailbox-2026!'); await click('form[data-action="mail-login"] button'); }
    await page.waitForFunction(s => [...document.querySelectorAll('[data-testid^="email-item-"]')].some(e => e.textContent.includes(s)), {}, subject);
    for (const item of await page.$$('[data-testid^="email-item-"]')) if ((await item.evaluate(e => e.textContent)).includes(subject)) { step(); await (await item.$('.email-content') || item).click(); break; }
    await page.waitForSelector('[data-testid="email-detail"]');
    return page.$eval('[data-testid="email-detail"]', e => e.textContent);
  }
  async function pay({ methodType, other, later, saved }) {
    await click(`input[name=methodType][value=${methodType}]`);
    if (other) { await click('input[name=amountChoice][value=other]'); await fill('amount', other); }
    if (later) { await click('input[name=when][value=later]'); step(); await page.$eval('[name=date]', (e, d) => { e.value = d; }, later); }
    await click('input[name=terms]'); await click('form[data-form=pay] button[type=submit]');
    await nav('[data-transfer] a', 'Payment Details');
    if (saved) await click(`input[name=source][value="saved:${saved}"]`);
    else { await fill('name', 'Alex Morgan'); await fill('routing', '021000021'); await fill('accountNumber', '000001048'); await fill('confirmAccountNumber', '000001048'); await fill('zip', '63863'); await fill('email', 'alex@billworld.test'); }
    await submitNav('details', 'Review Payment'); await click('input[name=authorize]'); await submitNav('submit', 'Confirmation');
  }
  await h1('City of Malden Missouri');
  if (taskId === 'task_md1') {
    await nav('.m-qlinks a[href^="/wipp/home"]', 'Account Log In'); await nav('a[href="/wipp/lookup"]', 'Lookup your account');
    await fill('value', '1001048'); await click('form[data-form=lookup] button[type=submit]'); await click('[data-select="1001048"]');
    await nav('[data-confirm-account]', 'Utility Account 1001048'); await nav('a[href="/wipp/pay/1001048"]', 'Make Payment');
    await pay({ methodType: 'echeck' });
    return { confirmation: await page.$eval('[data-confirmation]', e => e.textContent.trim()) };
  }
  if (taskId === 'task_md2') {
    await login(); await nav('a[aria-label="View/Pay Account 1001048"]', 'Utility Account 1001048'); await nav('a[href="/wipp/pay/1001048"]', 'Make Payment');
    await pay({ methodType: 'card', other: '50.00', saved: 'alex-card-4242' });
    return { confirmation: await page.$eval('[data-confirmation]', e => e.textContent.trim()) };
  }
  if (taskId === 'task_md3') {
    await go('/wipp/home', 'Account Log In'); await nav('a[href="/wipp/create-account"]', 'Create Account');
    for (const [k, v] of Object.entries({ firstName: 'Alex', lastName: 'Morgan', email: 'alex@billworld.test', confirmEmail: 'alex@billworld.test', mobile: '(573) 555-0148', password: 'Registered-2026!', confirmPassword: 'Registered-2026!' })) await fill(k, v);
    await submitNav('register', 'Verify E-Mail');
    const code = (await mail('Verify your WIPP E-Mail')).match(/code is (\d{6})/)[1];
    await go('/wipp/create-account', 'Verify E-Mail'); await fill('code', code); await submitNav('verify', 'Success!');
    await nav('a[href="/wipp/summary"]', 'Summary'); await nav('a.button[href="/wipp/billing-accounts"]', 'My Billing Accounts');
    await fill('accountId', '1001048'); await fill('balance', '84.32'); await click('form[data-form=add] button[type=submit]');
    await page.waitForSelector('[data-link="1001048"]'); await nav('[data-link="1001048"]', 'My Billing Accounts');
    await nav('.w-nav a[href="/wipp/e-billing"]', 'eBilling'); await nav('button[aria-label="Enroll 1001048 in eBilling"]', 'eBilling');
    return {};
  }
  if (taskId === 'task_md4') {
    await go('/wipp/home', 'Account Log In'); await nav('a[href="/wipp/password"]', 'Forgot Password');
    await fill('email', 'alex@billworld.test'); await submitNav('forgot', 'Reset Password');
    const temp = (await mail('WIPP temporary password')).match(/temporary password is: (\S+) \(copy/)[1];
    await go('/wipp/password', 'Reset Password'); await fill('tempPassword', temp); await fill('password', 'Restored-2026!'); await fill('confirmPassword', 'Restored-2026!');
    await submitNav('reset', 'Account Log In'); await fill('email', 'alex@billworld.test'); await fill('password', 'Restored-2026!'); await submitNav('login', 'Summary');
    return {};
  }
  if (taskId === 'task_md5') {
    await login(); await nav('a[aria-label="View/Pay Account 1001048"]', 'Utility Account 1001048');
    await click('button[aria-label^="Delete Scheduled Payment of $25.00"]'); await nav('[data-yes]', 'Utility Account 1001048');
    await nav('a[href="/wipp/pay/1001048"]', 'Make Payment'); await pay({ methodType: 'echeck', later: '2026-10-09', saved: 'alex-bank-1048' });
    const text = await page.$eval('main', e => e.textContent); const m = text.match(/will be paid on (\d{2})\/(\d{2})\/(\d{4})/);
    return { scheduledDate: `${m[3]}-${m[1]}-${m[2]}` };
  }
  if (['task_md6', 'task_md7', 'task_md8'].includes(taskId)) {
    await login(); await nav('.w-nav a[href="/wipp/auto-pay"]', 'AutoPay');
    if (taskId === 'task_md8') { await click('button[aria-label="Unenroll 1001048 from Autopay"]'); await page.waitForSelector('#un-h'); await nav('[data-yes]', 'AutoPay'); }
    else { step(); await page.select('form[data-account="1001048"] [name=methodId]', taskId === 'task_md6' ? 'alex-bank-1048' : 'alex-card-4242'); await nav(taskId === 'task_md6' ? 'button[aria-label="Enroll 1001048 in AutoPay"]' : 'button[aria-label="Save AutoPay payment method for 1001048"]', 'AutoPay'); }
    return {};
  }
  if (taskId === 'task_md9') {
    await login(); await nav('a[aria-label="View/Pay Account 1001048"]', 'Utility Account 1001048');
    await nav('a[href="/wipp/bill/1001048"]', 'City of Malden Board of Public Works — Utility Bill');
    const [m, d, y] = (await page.$eval('[data-due]', e => e.textContent)).split('/');
    const cents = Math.round(Number((await page.$eval('[data-balance]', e => e.textContent)).replace(/[^0-9.]/g, '')) * 100);
    return { billingDate: `${y}-${m}-${d}`, remainingBalanceCents: cents };
  }
  throw new Error('Unknown Malden reference task');
}
