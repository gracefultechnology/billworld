import puppeteer from 'puppeteer';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { captureDOM, captureApplicationReady, capturePublicUiControl } from './capture-dom.mjs';

// Public read-only capture: no login, registration, form submission, or payment.
const sourceSets = { gvp: [
  ['gvp-home','https://www.gvp.org/'],
  ['gvp-ways-pay','https://www.gvp.org/ways-pay'],
  ['gvp-smarthub-guide','https://www.gvp.org/SmartHub'],
  ['gvp-paperless-guide','https://www.gvp.org/paperless'],
  ['gvp-login','https://gvp.smarthub.coop/ui/#/login'],
  ['gvp-registration','https://gvp.smarthub.coop/ui/#/registration'],
  ['gvp-recovery','https://gvp.smarthub.coop/ui/#/accountAccess'],
  ['gvp-paynow','https://gvp.smarthub.coop/ui/#/paynow'],
], duluth: [
  ['duluth-home', 'https://comfortsystemsduluth.com/'],
  ['duluth-portal-guide', 'https://comfortsystemsduluth.com/billing-info/customer-portal/'],
  ['duluth-payment-help', 'https://comfortsystemsduluth.com/billing-info/ways-to-pay/'],
  ['duluth-reading-bill', 'https://comfortsystemsduluth.com/billing-info/reading-your-bill/'],
  ['duluth-billing-help', 'https://comfortsystemsduluth.com/billing-info/bill-assistance/'],
  ['duluth-portal', 'https://duluthmn.municipalonlinepayments.com/duluthmn/utilities'],
  ['duluth-quickpay', 'https://duluthmn.municipalonlinepayments.com/duluthmn/utilities/quickpay'],
  ['duluth-signin', 'https://duluthmn.municipalonlinepayments.com/duluthmn/login?returnUrl=%2Fduluthmn%2Futilities'],
  ['duluth-register', 'https://duluthmn.municipalonlinepayments.com/duluthmn/login?returnUrl=%2Fduluthmn%2Futilities', 'button[data-se="enroll"]'],
  ['duluth-unlock', 'https://duluthmn.municipalonlinepayments.com/duluthmn/login?returnUrl=%2Fduluthmn%2Futilities', 'button[data-se="unlock"]'],
  ['duluth-signin-faq', 'https://duluthmn.municipalonlinepayments.com/duluthmn/signinfaq'],
  ['duluth-utility-faq', 'https://duluthmn.municipalonlinepayments.com/duluthmn/faq/utilities'],
], juneau: [
  ['juneau-home', 'https://juneau.org/'],
  ['juneau-faq', 'https://juneau.org/engineering-public-works/utilities-division/faq'],
  ['juneau-payment', 'https://juneau.org/engineering-public-works/utilities-division/payment-information'],
  ['juneau-portal', 'https://www.invoicecloud.com/cityandboroughofjuneauak'],
], spotify: [
  ['spotify-home', 'https://www.spotify.com/us/'],
  ['spotify-login', 'https://accounts.spotify.com/en/login'],
  ['spotify-support', 'https://support.spotify.com/us/'],
  ['spotify-google-help', 'https://support.spotify.com/us/article/google-login-help/'],
  ['spotify-payment-help', 'https://support.spotify.com/us/article/change-payment-details/'],
  ['spotify-cancellation-help', 'https://support.spotify.com/us/article/cancel-premium/']
], homer: [
  ['homer-home', 'https://www.cityofhomer-ak.gov/'],
  ['homer-billing-help', 'https://www.cityofhomer-ak.gov/finance/utility-bill-payments-and-services'],
  ['homer-faq', 'https://www.cityofhomer-ak.gov/finance/online-bill-pay-tips-and-frequently-asked-questions'],
  ['homer-login', 'https://xpressbillpay.com/#/?org=cityofhomer11061'],
  ['homer-guide', 'https://www.cityofhomer-ak.gov/finance/create-log-and-make-utility-payments-xpress-bill-pay'],
  ['homer-forgot', 'https://xpressbillpay.com/#/forgot-password'],
  ['homer-register', 'https://xpressbillpay.com/customer/#/register/register'],
  ['homer-guest', 'https://guest.xpressbillpay.com/refer/cityofhomer11061'],
  ['xpress-faq', 'https://xpressbillpay.com/faq/']
], tuscaloosa: [
  ['tuscaloosa-home', 'https://www.tuscaloosa.com/'],
  ['tuscaloosa-billing-help', 'https://www.tuscaloosa.com/billinfo'],
  ['tuscaloosa-autopay-help', 'https://www.tuscaloosa.com/ach'],
  ['tuscaloosa-faq', 'https://www.tuscaloosa.com/faqs'],
  ['tuscaloosa-service-center', 'https://www.tuscaloosa.com/onlineservices'],
  ['tuscaloosa-login', 'https://ipn4.paymentus.com/cp/tusl']
], avec: [
  ['avec-home', 'https://avec.org/'],
  ['avec-customer-service', 'https://avec.org/customer-service/'],
  ['avec-billing-help', 'https://avec.org/customer-service/billing-and-payment-options/'],
  ['avec-account-access', 'https://avec.smarthub.coop/ui/#/accountAccess'],
  ['avec-login', 'https://avec.smarthub.coop/ui/#/login'],
  ['avec-registration', 'https://avec.smarthub.coop/ui/#/registration'],
  ['avec-paynow', 'https://avec.smarthub.coop/ui/#/paynow']
] };
const listFlag = process.argv.indexOf('--source-list');
const captureInput = listFlag >= 0 ? JSON.parse(readFileSync(process.argv[listFlag + 1], 'utf8')) : null;
if (captureInput) {
  if (captureInput.mode !== 'public_read_only' || !/^biller_[a-f0-9]{20}$/.test(captureInput.selection) || !Array.isArray(captureInput.sources) || !captureInput.sources.length || captureInput.sources.length > 20) throw new Error('Invalid public catalog capture input');
  const ids = new Set();
  sourceSets[captureInput.selection] = captureInput.sources.map(source => {
    if (!source.id.startsWith(captureInput.selection + '-') || !/^[a-zA-Z0-9_-]+$/.test(source.id) || ids.has(source.id)) throw new Error('Invalid or duplicate capture ID');
    ids.add(source.id);
    const url = new URL(source.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || ['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Invalid public capture URL');
    if (source.publicUiSelector) {
      if (source.publicNavigationFrom || !source.publicUiReadySelector) throw new Error('A public UI capture requires its own ready selector');
      return [source.id, source.url, source.publicUiSelector, undefined, source.publicUiReadySelector, source.publicReadyImages];
    }
    if(source.publicNavigationFrom){
      const start=new URL(source.publicNavigationFrom);
      if(start.origin!==url.origin||start.username||start.password)throw new Error('Public navigation must start on the same source origin');
      const destinations = [...(source.publicNavigationVia || []), source.url].map(value => {
        const destination = new URL(value, start);
        if (destination.origin !== start.origin || destination.username || destination.password) throw new Error('Public navigation must stay on the source origin');
        return `a[href="${destination.pathname+destination.search+destination.hash}"],a[href="${destination.href}"]`;
      });
      return [source.id,source.url,destinations,start.href];
    }
    return [source.id, source.url, undefined, undefined, undefined, source.publicReadyImages];
  });
}
const flag = process.argv.indexOf('--site');
if (captureInput && flag >= 0) throw new Error('Choose either --site or --source-list');
const selection = captureInput?.selection || (flag >= 0 ? process.argv[flag + 1] : 'juneau');
if (!sourceSets[selection]) throw new Error(`Unknown source set: ${selection}`);
const idFlag = process.argv.indexOf('--ids');
const selectedIds = idFlag >= 0 ? process.argv[idFlag + 1].split(',') : null;
if (selectedIds?.some(id => !sourceSets[selection].some(row => row[0] === id))) throw new Error('Unknown capture ID');
const sources = sourceSets[selection].filter(row => !selectedIds || selectedIds.includes(row[0]));
const directory = fileURLToPath(new URL('./captures/', import.meta.url));
mkdirSync(directory, { recursive: true });
const browser = await puppeteer.launch({ headless: true, timeout: 60000 });
const priorPath = `${directory}/${selection}-manifest.json`;
const prior = existsSync(priorPath) ? JSON.parse(readFileSync(priorPath, 'utf8')) : null;
const manifest = { capturedAt: new Date().toISOString(), browser: await browser.version(), mode: 'public_read_only', view: { width: 1365, height: 900 }, pages: (prior?.pages || []).map(page => ({ ...page, capturedAt: page.capturedAt || prior.capturedAt })) };
if (captureInput) manifest.catalogSource = captureInput;
const digest = buffer => createHash('sha256').update(buffer).digest('hex');
try {
  for (const [id, url, navigationSelector, navigationStartUrl, uiReadySelector, readyImages] of sources) {
    const target = `${directory}/${id}`; mkdirSync(`${target}/assets`, { recursive: true });
    const context = await browser.createBrowserContext(); const page = await context.newPage(); await page.setViewport(manifest.view);
    const requests = [], assets = [], pending = [], errors = [], assetErrors = []; let capturedBytes = 0;
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', response => {
      const request = response.request(); const type = request.resourceType();
      requests.push({ url: response.url(), status: response.status(), resourceType: type, method: request.method(), contentType: response.headers()['content-type'] || '' });
      if ((['script', 'stylesheet', 'image', 'font'].includes(type) || type==='other' && response.headers()['content-type']?.split(';')[0]==='image/svg+xml') && response.ok()) {
        pending.push((async () => {
          try {
            let timer;
            let content, retrieval = 'browser_response';
            try {
              content = await Promise.race([
                response.content().finally(() => clearTimeout(timer)),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Asset body deadline exceeded')), 20000); }),
              ]);
            } catch (error) {
              clearTimeout(timer);
              if (type !== 'stylesheet' || request.method() !== 'GET') throw error;
              // Retry only an observed public CSS URL, without browser cookies or form data.
              const retry = await fetch(response.url(), { credentials: 'omit', signal: AbortSignal.timeout(30000) });
              if (!retry.ok || !retry.headers.get('content-type')?.startsWith('text/css')) throw error;
              content = await retry.arrayBuffer(); retrieval = 'public_GET_retry';
            }
            const data = Buffer.from(content);
            if (data.length > 8 * 1024 * 1024 || capturedBytes + data.length > 40 * 1024 * 1024) return;
            capturedBytes += data.length; const filename = digest(data);
            writeFileSync(`${target}/assets/${filename}`, data); assets.push({ url: response.url(), resourceType: type, sha256: filename, bytes: data.length, contentType: response.headers()['content-type'], file: `assets/${filename}`, retrieval });
          } catch (error) { assetErrors.push({ url: response.url(), resourceType: type, error: error.message }); }
        })());
      }
    });
    const record = { id, requestedUrl: url, capturedAt: new Date().toISOString(), evidenceType: 'observed_public', authenticated: false };
    try {
      const response = await page.goto(navigationStartUrl||url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForNetworkIdle({ idleTime: 800, timeout: 10000 }).catch(() => {});
      if (navigationSelector) {
        if(navigationStartUrl)record.navigationStartUrl=navigationStartUrl;
        record.navigationSteps = [];
        for (const selector of Array.isArray(navigationSelector) ? navigationSelector : [navigationSelector]) {
          if (uiReadySelector) {
            const control = await page.waitForSelector(selector, { visible: true });
            if (!await control.evaluate(capturePublicUiControl)) throw new Error('Public UI capture may only click an enabled non-submit button');
            await control.click();
            await page.waitForSelector(uiReadySelector, { visible: true, timeout: 20000 });
            await page.waitForNetworkIdle({ idleTime: 800, timeout: 10000 }).catch(() => {});
            record.navigationSteps.push({ action: 'public_ui_click', selector, readySelector: uiReadySelector, submitsForm: false });
            continue;
          }
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
            page.locator(selector).click(),
          ]);
          await page.waitForSelector('body', { timeout: 20000 });
          await page.waitForNetworkIdle({ idleTime: 800, timeout: 10000 }).catch(() => {});
          record.navigationSteps.push({ action: 'public_navigation_click', selector, submitsForm: false });
        }
      }
      // Network-idle alone can precede a React route's first usable screen.
      if (!await page.evaluate(captureApplicationReady)) {
        record.waitedForApplication = true;
        await page.waitForFunction(captureApplicationReady, { timeout: 20000 }).catch(() => {});
      }
      record.applicationReady = await page.evaluate(captureApplicationReady);
      if (readyImages?.length) {
        await page.waitForFunction(urls => urls.every(url => [...document.images].some(img => (img.currentSrc || img.src) === url && img.complete && img.naturalWidth > 0)), { timeout: 30000 }, readyImages);
        record.readyImageUrls = readyImages;
      }
      record.finalUrl = page.url();
      record.status = requests.findLast(r=>r.resourceType==='document'&&r.url.split('#')[0]===record.finalUrl.split('#')[0])?.status ?? response?.status(); record.title = await page.title();
      const html = await page.content(); writeFileSync(`${target}/page.html`, html); record.htmlSha256 = digest(html);
      // insertRule() styles do not appear in page.content(); preserve observed CSSOM separately.
      const inlineStyles = await page.evaluate(() => [...document.querySelectorAll('style')].map((style,index) => {
        try { return { index, css: [...(style.sheet?.cssRules || [])].map(rule => rule.cssText).join('\n') }; }
        catch { return { index, unavailable: true }; }
      }));
      const styleMetadata = JSON.stringify(inlineStyles, null, 2);
      writeFileSync(`${target}/inline-styles.json`, styleMetadata); record.inlineStylesSha256 = digest(styleMetadata);
      const visibleText = await page.$eval('body', el => el.innerText);
      writeFileSync(`${target}/visible-text.txt`, visibleText);
      const dom = await page.evaluate(captureDOM);
      writeFileSync(`${target}/dom.json`, JSON.stringify(dom, null, 2));
      const cdp = await page.createCDPSession(); const accessibility = await cdp.send('Accessibility.getFullAXTree'); await cdp.detach();
      writeFileSync(`${target}/accessibility.json`, JSON.stringify(accessibility, null, 2));
      await page.screenshot({ path: `${target}/screenshot.png`, fullPage: true });
      record.contentStatus = record.status >= 400 ? 'http_error' : !record.applicationReady ? 'application_not_ready' : 'captured_requires_review';
    } catch (error) { record.error = error.message; record.contentStatus = 'capture_failed'; }
    let assetDeadline;
    const assetCompletion = await Promise.race([
      Promise.allSettled(pending).then(() => 'settled'),
      new Promise(resolve => { assetDeadline = setTimeout(() => resolve('deadline'), 60000); }),
    ]);
    clearTimeout(assetDeadline);
    record.assetCollection = assetCompletion;
    record.assetErrors = assetErrors;
    writeFileSync(`${target}/network.json`, JSON.stringify(requests, null, 2));
    writeFileSync(`${target}/assets.json`, JSON.stringify(assets, null, 2));
    if (id === 'juneau-portal') {
      const logo = assets.find(a => a.url.includes('067f4432-25ca-4d2d-a44f-d1b7f716c77a.png'));
      if (logo) {
        const { readFileSync } = await import('node:fs');
        const localAssets = fileURLToPath(new URL('./public/reference-assets/', import.meta.url));
        mkdirSync(localAssets, { recursive: true });
        writeFileSync(`${localAssets}/juneau-logo.png`, readFileSync(`${target}/${logo.file}`));
      }
    }
    if (id === 'avec-login') {
      const { readFileSync } = await import('node:fs');
      const localAssets = fileURLToPath(new URL('./public/reference-assets/', import.meta.url)); mkdirSync(localAssets, { recursive: true });
      for (const [source, name] of [['260x50_Logo_SH_AVEC.png', 'avec-logo.png'], ['LoginBackground_AVEC_v5.jpg', 'avec-background.jpg']]) {
        const asset = assets.find(a => a.url.includes(source));
        if (asset) writeFileSync(`${localAssets}/${name}`, readFileSync(`${target}/${asset.file}`));
      }
    }
    if (id === 'homer-login') {
      const localAssets = fileURLToPath(new URL('./public/reference-assets/', import.meta.url)); mkdirSync(localAssets, { recursive: true });
      for (const [source, name] of [['xbp-logo.svg', 'xpress-logo.svg'], ['CityofHomer_logo.png', 'homer-logo.png'], ['bg-devices.jpg', 'xpress-background.jpg']]) {
        const asset = assets.find(a => a.url.includes(source));
        if (asset) writeFileSync(`${localAssets}/${name}`, readFileSync(`${target}/${asset.file}`));
      }
    }
    Object.assign(record, { assets: assets.length, assetBytes: capturedBytes, errors, directory: id }); manifest.pages = manifest.pages.filter(page => page.id !== record.id); manifest.pages.push(record);
    await context.close(); console.log(`${id}: ${record.contentStatus} (${assets.length} assets)`);
    writeFileSync(`${directory}/${selection}-manifest.json`, JSON.stringify(manifest, null, 2));
    if (selection === 'juneau') writeFileSync(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2));
  }
} finally { await browser.close(); }
