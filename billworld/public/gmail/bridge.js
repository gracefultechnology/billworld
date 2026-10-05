// Billworld integration for the MIT WebArena-Infinity Gmail frontend.
// Authoritative messages are fetched after mailbox authentication. Browser state
// never supplies message bodies, identities, challenges or billing outcomes.
(() => {
  let snapshot = new Map(), ready = false, saving = Promise.resolve(), busy = false, revision = 0;
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
    AppState.emails = messages.map(decode);
    snapshot = new Map(AppState.emails.map(email => [email.serverId, fields(email)]));
    AppState._recalculateLabelCounts();
    if (AppState.searchQuery) AppState.searchResults = AppState.searchEmails(AppState.searchQuery);
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    const began = revision;
    try { const messages = (await api('')).messages; if (began === revision) { accept(messages); if (ready) App.render(); } }
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
      const signupLinks=[...message.body.matchAll(/\/starnik\/signup\/verify\?token=([A-Za-z0-9_-]+)/g)];
      html += signupLinks.map(match => `<p><a href="/starnik/signup/verify?token=${encodeURIComponent(match[1])}">Verify your Greater Minnesota Gas email</a></p>`).join('');
      const starnikLinks=[...message.body.matchAll(/\/starnik\/reset\?token=([A-Za-z0-9_-]+)/g)];
      html += starnikLinks.map(match => `<p><a href="/starnik/reset?token=${encodeURIComponent(match[1])}">Reset your Greater Minnesota Gas password</a></p>`).join('');
    }
    return html;
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
      const style = document.createElement('style'); style.textContent = '[hidden]{display:none!important}'; document.head.append(style);
      const banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;padding:6px 16px;background:#e8f0fe;z-index:1000;display:flex;gap:24px;align-items:center';
      banner.innerHTML = '<h1 style="font-size:14px;margin:0">Inbox</h1><span>Billworld mock Gmail</span><a href="/">Billing site</a><button id="mail-signout">Sign out</button><span id="mail-status" role="status"></span>';
      document.body.append(banner);
      document.querySelector('#mail-signout').addEventListener('click', async () => { await api('/logout', {}); location.reload(); });
      setInterval(() => { if (ready) saving.then(refresh).catch(error => { if ([401, 403].includes(error.status)) login(error.message); }); }, 2000);
    } catch (error) { login(error.status === 401 ? '' : error.message); }
  };
})();
