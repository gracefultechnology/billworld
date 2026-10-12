// Billworld integration for the MIT WebArena-Infinity Gmail frontend.
// Authoritative messages are fetched after mailbox authentication. Browser state
// never supplies message bodies, identities, challenges or billing outcomes.
(() => {
  let snapshot = new Map(), ready = false, saving = Promise.resolve(), busy = false, revision = 0, lastPayload = '';
  async function api(path, input) {
    const response = await fetch('/api/mail' + path, input ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {});
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || 'Mailbox unavailable'), { status: response.status });
    return data;
  }
  const fields = email => ({ unread: !email.isRead, starred: !!email.isStarred, archived: !!email.isArchived, trashed: !!email.isTrashed, important: !!email.isImportant, spam: !!email.isSpam });
  const decode = message => {
    const id = Number(message.id.replace('mail-', ''));
    return { id, serverId: message.id, threadId: message.threadId, from: { name: 'Billing notifications', email: message.from },
      to: [{ name: 'Alex Morgan', email: message.to }], cc: [], bcc: [], subject: message.subject, body: message.text, snippet: message.text.slice(0, 140), date: message.receivedAt,
      isRead: !message.unread, isStarred: !!message.starred, starType: message.starred ? 'yellow-star' : null, isImportant: !!message.important,
      isArchived: !!message.archived, isTrashed: !!message.trashed, isSpam: !!message.spam, isDraft: false, isSnoozed: false,
      labels: [...(!message.archived && !message.trashed && !message.spam ? ['INBOX'] : []), 'CATEGORY_PRIMARY', ...(message.important ? ['IMPORTANT'] : [])],
      category: 'primary', hasAttachments: (message.attachments||[]).length>0, attachments: (message.attachments||[]).map(a=>({...a,size:a.sizeBytes+' bytes'})) };
  };
  function accept(messages) {
    lastPayload = JSON.stringify(messages);
    AppState.emails = messages.map(decode);
    snapshot = new Map(AppState.emails.map(email => [email.serverId, fields(email)]));
    AppState._recalculateLabelCounts();
    if (AppState.searchQuery) AppState.searchResults = AppState.searchEmails(AppState.searchQuery);
  }
  const view = emails => JSON.stringify(emails.map(e => [e.serverId, e.subject, e.body, e.date, (e.attachments || []).length, fields(e)]));
  async function refresh() {
    if (busy) return;
    busy = true;
    const began = revision;
    // Re-render only when the server's messages changed: an unconditional 2 s re-render replaced every element,
    // which broke clicks/refs held by agents and assistive tech and discarded focus.
    try { const messages = (await api('')).messages; if (began === revision && JSON.stringify(messages) !== lastPayload) {
      // A save echo (e.g. the server confirming "read" after a message was opened) matches what is already
      // on screen, so adopt it silently instead of replacing the message view the agent just opened.
      const shown = view(AppState.emails); accept(messages); if (ready && view(AppState.emails) !== shown) App.render(); } }
    finally { busy = false; }
  }
  function login(error = '') {
    ready = false;
    document.body.innerHTML = `<main style="max-width:440px;margin:80px auto;padding:24px"><h1>Sign in to Gmail</h1><p>Local Billworld mailbox</p><form data-action="mail-login"><label>Email address<input name="email" type="email" autocomplete="username" required></label><br><label>Mailbox password<input name="password" type="password" autocomplete="current-password" required></label><br><button class="btn btn-primary">Sign in to email</button></form><p id="error" role="alert"></p><a href="/">Back to billing site</a></main>`;
    document.querySelector('#error').textContent = error;
    document.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      try { await api('/login', Object.fromEntries(new FormData(event.target))); location.reload(); }
      catch (failure) { document.querySelector('#error').textContent = failure.message; }
    });
  }
  AppState._persist = () => {};
  AppState._pushStateToServer = () => { if (ready) AppState.notify(); };
  AppState._loadPersistedData = () => null;
  App.setupSSE = () => {};
  AppState.notify = function() {
    revision++;
    const edits = this.emails.map(email => {
      const previous = snapshot.get(email.serverId) || {}, next = fields(email);
      return { id: email.serverId, changes: Object.fromEntries(Object.entries(next).filter(([key, value]) => !!previous[key] !== value)) };
    }).filter(edit => Object.keys(edit.changes).length);
    // Capture optimistic values so opening/rendering a message cannot enqueue duplicates.
    snapshot = new Map(this.emails.map(email => [email.serverId, fields(email)]));
    saving = saving.then(async () => { for (const edit of edits) await api('/update', edit); await refresh(); }).catch(error => {
      if (error.status === 401 || error.status === 403) login(error.message);
      else { Components.showToast(error.message, 'error'); refresh().catch(() => {}); }
    });
    for (const listener of this._listeners) listener();
  };
  // Match the declared connector search subset, including combined operators.
  AppState.searchEmails = function(query) {
    if (!query) return null;
    let items = this.emails;
    for (const term of query.match(/(?:[^\s"]+|"[^"]*")+/g) || []) {
      const clean = term.replaceAll('"', '');
      if (clean === 'is:unread') items = items.filter(e => !e.isRead);
      else if (clean === 'has:attachment') items = items.filter(e=>e.hasAttachments);
      else if (clean.startsWith('from:')) items = items.filter(e => e.from.email.includes(clean.slice(5)));
      else if (clean.startsWith('to:')) items = items.filter(e => e.to.some(t => t.email.includes(clean.slice(3))));
      else if (clean.startsWith('subject:')) items = items.filter(e => e.subject.toLowerCase().includes(clean.slice(8).toLowerCase()));
      else items = items.filter(e => `${e.subject} ${e.body}`.toLowerCase().includes(clean.toLowerCase()));
    }
    return items;
  };
  const card = Views._renderMessageCard;
  Views._renderMessageCard = function(message, expanded) {
    let html = card.call(this, message, expanded);
    if (expanded) {
      html+=(message.attachments||[]).map(a=>`<p><a data-testid="download-${Components.escapeAttr(a.id)}" href="/api/mail/attachment?messageId=${encodeURIComponent(message.serverId)}&amp;attachmentId=${encodeURIComponent(a.id)}" download>${Components.escapeHtml('Download '+a.name)}</a></p>`).join('');
      const links = [...message.body.matchAll(/\/portal\/reset\?token=([A-Za-z0-9_-]+)/g)];
      html += links.map(match => `<p><a href="/portal/reset?token=${encodeURIComponent(match[1])}">Reset your portal password</a></p>`).join('');
      const verificationLinks = [...message.body.matchAll(/\/xpress\/verify-email\?token=([A-Za-z0-9_-]+)/g)];
      html += verificationLinks.map(match => `<p><a href="/xpress/verify-email?token=${encodeURIComponent(match[1])}">Verify Email</a></p>`).join('');
      const cusiLinks = [...message.body.matchAll(/\/Account\/ResetPassword\?token=([A-Za-z0-9_-]+)/g)];
      html += cusiLinks.map(match => `<p><a href="/Account/ResetPassword?token=${encodeURIComponent(match[1])}">Reset your Lockwood password</a></p>`).join('');
      const paymentusLinks = [...message.body.matchAll(/\/paymentus\/reset\?token=([A-Za-z0-9_-]+)/g)];
      html += paymentusLinks.map(match => `<p><a href="/paymentus/reset?token=${encodeURIComponent(match[1])}">Reset your Batavia password</a></p>`).join('');
      const charlotteLinks = [...message.body.matchAll(/\/cp\/ccfl\/reset\?token=([A-Za-z0-9_-]+)/g)];
      html += charlotteLinks.map(match => `<p><a href="/cp/ccfl/reset?token=${encodeURIComponent(match[1])}">Reset your Charlotte County Utilities password</a></p>`).join('');
      // Starnik serves several billers (GMG, Inframark, ...): name the link after the biller in the subject.
      const starnikBrand = Components.escapeHtml((String(message.subject || '').match(/your local (.+?) (?:email|password)$/i) || [])[1] || 'portal');
      const signupLinks=[...message.body.matchAll(/\/starnik\/signup\/verify\?token=([A-Za-z0-9_-]+)/g)];
      html += signupLinks.map(match => `<p><a href="/starnik/signup/verify?token=${encodeURIComponent(match[1])}">Verify your ${starnikBrand} email</a></p>`).join('');
      const starnikLinks=[...message.body.matchAll(/\/starnik\/reset\?token=([A-Za-z0-9_-]+)/g)];
      html += starnikLinks.map(match => `<p><a href="/starnik/reset?token=${encodeURIComponent(match[1])}">Reset your ${starnikBrand} password</a></p>`).join('');
      const authorityLinks=[...message.body.matchAll(/\/site\/reset-password\?token=([A-Za-z0-9_-]+)/g)];
      html += authorityLinks.map(match => `<p><a href="/site/reset-password?token=${encodeURIComponent(match[1])}">Reset your Town of Swepsonville password</a></p>`).join('');
      const tuscaloosaLinks=[...message.body.matchAll(/\/cp\/tusl\/reset\?token=([A-Za-z0-9_-]+)/g)];
      html += tuscaloosaLinks.map(match => `<p><a href="/cp/tusl/reset?token=${encodeURIComponent(match[1])}">Reset your City of Tuscaloosa customer portal password</a></p>`).join('');
      // Any other same-site token link in a message body is still rendered as a clickable link.
      const known = /^\/(?:portal\/reset|xpress\/verify-email|Account\/ResetPassword|paymentus\/reset|starnik\/signup\/verify|starnik\/reset|site\/reset-password|cp\/tusl\/reset)$/;
      const otherLinks = [...message.body.matchAll(/(?:^|\s)(\/[A-Za-z][A-Za-z0-9\/_-]*)\?token=([A-Za-z0-9_-]+)/g)].filter(match => !known.test(match[1]));
      html += otherLinks.map(match => `<p><a href="${Components.escapeAttr(match[1])}?token=${encodeURIComponent(match[2])}">Open link: ${Components.escapeHtml(match[1])}</a></p>`).join('');
    }
    return html;
  };
  // Inbox rows open via an explicit link so keyboard and accessibility-tree agents can open them.
  const row = Views._renderEmailRow;
  Views._renderEmailRow = function(email) {
    const label = `Open message: ${email.subject} from ${email.from.name}`;
    return row.call(this, email).replace(/<span class="email-subject-text">([\s\S]*?)<\/span>/, (_, subject) =>
      `<a class="email-subject-text email-open" href="#/email/${email.id}" aria-label="${Components.escapeAttr(label)}" data-testid="email-open-${email.id}">${subject}</a>`);
  };
  const render = App.render;
  App.render = function() {
    render.call(this);
    for (const selector of ['#composeBtn', '#settingsBtn', '#searchOptionsBtn', '[data-route="snoozed"]', '[data-route="sent"]', '[data-route="drafts"]', '[data-action="empty-trash"]', '[data-action="create-label"]', '[data-action="manage-labels"]', '[data-action="reply"]', '[data-action="reply-all"]', '[data-action="forward"]', '[data-action="snooze-email"]', '[data-action="label-email"]', '[data-action="more-message-actions"]'])
      document.querySelectorAll(selector).forEach(element => element.hidden = true);
  };
  const init = App.initApp;
  App.initApp = async function() {
    try {
      const messages = (await api('')).messages;
      const seed = AppState._loadSeedData;
      AppState._loadSeedData = function() {
        seed.call(this);
        this.currentUser = { id: 'mail-alex', name: 'Alex Morgan', email: 'alex@billworld.test', avatarColor: '#1a73e8' };
        this.settings.categoriesEnabled = { social: false, promotions: false, updates: false, forums: false };
        this.settings.importanceMarkers = false;
        this.contacts = []; this.filters = []; this.labels = this.labels.filter(label => label.type === 'system');
        accept(messages);
      };
      init.call(this); ready = true;
      document.addEventListener('click', event => {
        const action = event.target.closest('[data-action]')?.dataset.action || '';
        if (/(snooze|mute|label|filter|compose|send-email|reply|forward|delete-permanent|empty-trash|settings|draft)/.test(action)) {
          event.preventDefault(); event.stopImmediatePropagation();
          Components.showToast('This mailbox supports reading, searching and organizing messages. This action is unavailable.', 'error');
        }
      }, true);
      const style = document.createElement('style'); style.textContent = '[hidden]{display:none!important}a.email-open{color:inherit;text-decoration:none}a.email-open:focus-visible{outline:2px solid #1a73e8;outline-offset:2px}.email-message-body a,.email-detail a[href]{color:#1a73e8;text-decoration:underline}'; document.head.append(style);
      const banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;padding:6px 16px;background:#e8f0fe;z-index:1000;display:flex;gap:24px;align-items:center';
      banner.innerHTML = '<h1 style="font-size:14px;margin:0">Inbox</h1><span>Billworld mock Gmail</span><a href="/">Billing site</a><button id="mail-signout">Sign out</button><span id="mail-status" role="status"></span>';
      document.body.append(banner);
      document.querySelector('#mail-signout').addEventListener('click', async () => { await api('/logout', {}); location.reload(); });
      setInterval(() => { if (ready) saving.then(refresh).catch(error => { if ([401, 403].includes(error.status)) login(error.message); }); }, 2000);
    } catch (error) { login([401, 403].includes(error.status) ? '' : error.message); }
  };
})();
