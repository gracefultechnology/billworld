// Runs inside the captured page. Hidden template fields are not observed inputs.
export function captureDOM() {
  const visible = element => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && element.getClientRects().length > 0;
  const field = element => ({
    tag: element.tagName, type: element.type, name: element.name,
    id: element.id, label: element.labels?.[0]?.textContent?.trim() || element.getAttribute('aria-label'),
    text: element.tagName === 'BUTTON' ? element.textContent.trim() : undefined,
    placeholder: element.getAttribute('placeholder'), visible: visible(element),
    disabled: Boolean(element.disabled), required: Boolean(element.required),
    ariaRequired: element.getAttribute('aria-required'),
  });
  return {
    schemaVersion: 2, title: document.title,
    links: [...document.querySelectorAll('a[href]')].map(a => ({ text: a.textContent.trim(), href: a.href, visible: visible(a) })),
    images: [...document.images].map(i => ({ src: i.currentSrc || i.src, alt: i.alt, loading: i.loading, visible: visible(i) })),
    forms: [...document.forms].map(f => ({ action: f.action, method: f.method, fields: [...f.elements].map(field) })),
    controls: [...document.querySelectorAll('button,input,select,textarea,[role="button"]')].map(field),
  };
}

export function captureApplicationReady() {
  if (!document.body || !document.body.innerText.trim()) return false;
  if (/^Loading\.{3}(?:\s|$)/i.test(document.body.innerText.trim())) return false;
  // MyChart's React workflow can replace its loading text with an empty spinner.
  const root = document.querySelector('main.capturedWorkflowPage #appRoot, app-root');
  return !root || root.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && Boolean(root.innerText.trim()) && !/^Loading\.{3}(?:\s|$)/i.test(root.innerText.trim());
}

// This guard is evaluated in the browser immediately before a public UI click.
// Missing button types inside forms default to submit and are deliberately denied.
export function capturePublicUiControl(element) {
  return element.tagName === 'BUTTON' && element.type === 'button' && !element.disabled;
}
